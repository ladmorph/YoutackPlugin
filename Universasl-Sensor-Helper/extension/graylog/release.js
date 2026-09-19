function currentReleaseStreams() { return GraylogStreams.monitorStreams(releaseUi?.streamMode?.value || "o"); }
const RELEASE_CACHE_LIMIT = 48;
const RELEASE_PROBE_FAILURE_CACHE_MS = 30 * 1000;
const RELEASE_CURRENT_CACHE_MS = 60 * 1000;
// Not named HOUR_MS: popup.js already declares that at the same (shared,
// non-module) script scope, and a second top-level const with the same
// name would throw at page load.
const RELEASE_HISTORY_ANCHOR_MS = 60 * 60 * 1000;
const TRACE_CACHE_LIMIT = 64;

const RELEASE_CHECKS = [
  {
    id: "npe",
    title: "NullPointerException",
    query: 'message:"java.lang.NullPointerException" AND NOT message:"The mapper returned a null value."',
    dimensions: ["service-name"]
  },
  {
    id: "deserialize",
    title: "Ошибки десериализации",
    query: 'message:"Cannot deserialize"',
    dimensions: ["initUri"]
  },
  {
    id: "kafka",
    title: "Ошибки Kafka",
    query: "(message:kafka* OR message:Producer* OR message:Consumer*) AND level:3",
    dimensions: ["initUri"]
  },
  {
    id: "validation",
    title: "Ошибки валидации",
    query: 'level:3 AND message:"4008" AND message:"errorCode" AND message:"OPENAPI"',
    dimensions: ["service-name"]
  },
  {
    id: "redis",
    title: "Ошибки Redis",
    query: "level:3 AND message:redis",
    dimensions: ["service-name"]
  },
  {
    id: "sql",
    title: "Ошибки SQL",
    query: 'level:3 AND "SQL"',
    dimensions: ["service-name"]
  },
  {
    id: "http500",
    title: "Фон HTTP 5xx",
    query: "httpStatus:[500 TO 599]",
    dimensions: ["service-name", "httpStatus"]
  },
  {
    id: "config-missing",
    title: "Конфигурация не найдена",
    query: '("not found in table with name config" OR "Failed to get object by key") AND NOT (service-name:online\\-banking\\-log\\-generator OR instance-name:online\\-banking\\-log\\-generator)',
    dimensions: ["service-name"]
  },
  {
    id: "empty-value",
    title: "RuntimeException: пустое значение",
    query: 'message:"java.lang.RuntimeException: Value could not be empty" AND level:3',
    dimensions: ["service-name"]
  }
];

const releaseUi = {
  spamTab: document.querySelector("#spam-tab"),
  releaseTab: document.querySelector("#release-tab"),
  percentilesTab: document.querySelector("#percentiles-tab"),
  searchTab: document.querySelector("#search-tab"),
  technicalLogTab: document.querySelector("#technical-log-tab"),
  spamView: document.querySelector("#spam-view"),
  releaseView: document.querySelector("#release-view"),
  percentilesView: document.querySelector("#percentiles-view"),
  searchView: document.querySelector("#search-view"),
  technicalLogView: document.querySelector("#technical-log-view"),
  mode: document.querySelector("#monitor-mode"),
  streamMode: document.querySelector("#monitor-stream-mode"),
  historyRange: document.querySelector("#monitor-history-range"),
  chartMode: document.querySelector("#monitor-chart-mode"),
  range: document.querySelector("#monitor-range"),
  end: document.querySelector("#monitor-end"),
  now: document.querySelector("#monitor-now"),
  periodPreview: document.querySelector("#monitor-period-preview"),
  run: document.querySelector("#run-monitor"),
  refresh: document.querySelector("#refresh-monitor"),
  note: document.querySelector("#monitor-mode-note"),
  error: document.querySelector("#monitor-error"),
  results: document.querySelector("#monitor-results"),
  newLabel: document.querySelector("#new-events-label"),
  newTotal: document.querySelector("#new-events-total"),
  knownLabel: document.querySelector("#known-events-label"),
  knownTotal: document.querySelector("#known-events-total"),
  eventsTotal: document.querySelector("#events-total"),
  expandAll: document.querySelector("#expand-all-monitors"),
  collapseAll: document.querySelector("#collapse-all-monitors")
};

let releaseLoading = false;
globalThis.__graylogTraceLookupLoading = false;
const releaseTotals = { newEvents: 0, knownEvents: 0, events: 0 };
const releaseCache = new Map();
const traceCache = new Map();
const releaseRenderedResults = new Map();
let releaseVersionInventory = null;
let releaseComparisonScope = null;

function localDateTimeValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function moscowPeriodLabel(startMs, endMs) {
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  return `${formatter.format(new Date(startMs))} — ${formatter.format(new Date(endMs))} МСК`;
}

function updateMonitorPeriodPreview() {
  try {
    const { startMs, endMs } = selectedMonitorBounds();
    releaseUi.periodPreview.textContent = `Будет запрошено: ${moscowPeriodLabel(startMs, endMs)}`;
  } catch {
    releaseUi.periodPreview.textContent = "Укажите корректный конец периода";
  }
}

function releaseEventCountLabel(value) {
  const count = Math.max(0, Number(value) || 0);
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? "событий" : last === 1 ? "событие" : last >= 2 && last <= 4 ? "события" : "событий";
  return `${number(count)} ${noun}`;
}

function monitorInterval(rangeSeconds) {
  if (rangeSeconds <= 2 * 3600) return "5m";
  if (rangeSeconds <= 6 * 3600) return "15m";
  return "1h";
}

function setMonitorModeNote() {
  const releaseMode = releaseUi.mode.value === "release";
  const streamMode = releaseUi.streamMode?.value === "r" ? "r" : "o";
  const streamModeLabel = globalThis.GraylogStreams?.environment?.() === "test"
    ? "Test-режим · фиксированные 4 streams"
    : streamMode === "r" ? "Режим Р · новый stream" : "Режим О · прежние 9 streams";
  const historyHours = (releaseComparisonScope?.historyMs ?? Number(releaseUi.historyRange?.value || 86400) * 1000) / 3600000;
  releaseUi.newLabel.textContent = releaseMode ? "Новых в релизе" : "Новое за период";
  releaseUi.knownLabel.textContent = releaseMode ? "Известных в релизе" : `Встречалось за ${historyHours} ч`;
  // The history window is anchored to the hour, so it is never shorter than
  // the picked span and can be up to an hour longer. Say so where the number
  // is shown, instead of letting the tile claim an exact span.
  releaseUi.knownLabel.title = releaseMode ? "" : `Окно истории округляется к началу часа: проверяется не менее ${historyHours} ч и не более ${historyHours + 1} ч, всегда вплотную к началу периода.`;
  document.querySelector("#release-unknown-card").hidden = !releaseMode;
  document.querySelector("#monitor-history-control").hidden = releaseMode;
  releaseUi.note.textContent = `${streamModeLabel}. ` + (releaseMode
    ? "Две наибольшие числовые версии branch каждого сервиса сравниваются только внутри выбранного периода (по умолчанию 1 час). Считаются ошибки последней версии; если группа есть в предыдущей — она известная. Одна версия — без сравнения. Версии определяются по всем сообщениям, включая сообщения без ошибок."
    : `Новое за период: сервис и признаки ошибки отсутствовали за ${historyHours}\u2013${historyHours + 1} ч непосредственно перед выбранным периодом. История берётся двумя запросами: основное окно округлено к началу часа, отдельный короткий запрос закрывает стык до начала периода, поэтому окно бывает шире заявленного, но разрыва перед периодом нет. Версии сервиса не влияют на показатель.`);
}

function showReleaseError(message) {
  setMonitorEmptyState(false);
  releaseUi.error.textContent = message;
  releaseUi.error.hidden = false;
}

function setMonitorEmptyState(visible) {
  let panel = document.querySelector("#monitor-empty-state");
  if (!panel && visible) {
    panel = document.createElement("section");
    panel.id = "monitor-empty-state";
    panel.className = "empty-result-state";
    panel.setAttribute("role", "status");
    const image = document.createElement("img");
    image.src = globalThis.chrome?.runtime?.getURL?.("extension/shared/empty-state.png") || "empty-state.png";
    image.width = 200; image.height = 164;
    image.alt = "Смайл для пустого результата";
    const title = document.createElement("h3");
    title.textContent = "За выбранный период событий нет";
    const description = document.createElement("p");
    description.textContent = "Все проверки мониторинга завершены. Можно изменить период или повторить проверку позже.";
    panel.append(image, title, description);
    releaseUi.results.prepend(panel);
  }
  if (panel) panel.hidden = !visible;
}

function renderMonitorGroupingRules() {
  const target = document.querySelector("#monitor-grouping-rules");
  if (!target) return;
  const labels = {"service-name":"сервис", initUri:"URI (initUri)", httpStatus:"HTTP-код (httpStatus)"};
  target.innerHTML = RELEASE_CHECKS.map(definition => {
    const fields = [...new Set(["service-name", ...definition.dimensions])];
    return `<tr><td>${escapeHtml(definition.title)}</td><td>Категория + ${fields.map(field => escapeHtml(labels[field] || field)).join(" + ")}</td></tr>`;
  }).join("");
}

// Injected into the active Graylog search tab; keep all dependencies local.
// One count per window: are there any messages that carry the alias fields
// (instance-name / instance-version) but not the canonical ones
// (service-name / branch)? Only then do the per-check alias-variant queries
// in fetchReleaseCheckInGraylog have anything to find.
async function probeReleaseAliasesInGraylog(streamIds, windows) {
  try {
    if (!Array.isArray(streamIds) || !streamIds.length) throw new Error("Stream для мониторинга не выбран");
    const current = new URL(location.href);
    const searchIndex = current.pathname.toLowerCase().lastIndexOf("/search");
    if (searchIndex < 0) throw new Error("Текущая вкладка не является страницей поиска Graylog");
    const beforeSearch = current.pathname.slice(0, searchIndex);
    const streamRouteIndex = beforeSearch.toLowerCase().lastIndexOf("/streams/");
    const basePath = streamRouteIndex >= 0 ? beforeSearch.slice(0, streamRouteIndex) : beforeSearch;
    const endpoint = new URL(`${basePath}/api/views/search/sync?timeout=60000`, current.origin).toString();
    const ids = {};
    const queries = [];
    for (const window of Array.isArray(windows) ? windows : []) {
      const queryId = crypto.randomUUID(), typeId = crypto.randomUUID();
      ids[window.key] = { queryId, typeId };
      queries.push({
        id: queryId,
        query: { type: "elasticsearch", query_string: "(NOT _exists_:service-name AND _exists_:instance-name) OR (NOT _exists_:branch AND _exists_:instance-version)" },
        timerange: { type: "absolute", from: new Date(window.from).toISOString(), to: new Date(window.to).toISOString() },
        filter: { type: "or", filters: streamIds.map((id) => ({ type: "stream", id })) },
        search_types: [{ id: typeId, type: "pivot", name: "release-alias-probe", row_groups: [], column_groups: [], series: [{ type: "count", id: "count()", field: null }], rollup: false }]
      });
    }
    if (!queries.length) return { counts: {} };
    const headers = { Accept: "application/json", "Content-Type": "application/json", "X-Requested-By": "graylog-release-monitor" };
    const storedSession = globalThis.localStorage?.getItem("sessionId") || "";
    let sessionId = storedSession;
    try { sessionId = JSON.parse(storedSession); } catch {}
    if (typeof sessionId === "string" && sessionId) headers.Authorization = `Basic ${btoa(`${sessionId}:session`)}`;
    const response = await fetch(endpoint, { method: "POST", credentials: "include", cache: "no-store", headers, body: JSON.stringify({ id: crypto.randomUUID(), parameters: [], queries }) });
    const responseText = await response.text();
    let data;
    try { data = responseText ? JSON.parse(responseText) : {}; }
    catch { throw new Error(`Graylog вернул не JSON: HTTP ${response.status}`); }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message || data.type || "ошибка Graylog"}`);
    if (data.execution?.completed_exceptionally || data.execution?.cancelled || data.execution?.done === false || data.errors?.length) throw new Error("Graylog не завершил проверку alias-полей");
    const counts = {};
    for (const [key, entry] of Object.entries(ids)) {
      const queryResult = data.results?.[entry.queryId];
      const searchType = queryResult?.search_types?.[entry.typeId];
      if (!searchType || searchType.errors?.length || (queryResult?.errors && Object.keys(queryResult.errors).length)) {
        const details = [...(data.errors || []), ...Object.values(queryResult?.errors || {})].map((item) => item?.description || item?.message).filter(Boolean).join("; ");
        throw new Error(`Нет результата probe ${key}${details ? `: ${details}` : ""}`);
      }
      // The pivot's own total is the number of matching messages and is
      // present even when there are none; a groupless pivot may then return
      // no rows at all, which is a legitimate 0, not a missing result.
      const total = Number(searchType.total);
      const cells = (searchType.rows || []).flatMap((row) => row.values || []);
      const cell = cells.length === 1 ? Number(cells[0].value) : NaN;
      const count = Number.isFinite(total) && total >= 0 ? total : Number.isFinite(cell) && cell >= 0 ? cell : cells.length === 0 ? 0 : NaN;
      if (!Number.isFinite(count)) throw new Error(`Неожиданная форма ответа probe ${key}`);
      counts[key] = count;
    }
    return { counts };
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

async function fetchReleaseCheckInGraylog(definition, streamIds, startMs, endMs, mode, interval, branchAware, historyMs = 24 * 60 * 60 * 1000, includeAliases = true) {
  try {
    const current = new URL(location.href);
    const searchIndex = current.pathname.toLowerCase().lastIndexOf("/search");
    if (searchIndex < 0) throw new Error("Текущая вкладка не является страницей поиска Graylog");
    const beforeSearch = current.pathname.slice(0, searchIndex);
    const streamRouteIndex = beforeSearch.toLowerCase().lastIndexOf("/streams/");
    const basePath = streamRouteIndex >= 0 ? beforeSearch.slice(0, streamRouteIndex) : beforeSearch;
    const endpoint = new URL(`${basePath}/api/views/search/sync?timeout=60000`, current.origin).toString();
    const searchId = crypto.randomUUID();
    const querySpecs = mode === "history"
      ? [{ key: "history", from: startMs - historyMs, to: startMs }]
      : [{ key: "current", from: startMs, to: endMs }];
    const identifiers = {};
    const branchDimensions = [...new Set(["service-name", "branch", ...definition.dimensions])];
    const pivot = (id, name, timeInterval, dimensions) => ({
      id, type: "pivot", name,
      row_groups: [{ type: "time", field: "timestamp", interval: { type: "timeunit", timeunit: timeInterval } }],
      column_groups: dimensions.map((field, index) => ({
        type: "values", field,
        limit: field === "service-name" || field === "instance-name" ? 30 : field === "branch" || field === "instance-version" ? 8 : index === 0 ? 30 : 10
      })),
      series: [{ type: "count", id: "count()", field: null }], rollup: false
    });
    const queries = [];
    const aliasesFor = (fields) => {
      const aliasable=fields.map((field,index)=>field === "service-name" || field === "branch" ? index : -1).filter(index=>index>=0);
      const variants=[];
      for(let mask=1;mask<(1<<aliasable.length);mask++){
        const actual=[...fields],clauses=[];
        aliasable.forEach((index,bit)=>{
          const canonical=fields[index],alias=canonical === "service-name" ? "instance-name" : "instance-version";
          if(mask&(1<<bit)){actual[index]=alias;clauses.push(`NOT _exists_:${canonical}`,`_exists_:${alias}`);}
          else clauses.push(`_exists_:${canonical}`);
        });
        variants.push({actual,clauses});
      }
      return variants;
    };
    for (const spec of querySpecs) {
      const queryId = crypto.randomUUID();
      const chartId = mode === "history" ? null : crypto.randomUUID();
      const branchId = branchAware ? crypto.randomUUID() : null;
      const totalId = branchAware ? crypto.randomUUID() : null;
      const ids=identifiers[spec.key] = { queryId, totalId, chart:[], branch:[] };
      const searchTypes = [];
      if (chartId) {searchTypes.push(pivot(chartId, `release-${definition.id}-${spec.key}`, interval, definition.dimensions));ids.chart.push({queryId,typeId:chartId,actual:definition.dimensions,canonical:definition.dimensions});}
      if (branchId) {searchTypes.push(pivot(branchId, `release-${definition.id}-${spec.key}-branches`, "1d", branchDimensions));ids.branch.push({queryId,typeId:branchId,actual:branchDimensions,canonical:branchDimensions});}
      if (totalId) searchTypes.push({id:totalId,type:"pivot",name:"error-total",row_groups:[],column_groups:[],series:[{type:"count",id:"count()",field:null}],rollup:false});
      const baseQuery = {
        id: queryId,
        query: { type: "elasticsearch", query_string: definition.query },
        timerange: { type: "absolute", from: new Date(spec.from).toISOString(), to: new Date(spec.to).toISOString() },
        filter: { type: "or", filters: streamIds.map((id) => ({ type: "stream", id })) },
        search_types: searchTypes
      };
      queries.push(baseQuery);
      // Alias variants exist only to catch messages logged under
      // instance-name/instance-version instead of service-name/branch. When
      // the caller's probe found no such messages in this window they are
      // skipped: the branch total-vs-points check below still flags the
      // result incomplete if the probe was ever wrong.
      if (includeAliases) for(const [resultType,fields,timeInterval] of [["chart",definition.dimensions,interval],["branch",branchDimensions,"1d"]]){
        if(resultType === "chart" && !chartId || resultType === "branch" && !branchId)continue;
        for(const [index,variant] of aliasesFor(fields).entries()){
          const aliasQueryId=crypto.randomUUID(),aliasTypeId=crypto.randomUUID();
          queries.push({id:aliasQueryId,query:{type:"elasticsearch",query_string:`(${definition.query}) AND ${variant.clauses.join(" AND ")}`},timerange:baseQuery.timerange,filter:baseQuery.filter,
            search_types:[pivot(aliasTypeId,`release-${definition.id}-${spec.key}-${resultType}-alias-${index+1}`,timeInterval,variant.actual)]});
          ids[resultType].push({queryId:aliasQueryId,typeId:aliasTypeId,actual:variant.actual,canonical:fields});
        }
      }
    }
    const headers = { Accept: "application/json", "Content-Type": "application/json", "X-Requested-By": "graylog-release-monitor" };
    const storedSession = globalThis.localStorage?.getItem("sessionId") || "";
    let sessionId = storedSession;
    try { sessionId = JSON.parse(storedSession); } catch {}
    if (typeof sessionId === "string" && sessionId) headers.Authorization = `Basic ${btoa(`${sessionId}:session`)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers,
      body: JSON.stringify({ id: searchId, parameters: [], queries })
    });
    const responseText = await response.text();
    let data;
    try { data = responseText ? JSON.parse(responseText) : {}; }
    catch { throw new Error(`Graylog вернул не JSON: HTTP ${response.status}`); }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message || data.type || "ошибка Graylog"}`);

    let incomplete = Boolean(data.execution?.completed_exceptionally || data.execution?.cancelled || data.execution?.done === false || (Array.isArray(data.errors) && data.errors.length));

    const parse = (key, resultType, fieldNames) => {
      const ids = identifiers[key],entries=ids[resultType]||[];
      if (!entries.length) return [];
      const points = [];
      for(const entry of entries){
      const queryResult = data.results?.[entry.queryId];
      if (queryResult?.errors && Object.keys(queryResult.errors).length || queryResult?.execution?.done === false || queryResult?.execution?.completed_exceptionally || queryResult?.execution?.cancelled) incomplete = true;
      const searchType = queryResult?.search_types?.[entry.typeId];
      if (!searchType) {
        const details = data.errors?.map((item) => item.description || item.message).filter(Boolean).join("; ");
        throw new Error(`Нет результата ${key}${details ? `: ${details}` : ""}`);
      }
      for (const row of searchType.rows || []) {
        const time = Array.isArray(row.key) && row.key[0] ? String(row.key[0]) : new Date(startMs).toISOString();
        for (const cell of row.values || []) {
          if (cell.value == null || !Number.isSafeInteger(Number(cell.value)) || Number(cell.value) < 0 || !Array.isArray(cell.key)) { incomplete = true; continue; }
          const dimensionValues = cell.key.filter((value) => !["count", "count()"].includes(String(value).toLowerCase()));
          const values=dimensionValues.slice(0,entry.actual.length).map(value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,160):'');
          if (dimensionValues.length < entry.actual.length || values.some(value => !value)) { incomplete = true; continue; }
          const fields = Object.fromEntries(entry.canonical.map((field, index) => [field, values[index]]));
          const signature = definition.dimensions.map((field) => fields[field]).filter((value) => value !== undefined).join(" · ");
          points.push({ time, signature, service: fields["service-name"] || "", branch: fields.branch || "", fields, count: Number(cell.value) });
        }
      }
      if (((Number(searchType.total) > 0 || searchType.rows?.length > 0) && !points.length) || !Array.isArray(searchType.rows) || (Array.isArray(searchType.errors) && searchType.errors.length)) incomplete = true;
      }
      if (resultType === "branch") {
        const total = data.results?.[ids.queryId]?.search_types?.[ids.totalId];
        const cells = (total?.rows || []).flatMap(row => row.values || []);
        const count = cells.length === 1 ? Number(cells[0].value) : NaN;
        if (!Number.isFinite(count) || count !== points.reduce((sum, point) => sum + point.count, 0) || total?.errors?.length) incomplete = true;
        // Values pivots keep only top buckets. A saturated dimension cannot prove absence.
        const buckets = new Map();
        for (const point of points) fieldNames.forEach((field, index) => {
          const key = JSON.stringify([point.time, ...fieldNames.slice(0, index).map(name => point.fields[name])]);
          const entryKey = `${index}:${key}`;
          if (!buckets.has(entryKey)) buckets.set(entryKey, new Set());
          const values = buckets.get(entryKey); values.add(point.fields[field]);
          if (values.size >= (field === "service-name" ? 30 : field === "branch" ? 8 : index === 0 ? 30 : 10)) incomplete = true;
        });
      }
      return points;
    };

    const result = mode === "history"
      ? { current: [], branchCurrent: [], history: [], branchHistory: parse("history", "branch", branchDimensions) }
      : { current: parse("current", "chart", definition.dimensions), branchCurrent: parse("current", "branch", branchDimensions), history: [], branchHistory: [] };
    return { ...result, incomplete };
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

function chartData(points) {
  const seriesTotals = ReleaseAnalysis.aggregateBySignature(points);
  const topSeries = [...seriesTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);
  const buckets = [...new Set(points.map((point) => point.time))].sort();
  const values = new Map();
  for (const point of points) {
    if (!topSeries.includes(point.signature)) continue;
    values.set(`${point.time}\u0000${point.signature}`, (values.get(`${point.time}\u0000${point.signature}`) || 0) + point.count);
  }
  return { topSeries, buckets, values };
}

function chartPointAttributes(label, first = false) {
  const escaped = escapeHtml(label);
  return `data-chart-point data-chart-tooltip="${escaped}" aria-label="${escaped}" role="graphics-symbol" tabindex="${first ? 0 : -1}"`;
}

function chartPointTime(time) {
  return new Date(time).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " МСК";
}

function chartLegendMarkup(series) {
  return `<div class="chart-legend" aria-label="Видимость рядов">${series.map((name, index) => `<button type="button" class="legend-item" data-chart-toggle="${index}" aria-pressed="true" title="Показать или скрыть ряд; шкала сохраняется"><i class="legend-dot legend-${index}" aria-hidden="true"></i>${escapeHtml(name)}</button>`).join("")}</div>`;
}

function barChartMarkup(points) {
  if (!points.length) return '<div class="chart-empty">Событий за период нет</div>';
  const colors = ["#43d9c7", "#60a5fa", "#ffb454", "#c084fc", "#ff6870"];
  const { topSeries, buckets, values } = chartData(points);
  const bucketTotals = buckets.map((time) => topSeries.reduce((sum, name) => sum + (values.get(`${time}\u0000${name}`) || 0), 0));
  const maximum = Math.max(1, ...bucketTotals);
  const width = 720;
  const height = 132;
  const plotTop = 8;
  const plotBottom = 108;
  const plotHeight = plotBottom - plotTop;
  const left = 34;
  const right = 710;
  const slot = (right - left) / Math.max(1, buckets.length);
  const barWidth = Math.max(2, Math.min(22, slot * 0.72));
  const bars = [];
  buckets.forEach((time, bucketIndex) => {
    let y = plotBottom;
    topSeries.forEach((name, seriesIndex) => {
      const value = values.get(`${time}\u0000${name}`) || 0;
      if (!value) return;
      const segmentHeight = value / maximum * plotHeight;
      y -= segmentHeight;
      const x = left + bucketIndex * slot + (slot - barWidth) / 2;
      bars.push(`<rect data-chart-series="${seriesIndex}" ${chartPointAttributes(`${chartPointTime(time)}\n${name}: ${number(value)} событий`, bars.length === 0)} x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, segmentHeight).toFixed(1)}" rx="1.5" fill="${colors[seriesIndex]}"></rect>`);
    });
  });
  const firstLabel = new Date(buckets[0]).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
  const lastLabel = new Date(buckets[buckets.length - 1]).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
  const svg = `<svg class="monitor-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="График количества ошибок">
    <line class="chart-grid" x1="${left}" y1="${plotTop}" x2="${right}" y2="${plotTop}" />
    <line class="chart-grid" x1="${left}" y1="${plotBottom}" x2="${right}" y2="${plotBottom}" />
    <text class="chart-label" x="0" y="12">${number(maximum)}</text><text class="chart-label" x="18" y="112">0</text>
    ${bars.join("")}
    <text class="chart-label" x="${left}" y="126">${escapeHtml(firstLabel)}</text>
    <text class="chart-label" x="${right}" y="126" text-anchor="end">${escapeHtml(lastLabel)}</text>
  </svg>`;
  return `<div data-chart-scope>${svg.replace('role="img"', 'role="group"')}${chartLegendMarkup(topSeries)}</div>`;
}

function lineChartMarkup(points) {
  if (!points.length) return '<div class="chart-empty">Событий за период нет</div>';
  const colors = ["#43d9c7", "#60a5fa", "#ffb454", "#c084fc", "#ff6870"];
  const { topSeries, buckets, values } = chartData(points);
  const maximum = Math.max(1, ...topSeries.flatMap((name) => buckets.map((time) => values.get(`${time}\u0000${name}`) || 0)));
  const left = 34, right = 710, top = 8, bottom = 108;
  const x = (index) => buckets.length === 1 ? (left + right) / 2 : left + index * (right - left) / (buckets.length - 1);
  const y = (value) => bottom - value / maximum * (bottom - top);
  const lines = topSeries.map((name, seriesIndex) => {
    const coordinates = buckets.map((time, index) => ({ x: x(index), y: y(values.get(`${time}\u0000${name}`) || 0), value: values.get(`${time}\u0000${name}`) || 0 }));
    const polyline = coordinates.length > 1 ? `<polyline points="${coordinates.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}" fill="none" stroke="${colors[seriesIndex]}" stroke-width="2"/>` : "";
    const dots = coordinates.map((point, index) => `<circle ${chartPointAttributes(`${chartPointTime(buckets[index])}\n${name}: ${number(point.value)} событий`, seriesIndex === 0 && index === 0)} cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="${colors[seriesIndex]}"></circle>`).join("");
    return `<g data-chart-series="${seriesIndex}">${polyline}${dots}</g>`;
  }).join("");
  const firstLabel = new Date(buckets[0]).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
  const lastLabel = new Date(buckets[buckets.length - 1]).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
  return `<div data-chart-scope><svg class="monitor-chart" viewBox="0 0 720 132" role="group" aria-label="Линейный график количества ошибок"><line class="chart-grid" x1="${left}" y1="${top}" x2="${right}" y2="${top}"/><line class="chart-grid" x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}"/><text class="chart-label" x="0" y="12">${number(maximum)}</text><text class="chart-label" x="18" y="112">0</text>${lines}<text class="chart-label" x="${left}" y="126">${escapeHtml(firstLabel)}</text><text class="chart-label" x="${right}" y="126" text-anchor="end">${escapeHtml(lastLabel)}</text></svg>${chartLegendMarkup(topSeries)}</div>`;
}

function chartTableMarkup(points) {
  if (!points.length) return '<div class="chart-empty">Событий за период нет</div>';
  const rows = [...points].sort((a, b) => b.count - a.count).slice(0, 200);
  return `<div class="chart-table"><table><thead><tr><th>Время</th><th>Признаки ошибки</th><th>Количество</th></tr></thead><tbody>${rows.map((point) => `<tr><td>${escapeHtml(new Date(point.time).toLocaleString("ru-RU"))}</td><td class="signature">${escapeHtml(point.signature)}</td><td>${number(point.count)}</td></tr>`).join("")}</tbody></table></div>`;
}

function chartMarkup(points, mode = "bars") {
  const summary = ReleaseAnalysis.summarizeTimeBuckets(points);
  const peakTime = summary ? new Date(summary.peakTime).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }) : "";
  const direction = summary?.direction === "up" ? `↑ на ${number(summary.change)}`
    : summary?.direction === "down" ? `↓ на ${number(Math.abs(summary.change))}`
      : summary?.direction === "flat" ? "без изменения" : "один интервал";
  const insight = summary ? `<div class="release-summary" aria-label="Сводка по временным интервалам"><span class="release-count">Пик: ${number(summary.peakCount)} · ${escapeHtml(peakTime)} МСК</span><span class="release-count">Последний интервал: ${number(summary.latestCount)}</span><span class="release-count">К предыдущему: ${direction}</span></div>` : "";
  if (mode === "lines") return insight + lineChartMarkup(points);
  if (mode === "table") return insight + chartTableMarkup(points);
  return insight + barChartMarkup(points);
}

function comparisonMarkup(definition, currentPoints, historyPoints, mode, options = {}) {
  const releaseMode = mode === "release";
  const comparison = releaseMode
    ? ReleaseAnalysis.compareReleaseBranches(currentPoints, [], options)
    : ReleaseAnalysis.comparePeriodSignatures(currentPoints, historyPoints, options);
  const { rows, newCount, knownCount, newEventCount, knownEventCount } = comparison;
  const visibleRows = rows.slice(0, 100);
  const reasons = {"previous-version-absent":"В выбранном периоде эта группа не встречается в предыдущей версии сервиса.","previous-version-match":"Такая группа есть в предыдущей версии этого сервиса.","single-version":"Найдена только одна версия сервиса: сравнение не выполнялось.","no-numeric-version":"Числовая версия branch не определена: сравнение не выполнялось.","incomplete-data":"Выборка неполна: отсутствие ошибки в предыдущей версии не подтверждено."};
  const noveltyTooltip = (row) => releaseMode
    ? reasons[row.reason] || row.noveltyReason || "Сравнение с предыдущей версией этого сервиса внутри выбранного периода."
    : `${row.isNew ? "Не встречалось" : "Встречалось"} в истории перед периодом (не менее ${(options.historyMs || 86400000) / 3600000} ч, вплотную к его началу).`;
  // Округление отношения: «×12» читается, «×12.3471» нет. Ниже десяти
  // показывается один знак, чтобы ×5.4 не превращалось в ×5.
  const spikeRatio = (ratio) => ratio >= 10 ? String(Math.round(ratio)) : (Math.round(ratio * 10) / 10).toString().replace(".", ",");
  const perHour = (value) => value >= 10 ? number(Math.round(value)) : (Math.round(value * 10) / 10).toString().replace(".", ",");
  const spikeTooltip = (row) => `Признак не новый, но его частота выросла: ${perHour(row.spike.periodPerHour)} событий в час за период против ${perHour(row.spike.historyPerHour)} в час за историю — в ${spikeRatio(row.spike.ratio)} раза. Сравниваются частоты, а не сырые числа: окна разной длины. Порог: не менее ${ReleaseAnalysis.SPIKE_MIN_EVENTS} событий за период и рост не менее чем в ${ReleaseAnalysis.SPIKE_MIN_RATIO} раз. Рост частоты сам по себе не доказывает, что причина в этом релизе.`;
  const newSummary = visibleRows.filter((row) => row.isNew).map((row) => {
    return `<div class="new-event-summary"><div class="new-event-summary-text"><strong>${releaseEventCountLabel(row.count)}</strong> · ${escapeHtml(row.service)} · ${escapeHtml(row.signature)}</div></div>`;
  }).join("");
  const spikeRows = releaseMode ? [] : rows.filter(row => row.spike);
  const spikeSummary = spikeRows.slice(0, 100).map(row => `<div class="new-event-summary"><div class="new-event-summary-text"><span class="novelty novelty-known">Известная</span> <span class="novelty novelty-spike" tabindex="0" title="${escapeHtml(spikeTooltip(row))}" aria-label="${escapeHtml(spikeTooltip(row))}" data-tooltip="${escapeHtml(spikeTooltip(row))}">Всплеск ×${spikeRatio(row.spike.ratio)}</span> <strong>${releaseEventCountLabel(row.count)}</strong> · ${escapeHtml(row.service)} · ${escapeHtml(row.signature)}<p class="hint">${perHour(row.spike.periodPerHour)} событий/ч за период · ${perHour(row.spike.historyPerHour)} событий/ч в истории</p></div></div>`).join("");
  const newSummaryHtml = (newSummary ? `<div class="new-event-summary-list" aria-label="${releaseMode ? "Новые в релизе" : "Новое за период"}">${newSummary}</div>` : "") + (spikeSummary ? `<div class="new-event-summary-list" aria-label="Известные ошибки со всплеском"><p class="hint">Известных со всплеском: ${number(spikeRows.length)}${spikeRows.length > 100 ? " · показаны первые 100" : ""}</p>${spikeSummary}</div>` : "");
  const table = rows.length ? `<div class="comparison-table"><table><thead><tr><th>Статус</th><th>Сервис</th><th>Последняя версия</th><th>Признаки ошибки</th><th>В последней</th><th>В предыдущей версии</th></tr></thead><tbody>${visibleRows.map((row) => `<tr>
    <td><span class="novelty novelty-${row.novelty || (row.isNew ? "new" : "known")}" tabindex="0" title="${escapeHtml(noveltyTooltip(row))}" aria-label="${escapeHtml(noveltyTooltip(row))}" data-tooltip="${escapeHtml(noveltyTooltip(row))}">${row.isNew ? "Новая" : row.novelty === "unknown" ? "Без сравнения" : "Известная"}</span>${row.spike ? `<span class="novelty novelty-spike" tabindex="0" title="${escapeHtml(spikeTooltip(row))}" aria-label="${escapeHtml(spikeTooltip(row))}" data-tooltip="${escapeHtml(spikeTooltip(row))}">Всплеск ×${spikeRatio(row.spike.ratio)}</span>` : ""}</td>
    <td class="signature">${escapeHtml(row.service)}</td><td><code>${escapeHtml(row.currentBranches.join(", ") || "—")}</code></td><td class="signature">${escapeHtml(row.signature)}</td><td class="${row.isNew ? "new-event-number" : ""}">${number(row.count)}</td><td>${row.novelty === "unknown" && !row.previousBranches.length ? "—" : number(row.previous)}${row.previousBranches.length ? `<small class="branch-history">${escapeHtml(row.previousBranches.join(", "))}</small>` : ""}</td>
  </tr>`).join("")}</tbody></table></div>` : '<div class="chart-empty">В последней версии ошибок этой категории не найдено в доступной выборке.</div>';
  const services = (comparison.serviceSummaries || []).map(item => `<div class="release-service-summary"><strong>${escapeHtml(item.service)}</strong><p>В последней версии <code>${escapeHtml(item.latestBranch || "не определена")}</code> — ${releaseEventCountLabel(item.latestEventCount)} ошибок этой категории: <b>${number(item.newEventCount)} новых</b>, ${number(item.knownEventCount)} известных, ${number(item.unknownEventCount - (item.unversionedEventCount || 0))} без сравнения.</p>${item.unversionedEventCount ? `<p>Ещё ${releaseEventCountLabel(item.unversionedEventCount)} без числовой версии — сравнение не выполнялось.</p>` : ''}<small>${item.previousBranch ? `Сравнение с <code>${escapeHtml(item.previousBranch)}</code> · внутри выбранного периода` : "Предыдущая версия не найдена — сравнение не выполнялось."}</small></div>`).join("");
  return {
    html: `${services}<div class="release-summary"><span class="release-count new">Новых событий: ${number(newEventCount)}</span><span class="release-count">Известных: ${number(knownEventCount)}</span><span class="release-count">Без сравнения: ${number(comparison.unknownEventCount || 0)}</span><span class="release-count">Групп: ${number(newCount)} новых · ${number(knownCount)} известных</span></div>${options.complete === false ? `<p class="hint">${releaseMode ? "Выборка неполна. Метка «новая» не присваивается." : "Выборка неполна: отсутствие признака в истории не подтверждено, метка «новая» здесь может быть завышена."}</p>` : ''}${table}${rows.length > visibleRows.length ? '<p class="hint">Показаны первые 100 групп; счётчики учитывают все загруженные группы.</p>' : ''}`,
    newSummaryHtml,
    newEventCount,
    knownEventCount,
    unknownEventCount: comparison.unknownEventCount || 0,
    latestEventCount: releaseMode ? (comparison.serviceSummaries || []).reduce((sum, item) => sum + item.latestEventCount, 0) : rows.reduce((sum, row) => sum + row.count, 0)
  };
}

function monitorCardShell(definition) {
  return `<details id="monitor-${definition.id}" class="monitor-card" open>
    <summary class="monitor-card-head"><div class="monitor-card-title"><h3>${escapeHtml(definition.title)}</h3><code>${escapeHtml(definition.dimensions.join(" + "))}</code></div><div class="monitor-card-tools"><div class="destination-group" title="Открыть в Graylog"><span class="destination-icon graylog-icon">G</span><button class="open-graylog-filter" type="button" data-check-id="${escapeHtml(definition.id)}">Поиск</button><button class="open-graylog-trace" type="button" data-trace-check-id="${escapeHtml(definition.id)}">Трейс</button></div><span class="monitor-status">Ожидает</span><span class="monitor-chevron">⌄</span></div></summary>
    <div class="monitor-card-body"><div class="chart-empty">Нажмите «Запустить»</div></div>
  </details>`;
}

function updateReleaseTotals() {
  releaseUi.newTotal.textContent = number(releaseTotals.newEvents);
  const newEventsCard = releaseUi.newTotal.closest(".card");
  newEventsCard?.classList.toggle("new-events-zero", releaseTotals.newEvents === 0);
  newEventsCard?.classList.toggle("new-events-positive", releaseTotals.newEvents > 0);
  releaseUi.knownTotal.textContent = number(releaseTotals.knownEvents);
  releaseUi.eventsTotal.textContent = number(releaseTotals.events);
  const unknown = document.querySelector("#unknown-events-total");
  if (unknown) unknown.textContent = number(releaseTotals.unknownEvents || 0);
}

async function ensureReleaseVersionInventory(forceRefresh = false) {
  if (releaseVersionInventory) return releaseVersionInventory;
  const scope = releaseComparisonScope;
  if (!scope) return {versionPoints:[], incomplete:true};
  activeTab = await chrome.tabs.get(activeTab.id);
  const key = JSON.stringify([activeTab.url,"release-versions",scope.streamIds,scope.startMs,scope.endMs]);
  const cached = releaseCache.get(key);
  if (!forceRefresh && cached && (scope.endMs < Date.now() - 60000 || Date.now() - cached.savedAt < RELEASE_CURRENT_CACHE_MS)) {
    releaseVersionInventory = cached.result; return releaseVersionInventory;
  }
  const audit = QueryAudit.begin({area:"Мониторинг · версии сервисов",query:"*",streams:scope.streamIds,startMs:scope.startMs,endMs:scope.endMs,aggregation:"service-name × branch × count(); всего count()"});
  try {
    const execution = await chrome.scripting.executeScript({target:{tabId:activeTab.id},world:"MAIN",func:fetchReleaseVersionsInGraylog,args:[scope.streamIds,scope.startMs,scope.endMs]});
    const result = execution[0]?.result;
    if (execution[0]?.error || result?.error || !Array.isArray(result?.versionPoints)) throw new Error(result?.error || execution[0]?.error?.message || "Не удалось определить версии сервисов");
    releaseVersionInventory = result;
    releaseCache.set(key,{result,savedAt:Date.now()});
    audit.finish("success",result.versionPoints.length);
  } catch (error) {
    audit.finish("error", null, error?.message || String(error));
    releaseVersionInventory = {versionPoints:[],incomplete:true};
    showReleaseError(`Сравнение релиза неполное: ${error.message}`);
  }
  return releaseVersionInventory;
}

function monitorComparisonOptions(result) {
  const services = new Set((result.branchCurrent || []).map(point => point.service));
  // Only "Проверка релиза" fetches the version inventory, and only it compares
  // against other versions - so only there does a missing inventory make the
  // sample incomplete. Judging "Новое за период" by an inventory it never
  // requests left complete === false on every run, and the card claimed the
  // sample was incomplete while still labelling rows "Новая".
  const releaseMode = releaseUi.mode.value === "release";
  const complete = releaseMode ? !result.incomplete && releaseVersionInventory?.incomplete === false : !result.incomplete;
  const periodMs = releaseComparisonScope ? releaseComparisonScope.endMs - releaseComparisonScope.startMs : 0;
  return {versionPoints:(releaseVersionInventory?.versionPoints || []).filter(point => services.has(point.service)),complete,historyMs:releaseComparisonScope?.historyMs,periodMs,historySpanMs:result.historySpanMs || releaseComparisonScope?.historyMs};
}

// One probe per window (not per check): cached alongside the check results
// with the same freshness rule, so a full run costs one extra tiny query
// instead of four alias-variant queries per check. Any probe failure means
// "assume aliases exist" - the slower but complete behaviour.
async function releaseAliasesPresent(streamIds, fromMs, toMs, forceRefresh = false) {
  const cacheKey = JSON.stringify(["alias-probe", activeTab.url, streamIds, fromMs, toMs]);
  const cached = releaseCache.get(cacheKey);
  const touchesNow = toMs >= Date.now() - 60_000;
  // A failed probe is remembered only briefly: long enough that one failing
  // window costs one request per run rather than one per check, short enough
  // that a transient 'Failed to fetch' (the Graylog tab reloading at the
  // moment the run starts) does not switch the whole next run off the fast
  // path.
  const maxAge = cached?.failed ? RELEASE_PROBE_FAILURE_CACHE_MS : touchesNow ? RELEASE_CURRENT_CACHE_MS : Infinity;
  if (!forceRefresh && cached && Date.now() - cached.savedAt < maxAge) return cached.result;
  const audit = QueryAudit.begin({ area: "Мониторинг · probe alias-полей", query: "(NOT _exists_:service-name AND _exists_:instance-name) OR (NOT _exists_:branch AND _exists_:instance-version)", streams: streamIds, startMs: fromMs, endMs: toMs, aggregation: "count()" });
  let present = true, failed = false;
  const probe = async () => {
    const execution = await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, world: "MAIN", func: probeReleaseAliasesInGraylog, args: [streamIds, [{ key: "window", from: fromMs, to: toMs }]] });
    const result = execution[0]?.result;
    if (execution[0]?.error || result?.error || !Number.isFinite(result?.counts?.window)) throw new Error(result?.error || execution[0]?.error?.message || "Нет результата probe");
    return result.counts.window;
  };
  try {
    let count;
    try { count = await probe(); }
    catch (firstError) {
      // One retry after a short pause covers the tab-still-loading case.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try { count = await probe(); } catch { throw firstError; }
    }
    present = count > 0;
    audit.finish("success", count);
  } catch (error) {
    failed = true;
    audit.finish("error", null, `Probe не удался, alias-варианты включены: ${error?.message || error}`);
  }
  releaseCache.set(cacheKey, { result: present, savedAt: Date.now(), failed });
  BoundedCache.pruneCache(releaseCache, RELEASE_CACHE_LIMIT);
  return present;
}

async function executeReleasePhase(definition, startMs, endMs, phase, interval, forceRefresh = false, branchAware = false) {
  activeTab = await chrome.tabs.get(activeTab.id);
  const streamIds = releaseComparisonScope?.streamIds || currentReleaseStreams();
  const historyMs = releaseComparisonScope?.historyMs || 86400000;

  // One Graylog call. For the history phase the window is [edgeMs - windowMs,
  // edgeMs]; for the base phase it is the picked [startMs, endMs] and both
  // arguments are ignored in favour of those bounds.
  const runWindow = async (edgeMs, windowMs, auditSuffix = "") => {
    const cacheKey = JSON.stringify([activeTab.url, definition.id, streamIds, edgeMs, phase === "history" ? windowMs : endMs, phase, interval, branchAware, historyMs]);
    const cached = releaseCache.get(cacheKey);
    // A window whose end already passed is done changing; only one still
    // touching "now" deserves the 60s distrust.
    const touchesNow = (phase === "history" ? edgeMs : endMs) >= Date.now() - 60_000;
    if (!forceRefresh && cached && (!touchesNow || Date.now() - cached.savedAt < RELEASE_CURRENT_CACHE_MS)) return cached.result;

    const queryStart = phase === "history" ? edgeMs - windowMs : startMs;
    const queryEnd = phase === "history" ? edgeMs : endMs;
    const auditDimensions = branchAware ? [...new Set(["service-name", "branch", ...definition.dimensions])] : definition.dimensions;
    const aggregation = phase === "history"
      ? `timestamp 1d × ${auditDimensions.join(" × ")} × count()`
      : branchAware
        ? `график: timestamp ${interval} × ${definition.dimensions.join(" × ")} × count(); branch: timestamp 1d × ${auditDimensions.join(" × ")} × count()`
        : `timestamp ${interval} × ${definition.dimensions.join(" × ")} × count()`;
    const includeAliases = await releaseAliasesPresent(streamIds, queryStart, queryEnd, forceRefresh);
    const audit = QueryAudit.begin({ area: `Мониторинг · ${definition.title}${phase === "history" ? ` · история${auditSuffix}` : ""}`, query: definition.query, streams: streamIds, startMs: queryStart, endMs: queryEnd, aggregation: `${aggregation}${includeAliases ? "" : "; alias-варианты пропущены (probe: 0)"}` });
    try {
      const execution = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        world: "MAIN",
        func: fetchReleaseCheckInGraylog,
        args: [definition, streamIds, edgeMs, endMs, phase, interval, branchAware, windowMs, includeAliases]
      });
      if (execution[0]?.error) throw new Error(execution[0].error.message || String(execution[0].error));
      const result = execution[0]?.result;
      if (result?.error) throw new Error(result.error);
      if (!Array.isArray(result?.current) || !Array.isArray(result?.history) || !Array.isArray(result?.branchCurrent) || !Array.isArray(result?.branchHistory)) throw new Error("Не удалось получить данные");
      const countedPoints = phase === "history" ? result.branchHistory : result.current;
      const resultCount = countedPoints.reduce((sum, point) => sum + (Number(point.count) || 0), 0);
      audit.finish("success", resultCount);
      releaseCache.set(cacheKey, { result, savedAt: Date.now() });
      BoundedCache.pruneCache(releaseCache, RELEASE_CACHE_LIMIT);
      return result;
    } catch (error) {
      audit.finish("error", null, error?.message || String(error));
      throw error;
    }
  };

  if (phase !== "history") return runWindow(startMs, historyMs);

  // The heavy 24h window is anchored to the hour so its cache key stops
  // shifting with "Конец периода" and a re-run reuses it. Anchoring alone
  // would leave [anchorMs, startMs] - up to 59 minutes immediately before the
  // period - covered by neither window, and a signature last seen in that gap
  // would be reported as new. So the anchored window is followed by a second,
  // short query for the gap itself, and the two are merged. The gap query
  // spans under an hour against the anchored window's 24h, and is skipped
  // entirely when the period starts exactly on the hour.
  const anchorMs = Math.floor(startMs / RELEASE_HISTORY_ANCHOR_MS) * RELEASE_HISTORY_ANCHOR_MS;
  const anchored = await runWindow(anchorMs, historyMs);
  const gapMs = startMs - anchorMs;
  // Фактически покрытый историей промежуток: он шире выбранного окна ровно на
  // стык. Сравнение частот ниже по течению должно делить на него, а не на
  // заявленные N ч, иначе рост будет завышен.
  if (gapMs <= 0) return { ...anchored, historySpanMs: historyMs };
  const gap = await runWindow(startMs, gapMs, " · стык");
  // The windows do not overlap, so counts add and branches union per
  // service+signature exactly as ReleaseAnalysis already folds them.
  return {
    ...anchored,
    history: [...(anchored.history || []), ...(gap.history || [])],
    branchHistory: [...(anchored.branchHistory || []), ...(gap.branchHistory || [])],
    historySpanMs: historyMs + gapMs,
    incomplete: anchored.incomplete === true || gap.incomplete === true
  };
}

function sortMonitorCardsByEvents() {
  const originalOrder = new Map(RELEASE_CHECKS.map((definition, index) => [definition.id, index]));
  const cards = [...releaseUi.results.querySelectorAll(".monitor-card")];
  cards.sort((left, right) => (releaseUi.mode.value === "release" ? Number(right.dataset.newEvents ?? -1) - Number(left.dataset.newEvents ?? -1) || Number(right.dataset.latestEvents ?? -1) - Number(left.dataset.latestEvents ?? -1) : 0)
    || Number(right.dataset.events ?? -1) - Number(left.dataset.events ?? -1)
    || originalOrder.get(left.id.replace("monitor-", "")) - originalOrder.get(right.id.replace("monitor-", "")));
  for (const card of cards) releaseUi.results.appendChild(card);
}

async function runReleaseMonitor(forceRefresh = false) {
  if (releaseLoading || globalThis.__graylogTraceLookupLoading === true || globalThis.GraylogHttpActions?.busy?.("monitor")) return;
  setMonitorEmptyState(false);
  const checks = RELEASE_CHECKS;
  let successfulChecks = 0;
  let hasIncompleteResult = false;
  const endMs = new Date(releaseUi.end.value).getTime();
  const rangeSeconds = Number(releaseUi.range.value);
  if (!Number.isFinite(endMs)) {
    showReleaseError("Укажите конец периода");
    globalThis.Clippy?.show?.("error");
    return;
  }
  const startMs = endMs - rangeSeconds * 1000;
  const mode = releaseUi.mode.value;
  const interval = monitorInterval(rangeSeconds);
  const finishCompanion = globalThis.Clippy?.begin?.("loading");
  let companionOutcome = "error";
  try {
  releaseLoading = true;
  releaseUi.mode.disabled = true;
  releaseUi.streamMode.disabled = true;
  releaseUi.error.hidden = true;
  releaseUi.run.disabled = true;
  releaseUi.refresh.disabled = true;
  releaseUi.run.textContent = `Проверяю 0/${checks.length}`;
  releaseTotals.newEvents = 0;
  releaseTotals.knownEvents = 0;
  releaseTotals.events = 0;
  releaseTotals.unknownEvents = 0;
  releaseComparisonScope = {startMs,endMs,historyMs:Number(releaseUi.historyRange?.value || 86400)*1000,streamIds:currentReleaseStreams()};
  releaseVersionInventory = null;
  updateReleaseTotals();
  releaseRenderedResults.clear();
  releaseUi.results.innerHTML = checks.map(monitorCardShell).join("");
  if (mode === "release") {
    await ensureReleaseVersionInventory(forceRefresh);
    hasIncompleteResult ||= releaseVersionInventory?.incomplete === true;
  }
  setMonitorModeNote();

  for (let index = 0; index < checks.length; index += 1) {
    const definition = checks[index];
    const card = document.querySelector(`#monitor-${definition.id}`);
    const status = card.querySelector(".monitor-status");
    const body = card.querySelector(".monitor-card-body");
    status.textContent = "Загрузка…";
    releaseUi.run.textContent = `Проверяю ${index + 1}/${checks.length}`;
    try {
      const currentResult = await executeReleasePhase(definition, startMs, endMs, "base", interval, forceRefresh, true);
      hasIncompleteResult ||= currentResult.incomplete === true;
      const result = { current: currentResult.current, history: [], branchCurrent: currentResult.branchCurrent || [], branchHistory: [], incomplete:currentResult.incomplete === true, historyLoaded:false };
      if (result.current.length && mode !== "release") {
        const historical = await executeReleasePhase(definition, startMs, endMs, "history", "1h", forceRefresh, true);
        hasIncompleteResult ||= historical.incomplete === true;
        result.branchHistory = historical.branchHistory || [];
        result.historySpanMs = historical.historySpanMs;
        result.historyLoaded = true;
      }
      const events = result.current.reduce((sum, point) => sum + point.count, 0);
      card.dataset.events = String(events);
      releaseTotals.events += events;
      const comparison = comparisonMarkup(definition, result.branchCurrent, result.branchHistory, mode, monitorComparisonOptions(result));
      card.dataset.newEvents = String(comparison.newEventCount);
      card.dataset.latestEvents = String(comparison.latestEventCount || 0);
      releaseTotals.newEvents += comparison.newEventCount;
      releaseTotals.knownEvents += comparison.knownEventCount;
      releaseTotals.unknownEvents += comparison.unknownEventCount || 0;
      const comparisonHtml = mode === "release" ? comparison.html : comparison.newSummaryHtml;
      releaseRenderedResults.set(definition.id, { result, comparisonHtml });
      body.innerHTML = mode === "release" ? comparisonHtml + '<p class="hint">Динамика за выбранный период · все версии сервиса</p>' + chartMarkup(result.current, releaseUi.chartMode.value) : chartMarkup(result.current, releaseUi.chartMode.value) + comparisonHtml;
      status.textContent = mode === "release" ? `${comparison.newEventCount} новых · ${comparison.latestEventCount || 0} в последней версии` : releaseEventCountLabel(events);
      status.className = `monitor-status ${comparison.newEventCount > 0 ? "bad" : comparison.unknownEventCount > 0 ? "" : "ok"}`;
      successfulChecks++;
    } catch (error) {
      const message = error.message || String(error);
      card.dataset.events = "-1";
      status.textContent = "Ошибка запроса";
      status.className = "monitor-status bad";
      body.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
      if (/(?:HTTP\s*)?401|unauthori[sz]ed/i.test(message)) {
        showReleaseError(`${message}. Сначала завершите вход в исходной вкладке Graylog.`);
        for (let pending = index + 1; pending < checks.length; pending += 1) {
          const pendingCard = document.querySelector(`#monitor-${checks[pending].id}`);
          pendingCard.dataset.events = "-2";
          pendingCard.querySelector(".monitor-status").textContent = "Не выполнено · требуется вход";
        }
        updateReleaseTotals();
        break;
      }
    }
    updateReleaseTotals();
  }

  sortMonitorCardsByEvents();
  setMonitorEmptyState(checks.length > 0 && successfulChecks === checks.length && !hasIncompleteResult && releaseTotals.events === 0);
  companionOutcome = successfulChecks !== checks.length ? "error" : hasIncompleteResult ? "warning" : releaseTotals.events === 0 ? "empty" : "success";
  } finally {
  releaseLoading = false;
  releaseUi.mode.disabled = false;
  releaseUi.streamMode.disabled = globalThis.GraylogStreams?.environment?.() === "test";
  releaseUi.run.disabled = false;
  releaseUi.refresh.disabled = false;
  releaseUi.run.textContent = "Запустить";
  finishCompanion?.(companionOutcome);
  }
}

function selectedMonitorBounds() {
  const endMs = new Date(releaseUi.end.value).getTime();
  if (!Number.isFinite(endMs)) throw new Error("Укажите конец периода");
  return { endMs, startMs: endMs - Number(releaseUi.range.value) * 1000 };
}

async function openCheckInGraylog(definition) {
  const { startMs, endMs } = selectedMonitorBounds();
  activeTab = await chrome.tabs.get(activeTab.id);
  const target = new URL(activeTab.url);
  target.search = "";
  target.hash = "";
  target.searchParams.set("q", definition.query);
  target.searchParams.set("rangetype", "absolute");
  target.searchParams.set("from", new Date(startMs).toISOString());
  target.searchParams.set("to", new Date(endMs).toISOString());
  target.searchParams.set("streams", currentReleaseStreams().join(","));
  await chrome.tabs.create({ url: target.toString() });
}

async function fetchOneTraceInGraylog(queryString, streamIds, startMs, endMs) {
  try {
    if (!Array.isArray(streamIds) || !streamIds.length) throw new Error("Stream для поиска traceId не выбран");
    const current = new URL(location.href);
    const searchIndex = current.pathname.toLowerCase().lastIndexOf("/search");
    if (searchIndex < 0) throw new Error("Текущая вкладка не является страницей поиска Graylog");
    const beforeSearch = current.pathname.slice(0, searchIndex);
    const streamRouteIndex = beforeSearch.toLowerCase().lastIndexOf("/streams/");
    const basePath = streamRouteIndex >= 0 ? beforeSearch.slice(0, streamRouteIndex) : beforeSearch;
    const endpoint = new URL(`${basePath}/api/views/search/sync?timeout=60000`, current.origin).toString();
    const searchId = crypto.randomUUID(), queryId = crypto.randomUUID(), searchTypeId = crypto.randomUUID();
    const headers = { Accept: "application/json", "Content-Type": "application/json", "X-Requested-By": "graylog-one-trace" };
    const storedSession = globalThis.localStorage?.getItem("sessionId") || "";
    let sessionId = storedSession;
    try { sessionId = JSON.parse(storedSession); } catch {}
    if (typeof sessionId === "string" && sessionId) headers.Authorization = `Basic ${btoa(`${sessionId}:session`)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers,
      body: JSON.stringify({
        id: searchId,
        parameters: [],
        queries: [{
          id: queryId,
          query: { type: "elasticsearch", query_string: `(${queryString}) AND _exists_:traceId` },
          timerange: { type: "absolute", from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString() },
          filter: { type: "or", filters: streamIds.map((id) => ({ type: "stream", id })) },
          search_types: [{
            id: searchTypeId, type: "messages", limit: 1, offset: 0,
            sort: [{ field: "timestamp", order: "DESC" }], filter: null
          }]
        }]
      })
    });
    const responseText = await response.text();
    let data;
    try { data = responseText ? JSON.parse(responseText) : {}; }
    catch { throw new Error(`Graylog вернул не JSON: HTTP ${response.status}`); }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message || data.type || "ошибка Graylog"}`);
    const searchType = data.results?.[queryId]?.search_types?.[searchTypeId];
    if (!searchType) throw new Error("Graylog не вернул traceId");
    const first = searchType.messages?.[0];
    const source = first?.message && typeof first.message === "object" ? first.message : first;
    const traceId = Array.isArray(source?.traceId) ? source.traceId[0] : source?.traceId;
    return { traceId: traceId === null || traceId === undefined ? null : String(traceId) };
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

async function openOneTraceInGraylog(queryString, streamIds, startMs, endMs, button) {
  if (releaseLoading || globalThis.__graylogTraceLookupLoading === true || globalThis.GraylogHttpActions?.busy?.("monitor")) return false;
  globalThis.__graylogTraceLookupLoading = true;
  const originalText = button?.textContent || "1 traceId ↗";
  const traceButtons = [...(document.querySelectorAll?.(".open-graylog-trace") || [])];
  for (const item of traceButtons) item.disabled = true;
  if (button) button.textContent = "Ищу traceId…";
  try {
    activeTab = await chrome.tabs.get(activeTab.id);
    const cacheKey = JSON.stringify([activeTab.url, queryString, streamIds, startMs, endMs]);
    let traceId = traceCache.get(cacheKey);
    if (!traceId) {
      const audit = QueryAudit.begin({ area: "1 traceId", query: queryString, streams: streamIds, startMs, endMs, aggregation: "Обычный поиск messages; limit 1; без агрегации" });
      try {
        const execution = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          world: "MAIN",
          func: fetchOneTraceInGraylog,
          args: [queryString, streamIds, startMs, endMs]
        });
        if (execution[0]?.error) throw new Error(execution[0].error.message || String(execution[0].error));
        const result = execution[0]?.result;
        if (result?.error) throw new Error(result.error);
        if (!result?.traceId) throw new Error("В выбранном периоде traceId не найден");
        traceId = result.traceId;
        audit.finish("success", 1);
      } catch (error) {
        audit.finish("error", null, error?.message || String(error));
        throw error;
      }
      traceCache.set(cacheKey, traceId);
      BoundedCache.pruneCache(traceCache, TRACE_CACHE_LIMIT);
    }
    const escapedTraceId = String(traceId).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    const traceQuery = `traceId:"${escapedTraceId}"`;
    const target = new URL(activeTab.url);
    target.search = "";
    target.hash = "";
    target.searchParams.set("q", traceQuery);
    target.searchParams.set("rangetype", "absolute");
    target.searchParams.set("from", new Date(startMs).toISOString());
    target.searchParams.set("to", new Date(endMs).toISOString());
    if (streamIds.length) target.searchParams.set("streams", streamIds.join(","));
    await chrome.tabs.create({ url: target.toString() });
    return true;
  } finally {
    globalThis.__graylogTraceLookupLoading = false;
    for (const item of traceButtons) if (item?.isConnected !== false) item.disabled = false;
    if (button) button.textContent = originalText;
  }
}

const toolTabsAndViews = [
  [releaseUi.spamTab, releaseUi.spamView],
  [releaseUi.releaseTab, releaseUi.releaseView],
  [releaseUi.percentilesTab, releaseUi.percentilesView],
  [releaseUi.searchTab, releaseUi.searchView],
  [releaseUi.technicalLogTab, releaseUi.technicalLogView],
  [document.querySelector('#journal-tab'), document.querySelector('#journal-view')],
  [document.querySelector('#navigator-tab'), document.querySelector('#navigator-view')]
].filter(([tab,view])=>tab&&view);

function selectToolView(selectedTab) {
  for (const [tab, view] of toolTabsAndViews) {
    tab.classList.toggle("active", tab === selectedTab);
    if (tab === selectedTab) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
    view.hidden = tab !== selectedTab;
  }
  if (typeof GraylogAppShell !== "undefined") GraylogAppShell.select(selectedTab.id);
}

for (const [tab] of toolTabsAndViews) tab.addEventListener("click", () => selectToolView(tab));

async function refreshMonitorComparison() {
  setMonitorModeNote();
  if (!releaseRenderedResults.size || releaseLoading || globalThis.__graylogTraceLookupLoading === true || globalThis.GraylogHttpActions?.busy?.("monitor")) return;
  // A mode switch must only re-render what is already loaded, never query
  // Graylog by itself - in either direction: "Проверка релиза" needs the
  // version inventory (service-name x branch across every stream), "Новое
  // за период" needs 24h history per check that does not have it yet. Both
  // are real requests, sized like the checks themselves; only "Запустить"/
  // "Обновить" may trigger them.
  const missingHistory = releaseUi.mode.value !== "release" && RELEASE_CHECKS.some(definition => {
    const stored = releaseRenderedResults.get(definition.id);
    return stored && !stored.result.historyLoaded && stored.result.current.length;
  });
  if ((releaseUi.mode.value === "release" && !releaseVersionInventory) || missingHistory) {
    showReleaseError(`Нажмите «Обновить», чтобы ${releaseUi.mode.value === "release" ? "сравнить версии релиза" : "загрузить историю"} за этот период.`);
    return;
  }
  releaseUi.error.hidden = true;
  releaseLoading = true;
  releaseUi.mode.disabled = true;
  releaseUi.streamMode.disabled = true;
  releaseUi.run.disabled = true;
  releaseUi.refresh.disabled = true;
  try {
  if (releaseUi.mode.value === "release") await ensureReleaseVersionInventory();
  releaseTotals.newEvents = 0;
  releaseTotals.knownEvents = 0;
  releaseTotals.unknownEvents = 0;
  for (const definition of RELEASE_CHECKS) {
    const stored = releaseRenderedResults.get(definition.id);
    if (!stored) continue;
    const comparison = comparisonMarkup(definition, stored.result.branchCurrent, stored.result.branchHistory, releaseUi.mode.value, monitorComparisonOptions(stored.result));
    stored.comparisonHtml = releaseUi.mode.value === "release" ? comparison.html : comparison.newSummaryHtml;
    releaseTotals.newEvents += comparison.newEventCount;
    releaseTotals.knownEvents += comparison.knownEventCount;
    releaseTotals.unknownEvents += comparison.unknownEventCount || 0;
    const card = document.querySelector(`#monitor-${definition.id}`);
    if (card) {
      card.dataset.newEvents = String(comparison.newEventCount);
      card.dataset.latestEvents = String(comparison.latestEventCount || 0);
    }
    const body = card?.querySelector(".monitor-card-body");
    if (body) body.innerHTML = releaseUi.mode.value === "release" ? stored.comparisonHtml + '<p class="hint">Динамика за выбранный период · все версии сервиса</p>' + chartMarkup(stored.result.current, releaseUi.chartMode.value) : chartMarkup(stored.result.current, releaseUi.chartMode.value) + stored.comparisonHtml;
    const status = card?.querySelector(".monitor-status");
    if (status) {
      status.className = `monitor-status ${comparison.newEventCount > 0 ? "bad" : comparison.unknownEventCount > 0 ? "" : "ok"}`;
      status.textContent = releaseUi.mode.value === "release" ? `${comparison.newEventCount} новых · ${comparison.latestEventCount || 0} в последней версии` : releaseEventCountLabel(Number(card.dataset.events) || 0);
    }
  }
  updateReleaseTotals();
  sortMonitorCardsByEvents();
  } catch (error) { showReleaseError(error.message || String(error)); }
  finally {
    releaseLoading = false;
    releaseUi.mode.disabled = false;
    releaseUi.streamMode.disabled = globalThis.GraylogStreams?.environment?.() === "test";
    releaseUi.run.disabled = false;
    releaseUi.refresh.disabled = false;
  }
}

releaseUi.mode.addEventListener("change", refreshMonitorComparison);
releaseUi.streamMode.addEventListener("change", () => {
  releaseComparisonScope = null;
  releaseVersionInventory = null;
  releaseRenderedResults.clear();
  releaseTotals.newEvents = 0; releaseTotals.knownEvents = 0; releaseTotals.events = 0; releaseTotals.unknownEvents = 0;
  updateReleaseTotals();
  releaseUi.results.innerHTML = RELEASE_CHECKS.map(monitorCardShell).join("");
  setMonitorModeNote();
});
renderMonitorGroupingRules();
releaseUi.chartMode.addEventListener("change", () => {
  for (const definition of RELEASE_CHECKS) {
    const stored = releaseRenderedResults.get(definition.id);
    const body = document.querySelector(`#monitor-${definition.id} .monitor-card-body`);
    if (stored && body) body.innerHTML = releaseUi.mode.value === "release" ? stored.comparisonHtml + '<p class="hint">Динамика за выбранный период · все версии сервиса</p>' + chartMarkup(stored.result.current, releaseUi.chartMode.value) : chartMarkup(stored.result.current, releaseUi.chartMode.value) + stored.comparisonHtml;
  }
});
releaseUi.run.addEventListener("click", () => runReleaseMonitor(false));
releaseUi.refresh.addEventListener("click", () => runReleaseMonitor(true));
releaseUi.now.addEventListener("click", () => {
  releaseUi.end.value = localDateTimeValue(new Date());
  updateMonitorPeriodPreview();
});
releaseUi.end.addEventListener("input", updateMonitorPeriodPreview);
releaseUi.range.addEventListener("change", updateMonitorPeriodPreview);
releaseUi.expandAll.addEventListener("click", () => {
  for (const card of releaseUi.results.querySelectorAll(".monitor-card")) card.open = true;
});
releaseUi.collapseAll.addEventListener("click", () => {
  for (const card of releaseUi.results.querySelectorAll(".monitor-card")) card.open = false;
});
releaseUi.results.addEventListener("click", (event) => {
  const filterButton = event.target.closest(".open-graylog-filter");
  const traceButton = event.target.closest(".open-graylog-trace");
  if (!filterButton && !traceButton) return;
  event.preventDefault();
  event.stopPropagation();
  if (filterButton) {
    const definition = RELEASE_CHECKS.find((item) => item.id === filterButton.dataset.checkId);
    if (definition) openCheckInGraylog(definition).catch((error) => showReleaseError(error.message));
  }
  if (traceButton) {
    const definition = RELEASE_CHECKS.find((item) => item.id === traceButton.dataset.traceCheckId);
    if (!definition) return;
    try {
      const { startMs, endMs } = selectedMonitorBounds();
      openOneTraceInGraylog(definition.query, currentReleaseStreams(), startMs, endMs, traceButton).catch((error) => showReleaseError(error.message));
    } catch (error) { showReleaseError(error.message); }
  }

});
releaseUi.end.value = localDateTimeValue(new Date());
updateMonitorPeriodPreview();
releaseUi.results.innerHTML = RELEASE_CHECKS.map(monitorCardShell).join("");
setMonitorModeNote();
if (!document.querySelector("#tool-tabs")?.hidden) selectToolView(releaseUi.releaseTab);

