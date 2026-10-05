(function initializeGraylogConstants(root) {
  "use strict";
  // The gateway service name and the standard spam-check hour are baked
  // into several independent query strings and date calculations across the
  // popup UI (percentiles, spam check, release monitoring). Kept in one
  // place so a service rename or schedule change does not require hunting
  // through multiple files for the same literal.
  const GATEWAY_SERVICE_NAME = "online-banking-gateway";
  const MOSCOW_STANDARD_START_HOUR = 11;
  const api = Object.freeze({ GATEWAY_SERVICE_NAME, MOSCOW_STANDARD_START_HOUR });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GraylogConstants = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
