const HOUR_MS = 60 * 60 * 1000;
const SPAM_CACHE_LIMIT = 24;
const CURRENT_HOUR_CACHE_MS = 60 * 1000;
const SPAM_QUERY = `service-name:${globalThis.GraylogConstants?.GATEWAY_SERVICE_NAME ?? "online-banking-gateway"} AND "REQUEST" AND NOT "INTERNAL"`;

const ui = {
  pageState: document.querySelector("#page-state"),
  toolTabs: document.querySelector("#tool-tabs"),
  launcher: document.querySelector("#launcher"),
  checker: document.querySelector("#checker"),
  url: document.querySelector("#graylog-url"),
  open: document.querySelector("#open-graylog"),
  streamMode: document.querySelector("#spam-stream-mode"),
  range: document.querySelector("#range-seconds"),
  previousHour: document.querySelector("#previous-hour"),
  nextHour: document.querySelector("#next-hour"),
  selectedHour: document.querySelector("#selected-hour"),
  run: document.querySelector("#run-check"),
  error: document.querySelector("#error"),
  results: document.querySelector("#results"),
  summary: document.querySelector("#summary"),
  meta: document.querySelector("#result-meta"),
  downloadCsv: document.querySelector("#download-spam-csv"),
  findings: document.querySelector("#findings"),
  versionFilters: document.querySelector("#version-filters"),
  terminalFilters: document.querySelector("#terminal-filters"),
  versionFilterSummary: document.querySelector("#version-filter-summary"),
  terminalFilterSummary: document.querySelector("#terminal-filter-summary"),
  resetFilters: document.querySelector("#reset-filters"),
};

const authRecoveryUi = {
  panel: document.querySelector("#auth-recovery"),
  text: document.querySelector("#auth-recovery-text"),
  button: document.querySelector("#reauth-graylog")
};


let activeTab;
let selectedHourStart = SpamAnalyzer.latestCompletedMoscowStandardHour();
let loadedHourStart = null;
let allRows = [];
let spamUriTotals = new Map();
let spamLoadedVersions = [];
let loading = false;

// All Graylog request tools live in this extension page. Read their existing
// synchronous flags so switching sections cannot start a competing operation.
// Each tool keeps its own stronger same-action guard as well.
globalThis.GraylogHttpActions = Object.freeze({
  busy(owner) {
    const states = [
      ["spam", () => loading],
      ["monitor", () => releaseLoading || globalThis.__graylogTraceLookupLoading === true],
      ["percentiles", () => percentileLoading],
      ["search", () => safeSearchLoading || traceDiagramLoading]
    ];
    return states.some(([name, read]) => {
      if (name === owner) return false;
      try { return Boolean(read()); } catch { return false; }
    });
  }
});
const hiddenVersions = new Set();
const hiddenTerminalTypes = new Set();
const latestSpamVersions = new Map();
const spamTypesByVersion = new Map();
const spamHourCache = new Map();
let lastSpamLoadFromCache = false;
let visibleSpamAnalysis = null;
let authRetryArmed = false;
let authRetryTimer = null;

function currentHour() {
  return Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
}

function currentSpamStreams() {
  return GraylogStreams.monitorStreams(ui.streamMode?.value || "o");
}

function spamModeUnavailable() {
  return !testEnvironmentActive() && ui.streamMode?.value === "r";
}
globalThis.GraylogSpamMode = Object.freeze({ unavailable:spamModeUnavailable });

function earliestAllowedHour() {
  if (ui.range.value === "standard") return SpamAnalyzer.latestCompletedMoscowStandardHour();
  const hours = Math.max(1, Math.round(Number(ui.range.value) / 3600));
  return currentHour() - (hours - 1) * HOUR_MS;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function number(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function hourLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function hourRangeLabel(value) {
  const end = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date(value + HOUR_MS));
  return `${hourLabel(value)}–${end} МСК`;
}

function showError(message) {
  ui.error.textContent = message;
  ui.error.hidden = false;
}

function refreshLoginRecovery() {
  const errorElements = [...document.querySelectorAll("#error, #monitor-error, #percentile-error, #safe-search-error, #trace-diagram-error")];
  const unauthorized = errorElements.some((element) => !element.hidden && /(?:HTTP\s*)?401|unauthori[sz]ed/i.test(element.textContent || ""));
  authRecoveryUi.panel.hidden = !unauthorized;
}

async function reopenGraylogForLogin() {
  const original = authRecoveryUi.button.textContent;
  authRecoveryUi.button.disabled = true;
  authRecoveryUi.button.textContent = "Открываю…";
  try {
    activeTab = await chrome.tabs.get(activeTab.id);
    authRetryArmed = true;
    await chrome.tabs.reload(activeTab.id);
    await chrome.tabs.update(activeTab.id, { active: true });
    if (Number.isInteger(activeTab.windowId)) await chrome.windows.update(activeTab.windowId, { focused: true });
    authRecoveryUi.text.textContent = "Завершите вход в открывшейся вкладке и вернитесь сюда. Запрос повторится автоматически.";
  } catch (error) {
    authRecoveryUi.text.textContent = `Не удалось открыть вкладку Graylog: ${error?.message || String(error)}`;
  } finally {
    authRecoveryUi.button.disabled = false;
    authRecoveryUi.button.textContent = original;
  }
}

function failedRequestButton() {
  const actions = [
    ["#monitor-error", "#refresh-monitor"],
    ["#percentile-error", "#run-percentiles"],
    ["#safe-search-error", "#run-safe-search"],
    ["#trace-diagram-error", "#show-trace-diagram"],
    ["#error", "#run-check"]
  ];
  for (const [errorSelector, buttonSelector] of actions) {
    const error = document.querySelector(errorSelector);
    if (error && !error.hidden && /(?:HTTP\s*)?401|unauthori[sz]ed/i.test(error.textContent || "")) return document.querySelector(buttonSelector);
  }
  return null;
}

async function retryAfterGraylogLogin() {
  if (!authRetryArmed) return;
  const button = failedRequestButton();
  if (!button || button.disabled) return;
  authRetryArmed = false;
  authRecoveryUi.text.textContent = "Проверяю новую сессию Graylog…";
  button.click();
}

window.addEventListener("focus", () => {
  if (!authRetryArmed) return;
  clearTimeout(authRetryTimer);
  authRetryTimer = setTimeout(() => retryAfterGraylogLogin().catch(() => {}), 350);
});

const loginRecoveryObserver = new MutationObserver(refreshLoginRecovery);
for (const element of document.querySelectorAll("#error, #monitor-error, #percentile-error, #safe-search-error, #trace-diagram-error")) {
  loginRecoveryObserver.observe(element, { attributes: true, childList: true, characterData: true, subtree: true });
}
authRecoveryUi.button.addEventListener("click", reopenGraylogForLogin);

function isSearchPage(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && parsed.pathname.toLowerCase().includes("/search");
  } catch {
    return false;
  }
}

function testEnvironmentActive() { return GraylogStreams.environment?.() === "test"; }

function applyGraylogEnvironmentUi() {
  const testMode = testEnvironmentActive();
  document.body.dataset.graylogEnvironment = testMode ? "test" : "default";
  for (const id of ["spam-stream-mode", "monitor-stream-mode"]) {
    const select = document.querySelector(`#${id}`);
    if (!select) continue;
    const options = [...select.options];
    if (options[0]) options[0].textContent = testMode ? "Test · 4 streams" : "Режим О · 9 streams";
    if (options[1]) options[1].hidden = testMode;
    if (testMode) select.value = "o";
    select.disabled = testMode;
    select.title = testMode ? "Контур выбран автоматически по hostname Graylog" : "";
  }
  const percentileTab = document.querySelector("#search-percentiles-tab");
  if (percentileTab) {
    percentileTab.disabled = testMode;
    percentileTab.title = testMode
      ? "Процентили отключены для test-окружения"
      : "Открыть процентили gateway; запросы запускаются отдельной кнопкой";
  }
  const spamNote = document.querySelector("#spam-stream-note");
  if (spamNote) spamNote.innerHTML = testMode
    ? 'Test-режим использует фиксированные 4 streams. Проверяется последний завершённый интервал 11:00–12:00 МСК. Фильтр: <code>service-name:online-banking-gateway AND "REQUEST" AND NOT "INTERNAL"</code>. База считается отдельно для каждой пары версия + тип.'
    : 'По умолчанию выбран Режим О: прежние 9 streams. Поиск спама в режиме Р пока недоступен. Проверяется последний завершённый интервал 11:00–12:00 МСК. Фильтр: <code>service-name:online-banking-gateway AND "REQUEST" AND NOT "INTERNAL"</code>. База считается отдельно для каждой пары версия + тип.';
  updateHourControls();
  if (typeof globalThis.setMonitorModeNote === "function") globalThis.setMonitorModeNote();
  globalThis.TracePercentiles?.refreshSearchState?.();
}

async function selectGraylogTab(tabId) {
  activeTab = await chrome.tabs.get(Number(tabId));
  GraylogStreams.setHost?.(activeTab?.url || "");
  applyGraylogEnvironmentUi();
  ui.error.hidden = true;
  ui.launcher.hidden = true;
  ui.checker.hidden = true;
  ui.toolTabs.hidden = true;

  if (activeTab && isSearchPage(activeTab.url)) {
    ui.pageState.textContent = testEnvironmentActive()
      ? "Graylog test: автоматически выбраны 4 streams, процентили отключены."
      : "Graylog: вкладка найдена. Сессия проверится при первом запросе.";
    ui.toolTabs.hidden = false;
    ui.checker.hidden = false;
    if(!document.querySelector('#navigator-tab')?.classList.contains('active'))document.querySelector("#release-tab")?.click();
    updateHourControls();
  } else {
    ui.pageState.textContent = "Откройте поиск Graylog";
    ui.launcher.hidden = false;
  }
}

function applyRequestedView(view, traceId, autoPercentiles = false, traceContext = null) {
  const generation = (applyRequestedView.generation || 0) + 1;
  applyRequestedView.generation = generation;
  if (view === "percentiles" && globalThis.GraylogStreams?.environment?.() === "test") {
    setTimeout(() => {
      const target = document.querySelector("#safe-search-error");
      if (target) { target.textContent = "Процентили отключены для test-окружения."; target.hidden = false; }
    }, 0);
    return;
  }
  if (view !== "percentiles") {
    if (view === "monitoring") setTimeout(() => document.querySelector("#release-tab")?.click(), 0);
    if (view === "journal") setTimeout(() => document.querySelector("#journal-tab")?.click(), 0);
    return;
  }
  const context = (() => {
    const startMs = Number(traceContext?.startMs);
    const endMs = Number(traceContext?.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs || endMs - startMs > 7 * 86400 * 1000) return null;
    const streamIds = Array.isArray(traceContext?.streamIds)
      ? [...new Set(traceContext.streamIds.map(String).filter((item) => /^[a-f0-9]{24}$/i.test(item)))].slice(0, 16)
      : [];
    return { startMs, endMs, streamIds, nativeSnapshotExact:traceContext?.nativeSnapshotExact===true };
  })();
  setTimeout(async () => {
    if (generation !== applyRequestedView.generation) return;
    // popup.js is loaded before search.js. On the first extension-page load a
    // zero-delay task can run while the later classic scripts are still being
    // fetched, so wait briefly for the context consumers instead of silently
    // dropping the Graylog period.
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const seedReady = !context || typeof globalThis.seedGraylogTraceLaunch === "function";
      const percentilesReady = !(view === "percentiles" && autoPercentiles)
        || typeof globalThis.prepareCurrentTracePercentiles === "function";
      if (seedReady && percentilesReady) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (generation !== applyRequestedView.generation) return;
    }
    if (!/^[a-z0-9_-]{1,128}$/i.test(String(traceId || ""))) return;
    const input = document.querySelector("#safe-search-query");
    if (input) {
      input.value = `traceId:"${traceId}"`;
      input.dispatchEvent(new Event("input", {bubbles:true}));
    }
    if (typeof globalThis.seedGraylogTraceLaunch === "function") globalThis.seedGraylogTraceLaunch(traceId, context);
    if (generation !== applyRequestedView.generation) return;
    try {
      if (view === "percentiles" && autoPercentiles) {
        if (typeof globalThis.prepareCurrentTracePercentiles !== "function") throw new Error("Модуль процентилей не загрузился.");
        await globalThis.prepareCurrentTracePercentiles({isCurrent:()=>generation===applyRequestedView.generation});
      }
    } catch (error) {
      if (generation !== applyRequestedView.generation) return;
      const target = document.querySelector("#safe-search-error");
      if (target) { target.textContent = error?.message || String(error); target.hidden = false; }
    }
  }, 0);
}

async function aggregateInGraylog(hourStartMs, hourEndMs, queryString, streamIds, excludedVersions = [], timeoutMs = 60000) {
  try {
    const current = new URL(location.href);
    const searchIndex = current.pathname.toLowerCase().lastIndexOf("/search");
    if (searchIndex < 0) throw new Error("Текущая вкладка не является страницей поиска Graylog");
    const beforeSearch = current.pathname.slice(0, searchIndex);
    const streamRouteIndex = beforeSearch.toLowerCase().lastIndexOf("/streams/");
    const basePath = streamRouteIndex >= 0 ? beforeSearch.slice(0, streamRouteIndex) : beforeSearch;
    const endpoint = new URL(`${basePath}/api/views/search/sync?timeout=60000`, current.origin).toString();
    const searchId = crypto.randomUUID();
    const queryId = crypto.randomUUID();
    const searchTypeId = crypto.randomUUID();
    const uriTotalsId = crypto.randomUUID();
    const versionsId = crypto.randomUUID();
    if(!Array.isArray(excludedVersions)||excludedVersions.length>3000||excludedVersions.some(v=>typeof v!=='string'||!v||v.length>256||/[\u0000-\u001f\u007f]/.test(v)))throw new Error('Некорректный список уже загруженных версий');
    const quoted=excludedVersions.map(v=>'"'+v.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"');
    const pagedQuery=`(${queryString}) AND _exists_:Terminal-Version${quoted.length?' AND NOT Terminal-Version:('+quoted.join(' OR ')+')':''}`;
    if(pagedQuery.length>60000)throw new Error('Список версий слишком велик для безопасного продолжения. Загружены не все версии.');
    if (!Array.isArray(streamIds) || !streamIds.length) throw new Error("Stream для проверки спама не выбран");
    const streamFilter = { type: "or", filters: streamIds.map((id) => ({ type: "stream", id })) };
    const body = {
      id: searchId,
      parameters: [],
      queries: [{
        id: queryId,
        query: { type: "elasticsearch", query_string: pagedQuery },
        timerange: { type: "absolute", from: new Date(hourStartMs).toISOString(), to: new Date(hourEndMs).toISOString() },
        filter: streamFilter,
        search_types: [{
          id: searchTypeId,
          type: "pivot",
          name: "graylog-spam-check",
          row_groups: [{ type: "time", field: "timestamp", interval: { type: "timeunit", timeunit: "1h" } }],
          column_groups: [
            { type: "values", field: "Terminal-Version", limit: 30 },
            { type: "values", field: "Terminal-Type", limit: 5 },
            { type: "values", field: "initUri", limit: 200 }
          ],
          series: [{ type: "count", id: "count()", field: null }],
          rollup: false
        }, {
          id: uriTotalsId, type: 'pivot', name: 'graylog-spam-uri-hour-total',
          row_groups: [],
          column_groups: [{ type: 'values', field: 'Terminal-Version', limit: 30 }, { type: 'values', field: 'initUri', limit: 200 }],
          series: [{ type: 'count', id: 'count()', field: null }], rollup: false
        }, {
          id: versionsId, type: 'pivot', name: 'graylog-spam-versions', row_groups: [],
          column_groups: [{ type: 'values', field: 'Terminal-Version', limit: 30 }],
          series: [{ type: 'count', id: 'count()', field: null }], rollup: false
        }]
      }]
    };
    const headers = { Accept: "application/json", "Content-Type": "application/json", "X-Requested-By": "graylog-spam-check" };
    const storedSession = globalThis.localStorage?.getItem("sessionId") || "";
    let sessionId = storedSession;
    try { sessionId = JSON.parse(storedSession); } catch {}
    if (typeof sessionId === "string" && sessionId) headers.Authorization = `Basic ${btoa(`${sessionId}:session`)}`;
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(60000,timeoutMs)));
    let response,responseText;
    try{response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers,
      body: JSON.stringify(body), signal:controller.signal
    });
    responseText = await response.text();}finally{clearTimeout(timer);}
    let data;
    try { data = responseText ? JSON.parse(responseText) : {}; }
    catch { throw new Error(`Graylog вернул не JSON: HTTP ${response.status} для ${endpoint}`); }
    if (!response.ok) throw new Error(`HTTP ${response.status} для ${endpoint}: ${data.message || data.type || "ошибка Graylog"}`);

    const searchType = data.results?.[queryId]?.search_types?.[searchTypeId];
    if (!searchType) {
      const details = data.errors?.map((item) => item.description || item.message).filter(Boolean).join("; ");
      throw new Error(`Graylog не вернул pivot-результат${details ? `: ${details}` : ""}`);
    }

    const uriTotalsPivot = data.results?.[queryId]?.search_types?.[uriTotalsId];
    const totalsValid = !data.errors?.length && !data.results?.[queryId]?.errors?.length && data.execution?.done !== false && !data.execution?.cancelled && !data.execution?.completed_exceptionally;
    if(!totalsValid||searchType.errors?.length)throw new Error('Graylog не завершил агрегацию. Не все версии загружены.');
    return { pivot: searchType, uriTotalsPivot, versionsPivot:data.results?.[queryId]?.search_types?.[versionsId] };
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

// Was its own /\d+/g scan that took every number in the string - the same
// bug fixed in ReleaseAnalysis.branchVersion() for the monitoring tab
// (a ticket/date prefix before the real version, e.g. "1234-release-2.5.0",
// could outrank a genuinely higher version). "Новая"/"Старая" in the spam
// view depends on this ordering being right, so it now shares that fix
// instead of keeping its own copy of the old bug.
function compareVersions(left, right) {
  const leftVersion = ReleaseAnalysis.branchVersion(left);
  const rightVersion = ReleaseAnalysis.branchVersion(right);
  if (leftVersion && rightVersion) return ReleaseAnalysis.compareBranchVersions(leftVersion, rightVersion);
  return String(left).localeCompare(String(right), "ru");
}

function updateHourControls() {
  if (ui.range.value === "standard") selectedHourStart = SpamAnalyzer.latestCompletedMoscowStandardHour();
  const minimum = earliestAllowedHour();
  const maximum = ui.range.value === "standard" ? minimum : currentHour();
  selectedHourStart = Math.max(minimum, Math.min(maximum, selectedHourStart));
  ui.selectedHour.textContent = hourRangeLabel(selectedHourStart);
  ui.previousHour.disabled = loading || selectedHourStart <= minimum;
  ui.nextHour.disabled = loading || selectedHourStart >= maximum;
  const unavailable = spamModeUnavailable();
  ui.run.disabled = loading || unavailable;
  ui.run.dataset.unavailable = String(unavailable);
  ui.run.title = unavailable ? "Поиск спама в режиме Р пока недоступен. Выберите режим О." : "";
  if (!loading) ui.run.textContent = unavailable ? "Недоступно в режиме Р" : "Загрузить час";
}

function updateFilterSummaries() {
  for(const [list,label,title] of [[ui.versionFilters,ui.versionFilterSummary,'Версии'],[ui.terminalFilters,ui.terminalFilterSummary,'Типы терминалов']]){
    const inputs=[...list.querySelectorAll('input[type="checkbox"]')],checked=inputs.filter(input=>input.checked).length;
    label.textContent=`${title} · ${checked===inputs.length?'все':`${checked} из ${inputs.length}`}`;
  }
}

function filterOption(value, hiddenSet) {
  return `<label class="filter-option"><input type="checkbox" value="${escapeHtml(value)}" ${hiddenSet.has(value) ? "" : "checked"}><span>${escapeHtml(value)}</span></label>`;
}

function versionFilterOption(value) {
  const types=[...(spamTypesByVersion.get(value)||[])];
  const marks=types.map(type=>`<span class="version-state version-${latestSpamVersions.get(type)===value?'new':'old'}">${latestSpamVersions.get(type)===value?'Новая':'Старая'} · ${escapeHtml(type)}</span>`).join(' ');
  return `<div class="version-filter-option">
    ${filterOption(value, hiddenVersions)}
    <span class="spam-version-marks">${marks||'Тип не определён в группировке'}</span>
  </div>`;
}

function bindSpamFilterTools(list,hiddenSet,prefix){
  const search=document.getElementById(prefix+'-search'),select=document.getElementById(prefix+'-select-all'),clear=document.getElementById(prefix+'-clear-all'),count=document.getElementById(prefix+'-matches');
  const inputs=()=>[...list.querySelectorAll('input[type="checkbox"]')];
  const update=()=>{
    const term=search.value.trim().toLocaleLowerCase('ru');let matched=0;
    for(const input of inputs()){const row=input.closest('.version-filter-option')||input.closest('.filter-option');row.hidden=!input.value.toLocaleLowerCase('ru').includes(term);if(!row.hidden)matched++;}
    select.textContent=term?'Выбрать найденные':'Выбрать все';clear.textContent=term?'Снять найденные':'Снять все';
    select.disabled=clear.disabled=matched===0;count.textContent=`Найдено: ${matched} из ${inputs().length}`;
  };
  search.oninput=update;
  const apply=checked=>{for(const input of inputs()){const row=input.closest('.version-filter-option')||input.closest('.filter-option');if(row.hidden)continue;input.checked=checked;if(checked)hiddenSet.delete(input.value);else hiddenSet.add(input.value);}updateFilterSummaries();renderFilteredResults();};
  select.onclick=()=>apply(true);clear.onclick=()=>apply(false);update();
}

function renderFilters(rows) {
  const versions = [...new Set([...spamLoadedVersions,...rows.map((row) => row.version)])].sort((a, b) => compareVersions(b, a));
  const terminalTypes = [...new Set(rows.map((row) => row.terminalType))].sort((a, b) => a.localeCompare(b, "ru"));
  latestSpamVersions.clear();
  spamTypesByVersion.clear();
  for(const row of rows){const old=latestSpamVersions.get(row.terminalType);if(old===undefined||compareVersions(row.version,old)>0)latestSpamVersions.set(row.terminalType,row.version);if(!spamTypesByVersion.has(row.version))spamTypesByVersion.set(row.version,new Set());spamTypesByVersion.get(row.version).add(row.terminalType);}
  ui.versionFilters.innerHTML = versions.map(versionFilterOption).join("") || '<span class="muted">Нет версий</span>';
  ui.terminalFilters.innerHTML = terminalTypes.map((value) => filterOption(value, hiddenTerminalTypes)).join("") || '<span class="muted">Нет типов</span>';

  for (const input of ui.versionFilters.querySelectorAll("input")) {
    input.addEventListener("change", () => {
      if (input.checked) hiddenVersions.delete(input.value); else hiddenVersions.add(input.value);
      updateFilterSummaries();
      renderFilteredResults();
    });
  }
  for (const input of ui.terminalFilters.querySelectorAll("input")) {
    input.addEventListener("change", () => {
      if (input.checked) hiddenTerminalTypes.delete(input.value); else hiddenTerminalTypes.add(input.value);
      updateFilterSummaries();
      renderFilteredResults();
    });
  }
  updateFilterSummaries();
  bindSpamFilterTools(ui.versionFilters,hiddenVersions,'spam-version');
  bindSpamFilterTools(ui.terminalFilters,hiddenTerminalTypes,'spam-terminal');
}

function card(label, value, className = "") {
  return `<div class="card ${className}"><span>${label}</span><strong>${number(value)}</strong></div>`;
}

function spamCsvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function spamCsvText(findings, periodLabel) {
  const header = ["Период МСК", "Риск", "Версия", "Тип терминала", "initUri", "Факт", "База", "Лишних", "Коэффициент", "Всего по URI версии за час (все типы)"].map(spamCsvCell).join(";");
  const rows = (findings || []).map((item) => [
    periodLabel, item.riskLabel, item.version, item.terminalType, item.uri,
    Number(item.count) || 0, Number(item.baseline) || 0, Number(item.excess) || 0,
    Number.isFinite(Number(item.ratio)) ? Number(item.ratio).toFixed(2) : "",
    Number.isSafeInteger(item.uriHourTotal) ? item.uriHourTotal : ""
  ].map(spamCsvCell).join(";"));
  return [header, ...rows].join("\r\n");
}

function downloadSpamCsv() {
  const findings = visibleSpamAnalysis?.findings || [];
  if (!findings.length || loadedHourStart === null) return;
  const finishCompanion = globalThis.Clippy?.begin?.("export");
  let companionOutcome = "error";
  let url = "";
  try {
  const blob = new Blob(["\uFEFF", spamCsvText(findings, hourRangeLabel(loadedHourStart))], { type:"text/csv;charset=utf-8" });
  url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `graylog-spam-${new Date(loadedHourStart).toISOString().replace(/[:.]/g, "-")}.csv`;
  link.click();
  companionOutcome = "exported";
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    finishCompanion?.(companionOutcome);
  }
}

function render(analysis) {
  visibleSpamAnalysis = analysis;
  ui.results.hidden = false;
  ui.downloadCsv.disabled = !analysis.findings.length;
  ui.summary.innerHTML = [
    card("Критические", analysis.summary.critical, "critical"),
    card("Высокий", analysis.summary.high, "high"),
    card("Подозрение", analysis.summary.watch),
    card("Лишних запросов", analysis.summary.totalExcess || 0),
    card("Без базы", analysis.summary.unresolved, analysis.summary.unresolved ? "high" : ""),
    card("Версия × тип", analysis.summary.totalGroups, "groups")
  ].join("");
  ui.meta.textContent = `${hourRangeLabel(loadedHourStart)} · версий: ${number(spamLoadedVersions.length)} · строк: ${number(analysis.summary.totalRows)}${lastSpamLoadFromCache ? " · из памяти" : ""}`;
  if(analysis.findings.length>250)ui.meta.textContent+=` · показано 250 из ${number(analysis.findings.length)} отклонений: уточните фильтр или скачайте CSV`;
  const groupsByKey = new Map(analysis.groups.map((group) => [`${group.version}\u0000${group.terminalType}`, group]));
  const findingsByKey = new Map();
  for (const item of analysis.findings.slice(0, 250)) {
    const key = `${item.version}\u0000${item.terminalType}`;
    if (!findingsByKey.has(key)) findingsByKey.set(key, []);
    findingsByKey.get(key).push(item);
  }
  const findingMarkup = analysis.findings.length ? [...findingsByKey.entries()].map(([key, items]) => {
    const group = groupsByKey.get(key);
    const first = items[0];
    const mark = latestSpamVersions.get(first.terminalType)===first.version?'new':'old';
    const badge = mark ? `<span class="version-state version-${mark}">${mark === "new" ? "Новая" : "Старая"}</span>` : "";
    const bands = (group?.bands || []).map((band) => `${band.label}: ${number(band.min)}–${number(band.max)} (${band.size})`).join(" · ");
    const header = `<tr class="finding-group"><td colspan="6"><strong>${escapeHtml(first.version)}</strong> · ${escapeHtml(first.terminalType)} ${badge}<span>Сравнение: ${group?.baseline ? number(group.baseline) : "не определено"} · ${escapeHtml(bands)} · ${escapeHtml(group?.reason || "")}</span></td></tr>`;
    const rows = items.map((item) => `<tr>
      <td><span class="risk risk-${item.risk}">${escapeHtml(item.riskLabel)}</span></td>
      <td>${escapeHtml(hourLabel(loadedHourStart))}</td>
      <td>${escapeHtml(item.version)}<br><span class="muted">${escapeHtml(item.terminalType)}</span></td>
      <td class="uri">${escapeHtml(item.uri)}</td>
      <td class="spam-uri-total" title="Эта версия, все типы терминалов в выбранных streams за загруженный час">${Number.isSafeInteger(item.uriHourTotal)?`<strong>${number(item.uriHourTotal)}</strong>`:'<span class="muted" title="Graylog не вернул итог для URI: агрегация недоступна или URI вне первых 200 групп. Это не ноль.">Нет данных</span>'}</td>
      <td>${number(item.count)} / ${number(item.baseline)}<br><strong>${item.ratio.toFixed(2)}×</strong></td>
    </tr>`).join("");
    return header + rows;
  }).join("") : "";
  const unresolvedMarkup = analysis.groups.filter((group) => !group.baseline).map((group) => `<tr class="finding-group finding-unresolved"><td colspan="6"><strong>${escapeHtml(group.version)}</strong> · ${escapeHtml(group.terminalType)} <span class="version-state version-${latestSpamVersions.get(group.terminalType)===group.version?"new":"old"}">${latestSpamVersions.get(group.terminalType)===group.version?"Новая":"Старая"}</span><span>База не определена · URI: ${number(group.uriCount)} · ${escapeHtml(group.reason || "недостаточно данных для сравнения")}</span></td></tr>`).join("");
  ui.findings.innerHTML = findingMarkup + unresolvedMarkup || `<tr><td class="empty" colspan="6">${!analysis.groups.length&&allRows.length?'По выбранным фильтрам нет групп. Выберите версии и типы или нажмите «Показать все».':'Для выбранного часа заметных превышений не найдено. Все группы получили достаточную базу.'}</td></tr>`;
}

function renderFilteredResults() {
  const analysis = SpamAnalyzer.analyzeRows(allRows);
  const isVisible = (item) => !hiddenVersions.has(item.version) && !hiddenTerminalTypes.has(item.terminalType);
  const findings = analysis.findings.filter(isVisible).map(item=>({...item,uriHourTotal:spamUriTotals.get(JSON.stringify([item.version,item.uri]))}));
  const groups = analysis.groups.filter(isVisible);
  render({
    ...analysis,
    findings,
    groups,
    summary: {
      ...analysis.summary,
      totalGroups: groups.length,
      critical: findings.filter((item) => item.risk === "critical").length,
      high: findings.filter((item) => item.risk === "high").length,
      watch: findings.filter((item) => item.risk === "watch").length,
      totalExcess: findings.reduce((sum, item) => sum + item.excess, 0),
      unresolved: groups.filter((group) => !group.baseline).length
    }
  });
}

async function loadSelectedHour() {
  if (loading || globalThis.GraylogHttpActions?.busy?.("spam")) return;
  if (globalThis.GraylogSpamMode?.unavailable?.() === true) {
    showError("Поиск спама в режиме Р пока недоступен. Выберите режим О.");
    updateHourControls();
    return false;
  }
  const finishCompanion = globalThis.Clippy?.begin?.("loading");
  let companionOutcome = "error";
  loading = true;
  ui.error.hidden = true;
  ui.run.disabled = true;
  ui.streamMode.disabled = true;
  ui.run.textContent = "Загружаю…";
  updateHourControls();
  try {
    activeTab = await chrome.tabs.get(activeTab.id);
    const streamIds = currentSpamStreams();
    const cacheKey = `${new URL(activeTab.url).origin}\u0000${SPAM_QUERY}\u0000${streamIds.join(",")}\u0000${selectedHourStart}`;
    const cached = spamHourCache.get(cacheKey);
    const cacheIsFresh = cached && (selectedHourStart !== currentHour() || Date.now() - cached.savedAt < CURRENT_HOUR_CACHE_MS);
    if (cacheIsFresh) {
      loadedHourStart = selectedHourStart;
      allRows = cached.rows;
      spamUriTotals = new Map(cached.uriTotals || []);
      spamLoadedVersions = cached.versions || [];
      lastSpamLoadFromCache = true;
      renderFilters(allRows);
      renderFilteredResults();
      companionOutcome = cached.incomplete ? "warning" : allRows.length === 0 ? "empty" : "success";
      return;
    }
    const hourEnd = selectedHourStart === currentHour() ? Date.now() : selectedHourStart + HOUR_MS;
    const rows=[],totals=new Map(),versions=new Set(),deadline=Date.now()+180000;
    let portion=0;
    while(true){
      if(Date.now()>=deadline||versions.size>=3000)throw new Error('Не удалось завершить загрузку всех версий в пределах безопасного объёма/времени. Частичный результат не опубликован.');
      ui.run.textContent=`Загружаю версии… получено ${versions.size}`;
      const audit=QueryAudit.begin({area:`Спам запросов · порция ${++portion}`,query:SPAM_QUERY,streams:streamIds,startMs:selectedHourStart,endMs:hourEnd,aggregation:`версия(30) × тип(5) × URI(200); отдельно версия × URI × count(); каталог версий(30); исключено ранее полученных версий: ${versions.size}; один HTTP`});
      let pageVersions;
      try{
        const execution=await chrome.scripting.executeScript({target:{tabId:activeTab.id},world:'MAIN',func:aggregateInGraylog,args:[selectedHourStart,hourEnd,SPAM_QUERY,streamIds,[...versions],Math.min(60000,deadline-Date.now())]});
        const result=execution[0]?.result;
        if(execution[0]?.error||result?.error)throw new Error(result?.error||'Не удалось выполнить агрегацию Graylog.');
        if(!Array.isArray(result?.pivot?.rows))throw new Error('Не удалось получить pivot из вкладки Graylog.');
        pageVersions=SpamAnalyzer.parseSpamVersions(result.versionsPivot);
        if(pageVersions.length>30||pageVersions.some(version=>versions.has(version)))throw new Error('Graylog повторил уже полученную версию. Загрузка остановлена без неполного отчёта.');
        const pageRows=SpamAnalyzer.parseSpamPivotRows(result.pivot,new Date(selectedHourStart).toISOString());
        if(!pageRows.length&&result.pivot.rows.some(row=>(row.values||[]).some(cell=>cell.rollup!==true&&(!cell.source||cell.source==='col-leaf'))))throw new Error('Graylog вернул группы в неподдерживаемом формате. Полнота анализа не подтверждена.');
        if(pageRows.some(row=>!pageVersions.includes(row.version)))throw new Error('Группы и список версий не совпали. Полнота загрузки не подтверждена.');
        if(rows.length+pageRows.length>100000)throw new Error('Превышен объём групп для анализа. Загружены не все версии; частичный отчёт не опубликован.');
        rows.push(...pageRows);
        for(const [key,value] of SpamAnalyzer.parseSpamUriTotals(result.uriTotalsPivot)){
          if(!pageVersions.includes(JSON.parse(key)[0]))throw new Error('Итог URI относится к другой порции версий.');
          totals.set(key,value);
        }
        pageVersions.forEach(version=>versions.add(version));
        audit.finish('success',result.pivot.total);
      }catch(error){audit.finish('error');throw error;}
      if(pageVersions.length<30)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    loadedHourStart=selectedHourStart;allRows=rows;spamUriTotals=totals;spamLoadedVersions=[...versions];
    lastSpamLoadFromCache = false;
    spamHourCache.set(cacheKey,{rows:allRows,uriTotals:[...spamUriTotals],versions:spamLoadedVersions,savedAt:Date.now()});
    BoundedCache.pruneCache(spamHourCache, SPAM_CACHE_LIMIT);
    renderFilters(allRows);
    renderFilteredResults();
    companionOutcome = allRows.length === 0 ? "empty" : "success";
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    loading = false;
    ui.run.disabled = false;
    ui.streamMode.disabled = globalThis.GraylogStreams?.environment?.() === "test";
    ui.run.textContent = "Загрузить час";
    updateHourControls();
    finishCompanion?.(companionOutcome);
  }
}

async function moveHour(offset) {
  // Keep navigation atomic with the request it starts. The buttons are also
  // disabled while loading, but this guard prevents a queued/synthetic second
  // click from changing the selected hour behind the active request.
  if (loading) return;
  selectedHourStart += offset * HOUR_MS;
  updateHourControls();
  await loadSelectedHour();
}

async function initialize() {
  const tabId = new URLSearchParams(location.search).get("tabId");
  if (!tabId) throw new Error("Не удалось определить вкладку Graylog");
  await selectGraylogTab(tabId);
  const launch = new URLSearchParams(location.search);
  applyRequestedView(launch.get("view"), launch.get("traceId"), launch.get("autoPercentiles") === "1", {
    startMs: launch.get("startMs"), endMs: launch.get("endMs"), streamIds: (launch.get("streams") || "").split(","), nativeSnapshotExact:launch.get("nativeSnapshot")==="1"
  });
}

ui.open.addEventListener("click", async () => {
  try {
    const target = new URL(ui.url.value.trim());
    if (!/^https?:$/.test(target.protocol)) throw new Error();
    await chrome.tabs.update(activeTab.id, { url: target.toString() });
    ui.pageState.textContent = "Graylog открыт в исходной вкладке";
  } catch {
    showError("Укажите полную ссылку на поиск Graylog");
  }
});

ui.run.addEventListener("click", loadSelectedHour);
ui.streamMode.addEventListener("change", () => {
  loadedHourStart = null;
  allRows = [];
  spamUriTotals = new Map();
  spamLoadedVersions = [];
  visibleSpamAnalysis = null;
  ui.results.hidden = true;
  ui.downloadCsv.disabled = true;
  ui.error.hidden = true;
  updateHourControls();
});
ui.downloadCsv.addEventListener("click", downloadSpamCsv);
ui.previousHour.addEventListener("click", () => moveHour(-1));
ui.nextHour.addEventListener("click", () => moveHour(1));
ui.range.addEventListener("change", () => {
  selectedHourStart = ui.range.value === "standard" ? SpamAnalyzer.latestCompletedMoscowStandardHour() : currentHour();
  updateHourControls();
});
ui.resetFilters.addEventListener("click", () => {
  hiddenVersions.clear();
  hiddenTerminalTypes.clear();
  document.getElementById('spam-version-search').value='';
  document.getElementById('spam-terminal-search').value='';
  renderFilters(allRows);
  renderFilteredResults();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "graylog-tab-changed" && message.tabId) {
    selectGraylogTab(message.tabId)
      .then(() => { applyRequestedView(message.view, message.traceId, message.autoPercentiles === true, message.traceContext); sendResponse({ connected: true }); })
      .catch((error) => {
        showError(error.message);
        sendResponse({ connected: false, error: error.message });
      });
    return true;
  }
  return false;
});

initialize().catch((error) => {
  ui.pageState.textContent = "Не удалось подключиться к вкладке Graylog";
  showError(error.message);
});
