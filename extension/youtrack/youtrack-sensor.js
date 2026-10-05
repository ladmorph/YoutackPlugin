// The sensor is no longer injected into the YouTrack site (feature flag
// youtrackSensorOnSite in extension/feature-flags.js). The file is kept only as
// a cleanup shim for pages that still hold the assistant from an older build.
(() => {
  'use strict';
  document.getElementById('youtrack-session-assistant')?.remove();
  globalThis.__youtrackReferenceAssistantDispose?.();
})();
