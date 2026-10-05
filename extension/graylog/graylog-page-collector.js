(function installPageCollector(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document && !root.GraylogPageCollector) root.GraylogPageCollector = api.create(root);
})(globalThis, function pageCollectorModule() {
  'use strict';
  const PAGERS = '.pagination,.pager,[role="navigation"][aria-label*="agination"],[aria-label*="страниц" i],[data-testid*="pagination" i],[class*="Pagination"],[class*="pagination"]';
  const TABLES = 'table';
  const MAX_PAGES = 5, MAX_MESSAGES = 1000, MAX_CHARS = 10 * 1024 * 1024, TTL = 300000;
  const abortError = message => Object.assign(new Error(message || 'Сбор страниц остановлен'), { name: 'AbortError' });
  const visible = node => node?.isConnected !== false && !node?.hidden && node?.getAttribute?.('aria-hidden') !== 'true' && (!node?.getClientRects || node.getClientRects().length > 0);
  const scalar = value => Array.isArray(value) && value.length === 1 ? value[0] : value;
  const PAGE_KEYS = ['page', 'offset', 'pageNumber', 'page_number', 'pageno', 'pageNo', 'page_no'];
  function pageContext(value) { const url = new URL(value); for (const key of PAGE_KEYS) url.searchParams.delete(key); return url.href; }

  function safeButton(button, doc) {
    if (button.getAttribute('role') === 'tab' || button.closest('[role="tablist"]')) return false;
    if (button.getAttribute('target') || button.getAttribute('download') !== null) return false;
    const href = button.getAttribute('href');
    try { return !href || href === '#' || Boolean(doc.location?.href && pageContext(new URL(href, doc.location.href).href) === pageContext(doc.location.href)); }
    catch { return false; }
  }
  function buttonText(button) {
    // Bootstrap's active item can contain an invisible "(current)" label.
    if (!button.cloneNode) return (button.textContent || '').trim();
    const copy = button.cloneNode(true);
    copy.querySelectorAll('.sr-only,.visually-hidden,[aria-hidden="true"]').forEach(node => node.remove());
    return (copy.textContent || '').trim();
  }
  function arrowPagination(element, doc) {
    const captions = [element, ...Array.from(element.querySelectorAll('span,p,label,output')).slice(0, 40)];
    const ranges = new Map();
    for (const caption of captions) {
      const match = /^\s*(?:page|страница)?\s*(\d{1,6})\s*(?:из|of|\/)\s*(\d{1,6})\s*$/i.exec(caption.textContent || '');
      if (match) ranges.set(`${match[1]}/${match[2]}`, [Number(match[1]), Number(match[2])]);
    }
    if (ranges.size !== 1) return null;
    const [currentPage, totalPages] = [...ranges.values()][0];
    if (!currentPage || currentPage > totalPages || totalPages > 100000) return null;
    const directions = new Map();
    for (const button of Array.from(element.querySelectorAll('a,button')).slice(0, 20)) {
      if (!visible(button) || !safeButton(button, doc)) continue;
      const labels = [button.getAttribute('aria-label'), button.getAttribute('title'), button.getAttribute('rel'), button.textContent,
        ...Array.from(button.querySelectorAll('i,svg,span')).slice(0, 5).flatMap(icon => [icon.getAttribute('class'), icon.getAttribute('data-icon')])].filter(Boolean).map(value => value.trim().toLowerCase());
      const roles = new Set();
      for (const label of labels) {
        if (/^(?:first(?: page)?|первая(?: страница)?|в начало|«|<<|⏮)$/.test(label) || /(?:angle-double-left|angles-left|step-backward)/.test(label)) roles.add('first');
        else if (/^(?:last(?: page)?|последняя(?: страница)?|в конец|»|>>|⏭)$/.test(label) || /(?:angle-double-right|angles-right|step-forward)/.test(label)) roles.add('last');
        else if (/^(?:prev(?:ious)?(?: page)?|back|предыдущая(?: страница)?|назад|‹|<|←|keyboard_arrow_left|navigate_before)$/.test(label) || /(?:chevron-left|angle-left|arrow-left)/.test(label)) roles.add('previous');
        else if (/^(?:next(?: page)?|forward|следующая(?: страница)?|вперёд|вперед|›|>|→|keyboard_arrow_right|navigate_next)$/.test(label) || /(?:chevron-right|angle-right|arrow-right)/.test(label)) roles.add('next');
      }
      if (roles.size !== 1) continue;
      const role = [...roles][0];
      if (directions.has(role)) return null;
      directions.set(role, button);
    }
    const enabled = button => button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !button.closest('.disabled');
    if (currentPage > 1 && !enabled(directions.get('previous')) || currentPage < totalPages && !enabled(directions.get('next'))) return null;
    const buttons = new Map();
    for (const [role, target] of [['previous', currentPage-1], ['next', currentPage+1], ['first', 1], ['last', totalPages]]) {
      const button = directions.get(role);
      if (target >= 1 && target <= totalPages && target !== currentPage && enabled(button) && !buttons.has(target)) buttons.set(target, button);
    }
    return { element, buttons, currentPage, totalPages, mode:'arrows' };
  }

  function pagination(doc) {
    const allCandidates = Array.from(doc.querySelectorAll(PAGERS)).filter(visible).slice(0, 20);
    const candidates = allCandidates;
    const results = [];
    for (const element of candidates) {
      // A paginator belongs to the smallest local container with a message table.
      // Never select an unrelated widget simply because it also has page numbers.
      let container = element.parentElement, matched = false;
      for (let depth = 0; container && depth < 6 && container !== doc.body; depth++, container = container.parentElement) {
        const visibleTables = Array.from(container.querySelectorAll(TABLES)).filter(visible);
        const tables = visibleTables.filter(table => !visibleTables.some(other => other !== table && other.contains?.(table)));
        if (!tables.length) continue;
        const messageTables = tables.filter(table => { const header = (table.querySelector('thead') || table.querySelector('tr'))?.textContent || ''; return /timestamp/i.test(header) && /source|message/i.test(header); });
        if (messageTables.length === 1 && tables.length === 1) matched = true;
        break;
      }
      if (!matched) continue;
      const arrows = arrowPagination(element, doc);
      if (arrows) { results.push(arrows); continue; }
      const buttons = new Map(); let currentPage = null, invalid = false;
      for (const button of Array.from(element.querySelectorAll('a,button,li > span')).slice(0, 40)) {
        const text = buttonText(button);
        if (!/^\d+$/.test(text)) continue;
        const number = Number(text);
        if (!safeButton(button, doc)) { invalid = true; break; }
        if (number < 1 || number > 100000 || buttons.has(number)) { invalid = true; break; }
        buttons.set(number, button);
        if (button.getAttribute('aria-current') === 'page' || button.closest('.active,[aria-current="page"]')) {
          if (currentPage !== null && currentPage !== number) invalid = true;
          currentPage = number;
        }
      }
      const pages = [...buttons.keys()].sort((a, b) => a - b), totalPages = pages.at(-1) || 0;
      // Ellipsis means the entire page range is not proven, even if visible numbers end at 5.
      if (invalid || !currentPage || !totalPages || /…|\.\.\./.test(element.textContent || '') || pages.length !== totalPages || pages.some((page, index) => page !== index + 1)) continue;
      results.push({ element, buttons, currentPage, totalPages });
    }
    // A navigation wrapper and its inner paginator are one control, not two.
    const unique = results.filter(result => !results.some(other => other !== result && result.element.contains?.(other.element)));
    if (unique.length !== 1) return { available: false, currentPage: null, totalPages: null, reason: unique.length ? 'ambiguous-pagination' : 'pagination-not-found' };
    const found = unique[0];
    return { ...found, available: found.totalPages >= 2 && found.totalPages <= MAX_PAGES, reason: found.totalPages > MAX_PAGES ? 'too-many-pages' : found.totalPages === 1 ? 'single-page' : null };
  }

  function create(env, overrides = {}) {
    const doc = env.document, now = overrides.now || Date.now;
    const delay = overrides.delay || (ms => new Promise(resolve => env.setTimeout(resolve, ms)));
    const read = overrides.snapshot || ((traceId, options) => env.__advancedGraylogRenderedMessages.snapshotTrace(traceId, options));
    const find = overrides.pagination || (() => pagination(doc));
    const context = overrides.context || (() => {
      const url = new URL(env.location.href);
      // Only pagination fields may change as a consequence of our authorized clicks.
      for (const key of PAGE_KEYS) url.searchParams.delete(key);
      const editor = doc.querySelector('[data-testid="query-editor"],[data-testid="QueryEditor"],#query,[name="query"],[contenteditable="true"][role="textbox"]');
      const editorText = editor ? String(editor.value ?? editor.textContent ?? '') : null;
      return { key: url.href + '\n' + String(editorText), query: url.searchParams.get('q') || url.searchParams.get('query') || editorText?.trim() || '' };
    });
    const exact = query => env.GraylogOverlay?.exactTraceId?.(query) || (() => {
      const match = String(query).trim().match(/^trace(?:Id|_id)\s*:\s*(?:"([a-z\d_-]{1,128})"|([a-z\d_-]{1,128}))\s*$/i);
      return match ? match[1] || match[2] : '';
    })();
    const sessions = new Map(); let active = null, currentSeed = null, seedTimer = null;
    const clearSeed = () => { currentSeed = null; if (seedTimer) env.clearTimeout?.(seedTimer); seedTimer = null; };
    const discard = key => { const value = sessions.get(key); if (value?.timer) env.clearTimeout?.(value.timer); return sessions.delete(key); };
    const purge = () => { for (const [key, value] of sessions) if (now() - value.created > TTL) discard(key); };
    const safe = state => ({ active: Boolean(state), pagesRead: state?.pagesRead || 0, currentPage: state?.currentPage || 0, totalPages: state?.totalPages || 0, messagesRead: state?.messagesRead || 0, phase: state?.phase || 'idle', readyToken: state?.readyToken && !state.userChanged && sessions.get(state.readyToken)?.context === context().key ? state.readyToken : null });
    function inspect() {
      const { available, currentPage, totalPages, reason } = find();
      return { available, currentPage, totalPages, reason };
    }
    function snapshotKey(snapshot) {
      // Exact native identities are mandatory for pagination deduplication. A hash
      // of prose alone could silently merge genuinely distinct duplicate logs.
      if (!Array.isArray(snapshot.messages) || !snapshot.messages.length || snapshot.truncated) return null;
      const keys = [];
      for (const item of snapshot.messages) {
        const id = scalar(item.message?._id), index = item.index;
        if (typeof id !== 'string' || !id || typeof index !== 'string' || !index) return null;
        keys.push(JSON.stringify([index, id]));
      }
      return keys.join('\n');
    }
    function rememberCurrent(traceId, snapshot, pageNumber) {
      clearSeed();
      const current = context(), pager = find(), key = snapshotKey(snapshot);
      if (exact(current.query) !== traceId || !key || pageNumber !== pager.currentPage || snapshot.nativePage !== pageNumber || !snapshot.nativePayload || snapshot.messages.length > 200) return false;
      currentSeed = { traceId, pageNumber, snapshot, key, context: current.key, created: now() };
      seedTimer = env.setTimeout?.(clearSeed, TTL); seedTimer?.unref?.(); return true;
    }
    async function collect(traceId, { signal, onProgress } = {}) {
      if (active) throw new Error('Сбор страниц уже выполняется');
      const start = find(), initialContext = context();
      if (!start.available) throw new Error(start.reason === 'too-many-pages' ? 'Собрать можно не больше 5 страниц' : 'Пагинация сообщений не определена однозначно');
      if (!traceId || exact(initialContext.query) !== traceId) throw new Error('Поиск должен содержать один точный traceId');
      if (signal?.aborted) throw abortError();
      const state = { pagesRead: 0, currentPage: start.currentPage, totalPages: start.totalPages, messagesRead: 0, phase: 'reading', cancelled: false, userChanged: false, deadline: now() + 90000 };
      active = state;
      const changed = () => context().key !== initialContext.key;
      const check = (restoring = false) => {
        if (changed()) state.userChanged = true;
        if (state.userChanged || (!restoring && (state.cancelled || signal?.aborted))) throw abortError();
        if (now() >= state.deadline) throw new Error('Истекло время сбора страниц');
      };
      const progress = () => { try { onProgress?.(safe(state)); } catch { /* UI observer cannot break collection. */ } };
      const userAction = event => { if (event.isTrusted && !event.composedPath?.().some(node => ['advanced-graylog-clippy-root', 'advanced-graylog-preview-root'].includes(node?.id))) { state.userChanged = true; state.cancelled = true; } };
      const signalAbort = () => { state.cancelled = true; };
      for (const type of ['input', 'change', 'pointerdown', 'keydown']) doc.addEventListener(type, userAction, true);
      signal?.addEventListener('abort', signalAbort, { once: true });
      const gathered = new Map(), steps = []; let chars = 0, previous = null, inFlight = null, expectedTotal = null, expectedPageSize = null, contentTruncated = false;
      async function stablePage(page, oldKey, restoring = false) {
        const deadline = Math.min(now() + 15000, state.deadline);
        const seed = (!oldKey || state.readyToken) && currentSeed?.traceId === traceId && currentSeed.pageNumber === page && currentSeed.context === initialContext.key && now() - currentSeed.created <= TTL ? currentSeed : null;
        let lastKey = seed?.key || null;
        while (now() < deadline) {
          check(restoring);
          const pager = find();
          if (pager.totalPages !== state.totalPages) throw abortError('Число страниц изменилось; сбор остановлен');
          if (pager.currentPage === page && !doc.querySelector('[aria-busy="true"]')) {
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            state.pendingRead = controller;
            const timeout = env.setTimeout?.(() => controller?.abort(), Math.max(1, deadline - now()));
            let snapshot;
            try { snapshot = await read(traceId, { queryExact: true, pageNumber: page, signal: controller?.signal }); }
            finally { if (timeout) env.clearTimeout?.(timeout); if (state.pendingRead === controller) state.pendingRead = null; }
            check(restoring);
            if (snapshot.nativePageSize > 0 && Number.isSafeInteger(snapshot.nativeTotal) && Math.ceil(snapshot.nativeTotal / snapshot.nativePageSize) > MAX_PAGES) throw new Error('Собрать можно не больше 5 страниц');
            if (expectedTotal !== null && (snapshot.nativeTotal !== expectedTotal || snapshot.nativePageSize !== expectedPageSize)) throw abortError('Выдача Graylog изменилась; сбор остановлен');
            const key = snapshotKey(snapshot);
            const expected = Number.isSafeInteger(snapshot.nativeTotal) && snapshot.nativePageSize > 0 ? Math.min(snapshot.nativePageSize, Math.max(0, snapshot.nativeTotal - (page - 1) * snapshot.nativePageSize)) : null;
            const completePage = expected !== null && snapshot.messages.length === expected && Math.ceil(snapshot.nativeTotal / snapshot.nativePageSize) === state.totalPages;
            const valid = key && key !== oldKey && completePage && (snapshot.nativePage == null || snapshot.nativePage === page) && snapshot.messages.every(item => scalar(item.message?.traceId ?? item.message?.trace_id) === traceId);
            if (valid && key === lastKey) { inFlight = null; return { snapshot, key }; }
            lastKey = valid ? key : null;
          } else lastKey = null;
          await delay(100);
        }
        throw new Error('Не дождались новой выдачи Graylog; сбор остановлен');
      }
      async function move(page, restoring = false) {
        check(restoring);
        const pager = find();
        if (pager.totalPages !== state.totalPages) throw abortError('Пагинация изменилась');
        if (pager.currentPage === page) return { ...(await stablePage(page, null, restoring)), action: 'snapshot', fromPage: page, targetPage: page };
        let last = previous;
        for (let hop = 0; hop < MAX_PAGES; hop++) {
          // Delay starts after the previous committed result, including every
          // intermediate hop of an arrow-only paginator.
          await delay(100); check(restoring);
          const fresh = find();
          if (fresh.totalPages !== state.totalPages) throw abortError('Пагинация изменилась');
          const target = fresh.buttons?.has(page) ? page : fresh.mode === 'arrows' ? fresh.currentPage + Math.sign(page-fresh.currentPage) : page;
          const button = fresh.buttons?.get(target);
          if (!button || !visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true' || button.closest?.('.disabled')) throw new Error('Страница недоступна');
          inFlight = { page:target, oldKey:last?.key || null };
          const hopStarted = now();
          button.click();
          state.currentPage = target; progress();
          last = { ...(await stablePage(target, last?.key || null, restoring)), action:'native-click', fromPage:fresh.currentPage, targetPage:target };
          if (target === page) return last;
          steps.push({ page:target, kind:state.phase === 'returning' ? 'return' : 'transit', action:'native-click', fromPage:fresh.currentPage, targetPage:target, elapsedMs:Math.max(0,now()-hopStarted) });
        }
        throw new Error('Не удалось перейти к странице');
      }
      try {
        let readStarted = now();
        previous = { ...(await stablePage(start.currentPage, null)), action: 'snapshot', fromPage: start.currentPage, targetPage: start.currentPage };
        expectedTotal = previous.snapshot.nativeTotal; expectedPageSize = previous.snapshot.nativePageSize;
        if (expectedTotal > MAX_MESSAGES) throw new Error('Превышен безопасный объём страниц');
        const others = Array.from({ length: state.totalPages }, (_, i) => i + 1).filter(page => page !== start.currentPage);
        const order = [start.currentPage, ...(start.mode === 'arrows' ? [...others.filter(page=>page>start.currentPage),...others.filter(page=>page<start.currentPage).reverse()] : others)];
        for (const page of order) {
          check();
          if (page !== start.currentPage || state.pagesRead) { readStarted = now(); previous = await move(page); }
          contentTruncated ||= previous.snapshot.contentTruncated === true;
          for (const item of previous.snapshot.messages) {
            const key = JSON.stringify([item.index, scalar(item.message._id)]);
            if (gathered.has(key)) continue;
            const size = JSON.stringify(item).length;
            if (gathered.size >= MAX_MESSAGES || chars + size > MAX_CHARS) throw new Error('Превышен безопасный объём страниц');
            gathered.set(key, item); chars += size;
          }
          steps.push({ page, kind: 'read', action: previous.action, fromPage: previous.fromPage, targetPage: page, elapsedMs: Math.max(0, now() - readStarted) });
          state.pagesRead++; state.messagesRead = gathered.size; progress();
        }
        if (gathered.size !== expectedTotal) throw new Error('Сообщения между страницами пересеклись или изменились; повторите сбор');
        check(); purge();
        while (sessions.size >= 2) discard(sessions.keys().next().value);
        // randomUUID is secure-context-only; intranet Graylog can be served
        // over HTTP. getRandomValues remains available there and is equally
        // suitable for an opaque local handle (it never leaves extension UI).
        const token = typeof env.crypto?.randomUUID === 'function' ? env.crypto.randomUUID() : (() => {
          if (typeof env.crypto?.getRandomValues !== 'function') throw new Error('Браузер не поддерживает безопасное хранение собранных страниц');
          const bytes = new Uint8Array(16); env.crypto.getRandomValues(bytes);
          return `pages-${Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')}`;
        })();
        const timer = env.setTimeout?.(() => discard(token), TTL); timer?.unref?.();
        sessions.set(token, { traceId, created: now(), context: initialContext.key, timer, snapshot: { scope: 'current-page', collectedPages: state.totalPages, messages: [...gathered.values()], total_results: gathered.size, complete: true, truncated: false, contentTruncated } });
        // Data readiness and restoring the native page are independent. The
        // complete snapshot can be opened while Graylog finishes its own return.
        state.readyToken = token; state.phase = 'returning'; progress();
        if (find().currentPage !== 1) { const returnStarted = now(); previous = await move(1); steps.push({ page: 1, kind: 'return', action: previous.action, fromPage: previous.fromPage, targetPage: 1, elapsedMs: Math.max(0, now() - returnStarted) }); }
        check();
        return { token, pagesRead: state.pagesRead, totalPages: state.totalPages, messagesRead: gathered.size, steps, returnStatus: 'returned' };
      } catch (error) {
        if (state.readyToken) {
          if (state.userChanged || changed()) { discard(state.readyToken); throw error; }
          // Stop/timeout after the last page must not destroy a valid graph.
          // An already accepted native return cannot be cancelled by us.
          return { token: state.readyToken, pagesRead: state.pagesRead, totalPages: state.totalPages, messagesRead: gathered.size, steps, returnStatus: state.cancelled || signal?.aborted ? 'cancelled' : 'failed' };
        }
        if (!state.userChanged && !changed() && find().currentPage !== 1) {
          try {
            state.phase = 'returning'; progress();
            // A click already accepted by Graylog cannot be aborted by us. Wait
            // for its committed result before issuing a return-to-first click.
            if (inFlight) previous = await stablePage(inFlight.page, inFlight.oldKey, true);
            await move(1, true);
          } catch { /* Context loss must never force stale navigation. */ }
        }
        throw error;
      } finally {
        for (const type of ['input', 'change', 'pointerdown', 'keydown']) doc.removeEventListener(type, userAction, true);
        signal?.removeEventListener('abort', signalAbort); active = null;
      }
    }
    return Object.freeze({ inspect, collect, rememberCurrent, getProgress: () => safe(active), cancel: () => { if (!active) return false; active.cancelled = true; active.pendingRead?.abort(); return true; }, clear: discard, peek: (token, traceId) => { purge(); const value = sessions.get(token); return value?.traceId === traceId && value.context === context().key ? value.snapshot : null; } });
  }
  return Object.freeze({ create, pagination, pageContext });
});
