(() => {
  "use strict";
  const button = document.querySelector("#youtrack-launch");
  button?.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try { await chrome.tabs.create({ url:chrome.runtime.getURL("extension/youtrack/youtrack.html"), active:true }); }
    finally { button.disabled = false; }
  });
})();
