(function initializeTraceReview(root) {
  "use strict";
  const latency = typeof module !== "undefined" && module.exports ? require("./trace-latency.js") : root.TraceLatency;
  const LIMIT = 2000;
  const list = value => Array.isArray(value) ? value : [];
  const text = (value, limit = 256) => typeof value === "string" ? value.slice(0, limit) : "";
  const count = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  const stamp = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const nonzero = value => count(value) > 0;
  const rank = { none:0, unknown:1, low:2, medium:3, high:4 };
  const evidenceNames = new Set(["parent-span", "recovered-response", "kafka-timestamp", "duration-window", "interval", "single-timestamp", "http-target-window", "openapi-window", "openapi-name-uri", "openapi-gateway-window", "partner-backend-window", "partner-backend-name-uri", "gateway-envelope", "cross-service-response"]);
  function firstTime(node) {
    const times = ["requestAt", "responseAt", "openApiRequestAt", "openApiResponseAt", "gorodClientRequestAt", "gorodClientResponseAt", "partnerBackendRequestAt", "partnerBackendResponseAt", "kafkaProduceAt", "cacheAccessAt"].map(key => stamp(node?.[key])).filter(value => value !== null);
    return times.length ? Math.min(...times) : null;
  }
  function analyze(diagram, thresholdMs = latency?.getThreshold()) {
    const source = diagram && typeof diagram === "object" ? diagram : {};
    const originalNodes = list(source.nodes), originalEdges = list(source.edges);
    const nodes = originalNodes.slice(0, LIMIT);
    const threshold = typeof thresholdMs === "number" && Number.isFinite(thresholdMs) && thresholdMs >= 1 && thresholdMs <= 86400000 ? thresholdMs : latency?.getThreshold() || 3000;
    const errors = source.errorAnalysis;
    const errorsAvailable = errors?.available === true;
    const errorEvents = errorsAvailable ? count(errors.events) : null;
    const unknownErrorEvents = errorsAvailable ? count(errors.unknown) : null;
    let partial = Boolean(source.truncated || source.partial || errors?.truncated || originalNodes.length > LIMIT || originalEdges.length > LIMIT);
    let priority = errorsAvailable ? "none" : "unknown";
    const promote = next => { if (rank[next] > rank[priority]) priority = next; };
    const errorGroups = list(errors?.groups).slice(0, LIMIT);
    for (const group of errorGroups) {
      if (!nonzero(group?.count)) continue;
      promote(typeof group.priority === "string" && Object.hasOwn(rank, group.priority) ? group.priority : "unknown");
    }
    if (unknownErrorEvents > 0 || errorEvents > 0 && !errorGroups.length) promote("unknown");
    const services = new Map(), slowCalls = [], incomplete = [], recovered = [];
    let cacheCount = 0, kafkaCount = 0, unknownDurations = 0;
    const append = (array, value) => { if (array.length < LIMIT) array.push(value); else partial = true; };
    nodes.forEach(node => {
      if (!node || typeof node !== "object") { partial = true; return; }
      const service = text(node.service), spanId = text(node.spanId, 128);
      const row = services.get(service) || {service, spanCount:0, requestEvents:0, responseEvents:0};
      row.spanCount++; row.requestEvents += count(node.requestCount); row.responseEvents += count(node.responseCount); services.set(service, row);
      cacheCount += count(node.cacheAccessCount); kafkaCount += count(node.kafkaProduceCount);
      const httpPresent = nonzero(node.requestCount) || nonzero(node.responseCount);
      // Side effects have no response pair. A mixed span may still contain a real HTTP call.
      const sideEffectOnly = !httpPresent && (nonzero(node.cacheAccessCount) || nonzero(node.kafkaProduceCount) || node.cacheChain || node.kafkaProduce || node.oneWay);
      const ms = sideEffectOnly ? null : latency?.duration(node);
      if (!sideEffectOnly && ms == null) unknownDurations++;
      if (typeof ms === "number" && ms > threshold) append(slowCalls, {service,spanId,label:"HTTP",durationMs:ms});
      const externalDurations = latency?.externalDurations(node) || [];
      for (const [prefix,label] of [["openApi","OPENAPI"],["gorodClient","HTTP CLIENT"],["partnerBackend","PARTNER BACKEND"]]) {
        const observed = Math.max(count(node[`${prefix}RequestCount`]),count(node[`${prefix}ResponseCount`]));
        unknownDurations += Math.max(0,observed-externalDurations.filter(item=>item.label===label).length);
      }
      for (const external of externalDurations.slice(0, LIMIT)) {
        if (external.durationMs > threshold) append(slowCalls, {service,spanId,label:external.label,index:external.index,durationMs:external.durationMs});
      }
      for (const [prefix,label] of [["","HTTP"],["openApi","OPENAPI"],["gorodClient","HTTP CLIENT"],["partnerBackend","PARTNER BACKEND"]]) {
        if (!prefix && sideEffectOnly) continue;
        const requests = count(node[prefix ? `${prefix}RequestCount` : "requestCount"]), responses = count(node[prefix ? `${prefix}ResponseCount` : "responseCount"]);
        if ((requests > 0) !== (responses > 0)) append(incomplete, {service,spanId,label,missingRequest:requests === 0,missingResponse:responses === 0});
      }
      if (node.spanRecovery || list(node.recoveredSpanIds).length) append(recovered, {service,spanId,responseSpanIds:list(node.recoveredSpanIds).slice(0,LIMIT).map(value=>text(value,128)).filter(Boolean)});
    });
    slowCalls.sort((a,b)=>b.durationMs-a.durationMs);
    const interactions = [];
    for (const edge of originalEdges.slice(0,LIMIT)) {
      if (!Number.isInteger(edge?.from) || !Number.isInteger(edge?.to) || edge.from === edge.to) { partial = true; continue; }
      const from = nodes[edge.from], to = nodes[edge.to];
      if (!from || !to) { partial = true; continue; }
      const inference = evidenceNames.has(to.parentInference) ? to.parentInference : edge.inferred === false ? "parent-span" : "inferred";
      const evidence = edge.recovered ? "recovered-response" : inference;
      interactions.push({fromService:text(from.service),toService:text(to.service),fromSpanId:text(from.spanId,128),toSpanId:text(to.spanId,128),requestObserved:edge.requestObserved === true,responseObserved:edge.responseObserved === true,kind:edge.kafkaObserved ? "kafka" : "http",evidence,at:firstTime(to)});
    }
    // Sorting describes log chronology only. Parentage comes solely from supplied graph edges.
    interactions.sort((a,b)=>(a.at ?? Infinity)-(b.at ?? Infinity));
    const repeated = [];
    for (const row of list(source.repeatedHttpTargets).slice(0,LIMIT)) {
      if (count(row?.count) <= 1) continue;
      repeated.push({service:text(row.service),callerService:text(row.callerService),targetServices:list(row.targetServices).slice(0,LIMIT).map(value=>text(value)),url:text(row.url,2048),count:count(row.count),methods:list(row.methods).slice(0,16).map(value=>text(value,16))});
    }
    if (list(source.repeatedHttpTargets).length > LIMIT || list(errors?.groups).length > LIMIT) partial = true;
    if (slowCalls.length || repeated.length || incomplete.length || recovered.length) promote("medium");
    if (partial) promote("unknown");
    return {priority,partial,unknownDurations,errorsAvailable,errorEvents,unknownErrorEvents,errorCountMeaning:"level3-log-events",spanCount:nodes.length,serviceCount:services.size,serviceCounts:[...services.values()],thresholdMs:threshold,slowCalls,repeated,interactions,interactionOrder:"observed-timestamps",incomplete,recovered,cacheCount,kafkaCount,limitations:["Порядок по времени наблюдения не доказывает причинную связь.","Количество level:3 — события журнала, а не число независимых сбоев.","Повторы сервиса сами по себе не считаются повтором URI."]};
  }
  const api = {analyze};
  root.TraceReview = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
