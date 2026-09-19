const tracePage = {
  canvas: document.querySelector("#trace-canvas"), query: document.querySelector("#trace-query"),
  error: document.querySelector("#trace-error"), zoomIn: document.querySelector("#zoom-in"),
  zoomOut: document.querySelector("#zoom-out"), zoomFit: document.querySelector("#zoom-fit"), zoomReset: document.querySelector("#zoom-reset"),
  zoomStart: document.querySelector("#zoom-start"), follow: document.querySelector("#trace-follow"),
  resetLayout: document.querySelector("#reset-layout"), flowToggle: document.querySelector("#toggle-trace-flow"), flowPlay: document.querySelector("#play-trace-flow"), flowSpeed:document.querySelector("#trace-playback-speed"), flowStop: document.querySelector("#stop-trace-flow"), playbackStatus:document.querySelector("#trace-playback-status"),
  zoomLevel: document.querySelector("#zoom-level"), download: document.querySelector("#download-png"), downloadStatus: document.querySelector("#download-status"),
  totalDuration: document.querySelector("#trace-total-duration"), duplicateSummary: document.querySelector("#trace-duplicate-summary"),
  localTools: document.querySelector("#trace-local-tools"), summary: document.querySelector("#trace-summary"),
  streamScope:document.querySelector("#trace-stream-scope"), streamSelect: document.querySelector("#trace-stream-select"), streamHelp:document.querySelector("#trace-stream-help"), streamCount: document.querySelector("#trace-stream-count"),
  assumptionToggle:document.querySelector("#trace-assumption-toggle"), assumptionStatus:document.querySelector("#trace-assumption-status"),
  localSearch: document.querySelector("#trace-local-search"), localMode: document.querySelector("#trace-local-mode"),
  filterCount: document.querySelector("#trace-filter-count"), filterReset: document.querySelector("#trace-filter-reset"),
  minimap: document.querySelector("#trace-minimap"), minimapCanvas: document.querySelector("#trace-minimap-canvas"), minimapMeta: document.querySelector("#trace-minimap-meta"),
  umlButton:document.querySelector("#show-trace-uml"), umlDialog:document.querySelector("#trace-uml-dialog"),
  umlCanvas:document.querySelector("#trace-uml-canvas"), umlMeta:document.querySelector("#trace-uml-meta")
};
let traceScale = 1;
const TRACE_CAMERA_TRANSITION_MS = 400;
let traceOffsetX = 28;
let traceOffsetY = 28;
let traceCameraFrame = 0;
let traceStage = null;
let traceViewport = null;
let traceNaturalWidth = 0;
let traceNaturalHeight = 0;
let traceQuery = "traceId";
let traceFullDiagram = null;
const traceExpandedCallGroups = new Set();
let traceCallGroupDiagram = null;
let traceStreamScope = "configured";
// Assumptions are shown by default (a clearly highlighted, reversible pass -
// see syncTraceAssumptionControls' amber styling and the toggle button,
// which now reads "Убрать предположения" first). Nothing here changes what
// counts as evidence or how the assumption pass itself works; only which
// graph (before vs. after that pass) is shown on first render.
let traceAssumptionMode = true;
let traceScopeGuideTimer = 0;
let traceScopeGuideShown = false;
let traceExportModel = null;
let traceScaleMode = "readable";
let traceInteractionModel = null;
let traceDragState = null;
let tracePanState = null;
let traceGeometryFrame = 0;
let traceFilterFrame = 0;
let traceMinimapFrame = 0;
let traceMinimapDrag = null;
let traceFlowPaused = false;
let traceUmlDiagram = null;
let tracePlayback = { state:"idle", events:[], index:0, phase:"idle", timer:null, remaining:0, startedAt:0, generation:0, resumeAfterGeometry:false, speed:1, stepMs:620, gapMs:120 };
let traceStatusImagesPromise = null;
const traceMotionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
globalThis.TracePlaybackContextView=globalThis.TracePlaybackContext?.create({container:tracePage.canvas.parentElement,canvas:tracePage.canvas,onSource:showTraceSource});
const traceStatusMeta = Object.freeze({
  ok: { src:"status-ok.png", label:"Запрос завершён корректно" },
  error: { src:"status-error.png", label:"Ошибка: RESPONSE содержит level 3" },
  spam: { src:"status-spam.png", label:"Требует проверки: повторный URI или превышение нормы" }
});
globalThis.TraceStepsView=globalThis.TraceSteps?.create({
  container:tracePage.canvas.parentElement,
  onSelect(index) {
    selectTracePlaybackStep(index,true);
  },
  onToggle() {requestAnimationFrame(()=>{window.dispatchEvent(new Event("resize"));if(["playing","paused"].includes(tracePlayback.state))focusTracePlaybackEvent(tracePlayback.events[tracePlayback.index],true);});}
});
if(globalThis.TraceStepsView)tracePage.zoomStart.before(globalThis.TraceStepsView.toggleButton);

function moscowTime(value) {
  if (value === null || !Number.isFinite(Number(value))) return "нет времени";
  return new Intl.DateTimeFormat("ru-RU", { timeZone:"Europe/Moscow", hour:"2-digit", minute:"2-digit", second:"2-digit", fractionalSecondDigits:3 }).format(new Date(Number(value))) + " МСК";
}

function traceCanonicalGateway(node) {
  if(node?.reconstructedEntry)return true;
  if(!node?.identityFields?.includes('service-name'))return false;
  const tokens=String(node.service||'').toLowerCase().split(/[-_.]+/).filter(Boolean);
  return tokens.length>0&&tokens[tokens.length-1]==='gateway';
}

// Temporary support export. The pure serializer copies only safe fields.
function downloadTraceDiagnostics() {
  const button=document.querySelector('#download-trace-diagnostics');
  const status=document.querySelector('#trace-diagnostics-status');
  if(!traceFullDiagram || !globalThis.TraceDiagnostics) return;
  if(button) button.disabled=true;
  let url;
  try {
    const before=traceStreamScope==='configured' && globalThis.TraceStreamFilter
      ? TraceStreamFilter.filterTraceDiagram(traceFullDiagram,traceConfiguredStreamIds()) : traceFullDiagram;
    const after=globalThis.TraceAssumptionMatcher?.match(before) || before;
    const diagnostic=TraceDiagnostics.build(traceFullDiagram,before,after,{
      assumptionsEnabled:traceAssumptionMode,scope:traceStreamScope,positions:traceInteractionModel?.positions,
      version:chrome.runtime?.getManifest?.()?.version
    });
    url=URL.createObjectURL(new Blob([JSON.stringify(diagnostic,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='sensor-trace-diagnostic.json';
    document.body.append(link);link.click();link.remove();
    if(status) status.textContent=diagnostic.truncated ? 'JSON скачан · достигнут лимит, это отмечено в файле' : 'JSON скачан · имена и URI заменены, исходных логов нет';
  } catch {
    if(status) status.textContent='Не удалось подготовить диагностику. Попробуйте после построения графа.';
  } finally {
    if(url) setTimeout(()=>URL.revokeObjectURL(url),1000);
    if(button) button.disabled=false;
  }
}
document.querySelector('#download-trace-diagnostics')?.addEventListener('click',downloadTraceDiagnostics);

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function appendTraceConnection(svg, attributes, flowKind, flowKey, flowPaths) {
  const path = svgElement("path", attributes);
  path.classList.add("trace-connection", `trace-connection-${flowKind}`);
  if (flowKey) path.dataset.flowKey = flowKey;
  svg.append(path);
  const flow = path.cloneNode(false);
  flow.classList.remove("trace-connection", `trace-connection-${flowKind}`);
  flow.classList.add("trace-flow", `trace-flow-${flowKind}`);
  flow.removeAttribute("marker-end");
  flow.removeAttribute("stroke-dasharray");
  flow.removeAttribute("data-flow-key");
  flow.setAttribute("pathLength", "1");
  flow.setAttribute("aria-hidden", "true");
  svg.append(flow);
  if (flowKey && flowPaths) flowPaths.set(flowKey, path);
  return path;
}

function traceNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function applyTracePlaybackControls() {
  syncTracePlaybackContext();
  const active=["playing","paused"].includes(tracePlayback.state);
  document.body.classList.toggle("trace-playback-focus",active);
  globalThis.TraceStepsView?.sync(["playing","paused"].includes(tracePlayback.state)?tracePlayback.index:-1,tracePlayback.state);
  const reducedMotion = Boolean(traceMotionPreference?.matches);
  if (tracePage.flowPlay) {
    tracePage.flowPlay.disabled = reducedMotion || !tracePlayback.events.length;
    tracePage.flowPlay.setAttribute("aria-pressed", String(tracePlayback.state === "playing"));
    tracePage.flowPlay.textContent = reducedMotion ? "Анимация отключена"
      : tracePlayback.state === "playing" ? "⏸ Пауза"
      : tracePlayback.state === "paused" ? "▶ Продолжить"
      : tracePlayback.state === "done" ? "↻ Повторить путь" : "▶ Проиграть путь";
    tracePage.flowPlay.title = reducedMotion ? "Анимация отключена системной настройкой уменьшения движения"
      : tracePlayback.state === "playing" ? "Приостановить хронологическое проигрывание"
      : tracePlayback.state === "paused" ? "Продолжить с текущего шага" : "По шагам показать путь REQUEST, RESPONSE, кеш и Kafka";
  }
  if (tracePage.flowStop) tracePage.flowStop.disabled = !["playing", "paused"].includes(tracePlayback.state);
  if(tracePage.playbackStatus){
    tracePage.playbackStatus.hidden=!active;
    tracePage.playbackStatus.textContent=active?`Шаг ${Math.min(tracePlayback.index+1,tracePlayback.events.length)} из ${tracePlayback.events.length}`:"";
  }
}

function applyTraceFlowControls() {
  const reducedMotion = Boolean(traceMotionPreference?.matches);
  traceStage?.classList.toggle("trace-flow-paused", traceFlowPaused);
  if (!tracePage.flowToggle) return;
  tracePage.flowToggle.disabled = reducedMotion;
  tracePage.flowToggle.setAttribute("aria-pressed", String(!traceFlowPaused && !reducedMotion));
  tracePage.flowToggle.textContent = reducedMotion ? "Поток отключён" : traceFlowPaused ? "▶ Поток" : "⏸ Поток";
  tracePage.flowToggle.title = reducedMotion ? "Постоянная анимация отключена системной настройкой уменьшения движения"
    : traceFlowPaused ? "Возобновить постоянный светящийся поток" : "Приостановить постоянный светящийся поток";
}

function toggleTraceFlow() {
  if (traceMotionPreference?.matches) return;
  traceFlowPaused = !traceFlowPaused;
  applyTraceFlowControls();
}

function syncTraceMotionPreference() {
  if (traceMotionPreference?.matches) cancelTracePlayback(true, "idle");
  applyTraceFlowControls();
  applyTracePlaybackControls();
}

function durationLabel(value) {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits:2 }).format(numeric) : "";
}

function createTraceLatencyBadge(value) {
  const badge = document.createElement("span");
  badge.className = "trace-latency-badge";
  badge.dataset.traceLatency = String(value);
  badge.textContent = "Медленное выполнение";
  return badge;
}

function refreshTraceLatency() {
  if (!globalThis.TraceLatency) return;
  for (const badge of traceStage?.querySelectorAll("[data-trace-latency]") || []) {
    const slow = TraceLatency.isSlow(badge.dataset.traceLatency);
    badge.style.visibility = slow ? "visible" : "hidden";
    badge.setAttribute("aria-hidden", String(!slow));
    badge.title = `${badge.dataset.traceLatency} мс > ${TraceLatency.getThreshold()} мс. Отдельная оценка длительности, не статус ошибки.`;
  }
}

function initializeTraceLatencyControl(diagram) {
  const input = document.querySelector("#trace-latency-threshold");
  if (!input || !globalThis.TraceLatency) return;
  if (diagram?.latencyThresholdMs !== undefined) TraceLatency.setThreshold(diagram.latencyThresholdMs);
  input.value = String(TraceLatency.getThreshold());
  input.onchange = () => {
    if (!TraceLatency.setThreshold(input.value)) {
      input.setCustomValidity("Укажите целое число от 1 до 86400000 мс.");
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    refreshTraceLatency(); // Update labels only: preserve camera, branch positions and playback.
    const reviewButton = document.querySelector("#show-trace-errors");
    if (reviewButton) globalThis.TraceErrorView?.configureButton?.(reviewButton, diagram);
  };
  input.oninput = () => input.setCustomValidity("");
}

function isKafkaOnlyNode(node) {
  return (Number(node?.kafkaProduceCount) || 0) + (Number(node?.kafkaConsumeCount) || 0) + (Number(node?.kafkaBrokerCount) || 0) > 0
    && (Number(node?.requestCount) || 0) === 0 && (Number(node?.responseCount) || 0) === 0
    && (Number(node?.openApiRequestCount) || 0) === 0 && (Number(node?.openApiResponseCount) || 0) === 0
    && (Number(node?.gorodClientRequestCount) || 0) === 0 && (Number(node?.gorodClientResponseCount) || 0) === 0
    && (Number(node?.partnerBackendRequestCount) || 0) === 0 && (Number(node?.partnerBackendResponseCount) || 0) === 0;
}

function isProcedureOnlyNode(node) {
  return (Number(node?.xmlProcedureRequestCount) || 0) + (Number(node?.xmlProcedureResponseCount) || 0) > 0
    && (Number(node?.requestCount) || 0) === 0 && (Number(node?.responseCount) || 0) === 0
    && (Number(node?.openApiRequestCount) || 0) === 0 && (Number(node?.openApiResponseCount) || 0) === 0
    && (Number(node?.gorodClientRequestCount) || 0) === 0 && (Number(node?.gorodClientResponseCount) || 0) === 0
    && (Number(node?.partnerBackendRequestCount) || 0) === 0 && (Number(node?.partnerBackendResponseCount) || 0) === 0
    && !isKafkaOnlyNode(node);
}

function traceTextCells(value) {
  return Array.from(String(value ?? "")).reduce((total, character) => total + (character.codePointAt(0) > 0xff ? 2 : 1), 0);
}

function traceLabelLines(labels) {
  const lines = [...new Set((labels || []).map(label => [label.action ? `Action: ${label.action}` : "", label.requestType ? `RequestType: ${label.requestType}` : ""].filter(Boolean).join(" · ")).filter(Boolean))];
  return lines.length > 10 ? [...lines.slice(0, 10), `Ещё вариантов: ${lines.length - 10}`] : lines;
}

function traceLabelElement(labels) {
  const block = document.createElement("div"); block.className = "trace-request-labels";
  const lines = traceLabelLines(labels); block.hidden = !lines.length;
  for (const line of lines) { const item = document.createElement("code"); item.textContent = line; block.append(item); }
  block.title = "Только Action и RequestType из заголовков этого события. Числовые и непрозрачные значения маскируются.";
  return block;
}

function traceCardWidth(node) {
  const completedOnly = node?.completedOperation && Number(node.requestCount) === 0;
  const targets = node?.requestTargets?.length ? node.requestTargets : completedOnly ? node.responseTargets : [];
  const firstTarget = targets?.[0];
  const extraTargetCount = Math.max(0, (targets?.length || 0) - 1);
  const methodCells = firstTarget ? traceTextCells(completedOnly ? "URI" : firstTarget.method || "HTTP") : 0;
  const urlCells = firstTarget ? traceTextCells(firstTarget.url) : 0;
  const extraCells = extraTargetCount ? traceTextCells(`+${extraTargetCount}`) : 0;
  // Внутри HTTP-плашки остаются отступы карточки, padding плашки и промежутки grid.
  // 6.4 px на знакоместо немного больше фактической ширины 10px monospace,
  // поэтому URI не попадает под ellipsis из-за округления шрифта браузером.
  const targetWidth = firstTarget ? 81 + (methodCells + urlCells + extraCells) * 6.4 + (extraTargetCount ? 12 : 6) : 0;
  const warningReserve = node?.traceOverLimit ? 136 : 0;
  const statusReserve = node?.traceStatus ? 22 : 0;
  const serviceWidth = 82 + traceTextCells(node?.service) * 8.7 + warningReserve + statusReserve;
  const spanWidth = 57 + traceTextCells(`${node?.clientSpanAssociation ? "CLIENT · " : ""}spanId: ${node?.spanId || ""}`) * 7.3;
  const kafkaTopics = [...(node?.kafkaProduces || []), ...(node?.kafkaConsumes || []), ...(node?.kafkaBrokers || [])];
  const kafkaWidth = isKafkaOnlyNode(node) ? Math.max(0, ...kafkaTopics.map((item) => 57 + traceTextCells(`topic: ${item?.topic || "не определён"}`) * 6.4)) : 0;
  const recoveryWidth = node?.spanRecovery ? Math.max(480, 70 + traceTextCells(`RESPONSE spanId: ${(node.recoveredSpanIds || []).join(", ")}`) * 7.3) : 0;
  const labelsWidth = Math.max(0, ...traceLabelLines(node?.requestLabels).map(text => 72 + traceTextCells(text) * 6.4));
  return Math.ceil(Math.min(1200, Math.max(completedOnly ? 340 : 240, targetWidth, serviceWidth, spanWidth, kafkaWidth, recoveryWidth, labelsWidth)));
}

function traceSubcallWidth(detail, minimumWidth = 280) {
  if (detail?.cacheOwnerService) return Math.ceil(Math.max(minimumWidth, 32 + Math.max(traceTextCells(`Сервис: ${detail.cacheOwnerService}`), traceTextCells(`Ключ: ${detail.safeKey || "не указан"}`)) * 6.2));
  if (detail?.procedure) return Math.ceil(Math.min(800, Math.max(minimumWidth, 72 + traceTextCells(`Процедура: ${detail.procedure}`) * 6.2)));
  if (!detail?.url) return minimumWidth;
  const methodCells = traceTextCells(detail.method || "HTTP");
  const urlCells = traceTextCells(detail.url);
  // padding карточки и HTTP-плашки + grid gap; шрифт цели подпункта — 9px monospace.
  return Math.ceil(Math.min(1200, Math.max(minimumWidth, 43 + (methodCells + urlCells) * 5.8)));
}

function traceKafkaBrokerWidth(topic) {
  return Math.ceil(Math.min(800, Math.max(220, 78 + traceTextCells(`topic: ${topic || "не определён"}`) * 5.8)));
}

function updateKafkaEndpointGeometry(endpoint, positions, subcalls) {
  const owner = endpoint.ownerType === "node" ? positions[endpoint.ownerIndex] : subcalls[endpoint.ownerIndex];
  if (!owner) return endpoint;
  endpoint.x = Math.max(12, owner.x + owner.width / 2 - endpoint.width / 2 + (Number(endpoint.ownerOffset) || 0));
  endpoint.y = owner.y + owner.height + 68;
  return endpoint;
}

function createKafkaEndpoints(nodes, positions, subcalls, kafkaLinks = []) {
  const endpoints = [];
  const addLinks = (endpoint, producerNodeIndex, producerDetailIndex) => ({ ...endpoint,
    consumerLinks:(Array.isArray(kafkaLinks) ? kafkaLinks : []).filter((link) => link.producerNodeIndex === producerNodeIndex && link.producerDetailIndex === producerDetailIndex)
  });
  nodes.forEach((node, index) => {
    if (!isKafkaOnlyNode(node) || (Number(node.kafkaProduceCount) || 0) <= 0) return;
    const detail = node.kafkaProduces?.[0] || { topic:"не определён", at:node.kafkaProduceAt };
    endpoints.push(addLinks({ ownerType:"node", ownerIndex:index, topic:detail.topic || "не определён", at:detail.at ?? node.kafkaProduceAt ?? null, width:traceKafkaBrokerWidth(detail.topic), height:56, x:0, y:0 }, index, 0));
  });
  subcalls.forEach((subcall, index) => {
    if (!subcall.kafkaProduce) return;
    endpoints.push(addLinks({ ownerType:"subcall", ownerIndex:index, topic:subcall.detail?.topic || "не определён", at:subcall.detail?.at ?? subcall.requestAt ?? null, width:traceKafkaBrokerWidth(subcall.detail?.topic), height:56, x:0, y:0 }, subcall.parentIndex, subcall.subIndex));
  });
  nodes.forEach((node, index) => {
    const events = Array.isArray(node?.kafkaBrokers) ? node.kafkaBrokers : [];
    const count = Math.max(events.length, Math.floor(Number(node?.kafkaBrokerCount) || 0));
    if (!count) return;
    const topics = [...new Set(events.map((item) => String(item?.topic || "")).filter(Boolean))].slice(0, 8);
    const topic = topics.length ? `${topics.slice(0, 2).join(", ")}${topics.length > 2 ? ` · +${topics.length - 2}` : ""}` : "не определён";
    const times = events.map((item) => Number(item?.at)).filter(Number.isFinite);
    endpoints.push({ ownerType:"node", ownerIndex:index, brokerObservation:true, eventCount:count, topics, topic,
      at:times.length ? Math.min(...times) : node.kafkaBrokerAt ?? null, times, width:traceKafkaBrokerWidth(topic), height:72, x:0, y:0, consumerLinks:[] });
  });
  const byOwner = new Map();
  for (const endpoint of endpoints) {
    const key = `${endpoint.ownerType}:${endpoint.ownerIndex}`;
    const list = byOwner.get(key) || []; list.push(endpoint); byOwner.set(key, list);
  }
  for (const list of byOwner.values()) {
    const totalWidth = list.reduce((sum, endpoint) => sum + endpoint.width, 0) + Math.max(0, list.length - 1) * 18;
    let cursor = -totalWidth / 2;
    for (const endpoint of list) { endpoint.ownerOffset = cursor + endpoint.width / 2; cursor += endpoint.width + 18; }
  }
  endpoints.forEach((endpoint) => updateKafkaEndpointGeometry(endpoint, positions, subcalls));
  return endpoints;
}

function traceCardHeight(node) {
  if (isKafkaOnlyNode(node)) return 78 + (Number(node?.kafkaProduceCount) > 0 ? 48 : 0) + (Number(node?.kafkaConsumeCount) > 0 ? 48 : 0) + (Number(node?.kafkaBrokerCount) > 0 ? 48 : 0);
  if (isProcedureOnlyNode(node)) return 126;
  const labelHeight = traceLabelLines(node?.requestLabels).length * 16;
  const hasTarget = node?.requestTargets?.length || (node?.completedOperation && Number(node.requestCount) === 0 && node.responseTargets?.length);
  return 112 + (hasTarget ? 38 : 0) + (node?.repeatedHttpTargets?.length ? 28 : 0) + (Number(node?.responseLevel3Count) > 0 ? 28 : 0) + (durationLabel(globalThis.TraceLatency ? TraceLatency.duration(node) : node?.responseDuration) ? 48 : 0) + (node?.spanRecovery ? 80 : 0) + (node?.reconstructedEntry ? 42 : 0) + (node?.crossServicePair ? 42 : 0) + (labelHeight ? labelHeight + 12 : 0) + (Number(node?.kafkaConsumeCount) > 0 ? 48 : 0);
}

function traceSubcallDetail(details, subIndex) {
  let offset = Math.max(0, Math.floor(Number(subIndex) || 0));
  for (const detail of Array.isArray(details) ? details : []) {
    const copies = Math.max(1, Math.floor(Number(detail?.count) || 1));
    if (offset < copies) return detail;
    offset -= copies;
  }
  return null;
}

function repeatedTimesLabel(value) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  const tail = count % 100;
  const ending = tail >= 11 && tail <= 14 ? "раз" : count % 10 === 2 || count % 10 === 3 || count % 10 === 4 ? "раза" : "раз";
  return `${count} ${ending}`;
}

function traceServiceCallTotals(nodes) {
  const totals = new Map();
  for (const node of nodes || []) {
    if (Number(node?.requestCount) > 0 || Number(node?.openApiRequestCount) > 0 || Number(node?.gorodClientRequestCount) > 0 || Number(node?.partnerBackendRequestCount) > 0) {
      totals.set(node.service, (totals.get(node.service) || 0) + 1);
    }
  }
  return totals;
}

function traceUriCallTotals(nodes) {
  const grouped = new Map();
  for (const [nodeIndex, node] of (nodes || []).entries()) {
    // Считаем только агрегированные HTTP-цели. requestCount и счётчики семейств
    // намеренно не прибавляются: иначе одно событие попало бы в норму дважды.
    for (const property of ["requestTargets", "openApiRequestTargets", "gorodClientRequestTargets", "partnerBackendRequestTargets"]) {
      for (const target of Array.isArray(node?.[property]) ? node[property] : []) {
        const url = String(target?.url || "").trim();
        if (!url) continue;
        const parent = Number.isInteger(node?.parentIndex) ? nodes[node.parentIndex] : null;
        const callerService = String(property === "requestTargets" ? node?.httpCallerKey || node?.httpCallerService || parent?.service || "Внешний источник" : node?.service || "").trim();
        if (!callerService) continue;
        const count = Math.max(1, Math.floor(Number(target?.count) || 1));
        const key = `${callerService}\u0000${url}`;
        const existing = grouped.get(key) || { incoming:0, outgoing:0 };
        if (property === "requestTargets" && !node.clientSpanAssociation) existing.incoming += count;
        else existing.outgoing += count;
        grouped.set(key, existing);
      }
    }
  }
  const totals = new Map();
  for (const [key, counts] of grouped) totals.set(key, Math.max(counts.incoming, counts.outgoing));
  return totals;
}

function traceUriCallCount(service, target, uriCallTotals) {
  const url = String(target?.url || "").trim();
  return url ? Number(uriCallTotals?.get(`${String(service || "").trim()}\u0000${url}`)) || 0 : 0;
}

function traceNodeOverLimit(node, uriRepeatLimit, uriCallTotals) {
  return (Array.isArray(node?.requestTargets) ? node.requestTargets : [])
    .some((target) => traceUriCallCount(node?.httpCallerKey || node?.httpCallerService || node?.service, target, uriCallTotals) > uriRepeatLimit);
}

function traceNodeStatus(node, uriRepeatLimit, uriCallTotals) {
  if (Number(node?.responseLevel3Count) > 0) return "error";
  if ((node?.repeatedHttpTargets?.length || 0) > 0 || traceNodeOverLimit(node, uriRepeatLimit, uriCallTotals)) return "spam";
  if (isKafkaOnlyNode(node)) return "ok";
  if (isProcedureOnlyNode(node)) return Number(node?.xmlProcedureRequestCount) > 0 && Number(node?.xmlProcedureResponseCount) > 0 ? "ok" : null;
  return Number(node?.requestCount) > 0 && Number(node?.responseCount) > 0 ? "ok" : null;
}

function traceSubcallStatus(subcall) {
  if (subcall?.diagnostic || subcall?.assumption) return null;
  if (subcall?.clientFailure) return "error";
  if (subcall?.responseLevel3) return "error";
  if (subcall?.repeatedUri) return "spam";
  if (subcall?.cacheChain) return null;
  if (subcall?.oneWay && Number(subcall?.requestTotal) > Number(subcall?.subIndex)) return "ok";
  return (subcall?.responseObserved ?? (Number(subcall?.responseTotal) > Number(subcall?.subIndex))) ? "ok" : null;
}

function traceFilterText(values) {
  return values.flat(Infinity).filter((value) => value !== null && value !== undefined && value !== "").map(String).join(" ").toLocaleLowerCase("ru");
}

function traceNodeFilterData(node) {
  const targets = [node?.requestTargets, node?.openApiRequestTargets, node?.gorodClientRequestTargets, node?.partnerBackendRequestTargets]
    .flatMap((items) => Array.isArray(items) ? items : []);
  const topics = [...(Array.isArray(node?.kafkaProduces) ? node.kafkaProduces : []), ...(Array.isArray(node?.kafkaConsumes) ? node.kafkaConsumes : []), ...(Array.isArray(node?.kafkaBrokers) ? node.kafkaBrokers : [])].map((item) => item?.topic);
  const kafka = isKafkaOnlyNode(node) || Number(node?.kafkaProduceCount) > 0 || Number(node?.kafkaConsumeCount) > 0 || Number(node?.kafkaBrokerCount) > 0 || topics.some(Boolean);
  const cache = Number(node?.cacheAccessCount) > 0;
  const level3 = Number(node?.responseLevel3Count) > 0;
  const repeated = Boolean(node?.traceOverLimit) || (node?.repeatedHttpTargets?.length || 0) > 0;
  const procedures=[...(node?.xmlProcedureRequests || []),...(node?.xmlProcedureResponseSamples || [])].map((item)=>item?.procedure);
  const incomplete = !isKafkaOnlyNode(node) && !isProcedureOnlyNode(node) && (Number(node?.requestCount) <= 0 || Number(node?.responseCount) <= 0);
  return {
    text:traceFilterText([node?.jobNames, node?.jobNames?.length ? "шедулер scheduler" : "", node?.service, node?.spanId, node?.recoveredSpanIds, targets.map((item) => [item?.method, item?.url]), topics, procedures, (node?.cacheAccesses || []).map((item) => item.safeKey), cache ? "LOCAL CACHE REDIS" : "", node?.spanRecovery ? "разрыв span" : ""]),
    flags:{ level3, repeated, incomplete, kafka, cache, issue:level3 || repeated || incomplete || Boolean(node?.spanRecovery) }
  };
}

function traceSubcallFilterData(subcall, parent) {
  if (subcall?.assumption) return {
    text:traceFilterText([parent?.service, parent?.spanId, "ПРЕДПОЛОЖЕНИЕ", "Дальнейшее действие не найдено", "возможно БД или кеш"]),
    flags:{level3:false, repeated:false, incomplete:true, kafka:false, cache:false, issue:true}
  };
  if (subcall?.diagnostic) return {
    text:traceFilterText([subcall.detail.service, ...subcall.detail.spanIds, subcall.label, ...subcall.detail.causes.map(cause => cause.title)]),
    flags:{level3:true, repeated:false, incomplete:false, kafka:false, cache:false, issue:true}
  };
  const kafka = Boolean(subcall?.kafkaProduce);
  const cache = Boolean(subcall?.cacheChain);
  const repeated = Boolean(subcall?.repeatedUri || subcall?.overLimit);
  const incomplete = !kafka && !cache && (!(subcall?.requestObserved ?? Number(subcall?.subIndex) < Number(subcall?.requestTotal)) || !(subcall?.responseObserved ?? Number(subcall?.subIndex) < Number(subcall?.responseTotal)));
  return {
    text:traceFilterText([parent?.service, parent?.spanId, subcall?.clientFailure?.service, subcall?.clientFailure?.spanId, subcall?.clientFailure?.failureType, subcall?.label, subcall?.detail?.method, subcall?.detail?.url, subcall?.detail?.procedure, subcall?.detail?.topic, subcall?.detail?.safeKey, cache ? "LOCAL CACHE REDIS" : ""]),
    flags:{ level3:Boolean(subcall?.responseLevel3 || subcall?.clientFailure?.level3), repeated, incomplete, kafka, cache, issue:Boolean(subcall?.responseLevel3 || subcall?.clientFailure) || repeated || incomplete }
  };
}

function traceItemMatches(item, term, mode) {
  const normalizedTerm = String(term || "").trim().toLocaleLowerCase("ru");
  const normalizedMode = ["issues", "level3", "repeated", "incomplete", "kafka", "cache"].includes(mode) ? mode : "all";
  const modeMatch = normalizedMode === "all" || normalizedMode === "issues" && item?.flags?.issue || Boolean(item?.flags?.[normalizedMode]);
  return Boolean(modeMatch && (!normalizedTerm || String(item?.text || "").includes(normalizedTerm)));
}

function traceSummaryStats(nodes, subcalls, kafkaEndpoints, uriCallTotals) {
  const list = Array.isArray(nodes) ? nodes : [];
  return {
    spans:list.length,
    services:new Set(list.map((node) => String(node?.service || "").trim()).filter(Boolean)).size,
    level3:list.filter((node) => Number(node?.responseLevel3Count) > 0).length + (subcalls || []).filter((call) => call.responseLevel3 || call.clientFailure?.level3).length,
    repeated:[...(uriCallTotals?.values?.() || [])].filter((count) => Number(count) > 1).length,
    incomplete:list.filter((node) => !isKafkaOnlyNode(node) && !isProcedureOnlyNode(node) && (Number(node?.requestCount) <= 0 || Number(node?.responseCount) <= 0)).length
      + (Array.isArray(subcalls) ? subcalls : []).filter((subcall) => !subcall?.oneWay && (!(subcall?.requestObserved ?? Number(subcall?.subIndex) < Number(subcall?.requestTotal)) || !(subcall?.responseObserved ?? Number(subcall?.subIndex) < Number(subcall?.responseTotal)))).length
      + (Array.isArray(subcalls) ? subcalls : []).filter((subcall) => subcall?.assumption).length,
    kafka:(Array.isArray(kafkaEndpoints) ? kafkaEndpoints : []).reduce((sum, endpoint) => sum + Math.max(1, Number(endpoint?.eventCount) || 0), 0) + list.reduce((sum, node) => sum + Math.max(0, Number(node?.kafkaConsumeCount) || 0), 0),
    cache:list.reduce((sum, node) => sum + Math.max(0, Number(node?.cacheAccessCount) || 0), 0),
    assumptions:list.filter((node) => node?.parentInference === "user-assumption").length
  };
}

function renderTraceSummary(nodes, subcalls, kafkaEndpoints, uriCallTotals, insights, contentTruncated=false) {
  if (!tracePage.summary) return;
  const stats = traceSummaryStats(nodes, subcalls, kafkaEndpoints, uriCallTotals);
  const redisEvidence=(subcalls || []).filter(call=>call.diagnostic&&call.detail?.dependency==="redis").reduce((sum,call)=>sum+call.detail.eventCount,0);
  const branch=insights?.longestBranch;
  const branchServices=branch?.nodeIndexes?.map(index=>nodes[index]?.service).filter(Boolean).join(' → ');
  const values = [
    [`${stats.spans} span`, "", ""], [`${stats.services} сервисов`, "", ""],
    ...(contentTruncated?[["Тексты сокращены",'issue','Длинные message/full_message прочитаны частично. За пределами прочитанного текста могут остаться связи и ошибки. Оригиналы в Graylog не изменены.']]:[]),
    ...(insights ? [[`${contentTruncated?'полнота структуры':'полнота данных'}: ${insights.score}%`,insights.grade==='good'?'':insights.grade==='partial'?'issue':'failed',
      `Локальная оценка полноты: наличие связей, времён и завершений. Она не оценивает качество самого сервиса.`],
      [`связи: ${insights.observedEdges} явн. / ${insights.inferredEdges} восст.`,insights.inferredEdges?'issue':'',
        'Явные связи имеют parentSpanId; восстановленные получены консервативными эвристиками.'],
      ...(insights.clockSkewWarnings?[[`возможный сдвиг часов: ${insights.clockSkewWarnings}`,'issue','Дочернее событие начинается раньше родителя. Времена не исправлялись.']]:[]),
      ...(branch?[[`длинная ветка: ${durationLabel(branch.durationMs)||0} мс`,branch.confidence==='low'?'issue':'',
        `Оценка по доступной топологии (${branch.confidence==='observed'?'явная':branch.confidence==='high'?'высокая уверенность':'предполагаемая'}).${branchServices?` ${branchServices}`:''}`]]:[])]:[]),
    [`level 3: ${stats.level3}`, stats.level3 ? "failed" : ""],
    [`повторных URI: ${stats.repeated}`, stats.repeated ? "issue" : ""],
    [`незавершённых: ${stats.incomplete}`, stats.incomplete ? "issue" : ""],
    [`Kafka: ${stats.kafka}`, ""],
    [`кеш Local + Redis: ${stats.cache}`, ""],
    ...(stats.assumptions ? [[`предположений: ${stats.assumptions}`, "issue", "Связи добавлены локально по явному нажатию и показаны жёлтым пунктиром."]] : []),
    ...(redisEvidence ? [[`Redis по ошибкам: ${redisEvidence}`,"issue"]] : []),
    [`пар по времени: ${nodes.filter(node => node.spanRecovery).length}`, nodes.some(node => node.spanRecovery) ? "issue" : ""]
  ];
  tracePage.summary.replaceChildren(...values.map(([text, className, title]) => {
    const badge = document.createElement("span"); badge.textContent = text; if (className) badge.className = className;if(title)badge.title=title; return badge;
  }));
}

function applyTraceLocalFilter() {
  const model = traceInteractionModel;
  if (!model) return;
  const term = tracePage.localSearch?.value || "";
  const mode = tracePage.localMode?.value || "all";
  const active = Boolean(term.trim() || mode !== "all");
  if(active&&globalThis.expandTraceCallGroups?.())return;
  let matched = 0;
  for (const item of model.filterItems || []) {
    item.matched = traceItemMatches(item, term, mode);
    if (item.matched) matched += 1;
    item.element?.classList.toggle("trace-filter-match", active && item.matched);
    item.element?.classList.toggle("trace-filter-muted", active && !item.matched);
  }
  model.stage.classList.toggle("trace-filtering", active);
  const total = model.filterItems?.length || 0;
  if (tracePage.filterCount) {
    const collapsedCount=(model.filterItems||[]).filter(item=>item.box?.foldHidden).length;
    tracePage.filterCount.textContent = collapsedCount&&!active ? `Показано ${total-collapsedCount} · в группах ${collapsedCount} · всего ${total}` : `${matched} из ${total} блоков`;
    tracePage.filterCount.classList.toggle("no-matches", active && matched === 0);
  }
  scheduleTraceMinimapUpdate();
}

function scheduleTraceLocalFilter() {
  if (traceFilterFrame) return;
  traceFilterFrame = requestAnimationFrame(() => { traceFilterFrame = 0; applyTraceLocalFilter(); });
}

function resetTraceLocalFilter() {
  if (tracePage.localSearch) tracePage.localSearch.value = "";
  if (tracePage.localMode) tracePage.localMode.value = "all";
  if (traceFilterFrame) { cancelAnimationFrame(traceFilterFrame); traceFilterFrame = 0; }
  applyTraceLocalFilter();
  tracePage.localSearch?.focus();
}

function traceConfiguredStreamIds() {
  const supplied = Array.isArray(traceFullDiagram?.configuredStreamIds)
    ? [...new Set(traceFullDiagram.configuredStreamIds.map(value => String(value || "").toLowerCase())
      .filter(value => /^[a-f0-9]{24}$/.test(value)))].slice(0, 32)
    : [];
  if (supplied.length) return supplied;
  return typeof globalThis.GraylogStreams?.list === "function" ? GraylogStreams.list() : [];
}

function traceStreamStats(diagram, scopedDiagram = null) {
  const nodes = Array.isArray(diagram?.nodes) ? diagram.nodes : [];
  const attributed = globalThis.TraceStreamFilter
    ? nodes.filter((node) => node?.streamMetadataComplete !== false && TraceStreamFilter.nodeStreamIds(node).length > 0).length : 0;
  return {
    total:nodes.length,
    attributed,
    visible:Array.isArray(scopedDiagram?.nodes) ? scopedDiagram.nodes.length : nodes.length,
    configured:traceConfiguredStreamIds().length
  };
}

function syncTraceStreamControls(diagram, scopedDiagram = null) {
  const stats = traceStreamStats(diagram, scopedDiagram);
  const available = Boolean(globalThis.TraceStreamFilter && stats.configured && stats.attributed);
  if (tracePage.streamScope) tracePage.streamScope.hidden = false;
  if (tracePage.streamSelect) {
    const configuredOption = tracePage.streamSelect.querySelector('option[value="configured"]');
    if (configuredOption) {
      configuredOption.textContent = `Мои ${stats.configured} streams · рабочий контур`;
      configuredOption.disabled = !available;
    }
    if (!available && traceStreamScope === "configured") traceStreamScope = "all";
    tracePage.streamSelect.value = traceStreamScope;
    tracePage.streamSelect.title = available
      ? "Показать весь trace или локально оставить компоненты настроенных streams"
      : "Показан весь trace. Фильтр настроенных streams станет доступен при наличии stream-меток";
  }
  if (tracePage.streamCount) {
    const hidden = Math.max(0, stats.total - stats.visible);
    tracePage.streamCount.textContent = traceStreamScope === "configured"
      ? `Локально · без нового запроса · ${stats.visible}/${stats.total} компонентов`
      : stats.attributed < stats.total
        ? `Локально · без нового запроса · ${stats.total} компонентов, stream-метки у ${stats.attributed}`
        : `Локально · без нового запроса · ${stats.total} компонентов`;
    tracePage.streamCount.title = traceStreamScope === "configured"
      ? `Показано ${stats.visible} из ${stats.total} компонентов. Скрыто ${hidden}. Это локальный фильтр уже загруженной схемы.`
      : `Показаны все ${stats.total} компонентов trace. Stream полностью определён у ${stats.attributed}.`;
    tracePage.streamCount.classList.toggle("issue", traceStreamScope === "configured" && hidden > 0 || stats.attributed < stats.total);
  }
  return {stats, available, hidden:Math.max(0, stats.total - stats.visible)};
}

function explainTraceStreamScope({ repeat = true } = {}) {
  const target = tracePage.streamScope;
  if (!target || !traceFullDiagram || typeof globalThis.Clippy?.guide !== "function") return false;
  const shown = traceStreamScope === "configured" && globalThis.TraceStreamFilter
    ? TraceStreamFilter.filterTraceDiagram(traceFullDiagram, traceConfiguredStreamIds())
    : traceFullDiagram;
  const { stats, available, hidden } = syncTraceStreamControls(traceFullDiagram, shown);
  const message = traceStreamScope === "configured"
    ? `Сейчас оставлены ваши ${stats.configured} streams: видно ${stats.visible} из ${stats.total} компонентов. «Весь trace» вернёт смежные системы. Переключение локальное и не отправляет запрос в Graylog.`
    : available
      ? `«Весь trace» показывает смежные системы. «Мои ${stats.configured} streams» спокойно скрывает остальные${hidden ? ` (${hidden})` : ""}. Это локальный фильтр: нового запроса в Graylog нет.`
      : `Здесь выбирается состав уже загруженного графа. Фильтр настроенных streams станет доступен, когда в событиях будут stream-метки. Новый запрос в Graylog не выполняется.`;
  return Clippy.guide({key:"trace-stream-scope",target,message,scene:"point",duration:7200,repeat});
}

function scheduleTraceStreamScopeGuide() {
  if (traceScopeGuideShown || !traceFullDiagram?.nodes?.length) return;
  traceScopeGuideShown = true;
  clearTimeout(traceScopeGuideTimer);
  traceScopeGuideTimer = setTimeout(() => explainTraceStreamScope({repeat:false}), 3800);
}

function updateTraceQueryText(diagram, shownDiagram = diagram) {
  traceQuery = diagram.query || "traceId";
  const totalNodes = diagram.nodes?.length || 0;
  const shownNodes = shownDiagram.nodes?.length || 0;
  const scopeText = traceStreamScope === "configured" ? ` · показано ${shownNodes} из ${totalNodes} компонентов` : ` · ${totalNodes} компонентов`;
  tracePage.query.textContent = `${traceQuery}${scopeText}${Number.isFinite(diagram.loadedMessages) ? ` · получено ${diagram.loadedMessages} из ${diagram.totalMessages} сообщений` : ""}${diagram.loadingMore ? " · догружаю…" : diagram.truncated ? " · показана часть трейса" : ""}${diagram.fromCache ? " · из памяти" : ""}`;
  if(diagram.contentTruncated)tracePage.query.textContent+=' · длинные тексты сокращены: часть связей и ошибок может быть пропущена';
  tracePage.query.title = `Норма: ≤ ${diagram.serviceCallLimit || 1} повтора URI. Фильтр streams работает только с уже полученной моделью и не выполняет HTTP. ${diagram.timings ? `Ожидание ответов: ${Math.round(diagram.timings.requestMs || 0)} мс; локальная обработка: ${Math.round((diagram.timings.parseMs || 0) + (diagram.timings.processingMs || 0))} мс. Паузы между порциями не включены.` : ""}`;
}

function renderEmptyTraceStreamScope(diagram) {
  cancelTracePlayback(true, "idle");
  tracePage.canvas.replaceChildren();
  traceStage = null; traceViewport = null; traceInteractionModel = null; traceExportModel = null; traceUmlDiagram = diagram;
  tracePage.localTools.hidden = false;
  tracePage.minimap.hidden = true;
  tracePage.download.disabled = true;
  tracePage.resetLayout.disabled = true;
  if (tracePage.umlButton) tracePage.umlButton.disabled = true;
  tracePage.duplicateSummary.hidden = true;
  tracePage.totalDuration.hidden = true;
  document.querySelector("#trace-error-timeline-summary")?.setAttribute("hidden", "");
  const errorButton = document.querySelector("#show-trace-errors");
  if (errorButton) errorButton.hidden = true;
  tracePage.summary.replaceChildren();
  tracePage.filterCount.textContent = "0 из 0 блоков";
  tracePage.error.textContent = `В текущем trace нет компонентов из ${traceConfiguredStreamIds().length} настроенных streams. Верните «Все события trace», чтобы увидеть полную уже загруженную модель.`;
  tracePage.error.hidden = false;
}

function renderTraceStreamScope(preserveLocalFilters = true) {
  const diagram = traceFullDiagram;
  if (!diagram) return;
  let baseShown = diagram;
  if (traceStreamScope === "configured" && globalThis.TraceStreamFilter) baseShown = TraceStreamFilter.filterTraceDiagram(diagram, traceConfiguredStreamIds());
  const assumptionResult = globalThis.TraceAssumptionMatcher?.match?.(baseShown);
  const assumptionCount = Array.isArray(assumptionResult?.assumptionMatches) ? assumptionResult.assumptionMatches.length : 0;
  if (!assumptionCount) traceAssumptionMode = false;
  const shown = traceAssumptionMode && assumptionResult ? assumptionResult : baseShown;
  syncTraceAssumptionControls(assumptionCount);
  updateTraceQueryText(diagram, shown);
  syncTraceStreamControls(diagram, shown);
  if (!shown.nodes?.length && !shown.outgoingFailures?.length) {
    renderEmptyTraceStreamScope(shown);
    return;
  }
  renderTrace(shown, { preserveLocalFilters });
  tracePage.error.hidden = true;
  if (diagram.loadError) {
    tracePage.error.textContent = `${diagram.loadError} Показана уже загруженная часть трейса.`;
    tracePage.error.hidden = false;
  }
}

function syncTraceAssumptionControls(count = 0) {
  if (!tracePage.assumptionToggle) return;
  const available = Number(count) > 0;
  tracePage.assumptionToggle.disabled = !available;
  tracePage.assumptionToggle.setAttribute("aria-pressed", String(available && traceAssumptionMode));
  tracePage.assumptionToggle.textContent = traceAssumptionMode && available
    ? `Убрать предположения · ${count}` : available ? `Сопоставить предположения · ${count}` : "Нет предположений для сопоставления";
  tracePage.assumptionToggle.title = available
    ? "Локально сопоставить несвязанные блоки по URI, batch/topic, имени сервиса и вложенному времени. Нового запроса Graylog нет."
    : "Не найдено ни одного достаточно обоснованного локального предположения.";
  if (tracePage.assumptionStatus) {
    tracePage.assumptionStatus.textContent = traceAssumptionMode && available
      ? `${count} связей показаны жёлтым пунктиром · можно отменить`
      : available ? `${count} несвязанных блоков можно осторожно сопоставить` : "Локально · без запросов Graylog";
    tracePage.assumptionStatus.classList.toggle("active", traceAssumptionMode && available);
  }
}

function toggleTraceAssumptions() {
  traceExpandedCallGroups.clear();
  if (!traceFullDiagram || tracePage.assumptionToggle?.disabled) return;
  traceAssumptionMode = !traceAssumptionMode;
  renderTraceStreamScope(true);
  globalThis.Clippy?.guide?.({ key:"trace-assumptions", target:tracePage.assumptionToggle,
    message:traceAssumptionMode
      ? "Я соединил только уникальные локальные гипотезы. Жёлтый пунктир не означает подтверждённый вызов; повторное нажатие вернёт доказательный граф."
      : "Доказательный граф восстановлен: локальные предполагаемые связи убраны.",
    scene:"point", duration:6200, repeat:true });
}

function setTraceStreamScope(scope) {
  traceExpandedCallGroups.clear();
  const next = scope === "configured" ? "configured" : "all";
  const configuredOption = tracePage.streamSelect?.querySelector('option[value="configured"]');
  if (next === "configured" && configuredOption?.disabled || next === traceStreamScope) return;
  traceStreamScope = next;
  renderTraceStreamScope(true);
  // Switching an already loaded local view is a direct control. Sensor guidance
  // is reserved for the adjacent explicit help button, so this does not move it.
}

function traceMinimapScrollTarget(clientX, clientY, rect, worldWidth, worldHeight, viewportWidth, viewportHeight) {
  const relativeX = Math.min(1, Math.max(0, (Number(clientX) - Number(rect?.left || 0)) / Math.max(1, Number(rect?.width) || 1)));
  const relativeY = Math.min(1, Math.max(0, (Number(clientY) - Number(rect?.top || 0)) / Math.max(1, Number(rect?.height) || 1)));
  return {
    left:Math.max(0, Math.min(Math.max(0, worldWidth - viewportWidth), relativeX * worldWidth - viewportWidth / 2)),
    top:Math.max(0, Math.min(Math.max(0, worldHeight - viewportHeight), relativeY * worldHeight - viewportHeight / 2))
  };
}

function traceMinimapWorld() {
  return {
    width:Math.max(1, Number(tracePage.canvas?.scrollWidth) || Math.ceil(traceNaturalWidth * traceScale + 56)),
    height:Math.max(1, Number(tracePage.canvas?.scrollHeight) || Math.ceil(traceNaturalHeight * traceScale + 56))
  };
}

function drawTraceMinimap() {
  const model = traceInteractionModel;
  const canvas = tracePage.minimapCanvas;
  if (!model || !canvas) return;
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width || 260));
  const height = Math.max(1, Math.round(bounds.height || 84));
  const dpr = Math.min(2, Math.max(1, Number(globalThis.devicePixelRatio) || 1));
  const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#06111a"; context.fillRect(0, 0, width, height);
  const world = traceMinimapWorld();
  const scaleX = width / world.width, scaleY = height / world.height;
  // Show topology in the overview as well as cards. Without these lightweight
  // links a large, valid tree looks like unrelated coloured fragments.
  const nodeMatches=new Map((model.filterItems||[]).filter(item=>item.type==="node").map(item=>[item.index,item.matched!==false]));
  const subcallMatches=new Map((model.filterItems||[]).filter(item=>item.type==="subcall").map(item=>[item.index,item.matched!==false]));
  context.lineWidth=.75;context.strokeStyle="rgba(143,177,197,.52)";context.beginPath();
  for(const edge of model.edges||[]){
    const parent=model.positions?.[edge.from],child=model.positions?.[edge.to];
    if(!parent||!child||parent.foldHidden||child.foldHidden||nodeMatches.get(edge.from)===false||nodeMatches.get(edge.to)===false)continue;
    const x1=(traceOffsetX+(parent.x+parent.width/2)*traceScale)*scaleX;
    const y1=(traceOffsetY+(parent.y+parent.height)*traceScale)*scaleY;
    const x2=(traceOffsetX+(child.x+child.width/2)*traceScale)*scaleX;
    const y2=(traceOffsetY+child.y*traceScale)*scaleY,mid=(y1+y2)/2;
    context.moveTo(x1,y1);context.lineTo(x1,mid);context.lineTo(x2,mid);context.lineTo(x2,y2);
  }
  for(const [index,subcall] of (model.subcalls||[]).entries()){
    const parent=model.positions?.[subcall.parentIndex];
    if(!parent||parent.foldHidden||subcall.foldHidden||subcallMatches.get(index)===false||nodeMatches.get(subcall.parentIndex)===false)continue;
    const x1=(traceOffsetX+(parent.x+parent.width/2)*traceScale)*scaleX;
    const y1=(traceOffsetY+(parent.y+parent.height)*traceScale)*scaleY;
    const x2=(traceOffsetX+(subcall.x+subcall.width/2)*traceScale)*scaleX;
    const y2=(traceOffsetY+subcall.y*traceScale)*scaleY,mid=(y1+y2)/2;
    context.moveTo(x1,y1);context.lineTo(x1,mid);context.lineTo(x2,mid);context.lineTo(x2,y2);
  }
  context.stroke();
  for (const item of model.filterItems || []) {
    const box = item.box;
    if (!box || box.foldHidden) continue;
    const flags = item.flags || {};
    context.globalAlpha = item.matched === false ? .16 : .9;
    context.fillStyle = flags.level3 ? "#f0626d" : flags.repeated ? "#fb923c" : flags.incomplete ? "#8fb1c5" : flags.kafka ? "#a78bfa" : flags.cache ? "#38bdf8" : "#43d9c7";
    context.fillRect((traceOffsetX + box.x * traceScale) * scaleX, (traceOffsetY + box.y * traceScale) * scaleY, Math.max(2, box.width * traceScale * scaleX), Math.max(2, box.height * traceScale * scaleY));
  }
  context.globalAlpha = 1;
  const left = Math.max(0, tracePage.canvas.scrollLeft * scaleX), top = Math.max(0, tracePage.canvas.scrollTop * scaleY);
  const viewportWidth = Math.min(width, tracePage.canvas.clientWidth * scaleX), viewportHeight = Math.min(height, tracePage.canvas.clientHeight * scaleY);
  context.fillStyle = "rgba(96,165,250,.1)"; context.fillRect(left, top, viewportWidth, viewportHeight);
  context.strokeStyle = "#93c5fd"; context.lineWidth = 1.5; context.strokeRect(left + .75, top + .75, Math.max(1, viewportWidth - 1.5), Math.max(1, viewportHeight - 1.5));
  if (tracePage.minimapMeta) tracePage.minimapMeta.textContent = `${Math.round(traceScale * 100)}% · ${Math.round(Math.min(1, tracePage.canvas.clientWidth / world.width) * 100)}% в кадре`;
}

function scheduleTraceMinimapUpdate() {
  if (traceMinimapFrame) return;
  traceMinimapFrame = requestAnimationFrame(() => { traceMinimapFrame = 0; drawTraceMinimap(); });
}

function navigateTraceMinimap(event) {
  if (!traceInteractionModel || !tracePage.minimapCanvas) return;
  const world = traceMinimapWorld();
  const target = traceMinimapScrollTarget(event.clientX, event.clientY, tracePage.minimapCanvas.getBoundingClientRect(), world.width, world.height, tracePage.canvas.clientWidth, tracePage.canvas.clientHeight);
  tracePage.canvas.scrollLeft = target.left;
  tracePage.canvas.scrollTop = target.top;
  scheduleTraceMinimapUpdate();
}

function beginTraceMinimapDrag(event) {
  if (event.button !== 0 || !traceInteractionModel) return;
  event.preventDefault();
  traceMinimapDrag = { pointerId:event.pointerId };
  tracePage.minimapCanvas.setPointerCapture?.(event.pointerId);
  tracePage.minimap?.classList.add("dragging");
  navigateTraceMinimap(event);
}

function moveTraceMinimapDrag(event) {
  if (!traceMinimapDrag || event.pointerId !== traceMinimapDrag.pointerId) return;
  event.preventDefault();
  navigateTraceMinimap(event);
}

function finishTraceMinimapDrag(event) {
  if (!traceMinimapDrag || event.pointerId !== traceMinimapDrag.pointerId) return;
  tracePage.minimapCanvas?.releasePointerCapture?.(event.pointerId);
  traceMinimapDrag = null;
  tracePage.minimap?.classList.remove("dragging");
}

function handleTraceMinimapKeydown(event) {
  if (!traceInteractionModel) return;
  const stepX = Math.max(40, tracePage.canvas.clientWidth * .22), stepY = Math.max(40, tracePage.canvas.clientHeight * .22);
  const changes = { ArrowLeft:[-stepX, 0], ArrowRight:[stepX, 0], ArrowUp:[0, -stepY], ArrowDown:[0, stepY] };
  if (changes[event.key]) {
    event.preventDefault();
    tracePage.canvas.scrollLeft += changes[event.key][0]; tracePage.canvas.scrollTop += changes[event.key][1];
  } else if (event.key === "Home") {
    event.preventDefault(); tracePage.canvas.scrollLeft = 0; tracePage.canvas.scrollTop = 0;
  } else if (event.key === "End") {
    event.preventDefault(); tracePage.canvas.scrollLeft = tracePage.canvas.scrollWidth; tracePage.canvas.scrollTop = tracePage.canvas.scrollHeight;
  } else return;
  scheduleTraceMinimapUpdate();
}

function traceAssetUrl(fileName) {
  const normalizedName = String(fileName || "").replace(/^\/+/, "");
  const extensionPath = normalizedName.startsWith("extension/") ? normalizedName : `extension/graylog/${normalizedName}`;
  return globalThis.chrome?.runtime?.getURL?.(extensionPath) || normalizedName;
}

function createTraceStatusIcon(status) {
  const meta = traceStatusMeta[status];
  if (!meta) return null;
  const image = document.createElement("img");
  image.className = `trace-status-icon trace-status-${status}`;
  image.src = traceAssetUrl(meta.src);
  image.alt = meta.label;
  image.title = meta.label;
  image.draggable = false;
  return image;
}

function createTraceKindIcon(fileName, label) {
  const image = document.createElement("img");
  image.className = "trace-kind-icon";
  image.src = traceAssetUrl(fileName);
  image.alt = "";
  image.title = label;
  image.draggable = false;
  return image;
}

function loadTraceStatusImages() {
  if (traceStatusImagesPromise) return traceStatusImagesPromise;
  const sources = [...Object.entries(traceStatusMeta), ["cache", { src:"trace-cache.png" }], ["service", { src:"trace-service.png" }], ["kafka", { src:"trace-kafka.png" }]];
  traceStatusImagesPromise = Promise.all(sources.map(([status, meta]) => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve([status, image]);
    image.onerror = () => resolve([status, null]);
    image.src = traceAssetUrl(meta.src);
  }))).then((entries) => Object.fromEntries(entries));
  return traceStatusImagesPromise;
}

function renderRepeatedHttpSummary(items) {
  if (!tracePage.duplicateSummary) return;
  const repeated = Array.isArray(items) ? items.filter((item) => Number(item?.count) > 1 && item?.service && item?.url) : [];
  tracePage.duplicateSummary.hidden = !repeated.length;
  if (!repeated.length) { tracePage.duplicateSummary.replaceChildren(); return; }
  const wasOpen = Boolean(tracePage.duplicateSummary.querySelector("details")?.open);
  const details = document.createElement("details"); details.open = wasOpen;
  const title = document.createElement("summary");
  title.textContent = `Повторные HTTP-вызовы · ${repeated.length} ${repeated.length === 1 ? "группа" : repeated.length < 5 ? "группы" : "групп"}`;
  title.title = "Развернуть список повторных маршрутов. Он не перекрывает граф по умолчанию.";
  const list = document.createElement("ul");
  for (const item of repeated) {
    const row = document.createElement("li");
    const service = document.createElement("b"); service.textContent = item.callerService || item.service;
    const targetServices = Array.isArray(item.targetServices) ? item.targetServices.filter(Boolean) : [];
    const url = document.createElement("code"); url.textContent = `${Array.isArray(item.methods) && item.methods.length ? `${item.methods.join("/")} ` : ""}${item.url}`;
    row.append(service, document.createTextNode(targetServices.length ? ` вызвал ${targetServices.join(", ")} по одинаковому URL ` : " вызвал одинаковый URL "), url, document.createTextNode(` ${repeatedTimesLabel(item.count)}.`));
    list.append(row);
  }
  details.append(title, list);
  tracePage.duplicateSummary.replaceChildren(details);
}

function traceExternalPairs(family) {
  const requests = Array.from({length:Math.min(200, Number(family.requestTotal) || 0)}, (_, index) => ({
    detail:traceSubcallDetail(family.details, index),
    requestAt:traceSubcallDetail(family.details, index)?.at ?? family.requestTimes?.[index] ?? (Number(family.requestTotal) === 1 ? family.requestAt : null),
    requestObserved:true, responseObserved:false
  }));
  const samples = (family.samples || []).slice(0, 200);
  if (!samples.length) return null; // Older reduced models retain their original rendering.
  const used = new Set();
  if (Array.isArray(family.exchanges)) {
    // Reuse the model's unmasked URI/time pairing. Re-matching masked display
    // URLs here could merge unrelated calls, and duration may be absent.
    for (const exchange of family.exchanges) {
      const matches=requests.filter(request=>request.requestAt===exchange.requestAt&&family.details?.indexOf(request.detail)===exchange.targetOrdinal);
      const responses=samples.map((sample,index)=>({sample,index})).filter(({sample,index})=>sample.at===exchange.responseAt&&(!Number.isInteger(exchange.responseOrdinal)||index===exchange.responseOrdinal));
      if(matches.length!==1||responses.length!==1||matches[0].responseObserved||used.has(responses[0].index))continue;
      Object.assign(matches[0],{responseObserved:true,sample:responses[0].sample});used.add(responses[0].index);
    }
    samples.forEach((sample,index)=>{if(!used.has(index))requests.push({detail:null,requestAt:null,requestObserved:false,responseObserved:true,sample});});
    return requests;
  }
  const candidates = requests.map(request => samples.map((sample, index) => ({sample,index})).filter(({sample}) =>
    request.requestAt != null && sample.at != null && sample.duration != null &&
    (!request.detail?.procedure || !sample.procedure || String(request.detail.procedure).toLowerCase() === String(sample.procedure).toLowerCase()) &&
    Math.abs(Number(sample.at) - Number(sample.duration) - Number(request.requestAt)) <= 2));
  for (const [index, request] of requests.entries()) {
    if (candidates[index].length !== 1) continue;
    const match = candidates[index][0];
    if (candidates.filter(list => list.some(item => item.index === match.index)).length !== 1) continue;
    Object.assign(request, {responseObserved:true, sample:match.sample}); used.add(match.index);
  }
  const missing = requests.filter(request => !request.responseObserved);
  const remaining = samples.map((sample,index) => ({sample,index})).filter(item => !used.has(item.index));
  // A single unambiguous call may omit duration. With several calls keep unmatched responses separate.
  if (requests.length === 1 && missing.length === 1 && samples.length === 1 && samples[0].duration == null &&
      (missing[0].requestAt == null || samples[0].at == null || Number(samples[0].at) >= Number(missing[0].requestAt))) {
    Object.assign(missing[0], {responseObserved:true,sample:samples[0]}); used.add(0);
  }
  for (const {sample,index} of remaining) if (!used.has(index)) requests.push({detail:null,requestAt:null,requestObserved:false,responseObserved:true,sample});
  return requests;
}

function traceDiagnosticLines(diagnostic) {
  const lines=[
    diagnostic.binding === "exact" ? "Диагностическая связь по service + span" : diagnostic.binding === "ambiguous" ? "Привязка неоднозначна · линия не построена" : "Владелец span не найден · линия не построена",
    `Сервис: ${diagnostic.service || "не указан"}`,
    `spanId: ${diagnostic.spanIds.join(", ") || "не указан"}`,
    ...diagnostic.causes.flatMap(cause => [`${cause.title} ×${cause.count}`,...(cause.exceptionMessage?[cause.exceptionMessage]:[])])
  ];
  return lines.flatMap(text=>{
    const wrapped=[];let line="";
    for(const word of text.split(/\s+/)) {
      if(line&&traceTextCells(`${line} ${word}`)>72){wrapped.push(line);line="";}
      if(word.length>72){if(line){wrapped.push(line);line="";}for(let i=0;i<word.length;i+=72)wrapped.push(word.slice(i,i+72));}
      else line=line?`${line} ${word}`:word;
    }
    if(line)wrapped.push(line);return wrapped;
  });
}

function traceDiagnosticSubcall(diagnostic, x, depth) {
  const lines = traceDiagnosticLines(diagnostic);
  return {
    diagnostic:true, detail:diagnostic, label:diagnostic.label, parentIndex:diagnostic.ownerIndex,
    subIndex:0, total:0, requestTotal:0, responseTotal:0, requestObserved:false, responseObserved:false,
    requestAt:null, responseAt:null, responseDuration:null, responseLevel3:false, oneWay:true, labels:[],
    width:Math.ceil(Math.max(420, ...lines.map(line => 28 + traceTextCells(line) * 6.4))),
    height:56 + lines.length * 17, x, y:0, depth
  };
}

function traceKafkaConsumeAssumptions(nodes, diagnostics = [], outgoingFailures = []) {
  const list = Array.isArray(nodes) ? nodes : [];
  const timestamp = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const observedAfter = (consumedAt, count, times, fallback, details = []) => {
    const total = Math.max(0, Math.floor(Number(count) || 0));
    if (!total) return false;
    const timeList = (Array.isArray(times) ? times : []).map(timestamp).filter((value) => value !== null);
    const detailList = (Array.isArray(details) ? details : []).map((item) => timestamp(item?.at)).filter((value) => value !== null);
    const fallbackTime = timestamp(fallback);
    const known = [...timeList, ...detailList, ...(fallbackTime === null ? [] : [fallbackTime])];
    if (timeList.length < total && detailList.length < total && !(total === 1 && fallbackTime !== null)) return true;
    return known.some((value) => value > consumedAt);
  };
  const results = [];
  list.forEach((node, ownerIndex) => {
    const consumes = Array.isArray(node?.kafkaConsumes) ? node.kafkaConsumes : [];
    const consumeTimes = consumes.map((item) => timestamp(item?.at)).filter((value) => value !== null);
    const declaredCount = Math.max(0, Math.floor(Number(node?.kafkaConsumeCount) || 0));
    // Unknown consume ordering cannot prove that the trace ends after consume.
    if (!declaredCount || !consumeTimes.length || consumeTimes.length < declaredCount) return;
    const consumedAt = Math.max(...consumeTimes);
    const activity = [
      [node.responseCount, node.responseTimes, node.responseAt, node.responseTargets],
      [node.openApiRequestCount, node.openApiRequestTimes, node.openApiRequestAt, node.openApiRequestTargets],
      [node.openApiResponseCount, node.openApiResponseTimes, node.openApiResponseAt, node.openApiResponseTargets],
      [node.gorodClientRequestCount, node.gorodClientRequestTimes, node.gorodClientRequestAt, node.gorodClientRequestTargets],
      [node.gorodClientResponseCount, node.gorodClientResponseTimes, node.gorodClientResponseAt, node.gorodClientResponseTargets],
      [node.partnerBackendRequestCount, node.partnerBackendRequestTimes, node.partnerBackendRequestAt, node.partnerBackendRequestTargets],
      [node.partnerBackendResponseCount, node.partnerBackendResponseTimes, node.partnerBackendResponseAt, node.partnerBackendResponseTargets],
      [node.kafkaProduceCount, node.kafkaProduceTimes, node.kafkaProduceAt, node.kafkaProduces],
      [node.kafkaBrokerCount, node.kafkaBrokerTimes, node.kafkaBrokerAt, node.kafkaBrokers],
      [node.xmlProcedureRequestCount, node.xmlProcedureRequestTimes, node.xmlProcedureRequestAt, node.xmlProcedureRequests],
      [node.xmlProcedureResponseCount, node.xmlProcedureResponseTimes, node.xmlProcedureResponseAt, node.xmlProcedureResponseSamples],
      [node.cacheAccessCount, node.cacheAccessTimes, node.cacheAccessAt, node.cacheAccesses]
    ].some((entry) => observedAfter(consumedAt, ...entry));
    const childActivity = list.some((child, childIndex) => {
      if (childIndex === ownerIndex || child?.parentIndex !== ownerIndex) return false;
      const times = [child.requestAt, child.openApiRequestAt, child.gorodClientRequestAt, child.partnerBackendRequestAt, child.kafkaProduceAt, child.kafkaConsumeAt, child.kafkaBrokerAt, child.xmlProcedureRequestAt, child.xmlProcedureResponseAt, child.cacheAccessAt, child.responseAt]
        .map(timestamp).filter((value) => value !== null);
      return !times.length || times.some((value) => value > consumedAt);
    });
    const diagnosticActivity = (Array.isArray(diagnostics) ? diagnostics : []).some((item) => item?.ownerIndex === ownerIndex);
    const failedActivity = (Array.isArray(outgoingFailures) ? outgoingFailures : []).some((item) => item?.ownerIndex === ownerIndex
      && (timestamp(item?.at) === null || timestamp(item.at) > consumedAt));
    if (activity || childActivity || diagnosticActivity || failedActivity) return;
    results.push({ ownerIndex, consumedAt, topic:String(consumes.find((item) => timestamp(item?.at) === consumedAt)?.topic || "") });
  });
  return results;
}

function traceRoutePath(url) {
  const raw = String(url || "").trim().toLowerCase();
  if (!raw) return "";
  try { return new URL(raw, "https://trace.invalid").pathname.replace(/\/+$/, "") || "/"; }
  catch { return raw.split(/[?#]/, 1)[0].replace(/\/+$/, ""); }
}

function traceKafkaBoundarySubcall(assumption, x, depth) {
  return {
    assumption:true, label:"ПРЕДПОЛОЖЕНИЕ", parentIndex:assumption.ownerIndex,
    subIndex:0, total:0, requestTotal:0, responseTotal:0, requestObserved:false, responseObserved:false,
    requestAt:null, responseAt:null, responseDuration:null, responseLevel3:false, oneWay:true, labels:[],
    detail:{ text:"Дальнейшее действие не найдено · возможно БД или кеш", topic:assumption.topic },
    width:340, height:86, x, y:0, depth
  };
}

function traceOutgoingFailureSubcall(failure, x, depth) {
  const requestObserved = Boolean(failure.requestMatch);
  return {label:"HTTP CLIENT", parentIndex:failure.ownerIndex, subIndex:0, total:1,
    requestTotal:requestObserved ? 1 : 0, responseTotal:0,
    requestAt:failure.requestMatch?.at ?? null, responseAt:null, responseDuration:null,
    requestObserved, responseObserved:false, responseLevel3:false, clientFailure:failure,
    detail:{method:failure.method,url:failure.url}, labels:[],
    width:Math.max(380, traceSubcallWidth(failure, 380), 24 + traceTextCells(`${failure.service} · span: ${failure.spanId} · связь не определена`) * 6.4), height:126, depth, x, y:0};
}

function layoutTrace(nodes, diagnostics = [], outgoingFailures = [], kafkaLinks = [], edges = []) {
  const families=globalThis.TraceApplicationGroups?.group(nodes)||[];
  const familyRank=new Map(families.flatMap((family,index)=>family.nodeIndexes.map(node=>[node,index])));
  const packingWidth=Math.max(1600,Math.min(4800,Math.sqrt(nodes.length)*520));
  const siblingColumns=nodes.length>40?4:3;
  const kafkaAssumptions = typeof traceKafkaConsumeAssumptions === "function" ? traceKafkaConsumeAssumptions(nodes, diagnostics, outgoingFailures) : [];
  const children = nodes.map(() => []);
  const roots = [];
  nodes.forEach((node, index) => {
    if (Number.isInteger(node.parentIndex) && node.parentIndex >= 0 && node.parentIndex < nodes.length && node.parentIndex !== index) children[node.parentIndex].push(index);
    else roots.push(index);
  });
  const observedTime = item => [item.reconstructedEntry?.at, item.requestAt, item.openApiRequestAt, item.gorodClientRequestAt, item.partnerBackendRequestAt, item.kafkaProduceAt, item.kafkaConsumeAt, item.kafkaBrokerAt, item.xmlProcedureRequestAt, item.xmlProcedureResponseAt, item.cacheAccessAt, item.responseAt, item.openApiResponseAt, item.gorodClientResponseAt, item.partnerBackendResponseAt]
    .find(value => typeof value === "number" && Number.isFinite(value)) ?? Infinity;
  const byTime = (left, right) => observedTime(nodes[left]) - observedTime(nodes[right]);
  children.forEach((items) => items.sort(byTime));
  // Keep the trace entry in the first row even when a disconnected family
  // occurs earlier in the source array or grows after assumption matching.
  roots.sort((a,b)=>Number(traceCanonicalGateway(nodes[b]))-Number(traceCanonicalGateway(nodes[a]))
    || (familyRank.get(a)??0)-(familyRank.get(b)??0)||byTime(a,b));
  let leaf = 0;
  const cardWidths = nodes.map(traceCardWidth);
  const cardHeights = nodes.map(traceCardHeight);
  const laneWidth = Math.max(290, ...cardWidths.map((width) => width + 50));
  const positions = new Array(nodes.length);
  const subcalls = [];
  const place = (index, depth, seen) => {
    if (seen.has(index)) return leaf++;
    const nextSeen = new Set(seen); nextSeen.add(index);
    const childXs = children[index].map((child) => place(child, depth + 1, nextSeen));
    const subcallXs = [];
    const consumedFailures = new Set();
    const families = [
      { label:"OPENAPI", exchanges:nodes[index].clientExchanges?.filter(call=>call.family==='openApi'), requestTotal:nodes[index].openApiRequestCount, responseTotal:nodes[index].openApiResponseCount, requestAt:nodes[index].openApiRequestAt, responseAt:nodes[index].openApiResponseAt, requestTimes:nodes[index].openApiRequestTimes, responseTimes:nodes[index].openApiResponseTimes, requestLogSteps:nodes[index].openApiRequestLogSteps, responseLogSteps:nodes[index].openApiResponseLogSteps, durations:nodes[index].openApiResponseDurations, details:nodes[index].openApiRequestTargets, width:280 },
      { label:"HTTP CLIENT", exchanges:nodes[index].clientExchanges?.filter(call=>call.family==='gorodClient'), requestTotal:nodes[index].gorodClientRequestCount, responseTotal:nodes[index].gorodClientResponseCount, requestAt:nodes[index].gorodClientRequestAt, responseAt:nodes[index].gorodClientResponseAt, requestTimes:nodes[index].gorodClientRequestTimes, responseTimes:nodes[index].gorodClientResponseTimes, requestLogSteps:nodes[index].gorodClientRequestLogSteps, responseLogSteps:nodes[index].gorodClientResponseLogSteps, durations:nodes[index].gorodClientResponseDurations, details:nodes[index].gorodClientRequestTargets, width:280 },
      { label:"PARTNER BACKEND", exchanges:nodes[index].clientExchanges?.filter(call=>call.family==='partnerBackend'), requestTotal:nodes[index].partnerBackendRequestCount, responseTotal:nodes[index].partnerBackendResponseCount, requestAt:nodes[index].partnerBackendRequestAt, responseAt:nodes[index].partnerBackendResponseAt, requestTimes:nodes[index].partnerBackendRequestTimes, responseTimes:nodes[index].partnerBackendResponseTimes, requestLogSteps:nodes[index].partnerBackendRequestLogSteps, responseLogSteps:nodes[index].partnerBackendResponseLogSteps, durations:nodes[index].partnerBackendResponseDurations, details:nodes[index].partnerBackendRequestTargets, width:300 },
      { label:"ПРОЦЕДУРА", requestTotal:nodes[index].xmlProcedureRequestCount, responseTotal:nodes[index].xmlProcedureResponseCount, requestAt:nodes[index].xmlProcedureRequestAt, responseAt:nodes[index].xmlProcedureResponseAt, requestTimes:nodes[index].xmlProcedureRequestTimes, responseTimes:nodes[index].xmlProcedureResponseTimes, requestLogSteps:nodes[index].xmlProcedureRequestLogSteps, responseLogSteps:nodes[index].xmlProcedureResponseLogSteps, durations:nodes[index].xmlProcedureResponseDurations, details:nodes[index].xmlProcedureRequests, samples:nodes[index].xmlProcedureResponseSamples, xmlProcedure:true, width:300 },
      { label:"↑ KAFKA · ОТПРАВКА", requestTotal:isKafkaOnlyNode(nodes[index]) ? 0 : nodes[index].kafkaProduceCount, responseTotal:0, requestAt:nodes[index].kafkaProduceAt, requestTimes:nodes[index].kafkaProduceTimes, requestLogSteps:nodes[index].kafkaProduceLogSteps, details:nodes[index].kafkaProduces, oneWay:true, kafkaProduce:true, width:220, height:58 },
      { label:"CACHE", requestTotal:nodes[index].cacheAccessCount, responseTotal:0, requestAt:nodes[index].cacheAccessAt, requestTimes:nodes[index].cacheAccessTimes, requestLogSteps:nodes[index].cacheAccessLogSteps, details:nodes[index].cacheAccesses, oneWay:true, cacheChain:true, width:340, height:112 }
    ];
    for (const family of families) {
      family.samples = family.xmlProcedure ? nodes[index].xmlProcedureResponseSamples : family.label === "OPENAPI" ? nodes[index].openApiResponseSamples : family.label === "HTTP CLIENT" ? nodes[index].gorodClientResponseSamples : family.label === "PARTNER BACKEND" ? nodes[index].partnerBackendResponseSamples : null;
      family.labels = family.label === "OPENAPI" ? [...(nodes[index].openApiRequestLabels || []), ...(nodes[index].openApiResponseLabels || [])] : family.label === "HTTP CLIENT" ? [...(nodes[index].gorodClientRequestLabels || []), ...(nodes[index].gorodClientResponseLabels || [])] : family.label === "PARTNER BACKEND" ? [...(nodes[index].partnerBackendRequestLabels || []), ...(nodes[index].partnerBackendResponseLabels || [])] : [];
      const requestTotal = Math.max(0, Math.floor(Number(family.requestTotal) || 0));
      const responseTotal = Math.max(0, Math.floor(Number(family.responseTotal) || 0));
      const pairs = family.oneWay ? null : traceExternalPairs(family);
      const count = pairs?.length ?? Math.max(requestTotal, responseTotal);
      const visibleCount = Math.min(family.oneWay ? 10 : 200, count);
      if (!visibleCount) continue;
      for (let subIndex = 0; subIndex < visibleCount; subIndex += 1) {
        const pair = pairs?.[subIndex];
        const eventDetail = pair ? pair.detail : traceSubcallDetail(family.details, subIndex);
        const detail = family.cacheChain ? { ...eventDetail, cacheOwnerService:nodes[index].service } : eventDetail;
        const requestAt = pair ? pair.requestAt : detail?.at ?? family.requestTimes?.[subIndex] ?? family.requestAt ?? null;
        const failure = (nodes[index].outgoingFailures || []).find(item => item.requestMatch?.family === family.label && item.requestMatch.at === requestAt && item.url === detail?.url && item.method === detail?.method && (pair?.requestObserved ?? subIndex < requestTotal) && !(pair?.responseObserved ?? subIndex < responseTotal));
        if (failure) consumedFailures.add(failure);
        const labels = family.labels.filter(label => (label.at != null && (label.at === requestAt || label.at === pair?.sample?.at)) || count === 1);
        const labelLines = traceLabelLines(labels);
        const width = Math.max(traceSubcallWidth(detail, family.width), failure ? Math.max(380, 24 + traceTextCells(`${failure.service} · span: ${failure.spanId}`) * 6.4) : 0, ...labelLines.map(line => 36 + traceTextCells(line) * 6.4));
        const leftUnit = leaf;
        const unit = leftUnit + width / (2 * laneWidth);
        const responseDuration = pair ? pair.sample?.duration ?? null : family.durations?.[subIndex] ?? null;
        const executionDuration = globalThis.TraceLatency ? TraceLatency.duration({ responseDuration, requestAt, responseAt:pair?.sample?.at ?? family.responseTimes?.[subIndex] ?? null, requestObserved:Boolean(pair?.requestObserved), responseObserved:Boolean(pair?.responseObserved), oneWay:family.oneWay }) : responseDuration;
        // An outgoing HTTP call whose target route no loaded node was ever
        // called on: the callee's own messages are not in this trace's
        // sample (another stream, traceId not propagated, or outside the
        // window). Say so on the card instead of leaving a bare client call.
        const calleeMissing = !family.oneWay && !family.cacheChain && !family.xmlProcedure && !failure && Boolean(detail?.url)
          && !nodes.some((other, otherIndex) => otherIndex !== index && (other.requestTargets || []).some(item => traceRoutePath(item?.url) === traceRoutePath(detail.url)));
        const height = (failure ? 126 : family.oneWay ? family.height : 48 + (detail?.url ? 28 : 0) + (durationLabel(executionDuration) ? 40 : 0)) + (labelLines.length ? labelLines.length * 16 + 12 : 0) + (calleeMissing ? 18 : 0);
        subcallXs.push(unit);
        const inferredResponseAt = requestAt !== null && durationLabel(responseDuration) ? Number(requestAt) + Number(responseDuration) : null;
        const responseAt = pair ? pair.sample?.at ?? null : family.responseTimes?.[subIndex] ?? inferredResponseAt ?? family.responseAt ?? null;
        const logStepFor=(times,steps,at,fallbackIndex)=>{const exact=(times||[]).findIndex(value=>value===at);return (steps||[])[exact>=0?exact:fallbackIndex]??null;};
        subcalls.push({ label:family.cacheChain ? detail?.operation === "put" ? "CACHE · PUT / запись" : "CACHE · GET / чтение" : family.label, parentIndex:index, subIndex, targetOrdinal:family.details?.indexOf(eventDetail) ?? -1, total:count, requestTotal, responseTotal, requestAt, responseAt, requestLogStep:logStepFor(family.requestTimes,family.requestLogSteps,requestAt,subIndex), responseLogStep:logStepFor(family.responseTimes,family.responseLogSteps,responseAt,subIndex), responseDuration:executionDuration, responseStatus:pair?.sample?.status || family.exchanges?.[subIndex]?.response?.status || family.samples?.[subIndex]?.status || null, responseLevel3:Boolean(pair?.sample?.level3), clientFailure:failure || null, calleeMissing, labels, requestObserved:pair?.requestObserved ?? subIndex < requestTotal, responseObserved:pair?.responseObserved ?? subIndex < responseTotal, detail, oneWay:Boolean(family.oneWay), kafkaProduce:Boolean(family.kafkaProduce), xmlProcedure:Boolean(family.xmlProcedure), cacheChain:Boolean(family.cacheChain), cacheWrite:Boolean(family.cacheChain && detail?.operation === "put"), width, height, depth:depth + 1, x:45 + leftUnit * laneWidth, y:0 });
        leaf += Math.max(.5, (width + 50) / laneWidth);
      }
    }
    for (const failure of (nodes[index].outgoingFailures || []).filter(item => !consumedFailures.has(item))) {
      const call = traceOutgoingFailureSubcall(failure, 45 + leaf * laneWidth, depth + 1);
      subcalls.push(call); subcallXs.push(leaf + call.width / (2 * laneWidth));
      leaf += (call.width + 50) / laneWidth;
    }
    for (const diagnostic of diagnostics.filter(item => item.ownerIndex === index)) {
      const call = traceDiagnosticSubcall(diagnostic, 45 + leaf * laneWidth, depth + 1);
      subcalls.push(call); subcallXs.push(leaf + call.width / (2 * laneWidth));
      leaf += (call.width + 50) / laneWidth;
    }
    for (const assumption of kafkaAssumptions.filter((item) => item.ownerIndex === index)) {
      const call = traceKafkaBoundarySubcall(assumption, 45 + leaf * laneWidth, depth + 1);
      subcalls.push(call); subcallXs.push(leaf + call.width / (2 * laneWidth));
      leaf += (call.width + 50) / laneWidth;
    }
    const anchors = [...childXs, ...subcallXs].sort((a, b) => a - b);
    const x = anchors.length ? (anchors[0] + anchors[anchors.length - 1]) / 2 : leaf++;
    positions[index] = { x:45 + x * laneWidth + (laneWidth - cardWidths[index]) / 2, y:0, width:cardWidths[index], height:cardHeights[index], depth, hasKafkaBroker:isKafkaOnlyNode(nodes[index]) };
    return x;
  };
  roots.forEach((root) => place(root, 0, new Set()));
  // Recursive parent centering can extend a node beyond its leaf allocation.
  // Reserve actual card/broker widths when packing each level, rather than
  // assuming the leaf cursor also bounds the parent rectangle.
  const kafkaEndpoints = createKafkaEndpoints(nodes, positions, subcalls, kafkaLinks);
  // A model-confirmed outgoing operation is an intermediate box, not another
  // sibling of the work it contains. Never choose one of competing call boxes.
  nodes.forEach((node,index) => {
    const reference=node.parentCall,label={openApi:'OPENAPI',gorodClient:'HTTP CLIENT',partnerBackend:'PARTNER BACKEND'}[reference?.family];
    if (!label || !Number.isInteger(node.parentIndex) || (!Number.isFinite(reference.requestAt)&&!reference.requestInferred)) return;
    const matches=subcalls.map((call,callIndex)=>({call,callIndex})).filter(({call})=>call.parentIndex===node.parentIndex && call.label===label && (reference.requestInferred
      ? !call.requestObserved&&call.responseObserved&&call.responseAt===reference.responseAt
      : call.requestObserved&&call.requestAt===reference.requestAt&&(!Number.isInteger(reference.targetOrdinal)||call.targetOrdinal===reference.targetOrdinal)));
    if(matches.length!==1)return;
    positions[index].parentSubcallIndex=matches[0].callIndex;
    (matches[0].call.childNodeIndexes ||= []).push(index);
  });
  const callGroups=globalThis.TraceCallGroups?.plan(nodes,positions,subcalls,edges,traceExpandedCallGroups)||[];
  const brokerWidths = new Map();
  for (const endpoint of kafkaEndpoints) {
    const owner = endpoint.ownerType === "node" ? positions[endpoint.ownerIndex] : subcalls[endpoint.ownerIndex];
    if (!owner) continue;
    brokerWidths.set(owner, Math.max(brokerWidths.get(owner) || 0, endpoint.width + 2 * Math.abs(Number(endpoint.ownerOffset) || 0)));
  }
  // Pack actual subtree contours. A long label in one branch must not create
  // a wide empty lane for every other branch. Parents stay over their children.
  const footprint=item=>Math.max(item.width,brokerWidths.get(item)||0);
  const cluster=(item,childClusters=[])=>{
    const rows=[],limit=packingWidth;
    let row=[],rowWidth=0;
    for(const child of childClusters) {
      const left=Math.min(...child.contours.map(b=>b.left)),right=Math.max(...child.contours.map(b=>b.right)),width=right-left;
      if(row.length&&(row.length>=siblingColumns||rowWidth+42+width>limit)){rows.push(row);row=[];rowWidth=0;}
      row.push({child,left,right,width});rowWidth+=(row.length>1?42:0)+width;
    }
    if(row.length)rows.push(row);
    const entries=[],contours=[],wrapped=rows.length>1;
    const maximumWidth=Math.max(0,...rows.map(items=>items.reduce((sum,entry)=>sum+entry.width,0)+(items.length-1)*42));
    const gutter=-maximumWidth/2-36;
    let rowDepth=1;
    for(const items of rows) {
      const width=items.reduce((sum,entry)=>sum+entry.width,0)+(items.length-1)*42;
      let cursor=-width/2;
      for(const {child,left,width:childWidth} of items) {
        const shift=cursor-left;
        for(const entry of child.entries) {
          const moved={...entry,x:entry.x+shift,depth:entry.depth+rowDepth};
          if(Number.isFinite(entry.gutter))moved.gutter=entry.gutter+shift;
          if(wrapped&&entry.depth===0)moved.gutter=gutter;
          entries.push(moved);
        }
        child.contours.forEach((b,depth)=>{
          const index=depth+rowDepth-1,moved={left:b.left+shift,right:b.right+shift};
          contours[index]=contours[index]?{left:Math.min(contours[index].left,moved.left),right:Math.max(contours[index].right,moved.right)}:moved;
        });
        cursor+=childWidth+42;
      }
      rowDepth+=Math.max(...items.map(entry=>entry.child.contours.length));
    }
    if(wrapped)for(const bounds of contours)bounds.left=Math.min(bounds.left,gutter-12);
    const half=footprint(item)/2;
    return {entries:[{item,x:0,depth:0},...entries],contours:[{left:wrapped?Math.min(-half,gutter-12):-half,right:half},...contours]};
  };
  const compact=(index,seen=new Set())=>{
    const next=new Set(seen);next.add(index);
    // All observed outgoing exchanges share one chronological sibling order.
    // Appending subcalls after service subtrees displaced early cache/Kafka calls
    // into later rows. Equal or unavailable timestamps retain their input order;
    // a missing timestamp does not fabricate an early exchange.
    const descendants=children[index].filter(child=>!positions[child].foldHidden&&!next.has(child)&&!Number.isInteger(positions[child].parentSubcallIndex))
      .map(child=>({time:observedTime(nodes[child]),tree:compact(child,next)}));
    descendants.push(...subcalls.filter(call=>call.parentIndex===index&&!call.foldHidden)
      .map(call=>({time:observedTime(call),tree:cluster(call,(call.childNodeIndexes||[]).filter(child=>!positions[child].foldHidden&&!next.has(child)).map(child=>compact(child,next)))})));
    descendants.sort((left,right)=>left.time-right.time);
    return cluster(positions[index],descendants.map(entry=>entry.tree));
  };
  let forestRight=45,forestDepth=0,forestRowDepth=0,forestColumns=0;
  for(const root of roots) {
    const tree=compact(root),left=Math.min(...tree.contours.map(row=>row.left)),right=Math.max(...tree.contours.map(row=>row.right));
    if(forestColumns&&(forestColumns>=6||forestRight+right-left>packingWidth+45)){forestDepth+=forestRowDepth+1;forestRight=45;forestRowDepth=0;forestColumns=0;}
    for(const entry of tree.entries){entry.item.x=forestRight-left+entry.x-entry.item.width/2;entry.item.depth=forestDepth+entry.depth;if(Number.isFinite(entry.gutter))entry.item.routeGutter=forestRight-left+entry.gutter;}
    forestRight+=right-left+64;
    forestColumns++;forestRowDepth=Math.max(forestRowDepth,tree.contours.length);
  }
  positions.forEach((box,index)=>{const parent=subcalls[box.parentSubcallIndex]||positions[nodes[index].parentIndex];if(parent&&Number.isFinite(box.routeGutter))box.routeGutterOffset=box.routeGutter-parent.x;});
  subcalls.forEach(box=>{const parent=positions[box.parentIndex];if(parent&&Number.isFinite(box.routeGutter))box.routeGutterOffset=box.routeGutter-parent.x;});
  const levels = new Map();
  const addLevelItem = (item) => {
    if(item.foldHidden)return;
    const depth = Math.max(0, Number(item.depth) || 0);
    if (!levels.has(depth)) levels.set(depth, []);
    levels.get(depth).push(item);
  };
  positions.filter(Boolean).forEach(addLevelItem);
  subcalls.forEach(addLevelItem);
  let levelTop = 35;
  for (const depth of [...levels.keys()].sort((left, right) => left - right)) {
    const items = levels.get(depth).sort((left, right) => left.x - right.x);
    let levelBottom = levelTop;
    items.forEach((item) => {
      item.y = levelTop;
      levelBottom = Math.max(levelBottom, item.y + item.height + (item.kafkaProduce || item.hasKafkaBroker ? 124 : 0));
    });
    levelTop = levelBottom + 80;
  }
  for(const item of [...positions,...subcalls])if(item.foldHidden){item.x=item.foldOwner.x;item.y=item.foldOwner.y;}
  kafkaEndpoints.forEach(endpoint => updateKafkaEndpointGeometry(endpoint, positions, subcalls));
  // Unowned evidence is a separate region, not another root at a guessed causal depth.
  // Parent centering can extend beyond the final leaf cursor, so that cursor cannot
  // safely place standalone boxes beside observed root cards.
  const orphanTop = Math.max(0, ...positions.filter(Boolean).map(item => item.y + item.height), ...subcalls.map(item => item.y + item.height), ...kafkaEndpoints.map(item => item.y + item.height)) + 105;
  let orphanLeft = 45;
  for (const diagnostic of diagnostics.filter(item => item.ownerIndex === null)) {
    const call = traceDiagnosticSubcall(diagnostic, orphanLeft, 0);
    call.y = orphanTop;
    subcalls.push(call); orphanLeft += call.width + 50;
  }
  for (const failure of outgoingFailures.filter(item => item.ownerIndex === null || item.ownerIndex >= nodes.length)) {
    const call = traceOutgoingFailureSubcall({...failure, ownerIndex:null}, orphanLeft, 0);
    call.y = orphanTop; subcalls.push(call); orphanLeft += call.width + 50;
  }
  let orphanY=orphanTop,orphanRowHeight=0,orphanColumn=0;orphanLeft=45;
  for(const call of subcalls.filter(item=>item.parentIndex===null)) {
    if(orphanColumn&&(orphanColumn>=3||orphanLeft+call.width>1645)){orphanY+=orphanRowHeight+64;orphanLeft=45;orphanColumn=0;orphanRowHeight=0;}
    call.x=orphanLeft;call.y=orphanY;orphanLeft+=call.width+42;orphanColumn++;orphanRowHeight=Math.max(orphanRowHeight,call.height);
  }
  const maxX = Math.max(0, ...positions.filter(Boolean).map(item => item.x + item.width), ...subcalls.map(item => item.x + item.width), ...kafkaEndpoints.map((item) => item.x + item.width));
  const maxY = Math.max(0, ...positions.filter(Boolean).map((item) => item.y + item.height), ...subcalls.map((item) => item.y + item.height), ...kafkaEndpoints.map((item) => item.y + item.height));
  // A row belongs to its actual calling span, not to adjacent global card IDs.
  // Keep these lightweight bounds separate from topology and event numbering.
  const groups = [];
  for (let parentIndex = 0; parentIndex < nodes.length; parentIndex++) {
    const members = children[parentIndex].filter(index => positions[index]).map(index => ({type:"node", index, box:positions[index]}));
    subcalls.forEach((box, index) => { if (box.parentIndex === parentIndex && !box.diagnostic && !(box.clientFailure && !box.requestObserved)) members.push({type:"subcall", index, box}); });
    const rowYs = [...new Set(members.map(member => member.box.y))].sort((a, b) => a - b);
    rowYs.forEach((y, rowIndex) => {
      const row = members.filter(member => member.box.y === y).sort((a, b) => a.box.x - b.box.x);
      const boxes = row.map(member => member.box);
      for (const member of row) boxes.push(...kafkaEndpoints.filter(endpoint => endpoint.ownerType === member.type && endpoint.ownerIndex === member.index));
      const x = Math.min(...boxes.map(box => box.x)), right = Math.max(...boxes.map(box => box.x + box.width));
      const bottom = Math.max(...boxes.map(box => box.y + box.height));
      groups.push({parentIndex, rowIndex, rowCount:rowYs.length, nodeIndexes:row.filter(member => member.type === "node").map(member => member.index), subcallIndexes:row.filter(member => member.type === "subcall").map(member => member.index), x, y, width:right - x, height:bottom - y});
    });
  }
  if (roots.length > 1) {
    const rowYs=[...new Set(roots.map(index=>positions[index]?.y).filter(Number.isFinite))];
    rowYs.forEach((y,rowIndex)=>{
      const members=roots.filter(index=>positions[index]?.y===y),boxes=members.map(index=>positions[index]);
      const x=Math.min(...boxes.map(box=>box.x));
      groups.unshift({parentIndex:null,rowIndex,rowCount:rowYs.length,nodeIndexes:members,subcallIndexes:[],x,y,width:Math.max(...boxes.map(box=>box.x+box.width))-x,height:Math.max(...boxes.map(box=>box.height))});
    });
  }
  return { positions, subcalls, kafkaEndpoints, groups, callGroups, width:Math.max(800, maxX + 45), height:Math.max(550, 80 + maxY) };
}

function traceConnectionRoute(parent, target, offset = 0, reverse = false) {
  const px = parent.x + parent.width / 2, py = parent.y + parent.height;
  const cx = target.x + target.width / 2, cy = target.y, mid = (py + cy) / 2;
  let commands;
  const gutterOffset = target.routeGutterOffset;
  const plannedGutter = typeof gutterOffset === "number" && Number.isFinite(gutterOffset)
    ? parent.x + gutterOffset : target.routeGutter;
  const wrapped = typeof plannedGutter === "number" && Number.isFinite(plannedGutter);
  const gutter = wrapped ? Math.min(plannedGutter, parent.x - 24, target.x - 24) : null;
  if (wrapped) {
    const clearance = Math.min(24, Math.max(8, (cy - py) / 3));
    const points = [[px + offset, py], [px + offset, py + clearance + offset],
      [gutter + offset, py + clearance + offset],
      [gutter + offset, cy - clearance - offset],
      [cx + offset, cy - clearance - offset], [cx + offset, cy]];
    if (reverse) points.reverse();
    commands = [["M", ...points[0]]];
    for (let index = 1; index < points.length - 1; index += 1) {
      const before = points[index - 1], corner = points[index], after = points[index + 1];
      const incoming = Math.hypot(corner[0] - before[0], corner[1] - before[1]);
      const outgoing = Math.hypot(after[0] - corner[0], after[1] - corner[1]);
      const radius = Math.min(10, incoming / 2, outgoing / 2);
      if (!radius) { commands.push(["L", ...corner]); continue; }
      const entry = corner.map((value, axis) => value + (before[axis] - value) * radius / incoming);
      const exit = corner.map((value, axis) => value + (after[axis] - value) * radius / outgoing);
      commands.push(["L", ...entry], ["Q", ...corner, ...exit]);
    }
    commands.push(["L", ...points[points.length - 1]]);
  } else {
    commands = reverse
      ? [["M", cx + offset, cy], ["C", cx + offset, mid, px + offset, mid, px + offset, py]]
      : [["M", px + offset, py], ["C", px + offset, mid, cx + offset, mid, cx + offset, cy]];
  }
  return { commands, d:commands.map(command => command.join(" ")).join(" "),
    endX:(reverse ? px : cx) + offset, endY:reverse ? py : cy, direction:reverse ? -1 : 1,
    labelX:wrapped ? cx + 8 : (px + cx) / 2 + 8, labelY:wrapped ? cy - 34 : mid - 7 };
}

function paintTraceConnection(context, route) {
  context.beginPath();
  for (const [kind, ...values] of route.commands) {
    if (kind === "M") context.moveTo(...values);
    else if (kind === "L") context.lineTo(...values);
    else if (kind === "Q") context.quadraticCurveTo(...values);
    else if (kind === "C") context.bezierCurveTo(...values);
  }
  context.stroke();
}

function traceGroupBounds(group, model) {
  const boxes=[...(group.nodeIndexes||[]).map(i=>model.positions[i]),...(group.subcallIndexes||[]).map(i=>model.subcalls[i])].filter(box=>box&&!box.foldHidden);
  if(!boxes.length)return null;
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
}

function traceGroupLabel(group, nodes) {
  if(group.kind==='island')return group.label||"Несопоставленная ветка";
  if(group.parentIndex===null)return "Корневые ветви · отдельные цепочки";
  const node=nodes[group.parentIndex];
  return `Из ${node?.stepNumber == null ? '' : `№${node.stepNumber} · `}${node?.service || "сервис"}${group.rowCount>1?` · ряд ${group.rowIndex+1}/${group.rowCount}`:""}`;
}

function renderTraceGroups(model) {
  if(!model.groups?.length)return;
  if(!model.groupLayer){model.groupLayer=document.createElement("div");model.groupLayer.className="trace-group-guides";model.stage.append(model.groupLayer);}
  model.groupLayer.replaceChildren();
  for(const group of model.groups){
    const box=traceGroupBounds(group,model);if(!box)continue;
    if(group.kind==='island'){
      const region=document.createElement('div');region.className=`trace-island-frame trace-island-${group.islandKind||'standalone'}`;
      region.style.left=`${box.x-14}px`;region.style.top=`${box.y-14}px`;region.style.width=`${box.width+28}px`;region.style.height=`${Math.max(70,box.height+28)}px`;
      region.title=group.title||group.label||'';model.groupLayer.append(region);
    }
    const label=document.createElement("div");label.className="trace-group-label";
    if(group.kind==='island')label.classList.add('trace-island-label');
    label.textContent=traceGroupLabel(group,model.nodes);label.title=label.textContent;
    label.style.left=`${box.x}px`;label.style.top=`${box.y-27}px`;label.style.maxWidth=`${box.width}px`;
    model.groupLayer.append(label);
  }
}

function drawTraceConnections(svg, defs, edges, nodes, positions, subcalls, kafkaEndpoints, serviceCallLimit) {
  svg.replaceChildren(defs);
  const flowPaths = new Map();
  const uriCallTotals = traceUriCallTotals(nodes);
  for (const [edgeIndex, edge] of (edges || []).entries()) {
    const child = positions[edge.to], parent = subcalls[child?.parentSubcallIndex] || positions[edge.from];
    if (!parent || !child || parent.foldHidden || child.foldHidden) continue;
    const childNode = nodes[edge.to];
    const responseNode = edge.crossServicePair ? nodes[edge.from] : childNode;
    const overLimit = traceNodeOverLimit(childNode, serviceCallLimit, uriCallTotals);
    const failedResponse = Number(responseNode?.responseLevel3Count) > 0;
    const px = parent.x + parent.width / 2, py = parent.y + parent.height, cx = child.x + child.width / 2, cy = child.y;
    const route = traceConnectionRoute(parent, child);
    if (edge.assumption) {
      const association=svgElement("path", {class:"trace-user-assumption", d:route.d, fill:"none", stroke:"#e7b45b", "stroke-width":2, "stroke-dasharray":"4 6", "marker-end":"url(#warning-arrow)"});
      const ordinal=Number.isInteger(edge.assumptionOrdinal)&&edge.assumptionOrdinal>0?edge.assumptionOrdinal:null;
      const description=svgElement("title"); description.textContent=`Предположение${ordinal?` ${ordinal}`:""}: ${edge.reason || "уникальное совпадение локальных признаков"}. Наблюдаемый REQUEST/RESPONSE отсутствует.`;
      association.append(description); svg.append(association);
      const label=svgElement("text", {class:"trace-assumption-edge-label", x:route.labelX, y:route.labelY, "text-anchor":"middle"}); label.textContent=`ПРЕДПОЛОЖЕНИЕ${ordinal?` ${ordinal}`:""}`; svg.append(label);
      continue;
    }
    if (edge.filteredAssociation) {
      const association=svgElement("path", {class:"trace-filtered-ancestry", d:route.d, fill:"none", stroke:"#8fa9ba", "stroke-width":1.5, "stroke-dasharray":"1 7"});
      const description=svgElement("title");
      description.textContent=`Ближайший видимый предок через ${Math.max(1,Number(edge.hiddenHops)||1)} скрытых span-блоков. Линия сохраняет parent chain и не означает сетевой вызов.`;
      association.append(description); svg.append(association);
      const label=svgElement("text", {class:"trace-filtered-ancestry-label", x:route.labelX, y:route.labelY, "text-anchor":"middle"});
      label.textContent=`через ${Math.max(1,Number(edge.hiddenHops)||1)} скрыт.`; svg.append(label);
      continue;
    }
    if (edge.spanAssociation) {
      const association=svgElement("path", {class:"trace-client-span-association", d:route.d, fill:"none", stroke:"#8fa9ba", "stroke-width":1.5, "stroke-dasharray":"2 6"});
      const description=svgElement("title"); description.textContent="CLIENT span того же сервиса по явному parentSpanId. Это принадлежность span, а не сетевой вызов сервиса самого себя.";
      association.append(description); svg.append(association); continue;
    }
    if (childNode?.parentInference === 'openapi-window') {
      const association=svgElement('path',{class:'trace-openapi-window-association',d:route.d,fill:'none',stroke:'#90aeb8','stroke-width':1.7,'stroke-dasharray':'4 5'});
      const description=svgElement('title');description.textContent='Ветка OpenAPI по времени; прямой вызов не подтверждён';
      association.append(description);svg.append(association);continue;
    }
    if (childNode?.parentInference === 'openapi-name-uri' || childNode?.parentInference === 'openapi-gateway-window') {
      const association=svgElement('path',{class:'trace-openapi-window-association',d:route.d,fill:'none',stroke:'#7dd3fc','stroke-width':1.9,'stroke-dasharray':'5 4','marker-end':'url(#request-arrow)'});
      const description=svgElement('title');description.textContent=childNode.parentInference==='openapi-gateway-window'
        ? 'Операция отнесена к входящему запросу OpenAPI gateway по временному окну; при нескольких кандидатах учитывается service-name / URI.'
        : 'Предполагаемая ветка OpenAPI: окно времени и единственный общий смысловой токен service-name / URI.';
      association.append(description);svg.append(association);
      const label=svgElement('text',{class:'trace-operation-label',x:route.labelX,y:route.labelY,'text-anchor':'middle'});label.textContent=childNode.parentInference==='openapi-gateway-window'?'OpenAPI gateway · окно':'OpenAPI · имя + URI';svg.append(label);continue;
    }
    if (childNode?.parentInference === 'gateway-envelope') {
      const association=svgElement('path',{class:'trace-gateway-reconstruction',d:route.d,fill:'none',stroke:'#67e8f9','stroke-width':1.8,'stroke-dasharray':'3 5','marker-end':'url(#request-arrow)'});
      const description=svgElement('title');description.textContent='Входящий REQUEST gateway отсутствует в логе; начало восстановлено по финальному RESPONSE и единственной корневой ветке той же семьи service-name.';
      association.append(description);svg.append(association);
      const label=svgElement('text',{class:'trace-operation-label',x:route.labelX,y:route.labelY,'text-anchor':'middle'});label.textContent='вход восстановлен';svg.append(label);
    }
    if(edge.requestObserved===false&&edge.responseObserved===false&&!edge.kafkaObserved){
      const association=svgElement('path',{class:'trace-operation-association',d:route.d,fill:'none',stroke:'#90aeb8','stroke-width':1.7,'stroke-dasharray':'4 5','marker-end':'url(#request-arrow)'});
      const description=svgElement('title');description.textContent=childNode?.parentInference==='consumer-batch'?'Обработка после consume: одно приложение и общий batchRequestId.':'Предполагаемая связь операций по временному интервалу; сетевой вызов не подтверждён.';
      association.append(description);svg.append(association);continue;
    }
    if (edge.kafkaObserved) {
      appendTraceConnection(svg, { d:route.d, fill:"none", stroke:overLimit ? "#fb923c" : "#a78bfa", "stroke-width":2, "marker-end":overLimit ? "url(#warning-arrow)" : "url(#kafka-arrow)" }, "kafka", `edge:${edgeIndex}:kafka`, flowPaths);
      const label = svgElement("text", { class:"trace-kafka-edge-label", x:route.labelX, y:route.labelY, "text-anchor":"middle" });
      label.textContent = "KAFKA";
      svg.append(label);
    }
    if (edge.requestObserved !== false) appendTraceConnection(svg, { d:traceConnectionRoute(parent, child, -5).d, fill:"none", stroke:overLimit ? "#fb923c" : "#43d9c7", "stroke-width":2, "marker-end":overLimit ? "url(#warning-arrow)" : "url(#request-arrow)" }, "request", `edge:${edgeIndex}:request`, flowPaths);
    if (edge.responseObserved !== false) appendTraceConnection(svg, { d:traceConnectionRoute(parent, child, 5, true).d, fill:"none", stroke:failedResponse ? "#f0626d" : overLimit ? "#fb923c" : "#f6b84a", "stroke-width":2, "stroke-dasharray":edge.recovered ? "2 5" : "5 4", "marker-end":failedResponse ? "url(#error-arrow)" : overLimit ? "url(#warning-arrow)" : "url(#response-arrow)" }, "response", `edge:${edgeIndex}:response`, flowPaths);
    if(edge.crossServicePair){const label=svgElement('text',{class:'trace-operation-label',x:route.labelX,y:route.labelY-13,'text-anchor':'middle'});label.textContent='вызов → цель · ответ → источник';svg.append(label);}
  }
  for (const [subcallIndex, subcall] of subcalls.entries()) {
    const parent = positions[subcall.parentIndex];
    if (!parent || parent.foldHidden || subcall.foldHidden) continue;
    const overLimit = Boolean(subcall.overLimit);
    const px = parent.x + parent.width / 2, py = parent.y + parent.height, cx = subcall.x + subcall.width / 2, cy = subcall.y;
    const route = traceConnectionRoute(parent, subcall);
    if (subcall.assumption) {
      const association = svgElement("path", {class:"trace-assumption-association", d:route.d, fill:"none", stroke:"#d6a85f", "stroke-width":1.5, "stroke-dasharray":"3 6"});
      const description = svgElement("title"); description.textContent="Предположение после последнего наблюдаемого Kafka consume; дальнейшее действие в trace не найдено.";
      association.append(description); svg.append(association); continue;
    }
    if (subcall.diagnostic) {
      const association = svgElement("path", {class:"trace-diagnostic-association", d:route.d, fill:"none", stroke:"#b28e9b", "stroke-width":1.5, "stroke-dasharray":"2 6", "data-diagnostic-owner":subcall.parentIndex,"data-subcall-index":subcallIndex});
      const description = svgElement("title"); description.textContent="Ошибка записана этим сервисом и span. Это диагностическая связь, не наблюдаемый сетевой вызов.";
      association.append(description); svg.append(association); continue;
    }
    if (subcall.clientFailure && !subcall.requestObserved) {
      const association = svgElement("path", {class:"trace-client-failure-association", d:route.d, fill:"none", stroke:"#f0626d", "stroke-width":1.5, "stroke-dasharray":"2 6"});
      const description = svgElement("title"); description.textContent="WebClient checkpoint этого span. Исходный REQUEST не сопоставлен; HTTP-ответ не получен.";
      association.append(description); svg.append(association); continue;
    }
    const outboundKind = subcall.kafkaProduce ? "kafka" : subcall.cacheChain ? "cache" : "request";
    const outboundColor = overLimit ? "#fb923c" : subcall.kafkaProduce ? "#a78bfa" : subcall.cacheWrite ? "#a3e635" : subcall.cacheChain ? "#38bdf8" : "#43d9c7";
    if ((subcall.requestObserved ?? (subcall.subIndex < subcall.requestTotal))) appendTraceConnection(svg, { d:traceConnectionRoute(parent, subcall, -4).d, fill:"none", stroke:outboundColor, "stroke-width":2, "marker-end":overLimit ? "url(#warning-arrow)" : subcall.kafkaProduce ? "url(#kafka-arrow)" : subcall.cacheWrite ? "url(#cache-write-arrow)" : subcall.cacheChain ? "url(#cache-read-arrow)" : "url(#request-arrow)" }, outboundKind, `subcall:${subcallIndex}:${outboundKind}`, flowPaths);
    if (subcall.cacheChain) {
      const operation = svgElement("text", {class:"trace-cache-edge-label", x:route.labelX, y:route.labelY, fill:outboundColor, "text-anchor":"middle"});
      operation.textContent = subcall.cacheWrite ? "PUT · запись" : "GET · чтение"; svg.append(operation);
    }
    if ((subcall.responseObserved ?? (subcall.subIndex < subcall.responseTotal))) {
      appendTraceConnection(svg, { d:traceConnectionRoute(parent, subcall, 4, true).d, fill:"none", stroke:subcall.responseLevel3 ? "#f0626d" : overLimit ? "#fb923c" : "#f6b84a", "stroke-width":2, "stroke-dasharray":"5 4", "marker-end":subcall.responseLevel3 ? "url(#error-arrow)" : overLimit ? "url(#warning-arrow)" : "url(#response-arrow)" }, "response", `subcall:${subcallIndex}:response`, flowPaths);
    }
  }
  for (const [endpointIndex, endpoint] of kafkaEndpoints.entries()) {
    const owner = endpoint.ownerType === "node" ? positions[endpoint.ownerIndex] : subcalls[endpoint.ownerIndex];
    if (!owner) continue;
    const sx = owner.x + owner.width / 2, sy = owner.y + owner.height, bx = endpoint.x + endpoint.width / 2, by = endpoint.y;
    const mid = (sy + by) / 2;
    appendTraceConnection(svg, { d:`M ${sx} ${sy} C ${sx} ${mid}, ${bx} ${mid}, ${bx} ${by}`, fill:"none", stroke:"#a78bfa", "stroke-width":2, "marker-end":"url(#kafka-arrow)" }, endpoint.brokerObservation ? "kafka-infra" : "kafka", `broker:${endpointIndex}:kafka`, flowPaths);
    for (const [consumeIndex, link] of (endpoint.consumerLinks || []).entries()) {
      const consumer = positions[link.consumerNodeIndex];
      if (!consumer) continue;
      const startX = endpoint.x + endpoint.width / 2, startY = endpoint.y + endpoint.height;
      const endX = consumer.x + consumer.width / 2, endY = consumer.y;
      const curve = endY > startY
        ? `M ${startX} ${startY} C ${startX} ${(startY + endY) / 2}, ${endX} ${(startY + endY) / 2}, ${endX} ${endY}`
        : `M ${startX} ${startY} C ${Math.max(endpoint.x + endpoint.width, consumer.x + consumer.width) + 24} ${startY}, ${Math.max(endpoint.x + endpoint.width, consumer.x + consumer.width) + 24} ${endY}, ${endX} ${endY}`;
      appendTraceConnection(svg, { d:curve, fill:"none", stroke:"#c4b5fd", "stroke-width":2, "stroke-dasharray":"5 4", "marker-end":"url(#kafka-arrow)" }, "kafka", `broker:${endpointIndex}:consume:${consumeIndex}`, flowPaths);
    }
  }
  const playbackTrail = svgElement("path", { class:"trace-playback-trail", pathLength:1, d:"M 0 0", fill:"none", "aria-hidden":"true" });
  svg.append(playbackTrail);
  const playbackHead=svgElement("path",{d:"M 2 0 L -11 -6 L -8 0 L -11 6 Z", "aria-hidden":"true",class:"trace-playback-head",display:"none"});
  svg.append(playbackHead);
  return { flowPaths, playbackTrail, playbackHead };
}

function tracePlaybackTimes(values, fallback) {
  const times = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (times.length) return times;
  if (fallback !== null && fallback !== undefined && fallback !== "" && Number.isFinite(Number(fallback))) return [Number(fallback)];
  return [null];
}

function syncTracePlaybackContext() {
  if(tracePage.playbackStatus&&!tracePage.playbackStatus.hidden)tracePage.playbackStatus.textContent=`Шаг ${Math.min(tracePlayback.index+1,tracePlayback.events.length)} из ${tracePlayback.events.length}`;
  const view=globalThis.TracePlaybackContextView;if(!view)return;
  const index=Math.min(tracePlayback.index,tracePlayback.events.length-1),event=tracePlayback.events[index];
  if(!event||tracePlayback.state==="idle"){view.hide();return;}
  view.render(traceInteractionModel,event,index,tracePlayback.events.length,{state:tracePlayback.state,phase:tracePlayback.phase,events:tracePlayback.events});
}

function tracePlaybackScaledMs(value) {
  return Math.max(40, Math.round((Number(value) || 0) / Math.max(1,Number(tracePlayback.speed)||1)));
}

function selectTracePlaybackStep(index, focus = true) {
  globalThis.expandTraceCallGroups?.();
  const event=tracePlayback.events[index],model=traceInteractionModel;if(!event||!model)return;
  clearTracePlaybackTimer();tracePlayback.generation++;tracePlayback.index=index;tracePlayback.phase="idle";tracePlayback.state="paused";
  globalThis.Clippy?.show?.("pause");
  restoreTracePlaybackProgress();revealTracePlaybackTarget(event);model.stage.classList.add("trace-playback-paused");
  const prefix=event.pathKey.split(":").slice(0,2).join(":")+":";
  for(const [key,path] of model.flowPaths)if(key.startsWith(prefix))path.classList.add("trace-inspected-link");
  syncTracePlaybackContext();if(focus)focusTracePlaybackEvent(event,true);applyTracePlaybackControls();
}

function traceBlockEventIndex(events,type,index) {
  const candidates=events.map((event,i)=>({event,i})).filter(({event})=>event.targetType===type&&event.targetIndex===index);
  return (candidates.find(({event})=>event.kind!=="response") || candidates[0])?.i ?? -1;
}

function bindTraceBlockSelection(element,type,index) {
  element.tabIndex=0;element.setAttribute("role","button");
  let origin=null;
  element.addEventListener("pointerdown",event=>{origin={x:event.clientX,y:event.clientY};});
  const select=()=>{
    const step=traceBlockEventIndex(tracePlayback.events,type,index);
    if(step>=0)selectTracePlaybackStep(step,false);
    else {
      cancelTracePlayback(true,"idle");
      for(const item of traceStage.querySelectorAll(".trace-step-current"))item.classList.remove("trace-step-current");
      element.classList.add("trace-step-current");
      if(type==="subcall"&&traceInteractionModel.subcalls[index]?.diagnostic){
        globalThis.TracePlaybackContextView?.inspectEvidence?.(traceInteractionModel,index);
        traceInteractionModel.svg.querySelector(`[data-subcall-index="${index}"]`)?.classList.add("trace-inspected-link");
      }
    }
  };
  element.addEventListener("click",event=>{
    if(event.detail>0&&origin&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>4)return;
    select();
  });
  element.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();event.stopPropagation();select();}});
}

function showTraceSource(sourceElement) {
  pauseTracePlayback();
  const box=sourceElement?.getBoundingClientRect(),canvas=tracePage.canvas,rect=canvas.getBoundingClientRect();
  if(!box)return;
  const inset=globalThis.TracePlaybackContextView?.reservedHeight?.() || 0;
  canvas.scrollTo({left:Math.max(0,canvas.scrollLeft+box.left+box.width/2-rect.left-canvas.clientWidth/2),
    top:Math.max(0,canvas.scrollTop+box.top+box.height/2-rect.top-(canvas.clientHeight+inset)/2),behavior:traceMotionPreference?.matches?"instant":"smooth"});
}

function buildTracePlaybackEvents(nodes, edges, subcalls, kafkaEndpoints) {
  const events = [];
  let sequence = 0;
  const add = (pathKey, kind, times, targetType, targetIndex, inferred = false, focusType = targetType, focusIndex = targetIndex, logSteps = []) => {
    for (const [timeIndex,at] of times.entries()) { const rawLogStep=logSteps?.[timeIndex]; events.push({ pathKey, kind, at, targetType, targetIndex, focusType, focusIndex,
      logStep:rawLogStep!==null&&rawLogStep!==undefined&&rawLogStep!==''&&Number.isInteger(Number(rawLogStep))&&Number(rawLogStep)>0 ? Number(rawLogStep) : null,
      inferred:inferred || at === null, sequence:sequence++ });
    }
  };
  for (const [edgeIndex, edge] of (edges || []).entries()) {
    if (edge.spanAssociation || edge.filteredAssociation || edge.assumption) continue;
    const child = nodes[edge.to] || {};
    if (edge.kafkaObserved) add(`edge:${edgeIndex}:kafka`, "kafka", tracePlaybackTimes(child.kafkaProduceTimes, child.kafkaProduceAt), "node", edge.to,false,"node",edge.to,child.kafkaProduceLogSteps);
    const crossPairs=edge.crossServicePair?(edge.crossServicePairs||[edge.crossServicePair]):null;
    const requestTimes=crossPairs?crossPairs.map(pair=>pair.requestAt):tracePlaybackTimes(child.requestTimes, child.requestAt);
    if(edge.requestObserved===false&&edge.reconstructedGatewayEntry){
      const gateway=nodes[edge.from],start=events.length;
      const inferredAt=Number.isFinite(gateway?.reconstructedEntry?.at) ? gateway.reconstructedEntry.at+0.001 : null;
      add(`edge:${edgeIndex}:request`,'request',[inferredAt],'node',edge.to,true,'node',edge.to,[null]);
      for(const event of events.slice(start))event.reconstructed=true;
    }
    if(edge.requestObserved===false&&child.parentInference==='openapi-gateway-window'){
      const start=events.length;
      const inferredAt=Number.isFinite(child.completedOperation?.start) ? child.completedOperation.start
        : Math.min(...[...child.requestTimes,...child.responseTimes,...child.xmlProcedureRequestTimes,...child.xmlProcedureResponseTimes].filter(Number.isFinite));
      add(`edge:${edgeIndex}:request`,'request',[Number.isFinite(inferredAt)?inferredAt:null],'node',edge.to,true,'node',edge.to,[null]);
      for(const event of events.slice(start))event.reconstructed=true;
    }
    const requestSteps=crossPairs?crossPairs.map(pair=>child.requestLogSteps?.[pair.requestOrdinal]??null):child.requestLogSteps;
    if (edge.requestObserved !== false) add(`edge:${edgeIndex}:request`, "request", requestTimes, "node", edge.to,false,"node",edge.to,requestSteps);
    const parentCallIndex = subcalls.findIndex(call=>call.childNodeIndexes?.includes(edge.to));
    const responseOwner=crossPairs?nodes[edge.from]:child;
    const responseTimes=crossPairs?crossPairs.map(pair=>pair.responseAt):tracePlaybackTimes(child.responseTimes, child.responseAt);
    const responseSteps=crossPairs?crossPairs.map(pair=>responseOwner?.responseLogSteps?.[pair.responseOrdinal]??null):child.responseLogSteps;
    if (edge.responseObserved !== false) add(`edge:${edgeIndex}:response`, "response", responseTimes, "node", edge.to, edge.recovered, parentCallIndex>=0 ? "subcall" : "node", parentCallIndex>=0 ? parentCallIndex : edge.from,responseSteps);
  }
  for (const [subcallIndex, subcall] of subcalls.entries()) {
    if (subcall.diagnostic || subcall.assumption) continue;
    const outboundKind = subcall.kafkaProduce ? "kafka" : subcall.cacheChain ? "cache" : "request";
    if ((subcall.requestObserved ?? (subcall.subIndex < subcall.requestTotal))) add(`subcall:${subcallIndex}:${outboundKind}`, outboundKind, tracePlaybackTimes([], subcall.requestAt), "subcall", subcallIndex,false,"subcall",subcallIndex,[subcall.requestLogStep]);
    if ((subcall.responseObserved ?? (subcall.subIndex < subcall.responseTotal))) add(`subcall:${subcallIndex}:response`, "response", tracePlaybackTimes([], subcall.responseAt), "subcall", subcallIndex, subcall.responseAt === null, "node", subcall.parentIndex,[subcall.responseLogStep]);
  }
  for (const [endpointIndex, endpoint] of kafkaEndpoints.entries()) {
    add(`broker:${endpointIndex}:kafka`, endpoint.brokerObservation ? "kafka-infra" : "kafka-broker", tracePlaybackTimes(endpoint.times, endpoint.at), "broker", endpointIndex);
    for (const [consumeIndex, link] of (endpoint.consumerLinks || []).entries()) {
      add(`broker:${endpointIndex}:consume:${consumeIndex}`, "kafka-consume", tracePlaybackTimes([], link.consumedAt), "node", link.consumerNodeIndex);
    }
  }
  const claimedCrossResponses=new Map();
  for(const edge of edges||[])for(const pair of edge?.crossServicePair?(edge.crossServicePairs||[edge.crossServicePair]):[]){
    const owner=Number.isInteger(pair.responseNodeIndex)?pair.responseNodeIndex:Number(edge.from);
    if(!Number.isInteger(owner)||!Number.isInteger(pair.responseOrdinal))continue;
    const ordinals=claimedCrossResponses.get(owner)||new Set();ordinals.add(pair.responseOrdinal);claimedCrossResponses.set(owner,ordinals);
  }
  for(const [index,node] of nodes.entries())if(node.parentIndex===null){
    if(node.reconstructedEntry){
      const start=events.length;add(`root:${index}:reconstructed-request`,"request",[node.reconstructedEntry.at],"node",index,true,"node",index,[null]);
      for(const event of events.slice(start)){event.boundary=true;event.reconstructed=true;}
    }
    for(const kind of ['request','response'])if(Number(node[`${kind}Count`])>0){
      const start=events.length;
      const allTimes=tracePlaybackTimes(node[`${kind}Times`],node[`${kind}At`]),allSteps=node[`${kind}LogSteps`]||[];
      const selected=allTimes.map((at,ordinal)=>({at,ordinal})).filter(item=>kind!=='response'||!claimedCrossResponses.get(index)?.has(item.ordinal));
      add(`root:${index}:${kind}`,kind,selected.map(item=>item.at),"node",index,false,"node",index,selected.map(item=>allSteps[item.ordinal]??null));
      for(const event of events.slice(start))event.boundary=true;
    }
  }
  const priority = { request:0, cache:1, kafka:2, "kafka-broker":3, "kafka-infra":3, "kafka-consume":4, response:5 };
  for(const event of events) {
    const [type,indexText]=event.pathKey.split(":"), index=Number(indexText);
    const record=type==="edge" ? nodes[edges[index]?.to] : type==="root" ? nodes[index] : type==="subcall" ? subcalls[index] : {oneWay:true};
    Object.assign(event,globalThis.TracePlaybackTiming?.forRecord(record) || {latencyMs:null,durationMs:650,band:"unknown"});
  }
  return events.sort((left, right) => {
    if (left.at === null && right.at !== null) return 1;
    if (left.at !== null && right.at === null) return -1;
    if (left.at !== right.at) return Number(left.at) - Number(right.at);
    return (left.boundary && left.kind === 'request' ? -1 : priority[left.kind] ?? 9) - (right.boundary && right.kind === 'request' ? -1 : priority[right.kind] ?? 9) || left.sequence - right.sequence;
  });
}

function tracePlaybackFrame(event, model) {
  const nodeIndices=new Set(), boxes=[];
  const add=box=>{if(box && [box.x,box.y,box.width,box.height].every(Number.isFinite))boxes.push(box);};
  const node=index=>{if(Number.isInteger(index)){nodeIndices.add(index);add(model.positions[index]);}};
  const [kind,indexText]=String(event.pathKey || "").split(":");
  const index=Number(indexText);
  if(kind==="edge") {const edge=model.edges?.[index];if(edge){const call=model.subcalls?.[model.positions?.[edge.to]?.parentSubcallIndex];if(call)add(call);else node(edge.from);node(edge.to);}}
  else if(kind==="subcall") {const call=model.subcalls?.[index];add(call);node(call?.parentIndex);}
  else if(kind==="broker") {const broker=model.kafkaEndpoints?.[index];add(broker);if(broker?.ownerType==="node")node(broker.ownerIndex);else {const call=model.subcalls?.[broker?.ownerIndex];add(call);node(call?.parentIndex);}if(event.kind==="kafka-consume")node(event.focusIndex);}
  if(!boxes.length) {if(event.focusType==="node")node(event.focusIndex);else add((event.focusType==="subcall"?model.subcalls:model.kafkaEndpoints)?.[event.focusIndex]);}
  // Only the exchange endpoints define the shot. A wrapped connector or a
  // diagnostic in a distant row must never force the whole tree into view.
  if(!boxes.length)return null;
  const x=Math.min(...boxes.map(box=>box.x)),y=Math.min(...boxes.map(box=>box.y));
  return {x,y,width:Math.max(...boxes.map(box=>box.x+box.width))-x,height:Math.max(...boxes.map(box=>box.y+box.height))-y};
}

function focusTracePlaybackEvent(event, force = false) {
  if (!force && tracePage.follow && !tracePage.follow.checked) return;
  const model = traceInteractionModel;
  if (!model || !event || typeof tracePage.canvas?.scrollTo !== "function") return;
  const box = tracePlaybackFrame(event,model);
  if (!box) return;
  const canvas=tracePage.canvas, rect=canvas.getBoundingClientRect();
  const contextNode=globalThis.TracePlaybackContextView?.node;
  const topInset=contextNode&&!contextNode.hidden?(globalThis.TracePlaybackContextView?.reservedHeight?.() || contextNode.getBoundingClientRect().height)+24:0;
  let leftWidth=canvas.clientWidth,topHeight=canvas.clientHeight;
  for(const overlay of document.querySelectorAll("#trace-minimap:not([hidden]),#clippy-companion:not([hidden]),#clippy-restore:not([hidden])")) {
    const bounds=overlay.getBoundingClientRect();
    if(bounds.bottom>rect.top&&bounds.top<rect.bottom&&bounds.left<rect.right&&bounds.right>rect.left) {
      leftWidth=Math.min(leftWidth,Math.max(1,bounds.left-rect.left-16));
      topHeight=Math.min(topHeight,Math.max(1,bounds.top-rect.top-16));
    }
  }
  // A narrow display has more usable room above the minimap than beside it.
  const areas=[{width:leftWidth,height:Math.max(1,canvas.clientHeight-topInset)},{width:canvas.clientWidth,height:Math.max(1,topHeight-topInset)}].map(area=>{
    const margin=Math.min(64,area.width*.12,area.height*.12);
    return {...area,margin,fit:Math.min((area.width-2*margin)/Math.max(1,box.width),(area.height-2*margin)/Math.max(1,box.height))};
  }).sort((a,b)=>b.fit-a.fit);
  const {width,height,margin,fit}=areas[0];
  const rightInset=canvas.clientWidth-width,bottomInset=canvas.clientHeight-height;
  // Keep the receiver visible in both directions. Camera motion settles before
  // the arrow starts, while the pinned context preserves the offscreen sender.
  const targetType=event.focusType||event.targetType,targetIndex=event.focusIndex??event.targetIndex;
  const target = targetType === "node" ? model.positions[targetIndex]
    : (targetType === "subcall" ? model.subcalls : model.kafkaEndpoints)?.[targetIndex];
  const local = target || box;
  const localFit = Math.min((width-2*margin)/local.width,(height-2*margin)/local.height);
  const scale = Math.min(.78,localFit);
  const tracking = fit < scale;
  // Fixed readable scale, with a local shot for long connectors. Arrow travel
  // and camera travel have independent clocks.
  setTraceScale(scale,true,"playback");
  const frame = tracking ? local : box;
  const left=Math.max(0,(frame.x+frame.width/2)*traceScale+traceOffsetX-width/2);
  const top=Math.max(0,(frame.y+frame.height/2)*traceScale+traceOffsetY-topInset-height/2);
  const visible=frame.x*traceScale+traceOffsetX-canvas.scrollLeft>=margin
    &&frame.y*traceScale+traceOffsetY-canvas.scrollTop>=topInset+margin
    &&(frame.x+frame.width)*traceScale+traceOffsetX-canvas.scrollLeft<=width-margin
    &&(frame.y+frame.height)*traceScale+traceOffsetY-canvas.scrollTop<=topInset+height-margin;
  const moving=force||!visible;
  const origin={left:canvas.scrollLeft,top:canvas.scrollTop};
  if(tracePlayback.state==="playing")canvas.scrollTo({...origin,behavior:"instant"});
  else if(moving)canvas.scrollTo({left,top,behavior:traceMotionPreference?.matches?"instant":"smooth"});
  return {tracking,width,height,moving,origin,destination:{left,top},path:model.flowPaths?.get(event.pathKey)};
}

function followTracePlaybackHead() {
  if(traceCameraFrame)cancelAnimationFrame(traceCameraFrame);
  traceCameraFrame=0;
  const camera=tracePlayback.camera;
  if(camera?.moving&&tracePlayback.phase==="framing"&&tracePlayback.state==="playing"){
    const generation=tracePlayback.generation;
    const pan=()=>{
      traceCameraFrame=0;
      if(generation!==tracePlayback.generation||tracePlayback.state!=="playing"||tracePlayback.phase!=="framing")return;
      const t=Math.max(0,Math.min(1,1-(tracePlayback.remaining-(traceNow()-tracePlayback.startedAt))/tracePlaybackScaledMs(TRACE_CAMERA_TRANSITION_MS)));
      const ease=t*t*(3-2*t);
      if(tracePage.follow?.checked!==false)tracePage.canvas.scrollTo({left:camera.origin.left+(camera.destination.left-camera.origin.left)*ease,top:camera.origin.top+(camera.destination.top-camera.origin.top)*ease,behavior:"instant"});
      globalThis.TracePlaybackContextView?.updateSourceVisibility?.();
      if(t<1)traceCameraFrame=requestAnimationFrame(pan);
    };
    pan();return;
  }
  if(!camera || tracePlayback.phase!=="moving" || tracePlayback.state!=="playing")return;
  const length=camera.path?.getTotalLength?.();
  if(!Number.isFinite(length))return;
  const generation=tracePlayback.generation;
  const tick=()=>{
    traceCameraFrame=0;
    if(generation!==tracePlayback.generation||tracePlayback.state!=="playing"||tracePlayback.phase!=="moving")return;
    const progress=Math.max(0,Math.min(1,1-(tracePlayback.remaining-(traceNow()-tracePlayback.startedAt))/tracePlayback.stepMs));
    const point=camera.path.getPointAtLength(length*progress);
    const before=camera.path.getPointAtLength(Math.max(0,length*progress-1)),after=camera.path.getPointAtLength(Math.min(length,length*progress+1));
    const head=traceInteractionModel?.playbackHead;
    if(head){head.setAttribute("display","inline");head.setAttribute("fill",camera.path.getAttribute("stroke")||"#fff");head.setAttribute("transform",`translate(${point.x} ${point.y}) rotate(${Math.atan2(after.y-before.y,after.x-before.x)*180/Math.PI})`);}
    if(progress<1)traceCameraFrame=requestAnimationFrame(tick);
  };
  tick();
}

function tracePlaybackTargetElement(event) {
  const model = traceInteractionModel;
  if (!model || !event) return null;
  const type=event.focusType||event.targetType,index=event.focusIndex??event.targetIndex;
  if (type === "node") return model.cardElements[index] || null;
  if (type === "subcall") return model.subcallElements[index] || null;
  if (type === "broker") return model.kafkaEndpointElements[index] || null;
  return null;
}

function revealTracePlaybackTarget(event) {
  for(const element of traceInteractionModel?.stage?.querySelectorAll?.(".trace-step-current") || [])element.classList.remove("trace-step-current");
  tracePlaybackTargetElement(event)?.classList.add("trace-playback-visible","trace-step-current");
}

function clearTracePlaybackTimer() {
  if(traceCameraFrame)cancelAnimationFrame(traceCameraFrame);
  traceCameraFrame=0;
  if (tracePlayback.timer !== null) clearTimeout(tracePlayback.timer);
  tracePlayback.timer = null;
}

function resetTracePlaybackScene(restore = true) {
  const model = traceInteractionModel;
  if (!model) return;
  model.stage.classList.remove("trace-playback-active", "trace-playback-paused");
  for(const path of model.stage.querySelectorAll?.(".trace-inspected-link") || [])path.classList.remove("trace-inspected-link");
  if(model.playbackHead)model.playbackHead.setAttribute("display","none");
  for (const path of model.flowPaths?.values?.() || []) path.classList.remove("trace-playback-reached","trace-inspected-link");
  for (const element of [...model.cardElements, ...model.subcallElements, ...model.kafkaEndpointElements]) {element?.classList.remove("trace-playback-visible");element?.classList.remove("trace-step-current","trace-step-complete");}
  if (model.playbackTrail) {
    model.playbackTrail.setAttribute("class", "trace-playback-trail");
    model.playbackTrail.removeAttribute("d");
  }
  if (!restore) model.stage.classList.add("trace-playback-active");
}

function cancelTracePlayback(restore = true, nextState = "idle") {
  const companionWasPlaying = ["playing", "paused"].includes(tracePlayback.state);
  clearTracePlaybackTimer();
  tracePlayback.generation += 1;
  tracePlayback.state = nextState;
  if (companionWasPlaying) globalThis.Clippy?.show?.("idle");
  tracePlayback.index = nextState === "done" ? tracePlayback.events.length : 0;
  tracePlayback.phase = "idle";
  tracePlayback.remaining = 0;
  tracePlayback.resumeAfterGeometry = false;
  resetTracePlaybackScene(restore);
  applyTracePlaybackControls();
}

function prepareTracePlaybackScene() {
  const model = traceInteractionModel;
  if (!model) return;
  resetTracePlaybackScene(false);
  model.cardElements.forEach((element, index) => {
    if (model.nodes[index]?.parentIndex === null) element?.classList.add("trace-playback-visible");
  });
}

function restoreTracePlaybackProgress() {
  const model = traceInteractionModel;
  if (!model) return;
  prepareTracePlaybackScene();
  for (let index = 0; index < tracePlayback.index; index += 1) {
    const event = tracePlayback.events[index];
    model.flowPaths.get(event.pathKey)?.classList.add("trace-playback-reached");
    revealTracePlaybackTarget(event);
  }
}

function scheduleTracePlaybackTimer(delay) {
  clearTracePlaybackTimer();
  const generation = tracePlayback.generation;
  tracePlayback.remaining = Math.max(0, Number(delay) || 0);
  tracePlayback.startedAt = traceNow();
  followTracePlaybackHead();
  tracePlayback.timer = setTimeout(() => {
    if (generation !== tracePlayback.generation) return;
    tracePlayback.timer = null;
    tracePlayback.remaining = 0;
    advanceTracePlayback();
  }, tracePlayback.remaining);
}

function runTracePlaybackStep() {
  const model = traceInteractionModel;
  for(const path of model?.flowPaths?.values?.() || [])path.classList.remove("trace-inspected-link");
  if (!model || tracePlayback.index >= tracePlayback.events.length) {
    cancelTracePlayback(true, "done");
    return;
  }
  let event = tracePlayback.events[tracePlayback.index];
  let basePath = model.flowPaths.get(event.pathKey);
  while (!basePath && !event.boundary && tracePlayback.index < tracePlayback.events.length - 1) {
    tracePlayback.index += 1;
    event = tracePlayback.events[tracePlayback.index];
    basePath = model.flowPaths.get(event.pathKey);
  }
  if ((!basePath && !event.boundary) || !model.playbackTrail) {
    cancelTracePlayback(true, "done");
    return;
  }
  globalThis.TraceStepsView?.sync(tracePlayback.index,tracePlayback.state);
  syncTracePlaybackContext();
  revealTracePlaybackTarget(event);
  tracePlayback.camera=focusTracePlaybackEvent(event) || {tracking:false,path:basePath};
  tracePlayback.stepMs=tracePlaybackScaledMs(event.boundary ? event.durationMs || 650
    : globalThis.TracePlaybackTiming?.travelDuration(basePath.getTotalLength()*traceScale,event.band) || event.durationMs || 650);
  if(tracePlayback.camera.moving){
    tracePlayback.phase="framing";
    syncTracePlaybackContext();
    scheduleTracePlaybackTimer(tracePlaybackScaledMs(TRACE_CAMERA_TRANSITION_MS));
  } else animateTracePlaybackStep();
}

function animateTracePlaybackStep() {
  const model=traceInteractionModel,event=tracePlayback.events[tracePlayback.index];
  const basePath=model?.flowPaths.get(event?.pathKey);
  if(event?.boundary){
    const card=model.cardElements[event.targetIndex];
    card?.classList.add("trace-step-complete");
    tracePlayback.phase="moving";syncTracePlaybackContext();scheduleTracePlaybackTimer(tracePlayback.stepMs);return;
  }
  if(!basePath)return;
  const trail = model.playbackTrail;
  trail.setAttribute("class", `trace-playback-trail trace-playback-${event.kind}`);
  trail.setAttribute("d", basePath.getAttribute("d") || "M 0 0");
  trail.setAttribute("stroke", basePath.getAttribute("stroke") || "#ffffff");
  trail.removeAttribute("marker-end");
  trail.style.setProperty("--trace-playback-duration", `${tracePlayback.stepMs}ms`);
  void trail.getBoundingClientRect();
  trail.classList.add("active");
  tracePlayback.phase = "moving";
  syncTracePlaybackContext();
  scheduleTracePlaybackTimer(tracePlayback.stepMs);
}

function advanceTracePlayback() {
  const model = traceInteractionModel;
  if (!model || tracePlayback.state !== "playing") return;
  const event = tracePlayback.events[tracePlayback.index];
  if(tracePlayback.phase==="framing"){
    if(tracePage.follow?.checked!==false&&tracePlayback.camera?.destination)tracePage.canvas.scrollTo({...tracePlayback.camera.destination,behavior:"instant"});
    animateTracePlaybackStep();return;
  }
  if (tracePlayback.phase === "moving") {
    model.flowPaths.get(event.pathKey)?.classList.add("trace-playback-reached");
    revealTracePlaybackTarget(event);
    model.playbackTrail?.classList.remove("active");
    if(model.playbackHead)model.playbackHead.setAttribute("display","none");
    model.cardElements[event.targetIndex]?.classList.remove("trace-step-complete");
    tracePlayback.phase = "gap";
    scheduleTracePlaybackTimer(tracePlayback.gapMs);
    return;
  }
  tracePlayback.index += 1;
  tracePlayback.phase = "idle";
  runTracePlaybackStep();
}

function startTracePlayback() {
  globalThis.expandTraceCallGroups?.();
  if (traceMotionPreference?.matches || !traceInteractionModel) return;
  globalThis.document?.querySelectorAll?.(".trace-more-controls[open],.trace-filter-disclosure[open]")?.forEach((item) => item.removeAttribute("open"));
  globalThis.Clippy?.show?.("playback");
  clearTracePlaybackTimer();
  tracePlayback.generation += 1;
  tracePlayback.events = buildTracePlaybackEvents(traceInteractionModel.nodes, traceInteractionModel.edges, traceInteractionModel.subcalls, traceInteractionModel.kafkaEndpoints);
  tracePlayback.index = 0;
  tracePlayback.phase = "idle";
  tracePlayback.state = "playing";
  tracePlayback.gapMs = tracePlaybackScaledMs(120);
  prepareTracePlaybackScene();
  applyTracePlaybackControls();
  runTracePlaybackStep();
}

function pauseTracePlayback() {
  if (tracePlayback.state !== "playing") return;
  globalThis.Clippy?.show?.("pause");
  if (tracePlayback.timer !== null) tracePlayback.remaining = Math.max(0, tracePlayback.remaining - (traceNow() - tracePlayback.startedAt));
  clearTracePlaybackTimer();
  tracePage.canvas.scrollTo({left:tracePage.canvas.scrollLeft,top:tracePage.canvas.scrollTop,behavior:"instant"});
  tracePlayback.state = "paused";
  traceInteractionModel?.stage.classList.add("trace-playback-paused");
  applyTracePlaybackControls();
}

function resumeTracePlayback() {
  if (tracePlayback.state !== "paused" || traceMotionPreference?.matches) return;
  globalThis.Clippy?.show?.("playback");
  tracePlayback.state = "playing";
  traceInteractionModel?.stage.classList.remove("trace-playback-paused");
  applyTracePlaybackControls();
  if (tracePlayback.phase === "idle") runTracePlaybackStep();
  else {
    if(tracePlayback.phase==="framing"){tracePlayback.camera=focusTracePlaybackEvent(tracePlayback.events[tracePlayback.index],true);tracePlayback.remaining=tracePlaybackScaledMs(TRACE_CAMERA_TRANSITION_MS);}
    scheduleTracePlaybackTimer(tracePlayback.remaining || (tracePlayback.phase === "moving" ? tracePlayback.stepMs : tracePlayback.phase === "framing" ? tracePlaybackScaledMs(TRACE_CAMERA_TRANSITION_MS) : tracePlayback.gapMs));
  }
}

function cycleTracePlaybackSpeed() {
  const speeds=[1,1.5,2],old=Math.max(1,Number(tracePlayback.speed)||1),index=speeds.indexOf(old);
  const next=speeds[(index+1)%speeds.length];
  if(tracePlayback.timer!==null){
    const left=Math.max(0,tracePlayback.remaining-(traceNow()-tracePlayback.startedAt));
    tracePlayback.remaining=Math.round(left*old/next);
    tracePlayback.stepMs=Math.max(40,Math.round(tracePlayback.stepMs*old/next));
    tracePlayback.speed=next;
    tracePlayback.gapMs=tracePlaybackScaledMs(120);
    scheduleTracePlaybackTimer(tracePlayback.remaining);
  } else tracePlayback.speed=next;
  if(tracePage.flowSpeed){tracePage.flowSpeed.textContent=`${next}×`;tracePage.flowSpeed.title=`Скорость проигрывания: ${next}× · нажмите для переключения`;tracePage.flowSpeed.setAttribute('aria-label',`Скорость проигрывания: ${next}×`);tracePage.flowSpeed.setAttribute('aria-pressed',String(next>1));}
}

function toggleTracePlayback() {
  if (tracePlayback.state === "playing") pauseTracePlayback();
  else if (tracePlayback.state === "paused") resumeTracePlayback();
  else startTracePlayback();
}

function suspendTracePlaybackForGeometry() {
  if (!["playing", "paused"].includes(tracePlayback.state)) return;
  const resume = tracePlayback.state === "playing";
  pauseTracePlayback();
  if (tracePlayback.phase === "gap") tracePlayback.index += 1;
  tracePlayback.phase = "idle";
  tracePlayback.remaining = 0;
  tracePlayback.resumeAfterGeometry = resume;
  traceInteractionModel?.playbackTrail?.classList.remove("active");
}

function resumeTracePlaybackAfterGeometry() {
  if (tracePlayback.state !== "paused") return;
  const resume = tracePlayback.resumeAfterGeometry;
  tracePlayback.resumeAfterGeometry = false;
  restoreTracePlaybackProgress();
  if (resume) resumeTracePlayback();
  else applyTracePlaybackControls();
}

function renderTraceErrorTimelineSummary(diagram) {
  let strip = document.querySelector("#trace-error-timeline-summary");
  if (!strip) {
    strip = document.createElement("section");
    strip.id = "trace-error-timeline-summary";
    strip.className = "trace-error-timeline-summary";
    strip.setAttribute("aria-label", "Хронология ошибок trace");
    document.querySelector("header")?.append(strip);
  }
  strip.replaceChildren();
  const timeline = diagram?.errorAnalysis?.timeline;
  const events = Array.isArray(timeline?.events) ? timeline.events : [];
  strip.hidden = !events.length;
  if (!events.length) return;
  const firstIds = new Set(Array.isArray(timeline.firstObservedIds) ? timeline.firstObservedIds : []);
  const first = events.filter(event => firstIds.has(event.id));
  const details = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = first.length === 1
    ? `Первая зафиксированная ошибка: ${String(first[0].service || "сервис не определён").slice(0,160)} · ${moscowTime(first[0].at)}`
    : first.length > 1 ? `Первые по времени: ${first.length} ошибок с одинаковым timestamp`
      : "Порядок ошибок не определён: нет точного времени";
  const note = document.createElement("span");
  const links = Array.isArray(timeline.links) ? timeline.links : [];
  const linkedEvents = new Set(links.flatMap(link => [link.from, link.to]));
  const linked = links.length;
  const sources = events.filter(event => event.sourceAvailable).length;
  note.textContent = `Связей между ошибками: ${linked} · Отдельных записей: ${events.filter(event => !linkedEvents.has(event.id)).length} · Со стеком: ${sources}`;
  note.title = "Разбор показывает, где ошибка появилась и где могла быть записана повторно. Основания каждой связи указаны отдельно; одного порядка времени недостаточно.";
  if (timeline.incomplete) note.textContent += " · Выборка неполная";
  details.append(title, note);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Ошибки и источники ↗";
  button.addEventListener("click", () => TraceErrorView.showTraceDialog(diagram));
  strip.append(details, button);
}

function renderTrace(diagram, options = {}) {
  traceCallGroupDiagram = diagram;
  traceUmlDiagram = diagram;
  if (tracePage.umlButton) tracePage.umlButton.disabled = !globalThis.TraceUml;
  initializeTraceLatencyControl(diagram);
  let errorAnalysisButton = document.querySelector("#show-trace-errors");
  if (!errorAnalysisButton) {
    errorAnalysisButton = document.createElement("button"); errorAnalysisButton.id="show-trace-errors"; errorAnalysisButton.type="button";
    document.querySelector("header .controls")?.insertBefore(errorAnalysisButton, tracePage.flowPlay);
  }
  errorAnalysisButton.hidden = !diagram.errorAnalysis?.available;
  errorAnalysisButton.textContent = `Разбор ошибок (${diagram.errorAnalysis?.events || 0})`;
  errorAnalysisButton.onclick = () => TraceErrorView.showTraceDialog(diagram);
  TraceErrorView.configureButton(errorAnalysisButton, diagram);
  renderTraceErrorTimelineSummary(diagram);
  cancelTracePlayback(true, "idle");
  if (!options.preserveLocalFilters && tracePage.localSearch) tracePage.localSearch.value = "";
  if (!options.preserveLocalFilters && tracePage.localMode) tracePage.localMode.value = "all";
  const nodes = Array.isArray(diagram?.nodes) ? diagram.nodes.slice(0, 200) : [];
  if (!nodes.length && !diagram.outgoingFailures?.length) throw new Error("В дереве нет span-блоков");
  const repeatedHttpTargets = Array.isArray(diagram?.repeatedHttpTargets) ? diagram.repeatedHttpTargets.filter((item) => Number(item?.count) > 1) : [];
  for (const [nodeIndex, node] of nodes.entries()) {
    node.repeatedHttpTargets = repeatedHttpTargets
      .filter((item) => (Array.isArray(item.nodeIndexes) ? item.nodeIndexes.includes(nodeIndex) : (item.callerService || item.service) === (node.httpCallerService || node.service)) && node.requestTargets?.some((target) => target.url === item.url))
      .map((item) => ({ service:item.service, callerService:item.callerService || item.service, targetServices:Array.isArray(item.targetServices) ? item.targetServices : [], url:item.url, count:item.count, methods:Array.isArray(item.methods) ? item.methods : [] }));
    if (node.repeatedHttpTargets.length && Array.isArray(node.requestTargets)) {
      const priority = new Map(node.repeatedHttpTargets.map((item, index) => [item.url, index]));
      node.requestTargets = [...node.requestTargets].sort((left, right) => (priority.get(left.url) ?? Number.MAX_SAFE_INTEGER) - (priority.get(right.url) ?? Number.MAX_SAFE_INTEGER));
    }
  }
  renderRepeatedHttpSummary(repeatedHttpTargets);
  const serviceCallLimit = [1, 2, 3, 5, 10].includes(Number(diagram.serviceCallLimit)) ? Number(diagram.serviceCallLimit) : 1;
  const uriCallTotals = traceUriCallTotals(nodes);
  for (const node of nodes) {
    node.traceOverLimit = traceNodeOverLimit(node, serviceCallLimit, uriCallTotals);
    node.traceStatus = traceNodeStatus(node, serviceCallLimit, uriCallTotals);
  }
  const gateway = nodes.filter((node) => node.parentIndex === null && traceCanonicalGateway(node) && durationLabel(node.responseDuration)).sort((left, right) => Number(right.responseAt || 0) - Number(left.responseAt || 0))[0]
    || nodes.filter((node) => node.parentIndex === null && durationLabel(node.responseDuration)).sort((left, right) => Number(right.responseAt || 0) - Number(left.responseAt || 0))[0];
  const totalDuration = durationLabel(gateway?.responseDuration);
  tracePage.totalDuration.textContent = totalDuration ? `Запрос исполнился за: ${totalDuration} мс · ${gateway.service}` : "";
  tracePage.totalDuration.hidden = !totalDuration;
  const serviceTotals = traceServiceCallTotals(nodes);
  const serviceSeen = new Map();
  const diagnostics = globalThis.TraceErrorGraph?.build(nodes, diagram.errorAnalysis) || [];
  const { positions, subcalls, kafkaEndpoints, groups, callGroups, width, height } = layoutTrace(nodes, diagnostics, diagram.outgoingFailures || [], diagram.kafkaLinks || [], diagram.edges || []);
  const playbackEvents = buildTracePlaybackEvents(nodes, diagram.edges || [], subcalls, kafkaEndpoints);
  // Numbers are each event's position in the whole trace sorted by observed
  // time - while more pages are still loading, that set keeps growing, and
  // a page arriving with earlier-timestamped messages shifts everything
  // already numbered. Rather than visibly renumbering with every batch,
  // numbering is withheld until loading settles, then computed once.
  const stepNumbers = diagram.loadingMore ? null : globalThis.TraceSteps?.numbering({nodes,edges:diagram.edges||[],positions,subcalls,kafkaEndpoints},playbackEvents);
  nodes.forEach((node,index)=>{node.stepNumber=stepNumbers?.nodeNumbers[index] ?? null;});
  subcalls.forEach((call,index)=>{call.stepNumber=stepNumbers?.subcallNumbers[index] ?? null;});
  kafkaEndpoints.forEach((broker,index)=>{broker.stepNumber=stepNumbers?.brokerNumbers[index] ?? null;});
  const largeDiagram = nodes.length + subcalls.length + kafkaEndpoints.length > 60;
  if (largeDiagram) traceFlowPaused = true;
  for (const subcall of subcalls) {
    subcall.uriCallCount = subcall.oneWay || (subcall.clientFailure && !subcall.requestObserved) ? 0 : traceUriCallCount(nodes[subcall.parentIndex]?.service, subcall.detail, uriCallTotals);
    subcall.overLimit = !subcall.oneWay && subcall.uriCallCount > serviceCallLimit;
    subcall.repeatedUri = !subcall.oneWay && subcall.uriCallCount > 1;
  }
  const stage = document.createElement("div"); stage.className = `trace-stage${largeDiagram ? " trace-large" : ""}${traceFlowPaused ? " trace-flow-paused" : ""}`; stage.style.width = `${width}px`; stage.style.height = `${height}px`;
  const svg = svgElement("svg", { class:"trace-lines", width, height, viewBox:`0 0 ${width} ${height}` });
  const defs = svgElement("defs");
  const requestMarker = svgElement("marker", { id:"request-arrow", viewBox:"0 0 10 10", refX:9, refY:5, markerWidth:7, markerHeight:7, orient:"auto-start-reverse" });
  requestMarker.append(svgElement("path", { d:"M 0 0 L 10 5 L 0 10 z", fill:"#43d9c7" }));
  const responseMarker = svgElement("marker", { id:"response-arrow", viewBox:"0 0 10 10", refX:9, refY:5, markerWidth:7, markerHeight:7, orient:"auto-start-reverse" });
  responseMarker.append(svgElement("path", { d:"M 0 0 L 10 5 L 0 10 z", fill:"#f6b84a" }));
  const warningMarker = svgElement("marker", { id:"warning-arrow", viewBox:"0 0 10 10", refX:9, refY:5, markerWidth:7, markerHeight:7, orient:"auto-start-reverse" });
  warningMarker.append(svgElement("path", { d:"M 0 0 L 10 5 L 0 10 z", fill:"#fb923c" }));
  const errorMarker = svgElement("marker", { id:"error-arrow", viewBox:"0 0 10 10", refX:9, refY:5, markerWidth:7, markerHeight:7, orient:"auto-start-reverse" });
  errorMarker.append(svgElement("path", { d:"M 0 0 L 10 5 L 0 10 z", fill:"#f0626d" }));
  const kafkaMarker = svgElement("marker", { id:"kafka-arrow", viewBox:"0 0 10 10", refX:9, refY:5, markerWidth:7, markerHeight:7, orient:"auto-start-reverse" });
  kafkaMarker.append(svgElement("path", { d:"M 0 0 L 10 5 L 0 10 z", fill:"#a78bfa" }));
  defs.append(requestMarker, responseMarker, warningMarker, errorMarker, kafkaMarker);
  for (const [id, color] of [["cache-write-arrow", "#a3e635"], ["cache-read-arrow", "#38bdf8"]]) {
    const marker=svgElement("marker", {id, viewBox:"0 0 10 10", refX:9, refY:5, markerWidth:7, markerHeight:7, orient:"auto-start-reverse"});
    marker.append(svgElement("path", {d:"M 0 0 L 10 5 L 0 10 z", fill:color})); defs.append(marker);
  }
  const geometry = drawTraceConnections(svg, defs, diagram.edges || [], nodes, positions, subcalls, kafkaEndpoints, serviceCallLimit);
  stage.append(svg);
  const cardElements = [];
  const applicationGroups=globalThis.TraceApplicationGroups?.group(nodes)||[];
  const familyByNode=new Map(applicationGroups.flatMap(group=>group.nodeIndexes.map(index=>[index,group])));
  // Same evaluation the "Сопоставить предположения" pass itself runs, just
  // reported instead of applied - so an unresolved root can say *why*: no
  // candidate had any evidence at all, or several tied and none could be
  // preferred over the others. Previously only visible in the JSON export.
  const assumptionByChild=new Map((globalThis.TraceAssumptionMatcher?.explain?.(diagram)?.unlinked||[]).map(entry=>[entry.childIndex,entry]));
  for(const island of Array.isArray(diagram.rootIslands)?diagram.rootIslands:[]){
    if(island.kind==='sync-entry')continue;
    const branch=island.kind==='reconstructed-gateway'?[island.rootIndex]:traceBranchIndexes(nodes,island.rootIndex);
    const family=familyByNode.get(island.rootIndex),outside=(family?.nodeIndexes||[]).filter(index=>!branch.includes(index));
    const likely=[...(island.likelyNodeIndexes||[]),...outside].filter((value,index,all)=>nodes[value]&&all.indexOf(value)===index).slice(0,3);
    const likelyNames=[...new Set(likely.map(index=>nodes[index].service))];
    const assumption=assumptionByChild.get(island.rootIndex);
    const assumptionDetail=assumption?.outcome==='tie'?` · ${assumption.tied} кандидатов с равным счётом`:assumption?.outcome==='no-candidate'?' · кандидатов нет':'';
    const label=island.kind==='async-kafka'
      ? `Асинхронная ветка Kafka${likelyNames.length?` · от ${likelyNames.join(', ')}`:' · producer не сопоставлен'}`
      : island.kind==='reconstructed-gateway' ? 'Gateway · входящий лог восстановлен'
      : `Не сопоставлено${likelyNames.length?` · вероятно относится к ${likelyNames.join(', ')}`:family?.inferred?` · вероятная группа ${family.label}`:' · источник неизвестен'}${assumptionDetail}`;
    const assumptionTitle=assumption?.outcome==='tie'
      ?`Предположение не построено: ${assumption.tied} кандидатов набрали одинаковый счёт (${[...new Set(assumption.candidates.flatMap(item=>item.evidence))].join(', ')||'без общих улик'}), однозначного выбора нет.`
      :assumption?.outcome==='no-candidate'?'Предположение не построено: ни один узел не подошёл ни по одной из проверяемых улик (span, URI, batch/topic, имя сервиса, время).':'';
    groups.push({kind:'island',islandKind:island.kind,parentIndex:null,nodeIndexes:branch,subcallIndexes:subcalls.flatMap((call,index)=>branch.includes(call.parentIndex)?[index]:[]),label,
      title:island.kind==='async-kafka'?'Асинхронная граница выделена отдельно. Связь с producer показывается только при совпадении topic и однозначном времени.':island.kind==='reconstructed-gateway'?nodes[island.rootIndex]?.reconstructedEntry?.reason||label:`Блоки принадлежат traceId, но достаточных признаков причинной связи нет. Рамка показывает вероятную область, не создавая стрелку.${assumptionTitle?`\n${assumptionTitle}`:''}`});
  }
  let familyPanel=document.querySelector('#trace-application-groups');
  if(!familyPanel){familyPanel=document.createElement('details');familyPanel.id='trace-application-groups';familyPanel.className='trace-application-groups';document.querySelector('.trace-filter-options')?.append(familyPanel);}
  familyPanel.replaceChildren();const familySummary=document.createElement('summary');familySummary.textContent=`Группы приложений · ${applicationGroups.length}`;familyPanel.append(familySummary);
  const familyHint=document.createElement('p');familyHint.textContent='Группы по названиям. Нажмите, чтобы подсветить: все приложения и переходы останутся видимыми.';familyPanel.append(familyHint);
  for(const group of applicationGroups){const chip=document.createElement('button');chip.type='button';chip.textContent=`${group.label}${group.inferred?' · семья':''} (${group.nodeIndexes.length})`;chip.setAttribute('aria-pressed','false');chip.addEventListener('click',()=>{const active=chip.getAttribute('aria-pressed')!=='true';familyPanel.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button===chip&&active)));cardElements.forEach((card,index)=>card.classList.toggle('trace-family-highlight',active&&group.nodeIndexes.includes(index)));});familyPanel.append(chip);}
  const filterItems = [];
  nodes.forEach((node, index) => {
    const kafkaOnly = isKafkaOnlyNode(node);
    const procedureOnly = isProcedureOnlyNode(node);
    const repeatedTarget = node.repeatedHttpTargets?.[0] || null;
    const hasRepeatedTarget = Boolean(repeatedTarget);
    const hasFailedResponse = Number(node.responseLevel3Count) > 0;
    const isObservedCall = Number(node.requestCount) > 0 || Number(node.openApiRequestCount) > 0 || Number(node.gorodClientRequestCount) > 0 || Number(node.partnerBackendRequestCount) > 0;
    const totalCalls = Number(node.serviceCallTotal) || serviceTotals.get(node.service) || 0;
    const ordinal = isObservedCall ? Number(node.serviceCallOrdinal) || (totalCalls ? (serviceSeen.get(node.service) || 0) + 1 : 0) : 0;
    if (ordinal) serviceSeen.set(node.service, ordinal);
    const overLimit = Boolean(node.traceOverLimit);
    const statusIcon = createTraceStatusIcon(node.traceStatus);
    const card = document.createElement("article"); card.className = `trace-card${node.parentIndex === null ? " trace-root" : ""}${kafkaOnly ? " trace-kafka-node" : ""}${procedureOnly ? " trace-procedure-node" : ""}${hasRepeatedTarget ? " trace-duplicate-url" : ""}${hasFailedResponse ? " trace-failed-response" : ""}${overLimit ? " trace-over-limit" : ""}${node.reconstructedEntry ? " trace-reconstructed-gateway" : ""}`;
    if (node.clientSpanAssociation) card.classList.add("trace-client-span");
    card.style.left = `${positions[index].x}px`; card.style.top = `${positions[index].y}px`; card.style.width = `${positions[index].width}px`; card.style.minHeight = `${positions[index].height}px`;
    const order = document.createElement("span"); order.className = "trace-order"; order.textContent = node.stepNumber == null ? '—' : String(node.stepNumber); order.title = node.stepNumber != null ? `Первый шаг реконструкции графа: ${node.stepNumber} · номер в списке «Шаги»` : diagram.loadingMore ? 'Номер появится, когда догрузятся все страницы' : 'Для этого блока нет отдельного наблюдаемого шага';
    if(node.parentIndex!==null){
      const confidence={observed:'подтверждена parentSpanId',high:'высокая',medium:'средняя',low:'низкая'}[node.heuristicConfidence]||'низкая';
      order.title+=`\nУверенность связи с родителем: ${confidence}.`;
    }
    const repeated = document.createElement("span"); repeated.className = "trace-repeat-badge"; repeated.textContent = `ВЫЗОВ ${ordinal}/${totalCalls}`; repeated.hidden = !isObservedCall || totalCalls <= 1;
    const limitWarning = document.createElement("span"); limitWarning.className = "trace-limit-warning"; limitWarning.textContent = "ВЫШЕ НОРМЫ"; limitWarning.title = `${node.httpCallerService || node.service} вызвал ${node.service} по одинаковому URI ${Math.max(0, ...(node.requestTargets || []).map((target) => traceUriCallCount(node.httpCallerKey || node.httpCallerService || node.service, target, uriCallTotals)))} раз; норма ≤ ${serviceCallLimit}`; limitWarning.hidden = !overLimit;
    const recovered = document.createElement("div"); recovered.className = "trace-span-recovery"; recovered.hidden = !node.spanRecovery;
    if (node.spanRecovery) {
      const gatewayDuplicate=node.spanRecovery.kind==='openapi-gateway-duplicate';
      const heading = document.createElement("strong"); heading.textContent = gatewayDuplicate ? "ДУБЛЬ OPENAPI GATEWAY ПОГЛОЩЁН" : node.spanRecovery.kind === 'uri-time-match' ? "ПАРА ПО URI И ВРЕМЕНИ" : "ПАРА ПО ВРЕМЕНИ И DURATION";
      const responseId = document.createElement("code"); responseId.textContent = gatewayDuplicate
        ? `Объединено записей: ${1 + (node.absorbedGatewayDuplicates || []).length}`
        : `RESPONSE spanId: ${(node.recoveredSpanIds || []).join(", ")}`;
      const reason = document.createElement("span"); reason.textContent = gatewayDuplicate ? "Соседние записи одного входа с одинаковыми методом и URI объединены; связь дочернего parentSpanId сохранена."
        : node.spanRecovery.kind === 'uri-time-match' ? "Единственная совместимая пара по сервису, URI и времени. Duration в журнале не указан." : "Предполагаемая пара по сервису, времени и duration. Разные spanId сами по себе не доказывают разрыв.";
      recovered.append(heading, responseId, reason); recovered.title = node.spanRecovery.reason || reason.textContent;
    }
    const service = document.createElement("div"); service.className = "trace-service"; service.append(createTraceKindIcon(kafkaOnly ? "trace-kafka.png" : "trace-service.png", kafkaOnly ? "Kafka" : "Сервис"), document.createTextNode(node.service));
    service.title=[familyByNode.get(index)?.label ? `Группа: ${familyByNode.get(index).label}` : '',...(node.threadKinds?.length?[`Имена потоков: ${node.threadKinds.join(', ')}. Подсказка по соглашению, не доказательство порядка вызовов.`]:[])].filter(Boolean).join('\n');
    if (['openapi-window','openapi-name-uri','openapi-gateway-window'].includes(node.parentInference)) {
      service.title += `${service.title ? '\n' : ''}${node.parentInference==='openapi-name-uri'?'Ветка OpenAPI выбрана по окну времени и единственному общему токену service-name / URI.':node.parentInference==='openapi-gateway-window'?'Операция отнесена к входу OpenAPI gateway по временному окну; при неоднозначности использовано совпадение service-name / URI.':'Ветка OpenAPI по времени; прямой вызов не подтверждён'}`;
      order.style.borderStyle = 'dashed';
      order.title += node.parentInference==='openapi-name-uri'?'\nВетка OpenAPI: приоритет по имени сервиса и URI; связь предполагаемая.':node.parentInference==='openapi-gateway-window'?'\nВетка OpenAPI: вход через gateway восстановлен по окну операции; связь предполагаемая.':'\nВетка OpenAPI по времени; прямой вызов не подтверждён';
    }
    const reconstructionBadge=document.createElement('span');reconstructionBadge.className='trace-reconstruction-badge';reconstructionBadge.hidden=!node.reconstructedEntry;
    reconstructionBadge.textContent='ВХОД GATEWAY ВОССТАНОВЛЕН · записи REQUEST в логе нет';reconstructionBadge.title=node.reconstructedEntry?.reason||'';
    const crossServiceBadge=document.createElement('span');crossServiceBadge.className='trace-cross-service-badge';crossServiceBadge.hidden=!node.crossServicePair;
    crossServiceBadge.textContent='REQUEST У ЦЕЛИ · RESPONSE У ИСТОЧНИКА';crossServiceBadge.title=node.crossServicePair?.reason||'';
    const span = document.createElement("code"); span.className = "trace-span"; span.textContent = `spanId: ${node.spanId}`;
    if (node.clientSpanAssociation) {
      const badge=document.createElement("b"); badge.className="trace-client-span-badge"; badge.textContent="CLIENT · ";
      badge.title="Клиентский span этого сервиса. Пунктирная связь с родителем не означает вызов сервиса самого себя."; span.prepend(badge);
    }
    const filteredAncestry = document.createElement("span");
    filteredAncestry.className = "trace-filtered-ancestry-badge";
    filteredAncestry.hidden = !node.filteredAncestry;
    if (node.filteredAncestry) {
      const hiddenHops = Math.max(1, Number(node.filteredAncestry.hiddenHops) || 1);
      filteredAncestry.textContent = `PARENT CHAIN · через ${hiddenHops} скрыт. блок${hiddenHops === 1 ? "" : "а"}`;
      filteredAncestry.title = "Показан ближайший видимый предок. Это связь по цепочке parent span, а не наблюдаемый сетевой вызов между двумя карточками.";
    }
    const request = document.createElement("div"); request.className = "trace-event request"; request.innerHTML = `<b>REQUEST</b><span></span>`; request.lastElementChild.textContent = `${moscowTime(node.requestAt)} · ${Number(node.requestCount)||0}`;
    const requestTarget = document.createElement("div"); requestTarget.className = "trace-http-target";
    const completedOnly = node.completedOperation && Number(node.requestCount) === 0;
    const displayTargets = node.requestTargets?.length ? node.requestTargets : completedOnly ? node.responseTargets : [];
    const firstTarget = displayTargets?.[0];
    if (firstTarget) {
      if (node.repeatedHttpTargets?.some((item) => item.url === firstTarget.url)) requestTarget.classList.add("duplicate");
      const method = document.createElement("b"); method.textContent = completedOnly ? "URI" : firstTarget.method;
      const url = document.createElement("code"); url.textContent = firstTarget.url; url.title = firstTarget.url;
      const extra = Math.max(0, displayTargets.length - 1); requestTarget.append(method, url);
      if (extra) { const more = document.createElement("small"); more.textContent = `+${extra}`; more.title = "Другие HTTP-цели этого span"; requestTarget.append(more); }
    } else requestTarget.hidden = true;
    const duplicateWarning = document.createElement("div"); duplicateWarning.className = "trace-duplicate-warning";
    duplicateWarning.textContent = repeatedTarget ? `ТРЕБУЕТ ПРОВЕРКИ · URL ×${repeatedTarget.count}${node.repeatedHttpTargets.length > 1 ? ` · ещё ${node.repeatedHttpTargets.length - 1}` : ""}` : "";
    duplicateWarning.title = repeatedTarget ? `${repeatedTarget.callerService || node.httpCallerService || node.service} вызвал ${node.service} по одинаковому URL ${repeatedTimesLabel(repeatedTarget.count)}: ${repeatedTarget.url}` : "";
    duplicateWarning.hidden = !repeatedTarget;
    const response = document.createElement("div"); response.className = `trace-event response${hasFailedResponse ? " level-3" : ""}`; response.innerHTML = `<b>RESPONSE</b><span></span>`; response.lastElementChild.textContent = `${moscowTime(node.responseAt)} · ${Number(node.responseCount)||0}`;
    if (completedOnly && /^\d{3}$/.test(String(firstTarget?.status || ''))) response.lastElementChild.textContent = `${firstTarget.status} · ${response.lastElementChild.textContent}`;
    const responseError = document.createElement("div"); responseError.className = "trace-response-error";
    responseError.textContent = hasFailedResponse ? `ЗАПРОС ЗАВЕРШИЛСЯ ОШИБКОЙ · LEVEL 3${Number(node.responseLevel3Count) > 1 ? ` ×${Number(node.responseLevel3Count)}` : ""}` : "";
    responseError.hidden = !hasFailedResponse;
    const elapsed = document.createElement("div"); elapsed.className = "trace-node-duration";
    const executionDuration = globalThis.TraceLatency ? TraceLatency.duration(node) : node.responseDuration;
    const elapsedValue = durationLabel(executionDuration);
    elapsed.textContent = elapsedValue ? `Запрос исполнился за: ${elapsedValue} мс` : "";
    elapsed.hidden = !elapsedValue;
    if (elapsedValue) elapsed.append(createTraceLatencyBadge(executionDuration));
    const kafkaConsumeEvent = document.createElement("div"); kafkaConsumeEvent.className = "trace-kafka-event consume";
    const kafkaConsumeLabel = document.createElement("b"); kafkaConsumeLabel.textContent = "↓ KAFKA · ПОЛУЧЕНИЕ";
    const kafkaConsumeTime = document.createElement("span"); kafkaConsumeTime.textContent = `${moscowTime(node.kafkaConsumeAt)} · ${Number(node.kafkaConsumeCount) || 0}`;
    kafkaConsumeEvent.append(kafkaConsumeLabel, kafkaConsumeTime);
    const kafkaConsumeTopic = document.createElement("code"); kafkaConsumeTopic.className = "trace-kafka-node-topic";
    kafkaConsumeTopic.textContent = `topic: ${node.kafkaConsumes?.[0]?.topic || "не определён"}`;
    kafkaConsumeTopic.title = node.kafkaConsumes?.[0]?.topic || "Topic не определён";
    if (procedureOnly) {
      const procedureEvent=document.createElement("div"); procedureEvent.className="trace-procedure-event";
      const procedureLabel=document.createElement("b"); procedureLabel.textContent="XML ПРОЦЕДУРА";
      const procedureCount=document.createElement("span"); procedureCount.textContent=`REQ ${Number(node.xmlProcedureRequestCount)||0} · RESP ${Number(node.xmlProcedureResponseCount)||0}`;
      procedureEvent.append(procedureLabel,procedureCount);
      const procedureName=document.createElement("code"); procedureName.className="trace-procedure-node-name";
      procedureName.textContent=`Процедура: ${node.xmlProcedureRequests?.[0]?.procedure || node.xmlProcedureResponseSamples?.[0]?.procedure || "не определена"}`;
      card.append(order, limitWarning, service, span, procedureEvent, procedureName);
    } else if (kafkaOnly) {
      card.append(order, limitWarning, service, span);
      if (Number(node.kafkaProduceCount) > 0) {
        const kafkaEvent = document.createElement("div"); kafkaEvent.className = "trace-kafka-event";
        const kafkaLabel = document.createElement("b"); kafkaLabel.textContent = "↑ KAFKA · ОТПРАВКА";
        const kafkaTime = document.createElement("span"); kafkaTime.textContent = `${moscowTime(node.kafkaProduceAt)} · ${Number(node.kafkaProduceCount) || 0}`;
        kafkaEvent.append(kafkaLabel, kafkaTime);
        const kafkaTopic = document.createElement("code"); kafkaTopic.className = "trace-kafka-node-topic";
        kafkaTopic.textContent = `topic: ${node.kafkaProduces?.[0]?.topic || "не определён"}`;
        kafkaTopic.title = (node.kafkaProduces?.[0]?.topic || "Topic не определён") + (node.kafkaProduces?.[0]?.provenance === "instance-send-topic" ? " · Отправка определена по правилу OpenAPI: Send в instance-name и topic в сообщении." : "");
        card.append(kafkaEvent, kafkaTopic);
      }
      if (Number(node.kafkaConsumeCount) > 0) card.append(kafkaConsumeEvent, kafkaConsumeTopic);
      if (Number(node.kafkaBrokerCount) > 0) {
        const brokerEvent = document.createElement("div"); brokerEvent.className = "trace-kafka-event";
        const brokerLabel = document.createElement("b"); brokerLabel.textContent = node.kafkaRoleHint === "produce" ? "◇ KAFKA · ВЕРОЯТНАЯ ОТПРАВКА" : node.kafkaRoleHint === "consume" ? "◇ KAFKA · ВЕРОЯТНОЕ ПОЛУЧЕНИЕ" : "◇ KAFKA · НАПРАВЛЕНИЕ НЕИЗВЕСТНО";
        const brokerTime = document.createElement("span"); brokerTime.textContent = `${moscowTime(node.kafkaBrokerAt)} · ${Number(node.kafkaBrokerCount) || 0}`;
        brokerEvent.append(brokerLabel, brokerTime);
        const topics = document.createElement("code"); topics.className = "trace-kafka-node-topic";
        topics.textContent = `topic: ${node.kafkaBrokers?.[0]?.topic || "не определён"}`;
        card.append(brokerEvent, topics);
      }
    } else {
      card.append(order, repeated, limitWarning, service, span, reconstructionBadge, crossServiceBadge, request, requestTarget, duplicateWarning, response, responseError, elapsed, recovered);
      if (Number(node.kafkaConsumeCount) > 0) card.append(kafkaConsumeEvent, kafkaConsumeTopic);
      card.append(traceLabelElement(node.requestLabels));
    }
    if (node.filteredAncestry) card.append(filteredAncestry);
    if (statusIcon) card.append(statusIcon);
    card.addEventListener("pointerdown", (event) => beginBranchDrag(event, index, card));
    bindTraceBlockSelection(card,"node",index);
    cardElements[index] = card;
    stage.append(card);
    const filterData = traceNodeFilterData(node);
    card.dataset.traceFilterText = filterData.text;
    card.dataset.traceFilterFlags = Object.entries(filterData.flags).filter(([, value]) => value).map(([key]) => key).join(" ");
    filterItems.push({ element:card, box:positions[index], type:"node", index, ...filterData, matched:true });
  });
  const subcallElements = [];
  for (const [subcallIndex, subcall] of subcalls.entries()) {
    const call = document.createElement("div");
    call.className = `trace-subcall${subcall.responseLevel3 ? " response-level3" : ""}${subcall.clientFailure ? " client-failure" : ""}${subcall.kafkaProduce ? " kafka-produce" : ""}${subcall.xmlProcedure ? " xml-procedure" : ""}${subcall.cacheChain ? " cache-chain" : ""}${subcall.cacheWrite ? " cache-write" : ""}${subcall.overLimit ? " over-limit" : ""}`;
    if (subcall.clientFailure && !subcall.requestObserved) call.classList.add("client-failure-unpaired");
    call.style.left = `${subcall.x}px`; call.style.top = `${subcall.y}px`;
    call.style.width = `${subcall.width}px`; call.style.height = `${subcall.height}px`;
    if (subcall.assumption) {
      call.classList.add("trace-assumption");
      const title=document.createElement("strong"); title.className="trace-subcall-title"; title.textContent="ПРЕДПОЛОЖЕНИЕ";
      const text=document.createElement("div"); text.className="trace-assumption-text"; text.textContent="Дальнейшее действие не найдено · возможно БД или кеш";
      call.append(title,text);
      call.title="Это предположение по границе наблюдаемого trace, а не подтверждённый вызов конкретной технологии.";
    } else if (subcall.diagnostic) {
      call.classList.add("trace-diagnostic");
      call.dataset.diagnosticDependency=subcall.detail.dependency;
      call.dataset.diagnosticBinding=subcall.detail.binding;
      const title=document.createElement("strong"); title.className="trace-subcall-title";
      title.textContent=`${subcall.label} · level 3 ×${subcall.detail.eventCount}`;
      call.append(title);
      for (const line of traceDiagnosticLines(subcall.detail)) {
        const item=document.createElement("div"); item.className="trace-diagnostic-line"; item.textContent=line; call.append(item);
      }
      call.title="Диагностика по журналу: вызов зависимости и его время не наблюдались. Перемещайте блок за заголовок.";
    } else {
    const overLimit = Boolean(subcall.overLimit);
    const statusIcon = createTraceStatusIcon(traceSubcallStatus(subcall));
    const subcallOrder = document.createElement("span"); subcallOrder.className = "trace-subcall-order"; subcallOrder.textContent = subcall.stepNumber == null ? '—' : String(subcall.stepNumber); subcallOrder.title = subcall.stepNumber != null ? `Первый шаг этого блока: ${subcall.stepNumber} · номер в списке «Шаги»` : diagram.loadingMore ? 'Номер появится, когда догрузятся все страницы' : 'Для этого блока нет отдельного наблюдаемого шага';
    if (subcall.clientFailure) subcallOrder.hidden = !subcall.requestObserved;
    const label = document.createElement("strong"); label.className = "trace-subcall-title"; label.textContent = `${overLimit ? "ВЫШЕ НОРМЫ · " : ""}${subcall.label}`;
    if (subcall.kafkaProduce) label.prepend(createTraceKindIcon("trace-kafka.png", "Kafka produce"));
    const target = document.createElement("div"); target.className = subcall.cacheChain ? "trace-cache-path" : "trace-subcall-target";
    if (subcall.cacheChain) {
      const local = document.createElement("span"); local.className = "trace-cache-hop local"; local.textContent = "LOCAL CACHE";
      const localIcon = document.createElement("img"); localIcon.className = "trace-cache-icon"; localIcon.src = traceAssetUrl("trace-cache.png"); localIcon.alt = ""; local.prepend(localIcon);
      const arrow = document.createElement("span"); arrow.className = "trace-cache-arrow"; arrow.textContent = "→"; arrow.setAttribute("aria-hidden", "true");
      const redis = document.createElement("span"); redis.className = "trace-cache-hop redis"; redis.textContent = "REDIS";
      const redisIcon = document.createElement("img"); redisIcon.className = "trace-cache-icon"; redisIcon.src = traceAssetUrl("trace-cache.png"); redisIcon.alt = ""; redis.prepend(redisIcon);
      target.append(local, arrow, redis);
      target.setAttribute("aria-label", `${subcall.cacheWrite ? "PUT: запись в" : "GET: чтение из"} двухуровневого кеша Local Cache и Redis`);
    } else if (subcall.xmlProcedure && subcall.detail?.procedure) {
      const prefix=document.createElement("b"); prefix.textContent="Процедура:";
      const procedure=document.createElement("code"); procedure.textContent=subcall.detail.procedure;
      target.append(prefix,procedure);
    } else if (!subcall.oneWay && subcall.detail?.url) {
      const method = document.createElement("b"); method.textContent = subcall.detail.method || "HTTP";
      const url = document.createElement("code"); url.textContent = subcall.detail.url; url.title = subcall.detail.url;
      target.append(method, url);
      if (subcall.calleeMissing) {
        const missing = document.createElement("small"); missing.className = "trace-subcall-callee-missing";
        missing.textContent = "Получатель не в выборке: его сообщений с этим traceId не загружено";
        missing.title = "Вызов виден только со стороны вызывающего сервиса (его REQUEST/RESPONSE клиента). Ни один узел трейса не принимал запрос на этот маршрут: логи сервиса-получателя либо в другом stream, либо без этого traceId, либо вне периода.";
        target.append(missing);
      }
    } else target.hidden = true;
    const response = document.createElement("small");
    const hasResponse = (subcall.responseObserved ?? (subcall.subIndex < subcall.responseTotal));
    response.className = subcall.responseLevel3 ? "response-level3-label" : subcall.kafkaProduce ? "kafka-topic" : hasResponse ? "has-response" : "no-response";
    response.textContent = subcall.kafkaProduce ? `topic: ${subcall.detail?.topic || "не определён"}` : hasResponse ? `${subcall.label} RESPONSE${subcall.responseLevel3 ? " · LEVEL 3" : " ✓"}${subcall.requestObserved === false ? " · БЕЗ ПАРЫ" : ""}` : `${subcall.label} RESPONSE —`;
    response.title = subcall.kafkaProduce ? (subcall.detail?.topic || "Topic не определён") + (subcall.detail?.provenance === "instance-send-topic" ? " · Отправка определена по правилу OpenAPI: Send в instance-name и topic в сообщении." : "") : "";
    response.hidden = Boolean(subcall.cacheChain);
    if (subcall.clientFailure) {
      response.className="trace-client-failure-label";
      response.textContent="Сбой WebClient · HTTP-ответ не получен";
      response.title="WebClientRequestException: статус HTTP не установлен. Причина доступна в разборе трейса.";
    }
    const elapsed = document.createElement("small"); elapsed.className = "trace-subcall-duration";
    const elapsedValue = durationLabel(subcall.responseDuration);
    elapsed.textContent = elapsedValue ? `duration: ${elapsedValue} мс` : "";
    elapsed.hidden = !elapsedValue;
    call.append(subcallOrder, label, target);
    if (subcall.cacheChain) {
      const owner = document.createElement("small"); owner.className = "trace-cache-owner"; owner.textContent = `Сервис: ${nodes[subcall.parentIndex].service}`;
      const key = document.createElement("code"); key.className = "trace-cache-key"; key.textContent = `Ключ: ${subcall.detail?.safeKey || "не указан"}`;
      key.title = "Числа и непрозрачные сегменты заменены на *. Текстовые имена сохранены; проверьте их перед передачей схемы.";
      call.append(owner, key);
    }
    if (!subcall.cacheChain) call.append(response);
    if (subcall.clientFailure) {
      const pairing=document.createElement("small"); pairing.className="trace-client-failure-pairing";
      pairing.textContent=subcall.requestObserved ? "REQUEST сопоставлен по service + span + метод + URI" : "REQUEST не сопоставлен";
      const owner=document.createElement("small"); owner.className="trace-client-failure-owner";
      owner.textContent=`${subcall.clientFailure.service} · span: ${subcall.clientFailure.spanId}${subcall.parentIndex === null ? " · связь не определена" : ""}`;
      call.append(pairing, owner);
    }
    if (elapsedValue) elapsed.append(createTraceLatencyBadge(subcall.responseDuration));
    call.append(elapsed, traceLabelElement(subcall.labels));
    if (statusIcon) call.append(statusIcon);
    call.title = subcall.cacheChain ? `${subcall.cacheWrite ? "PUT: запись в кеш" : "GET: чтение кеша"} сервисом ${nodes[subcall.parentIndex].service}; точное совпадение service-name + spanId. Ключ: ${subcall.detail?.safeKey || "не указан"}. Событие ${subcall.subIndex + 1} из ${subcall.total}`
      : `${overLimit ? `Требует проверки: одинаковый URI вызван ${subcall.uriCallCount} раз, норма ≤ ${serviceCallLimit}. ` : ""}${subcall.kafkaProduce ? `Kafka produce: ${subcall.detail?.topic || "topic не определён"}` : subcall.xmlProcedure ? `XML-процедура ${subcall.detail?.procedure || "не определена"}; сопоставление только внутри service/instance + span.` : `${subcall.label}: исходящий вызов ${subcall.subIndex + 1} из ${subcall.total}`}`;
    }
    call.addEventListener("pointerdown", (event) => beginSubcallDrag(event, subcallIndex, call));
    bindTraceBlockSelection(call,"subcall",subcallIndex);
    subcallElements[subcallIndex] = call;
    stage.append(call);
    const filterData = traceSubcallFilterData(subcall, nodes[subcall.parentIndex]);
    call.dataset.traceFilterText = filterData.text;
    call.dataset.traceFilterFlags = Object.entries(filterData.flags).filter(([, value]) => value).map(([key]) => key).join(" ");
    filterItems.push({ element:call, box:subcall, type:"subcall", index:subcallIndex, ...filterData, matched:true });
  }
  const kafkaEndpointElements = [];
  for (const [endpointIndex, endpoint] of kafkaEndpoints.entries()) {
    const broker = document.createElement("div"); broker.className = `trace-kafka-broker${endpoint.brokerObservation ? " trace-kafka-infra" : ""}`;
    broker.style.left = `${endpoint.x}px`; broker.style.top = `${endpoint.y}px`; broker.style.width = `${endpoint.width}px`; broker.style.height = `${endpoint.height}px`;
    const title = document.createElement("strong"); title.append(createTraceKindIcon("trace-kafka.png", "Kafka broker"), document.createTextNode(endpoint.brokerObservation ? "KAFKA INFRA" : "KAFKA BROKER"));
    const topic = document.createElement("code"); topic.textContent = `topic: ${endpoint.topic}`; topic.title = endpoint.topic;
    broker.append(title, topic);
    if (endpoint.brokerObservation) {
      const count=document.createElement("small"); count.className="trace-kafka-broker-count"; count.textContent=`Сообщений: ${endpoint.eventCount}`;
      broker.append(count);
      broker.title="Наблюдаемая Kafka-инфраструктура. Адрес broker и offset скрыты; записи сгруппированы по service/instance + span.";
    }
    bindTraceBlockSelection(broker,"broker",endpointIndex);
    kafkaEndpointElements[endpointIndex] = broker;
    stage.append(broker);
    const owner = endpoint.ownerType === "node" ? nodes[endpoint.ownerIndex] : nodes[subcalls[endpoint.ownerIndex]?.parentIndex];
    const filterData = { text:traceFilterText([owner?.service, owner?.spanId, endpoint.brokerObservation ? "KAFKA INFRA" : "KAFKA BROKER", endpoint.topic]), flags:{ level3:false, repeated:false, incomplete:false, kafka:true, issue:false } };
    broker.dataset.traceFilterText = filterData.text;
    broker.dataset.traceFilterFlags = "kafka";
    filterItems.push({ element:broker, box:endpoint, type:"broker", index:endpointIndex, ...filterData, matched:true });
  }
  const viewport = document.createElement("div"); viewport.className = "trace-viewport"; viewport.append(stage);
  tracePage.canvas.replaceChildren(viewport);
  traceStage = stage; traceViewport = viewport; traceNaturalWidth = width; traceNaturalHeight = height;
  traceExportModel = { nodes, edges:diagram.edges || [], positions, subcalls, kafkaEndpoints, groups, width, height, serviceCallLimit, repeatedHttpTargets };
  traceInteractionModel = {
    nodes, edges:diagram.edges || [], positions, subcalls, kafkaEndpoints, callGroups, serviceCallLimit, stage, svg, defs, cardElements, subcallElements, kafkaEndpointElements,
    flowPaths:geometry.flowPaths, playbackTrail:geometry.playbackTrail, playbackHead:geometry.playbackHead, filterItems,
    baseWidth:width, baseHeight:height,
    originalPositions:positions.map((item) => ({ ...item })),
    originalSubcalls:subcalls.map((item) => ({ x:item.x, y:item.y }))
  };
  traceDragState = null;
  tracePage.resetLayout.disabled = true;
  tracePage.download.disabled = false;
  tracePlayback.events = playbackEvents;
  traceInteractionModel.groups=groups;
  renderTraceGroups(traceInteractionModel);
  globalThis.renderTraceCallGroups?.(traceInteractionModel);
  tracePlayback.state = "idle";
  globalThis.TraceStepsView?.render(traceInteractionModel,diagram.loadingMore?[]:tracePlayback.events);
  tracePage.localTools.hidden = false;
  tracePage.minimap.hidden = false;
  refreshTraceLatency();
  const insights=globalThis.TraceObservability?.summarize?.({nodes,edges:diagram.edges||[],rootIslands:diagram.rootIslands||[]})||diagram.traceInsights;
  renderTraceSummary(nodes, subcalls, kafkaEndpoints, uriCallTotals, insights, diagram.contentTruncated===true);
  applyTraceLocalFilter();
  applyTraceFlowControls();
  applyTracePlaybackControls();
  readableTrace();
}

function traceBranchIndexes(nodes, rootIndex) {
  const branch = new Set([rootIndex]);
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((node, index) => {
      if (!branch.has(index) && branch.has(node.parentIndex)) { branch.add(index); changed = true; }
    });
  }
  return [...branch];
}

function beginBranchDrag(event, nodeIndex, card) {
  if (event.button !== 0 || !traceInteractionModel || !event.target.closest(".trace-order, .trace-service")) return;
  suspendTracePlaybackForGeometry();
  event.preventDefault();
  const nodeIndexes = traceBranchIndexes(traceInteractionModel.nodes, nodeIndex);
  const branchSet = new Set(nodeIndexes);
  const subcallIndexes = traceInteractionModel.subcalls.map((subcall, index) => branchSet.has(subcall.parentIndex) ? index : -1).filter((index) => index >= 0);
  const positionOrigins = new Map(nodeIndexes.map((index) => [index, { x:traceInteractionModel.positions[index].x, y:traceInteractionModel.positions[index].y }]));
  const subcallOrigins = new Map(subcallIndexes.map((index) => [index, { x:traceInteractionModel.subcalls[index].x, y:traceInteractionModel.subcalls[index].y }]));
  const allOrigins = [...positionOrigins.values(), ...subcallOrigins.values()];
  traceDragState = {
    pointerId:event.pointerId, card, nodeIndexes, subcallIndexes, positionOrigins, subcallOrigins,
    startX:event.clientX, startY:event.clientY, minX:Math.min(...allOrigins.map((item) => item.x)), minY:Math.min(...allOrigins.map((item) => item.y)), moved:false
  };
  card.setPointerCapture?.(event.pointerId);
  card.classList.add("branch-dragging");
  for (const index of nodeIndexes) traceInteractionModel.cardElements[index]?.classList.add("branch-moving");
}

function beginSubcallDrag(event, subcallIndex, card) {
  if (event.button !== 0 || !traceInteractionModel || !event.target.closest(".trace-subcall-title,.trace-subcall-order")) return;
  const subcall = traceInteractionModel.subcalls[subcallIndex];
  if (!subcall) return;
  suspendTracePlaybackForGeometry();
  event.preventDefault();
  traceDragState = {
    pointerId:event.pointerId, card, nodeIndexes:[], subcallIndexes:[subcallIndex], positionOrigins:new Map(),
    subcallOrigins:new Map([[subcallIndex, { x:subcall.x, y:subcall.y }]]),
    startX:event.clientX, startY:event.clientY, minX:subcall.x, minY:subcall.y, moved:false
  };
  card.setPointerCapture?.(event.pointerId);
  card.classList.add("branch-dragging", "branch-moving");
}

function scheduleTraceGeometryRefresh() {
  if (traceGeometryFrame) return;
  traceGeometryFrame = requestAnimationFrame(() => { traceGeometryFrame = 0; refreshTraceGeometry(); });
}

function refreshTraceGeometry() {
  const model = traceInteractionModel;
  if (!model) return;
  model.positions.forEach((position, index) => {
    const card = model.cardElements[index];
    if (!card) return;
    card.style.left = `${position.x}px`;
    card.style.top = `${position.y}px`;
  });
  model.subcalls.forEach((subcall, index) => {
    const element = model.subcallElements[index];
    if (!element) return;
    element.style.left = `${subcall.x}px`;
    element.style.top = `${subcall.y}px`;
  });
  model.kafkaEndpoints.forEach((endpoint, index) => {
    updateKafkaEndpointGeometry(endpoint, model.positions, model.subcalls);
    const element = model.kafkaEndpointElements[index];
    if (!element) return;
    element.style.left = `${endpoint.x}px`;
    element.style.top = `${endpoint.y}px`;
  });
  const maxX = Math.max(0, ...model.positions.map((item) => item.x + item.width), ...model.subcalls.map((item) => item.x + item.width), ...model.kafkaEndpoints.map((item) => item.x + item.width));
  const maxY = Math.max(0, ...model.positions.map((item) => item.y + item.height), ...model.subcalls.map((item) => item.y + item.height), ...model.kafkaEndpoints.map((item) => item.y + item.height));
  const width = Math.max(model.baseWidth, Math.ceil(maxX + 45));
  const height = Math.max(model.baseHeight, Math.ceil(maxY + 80));
  model.stage.style.width = `${width}px`;
  model.stage.style.height = `${height}px`;
  model.svg.setAttribute("width", String(width));
  model.svg.setAttribute("height", String(height));
  model.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const geometry = drawTraceConnections(model.svg, model.defs, model.edges, model.nodes, model.positions, model.subcalls, model.kafkaEndpoints, model.serviceCallLimit);
  model.flowPaths = geometry.flowPaths;
  model.playbackTrail = geometry.playbackTrail;
  model.playbackHead = geometry.playbackHead;
  renderTraceGroups(model);
  traceNaturalWidth = width;
  traceNaturalHeight = height;
  if (traceExportModel) { traceExportModel.width = width; traceExportModel.height = height; traceExportModel.kafkaEndpoints = model.kafkaEndpoints; }
  applyScale(false);
}

function moveTraceBranch(event) {
  if (!traceDragState || event.pointerId !== traceDragState.pointerId || !traceInteractionModel) return;
  event.preventDefault();
  let deltaX = (event.clientX - traceDragState.startX) / traceScale;
  let deltaY = (event.clientY - traceDragState.startY) / traceScale;
  deltaX = Math.max(deltaX, 12 - traceDragState.minX);
  deltaY = Math.max(deltaY, 12 - traceDragState.minY);
  for (const [index, origin] of traceDragState.positionOrigins) {
    traceInteractionModel.positions[index].x = origin.x + deltaX;
    traceInteractionModel.positions[index].y = origin.y + deltaY;
  }
  for (const [index, origin] of traceDragState.subcallOrigins) {
    traceInteractionModel.subcalls[index].x = origin.x + deltaX;
    traceInteractionModel.subcalls[index].y = origin.y + deltaY;
  }
  if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
    traceDragState.moved = true;
    tracePage.resetLayout.disabled = false;
  }
  scheduleTraceGeometryRefresh();
}

function finishBranchDrag(event) {
  if (!traceDragState || event.pointerId !== traceDragState.pointerId) return;
  const restoreFit = traceScaleMode === "fit";
  traceDragState.card.classList.remove("branch-dragging");
  traceDragState.card.classList.remove("branch-moving");
  for (const index of traceDragState.nodeIndexes) traceInteractionModel?.cardElements[index]?.classList.remove("branch-moving");
  traceDragState.card.releasePointerCapture?.(event.pointerId);
  traceDragState = null;
  if (traceGeometryFrame) { cancelAnimationFrame(traceGeometryFrame); traceGeometryFrame = 0; }
  refreshTraceGeometry();
  resumeTracePlaybackAfterGeometry();
  if (restoreFit) fitTrace();
}

function beginTracePan(event) {
  if (event.button !== 0 || tracePanState || event.target.closest?.(".trace-card,.trace-subcall,.trace-kafka-broker,button")) return;
  event.preventDefault();
  tracePage.canvas.focus?.({preventScroll:true});
  tracePanState = { pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, scrollLeft:tracePage.canvas.scrollLeft, scrollTop:tracePage.canvas.scrollTop };
  tracePage.canvas.setPointerCapture?.(event.pointerId);
  tracePage.canvas.classList.add("trace-panning");
}

function moveTracePan(event) {
  if (!tracePanState || event.pointerId !== tracePanState.pointerId) return;
  event.preventDefault();
  tracePage.canvas.scrollLeft = tracePanState.scrollLeft - (event.clientX - tracePanState.startX);
  tracePage.canvas.scrollTop = tracePanState.scrollTop - (event.clientY - tracePanState.startY);
}

function finishTracePan(event) {
  if (!tracePanState || event.pointerId !== tracePanState.pointerId) return;
  tracePage.canvas.releasePointerCapture?.(event.pointerId);
  tracePanState = null;
  tracePage.canvas.classList.remove("trace-panning");
}

function resetTraceLayout() {
  const model = traceInteractionModel;
  if (!model) return;
  const playbackWasActive = ["playing", "paused"].includes(tracePlayback.state);
  const playbackWasPaused = tracePlayback.state === "paused";
  if (playbackWasActive) cancelTracePlayback(true, "idle");
  model.originalPositions.forEach((origin, index) => Object.assign(model.positions[index], origin));
  model.originalSubcalls.forEach((origin, index) => Object.assign(model.subcalls[index], origin));
  model.baseWidth = Math.max(800, model.baseWidth);
  refreshTraceGeometry();
  tracePage.resetLayout.disabled = true;
  readableTrace();
  if (playbackWasActive) {
    startTracePlayback();
    if (playbackWasPaused) pauseTracePlayback();
  }
}

function applyScale(preserveCenter = true) {
  if (!traceStage || !traceViewport) return;
  const oldScale = Number(traceStage.dataset.scale) || traceScale;
  const centerX = (tracePage.canvas.scrollLeft + tracePage.canvas.clientWidth / 2 - traceOffsetX) / oldScale;
  const centerY = (tracePage.canvas.scrollTop + tracePage.canvas.clientHeight / 2 - traceOffsetY) / oldScale;
  traceStage.style.transform = `scale(${traceScale})`;
  traceStage.dataset.scale = String(traceScale);
  const localCamera = traceScaleMode === "playback" || traceScaleMode === "readable";
  traceOffsetX = localCamera ? tracePage.canvas.clientWidth / 2 : Math.max(28,(tracePage.canvas.clientWidth-traceNaturalWidth*traceScale)/2);
  traceOffsetY = localCamera ? tracePage.canvas.clientHeight / 2 : Math.max(28,(tracePage.canvas.clientHeight-traceNaturalHeight*traceScale)/2);
  traceStage.style.left = `${traceOffsetX}px`;
  traceStage.style.top = `${traceOffsetY}px`;
  traceViewport.style.width = `${Math.ceil(traceNaturalWidth * traceScale + traceOffsetX*2)}px`;
  traceViewport.style.height = `${Math.ceil(traceNaturalHeight * traceScale + traceOffsetY*2)}px`;
  tracePage.zoomLevel.textContent = `${Math.round(traceScale * 100)}%`;
  if (preserveCenter) {
    tracePage.canvas.scrollLeft = Math.max(0, centerX * traceScale + traceOffsetX - tracePage.canvas.clientWidth / 2);
    tracePage.canvas.scrollTop = Math.max(0, centerY * traceScale + traceOffsetY - tracePage.canvas.clientHeight / 2);
  }
  scheduleTraceMinimapUpdate();
  globalThis.TracePlaybackContextView?.updateSourceVisibility?.();
}
function setTraceScale(value, preserveCenter = true, mode = "manual") {
  const minimum = .001;
  traceScale = Math.min(2.5, Math.max(minimum, Number(value) || 1));
  traceScaleMode = mode;
  applyScale(preserveCenter);
}
function fitTrace() {
  if (!traceStage) return;
  const widthScale = (tracePage.canvas.clientWidth - 56) / traceNaturalWidth;
  const heightScale = (tracePage.canvas.clientHeight - 56) / traceNaturalHeight;
  setTraceScale(Math.min(1, widthScale, heightScale), false, "fit");
  tracePage.canvas.scrollLeft = 0; tracePage.canvas.scrollTop = 0;
}
function readableTrace() {
  if (!traceStage) return;
  const first = traceInteractionModel?.positions?.[0];
  if (!first) return fitTrace();
  setTraceScale(Math.min(1, (tracePage.canvas.clientWidth - 96) / first.width, (tracePage.canvas.clientHeight - 80) / first.height), false, "readable");
  tracePage.canvas.scrollLeft = Math.max(0, (first.x + first.width / 2) * traceScale + traceOffsetX - tracePage.canvas.clientWidth / 2);
  tracePage.canvas.scrollTop = Math.max(0, first.y * traceScale + traceOffsetY - 40);
}

// Keep the diagram point under the pointer stationary while zooming.
function zoomTraceAt(value, clientX, clientY) {
  if (!traceStage) return;
  const rect = tracePage.canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  const worldX = (tracePage.canvas.scrollLeft + x - traceOffsetX) / traceScale;
  const worldY = (tracePage.canvas.scrollTop + y - traceOffsetY) / traceScale;
  setTraceScale(value, false);
  tracePage.canvas.scrollLeft = Math.max(0, worldX * traceScale + traceOffsetX - x);
  tracePage.canvas.scrollTop = Math.max(0, worldY * traceScale + traceOffsetY - y);
}

function handleTraceViewportKey(event) {
  if (event.target !== tracePage.canvas || event.ctrlKey || event.metaKey || event.altKey) return;
  const actions = {
    "+":() => setTraceScale(traceScale * 1.2), "=":() => setTraceScale(traceScale * 1.2),
    "-":() => setTraceScale(traceScale / 1.2), "0":() => setTraceScale(1),
    Home:readableTrace, f:fitTrace, F:fitTrace,
    ArrowLeft:() => { tracePage.canvas.scrollLeft -= 80; }, ArrowRight:() => { tracePage.canvas.scrollLeft += 80; },
    ArrowUp:() => { tracePage.canvas.scrollTop -= 80; }, ArrowDown:() => { tracePage.canvas.scrollTop += 80; }
  };
  if (!actions[event.key]) return;
  event.preventDefault(); actions[event.key]();
}
function exportFileName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `trace-diagram-${stamp}.png`;
}

function roundedRect(context, x, y, width, height, radius = 9) {
  const value = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + value, y); context.lineTo(x + width - value, y); context.quadraticCurveTo(x + width, y, x + width, y + value);
  context.lineTo(x + width, y + height - value); context.quadraticCurveTo(x + width, y + height, x + width - value, y + height);
  context.lineTo(x + value, y + height); context.quadraticCurveTo(x, y + height, x, y + height - value);
  context.lineTo(x, y + value); context.quadraticCurveTo(x, y, x + value, y); context.closePath();
}

function canvasText(context, value, x, y, maximumWidth) {
  let text = String(value ?? "");
  if (maximumWidth && context.measureText(text).width > maximumWidth) {
    while (text.length > 1 && context.measureText(`${text}…`).width > maximumWidth) text = text.slice(0, -1);
    text += "…";
  }
  context.fillText(text, x, y);
}

function paintArrow(context, x, y, color, direction = 1) {
  context.fillStyle = color; context.beginPath(); context.moveTo(x, y); context.lineTo(x - 5, y - 8 * direction); context.lineTo(x + 5, y - 8 * direction); context.closePath(); context.fill();
}

function paintTracePng(context, model, padding, statusImages) {
  statusImages = statusImages || {};
  const { nodes, edges, positions, subcalls, kafkaEndpoints = [], serviceCallLimit } = model;
  const uriCallTotals = traceUriCallTotals(nodes);
  context.save(); context.translate(padding, padding); context.lineWidth = 2; context.lineCap = "round";
  for (const edge of edges) {
    const child = positions[edge.to], parent = subcalls[child?.parentSubcallIndex] || positions[edge.from];
    if (!parent || !child || parent.foldHidden || child.foldHidden) continue;
    const childNode = nodes[edge.to];
    const overLimit = traceNodeOverLimit(childNode, serviceCallLimit, uriCallTotals);
    const failedResponse = Number(childNode?.responseLevel3Count) > 0;
    const route = traceConnectionRoute(parent, child);
    if (edge.assumption) { const ordinal=Number.isInteger(edge.assumptionOrdinal)&&edge.assumptionOrdinal>0?` ${edge.assumptionOrdinal}`:""; context.strokeStyle="#e7b45b"; context.setLineDash([4,6]); paintTraceConnection(context, route); paintArrow(context,route.endX,route.endY,"#e7b45b",route.direction); context.fillStyle="#f2c979"; context.font="800 9px monospace"; context.textAlign="center"; context.fillText(`ПРЕДПОЛОЖЕНИЕ${ordinal}`,route.labelX,route.labelY); continue; }
    if (edge.filteredAssociation) { context.strokeStyle="#8fa9ba"; context.setLineDash([1,7]); paintTraceConnection(context, route); context.fillStyle="#b6c8d3"; context.font="800 9px monospace"; context.textAlign="center"; context.fillText(`через ${Math.max(1,Number(edge.hiddenHops)||1)} скрыт.`,route.labelX,route.labelY); continue; }
    if (edge.spanAssociation) { context.strokeStyle="#8fa9ba"; context.setLineDash([2,6]); paintTraceConnection(context, route); continue; }
    if (childNode?.parentInference === 'openapi-window') { context.strokeStyle='#90aeb8'; context.setLineDash([4,5]); paintTraceConnection(context, route); context.fillStyle='#90aeb8'; context.font='800 9px monospace'; context.textAlign='center'; context.fillText('OpenAPI · по времени',route.labelX,route.labelY); continue; }
    if (childNode?.parentInference === 'openapi-name-uri' || childNode?.parentInference === 'openapi-gateway-window') { context.strokeStyle='#7dd3fc'; context.setLineDash([5,4]); paintTraceConnection(context, route); paintArrow(context,route.endX,route.endY,'#7dd3fc',route.direction);context.fillStyle='#7dd3fc';context.font='800 9px monospace';context.textAlign='center';context.fillText(childNode.parentInference==='openapi-gateway-window'?'OpenAPI gateway · окно':'OpenAPI · имя + URI',route.labelX,route.labelY);continue; }
    if (childNode?.parentInference === 'gateway-envelope') { context.strokeStyle='#67e8f9';context.setLineDash([3,5]);paintTraceConnection(context,route);paintArrow(context,route.endX,route.endY,'#67e8f9',route.direction);context.fillStyle='#67e8f9';context.font='800 9px monospace';context.textAlign='center';context.fillText('вход восстановлен',route.labelX,route.labelY); }
    if (edge.kafkaObserved) {
      const kafkaColor = overLimit ? "#fb923c" : "#a78bfa";
      context.strokeStyle = kafkaColor; context.setLineDash([]); paintTraceConnection(context, route); paintArrow(context, route.endX, route.endY, kafkaColor, route.direction);
      context.fillStyle = "#cdb8ff"; context.font = "800 10px monospace"; context.textAlign = "center"; context.fillText("KAFKA", route.labelX, route.labelY);
    }
    if (edge.requestObserved !== false) {
      const requestColor = overLimit ? "#fb923c" : "#43d9c7";
      context.strokeStyle = requestColor; context.setLineDash([]); const requestRoute = traceConnectionRoute(parent, child, -5); paintTraceConnection(context, requestRoute); paintArrow(context, requestRoute.endX, requestRoute.endY, requestColor, requestRoute.direction);
    }
    if (edge.responseObserved !== false) {
      const responseColor = failedResponse ? "#f0626d" : overLimit ? "#fb923c" : "#f6b84a";
      context.strokeStyle = responseColor; context.setLineDash(edge.recovered ? [2,5] : [5,4]); const responseRoute = traceConnectionRoute(parent, child, 5, true); paintTraceConnection(context, responseRoute); paintArrow(context, responseRoute.endX, responseRoute.endY, responseColor, responseRoute.direction);
    }
    if(edge.crossServicePair){context.fillStyle='#91b7c7';context.font='700 9px monospace';context.textAlign='center';context.fillText('ответ источнику',route.labelX,route.labelY-13);}
  }
  for (const subcall of subcalls) {
    const parent = positions[subcall.parentIndex]; if (!parent || parent.foldHidden || subcall.foldHidden) continue;
    const overLimit = Boolean(subcall.overLimit);
    const color = overLimit ? "#fb923c" : subcall.cacheWrite ? "#a3e635" : subcall.cacheChain ? "#38bdf8" : "#43d9c7";
    const route = traceConnectionRoute(parent, subcall);
    if (subcall.assumption) { context.strokeStyle="#d6a85f"; context.setLineDash([3,6]); paintTraceConnection(context, route); continue; }
    if (subcall.diagnostic) { context.strokeStyle="#b28e9b"; context.setLineDash([2,6]); paintTraceConnection(context, route); continue; }
    if (subcall.clientFailure && !subcall.requestObserved) { context.strokeStyle="#f0626d"; context.setLineDash([2,6]); paintTraceConnection(context, route); continue; }
    if ((subcall.requestObserved ?? (subcall.subIndex < subcall.requestTotal))) { context.strokeStyle = color; context.setLineDash([]); const requestRoute = traceConnectionRoute(parent, subcall, -4); paintTraceConnection(context, requestRoute); paintArrow(context, requestRoute.endX, requestRoute.endY, color, requestRoute.direction); }
    if (subcall.cacheChain) { context.fillStyle=color; context.font="800 10px monospace"; context.textAlign="center"; context.fillText(subcall.cacheWrite ? "PUT · запись" : "GET · чтение",route.labelX,route.labelY); }
    if ((subcall.responseObserved ?? (subcall.subIndex < subcall.responseTotal))) { context.strokeStyle = subcall.responseLevel3 ? "#f0626d" : overLimit ? "#fb923c" : "#f6b84a"; context.setLineDash([5,4]); const responseRoute = traceConnectionRoute(parent, subcall, 4, true); paintTraceConnection(context, responseRoute); paintArrow(context, responseRoute.endX, responseRoute.endY, context.strokeStyle, responseRoute.direction); }
  }
  for (const endpoint of kafkaEndpoints) {
    const owner = endpoint.ownerType === "node" ? positions[endpoint.ownerIndex] : subcalls[endpoint.ownerIndex];
    if (!owner) continue;
    const sx = owner.x + owner.width / 2, sy = owner.y + owner.height, bx = endpoint.x + endpoint.width / 2, by = endpoint.y, mid = (sy + by) / 2;
    context.strokeStyle = "#a78bfa"; context.setLineDash([]); context.beginPath(); context.moveTo(sx, sy); context.bezierCurveTo(sx, mid, bx, mid, bx, by); context.stroke(); paintArrow(context, bx, by, "#a78bfa", 1);
    for (const link of endpoint.consumerLinks || []) {
      const consumer = positions[link.consumerNodeIndex]; if (!consumer) continue;
      const startX = endpoint.x + endpoint.width / 2, startY = endpoint.y + endpoint.height;
      const endX = consumer.x + consumer.width / 2, endY = consumer.y;
      context.strokeStyle = "#c4b5fd"; context.setLineDash([5,4]); context.beginPath(); context.moveTo(startX, startY);
      if (endY > startY) context.bezierCurveTo(startX, (startY + endY) / 2, endX, (startY + endY) / 2, endX, endY);
      else { const outside = Math.max(endpoint.x + endpoint.width, consumer.x + consumer.width) + 24; context.bezierCurveTo(outside, startY, outside, endY, endX, endY); }
      context.stroke(); paintArrow(context, endX, endY, "#c4b5fd", endY >= startY ? 1 : -1);
    }
  }
  context.setLineDash([]); context.textAlign = "left";
  for(const group of model.groups || []){
    const box=traceGroupBounds(group,model);if(!box)continue;
    const label=traceGroupLabel(group,nodes);
    if(group.kind==='island'){
      context.strokeStyle=group.islandKind==='async-kafka'?'#9272d4':group.islandKind==='reconstructed-gateway'?'#35b7c4':'#c58a38';
      context.setLineDash([6,5]);roundedRect(context,box.x-14,box.y-14,box.width+28,box.height+28,14);context.stroke();context.setLineDash([]);
    }
    context.font="600 10px system-ui";context.textAlign="left";
    const labelWidth=Math.min(box.width,context.measureText(label).width+18);
    context.fillStyle="#0c1d28";context.fillRect(box.x,box.y-27,labelWidth,22);
    context.fillStyle="#aac4d3";canvasText(context,label,box.x+9,box.y-12,labelWidth-18);
    context.fillStyle="#55889a";context.fillRect(box.x,box.y-27,2,22);
  }
  nodes.forEach((node, index) => {
    let box = positions[index]; if (!box || box.foldHidden) return;
    if(globalThis.paintTraceCallGroup?.(context,box))return;
    if(box.foldGroup||box.schedulerNames)box={...box,y:box.y+62,height:box.height-62};
    const kafkaOnly = isKafkaOnlyNode(node);
    const procedureOnly = isProcedureOnlyNode(node);
    const repeatedTarget = node.repeatedHttpTargets?.[0] || null;
    const hasRepeatedTarget = Boolean(repeatedTarget);
    const hasFailedResponse = Number(node.responseLevel3Count) > 0;
    const overLimit = traceNodeOverLimit(node, serviceCallLimit, uriCallTotals);
    const status = traceNodeStatus(node, serviceCallLimit, uriCallTotals);
    roundedRect(context, box.x, box.y, box.width, box.height, 10); context.fillStyle = kafkaOnly ? "#17152c" : procedureOnly ? "#102b31" : "#0b1d29"; context.fill(); context.strokeStyle = hasFailedResponse ? "#f0626d" : overLimit || hasRepeatedTarget ? "#fb923c" : kafkaOnly ? "#8b6ac7" : procedureOnly ? "#2aa7a1" : node.parentIndex === null ? "#6f91a4" : "#237a78"; context.lineWidth = hasRepeatedTarget || hasFailedResponse || overLimit ? 2.5 : 1.5; context.stroke();
    if (status && statusImages[status]) context.drawImage(statusImages[status], box.x + box.width - 13, box.y - 13, 30, 30);
    roundedRect(context, box.x + 10, box.y + 11, 25, 25, 5); context.fillStyle = "#132f40"; context.fill(); context.strokeStyle = "#5c879e"; context.stroke(); context.fillStyle = "#ffffff"; context.font = "800 12px system-ui"; context.textAlign = "center"; context.fillText(node.stepNumber == null ? '—' : String(node.stepNumber), box.x + 22.5, box.y + 28);
    const kindImage = kafkaOnly ? statusImages.kafka : statusImages.service;
    if (kindImage) context.drawImage(kindImage, box.x + 43, box.y + 7, 22, 22);
    context.textAlign = "left"; context.fillStyle = "#ffffff"; context.font = "800 15px system-ui"; canvasText(context, node.service, box.x + 70, box.y + 25, box.width - (overLimit ? 203 : 82));
    if (overLimit) {
      roundedRect(context, box.x + box.width - 126, box.y + 10, 116, 21, 5); context.fillStyle = "#342215"; context.fill(); context.strokeStyle = "rgba(251,146,60,.75)"; context.lineWidth = 1; context.stroke();
      context.fillStyle = "#fdba74"; context.font = "800 9px monospace"; context.textAlign = "center"; context.fillText("ВЫШЕ НОРМЫ", box.x + box.width - 68, box.y + 24);
    }
    context.textAlign = "left"; context.fillStyle = "#a8c6d8"; context.font = "12px monospace"; canvasText(context, `${node.clientSpanAssociation ? "CLIENT · " : ""}spanId: ${node.spanId}`, box.x + 45, box.y + 47, box.width - 57);
    if (procedureOnly) {
      context.fillStyle="#73e2d8"; context.font="800 11px system-ui"; context.fillText("XML ПРОЦЕДУРА",box.x+45,box.y+72);
      context.textAlign="right"; canvasText(context,`REQ ${Number(node.xmlProcedureRequestCount)||0} · RESP ${Number(node.xmlProcedureResponseCount)||0}`,box.x+box.width-12,box.y+72,box.width-156);
      context.textAlign="left"; context.fillStyle="#d7fffb"; context.font="10px monospace";
      canvasText(context,`Процедура: ${node.xmlProcedureRequests?.[0]?.procedure || node.xmlProcedureResponseSamples?.[0]?.procedure || "не определена"}`,box.x+45,box.y+96,box.width-57);
      return;
    }
    if (kafkaOnly) {
      let kafkaY = box.y + 72;
      if (Number(node.kafkaProduceCount) > 0) {
        context.fillStyle = "#cdb8ff"; context.font = "800 11px system-ui"; context.textAlign = "left"; context.fillText("KAFKA PRODUCE", box.x + 45, kafkaY);
        context.textAlign = "right"; canvasText(context, `${moscowTime(node.kafkaProduceAt)} · ${Number(node.kafkaProduceCount) || 0}`, box.x + box.width - 12, kafkaY, box.width - 154);
        context.textAlign = "left"; context.font = "10px monospace"; canvasText(context, `topic: ${node.kafkaProduces?.[0]?.topic || "не определён"}`, box.x + 45, kafkaY + 24, box.width - 57);
        kafkaY += 48;
      }
      if (Number(node.kafkaConsumeCount) > 0) {
        context.fillStyle = "#cdb8ff"; context.font = "800 11px system-ui"; context.textAlign = "left"; context.fillText("KAFKA CONSUME", box.x + 45, kafkaY);
        context.textAlign = "right"; canvasText(context, `${moscowTime(node.kafkaConsumeAt)} · ${Number(node.kafkaConsumeCount) || 0}`, box.x + box.width - 12, kafkaY, box.width - 154);
        context.textAlign = "left"; context.font = "10px monospace"; canvasText(context, `topic: ${node.kafkaConsumes?.[0]?.topic || "не определён"}`, box.x + 45, kafkaY + 24, box.width - 57);
      }
      return;
    }
    context.font = "700 11px system-ui"; context.fillStyle = "#43d9c7"; context.fillText("REQUEST", box.x + 45, box.y + 70); context.textAlign = "right"; canvasText(context, `${moscowTime(node.requestAt)} · ${Number(node.requestCount)||0}`, box.x + box.width - 12, box.y + 70, box.width - 128);
    let responseY = box.y + 90;
    const completedOnly = node.completedOperation && Number(node.requestCount) === 0;
    const firstTarget = node.requestTargets?.[0] || (completedOnly ? node.responseTargets?.[0] : null);
    if (firstTarget) {
      const firstRepeated = node.repeatedHttpTargets?.some((item) => item.url === firstTarget.url);
      roundedRect(context, box.x + 42, box.y + 78, box.width - 54, 38, 5); context.fillStyle = firstRepeated ? "rgba(251,146,60,.12)" : "rgba(96,165,250,.08)"; context.fill(); context.strokeStyle = firstRepeated ? "#fb923c" : "rgba(96,165,250,.28)"; context.lineWidth = 1; context.stroke();
      context.textAlign = "left"; context.fillStyle = "#93c5fd"; context.font = "800 10px monospace"; context.fillText(completedOnly ? "URI" : firstTarget.method, box.x + 45, box.y + 91);
      context.fillStyle = "#cfe5f6"; context.font = "10px monospace"; canvasText(context, firstTarget.url, box.x + 45, box.y + 108, box.width - 57);
      responseY = box.y + 128;
    }
    if (repeatedTarget) {
      roundedRect(context, box.x + 45, responseY - 10, box.width - 57, 22, 5); context.fillStyle = "rgba(251,146,60,.14)"; context.fill(); context.strokeStyle = "rgba(251,146,60,.7)"; context.stroke();
      context.fillStyle = "#fdba74"; context.font = "800 9px monospace"; context.textAlign = "left"; canvasText(context, `ТРЕБУЕТ ПРОВЕРКИ · URL ×${repeatedTarget.count}`, box.x + 52, responseY + 4, box.width - 71);
      responseY += 28;
    }
    const responseStatus = completedOnly && /^\d{3}$/.test(String(firstTarget?.status || '')) ? `${firstTarget.status} · ` : '';
    context.fillStyle = hasFailedResponse ? "#ff7d86" : "#f6b84a"; context.font = "700 11px system-ui"; context.textAlign = "left"; context.fillText("RESPONSE", box.x + 45, responseY); context.textAlign = "right"; canvasText(context, `${responseStatus}${moscowTime(node.responseAt)} · ${Number(node.responseCount)||0}`, box.x + box.width - 12, responseY, box.width - 128);
    let responseDetailOffset = 0;
    if (hasFailedResponse) {
      roundedRect(context, box.x + 45, responseY + 10, box.width - 57, 22, 5); context.fillStyle = "rgba(240,98,109,.16)"; context.fill(); context.strokeStyle = "rgba(240,98,109,.75)"; context.stroke();
      context.fillStyle = "#ff9aa2"; context.font = "800 9px monospace"; context.textAlign = "left"; canvasText(context, `ЗАВЕРШИЛСЯ ОШИБКОЙ · LEVEL 3${Number(node.responseLevel3Count) > 1 ? ` ×${Number(node.responseLevel3Count)}` : ""}`, box.x + 52, responseY + 25, box.width - 71);
      responseDetailOffset = 28;
    }
    const executionDuration = globalThis.TraceLatency ? TraceLatency.duration(node) : node.responseDuration;
    const elapsed = durationLabel(executionDuration);
    if (elapsed) { context.strokeStyle = "rgba(143,177,197,.22)"; context.beginPath(); context.moveTo(box.x + 45, responseY + 12 + responseDetailOffset); context.lineTo(box.x + box.width - 12, responseY + 12 + responseDetailOffset); context.stroke(); context.textAlign = "left"; context.fillStyle = "#c7dce7"; context.font = "800 10px monospace"; context.fillText(`Запрос исполнился за: ${elapsed} мс`, box.x + 45, responseY + 30 + responseDetailOffset); }
    if (elapsed && globalThis.TraceLatency?.isSlow(executionDuration)) { context.fillStyle="#ffd17a"; context.font="800 10px monospace"; context.textAlign="left"; canvasText(context, "Медленное выполнение", box.x + 45, responseY + 49 + responseDetailOffset, box.width - 57); }
    const consumeHeight = Number(node.kafkaConsumeCount) > 0 ? 48 : 0;
    if (node.spanRecovery) {
      const lines = traceLabelLines(node.requestLabels);
      const top = box.y + box.height - 75 - (lines.length ? lines.length * 16 + 12 : 0) - consumeHeight;
      roundedRect(context, box.x + 45, top, box.width - 57, 65, 5); context.fillStyle = "#302619"; context.fill(); context.strokeStyle = "#bd873d"; context.stroke();
      context.fillStyle = "#ffce8b"; context.textAlign = "left"; context.font = "800 10px monospace";
      canvasText(context, node.spanRecovery.kind === 'uri-time-match' ? "ПАРА ПО URI И ВРЕМЕНИ" : "ПАРА ПО ВРЕМЕНИ И DURATION", box.x + 53, top + 16, box.width - 73);
      context.font = "10px monospace";
      canvasText(context, `RESPONSE spanId: ${(node.recoveredSpanIds || []).join(", ")}`, box.x + 53, top + 34, box.width - 73);
      canvasText(context, node.spanRecovery.kind === 'uri-time-match' ? "Совпали сервис, URI и время. Duration не указан." : "Совпали сервис, время и duration. Проверьте логирование.", box.x + 53, top + 52, box.width - 73);
    }
    const labelLines = traceLabelLines(node.requestLabels);
    if (consumeHeight) {
      const top = box.y + box.height - (labelLines.length ? labelLines.length * 16 + 12 : 0) - 40;
      context.fillStyle = "#cdb8ff"; context.font = "800 10px system-ui"; context.textAlign = "left"; context.fillText("KAFKA CONSUME", box.x + 45, top);
      context.textAlign = "right"; canvasText(context, `${moscowTime(node.kafkaConsumeAt)} · ${Number(node.kafkaConsumeCount) || 0}`, box.x + box.width - 12, top, box.width - 154);
      context.textAlign = "left"; context.font = "10px monospace"; canvasText(context, `topic: ${node.kafkaConsumes?.[0]?.topic || "не определён"}`, box.x + 45, top + 20, box.width - 57);
    }
    context.fillStyle = "#bad8ee"; context.textAlign = "left"; context.font = "10px monospace";
    labelLines.forEach((line, index) => canvasText(context, line, box.x + 45, box.y + box.height - labelLines.length * 16 + index * 16, box.width - 57));
  });
  for (let subcall of subcalls) {
    if(subcall.foldHidden)continue;
    if(globalThis.paintTraceCallGroup?.(context,subcall))continue;
    if(subcall.foldGroup)subcall={...subcall,y:subcall.y+62,height:subcall.height-62};
    if (subcall.assumption) {
      roundedRect(context,subcall.x,subcall.y,subcall.width,subcall.height,7);
      context.fillStyle="#2b2418"; context.fill(); context.strokeStyle="#d6a85f"; context.lineWidth=1.5; context.stroke();
      context.textAlign="center"; context.fillStyle="#ffd58f"; context.font="800 11px monospace";
      canvasText(context,"ПРЕДПОЛОЖЕНИЕ",subcall.x+subcall.width/2,subcall.y+28,subcall.width-24);
      context.fillStyle="#ead8b9"; context.font="10px monospace";
      canvasText(context,"Дальнейшее действие не найдено · возможно БД или кеш",subcall.x+subcall.width/2,subcall.y+57,subcall.width-24);
      continue;
    }
    if (subcall.diagnostic) {
      roundedRect(context,subcall.x,subcall.y,subcall.width,subcall.height,7);
      context.fillStyle="#271d28"; context.fill(); context.strokeStyle="#b77488"; context.stroke();
      context.textAlign="center"; context.fillStyle="#ffb4c4"; context.font="800 12px monospace";
      canvasText(context,`${subcall.label} · level 3 ×${subcall.detail.eventCount}`,subcall.x+subcall.width/2,subcall.y+23,subcall.width-24);
      context.textAlign="left"; context.fillStyle="#d8c8ce"; context.font="10px monospace";
      traceDiagnosticLines(subcall.detail).forEach((line,index)=>canvasText(context,line,subcall.x+12,subcall.y+46+index*17,subcall.width-24));
      continue;
    }
    const overLimit = Boolean(subcall.overLimit);
    const status = traceSubcallStatus(subcall);
    roundedRect(context, subcall.x, subcall.y, subcall.width, subcall.height, 7); context.fillStyle = subcall.clientFailure ? "#2b1921" : overLimit ? "#342215" : subcall.cacheWrite ? "#1c2b15" : subcall.cacheChain ? "#0c2432" : subcall.kafkaProduce ? "#17152c" : subcall.xmlProcedure ? "#102b31" : "#0d2330"; context.fill(); context.strokeStyle = subcall.responseLevel3 || subcall.clientFailure ? "#f0626d" : overLimit ? "#fb923c" : subcall.cacheWrite ? "#a3e635" : subcall.cacheChain ? "#38bdf8" : subcall.kafkaProduce ? "#8b6ac7" : subcall.xmlProcedure ? "#2aa7a1" : "#237a78"; context.stroke();
    if (status && statusImages[status]) context.drawImage(statusImages[status], subcall.x + subcall.width - 11, subcall.y - 11, 26, 26);
    const center = subcall.x + subcall.width / 2;
    let contentY = subcall.y + 19;
    if (!(subcall.clientFailure && !subcall.requestObserved)) {
      const order = subcall.stepNumber == null ? '—' : String(subcall.stepNumber);
      context.font = "800 9px system-ui";
      const orderWidth = Math.max(31, context.measureText(order).width + 8);
      roundedRect(context, subcall.x + 8, subcall.y + 7, orderWidth, 25, 5); context.fillStyle = "#132f40"; context.fill(); context.strokeStyle = "#5c879e"; context.stroke();
      context.fillStyle = "#fff"; context.textAlign = "center"; context.fillText(order, subcall.x + 8 + orderWidth / 2, subcall.y + 23);
    }
    context.textAlign = "center"; context.fillStyle = overLimit ? "#fdba74" : "#e8f1f6"; context.font = "800 11px monospace"; canvasText(context, `${overLimit ? "ВЫШЕ НОРМЫ · " : ""}${subcall.label}`, center, contentY, subcall.width - 92);
    if (subcall.kafkaProduce && statusImages.kafka) context.drawImage(statusImages.kafka, subcall.x + 44, subcall.y + 10, 18, 18);
    if (subcall.cacheChain) {
      contentY += 29;
      const hopY = contentY - 12;
      roundedRect(context, subcall.x + 14, hopY, 126, 28, 6); context.fillStyle = "rgba(56,189,248,.12)"; context.fill(); context.strokeStyle = "#38bdf8"; context.stroke();
      roundedRect(context, subcall.x + subcall.width - 116, hopY, 102, 28, 6); context.fillStyle = "rgba(239,68,68,.11)"; context.fill(); context.strokeStyle = "#f87171"; context.stroke();
      if (statusImages.cache) {
        context.drawImage(statusImages.cache, subcall.x + 20, hopY + 4, 20, 20);
        context.drawImage(statusImages.cache, subcall.x + subcall.width - 110, hopY + 4, 20, 20);
      }
      context.textAlign = "center"; context.fillStyle = "#bae6fd"; context.font = "800 9px monospace"; context.fillText("LOCAL CACHE", subcall.x + 88, hopY + 18);
      context.fillStyle = "#7dd3fc"; context.font = "800 14px system-ui"; context.fillText("→", subcall.x + subcall.width / 2, hopY + 19);
      context.fillStyle = "#fecaca"; context.font = "800 9px monospace"; context.fillText("REDIS", subcall.x + subcall.width - 53, hopY + 18);
      context.textAlign = "center"; context.font = "10px monospace"; context.fillStyle = "#b3cad6";
      canvasText(context, `Сервис: ${nodes[subcall.parentIndex].service}`, center, subcall.y + 78, subcall.width - 24);
      context.fillStyle = "#e1f4fc";
      canvasText(context, `Ключ: ${subcall.detail?.safeKey || "не указан"}`, center, subcall.y + 96, subcall.width - 24);
      continue;
    }
    if (subcall.xmlProcedure && subcall.detail?.procedure) {
      contentY += 22; context.textAlign="left"; context.font="800 9px monospace"; context.fillStyle="#73e2d8";
      canvasText(context,`Процедура: ${subcall.detail.procedure}`,subcall.x+8,contentY,subcall.width-16);
    } else if (!subcall.oneWay && subcall.detail?.url) {
      contentY += 22; context.textAlign = "left"; context.font = "800 9px monospace"; context.fillStyle = "#93c5fd";
      canvasText(context, `${subcall.detail.method || "HTTP"} ${subcall.detail.url}`, subcall.x + 8, contentY, subcall.width - 16);
    }
    if (subcall.clientFailure) {
      context.textAlign="center"; context.fillStyle="#ff9aa2"; context.font="800 10px monospace";
      canvasText(context,"Сбой WebClient · HTTP-ответ не получен",center,subcall.y+66,subcall.width-16);
      context.fillStyle="#d9b9be"; context.font="9px monospace";
      canvasText(context,subcall.requestObserved ? "REQUEST сопоставлен по service + span + метод + URI" : "REQUEST не сопоставлен",center,subcall.y+84,subcall.width-16);
      canvasText(context,`${subcall.clientFailure.service} · span: ${subcall.clientFailure.spanId}${subcall.parentIndex === null ? " · связь не определена" : ""}`,center,subcall.y+102,subcall.width-16);
      continue;
    }
    contentY += 20;
    const hasResponse = (subcall.responseObserved ?? (subcall.subIndex < subcall.responseTotal)); context.textAlign = "center"; context.fillStyle = subcall.responseLevel3 ? "#ff9aa2" : subcall.kafkaProduce ? "#cdb8ff" : hasResponse ? "#f6b84a" : "#7895a6"; context.font = "800 9px monospace";
    canvasText(context, subcall.kafkaProduce ? `topic: ${subcall.detail?.topic || "не определён"}` : hasResponse ? `${subcall.label} RESPONSE${subcall.responseLevel3 ? " · LEVEL 3" : " ✓"}${subcall.requestObserved === false ? " · БЕЗ ПАРЫ" : ""}` : `${subcall.label} RESPONSE —`, center, contentY, subcall.width - 16);
    const elapsed = durationLabel(subcall.responseDuration);
    if (elapsed) { contentY += 17; context.fillStyle = "#c7dce7"; canvasText(context, `duration: ${elapsed} мс`, center, contentY, subcall.width - 16); contentY += 22; if (globalThis.TraceLatency?.isSlow(subcall.responseDuration)) { context.fillStyle="#ffd17a"; canvasText(context, "Медленное выполнение", center, contentY, subcall.width - 16); } }
    const labelLines = traceLabelLines(subcall.labels);
    context.fillStyle = "#bad8ee"; context.font = "10px monospace";
    labelLines.forEach((line, index) => canvasText(context, line, center, subcall.y + subcall.height - labelLines.length * 16 + index * 16, subcall.width - 16));
  }
  for (const endpoint of kafkaEndpoints) {
    roundedRect(context, endpoint.x, endpoint.y, endpoint.width, endpoint.height, 9); context.fillStyle = "#17152c"; context.fill(); context.strokeStyle = "#8b6ac7"; context.lineWidth = 1.5; context.stroke();
    const center = endpoint.x + endpoint.width / 2;
    if (statusImages.kafka) context.drawImage(statusImages.kafka, endpoint.x + 8, endpoint.y + 7, 18, 18);
    context.textAlign = "center"; context.fillStyle = "#c4b5fd"; context.font = "800 11px monospace"; context.fillText(endpoint.brokerObservation ? "KAFKA INFRA" : "KAFKA BROKER", center, endpoint.y + 21);
    context.fillStyle = "#e0d5ff"; context.font = "9px monospace"; canvasText(context, `topic: ${endpoint.topic}`, center, endpoint.y + 41, endpoint.width - 20);
    if (endpoint.brokerObservation) { context.fillStyle="#b9a7e6"; canvasText(context,`Сообщений: ${endpoint.eventCount}`,center,endpoint.y+58,endpoint.width-20); }
  }
  context.restore();
}

async function downloadTracePng() {
  if (!traceStage || tracePage.download.disabled) return;
  const finishCompanion = globalThis.Clippy?.begin?.("export");
  let companionOutcome = "error";
  tracePage.download.disabled = true;
  tracePage.downloadStatus.textContent = "Готовлю изображение…";
  let pngUrl = "";
  try {
    const padding = 28;
    const naturalWidth = traceNaturalWidth + padding * 2;
    const naturalHeight = traceNaturalHeight + padding * 2;
    const pixelLimit = 50_000_000;
    const exportScale = Math.min(2, 12000 / naturalWidth, 12000 / naturalHeight, Math.sqrt(pixelLimit / (naturalWidth * naturalHeight)));
    const pixelWidth = Math.max(1, Math.floor(naturalWidth * exportScale));
    const pixelHeight = Math.max(1, Math.floor(naturalHeight * exportScale));
    const canvas = document.createElement("canvas"); canvas.width = pixelWidth; canvas.height = pixelHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas недоступен");
    context.scale(exportScale, exportScale); context.fillStyle = "#06111a"; context.fillRect(0, 0, naturalWidth, naturalHeight);
    const statusImages = await loadTraceStatusImages();
    paintTracePng(context, traceExportModel, padding, statusImages);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Не удалось сформировать PNG");
    pngUrl = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = pngUrl; link.download = exportFileName(); link.click();
    companionOutcome = "exported";
    tracePage.downloadStatus.textContent = `${pixelWidth} × ${pixelHeight}px · вся схема`;
  } catch (error) {
    tracePage.downloadStatus.textContent = error?.message || String(error);
  } finally {
    if (pngUrl) setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
    tracePage.download.disabled = false;
    finishCompanion?.(companionOutcome);
  }
}

function openTraceUml() {
  if (!traceUmlDiagram || !tracePage.umlDialog || !tracePage.umlCanvas || !globalThis.TraceUml) return;
  try {
    const model = TraceUml.build(traceUmlDiagram);
    TraceUml.render(tracePage.umlCanvas, model);
    if (tracePage.umlMeta) {
      const parts = [`${model.participants.length} участников`, `${model.events.length} событий`];
      if (model.truncated) {
        const t = model.truncation || {};
        const hidden = [];
        if (t.nodesOmitted) hidden.push(`${t.nodesOmitted} узлов`);
        if (t.eventsOmitted) hidden.push(`${t.eventsOmitted} событий`);
        if (t.participantsOmitted) hidden.push(`${t.participantsOmitted} сервисов`);
        parts.push(hidden.length ? `скрыто: ${hidden.join(", ")}` : t.upstream ? "часть сообщений не загружена" : "показана безопасная сокращённая версия");
      }
      tracePage.umlMeta.textContent = parts.join(" · ");
    }
    tracePage.umlDialog.showModal();
    tracePage.umlCanvas.scrollTo({ left:0, top:0, behavior:"instant" });
  } catch (error) {
    if (tracePage.umlMeta) tracePage.umlMeta.textContent = error?.message || "Не удалось построить UML";
  }
}

tracePage.flowToggle?.addEventListener("click", toggleTraceFlow);
tracePage.flowPlay?.addEventListener("click", toggleTracePlayback);
tracePage.flowSpeed?.addEventListener("click", cycleTracePlaybackSpeed);
tracePage.flowStop?.addEventListener("click", () => cancelTracePlayback(true, "idle"));
traceMotionPreference?.addEventListener?.("change", syncTraceMotionPreference);
applyTraceFlowControls();
applyTracePlaybackControls();
tracePage.zoomIn.addEventListener("click", () => setTraceScale(traceScale * 1.2));
tracePage.zoomOut.addEventListener("click", () => setTraceScale(traceScale / 1.2));
tracePage.zoomStart?.addEventListener("click", readableTrace);
tracePage.zoomFit.addEventListener("click", fitTrace);
tracePage.zoomReset.addEventListener("click", () => setTraceScale(1));
tracePage.resetLayout.addEventListener("click", resetTraceLayout);
tracePage.umlButton?.addEventListener("click", openTraceUml);
tracePage.download.addEventListener("click", downloadTracePng);
tracePage.localSearch?.addEventListener("input", scheduleTraceLocalFilter);
tracePage.localMode?.addEventListener("change", applyTraceLocalFilter);
tracePage.filterReset?.addEventListener("click", resetTraceLocalFilter);
tracePage.streamSelect?.addEventListener("change", (event) => setTraceStreamScope(event.target.value));
tracePage.streamHelp?.addEventListener("click", () => explainTraceStreamScope({repeat:true}));
tracePage.assumptionToggle?.addEventListener("click", toggleTraceAssumptions);
for (const disclosure of document.querySelectorAll(".trace-more-controls,.trace-filter-disclosure")) disclosure.addEventListener("toggle", () => {
  if (disclosure.open) globalThis.Clippy?.dismissGuide?.();
});
document.addEventListener("pointerdown", (event) => {
  for (const details of document.querySelectorAll(".trace-more-controls[open],.trace-filter-disclosure[open]")) {
    if (!details.contains(event.target)) details.removeAttribute("open");
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const opened = [...document.querySelectorAll(".trace-more-controls[open],.trace-filter-disclosure[open]")];
  if (!opened.length) return;
  for (const details of opened) details.removeAttribute("open");
  opened.at(-1)?.querySelector("summary")?.focus({preventScroll:true});
});
tracePage.minimapCanvas?.addEventListener("pointerdown", beginTraceMinimapDrag);
tracePage.minimapCanvas?.addEventListener("keydown", handleTraceMinimapKeydown);
tracePage.canvas.addEventListener("scroll", scheduleTraceMinimapUpdate, { passive:true });
tracePage.canvas.addEventListener("scroll",()=>globalThis.TracePlaybackContextView?.updateSourceVisibility?.(),{passive:true});
window.addEventListener("pointermove", moveTraceBranch, { passive:false });
window.addEventListener("pointermove", moveTracePan, { passive:false });
window.addEventListener("pointermove", moveTraceMinimapDrag, { passive:false });
window.addEventListener("pointerup", finishBranchDrag);
window.addEventListener("pointercancel", finishBranchDrag);
window.addEventListener("pointerup", finishTracePan);
window.addEventListener("pointercancel", finishTracePan);
window.addEventListener("pointerup", finishTraceMinimapDrag);
window.addEventListener("pointercancel", finishTraceMinimapDrag);
tracePage.canvas.addEventListener("pointerdown", beginTracePan);
tracePage.canvas.addEventListener("keydown", handleTraceViewportKey);
tracePage.canvas.addEventListener("wheel", (event) => {
  if (!(event.ctrlKey || event.metaKey) || !traceStage) return;
  event.preventDefault();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? tracePage.canvas.clientHeight : 1);
  zoomTraceAt(traceScale * Math.exp(-Math.max(-300, Math.min(300, delta)) * .002), event.clientX, event.clientY);
}, { passive:false });
window.addEventListener("resize", () => {
  if (!traceStage) return;
  if (traceScaleMode === "fit") fitTrace();
  else applyScale(true);
});

const liveTraceToken = new URL(location.href).searchParams.get("token") || "";
function acceptTraceDiagram(diagram) {
  if (!traceFullDiagram || traceFullDiagram.query !== diagram.query) {traceAssumptionMode = true;traceExpandedCallGroups.clear();}
  traceFullDiagram = diagram;
  updateTraceQueryText(diagram, diagram);
  syncTraceStreamControls(diagram, diagram);
  tracePage.error.hidden = true;
  if (!diagram.nodes?.length && !diagram.outgoingFailures?.length) {
    if (tracePage.flowPlay) tracePage.flowPlay.disabled = true;
    if (!diagram.loadingMore || diagram.loadError) {
      tracePage.error.textContent = diagram.loadError || "В загруженных сообщениях пока нет данных для схемы вызовов.";
      tracePage.error.hidden = false;
    }
    return;
  }
  renderTraceStreamScope(Boolean(traceInteractionModel));
  scheduleTraceStreamScopeGuide();
  if (tracePage.flowPlay) tracePage.flowPlay.disabled = Boolean(diagram.loadingMore);
}
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "store-trace-diagram" || message.token !== liveTraceToken
    || sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL("extension/"))) return;
  if (Array.isArray(message.diagram?.nodes) && message.diagram.nodes.length <= 200) acceptTraceDiagram(message.diagram);
});
(async () => {
  try {
    const token = liveTraceToken;
    const response = await chrome.runtime.sendMessage({ type:"take-trace-diagram", token });
    if (!response?.diagram) throw new Error("Данные дерева устарели или уже были открыты. Постройте схему повторно.");
    acceptTraceDiagram(response.diagram);
  } catch (error) { tracePage.error.textContent = error?.message || String(error); tracePage.error.hidden = false; tracePage.query.textContent = "Не удалось открыть дерево"; }
})();
