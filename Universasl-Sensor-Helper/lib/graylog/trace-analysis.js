(function initializeTraceAnalysis() {
  const heuristicResolver = typeof module !== "undefined" && module.exports
    ? require("./trace-heuristic-resolver")
    : globalThis.TraceHeuristicResolver;
  const observability = typeof module !== "undefined" && module.exports
    ? require("./trace-observability")
    : globalThis.TraceObservability;
  function traceTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
    const numeric = Number(value);
    if (String(value ?? "").trim() && Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(String(value ?? ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function looksLikeTimestamp(value) {
    if (typeof value === "number") return Number.isFinite(value) && value >= 100_000_000_000;
    const text = String(value ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(text)) return Number.isFinite(Date.parse(text));
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric > 100_000_000_000;
  }

  function traceMetricValue(value) {
    let current = value;
    for (let depth = 0; depth < 5; depth += 1) {
      if (current === null || current === undefined || current === "") return null;
      if (typeof current !== "object") return current;
      if (Array.isArray(current)) {
        if (current.length !== 1) return null;
        [current] = current;
        continue;
      }
      const nestedKey = ["value", "result", "number", "long", "double"].find((key) => Object.prototype.hasOwnProperty.call(current, key));
      if (!nestedKey) return null;
      current = current[nestedKey];
    }
    return null;
  }

  function tracePivotCells(row) {
    const raw = row?.values;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") return Object.entries(raw).map(([key, entry]) => entry && typeof entry === "object" && !Array.isArray(entry) ? { key: entry.key ?? [key], ...entry } : { key: [key], value: entry });
    if (row && Object.prototype.hasOwnProperty.call(row, "value")) return [{ key: ["value"], value: row.value }];
    return [];
  }

  function parseTracePivot(searchType) {
    const bySpan = new Map();
    for (const row of searchType?.rows || []) {
      const rowKey = Array.isArray(row.key) ? row.key : [];
      const values = tracePivotCells(row);
      for (const cell of values) {
        const cellKey = Array.isArray(cell.key) ? cell.key.map(String) : [];
        let dimensions;
        if (rowKey.length === 2) dimensions = rowKey;
        else if (rowKey.length === 1 && cellKey.length >= 2 && !/^(?:count\(\)|count|min\(timestamp\)|min)$/i.test(cellKey[0])) dimensions = [rowKey[0], cellKey[0]];
        else continue;
        const value = traceMetricValue(cell?.value);
        const metric = `${cellKey.join(" ")} ${cell.id || ""} ${cell.type || ""} ${cell.field || ""}`.toLowerCase().replaceAll(" ", "");
        const timestamp = metric.includes("timestamp") || metric.includes("min") || looksLikeTimestamp(value) ? traceTimestamp(value) : null;
        const numeric = Number(value);
        const count = timestamp === null && Number.isFinite(numeric) ? numeric : 0;
        const service = String(dimensions[0] || "неизвестный сервис");
        const spanId = String(dimensions[1] || "без spanId");
        const key = `${service}\u0000${spanId}`;
        const existing = bySpan.get(key);
        if (!existing) bySpan.set(key, { service, spanId, count, firstSeen: timestamp });
        else {
          existing.count = Math.max(existing.count, count);
          if (timestamp !== null && (existing.firstSeen === null || timestamp < existing.firstSeen)) existing.firstSeen = timestamp;
        }
      }
    }

    const nodes = [...bySpan.values()].sort((left, right) => {
      if (left.firstSeen !== null && right.firstSeen !== null && left.firstSeen !== right.firstSeen) return left.firstSeen - right.firstSeen;
      if (left.firstSeen !== null) return -1;
      if (right.firstSeen !== null) return 1;
      return left.service.localeCompare(right.service, "ru") || left.spanId.localeCompare(right.spanId, "ru");
    });
    const edges = nodes.slice(1).map((node, index) => ({ from: index, to: index + 1, inferred: true }));
    return { nodes, edges };
  }

  function parseTraceDurations(searchType) {
    const candidates = new Map();
    for (const row of searchType?.rows || []) {
      const rowKey = Array.isArray(row.key) ? row.key.map(String) : [];
      for (const cell of tracePivotCells(row)) {
        if (cell?.rollup === true) continue;
        const cellKey = Array.isArray(cell.key) ? cell.key.map(String) : [];
        const metric = `${cellKey.join(" ")} ${cell.id || ""} ${cell.type || ""}`.toLowerCase();
        if (!metric.includes("count")) continue;
        let service, spanId, duration;
        if (rowKey.length >= 3) [service, spanId, duration] = rowKey;
        else if (rowKey.length === 2 && cellKey.length >= 2) [service, spanId, duration] = [rowKey[0], rowKey[1], cellKey[0]];
        else if (rowKey.length === 1 && cellKey.length >= 3) [service, spanId, duration] = [rowKey[0], cellKey[0], cellKey[1]];
        else continue;
        const normalized = String(duration ?? "").trim().replace(",", ".");
        const numericDuration = Number(normalized);
        const count = Number(traceMetricValue(cell.value));
        if (!Number.isFinite(numericDuration) || numericDuration < 0 || !Number.isFinite(count) || count <= 0) continue;
        const key = `${service}\u0000${spanId}`;
        if (!candidates.has(key)) candidates.set(key, new Map());
        const values = candidates.get(key);
        values.set(numericDuration, (values.get(numericDuration) || 0) + count);
      }
    }
    const selected = new Map();
    for (const [key, values] of candidates) {
      const [duration] = [...values].sort((left, right) => right[1] - left[1] || right[0] - left[0])[0];
      selected.set(key, duration);
    }
    return selected;
  }

  function parseTraceDurationSamples(searchType) {
    const samples = new Map();
    for (const row of searchType?.rows || []) {
      const rowKey = Array.isArray(row.key) ? row.key.map(String) : [];
      const firstCell = tracePivotCells(row).find((cell) => Array.isArray(cell?.key) && cell.key.length >= 1);
      const service = rowKey[0];
      const spanId = rowKey.length >= 2 ? rowKey[1] : firstCell?.key?.[0];
      if (!service || !spanId || !Array.isArray(row.durationSamples)) continue;
      const values = row.durationSamples.map(Number).filter((value) => Number.isFinite(value) && value >= 0);
      if (values.length) samples.set(`${service}\u0000${spanId}`, values);
    }
    return samples;
  }

  function parseTraceEventTimes(searchType) {
    const times = new Map();
    for (const row of searchType?.rows || []) {
      const rowKey = Array.isArray(row.key) ? row.key.map(String) : [];
      const firstCell = tracePivotCells(row).find((cell) => Array.isArray(cell?.key) && cell.key.length >= 1);
      const service = rowKey[0];
      const spanId = rowKey.length >= 2 ? rowKey[1] : firstCell?.key?.[0];
      if (!service || !spanId || !Array.isArray(row.eventTimes)) continue;
      const values = row.eventTimes.map(traceTimestamp).filter((value) => value !== null).sort((left, right) => left - right);
      if (values.length) times.set(`${service}\u0000${spanId}`, values);
    }
    return times;
  }

  function parseTraceEventLogSteps(searchType) {
    const steps = new Map();
    for (const row of searchType?.rows || []) {
      const rowKey = Array.isArray(row.key) ? row.key.map(String) : [];
      const firstCell = tracePivotCells(row).find((cell) => Array.isArray(cell?.key) && cell.key.length >= 1);
      const service = rowKey[0];
      const spanId = rowKey.length >= 2 ? rowKey[1] : firstCell?.key?.[0];
      if (!service || !spanId || !Array.isArray(row.eventLogSteps)) continue;
      const values = row.eventLogSteps.map(Number).filter(value=>Number.isInteger(value)&&value>0);
      if (values.length) steps.set(`${service}\u0000${spanId}`, values);
    }
    return steps;
  }

  function parseTraceMetadata(searchType, property) {
    const metadata = new Map();
    for (const row of searchType?.rows || []) {
      const rowKey = Array.isArray(row.key) ? row.key.map(String) : [];
      const firstCell = tracePivotCells(row).find((cell) => Array.isArray(cell?.key) && cell.key.length >= 1);
      const service = rowKey[0];
      const spanId = rowKey.length >= 2 ? rowKey[1] : firstCell?.key?.[0];
      if (!service || !spanId || !Array.isArray(row?.[property]) || !row[property].length) continue;
      metadata.set(`${service}\u0000${spanId}`, row[property].map((item) => ({ ...item })));
    }
    return metadata;
  }

  function parseTraceCountMetadata(searchType, property) {
    const metadata = new Map();
    for (const row of searchType?.rows || []) {
      const rowKey = Array.isArray(row.key) ? row.key.map(String) : [];
      const firstCell = tracePivotCells(row).find((cell) => Array.isArray(cell?.key) && cell.key.length >= 1);
      const service = rowKey[0];
      const spanId = rowKey.length >= 2 ? rowKey[1] : firstCell?.key?.[0];
      const count = Math.max(0, Math.floor(Number(row?.[property]) || 0));
      if (service && spanId && count) metadata.set(`${service}\u0000${spanId}`, count);
    }
    return metadata;
  }

  function emptyTraceNode(node) {
    return {
      service: node.service, spanId: node.spanId, parentSpanIds: [], spanKinds: [], requestLabels: [],
      requestCount: 0, requestAt: null, requestTimes: [], requestLogSteps: [], requestTargets: [], responseCount: 0, responseAt: null, responseTimes: [], responseLogSteps: [], responseTargets: [], responseDuration: null, responseDurations: [], responseLevel3Count: 0,
      openApiRequestCount: 0, openApiRequestAt: null, openApiRequestTimes: [], openApiRequestLogSteps: [], openApiRequestTargets: [], openApiResponseCount: 0, openApiResponseAt: null, openApiResponseTimes: [], openApiResponseLogSteps: [], openApiResponseDurations: [],
      gorodClientRequestCount: 0, gorodClientRequestAt: null, gorodClientRequestTimes: [], gorodClientRequestLogSteps: [], gorodClientRequestTargets: [], gorodClientResponseCount: 0, gorodClientResponseAt: null, gorodClientResponseTimes: [], gorodClientResponseLogSteps: [], gorodClientResponseDurations: [],
      partnerBackendRequestCount: 0, partnerBackendRequestAt: null, partnerBackendRequestTimes: [], partnerBackendRequestLogSteps: [], partnerBackendRequestTargets: [], partnerBackendResponseCount: 0, partnerBackendResponseAt: null, partnerBackendResponseTimes: [], partnerBackendResponseLogSteps: [], partnerBackendResponseDurations: [],
      kafkaProduceCount: 0, kafkaProduceAt: null, kafkaProduceTimes: [], kafkaProduceLogSteps: [], kafkaProduces: [],
      kafkaConsumeCount: 0, kafkaConsumeAt: null, kafkaConsumeTimes: [], kafkaConsumeLogSteps: [], kafkaConsumes: [],
      kafkaBrokerCount: 0, kafkaBrokerAt: null, kafkaBrokerTimes: [], kafkaBrokerLogSteps: [], kafkaBrokers: [],
      xmlProcedureRequestCount: 0, xmlProcedureRequestAt: null, xmlProcedureRequestTimes: [], xmlProcedureRequestLogSteps: [], xmlProcedureRequests: [],
      xmlProcedureResponseCount: 0, xmlProcedureResponseAt: null, xmlProcedureResponseTimes: [], xmlProcedureResponseLogSteps: [], xmlProcedureResponseDurations: [], xmlProcedureResponseSamples: [],
      cacheAccessCount: 0, cacheAccessAt: null, cacheAccessTimes: [], cacheAccessLogSteps: [], cacheAccesses: []
    };
  }

  // A log schema is evidence about ownership, not a threading model. Build
  // intervals per operation before considering relations across schemas.
  function operationWindow(node) {
    if(node.completedOperation)return {start:node.completedOperation.start,end:node.completedOperation.end};
    const starts = [...node.requestTimes, ...node.xmlProcedureRequestTimes];
    const ends = [...node.responseTimes, ...node.xmlProcedureResponseTimes];
    if (!starts.length || !ends.length) return null;
    const start = Math.min(...starts), end = Math.max(...ends);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? {start,end} : null;
  }

  function outgoingCallWindows(node) {
    const windows=[];
    for(const family of ['openApi','gorodClient','partnerBackend']){
      const starts=node[family+'RequestTimes']||[],ends=node[family+'ResponseTimes']||[];
      const targets=node[family+'RequestTargets']||[],replies=node[family+'ResponseTargets']||[];
      const hints=node.httpRouteHints||[];
      const routeKey=(at,direction,url)=>{
        const matches=hints.filter(h=>h.direction===direction&&(h.endAt??h.at)===at&&(!url||String(h.url).split(/[?#]/,1)[0].replace(/\/+$/,'')===String(url).split(/[?#]/,1)[0].replace(/\/+$/,'')));
        return new Set(matches.map(h=>h.routeKey)).size===1?matches[0]?.routeKey:null;
      };
      // Equal timestamps can belong to different parallel clients. Keep every
      // occurrence instead of repeatedly taking the first target at that time.
      const usedTargets=new Set(),usedReplies=new Set();
      const requests=starts.map((at,i)=>{const ordinal=targets.findIndex((target,j)=>target.at===at&&!usedTargets.has(j));usedTargets.add(ordinal);const target=targets[ordinal]||{};return {at,url:target.url,method:target.method,clientKey:target.clientKey,routeKey:routeKey(at,'outgoing',target.url),targetOrdinal:ordinal<0?i:ordinal};});
      const responses=ends.map(at=>{const ordinal=replies.findIndex((reply,j)=>reply.at===at&&!usedReplies.has(j));usedReplies.add(ordinal);const target=replies[ordinal]||{},allSamples=node[family+'ResponseSamples']||[],samples=allSamples.filter(reply=>reply.at===at&&(!target.clientKey||reply.clientKey===target.clientKey));const sample=samples.length===1?samples[0]:null;return {...target,at,routeKey:routeKey(at,'outgoing-response',target.url),duration:sample?.duration,...(target.clientKey&&sample?{responseOrdinal:allSamples.indexOf(sample)}:{})};});
      const same=(a,b)=>a.routeKey&&b.routeKey?a.routeKey===b.routeKey:!a.routeKey&&!b.routeKey&&a.url&&b.url&&a.url===b.url;
      const proposals=requests.map(request=>({request,responses:responses.filter(response=>{
        if(response.at<request.at)return false;
        if(request.clientKey && response.clientKey && request.clientKey!==response.clientKey)return false;
        if(requests.length===1&&responses.length===1)return (!request.method||!response.method||request.method===response.method)
          &&(!(request.routeKey&&response.routeKey)||request.routeKey===response.routeKey)
          &&(request.routeKey||response.routeKey||!request.url||!response.url||request.url===response.url);
        if(request.method&&response.method&&request.method!==response.method)return false;
        const requestHasRoute=Boolean(request.routeKey||request.url),responseHasRoute=Boolean(response.routeKey||response.url);
        // Some OpenAPI response loggers omit the URI while preserving the exact
        // request duration. For parallel calls, accept that response only when
        // its derived start lands on this request. Mutual uniqueness below still
        // rejects duplicate timestamps and competing candidates. A conflicting
        // URI is never overridden by duration.
        if(requestHasRoute&&responseHasRoute&&!same(request,response))return false;
        if(Number.isFinite(response.duration))return Math.abs(response.at-response.duration-request.at)<=2;
        if(!same(request,response))return false;
        const next=requests.filter(other=>other.at>request.at&&same(request,other)).sort((a,b)=>a.at-b.at)[0];
        return !next||response.at<next.at;
      })}));
      for(const proposal of proposals){
        if(proposal.responses.length!==1||proposals.filter(other=>other.responses.includes(proposal.responses[0])).length!==1)continue;
        const response=proposal.responses[0],request=proposal.request;
        windows.push({start:request.at,end:response.at,routeKey:request.routeKey,url:request.url,method:request.method,parentCall:{family,requestAt:request.at,responseAt:response.at,targetOrdinal:request.targetOrdinal,...(Number.isInteger(response.responseOrdinal)?{responseOrdinal:response.responseOrdinal}:{})}});
      }
      // A named client may log only RESPONSE. Preserve that fact: its duration
      // bounds a possible call, but does not create an observed REQUEST event.
      for(const response of responses){
        if(!response.routeKey||!Number.isFinite(response.duration)||response.duration<0||response.duration>86400000)continue;
        if(requests.some(request=>(!request.clientKey||!response.clientKey||request.clientKey===response.clientKey)&&same(request,response)))continue;
        if(responses.filter(other=>other.at===response.at&&other.routeKey===response.routeKey&&other.clientKey===response.clientKey).length!==1)continue;
        windows.push({start:response.at-response.duration,end:response.at,routeKey:response.routeKey,url:response.url,method:response.method,requestInferred:true,
          parentCall:{family,requestAt:null,responseAt:response.at,requestInferred:true,...(Number.isInteger(response.responseOrdinal)?{responseOrdinal:response.responseOrdinal}:{})}});
      }
    }
    return windows;
  }

  function recoverProcedureResponses(bySpan) {
    const values=[...bySpan.values()];
    const proposals=values.filter(n=>n.xmlProcedureResponseCount===1 && !n.xmlProcedureRequestCount && n.xmlProcedureResponseSamples.length===1)
      .map(fragment=>{
        const sample=fragment.xmlProcedureResponseSamples[0];
        const at=fragment.xmlProcedureResponseTimes[0],duration=fragment.xmlProcedureResponseDurations[0];
        const candidates=values.filter(candidate=>candidate!==fragment && candidate.service===fragment.service
          && candidate.xmlProcedureRequestCount===1 && !candidate.xmlProcedureResponseCount
          && candidate.xmlProcedureRequests.length===1 && candidate.xmlProcedureRequests[0].procedure===sample.procedure
          && typeof at==='number' && typeof duration==='number' && Math.abs(candidate.xmlProcedureRequestTimes[0]-(at-duration))<=2);
        return {fragment,candidates};
      });
    for(const {fragment,candidates} of proposals){
      if(candidates.length!==1 || proposals.filter(p=>p.candidates.includes(candidates[0])).length!==1)continue;
      if(fragment.requestCount||fragment.responseCount||fragment.kafkaProduceCount||fragment.kafkaConsumeCount||fragment.kafkaBrokerCount||fragment.cacheAccessCount)continue;
      const target=candidates[0];
      for(const key of ['xmlProcedureResponseCount','xmlProcedureResponseAt','xmlProcedureResponseTimes','xmlProcedureResponseDurations','xmlProcedureResponseSamples'])target[key]=fragment[key];
      target.recoveredSpanIds=[...(target.recoveredSpanIds||[]),fragment.spanId];
      target.identityFields=[...new Set([...(target.identityFields||[]),...(fragment.identityFields||[])])];
      target.jobNames=[...new Set([...(target.jobNames||[]),...(fragment.jobNames||[])])].slice(0,8);
      target.batchKeys=[...new Set([...(target.batchKeys||[]),...(fragment.batchKeys||[])])];
      target.spanRecovery={kind:'procedure-duration-match',confidence:'inferred',requestSpanId:target.spanId,responseSpanIds:[fragment.spanId],reason:'Предполагаемая пара процедуры одного приложения по имени, времени и elapsed (±2 мс).'};
      // Preserve any independent events recorded with the response span.
      bySpan.delete(`${fragment.service}\u0000${fragment.spanId}`);
    }
  }

  function findRepeatedHttpTargets(nodes) {
    const grouped = new Map();
    for (const [nodeIndex, node] of (Array.isArray(nodes) ? nodes : []).entries()) {
      for (const property of ["requestTargets", "openApiRequestTargets", "gorodClientRequestTargets", "partnerBackendRequestTargets"]) {
        for (const target of Array.isArray(node?.[property]) ? node[property] : []) {
          const url = String(target?.url || "").trim();
          if (!url) continue;
          const parent = Number.isInteger(node?.parentIndex) ? nodes[node.parentIndex] : null;
          const callerService = String(property === "requestTargets" ? parent?.service || "Внешний источник" : node?.service || "").trim();
          if (!callerService) continue;
          const callerKey = property === "requestTargets" && !parent ? `${callerService} → ${String(node?.service || "неизвестный сервис")}` : callerService;
          const count = Math.max(1, Math.floor(Number(target?.count) || 1));
          const key = `${callerKey}\u0000${url}`;
          const existing = grouped.get(key) || { service:callerService, callerService, url, incomingCount:0, outgoingCount:0, methods: new Set(), nodeIndexes: new Set(), targetServices:new Set() };
          if (property === "requestTargets" && !node.clientSpanAssociation) {
            existing.incomingCount += count;
            if (node?.service) existing.targetServices.add(String(node.service));
          } else existing.outgoingCount += count;
          if (target?.method) existing.methods.add(String(target.method).toUpperCase());
          existing.nodeIndexes.add(nodeIndex);
          grouped.set(key, existing);
        }
      }
    }
    return [...grouped.values()]
      .map((item) => ({ ...item, count:Math.max(item.incomingCount, item.outgoingCount) }))
      .filter((item) => item.count > 1)
      .map((item) => ({ service:item.service, callerService:item.callerService, targetServices:[...item.targetServices].sort(), url:item.url, count:item.count, methods:[...item.methods].sort(), nodeIndexes:[...item.nodeIndexes].sort((left, right) => left - right) }))
      .sort((left, right) => right.count - left.count || left.service.localeCompare(right.service, "ru") || left.url.localeCompare(right.url, "ru"));
  }

  // Distinct spans are normal across client/server boundaries. A same-service
  // time/duration match is only a recovery hypothesis; explicit relationships,
  // incompatible kinds or conflicting HTTP metadata must prevent that merge.
  function recoverSplitResponses(bySpan) {
    const nodesById = new Map();
    for (const node of bySpan.values()) {
      if (!nodesById.has(node.spanId)) nodesById.set(node.spanId, []);
      nodesById.get(node.spanId).push(node);
    }
    const hasAncestor = (node, ancestor) => {
      const pending = [...node.parentSpanIds], visited = new Set();
      while (pending.length) {
        const id = pending.pop();
        if (id === ancestor.spanId) return true;
        if (visited.has(id)) continue;
        visited.add(id);
        for (const parent of nodesById.get(id) || []) pending.push(...parent.parentSpanIds);
      }
      return false;
    };
    const compatibleKinds = (left, right) => {
      if (left.spanKinds.length > 1 || right.spanKinds.length > 1) return false;
      return !left.spanKinds.length || !right.spanKinds.length || left.spanKinds[0] === right.spanKinds[0];
    };
    const compatibleHttp = (request, response) => {
      const requestRoutes=(request.httpRouteHints||[]).filter(hint=>hint.direction==='incoming');
      const responseRoutes=(response.httpRouteHints||[]).filter(hint=>hint.direction==='incoming-response');
      if(requestRoutes.length&&responseRoutes.length){
        const agrees=(left,right)=>left.routeKey===right.routeKey&&(!left.method||!right.method||left.method===right.method);
        return requestRoutes.every(left=>responseRoutes.some(right=>agrees(left,right)))&&responseRoutes.every(right=>requestRoutes.some(left=>agrees(left,right)));
      }
      const requests = request.requestTargets, responses = response.responseTargets;
      if (!requests.length || !responses.length) return true;
      const path=value=>String(value||'').split(/[?#]/,1)[0].replace(/\/+$/, '');
      const agrees = (left, right) => (!left.url || !right.url || path(left.url) === path(right.url))
        && (!left.method || !right.method || String(left.method).toUpperCase() === String(right.method).toUpperCase());
      return requests.every(left => responses.some(right => agrees(left, right)))
        && responses.every(right => requests.some(left => agrees(left, right)));
    };
    const fragments = [...bySpan.entries()].filter(([, node]) => node.requestCount === 0 && node.responseCount === 1
      && node.responseTimes.length === 1 && (Number.isFinite(node.responseDuration)||(node.httpRouteHints||[]).some(h=>h.direction==='incoming-response')));
    const proposals = fragments.map(([key, fragment]) => {
      const measuredDuration=Number.isFinite(fragment.responseDuration);
      const start = measuredDuration ? fragment.responseTimes[0] - fragment.responseDuration : null;
      const candidates = [...bySpan.values()].filter((candidate) => candidate !== fragment
        && candidate.service === fragment.service && candidate.requestCount === 1 && candidate.responseCount === 0
        && candidate.requestTimes.length === 1
        && candidate.requestTimes.some((at) => measuredDuration ? Math.abs(at - start) <= 2
          : fragment.responseTimes[0]>=at&&fragment.responseTimes[0]-at<=300000
            &&(candidate.httpRouteHints||[]).some(req=>req.direction==='incoming'&&(fragment.httpRouteHints||[]).some(res=>res.direction==='incoming-response'&&req.routeKey===res.routeKey)))
        && !hasAncestor(fragment, candidate) && !hasAncestor(candidate, fragment)
        && compatibleKinds(candidate, fragment) && compatibleHttp(candidate, fragment)
        && (!fragment.parentSpanIds.length || !candidate.parentSpanIds.length
          || fragment.parentSpanIds.some((id) => candidate.parentSpanIds.includes(id))));
      return { key, fragment, candidates, measuredDuration };
    });
    for (const { key, fragment, candidates, measuredDuration } of proposals) {
      if (candidates.length !== 1) continue;
      const target = candidates[0];
      // Multiple possible replies to one missing request remain separate.
      const competing = proposals.filter((item) => item.candidates.includes(target)).length;
      if (competing !== 1) continue;
      target.responseCount += fragment.responseCount;
      target.responseTimes = [...target.responseTimes, ...fragment.responseTimes].sort((a, b) => a - b);
      target.responseLogSteps = [...(target.responseLogSteps || []), ...(fragment.responseLogSteps || [])];
      target.responseAt = target.responseTimes[0];
      target.responseDuration = fragment.responseDuration;
      target.responseDurations = [...(target.responseDurations || []), ...(fragment.responseDurations || [])];
      target.responseLevel3Count += fragment.responseLevel3Count;
      target.responseTargets = [...target.responseTargets, ...fragment.responseTargets];
      target.spanKinds = [...new Set([...target.spanKinds, ...fragment.spanKinds])];
      target.streamIds = [...new Set([...(target.streamIds || []), ...(fragment.streamIds || [])])].slice(0, 32);
      target.streamMetadataComplete = target.streamMetadataComplete === true && fragment.streamMetadataComplete === true;
      target.identityFields = [...new Set([...(target.identityFields || []), ...(fragment.identityFields || [])])];
      target.jobNames=[...new Set([...(target.jobNames||[]),...(fragment.jobNames||[])])].slice(0,8);
      target.httpRouteHints = [...(target.httpRouteHints||[]),...(fragment.httpRouteHints||[])].slice(0,24);
      target.batchKeys = [...new Set([...(target.batchKeys || []), ...(fragment.batchKeys || [])])];
      target.requestLabels = [...target.requestLabels, ...fragment.requestLabels].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
      target.recoveredSpanIds = [fragment.spanId];
      target.parentSpanIds = [...new Set([...target.parentSpanIds, ...fragment.parentSpanIds])];
      target.spanRecovery = {
        kind: measuredDuration ? "duration-match" : "uri-time-match", confidence: "inferred", requestSpanId: target.spanId,
        responseSpanIds: [fragment.spanId],
        reason: measuredDuration ? "Предполагаемая пара одного сервиса по времени и duration (±2 мс); разные spanId сами по себе не доказывают разрыв трассировки."
          : "Единственная совместимая пара одного сервиса по исходному URI и порядку REQUEST → RESPONSE (не более 5 минут). Duration в сообщении не указан."
      };
      // Keep subcalls on the recovered fragment: ownership is the same service,
      // but their original span IDs remain visible in recovery metadata.
      for (const prefix of ["openApi", "gorodClient", "partnerBackend", "kafkaProduce", "kafkaConsume", "cacheAccess"]) {
        for (const [field, value] of Object.entries(fragment)) {
          if (!field.startsWith(prefix)) continue;
          if (Array.isArray(value)) target[field] = [...(target[field] || []), ...value];
          else if (field.endsWith("Count")) target[field] = (target[field] || 0) + value;
          else if (field.endsWith("At") && value !== null) target[field] = target[field] === null || target[field] === undefined ? value : Math.min(target[field], value);
        }
      }
      bySpan.delete(key);
    }
  }

  function canonicalGatewayNode(node) {
    if (!node?.identityFields?.includes("service-name")) return false;
    const tokens=String(node.service||"").toLowerCase().split(/[-_.]+/).filter(Boolean);
    return tokens.length > 0 && tokens[tokens.length - 1] === "gateway";
  }

  function openApiGatewayNode(node) {
    if (!canonicalGatewayNode(node)) return false;
    return String(node.service || "").toLowerCase().split(/[-_.]+/).includes("openapi");
  }

  // Some OpenAPI installations emit the same gateway entry twice under two
  // span IDs. Collapse only adjacent, near-simultaneous copies with the same
  // raw operation. The second span remains in recoveredSpanIds so explicit
  // child parentSpanId evidence still resolves to the retained gateway node.
  function absorbDuplicateOpenApiGatewayEntries(bySpan) {
    const operation = (node) => {
      const hints = (node.httpRouteHints || []).filter((hint) => hint.direction === "incoming");
      const targets = node.requestTargets || [];
      const methods = [...new Set([...hints.map((item) => item.method), ...targets.map((item) => item.method)].filter(Boolean).map((item) => String(item).toUpperCase()))];
      const routes = [...new Set([...hints.map((item) => item.routeKey), ...targets.map((item) => item.routeKey)].filter(Boolean))];
      const urls = [...new Set([...hints.map((item) => item.url), ...targets.map((item) => item.url)].filter(Boolean).map((item) => String(item).split(/[?#]/, 1)[0].replace(/\/+$/, "")))];
      if (methods.length > 1 || routes.length > 1 || (!routes.length && urls.length !== 1)) return null;
      return { method:methods[0] || "", route:routes[0] || "", url:urls[0] || "" };
    };
    const candidates = [...bySpan.entries()].flatMap(([key, node]) => {
      const requestAt = node.requestTimes?.length === 1 ? Number(node.requestTimes[0]) : null;
      const logStep = node.requestLogSteps?.length === 1 ? Number(node.requestLogSteps[0]) : null;
      const signature = operation(node);
      return openApiGatewayNode(node) && node.requestCount === 1 && signature
        && !node.openApiRequestCount && !node.gorodClientRequestCount && !node.partnerBackendRequestCount && !node.kafkaProduceCount && !node.kafkaConsumeCount
        ? [{ key, node, requestAt:Number.isFinite(requestAt) ? requestAt : null, logStep:Number.isSafeInteger(logStep) ? logStep : null, signature }]
        : [];
    });
    const sameOperation = (left, right) => left.node.service === right.node.service
      && left.signature.method === right.signature.method
      && (left.signature.route && right.signature.route ? left.signature.route === right.signature.route : left.signature.url === right.signature.url);
    const adjacent = (left, right) => (left.logStep !== null && right.logStep !== null && Math.abs(left.logStep - right.logStep) === 1)
      || (left.requestAt !== null && right.requestAt !== null && Math.abs(left.requestAt - right.requestAt) <= 15);
    const consumed = new Set();
    for (const current of candidates) {
      if (consumed.has(current.key)) continue;
      const matches = candidates.filter((other) => other.key !== current.key && !consumed.has(other.key) && sameOperation(current, other) && adjacent(current, other));
      if (matches.length !== 1) continue;
      const duplicate = matches[0];
      if (candidates.some((other) => other.key !== current.key && other.key !== duplicate.key && !consumed.has(other.key)
        && sameOperation(current, other) && (adjacent(current, other) || adjacent(duplicate, other)))) continue;
      const richer = (item) => (item.node.responseCount || 0) * 20 + (item.node.parentSpanIds?.length || 0) * 4
        + (item.node.httpRouteHints?.length || 0) + (item.node.requestTargets?.length || 0);
      const retained = richer(duplicate) > richer(current) ? duplicate : current;
      const removed = retained === current ? duplicate : current;
      const target = retained.node, source = removed.node;
      target.recoveredSpanIds = [...new Set([...(target.recoveredSpanIds || []), source.spanId, ...(source.recoveredSpanIds || [])])];
      target.parentSpanIds = [...new Set([...(target.parentSpanIds || []), ...(source.parentSpanIds || [])])];
      target.spanKinds = [...new Set([...(target.spanKinds || []), ...(source.spanKinds || [])])];
      target.identityFields = [...new Set([...(target.identityFields || []), ...(source.identityFields || [])])];
      target.jobNames=[...new Set([...(target.jobNames||[]),...(source.jobNames||[])])].slice(0,8);
      target.streamIds = [...new Set([...(target.streamIds || []), ...(source.streamIds || [])])].slice(0, 32);
      target.streamMetadataComplete = target.streamMetadataComplete === true && source.streamMetadataComplete === true;
      target.httpRouteHints = [...(target.httpRouteHints || []), ...(source.httpRouteHints || [])]
        .filter((hint, index, all) => all.findIndex((item) => item.direction === hint.direction && item.routeKey === hint.routeKey && item.at === hint.at && item.method === hint.method) === index).slice(0, 24);
      for (const property of ["responseTimes", "responseLogSteps", "responseDurations", "responseTargets", "requestLabels", "responseLabels"]) {
        target[property] = [...(target[property] || []), ...(source[property] || [])];
      }
      if ((source.responseCount || 0) > (target.responseCount || 0)) {
        target.responseCount = source.responseCount;
        target.responseAt = source.responseAt;
        target.responseDuration = source.responseDuration;
      }
      target.responseLevel3Count = Math.max(target.responseLevel3Count || 0, source.responseLevel3Count || 0);
      target.absorbedGatewayDuplicates = [...(target.absorbedGatewayDuplicates || []), {
        count:1, logSteps:[retained.logStep, removed.logStep].filter(Number.isSafeInteger).sort((a, b) => a - b),
        reason:"Две соседние записи входа OpenAPI gateway с одинаковыми URI и методом объединены; исходные spanId различались."
      }];
      target.spanRecovery = target.spanRecovery || { kind:"openapi-gateway-duplicate", confidence:"inferred", requestSpanId:target.spanId,
        responseSpanIds:[], reason:target.absorbedGatewayDuplicates[target.absorbedGatewayDuplicates.length - 1].reason };
      bySpan.delete(removed.key);
      consumed.add(retained.key); consumed.add(removed.key);
    }
  }

  function sameApplicationFamily(left, right) {
    const tokens=value=>String(value||"").toLowerCase().split(/[-_.]+/).filter(Boolean);
    const a=tokens(left),b=tokens(right);
    return a.length>=3&&b.length>=3&&a[0]===b[0]&&a[1]===b[1];
  }

  function openApiNameUriScore(service, uri) {
    const ignored=new Set(['api','openapi','service','server','client','online','banking','gateway','http','https']);
    const tokens=value=>new Set(String(value||'').toLowerCase().split(/[^\p{L}\p{N}]+/u)
      .filter(token=>token.length>=3&&!ignored.has(token)&&!/^(?:v?\d+|\d+)$/i.test(token)));
    const names=tokens(service),routes=tokens(String(uri||'').split(/[?#]/,1)[0]);
    let score=0;for(const token of names)if(routes.has(token))score+=Math.min(12,token.length);
    return score;
  }

  // In the supported log convention an HTTP REQUEST is attributed to the
  // service receiving that request, while RESPONSE is attributed to the
  // caller receiving the reply. Therefore RESPONSE.service is the parent and
  // REQUEST.service is the child. Match individual events: one span may hold
  // several simultaneous calls and they must remain parallel sibling edges.
  // A terminal canonical gateway is handled separately because its missing
  // entry points in the opposite direction.
  function annotateCrossServiceResponses(nodes) {
    const events=(node,index,direction,timesName)=>{
      const times=Array.isArray(node[timesName])?node[timesName]:[];
      return (node.httpRouteHints||[]).filter(hint=>hint.direction===direction&&hint.routeKey).map((hint,ordinal)=>({
        node,index,hint,ordinal,
        at:Number.isFinite(Number(hint.at))?Number(hint.at):Number.isFinite(Number(times[ordinal]))?Number(times[ordinal]):null
      })).filter(event=>event.at!==null);
    };
    const requests=nodes.flatMap((node,index)=>events(node,index,'incoming','requestTimes'));
    const responses=nodes.flatMap((node,index)=>canonicalGatewayNode(node)?[]:events(node,index,'incoming-response','responseTimes'))
      .sort((left,right)=>left.at-right.at||left.index-right.index||left.ordinal-right.ordinal);
    const proposals=[];
    for(const response of responses){
      const responseDuration=Number(response.node.responseDurations?.[response.ordinal]);
      for(const request of requests){
        if(request.node.service===response.node.service)continue;
        const contradictions=[];
        if(request.hint.routeKey!==response.hint.routeKey)contradictions.push('route-mismatch');
        if(request.hint.method&&response.hint.method&&request.hint.method!==response.hint.method)contradictions.push('method-mismatch');
        if(request.at>response.at)contradictions.push('reverse-time');
        if(response.at-request.at>300000)contradictions.push('outside-window');
        const durationExact=Number.isFinite(responseDuration)&&Math.abs(request.at-(response.at-responseDuration))<=2;
        proposals.push({leftKey:`${request.index}:${request.ordinal}`,rightKey:`${response.index}:${response.ordinal}`,
          request,response,contradictions,distance:durationExact?0:0,
          evidence:[durationExact?'exact-route-method-duration':request.hint.method&&response.hint.method?'exact-route-method':'exact-route']});
      }
    }
    const resolved=heuristicResolver?.resolveMutual?.(proposals);
    const matches=(resolved?.matches||[]).map(item=>({request:item.proposal.request,response:item.proposal.response,
      confidence:item.confidence,evidence:item.evidence}));
    const byRequestNode=new Map();
    for(const {request,response,confidence,evidence} of matches){
      const pair={parentIndex:response.index,requestNodeIndex:request.index,responseNodeIndex:response.index,
        requestAt:request.at,responseAt:response.at,requestOrdinal:request.ordinal,responseOrdinal:response.ordinal,
        routeKey:request.hint.routeKey,method:request.hint.method||response.hint.method||null,
        heuristicConfidence:confidence,heuristicEvidence:evidence,
        reason:"REQUEST записан у принимающего сервиса, RESPONSE — у вызывающего; направление восстановлено по URI, методу и времени."};
      const list=byRequestNode.get(request.index)||[];list.push(pair);byRequestNode.set(request.index,list);
      response.node.crossServiceResponseOwner=true;
    }
    for(const [requestIndex,pairs] of byRequestNode){
      const parentIndexes=[...new Set(pairs.map(pair=>pair.parentIndex))];
      if(parentIndexes.length!==1)continue;
      const node=nodes[requestIndex];
      node.crossServicePairs=pairs.sort((left,right)=>left.requestAt-right.requestAt||left.requestOrdinal-right.requestOrdinal);
      node.crossServicePair={...node.crossServicePairs[0]};
    }
  }

  // A WebClient checkpoint records a failed outgoing attempt, not an HTTP reply.
  // Keep it separate from span recovery and never derive its owner from a URL.
  function resolveOutgoingFailures(nodes, pivot) {
    const failures = [];
    for (const row of pivot?.rows || []) {
      const service = row.key?.[0];
      // MAIN's reduced row stores service in row.key and span in metric cells.
      // Row-level metadata is attributable only when those cells agree on span.
      const cellSpans = [...new Set(tracePivotCells(row).filter(cell => Array.isArray(cell.key) && cell.key.length >= 2).map(cell => cell.key[0]).filter(Boolean))];
      const spanId = row.key?.[1] ?? (cellSpans.length === 1 ? cellSpans[0] : null);
      if (!service || !spanId) continue;
      const exact = nodes.flatMap((node, index) => node.service === service && (node.spanId === spanId || node.recoveredSpanIds?.includes(spanId)) ? [index] : []);
      const parents = Array.isArray(row.parentSpanIds) ? row.parentSpanIds : [];
      const parentMatches = exact.length ? [] : nodes.flatMap((node, index) => node.service === service && parents.some(id => node.spanId === id || node.recoveredSpanIds?.includes(id)) ? [index] : []);
      const ownerIndex = exact.length === 1 ? exact[0] : !exact.length && parentMatches.length === 1 ? parentMatches[0] : null;
      const binding = exact.length === 1 ? "exact" : ownerIndex !== null ? "parent-span" : exact.length > 1 || parentMatches.length > 1 ? "ambiguous" : "unmatched";
      for (const source of (Array.isArray(row.outgoingFailures) ? row.outgoingFailures : []).slice(0, 200)) {
        if (source?.failureType !== "WebClientRequestException" || !/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|TRACE|CONNECT)$/.test(source.method || "") || typeof source.url !== "string" || !source.url.startsWith("/") || source.url.startsWith("//")) continue;
        const at = source.at !== null && source.at !== undefined && Number.isFinite(Number(source.at)) ? Number(source.at) : null;
        failures.push({ service, spanId, ownerIndex, binding, at, method:source.method, url:source.url,
          failureType:"WebClientRequestException", level3:Boolean(source.level3), requestMatch:null });
      }
    }
    // Only explicit client requests are eligible. A generic server REQUEST may
    // carry the same URI and must never be stolen by an outgoing checkpoint.
    const proposals = failures.map(failure => {
      const node = nodes[failure.ownerIndex];
      if (!node || node.spanId !== failure.spanId || node.recoveredSpanIds?.length || failure.at === null) return { failure, candidates:[] };
      const families = [
        ["OPENAPI", node.openApiRequestTargets, node.openApiResponseCount],
        ["HTTP CLIENT", node.gorodClientRequestTargets, node.gorodClientResponseCount],
        ["PARTNER BACKEND", node.partnerBackendRequestTargets, node.partnerBackendResponseCount],
        ...(node.spanKinds?.includes("client") && !node.spanKinds.includes("server") ? [["HTTP CLIENT", node.requestTargets, node.responseCount]] : [])
      ];
      const candidates = families.flatMap(([family, targets, responses]) => Number(responses) > 0 ? [] : (targets || []).flatMap((target, targetIndex) => {
        const at = target.at !== null && target.at !== undefined && Number.isFinite(Number(target.at)) ? Number(target.at) : null;
        return at !== null && at <= failure.at && target.method === failure.method && target.url === failure.url && (target.count === undefined || Number(target.count) === 1)
          ? [{family, at, targetIndex, key:`${failure.ownerIndex}:${family}:${targetIndex}`}]
          : [];
      }));
      return { failure, candidates };
    });
    for (const { failure, candidates } of proposals) {
      if (candidates.length !== 1 || proposals.filter(item => item.candidates.some(candidate => candidate.key === candidates[0].key)).length !== 1) continue;
      const {family, at, targetIndex} = candidates[0];
      failure.requestMatch = {family, at, targetIndex};
    }
    for (const node of nodes) node.outgoingFailures = [];
    for (const failure of failures) if (failure.ownerIndex !== null) nodes[failure.ownerIndex].outgoingFailures.push(failure);
    return failures;
  }

  function buildRequestResponseTrace(requestSearchType, responseSearchType, openApiSearchType, openApiResponseSearchType, gorodClientSearchType, gorodClientResponseSearchType, kafkaProduceSearchType, cacheAccessSearchType, outgoingFailureSearchType, kafkaConsumeSearchType, kafkaBrokerSearchType, xmlProcedureRequestSearchType, xmlProcedureResponseSearchType, partnerBackendSearchType, partnerBackendResponseSearchType) {
    const requestNodes = parseTracePivot(requestSearchType).nodes;
    const responseNodes = parseTracePivot(responseSearchType).nodes;
    const openApiNodes = parseTracePivot(openApiSearchType).nodes;
    const openApiResponseNodes = parseTracePivot(openApiResponseSearchType).nodes;
    const gorodClientNodes = parseTracePivot(gorodClientSearchType).nodes;
    const gorodClientResponseNodes = parseTracePivot(gorodClientResponseSearchType).nodes;
    const partnerBackendNodes = parseTracePivot(partnerBackendSearchType).nodes;
    const partnerBackendResponseNodes = parseTracePivot(partnerBackendResponseSearchType).nodes;
    const kafkaProduceNodes = parseTracePivot(kafkaProduceSearchType).nodes;
    const kafkaConsumeNodes = parseTracePivot(kafkaConsumeSearchType).nodes;
    const kafkaBrokerNodes = parseTracePivot(kafkaBrokerSearchType).nodes;
    const xmlProcedureRequestNodes = parseTracePivot(xmlProcedureRequestSearchType).nodes;
    const xmlProcedureResponseNodes = parseTracePivot(xmlProcedureResponseSearchType).nodes;
    const cacheAccessNodes = parseTracePivot(cacheAccessSearchType).nodes;
    const responseDurations = parseTraceDurations(responseSearchType);
    const responseDurationSamples = parseTraceDurationSamples(responseSearchType);
    const requestTimes = parseTraceEventTimes(requestSearchType);
    const responseTimes = parseTraceEventTimes(responseSearchType);
    const requestLogSteps = parseTraceEventLogSteps(requestSearchType);
    const responseLogSteps = parseTraceEventLogSteps(responseSearchType);
    const responseLevel3Counts = parseTraceCountMetadata(responseSearchType, "level3Count");
    const openApiRequestTimes = parseTraceEventTimes(openApiSearchType);
    const openApiResponseTimes = parseTraceEventTimes(openApiResponseSearchType);
    const openApiRequestLogSteps = parseTraceEventLogSteps(openApiSearchType);
    const openApiResponseLogSteps = parseTraceEventLogSteps(openApiResponseSearchType);
    const gorodClientRequestTimes = parseTraceEventTimes(gorodClientSearchType);
    const gorodClientResponseTimes = parseTraceEventTimes(gorodClientResponseSearchType);
    const gorodClientRequestLogSteps = parseTraceEventLogSteps(gorodClientSearchType);
    const gorodClientResponseLogSteps = parseTraceEventLogSteps(gorodClientResponseSearchType);
    const partnerBackendRequestTimes = parseTraceEventTimes(partnerBackendSearchType);
    const partnerBackendResponseTimes = parseTraceEventTimes(partnerBackendResponseSearchType);
    const partnerBackendRequestLogSteps = parseTraceEventLogSteps(partnerBackendSearchType);
    const partnerBackendResponseLogSteps = parseTraceEventLogSteps(partnerBackendResponseSearchType);
    const kafkaProduceTimes = parseTraceEventTimes(kafkaProduceSearchType);
    const kafkaConsumeTimes = parseTraceEventTimes(kafkaConsumeSearchType);
    const kafkaBrokerTimes = parseTraceEventTimes(kafkaBrokerSearchType);
    const kafkaProduceLogSteps = parseTraceEventLogSteps(kafkaProduceSearchType);
    const kafkaConsumeLogSteps = parseTraceEventLogSteps(kafkaConsumeSearchType);
    const kafkaBrokerLogSteps = parseTraceEventLogSteps(kafkaBrokerSearchType);
    const xmlProcedureRequestTimes = parseTraceEventTimes(xmlProcedureRequestSearchType);
    const xmlProcedureResponseTimes = parseTraceEventTimes(xmlProcedureResponseSearchType);
    const xmlProcedureRequestLogSteps = parseTraceEventLogSteps(xmlProcedureRequestSearchType);
    const xmlProcedureResponseLogSteps = parseTraceEventLogSteps(xmlProcedureResponseSearchType);
    const cacheAccessTimes = parseTraceEventTimes(cacheAccessSearchType);
    const cacheAccessLogSteps = parseTraceEventLogSteps(cacheAccessSearchType);
    const requestTargets = parseTraceMetadata(requestSearchType, "httpRequests");
    const responseTargets = parseTraceMetadata(responseSearchType, "httpResponses");
    const openApiRequestTargets = parseTraceMetadata(openApiSearchType, "httpRequests");
    const gorodClientRequestTargets = parseTraceMetadata(gorodClientSearchType, "httpRequests");
    const openApiResponseTargets = parseTraceMetadata(openApiResponseSearchType, "httpResponses");
    const gorodClientResponseTargets = parseTraceMetadata(gorodClientResponseSearchType, "httpResponses");
    const partnerBackendRequestTargets = parseTraceMetadata(partnerBackendSearchType, "httpRequests");
    const partnerBackendResponseTargets = parseTraceMetadata(partnerBackendResponseSearchType, "httpResponses");
    const kafkaProduces = parseTraceMetadata(kafkaProduceSearchType, "kafkaProduces");
    const kafkaConsumes = parseTraceMetadata(kafkaConsumeSearchType, "kafkaConsumes");
    const kafkaBrokers = parseTraceMetadata(kafkaBrokerSearchType, "kafkaBrokers");
    const xmlProcedureRequests = parseTraceMetadata(xmlProcedureRequestSearchType, "xmlProcedures");
    const xmlProcedureResponses = parseTraceMetadata(xmlProcedureResponseSearchType, "xmlProcedures");
    const xmlProcedureResponseDurations = parseTraceDurationSamples(xmlProcedureResponseSearchType);
    const xmlProcedureResponseSamples = parseTraceMetadata(xmlProcedureResponseSearchType, "responseSamples");
    const cacheAccesses = parseTraceMetadata(cacheAccessSearchType, "cacheAccesses");
    const openApiResponseDurations = parseTraceDurationSamples(openApiResponseSearchType);
    const gorodClientResponseDurations = parseTraceDurationSamples(gorodClientResponseSearchType);
    const partnerBackendResponseDurations = parseTraceDurationSamples(partnerBackendResponseSearchType);
    // Labels are already reduced/masked in the source tab. Keep their exact
    // owner and request/response phase; span IDs alone are not globally unique.
    const labelSources = [
      ["requestLabels", parseTraceMetadata(requestSearchType, "requestLabels")],
      ["requestLabels", parseTraceMetadata(responseSearchType, "requestLabels")],
      ["openApiRequestLabels", parseTraceMetadata(openApiSearchType, "requestLabels")],
      ["openApiResponseLabels", parseTraceMetadata(openApiResponseSearchType, "requestLabels")],
      ["gorodClientRequestLabels", parseTraceMetadata(gorodClientSearchType, "requestLabels")],
      ["gorodClientResponseLabels", parseTraceMetadata(gorodClientResponseSearchType, "requestLabels")],
      ["partnerBackendRequestLabels", parseTraceMetadata(partnerBackendSearchType, "requestLabels")],
      ["partnerBackendResponseLabels", parseTraceMetadata(partnerBackendResponseSearchType, "requestLabels")]
    ];
    const parentIds = new Map();
    const spanKinds = new Map();
    const jobNames = new Map();
    const identityFields = new Map();
    const batchKeys = new Map();
    const threadKinds = new Map();
    const httpRouteHints = new Map();
    const streamIds = new Map();
    const streamMetadataComplete = new Map();
    for (const source of [requestSearchType, responseSearchType, openApiSearchType, openApiResponseSearchType, gorodClientSearchType, gorodClientResponseSearchType, partnerBackendSearchType, partnerBackendResponseSearchType, kafkaProduceSearchType, cacheAccessSearchType, outgoingFailureSearchType, kafkaConsumeSearchType, kafkaBrokerSearchType, xmlProcedureRequestSearchType, xmlProcedureResponseSearchType]) {
      for (const row of source?.rows || []) {
        const span = row.key?.[1] ?? tracePivotCells(row)[0]?.key?.[0];
        if (!row.key?.[0] || !span) continue;
        const key = row.key[0] + "\u0000" + span;
        jobNames.set(key,[...new Set([...(jobNames.get(key)||[]),...(row.jobNames||[]).filter(v=>typeof v==='string'&&v.length<=160&&!/[\u0000-\u001f]/.test(v))])].slice(0,8));
        identityFields.set(key,[...new Set([...(identityFields.get(key)||[]),...(row.identityFields||[]).filter(field=>field==='service-name'||field==='instance-name')])]);
        batchKeys.set(key,[...new Set([...(batchKeys.get(key)||[]),...(row.batchKeys||[]).filter(value=>/^batch-\d{1,4}$/.test(value))])]);
        threadKinds.set(key,[...new Set([...(threadKinds.get(key)||[]),...(row.threadKinds||[]).filter(value=>['reactor','netty','kafka','scheduled','worker-pool'].includes(value))])]);
        httpRouteHints.set(key, [...(httpRouteHints.get(key)||[]), ...(row.httpRouteHints||[])].filter((hint,i,all)=>hint && /^route-\d{1,5}$/.test(hint.routeKey) && all.findIndex(other=>other.routeKey===hint.routeKey && other.at===hint.at && other.method===hint.method && other.direction===hint.direction)===i).slice(0,24));
        const parents = Array.isArray(row.parentSpanIds) ? row.parentSpanIds : [];
        parentIds.set(key, [...new Set([...(parentIds.get(key) || []), ...parents.filter((id) => typeof id === "string" && id)])]);
        const kinds = (Array.isArray(row.spanKinds) ? row.spanKinds : []).map(kind => String(kind).toLowerCase())
          .filter(kind => ["client", "server", "internal", "producer", "consumer"].includes(kind));
        spanKinds.set(key, [...new Set([...(spanKinds.get(key) || []), ...kinds])]);
        const memberships=(Array.isArray(row.streamIds)?row.streamIds:[]).map(id=>String(id).toLowerCase()).filter(id=>/^[a-f0-9]{24}$/.test(id));
        streamIds.set(key,[...new Set([...(streamIds.get(key)||[]),...memberships])].slice(0,32));
        streamMetadataComplete.set(key,(streamMetadataComplete.get(key)??true)&&row.streamMetadataComplete===true&&memberships.length>0);
      }
    }
    const openApiResponseSamples = parseTraceMetadata(openApiResponseSearchType, "responseSamples");
    const gorodClientResponseSamples = parseTraceMetadata(gorodClientResponseSearchType, "responseSamples");
    const partnerBackendResponseSamples = parseTraceMetadata(partnerBackendResponseSearchType, "responseSamples");
    const openApiResponseLevel3Counts = parseTraceCountMetadata(openApiResponseSearchType, "level3Count");
    const gorodClientResponseLevel3Counts = parseTraceCountMetadata(gorodClientResponseSearchType, "level3Count");
    const partnerBackendResponseLevel3Counts = parseTraceCountMetadata(partnerBackendResponseSearchType, "level3Count");
    const bySpan = new Map();
    for (const node of requestNodes) {
      const key = `${node.service}\u0000${node.spanId}`;
      bySpan.set(key, {
        ...emptyTraceNode(node), requestCount: node.count, requestAt: node.firstSeen,
        requestTimes: requestTimes.get(key) || (node.firstSeen === null ? [] : [node.firstSeen]),
        requestLogSteps: requestLogSteps.get(key) || [],
        requestTargets: requestTargets.get(key) || []
      });
    }
    for (const node of responseNodes) {
      const key = `${node.service}\u0000${node.spanId}`;
      const existing = bySpan.get(key) || emptyTraceNode(node);
      existing.responseCount = node.count;
      existing.responseAt = node.firstSeen;
      existing.responseTimes = responseTimes.get(key) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.responseLogSteps = responseLogSteps.get(key) || [];
      existing.responseLevel3Count = responseLevel3Counts.get(key) || 0;
      existing.responseTargets = responseTargets.get(key) || [];
      const orderedDurations = responseDurationSamples.get(key) || [];
      existing.responseDurations = orderedDurations;
      existing.responseDuration = orderedDurations.length ? orderedDurations[orderedDurations.length - 1] : responseDurations.get(key) ?? null;
      bySpan.set(key, existing);
    }
    for (const node of openApiNodes) {
      const key = `${node.service}\u0000${node.spanId}`;
      const existing = bySpan.get(key) || emptyTraceNode(node);
      existing.openApiRequestCount = node.count;
      existing.openApiRequestAt = node.firstSeen;
      existing.openApiRequestTimes = openApiRequestTimes.get(key) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.openApiRequestLogSteps = openApiRequestLogSteps.get(key) || [];
      existing.openApiRequestTargets = openApiRequestTargets.get(key) || [];
      bySpan.set(key, existing);
    }
    for (const node of openApiResponseNodes) {
      const key = `${node.service}\u0000${node.spanId}`;
      const existing = bySpan.get(key) || emptyTraceNode(node);
      existing.openApiResponseCount = node.count;
      existing.openApiResponseAt = node.firstSeen;
      existing.openApiResponseTimes = openApiResponseTimes.get(key) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.openApiResponseLogSteps = openApiResponseLogSteps.get(key) || [];
      existing.openApiResponseDurations = openApiResponseDurations.get(key) || [];
      existing.openApiResponseSamples = openApiResponseSamples.get(key) || [];
      existing.openApiResponseLevel3Count = openApiResponseLevel3Counts.get(key) || 0;
      existing.openApiResponseTargets = openApiResponseTargets.get(key) || [];
      bySpan.set(key, existing);
    }
    for (const node of gorodClientNodes) {
      const key = `${node.service}\u0000${node.spanId}`;
      const existing = bySpan.get(key) || emptyTraceNode(node);
      existing.gorodClientRequestCount = node.count;
      existing.gorodClientRequestAt = node.firstSeen;
      existing.gorodClientRequestTimes = gorodClientRequestTimes.get(key) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.gorodClientRequestLogSteps = gorodClientRequestLogSteps.get(key) || [];
      existing.gorodClientRequestTargets = gorodClientRequestTargets.get(key) || [];
      bySpan.set(key, existing);
    }
    for (const node of gorodClientResponseNodes) {
      const key = `${node.service}\u0000${node.spanId}`;
      const existing = bySpan.get(key) || emptyTraceNode(node);
      existing.gorodClientResponseCount = node.count;
      existing.gorodClientResponseAt = node.firstSeen;
      existing.gorodClientResponseTimes = gorodClientResponseTimes.get(key) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.gorodClientResponseLogSteps = gorodClientResponseLogSteps.get(key) || [];
      existing.gorodClientResponseDurations = gorodClientResponseDurations.get(key) || [];
      existing.gorodClientResponseSamples = gorodClientResponseSamples.get(key) || [];
      existing.gorodClientResponseLevel3Count = gorodClientResponseLevel3Counts.get(key) || 0;
      existing.gorodClientResponseTargets = gorodClientResponseTargets.get(key) || [];
      bySpan.set(key, existing);
    }
    for (const node of partnerBackendNodes) {
      const key = `${node.service}\u0000${node.spanId}`;
      const existing = bySpan.get(key) || emptyTraceNode(node);
      existing.partnerBackendRequestCount = node.count;
      existing.partnerBackendRequestAt = node.firstSeen;
      existing.partnerBackendRequestTimes = partnerBackendRequestTimes.get(key) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.partnerBackendRequestLogSteps = partnerBackendRequestLogSteps.get(key) || [];
      existing.partnerBackendRequestTargets = partnerBackendRequestTargets.get(key) || [];
      bySpan.set(key, existing);
    }
    for (const node of partnerBackendResponseNodes) {
      const key = `${node.service}\u0000${node.spanId}`;
      const existing = bySpan.get(key) || emptyTraceNode(node);
      existing.partnerBackendResponseCount = node.count;
      existing.partnerBackendResponseAt = node.firstSeen;
      existing.partnerBackendResponseTimes = partnerBackendResponseTimes.get(key) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.partnerBackendResponseLogSteps = partnerBackendResponseLogSteps.get(key) || [];
      existing.partnerBackendResponseDurations = partnerBackendResponseDurations.get(key) || [];
      existing.partnerBackendResponseSamples = partnerBackendResponseSamples.get(key) || [];
      existing.partnerBackendResponseLevel3Count = partnerBackendResponseLevel3Counts.get(key) || 0;
      existing.partnerBackendResponseTargets = partnerBackendResponseTargets.get(key) || [];
      bySpan.set(key, existing);
    }
    for (const node of kafkaProduceNodes) {
      const exactKey = `${node.service}\u0000${node.spanId}`;
      const sameSpanKeys = [...bySpan.keys()].filter((key) => key.endsWith(`\u0000${node.spanId}`));
      const key = bySpan.has(exactKey) || sameSpanKeys.length !== 1 ? exactKey : sameSpanKeys[0];
      const existing = bySpan.get(key) || emptyTraceNode(node);
      existing.kafkaProduceCount = node.count;
      existing.kafkaProduceAt = node.firstSeen;
      existing.kafkaProduceTimes = kafkaProduceTimes.get(exactKey) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.kafkaProduceLogSteps = kafkaProduceLogSteps.get(exactKey) || [];
      existing.kafkaProduces = kafkaProduces.get(exactKey) || [];
      bySpan.set(key, existing);
    }
    for (const node of kafkaConsumeNodes) {
      const exactKey = `${node.service}\u0000${node.spanId}`;
      // Consumer evidence belongs to its logging service and span. Reusing a
      // span ID in another service is not enough to move the event there.
      const existing = bySpan.get(exactKey) || emptyTraceNode(node);
      existing.kafkaConsumeCount = node.count;
      existing.kafkaConsumeAt = node.firstSeen;
      existing.kafkaConsumeTimes = kafkaConsumeTimes.get(exactKey) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.kafkaConsumeLogSteps = kafkaConsumeLogSteps.get(exactKey) || [];
      existing.kafkaConsumes = kafkaConsumes.get(exactKey) || [];
      bySpan.set(exactKey, existing);
    }
    for (const node of kafkaBrokerNodes) {
      const exactKey = `${node.service}\u0000${node.spanId}`;
      // Infrastructure records remain owned by the exact instance/span pair.
      // Address and offset were removed before this model was built.
      const existing = bySpan.get(exactKey) || emptyTraceNode(node);
      existing.kafkaBrokerCount = node.count;
      existing.kafkaBrokerAt = node.firstSeen;
      existing.kafkaBrokerTimes = kafkaBrokerTimes.get(exactKey) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.kafkaBrokerLogSteps = kafkaBrokerLogSteps.get(exactKey) || [];
      existing.kafkaBrokers = kafkaBrokers.get(exactKey) || [];
      const hints=[...new Set(existing.kafkaBrokers.map(event=>event.directionHint).filter(value=>value==='produce'||value==='consume'))];
      existing.kafkaRoleHint=hints.length===1?hints[0]:null;
      bySpan.set(exactKey, existing);
    }
    for (const node of xmlProcedureRequestNodes) {
      const exactKey = `${node.service}\u0000${node.spanId}`;
      const existing = bySpan.get(exactKey) || emptyTraceNode(node);
      existing.xmlProcedureRequestCount = node.count;
      existing.xmlProcedureRequestAt = node.firstSeen;
      existing.xmlProcedureRequestTimes = xmlProcedureRequestTimes.get(exactKey) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.xmlProcedureRequestLogSteps = xmlProcedureRequestLogSteps.get(exactKey) || [];
      existing.xmlProcedureRequests = xmlProcedureRequests.get(exactKey) || [];
      bySpan.set(exactKey, existing);
    }
    for (const node of xmlProcedureResponseNodes) {
      const exactKey = `${node.service}\u0000${node.spanId}`;
      const existing = bySpan.get(exactKey) || emptyTraceNode(node);
      existing.xmlProcedureResponseCount = node.count;
      existing.xmlProcedureResponseAt = node.firstSeen;
      existing.xmlProcedureResponseTimes = xmlProcedureResponseTimes.get(exactKey) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.xmlProcedureResponseLogSteps = xmlProcedureResponseLogSteps.get(exactKey) || [];
      existing.xmlProcedureResponseDurations = xmlProcedureResponseDurations.get(exactKey) || [];
      existing.xmlProcedureResponseSamples = xmlProcedureResponseSamples.get(exactKey) || [];
      bySpan.set(exactKey, existing);
    }
    for (const node of cacheAccessNodes) {
      const exactKey = `${node.service}\u0000${node.spanId}`;
      // A reused span ID from another service is not evidence of ownership.
      const key = exactKey;
      if (!bySpan.has(key)) continue;
      const existing = bySpan.get(key);
      existing.cacheAccessCount = node.count;
      existing.cacheAccessAt = node.firstSeen;
      existing.cacheAccessTimes = cacheAccessTimes.get(exactKey) || (node.firstSeen === null ? [] : [node.firstSeen]);
      existing.cacheAccessLogSteps = cacheAccessLogSteps.get(exactKey) || [];
      existing.cacheAccesses = cacheAccesses.get(exactKey) || [];
      bySpan.set(key, existing);
    }
    for (const [key, node] of bySpan) {
      node.parentSpanIds = parentIds.get(key) || [];
      node.spanKinds = spanKinds.get(key) || [];
      node.identityFields = identityFields.get(key) || [];
      node.jobNames = jobNames.get(key) || [];
      node.httpRouteHints = httpRouteHints.get(key) || [];
      node.batchKeys = batchKeys.get(key) || [];
      node.threadKinds = threadKinds.get(key) || [];
      node.streamIds = streamIds.get(key) || [];
      node.streamMetadataComplete = streamMetadataComplete.get(key) === true;
      for (const [property, labels] of labelSources) {
        node[property] = [...(node[property] || []), ...(labels.get(key) || [])]
          .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
      }
    }
    absorbDuplicateOpenApiGatewayEntries(bySpan);
    recoverSplitResponses(bySpan);
    recoverProcedureResponses(bySpan);
    for(const node of bySpan.values()){
      const completed=(node.httpRouteHints||[]).filter(hint=>hint.provenance==='access-completion'&&hint.direction==='incoming'&&Number.isFinite(hint.at)&&Number.isFinite(hint.endAt));
      if(node.requestCount===0&&node.responseCount===1&&completed.length===1){
        const hint=completed[0];node.completedOperation={start:hint.at,end:hint.endAt,duration:hint.duration,source:'access-completion',inferredStart:true};
      }
    }
    const nodes = [...bySpan.values()].sort((left, right) => {
      const leftTime = left.requestAt ?? left.openApiRequestAt ?? left.gorodClientRequestAt ?? left.partnerBackendRequestAt ?? left.kafkaProduceAt ?? left.kafkaConsumeAt ?? left.kafkaBrokerAt ?? left.xmlProcedureRequestAt ?? left.xmlProcedureResponseAt ?? left.cacheAccessAt ?? left.responseAt ?? left.openApiResponseAt ?? left.gorodClientResponseAt ?? left.partnerBackendResponseAt;
      const rightTime = right.requestAt ?? right.openApiRequestAt ?? right.gorodClientRequestAt ?? right.partnerBackendRequestAt ?? right.kafkaProduceAt ?? right.kafkaConsumeAt ?? right.kafkaBrokerAt ?? right.xmlProcedureRequestAt ?? right.xmlProcedureResponseAt ?? right.cacheAccessAt ?? right.responseAt ?? right.openApiResponseAt ?? right.gorodClientResponseAt ?? right.partnerBackendResponseAt;
      if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return leftTime - rightTime;
      if (leftTime !== null) return -1;
      if (rightTime !== null) return 1;
      return left.service.localeCompare(right.service, "ru") || left.spanId.localeCompare(right.spanId, "ru");
    });
    const serviceTotals = new Map();
    for (const node of nodes) if (node.requestCount > 0 || node.openApiRequestCount > 0 || node.gorodClientRequestCount > 0 || node.partnerBackendRequestCount > 0) serviceTotals.set(node.service, (serviceTotals.get(node.service) || 0) + 1);
    const serviceSeen = new Map();
    for (const node of nodes) {
      node.serviceCallTotal = serviceTotals.get(node.service) || 0;
      if (node.serviceCallTotal) {
        const ordinal = (serviceSeen.get(node.service) || 0) + 1;
        serviceSeen.set(node.service, ordinal);
        node.serviceCallOrdinal = ordinal;
      } else node.serviceCallOrdinal = 0;
    }
    annotateCrossServiceResponses(nodes);
    const closedCalls=nodes.map(outgoingCallWindows);
    // Rendering and parent anchors share the same proven call pairing. Keep
    // only safe coordinates, including exchanges that have no downstream node.
    nodes.forEach((node,index)=>{node.clientExchanges=closedCalls[index].filter(call=>!call.requestInferred).map(call=>({...call.parentCall}));});
    for (let childIndex = 0; childIndex < nodes.length; childIndex += 1) {
      const child = nodes[childIndex];
      const kafkaProduceOnly = child.kafkaProduceCount > 0
        && child.requestCount === 0 && child.responseCount === 0
        && child.openApiRequestCount === 0 && child.openApiResponseCount === 0
        && child.gorodClientRequestCount === 0 && child.gorodClientResponseCount === 0
        && child.partnerBackendRequestCount === 0 && child.partnerBackendResponseCount === 0;
      const kafkaConsumeOnly = child.kafkaConsumeCount > 0 && child.kafkaProduceCount === 0
        && child.requestCount === 0 && child.responseCount === 0
        && child.openApiRequestCount === 0 && child.openApiResponseCount === 0
        && child.gorodClientRequestCount === 0 && child.gorodClientResponseCount === 0
        && child.partnerBackendRequestCount === 0 && child.partnerBackendResponseCount === 0;
      child.parentIndex = null;
      child.depth = 0;
      if(child.crossServiceResponseOwner&&child.requestCount===0)continue;
      // A consume checkpoint does not prove which producer caused it. Its only
      // causal Kafka link is resolved below by topic and event time.
      if (kafkaConsumeOnly) continue;
      const childTimes = [
        ...child.requestTimes, ...child.responseTimes,
        ...child.openApiRequestTimes, ...child.openApiResponseTimes,
        ...child.gorodClientRequestTimes, ...child.gorodClientResponseTimes,
        ...child.partnerBackendRequestTimes, ...child.partnerBackendResponseTimes,
        ...child.kafkaProduceTimes, ...child.kafkaConsumeTimes, ...child.kafkaBrokerTimes, ...child.xmlProcedureRequestTimes, ...child.xmlProcedureResponseTimes, ...child.cacheAccessTimes
      ].filter((value) => value !== null && Number.isFinite(Number(value))).map(Number);
      if (!childTimes.length) continue;
      const childStart = child.completedOperation?.start ?? Math.min(...childTimes);
      const childEnd = Math.max(...childTimes);
      const childComplete = child.requestAt !== null && child.responseAt !== null && child.responseAt >= child.requestAt;
      let bestIndex = null;
      let bestDuration = Infinity;
      let bestUsesDuration = false;
      let intervalTied = false;
      const possibleParents=[];
      for (let candidateIndex = 0; candidateIndex < nodes.length; candidateIndex += 1) {
        if (candidateIndex === childIndex) continue;
        const candidate = nodes[candidateIndex];
        // Separate spans of one service do not establish a recursive network call.
        if (candidate.service === child.service && !kafkaProduceOnly && !candidate.xmlProcedureRequestCount && !child.xmlProcedureRequestCount) continue;
        if(kafkaProduceOnly && candidate.service!==child.service)continue;
        const rawOutgoing=[...(candidate.httpRouteHints||[]).filter(hint=>hint.direction==='outgoing'),
          ...closedCalls[candidateIndex].filter(call=>call.requestInferred).map(call=>({...call,at:call.start}))];
        const rawIncoming=(child.httpRouteHints||[]).filter(hint=>hint.direction==='incoming');
        const outgoing=rawOutgoing.length?rawOutgoing:[...(candidate.openApiRequestTargets||[]),...(candidate.gorodClientRequestTargets||[]),...(candidate.partnerBackendRequestTargets||[])];
        const incoming=rawIncoming.length?rawIncoming:child.requestTargets||[];
        const routeMatches=outgoing.filter(out=>incoming.some(inc=>{
          // Never equate different private paths merely because both display as /*.
          const sameRoute=out.routeKey&&inc.routeKey?out.routeKey===inc.routeKey
            :!out.routeKey&&!inc.routeKey&&out.url&&!/[{}*]/.test(out.url)&&out.url.split(/[?#]/,1)[0].replace(/\/+$/, '')===String(inc.url||'').split(/[?#]/,1)[0].replace(/\/+$/, '');
          return sameRoute && (!inc.method||!out.method||inc.method===out.method) && Number.isFinite(out.at)
            && out.at<=childStart && (!Number.isFinite(inc.at)||out.at<=inc.at);
        }));
        const httpMatch=routeMatches.length>0;
        const routeMethodExact=httpMatch&&routeMatches.some(out=>rawIncoming.some(inc=>inc.routeKey===out.routeKey&&inc.method&&out.method&&inc.method===out.method));
        const differentSchema=candidate.identityFields.length && child.identityFields.length && !candidate.identityFields.some(field=>child.identityFields.includes(field));
        if(differentSchema && !httpMatch)continue;
        if(candidate.service!==child.service && candidate.identityFields.includes('instance-name') && child.identityFields.includes('instance-name') && !httpMatch)continue;
        let window=operationWindow(candidate);
        const matchedRouteCalls=httpMatch?closedCalls[candidateIndex].filter(call=>routeMatches.some(route=>route.routeKey&&call.routeKey?route.routeKey===call.routeKey:!route.routeKey&&!call.routeKey&&route.url===call.url)):[];
        const matchedCalls=matchedRouteCalls.filter(call=>call.start<=childStart&&call.end>=childEnd);
        if(matchedRouteCalls.length&&!matchedCalls.length)continue;
        if(matchedCalls.length>1)continue;
        if(matchedCalls.length===1)window=matchedCalls[0];
        const candidateStarts = window ? [window.start] : candidate.requestTimes.length===1 && !candidate.responseTimes.length ? candidate.requestTimes : [];
        const candidateEnds = window ? [window.end] : [];
        let usesDuration = matchedCalls[0]?.requestInferred===true;
        if (!candidateEnds.length && candidateStarts.length && candidate.responseDuration !== null && Number.isFinite(Number(candidate.responseDuration)) && Number(candidate.responseDuration) >= 0) {
          candidateEnds.push(Math.min(...candidateStarts) + Number(candidate.responseDuration));
          usesDuration = true;
        }
        if (!candidateStarts.length || !candidateEnds.length) continue;
        const candidateStart = Math.min(...candidateStarts);
        const candidateEnd = Math.max(...candidateEnds);
        if (candidateEnd < candidateStart) continue;
        const contains = candidateStart <= childStart && candidateEnd >= childEnd;
        const strict = candidateStart < childStart || candidateEnd > childEnd;
        const duration = candidateEnd - candidateStart;
        // The outer handler may continue long after its outbound request. When
        // that call has one explicit reply, use its tighter observed interval.
        const clientEnds=[...candidate.openApiResponseTimes,...candidate.gorodClientResponseTimes,...candidate.partnerBackendResponseTimes];
        const withinHttpCall=matchedCalls.length===1||!httpMatch||clientEnds.length!==1||childEnd<=clientEnds[0];
        if(contains && (strict||httpMatch&&matchedCalls.length===1) && withinHttpCall)possibleParents.push({index:candidateIndex,start:candidateStart,end:candidateEnd,httpMatch,routeMethodExact,
          usesDuration,duration,distance:Math.max(0,childStart-candidateStart),parentCall:matchedCalls[0]?.parentCall});
        if(!withinHttpCall)continue;
        if (contains && strict && duration === bestDuration) intervalTied = true;
        if (contains && strict && duration < bestDuration) { bestIndex = candidateIndex; bestDuration = duration; bestUsesDuration = usesDuration; intervalTied = false; }
      }
      const matchedHttp=possibleParents.filter(item=>item.httpMatch);
      let heuristicDecision=null;
      if(matchedHttp.length){
        heuristicDecision=heuristicResolver?.resolveUnique?.(matchedHttp.map(item=>({...item,
          distance:0,width:Infinity,
          evidence:[item.routeMethodExact?'exact-route-method':'exact-route','closed-window',...(item.usesDuration?['duration-window']:[])]})))||null;
        bestIndex=heuristicDecision?.winner?.index??null;bestUsesDuration=heuristicDecision?.winner?.usesDuration===true;intervalTied=bestIndex===null;
      }
      else if(possibleParents.some((left,i)=>possibleParents.slice(i+1).some(right=>!(left.start<=right.start&&left.end>=right.end)&&!(right.start<=left.start&&right.end>=left.end))))intervalTied=true;
      if (intervalTied) bestIndex = null;
      child.unresolvedParentCandidates=possibleParents.map(item=>item.index).filter((value,index,all)=>all.indexOf(value)===index).slice(0,6);
      let inference = bestIndex === null ? null : matchedHttp.length===1 ? "http-target-window" : kafkaProduceOnly ? "kafka-timestamp" : bestUsesDuration ? "duration-window" : childComplete ? "interval" : "single-timestamp";
      if (bestIndex === null && kafkaProduceOnly) {
        let bestOpenStart = -Infinity;
        let bestClosedGap = Infinity;
        for (let candidateIndex = 0; candidateIndex < nodes.length; candidateIndex += 1) {
          if (candidateIndex === childIndex) continue;
          const candidate = nodes[candidateIndex];
          if(candidate.service!==child.service)continue;
          const candidateStarts = candidate.requestTimes.length ? candidate.requestTimes : candidate.requestAt === null ? [] : [candidate.requestAt];
          if (!candidateStarts.length) continue;
          const candidateStart = Math.min(...candidateStarts);
          if (candidateStart > childStart) continue;
          const candidateEnds = candidate.responseTimes.length ? candidate.responseTimes : candidate.responseAt === null ? [] : [candidate.responseAt];
          if (!candidateEnds.length) {
            if (candidateStart > bestOpenStart) { bestIndex = candidateIndex; bestOpenStart = candidateStart; bestClosedGap = Infinity; }
            continue;
          }
          const gap = childStart - Math.max(...candidateEnds);
          if (bestOpenStart === -Infinity && gap >= 0 && gap <= 100 && gap < bestClosedGap) { bestIndex = candidateIndex; bestClosedGap = gap; }
        }
        if (bestIndex !== null) inference = "kafka-timestamp";
      }
      child.parentIndex = bestIndex;
      child.parentInference = inference;
      child.heuristicConfidence=bestIndex===null?null:(heuristicDecision?.confidence||'low');
      child.heuristicEvidence=bestIndex===null?[]:(heuristicDecision?.evidence||[bestUsesDuration?'duration-window':'time-window']);
      const anchoredCall=possibleParents.find(item=>item.index===bestIndex&&item.httpMatch)?.parentCall;
      if(anchoredCall)child.parentCall={...anchoredCall};
      child.httpCallerService = bestIndex === null ? "Внешний источник" : String(nodes[bestIndex]?.service || "Внешний источник");
      child.httpCallerKey = bestIndex === null ? `Внешний источник → ${String(child.service || "неизвестный сервис")}` : child.httpCallerService;
    }
    // A consume has no HTTP response window. The structured batch can still
    // associate its subsequent local work without serializing other batches.
    for(const [index,child] of nodes.entries()){
      if(child.parentIndex!==null||child.kafkaConsumeCount||child.kafkaBrokerCount||!child.batchKeys.length)continue;
      const start=child.requestAt??child.xmlProcedureRequestAt??child.kafkaProduceAt;
      if(start===null||start===undefined)continue;
      const owners=nodes.flatMap((node,i)=>i!==index&&node.service===child.service&&(node.kafkaConsumeCount>0||node.kafkaBrokerCount>0)
        &&(node.kafkaConsumeAt??node.kafkaBrokerAt)!==null&&(node.kafkaConsumeAt??node.kafkaBrokerAt)<=start&&node.batchKeys.some(key=>child.batchKeys.includes(key))?[i]:[]);
      if(owners.length===1){child.parentIndex=owners[0];child.parentInference='consumer-batch';}
    }
    // Parent IDs also work when timestamps are missing. Do not fall back to a
    // guessed caller when a declared parent is missing or ambiguous.
    for (const [childIndex, child] of nodes.entries()) {
      const matches = nodes.flatMap((candidate, index) => index !== childIndex && child.parentSpanIds.some((id) => candidate.spanId === id || candidate.recoveredSpanIds?.includes(id)) ? [index] : []);
      if (child.parentSpanIds.length) {
        child.parentIndex = matches.length === 1 ? matches[0] : null;
        child.parentInference = child.parentIndex === null ? null : "parent-span";
        child.heuristicConfidence = child.parentIndex === null ? null : "observed";
        child.heuristicEvidence = child.parentIndex === null ? [] : ["explicit-parent"];
      }
    }
    // Apply a cross-service response pair only when ordinary interval and
    // explicit parentSpan evidence did not already determine ownership.
    for(const child of nodes){
      const pair=child.crossServicePair;
      if(!pair||child.parentSpanIds.length||child.parentIndex!==null&&!['interval','single-timestamp','duration-window'].includes(child.parentInference))continue;
      if(nodes[pair.parentIndex]){child.parentIndex=pair.parentIndex;child.parentInference='cross-service-response';
        child.heuristicConfidence=pair.heuristicConfidence||'high';child.heuristicEvidence=[...(pair.heuristicEvidence||[])];}
    }
    // When a raw OpenAPI URI first links our client to an OpenAPI gateway,
    // an instance operation with the same URI belongs below that gateway.
    // This refines an otherwise direct client → instance match without using
    // service-name text alone.
    for(const [index,child] of nodes.entries()){
      if(child.parentInference!=='http-target-window'||child.parentSpanIds.length||!child.identityFields.includes('instance-name')||child.identityFields.includes('service-name'))continue;
      const clientIndex=child.parentIndex;
      const childHints=(child.httpRouteHints||[]).filter(hint=>hint.direction==='incoming'&&hint.routeKey);
      if(!childHints.length)continue;
      const times=[...child.requestTimes,...child.responseTimes,...child.xmlProcedureRequestTimes,...child.xmlProcedureResponseTimes].filter(Number.isFinite);
      if(!times.length)continue;
      const start=child.completedOperation?.start??Math.min(...times),end=Math.max(...times);
      const candidates=nodes.flatMap((gateway,gatewayIndex)=>{
        if(gatewayIndex===index||gateway.parentIndex!==clientIndex||!openApiGatewayNode(gateway))return [];
        const window=operationWindow(gateway);if(!window||window.start>start||window.end<end)return [];
        const routeMatch=(gateway.httpRouteHints||[]).some(g=>g.direction==='incoming'&&g.routeKey&&childHints.some(c=>c.routeKey===g.routeKey));
        return routeMatch?[gatewayIndex]:[];
      });
      if(candidates.length===1){child.parentIndex=candidates[0];child.parentInference='openapi-gateway-window';child.operationAssociation='gateway-uri-window';delete child.parentCall;}
    }
    // An operation matched to an outgoing URI can own its nearest subsequent
    // procedure even when that procedure is emitted by a different instance.
    // This remains a temporal assumption, never an observed HTTP call.
    const procedureProposals=new Map();
    for(const [ownerIndex,owner] of nodes.entries()){
      if(owner.parentInference!=='http-target-window')continue;
      const window=operationWindow(owner);if(!window)continue;
      const candidates=nodes.flatMap((child,index)=>{
        if(index===ownerIndex||!child.xmlProcedureRequestCount||!child.identityFields.includes('instance-name')||child.identityFields.includes('service-name')||child.parentSpanIds.length||child.batchKeys.length||child.kafkaConsumeCount)return [];
        if(child.parentIndex!==null&&child.parentIndex!==ownerIndex)return [];
        if((child.httpRouteHints||[]).some(hint=>hint.direction==='incoming'))return [];
        const start=child.xmlProcedureRequestAt,end=Math.max(...child.xmlProcedureRequestTimes,...child.xmlProcedureResponseTimes);
        return Number.isFinite(start)&&start>=window.start&&end<=window.end?[{index,start}]:[];
      });
      const nearest=Math.min(...candidates.map(item=>item.start));
      const first=candidates.filter(item=>item.start===nearest);
      if(first.length!==1)continue;
      const proposal=procedureProposals.get(first[0].index)||[];
      proposal.push({ownerIndex,start:window.start});procedureProposals.set(first[0].index,proposal);
    }
    for(const [index,proposals] of procedureProposals){
      const child=nodes[index];if(child.parentIndex!==null)continue;
      const closest=Math.max(...proposals.map(item=>item.start)),owners=proposals.filter(item=>item.start===closest);
      if(owners.length!==1)continue;
      child.parentIndex=owners[0].ownerIndex;child.parentInference=openApiGatewayNode(nodes[owners[0].ownerIndex])?'openapi-gateway-window':'openapi-window';
      child.operationAssociation='nearest-procedure-after-uri';
    }
    // User-authorized fallback: instance operations inside one closed OpenAPI
    // or PARTNER BACKEND exchange are shown as its assumed branch. It never overrides URI/span/
    // batch evidence, and concurrent client calls cannot pick an arbitrary owner.
    const clientOpenApiWindows=closedCalls.flatMap((calls,index)=>calls.filter(call=>['openApi','partnerBackend'].includes(call.parentCall.family)).map(call=>({...call,index,entryGateway:false})));
    const gatewayOpenApiWindows=nodes.flatMap((node,index)=>{
      if(!openApiGatewayNode(node))return [];
      const window=operationWindow(node);if(!window)return [];
      const hint=(node.httpRouteHints||[]).find(item=>item.direction==='incoming'&&Number.isFinite(item.at)&&item.at>=window.start-2&&item.at<=window.end)
        ||node.requestTargets?.[0]||{};
      return [{...window,index,entryGateway:true,url:hint.url||'',routeKey:hint.routeKey||null}];
    });
    const openApiWindows=[...clientOpenApiWindows,...gatewayOpenApiWindows];
    for(const [index,child] of nodes.entries()){
      if(child.parentIndex!==null||child.parentSpanIds.length||!child.identityFields.includes('instance-name')||child.identityFields.includes('service-name')||child.kafkaConsumeCount||(child.kafkaBrokerCount&&child.batchKeys.length))continue;
      if((child.httpRouteHints||[]).some(hint=>hint.direction==='incoming'))continue;
      const times=[...child.requestTimes,...child.responseTimes,...child.xmlProcedureRequestTimes,...child.xmlProcedureResponseTimes,...child.kafkaProduceTimes,...child.kafkaBrokerTimes].filter(Number.isFinite);
      if(!times.length)continue;
      const start=child.completedOperation?.start??Math.min(...times),end=Math.max(...times);
      const candidates=openApiWindows.filter(window=>window.index!==index&&window.start<=start&&window.end>=end);
      const gatewayCandidates=candidates.filter(candidate=>candidate.entryGateway);
      const clientCandidates=candidates.filter(candidate=>!candidate.entryGateway);
      // Окно вызываемого gateway вложено в окно вызывающего, поэтому по одному
      // лишь времени оно всегда выглядит «точнее». Но действие, у которого нет
      // ничего кроме instance-name, с тем же успехом принадлежит вызывающему:
      // продюс в топик, сделанный сервисом рядом со своим вызовом OpenAPI,
      // становился ребёнком OpenAPI и переворачивал причинность — выходило,
      // что вызываемый спровоцировал действие вызывающего. Вложенный gateway
      // перебивает вызывающего только при положительном совпадении имени
      // операции и URI маршрута; иначе выбор идёт среди окон вызывающего.
      const affineGateways=clientCandidates.length
        ? gatewayCandidates.filter(candidate=>openApiNameUriScore(child.service,candidate.url)>0)
        : gatewayCandidates;
      const selectionPool=affineGateways.length
        ? affineGateways
        : clientCandidates.length ? clientCandidates : gatewayCandidates;
      let selected=selectionPool.length===1?selectionPool[0]:null,inference=selected?.entryGateway?'openapi-gateway-window':selected?.parentCall?.family==='partnerBackend'?'partner-backend-window':'openapi-window';
      if(!selected&&selectionPool.length>1){
        const scored=selectionPool.map(candidate=>({candidate,score:openApiNameUriScore(child.service,candidate.url)}));
        const best=Math.max(0,...scored.map(item=>item.score)),winners=scored.filter(item=>item.score===best&&best>0);
        if(winners.length===1){selected=winners[0].candidate;inference=selected.entryGateway?'openapi-gateway-window':selected.parentCall?.family==='partnerBackend'?'partner-backend-name-uri':'openapi-name-uri';}
      }
      if(selected){child.parentIndex=selected.index;child.parentInference=inference;child.parentCall={...selected.parentCall};
        if(!selected.parentCall)delete child.parentCall;
        if(inference==='openapi-name-uri'||inference==='partner-backend-name-uri')child.operationAssociation='service-uri-token';
        if(inference==='openapi-gateway-window')child.operationAssociation=gatewayCandidates.length>1?'gateway-service-uri-token':'openapi-gateway-entry';}
    }
    // A response-only canonical service-name ending in "gateway" at the end
    // of the trace is evidence of a lost entry log. Reconstruct only one
    // unambiguous root from the same application family and label the result.
    const allTimes=nodes.flatMap(node=>[
      ...node.requestTimes,...node.responseTimes,...node.openApiRequestTimes,...node.openApiResponseTimes,
      ...node.gorodClientRequestTimes,...node.gorodClientResponseTimes,...node.partnerBackendRequestTimes,...node.partnerBackendResponseTimes,...node.kafkaProduceTimes,...node.kafkaConsumeTimes,
      ...node.kafkaBrokerTimes,...node.xmlProcedureRequestTimes,...node.xmlProcedureResponseTimes,...node.cacheAccessTimes
    ]).filter(Number.isFinite);
    const traceEnd=allTimes.length?Math.max(...allTimes):null;
    for(const [gatewayIndex,gateway] of nodes.entries()){
      if(!canonicalGatewayNode(gateway)||gateway.parentIndex!==null||gateway.requestCount!==0||gateway.responseCount<1||gateway.responseAt!==traceEnd)continue;
      const familyCandidates=nodes.flatMap((node,index)=>index!==gatewayIndex&&node.parentIndex===null&&node.requestCount>0&&!node.kafkaConsumeCount
        &&sameApplicationFamily(gateway.service,node.service)&&(node.requestAt??Infinity)<gateway.responseAt?[index]:[]);
      const duration=gateway.responseCount===1?gateway.responseDuration:null;
      const start=typeof duration==='number'&&Number.isFinite(duration)&&duration>=0?gateway.responseAt-duration:null;
      const replies=(gateway.httpRouteHints||[]).filter(h=>h.direction==='incoming-response'&&h.routeKey);
      const routeCandidates=start===null?[]:nodes.flatMap((node,index)=>{
        if(index===gatewayIndex||node.parentIndex!==null||node.parentSpanIds.length||!node.requestCount||node.kafkaConsumeCount||node.requestAt<start||node.requestAt>=gateway.responseAt)return [];
        const direct=(node.httpRouteHints||[]).filter(h=>h.direction==='incoming'&&h.provenance==='message');
        if(!direct.some(h=>replies.some(reply=>reply.routeKey===h.routeKey)))return [];
        const times=[...node.responseTimes,...node.openApiResponseTimes,...node.gorodClientResponseTimes,...node.partnerBackendResponseTimes];
        return times.some(t=>t>gateway.responseAt)?[]:[index];
      });
      const candidates=routeCandidates.length?routeCandidates:familyCandidates;
      if(candidates.length!==1)continue;
      const child=nodes[candidates[0]];
      child.parentIndex=gatewayIndex;child.parentInference='gateway-envelope';
      child.heuristicConfidence='medium';child.heuristicEvidence=routeCandidates.length?['exact-route','duration-window']:['time-window'];
      gateway.reconstructedEntry={at:Math.max(0,routeCandidates.length?start:Math.min(...allTimes)-1),childIndex:candidates[0],confidence:'inferred',
        reason:routeCandidates.length?'Финальный RESPONSE gateway: единственный вход с тем же URI внутри duration. REQUEST gateway не наблюдался.':'Финальный RESPONSE gateway наблюдается, входящий REQUEST отсутствует; начало цепочки восстановлено внутри одной семьи service-name.'};
    }
    // Break an edge inside the cycle, preferring a temporal guess over exact
    // span ancestry. Array/timestamp order must not sever a declared parent,
    // or an innocent descendant that merely leads into a corrupt cycle.
    for (let index = 0; index < nodes.length; index += 1) {
      const path = [], seen = new Map();
      let cursor = index;
      while (Number.isInteger(cursor)) {
        if (seen.has(cursor)) {
          const cycle = path.slice(seen.get(cursor));
          const cut = cycle.find(nodeIndex => nodes[nodeIndex].parentInference !== "parent-span") ?? cycle[0];
          nodes[cut].parentIndex = null;
          nodes[cut].parentInference = null;
          break;
        }
        seen.set(cursor, path.length); path.push(cursor); cursor = nodes[cursor].parentIndex;
      }
    }
    for (const node of nodes) {
      // `openapi-name-uri` is still anchored to one concrete closed OPENAPI
      // exchange. Keep that safe call coordinate so layout draws the edge from
      // the OPENAPI box itself instead of falling back to its owner service.
      if(node.parentIndex===null||!['http-target-window','openapi-window','openapi-name-uri','partner-backend-window','partner-backend-name-uri'].includes(node.parentInference))delete node.parentCall;
      node.httpCallerService = node.parentIndex === null ? "Внешний источник" : nodes[node.parentIndex].service;
      node.httpCallerKey = node.parentIndex === null ? "Внешний источник → " + node.service : node.httpCallerService;
    }
    const depthFor = (index, seen = new Set()) => {
      const parent = nodes[index].parentIndex;
      if (parent === null || seen.has(parent)) return 0;
      seen.add(parent);
      return 1 + depthFor(parent, seen);
    };
    nodes.forEach((_node, index) => { nodes[index].depth = depthFor(index); });
    // Match a consume only to the unique closest earlier produce of the same
    // topic. Equal timestamps, missing timestamps and ties stay deliberately
    // unlinked: none of them proves producer causality.
    const producerEvents = nodes.flatMap((node, producerNodeIndex) => (Array.isArray(node.kafkaProduces) ? node.kafkaProduces : []).map((event, producerDetailIndex) => ({
      producerNodeIndex, producerDetailIndex, topic:String(event?.topic || ""), at:Number(event?.at)
    })).filter((event) => event.topic && Number.isFinite(event.at)));
    const kafkaLinks = [];
    nodes.forEach((node, consumerNodeIndex) => {
      (Array.isArray(node.kafkaConsumes) ? node.kafkaConsumes : []).forEach((event, consumerDetailIndex) => {
        const topic = String(event?.topic || ""), consumedAt = Number(event?.at);
        if (!topic || !Number.isFinite(consumedAt)) return;
        const candidates = producerEvents.filter((producer) => producer.topic === topic && producer.at < consumedAt);
        if (!candidates.length) return;
        const producedAt = Math.max(...candidates.map((producer) => producer.at));
        const closest = candidates.filter((producer) => producer.at === producedAt);
        if (closest.length !== 1) return;
        const producer = closest[0];
        kafkaLinks.push({ producerNodeIndex:producer.producerNodeIndex, producerDetailIndex:producer.producerDetailIndex,
          consumerNodeIndex, consumerDetailIndex, topic, producedAt, consumedAt });
      });
    });
    const edges = nodes.flatMap((node, to) => {
      if (node.parentIndex === null) return [];
      // A CLIENT span under an explicit same-service parent is local tracing
      // structure, not evidence of a network call to the service itself.
      const spanAssociation = node.parentInference === "parent-span"
        && node.service === nodes[node.parentIndex].service
        && node.spanKinds.includes("client") && !node.spanKinds.includes("server");
      if (spanAssociation) node.clientSpanAssociation = true;
      const kafkaObserved = node.kafkaProduceCount > 0
        && node.requestCount === 0 && node.responseCount === 0
        && node.openApiRequestCount === 0 && node.openApiResponseCount === 0
        && node.gorodClientRequestCount === 0 && node.gorodClientResponseCount === 0
        && node.partnerBackendRequestCount === 0 && node.partnerBackendResponseCount === 0;
      return [{
        from: node.parentIndex,
        to,
        requestObserved: node.parentInference==='cross-service-response' ? true : !node.parentCall?.requestInferred && !spanAssociation && !kafkaObserved && (nodes[node.parentIndex].requestCount > 0 || nodes[node.parentIndex].openApiRequestCount > 0 || nodes[node.parentIndex].gorodClientRequestCount > 0 || nodes[node.parentIndex].partnerBackendRequestCount > 0) && node.requestCount > 0,
        responseObserved: node.parentInference==='cross-service-response' ? true : !spanAssociation && !kafkaObserved && (nodes[node.parentIndex].responseCount > 0 || nodes[node.parentIndex].openApiResponseCount > 0 || nodes[node.parentIndex].gorodClientResponseCount > 0 || nodes[node.parentIndex].partnerBackendResponseCount > 0) && node.responseCount > 0,
        ...(node.parentInference==='cross-service-response'?{crossServicePair:{...node.crossServicePair},crossServicePairs:(node.crossServicePairs||[node.crossServicePair]).map(pair=>({...pair}))}:{}),
        ...(node.parentInference==='gateway-envelope'?{reconstructedGatewayEntry:true}:{}),
        ...(spanAssociation ? {spanAssociation:true} : {}),
        ...(kafkaObserved ? { kafkaObserved: true } : {}),
        ...(node.parentInference === "recovered-response" ? { recovered: true } : {}),
        inferred: node.parentInference !== "parent-span"
      }];
    });
    // Classify each disconnected root from observed evidence. In particular,
    // a Kafka consumer is an asynchronous boundary, not a broken HTTP child,
    // and must not receive an invented response edge back to the gateway.
    const rootIslands = nodes.flatMap((node, rootIndex) => {
      if (node.parentIndex !== null) return [];
      const unresolvedParent = node.parentSpanIds.length > 0;
      const kafkaConsumeOnly = node.kafkaConsumeCount > 0
        && node.requestCount === 0 && node.responseCount === 0
        && node.openApiRequestCount === 0 && node.openApiResponseCount === 0
        && node.gorodClientRequestCount === 0 && node.gorodClientResponseCount === 0
        && node.partnerBackendRequestCount === 0 && node.partnerBackendResponseCount === 0;
      const syncEntry = node.requestCount > 0 || node.openApiRequestCount > 0 || node.gorodClientRequestCount > 0 || node.partnerBackendRequestCount > 0;
      const kind = node.reconstructedEntry ? "reconstructed-gateway" : unresolvedParent ? "unresolved-parent" : kafkaConsumeOnly ? "async-kafka" : syncEntry ? "sync-entry" : "standalone";
      const completion = kind === "async-kafka"
        ? "consume-observed"
        : node.responseCount > 0 || node.openApiResponseCount > 0 || node.gorodClientResponseCount > 0 || node.partnerBackendResponseCount > 0
          ? "response-observed"
          : "open";
      const kafkaSources=kafkaLinks.filter(link=>link.consumerNodeIndex===rootIndex).map(link=>link.producerNodeIndex);
      const likelyNodeIndexes=kind==='async-kafka' ? kafkaSources : (node.unresolvedParentCandidates||[]).filter(index=>nodes[index]);
      return [{
        rootIndex, kind, completion, likelyNodeIndexes,
        kafkaLinked: kind === "async-kafka" && kafkaSources.length>0
      }];
    });
    const repeatedHttpTargets = findRepeatedHttpTargets(nodes);
    for (const repeated of repeatedHttpTargets) {
      for (const nodeIndex of repeated.nodeIndexes) {
        if (!nodes[nodeIndex].repeatedHttpTargets) nodes[nodeIndex].repeatedHttpTargets = [];
        nodes[nodeIndex].repeatedHttpTargets.push({ service:repeated.service, callerService:repeated.callerService, targetServices:[...repeated.targetServices], url:repeated.url, count:repeated.count, methods:[...repeated.methods] });
      }
    }
    const outgoingFailures = resolveOutgoingFailures(nodes, outgoingFailureSearchType);
    const result={ nodes, edges, kafkaLinks, rootIslands, repeatedHttpTargets, outgoingFailures };
    result.schedulerJobs=(requestSearchType?.schedulerJobs||[]).filter(v=>typeof v==='string'&&v.length<=160&&!/[\u0000-\u001f]/.test(v)).slice(0,20);
    result.traceInsights=observability?.summarize?.(result)||null;
    return result;
  }

  const api = { parseTracePivot, parseTraceDurations, parseTraceDurationSamples, parseTraceEventTimes, parseTraceEventLogSteps, parseTraceMetadata, parseTraceCountMetadata, findRepeatedHttpTargets, buildRequestResponseTrace, traceTimestamp, traceMetricValue, tracePivotCells };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.TraceAnalysis = api;
})();
