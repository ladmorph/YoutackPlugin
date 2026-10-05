(function initializeTraceStreamFilter(root) {
  "use strict";

  function normalizeIds(values) {
    const source = Array.isArray(values) ? values : values === null || values === undefined ? [] : [values];
    return [...new Set(source.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
  }

  function nodeStreamIds(node) {
    return normalizeIds(node?.streamIds ?? node?.streams ?? node?.streamId ?? node?.stream_id);
  }

  function nodeMatchesStreams(node, configuredIds) {
    const configured = configuredIds instanceof Set ? configuredIds : new Set(normalizeIds(configuredIds));
    return node?.streamMetadataComplete !== false && nodeStreamIds(node).some((id) => configured.has(id));
  }

  function cloneNode(node) {
    const copy = { ...node };
    for (const property of [
      "jobNames", "parentSpanIds", "spanKinds", "requestLabels", "openApiRequestLabels", "openApiResponseLabels",
      "gorodClientRequestLabels", "gorodClientResponseLabels", "requestTimes", "responseTimes",
      "partnerBackendRequestLabels", "partnerBackendResponseLabels",
      "requestLogSteps", "responseLogSteps",
      "openApiRequestTimes", "openApiResponseTimes", "gorodClientRequestTimes", "gorodClientResponseTimes",
      "partnerBackendRequestTimes", "partnerBackendResponseTimes",
      "openApiRequestLogSteps", "openApiResponseLogSteps", "gorodClientRequestLogSteps", "gorodClientResponseLogSteps",
      "partnerBackendRequestLogSteps", "partnerBackendResponseLogSteps",
      "kafkaProduceTimes", "kafkaConsumeTimes", "kafkaBrokerTimes", "xmlProcedureRequestTimes",
      "kafkaProduceLogSteps", "kafkaConsumeLogSteps", "kafkaBrokerLogSteps", "xmlProcedureRequestLogSteps",
      "xmlProcedureResponseTimes", "xmlProcedureResponseLogSteps", "cacheAccessTimes", "cacheAccessLogSteps", "requestTargets", "responseTargets",
      "openApiRequestTargets", "openApiResponseTargets", "gorodClientRequestTargets", "gorodClientResponseTargets",
      "partnerBackendRequestTargets", "partnerBackendResponseTargets", "partnerBackendResponseDurations", "partnerBackendResponseSamples",
      "kafkaProduces", "kafkaConsumes", "kafkaBrokers", "xmlProcedureRequests", "xmlProcedureResponseSamples",
      "cacheAccesses", "responseDurations", "recoveredSpanIds", "repeatedHttpTargets", "outgoingFailures", "streamIds", "absorbedGatewayDuplicates"
    ]) if (Array.isArray(node?.[property])) copy[property] = node[property].map((item) => item && typeof item === "object" ? { ...item } : item);
    return copy;
  }

  function visibleAncestor(nodes, originalIndex, included) {
    const seen = new Set([originalIndex]);
    let cursor = nodes[originalIndex]?.parentIndex;
    let hiddenHops = 0;
    while (Number.isInteger(cursor) && cursor >= 0 && cursor < nodes.length && !seen.has(cursor)) {
      if (included.has(cursor)) return { index:cursor, hiddenHops };
      seen.add(cursor);
      hiddenHops += 1;
      cursor = nodes[cursor]?.parentIndex;
    }
    return { index:null, hiddenHops };
  }

  function filterRepeatedTargets(items, indexMap) {
    return (Array.isArray(items) ? items : []).flatMap((item) => {
      const indexes = (Array.isArray(item?.nodeIndexes) ? item.nodeIndexes : [])
        .filter((index) => indexMap.has(index)).map((index) => indexMap.get(index));
      return indexes.length ? [{ ...item, nodeIndexes:indexes }] : [];
    });
  }

  function visibleNodeKeys(nodes) {
    const keys = new Set();
    for (const node of nodes) for (const spanId of [node?.spanId, ...(Array.isArray(node?.recoveredSpanIds) ? node.recoveredSpanIds : [])]) {
      if (node?.service && spanId) keys.add(JSON.stringify([String(node.service), String(spanId)]));
    }
    return keys;
  }

  function filterErrorAnalysis(analysis, nodes) {
    if (!analysis?.available) return analysis;
    const keys = visibleNodeKeys(nodes);
    const belongs = (item) => keys.has(JSON.stringify([String(item?.service || ""), String(item?.spanId || "")]));
    const groups = (Array.isArray(analysis.groups) ? analysis.groups : []).filter(belongs).map((group) => ({ ...group }));
    const timeline = analysis.timeline && typeof analysis.timeline === "object" ? { ...analysis.timeline } : null;
    if (timeline) {
      timeline.events = (Array.isArray(timeline.events) ? timeline.events : []).filter(belongs).map((event) => ({ ...event }));
      const eventIds = new Set(timeline.events.map((event) => event.id));
      timeline.links = (Array.isArray(timeline.links) ? timeline.links : []).filter((link) => eventIds.has(link.from) && eventIds.has(link.to)).map((link) => ({ ...link }));
      timeline.firstObservedIds = (Array.isArray(timeline.firstObservedIds) ? timeline.firstObservedIds : []).filter((id) => eventIds.has(id));
    }
    const eventCount = groups.reduce((sum, group) => sum + Math.max(0, Number(group?.count) || 0), 0);
    const recognized = groups.filter((group) => group?.classification === "recognized").reduce((sum, group) => sum + Math.max(0, Number(group?.count) || 0), 0);
    return { ...analysis, groups, timeline, events:eventCount, recognized, unknown:Math.max(0, eventCount - recognized), available:eventCount > 0 };
  }

  function filterTraceDiagram(diagram, configuredIds) {
    const nodes = Array.isArray(diagram?.nodes) ? diagram.nodes : [];
    const configured = new Set(normalizeIds(configuredIds));
    const included = new Set(nodes.flatMap((node, index) => nodeMatchesStreams(node, configured) ? [index] : []));
    const oldIndexes = [...included].sort((left, right) => left - right);
    const indexMap = new Map(oldIndexes.map((oldIndex, newIndex) => [oldIndex, newIndex]));
    const directEdges = new Map((Array.isArray(diagram?.edges) ? diagram.edges : []).map((edge) => [`${edge.from}:${edge.to}`, edge]));
    const filteredNodes = oldIndexes.map((oldIndex) => cloneNode(nodes[oldIndex]));
    const edges = [];

    oldIndexes.forEach((oldIndex, newIndex) => {
      const original = nodes[oldIndex];
      const ancestry = visibleAncestor(nodes, oldIndex, included);
      const oldParent = ancestry.index;
      const node = filteredNodes[newIndex];
      if (node.crossServicePair) {
        if (indexMap.has(node.crossServicePair.parentIndex)) node.crossServicePair = { ...node.crossServicePair, parentIndex:indexMap.get(node.crossServicePair.parentIndex) };
        else delete node.crossServicePair;
      }
      if(Array.isArray(node.crossServicePairs))node.crossServicePairs=node.crossServicePairs
        .filter(pair=>indexMap.has(pair.parentIndex)).map(pair=>({...pair,parentIndex:indexMap.get(pair.parentIndex)}));
      if (node.reconstructedEntry) {
        if (indexMap.has(node.reconstructedEntry.childIndex)) node.reconstructedEntry = { ...node.reconstructedEntry, childIndex:indexMap.get(node.reconstructedEntry.childIndex) };
        else delete node.reconstructedEntry;
      }
      node.unresolvedParentCandidates = (Array.isArray(node.unresolvedParentCandidates) ? node.unresolvedParentCandidates : [])
        .filter((index) => indexMap.has(index)).map((index) => indexMap.get(index));
      node.parentIndex = oldParent === null ? null : indexMap.get(oldParent);
      node.depth = 0;
      delete node.filteredAncestry;
      if (oldParent === null) {
        node.httpCallerService = "Внешний источник";
        node.httpCallerKey = `Внешний источник → ${String(node.service || "неизвестный сервис")}`;
        return;
      }
      node.httpCallerService = filteredNodes[node.parentIndex]?.service || "Внешний источник";
      node.httpCallerKey = node.httpCallerService;
      if (ancestry.hiddenHops > 0) {
        node.filteredAncestry = { hiddenHops:ancestry.hiddenHops };
        node.parentInference = "filtered-ancestry";
        delete node.clientSpanAssociation;
        edges.push({ from:node.parentIndex, to:newIndex, filteredAssociation:true, hiddenHops:ancestry.hiddenHops,
          requestObserved:false, responseObserved:false, inferred:true });
        return;
      }
      const direct = directEdges.get(`${oldParent}:${oldIndex}`);
      edges.push(direct ? { ...direct, from:node.parentIndex, to:newIndex,
          ...(direct.crossServicePair ? { crossServicePair:{ ...direct.crossServicePair, parentIndex:node.parentIndex },
            crossServicePairs:(direct.crossServicePairs||[direct.crossServicePair]).map(pair=>({...pair,parentIndex:node.parentIndex})) } : {}) }
        : { from:node.parentIndex, to:newIndex, filteredAssociation:true, hiddenHops:0, requestObserved:false, responseObserved:false, inferred:true });
    });

    const depthFor = (index, seen = new Set()) => {
      const parent = filteredNodes[index]?.parentIndex;
      if (!Number.isInteger(parent) || seen.has(parent)) return 0;
      const next = new Set(seen); next.add(parent);
      return 1 + depthFor(parent, next);
    };
    filteredNodes.forEach((_node, index) => { filteredNodes[index].depth = depthFor(index); });
    const serviceTotals = new Map();
    for (const node of filteredNodes) if (Number(node.requestCount) > 0 || Number(node.openApiRequestCount) > 0 || Number(node.gorodClientRequestCount) > 0 || Number(node.partnerBackendRequestCount) > 0) {
      serviceTotals.set(node.service, (serviceTotals.get(node.service) || 0) + 1);
    }
    const serviceSeen = new Map();
    filteredNodes.forEach((node, newIndex) => {
      node.serviceCallTotal = serviceTotals.get(node.service) || 0;
      node.serviceCallOrdinal = node.serviceCallTotal ? (serviceSeen.get(node.service) || 0) + 1 : 0;
      if (node.serviceCallOrdinal) serviceSeen.set(node.service, node.serviceCallOrdinal);
      node.outgoingFailures = (Array.isArray(node.outgoingFailures) ? node.outgoingFailures : []).map((failure) => ({ ...failure, ownerIndex:newIndex }));
    });

    const kafkaLinks = (Array.isArray(diagram?.kafkaLinks) ? diagram.kafkaLinks : []).flatMap((link) => {
      if (!indexMap.has(link.producerNodeIndex) || !indexMap.has(link.consumerNodeIndex)) return [];
      return [{ ...link, producerNodeIndex:indexMap.get(link.producerNodeIndex), consumerNodeIndex:indexMap.get(link.consumerNodeIndex) }];
    });
    const outgoingFailures = (Array.isArray(diagram?.outgoingFailures) ? diagram.outgoingFailures : []).flatMap((failure) => {
      if (!indexMap.has(failure?.ownerIndex)) return [];
      return [{ ...failure, ownerIndex:indexMap.get(failure.ownerIndex) }];
    });
    const repeatedHttpTargets = filterRepeatedTargets(diagram?.repeatedHttpTargets, indexMap);
    const rootIslands = (Array.isArray(diagram?.rootIslands) ? diagram.rootIslands : []).flatMap((island) => {
      if (!indexMap.has(island?.rootIndex)) return [];
      const rootIndex=indexMap.get(island.rootIndex);
      if (filteredNodes[rootIndex]?.parentIndex !== null) return [];
      return [{ ...island, rootIndex, likelyNodeIndexes:(Array.isArray(island.likelyNodeIndexes) ? island.likelyNodeIndexes : [])
        .filter((index) => indexMap.has(index)).map((index) => indexMap.get(index)) }];
    });
    const attributed = nodes.filter((node) => node?.streamMetadataComplete !== false && nodeStreamIds(node).length > 0).length;
    return {
      ...diagram, nodes:filteredNodes, edges, kafkaLinks, rootIslands, outgoingFailures, repeatedHttpTargets,
      errorAnalysis:filterErrorAnalysis(diagram?.errorAnalysis, filteredNodes),
      streamFilter:{ mode:"configured", totalNodes:nodes.length, visibleNodes:filteredNodes.length,
        hiddenNodes:nodes.length - filteredNodes.length, attributedNodes:attributed, configuredCount:configured.size }
    };
  }

  const api = Object.freeze({ normalizeIds, nodeStreamIds, nodeMatchesStreams, filterTraceDiagram });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TraceStreamFilter = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
