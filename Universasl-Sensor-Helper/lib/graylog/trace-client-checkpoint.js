(function (root) {
  "use strict";
  // Temporary parser for the Graylog page. Raw targets must be masked by the
  // caller before they cross the extension message boundary.
  function parse(value) {
    if (typeof value !== "string") return null;
    const text = value.slice(0, 8192).split(/\b(?:(?:REQUEST|RESPONSE)[_\s]+)?BODY["']?\s*[:=]/i, 1)[0].trim();
    if (!/^(?:org\.springframework\.web\.reactive\.function\.client\.)?WebClientRequestException(?=\s|:|$)/.test(text)) return null;
    const targets = new Map();
    const pattern = /checkpoint\s*(?:⇢|->|→)\s*Request to (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+((?:https?:\/\/|\/)[^\s<>"']{1,1024})\s+\[DefaultWebClient\]/g;
    for (const match of text.matchAll(pattern)) {
      try {
        const url = new URL(match[2], "https://trace.invalid");
        if (!["http:", "https:"].includes(url.protocol) || match[2].startsWith("//")) continue;
        targets.set(`${match[1]} ${match[2]}`, { method:match[1], target:match[2] });
      } catch {}
    }
    return targets.size === 1 ? [...targets.values()][0] : null;
  }
  const api = { parse };
  root.TraceClientCheckpoint = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
