(function installGraylogRuntime(root) {
  "use strict";
  if (root.GraylogRuntime?.available?.()) return;
  if (!root.document?.documentElement) return;
  if (root.GraylogPage && !root.GraylogPage.isSupported(root.document, root.location)) return;
  const doc = root.document;
  const runtime = root.chrome?.runtime;
  const listeners = new Set();
  const pending = new Set();
  let stopped = false;
  let monitor = null;
  const ownerId = "advanced-graylog-runtime-owner";
  const previous = doc.getElementById(ownerId);
  previous?.remove();
  // Only our own hosts are replaced. Native result rows and their text stay put.
  if (previous) {
    for (const id of ["advanced-graylog-clippy-root", "advanced-graylog-preview-root", "advanced-graylog-trace-action", "advanced-graylog-runtime-notice"]) doc.getElementById(id)?.remove();
    for (const host of doc.querySelectorAll("[data-advanced-graylog-message-badges]")) host.remove();
  }
  const owner = doc.createElement("span");
  owner.id = ownerId;
  owner.hidden = true;
  doc.documentElement.append(owner);
  const invalidMessage = "Помощник потерял связь с расширением. Обновите страницу Graylog, чтобы подключить его снова.";
  const isInvalid = error => /extension context invalidated/i.test(String(error?.message || error || ""));
  function notice() {
    if (!owner.isConnected || doc.getElementById("advanced-graylog-runtime-notice")) return;
    const host = doc.createElement("div");
    host.id = "advanced-graylog-runtime-notice";
    host.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;width:min(330px,calc(100vw - 32px));z-index:2147483647";
    const shadow = host.attachShadow({mode:"closed"});
    const style = doc.createElement("style");
    style.textContent = ":host{all:initial}section{font:13px/1.5 system-ui;background:#fff;color:#29434d;border:1px solid #bacdd3;border-radius:12px;padding:14px;box-shadow:0 4px 18px #0002}p{margin:0 0 10px}button{font:600 12px system-ui;border:1px solid #94b2ba;border-radius:6px;background:#f3f8f9;color:#185967;padding:7px 10px;cursor:pointer}button+button{margin-left:8px}";
    const section = doc.createElement("section"); section.setAttribute("role","status");
    const text = doc.createElement("p"); text.textContent = invalidMessage;
    const reload = doc.createElement("button"); reload.type="button"; reload.textContent="Обновить страницу";
    reload.addEventListener("click",()=>root.location.reload());
    const close = doc.createElement("button"); close.type="button"; close.textContent="Закрыть";
    close.addEventListener("click",()=>host.remove());
    section.append(text,reload,close);
    if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in shadow) {
      const sheet=new CSSStyleSheet();sheet.replaceSync(style.textContent);shadow.adoptedStyleSheets=[sheet];
    } else shadow.append(style);
    shadow.append(section);doc.documentElement.append(host);
  }
  function stop(showNotice = true) {
    if (stopped) return;
    stopped = true;
    clearInterval(monitor);
    for (const reject of [...pending]) reject(new Error(invalidMessage));
    pending.clear();
    for (const listener of [...listeners]) { try { listener(); } catch {} }
    listeners.clear();
    if (showNotice) { try { notice(); } catch {} }
  }
  function available() {
    if (stopped) return false;
    if (!owner.isConnected) { stop(false);return false; }
    try {
      if (typeof runtime?.id !== "string" || !runtime.id) { stop();return false; }
      // Synchronous validity check only: no worker message and no HTTP.
      runtime.getURL("");
      return true;
    } catch { stop();return false; }
  }
  function handle(error) { if (isInvalid(error)) stop();return new Error(isInvalid(error) ? invalidMessage : error?.message || String(error)); }
  async function sendMessage(message, {timeoutMs=15000}={}) {
    if (!available()) throw new Error(invalidMessage);
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);pending.delete(cancel);error?reject(error):resolve(value);};
      const cancel=error=>finish(error);
      const timer=setTimeout(()=>finish(new Error("Расширение не ответило. Повторите действие после завершения текущей операции.")),timeoutMs);
      pending.add(cancel);
      try {
        Promise.resolve(runtime.sendMessage(message)).then(value=>{if(available())finish(null,value);else finish(new Error(invalidMessage));},error=>finish(handle(error)));
      } catch(error) { finish(handle(error)); }
    });
  }
  root.GraylogRuntime=Object.freeze({available,sendMessage,handle,
    getURL(path){if(!available())return "";try{return runtime.getURL(path);}catch(error){handle(error);return "";}},
    onInvalidated(listener){if(stopped){listener();return()=>{};}listeners.add(listener);return()=>listeners.delete(listener);},
    getState:()=>({active:!stopped,owner:owner.isConnected})
  });
  monitor=setInterval(available,1000);
  root.addEventListener("pagehide",()=>stop(false),{once:true});
})(globalThis);
