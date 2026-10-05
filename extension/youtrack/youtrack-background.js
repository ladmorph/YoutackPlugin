// Reference authentication; isolated from Graylog.
if(typeof importScripts==='function')importScripts('feature-flags.js','youtrack/youtrack-request-store.js');
(() => {
  'use strict';
  const ORIGIN='https://youtrack-mapps.sovcombank.ru';
  const HOST=ORIGIN+'/*';
  // See extension/feature-flags.js. The Authorization header is read only while
  // capture is armed, and arming happens in exactly two cases: the user opens
  // the report from a YouTrack tab, or presses «Обновить подключение».
  // Simply opening an extension page never produces a token.
  const CAPTURE_ENABLED=globalThis.SensorFeatureFlags?.youtrackTokenCapture!==false;
  const CAPTURE_WINDOW_MS=120000;
  let captureUntil=0,captureTab=-1;
  const captureReady=chrome.storage.session.get(['youtrackCaptureUntil','youtrackCaptureTab']).then(v=>{captureUntil=v.youtrackCaptureUntil||0;captureTab=v.youtrackCaptureTab??-1;}).catch(()=>{});
  if(CAPTURE_ENABLED)chrome.webRequest.onBeforeSendHeaders.addListener(async details=>{
    await captureReady;
    if(Date.now()>captureUntil)return;
    if(!Number.isInteger(details.tabId)||details.tabId<0)return;
    if(captureTab>=0&&details.tabId!==captureTab)return;
    if(details.initiator&&details.initiator!==ORIGIN)return;
    const authHeader=(details.requestHeaders||[]).find(h=>h.name.toLowerCase()==='authorization');
    const token=authHeader?.value?.replace(/^Bearer\s+/i,'').trim();
    if(!token)return;
    captureUntil=0;
    await chrome.storage.session.set({youtrackCaptureUntil:0}).catch(()=>{});
    store(token,details.url).catch(()=>{});
  },{urls:[HOST]},['requestHeaders','extraHeaders']);

  async function arm(tabId){
    await captureReady;
    captureUntil=Date.now()+CAPTURE_WINDOW_MS;captureTab=tabId;
    await chrome.storage.session.set({youtrackCaptureUntil:captureUntil,youtrackCaptureTab:tabId}).catch(()=>{});
  }
  async function disarm(){
    captureUntil=0;
    await chrome.storage.session.set({youtrackCaptureUntil:0}).catch(()=>{});
  }

  async function store(token,sourceUrl){
    const [{ytToken},session]=await Promise.all([
      chrome.storage.local.get('ytToken'),
      chrome.storage.session.get(['youtrackLiveToken','youtrackExplicitConnection'])
    ]);
    const unchanged=ytToken===token&&session.youtrackLiveToken===token&&session.youtrackExplicitConnection===true;
    if(unchanged)return;
    await chrome.storage.local.set({ytToken:token,ytTokenCapturedAt:Date.now(),ytTokenSourceUrl:sourceUrl});
    await chrome.storage.session.set({youtrackLiveToken:token,youtrackExplicitConnection:true,youtrackCaptureUntil:0});
  }

  async function sessionReady(){
    const [{ytToken},session]=await Promise.all([
      chrome.storage.local.get('ytToken'),
      chrome.storage.session.get(['youtrackLiveToken','youtrackExplicitConnection'])
    ]);
    return Boolean(ytToken&&session.youtrackExplicitConnection&&session.youtrackLiveToken===ytToken);
  }

  function waitForToken(timeoutMs){
    return new Promise(resolve=>{
      const startedAt=Date.now();
      const done=value=>{clearTimeout(timer);chrome.storage.onChanged.removeListener(listener);resolve(value);};
      const timer=setTimeout(()=>done(null),timeoutMs);
      function listener(changes,area){
        if(area!=='local'||!changes.ytTokenCapturedAt)return;
        if((changes.ytTokenCapturedAt.newValue||0)>=startedAt)chrome.storage.local.get('ytToken',({ytToken})=>done(ytToken||null));
      }
      chrome.storage.onChanged.addListener(listener);
    });
  }

  // Explicit refresh («Обновить подключение»): arm capture, then make YouTrack
  // issue an ordinary request by reloading its tab, or open one in background.
  let ensuring=null;
  function ensureSession(){
    if(ensuring)return ensuring;
    ensuring=(async()=>{
      let temporary=null;
      try{
        if(!CAPTURE_ENABLED)return {ok:false,disabled:true};
        const tabs=await chrome.tabs.query({url:HOST});
        const target=tabs.find(t=>t.id!=null);
        await arm(target?target.id:-1);
        if(target)await chrome.tabs.reload(target.id);
        else{temporary=await chrome.tabs.create({url:ORIGIN+'/',active:false});await arm(temporary.id??-1);}
        const token=await waitForToken(20000);
        return {ok:Boolean(token)||await sessionReady()};
      }catch{
        return {ok:false};
      }finally{
        if(temporary?.id!=null)chrome.tabs.remove(temporary.id).catch(()=>{});
        await disarm();
        ensuring=null;
      }
    })();
    return ensuring;
  }

  // Opening the report from a YouTrack tab counts as an explicit transition:
  // capture is armed for that tab, and the tab is reloaded only if the page
  // does not send a request by itself within a few seconds.
  async function connectFromTab(tabId){
    if(!CAPTURE_ENABLED||tabId==null)return {ok:false};
    if(await sessionReady())return {ok:true,reused:true};
    await arm(tabId);
    let token=await waitForToken(4000);
    if(!token){
      try{await chrome.tabs.reload(tabId);}catch{return {ok:false};}
      token=await waitForToken(16000);
    }
    await disarm();
    return {ok:Boolean(token)};
  }

  function isTab(tab){try{const u=new URL(tab?.url);return u.origin===ORIGIN||u.href.startsWith(chrome.runtime.getURL('extension/youtrack/youtrack'));}catch{return false;}}
  const viewFiles={report:'youtrack.html',fields:'youtrack-fields.html',network:'youtrack-network.html'};let opening=Promise.resolve();
  function openView(view){const file=viewFiles[view];if(!file)return Promise.reject(Error('Unknown view'));
    opening=opening.catch(()=>{}).then(async()=>{const url=chrome.runtime.getURL('extension/youtrack/'+file),tabs=await chrome.tabs.query({url});const existing=tabs.find(t=>t.url===url);if(existing){await chrome.tabs.update(existing.id,{active:true});if(existing.windowId)await chrome.windows.update(existing.windowId,{focused:true});return existing;}return chrome.tabs.create({url,active:true});});return opening;
  }
  async function onAction(tab){
    let origin=null;try{origin=new URL(tab?.url||'').origin;}catch{}
    if(origin===ORIGIN&&tab?.id!=null)connectFromTab(tab.id).catch(()=>{});
    return openView('report');
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender.id!==chrome.runtime.id)return;
    const internal=String(sender.url||'').startsWith(chrome.runtime.getURL('extension/youtrack/youtrack'));
    if((message?.type==='arm-youtrack-capture'||message?.type==='ensure-youtrack-session')&&internal){
      ensureSession().then(result=>reply(result)).catch(()=>reply({ok:false}));return true;
    }
    if(message?.type==='open-youtrack-view'&&internal){openView(message.view).then(tab=>reply({ok:true,tabId:tab?.id})).catch(()=>reply({ok:false}));return true;}
    if(message?.type==='youtrack-request-log'&&internal){globalThis.YouTrackRequestStore?.write(message.row).then(()=>reply({ok:true}));return true;}
    if(message?.type==='youtrack-request-clear'&&internal){globalThis.YouTrackRequestStore?.clear().then(()=>reply({ok:true}));return true;}
    if(message?.type==='get-youtrack-session-status'){sessionReady().then(connected=>reply({connected}));return true;}
    if(message?.type==='open-youtrack-report'){onAction().then(()=>reply({ok:true}));return true;}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.ytToken){
    if(changes.ytToken.newValue&&changes.ytToken.newValue!==changes.ytToken.oldValue)globalThis.YouTrackRequestStore?.write({id:'token-'+Date.now(),at:Date.now(),method:'TOKEN',path:'/api/…',state:'token'}).catch(()=>{});
  }});
  // Clean up anything a previous version left on the YouTrack site: the sensor
  // is no longer injected there at all (feature flag youtrackSensorOnSite).
  chrome.tabs.query({url:HOST}).then(tabs=>Promise.all(tabs.filter(t=>t.id).map(tab=>chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
    document.getElementById('youtrack-session-assistant')?.remove();
    globalThis.__youtrackReferenceAssistantDispose?.();
  }}).catch(()=>{})))).catch(()=>{});
  chrome.scripting.getRegisteredContentScripts().then(scripts=>{
    const ids=scripts.filter(s=>s.id.startsWith('advanced_youtrack_sensor_')).map(s=>s.id);
    if(ids.length)return chrome.scripting.unregisterContentScripts({ids});
  }).catch(()=>{});
  chrome.storage.session.remove(['youtrackCapturedAuthByOrigin','youtrackAuthSession']).catch(()=>{});
  globalThis.YouTrackBackground=Object.freeze({isTab,onAction,ensureSession,connectFromTab});
})();
