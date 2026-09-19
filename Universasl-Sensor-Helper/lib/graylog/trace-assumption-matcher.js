(function initializeTraceAssumptionMatcher(root) {
  "use strict";

  const TIME_FIELDS = Object.freeze([
    "requestTimes", "responseTimes", "openApiRequestTimes", "openApiResponseTimes",
    "gorodClientRequestTimes", "gorodClientResponseTimes", "kafkaProduceTimes",
    "partnerBackendRequestTimes", "partnerBackendResponseTimes",
    "kafkaConsumeTimes", "kafkaBrokerTimes", "xmlProcedureRequestTimes",
    "xmlProcedureResponseTimes", "cacheAccessTimes"
  ]);
  const ROUTE_FIELDS = Object.freeze([
    "requestTargets", "responseTargets", "openApiRequestTargets", "openApiResponseTargets",
    "gorodClientRequestTargets", "gorodClientResponseTargets", "partnerBackendRequestTargets",
    "partnerBackendResponseTargets", "httpRouteHints"
  ]);
  const IGNORED_TOKENS = new Set(["api", "openapi", "gateway", "service", "online", "banking", "request", "response", "http", "https", "v1", "v2", "v3"]);
  const list = value => Array.isArray(value) ? value : [];
  const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function nodeRange(node) {
    const times = TIME_FIELDS.flatMap(field => list(node?.[field])).map(finite).filter(value => value !== null);
    for (const value of [node?.requestAt, node?.responseAt, node?.openApiRequestAt, node?.openApiResponseAt,
      node?.gorodClientRequestAt, node?.gorodClientResponseAt, node?.kafkaProduceAt, node?.kafkaConsumeAt,
      node?.partnerBackendRequestAt, node?.partnerBackendResponseAt,
      node?.kafkaBrokerAt, node?.xmlProcedureRequestAt, node?.xmlProcedureResponseAt,
      node?.completedOperation?.start, node?.completedOperation?.end, node?.reconstructedEntry?.at]) {
      const parsed = finite(value); if (parsed !== null) times.push(parsed);
    }
    return times.length ? { start:Math.min(...times), end:Math.max(...times) } : { start:null, end:null };
  }

  function routeKey(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "";
    try {
      const url = new URL(raw, "https://trace.invalid");
      return url.pathname.replace(/\/+$/, "") || "/";
    } catch {
      return raw.split(/[?#]/, 1)[0].replace(/\/+$/, "");
    }
  }

  // Hints taken from the initUri/publicUri field are the whole request's
  // entry URL, propagated to every service's log line. They are not a route
  // this node was called on, so they must not count as a route match: with
  // them, every node in a trace "shares a URI" with every other node and
  // exact-uri becomes a tie among all candidates. They feed entryUriTokens()
  // instead.
  const ENTRY_URI_PROVENANCE = new Set(["initUri", "publicUri"]);
  const isEntryUriHint = item => ENTRY_URI_PROVENANCE.has(item?.provenance);

  function nodeRoutes(node) {
    const routes = new Set();
    for (const field of ROUTE_FIELDS) for (const item of list(node?.[field])) {
      if (field === "httpRouteHints" && isEntryUriHint(item)) continue;
      const key = routeKey(item?.routeKey || item?.url || item?.uri || item?.path);
      if (key && key !== "/") routes.add(key);
    }
    return routes;
  }

  // The trace's entry URL: the gateway's percentile context when the graph
  // was loaded through the popup's search, otherwise (current-page /
  // collected-pages graphs, where that context is never computed) the
  // initUri/publicUri hints already sitting on the nodes.
  function entryUriTokens(diagram) {
    const tokens = words(diagram?.percentileContext?.initUri);
    if (tokens.size) return tokens;
    for (const node of list(diagram?.nodes)) for (const item of list(node?.httpRouteHints)) {
      if (!isEntryUriHint(item)) continue;
      for (const token of words(item?.url || item?.routeKey || item?.uri || item?.path)) tokens.add(token);
    }
    return tokens;
  }

  const EXCHANGE_TARGET_FIELDS = Object.freeze({
    openApi:"openApiRequestTargets", gorodClient:"gorodClientRequestTargets", partnerBackend:"partnerBackendRequestTargets"
  });

  function exchangeRoute(node, exchange) {
    const field = EXCHANGE_TARGET_FIELDS[exchange?.family];
    if (!field) return "";
    const target = list(node?.[field])[Number(exchange?.targetOrdinal)];
    return routeKey(target?.routeKey || target?.url || target?.uri || target?.path);
  }

  // An assumed service edge may still have a concrete, observed HTTP call on
  // its parent card. Anchor to that call only when it is unique: exact URI is
  // strongest; otherwise a single closed window containing the child start is
  // enough. Ambiguous parallel calls remain attached to the service card.
  function parentCallFor(parent, child) {
    const childStart = nodeRange(child).start;
    if (childStart === null) return null;
    const exchanges = list(parent?.clientExchanges).filter(exchange => {
      const start = finite(exchange?.requestAt), end = finite(exchange?.responseAt);
      return start !== null && end !== null && start <= childStart + 25 && end >= childStart;
    });
    if (!exchanges.length) return null;
    const childRoutes = nodeRoutes(child);
    const exact = exchanges.filter(exchange => {
      const route = exchangeRoute(parent, exchange);
      return route && childRoutes.has(route);
    });
    const candidates = exact.length ? exact : exchanges;
    if (candidates.length !== 1) return null;
    const exchange = candidates[0];
    return { family:exchange.family, requestAt:finite(exchange.requestAt), responseAt:finite(exchange.responseAt), targetOrdinal:Number(exchange.targetOrdinal) };
  }

  function words(value) {
    return new Set(String(value || "").toLowerCase().split(/[^a-zа-яё0-9]+/iu)
      .filter(token => token.length >= 4 && !IGNORED_TOKENS.has(token) && !/^\d+$/.test(token)));
  }

  function intersects(left, right) {
    for (const item of left) if (right.has(item)) return true;
    return false;
  }

  function values(node, fields) {
    const result = new Set();
    for (const field of fields) for (const item of list(node?.[field])) {
      const value = String(item?.topic ?? item?.key ?? item ?? "").trim().toLowerCase();
      if (value) result.add(value);
    }
    return result;
  }

  function hasAncestor(nodes, index, ancestor) {
    const seen = new Set();
    let cursor = index;
    while (Number.isInteger(cursor) && nodes[cursor] && !seen.has(cursor)) {
      if (cursor === ancestor) return true;
      seen.add(cursor); cursor = nodes[cursor].parentIndex;
    }
    return false;
  }

  // The trace's own overall initUri (the gateway's single top-level URL for
  // this whole request) cannot discriminate between candidate parents by
  // exact match - every node in the trace shares it. But a candidate whose
  // *service name* echoes a word from that URL (e.g. a "cards" service for
  // initUri "/v1/cards/...") is weak supporting evidence for which specific
  // downstream service actually owns a call that has no other observed link
  // at all - only ever used together with time containment, same as the
  // existing pair-local service-uri signal below.
  function evidenceFor(nodes, parentIndex, childIndex, island, initUriTokens) {
    const parent = nodes[parentIndex], child = nodes[childIndex];
    if (!parent || !child || parentIndex === childIndex || hasAncestor(nodes, parentIndex, childIndex)) return null;
    const parentRange = nodeRange(parent), childRange = nodeRange(child);
    if (parentRange.start === null || childRange.start === null || parentRange.start > childRange.start + 25) return null;
    const gap = Math.max(0, childRange.start - parentRange.end);
    const contains = parentRange.start <= childRange.start && parentRange.end >= childRange.start;
    const listed = new Set([...list(child.unresolvedParentCandidates), ...list(island?.likelyNodeIndexes)]).has(parentIndex);
    const parentRoutes = nodeRoutes(parent), childRoutes = nodeRoutes(child);
    const exactRoute = intersects(parentRoutes, childRoutes);
    const parentBatches = values(parent, ["batchKeys"]), childBatches = values(child, ["batchKeys"]);
    const batch = intersects(parentBatches, childBatches);
    const produced = values(parent, ["kafkaProduces", "kafkaBrokers"]), consumed = values(child, ["kafkaConsumes", "kafkaBrokers"]);
    const topic = intersects(produced, consumed);
    const serviceTokens = words(parent.service), childServiceTokens = words(child.service);
    const routeTokens = new Set([...parentRoutes, ...childRoutes].flatMap(route => [...words(route)]));
    const serviceUri = intersects(serviceTokens, routeTokens) || intersects(childServiceTokens, routeTokens);
    const initUriService = initUriTokens?.size > 0 && (intersects(serviceTokens, initUriTokens) || intersects(childServiceTokens, initUriTokens));
    const sameFamily = intersects(serviceTokens, childServiceTokens);
    const syncEntry = island?.kind === "sync-entry";
    const eligible = listed || exactRoute || batch || topic || serviceUri && contains || initUriService && contains || !syncEntry && sameFamily && contains;
    if (!eligible || gap > 3000 && !listed && !exactRoute && !batch && !topic) return null;
    const score = (listed ? 100 : 0) + (batch ? 80 : 0) + (topic ? 75 : 0) + (exactRoute ? 70 : 0)
      + (serviceUri ? 40 : 0) + (initUriService ? 25 : 0) + (sameFamily ? 20 : 0) + (contains ? 30 : gap <= 500 ? 12 : gap <= 2000 ? 6 : 0);
    const evidence = [listed && "existing-candidate", batch && "batch", topic && "kafka-topic", exactRoute && "exact-uri",
      serviceUri && "service-uri", initUriService && "init-uri-service", sameFamily && "service-family", contains && "closed-window"].filter(Boolean);
    return { parentIndex, childIndex, score, distance:contains ? 0 : gap, evidence, parentCall:parentCallFor(parent, child) };
  }

  function proposalReason(evidence) {
    const labels = {
      "existing-candidate":"кандидат исходного анализа", batch:"общий batchRequestId", "kafka-topic":"одинаковый Kafka topic",
      "exact-uri":"совпавший URI", "service-uri":"service-name совпал с URI", "init-uri-service":"service-name совпал со словом из initUri всего trace",
      "service-family":"одна семья приложений", "closed-window":"вложенное временное окно"
    };
    return evidence.map(item => labels[item]).filter(Boolean).join(" · ");
  }

  // One pass over every still-unlinked node: which parents were eligible, how
  // they scored, and whether exactly one won. match() applies the winners;
  // explain() only reports them, so the diagnostic export can show why a
  // node stayed unlinked (no eligible candidate vs. a tie) without guessing.
  function evaluate(diagram) {
    const sourceNodes = list(diagram?.nodes);
    const islands = new Map(list(diagram?.rootIslands).map(island => [Number(island?.rootIndex), island]));
    const initUriTokens = entryUriTokens(diagram);
    const entries = [];
    for (const [childIndex, child] of sourceNodes.entries()) {
      // The entry has already been reconstructed from a gateway envelope.
      // A weaker, user-requested pass must not turn it into a downstream call.
      if (Number.isInteger(child?.parentIndex) || child?.reconstructedEntry) continue;
      const island = islands.get(childIndex) || { rootIndex:childIndex, kind:"standalone", likelyNodeIndexes:[] };
      const candidates = sourceNodes.map((_node, parentIndex) => evidenceFor(sourceNodes, parentIndex, childIndex, island, initUriTokens)).filter(Boolean)
        .sort((left, right) => right.score - left.score || left.distance - right.distance || left.parentIndex - right.parentIndex);
      const best = candidates[0] || null;
      const tied = best ? candidates.filter(item => item.score === best.score && item.distance === best.distance) : [];
      const outcome = !candidates.length ? "no-candidate" : tied.length !== 1 ? "tie" : "matched";
      entries.push({ childIndex, island, candidates, tied:tied.length, outcome,
        proposal: outcome === "matched" ? { ...best, reason:proposalReason(best.evidence), confidence:"low" } : null });
    }
    return { entries, initUriTokens };
  }

  function explain(diagram) {
    const { entries, initUriTokens } = evaluate(diagram);
    const serviceMatchesInitUri = node => initUriTokens.size > 0 && intersects(words(node?.service), initUriTokens);
    return Object.freeze({
      initUri: { present: initUriTokens.size > 0, tokenCount: initUriTokens.size },
      serviceMatchesInitUri: list(diagram?.nodes).map(serviceMatchesInitUri),
      unlinked: entries.map(entry => ({
        childIndex: entry.childIndex, islandKind: entry.island?.kind ?? null, outcome: entry.outcome, tied: entry.tied,
        candidates: entry.candidates.slice(0, 8).map(item => ({ parentIndex: item.parentIndex, score: item.score, distance: item.distance, evidence: [...item.evidence] }))
      }))
    });
  }

  function match(diagram) {
    const proposals = evaluate(diagram).entries.map(entry => entry.proposal).filter(Boolean);
    const result = clone(diagram || {});
    result.nodes = list(result.nodes);
    result.edges = list(result.edges);
    const applied = [];
    for (const proposal of proposals) {
      const child = result.nodes[proposal.childIndex], parent = result.nodes[proposal.parentIndex];
      if (!child || !parent || Number.isInteger(child.parentIndex)
        || hasAncestor(result.nodes, proposal.parentIndex, proposal.childIndex)) continue;
      const assumptionOrdinal = applied.length + 1;
      applied.push(proposal);
      child.parentIndex = proposal.parentIndex;
      child.parentInference = "user-assumption";
      child.assumptionOrdinal = assumptionOrdinal;
      child.heuristicConfidence = "low";
      child.heuristicEvidence = [...proposal.evidence];
      child.httpCallerService = parent.service || "Предполагаемый источник";
      child.httpCallerKey = child.httpCallerService;
      if (proposal.parentCall) child.parentCall = { ...proposal.parentCall };
      result.edges.push({ from:proposal.parentIndex, to:proposal.childIndex, assumption:true, inferred:true,
        assumptionOrdinal, requestObserved:false, responseObserved:false, confidence:"low", evidence:[...proposal.evidence], reason:proposal.reason });
    }
    const matched = new Set(applied.map(item => item.childIndex));
    result.rootIslands = list(result.rootIslands).filter(island => !matched.has(Number(island?.rootIndex)));
    const depthFor = (index, seen = new Set()) => {
      const parent = result.nodes[index]?.parentIndex;
      if (!Number.isInteger(parent) || seen.has(parent)) return 0;
      const next = new Set(seen); next.add(parent); return 1 + depthFor(parent, next);
    };
    result.nodes.forEach((_node, index) => { result.nodes[index].depth = depthFor(index); });
    result.assumptionMatches = applied.map((item, index) => ({ from:item.parentIndex, to:item.childIndex, assumptionOrdinal:index + 1, confidence:item.confidence,
      evidence:[...item.evidence], reason:item.reason }));
    result.assumptionMode = true;
    return result;
  }

  const api = Object.freeze({ match, explain, nodeRange, nodeRoutes, parentCallFor });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TraceAssumptionMatcher = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
