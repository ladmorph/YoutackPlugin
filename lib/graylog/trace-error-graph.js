(function initializeTraceErrorGraph(root) {
  "use strict";
  function dependency(category) { return ["sql", "postgres", "oracle"].includes(category) ? "database" : category === "redis" ? "redis" : category === "kafka" ? "kafka" : null; }
  function metadata(value, limit) { return typeof value === "string" ? value.slice(0, limit) : ""; }
  function build(nodes, analysis, references = root.ErrorReference?.entries || []) {
    if (!analysis?.available) return [];
    const byReference = new Map(references.map(entry => [entry.id, entry]));
    const owners = new Map();
    (Array.isArray(nodes) ? nodes : []).forEach((node, index) => {
      for (const span of new Set([node.spanId, ...(node.recoveredSpanIds || [])])) {
        if (!node.service || !span) continue;
        const key = JSON.stringify([node.service, span]);
        if (!owners.has(key)) owners.set(key, new Set());
        owners.get(key).add(index);
      }
    });
    const diagnostics = new Map();
    for (const group of Array.isArray(analysis.groups) ? analysis.groups : []) {
      if (group.classification !== "recognized" || group.conflict || group.nature === "business") continue;
      const kind = dependency(group.category);
      if (!kind) continue;
      const reference = byReference.get(group.referenceId);
      const referenceMatches = reference && dependency(reference.category) === kind;
      const applicationRedis = kind === "redis" && group.errorType === "application.response_code.redis_context"
        && group.matchedRule === "application.response_code.redis_context" && group.exceptionType === "ResponseCodeException";
      const title = referenceMatches ? reference.title : applicationRedis ? "ResponseCodeException" : kind === "database" && group.category === "sql" ? root.TraceErrorCatalog?.titleFor?.(group.errorType) : null;
      if (!title || !Number.isSafeInteger(group.count) || group.count < 1) continue;
      const service = metadata(group.service, 160), spanId = metadata(group.spanId, 128);
      const matches = service && spanId ? owners.get(JSON.stringify([service, spanId])) : null;
      const ownerIndex = matches?.size === 1 ? [...matches][0] : null;
      const binding = ownerIndex !== null ? "exact" : matches?.size > 1 ? "ambiguous" : "unmatched";
      const key = JSON.stringify([ownerIndex, ownerIndex === null ? service : "", ownerIndex === null ? spanId : "", kind]);
      if (!diagnostics.has(key)) diagnostics.set(key, {
        dependency:kind, label:kind === "redis" ? "Redis" : kind === "kafka" ? "Kafka" : "База данных", ownerIndex, binding,
        service, spanIds:[], eventCount:0, causes:[]
      });
      const result = diagnostics.get(key);
      if (spanId && !result.spanIds.includes(spanId)) result.spanIds.push(spanId);
      result.eventCount += group.count;
      const causeId = referenceMatches ? reference.id : group.errorType;
      const exceptionMessage = applicationRedis ? root.TraceErrorCatalog?.safeResponseText(group.exceptionMessage) || "" : "";
      let cause = result.causes.find(item => item.id === causeId && (item.exceptionMessage || "") === exceptionMessage);
      if (!cause) { cause = {id:causeId, title, count:0}; if (applicationRedis) Object.assign(cause, {exceptionType:"ResponseCodeException",exceptionMessage}); result.causes.push(cause); }
      cause.count += group.count;
    }
    return [...diagnostics.values()];
  }
  const api = Object.freeze({build});
  root.TraceErrorGraph = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
