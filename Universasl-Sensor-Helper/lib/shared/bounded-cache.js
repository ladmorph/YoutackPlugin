(function initializeBoundedCache(root) {
  "use strict";
  // The popup's caches (spam hour buckets, monitor releases/traces, percentile
  // buckets, safe search, trace diagrams) all reimplemented the same
  // insertion-order eviction idiom on their own Map. One shared helper keeps
  // that eviction rule in a single place instead of six copies that can drift.
  function pruneCache(cache, limit) {
    while (cache.size > limit) cache.delete(cache.keys().next().value);
  }

  const api = Object.freeze({ pruneCache });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BoundedCache = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
