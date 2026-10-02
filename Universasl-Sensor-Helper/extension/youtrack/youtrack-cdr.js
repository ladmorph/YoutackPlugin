// ЦДР: сколько задач по тегу, сгруппировано по полю или по автору тега. Только чтение.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const DEFAULT_ORIGIN = 'https://youtrack-mapps.sovcombank.ru';
  const SETTINGS_KEY = 'cdrSettings';
  const PAGE = 500, MAX_PAGES = 400;
  const net = globalThis.YouTrackReferenceNetwork;
  let projects = [], selected = new Set(), result = null, aborter = null;

  const norm = s => String(s ?? '').trim().toLowerCase();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function setStatus(t) { $('cdr-status').textContent = t || ''; }
  function setError(t) { const e = $('cdr-error'); e.hidden = !t; e.textContent = t || ''; }

  async function session() {
    const { ytToken, ytTokenSourceUrl } = await chrome.storage.local.get(['ytToken', 'ytTokenSourceUrl']);
    if (!ytToken) throw new Error('Нет подключения к YouTrack. Нажмите «Обновить подключение» или откройте отчёт с вкладки YouTrack.');
    let base = DEFAULT_ORIGIN;
    const m = String(ytTokenSourceUrl || '').match(/^(https?:\/\/[^?#]*?)\/api\//);
    if (m) base = m[1];
    return { token: ytToken, base };
  }

  async function api(path, params, signal) {
    const { token, base } = await session();
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    const res = await net.fetch(url.toString(), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal });
    if (res.status === 401 || res.status === 403) throw new Error('YouTrack вернул ' + res.status + '. Обновите подключение.');
    if (!res.ok) throw new Error('YouTrack вернул ' + res.status + ' на ' + path);
    return res.json();
  }

  async function loadProjects() {
    setError(''); setStatus('Загружаю проекты…');
    const all = [];
    for (let skip = 0; ; skip += 200) {
      const page = await api('/api/admin/projects', { fields: 'id,name,shortName,archived', $top: 200, $skip: skip });
      all.push(...page);
      if (page.length < 200) break;
    }
    projects = all.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    renderProjects(); setStatus('');
  }

  function renderProjects() {
    const q = norm($('cdr-project-filter').value), showArchived = $('cdr-archived').checked;
    const list = $('cdr-project-list'); list.textContent = '';
    const shown = projects.filter(p => (showArchived || !p.archived || selected.has(p.shortName)) && (!q || norm(p.name + ' ' + p.shortName).includes(q)));
    for (const p of shown) {
      const label = document.createElement('label');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = selected.has(p.shortName);
      cb.addEventListener('change', () => { cb.checked ? selected.add(p.shortName) : selected.delete(p.shortName); updateCount(); save(); });
      label.append(cb, document.createTextNode(p.name + ' (' + p.shortName + ')' + (p.archived ? ' · архив' : '')));
      list.append(label);
    }
    updateCount();
  }
  function updateCount() { $('cdr-projects-count').textContent = 'выбрано: ' + selected.size; }

  function fieldValues(issue, fieldName) {
    const cf = (issue.customFields || []).find(f => norm(f.name) === norm(fieldName));
    if (!cf || cf.value == null) return [];
    const arr = Array.isArray(cf.value) ? cf.value : [cf.value];
    return arr.map(v => typeof v === 'object' ? (v.fullName || v.name || v.login || v.presentation || '') : String(v)).filter(Boolean);
  }

  async function build() {
    setError(''); result = null; $('cdr-result').hidden = true; $('cdr-csv').disabled = true;
    const tag = $('cdr-tag').value.trim(), mode = $('cdr-mode').value, field = $('cdr-field').value.trim(), since = $('cdr-since').value;
    if (!tag) return setError('Укажите тег.');
    if (mode === 'field' && !field) return setError('Укажите поле для группировки.');
    if (!selected.size) return setError('Выберите хотя бы один проект.');
    aborter = new AbortController();
    $('cdr-run').disabled = true; $('cdr-cancel').hidden = false;
    const wantTag = norm(tag);
    const groups = new Map();
    const issueIndex = new Map();
    let scanned = 0, matched = 0;
    try {
      const params = {
        categories: 'TagsCategory',
        fields: 'id,timestamp,author(login,fullName),added(name),target(id,idReadable,project(shortName),customFields(name,value(name,login,fullName,presentation)))',
        $top: PAGE
      };
      if (since) params.start = String(new Date(since + 'T00:00:00').getTime());
      for (let page = 0; page < MAX_PAGES; page++) {
        params.$skip = page * PAGE;
        const items = await api('/api/activities', params, aborter.signal);
        for (const a of items) {
          scanned++;
          const issue = a.target;
          if (!issue || !selected.has(issue.project?.shortName)) continue;
          if (!(a.added || []).some(t => norm(t.name) === wantTag)) continue;
          matched++;
          const keys = mode === 'author'
            ? [a.author?.fullName || a.author?.login || '—']
            : (fieldValues(issue, field).length ? fieldValues(issue, field) : ['(не заполнено)']);
          issueIndex.set(issue.id, issue.idReadable || issue.id);
          for (const k of keys) {
            const g = groups.get(k) || { issues: new Set(), events: 0 };
            g.issues.add(issue.id); g.events++; groups.set(k, g);
          }
        }
        setStatus('Просмотрено событий: ' + scanned + ', подходящих: ' + matched);
        if (items.length < PAGE) break;
      }
      const rows = [...groups].map(([name, g]) => ({ name, count: g.issues.size, events: g.events, ids: [...g.issues].map(id => issueIndex.get(id)) }))
        .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name, 'ru'));
      const uniq = new Set(rows.flatMap(r => r.ids));
      result = { tag, mode, field, rows, total: uniq.size, scanned };
      const { base } = await session();
      render(base);
      setStatus('Готово');
    } catch (e) {
      setError(e.name === 'AbortError' ? 'Остановлено.' : (e.message || String(e)));
      setStatus('');
    } finally {
      $('cdr-run').disabled = false; $('cdr-cancel').hidden = true; aborter = null;
    }
  }

  function render(base) {
    $('cdr-result').hidden = false;
    $('cdr-group-head').textContent = result.mode === 'author' ? 'Кто добавил тег' : result.field;
    $('cdr-summary').textContent = 'Тег «' + result.tag + '»: уникальных задач — ' + result.total + ', групп — ' + result.rows.length + ', просмотрено событий тегов — ' + result.scanned + '.';
    const tbody = $('cdr-rows'); tbody.textContent = '';
    for (const r of result.rows) {
      const tr = document.createElement('tr');
      const links = r.ids.map(id => '<a href="' + esc(base) + '/issue/' + encodeURIComponent(id) + '" target="_blank" rel="noopener">' + esc(id) + '</a>').join('');
      tr.innerHTML = '<td>' + esc(r.name) + '</td><td class="num">' + r.count + '</td><td class="num">' + r.events + '</td><td class="cdr-ids">' + links + '</td>';
      tbody.append(tr);
    }
    $('cdr-csv').disabled = !result.rows.length;
  }

  function exportCsv() {
    if (!result) return;
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const lines = [[result.mode === 'author' ? 'Кто добавил тег' : result.field, 'Задач', 'Добавлений тега', 'Задачи'].map(q).join(';')];
    for (const r of result.rows) lines.push([q(r.name), r.count, r.events, q(r.ids.join(' '))].join(';'));
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'cdr-' + result.tag + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function save() {
    await chrome.storage.local.set({ [SETTINGS_KEY]: { tag: $('cdr-tag').value, mode: $('cdr-mode').value, field: $('cdr-field').value, since: $('cdr-since').value, projects: [...selected] } });
  }
  async function restore() {
    const s = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    if (!s) return;
    if (s.tag) $('cdr-tag').value = s.tag;
    if (s.mode) $('cdr-mode').value = s.mode;
    if (s.field) $('cdr-field').value = s.field;
    if (s.since) $('cdr-since').value = s.since;
    selected = new Set(s.projects || []);
  }
  function syncMode() { $('cdr-field-wrap').hidden = $('cdr-mode').value !== 'field'; }

  async function init() {
    await restore(); syncMode();
    $('cdr-mode').addEventListener('change', () => { syncMode(); save(); });
    for (const id of ['cdr-tag', 'cdr-field', 'cdr-since']) $(id).addEventListener('change', save);
    $('cdr-project-filter').addEventListener('input', renderProjects);
    $('cdr-archived').addEventListener('change', renderProjects);
    $('cdr-reload-projects').addEventListener('click', () => loadProjects().catch(e => setError(e.message)));
    $('cdr-run').addEventListener('click', build);
    $('cdr-cancel').addEventListener('click', () => aborter?.abort());
    $('cdr-csv').addEventListener('click', exportCsv);
    $('cdr-reconnect').addEventListener('click', async () => {
      setStatus('Обновляю подключение…');
      const r = await chrome.runtime.sendMessage({ type: 'ensure-youtrack-session' }).catch(() => null);
      setStatus(r?.ok ? 'Подключено' : 'Не удалось подключиться');
      if (r?.ok) loadProjects().catch(e => setError(e.message));
    });
    loadProjects().catch(e => { setError(e.message); setStatus(''); });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
