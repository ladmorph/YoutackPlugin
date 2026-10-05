// Explicit feature switches. One place, read by the service worker, the
// YouTrack content script and the YouTrack+ report page.
//
// youtrackTokenCapture: true
//   - the service worker may read the Authorization header of ordinary YouTrack
//     requests, but only while capture is armed
//     (extension/youtrack/youtrack-background.js). Arming happens in two cases:
//     the report is opened with the extension icon from a YouTrack tab, or the
//     user presses «Обновить подключение» in the report. Opening an extension
//     page on its own never yields a token.
//
// youtrackSensorOnSite: false
//   - nothing from the sensor is injected into youtrack-mapps.sovcombank.ru:
//     no "Подключить меня?" assistant, no mascot, no overlay. The site stays
//     untouched; all tooling lives in the extension pages.
globalThis.SensorFeatureFlags = Object.freeze({
  youtrackTokenCapture: true,
  youtrackSensorOnSite: false
});
