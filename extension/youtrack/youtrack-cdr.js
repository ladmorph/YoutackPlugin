// Раздел «ЦДР»: задачи, на которые когда-либо навешивали тег, сгруппированные по полю задачи.
// Данные берутся только из YouTrack REST API с токеном текущей сессии; сохраняются лишь настройки формы.
(() => {
  'use strict';
  const ORIGIN = 'https://youtrack-mapps.sovcombank.ru';
  const SETTINGS_KEY = 'youtrackCdrSettings';
  const DEFAULTS = Object.freeze({ tag: 'Pasha', field: 'Разработчик', projects: [] });
  const AUTHOR = '[автор тега]';
  const EMPTY = '— не указано —';
  const PAGE = 200, ISSUE_CHUNK = 40, MAX_PAGES = 1500;
  const norm = value => String(value ?? '').trim().toLocaleLowerCase('ru');

  // ---------- чистая логика (без DOM), экспортируется для тестов ----------
  function personLabel(value) {
    if (value == null) return null;
    if (typeof value === 'string') return value.trim() || null;
    return (value.fullName || value.presentation || value.name || value.login || '').trim() || null;
  }
  function fieldValues(customFields, fieldName) {
    const wanted = norm(fieldName);
    const field = (customFields || []).find(f => norm(f?.name) === wanted);
    if (!field) return [];
    const raw = Array.isArray(field.value) ? field.value : [field.value];
    return [...new Set(raw.map(personLabel).filter(Boolean))];
  }
  // Находит все задачи выбранных проектов, где тег когда-либо был добавлен.
  function collectTagged(activities, tag, projectIds) {
    const wanted = norm(tag), allowed = new Set(projectIds), byIssue = new Map();
    for (const item of activities || []) {
      if (!(item.added || []).some(t => norm(t?.name) === wanted)) continue;
      const issue = item.target;
      if (!issue?.id || !allowed.has(issue.project?.id)) continue;
      let entry = byIssue.get(issue.id);
      if (!entry) {
        entry = { id: issue.id, idReadable: issue.idReadable || issue.id, project: issue.project?.shortName || issue.project?.name || '', firstAt: Infinity, author: null, adders: new Set() };
        byIssue.set(issue.id, entry);
      }
      const who = personLabel(item.author) || EMPTY;
      entry.adders.add(who);
      if ((item.timestamp ?? Infinity) < entry.firstAt) { entry.firstAt = item.timestamp ?? Infinity; entry.author = who; }
    }
    return [...byIssue.values()];
  }
  // Группировка: каждая задача считается один раз в каждой найденной группе.
  function aggregate(tagged, details, field) {
    const groups = new Map();
    for (const issue of tagged) {
      let labels;
      if (field === AUTHOR) labels = [...issue.adders];
      else labels = fieldValues(details.get(issue.id)?.customFields, field);
      if (!labels.length) labels = [EMPTY];
      for (const label of labels) {
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(issue);
      }
    }
    return [...groups.entries()]
      .map(([label, issues]) => ({ label, count: issues.length, issues: issues.sort((a, b) => a.idReadable.localeCompare(b.idReadable, 'en', { numeric: true })) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'));
  }
  const api = Object.freeze({ norm, personLabel, fieldValues, collectTagged, aggregate, AUTHOR, EMPTY });
  globalThis.YouTrackCdr = api;
  if (typeof document === 'undefined') return;

  // ---------- интерфейс ----------
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const state = { projects: [], selected: new Set(), running: false, controller: null, rows: [] };
  const fetcher = (url, init) => (globalThis.YouTrackReferenceNetwork?.fetch || fetch)(url, init);

  const setStatus = (text, kind) => { const n = $('cdr-status'); n.textContent = text; n.dataset.kind = kind || ''; };
  const showError = message => { const n = $('cdr-error'); n.textContent = message || ''; n.hidden = !message; };

  async function loadToken() {
    const [{ ytToken }, session] = await Promise.all([
      chrome.storage.local.get('ytToken'),
      chrome.storage.session.get(['youtrackLiveToken', 'youtrackExplicitConnection'])
    ]);
    return ytToken && session.youtrackExplicitConnection && session.youtrackLiveToken === ytToken ? ytToken : null;
  }
  async function api_get(path, params, signal) {
    const token = await loadToken();
    if (!token) throw new Error('Нет подключения к YouTrack. Нажмите «Обновить подключение» или откройте отчёт иконкой расширения на вкладке YouTrack.');
    const url = new URL(path, ORIGIN + '/');
    if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/')) throw new Error('Недопустимый адрес запроса');
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
    const response = await fetcher(url.toString(), { signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (response.status === 401 || response.status === 403) throw new Error('YouTrack отклонил токен. Нажмите «Обновить подключение».');
    if (!response.ok) throw new Error(`YouTrack вернул HTTP ${response.status}`);
    return response.json();
  }
  async function pages(path, params, signal, onPage) {
    const out = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const chunk = await api_get(path, { ...params, $skip: page * PAGE, $top: PAGE }, signal);
      out.push(...chunk);
      if (onPage) onPage(page + 1, out.length);
      if (chunk.length < PAGE) return out;
    }
    throw new Error('Слишком много событий. Задайте дату «С», чтобы сузить поиск.');
  }

  async function readSettings() {
    const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
    return { tag: stored.tag || DEFAULTS.tag, field: stored.field || DEFAULTS.field, projects: Array.isArray(stored.projects) ? stored.projects : DEFAULTS.projects, from: stored.from || '' };
  }
  const saveSettings = () => chrome.storage.local.set({ [SETTINGS_KEY]: { tag: $('cdr-tag').value.trim(), field: $('cdr-field').value.trim(), projects: [...state.selected], from: $('cdr-from').value } });

  function renderProjects() {
    const box = $('cdr-projects'), query = norm($('cdr-project-search').value);
    box.replaceChildren();
    const shown = state.projects.filter(p => !query || norm(p.name).includes(query) || norm(p.shortName).includes(query));
    for (const project of shown) {
      const chip = el('button', `${project.name} (${project.shortName})`, 'yt-chip' + (state.selected.has(project.id) ? ' selected' : ''));
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(state.selected.has(project.id)));
      chip.addEventListener('click', () => {
        if (state.selected.has(project.id)) state.selected.delete(project.id); else state.selected.add(project.id);
        renderProjects(); saveSettings(); suggestFields();
      });
      box.append(chip);
    }
    if (!shown.length) box.append(el('p', state.projects.length ? 'Ничего не найдено.' : 'Проекты ещё не загружены.', 'hint'));
    $('cdr-selected-count').textContent = `Выбрано проектов: ${state.selected.size}`;
  }
  async function loadProjects() {
    setStatus('Загружаю проекты…');
    try {
      const all = [];
      for (let skip = 0; skip < 5000; skip += 100) {
        const chunk = await api_get('/api/admin/projects', { fields: 'id,name,shortName,archived', $skip: skip, $top: 100 });
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
          const list = await api_get(`/api/admin/projects/${encodeURIComponent(id)}/customFields`, { fields: 'field(name)', $top: 200 });
          for (const item of list) if (item?.field?.name) names.add(item.field.name);
        }
      } catch { /* подсказки необязательны */ }
      const datalist = $('cdr-field-options');
      datalist.replaceChildren();
      for (const value of [AUTHOR, ...[...names].sort((a, b) => a.localeCompare(b, 'ru'))]) { const o = document.createElement('option'); o.value = value; datalist.append(o); }
    }, 300);
  }

  async function run() {
    if (state.running) return;
    const tag = $('cdr-tag').value.trim(), field = $('cdr-field').value.trim(), from = $('cdr-from').value;
    if (!state.selected.size) return showError('Выберите хотя бы один проект.');
    if (!tag) return showError('Укажите тег.');
    if (!field) return showError('Укажите поле для группировки.');
    showError(''); saveSettings();
    state.running = true; state.controller = new AbortController();
    $('cdr-run').disabled = true; $('cdr-stop').disabled = false; $('cdr-result').hidden = true;
    const signal = state.controller.signal;
    try {
      setStatus('Читаю историю тегов…');
      const params = { categories: 'TagsCategory', fields: 'id,timestamp,author(id,login,fullName),added(id,name),target(id,idReadable,project(id,name,shortName))' };
      if (from) params.start = Date.parse(`${from}T00:00:00Z`);
      const activities = await pages('/api/activities', params, signal, (page, count) => setStatus(`История тегов: страниц ${page}, событий ${count}…`));
      const tagged = collectTagged(activities, tag, state.selected);
      const details = new Map();
      if (tagged.length && field !== AUTHOR) {
        const ids = tagged.map(i => i.idReadable).filter(id => /^[A-Za-z0-9_]+-\d+$/.test(id));
        for (let i = 0; i < ids.length; i += ISSUE_CHUNK) {
          setStatus(`Читаю поля задач: ${Math.min(i + ISSUE_CHUNK, ids.length)} из ${ids.length}…`);
          const chunk = ids.slice(i, i + ISSUE_CHUNK);
          const list = await api_get('/api/issues', { fields: 'id,idReadable,summary,customFields(name,value(name,login,fullName,presentation))', query: `issue id: ${chunk.join(', ')}`, $top: chunk.length }, signal);
          for (const issue of list) details.set(issue.id, issue);
        }
      }
      for (const issue of tagged) issue.summary = details.get(issue.id)?.summary || '';
      state.rows = aggregate(tagged, details, field);
      render(tagged.length, tag, field);
      setStatus(tagged.length ? `Готово: задач ${tagged.length}, обработано событий ${activities.length}.` : 'Задач с таким тегом не найдено.', 'ok');
    } catch (error) {
      setStatus(''); showError(error.name === 'AbortError' ? 'Остановлено.' : error.message);
    } finally { state.running = false; state.controller = null; $('cdr-run').disabled = false; $('cdr-stop').disabled = true; }
  }

  function render(total, tag, field) {
    const body = $('cdr-rows'); body.replaceChildren();
    $('cdr-result-title').textContent = `Тег «${tag}» · группировка: ${field === AUTHOR ? 'автор тега' : field}`;
    state.rows.forEach((row, index) => {
      const tr = el('tr'); tr.append(el('td', String(index + 1)), el('td', row.label, 'cdr-name'), el('td', String(row.count), 'cdr-num'), el('td', `${Math.round(row.count / Math.max(total, 1) * 100)}%`, 'cdr-num'));
      const toggle = el('button', 'Показать', 'quiet'); toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
      const cell = el('td'); cell.append(toggle); tr.append(cell);
      const detail = el('tr', null, 'cdr-detail'); detail.hidden = true;
      const holder = el('td'); holder.colSpan = 5;
      const list = el('ul', null, 'cdr-issues');
      for (const issue of row.issues) {
        const li = el('li'), a = el('a', issue.idReadable); a.href = `${ORIGIN}/issue/${encodeURIComponent(issue.idReadable)}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
        li.append(a, document.createTextNode(issue.summary ? ` — ${issue.summary}` : '')); list.append(li);
      }
      holder.append(list); detail.append(holder);
      toggle.addEventListener('click', () => { detail.hidden = !detail.hidden; toggle.textContent = detail.hidden ? 'Показать' : 'Скрыть'; toggle.setAttribute('aria-expanded', String(!detail.hidden)); });
      body.append(tr, detail);
    });
    $('cdr-total').textContent = `Всего уникальных задач: ${total}`;
    $('cdr-result').hidden = false;
  }

  function exportCsv() {
    const quote = v => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['Группа', 'Задач', 'Задачи'].map(quote).join(';')];
    for (const row of state.rows) lines.push([row.label, row.count, row.issues.map(i => i.idReadable).join(' ')].map(quote).join(';'));
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
    $('cdr-tag').value = settings.tag; $('cdr-field').value = settings.field; $('cdr-from').value = settings.from;
    state.selected = new Set(settings.projects);
    $('cdr-project-search').addEventListener('input', renderProjects);
    $('cdr-select-all').addEventListener('click', () => { const q = norm($('cdr-project-search').value); state.projects.filter(p => !q || norm(p.name).includes(q) || norm(p.shortName).includes(q)).forEach(p => state.selected.add(p.id)); renderProjects(); saveSettings(); suggestFields(); });
    $('cdr-clear').addEventListener('click', () => { state.selected.clear(); renderProjects(); saveSettings(); });
    $('cdr-reload').addEventListener('click', loadProjects);
    $('cdr-connect').addEventListener('click', refreshConnection);
    $('cdr-run').addEventListener('click', run);
    $('cdr-stop').addEventListener('click', () => state.controller?.abort());
    $('cdr-export').addEventListener('click', exportCsv);
    for (const id of ['cdr-tag', 'cdr-field', 'cdr-from']) $(id).addEventListener('change', saveSettings);
    $('cdr-field-options').append(Object.assign(document.createElement('option'), { value: AUTHOR }));
    renderProjects();
    if (await loadToken()) loadProjects(); else showError('Нет подключения к YouTrack. Нажмите «Обновить подключение» или откройте отчёт иконкой расширения на вкладке YouTrack.');
  });
})();
