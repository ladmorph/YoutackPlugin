
// Раздел «ЦДР»: задачи, на которые когда-либо навешивали тег, сгруппированные по полю задачи.
// Данные берутся только из YouTrack REST API с токеном текущей сессии; сохраняются лишь настройки формы.
(() => {
  'use strict';
  const ORIGIN = 'https://youtrack-mapps.sovcombank.ru';
  const SETTINGS_KEY = 'youtrackCdrSettings';
  const DEFAULTS = Object.freeze({ tag: 'Pasha', field: '$Разработчик', projects: [], from: '', to: '' });
  const AUTHOR = '[автор тега]';
  const EMPTY = '— не указано —';
  const PAGE_SIZE = 500, ISSUE_CHUNK = 40, MAX_REQUESTS = 3000;
  const norm = value => String(value ?? '').trim().toLocaleLowerCase('ru');
  const fieldKey = value => norm(value).replace(/^\$/, '');

  // ---------- чистая логика (без DOM), экспортируется для тестов ----------
  function personLabel(value) {
    if (value == null) return null;
    if (typeof value === 'string') return value.trim() || null;
    return (value.fullName || value.presentation || value.name || value.login || '').trim() || null;
  }
  function fieldValues(customFields, fieldName) {
    const wanted = fieldKey(fieldName);
    const field = (customFields || []).find(f => fieldKey(f?.name) === wanted);
    if (!field) return [];
    const raw = Array.isArray(field.value) ? field.value : [field.value];
    return [...new Set(raw.map(personLabel).filter(Boolean))];
  }
  // Все задачи выбранных проектов, где тег когда-либо добавляли; считает и число добавлений по авторам.
  function collectTagged(activities, tag, projectIds) {
    const wanted = norm(tag), allowed = new Set(projectIds), byIssue = new Map();
    for (const item of activities || []) {
      if (!(item.added || []).some(t => norm(t?.name) === wanted)) continue;
      const issue = item.target;
      if (!issue?.id || !allowed.has(issue.project?.id)) continue;
      let entry = byIssue.get(issue.id);
      if (!entry) {
        entry = { id: issue.id, idReadable: issue.idReadable || issue.id, project: issue.project?.shortName || issue.project?.name || '', firstAt: Infinity, events: 0, byAuthor: new Map() };
        byIssue.set(issue.id, entry);
      }
      const who = personLabel(item.author) || EMPTY;
      entry.events += 1;
      entry.byAuthor.set(who, (entry.byAuthor.get(who) || 0) + 1);
      if ((item.timestamp ?? Infinity) < entry.firstAt) entry.firstAt = item.timestamp ?? Infinity;
    }
    return [...byIssue.values()];
  }
  const sortedAuthors = map => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
  // Группировка: задача входит один раз в каждую группу; adds — сколько раз тег навешивали на задачи группы.
  function aggregate(tagged, details, field) {
    const groups = new Map();
    const group = label => { if (!groups.has(label)) groups.set(label, { label, issues: [], adds: 0, who: new Map() }); return groups.get(label); };
    for (const issue of tagged) {
      if (field === AUTHOR) {
        for (const [who, n] of issue.byAuthor) { const g = group(who); g.issues.push(issue); g.adds += n; g.who.set(who, n + (g.who.get(who) || 0)); }
        continue;
      }
      let labels = fieldValues(details.get(issue.id)?.customFields, field);
      if (!labels.length) labels = [EMPTY];
      for (const label of labels) {
        const g = group(label); g.issues.push(issue); g.adds += issue.events;
        for (const [who, n] of issue.byAuthor) g.who.set(who, (g.who.get(who) || 0) + n);
      }
    }
    return [...groups.values()]
      .map(g => ({ label: g.label, count: g.issues.length, adds: g.adds, who: sortedAuthors(g.who), issues: g.issues.sort((a, b) => a.idReadable.localeCompare(b.idReadable, 'en', { numeric: true })) }))
      .sort((a, b) => b.adds - a.adds || b.count - a.count || a.label.localeCompare(b.label, 'ru'));
  }
  // Серверный фильтр задач для /api/activities: только выбранные проекты.
  function issueQuery(projects) {
    const names = projects.map(p => /^[\w-]+$/.test(p.shortName || '') ? p.shortName : `{${String(p.name).replace(/[{}]/g, '')}}`);
    return `project: ${names.join(', ')}`;
  }
  const api = Object.freeze({ norm, personLabel, fieldValues, collectTagged, aggregate, issueQuery, sortedAuthors, AUTHOR, EMPTY });
  globalThis.YouTrackCdr = api;
  if (typeof document === 'undefined') return;

  // ---------- интерфейс ----------
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const state = { projects: [], selected: new Set(), running: false, controller: null, rows: [] };
  const fetcher = (url, init) => (globalThis.YouTrackReferenceNetwork?.fetch || fetch)(url, init);
  const setStatus = (text, kind) => { const n = $('cdr-status'); n.textContent = text; n.dataset.kind = kind || ''; };
  const showError = message => { const n = $('cdr-error'); n.textContent = message || ''; n.hidden = !message; };

  // ---------- календарь: тот же код и разметка, что в «Отчётах» (yt-date-btn / yt-cal-*) ----------
  const MONTH_NAMES = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  const WEEKDAY_NAMES = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  let openCalendarPopup = null;
  const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const formatRu = isoStr => { if (!isoStr) return "Выберите дату"; const [y, m, d] = isoStr.split("-"); return `${d}.${m}.${y}`; };
  const dateVal = key => $(key === 'from' ? 'cdr-from-value' : 'cdr-to-value').value;
  function closeCalendar() {
    if (openCalendarPopup) { openCalendarPopup.remove(); openCalendarPopup = null; }
    document.removeEventListener("mousedown", outsideClickHandler, true);
  }
  globalThis.YouTrackReferenceCalendar = Object.freeze({ close: closeCalendar });
  function outsideClickHandler(e) { if (openCalendarPopup && !openCalendarPopup.contains(e.target)) closeCalendar(); }
  function openCalendar(input, btn) {
    if (openCalendarPopup) {
      const wasForThisBtn = openCalendarPopup.dataset.forBtn === btn.id;
      closeCalendar();
      if (wasForThisBtn) return;
    }
    const initial = input.value ? new Date(input.value + "T00:00:00") : new Date();
    let viewYear = initial.getFullYear(), viewMonth = initial.getMonth();
    const popup = document.createElement("div");
    popup.className = "yt-cal-popup"; popup.dataset.forBtn = btn.id;
    document.body.appendChild(popup); openCalendarPopup = popup;
    const pick = value => { input.value = value; btn.textContent = formatRu(value); saveSettings(); closeCalendar(); };
    function render() {
      const firstDay = new Date(viewYear, viewMonth, 1);
      const startWeekday = (firstDay.getDay() + 6) % 7;
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      const selectedIso = input.value, todayIso = isoOf(new Date());
      let cells = "";
      for (let i = 0; i < startWeekday; i++) cells += `<span class="yt-cal-day yt-cal-empty"></span>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateIso = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const cls = ["yt-cal-day"];
        if (dateIso === selectedIso) cls.push("selected");
        if (dateIso === todayIso) cls.push("today");
        cells += `<button type="button" class="${cls.join(" ")}" data-date="${dateIso}">${d}</button>`;
      }
      popup.innerHTML = `
        <div class="yt-cal-header">
          <button type="button" class="yt-cal-nav" data-nav="-1">‹</button>
          <span class="yt-cal-title">${MONTH_NAMES[viewMonth]} ${viewYear}</span>
          <button type="button" class="yt-cal-nav" data-nav="1">›</button>
        </div>
        <div class="yt-cal-weekdays">${WEEKDAY_NAMES.map(w => `<span>${w}</span>`).join("")}</div>
        <div class="yt-cal-grid">${cells}</div>
        <div class="yt-links"><a data-clear="1">Очистить</a></div>
      `;
      popup.querySelectorAll(".yt-cal-nav").forEach(navBtn => navBtn.addEventListener("click", e => {
        e.stopPropagation();
        viewMonth += parseInt(navBtn.dataset.nav, 10);
        if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
        if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
        render();
      }));
      popup.querySelectorAll(".yt-cal-day:not(.yt-cal-empty)").forEach(cell => cell.addEventListener("click", e => { e.stopPropagation(); pick(cell.dataset.date); }));
      popup.querySelector("[data-clear]").addEventListener("click", e => { e.stopPropagation(); pick(""); });
    }
    render();
    const rect = btn.getBoundingClientRect();
    popup.style.position = "fixed"; popup.style.top = `${rect.bottom + 6}px`; popup.style.left = `${rect.left}px`;
    requestAnimationFrame(() => {
      const popupRect = popup.getBoundingClientRect();
      if (popupRect.right > window.innerWidth - 8) popup.style.left = `${Math.max(8, window.innerWidth - popupRect.width - 8)}px`;
    });
    setTimeout(() => document.addEventListener("mousedown", outsideClickHandler, true), 0);
  }
  function initDatePicker(inputId, btnId, value) {
    const input = $(inputId), btn = $(btnId);
    input.value = value || ""; btn.textContent = formatRu(input.value);
    btn.addEventListener("click", e => { e.stopPropagation(); openCalendar(input, btn); });
  }

  // ---------- API ----------
  async function loadToken() {
    const [{ ytToken }, session] = await Promise.all([
      chrome.storage.local.get('ytToken'),
      chrome.storage.session.get(['youtrackLiveToken', 'youtrackExplicitConnection'])
    ]);
    return ytToken && session.youtrackExplicitConnection && session.youtrackLiveToken === ytToken ? ytToken : null;
  }
  async function apiGet(path, params, signal) {
    const token = await loadToken();
    if (!token) throw new Error('Нет подключения к YouTrack. Нажмите «Обновить подключение» или откройте отчёт иконкой расширения на вкладке YouTrack.');
    const url = new URL(path, ORIGIN + '/');
    if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/')) throw new Error('Недопустимый адрес запроса');
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
    const response = await fetcher(url.toString(), { signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (response.status === 401 || response.status === 403) throw new Error('YouTrack отклонил токен. Нажмите «Обновить подключение».');
    if (response.status === 400) throw new Error('YouTrack не принял запрос (HTTP 400). Проверьте выбранные проекты и поле группировки.');
    if (!response.ok) throw new Error(`YouTrack вернул HTTP ${response.status}`);
    return response.json();
  }
  // Читает порциями, пока сервер не вернёт пустую страницу; не зависит от того, сколько записей реально отдаёт сервер.
  async function pages(path, params, size, signal, onPage) {
    const out = [];
    for (let request = 0; request < MAX_REQUESTS; request++) {
      const chunk = await apiGet(path, { ...params, $skip: out.length, $top: size }, signal);
      if (!chunk.length) return out;
      out.push(...chunk);
      if (onPage) onPage(request + 1, out.length);
    }
    throw new Error('Слишком много событий. Сузьте период или выберите меньше проектов.');
  }

  // ---------- настройки и проекты ----------
  async function readSettings() {
    const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
    const field = !stored.field || stored.field === 'Разработчик' ? DEFAULTS.field : stored.field;
    return { ...DEFAULTS, from: stored.from || '', to: stored.to || '', field, tag: stored.tag || DEFAULTS.tag, projects: Array.isArray(stored.projects) ? stored.projects : [] };
  }
  const saveSettings = () => chrome.storage.local.set({ [SETTINGS_KEY]: { tag: $('cdr-tag').value.trim(), field: $('cdr-field').value.trim(), projects: [...state.selected], from: dateVal('from'), to: dateVal('to') } });

  // Те же чипы, подписи и ссылки «Выбрать все / Снять всё», что и в «Отчётах».
  function renderProjects() {
    const box = $('cdr-projects');
    box.replaceChildren();
    if (!state.projects.length) box.append(el('span', 'Проекты появятся после подключения к YouTrack.', 'yt-chip-empty'));
    for (const project of state.projects) {
      const chip = el('button', project.name + (project.shortName ? ` · ${project.shortName}` : ''), 'yt-chip' + (state.selected.has(project.id) ? ' selected' : ''));
      chip.type = 'button'; chip.dataset.name = project.name;
      chip.addEventListener('click', () => {
        if (state.selected.has(project.id)) state.selected.delete(project.id); else state.selected.add(project.id);
        chip.classList.toggle('selected', state.selected.has(project.id));
        updateCount(); saveSettings(); suggestFields();
      });
      box.append(chip);
    }
    updateCount();
  }
  const updateCount = () => { $('cdr-selected-count').textContent = state.selected.size ? `(выбрано: ${state.selected.size})` : ''; };
  function toggleAll(checked) {
    for (const p of state.projects) { if (checked) state.selected.add(p.id); else state.selected.delete(p.id); }
    renderProjects(); saveSettings(); suggestFields();
  }
  async function loadProjects() {
    setStatus('Загружаю проекты…');
    try {
      const all = [];
      for (let skip = 0; skip < 5000; skip += 100) {
        const chunk = await apiGet('/api/admin/projects', { fields: 'id,name,shortName,archived', $skip: skip, $top: 100 });
        all.push(...chunk);
        if (chunk.length < 100) break;
      }
      state.projects = all.filter(p => !p.archived).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      const known = new Set(state.projects.map(p => p.id));
      state.selected = new Set([...state.selected].filter(id => known.has(id)));
      renderProjects(); setStatus(`Проектов: ${state.projects.length}.`); showError('');
      suggestFields();
    } catch (error) { setStatus(''); showError(error.message); }
  }
  let suggestTimer = 0;
  function suggestFields() {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async () => {
      const names = new Set();
      try {
        for (const id of [...state.selected].slice(0, 10)) {
          const list = await apiGet(`/api/admin/projects/${encodeURIComponent(id)}/customFields`, { fields: 'field(name)', $top: 200 });
          for (const item of list) if (item?.field?.name) names.add('$' + item.field.name);
        }
      } catch { /* подсказки необязательны */ }
      const datalist = $('cdr-field-options');
      datalist.replaceChildren();
      for (const value of [AUTHOR, ...[...names].sort((a, b) => a.localeCompare(b, 'ru'))]) { const o = document.createElement('option'); o.value = value; datalist.append(o); }
    }, 300);
  }

  // ---------- запуск ----------
  async function run() {
    if (state.running) return;
    const tag = $('cdr-tag').value.trim(), field = $('cdr-field').value.trim();
    if (!state.selected.size) return showError('Выберите хотя бы один проект.');
    if (!tag) return showError('Укажите тег.');
    if (!field) return showError('Укажите поле для группировки.');
    if (dateVal('from') && dateVal('to') && dateVal('from') > dateVal('to')) return showError('Дата «с» позже даты «по».');
    showError(''); saveSettings();
    state.running = true; state.controller = new AbortController();
    $('cdr-run').disabled = true; $('cdr-stop').disabled = false; $('cdr-result').hidden = true;
    const signal = state.controller.signal;
    try {
      const chosen = state.projects.filter(p => state.selected.has(p.id));
      const params = { categories: 'TagsCategory', issueQuery: issueQuery(chosen), fields: 'id,timestamp,author(id,login,fullName),added(id,name),target(id,idReadable,project(id,name,shortName))' };
      if (dateVal('from')) params.start = Date.parse(`${dateVal('from')}T00:00:00.000Z`);
      if (dateVal('to')) params.end = Date.parse(`${dateVal('to')}T23:59:59.999Z`);
      setStatus('Читаю историю тегов…');
      const activities = await pages('/api/activities', params, PAGE_SIZE, signal, (n, count) => setStatus(`История тегов: запросов ${n}, событий ${count}…`));
      const tagged = collectTagged(activities, tag, state.selected);
      const details = new Map();
      if (tagged.length && field !== AUTHOR) {
        const ids = tagged.map(i => i.idReadable).filter(id => /^[A-Za-z0-9_]+-\d+$/.test(id));
        for (let i = 0; i < ids.length; i += ISSUE_CHUNK) {
          setStatus(`Читаю поля задач: ${Math.min(i + ISSUE_CHUNK, ids.length)} из ${ids.length}…`);
          const chunk = ids.slice(i, i + ISSUE_CHUNK);
          const list = await apiGet('/api/issues', { fields: 'id,idReadable,summary,customFields(name,value(name,login,fullName,presentation))', query: `issue id: ${chunk.join(', ')}`, $top: chunk.length }, signal);
          for (const issue of list) details.set(issue.id, issue);
        }
      }
      for (const issue of tagged) issue.summary = details.get(issue.id)?.summary || '';
      state.rows = aggregate(tagged, details, field);
      render(tagged, tag, field);
      setStatus(tagged.length ? `Готово: задач ${tagged.length}, обработано событий ${activities.length}.` : `Задач с тегом «${tag}» не найдено (событий проверено: ${activities.length}).`, 'ok');
    } catch (error) {
      setStatus(''); showError(error.name === 'AbortError' ? 'Остановлено.' : error.message);
    } finally { state.running = false; state.controller = null; $('cdr-run').disabled = false; $('cdr-stop').disabled = true; }
  }

  function render(tagged, tag, field) {
    const byAuthorMode = field === AUTHOR;
    const head = $('cdr-head'), body = $('cdr-rows');
    head.replaceChildren(); body.replaceChildren();
    const columns = [['Значение поля', 'cdr-name'], ['Задач', 'cdr-num'], ['Тег навешивали, раз', 'cdr-num']];
    if (!byAuthorMode) columns.push(['Кто навешивал (раз)', 'cdr-who']);
    columns.push(['Задачи', 'cdr-act']);
    for (const [name, cls] of columns) head.append(el('th', name, cls));
    $('cdr-result-title').textContent = `Тег «${tag}» · группировка: ${byAuthorMode ? 'автор тега' : field}`;
    for (const row of state.rows) {
      const tr = el('tr');
      tr.append(el('td', row.label, 'cdr-name'), el('td', String(row.count), 'cdr-num'), el('td', String(row.adds), 'cdr-num'));
      if (!byAuthorMode) tr.append(el('td', row.who.map(([who, n]) => `${who} × ${n}`).join(', '), 'cdr-who'));
      const toggle = el('button', 'Показать', 'cdr-btn'); toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
      const cell = el('td', null, 'cdr-act'); cell.append(toggle); tr.append(cell);
      const detail = el('tr', null, 'cdr-detail'); detail.hidden = true;
      const holder = el('td'); holder.colSpan = columns.length;
      const list = el('ul', null, 'cdr-issues');
      for (const issue of row.issues) {
        const li = el('li'), a = el('a', issue.idReadable); a.href = `${ORIGIN}/issue/${encodeURIComponent(issue.idReadable)}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
        const who = sortedAuthors(issue.byAuthor).map(([name, n]) => n > 1 ? `${name} × ${n}` : name).join(', ');
        li.append(a, document.createTextNode(`${issue.summary ? ` — ${issue.summary}` : ''}`), el('span', ` · навешивал: ${who}`, 'cdr-muted')); list.append(li);
      }
      holder.append(list); detail.append(holder);
      toggle.addEventListener('click', () => { detail.hidden = !detail.hidden; toggle.textContent = detail.hidden ? 'Показать' : 'Скрыть'; toggle.setAttribute('aria-expanded', String(!detail.hidden)); });
      body.append(tr, detail);
    }
    const adds = tagged.reduce((n, i) => n + i.events, 0);
    $('cdr-total').textContent = `Уникальных задач: ${tagged.length} · всего навешиваний тега: ${adds}`;
    $('cdr-result').hidden = false;
  }

  function exportCsv() {
    const quote = v => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Группа', 'Задач', 'Навешиваний', 'Кто навешивал', 'Задачи'].map(quote).join(';')];
    for (const row of state.rows) lines.push([row.label, row.count, row.adds, row.who.map(([w, n]) => `${w} x${n}`).join(', '), row.issues.map(i => i.idReadable).join(' ')].map(quote).join(';'));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'cdr.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function refreshConnection() {
    setStatus('Обновляю подключение…');
    const result = await chrome.runtime.sendMessage({ type: 'ensure-youtrack-session' }).catch(() => ({ ok: false }));
    if (!result?.ok) { setStatus(''); return showError('Не удалось обновить подключение. Откройте вкладку YouTrack и повторите.'); }
    await loadProjects();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const settings = await readSettings();
    $('cdr-tag').value = settings.tag; $('cdr-field').value = settings.field;
    initDatePicker('cdr-from-value', 'cdr-from', settings.from);
    initDatePicker('cdr-to-value', 'cdr-to', settings.to);
    state.selected = new Set(settings.projects);
    $('cdr-select-all').addEventListener('click', () => toggleAll(true));
    $('cdr-clear').addEventListener('click', () => toggleAll(false));
    $('cdr-connect').addEventListener('click', refreshConnection);
    $('cdr-run').addEventListener('click', run);
    $('cdr-stop').addEventListener('click', () => state.controller?.abort());
    $('cdr-export').addEventListener('click', exportCsv);
    for (const id of ['cdr-tag', 'cdr-field']) $(id).addEventListener('change', saveSettings);
    $('cdr-field-options').append(Object.assign(document.createElement('option'), { value: AUTHOR }));
    renderProjects();
    if (await loadToken()) loadProjects(); else showError('Нет подключения к YouTrack. Нажмите «Обновить подключение» или откройте отчёт иконкой расширения на вкладке YouTrack.');
  });
})();
