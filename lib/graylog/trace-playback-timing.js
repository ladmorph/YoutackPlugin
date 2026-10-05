(function initializeTracePlaybackTiming(root) {
  "use strict";

  function nonnegativeNumber(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && !value.trim()) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  }

  function latency(record) {
    if (!record || record.oneWay || record.cacheChain || record.kafkaProduce) return null;
    // Aggregated span durations may represent the last/modal response rather than
    // the exchange being animated. Do not pair their first request and response.
    // Subcall requestTotal/responseTotal are family totals, not record counts.
    if ([record.requestCount, record.responseCount].some(value => nonnegativeNumber(value) > 1)
      || [record.requestTimes, record.responseTimes].some(value => Array.isArray(value) && value.length > 1)) return null;
    const explicit = nonnegativeNumber(record.responseDuration);
    if (explicit !== null) return explicit;
    const observed = (side) => {
      const count = nonnegativeNumber(record[`${side}Count`]);
      if (count !== null) return count === 1;
      return record[`${side}Observed`] === true;
    };
    // The trace model supplies normalized epoch milliseconds. A missing timestamp
    // is unknown, including when Number(null) would otherwise silently yield zero.
    const start = nonnegativeNumber(record.requestAt);
    const end = nonnegativeNumber(record.responseAt);
    return observed("request") && observed("response") && start !== null && end !== null && end >= start ? end - start : null;
  }

  function forRecord(record) {
    const latencyMs = latency(record);
    if (latencyMs === null) return { latencyMs: null, durationMs: 650, band: "unknown" };
    if (latencyMs < 500) return { latencyMs, durationMs: 650, band: "medium" };
    return { latencyMs, durationMs: 1000, band: "slow" };
  }

  function travelDuration(distancePx, band = "unknown") {
    const distance = nonnegativeNumber(distancePx);
    if (distance === null) return band === "slow" ? 1000 : 650;
    const pixelsPerSecond = band === "slow" ? 650 : 900;
    return Math.round(Math.min(1800,Math.max(420,distance/pixelsPerSecond*1000)));
  }

  const api = { forRecord, travelDuration };
  root.TracePlaybackTiming = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
