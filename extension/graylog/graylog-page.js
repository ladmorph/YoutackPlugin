(function installGraylogPage(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GraylogPage = api;
})(globalThis, function createGraylogPage() {
  "use strict";

  const SEARCH_PATH = /(?:^|\/)search(?:\/|$)/i;
  const GRAYLOG_WORD = /\bgraylog\b/i;

  function isSearchLocation(locationLike) {
    return SEARCH_PATH.test(String(locationLike?.pathname || ""));
  }

  function evidenceText(element) {
    if (!element) return "";
    const values = [
      element.textContent,
      element.getAttribute?.("alt"),
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("href")
    ];
    return values.filter(value => typeof value === "string").join(" ").slice(0, 600);
  }

  function hasGraylogEvidence(documentLike) {
    if (!documentLike) return false;
    if (GRAYLOG_WORD.test(String(documentLike.title || ""))) return true;
    const applicationName = documentLike.querySelector?.('meta[name="application-name"]')?.getAttribute?.("content");
    if (GRAYLOG_WORD.test(String(applicationName || ""))) return true;

    // Graylog 3.x exposes these two stable shell anchors before the result rows mount.
    if (documentLike.getElementById?.("global-notifications") && documentLike.getElementById?.("main-row")) return true;

    const brandCandidates = documentLike.querySelectorAll?.('nav,header,[role="banner"],img[alt],a[aria-label]') || [];
    for (const element of Array.from(brandCandidates).slice(0, 32)) {
      if (GRAYLOG_WORD.test(evidenceText(element))) return true;
    }
    return false;
  }

  function isSupported(documentLike = globalThis.document, locationLike = globalThis.location) {
    return isSearchLocation(locationLike) && hasGraylogEvidence(documentLike);
  }

  return Object.freeze({ isSearchLocation, hasGraylogEvidence, isSupported });
});
