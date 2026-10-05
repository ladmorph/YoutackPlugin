(function initializeClippy() {
  "use strict";
  if(globalThis.Clippy || !globalThis.ClippyState) return;
  // Static action names and phrases only: no messages, queries or user data.
  const catalog={
    welcome:[6,3900,"Я рядом, если понадобится разобраться."],
    idle:[6,3900,"Готов к следующему действию."],
    search:[21,10700,"Ищу события выбранного трейса…"],
    loading:[17,4700,"Дожидаюсь результата…"],
    analysis:[23,11900,"Смотрим разбор трейса."],
    success:[3,4500,"Готово."],
    empty:[8,3700,"За выбранный период ничего не найдено."],
    error:[1,5500,"Действие не завершилось. Подробности — в интерфейсе."],
    warning:[8,3700,"Есть ограничения — проверьте пояснение в результате."],
    export:[2,5800,"Подготавливаю файл…"],
    exported:[3,4500,"Экспорт передан браузеру."],
    playback:[22,12800,"Показываю последовательность взаимодействий."],
    pause:[13,6800,"Проигрывание на паузе."],
    scope:[14,4800,"Помогу выбрать состав графа."]
  };
  const host=document.createElement("aside");host.id="clippy-companion";host.className="skin-orb";host.dataset.intro="pending";host.setAttribute("aria-label","Помощник интерфейса Сенсор");
  const bubble=document.createElement("div");bubble.className="clippy-bubble";
  const phrase=document.createElement("p");phrase.id="clippy-phrase";phrase.setAttribute("role","status");phrase.setAttribute("aria-live","polite");
  const controls=document.createElement("div");controls.className="clippy-controls";
  const motionButton=document.createElement("button");motionButton.type="button";
  const skinButton=document.createElement("button");skinButton.type="button";skinButton.className="clippy-skin-toggle";skinButton.textContent="Вид ▾";skinButton.setAttribute("aria-label","Сменить визуал помощника");skinButton.setAttribute("aria-haspopup","menu");skinButton.setAttribute("aria-expanded","false");
  const skinMenu=document.createElement("div");skinMenu.className="clippy-skin-menu";skinMenu.hidden=true;skinMenu.setAttribute("role","menu");
  const orbChoice=document.createElement("button");orbChoice.type="button";orbChoice.dataset.skin="orb";orbChoice.textContent="◉ Сенсор";orbChoice.setAttribute("aria-label","Выбрать помощника Сенсор");orbChoice.setAttribute("role","menuitemradio");
  const clippyChoice=document.createElement("button");clippyChoice.type="button";clippyChoice.dataset.skin="clippy";clippyChoice.textContent="📎 Clippy";clippyChoice.setAttribute("role","menuitemradio");skinMenu.append(orbChoice,clippyChoice);
  const hideButton=document.createElement("button");hideButton.type="button";hideButton.textContent="Скрыть";hideButton.setAttribute("aria-label","Скрыть помощника");
  const reviewButton=document.createElement("button");reviewButton.type="button";reviewButton.className="clippy-review";reviewButton.textContent="Посмотреть разбор →";reviewButton.hidden=true;
  const tour=document.createElement("div");tour.className="clippy-tour-controls";tour.hidden=true;
  const tourCounter=document.createElement("span");tourCounter.className="clippy-tour-counter";
  const tourBack=document.createElement("button");tourBack.type="button";tourBack.textContent="←";tourBack.setAttribute("aria-label","Предыдущий шаг");
  const tourNext=document.createElement("button");tourNext.type="button";tourNext.textContent="Далее →";
  const tourClose=document.createElement("button");tourClose.type="button";tourClose.textContent="×";tourClose.setAttribute("aria-label","Закрыть онбординг");
  tour.append(tourCounter,tourBack,tourNext,tourClose);
  controls.append(skinButton,motionButton,hideButton);bubble.append(phrase,reviewButton,tour,skinMenu,controls);
  const figure=document.createElement("div");figure.className="clippy-figure";figure.tabIndex=0;figure.setAttribute("role","button");figure.setAttribute("aria-label","Сенсор — показать подсказку помощника");
  const orb=document.createElement("div");orb.className="clippy-orb";orb.setAttribute("aria-hidden","true");orb.innerHTML='<svg viewBox="0 0 100 100"><defs><radialGradient id="main-orb-shell" cx="34%" cy="25%"><stop offset="0" stop-color="#656b75"/><stop offset=".62" stop-color="#30343b"/><stop offset="1" stop-color="#171a1f"/></radialGradient><radialGradient id="main-orb-face" cx="38%" cy="30%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#d9dde2"/></radialGradient></defs><ellipse cx="50" cy="91" rx="25" ry="4" fill="#02080c" opacity=".4"/><g class="orb-body"><path d="M24 54C13 58 13 69 18 76M76 54c11 2 14 11 11 18" fill="none" stroke="#31363e" stroke-width="7" stroke-linecap="round"/><circle cx="18" cy="78" r="6" fill="#dadddf" stroke="#20242a" stroke-width="3"/><circle cx="87" cy="74" r="6" fill="#dadddf" stroke="#20242a" stroke-width="3"/><circle cx="50" cy="49" r="34" fill="url(#main-orb-shell)" stroke="#747a84" stroke-width="2"/><circle class="orb-face" cx="50" cy="47" r="26" fill="url(#main-orb-face)" stroke="#a9adb4" stroke-width="2"/><circle cx="20" cy="48" r="8" fill="#2c3036" stroke="#ef2934" stroke-width="4"/><circle cx="80" cy="48" r="6" fill="#24282e" stroke="#ef2934" stroke-width="3"/><path class="orb-wave" d="M32 52h8l4-7 5 16 5-20 5 15 4-6 4 2h5" fill="none" stroke="#ef2934" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M40 81h20l-4 7H44z" fill="#ef2934" stroke="#701016" stroke-width="2"/><g class="orb-scan"><rect x="32" y="31" width="3" height="31" rx="1.5" fill="#ff3641"/><path d="M35 31h12v31H35z" fill="#ff303b" opacity=".14"/></g><g class="orb-warning"><path d="M78 12l14 24H64z" fill="#f2b84b" stroke="#6d4810" stroke-width="2"/><path d="M78 20v8m0 4v1" stroke="#392706" stroke-width="3" stroke-linecap="round"/></g><g class="orb-success"><circle cx="78" cy="22" r="11" fill="#31c87a"/><path d="M72 22l4 4 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g></g></svg>';
  const mascot=document.createElement("img");mascot.className="clippy-mascot clippy-mascot-base";mascot.width=120;mascot.height=120;mascot.alt="";mascot.draggable=false;mascot.src=chrome.runtime.getURL("extension/shared/living-signal-mascot.png");
  const mascotWave=document.createElement("img");mascotWave.className="clippy-mascot clippy-mascot-wave";mascotWave.width=120;mascotWave.height=120;mascotWave.alt="";mascotWave.draggable=false;mascotWave.src=chrome.runtime.getURL("extension/shared/living-signal-mascot-wave.png");
  const image=document.createElement("img");image.className="clippy-classic";image.width=100;image.height=100;image.alt="";image.hidden=true;image.draggable=false;
  const still=document.createElement("canvas");still.width=100;still.height=100;still.setAttribute("aria-hidden","true");
  figure.append(mascot,mascotWave,orb,still,image);host.append(bubble,figure);
  const sensor=globalThis.SensorMascot?.mount(figure,{baseUrl:mascot.src,waveUrl:mascotWave.src});
  const restore=document.createElement("button");restore.id="clippy-restore";restore.type="button";restore.textContent="Помощник";restore.setAttribute("aria-label","Показать помощника");restore.hidden=true;
  document.body.append(host,restore);
  const reduced=matchMedia("(prefers-reduced-motion: reduce)");
  const narrow=matchMedia("(max-width: 600px)");
  let enabled=!narrow.matches, motion=!reduced.matches, skinId="orb", current="welcome", timer=null, idleTimer=null, bubbleTimer=null, introStartTimer=null, introEndTimer=null, sceneTimer=null, pageEffectTimer=null, pageEffect=null, moveAnimation=null, lastAnchor=null, generation=0, animated=false, disposed=false, introState="pending";
  let idleIndex=0, idleAnimation=false, lastActivity=Date.now();
  let traceReview=null, announcement="", tourState=null, guideState=null, scene="rest";
  const shownGuides=new Set();
  const idleScenes=[[6,3900],[14,4800],[7,2700]];
  const surface=still.getContext("2d");
  function stop() {
    generation++;clearTimeout(timer);clearTimeout(idleTimer);timer=null;idleTimer=null;animated=false;idleAnimation=false;
    if(skinId==="clippy"&&image.complete&&image.naturalWidth) {try{surface.clearRect(0,0,100,100);surface.drawImage(image,0,0,100,100);}catch{}}
    image.onload=null;image.onerror=null;image.hidden=true;image.removeAttribute("src");still.hidden=false;
  }
  function canIdle() {
    return !disposed&&enabled&&motion&&!reduced.matches&&!document.hidden&&!state.getState().pending&&current!=="playback"&&!tourState&&!guideState;
  }
  function scheduleIdle() {
    clearTimeout(idleTimer);idleTimer=null;
    if(!canIdle())return;
    // One timeout, no polling. Each action or user gesture postpones idle acting.
    idleTimer=setTimeout(()=>{
      idleTimer=null;if(!canIdle())return;
      if(skinId==="orb"&&idleIndex%3===1){idleIndex++;startScene("inspect",2600,true);return;}
      const idleClip=Date.now()-lastActivity>=120000 && idleIndex%3===2 ? [19,11700] : idleScenes[idleIndex%idleScenes.length];
      idleIndex++;stop();idleAnimation=true;play(idleClip[0],idleClip[1],true);
    },20000+Math.floor(Math.random()*15000));
  }
  function placeHost(left,top,teleport) {
    const before=host.getBoundingClientRect();
    host.style.left=`${Math.round(left)}px`;host.style.top=`${Math.round(top)}px`;host.style.right="auto";host.style.bottom="auto";
    const dx=before.left-left,dy=before.top-top;
    if(moveAnimation){moveAnimation.cancel();moveAnimation=null;delete host.dataset.teleport;bubble.classList.remove("teleporting");}
    if(teleport&&motion&&!reduced.matches&&typeof host.animate==="function"&&(Math.abs(dx)>2||Math.abs(dy)>2)){
      host.dataset.teleport="true";bubble.classList.add("teleporting");
      document.querySelectorAll(".sensor-teleport-portal").forEach((item)=>item.remove());
      const after=host.getBoundingClientRect();
      const departure=document.createElement("i"),arrival=document.createElement("i");
      departure.className="sensor-teleport-portal departure";arrival.className="sensor-teleport-portal arrival";
      departure.style.cssText=`left:${Math.round(before.right-56)}px;top:${Math.round(before.bottom-56)}px`;
      arrival.style.cssText=`left:${Math.round(after.right-56)}px;top:${Math.round(after.bottom-56)}px`;
      document.body.append(departure,arrival);setTimeout(()=>{departure.remove();arrival.remove();},980);
      moveAnimation=host.animate([
        {offset:0,transform:"scale(.08,1.35)",opacity:0,filter:"brightness(3) drop-shadow(0 0 18px #55ffff)"},
        {offset:.42,transform:"scale(.08,1.35)",opacity:0,filter:"brightness(3) drop-shadow(0 0 18px #55ffff)"},
        {offset:.58,transform:"scale(.18,1.28)",opacity:.22,filter:"brightness(2.4) drop-shadow(0 0 15px #55ffff)"},
        {offset:.82,transform:"scale(1.08,.94)",opacity:1,filter:"brightness(1.25) drop-shadow(0 0 7px #55ffff)"},
        {offset:1,transform:"translate(0,0) scale(1)",opacity:1,filter:"brightness(1)"}
      ],{duration:820,easing:"cubic-bezier(.2,.76,.2,1)",fill:"none"});
      moveAnimation.addEventListener("finish",()=>{moveAnimation=null;delete host.dataset.teleport;bubble.classList.remove("teleporting");quietBubble(0);},{once:true});
    }
  }
  function clearPageEffect(){clearTimeout(pageEffectTimer);pageEffectTimer=null;pageEffect?.remove();pageEffect=null;}
  function showPageEffect(value,duration){
    clearPageEffect();if(!motion||reduced.matches||!["scan","celebrate"].includes(value))return;
    const surface=document.querySelector(".trace-workspace")||document.querySelector("#trace-canvas");if(!surface)return;
    pageEffect=document.createElement("div");pageEffect.className=`sensor-page-effect sensor-page-${value}`;pageEffect.setAttribute("aria-hidden","true");
    if(value==="celebrate")pageEffect.innerHTML='<span>✓</span><b>Граф готов</b>';
    surface.append(pageEffect);pageEffectTimer=setTimeout(clearPageEffect,Math.min(4200,Math.max(1000,Number(duration)||3000)));
  }
  function position() {
    const anchor=tourState?.target?.isConnected?tourState.target:guideState?.target?.isConnected?guideState.target:null;
    const animateMove=introState==="final"&&lastAnchor!==anchor;
    if(anchor){
      const target=anchor.getBoundingClientRect(),box=host.getBoundingClientRect(),margin=10,gap=12;
      let left=target.right+gap,top=target.top+target.height/2-box.height/2,side="left";
      if(left+box.width>innerWidth-margin){left=target.left-box.width-gap;side="right";}
      if(left<margin){left=Math.max(margin,Math.min(innerWidth-box.width-margin,target.left+target.width/2-box.width/2));top=target.bottom+gap;side="top";}
      if(top+box.height>innerHeight-margin)top=innerHeight-box.height-margin;
      top=Math.max(margin,top);
      placeHost(left,top,animateMove);lastAnchor=anchor;
      if(tourState)host.dataset.tourSide=side;else host.dataset.guideSide=side;return;
    }
    delete host.dataset.tourSide;delete host.dataset.guideSide;
    const minimap=document.querySelector("#trace-minimap:not([hidden])");
    const bottom=minimap ? Math.max(14,innerHeight-minimap.getBoundingClientRect().top+12) : 14;
    const edge=narrow.matches?8:14,box=host.getBoundingClientRect();
    placeHost(Math.max(edge,innerWidth-edge-box.width),Math.max(edge,innerHeight-bottom-box.height),animateMove);lastAnchor=null;restore.style.bottom=`${bottom}px`;
  }
  function quietBubble(delay=4200) {clearTimeout(bubbleTimer);bubble.classList.remove("quiet");if(delay)bubbleTimer=setTimeout(()=>bubble.classList.add("quiet"),delay);}
  function finishIntro() {clearTimeout(introStartTimer);clearTimeout(introEndTimer);introStartTimer=null;introEndTimer=null;introState="final";sensor?.setIntro(introState);host.dataset.intro="final";host.classList.remove("clippy-intro-start","clippy-intro-flight");updateMessage();quietBubble(1300);}
  function startIntro() {
    if(introState!=="pending")return;
    if(reduced.matches||!enabled){finishIntro();return;}
    introState="start";sensor?.setIntro(introState);host.dataset.intro="start";host.classList.add("clippy-intro-start");phrase.textContent="Привет! Я Сенсор.";quietBubble(0);
    introStartTimer=setTimeout(()=>{if(disposed)return;introState="flight";sensor?.setIntro(introState);host.dataset.intro="flight";host.classList.remove("clippy-intro-start");host.classList.add("clippy-intro-flight");},1800);
    introEndTimer=setTimeout(()=>{if(!disposed)finishIntro();},3000);
  }
  function updateControls() {
    host.hidden=!enabled;restore.hidden=enabled;
    sensor?.setEnabled(enabled&&skinId==="orb");sensor?.setMotion(motion&&!reduced.matches);
    host.dataset.motion=String(motion&&!reduced.matches);
    motionButton.textContent=motion?"Без анимации":"Анимация";
    motionButton.setAttribute("aria-label",motion?"Отключить анимацию помощника":"Включить анимацию помощника");
    motionButton.setAttribute("aria-pressed",String(motion));
    orbChoice.setAttribute("aria-checked",String(skinId==="orb"));
    clippyChoice.setAttribute("aria-checked",String(skinId==="clippy"));
  }
  const actionScenes={search:"scan",loading:"scan",analysis:"inspect",graph:"inspect",percentiles:"inspect",playback:"scan",success:"celebrate",exported:"celebrate",warning:"alert",error:"alert"};
  function applyScene(){
    const active=scene!=="rest"?scene:actionScenes[current]||"rest";
    host.dataset.scene=active;sensor?.setScene(active);
  }
  function clearScene(){clearTimeout(sceneTimer);sceneTimer=null;scene="rest";idleAnimation=false;applyScene();}
  function startScene(value,duration=3600,idle=false){
    if(disposed||!enabled)return false;
    clearTimeout(sceneTimer);scene=["patrol","inspect","scan","point","celebrate","alert"].includes(value)?value:"rest";
    idleAnimation=Boolean(idle);applyScene();showPageEffect(scene,duration);
    sceneTimer=setTimeout(()=>{sceneTimer=null;scene="rest";idleAnimation=false;applyScene();scheduleIdle();},Math.max(600,Math.min(15000,Number(duration)||3600)));
    return true;
  }
  function updateMessage() {
    const traceSurface=Boolean(document.querySelector("#trace-canvas")) || document.querySelector("#search-view")?.hidden===false;
    const ready=traceReview&&traceSurface&&!state.getState().pending;
    reviewButton.hidden=!ready||Boolean(tourState)||Boolean(guideState);
    phrase.textContent=catalog[current][2];
    if(ready&&["welcome","idle","success"].includes(current)) {
      phrase.textContent=traceReview.finding ? traceReview.finding.types>1 ? `Нашёл ${traceReview.finding.types} типа известных системных ошибок. Первая: ${traceReview.finding.label}.` : `Нашёл известную системную ошибку: ${traceReview.finding.label}. Посмотрим разбор?` : traceReview.verdict==="work" ? "Есть над чем поработать. Посмотрим замечания по трейсу?" : traceReview.verdict==="clear" ? "Вы молодец! В полученных данных нет ошибок, замедлений и повторов." : "Разбор готов, но данных для полной оценки не хватает.";
    }
    if(introState!=="final")phrase.textContent="Привет! Я Сенсор.";
    else if(announcement)phrase.textContent=announcement;
    host.dataset.traceVerdict=ready?traceReview.verdict:"none";
    sensor?.setState(ready&&traceReview.finding&&!state.getState().pending?"warning":current);applyScene();
  }
  function setTraceReview(value) {
    const reference=value?.finding&&globalThis.ErrorReference?.entries?.find(entry=>entry.id===value.finding.referenceId);
    const exception=reference?.exceptions?.find(name=>typeof name==="string"&&/^[A-Za-z_$][\w.$]{0,180}(?:Exception|Error)$/.test(name));
    const finding=reference&&Number.isInteger(value.finding.count)&&value.finding.count>0&&Number.isInteger(value.finding.types)&&value.finding.types>0?{label:exception?.split(".").at(-1)||reference.title,count:value.finding.count,types:value.finding.types}:null;
    traceReview=value&&["work","clear","unknown"].includes(value.verdict)&&typeof value.open==="function"?{verdict:value.verdict,open:value.open,finding}:null;
    updateMessage();
  }
  function render(action) {
    if(disposed||!catalog[action])return;
    const changed=current!==action;
    current=action;sensor?.setState(action);lastActivity=Date.now();host.dataset.action=action;updateMessage();updateControls();position();if(introState!=="final")phrase.textContent="Привет! Я Сенсор.";else quietBubble();
    // A single animation is active at most. Repeated category progress does not restart it.
    if(!changed&&animated)return;
    stop();
    if(!enabled||document.hidden)return;
    const [id,duration]=catalog[action];play(id,duration,false);
  }
  function announce(message,action="analysis") {
    announcement=String(message||"").replace(/\s+/g," ").trim().slice(0,240);
    render(catalog[action]?action:"analysis");updateMessage();quietBubble(0);
  }
  function clearAnnouncement() {announcement="";updateMessage();quietBubble(1800);}
  function clearGuide({restore=true}={}){
    if(!guideState)return;
    const previousAction=guideState.previousAction;
    clearTimeout(guideState.timer);guideState=null;delete host.dataset.guide;delete host.dataset.guideSide;
    announcement="";clearScene();
    if(restore&&catalog[previousAction])current=previousAction;
    controls.hidden=Boolean(tourState);updateMessage();quietBubble(1800);position();scheduleIdle();
  }
  function guide(options={}){
    const target=options.target,message=String(options.message||"").replace(/\s+/g," ").trim().slice(0,240),key=String(options.key||"").slice(0,64);
    if(!target?.isConnected||!message||disposed)return false;
    if(key&&shownGuides.has(key)&&options.repeat!==true)return false;
    if(key)shownGuides.add(key);
    clearGuide({restore:true});
    guideState={target,key,previousAction:current,timer:null};host.dataset.guide="true";announcement=message;current="scope";lastActivity=Date.now();controls.hidden=true;updateMessage();updateControls();position();quietBubble(0);
    startScene(options.scene||"point",options.duration||6500,false);
    guideState.timer=setTimeout(()=>clearGuide({restore:true}),Math.max(1800,Math.min(15000,Number(options.duration)||6500)));
    return true;
  }
  function setTourStep(options={}) {
    const target=options.target;
    if(!target?.isConnected)return false;
    clearGuide({restore:true});
    tourState={target,onBack:options.onBack,onNext:options.onNext,onClose:options.onClose};
    host.dataset.tour="true";tour.hidden=false;controls.hidden=true;reviewButton.hidden=true;
    tourCounter.textContent=`${Number(options.index||0)+1} / ${Number(options.total||1)}`;
    tourBack.disabled=Number(options.index||0)<=0;
    tourNext.textContent=options.last?"Готово":"Далее →";
    setEnabled(true);announce(options.message,"analysis");position();return true;
  }
  function clearTour() {
    tourState=null;delete host.dataset.tourSide;delete host.dataset.tour;tour.hidden=true;controls.hidden=false;
    clearAnnouncement();position();
  }
  function playScene(value,duration=3600,idle=false){clearGuide({restore:true});return startScene(value,duration,idle);}
  function play(id,duration,isIdle) {
    const ticket=generation;
    host.dataset.idleAnimation=String(isIdle);
    if(skinId==="orb") {
      mascot.hidden=false;mascotWave.hidden=false;orb.hidden=true;still.hidden=true;image.hidden=true;animated=motion&&!reduced.matches;
      timer=setTimeout(()=>{if(ticket!==generation||disposed)return;animated=false;host.dataset.idleAnimation="false";scheduleIdle();},Math.min(duration,15000));
      return;
    }
    mascot.hidden=true;mascotWave.hidden=true;orb.hidden=true;
    image.onload=()=>{
      if(ticket!==generation||disposed)return;
      surface.clearRect(0,0,100,100);surface.drawImage(image,0,0,100,100);
      if(!motion||reduced.matches||(!isIdle&&current==="idle")) {stop();scheduleIdle();return;}
      still.hidden=true;image.hidden=false;animated=true;
      // One pass, then a still frame. Idle acting has its own long quiet pause.
      timer=setTimeout(()=>{stop();host.dataset.idleAnimation="false";scheduleIdle();},Math.min(duration,15000));
    };
    image.onerror=()=>{if(ticket!==generation)return;stop();phrase.textContent="Помощник недоступен. Остальные функции работают.";};
    image.src=chrome.runtime.getURL(`extension/graylog/clippy-${id}.gif`);
  }
  const state=ClippyState.create(({action})=>render(action));
  reviewButton.addEventListener("click",()=>traceReview?.open());
  tourBack.addEventListener("click",()=>tourState?.onBack?.());
  tourNext.addEventListener("click",()=>tourState?.onNext?.());
  tourClose.addEventListener("click",()=>tourState?.onClose?.());
  function setEnabled(value) {enabled=Boolean(value);if(!enabled){stop();clearScene();}render(current);}
  function setMotion(value) {motion=Boolean(value);stop();render(current);}
  function setSkin(value) {skinId=value==="clippy"?"clippy":"orb";host.classList.toggle("skin-orb",skinId==="orb");host.classList.toggle("skin-clippy",skinId==="clippy");figure.setAttribute("aria-label",skinId==="orb"?"Сенсор — показать подсказку помощника":"Clippy — показать подсказку помощника");skinMenu.hidden=true;skinButton.setAttribute("aria-expanded","false");stop();render(current);}
  hideButton.addEventListener("click",()=>setEnabled(false));restore.addEventListener("click",()=>setEnabled(true));motionButton.addEventListener("click",()=>setMotion(!motion));
  skinButton.addEventListener("click",()=>{skinMenu.hidden=!skinMenu.hidden;skinButton.setAttribute("aria-expanded",String(!skinMenu.hidden));});
  skinMenu.addEventListener("click",event=>{const choice=event.target.closest("button[data-skin]");if(choice)setSkin(choice.dataset.skin);});
  figure.addEventListener("mouseenter",()=>quietBubble(0));figure.addEventListener("mouseleave",()=>quietBubble(1200));figure.addEventListener("focus",()=>quietBubble(0));figure.addEventListener("blur",()=>quietBubble(1200));
  function visibility() {if(document.hidden)stop();else if(enabled)render(current);}
  document.addEventListener("visibilitychange",visibility);
  reduced.addEventListener("change",()=>{if(reduced.matches){motion=false;if(introState!=="final")finishIntro();}stop();render(current);});
  window.addEventListener("resize",position,{passive:true});
  window.addEventListener("scroll",position,{passive:true,capture:true});
  // The minimap becomes visible after asynchronous trace rendering.
  const minimap=document.querySelector("#trace-minimap");
  const observer=minimap?new MutationObserver(position):null;
  observer?.observe(minimap,{attributes:true,attributeFilter:["hidden"]});
  function activity(){lastActivity=Date.now();if(idleAnimation){stop();clearScene();}if(!animated)scheduleIdle();}
  for(const event of ["pointerdown","keydown","wheel"])document.addEventListener(event,activity,{passive:true});
  function dispose(){disposed=true;moveAnimation?.cancel();clearPageEffect();sensor?.dispose();clearTimeout(bubbleTimer);clearTimeout(introStartTimer);clearTimeout(introEndTimer);clearTimeout(sceneTimer);clearTimeout(guideState?.timer);stop();observer?.disconnect();document.removeEventListener("visibilitychange",visibility);window.removeEventListener("resize",position);window.removeEventListener("scroll",position,{capture:true});for(const event of ["pointerdown","keydown","wheel"])document.removeEventListener(event,activity);}
  window.addEventListener("pagehide",dispose,{once:true});
  globalThis.Clippy=Object.freeze({show:state.show,begin:state.begin,setEnabled,setMotion,setSkin,setTraceReview,announce,clearAnnouncement,setTourStep,clearTour,guide,dismissGuide:()=>clearGuide({restore:true}),playScene,refreshContext:updateMessage,getState:()=>({...state.getState(),enabled,motion,skinId,animated,idleAnimation,idleScheduled:idleTimer!==null,introState,scene:host.dataset.scene,sensor:sensor?.getState(),traceVerdict:traceReview?.verdict||null,touring:Boolean(tourState),guiding:Boolean(guideState),disposed})});
  state.show("welcome");
  Promise.allSettled([mascot,mascotWave].map(item=>typeof item.decode==="function"?item.decode():Promise.resolve()))
    .then(()=>{if(!disposed)startIntro();});
})();
