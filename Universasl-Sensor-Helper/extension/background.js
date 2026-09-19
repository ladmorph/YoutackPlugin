// `importScripts` exists in the MV3 service worker. The guard keeps the module
// executable in the small VM harness used by the regression tests.
if (typeof importScripts === "function") importScripts("graylog/streams.js", "../lib/graylog/business-error-rules.js", "../lib/graylog/graylog-constants.js", "../lib/graylog/analyzer.js", "youtrack/youtrack-background.js");

// streams.js is imported synchronously above, before anything else in this
// file runs, so GraylogStreams is always the single source of these IDs -
// no local fallback copy to keep in sync.

function isTestGraylogUrl(value) {
  try {
    if (typeof globalThis.GraylogStreams?.isTestHost === "function") return globalThis.GraylogStreams.isTestHost(value);
    return new URL(value).hostname.toLowerCase().includes("test");
  } catch { return false; }
}

function environmentStreamsForUrl(value) {
  if (isTestGraylogUrl(value)) return [...(globalThis.GraylogStreams.TEST_GRAYLOG_STREAMS || [])];
  return [...(globalThis.GraylogStreams.DEFAULT_GRAYLOG_STREAMS || [])];
}

let checkerTabId = null;
let graylogTabId = null;
const transientTraceDiagrams = new Map();
const TRACE_DIAGRAM_TTL_MS = 5 * 60 * 1000;
const TRACE_DIAGRAM_LIMIT = 8;
// Preview work is independent of Graylog's own search. Keep one running
// operation and only the latest queued context per source tab.
const previewWorkByTab = new Map();
const explicitOperationBySourceTab = new Map();
const explicitOperationPortByCheckerTab = new Map();
const previewOperationLog = [];
let previewOperationSequence = 0;
const PREVIEW_WAITERS_LIMIT = 32;
const previewCancelled = () => ({ ok:false, cancelled:true, error:"Разбор отменён: контекст изменился или панель закрыта." });
async function abortExplicitOperation(sourceTabId, operation, notifyTools = true) {
  if (!Number.isInteger(sourceTabId) || !operation || explicitOperationBySourceTab.get(sourceTabId)?.operationId !== operation.operationId) return false;
  let transportCancelled=false;
  try {
    const result=await chrome.scripting?.executeScript?.({target:{tabId:sourceTabId},world:"MAIN",func:runId=>globalThis.GraylogTraceFetch?.cancelExplicitTraceRunInGraylog?.(runId)===true,args:[operation.operationId]});
    transportCancelled=result?.[0]?.result===true;
  } catch {}
  if(notifyTools){
    try { operation.port?.postMessage?.({type:"cancel-explicit-operation",operationId:operation.operationId,sourceTabId}); }
    catch {}
  }
  explicitOperationBySourceTab.delete(sourceTabId);
  try { await chrome.tabs.sendMessage(sourceTabId,{type:"graylog-explicit-operation-state",operationId:operation.operationId,kind:operation.kind,active:false}); } catch {}
  return transportCancelled;
}
function previewReply(waiter, value) { try { waiter.respond(value); } catch {} }
function settlePreview(job, value) { for(const waiter of job.waiters.splice(0))previewReply(waiter,value); }
function recordPreview(job) {
  const record={id:++previewOperationSequence,area:"Компактный разбор",status:"queued",startedAt:Date.now(),waitMs:null,elapsedMs:null,joined:0};
  previewOperationLog.unshift(record);if(previewOperationLog.length>200)previewOperationLog.length=200;
  job.record=record;
}
function discardPendingPreview(state) {
  if(!state.pending)return;
  state.pending.record.status="cancelled";
  settlePreview(state.pending,previewCancelled());state.pending=null;
}
function previewContextKey(sourceTab, traceId, bounds) {
  const url=new URL(sourceTab.url);
  // Relative searches use the selected interval, not the moving Date.now()
  // bounds, so double clicks join the same in-flight query.
  return JSON.stringify([url.origin,url.pathname,traceId,...["rangetype","relative","from","to"].map(key=>url.searchParams.get(key)),bounds.streamIds]);
}
async function runPreviewWork(state, job) {
  state.active=job;job.record.status="pending";job.record.waitMs=Date.now()-job.record.startedAt;
  const started=Date.now();
  try {
    // Preserve the user gesture for a genuinely missing host grant.
    await requestGraylogAccess(job.sourceTab);
    if(typeof chrome.tabs.get==="function"){
      const current=await chrome.tabs.get(job.sourceTab.id);
      const expected=new URL(job.sourceTab.url),actual=new URL(current.url);
      if(actual.origin!==expected.origin||!/(?:^|\/)search(?:\/|$)/i.test(actual.pathname))throw new Error("Вкладка Graylog изменилась. Откройте разбор заново.");
    }
    if(state.closed||!job.waiters.length){job.record.status="cancelled";return;}
    await chrome.scripting.executeScript({
      target:{tabId:job.sourceTab.id},world:"MAIN",
      files:["lib/graylog/exception-chain.js","lib/graylog/trace-heuristic-resolver.js","lib/graylog/trace-observability.js","extension/graylog/graylog-rendered-messages.js","lib/graylog/error-analysis.js","lib/graylog/business-error-rules.js","lib/graylog/trace-error-catalog.js","lib/graylog/java-error-reference.js","lib/graylog/integration-error-reference.js","lib/graylog/postgres-error-reference.js","lib/graylog/kafka-error-reference.js","lib/graylog/error-reference.js","lib/graylog/trace-error-timeline.js","lib/graylog/trace-errors.js","lib/graylog/trace-client-checkpoint.js","lib/graylog/trace-application-groups.js","lib/graylog/graylog-trace-fetch.js","lib/graylog/trace-latency.js","lib/graylog/trace-analysis.js"]
    });
    if(state.closed||!job.waiters.length){job.record.status="cancelled";return;}
    const execution=await chrome.scripting.executeScript({target:{tabId:job.sourceTab.id},world:"MAIN",func:buildGraylogTracePreview,args:[`traceId:"${job.traceId}"`,job.bounds.startMs,job.bounds.endMs,job.bounds.streamIds]});
    if(execution?.[0]?.error)throw new Error(execution[0].error.message||"Не удалось выполнить разбор.");
    const result=execution?.[0]?.result;
    job.record.status=result?.error?"error":"success";
    settlePreview(job,result?.error?{ok:false,error:result.error}:{ok:true,preview:result});
  } catch(error) {
    job.record.status="error";settlePreview(job,{ok:false,error:error?.message||"Не удалось построить компактную схему в Graylog."});
  } finally {
    job.record.elapsedMs=Date.now()-started;
    if(state.closed){job.record.status="cancelled";return;}
    state.active=null;
    const next=state.pending;state.pending=null;
    if(next)void runPreviewWork(state,next);
    else if(previewWorkByTab.get(job.sourceTab.id)===state)previewWorkByTab.delete(job.sourceTab.id);
  }
}
function enqueuePreview(sourceTab, traceId, bounds, requestId, respond) {
  let state=previewWorkByTab.get(sourceTab.id);
  if(!state){state={active:null,pending:null,closed:false};previewWorkByTab.set(sourceTab.id,state);}
  const key=previewContextKey(sourceTab,traceId,bounds),waiter={requestId,respond};
  const matching=state.active?.key===key?state.active:state.pending?.key===key?state.pending:null;
  if(matching){
    if(matching===state.active)discardPendingPreview(state);
    if(matching.waiters.length>=PREVIEW_WAITERS_LIMIT){previewReply(waiter,{ok:false,cancelled:true,error:"Разбор уже выполняется. Дождитесь результата."});return;}
    matching.waiters.push(waiter);matching.record.joined++;return;
  }
  const job={key,sourceTab,traceId,bounds,waiters:[waiter]};recordPreview(job);
  if(state.active){discardPendingPreview(state);state.pending=job;return;}
  void runPreviewWork(state,job);
}
function cancelPreviewWaiter(tabId, requestId) {
  const state=previewWorkByTab.get(tabId);if(!state)return false;
  let cancelled=false;
  for(const job of [state.active,state.pending]){
    if(!job)continue;
    const removed=job.waiters.filter(waiter=>waiter.requestId===requestId);
    job.waiters=job.waiters.filter(waiter=>waiter.requestId!==requestId);
    for(const waiter of removed){cancelled=true;previewReply(waiter,previewCancelled());}
  }
  if(state.pending&&!state.pending.waiters.length){state.pending.record.status="cancelled";state.pending=null;}
  // The active transport retains its slot until it settles. Closing a panel
  // must not make the next query overlap an un-aborted request in Graylog.
  return cancelled;
}

function graylogSenderTab(sender, sourceUrl) {
  const tab = sender?.tab;
  let url;
  try { url = new URL(sender.url || tab?.url || ""); } catch { return null; }
  if (!tab?.id || (sender.frameId !== undefined && sender.frameId !== 0)
    || !/^https?:$/.test(url.protocol) || !/(?:^|\/)search(?:\/|$)/i.test(url.pathname)) return null;
  // sender.url can describe the original SPA document. The isolated overlay
  // supplies its current location, bounded to the authenticated sender origin.
  if (sourceUrl !== undefined) {
    let current;
    try { current = new URL(sourceUrl); } catch { return null; }
    if (current.origin !== url.origin || current.username || current.password
      || !/(?:^|\/)search(?:\/|$)/i.test(current.pathname)) return null;
    url = current;
  }
  return { ...tab, url: url.href };
}

function requestGraylogAccess(tab) {
  // A toolbar click may already have granted temporary activeTab access. Test
  // that capability without reading page data or converting it to a permanent
  // host grant. Static content-script matches alone do not allow executeScript.
  const url = new URL(tab.url);
  const origin = `${url.protocol}//${url.hostname}/*`;
  if (!chrome.permissions?.request) return Promise.resolve();
  const request = () => chrome.permissions.request({ origins: [origin] }).then(granted => {
    if (!granted) throw new Error("Разрешите доступ к этому Graylog, чтобы открыть анализ через Сенсора. Можно также нажать значок расширения в браузере.");
  });
  return new Promise((resolve, reject) => {
    // Keep Chrome's API callback here: awaiting the probe loses the initiating
    // user gesture, so a genuinely missing host grant could no longer be requested.
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => true }, () => {
      const error = chrome.runtime.lastError;
      if (!error) { resolve(); return; }
      if (!/Cannot access contents of (?:url|the page)|Missing host permission|Cannot access page/i.test(String(error.message))) {
        reject(new Error(error.message));
        return;
      }
      request().then(resolve, reject);
    });
  });
}

function tracePreviewBounds(tabUrl) {
  const url = new URL(tabUrl);
  const now = Date.now();
  const rangeType = String(url.searchParams.get("rangetype") || "").toLowerCase();
  const useAbsolute = rangeType === "absolute" || (!rangeType && url.searchParams.has("from") && url.searchParams.has("to"));
  const parsedEnd = useAbsolute && url.searchParams.get("to") ? Date.parse(url.searchParams.get("to")) : NaN;
  const endMs = Number.isFinite(parsedEnd) ? Math.min(parsedEnd, now + 60_000) : now;
  const parsedStart = useAbsolute && url.searchParams.get("from") ? Date.parse(url.searchParams.get("from")) : NaN;
  const relativeSeconds = Math.max(60, Math.min(7 * 86400, Number(url.searchParams.get("relative")) || 300));
  const lowerBound = endMs - 7 * 86400 * 1000;
  const startMs = Number.isFinite(parsedStart) && parsedStart < endMs
    ? Math.max(parsedStart, lowerBound)
    : endMs - relativeSeconds * 1000;
  const fromQuery = [...new Set((url.searchParams.get("streams") || "").split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-f0-9]{24}$/.test(value)))]
    .slice(0, 16);
  const routeStream = /\/streams\/([a-f0-9]{24})(?:\/|$)/i.exec(url.pathname)?.[1]?.toLowerCase();
  const configuredDefaults = globalThis.GraylogStreams?.DEFAULT_GRAYLOG_STREAMS;
  const testMode = typeof globalThis.GraylogStreams?.isTestHost === "function"
    ? globalThis.GraylogStreams.isTestHost(url.href)
    : url.hostname.toLowerCase().includes("test");
  const streamIds = testMode
    ? [...(globalThis.GraylogStreams.TEST_GRAYLOG_STREAMS || [])]
    : fromQuery.length
      ? fromQuery
      : routeStream
        ? [routeStream]
        : Array.isArray(configuredDefaults) && configuredDefaults.length
          ? configuredDefaults
          : globalThis.GraylogStreams.DEFAULT_GRAYLOG_STREAMS || [];
  return { startMs, endMs, streamIds: [...streamIds] };
}

function traceLaunchContext(tabUrl, nativeSnapshotExact = false) {
  const bounds = tracePreviewBounds(tabUrl);
  const url = new URL(tabUrl);
  const testMode = typeof globalThis.GraylogStreams?.isTestHost === "function"
    ? globalThis.GraylogStreams.isTestHost(url.href)
    : url.hostname.toLowerCase().includes("test");
  return {
    startMs: Math.round(bounds.startMs),
    endMs: Math.round(bounds.endMs),
    streamIds: testMode
      ? [...(globalThis.GraylogStreams.TEST_GRAYLOG_STREAMS || [])]
      : [...(globalThis.GraylogStreams.DEFAULT_GRAYLOG_STREAMS || [])],
    nativeSnapshotExact: false
  };
}

async function buildGraylogTracePreview(query, startMs, endMs, streamIds, snapshotOverride = null) {
  const match = /^traceId\s*:\s*(?:"([a-z0-9_-]{1,128})"|([a-z0-9_-]{1,128}))$/i.exec(String(query || "").trim());
  const traceId = match?.[1] || match?.[2];
  if (!traceId) throw new Error("Для схемы нужен точный traceId.");
  const reader = globalThis.__advancedGraylogRenderedMessages;
  if (!reader?.snapshotTrace) throw new Error("Не удалось прочитать текущую выдачу. Обновите страницу Graylog.");
  const snapshot = typeof snapshotOverride === "string"
    ? globalThis.GraylogPageCollector?.peek(snapshotOverride, traceId)
    : snapshotOverride || await reader.snapshotTrace(traceId);
  if (!snapshot) throw new Error("Собранные страницы устарели. Повторите сбор.");
  const result = await globalThis.GraylogTraceFetch.processPageTraceInGraylog(query, snapshot, globalThis.BusinessErrorRules?.list?.() || []);
  if (result?.error) throw new Error(result.error);
  const diagram = globalThis.TraceAnalysis.buildRequestResponseTrace(
    result?.requestPivot, result?.responsePivot,
    result?.openApiPivot, result?.openApiResponsePivot,
    result?.gorodClientPivot, result?.gorodClientResponsePivot,
    result?.kafkaProducePivot, result?.cacheAccessPivot, result?.outgoingFailurePivot, result?.kafkaConsumePivot, result?.kafkaBrokerPivot,
    result?.xmlProcedureRequestPivot, result?.xmlProcedureResponsePivot, result?.partnerBackendPivot, result?.partnerBackendResponsePivot
  );
  const configuredStreamIds = [...new Set((Array.isArray(streamIds) ? streamIds : [])
    .map(value => String(value || "").toLowerCase()).filter(value => /^[a-f0-9]{24}$/.test(value)))].slice(0, 32);
  Object.assign(diagram, { errorAnalysis: result?.errorAnalysis, timings: result?.timings, percentileContext: result?.percentileContext, loadedMessages: result?.returned, totalMessages: result?.total, truncated: Boolean(result?.truncated), contentTruncated:result?.contentTruncated===true, configuredStreamIds });
  if (snapshotOverride) globalThis.__advancedGraylogCollectedDiagram = { token: snapshotOverride, traceId, diagram };
  const boundedNumber = (value, maximum) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.min(numeric, maximum) : 0;
  };
  // Error evidence belongs to one precise service/span owner. Repeated service
  // calls and ambiguous recovered spans must never borrow each other's stack.
  const owners = new Map(), evidenceByNode = new Map();
  let unboundErrors = 0;
  (diagram.nodes || []).forEach((node, index) => {
    for (const span of new Set([node.spanId, ...(node.recoveredSpanIds || [])])) {
      if (!node.service || !span) continue;
      const key = JSON.stringify([node.service, span]);
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(index);
    }
  });
  for (const group of (Array.isArray(result?.errorAnalysis?.groups) ? result.errorAnalysis.groups : [])) {
    const matches = group.service && group.spanId ? owners.get(JSON.stringify([group.service, group.spanId])) : null;
    if (matches?.size !== 1) { unboundErrors += boundedNumber(group.count, 1_000_000); continue; }
    const owner = [...matches][0], list = evidenceByNode.get(owner) || [];
    evidenceByNode.set(owner, list);
    for (const item of (Array.isArray(group.evidence) ? group.evidence : []).slice(0, 8)) {
      const navigationKey=/^nv1_[a-f0-9]{16}$/.test(item?.navigationKey||'')?item.navigationKey:null;
      const eventKey=/^ev1_[a-f0-9]{16}$/.test(item?.eventKey||'')?item.eventKey:null;
      if (list.length >= 8 || (!navigationKey&&!eventKey)
        || list.some(previous => navigationKey ? previous.navigationKey===navigationKey : !previous.navigationKey&&previous.eventKey===eventKey)) continue;
      const sourceField = ["full_message","message","stack_trace","stacktrace","stackTrace","exception_stack_trace","exception_stacktrace","exceptionStackTrace"].includes(item.sourceField) ? item.sourceField : null;
      const stack = item.stack;
      const text = (value, max) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "";
      list.push({ eventKey, navigationKey, messageField:"message", sourceField, stack:sourceField && stack ? {
        kind:["assembly","original","stack","checkpoint"].includes(stack.kind) ? stack.kind : "stack",
        method:text(stack.method, 240), file:text(stack.file, 120),
        line:Number.isSafeInteger(stack.line) && stack.line > 0 && stack.line <= 9999999 ? stack.line : null,
        exceptionType:text(stack.exceptionType, 160),
        ...(['exception-stack','enclosing-exception','reactor-assembly','original-stack'].includes(stack.role)?{role:stack.role}:{}),
        ...(typeof stack.causeExceptionType==='string'&&/^[\w$]{1,160}$/.test(stack.causeExceptionType)?{causeExceptionType:stack.causeExceptionType}:{}),
        ...(stack.partial === true ? {partial:true} : {})
      } : null });
    }
  }
  const nodes = (diagram.nodes || []).slice(0, 40).map((node, index) => {
    const measuredDuration = globalThis.TraceLatency?.duration?.(node);
    return {
      index,
      service: String(node.service || "service").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 128),
      jobNames: (node.jobNames || []).slice(0,8),
      depth: Math.floor(boundedNumber(node.depth, 6)),
      ...(['openapi-window','openapi-name-uri','openapi-gateway-window','partner-backend-window','partner-backend-name-uri','gateway-envelope','cross-service-response'].includes(node.parentInference) ? { parentInference:node.parentInference } : {}),
      reconstructedEntry: Boolean(node.reconstructedEntry),
      duplicateGatewayEntries: Math.floor(boundedNumber(node.absorbedGatewayDuplicates?.length, 20)),
      requestCount: Math.floor(boundedNumber(node.requestCount, 10_000)),
      responseCount: Math.floor(boundedNumber(node.responseCount, 10_000)),
      partnerBackendRequestCount: Math.floor(boundedNumber(node.partnerBackendRequestCount, 10_000)),
      partnerBackendResponseCount: Math.floor(boundedNumber(node.partnerBackendResponseCount, 10_000)),
      cacheCount: Math.floor(boundedNumber(node.cacheAccessCount, 10_000)),
      xmlProcedureName: String(node.xmlProcedureRequests?.[0]?.procedure || node.xmlProcedureResponseSamples?.[0]?.procedure || "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 128),
      kafkaCount: Math.floor(boundedNumber(node.kafkaProduceCount, 10_000) + boundedNumber(node.kafkaConsumeCount, 10_000) + boundedNumber(node.kafkaBrokerCount, 10_000)),
      kafkaProduceCount: Math.floor(boundedNumber(node.kafkaProduceCount, 10_000)),
      kafkaConsumeCount: Math.floor(boundedNumber(node.kafkaConsumeCount, 10_000)),
      kafkaBrokerCount: Math.floor(boundedNumber(node.kafkaBrokerCount, 10_000)),
      kafkaRoleHint: ['produce','consume'].includes(node.kafkaRoleHint)?node.kafkaRoleHint:null,
      durationMs: typeof measuredDuration === "number" && Number.isFinite(measuredDuration) && measuredDuration >= 0
        ? Math.min(measuredDuration, 7 * 86400 * 1000)
        : null,
      failed: Number(node.responseLevel3Count) > 0 || evidenceByNode.has(index),
      errorEvidence: evidenceByNode.get(index) || []
    };
  });
  const validIndexes = new Set(nodes.map((node) => node.index));
  const edges = (diagram.edges || []).filter((edge) => validIndexes.has(edge.from) && validIndexes.has(edge.to)).slice(0, 60).map((edge) => ({
    from:edge.from, to:edge.to, responseObserved:edge.responseObserved === true,
    reconstructedGatewayEntry:edge.reconstructedGatewayEntry === true,
    crossServiceResponse: Boolean(edge.crossServicePair)
  }));
  return {
    scope: "current-page",
    schedulerJobs: (diagram.schedulerJobs || []).slice(0,20),
    collected: Boolean(snapshotOverride),
    configuredStreamIds,
    nodes,
    edges,
    unboundErrors: Math.floor(Math.min(unboundErrors, 1_000_000_000)),
    // Povtory uzhe poscitany v diagramme (findRepeatedHttpTargets), poetomu
    // prosto peredayutsya dalshe: dopolnitelnyh zaprosov k Graylog net.
    repeatedHttpTargets: Math.floor(boundedNumber((diagram.repeatedHttpTargets || []).filter((item) => Number(item?.count) > 1).length, 10_000)),
    total: Math.floor(boundedNumber(result?.total, 1_000_000_000)),
    truncated: Boolean(result?.truncated || (diagram.nodes || []).length > nodes.length),
    contentTruncated:result?.contentTruncated===true,
    errorEvents: result?.errorAnalysis?.available === true
      ? Math.floor(boundedNumber(result.errorAnalysis.events, 1_000_000_000))
      : null,
    initUri: typeof result?.percentileContext?.initUri === "string" ? result.percentileContext.initUri.slice(0, 500) : "",
    // Tolko dlya pokaza: eto nablyudennye initUri gateway, bez dokazatelstva
    // edinstvennosti. Raschet protsentiley po nim ne razreshen.
    observedInitUris: (Array.isArray(result?.observedInitUris) ? result.observedInitUris : [])
      .filter((uri) => typeof uri === "string")
      .slice(0, 5)
      .map((uri) => uri.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500)),
    percentileContextStatus: "page-only"
  };
}

function pruneTraceDiagrams() {
  const cutoff = Date.now() - TRACE_DIAGRAM_TTL_MS;
  for (const [token, entry] of transientTraceDiagrams) if (entry.savedAt < cutoff) transientTraceDiagrams.delete(token);
  while (transientTraceDiagrams.size > TRACE_DIAGRAM_LIMIT) transientTraceDiagrams.delete(transientTraceDiagrams.keys().next().value);
}

function isTraceStorageSender(sender) {
  return sender?.id === chrome.runtime.id && Number.isInteger(sender?.tab?.id)
    && typeof sender?.url === "string" && sender.url.startsWith(chrome.runtime.getURL("extension/popup.html"));
}

function isTraceReceiver(sender, token, entry) {
  if (sender?.id !== chrome.runtime.id || !Number.isInteger(sender?.tab?.id)
    || sender.tab.openerTabId !== entry?.ownerTabId || typeof sender?.url !== "string") return false;
  try {
    const actual = new URL(sender.url), expected = new URL(chrome.runtime.getURL("extension/graylog/trace.html"));
    return actual.origin === expected.origin && actual.pathname === expected.pathname && actual.searchParams.get("token") === token;
  } catch { return false; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "set-business-error-rules") {
    if (!isTraceStorageSender(sender) || !globalThis.BusinessErrorRules) {
      sendResponse({ synced:false });
      return false;
    }
    try {
      globalThis.BusinessErrorRules.replace(message.rules);
      sendResponse({ synced:true, count:globalThis.BusinessErrorRules.list().length });
    } catch {
      sendResponse({ synced:false });
    }
    return false;
  }
  if (message?.type === "store-trace-diagram") {
    pruneTraceDiagrams();
    const token = String(message.token || "");
    const nodes = message.diagram?.nodes;
    if (!isTraceStorageSender(sender) || !/^[0-9a-f-]{30,50}$/i.test(token) || !Array.isArray(nodes) || nodes.length > 200) {
      sendResponse({ stored: false });
      return false;
    }
    transientTraceDiagrams.set(token, { diagram: message.diagram, savedAt: Date.now(), ownerTabId:sender.tab.id });
    pruneTraceDiagrams();
    sendResponse({ stored: true });
    return false;
  }
  if (message?.type === "open-recent-trace-url") {
    const sourceTab = graylogSenderTab(sender);
    let url;
    try { url = new URL(String(message.url || "")); } catch { url = null; }
    if (!sourceTab || !url || !/^https?:$/.test(url.protocol) || url.username || url.password) {
      sendResponse({ opened: false });
      return false;
    }
    chrome.tabs.create({ url: url.href, openerTabId: sourceTab.id })
      .then(() => sendResponse({ opened: true }))
      .catch(() => sendResponse({ opened: false }));
    return true;
  }
  if (message?.type === "take-trace-diagram") {
    pruneTraceDiagrams();
    const token = String(message.token || "");
    const entry = transientTraceDiagrams.get(token);
    if (!entry || !isTraceReceiver(sender, token, entry)) {
      sendResponse({ diagram:null });
      return false;
    }
    transientTraceDiagrams.delete(token);
    sendResponse({ diagram: entry.diagram });
    return false;
  }
  return false;
});

function checkerUrl(tabId, options = {}) {
  const target = new URL(chrome.runtime.getURL("extension/popup.html"));
  target.searchParams.set("tabId", String(tabId));
  if (["percentiles", "journal"].includes(options.view)) target.searchParams.set("view", options.view);
  if (/^[a-z0-9_-]{1,128}$/i.test(String(options.traceId || ""))) target.searchParams.set("traceId", String(options.traceId));
  if (options.autoPercentiles === true) target.searchParams.set("autoPercentiles", "1");
  const context = options.traceContext;
  if (Number.isFinite(context?.startMs) && Number.isFinite(context?.endMs) && context.startMs < context.endMs) {
    target.searchParams.set("startMs", String(Math.round(context.startMs)));
    target.searchParams.set("endMs", String(Math.round(context.endMs)));
    const streamIds = Array.isArray(context.streamIds) ? context.streamIds.filter((value) => /^[a-f0-9]{24}$/i.test(String(value))).slice(0, 16) : [];
    if (streamIds.length) target.searchParams.set("streams", streamIds.join(","));
    if (context.nativeSnapshotExact === true) target.searchParams.set("nativeSnapshot", "1");
  }
  return target.toString();
}

async function reconnectCheckerTab(checkerId, tabId, options = {}) {
  const checkerTab = await chrome.tabs.get(checkerId);
  if (!checkerTab?.id) throw new Error("Вкладка расширения недоступна");

  if (checkerTab.windowId !== undefined) await chrome.windows.update(checkerTab.windowId, { focused: true });
  await chrome.tabs.update(checkerTab.id, { active: true });
  try {
    const reply = await chrome.runtime.sendMessage({ type: "graylog-tab-changed", tabId, view: options.view, traceId: options.traceId, traceContext: options.traceContext, autoPercentiles: options.autoPercentiles === true });
    if (reply?.connected) return;
  } catch {
    // После перезагрузки расширения старая вкладка остаётся без JS-контекста.
  }
  await chrome.tabs.update(checkerTab.id, { url: checkerUrl(tabId, options) });
}

async function injectGraylogClippy(tab) {
  if (!tab?.id || !/^https?:/i.test(String(tab.url || ""))) return false;
  let target;
  try { target = new URL(tab.url); } catch { return false; }
  if (!/(?:^|\/)search(?:\/|$)/i.test(target.pathname) || !chrome.scripting?.executeScript) return false;
  await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",files:["extension/graylog/graylog-page.js"]});
  const probe = await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",func:()=>globalThis.GraylogPage?.isSupported?.(document,location)===true});
  if (!probe?.[0]?.result) return false;
  await chrome.scripting.executeScript({target:{tabId:tab.id},world:"MAIN",files:["lib/graylog/exception-chain.js","extension/graylog/graylog-rendered-messages.js"]});
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:["extension/graylog/graylog-page.js","extension/graylog/graylog-runtime.js","lib/graylog/graylog-overlay.js","lib/graylog/trace-error-catalog.js","lib/graylog/java-error-reference.js","lib/graylog/integration-error-reference.js","lib/graylog/postgres-error-reference.js","lib/graylog/kafka-error-reference.js","lib/graylog/error-reference.js","lib/graylog/trace-journal.js","extension/graylog/graylog-preview-panel.js","lib/graylog/exception-chain.js","extension/graylog/graylog-exception-highlights.js","extension/graylog/graylog-message-badges.js","extension/shared/sensor-mascot.js","extension/graylog/graylog-clippy.js","extension/graylog/graylog-preview-onboarding.js"]});
  return true;
}

async function openCheckerForTab(tab, options = {}) {
  if (!tab?.id) return;
  const ownPage = chrome.runtime.getURL("extension/popup.html");
  const extensionRoot = chrome.runtime.getURL("extension/");

  if (checkerTabId === null) {
    const windows = await chrome.windows.getAll({ populate: true });
    const existingTab = windows.flatMap((window) => window.tabs || []).find((item) => item.url?.startsWith(ownPage));
    if (existingTab?.id !== undefined) checkerTabId = existingTab.id;
  }

  if (tab.url?.startsWith(extensionRoot)) {
    if (checkerTabId !== null) {
      try {
        const checkerTab = await chrome.tabs.get(checkerTabId);
        if (checkerTab.windowId !== undefined) await chrome.windows.update(checkerTab.windowId, { focused: true });
        await chrome.tabs.update(checkerTab.id, { active: true });
      } catch {
        checkerTabId = null;
      }
    }
    return;
  }

  if(graylogTabId!==null&&graylogTabId!==tab.id){
    const previousOperation=explicitOperationBySourceTab.get(graylogTabId);
    if(previousOperation)await abortExplicitOperation(graylogTabId,previousOperation);
  }
  graylogTabId = tab.id;

  if (checkerTabId !== null) {
    try {
      await reconnectCheckerTab(checkerTabId, graylogTabId, options);
      return;
    } catch {
      checkerTabId = null;
    }
  }

  const checker = await chrome.tabs.create({
    url: checkerUrl(graylogTabId, options),
    active: true,
    ...(tab.windowId === undefined ? {} : { windowId: tab.windowId })
  });
  checkerTabId = checker.id ?? null;
}

chrome.action.onClicked.addListener((tab) => {
  if (globalThis.YouTrackBackground?.isTab(tab)) return YouTrackBackground.onAction(tab);
  return (async () => {
    try { await injectGraylogClippy(tab); } catch {}
    await openCheckerForTab(tab);
  })().catch(() => {});
});

chrome.runtime.onConnect?.addListener(port => {
  if(port?.name!=="graylog-explicit-operation"||port.sender?.id!==chrome.runtime.id
    ||!String(port.sender?.url||"").startsWith(chrome.runtime.getURL(""))||!Number.isInteger(port.sender?.tab?.id))return;
  const checkerId=port.sender.tab.id;
  explicitOperationPortByCheckerTab.set(checkerId,port);
  port.onDisconnect?.addListener?.(()=>{
    if(explicitOperationPortByCheckerTab.get(checkerId)===port)explicitOperationPortByCheckerTab.delete(checkerId);
    for(const [sourceTabId,operation] of explicitOperationBySourceTab){
      if(operation.checkerTabId===checkerId&&operation.port===port)abortExplicitOperation(sourceTabId,operation,false).catch(()=>{});
    }
  });
});

// Messages from the isolated overlay contain only navigation intent and a bounded traceId.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if(message?.type==="set-graylog-explicit-operation"){
    const sourceTabId=Number(message.sourceTabId),operationId=String(message.operationId||""),kind=message.kind;
    const internalSender=sender?.id===chrome.runtime.id&&String(sender?.url||"").startsWith(chrome.runtime.getURL(""));
    if(!internalSender||!Number.isInteger(sourceTabId)||sourceTabId<0||sourceTabId!==graylogTabId
      ||!/^[a-z0-9_-]{1,128}$/i.test(operationId)||!["full-graph","extension-query"].includes(kind)){
      sendResponse({accepted:false});return false;
    }
    chrome.tabs.get(sourceTabId).then(tab=>{
      const url=new URL(tab.url);if(!/^https?:$/.test(url.protocol)||!/(?:^|\/)search(?:\/|$)/i.test(url.pathname))throw new Error("invalid source");
      if(message.active===false){
        if(explicitOperationBySourceTab.get(sourceTabId)?.operationId===operationId)explicitOperationBySourceTab.delete(sourceTabId);
      }else{
        const operationCheckerId=sender.tab?.id??checkerTabId;
        explicitOperationBySourceTab.set(sourceTabId,{operationId,kind,checkerTabId:operationCheckerId,port:explicitOperationPortByCheckerTab.get(operationCheckerId)||null});
      }
      return chrome.tabs.sendMessage(sourceTabId,{type:"graylog-explicit-operation-state",operationId,kind,active:message.active!==false});
    }).then(reply=>sendResponse({accepted:reply?.accepted===true})).catch(()=>sendResponse({accepted:false}));
    return true;
  }
  if(message?.type==="cancel-explicit-operation-from-graylog"){
    const sourceTab=graylogSenderTab(sender),operationId=String(message.operationId||""),operation=sourceTab&&explicitOperationBySourceTab.get(sourceTab.id);
    if(!sourceTab||!/^[a-z0-9_-]{1,128}$/i.test(operationId)||operation?.operationId!==operationId){sendResponse({cancelled:false});return false;}
    const targeted=operation.port?Promise.resolve().then(()=>{operation.port.postMessage({type:"cancel-explicit-operation",operationId,sourceTabId:sourceTab.id});return{cancelled:true};})
      :chrome.runtime.sendMessage({type:"cancel-explicit-operation-in-tools",operationId,sourceTabId:sourceTab.id,targetTabId:operation.checkerTabId}).catch(()=>({cancelled:false}));
    Promise.all([abortExplicitOperation(sourceTab.id,operation,false),targeted])
      .then(([transport,reply])=>sendResponse({cancelled:transport===true||reply?.cancelled===true})).catch(()=>sendResponse({cancelled:false}));
    return true;
  }
  if(message?.type==='repair-graylog-message-index'){
    const sourceTab=graylogSenderTab(sender);
    let url;try{url=new URL(sourceTab?.url||'');}catch{}
    if(!sourceTab||!/^https?:$/.test(url?.protocol||'')||!/(?:^|\/)search(?:\/|$)/i.test(url?.pathname||'')){sendResponse({ok:false});return false;}
    chrome.scripting.executeScript({target:{tabId:sourceTab.id},world:'MAIN',files:['lib/graylog/exception-chain.js','extension/graylog/graylog-rendered-messages.js']})
      .then(()=>sendResponse({ok:true})).catch(()=>sendResponse({ok:false}));
    return true;
  }
  if(message?.type==="cancel-preview-from-graylog"){
    const sourceTab=graylogSenderTab(sender);
    const requestId=/^[a-z0-9_-]{1,128}$/i.test(String(message.requestId||""))?String(message.requestId):"";
    sendResponse({cancelled:Boolean(sourceTab&&requestId&&cancelPreviewWaiter(sourceTab.id,requestId))});return false;
  }
  if (message?.type === "preview-trace-from-graylog") {
    const sourceTab = graylogSenderTab(sender, message.sourceUrl);
    const traceId = /^[a-z0-9_-]{1,128}$/i.test(String(message.traceId || "")) ? String(message.traceId) : "";
    let senderUrl;
    try { senderUrl = new URL(sourceTab?.url || ""); } catch {}
    const senderIsSearch = /^https?:$/.test(senderUrl?.protocol || "")
      && /(?:^|\/)search(?:\/|$)/i.test(senderUrl?.pathname || "");
    if (!traceId || !sourceTab || !senderIsSearch) {
      sendResponse({ ok: false, error: "Не найден точный traceId." });
      return false;
    }
    let bounds;
    try { bounds = tracePreviewBounds(sourceTab.url); }
    catch { sendResponse({ ok: false, error: "Не удалось определить период поиска." }); return false; }
    const requestId=message.requestId===undefined?null:/^[a-z0-9_-]{1,128}$/i.test(String(message.requestId||""))?String(message.requestId):"";
    if(requestId===""){sendResponse({ok:false,error:"Некорректный запрос разбора."});return false;}
    enqueuePreview(sourceTab,traceId,bounds,requestId,sendResponse);
    return true;
  }
  if (message?.type !== "open-tools-from-graylog") return false;
  // Действия с графом из Graylog обслуживает только локальный мостик страницы.
  // Совместимостный шим для этого же сообщения живёт в
  // graylog-page-collection-background.js (он импортируется в этот же worker),
  // и без этой проверки оба слушателя отвечают на одно сообщение: пользователь
  // из старой, ещё не перезагруженной вкладки Graylog получал вдобавок к графу
  // незапрошенную вкладку Сенсора.
  if (message.view === "search" && (message.autoGraph === true || message.autoAnalysis === true)) return false;
  const sourceTab = graylogSenderTab(sender, message.sourceUrl);
  if (!sourceTab) { sendResponse({ opened: false, error: "Откройте Сенсор на странице поиска Graylog." }); return false; }
  const traceId = /^[a-z0-9_-]{1,128}$/i.test(String(message.traceId || "")) ? String(message.traceId) : "";
  const view = ["percentiles", "journal"].includes(message.view) ? message.view : "monitoring";
  let traceContext = null;
  if (traceId) {
    try { traceContext = traceLaunchContext(sourceTab.url, message.nativeSnapshotExact === true); } catch {}
  }
  requestGraylogAccess(sourceTab).then(() => openCheckerForTab(sourceTab, {view,traceId,traceContext,autoPercentiles:view === "percentiles" && message.autoPercentiles === true && Boolean(traceId)}))
    .then(()=>sendResponse({opened:true}))
    .catch(error=>sendResponse({opened:false,error:error?.message || String(error)}));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const sourceOperation=explicitOperationBySourceTab.get(tabId);if(sourceOperation)abortExplicitOperation(tabId,sourceOperation).catch(()=>{});
  explicitOperationPortByCheckerTab.delete(tabId);
  for(const [sourceTabId,operation] of explicitOperationBySourceTab)if(operation.checkerTabId===tabId)abortExplicitOperation(sourceTabId,operation,false).catch(()=>{});
  const work=previewWorkByTab.get(tabId);
  if(work){work.closed=true;discardPendingPreview(work);if(work.active)settlePreview(work.active,previewCancelled());previewWorkByTab.delete(tabId);}
  if (tabId === checkerTabId) {
    checkerTabId = null;
    transientTraceDiagrams.clear();
  }
});

// Graylog tab lifecycle only. YouTrack owns its lifecycle in youtrack-background.js.
chrome.tabs.onUpdated?.addListener((_tabId, changeInfo, tab) => {
  const sourceOperation=explicitOperationBySourceTab.get(_tabId);
  if(sourceOperation&&changeInfo?.url)abortExplicitOperation(_tabId,sourceOperation).catch(()=>{});
  if(changeInfo?.status==="loading"){
    for(const [sourceTabId,operation] of explicitOperationBySourceTab)if(operation.checkerTabId===_tabId)abortExplicitOperation(sourceTabId,operation,false).catch(()=>{});
  }
  if (!changeInfo?.url && changeInfo?.status !== "complete") return;
  if (globalThis.YouTrackBackground?.isTab(tab)) return;
  injectGraylogClippy(tab).catch(() => {});
});

if(typeof importScripts==='function')importScripts('graylog/graylog-page-collection-background.js');
