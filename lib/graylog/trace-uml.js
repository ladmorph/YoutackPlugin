(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TraceUml = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_NODES = 200;
  const MAX_SERVICE_PARTICIPANTS = 48;
  const MAX_PARTICIPANTS = 55;
  const MAX_EVENTS = 400;
  const MIN_COLUMN_WIDTH = 168;
  const MAX_COLUMN_WIDTH = 292;
  const SIDE_PADDING = 58;
  const EVENT_HEIGHT = 46;
  const HEADER_HEIGHT = 92;
  const SVG_NS = "http://www.w3.org/2000/svg";

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function boundedCount(value, maximum = 200) {
    const count = Math.floor(Number(value) || 0);
    return Math.max(0, Math.min(maximum, count));
  }

  function safeServiceName(value, fallback) {
    const text = String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[^\p{L}\p{N}._ -]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48);
    return text || fallback;
  }

  function shorten(value, limit = 72) {
    const text = String(value || "");
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(1, limit - 1))}…`;
  }

  function maskOpaqueSegment(segment) {
    let decoded = String(segment || "");
    try { decoded = decodeURIComponent(decoded); } catch {}
    if (!decoded) return decoded;
    if (/^v\d+(?:\.\d+)*$/i.test(decoded)) return segment;
    if (/^\*$/.test(decoded)) return "*";
    if (/^\d+$/.test(decoded)
      || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)
      || /^[0-9a-f]{16,}$/i.test(decoded)
      || decoded.length > 32
      || /(?:token|secret|password|bearer|private|credential)/i.test(decoded)
      || (/\d/.test(decoded) && decoded.length >= 8)) return "*";
    return /^[\p{L}\p{N}_~-]+$/u.test(decoded) ? segment : "*";
  }

  function safeHttpMethod(value) {
    const method = String(value || "").trim().toUpperCase();
    return /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|TRACE|CONNECT)$/.test(method) ? method : "HTTP";
  }

  function safeHttpUri(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 500 || !/^\//.test(text) || /^\/\//.test(text)) return "путь не определён";
    const [withoutHash] = text.split("#", 1);
    const queryAt = withoutHash.indexOf("?");
    const pathname = queryAt < 0 ? withoutHash : withoutHash.slice(0, queryAt);
    const query = queryAt < 0 ? "" : withoutHash.slice(queryAt + 1);
    const safePath = pathname.split("/").map(maskOpaqueSegment).join("/");
    const safeQuery = query ? `?${query.split("&").slice(0, 8).map((part) => {
      const name = part.split("=", 1)[0];
      return `${/^[a-z][a-z0-9_.-]{0,39}$/i.test(name) ? name : "param"}=*`;
    }).join("&")}` : "";
    return shorten(`${safePath}${safeQuery}`, 50);
  }

  function safeStatus(value) {
    const match = /(?:^|\D)([1-5]\d{2})(?:\s+([A-Za-z][A-Za-z _-]{0,24}))?/.exec(String(value || ""));
    if (!match) return "статус не указан";
    const reason = String(match[2] || "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toUpperCase();
    return `${match[1]}${reason ? ` ${reason}` : ""}`;
  }

  function safeCacheKey(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 300) return "ключ не указан";
    const masked = text.split(/(:+|\/+|[._-])/).map((part) => {
      if (!part || /^(:+|\/+|[._-])$/.test(part)) return part;
      return maskOpaqueSegment(part);
    }).join("");
    return shorten(masked || "ключ не указан", 44);
  }

  function safeTopic(value) {
    const text = String(value || "").trim();
    if (!/^[a-z0-9._-]{1,249}$/i.test(text)) return "topic не определён";
    const masked = text.split(/([._-])/).map((part) => /^[._-]$/.test(part) ? part : maskOpaqueSegment(part)).join("");
    return shorten(masked || "topic не определён", 44);
  }

  function safeProcedure(value) {
    const text=String(value||"").trim();
    return /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(text) ? text : "не определена";
  }

  function formatDuration(value) {
    const number = finiteNumber(value);
    if (number === null || number < 0) return "duration не указан";
    if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 2).replace(/\.00$/, "")} s`;
    return `${Math.round(number * 10) / 10} ms`;
  }

  function expandedDetails(details, count) {
    const result = [];
    for (const detail of Array.isArray(details) ? details.slice(0, MAX_EVENTS) : []) {
      const copies = Math.max(1, boundedCount(detail?.count || 1, MAX_EVENTS));
      const times = Array.isArray(detail?.times) ? detail.times.slice(0, copies) : [];
      for (let index = 0; index < copies && result.length < MAX_EVENTS; index += 1) {
        result.push({ ...detail, at:finiteNumber(times[index]) ?? finiteNumber(detail?.at), detailOrder:result.length });
      }
    }
    while (result.length < count && result.length < MAX_EVENTS) result.push(null);
    return result.sort((left, right) => {
      const leftAt = finiteNumber(left?.at), rightAt = finiteNumber(right?.at);
      if (leftAt === null && rightAt !== null) return 1;
      if (leftAt !== null && rightAt === null) return -1;
      if (leftAt !== rightAt) return Number(leftAt) - Number(rightAt);
      return Number(left?.detailOrder || 0) - Number(right?.detailOrder || 0);
    });
  }

  function responseRequestIndexes(requestTimes, responseTimes, durations) {
    const requests = Array.isArray(requestTimes) ? requestTimes : [];
    const responses = Array.isArray(responseTimes) ? responseTimes : [];
    const values = Array.isArray(durations) ? durations : [];
    const proposals = responses.map((responseAt, responseIndex) => {
      const duration = finiteNumber(values[responseIndex]);
      if (duration === null || duration < 0 || finiteNumber(responseAt) === null) return [];
      const startedAt = Number(responseAt) - duration;
      return requests.flatMap((requestAt, requestIndex) => finiteNumber(requestAt) !== null && Math.abs(Number(requestAt) - startedAt) <= 2 ? [requestIndex] : []);
    });
    return proposals.map((candidates, responseIndex) => {
      if (candidates.length === 1 && proposals.filter((other) => other.includes(candidates[0])).length === 1) return candidates[0];
      if (requests.length === 1 && responses.length === 1 && responseIndex === 0) return 0;
      return null;
    });
  }

  function observedTimes(values, fallback, count) {
    const list = (Array.isArray(values) ? values : [])
      .slice(0, MAX_EVENTS)
      .map(finiteNumber);
    if (list.length) return list;
    if (count > 0) return Array.from({ length:count }, (_, index) => index === 0 ? finiteNumber(fallback) : null);
    return [];
  }

  function createParticipantRegistry() {
    const participants = [];
    const byKey = new Map();
    const overflowKeys = new Set();
    let overflow = null;

    function add(key, label, kind = "service") {
      if (byKey.has(key)) return byKey.get(key);
      const serviceCount = participants.filter(participant => participant.kind === "service" && participant.key !== "overflow").length;
      if (kind === "service" && serviceCount >= MAX_SERVICE_PARTICIPANTS) {
        if (!overflow) {
          overflow = { id:`participant-${participants.length + 1}`, key:"overflow", label:"Другие сервисы", kind:"service" };
          participants.push(overflow);
        }
        overflowKeys.add(key);
        return overflow;
      }
      const participant = { id:`participant-${participants.length + 1}`, key, label, kind };
      participants.push(participant);
      byKey.set(key, participant);
      return participant;
    }

    return { participants, add, isTruncated:() => Boolean(overflow), omittedCount:() => overflowKeys.size };
  }

  function participantOrder(nodes, edges) {
    const children = nodes.map(() => []);
    const roots = [];
    for (const edge of edges) {
      if (edge?.spanAssociation || edge?.assumption) continue;
      const from = Number(edge?.from);
      const to = Number(edge?.to);
      if (Number.isInteger(from) && Number.isInteger(to) && nodes[from] && nodes[to] && from !== to) children[from].push(to);
    }
    nodes.forEach((node, index) => {
      if (node?.parentIndex === null || !Number.isInteger(node?.parentIndex)) roots.push(index);
    });
    const at = index => finiteNumber(nodes[index]?.requestAt) ?? Number.POSITIVE_INFINITY;
    children.forEach(indexes => indexes.sort((left, right) => at(left) - at(right) || left - right));
    roots.sort((left, right) => at(left) - at(right) || left - right);
    const ordered = [];
    const seen = new Set();
    const visit = index => {
      if (seen.has(index) || !nodes[index]) return;
      seen.add(index);
      ordered.push(index);
      children[index].forEach(visit);
    };
    roots.forEach(visit);
    nodes.forEach((_, index) => visit(index));
    return ordered;
  }

  function build(diagram) {
    const nodes = (Array.isArray(diagram?.nodes) ? diagram.nodes : []).slice(0, MAX_NODES);
    const edges = Array.isArray(diagram?.edges) ? diagram.edges : [];
    const registry = createParticipantRegistry();
    const events = [];
    let insertionOrder = 0;
    let hasCache = false;
    let hasKafka = false;
    let omittedEvents = 0;

    const client = registry.add("client", "Внешний клиент", "boundary");
    const nodeParticipants = new Array(nodes.length);
    for (const index of participantOrder(nodes, edges)) {
      const name = safeServiceName(nodes[index]?.service, `Сервис ${index + 1}`);
      nodeParticipants[index] = registry.add(`service:${name.toLocaleLowerCase("ru-RU")}`, name, "service");
    }

    function addEvent(kind, from, to, at, label, options = {}) {
      if (!from || !to) return;
      if (events.length >= MAX_EVENTS) { omittedEvents += 1; return; }
      events.push({
        kind,
        from:from.id,
        to:to.id,
        at:finiteNumber(at),
        label,
        dashed:Boolean(options.dashed),
        warning:Boolean(options.warning),
        correlationKey:options.correlationKey || null,
        insertionOrder:insertionOrder++
      });
    }

    function httpRequestLabel(node, index) {
      const details = expandedDetails(node?.requestTargets, Math.max(1, boundedCount(node?.requestCount)));
      const detail = details[index] || details[0] || null;
      return `${safeHttpMethod(detail?.method)} ${safeHttpUri(detail?.url)}`;
    }

    function httpResponseLabel(node, index) {
      const targets = Array.isArray(node?.responseTargets) ? node.responseTargets : [];
      const durations = Array.isArray(node?.responseDurations) ? node.responseDurations : [];
      const target = targets[index] || (targets.length === 1 ? targets[0] : null);
      const duration = durations[index] ?? (durations.length === 1 ? durations[0] : node?.responseDuration);
      return `${safeStatus(target?.status)} · ${formatDuration(duration)}`;
    }

    const claimedCrossResponses=new Map();
    for(const edge of edges){
      for(const pair of edge?.crossServicePair?(edge.crossServicePairs||[edge.crossServicePair]):[]){
        const owner=Number.isInteger(pair.responseNodeIndex)?pair.responseNodeIndex:Number(edge.from);
        if(!Number.isInteger(owner)||!Number.isInteger(pair.responseOrdinal))continue;
        const ordinals=claimedCrossResponses.get(owner)||new Set();ordinals.add(pair.responseOrdinal);claimedCrossResponses.set(owner,ordinals);
      }
    }

    for (const [index, node] of nodes.entries()) {
      if (node?.parentIndex !== null && Number.isInteger(node?.parentIndex)) continue;
      const participant = nodeParticipants[index];
      const requestTimes = observedTimes(node?.requestTimes, node?.requestAt, boundedCount(node?.requestCount));
      for (const [eventIndex, at] of requestTimes.entries()) {
        addEvent("request", client, participant, at, httpRequestLabel(node, eventIndex), { correlationKey:`root:${index}:${eventIndex}` });
      }
      const responseTimes = observedTimes(node?.responseTimes, node?.responseAt, boundedCount(node?.responseCount));
      const visibleResponses=responseTimes.map((at,ordinal)=>({at,ordinal})).filter(item=>!claimedCrossResponses.get(index)?.has(item.ordinal));
      const responseIndexes = responseRequestIndexes(requestTimes, visibleResponses.map(item=>item.at), visibleResponses.map(item=>node?.responseDurations?.[item.ordinal]));
      for (const [visibleIndex, item] of visibleResponses.entries()) {
        const requestIndex = responseIndexes[visibleIndex];
        addEvent("response", participant, client, item.at, httpResponseLabel(node, item.ordinal), { dashed:true, warning:Number(node?.responseLevel3Count) > 0,
          correlationKey:requestIndex === null ? null : `root:${index}:${requestIndex}` });
      }
    }

    for (const [edgeIndex, edge] of edges.entries()) {
      if (edge?.spanAssociation || edge?.assumption) continue;
      const fromIndex = Number(edge?.from);
      const toIndex = Number(edge?.to);
      const source = nodeParticipants[fromIndex];
      const target = nodeParticipants[toIndex];
      const child = nodes[toIndex];
      if (!source || !target || !child) continue;
      if(edge?.reconstructedGatewayEntry){
        addEvent("request",source,target,nodes[fromIndex]?.reconstructedEntry?.at,"REQUEST восстановлен · запись gateway отсутствует",{dashed:true,warning:true,correlationKey:`edge:${edgeIndex}:reconstructed`});
      }
      if(edge?.requestObserved===false&&child?.parentInference==='openapi-gateway-window'){
        const inferredAt=finiteNumber(child?.completedOperation?.start) ?? finiteNumber(child?.xmlProcedureRequestAt) ?? finiteNumber(child?.responseAt);
        addEvent("request",source,target,inferredAt,"REQUEST восстановлен · окно OpenAPI gateway",{dashed:true,warning:true,correlationKey:`edge:${edgeIndex}:openapi-gateway`});
      }
      if (edge?.requestObserved !== false) {
        const crossPairs=edge?.crossServicePair?(edge.crossServicePairs||[edge.crossServicePair]):null;
        const requestTimes = crossPairs ? crossPairs.map(pair=>finiteNumber(pair.requestAt)) : observedTimes(child.requestTimes, child.requestAt, Math.max(1, boundedCount(child.requestCount)));
        for (const [eventIndex, at] of requestTimes.entries()) {
          const label=crossPairs ? httpRequestLabel(child,crossPairs[eventIndex]?.requestOrdinal??eventIndex) : httpRequestLabel(child,eventIndex);
          addEvent("request", source, target, at, label, { correlationKey:`edge:${edgeIndex}:${eventIndex}` });
        }
      }
      if (edge?.responseObserved !== false) {
        const crossPairs=edge?.crossServicePair?(edge.crossServicePairs||[edge.crossServicePair]):null;
        const responseNode=crossPairs?nodes[fromIndex]:child;
        const responseTimes = crossPairs ? crossPairs.map(pair=>finiteNumber(pair.responseAt)) : observedTimes(child.responseTimes, child.responseAt, Math.max(1, boundedCount(child.responseCount)));
        const requestTimes = observedTimes(child.requestTimes, child.requestAt, Math.max(1, boundedCount(child.requestCount)));
        const responseIndexes = responseRequestIndexes(requestTimes, responseTimes, child?.responseDurations);
        for (const [eventIndex, at] of responseTimes.entries()) {
          const requestIndex = responseIndexes[eventIndex];
          const responseOrdinal=crossPairs?.[eventIndex]?.responseOrdinal??eventIndex;
          addEvent("response", target, source, at, httpResponseLabel(responseNode, responseOrdinal), { dashed:true, warning:Number(responseNode?.responseLevel3Count) > 0,
            correlationKey:requestIndex === null ? null : `edge:${edgeIndex}:${requestIndex}` });
        }
      }
    }

    let localCache = null;
    let redis = null;
    let kafka = null;
    let openApi = null;
    let gorodClient = null;
    let partnerBackend = null;
    const procedures = new Map();
    for (const [index, node] of nodes.entries()) {
      const owner = nodeParticipants[index];
      const cacheCount = boundedCount(node?.cacheAccessCount, 40);
      const cacheDetails = Array.isArray(node?.cacheAccesses) ? node.cacheAccesses.slice(0, 40) : [];
      const cacheTimes = observedTimes(node?.cacheAccessTimes, node?.cacheAccessAt, Math.max(cacheCount, cacheDetails.length));
      for (let eventIndex = 0; eventIndex < Math.max(cacheCount, cacheDetails.length, cacheTimes.length); eventIndex += 1) {
        if (!localCache) localCache = registry.add("local-cache", "Local Cache", "cache");
        if (!redis) redis = registry.add("redis", "Redis", "cache");
        hasCache = true;
        const detail = cacheDetails[eventIndex] || {};
        const operation = String(detail.operation || "get").toLowerCase() === "put" ? "PUT" : "GET";
        const at = finiteNumber(detail.at) ?? cacheTimes[eventIndex] ?? null;
        const key = safeCacheKey(detail.safeKey);
        addEvent("cache", owner, localCache, at, `LOCAL ${operation} · ${key}`);
        addEvent("cache", localCache, redis, at === null ? null : at + 0.001, `REDIS ${operation} · ${key}`);
      }

      const kafkaCount = boundedCount(node?.kafkaProduceCount, 40);
      const kafkaDetails = Array.isArray(node?.kafkaProduces) ? node.kafkaProduces.slice(0, 40) : [];
      const kafkaTimes = observedTimes(node?.kafkaProduceTimes, node?.kafkaProduceAt, Math.max(kafkaCount, kafkaDetails.length));
      for (let eventIndex = 0; eventIndex < Math.max(kafkaCount, kafkaDetails.length, kafkaTimes.length); eventIndex += 1) {
        if (!kafka) kafka = registry.add("kafka", "Kafka broker", "kafka");
        hasKafka = true;
        const at = finiteNumber(kafkaDetails[eventIndex]?.at) ?? kafkaTimes[eventIndex] ?? null;
        addEvent("kafka", owner, kafka, at, `PRODUCE · ${safeTopic(kafkaDetails[eventIndex]?.topic)}`);
      }

      const kafkaConsumeCount = boundedCount(node?.kafkaConsumeCount, 40);
      const kafkaConsumeDetails = Array.isArray(node?.kafkaConsumes) ? node.kafkaConsumes.slice(0, 40) : [];
      const kafkaConsumeTimes = observedTimes(node?.kafkaConsumeTimes, node?.kafkaConsumeAt, Math.max(kafkaConsumeCount, kafkaConsumeDetails.length));
      for (let eventIndex = 0; eventIndex < Math.max(kafkaConsumeCount, kafkaConsumeDetails.length, kafkaConsumeTimes.length); eventIndex += 1) {
        if (!kafka) kafka = registry.add("kafka", "Kafka broker", "kafka");
        hasKafka = true;
        const at = finiteNumber(kafkaConsumeDetails[eventIndex]?.at) ?? kafkaConsumeTimes[eventIndex] ?? null;
        addEvent("kafka", kafka, owner, at, `CONSUME · ${safeTopic(kafkaConsumeDetails[eventIndex]?.topic)}`);
      }

      const brokerCount=boundedCount(node?.kafkaBrokerCount,40);
      const brokerDetails=Array.isArray(node?.kafkaBrokers)?node.kafkaBrokers.slice(0,40):[];
      const brokerTimes=observedTimes(node?.kafkaBrokerTimes,node?.kafkaBrokerAt,Math.max(brokerCount,brokerDetails.length));
      for(let eventIndex=0;eventIndex<Math.max(brokerCount,brokerDetails.length,brokerTimes.length);eventIndex+=1){
        if(!kafka)kafka=registry.add("kafka","Kafka broker","kafka");
        hasKafka=true;
        const at=finiteNumber(brokerDetails[eventIndex]?.at)??brokerTimes[eventIndex]??null;
        addEvent("kafka",owner,kafka,at,`INFRA LOG · ${safeTopic(brokerDetails[eventIndex]?.topic)}`);
      }

      const procedureRequests=Array.isArray(node?.xmlProcedureRequests)?node.xmlProcedureRequests.slice(0,40):[];
      const procedureResponses=Array.isArray(node?.xmlProcedureResponseSamples)?node.xmlProcedureResponseSamples.slice(0,40):[];
      const procedureNames=new Map();
      for(const item of [...procedureRequests,...procedureResponses]){
        const display=safeProcedure(item?.procedure);if(display==="не определена")continue;
        const key=display.toLowerCase();if(!procedureNames.has(key))procedureNames.set(key,display);
      }
      for(const [procedureKey,procedureName] of procedureNames){
        const remote=procedures.get(procedureKey)||registry.add(`procedure:${procedureKey}`,`Процедура: ${procedureName}`,"boundary");
        procedures.set(procedureKey,remote);
        const requests=procedureRequests.filter(item=>safeProcedure(item?.procedure).toLowerCase()===procedureKey);
        const responses=procedureResponses.filter(item=>safeProcedure(item?.procedure).toLowerCase()===procedureKey);
        for(const [eventIndex,item] of requests.entries())addEvent("request",owner,remote,finiteNumber(item?.at),`Процедура: ${procedureName}`,{correlationKey:`procedure:${index}:${procedureKey}:${eventIndex}`});
        const requestTimes=requests.map(item=>finiteNumber(item?.at));
        const responseTimes=responses.map(item=>finiteNumber(item?.at));
        const durations=responses.map(item=>finiteNumber(item?.duration));
        const responseIndexes=responseRequestIndexes(requestTimes,responseTimes,durations);
        for(const [eventIndex,item] of responses.entries()){
          const requestIndex=responseIndexes[eventIndex];
          addEvent("response",remote,owner,finiteNumber(item?.at),formatDuration(item?.duration),{dashed:true,correlationKey:requestIndex===null?null:`procedure:${index}:${procedureKey}:${requestIndex}`});
        }
      }

      for (const family of [
        { prefix:"openApi", key:"openapi", label:"OPENAPI" },
        { prefix:"gorodClient", key:"gorod-client", label:"HTTP CLIENT" },
        { prefix:"partnerBackend", key:"partner-backend", label:"PARTNER BACKEND" }
      ]) {
        const requestCount = boundedCount(node?.[`${family.prefix}RequestCount`], 40);
        const responseCount = boundedCount(node?.[`${family.prefix}ResponseCount`], 40);
        if (!requestCount && !responseCount) continue;
        const remote = family.prefix === "openApi"
          ? (openApi ||= registry.add(family.key, family.label, "boundary"))
          : family.prefix === "gorodClient"
            ? (gorodClient ||= registry.add(family.key, family.label, "boundary"))
            : (partnerBackend ||= registry.add(family.key, family.label, "boundary"));
        const requests = expandedDetails(node?.[`${family.prefix}RequestTargets`], requestCount);
        const requestTimes = observedTimes(node?.[`${family.prefix}RequestTimes`], node?.[`${family.prefix}RequestAt`], requestCount);
        for (const [eventIndex, at] of requestTimes.entries()) {
          const detail = requests[eventIndex] || requests[0] || {};
          addEvent("request", owner, remote, at, `${safeHttpMethod(detail.method)} ${safeHttpUri(detail.url)}`, { correlationKey:`${family.key}:${index}:${eventIndex}` });
        }
        const samples = Array.isArray(node?.[`${family.prefix}ResponseSamples`]) ? node[`${family.prefix}ResponseSamples`] : [];
        const responseTimes = observedTimes(node?.[`${family.prefix}ResponseTimes`], node?.[`${family.prefix}ResponseAt`], responseCount);
        const responseDurations = Array.isArray(node?.[`${family.prefix}ResponseDurations`]) ? node[`${family.prefix}ResponseDurations`] : [];
        const targets = Array.isArray(node?.[`${family.prefix}ResponseTargets`]) ? node[`${family.prefix}ResponseTargets`] : [];
        const sampleDurations = responseTimes.map((_at, eventIndex) => samples[eventIndex]?.duration ?? responseDurations[eventIndex] ?? null);
        const responseIndexes = responseRequestIndexes(requestTimes, responseTimes, sampleDurations);
        if (family.prefix === 'gorodClient' && Array.isArray(node.clientExchanges)) {
          responseTimes.forEach((at, responseOrdinal) => {
            const matches = node.clientExchanges.filter(call => call.family === family.prefix && call.responseAt === at
              && (!Number.isInteger(call.responseOrdinal) || call.responseOrdinal === responseOrdinal));
            responseIndexes[responseOrdinal] = matches.length === 1 ? matches[0].targetOrdinal : null;
          });
        }
        for (const [eventIndex, at] of responseTimes.entries()) {
          const sample = samples[eventIndex] || {};
          const target = targets[eventIndex] || sample;
          const duration = sample.duration ?? responseDurations[eventIndex] ?? null;
          addEvent("response", remote, owner, at, `${safeStatus(target?.status)} · ${formatDuration(duration)}`, {
            dashed:true,
            warning:Boolean(sample.level3) || Number(node?.[`${family.prefix}ResponseLevel3Count`]) > 0,
            correlationKey:responseIndexes[eventIndex] === null ? null : `${family.key}:${index}:${responseIndexes[eventIndex]}`
          });
        }
      }
    }

    const priority = { request:0, cache:1, kafka:2, response:3 };
    events.sort((left, right) => {
      if (left.at === null && right.at !== null) return 1;
      if (left.at !== null && right.at === null) return -1;
      if (left.at !== right.at) return Number(left.at) - Number(right.at);
      return (priority[left.kind] ?? 9) - (priority[right.kind] ?? 9) || left.insertionOrder - right.insertionOrder;
    });
    events.forEach((event, index) => { event.number = index + 1; });
    const requestNumbers = new Map(events.filter(event => event.kind === "request" && event.correlationKey).map(event => [event.correlationKey, event.number]));
    events.forEach((event) => {
      if (event.kind === "response" && requestNumbers.has(event.correlationKey)) {
        event.requestNumber = requestNumbers.get(event.correlationKey);
        event.label = `↩ #${event.requestNumber} · ${event.label}`;
      }
      delete event.insertionOrder;
      delete event.correlationKey;
    });
    const eventsByNumber = new Map(events.map(event => [event.number, event]));
    const activations = events.flatMap((event) => {
      if (event.kind !== "response" || !Number.isInteger(event.requestNumber)) return [];
      const request = eventsByNumber.get(event.requestNumber);
      if (!request || request.kind !== "request" || request.from !== event.to || request.to !== event.from || event.number <= request.number) return [];
      return [{ participant:request.to, startEvent:request.number, endEvent:event.number }];
    });

    const nodesOmitted = Math.max(0, (diagram?.nodes?.length || 0) - nodes.length);
    const participantsOmitted = registry.omittedCount();
    // diagram?.truncated carries truncation from the fetch layer (native
    // Graylog pagination cap or the DOM page-collector cap), which happened
    // before this trace ever reached the UML model and so cannot be counted
    // here - only reported as a fact.
    const truncation = {
      upstream: Boolean(diagram?.truncated),
      nodesOmitted,
      eventsOmitted: omittedEvents,
      participantsOmitted
    };
    return {
      participants:registry.participants,
      events,
      activations,
      hasCache,
      hasKafka,
      truncated:Boolean(truncation.upstream || nodesOmitted > 0 || participantsOmitted > 0 || omittedEvents > 0),
      truncation,
      omittedRawFields:["message", "requestBody", "responseBody", "traceId", "spanId", "rawCacheKey", "offset", "partition"]
    };
  }

  function svgElement(documentRef, name, attributes = {}) {
    const element = documentRef.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }

  function render(container, model) {
    const documentRef = container?.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!container || !documentRef) throw new Error("Контейнер UML недоступен");
    const participants = Array.isArray(model?.participants) ? model.participants : [];
    const events = Array.isArray(model?.events) ? model.events : [];
    const columnWidths = participants.map((participant) => Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, String(participant.label || "").length * 7.4 + 42)));
    const width = Math.max(720, SIDE_PADDING * 2 + Math.max(MIN_COLUMN_WIDTH, columnWidths.reduce((sum, value) => sum + value, 0)));
    const height = Math.max(260, HEADER_HEIGHT + events.length * EVENT_HEIGHT + 52);
    const svg = svgElement(documentRef, "svg", {
      class:"trace-uml-svg",
      width,
      height,
      viewBox:`0 0 ${width} ${height}`,
      role:"img",
      "aria-label":`UML sequence diagram: ${participants.length} участников, ${events.length} событий`
    });
    const defs = svgElement(documentRef, "defs");
    for (const [id, color] of [["uml-request-arrow", "#43d9c7"], ["uml-response-arrow", "#f6b84a"], ["uml-cache-arrow", "#38bdf8"], ["uml-kafka-arrow", "#a78bfa"], ["uml-warning-arrow", "#f0626d"]]) {
      const marker = svgElement(documentRef, "marker", { id, viewBox:"0 0 10 10", refX:9, refY:5, markerWidth:7, markerHeight:7, orient:"auto-start-reverse" });
      marker.append(svgElement(documentRef, "path", id === "uml-kafka-arrow"
        ? { d:"M 0 0 L 10 5 L 0 10", fill:"none", stroke:color, "stroke-width":1.8 }
        : { d:"M 0 0 L 10 5 L 0 10 z", fill:color }));
      defs.append(marker);
    }
    svg.append(defs);

    const positions = new Map();
    let columnOffset = SIDE_PADDING;
    participants.forEach((participant, index) => {
      const columnWidth = columnWidths[index];
      const x = columnOffset + columnWidth / 2;
      const boxWidth = columnWidth - 24;
      positions.set(participant.id, x);
      const lifeline = svgElement(documentRef, "line", { class:"trace-uml-lifeline", x1:x, y1:62, x2:x, y2:height - 20 });
      const box = svgElement(documentRef, "rect", { class:`trace-uml-participant trace-uml-participant-${participant.kind}`, x:x - boxWidth / 2, y:15, width:boxWidth, height:48, rx:8 });
      const label = svgElement(documentRef, "text", { class:"trace-uml-participant-label", x, y:44, "text-anchor":"middle" });
      label.textContent = participant.label;
      svg.append(lifeline, box, label);
      columnOffset += columnWidth;
    });

    for (const activation of Array.isArray(model?.activations) ? model.activations : []) {
      const x = positions.get(activation.participant);
      const start = Math.max(1, Number(activation.startEvent) || 1);
      const end = Math.max(start, Number(activation.endEvent) || start);
      if (!Number.isFinite(x) || end <= start) continue;
      const y = HEADER_HEIGHT + (start - 1) * EVENT_HEIGHT + 3;
      const bottom = HEADER_HEIGHT + (end - 1) * EVENT_HEIGHT - 3;
      svg.append(svgElement(documentRef, "rect", { class:"trace-uml-activation", x:x - 5, y, width:10, height:Math.max(8, bottom - y), rx:2 }));
    }

    events.forEach((event, index) => {
      const y = HEADER_HEIGHT + index * EVENT_HEIGHT;
      const fromX = positions.get(event.from);
      const toX = positions.get(event.to);
      if (!Number.isFinite(fromX) || !Number.isFinite(toX)) return;
      const colorKind = event.warning ? "warning" : event.kind;
      const line = svgElement(documentRef, "line", {
        class:`trace-uml-message trace-uml-message-${colorKind}`,
        x1:fromX,
        y1:y,
        x2:toX,
        y2:y,
        "marker-end":`url(#uml-${colorKind}-arrow)`
      });
      if (event.dashed) line.setAttribute("stroke-dasharray", "6 5");
      const number = svgElement(documentRef, "text", { class:"trace-uml-number", x:20, y:y + 4 });
      number.textContent = String(event.number);
      const midpoint = (fromX + toX) / 2;
      const labelWidth = Math.max(88, Math.min(400, event.label.length * 7 + 18));
      const labelBackground = svgElement(documentRef, "rect", { class:"trace-uml-message-label-bg", x:midpoint - labelWidth / 2, y:y - 21, width:labelWidth, height:18, rx:4 });
      const label = svgElement(documentRef, "text", { class:`trace-uml-message-label trace-uml-message-label-${colorKind}`, x:midpoint, y:y - 8, "text-anchor":"middle" });
      label.textContent = event.label;
      svg.append(line, number, labelBackground, label);
    });

    container.replaceChildren(svg);
    return svg;
  }

  return Object.freeze({ build, render, limits:Object.freeze({ maxNodes:MAX_NODES, maxParticipants:MAX_PARTICIPANTS, maxEvents:MAX_EVENTS }) });
});
