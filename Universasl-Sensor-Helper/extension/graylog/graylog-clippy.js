(function installGraylogClippy() {
  "use strict";
  if (globalThis.GraylogPage && !globalThis.GraylogPage.isSupported(document, location)) return;
  const runtime = globalThis.GraylogRuntime;
  if (runtime && !runtime.available()) return;
  const assetUrl = path => runtime ? runtime.getURL(path) : chrome.runtime.getURL(path);
  const sendMessage = async message => runtime ? runtime.sendMessage(message) : chrome.runtime.sendMessage(message);
  let disposed = false;
  if (globalThis.__advancedGraylogClippy?.activate) {
    globalThis.__advancedGraylogClippy.activate();
    return;
  }
  const helper = globalThis.GraylogOverlay;
  if (!helper || !document.documentElement || !/(?:^|\/)search(?:\/|$)/i.test(location.pathname)) return;
  const introAlreadyShown=Boolean(globalThis.__advancedGraylogSensorIntroShown);globalThis.__advancedGraylogSensorIntroShown=true;

  function setShadowContent(target, css, markup) {
    target.innerHTML = markup;
    if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in target) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      target.adoptedStyleSheets = [sheet];
      return;
    }
    const style = document.createElement("style");
    style.textContent = css;
    target.prepend(style);
  }

  const rootHost = document.createElement("div");
  rootHost.id = "advanced-graylog-clippy-root";
  rootHost.style.cssText = "all:initial;position:fixed;right:18px;bottom:16px;z-index:2147483647;width:258px;height:172px;pointer-events:none;color-scheme:dark";
  const shadow = rootHost.attachShadow({mode:"closed"});
  setShadowContent(shadow, `
    :host{all:initial}.companion{position:absolute;right:0;bottom:0;width:258px;height:172px;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#e6f7ff;pointer-events:none}.companion[data-intro="pending"]{opacity:0;pointer-events:none}
    .bubble{position:absolute;right:80px;bottom:106px;max-width:174px;min-width:130px;padding:9px 31px 9px 11px;border:1px solid #3a7085;border-radius:12px 12px 3px 12px;background:linear-gradient(145deg,#102b38,#0a1d27);box-shadow:0 8px 28px #0008;font:600 12px/1.4 Inter,system-ui,sans-serif;opacity:1;transform:translateY(0);transition:opacity .18s,transform .18s;pointer-events:auto}
    .bubble.quiet{opacity:0;transform:translateY(5px);pointer-events:none}.bubble p{margin:0}.skin-toggle{position:absolute;right:5px;top:5px;width:21px;height:21px;border:1px solid #4f7989;border-radius:7px;background:#173540;color:#dff9ff;cursor:pointer;font:800 12px/1 system-ui}.skin-menu{position:absolute;right:4px;top:31px;width:108px;padding:5px;border:1px solid #456d7c;border-radius:9px;background:#0c2029;box-shadow:0 8px 22px #000a;z-index:2}.skin-menu[hidden]{display:none}.skin-menu button{display:block;width:100%;border:0;border-radius:6px;background:transparent;color:#dff7ff;padding:6px 8px;text-align:left;cursor:pointer;font:700 11px/1.2 system-ui}.skin-menu button:hover,.skin-menu button[aria-checked="true"]{background:#244653;color:#fff}.figure{position:absolute;right:0;bottom:0;width:124px;height:124px;border:0;padding:0;background:transparent;cursor:pointer;pointer-events:auto;filter:drop-shadow(0 7px 8px #0008)}
    .figure:focus-visible{outline:3px solid #68f4e3;outline-offset:3px;border-radius:50%}.figure .orb-visual{display:block;width:120px;height:120px;overflow:visible}.classic-visual{display:none;width:120px;height:120px;object-fit:contain}.skin-clippy .orb-visual{display:none}.skin-clippy .classic-visual{display:block}.orb{transform-origin:60px 62px;animation:orb-float 3.2s ease-in-out infinite}.wave{filter:drop-shadow(0 0 3px #ff3944);animation:wave-pulse 3.2s ease-in-out infinite}.eye{transition:opacity .18s}.scan,.trace-ring,.graph-effect,.percent-effect,.success-effect,.warning-effect{opacity:0}.trace-ring{transform-origin:60px 56px}.right-arm{transform-origin:91px 68px;transition:transform .25s}.scene-search .face{fill:#251419}.scene-search .eye{opacity:.15}.scene-search .scan{opacity:1;animation:scan-sweep 1.1s ease-in-out infinite}.scene-search .orb{animation-duration:1.1s}.scene-trace .trace-ring{opacity:1;animation:trace-lock .55s ease-out both}.scene-graph .graph-effect{opacity:1;animation:effect-breathe 1.6s ease-in-out infinite}.scene-percentiles .percent-effect{opacity:1;animation:effect-breathe 1.4s ease-in-out infinite}.scene-success .success-effect{opacity:1;animation:pop .8s ease-out both}.scene-warning .warning-effect{opacity:1;animation:pop 1s ease-out both}.scene-open .right-arm{transform:rotate(-18deg)}.scene-open .orb{animation:open-turn .65s ease-out both}.searching .figure{filter:drop-shadow(0 0 12px #ff3844)}
    .close,.restore,.tools-toggle{display:none!important}.helper-actions{position:absolute;right:132px;bottom:15px;display:flex;align-items:center;gap:8px;pointer-events:none}.operation-cancel{position:static;display:inline-flex;align-items:center;gap:5px;min-height:28px;padding:5px 9px;border:1px solid #ff7d84;border-radius:999px;background:#9f1f29;color:#fff;box-shadow:0 5px 16px #0007;cursor:pointer;pointer-events:auto;font:800 11px/1 system-ui}.operation-cancel[hidden]{display:none}.operation-cancel:hover{background:#bd2632}.operation-cancel:focus-visible{outline:3px solid #fff;outline-offset:2px}.operation-cancel:disabled{opacity:.75;cursor:wait}
    .review-finding,.trace-explore{display:block;margin:8px 0 0;max-width:100%;padding:5px 7px;border:1px solid #589a96;border-radius:5px;background:#214b4b;color:#e8fffa;font:600 11px/1.3 system-ui,sans-serif;text-align:left;cursor:pointer}.review-finding[hidden],.trace-explore[hidden]{display:none}.review-finding:hover,.trace-explore:hover{background:#2a605e}.review-finding:focus-visible,.trace-explore:focus-visible{outline:2px solid #8ef7e0;outline-offset:2px}
    @keyframes orb-float{0%,100%{transform:translateY(1px) rotate(-1deg)}50%{transform:translateY(-3px) rotate(1deg)}}@keyframes wave-pulse{0%,72%,100%{opacity:.8}82%{opacity:1;filter:drop-shadow(0 0 7px #ff3944)}}@keyframes scan-sweep{0%{transform:translateX(-15px);opacity:0}20%,80%{opacity:1}100%{transform:translateX(15px);opacity:0}}@keyframes trace-lock{0%{transform:scale(1.45);opacity:0}100%{transform:scale(1);opacity:1}}@keyframes effect-breathe{0%,100%{opacity:.65}50%{opacity:1}}@keyframes pop{0%{transform:scale(.65);opacity:0}70%{transform:scale(1.12);opacity:1}100%{transform:scale(1);opacity:1}}@keyframes open-turn{0%{transform:translateX(0) rotate(0)}55%{transform:translateX(-4px) rotate(-7deg)}100%{transform:translateX(0) rotate(0)}}
    @media(prefers-reduced-motion:reduce){.bubble{transition:none!important}.orb,.wave,.scan,.trace-ring,.graph-effect,.percent-effect,.success-effect,.warning-effect{animation:none!important}}
    @media(max-height:700px){.companion{height:142px}.figure{width:100px;height:100px}.figure .orb-visual,.classic-visual{width:96px;height:96px}.bubble{right:68px;bottom:84px}.helper-actions{right:108px;bottom:10px}}
    @media(max-width:600px){.companion{width:218px}.bubble{right:72px;max-width:140px}.figure .orb-visual,.classic-visual{width:92px;height:92px}.figure{width:96px;height:96px}.helper-actions{right:104px;bottom:8px}}
    .figure .sensor-live{display:block;position:absolute;inset:0;width:120px;height:120px;pointer-events:none}.figure[data-sensor-rig] .mascot-visual{display:none!important;animation:none!important}.figure.skin-clippy .sensor-live{display:none}@media(max-height:700px){.figure .sensor-live{width:96px;height:96px}}@media(max-width:600px){.figure .sensor-live{width:92px;height:92px}}.figure{--sensor-glow:#48edf3}.figure::after{content:"";position:absolute;z-index:-2;inset:22px 14px 10px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--sensor-glow) 44%,transparent),transparent 70%);filter:blur(7px);animation:sensor-breathe 3.2s ease-in-out infinite}.figure .mascot-visual{display:block;width:120px;height:120px;object-fit:contain;transform-origin:50% 82%;animation:sensor-float 3.4s ease-in-out infinite}.figure .mascot-wave{position:absolute;inset:0;opacity:0}.skin-orb .orb-visual{display:none}.skin-clippy .mascot-visual{display:none}.scene-search .mascot-base{filter:drop-shadow(0 0 11px #48edf3);animation:sensor-search 1.15s ease-in-out infinite}.scene-warning .mascot-base{filter:drop-shadow(0 0 10px #ff3542);animation:sensor-alert .52s ease-in-out 3}.figure.scene-warning{--sensor-glow:#ff3542}.scene-success .mascot-base{filter:drop-shadow(0 0 10px #32d79b);animation:sensor-success .78s cubic-bezier(.2,.8,.2,1) 2}.figure.scene-success{--sensor-glow:#32d79b}.scene-trace .mascot-base,.scene-graph .mascot-base,.scene-percentiles .mascot-base{filter:drop-shadow(0 0 10px #48edf3)}
    .companion.intro-start,.companion.intro-flight{pointer-events:none}.companion.intro-start{transform:translateX(calc(-50vw + 80px)) translateY(8px) scale(1.12)}.companion.intro-flight{transform:none;transition:transform 1.25s cubic-bezier(.2,.86,.2,1)}.companion.intro-start .figure,.companion.intro-flight .figure{pointer-events:none}.companion.intro-start .figure{transform:scale(1.28)}.companion.intro-flight .figure{transform:none;transition:transform 1.25s cubic-bezier(.2,.86,.2,1)}.companion.intro-start .mascot-base{animation:sensor-base-crossfade .9s ease-in-out infinite}.companion.intro-start .mascot-wave{animation:sensor-wave-crossfade .9s ease-in-out infinite}.companion.intro-flight .mascot-base{animation:sensor-arrive 1.25s ease-out both}.companion.intro-flight .mascot-wave{animation:none;opacity:0}.companion.intro-flight .figure::before{content:"";position:absolute;z-index:-1;right:60px;top:58px;width:clamp(90px,38vw,520px);height:5px;border-radius:999px;background:linear-gradient(90deg,transparent,#48edf3 58%,#ff3542);filter:drop-shadow(0 0 7px #47e8ed);transform-origin:right center;animation:sensor-beam 1.25s ease-out both}
    @keyframes sensor-float{0%,100%{transform:translateY(1px) rotate(-1deg)}50%{transform:translateY(-4px) rotate(1.5deg)}}@keyframes sensor-breathe{0%,100%{opacity:.32;transform:scale(.88)}50%{opacity:.78;transform:scale(1.08)}}@keyframes sensor-search{0%,100%{transform:translateY(1px) rotate(-3deg) scale(1)}50%{transform:translateY(-5px) rotate(3deg) scale(1.035)}}@keyframes sensor-alert{0%,100%{transform:translateX(0) rotate(0)}30%{transform:translateX(-3px) rotate(-2deg)}70%{transform:translateX(3px) rotate(2deg)}}@keyframes sensor-success{0%,100%{transform:translateY(0) scale(1)}42%{transform:translateY(-9px) scale(1.035)}72%{transform:translateY(2px) scale(.985)}}@keyframes sensor-base-crossfade{0%,38%,100%{opacity:1;transform:translateY(0)}50%,86%{opacity:0;transform:translateY(-2px)}}@keyframes sensor-wave-crossfade{0%,38%,100%{opacity:0;transform:translateY(0)}50%,86%{opacity:1;transform:translateY(-2px)}}@keyframes sensor-arrive{0%{transform:scale(1.1) rotate(-5deg);filter:drop-shadow(0 0 16px #48edf3)}70%{transform:scale(.96) rotate(2deg)}100%{transform:scale(1) rotate(0)}}@keyframes sensor-beam{0%{opacity:0;transform:scaleX(.1)}25%{opacity:1}100%{opacity:0;transform:scaleX(1)}}
    @media(max-height:700px){.figure .mascot-visual{width:96px;height:96px}}@media(max-width:600px){.figure .mascot-visual{width:92px;height:92px}}@media(prefers-reduced-motion:reduce){.companion{transition:none!important}.mascot-visual,.figure::before,.figure::after{animation:none!important}}
  `, "");
  const companion = document.createElement("aside"); companion.className="companion"; companion.dataset.intro="pending"; companion.setAttribute("aria-label","Graylog-помощник Сенсор — переход к анализу");
  const bubble = document.createElement("div"); bubble.className="bubble";
  const phrase = document.createElement("p"); phrase.setAttribute("role","status"); phrase.setAttribute("aria-live","polite");
  const traceExplore = document.createElement("button");traceExplore.type="button";traceExplore.className="trace-explore";traceExplore.textContent="Давай разберёмся →";traceExplore.title="Открыть компактный граф и процентили этого traceId";traceExplore.hidden=true;
  const reviewFinding = document.createElement("button"); reviewFinding.type="button";reviewFinding.className="review-finding";reviewFinding.textContent="Открыть разбор ↗";reviewFinding.title="Открыть подробный разбор ошибок и источников в расширении";reviewFinding.hidden=true;
  const skinToggle=document.createElement("button");skinToggle.className="skin-toggle";skinToggle.type="button";skinToggle.textContent="⌄";skinToggle.title="Сменить помощника";skinToggle.setAttribute("aria-label","Сменить визуал помощника");skinToggle.setAttribute("aria-haspopup","menu");skinToggle.setAttribute("aria-expanded","false");
  const skinMenu=document.createElement("div");skinMenu.className="skin-menu";skinMenu.hidden=true;skinMenu.setAttribute("role","menu");
  const orbChoice=document.createElement("button");orbChoice.type="button";orbChoice.textContent="◉ Сенсор";orbChoice.dataset.skin="orb";orbChoice.setAttribute("aria-label","Выбрать помощника Сенсор");orbChoice.setAttribute("role","menuitemradio");
  const clippyChoice=document.createElement("button");clippyChoice.type="button";clippyChoice.textContent="📎 Clippy";clippyChoice.dataset.skin="clippy";clippyChoice.setAttribute("role","menuitemradio");skinMenu.append(orbChoice,clippyChoice);
  const figure = document.createElement("button"); figure.className="figure"; figure.type="button"; figure.title="Сенсор — открыть расширение и перейти к анализу"; figure.setAttribute("aria-label","Сенсор — открыть Advanced Graylog");figure.setAttribute("aria-haspopup","menu");figure.setAttribute("aria-expanded","false");
  figure.innerHTML=`<svg class="orb-visual" viewBox="0 0 120 120" aria-hidden="true"><defs><radialGradient id="orb-shell" cx="34%" cy="25%"><stop offset="0" stop-color="#5a606a"/><stop offset=".62" stop-color="#30343b"/><stop offset="1" stop-color="#181b20"/></radialGradient><radialGradient id="orb-face" cx="38%" cy="30%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#d9dde2"/></radialGradient><linearGradient id="orb-red" x1="0" x2="1"><stop stop-color="#ff5c65"/><stop offset="1" stop-color="#bd1019"/></linearGradient><filter id="orb-glow"><feGaussianBlur stdDeviation="2.4"/></filter></defs><ellipse cx="61" cy="108" rx="30" ry="5" fill="#02080c" opacity=".42"/><g class="orb"><path class="left-arm" d="M29 65C17 69 15 81 21 89" fill="none" stroke="#31363e" stroke-width="8" stroke-linecap="round"/><circle cx="21" cy="91" r="7" fill="#dadddf" stroke="#20242a" stroke-width="3"/><path class="right-arm" d="M91 65c12 2 16 11 13 21" fill="none" stroke="#31363e" stroke-width="8" stroke-linecap="round"/><g class="right-arm"><circle cx="103" cy="88" r="7" fill="#dadddf" stroke="#20242a" stroke-width="3"/><path d="M103 83v-7m4 9l5-5" stroke="#f4f5f6" stroke-width="3" stroke-linecap="round"/></g><circle cx="60" cy="58" r="40" fill="url(#orb-shell)" stroke="#717680" stroke-width="2"/><circle class="face" cx="60" cy="56" r="31" fill="url(#orb-face)" stroke="#a9adb4" stroke-width="2"/><circle cx="24" cy="57" r="10" fill="#2c3036" stroke="#ef2934" stroke-width="4"/><circle cx="96" cy="57" r="7" fill="#24282e" stroke="#ef2934" stroke-width="3"/><path class="eye" d="M42 51q5-7 10 0M68 51q5-7 10 0" fill="none" stroke="#25232a" stroke-width="3.5" stroke-linecap="round"/><path class="wave" d="M39 61h9l4-8 6 18 6-23 6 17 4-7 4 3h5" fill="none" stroke="url(#orb-red)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M48 96h24l-4 8H52z" fill="url(#orb-red)" stroke="#701016" stroke-width="2"/><rect x="44" y="103" width="32" height="5" rx="2.5" fill="#f72e38" opacity=".45" filter="url(#orb-glow)"/><g class="scan"><rect x="39" y="40" width="3" height="35" rx="1.5" fill="#ff3641"/><path d="M42 40h13v35H42z" fill="#ff303b" opacity=".15"/></g><g class="trace-ring"><circle cx="60" cy="56" r="35" fill="none" stroke="#32d9e9" stroke-width="2.5" stroke-dasharray="9 7"/><path d="M60 18v9M60 85v9M22 56h9M89 56h9" stroke="#32d9e9" stroke-width="3" stroke-linecap="round"/></g><g class="graph-effect"><path d="M78 31l17-9 12 14-10 16" fill="none" stroke="#36d7e8" stroke-width="2"/><circle cx="78" cy="31" r="4" fill="#ff3440"/><circle cx="95" cy="22" r="4" fill="#36d7e8"/><circle cx="107" cy="36" r="4" fill="#36d7e8"/><circle cx="97" cy="52" r="4" fill="#36d7e8"/></g><g class="percent-effect"><rect x="78" y="27" width="29" height="25" rx="4" fill="#202832" stroke="#e95cac"/><path d="M84 46V40m6 6V34m6 12V29m6 17V36" stroke="#e95cac" stroke-width="4"/><circle cx="96" cy="29" r="3" fill="#ffdf79"/></g><g class="success-effect"><circle cx="96" cy="27" r="13" fill="#31c87a"/><path d="M89 27l5 5 9-11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g><g class="warning-effect"><path d="M96 13l16 28H80z" fill="#f2b84b" stroke="#6d4810" stroke-width="2"/><path d="M96 22v9m0 5v1" stroke="#392706" stroke-width="3" stroke-linecap="round"/></g></g></svg><img class="classic-visual" alt="" draggable="false">`;
  const mascotImage=document.createElement("img");mascotImage.className="mascot-visual mascot-base";mascotImage.alt="";mascotImage.draggable=false;mascotImage.src=assetUrl("extension/graylog/living-signal-mascot.png");
  const mascotWaveImage=document.createElement("img");mascotWaveImage.className="mascot-visual mascot-wave";mascotWaveImage.alt="";mascotWaveImage.draggable=false;mascotWaveImage.src=assetUrl("extension/graylog/living-signal-mascot-wave.png");figure.prepend(mascotImage,mascotWaveImage);
  const sensor=globalThis.SensorMascot?.mount(figure,{baseUrl:mascotImage.src,waveUrl:mascotWaveImage.src});
  const close = document.createElement("button"); close.className="close"; close.type="button"; close.textContent="×"; close.title="Скрыть помощника"; close.setAttribute("aria-label","Скрыть Graylog-помощника на этой странице");
  const restore = document.createElement("button"); restore.className="restore"; restore.type="button"; restore.textContent="◉ Анализ"; restore.hidden=true; restore.setAttribute("aria-label","Показать Graylog-помощника");
  const toolsToggle=document.createElement("button");toolsToggle.className="tools-toggle";toolsToggle.type="button";toolsToggle.textContent="⋯";toolsToggle.hidden=true;toolsToggle.title="Показать инструменты trace";toolsToggle.setAttribute("aria-label","Показать инструменты trace");toolsToggle.setAttribute("aria-haspopup","menu");toolsToggle.setAttribute("aria-expanded","false");
  const operationCancel=document.createElement("button");operationCancel.className="operation-cancel";operationCancel.type="button";operationCancel.hidden=true;operationCancel.textContent="■ Стоп";operationCancel.title="Отменить запрос расширения";operationCancel.setAttribute("aria-label","Отменить выполняемый анализ расширения");
  const learnButton=document.createElement("button");learnButton.className="learn-preview";learnButton.type="button";learnButton.textContent="?";learnButton.title="Сенсор покажет, как пользоваться разбором";learnButton.setAttribute("aria-label","Обучение: разбор trace с Сенсором");
  const learnStyle=document.createElement("style");learnStyle.textContent='.learn-preview{position:relative;flex:none;display:grid;place-items:center;width:30px;height:30px;padding:0;border:2px solid #fff;border-radius:50%;background:linear-gradient(145deg,#1697a8,#086777);color:#fff;font:800 16px/1 system-ui;cursor:pointer;pointer-events:auto;box-shadow:0 2px 8px #0a526a59,0 0 0 2px #168899;transition:transform .16s,filter .16s,box-shadow .16s}.learn-preview::before{content:"";position:absolute;right:-5px;bottom:100%;width:68px;height:11px;pointer-events:auto}.learn-preview::after{content:"Помощь";position:absolute;right:-3px;bottom:calc(100% + 9px);padding:5px 8px;border-radius:6px;background:#173d45;color:#fff;box-shadow:0 4px 12px #102f3840;font:600 11px/1.2 system-ui;white-space:nowrap;opacity:0;transform:translateY(3px);transition:opacity .14s,transform .14s;pointer-events:auto}.learn-preview[hidden]{display:none}.learn-preview:disabled{opacity:.55;cursor:default}.learn-preview:not(:disabled):hover{transform:translateY(-2px);filter:brightness(1.08);box-shadow:0 4px 11px #0a526a66,0 0 0 3px #6cd7df66}.learn-preview:not(:disabled):hover::after,.learn-preview:focus-visible::after{opacity:1;transform:none}.learn-preview:focus-visible{outline:3px solid #ef9a24;outline-offset:3px}.bubble[hidden]{display:none!important}@media(prefers-reduced-motion:reduce){.learn-preview,.learn-preview::after{transition:none}}';if(typeof CSSStyleSheet==="function"&&"adoptedStyleSheets" in shadow){const sheet=new CSSStyleSheet();sheet.replaceSync(learnStyle.textContent);shadow.adoptedStyleSheets=[...shadow.adoptedStyleSheets,sheet];}else shadow.append(learnStyle);
  bubble.append(phrase,traceExplore,reviewFinding,skinToggle,skinMenu); const helperActions=document.createElement("div");helperActions.className="helper-actions";helperActions.append(operationCancel,learnButton);companion.append(bubble,figure,helperActions,toolsToggle,close); shadow.append(companion,restore); document.documentElement.append(rootHost);

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const scenes={idle:3900,search:6500,trace:2300,graph:5200,percentiles:5200,success:2200,warning:5200,open:3500};
  const sceneClasses=Object.keys(scenes).map(scene=>`scene-${scene}`);
  let timer=null,bubbleTimer=null,actionLockTimer=null,introStartTimer=null,introEndTimer=null,generation=0,hidden=false,lastUrl=location.href,skinId="orb",activeScene="idle",actionsLocked=false,introState="pending",cancelFeedbackPending=false;
  let panelOpen=false,tourActive=false;
  const cancelableOperations=new Map();
  let lastFindingReference="",detectedFinding=null,introFinding=null,findingSourceUrl=location.href;
  let cachedQueryField=null,currentTraceId=helper.exactTraceId(helper.queryFromUrl(location.href)),discoveryFrame=0,inputFrame=0;
  const classicImage=figure.querySelector(".classic-visual");
  const classicScenes={idle:6,search:21,trace:3,graph:3,percentiles:3,success:3,warning:6,open:3};
  function setSkin(next){sensor?.setEnabled(next!=="clippy");skinId=next==="clippy"?"clippy":"orb";figure.classList.toggle("skin-clippy",skinId==="clippy");figure.classList.toggle("skin-orb",skinId==="orb");figure.title=skinId==="orb"?"Сенсор — открыть расширение и перейти к анализу":"Clippy — открыть расширение и перейти к анализу";figure.setAttribute("aria-label",skinId==="orb"?"Сенсор — открыть Advanced Graylog":"Clippy — открыть Advanced Graylog");orbChoice.setAttribute("aria-checked",String(skinId==="orb"));clippyChoice.setAttribute("aria-checked",String(skinId==="clippy"));classicImage.src=assetUrl(`extension/clippy-${classicScenes[activeScene]||6}.gif`);}
  const QUERY_FIELD_SELECTOR='textarea,input[type="text"],input[type="search"],input:not([type]),[contenteditable="true"],[role="textbox"],[class*="QueryEditor"],[class*="query-editor"],.CodeMirror,.ace_editor,.monaco-editor,.cm-editor';
  function discoverQueryField(){
    const fields=[...new Set(document.querySelectorAll(QUERY_FIELD_SELECTOR))].filter(field=>{const rect=field.getBoundingClientRect();return rect.width>0&&rect.height>0;});
    return fields.map(field=>{const rect=field.getBoundingClientRect();const marker=[field.id,field.getAttribute("name"),field.getAttribute("placeholder"),field.getAttribute("aria-label"),field.getAttribute("data-testid"),field.className].filter(value=>typeof value==="string").join(" ");const form=field.closest("form");const editable=field.matches('textarea,input,[contenteditable="true"],[role="textbox"]');const score=(editable?6:0)+(/queryeditor|query-editor/i.test(marker)?14:0)+(/query|запрос|search/i.test(marker)?8:0)+(rect.width>300?3:0)+(rect.height<=90?2:0)+(form?2:0);return{field,score,area:rect.width*rect.height};}).sort((a,b)=>b.score-a.score||a.area-b.area)[0]?.field||null;
  }
  function queryField(){
    if(cachedQueryField?.isConnected&&cachedQueryField.getClientRects().length&&isReliableQueryField(cachedQueryField))return cachedQueryField;
    cachedQueryField=discoverQueryField();return cachedQueryField;
  }
  function queryText(field){
    return helper.readQueryText(field);
  }
  function isReliableQueryField(field){if(!field)return false;const marker=[field.id,field.getAttribute("name"),field.getAttribute("aria-label"),field.getAttribute("data-testid"),typeof field.className==="string"?field.className:""] .filter(Boolean).join(" ");return/queryeditor|query-editor|graylog-search-query|(?:^|[\s_-])query(?:[\s_-]|$)|codemirror|ace_editor|monaco-editor|cm-editor/i.test(marker)||field.matches('[contenteditable="true"][role="textbox"]');}
  function traceId(){return currentTraceId;}
  function resolveQueryField(target){
    if(!(target instanceof Element))return null;
    const editor=target.closest?.('[class*="QueryEditor"],[class*="query-editor"],.CodeMirror,.ace_editor,.monaco-editor,.cm-editor');
    if(editor&&isReliableQueryField(editor))return editor;
    const direct=target.matches(QUERY_FIELD_SELECTOR)?target:target.closest?.(QUERY_FIELD_SELECTOR);
    if(direct&&isReliableQueryField(direct))return direct;
    const form=target.closest?.("form");
    if(!form)return null;
    const hasSearch=[...form.querySelectorAll('button,input[type="submit"]')].some(item=>helper.isSearchControl(describeControl(item)));
    return hasSearch?(direct||form.querySelector(QUERY_FIELD_SELECTOR)):null;
  }
  function refreshTrace(field,preferUrl=false,authoritative=false){
    const previousTraceId=currentTraceId;
    if(field?.isConnected){cachedQueryField=field;const fromEditor=helper.exactTraceId(queryText(field));currentTraceId=fromEditor||(!authoritative?helper.exactTraceId(helper.queryFromUrl(location.href)):"");}
    else if(preferUrl){
      const url=new URL(location.href);
      // Graylog can change a saved-search/view URL without serializing q.
      // An explicit q (even empty or compound) remains authoritative on navigation.
      const discovered=url.searchParams.has("q")?null:queryField();
      currentTraceId=url.searchParams.has("q")?helper.exactTraceId(helper.queryFromUrl(location.href))
        :isReliableQueryField(discovered)?helper.exactTraceId(queryText(discovered)):"";
    }
    else {const discovered=queryField();const fromEditor=helper.exactTraceId(queryText(discovered));currentTraceId=discovered&&isReliableQueryField(discovered)&&helper.queryTextReady(discovered)?fromEditor:(fromEditor||helper.exactTraceId(helper.queryFromUrl(location.href)));}
    if(previousTraceId!==currentTraceId||findingSourceUrl!==location.href){lastFindingReference="";detectedFinding=null;introFinding=null;reviewFinding.hidden=true;findingSourceUrl=location.href;}
    globalThis.GraylogPreviewPanel?.syncContext({traceId:currentTraceId,sourceUrl:location.href});
    return currentTraceId;
  }
  function resolveTraceContext(){
    if(lastUrl!==location.href){lastUrl=location.href;refreshTrace(null,true);}
    else refreshTrace();
    return {traceId:currentTraceId,sourceUrl:location.href};
  }
  function findingPhrase(){return detectedFinding?.referenceId==="graylog.level3" ? "В выдаче есть ошибка level 3. Можно посмотреть разбор." : detectedFinding?.referenceId==="graylog.analysis" ? "В разборе trace найдены ошибки. Можно посмотреть источники." : `Найдена ${detectedFinding?.label || "ошибка"}. Можно посмотреть разбор.`;}
  function textForIdle() {return traceId()&&detectedFinding?findingPhrase():traceId()?"Вижу traceId. Давай разберёмся.":"Нажмите на меня, чтобы открыть мониторинг.";}
  function showBubble(text,quietAfter=5200){phrase.textContent=text;bubble.hidden=panelOpen||tourActive;clearTimeout(bubbleTimer);if(bubble.hidden)return;bubble.classList.remove("quiet");if(quietAfter)bubbleTimer=setTimeout(()=>{if(!bubble.matches(":hover")&&!bubble.contains(shadow.activeElement))bubble.classList.add("quiet");},quietAfter);}
  function setPanelOpen(value){panelOpen=value===true;bubble.hidden=panelOpen||tourActive;if(bubble.hidden){clearTimeout(bubbleTimer);skinMenu.hidden=true;}else showBubble(textForIdle(),2600);}
  function explainStack(message){
    if(disposed||typeof message!=='string')return;
    finishIntro();hidden=false;companion.hidden=false;restore.hidden=true;
    play('analysis',message.slice(0,360));
    // Explicit help click may explain a stack while the preview remains open.
    bubble.hidden=false;bubble.classList.remove('quiet');
    clearTimeout(bubbleTimer);bubbleTimer=setTimeout(()=>{bubble.hidden=panelOpen||tourActive;bubble.classList.add('quiet');},12000);
  }
  function setTourActive(value){tourActive=value===true;bubble.hidden=panelOpen||tourActive;learnButton.setAttribute("aria-expanded",String(tourActive));if(tourActive){finishIntro();clearTimeout(bubbleTimer);skinMenu.hidden=true;}else if(!panelOpen)showBubble(textForIdle(),2600);}
  function getTourAnchor(name){return name==="launch"?learnButton:name==="trace"&&!traceExplore.hidden?traceExplore:figure;}
  function finishIntro(){clearTimeout(introStartTimer);clearTimeout(introEndTimer);introStartTimer=null;introEndTimer=null;introState="final";sensor?.setIntro(introState);sensor?.setState(activeScene);companion.dataset.intro="final";companion.classList.remove("intro-start","intro-flight");bubble.classList.add("quiet");positionGraph();if(introFinding){const finding=introFinding;introFinding=null;reportFinding(finding);}}
  function startIntro(){if(introState!=="pending")return;if(reduced.matches||introAlreadyShown){finishIntro();return;}introState="start";sensor?.setIntro(introState);companion.dataset.intro="start";companion.classList.add("intro-start");showBubble("Привет! Я Сенсор.",0);introStartTimer=setTimeout(()=>{introState="flight";sensor?.setIntro(introState);companion.dataset.intro="flight";companion.classList.remove("intro-start");companion.classList.add("intro-flight");},1800);introEndTimer=setTimeout(finishIntro,3000);}
  function play(scene,message) {
    if(disposed || runtime && !runtime.available())return;
    if(introState!=="final"){activeScene=scene;return;}
    const duration=scenes[scene]||scenes.idle;activeScene=scene;sensor?.setState(scene); generation++;const ticket=generation;clearTimeout(timer);companion.classList.toggle("searching",scene==="search");figure.classList.remove(...sceneClasses);figure.classList.add(`scene-${scene}`);classicImage.src=assetUrl(`extension/clippy-${classicScenes[scene]||6}.gif`);showBubble(message,duration);
    // Reduced motion changes movement, not the time available to read a finding.
    const hold=duration;
    timer=setTimeout(()=>{if(disposed || runtime && !runtime.available() || ticket!==generation)return;activeScene="idle";sensor?.setState("idle");companion.classList.remove("searching");figure.classList.remove(...sceneClasses);figure.classList.add("scene-idle");classicImage.src=assetUrl("extension/graylog/clippy-6.gif");showBubble(textForIdle(),3800);},hold);
  }
  function trustedFinding(value){
    if(value?.kind==="level3")return Object.freeze({kind:"level3",referenceId:"graylog.level3",label:"Ошибка level 3",priority:"unknown"});
    const reference=globalThis.ErrorReference?.entries?.find?.(item=>item?.id===value?.referenceId);
    if(!reference)return null;
    const labels=(reference.exceptions||[]).map(item=>String(item||"").split(".").at(-1)).filter(item=>/^[A-Za-z_$][\w$]*(?:Exception|Error)$/.test(item));
    const label=labels[0]||(reference.sqlStates||[])[0]||(reference.oracleCodes||[])[0]||reference.title;
    return label?Object.freeze({referenceId:reference.id,label:String(label),priority:reference.priority||"unknown"}):null;
  }
  function reportFinding(value){
    const finding=trustedFinding(value);
    if(!finding||!traceId()||finding.referenceId===lastFindingReference)return false;
    // A generic row must not replace an already recognised exception.
    if(finding.kind==="level3"&&detectedFinding&&!['graylog.level3','graylog.analysis'].includes(detectedFinding.referenceId))return false;
    reviewFinding.hidden=false;
    if(introState!=="final"){introFinding=finding;detectedFinding=finding;return true;}
    lastFindingReference=finding.referenceId;detectedFinding=finding;
    play("warning",findingPhrase());
    return true;
  }
  function reportPreview(value){
    const context=resolveTraceContext();
    if(value?.traceId!==context.traceId||value?.sourceUrl!==context.sourceUrl||!Number.isSafeInteger(value?.errorEvents)||value.errorEvents<0)return false;
    if(value.errorEvents===0){if(detectedFinding?.referenceId==="graylog.analysis"){detectedFinding=null;reviewFinding.hidden=true;}return true;}
    reviewFinding.hidden=false;
    if(!detectedFinding)detectedFinding=Object.freeze({referenceId:"graylog.analysis",label:"Ошибки trace",priority:"unknown"});
    if(introState==="final")play("warning",findingPhrase());
    return true;
  }
  function reportCollection(){if(disposed)return;play('idle','Граф готов! Открой собранный граф в панели.');}
  function describeControl(element){return{tagName:element?.tagName,type:element?.type,textContent:element?.textContent,ariaLabel:element?.getAttribute?.("aria-label"),title:element?.getAttribute?.("title"),testId:element?.getAttribute?.("data-testid"),name:element?.getAttribute?.("name")};}
  function positionGraph(){
    const available=Boolean(traceId())&&introState==="final";toolsToggle.hidden=true;traceExplore.hidden=!available;figure.setAttribute("aria-expanded","false");
  }
  function unlockActions(){clearTimeout(actionLockTimer);actionsLocked=false;traceExplore.disabled=false;}
  function lockActions(){if(actionsLocked)return false;actionsLocked=true;traceExplore.disabled=true;actionLockTimer=setTimeout(unlockActions,1250);return true;}
  function onClick(event) {
    const control=event.composedPath().find(item=>item instanceof Element&&['BUTTON','INPUT'].includes(item.tagName));
    if(control&&helper.isSearchControl(describeControl(control))){const field=resolveQueryField(control);if(field)refreshTrace(field,false,true);play("search","Ищу события в Graylog…");setTimeout(positionGraph,0);}
  }
  function onKeydown(event){
    if(event.key!=="Enter"||!(event.target instanceof Element)||!event.target.matches('input,textarea,[contenteditable="true"],[role="textbox"]'))return;
    const field=event.target;
    const identifier=[field.getAttribute("name"),field.getAttribute("aria-label"),field.getAttribute("data-testid")].filter(Boolean).join(" ");
    const form=field.closest("form");
    const formHasSearch=form&&[...form.querySelectorAll('button,input[type="submit"]')].some(item=>helper.isSearchControl(describeControl(item)));
    if(field.tagName==="TEXTAREA"||field.isContentEditable||/query|запрос/i.test(identifier)||formHasSearch)play("search","Ищу события в Graylog…");
  }
  function onInput(event){
    const field=resolveQueryField(event.target);if(!field)return;
    cachedQueryField=field;
    if(field.matches('input,textarea')&&!field.closest('.CodeMirror,.ace_editor,.monaco-editor,.cm-editor')){refreshTrace(field,false,true);positionGraph();return;}
    // Capture runs before the editor updates its rendered lines. Coalesce reads
    // after that update without intercepting input, selection or submission.
    if(inputFrame)return;
    inputFrame=requestAnimationFrame(()=>{inputFrame=0;refreshTrace(cachedQueryField,false,true);positionGraph();});
  }
  function checkUrl(){
    if(document.hidden||globalThis.navigator?.scheduling?.isInputPending?.())return;
    if(location.href===lastUrl){
      // Saved views, editor remounts and programmatic query changes need not
      // emit input or change the URL. Read only the cached editor, no HTTP.
      const before=currentTraceId;refreshTrace();if(before!==currentTraceId)positionGraph();return;
    }
    lastUrl=location.href;lastFindingReference="";detectedFinding=null;introFinding=null;reviewFinding.hidden=true;refreshTrace(null,true);positionGraph();const id=traceId();if(id)play("trace","TraceId найден. Давай разберёмся.");
  }
  const urlTimer=setInterval(checkUrl,800);let positionFrame=0;const schedulePosition=()=>{if(positionFrame)return;positionFrame=requestAnimationFrame(()=>{positionFrame=0;positionGraph();});};
  // QueryEditor can mount after document_idle. Observe only until it is found;
  // result rendering and keystrokes must not trigger repeated whole-document scans.
  const discoveryObserver=new MutationObserver(()=>{if(cachedQueryField?.isConnected){discoveryObserver.disconnect();return;}if(discoveryFrame)return;discoveryFrame=requestAnimationFrame(()=>{discoveryFrame=0;const field=queryField();if(!field)return;refreshTrace(field);positionGraph();discoveryObserver.disconnect();});});
  if(!queryField())discoveryObserver.observe(document.documentElement,{childList:true,subtree:true});else refreshTrace(cachedQueryField);
  document.addEventListener("click",onClick,true);document.addEventListener("keydown",onKeydown,true);document.addEventListener("input",onInput,true);
  figure.addEventListener("click",()=>{play("open","Открываю мониторинг…");sendMessage({type:"open-tools-from-graylog",view:"monitoring"}).then(reply=>{if(!reply?.opened)throw new Error(reply?.error||"Не удалось открыть расширение.");}).catch(error=>showBubble(error?.message||"Не удалось открыть расширение. Нажмите его значок на панели браузера.",9000));});
  learnButton.addEventListener("click",event=>{event.stopPropagation();if(!globalThis.GraylogPreviewOnboarding?.start())showBubble("Обучение будет доступно после завершения текущей операции.",3500);});
  traceExplore.addEventListener("click",()=>{const id=traceId();if(!id||!lockActions())return;play("graph","Открываю краткий разбор…");globalThis.GraylogPreviewPanel?.open(id,"graph");});
  reviewFinding.addEventListener("click",async()=>{
    const context=resolveTraceContext();
    if(!context.traceId||!detectedFinding||reviewFinding.disabled)return;
    reviewFinding.disabled=true;reviewFinding.textContent="Открываю…";
    try {
      const reply=await sendMessage({type:"open-current-page-trace",traceId:context.traceId,sourceUrl:context.sourceUrl});
      if(!reply?.opened)throw new Error(reply?.error||"Не удалось открыть подробный разбор.");
    } catch(error){showBubble(error?.message||"Не удалось открыть подробный разбор.",9000);}
    finally{reviewFinding.disabled=false;reviewFinding.textContent="Открыть разбор ↗";}
  });
  skinToggle.addEventListener("click",event=>{event.stopPropagation();skinMenu.hidden=!skinMenu.hidden;skinToggle.setAttribute("aria-expanded",String(!skinMenu.hidden));});
  skinMenu.addEventListener("click",event=>{const choice=event.target.closest("button[data-skin]");if(!choice)return;setSkin(choice.dataset.skin);skinMenu.hidden=true;skinToggle.setAttribute("aria-expanded","false");showBubble(skinId==="orb"?"Сенсор включён.":"Clippy включён.",2600);});
  figure.addEventListener("mouseenter",()=>showBubble(textForIdle(),0));
  figure.addEventListener("mouseleave",()=>{clearTimeout(bubbleTimer);bubbleTimer=setTimeout(()=>bubble.classList.add("quiet"),1200);});
  figure.addEventListener("focus",()=>showBubble(textForIdle(),3200));
  bubble.addEventListener("mouseenter",()=>clearTimeout(bubbleTimer));
  bubble.addEventListener("focusin",()=>clearTimeout(bubbleTimer));
  bubble.addEventListener("mouseleave",()=>{if(!bubble.contains(shadow.activeElement))bubbleTimer=setTimeout(()=>bubble.classList.add("quiet"),3200);});
  close.addEventListener("click",()=>showBubble("Помощник остаётся рядом, пока расширение включено.",3200));
  restore.addEventListener("click",()=>{hidden=false;companion.hidden=false;restore.hidden=true;positionGraph();play("idle",textForIdle());});
  function activate(){if(hidden){hidden=false;companion.hidden=false;restore.hidden=true;}lastUrl=location.href;refreshTrace(null,true);positionGraph();if(introState==="final")play("idle",textForIdle());}
  function focusTraceTools(view){
    if(disposed)return;
    positionGraph();
    if(!traceExplore.hidden){unlockActions();traceExplore.focus({preventScroll:true});}
    else figure.focus({preventScroll:true});
  }
  function beginCancelableOperation(specification){
    const token=/^[a-z0-9_-]{1,128}$/i.test(String(specification?.token||""))?String(specification.token):"";
    const kind=["compact-graph","full-graph","extension-query"].includes(specification?.kind)?specification.kind:"";
    if(!token||!kind||typeof specification?.cancel!=="function")return false;
    cancelableOperations.set(token,{token,kind,cancel:specification.cancel,cancelRequested:false});learnButton.disabled=true;learnButton.hidden=false;learnButton.title="Обучение доступно после завершения операции";operationCancel.disabled=false;operationCancel.hidden=false;
    operationCancel.title=cancelableOperations.size>1?"Остановить выполняемые операции расширения":kind==="full-graph"?"Отменить построение полного графа":"Отменить запрос расширения";
    operationCancel.setAttribute("aria-label",operationCancel.title);return true;
  }
  function endCancelableOperation(token){const operation=cancelableOperations.get(String(token||""));if(!operation)return false;cancelableOperations.delete(operation.token);learnButton.disabled=cancelableOperations.size>0;learnButton.hidden=false;learnButton.title=learnButton.disabled?"Обучение доступно после завершения операции":"Сенсор покажет, как пользоваться разбором";operationCancel.hidden=cancelableOperations.size===0;operationCancel.disabled=false;if(operationCancel.hidden&&cancelFeedbackPending){cancelFeedbackPending=false;showBubble("Операция остановлена.",2600);}return true;}
  operationCancel.addEventListener("click",async event=>{event.stopPropagation();const operations=[...cancelableOperations.values()];if(!operations.length||operationCancel.disabled)return;for(const operation of operations)operation.cancelRequested=true;cancelFeedbackPending=true;operationCancel.disabled=true;showBubble("Отменяю запрос расширения…",0);const results=await Promise.allSettled(operations.map(operation=>operation.cancel()));const failed=results.some(result=>result.status==="rejected");if(failed){for(const operation of operations)operation.cancelRequested=false;cancelFeedbackPending=false;showBubble("Не удалось передать отмену. Закройте разбор и повторите.",5000);}if(cancelableOperations.size)operationCancel.disabled=false;});
  const operationMessageListener=(message,_sender,sendResponse)=>{
    if(message?.type!=="graylog-explicit-operation-state")return false;
    const token=/^[a-z0-9_-]{1,128}$/i.test(String(message.operationId||""))?String(message.operationId):"";
    if(!token){sendResponse?.({accepted:false});return false;}
    if(message.active===false){endCancelableOperation(token);sendResponse?.({accepted:true});return false;}
    const kind=["full-graph","extension-query"].includes(message.kind)?message.kind:"";
    const accepted=Boolean(kind&&beginCancelableOperation({token,kind,cancel:()=>sendMessage({type:"cancel-explicit-operation-from-graylog",operationId:token})}));
    sendResponse?.({accepted});return false;
  };
  globalThis.chrome?.runtime?.onMessage?.addListener(operationMessageListener);
  function dispose(){if(disposed)return;disposed=true;generation++;globalThis.GraylogPreviewOnboarding?.close();sensor?.dispose();clearInterval(urlTimer);clearTimeout(timer);clearTimeout(bubbleTimer);clearTimeout(actionLockTimer);clearTimeout(introStartTimer);clearTimeout(introEndTimer);if(positionFrame)cancelAnimationFrame(positionFrame);if(discoveryFrame)cancelAnimationFrame(discoveryFrame);if(inputFrame)cancelAnimationFrame(inputFrame);discoveryObserver.disconnect();document.removeEventListener("click",onClick,true);document.removeEventListener("keydown",onKeydown,true);document.removeEventListener("input",onInput,true);globalThis.chrome?.runtime?.onMessage?.removeListener?.(operationMessageListener);removeEventListener("resize",schedulePosition);rootHost.remove();if(globalThis.__advancedGraylogClippy?.dispose===dispose)delete globalThis.__advancedGraylogClippy;}
  addEventListener("resize",schedulePosition,{passive:true});
  addEventListener("pagehide",dispose,{once:true});
  globalThis.__advancedGraylogClippy=Object.freeze({activate,dispose,explainStack,setSkin,setPanelOpen,setTourActive,getTourAnchor,reportFinding,reportPreview,reportCollection,resolveTraceContext,focusTraceTools,beginCancelableOperation,endCancelableOperation,getState:()=>({hidden,skinId,introState,panelOpen,tourActive,bubbleHidden:bubble.hidden,skinMenuOpen:!skinMenu.hidden,traceId:traceId(),searching:companion.classList.contains("searching"),scene:activeScene,sensor:sensor?.getState(),knownError:detectedFinding,actionsLocked,touchToolsAvailable:false,graphAvailable:!traceExplore.hidden,graphVisible:false,percentileVisible:false,graphPosition:null,cancelVisible:!operationCancel.hidden,cancelKind:[...cancelableOperations.values()].at(-1)?.kind||null,cancelCount:cancelableOperations.size})});
  runtime?.onInvalidated(dispose);
  setSkin("orb");
  Promise.allSettled([mascotImage,mascotWaveImage].map(item=>typeof item.decode==="function"?item.decode():Promise.resolve()))
    .then(()=>{if(disposed)return;startIntro();if(introState==="final"&&!detectedFinding)play("idle",textForIdle());});
  const initialFinding=globalThis.__advancedGraylogPendingFinding||globalThis.__advancedGraylogMessageBadges?.getFindings?.()[0];
  delete globalThis.__advancedGraylogPendingFinding;
  if(initialFinding)reportFinding(initialFinding);
})();
