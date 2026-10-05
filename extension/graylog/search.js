const SAFE_SEARCH_FIELDS = new Set(["service-name", "initUri", "traceId", "level", "httpStatus", "errorCode", "Terminal-Version", "Terminal-Type", "logger_name", "source", "branch", "abbrev"]);
const SAFE_SEARCH_CACHE_LIMIT = 24;
const SAFE_SEARCH_CURRENT_CACHE_MS = 60 * 1000;
const TRACE_DIAGRAM_CACHE_LIMIT = 24;
const TRACE_DIAGRAM_NODE_LIMIT = 200;
const SEARCH_ALL_STREAMS = "__all_streams__";

const searchUi = {
  tab: document.querySelector("#search-tab"), query: document.querySelector("#safe-search-query"), stream: document.querySelector("#safe-search-stream"), range: document.querySelector("#safe-search-range"), end: document.querySelector("#safe-search-end"),
  now: document.querySelector("#safe-search-now"), periodPreview: document.querySelector("#safe-search-period-preview"),
  primary: document.querySelector("#safe-search-group-primary"), secondary: document.querySelector("#safe-search-group-secondary"), tertiary: document.querySelector("#safe-search-group-tertiary"), limit: document.querySelector("#safe-search-limit"),
  serviceCallLimit: document.querySelector("#trace-service-call-limit"),
  mode: document.querySelector("#safe-search-mode"), run: document.querySelector("#run-safe-search"), open: document.querySelector("#open-safe-search-graylog"),
  error: document.querySelector("#safe-search-error"), results: document.querySelector("#safe-search-results"), summary: document.querySelector("#safe-search-summary"),
  details: document.querySelector("#safe-search-details"),
  meta: document.querySelector("#safe-search-meta"), head: document.querySelector("#safe-search-head"), rows: document.querySelector("#safe-search-rows"),
  rawDetails: document.querySelector("#safe-search-raw-details"), timeline: document.querySelector("#trace-timeline"),
  timelineMeta: document.querySelector("#trace-timeline-meta"), timelineChart: document.querySelector("#trace-timeline-chart"),
  timelineFilter: document.querySelector("#trace-timeline-filter"), timelineMode: document.querySelector("#trace-timeline-mode"),
  timelineQuality: document.querySelector("#trace-timeline-quality"), timelineDetail: document.querySelector("#trace-timeline-detail"),
  traceButton: document.querySelector("#show-trace-diagram"), tracePanel: document.querySelector("#trace-diagram"), traceMeta: document.querySelector("#trace-diagram-meta"),
  traceError: document.querySelector("#trace-diagram-error"), traceFlow: document.querySelector("#trace-diagram-flow"), traceHelp: document.querySelector("#trace-action-help"),
  stale: document.querySelector("#safe-search-stale")
};

let safeSearchRows = [];
let safeSearchTotal = 0;
let safeSearchLoading = false;
let safeSearchSeeded = false;
let safeSearchFromCache = false;
let safeSearchStreamOverride = null;
let safeSearchIndependent = false;
let safeSearchContext = null;
let safeSearchLoadedSignature = null;
let traceDiagramLoading = false;
let traceTimelineDiagram = null;
let traceTimelineFromCache = false;
let activeExplicitTraceOperation = null;
let checkerPageTabId = null;
chrome.tabs.getCurrent().then(tab => { checkerPageTabId = tab?.id ?? null; }).catch(() => {});
const safeSearchCache = new Map();
const traceDiagramCache = new Map();
const searchEmptyState = document.createElement("section");
searchEmptyState.id = "trace-search-empty";
searchEmptyState.className = "empty-result-state";
searchEmptyState.hidden = true;
const emptySearchImage = document.createElement("img");
emptySearchImage.src = chrome.runtime.getURL("extension/shared/empty-state.png");
emptySearchImage.alt = "Смайл разводит руками: событий не найдено";
emptySearchImage.width = 200; emptySearchImage.height = 164;
const emptySearchHeading = document.createElement("h3");
emptySearchHeading.textContent = "По этому traceId ничего не найдено";
const emptySearchHint = document.createElement("p");
emptySearchHint.textContent = "Проверьте traceId, выбранные streams и период поиска.";
searchEmptyState.append(emptySearchImage, emptySearchHeading, emptySearchHint);
searchUi.results.before(searchEmptyState);

const TRACE_SEARCH_DEADLINE_MS = 65_000;
function createTraceSearchDeadline(onTimeout = () => {}) {
  const expiresAt = Date.now() + TRACE_SEARCH_DEADLINE_MS;
  let expired = false;
  const timeoutError = phase => {
    if (!expired) { expired = true; try { onTimeout(); } catch {} }
    const error = new Error(`Поиск остановлен: превышено общее время ожидания (65 с). Этап: ${phase}. Повторите поиск вручную.`);
    error.code = "TRACE_DEADLINE"; return error;
  };
  return { expiresAt, async wait(action, phase = "Graylog") {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0 || expired) throw timeoutError(phase);
    let timer;
    try { return await Promise.race([action(), new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError(phase)), remaining); })]); }
    finally { clearTimeout(timer); }
  } };
}
async function settleTraceCleanup(action) {
  let timer;
  try { await Promise.race([Promise.resolve().then(action).catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, 2000); })]); }
  finally { clearTimeout(timer); }
}

function startExplicitTraceOperation(sourceTabId, kind = "full-graph") {
  const operation = { id: crypto.randomUUID(), sourceTabId, kind, cancelled: false };
  activeExplicitTraceOperation = operation;
  return operation;
}

async function cancelExplicitTraceTransport(operation) {
  if (!operation) return false;
  operation.cancelled = true;
  const execution = await chrome.scripting.executeScript({
    target: { tabId: operation.sourceTabId }, world: "MAIN",
    func: runId => globalThis.GraylogTraceFetch?.cancelExplicitTraceRunInGraylog?.(runId) === true,
    args: [operation.id]
  }).catch(() => []);
  return execution?.[0]?.result === true;
}

async function activateExplicitTraceOperation(operation, deadline) {
  if (!operation || operation.active) return operation?.active === true;
  const prepared = await deadline.wait(() => chrome.scripting.executeScript({
    target: { tabId: operation.sourceTabId }, world: "MAIN",
    func: runId => globalThis.GraylogTraceFetch?.prepareExplicitTraceRunInGraylog?.(runId) === true,
    args: [operation.id]
  }).catch(() => []), "подготовка отмены");
  if (prepared?.[0]?.result !== true) throw new Error("Не удалось подготовить безопасную отмену операции.");
  if (operation.cancelled) { void cancelExplicitTraceTransport(operation); throw new Error("Операция остановлена."); }
  try {
    operation.keepAlive = chrome.runtime.connect?.({ name: "graylog-explicit-operation" }) || null;
    operation.keepAlive?.onMessage?.addListener?.(message => {
      if (message?.type === "cancel-explicit-operation" && message.operationId === operation.id) cancelExplicitTraceTransport(operation).catch(() => {});
    });
  } catch {}
  operation.ready = chrome.runtime.sendMessage({ type: "set-graylog-explicit-operation", sourceTabId: operation.sourceTabId, operationId: operation.id, kind: operation.kind, active: true }).catch(() => null);
  await deadline.wait(() => operation.ready, "регистрация операции");
  operation.active = true;
  return true;
}

async function finishExplicitTraceOperation(operation) {
  if (!operation) return;
  if (activeExplicitTraceOperation === operation) activeExplicitTraceOperation = null;
  await settleTraceCleanup(() => chrome.scripting.executeScript({target:{tabId:operation.sourceTabId},world:"MAIN",func:runId=>globalThis.GraylogTraceFetch?.releaseExplicitTraceRunInGraylog?.(runId)===true,args:[operation.id]}));
  if (operation.active) {
    await settleTraceCleanup(() => chrome.runtime.sendMessage({ type: "set-graylog-explicit-operation", sourceTabId: operation.sourceTabId, operationId: operation.id, kind: operation.kind, active: false }));
  }
  try { operation.keepAlive?.disconnect?.(); } catch {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "cancel-explicit-operation-in-tools") return false;
  const operation = activeExplicitTraceOperation;
  const operationId = String(message.operationId || "");
  if (sender?.id !== chrome.runtime.id || checkerPageTabId === null || checkerPageTabId !== Number(message.targetTabId)
    || !operation || operation.id !== operationId || operation.sourceTabId !== Number(message.sourceTabId)) return false;
  cancelExplicitTraceTransport(operation).then(cancelled => sendResponse({ cancelled })).catch(() => sendResponse({ cancelled: false }));
  return true;
});

function isExactTraceQuery(query) {
  return Boolean(traceIdValue(query));
}

function traceIdValue(value) {
  const input = String(value || "").trim();
  const match = /^traceId\s*:\s*(?:"([a-z0-9_-]{1,128})"|([a-z0-9_-]{1,128}))$/i.exec(input);
  const id = match ? match[1] || match[2] : input;
  return /^[a-z0-9_-]{1,128}$/i.test(id) ? id : "";
}

function auditSearchQuery(query) {
  return isExactTraceQuery(query) ? 'traceId:"[скрыт]"' : query;
}

function currentSearchFormSignature() {
  return JSON.stringify([
    searchUi.query.value.trim(), searchUi.stream.value, safeSearchStreamOverride,
    searchUi.range.value, searchUi.end.value, searchUi.primary.value,
    searchUi.secondary.value, searchUi.tertiary.value, searchUi.limit.value
  ]);
}

function updateSearchPeriodPreview() {
  const endMs = new Date(searchUi.end.value).getTime();
  const rangeSeconds = Number(searchUi.range.value);
  searchUi.periodPreview.textContent = Number.isFinite(endMs) && Number.isFinite(rangeSeconds)
    ? `Будет запрошено: ${moscowPeriodLabel(endMs - rangeSeconds * 1000, endMs)}`
    : "Укажите корректный конец периода";
}

function updateTraceActionState() {
  const exact = isExactTraceQuery(searchUi.query.value);
  const percentileBusy = globalThis.TracePercentiles?.isLoading?.() === true;
  searchUi.run.disabled = traceDiagramLoading || safeSearchLoading || percentileBusy;
  searchUi.run.title = traceDiagramLoading ? "Дождитесь загрузки графа" : percentileBusy ? "Дождитесь расчёта процентилей" : "Найти сообщения текущего запроса";
  searchUi.traceButton.disabled = traceDiagramLoading || safeSearchLoading || percentileBusy || !exact;
  searchUi.traceButton.title = exact ? "Построить дерево вызовов по текущему traceId" : "Вставьте traceId в поле поиска";
  searchUi.traceHelp.textContent = traceDiagramLoading ? "Получаю события и связываю span…" : percentileBusy ? "Выполняется расчёт процентилей…" : exact ? "Дерево вызовов по traceId" : "Введите точный traceId";
  globalThis.TracePercentiles?.refreshSearchState?.();
}

function markSearchFormChanged() {
  if (safeSearchLoadedSignature !== currentSearchFormSignature()) globalThis.TracePercentiles?.setTraceContext(null);
  updateSearchPeriodPreview();
  updateTraceActionState();
  searchUi.stale.hidden = !safeSearchLoadedSignature || safeSearchLoadedSignature === currentSearchFormSignature();
}

function graylogTabCacheScope(tab) {
  try {
    const parsed = new URL(String(tab?.url || ""));
    if (/^https?:$/.test(parsed.protocol)) return parsed.origin;
  } catch {}
  return `graylog-tab:${Number.isInteger(tab?.id) ? tab.id : "unknown"}`;
}

function setExactRangeOption(select, startMs, endMs, labelPrefix) {
  select.querySelector('option[data-trace-launch="true"]')?.remove();
  const seconds = (endMs - startMs) / 1000;
  const value = String(seconds);
  if (![...select.options].some((option) => option.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.dataset.traceLaunch = "true";
    option.textContent = `${labelPrefix} · ${Math.round(seconds)} сек`;
    select.append(option);
  }
  select.value = value;
}

function seedGraylogTraceLaunch(traceId, context = null) {
  const id = traceIdValue(traceId);
  if (!id) return false;
  searchUi.query.value = `traceId:"${id}"`;
  const startMs = Number(context?.startMs);
  const endMs = Number(context?.endMs);
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < endMs) {
    const boundedStart = Math.max(startMs, endMs - 86400 * 1000);
    setExactRangeOption(searchUi.range, boundedStart, endMs, "Период Graylog");
    const local = new Date(endMs - new Date(endMs).getTimezoneOffset() * 60_000).toISOString();
    searchUi.end.step = "1";
    searchUi.end.value = local.slice(0, 19);
    const streamIds = Array.isArray(context.streamIds)
      ? [...new Set(context.streamIds.map(String).filter((value) => /^[a-f0-9]{24}$/i.test(value)))].slice(0, 16)
      : [];
    if (streamIds.length) {
      safeSearchStreamOverride = streamIds;
      searchUi.stream.querySelector('option[value="__source_streams__"]')?.remove();
      if (streamIds.length === 1 && GraylogStreams.GRAYLOG_STREAMS.includes(streamIds[0])) searchUi.stream.value = streamIds[0];
      else {
        const option = document.createElement("option");
        option.value = "__source_streams__";
        option.textContent = `Набор из ${streamIds.length} streams · из Graylog`;
        searchUi.stream.append(option);
        searchUi.stream.value = option.value;
      }
    }
    globalThis.TracePercentiles?.setBounds?.({ startMs: boundedStart, endMs });
  }
  safeSearchSeeded = true;
  searchUi.tab.click();
  markSearchFormChanged();
  return true;
}

function safeSearchParameters() {
  const id = traceIdValue(searchUi.query.value);
  if (!id) throw new Error("Вставьте один traceId: буквы, цифры, дефис или подчёркивание, до 128 символов");
  const query = `traceId:"${id}"`;
  const rangeSeconds = Number(searchUi.range.value);
  const limit = Number(searchUi.limit.value);
  const serviceCallLimit = Number(searchUi.serviceCallLimit.value);
  const primary = searchUi.primary.value;
  const secondary = searchUi.secondary.value;
  const tertiary = searchUi.tertiary.value;
  if (!query) throw new Error("Введите запрос Graylog");
  if (query.length > 1000) throw new Error("Запрос длиннее 1000 символов");
  const isExactTrace = isExactTraceQuery(query);
  if (query === "*" && rangeSeconds > 900) throw new Error("Запрос «*» разрешён максимум за 15 минут");
  if (!SAFE_SEARCH_FIELDS.has(primary) || (secondary && !SAFE_SEARCH_FIELDS.has(secondary)) || (tertiary && !SAFE_SEARCH_FIELDS.has(tertiary))) throw new Error("Недопустимое поле группировки");
  if ([primary, secondary, tertiary].includes("traceId") && !isExactTrace) throw new Error("Группировка traceId разрешена только для точного traceId");
  const groups = [primary, secondary, tertiary].filter(Boolean);
  if (new Set(groups).size !== groups.length) throw new Error("Выберите разные поля группировки");
  if (![10, 25, 50].includes(limit) || rangeSeconds > (isExactTrace ? 86400 : 7200)) throw new Error("Период больше 2 часов разрешён только для точного traceId");
  if (![1, 2, 3, 5, 10].includes(serviceCallLimit)) throw new Error("Недопустимая норма повторов одного URI");
  const endMs = new Date(searchUi.end.value).getTime();
  if (!Number.isFinite(endMs)) throw new Error("Укажите конец периода");
  const streamIds = safeSearchStreamOverride?.length
    ? [...safeSearchStreamOverride]
    : searchUi.stream.value === SEARCH_ALL_STREAMS ? GraylogStreams.list() : [GraylogStreams.selectedGraylogStream(searchUi.stream)];
  if (!streamIds.length) throw new Error("Выберите stream для поиска");
  return { query, rangeSeconds, startMs: endMs - rangeSeconds * 1000, endMs, groups, limit, serviceCallLimit, streamIds };
}

async function fetchSafeSearchInGraylog(queryString, startMs, endMs, groups, limit, streamIds) {
  try {
    if (!Array.isArray(streamIds) || !streamIds.length) throw new Error("Stream для поиска не выбран");
    const current = new URL(location.href);
    const searchIndex = current.pathname.toLowerCase().lastIndexOf("/search");
    if (searchIndex < 0) throw new Error("Текущая вкладка не является страницей поиска Graylog");
    const beforeSearch = current.pathname.slice(0, searchIndex);
    const streamRouteIndex = beforeSearch.toLowerCase().lastIndexOf("/streams/");
    const basePath = streamRouteIndex >= 0 ? beforeSearch.slice(0, streamRouteIndex) : beforeSearch;
    const endpoint = new URL(`${basePath}/api/views/search/sync?timeout=60000`, current.origin).toString();
    const searchId = crypto.randomUUID(), queryId = crypto.randomUUID();
    const searchTypes = groups.map((field) => ({
      id: crypto.randomUUID(), type: "pivot", name: `safe-search-${field}`,
      row_groups: [{ type: "time", field: "timestamp", interval: { type: "timeunit", timeunit: "1h" } }],
      column_groups: [{ type: "values", field, limit }],
      series: [{ type: "count", id: "count()", field: null }], rollup: false
    }));
    const headers = { Accept: "application/json", "Content-Type": "application/json", "X-Requested-By": "graylog-safe-search" };
    const storedSession = globalThis.localStorage?.getItem("sessionId") || "";
    let sessionId = storedSession;
    try { sessionId = JSON.parse(storedSession); } catch {}
    if (typeof sessionId === "string" && sessionId) headers.Authorization = `Basic ${btoa(`${sessionId}:session`)}`;
    const response = await fetch(endpoint, {
      method: "POST", credentials: "include", cache: "no-store",
      headers,
      body: JSON.stringify({ id: searchId, parameters: [], queries: [{
        id: queryId,
        query: { type: "elasticsearch", query_string: queryString },
        timerange: { type: "absolute", from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString() },
        filter: { type: "or", filters: streamIds.map((id) => ({ type: "stream", id })) },
        search_types: searchTypes
      }] })
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`Graylog вернул не JSON: HTTP ${response.status}`); }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message || data.type || "ошибка Graylog"}`);
    const resultSearchTypes = data.results?.[queryId]?.search_types || {};
    const fieldPivots = searchTypes.map((definition, index) => ({ field: groups[index], pivot: resultSearchTypes[definition.id] })).filter((item) => item.pivot);
    if (fieldPivots.length !== searchTypes.length) {
      const details = data.errors?.map((item) => item.description || item.message).filter(Boolean).join("; ");
      throw new Error(`Graylog вернул не все выбранные поля${details ? `: ${details}` : ""}`);
    }
    return { fieldPivots, total: Math.max(0, ...fieldPivots.map((item) => Number(item.pivot.total) || 0)) };
  } catch (error) { return { error: error?.message || String(error) }; }
}

const fetchTraceDiagramInGraylog = (...args) => globalThis.GraylogTraceFetch.fetchTraceDiagramInGraylog(...args);
function searchNumber(value) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value); }

function safeSearchBar(count, maximum) {
  const width = Math.max(1, Math.min(210, count / Math.max(1, maximum) * 210));
  return `<svg class="safe-search-bar" viewBox="0 0 220 18" role="img" aria-label="${escapeHtml(searchNumber(count))}"><rect x="4" y="4" width="${width.toFixed(1)}" height="10" rx="3"><title>${escapeHtml(searchNumber(count))}</title></rect></svg>`;
}

function safeSearchShare(count) {
  return safeSearchTotal > 0 ? Math.min(100, Math.max(0, Number(count) / safeSearchTotal * 100)) : 0;
}

function safeSearchDetailsMarkup(groups) {
  const cards = groups.map((field) => {
    const rows = safeSearchRows.filter((row) => row.field === field);
    const covered = rows.reduce((sum, row) => sum + row.count, 0);
    const coverage = safeSearchTotal > 0 ? Math.min(100, covered / safeSearchTotal * 100) : 0;
    const values = rows.slice(0, 5).map((row) => `<div class="safe-search-top-value"><code title="${escapeHtml(row.value)}">${escapeHtml(row.value)}</code><span>${searchNumber(row.count)} · ${safeSearchShare(row.count).toFixed(1)}%</span></div>`).join("");
    return `<article class="safe-search-field-card"><h3>${escapeHtml(field)} <span>· ${searchNumber(rows.length)} знач. · охват ${coverage.toFixed(1)}%</span></h3><div class="safe-search-top-values">${values || '<span class="muted">Значений нет</span>'}</div></article>`;
  }).join("");
  const context = safeSearchContext;
  const period = context ? `${new Date(context.startMs).toLocaleString("ru-RU")} — ${new Date(context.endMs).toLocaleString("ru-RU")}` : "—";
  const streamPreview = context?.streamIds?.length ? `${context.streamIds.slice(0, 2).join(", ")}${context.streamIds.length > 2 ? ` +${context.streamIds.length - 2}` : ""}` : "—";
  const explanation = context?.localSummary
    ? `Сводка по ${searchNumber(context.returned)} загруженным сообщениям${context.truncated ? ` из ${searchNumber(safeSearchTotal)}. Трейс получен не полностью; значения относятся только к загруженной части` : ""}. Поля считаются отдельно; строки разных полей не образуют комбинацию.`
    : "Поля считаются независимо; строки разных полей не образуют комбинацию.";
  return `${cards}<p class="safe-search-explanation">${explanation} Период: ${escapeHtml(period)} · streams: ${escapeHtml(streamPreview)} · показано до ${escapeHtml(context?.limit ?? "—")} значений на поле.</p>`;
}

function renderSafeSearch() {
  const groups = safeSearchContext?.groups || [searchUi.primary.value, searchUi.secondary.value, searchUi.tertiary.value].filter(Boolean);
  const bars = searchUi.mode.value === "bars";
  searchUi.head.innerHTML = safeSearchIndependent
    ? `<th>Поле</th><th>Значение</th><th>Событий</th><th>Доля событий</th>${bars ? "<th>Визуально</th>" : ""}`
    : groups.map((field) => `<th>${escapeHtml(field)}</th>`).join("") + "<th>Количество</th>" + (bars ? "<th>Доля от максимума</th>" : "");
  const maximum = safeSearchIndependent ? Math.max(1, safeSearchTotal) : Math.max(1, ...safeSearchRows.map((row) => row.count));
  searchUi.rows.innerHTML = safeSearchRows.length ? safeSearchRows.map((row) => {
    const cells = safeSearchIndependent
      ? `<td>${escapeHtml(row.field)}</td><td class="signature">${escapeHtml(row.value)}</td>`
      : row.groups.map((value) => `<td class="signature">${escapeHtml(value)}</td>`).join("");
    const share = safeSearchIndependent ? `<td>${safeSearchShare(row.count).toFixed(1)}%</td>` : "";
    return `<tr>${cells}<td>${searchNumber(row.count)}</td>${share}${bars ? `<td>${safeSearchBar(row.count, maximum)}</td>` : ""}</tr>`;
  }).join("") : `<tr><td class="empty" colspan="${(safeSearchIndependent ? 4 : groups.length + 1) + (bars ? 1 : 0)}">Совпадений нет.</td></tr>`;
  searchUi.summary.innerHTML = `<div class="card groups"><span>Всего событий</span><strong>${searchNumber(safeSearchTotal)}</strong></div><div class="card"><span>Выбрано полей</span><strong>${searchNumber(groups.length)}</strong></div><div class="card"><span>Показано значений</span><strong>${searchNumber(safeSearchRows.length)}</strong></div><div class="card"><span>Источник</span><strong>${safeSearchFromCache ? "Память" : "Graylog"}</strong></div>`;
  searchUi.details.innerHTML = safeSearchIndependent ? safeSearchDetailsMarkup(groups) : "";
  const streamCount = safeSearchStreamOverride?.length || 1;
  searchUi.meta.textContent = `${groups.join(" + ")} · ${safeSearchIndependent ? "поля отдельно" : "одно поле"} · streams: ${streamCount}${safeSearchFromCache ? " · из памяти" : ""}`;
  searchUi.results.hidden = false;
}

function traceTimelineDuration(value) {
  const duration = Math.max(0, Number(value) || 0);
  if (duration < 1000) return `${Math.round(duration)} мс`;
  if (duration < 60000) return `${(duration / 1000).toFixed(duration < 10000 ? 2 : 1)} с`;
  return `${Math.floor(duration / 60000)} мин ${Math.round(duration % 60000 / 1000)} с`;
}

function traceTimelineBounds(node) {
  const values = [
    ...(node.requestTimes || []), ...(node.responseTimes || []),
    ...(node.openApiRequestTimes || []), ...(node.openApiResponseTimes || []),
    ...(node.gorodClientRequestTimes || []), ...(node.gorodClientResponseTimes || []),
    ...(node.kafkaProduceTimes || []), ...(node.kafkaConsumeTimes || []), ...(node.kafkaBrokerTimes || []),
    ...(node.xmlProcedureRequestTimes || []), ...(node.xmlProcedureResponseTimes || []), ...(node.cacheAccessTimes || [])
  ].filter((value) => value !== null && value !== undefined).map(Number).filter(Number.isFinite);
  const explicitStartValue = node.requestAt ?? node.openApiRequestAt ?? node.gorodClientRequestAt ?? node.partnerBackendRequestAt ?? node.kafkaProduceAt ?? node.kafkaConsumeAt ?? node.kafkaBrokerAt ?? node.xmlProcedureRequestAt ?? node.xmlProcedureResponseAt ?? node.cacheAccessAt;
  const responseAtValue = node.responseAt ?? node.openApiResponseAt ?? node.gorodClientResponseAt ?? node.partnerBackendResponseAt ?? node.xmlProcedureResponseAt;
  const durationValue = node.responseDuration;
  const explicitStart = explicitStartValue === null || explicitStartValue === undefined ? NaN : Number(explicitStartValue);
  const responseAt = responseAtValue === null || responseAtValue === undefined ? NaN : Number(responseAtValue);
  const duration = durationValue === null || durationValue === undefined ? NaN : Number(durationValue);
  let start = Number.isFinite(explicitStart) ? explicitStart : values.length ? Math.min(...values) : null;
  if (start === null && Number.isFinite(responseAt) && Number.isFinite(duration) && duration >= 0) start = responseAt - duration;
  if (start === null && Number.isFinite(responseAt)) start = responseAt;
  if (start === null) return null;
  let end = values.length ? Math.max(start, ...values) : start;
  if (Number.isFinite(responseAt)) end = Math.max(end, responseAt);
  if (Number.isFinite(duration) && duration >= 0) end = Math.max(end, start + duration);
  return { start, end: Math.max(start + 1, end), duration: Math.max(0, end - start) };
}

function traceTimelineNodes(nodes) {
  const source = Array.isArray(nodes) ? nodes : [];
  const children = new Map();
  source.forEach((node, index) => {
    const parent = Number.isInteger(node.parentIndex) && node.parentIndex >= 0 && node.parentIndex < source.length ? node.parentIndex : null;
    const list = children.get(parent) || [];
    list.push(index);
    children.set(parent, list);
  });
  const ordered = [];
  const visited = new Set();
  const append = (index) => {
    if (visited.has(index)) return;
    visited.add(index);
    ordered.push({ node: source[index], index });
    for (const child of children.get(index) || []) append(child);
  };
  for (const root of children.get(null) || []) append(root);
  source.forEach((_node, index) => append(index));
  return ordered;
}

function traceTimelineRequestTargetLabels(node) {
  return (Array.isArray(node?.requestTargets) ? node.requestTargets : []).flatMap((target) => {
    const method = String(target?.method || "HTTP").trim().toUpperCase();
    const url = String(target?.url || "").trim();
    if (!url) return [];
    const count = Math.max(0, Number(target?.count) || 0);
    return [`${method} ${url}${count > 1 ? ` ×${count}` : ""}`];
  });
}

function isKafkaOnlyTraceNode(node) {
  return Number(node.kafkaProduceCount) + Number(node.kafkaConsumeCount) + Number(node.kafkaBrokerCount) > 0
    && Number(node.requestCount) === 0 && Number(node.responseCount) === 0
    && Number(node.openApiRequestCount) === 0 && Number(node.openApiResponseCount) === 0
    && Number(node.gorodClientRequestCount) === 0 && Number(node.gorodClientResponseCount) === 0;
}

function isIncompleteTraceNode(node) {
  if (isKafkaOnlyTraceNode(node)) return false;
  const procedureEvents=Number(node.xmlProcedureRequestCount)+Number(node.xmlProcedureResponseCount);
  const httpEvents=Number(node.requestCount)+Number(node.responseCount)+Number(node.openApiRequestCount)+Number(node.openApiResponseCount)+Number(node.gorodClientRequestCount)+Number(node.gorodClientResponseCount)+Number(node.partnerBackendRequestCount)+Number(node.partnerBackendResponseCount);
  if(procedureEvents>0&&httpEvents===0)return Number(node.xmlProcedureRequestCount)!==Number(node.xmlProcedureResponseCount);
  const requests = Number(node.requestCount) + Number(node.openApiRequestCount) + Number(node.gorodClientRequestCount) + Number(node.partnerBackendRequestCount);
  const responses = Number(node.responseCount) + Number(node.openApiResponseCount) + Number(node.gorodClientResponseCount) + Number(node.partnerBackendResponseCount);
  // A node whose only activity is a cache access has no request/response
  // pair to complete. TraceObservability.completed() and TraceReview's
  // side-effect-only handling both already treat a cache-only node as
  // complete; this must agree instead of flagging it incomplete because it
  // has zero requests and zero responses.
  if (httpEvents === 0 && procedureEvents === 0 && requests === 0 && responses === 0 && Number(node.cacheAccessCount) > 0) return false;
  return requests !== responses || requests === 0 || responses === 0;
}

function traceTimelineMatches(node, term, mode) {
  if (mode === "failed" && Number(node.responseLevel3Count) === 0) return false;
  if (mode === "incomplete" && !isIncompleteTraceNode(node)) return false;
  if (mode === "repeated" && !(node.repeatedHttpTargets || []).length) return false;
  if (mode === "kafka" && Number(node.kafkaProduceCount) + Number(node.kafkaConsumeCount) + Number(node.kafkaBrokerCount) === 0) return false;
  if (mode === "cache" && Number(node.cacheAccessCount) === 0) return false;
  if (!term) return true;
  const haystack = [
    node.service, node.spanId,
    ...(node.requestTargets || []).flatMap((item) => [item.method, item.url]),
    ...(node.kafkaProduces || []).map((item) => item.topic),
    ...(node.kafkaConsumes || []).map((item) => item.topic),
    ...(node.kafkaBrokers || []).map((item) => item.topic),
    ...(node.xmlProcedureRequests || []).map((item) => item.procedure),
    ...(node.xmlProcedureResponseSamples || []).map((item) => item.procedure),
    ...(node.cacheAccesses || []).map((item) => item.safeKey),
    Number(node.cacheAccessCount) > 0 ? "local cache redis" : ""
  ].join(" ").toLocaleLowerCase("ru");
  return haystack.includes(term);
}

function renderTraceTimelineQuality(diagram) {
  searchUi.timelineQuality.replaceChildren();
  if (!diagram) return;
  const nodes = diagram.nodes || [];
  const incomplete = nodes.filter(isIncompleteTraceNode).length;
  const duplicates = nodes.filter((node) => Number(node.requestCount) > 1 || Number(node.responseCount) > 1).length;
  const inferred = nodes.filter((node) => node.parentIndex !== null && node.parentInference && node.parentInference !== "parent-span").length;
  const recovered = nodes.filter((node) => node.spanRecovery).length;
  const badges = [
    [diagram.truncated ? "error" : "", diagram.truncated ? "Выборка обрезана: статус поздних RESPONSE может быть неполным" : "Выборка помещается в лимит 200"],
    [incomplete ? "warn" : "", `Неполные пары: ${incomplete}`],
    [duplicates ? "warn" : "", `Дубли REQUEST/RESPONSE: ${duplicates}`],
    [inferred ? "warn" : "", `Связи по времени: ${inferred}`],
    [recovered ? "warn" : "", `Восстановлены пары: ${recovered}`]
  ];
  for (const [kind, text] of badges) {
    const badge = document.createElement("span");
    badge.className = `trace-quality-badge${kind ? ` ${kind}` : ""}`;
    badge.textContent = text;
    searchUi.timelineQuality.append(badge);
  }
}

function showTraceTimelineDetail(node, index, row) {
  searchUi.timelineChart.querySelectorAll(".trace-timeline-row.selected").forEach((item) => item.classList.remove("selected"));
  row?.classList.add("selected");
  const lines = [
    `#${index + 1} · ${node.service || "сервис не определён"} · spanId ${node.spanId || "—"}`,
    `REQUEST: ${Number(node.requestCount) || 0} · RESPONSE: ${Number(node.responseCount) || 0}${Number(node.responseLevel3Count) ? ` · level:3: ${node.responseLevel3Count}` : ""}`,
    `Связь: ${node.parentIndex === null ? "корневой span" : node.parentInference === "parent-span" ? "явный parentSpanId" : node.parentInference ? `восстановлена по времени (${node.parentInference})` : "родитель определён"}`
  ];
  if (node.spanRecovery) lines.push(`Пара REQUEST/RESPONSE восстановлена: ${node.spanRecovery.reason || "совпали сервис, время и длительность"}. Это предположение по метаданным.`);
  if (node.recoveredSpanIds?.length) lines.push(`Объединённые spanId: ${node.recoveredSpanIds.join(", ")}`);
  for (const item of traceTimelineDiagram?.errorAnalysis?.groups || []) {
    if (item.service === node.service && [node.spanId, ...(node.recoveredSpanIds || [])].includes(item.spanId)) {
      lines.push(`Ошибка ×${item.count}: ${TraceErrors.describe(item)}`);
    }
  }
  for (const target of node.requestTargets || []) lines.push(`HTTP ${target.method || ""} ${target.url || ""}${Number(target.count) > 1 ? ` ×${target.count}` : ""}`.trim());
  const labelLines = [...new Set((node.requestLabels || []).map((item) => [item.action ? `Action: ${item.action}` : "", item.requestType ? `Request type: ${item.requestType}` : ""].filter(Boolean).join(" · ")).filter(Boolean))];
  lines.push(...labelLines);
  for (const item of node.kafkaProduces || []) lines.push(`Kafka produce · topic ${item.topic || "—"}`);
  for (const item of node.kafkaConsumes || []) lines.push(`Kafka consume · topic ${item.topic || "—"}`);
  if (Number(node.kafkaBrokerCount) > 0) lines.push(`Kafka infra · сообщений: ${Number(node.kafkaBrokerCount)} · topic: ${[...new Set((node.kafkaBrokers || []).map((item) => item.topic).filter(Boolean))].join(", ") || "—"}`);
  for (const item of node.xmlProcedureRequests || []) lines.push(`Процедура: ${item.procedure || "—"}`);
  if (Number(node.cacheAccessCount) > 0) lines.push(`Двухуровневый кеш Local Cache → Redis · событий: ${Number(node.cacheAccessCount)}`);
  for (const item of node.cacheAccesses || []) lines.push(`${item.operation === "put" ? "PUT · запись в кеш" : "GET · чтение кеша"} · сервис ${node.service} · ключ: ${item.safeKey || "не указан"} · привязка по service-name + spanId`);
  for (const item of node.outgoingFailures || []) lines.push(`Исходящий ${item.method || "HTTP"} ${item.url || ""} · HTTP-ответ не получен · WebClientRequestException`);
  searchUi.timelineDetail.replaceChildren();
  lines.forEach((text, lineIndex) => {
    const element = document.createElement(lineIndex === 0 ? "strong" : "div");
    element.textContent = text;
    searchUi.timelineDetail.append(element);
  });
  if (typeof globalThis.openPercentilesForUri === "function") {
    const uris = [...new Set((node.requestTargets || []).map((target) => target.url).filter(Boolean))];
    for (const uri of uris) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = `Процентили URI: ${uri}`;
      button.title = "Открыть локальный разбор URI в процентилях; новый запрос автоматически не выполняется. URI может быть замаскирован.";
      button.addEventListener("click", () => globalThis.openPercentilesForUri(uri, { masked:true }));
      searchUi.timelineDetail.append(button);
    }
  }
  searchUi.timelineDetail.hidden = false;
}

function traceTimingLabel(timings, fromCache = false) {
  if (fromCache) return "из памяти · без запроса к Graylog";
  if (!timings) return "";
  const request = Number(timings.requestMs), parse = Number(timings.parseMs), processing = Number(timings.processingMs);
  if (![request, parse, processing].every((value) => Number.isFinite(value) && value >= 0)) return "";
  return `Ожидание ответа ${Math.round(request)} мс · обработка ${Math.round(parse + processing)} мс`;
}

function renderTraceErrorAnalysis(diagram) {
  let panel = document.querySelector("#trace-error-analysis");
  if (!panel) {
    panel = document.createElement("section"); panel.id = "trace-error-analysis"; panel.className = "trace-error-analysis";
    searchUi.timelineChart.before(panel);
  }
  panel.replaceChildren(); panel.hidden = !diagram;
  if (!diagram) { globalThis.Clippy?.setTraceReview?.(null); return; }
  TraceErrorView.render(panel, diagram.errorAnalysis);
  const reviewButton = document.createElement("button"); reviewButton.type="button"; reviewButton.id="show-search-trace-review";
  TraceErrorView.configureButton(reviewButton, diagram);
  reviewButton.addEventListener("click", () => TraceErrorView.showTraceDialog(diagram));
  panel.prepend(reviewButton);
}

function refreshTimelineLatency() {
  if (!globalThis.TraceLatency) return;
  const reviewButton = document.querySelector("#show-search-trace-review");
  if (reviewButton && traceTimelineDiagram) TraceErrorView.configureButton(reviewButton, traceTimelineDiagram);
  for (const badge of searchUi.timelineChart.querySelectorAll("[data-trace-latency]")) {
    badge.hidden = !TraceLatency.isSlow(badge.dataset.traceLatency);
    badge.title = `${badge.dataset.traceLatency} мс > ${TraceLatency.getThreshold()} мс. Длительность оценивается отдельно от ошибки ответа.`;
  }
}

function initializeTimelineLatencyControl() {
  if (!globalThis.TraceLatency || document.querySelector("#timeline-latency-threshold")) return;
  const label = document.createElement("label");
  const caption = document.createElement("span"); caption.textContent = "Медленно, если больше (мс)";
  const input = document.createElement("input"); input.id="timeline-latency-threshold";
  input.type="number"; input.min="1"; input.max="86400000"; input.step="1";
  input.value=String(TraceLatency.getThreshold());
  input.title="Порог текущей вкладки. Обновляет только пометки; без запросов к Graylog.";
  input.addEventListener("input", () => input.setCustomValidity(""));
  input.addEventListener("change", () => {
    if (!TraceLatency.setThreshold(input.value)) { input.setCustomValidity("Укажите целое число от 1 до 86400000 мс."); input.reportValidity(); return; }
    input.setCustomValidity(""); refreshTimelineLatency();
  });
  label.append(caption, input);
  document.querySelector(".trace-timeline-tools")?.append(label);
}

function appendTimelineLatency(label, node) {
  if (!globalThis.TraceLatency) return;
  const durationMs = TraceLatency.duration(node);
  const measurements = durationMs === null ? [] : [{label:"span", durationMs}];
  measurements.push(...TraceLatency.externalDurations(node));
  for (const measurement of measurements) {
    const badge = document.createElement("span"); badge.className="trace-timeline-latency";
    badge.dataset.traceLatency=String(measurement.durationMs);
    badge.textContent=`Медленное выполнение · ${measurement.label} · ${traceTimelineDuration(measurement.durationMs)}`;
    label.append(badge);
  }
}

function renderTraceTimeline(diagram, fromCache = false) {
  initializeTimelineLatencyControl();
  traceTimelineDiagram = diagram || null;
  traceTimelineFromCache = Boolean(fromCache);
  renderTraceErrorAnalysis(diagram);
  const ordered = traceTimelineNodes(diagram?.nodes);
  searchUi.timeline.hidden = !diagram;
  searchUi.timelineChart.replaceChildren();
  searchUi.timelineMeta.textContent = "";
  searchUi.timelineDetail.hidden = true;
  searchUi.timelineDetail.replaceChildren();
  renderTraceTimelineQuality(diagram);
  if (!diagram) return;
  if (!ordered.length) {
    const empty = document.createElement("div");
    empty.className = "trace-timeline-empty";
    empty.textContent = "Для временной диаграммы не найдены пары service-name + spanId.";
    searchUi.timelineChart.append(empty);
    return;
  }
  const allMeasured = ordered.map((item) => ({ ...item, bounds: traceTimelineBounds(item.node) })).filter((item) => item.bounds);
  const term = String(searchUi.timelineFilter.value || "").trim().toLocaleLowerCase("ru");
  const mode = searchUi.timelineMode.value || "all";
  const measured = allMeasured.filter((item) => traceTimelineMatches(item.node, term, mode));
  if (!allMeasured.length) {
    const empty = document.createElement("div");
    empty.className = "trace-timeline-empty";
    empty.textContent = "В сообщениях trace не найдены временные метки.";
    searchUi.timelineChart.append(empty);
    return;
  }
  if (!measured.length) {
    const empty = document.createElement("div");
    empty.className = "trace-timeline-empty";
    empty.textContent = "В уже загруженном trace нет span, подходящих под локальный фильтр.";
    searchUi.timelineChart.append(empty);
    searchUi.timelineMeta.textContent = `0 из ${allMeasured.length} span-блоков · без обращения к Graylog`;
    return;
  }
  const rangeStart = Math.min(...allMeasured.map((item) => item.bounds.start));
  const rangeEnd = Math.max(...allMeasured.map((item) => item.bounds.end));
  const range = Math.max(1, rangeEnd - rangeStart);
  const inner = document.createElement("div");
  inner.className = "trace-timeline-inner";
  const axis = document.createElement("div");
  axis.className = "trace-timeline-axis";
  const axisLabel = document.createElement("div");
  axisLabel.className = "trace-timeline-axis-label";
  axisLabel.textContent = "Сервис / span / HTTP method + URI";
  const scale = document.createElement("div");
  scale.className = "trace-timeline-scale";
  [0, 25, 50, 75, 100].forEach((percent) => {
    const label = document.createElement("span");
    label.style.left = `${percent}%`;
    label.textContent = traceTimelineDuration(range * percent / 100);
    scale.append(label);
  });
  axis.append(axisLabel, scale);
  inner.append(axis);
  for (const { node, index, bounds } of measured) {
    const row = document.createElement("div");
    row.className = "trace-timeline-row";
    const label = document.createElement("div");
    label.className = "trace-timeline-label";
    label.style.paddingLeft = `${10 + Math.min(84, Math.max(0, Number(node.depth) || 0) * 14)}px`;
    const order = document.createElement("span");
    order.className = "trace-timeline-order";
    order.textContent = String(index + 1);
    const service = document.createElement("strong");
    service.textContent = String(node.service || "сервис не определён");
    const span = document.createElement("code");
    span.className = "trace-timeline-span";
    span.textContent = String(node.spanId || "spanId не определён");
    const targets = document.createElement("div");
    targets.className = "trace-timeline-targets";
    const targetLabels = traceTimelineRequestTargetLabels(node);
    if (targetLabels.length) {
      for (const targetLabel of targetLabels) {
        const target = document.createElement("code");
        target.textContent = targetLabel;
        target.title = targetLabel;
        targets.append(target);
      }
    } else {
      targets.classList.add("empty");
      targets.textContent = "HTTP method/URI нет в REQUEST";
    }
    label.append(order, service, span, targets);
    appendTimelineLatency(label, node);
    const track = document.createElement("div");
    track.className = "trace-timeline-track";
    const bar = document.createElement("div");
    const kafkaOnly = isKafkaOnlyTraceNode(node);
    const failed = Number(node.responseLevel3Count) > 0;
    const repeated = Array.isArray(node.repeatedHttpTargets) && node.repeatedHttpTargets.length > 0;
    bar.className = `trace-timeline-bar${node.parentIndex === null ? " root" : ""}${kafkaOnly ? " kafka" : ""}${repeated ? " repeated" : ""}${failed ? " failed" : ""}`;
    bar.style.left = `${Math.max(0, (bounds.start - rangeStart) / range * 100)}%`;
    bar.style.width = `${Math.max(0, Math.min(100, (bounds.end - bounds.start) / range * 100))}%`;
    const durationLabel = document.createElement("span");
    const executionDuration = globalThis.TraceLatency ? TraceLatency.duration(node) : null;
    const executionLabel = executionDuration === null ? "Длительность неизвестна" : traceTimelineDuration(executionDuration);
    durationLabel.textContent = executionLabel;
    bar.title = `${node.service || "сервис"} · старт +${traceTimelineDuration(bounds.start - rangeStart)} · ${executionLabel}${failed ? ` · RESPONSE level:3 ×${node.responseLevel3Count}` : ""}`;
    bar.append(durationLabel);
    track.append(bar);
    row.append(label, track);
    row.tabIndex = 0;
    row.title = "Открыть безопасные детали span";
    row.addEventListener("click", () => showTraceTimelineDetail(node, index, row));
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showTraceTimelineDetail(node, index, row); } });
    inner.append(row);
  }
  searchUi.timelineChart.append(inner);
  refreshTimelineLatency();
  const failures = measured.reduce((sum, item) => sum + Math.max(0, Number(item.node.responseLevel3Count) || 0), 0);
  const timingLabel = traceTimingLabel(diagram?.timings, fromCache);
  searchUi.timelineMeta.textContent = `${measured.length}${measured.length !== allMeasured.length ? ` из ${allMeasured.length}` : ""} span-блоков · ${traceTimelineDuration(range)}${failures ? ` · ошибок level:3: ${failures}` : ""}${diagram?.truncated ? " · выборка ограничена" : ""}${timingLabel ? ` · ${timingLabel}` : ""}`;
  searchUi.timelineMeta.title = "Ожидание ответа включает сеть, выполнение в Graylog и получение тела. Обработка — разбор JSON и группировка событий; отрисовка браузера сюда не входит.";
}

function traceDiagramTime(value) {
  if (value === null) return "время не определено";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 }).format(new Date(value)) + " МСК";
}

async function openTraceDiagramTab(diagram, query, fromCache, serviceCallLimit, existing = null) {
  let current=existing;
  if(current)try{await chrome.tabs.get(current.tabId);}catch{current=null;}
  const knownOwnerTabId = typeof checkerPageTabId !== "undefined" ? checkerPageTabId : null;
  const ownerTabId=Number.isInteger(knownOwnerTabId)?knownOwnerTabId:(await chrome.tabs.getCurrent())?.id;
  if(!Number.isInteger(ownerTabId))throw new Error("Не удалось безопасно привязать вкладку графа.");
  const token = current?.token || crypto.randomUUID();
  const reply = await chrome.runtime.sendMessage({ type: "store-trace-diagram", token, diagram: { ...diagram, query, fromCache, serviceCallLimit, latencyThresholdMs:globalThis.TraceLatency?.getThreshold() ?? 3000 } });
  if (!reply?.stored) throw new Error("Не удалось передать дерево в отдельную вкладку");
  if (current) return current;
  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL(`extension/graylog/trace.html?token=${encodeURIComponent(token)}`),
    active: true, openerTabId:ownerTabId
  });
  return { token, tabId: tab.id };
}

function diagramFromTraceResult(result, configuredStreamIds = []) {
  const diagram = TraceAnalysis.buildRequestResponseTrace(result?.requestPivot, result?.responsePivot,
    result?.openApiPivot, result?.openApiResponsePivot, result?.gorodClientPivot, result?.gorodClientResponsePivot,
    result?.kafkaProducePivot, result?.cacheAccessPivot, result?.outgoingFailurePivot, result?.kafkaConsumePivot, result?.kafkaBrokerPivot,
    result?.xmlProcedureRequestPivot, result?.xmlProcedureResponsePivot, result?.partnerBackendPivot, result?.partnerBackendResponsePivot);
  Object.assign(diagram, { searchMode: result?.searchMode, timings: result?.timings,
    truncated: Boolean(result?.truncated), errorAnalysis: result?.errorAnalysis,
    percentileContext: result?.percentileContext, loadingMore: Boolean(result?.nextPageToken),
    loadedMessages: result?.returned, totalMessages: result?.total,
    configuredStreamIds: [...new Set((Array.isArray(configuredStreamIds) ? configuredStreamIds : [])
      .map(value => String(value || "").toLowerCase()).filter(value => /^[a-f0-9]{24}$/.test(value)))].slice(0, 32) });
  return diagram;
}

async function fetchTraceInPages(parameters, businessRules, current, onProgress = () => {}, beforePage = async () => {}, operation = null, deadline = createTraceSearchDeadline()) {
  const tabId = activeTab.id;
  const sourceTab=async()=>{try{return await deadline.wait(() => chrome.tabs.get(tabId), "проверка вкладки");}catch(error){if(error?.code==="TRACE_DEADLINE")throw error;throw new Error("Загрузка остановлена: вкладка Graylog закрыта или недоступна.");}};
  const sourceUrl = (await sourceTab()).url;
  await deadline.wait(() => chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["lib/graylog/error-analysis.js", "lib/graylog/business-error-rules.js", "lib/graylog/trace-error-catalog.js", "lib/graylog/java-error-reference.js", "lib/graylog/integration-error-reference.js", "lib/graylog/postgres-error-reference.js", "lib/graylog/kafka-error-reference.js", "lib/graylog/error-reference.js", "lib/graylog/exception-chain.js", "lib/graylog/trace-heuristic-resolver.js", "lib/graylog/trace-error-timeline.js", "lib/graylog/trace-errors.js", "lib/graylog/trace-client-checkpoint.js", "lib/graylog/trace-application-groups.js","lib/graylog/graylog-trace-fetch.js"] }), "подключение обработчика");
  // Standalone Search must not await a passive DOM snapshot merely to choose an HTTP limit.
  const pageSize = 50;
  if (operation) await activateExplicitTraceOperation(operation, deadline);
  let result, pageToken = null, page = 0;
  const timings = { requestMs: 0, parseMs: 0, processingMs: 0 };
  try {
  do {
    if (page) await new Promise(resolve => setTimeout(resolve, 200));
    if (!current() || (await sourceTab()).url !== sourceUrl) throw new Error("Загрузка остановлена: запрос или страница Graylog изменились.");
    await deadline.wait(beforePage, "подготовка графа");
    const offset = Number(result?.returned) || 0;
    const audit = QueryAudit.begin({ area: `Поиск · порция ${page + 1}`, query: auditSearchQuery(parameters.query),
      streams: parameters.streamIds, startMs: parameters.startMs, endMs: parameters.endMs,
      aggregation: `messages limit ${pageSize}, offset ${offset}; последовательно, пауза 200 мс; общий лимит ${TRACE_DIAGRAM_NODE_LIMIT}; сводка локально; без дополнительного pivot`,
      call: { source: "extension-search", method: "POST", path: "/api/views/search/sync", limit: Math.min(pageSize, TRACE_DIAGRAM_NODE_LIMIT-offset), offset } });
    try {
      const execution = await deadline.wait(() => chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: fetchTraceDiagramInGraylog,
        args: [parameters.query, parameters.startMs, parameters.endMs, parameters.streamIds, TRACE_DIAGRAM_NODE_LIMIT, [], 25, businessRules,
          { ...(pageToken ? { pageToken } : { pagination: true, pageSize }), skipPercentileFallback: true, deadlineAt: deadline.expiresAt, ...(operation?.id ? { runId: operation.id } : {}) }] }), "ответ Graylog");
      if (execution?.[0]?.error) throw new Error(execution[0].error.message || "Не удалось получить порцию сообщений.");
      result = execution?.[0]?.result;
      if (!result || result.error) throw new Error(result?.error || "Graylog не вернул порцию сообщений.");
      for (const key of Object.keys(timings)) timings[key] += Math.max(0, Number(result.timings?.[key]) || 0);
      result.timings = { ...timings };
      audit.finish("success", Math.max(0, Number(result.returned) - offset));
    } catch (error) { audit.finish(operation?.cancelled && !operation.timedOut ? "cancelled" : "error"); throw error; }
    pageToken = result.nextPageToken || null;
    if (!current() || (await sourceTab()).url !== sourceUrl) throw new Error("Загрузка остановлена: выбран другой trace или период.");
    page++;
    await deadline.wait(() => onProgress(result), "отображение результата");
  } while (pageToken && page < 200 && Number(result.returned) < TRACE_DIAGRAM_NODE_LIMIT);
  return result;
  } finally {
    if (pageToken) try { await settleTraceCleanup(() => chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: token => globalThis.GraylogTraceFetch?.cancelPageTraceInGraylog?.(token) === true, args: [pageToken] })); } catch {}
  }
}

async function runTraceDiagram() {
  if (traceDiagramLoading || safeSearchLoading || globalThis.GraylogHttpActions?.busy?.("search") || globalThis.TracePercentiles?.isLoading?.() || !isExactTraceQuery(searchUi.query.value)) return;
  const requestedSignature = currentSearchFormSignature();
  const sourceTabId = activeTab?.id;
  let graphWindow = null;
  let lastPartial = null;
  let operation = null;
  const deadline = createTraceSearchDeadline(() => { if(operation){operation.timedOut=true;void cancelExplicitTraceTransport(operation);} });
  const requestedQuery = `traceId:"${traceIdValue(searchUi.query.value)}"`;
  const requestedServiceLimit = Number(searchUi.serviceCallLimit.value);
  const current = () => requestedSignature === currentSearchFormSignature() && sourceTabId === activeTab?.id && operation?.cancelled !== true;
  const finishCompanion = globalThis.Clippy?.begin?.("loading");
  let companionOutcome = "error";
  searchEmptyState.hidden = true;
  traceDiagramLoading = true;
  searchUi.traceButton.textContent = "Строю график…";
  updateTraceActionState();
  searchUi.traceError.hidden = true;
  searchUi.error.hidden = true;
  try {
    const parameters = safeSearchParameters();
    safeSearchContext = { groups: [...parameters.groups], startMs: parameters.startMs, endMs: parameters.endMs, streamIds: [...parameters.streamIds], limit: parameters.limit };
    if (!isExactTraceQuery(parameters.query)) throw new Error("Блок-схема доступна только для точного запроса traceId:\"…\"");
    let refreshedTab;try{refreshedTab=await deadline.wait(() => chrome.tabs.get(sourceTabId), "проверка вкладки");}catch(error){if(error?.code==="TRACE_DEADLINE")throw error;throw new Error("Вкладка Graylog закрыта или недоступна. Откройте граф заново из актуальной выдачи.");}
    if(!current())return;
    activeTab=refreshedTab;
    const businessRules=globalThis.BusinessErrorRules?.list?.() || [];
    const graphScope = ["configured-streams", parameters.streamIds];
    const cacheKey = JSON.stringify([graylogTabCacheScope(activeTab), graphScope, parameters.query, parameters.startMs, parameters.endMs, businessRules]);
    const cached = traceDiagramCache.get(cacheKey);
    let result;
    let fromCache = false;
    if (cached && Date.now() - cached.savedAt < SAFE_SEARCH_CURRENT_CACHE_MS) {
      result = cached.result;
      fromCache = true;
    } else {
      operation = typeof startExplicitTraceOperation === "function" ? startExplicitTraceOperation(sourceTabId, "full-graph") : null;
      result = await fetchTraceInPages(parameters, businessRules, current, async partial => {
        const diagram = diagramFromTraceResult(partial, parameters.streamIds);
        lastPartial = diagram;
        renderTraceTimeline(diagram);
        if (Number(partial.total) === 0) return;
        graphWindow = await openTraceDiagramTab(diagram, parameters.query, false, parameters.serviceCallLimit, graphWindow);
        searchUi.traceButton.textContent = `Получено ${partial.returned} из ${partial.total}…`;
      }, async () => { if (graphWindow) try { await chrome.tabs.get(graphWindow.tabId); } catch { graphWindow=null; } }, operation, deadline);
      traceDiagramCache.set(cacheKey, { result, savedAt: Date.now() });
      BoundedCache.pruneCache(traceDiagramCache, TRACE_DIAGRAM_CACHE_LIMIT);
    }
    if(!current())return;
    const diagram = TraceAnalysis.buildRequestResponseTrace(
      result?.requestPivot, result?.responsePivot,
      result?.openApiPivot, result?.openApiResponsePivot,
      result?.gorodClientPivot, result?.gorodClientResponsePivot,
      result?.kafkaProducePivot, result?.cacheAccessPivot, result?.outgoingFailurePivot, result?.kafkaConsumePivot, result?.kafkaBrokerPivot,
      result?.xmlProcedureRequestPivot, result?.xmlProcedureResponsePivot, result?.partnerBackendPivot, result?.partnerBackendResponsePivot
    );
    diagram.searchMode = result?.searchMode;
    diagram.timings = result?.timings;
    diagram.truncated = Boolean(result?.truncated);
    diagram.errorAnalysis = result?.errorAnalysis;
    diagram.percentileContext = result?.percentileContext;
    diagram.loadedMessages = result?.returned;
    diagram.totalMessages = result?.total;
    diagram.configuredStreamIds = [...parameters.streamIds];
    globalThis.TracePercentiles?.setTraceContext(result?.percentileContext, result?.percentileContextStatus);
    if (Number(result?.total) === 0 && !result?.truncated) {
      companionOutcome = result?.incomplete ? "warning" : "empty";
      searchEmptyState.hidden = false;
      searchUi.results.hidden = true;
      renderTraceTimeline(null);
      globalThis.LocalAiController?.clearTrace?.();
      return;
    }
    if (!diagram.nodes.length && !diagram.outgoingFailures?.length) {
      const sample = result?.requestPivot?.rows?.[0] || result?.responsePivot?.rows?.[0];
      throw new Error(`Для traceId не найдены пары service-name + spanId. Graylog: ${result?.total || 0}; получено: ${result?.returned || 0}; распознано REQUEST/RESPONSE: ${result?.classified || 0}; REQUEST rows: ${result?.requestPivot?.rows?.length || 0}; RESPONSE rows: ${result?.responsePivot?.rows?.length || 0}; поля первой записи: ${(result?.availableFields || []).join(", ") || "—"}; первая строка: key=${JSON.stringify(sample?.key || [])}, source=${sample?.source || "—"}`);
    }
    globalThis.LocalAiController?.setTraceDiagram?.(diagram);
    if (!current()) return;
    await deadline.wait(() => openTraceDiagramTab(diagram, parameters.query, fromCache, parameters.serviceCallLimit, graphWindow), "открытие графа");
    companionOutcome = result?.truncated || result?.incomplete ? "warning" : "success";
  } catch (error) {
    if (graphWindow && lastPartial) {
      await settleTraceCleanup(() => openTraceDiagramTab({ ...lastPartial, loadingMore: false, loadError: error.message || String(error) },
        requestedQuery, false, requestedServiceLimit, graphWindow));
    }
    if(operation?.cancelled && !operation.timedOut){companionOutcome="warning";return;}
    if(!current() && !operation?.timedOut)return;
    searchUi.error.textContent = error.message || String(error);
    searchUi.error.hidden = false;
  } finally {
    if (typeof finishExplicitTraceOperation === "function") void finishExplicitTraceOperation(operation);
    traceDiagramLoading = false;
    searchUi.traceButton.innerHTML = '<span aria-hidden="true">⑂</span> Построить график';
    updateTraceActionState();
    finishCompanion?.(companionOutcome);
  }
}

async function runSafeSearch() {
  if (safeSearchLoading || traceDiagramLoading || globalThis.GraylogHttpActions?.busy?.("search") || globalThis.TracePercentiles?.isLoading?.()) return;
  const requestedSignature = currentSearchFormSignature();
  const sourceTabId = activeTab?.id;
  let operation = null;
  const deadline = createTraceSearchDeadline(() => { if(operation){operation.timedOut=true;void cancelExplicitTraceTransport(operation);} });
  const current = () => operation?.cancelled !== true && requestedSignature === currentSearchFormSignature() && sourceTabId === activeTab?.id;
  globalThis.Clippy?.setTraceReview?.(null);
  globalThis.LocalAiController?.clearTrace?.();
  const finishCompanion = globalThis.Clippy?.begin?.("search");
  let companionOutcome = "error";
  searchEmptyState.hidden = true;
  globalThis.TracePercentiles?.setTraceContext(null);
  safeSearchLoading = true; searchUi.error.hidden = true; searchUi.run.disabled = true; searchUi.run.textContent = "Ищу…";
  updateTraceActionState();
  try {
    const parameters = safeSearchParameters();
    safeSearchContext = { groups: [...parameters.groups], startMs: parameters.startMs, endMs: parameters.endMs, streamIds: [...parameters.streamIds], limit: parameters.limit };
    searchUi.tracePanel.hidden = true;
    const refreshedTab=await deadline.wait(() => chrome.tabs.get(sourceTabId), "проверка вкладки");
    if(!current())return;
    activeTab=refreshedTab;
    const origin = graylogTabCacheScope(activeTab);
    const exactTrace = isExactTraceQuery(parameters.query);
    const businessRules=globalThis.BusinessErrorRules?.list?.() || [];
    const cacheKey = JSON.stringify([origin, parameters.streamIds, parameters.query, parameters.startMs, parameters.endMs, parameters.groups, parameters.limit, businessRules]);
    const traceCacheKey = JSON.stringify([origin, parameters.streamIds, parameters.query, parameters.startMs, parameters.endMs, businessRules]);
    const cached = exactTrace ? traceDiagramCache.get(traceCacheKey) : safeSearchCache.get(cacheKey);
    let result;
    if (cached && Date.now() - cached.savedAt < SAFE_SEARCH_CURRENT_CACHE_MS) { result = cached.result; safeSearchFromCache = true; }
    else {
      if (exactTrace) {
        operation = startExplicitTraceOperation(sourceTabId, "extension-query");
        result = await fetchTraceInPages(parameters, businessRules, current, partial => {
          renderTraceTimeline(diagramFromTraceResult(partial, parameters.streamIds));
          searchUi.run.textContent = `Получено ${partial.returned} из ${partial.total}…`;
        }, async () => {}, operation, deadline);
      } else {
      const aggregation = `${parameters.groups.join(" × ")} × count(); limit ${parameters.limit}`;
      const audit = QueryAudit.begin({ area: "Поиск", query: auditSearchQuery(parameters.query), streams: parameters.streamIds, startMs: parameters.startMs, endMs: parameters.endMs, aggregation });
      try {
        const execution = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id }, world: "MAIN",
          func: fetchSafeSearchInGraylog,
          args: [parameters.query, parameters.startMs, parameters.endMs, parameters.groups, parameters.limit, parameters.streamIds]
        });
        if (execution[0]?.error) throw new Error(execution[0].error.message || String(execution[0].error));
        result = execution[0]?.result; if (result?.error) throw new Error(result.error);
        audit.finish("success", Array.isArray(result?.fieldPivots) ? result.total : result?.pivot?.total);
      } catch (error) {
        audit.finish("error", null, error?.message || String(error));
        throw error;
      }
      }
      safeSearchCache.set(cacheKey, { result, savedAt: Date.now() }); BoundedCache.pruneCache(safeSearchCache, SAFE_SEARCH_CACHE_LIMIT);
      safeSearchFromCache = false;
    }
    if (!current()) return;
    safeSearchContext.localSummary = result?.fieldSummarySource === "loaded-messages";
    safeSearchContext.returned = Number(result?.returned) || 0;
    safeSearchContext.truncated = Boolean(result?.truncated);
    let diagram = null;
    if (exactTrace) {
      traceDiagramCache.set(traceCacheKey, { result, savedAt: Date.now() });
      BoundedCache.pruneCache(traceDiagramCache, TRACE_DIAGRAM_CACHE_LIMIT);
      diagram = TraceAnalysis.buildRequestResponseTrace(
        result?.requestPivot, result?.responsePivot,
        result?.openApiPivot, result?.openApiResponsePivot,
        result?.gorodClientPivot, result?.gorodClientResponsePivot,
        result?.kafkaProducePivot, result?.cacheAccessPivot, result?.outgoingFailurePivot, result?.kafkaConsumePivot, result?.kafkaBrokerPivot,
        result?.xmlProcedureRequestPivot, result?.xmlProcedureResponsePivot, result?.partnerBackendPivot, result?.partnerBackendResponsePivot
      );
      diagram.searchMode = result?.searchMode;
      diagram.timings = result?.timings;
      diagram.truncated = Boolean(result?.truncated);
      diagram.errorAnalysis = result?.errorAnalysis;
      diagram.percentileContext = result?.percentileContext;
      globalThis.TracePercentiles?.setTraceContext(result?.percentileContext, result?.percentileContextStatus);
      globalThis.LocalAiController?.setTraceDiagram?.(diagram);
    }
    safeSearchIndependent = true;
    safeSearchRows = parameters.groups.flatMap(field => SearchAnalysis.parseIndependentSearchPivots(
      (result?.fieldPivots || []).filter(item => item.field === field)
    ).slice(0, parameters.limit));
    safeSearchTotal = Number(result?.total) || safeSearchRows.reduce((sum, row) => sum + row.count, 0);
    if (safeSearchTotal > 0 && !safeSearchRows.length && !safeSearchContext.localSummary) {
      const samples = (result?.fieldPivots || []).map(({ field, pivot }) => {
        const first = pivot?.rows?.[0];
        const values = Array.isArray(first?.values) ? first.values : first?.values && typeof first.values === "object" ? Object.values(first.values) : [];
        const cell = values[0];
        return `${field}: rows=${pivot?.rows?.length || 0}, rowKey=${JSON.stringify(first?.key || [])}, cells=${values.length}, cellKey=${JSON.stringify(cell?.key || [])}, valueType=${typeof cell?.value}`;
      }).join("; ");
      throw new Error(`Graylog вернул ${searchNumber(safeSearchTotal)} событий, но группы не распознаны. ${samples}`);
    }
    renderSafeSearch();
    renderTraceTimeline(diagram, safeSearchFromCache);
    if (Number(result?.total) === 0 && !result?.truncated) {
      searchEmptyState.hidden = false;
      searchUi.results.hidden = true;
      renderTraceTimeline(null);
    }
    searchUi.rawDetails.open = false;
    safeSearchLoadedSignature = currentSearchFormSignature();
    searchUi.stale.hidden = true;
    companionOutcome = result?.truncated || result?.incomplete ? "warning" : safeSearchTotal === 0 ? "empty" : "success";
  } catch (error) { if(current() || operation?.timedOut){searchUi.error.textContent = error.message || String(error); searchUi.error.hidden = false;} }
  finally { safeSearchLoading = false; searchUi.run.disabled = false; searchUi.run.textContent = "Найти"; updateTraceActionState(); finishCompanion?.(companionOutcome); void finishExplicitTraceOperation(operation); }
}

async function openSafeSearchInGraylog() {
  const parameters = safeSearchParameters();
  activeTab = await chrome.tabs.get(activeTab.id);
  const target = new URL(activeTab.url);
  target.search = ""; target.hash = "";
  target.searchParams.set("q", parameters.query); target.searchParams.set("rangetype", "absolute"); target.searchParams.set("from", new Date(parameters.startMs).toISOString()); target.searchParams.set("to", new Date(parameters.endMs).toISOString());
  target.searchParams.set("streams", parameters.streamIds.join(","));
  await chrome.tabs.create({ url: target.toString() });
}

searchUi.tab.addEventListener("click", async () => {
  if (safeSearchSeeded || searchUi.query.value.trim()) return;
  try {
    const refreshedTab = await chrome.tabs.get(activeTab.id);
    // An explicit launch may arrive while tabs.get is pending. Never let the
    // older URL overwrite the newer traceId/period context.
    if (safeSearchSeeded || searchUi.query.value.trim()) return;
    activeTab = refreshedTab;
    searchUi.query.value = traceIdValue(new URL(activeTab.url).searchParams.get("q"));
    safeSearchSeeded = true;
  } catch {}
});
searchUi.end.value = localDateTimeValue(new Date());
GraylogStreams.populateGraylogStreamSelect(searchUi.stream, SEARCH_ALL_STREAMS, { includeAll: true });
searchUi.stream.addEventListener("change", () => {
  if (searchUi.stream.value === "__source_streams__") return;
  safeSearchStreamOverride = null;
  searchUi.stream.querySelector('option[value="__source_streams__"]')?.remove();
  markSearchFormChanged();
});
searchUi.now.addEventListener("click", () => {
  searchUi.end.value = localDateTimeValue(new Date());
  markSearchFormChanged();
});
searchUi.run.addEventListener("click", runSafeSearch);
searchUi.open.addEventListener("click", () => openSafeSearchInGraylog().catch((error) => { searchUi.error.textContent = error.message || String(error); searchUi.error.hidden = false; }));
searchUi.mode.addEventListener("change", () => { if (!searchUi.results.hidden) renderSafeSearch(); });
searchUi.timelineFilter.addEventListener("input", () => { if (traceTimelineDiagram) renderTraceTimeline(traceTimelineDiagram, traceTimelineFromCache); });
searchUi.timelineMode.addEventListener("change", () => { if (traceTimelineDiagram) renderTraceTimeline(traceTimelineDiagram, traceTimelineFromCache); });
searchUi.traceButton.addEventListener("click", runTraceDiagram);
for (const element of [searchUi.query, searchUi.range, searchUi.end, searchUi.primary, searchUi.secondary, searchUi.tertiary, searchUi.limit, searchUi.serviceCallLimit]) {
  element.addEventListener(element === searchUi.query || element === searchUi.end ? "input" : "change", markSearchFormChanged);
}
updateSearchPeriodPreview();
updateTraceActionState();

let traceAnalysisLaunchGeneration = 0;
async function waitForTraceWork(current) {
  const deadline=Date.now()+65000;
  while(safeSearchLoading||traceDiagramLoading||(typeof percentileLoading!=="undefined"&&percentileLoading)){
    if(!current())return false;
    if(Date.now()>deadline)throw new Error("Предыдущий запрос ещё выполняется. Повторите действие после завершения.");
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  return current();
}
async function openCurrentTraceAnalysis({isCurrent = () => true} = {}) {
  const ticket = ++traceAnalysisLaunchGeneration;
  const signature = currentSearchFormSignature();
  const tabId = activeTab?.id;
  const current = () => ticket === traceAnalysisLaunchGeneration && isCurrent()
    && signature === currentSearchFormSignature() && tabId === activeTab?.id;
  if (!isExactTraceQuery(searchUi.query.value)) throw new Error("Для разбора нужен точный traceId.");
  document.querySelector("#trace-error-dialog")?.close();
  // Wait for existing explicit work; never add a competing search or treat an
  // early return from runSafeSearch as a newly completed analysis.
  if(!await waitForTraceWork(current))return false;
  await runSafeSearch(); // Reuses the existing strict query/period/stream cache.
  if (!current()) return false;
  if (!searchUi.error.hidden) throw new Error(searchUi.error.textContent || "Не удалось загрузить разбор trace.");
  if (safeSearchLoadedSignature !== signature || !traceTimelineDiagram) throw new Error("Для выбранного trace и периода данные разбора не найдены.");
  TraceErrorView.showTraceDialog(traceTimelineDiagram);
  return true;
}
async function openCurrentTraceGraph({isCurrent=()=>true}={}) {
  const signature=currentSearchFormSignature(),tabId=activeTab?.id;
  const current=()=>isCurrent()&&signature===currentSearchFormSignature()&&tabId===activeTab?.id;
  if(!isExactTraceQuery(searchUi.query.value))throw new Error("Для графа нужен точный traceId.");
  if(!await waitForTraceWork(current))return false;
  await runTraceDiagram();
  if(!current())return false;
  if(!searchUi.error.hidden)throw new Error(searchUi.error.textContent||"Не удалось построить граф.");
  return true;
}
globalThis.openCurrentTraceGraph = openCurrentTraceGraph;
globalThis.openCurrentTraceAnalysis = openCurrentTraceAnalysis;
globalThis.seedGraylogTraceLaunch = seedGraylogTraceLaunch;
globalThis.getCurrentTracePercentileState = () => {
  let bounds = null;
  try { const p = safeSearchParameters(); bounds = { startMs: p.startMs, endMs: p.endMs }; } catch {}
  return { exactTrace: isExactTraceQuery(searchUi.query.value), loading: safeSearchLoading || traceDiagramLoading,
    status: safeSearchLoading || traceDiagramLoading ? "loading" : safeSearchLoadedSignature === currentSearchFormSignature() ? "loaded" : safeSearchLoadedSignature ? "changed" : "idle", bounds };
};
globalThis.prepareCurrentTracePercentiles = async ({isCurrent=()=>true}={}) => {
  if (!isExactTraceQuery(searchUi.query.value)) throw new Error("Для процентилей нужен точный traceId.");

  const signature = currentSearchFormSignature();
  const tabId=activeTab?.id;
  const current=()=>isCurrent()&&signature===currentSearchFormSignature()&&tabId===activeTab?.id;
  if(!await waitForTraceWork(current))return false;
  const parameters = typeof safeSearchParameters === "function" ? safeSearchParameters() : null;
  // A lost MAIN URI token cannot be repaired by replaying its cached DTO.
  // Only this explicit retry invalidates this trace's cache; no passive fetch.
  if (parameters && globalThis.TracePercentiles?.getContextStatus?.() === "expired") {
    const businessRules = globalThis.BusinessErrorRules?.list?.() || [];
    const key = JSON.stringify([graylogTabCacheScope(activeTab), parameters.streamIds, parameters.query, parameters.startMs, parameters.endMs, businessRules]);
    traceDiagramCache.delete(key);
  }
  await runSafeSearch();
  if (!current()) return false;
  if (!searchUi.error.hidden) throw new Error(searchUi.error.textContent || "Не удалось получить trace.");
  if (parameters) globalThis.TracePercentiles?.setBounds?.({ startMs:parameters.startMs, endMs:parameters.endMs });
  if (!await globalThis.TracePercentiles?.open?.({ run: true })) {
    const error = document.querySelector("#percentile-error");
    throw new Error(error && !error.hidden && error.textContent ? error.textContent : "В trace не удалось определить однозначный initUri гейта для процентилей.");
  }
  return true;
};
