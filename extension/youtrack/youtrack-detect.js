(() => {
  "use strict";
  if (window.top !== window || globalThis.__youtrackDetector) return;
  globalThis.__youtrackDetector = true;
  let started = false, enabled=false;
  function isYouTrack() {
    return /(?:^|\.)youtrack(?:\.|$)/i.test(location.hostname)
      || /(?:^|\/)youtrack(?:\/|$)/i.test(location.pathname)
      || /\byoutrack\b/i.test(document.title)
      || /\byoutrack\b/i.test(document.querySelector('meta[name="application-name"]')?.content || "");
  }
  async function check() {
    if (!enabled || started || !isYouTrack()) return;
    if((await chrome.storage.local.get("youtrackEnabled")).youtrackEnabled!==true)return;
    if(started)return;
    started = true; observer?.disconnect();
    try {
      const response = await fetch(chrome.runtime.getURL("extension/youtrack/youtrack-sensor.css"));
      const sheet = new CSSStyleSheet(); sheet.replaceSync(await response.text());
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      await import(chrome.runtime.getURL("extension/shared/sensor-mascot.js"));
      await import(chrome.runtime.getURL("extension/youtrack/youtrack-sensor.js"));
    } catch { started = false; }
  }
  // Only the small head is observed, briefly, for SPAs that set the title late.
  const observer = document.head ? new MutationObserver(check) : null;
  const apply=value=>{enabled=value===true;if(!enabled){observer?.disconnect();return;}if(!started){observer?.observe(document.head,{childList:true,subtree:true,characterData:true});setTimeout(()=>observer?.disconnect(),15000);check();}};
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.youtrackEnabled)apply(changes.youtrackEnabled.newValue);});
  chrome.storage.local.get('youtrackEnabled').then(v=>apply(v.youtrackEnabled));
})();
