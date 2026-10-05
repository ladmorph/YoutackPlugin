const PERCENTILE_BASE_QUERY = `service-name: ${globalThis.GraylogConstants?.GATEWAY_SERVICE_NAME ?? "online-banking-gateway"} AND "RESPONSE"`;
const PERCENTILE_REQUIRED_FIELDS = [
  "Terminal-Id", "Terminal-Model", "Terminal-OS-Version", "Terminal-Type", "Terminal-Vendor", "Terminal-Version",
  "abbrev", "branch", "duration", "httpStatus", "initUri", "level", "logger_name", "message", "service-name",
  "source", "spanId", "thread_name", "timestamp", "traceId"
];
const PERCENTILE_QUERY = `${PERCENTILE_BASE_QUERY} AND ${PERCENTILE_REQUIRED_FIELDS.map((field) => `${field}:*`).join(" AND ")}`;
const PERCENTILE_STREAMS = Object.freeze([...(globalThis.GraylogStreams?.DEFAULT_PERCENTILE_STREAMS || [
  "67076246c4c24e10106b636f", "6731c46455c2594deb1be5af"
])]);
const PERCENTILE_URI_LIMIT = 1;
const PERCENTILE_DURATION_LIMIT = 500;
const PERCENTILE_CACHE_LIMIT = 24;
const PERCENTILE_CURRENT_CACHE_MS = 60 * 1000;
const PERCENTILE_TIMELINE_URI_LIMIT = 5;

const percentileUi = {
  stream: document.querySelector("#percentile-stream"),
  range: document.querySelector("#percentile-range"),
  chartMode: document.querySelector("#percentile-chart-mode"),
  end: document.querySelector("#percentile-end"),
  now: document.querySelector("#percentile-now"),
  periodPreview: document.querySelector("#percentile-period-preview"),
  run: document.querySelector("#run-percentiles"),
  prepare: document.querySelector("#prepare-trace-percentiles"),
  prepareActions: document.querySelector("#percentile-prepare-actions"),
  openGraylog: document.querySelector("#open-percentiles-graylog"),
  openTool: document.querySelector("#open-percentiles-tool"),
  openTrace: document.querySelector("#open-percentiles-trace"),
  openToolTrace: document.querySelector("#open-percentiles-tool-trace"),
  error: document.querySelector("#percentile-error"),
  results: document.querySelector("#percentile-results"),
  summary: document.querySelector("#percentile-summary"),
  filter: document.querySelector("#percentile-uri-filter"),
  uriSummary: document.querySelector("#percentile-uri-summary"),
  uriOptions: document.querySelector("#percentile-uri-options"),
  uriOptionSearch: document.querySelector("#percentile-uri-option-search"),
  uriSelectAll: document.querySelector("#percentile-uri-select-all"),
  uriReset: document.querySelector("#percentile-uri-reset"),
  uriTop: document.querySelector("#percentile-uri-top"),
  meta: document.querySelector("#percentile-meta"),
  rows: document.querySelector("#percentile-rows"),
  areaChart: document.querySelector("#percentile-area-chart"),
  areaMeta: document.querySelector("#percentile-area-meta"),
  tableSection: document.querySelector("#percentile-table-section"),
  areaSection: document.querySelector("#percentile-area-section"),
  jumpToggle: document.querySelector("#percentile-jump-toggle")
};
percentileUi.head = document.querySelector("#percentile-head");

let percentileRows = [];
let percentileTimeline = [];
let percentileCoverage = 0;
let percentileInvalid = 0;
const hiddenPercentileUris = new Set();
let percentileSelectionManual = false;
const collapsedPercentileCharts = new Set();
let percentileTraceUri = "";
let percentileTraceUriMasked = false;
let percentileTraceContext = null;
let percentileTraceContextStatus = "missing";
let percentileContextVersion = 0;
let percentileLoadedBounds = null;
let percentileLoading = false;
let percentilePreparing = false;
let percentileFromCache = false;
let percentileAreaVisible = false;
const percentileCache = new Map();
const percentileTimelineCache = new Map();

function percentileBounds() {
  const endMs = new Date(percentileUi.end.value).getTime();
  if (!Number.isFinite(endMs)) throw new Error("Укажите конец периода");
  return { endMs, startMs: endMs - Number(percentileUi.range.value) * 1000 };
}

function updatePercentilePeriodPreview() {
  try {
    const { startMs, endMs } = percentileBounds();
    percentileUi.periodPreview.textContent = `Будет запрошено: ${moscowPeriodLabel(startMs, endMs)}`;
  } catch {
    percentileUi.periodPreview.textContent = "Укажите корректный конец периода";
  }
}

function percentileStreams() {
  if (typeof globalThis.GraylogStreams?.percentileStreams === "function") return globalThis.GraylogStreams.percentileStreams();
  return [...PERCENTILE_STREAMS];
}

function percentileFeatureEnabled() {
  return typeof globalThis.GraylogStreams?.percentilesEnabled === "function"
    ? globalThis.GraylogStreams.percentilesEnabled()
    : true;
}

function percentileTimeUnit(rangeSeconds) {
  if (rangeSeconds <= 7200) return "1m";
  if (rangeSeconds <= 21600) return "5m";
  return "15m";
}

function percentileUriQuery(uris) {
  const escaped = uris.map((uri) => `initUri:"${String(uri).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`);
  return `${PERCENTILE_QUERY} AND (${escaped.join(" OR ")})`;
}

async function fetchPercentilesInGraylog(startMs, endMs, uriLimit, durationLimit, percentileQuery, streamIds, contextToken, displayUri) {
  const requestAbort = typeof AbortController === "function" ? new AbortController() : null;
  let requestTimeout = null;
  try {
    if (!Array.isArray(streamIds) || !streamIds.length || streamIds.length > 2 || streamIds.some((id) => !/^[a-f0-9]{24}$/i.test(String(id)))) throw new Error("Для процентилей должны быть указаны gateway streams");
    const contexts = globalThis.__advancedGraylogTraceUriContexts;
    if (contexts instanceof Map) for (const [key,value] of contexts) if (!value || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) contexts.delete(key);
    const context = typeof contextToken === "string" ? contexts?.get(contextToken) : null;
    if (!context || !Number.isFinite(context.expiresAt) || context.expiresAt <= Date.now()) throw new Error("Контекст initUri истёк или недоступен. Повторите поиск traceId.");
    const uri = context.uri;
    if (typeof uri !== "string" || !uri.startsWith("/") || uri.startsWith("//") || uri.length > 2048 || /[\s?#*\\\u0000-\u001f]/.test(uri)) throw new Error("Точный initUri трейса недоступен.");
    if (typeof displayUri !== "string" || !displayUri.startsWith("/") || displayUri.length > 2048) throw new Error("Нет безопасного имени initUri.");
    percentileQuery += ` AND initUri:"${uri.replaceAll('"', '\\"')}"`;
    uriLimit = 1;
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
    const headers = { Accept: "application/json", "Content-Type": "application/json", "X-Requested-By": "graylog-percentiles" };
    const storedSession = globalThis.localStorage?.getItem("sessionId") || "";
    let sessionId = storedSession;
    try { sessionId = JSON.parse(storedSession); } catch {}
    if (typeof sessionId === "string" && sessionId) headers.Authorization = `Basic ${btoa(`${sessionId}:session`)}`;
    // Bound the explicit request and body read, matching trace page transport.
    // Aborting our wait does not guarantee cancellation of work on the server.
    if (requestAbort) { requestTimeout = setTimeout(() => requestAbort.abort(), 65_000); requestTimeout?.unref?.(); }
    const response = await fetch(endpoint, {
      method: "POST",
      ...(requestAbort ? { signal: requestAbort.signal } : {}),
      credentials: "include",
      cache: "no-store",
      headers,
      body: JSON.stringify({
        id: searchId,
        parameters: [],
        queries: [{
          id: queryId,
          query: { type: "elasticsearch", query_string: percentileQuery },
          timerange: { type: "absolute", from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString() },
          filter: { type: "or", filters: streamIds.map((id) => ({ type: "stream", id })) },
          search_types: [{
            id: searchTypeId,
            type: "pivot",
            name: "duration-percentiles-by-init-uri",
            row_groups: [{ type: "values", field: "initUri", limit: uriLimit }],
            column_groups: [{ type: "values", field: "duration", limit: durationLimit }],
            series: [{ type: "count", id: "count()", field: null }],
            rollup: false
          }]
        }]
      })
    });
    const responseText = await response.text();
    let data;
    try { data = responseText ? JSON.parse(responseText) : {}; }
    catch { throw new Error(`Graylog вернул не JSON: HTTP ${response.status}`); }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ошибка Graylog`);
    if (data.execution?.completed_exceptionally || data.execution?.cancelled || data.execution?.done === false || (Array.isArray(data.errors) && data.errors.length)) throw new Error("Graylog не завершил расчёт процентилей.");

    const searchType = data.results?.[queryId]?.search_types?.[searchTypeId];
    if (!searchType) {
      throw new Error("Graylog не вернул процентили");
    }
    // Only numeric buckets leave MAIN. In particular, the exact initUri stays here.
    const numeric = value => {
      for (let depth=0;depth<5;depth++) {
        if (typeof value === "number" || typeof value === "string") {
          if (value === "" || !/^\d+(?:\.\d+)?$/.test(String(value))) return null;
          const result=Number(value);return Number.isFinite(result) ? result : null;
        }
        if (!value || typeof value !== "object") return null;
        if (Array.isArray(value)) { if(value.length!==1) return null; value=value[0]; }
        else { const key=["value","result","number","long","double"].find(key=>Object.hasOwn(value,key));if(!key)return null;value=value[key]; }
      }
      return null;
    };
    const buckets=[];
    for (const row of (Array.isArray(searchType.rows)?searchType.rows:[]).slice(0,501)) {
      const rowKey=Array.isArray(row?.key)?row.key:[];
      const raw=row?.values;
      const cells=Array.isArray(raw)?raw:raw&&typeof raw==="object"?Object.entries(raw).map(([key,value])=>value&&typeof value==="object"&&!Array.isArray(value)?{key:value.key??[key],value:value.value}:{key:[key],value}):[];
      for(const cell of cells.slice(0,501)) {
        const metricKey=Array.isArray(cell?.key)?cell.key:[];
        const dims=rowKey.length===2?rowKey:[...rowKey,...metricKey.slice(0,metricKey.some(part=>typeof part==="string"&&/count/i.test(part))?-1:undefined)];
        if(dims.length!==2 || dims[0]!==uri)continue;
        const duration=numeric(dims[1]),count=numeric(cell?.value);
        if(duration!==null&&count!==null&&count>0)buckets.push({uri:displayUri,duration,count});
        if(buckets.length>=500)break;
      }
      if(buckets.length>=500)break;
    }
    return { buckets, total: numeric(searchType.total) || 0 };
  } catch (error) {
    if (requestAbort?.signal.aborted) return { error: "Расчёт процентилей не завершился за 65 секунд. Ожидание остановлено; выполнение на сервере могло продолжиться." };
    const message = typeof error?.message === "string" ? error.message : "";
    return { error: /^(?:Для процентилей|Контекст initUri|Точный initUri|Нет безопасного имени|Текущая вкладка|Graylog не |Graylog вернул не JSON: HTTP \d{3}$|HTTP \d{3}: ошибка Graylog$)/.test(message) ? message : "Не удалось получить процентили из Graylog. Проверьте подключение и повторите поиск traceId." };
  } finally { if (requestTimeout !== null) clearTimeout(requestTimeout); }
}

function durationValue(value) {
  return PercentileFormat.durationValue(value);
}

function durationWithUnit(value) {
  return PercentileFormat.durationWithUnit(value);
}

function percentileChart(row, maximum) {
  return PercentileCharts.distribution(row, maximum, PercentileAnalysis.PERCENTILE_KEYS, escapeHtml);
}

function percentileBars(row, maximum) {
  return PercentileCharts.bars(row, maximum, PercentileAnalysis.PERCENTILE_KEYS, escapeHtml);
}

function percentileCard(label, value) {
  return PercentileFormat.card(label, value, escapeHtml);
}

function updatePercentileUriSummary() {
  const visible = percentileRows.length - percentileRows.filter((row) => hiddenPercentileUris.has(row.uri)).length;
  percentileUi.uriSummary.textContent = visible === percentileRows.length ? "initUri · все" : `initUri · ${visible} из ${percentileRows.length}`;
}

function updatePercentileSelection() {
  const hidden = percentileTraceUri
    ? new Set(percentileRows.filter((row) => row.uri !== percentileTraceUri).map((row) => row.uri))
    : PercentileAnalysis.percentileHiddenUris(percentileRows, hiddenPercentileUris, percentileSelectionManual);
  hiddenPercentileUris.clear();
  for (const uri of hidden) hiddenPercentileUris.add(uri);
}

function renderPercentileTraceContext() {
  const notice = document.querySelector("#percentile-trace-context");
  if (!notice) return;
  notice.hidden = false;
  const enabled = globalThis.GraylogStreams?.percentilesEnabled?.() !== false;
  const availableStreams = globalThis.GraylogStreams?.percentileStreams?.() || [];
  if (percentileUi.stream) {
    percentileUi.stream.innerHTML = `<option value="__gateway_streams__">${enabled ? `Gateway streams (${availableStreams.length})` : "Недоступно в test-режиме"}</option>`;
    percentileUi.stream.value = "__gateway_streams__";
    percentileUi.stream.disabled = true;
  }
  if (!enabled) {
    notice.textContent = "Процентили отключены для test-окружения. Поиск, графы и мониторинг используют фиксированные 4 streams.";
    percentileUi.run.hidden = true;
    percentileUi.run.disabled = true;
    if (percentileUi.prepareActions) percentileUi.prepareActions.hidden = false;
    if (percentileUi.prepare) percentileUi.prepare.disabled = true;
    for (const control of [percentileUi.range, percentileUi.end, percentileUi.now, percentileUi.chartMode]) if (control) control.disabled = true;
    for (const control of document.querySelectorAll?.('#percentiles-view [data-time-picker],#percentiles-view [data-time-target]') || []) control.disabled = true;
    const tab = document.querySelector("#search-percentiles-tab");
    if (tab) { tab.disabled = true; tab.title = "Процентили отключены для test-окружения"; }
    return;
  }
  const valid = Boolean(percentileTraceContext?.contextToken);
  const searchState=globalThis.getCurrentTracePercentileState?.() || {};
  const busy=percentileLoading||percentilePreparing||searchState.loading===true;
  const loaded = percentileLoadedBounds ? ` Расчёт: ${moscowPeriodLabel(percentileLoadedBounds.startMs, percentileLoadedBounds.endMs)}.` : "";
  notice.textContent = valid
    ? `URI gateway: ${percentileTraceUri}.${loaded} По кнопке «Рассчитать процентили» — один запрос ответов gateway для этого URI за выбранный период. В расчёт входят подходящие ответы разных trace.${percentileTraceUriMasked ? " Переменные пути в интерфейсе скрыты." : ""}`
    : percentileLoading ? "Завершается предыдущий расчёт процентилей. После завершения можно найти текущий trace; дополнительные запросы сейчас не запускаются."
    : searchState.loading ? "Поиск trace выполняется. Контекст gateway появится после завершения; переключение вкладок не запускает запросы."
    : percentilePreparing ? "Подготавливаю расчёт процентилей…"
    : ({expired:"Контекст gateway устарел. Нажмите «Найти trace и рассчитать», чтобы получить его заново.",ambiguous:"У gateway в trace несколько разных initUri. Однозначный URI для расчёта не выбран.",incomplete:"Выборка trace ограничена; подтвердить initUri gateway не удалось. Можно повторить поиск.",invalid:"initUri gateway не подходит для точного расчёта процентилей."}[percentileTraceContextStatus]
      || (!searchState.exactTrace ? "Укажите один точный traceId в разделе «Трейс и взаимодействия». После поиска используем initUri только из сообщений gateway."
        : searchState.status==='loaded' ? "В полученных сообщениях gateway не найден структурированный initUri. URI других сервисов для этого расчёта не используется."
        : "Текущий trace ещё не загружен. По кнопке ниже сначала найдём его initUri gateway, затем рассчитаем процентили ответов этого URI. Сообщения trace загружаются последовательно; расчёт процентилей выполняется отдельным запросом. При неполной выборке может понадобиться проверка URI."));
  percentileUi.run.disabled = !valid || busy;
  for(const control of [percentileUi.range,percentileUi.end,percentileUi.now])control.disabled=!valid||busy;
  for(const control of document.querySelectorAll?.('#percentiles-view [data-time-picker],#percentiles-view [data-time-target]')||[])control.disabled=!valid||busy;
  const periodNote=document.querySelector('#percentile-context-period-note');if(periodNote)periodNote.hidden=valid;
  percentileUi.run.hidden = !valid;
  if(percentileUi.prepareActions)percentileUi.prepareActions.hidden=valid;
  if(percentileUi.prepare){percentileUi.prepare.disabled=!searchState.exactTrace||busy;percentileUi.prepare.textContent=percentilePreparing?'Ищу trace и рассчитываю…':'Найти trace и рассчитать';}
  const tab = document.querySelector("#search-percentiles-tab");
  if (tab) { tab.disabled = false; tab.title = "Открыть процентили gateway; запросы запускаются отдельной кнопкой"; }
}

function setPercentileTraceContext(context, status = "missing") {
  percentileContextVersion++;
  const valid = context && typeof context.contextToken === "string" && /^[a-zA-Z0-9-]{16,128}$/.test(context.contextToken)
    && typeof context.initUri === "string" && context.initUri.startsWith("/") && context.initUri.length <= 2048;
  percentileTraceContext = valid ? {contextToken:context.contextToken,initUri:context.initUri,traceId:typeof context.traceId === "string" ? context.traceId.slice(0,128) : "",masked:context.masked===true} : null;
  percentileTraceContextStatus = valid ? "ready" : ["missing","ambiguous","incomplete","invalid","expired"].includes(status) ? status : "missing";
  percentileTraceUri = valid ? context.initUri : "";
  percentileTraceUriMasked = valid && context.masked===true;
  percentileRows=[];percentileTimeline=[];percentileLoadedBounds=null;percentileCache.clear();percentileTimelineCache.clear();
  percentileUi.results.hidden=true;percentileUi.error.hidden=true;
  percentileUi.filter.value="";percentileUi.uriOptionSearch.value="";
  hiddenPercentileUris.clear();percentileSelectionManual=true;
  if(valid){const bounds=globalThis.getCurrentTracePercentileState?.().bounds;if(bounds)setPercentileBounds(bounds);}
  renderPercentileTraceContext();
  return Boolean(valid);
}

function setPercentileBounds(bounds) {
  const startMs = Number(bounds?.startMs);
  const endMs = Number(bounds?.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs || endMs - startMs > 86400 * 1000) return false;
  percentileUi.range.querySelector?.('option[data-trace-launch="true"]')?.remove();
  const seconds = (endMs - startMs) / 1000;
  const value = String(seconds);
  const options = percentileUi.range.options ? [...percentileUi.range.options] : [];
  if (!options.some((option) => option.value === value) && typeof document.createElement === "function") {
    const option = document.createElement("option");
    option.value = value;
    option.dataset.traceLaunch = "true";
    option.textContent = `Период trace · ${Math.round(seconds)} сек`;
    percentileUi.range.append(option);
  }
  percentileUi.range.value = value;
  const local = new Date(endMs - new Date(endMs).getTimezoneOffset() * 60_000).toISOString();
  percentileUi.end.step = "1";
  percentileUi.end.value = local.slice(0, 19);
  if (typeof updatePercentilePeriodPreview === "function") updatePercentilePeriodPreview();
  return true;
}

function openTracePercentiles({run=false}={}) {
  if (globalThis.GraylogStreams?.percentilesEnabled?.() === false) {
    renderPercentileTraceContext();
    const target = document.querySelector("#safe-search-error");
    if (target) { target.textContent = "Процентили отключены для test-окружения."; target.hidden = false; }
    return false;
  }
  document.querySelector("#percentiles-tab")?.click();
  if(!percentileTraceContext){const bounds=globalThis.getCurrentTracePercentileState?.().bounds;if(bounds)setPercentileBounds(bounds);}
  renderPercentileTraceContext();
  if (run && percentileTraceContext && !percentileLoadedBounds) {
    const version=percentileContextVersion;
    return Promise.resolve(runPercentiles()).then(()=>version===percentileContextVersion&&Boolean(percentileLoadedBounds)&&percentileUi.error.hidden);
  }
  return Boolean(percentileTraceContext);
}

// A displayed masked URI never authorizes a broader search.
function openPercentilesForUri(uri) {
  if (typeof uri!=="string" || !uri.trim()) return false;
  if (!percentileTraceContext || uri!==percentileTraceContext.initUri) {
    percentileUi.error.textContent="Используйте initUri загруженного трейса: для произвольного URL расчёт недоступен.";
    percentileUi.error.hidden=false;
    return false;
  }
  if (globalThis.GraylogStreams?.percentilesEnabled?.() === false) {
    openTracePercentiles({run:false});
    return false;
  }
  openTracePercentiles({run:true});
  return true;
}
globalThis.openPercentilesForUri = openPercentilesForUri;
globalThis.TracePercentiles = Object.freeze({setTraceContext:setPercentileTraceContext,setBounds:setPercentileBounds,open:openTracePercentiles,run:runPercentiles,refreshSearchState:renderPercentileTraceContext,isLoading:()=>percentileLoading,getContextStatus:()=>percentileTraceContextStatus});

function renderPercentileUriOptions() {
  const needle = percentileUi.uriOptionSearch.value.trim().toLowerCase();
  const matching = percentileRows.filter((row) => !needle || row.uri.toLowerCase().includes(needle));
  percentileUi.uriOptions.innerHTML = matching.length ? matching.map((row) => `<label class="filter-option"><input type="checkbox" value="${escapeHtml(row.uri)}" ${hiddenPercentileUris.has(row.uri) ? "" : "checked"}><span>${escapeHtml(row.uri)}</span></label>`).join("") : '<span class="muted">Подходящих initUri нет</span>';
  const selectedMatching = matching.filter((row) => !hiddenPercentileUris.has(row.uri)).length;
  percentileUi.uriSelectAll.checked = matching.length > 0 && selectedMatching === matching.length;
  percentileUi.uriSelectAll.indeterminate = selectedMatching > 0 && selectedMatching < matching.length;
  percentileUi.uriSelectAll.disabled = !matching.length;
  for (const input of percentileUi.uriOptions.querySelectorAll("input")) {
    input.addEventListener("change", () => {
      percentileTraceUri = "";
      renderPercentileTraceContext();
      percentileSelectionManual = true;
      if (input.checked) hiddenPercentileUris.delete(input.value); else hiddenPercentileUris.add(input.value);
      renderPercentileUriOptions();
      renderPercentileRows();
    });
  }
  updatePercentileUriSummary();
}

function percentileAreaChart(rows) {
  const row = rows.find(item => item.uri === percentileTraceUri) || rows[0];
  percentileUi.areaMeta.textContent = row ? `${new Intl.NumberFormat("ru-RU").format(row.count)} ответов в учтённых корзинах` : "";
  if (!row) {
    percentileUi.areaChart.innerHTML = '<p class="chart-empty">За выбранный период для initUri трейса нет данных длительности. График не построен.</p>';
    return;
  }
  const keys = ["p50", "p75", "p95", "p99"];
  const colors = ["#43d9c7", "#60a5fa", "#ffb454", "#ff6870"];
  const values = keys.map(key => typeof row[key] === "number" && Number.isFinite(row[key]) && row[key] >= 0 ? row[key] : null);
  const maximum = Math.max(1, ...values.filter(value => value !== null));
  const ceiling = Math.min(Number.MAX_VALUE, maximum * 1.15);
  const left = 70, bottom = 260, plotHeight = 206, slot = 130, barWidth = 64;
  const ticks = Array.from({length:5}, (_, index) => {
    const y = bottom - index * plotHeight / 4;
    const value = ceiling * (index / 4);
    return `<line class="percentile-focus-grid" x1="${left}" x2="604" y1="${y}" y2="${y}"/><text class="percentile-focus-tick" x="58" y="${y+5}" text-anchor="end">${escapeHtml(durationValue(value))}</text>`;
  }).join("");
  const bars = keys.map((key,index) => {
    const value = values[index], center = left + slot * index + slot / 2;
    const label = value === null ? "нет данных" : durationWithUnit(value);
    const height = value === null ? 0 : value / ceiling * plotHeight;
    const y = bottom - height;
    const marker = value === null ? "" : value === 0 ? `<line x1="${center-barWidth/2}" x2="${center+barWidth/2}" y1="${bottom}" y2="${bottom}" stroke="${colors[index]}" stroke-width="3"/>` : `<rect class="percentile-focus-bar" data-percentile="${key}" x="${center-barWidth/2}" y="${y.toFixed(2)}" width="${barWidth}" height="${height.toFixed(2)}" rx="5" fill="${colors[index]}"/>`;
    return `<g><title>${key.toUpperCase()}: ${escapeHtml(label)}</title>${marker}<text class="percentile-focus-value" x="${center}" y="${Math.max(28,y-12).toFixed(2)}" text-anchor="middle">${escapeHtml(label)}</text><text class="percentile-focus-key" x="${center}" y="291" text-anchor="middle">${key.toUpperCase()}</text></g>`;
  }).join("");
  percentileUi.areaChart.innerHTML = `<div class="percentile-focus-uri"><span>initUri</span><code>${escapeHtml(row.uri)}</code></div><div class="percentile-focus-scroll"><svg class="percentile-focus-svg" viewBox="0 0 640 320" role="img" aria-label="P50, P75, P95 и P99 длительности ответа в миллисекундах"><title>Процентили длительности ответа</title><text class="percentile-focus-tick" x="18" y="25">мс</text>${ticks}${bars}</svg></div>`;
}

function renderPercentileRows() {
  const selected = percentileRows.filter((row) => !hiddenPercentileUris.has(row.uri));
  const visible = PercentileAnalysis.filterPercentileRows(selected, percentileUi.filter.value);
  const maximum = Math.max(1, ...visible.map((row) => row.p99 ?? row.p95 ?? row.p75 ?? row.p50 ?? 0));
  const mode = percentileUi.chartMode.value;
  percentileUi.head.innerHTML = `<th>initUri</th><th>P50, мс</th><th>P75, мс</th><th>P95, мс</th><th>P99, мс</th>${mode === "table" ? "" : `<th>${mode === "bars" ? "Столбцы" : "Распределение duration"}</th>`}`;
  percentileUi.rows.innerHTML = visible.length ? visible.map((row) => `<tr>
    <td class="uri">${escapeHtml(row.uri)}</td>
    <td>${durationValue(row.p50)}</td><td>${durationValue(row.p75)}</td><td>${durationValue(row.p95)}</td><td>${durationValue(row.p99)}</td>
    ${mode === "table" ? "" : `<td>${mode === "bars" ? percentileBars(row, maximum) : percentileChart(row, maximum)}</td>`}
  </tr>`).join("") : `<tr><td class="empty" colspan="${mode === "table" ? 5 : 6}">Подходящие initUri не найдены.</td></tr>`;
  percentileUi.meta.textContent = `initUri трейса · покрытие ${percentileCoverage.toFixed(1)}%${percentileInvalid ? ` · нечисловых: ${new Intl.NumberFormat("ru-RU").format(percentileInvalid)}` : ""}${percentileFromCache ? " · из памяти" : ""}. Лимит: 500 значений duration; при неполном покрытии процентили приблизительные.`;
  percentileAreaChart(visible);
}

function renderPercentiles(total) {
  percentileUi.results.hidden = false;
  const maxP95 = Math.max(0, ...percentileRows.map((row) => row.p95 ?? 0));
  const maxP99 = Math.max(0, ...percentileRows.map((row) => row.p99 ?? 0));
  const tail = PercentileAnalysis.summarizeTailLatency(percentileRows);
  percentileUi.summary.innerHTML = [
    percentileCard("initUri", String(percentileRows.length)),
    percentileCard("Response", new Intl.NumberFormat("ru-RU").format(total)),
    percentileCard("P95", durationWithUnit(maxP95)),
    percentileCard("P99", durationWithUnit(maxP99)),
    percentileCard("Хвост P99 / P50", tail ? `${tail.ratio.toFixed(1)}×` : "—")
  ].join("");
  renderPercentileRows();
}

async function runPercentiles() {
  if (globalThis.GraylogStreams?.percentilesEnabled?.() === false) {
    percentileUi.error.textContent = "Процентили отключены для test-окружения.";
    percentileUi.error.hidden = false;
    renderPercentileTraceContext();
    return false;
  }
  if (percentileLoading || globalThis.GraylogHttpActions?.busy?.("percentiles") || globalThis.getCurrentTracePercentileState?.().loading || !percentileTraceContext) { renderPercentileTraceContext(); return; }
  const finishCompanion = globalThis.Clippy?.begin?.("loading");
  let companionOutcome = "warning";
  const context = percentileTraceContext;
  const version = percentileContextVersion;
  const sourceTabId = activeTab?.id;
  const current = () => version === percentileContextVersion && sourceTabId === activeTab?.id;
  percentileLoading = true;
  percentileUi.error.hidden = true;
  percentileUi.run.disabled = true;
  percentileUi.run.textContent = "Строю…";
  globalThis.updateTraceActionState?.();
  renderPercentileTraceContext();
  try {
    const { startMs, endMs } = percentileBounds();
    const refreshedTab = await chrome.tabs.get(sourceTabId);
    if (!current()) return;
    activeTab = refreshedTab;
    const streams = percentileStreams();
    const cacheKey = JSON.stringify([activeTab.id, streams, startMs, endMs, context.contextToken]);
    const cached = percentileCache.get(cacheKey);
    const touchesNow = endMs >= Date.now() - 60_000;
    let result;
    if (cached && (!touchesNow || Date.now() - cached.savedAt < PERCENTILE_CURRENT_CACHE_MS)) {
      result = cached.result;
      percentileFromCache = true;
    } else {
      const audit = QueryAudit.begin({ area: "Процентили", query: percentileUriQuery([context.initUri]), streams, startMs, endMs, aggregation: `initUri(${PERCENTILE_URI_LIMIT}) × duration(${PERCENTILE_DURATION_LIMIT}) × count()` });
      try {
        const execution = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          world: "MAIN",
          func: fetchPercentilesInGraylog,
          args: [startMs, endMs, PERCENTILE_URI_LIMIT, PERCENTILE_DURATION_LIMIT, PERCENTILE_QUERY, streams, context.contextToken, context.initUri]
        });
        if (execution[0]?.error) throw new Error(execution[0].error.message || String(execution[0].error));
        result = execution[0]?.result;
        if (result?.error) throw new Error(result.error);
        audit.finish("success", result?.total);
      } catch (error) {
        audit.finish("error", null, error?.message || String(error));
        throw error;
      }
      percentileFromCache = false;
      percentileCache.set(cacheKey, { result, savedAt: Date.now() });
      BoundedCache.pruneCache(percentileCache, PERCENTILE_CACHE_LIMIT);
    }
    if (!current()) return;
    const durationBuckets = Array.isArray(result?.buckets) ? result.buckets : [];
    if ((Number(result?.total) || 0) > 0 && !durationBuckets.length) {
      throw new Error("Graylog вернул RESPONSE, но числовые пары initUri + duration не получены.");
    }
    const calculated = PercentileAnalysis.percentileRowsFromBuckets(durationBuckets);
    percentileRows = calculated.rows;
    percentileLoadedBounds = { startMs, endMs };
    percentileInvalid = calculated.invalidTotal;
    const resultTotal = Number(result?.total) || calculated.sampledTotal;
    percentileCoverage = resultTotal > 0 ? Math.min(100, calculated.sampledTotal / resultTotal * 100) : 0;
    updatePercentileSelection();
    renderPercentileUriOptions();
    renderPercentiles(resultTotal);
    renderPercentileTraceContext();
    companionOutcome = result?.incomplete || result?.truncated || percentileInvalid > 0 || (resultTotal > 0 && percentileCoverage < 100) ? "warning" : resultTotal === 0 ? "empty" : "success";

  } catch (error) {
    companionOutcome = "error";
    if (!current()) return;
    if (/^Контекст initUri/.test(error?.message || "")) setPercentileTraceContext(null, "expired");
    percentileUi.error.textContent = error.message || String(error);
    percentileUi.error.hidden = false;
  } finally {
    percentileLoading = false;
    percentileUi.run.disabled = false;
    percentileUi.run.textContent = "Рассчитать процентили";
    renderPercentileTraceContext();
    globalThis.updateTraceActionState?.();
    finishCompanion?.(companionOutcome);
  }
}

function initializePercentileStreamDisplay() {
  const streams = percentileStreams();
  percentileUi.stream.innerHTML = `<option value="__gateway_streams__">${globalThis.GraylogStreams?.percentilesEnabled?.() !== false ? `Gateway streams (${streams.length})` : "Недоступно в test-режиме"}</option>`;
  percentileUi.stream.value = "__gateway_streams__";
  percentileUi.stream.disabled = true;
}
initializePercentileStreamDisplay();
percentileUi.end.value = localDateTimeValue(new Date());
percentileUi.now.addEventListener("click", () => {
  percentileUi.end.value = localDateTimeValue(new Date());
  updatePercentilePeriodPreview();
});
percentileUi.end.addEventListener("input", updatePercentilePeriodPreview);
percentileUi.range.addEventListener("change", updatePercentilePeriodPreview);
updatePercentilePeriodPreview();
percentileUi.run.addEventListener("click", runPercentiles);
percentileUi.filter.addEventListener("input", () => { percentileTraceUri = ""; renderPercentileTraceContext(); renderPercentileRows(); });
percentileUi.uriOptionSearch.addEventListener("input", renderPercentileUriOptions);
percentileUi.uriSelectAll.addEventListener("change", () => {
  percentileTraceUri = "";
  renderPercentileTraceContext();
  percentileSelectionManual = true;
  const needle = percentileUi.uriOptionSearch.value.trim().toLowerCase();
  const matching = percentileRows.filter((row) => !needle || row.uri.toLowerCase().includes(needle));
  for (const row of matching) {
    if (percentileUi.uriSelectAll.checked) hiddenPercentileUris.delete(row.uri);
    else hiddenPercentileUris.add(row.uri);
  }
  renderPercentileUriOptions();
  renderPercentileRows();
});
percentileUi.uriReset.addEventListener("click", () => { if (percentileTraceUri) percentileUi.filter.value = ""; percentileTraceUri = ""; renderPercentileTraceContext(); percentileSelectionManual = true; hiddenPercentileUris.clear(); renderPercentileUriOptions(); renderPercentileRows(); });
percentileUi.uriTop?.addEventListener("click", () => { if (percentileTraceUri) percentileUi.filter.value = ""; percentileTraceUri = ""; renderPercentileTraceContext(); percentileSelectionManual = false; updatePercentileSelection(); renderPercentileUriOptions(); renderPercentileRows(); });
percentileUi.chartMode.addEventListener("change", renderPercentileRows);
const percentileAreaObserver = new IntersectionObserver((entries) => {
  percentileAreaVisible = Boolean(entries[0]?.isIntersecting);
  percentileUi.jumpToggle.textContent = percentileAreaVisible ? "↑ Перейти к таблице" : "↓ Перейти к графикам";
}, { threshold: 0.2 });
percentileAreaObserver.observe(percentileUi.areaSection);
percentileUi.jumpToggle.addEventListener("click", () => {
  const target = percentileAreaVisible ? percentileUi.tableSection : percentileUi.areaSection;
  const fold = target.closest("details.percentile-section-fold");
  if (fold) fold.open = true;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#search-trace-tab")?.addEventListener("click", () => document.querySelector("#search-tab")?.click());
document.querySelector("#search-percentiles-tab")?.addEventListener("click", () => openTracePercentiles({run:false}));
document.querySelector("#percentile-back-search")?.addEventListener("click", () => {document.querySelector("#search-tab")?.click();document.querySelector("#safe-search-query")?.focus();});
percentileUi.prepare?.addEventListener("click", async () => {
  if(globalThis.GraylogStreams?.percentilesEnabled?.()===false){renderPercentileTraceContext();return;}
  if(percentilePreparing||percentileLoading||!globalThis.getCurrentTracePercentileState?.().exactTrace)return;
  percentilePreparing=true;percentileUi.error.hidden=true;renderPercentileTraceContext();
  try{
    if(typeof globalThis.prepareCurrentTracePercentiles!=='function')throw new Error("Модуль поиска ещё не готов. Повторите действие через несколько секунд.");
    await globalThis.prepareCurrentTracePercentiles();
  }catch(error){if(percentileUi.error.hidden||!percentileUi.error.textContent)percentileUi.error.textContent=error?.message||"Не удалось подготовить процентили.";percentileUi.error.hidden=false;}
  finally{percentilePreparing=false;renderPercentileTraceContext();}
});
renderPercentileTraceContext();
