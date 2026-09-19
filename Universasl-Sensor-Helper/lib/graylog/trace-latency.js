(function initializeTraceLatency(root) {
  "use strict";
  const DEFAULT_THRESHOLD_MS = 3000;
  let thresholdMs = DEFAULT_THRESHOLD_MS;
  function number(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && !value.trim()) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  }
  function setThreshold(value) {
    const numeric = number(value);
    if (numeric === null || !Number.isInteger(numeric) || numeric < 1 || numeric > 86400000) return false;
    thresholdMs = numeric;
    return true;
  }
  function duration(call) {
    if (!call || call.oneWay || call.kafkaProduce || call.cacheChain) return null;
    const explicit = number(call.responseDuration);
    if (explicit !== null) return explicit;
    // Do not turn first/last events of several calls into one execution time.
    const singleRequest = call.requestObserved === true || Number(call.requestCount) === 1;
    const singleResponse = call.responseObserved === true || Number(call.responseCount) === 1;
    const start = number(call.requestAt), end = number(call.responseAt);
    return singleRequest && singleResponse && start !== null && end !== null && end >= start ? end - start : null;
  }
  function isSlow(value) { const numeric = number(value); return numeric !== null && numeric > thresholdMs; }
  function externalDurations(node) {
    const result = [];
    for (const [prefix, label] of [["openApi", "OPENAPI"], ["gorodClient", "HTTP CLIENT"], ["partnerBackend", "PARTNER BACKEND"]]) {
      const samples = node?.[`${prefix}ResponseSamples`];
      const durations = Array.isArray(samples) && samples.length ? samples.map(sample => sample.duration) : node?.[`${prefix}ResponseDurations`];
      const values = Array.isArray(durations) ? durations : [];
      if (!values.length || (values.length === 1 && number(values[0]) === null)) {
        const ms = duration({ requestCount:node?.[`${prefix}RequestCount`], responseCount:node?.[`${prefix}ResponseCount`], requestAt:node?.[`${prefix}RequestAt`], responseAt:node?.[`${prefix}ResponseAt`] });
        if (ms !== null) result.push({label, index:0, durationMs:ms});
      } else values.forEach((value, index) => { const ms = number(value); if (ms !== null) result.push({label, index, durationMs:ms}); });
    }
    return result;
  }
  const api = { DEFAULT_THRESHOLD_MS, getThreshold: () => thresholdMs, setThreshold, duration, isSlow, externalDurations };
  root.TraceLatency = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
