// Guided report flow. Watches UI state; never starts a request or calculation.
document.addEventListener('DOMContentLoaded',() => {
  let connected=false,frame=0,hidden=false,lastData=null,lastResult=null,built=false,targets=[];
  const host=document.createElement('aside');host.id='youtrack-flow';host.setAttribute('aria-label','Помощник по отчёту');
  host.innerHTML='<button type="button" class="flow-hide" aria-label="Свернуть помощника">−</button><img class="flow-mascot" alt="Сенсор" width="48" height="48"><div class="flow-copy"><strong></strong><p aria-live="polite"></p><button type="button" class="flow-jump">К этому шагу</button></div>';
  host.querySelector('.flow-mascot').src=chrome.runtime.getURL('extension/graylog/living-signal-mascot.png');
  document.body.append(host);
  const projectHint=document.createElement('div');projectHint.className='flow-project-hint';projectHint.hidden=true;
  projectHint.innerHTML='<p role="status">Выберите пресет — он отметит проекты из своих настроек — или выберите проекты вручную. Затем укажите период и нажмите «Загрузить».</p><button type="button">Выбрать пресет</button> <button type="button">Выбрать проекты</button>';
  document.getElementById('ytProjectList')?.after(projectHint);
  function reveal(target){if(!target)return;for(let p=target.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;target.scrollIntoView({block:'center',behavior:'smooth'});(target.querySelector('button')||target).focus({preventScroll:true});}
  projectHint.querySelectorAll('button').forEach((button,index)=>button.onclick=()=>reveal(document.querySelector(index?'#ytProjectList':document.querySelector('#ytPresetList .yt-chip')?'#ytPresetList':'#ytPresetsPanel details summary')));
  document.getElementById('ytFetchBtn')?.addEventListener('click',event=>{
    if(!connected||document.querySelector('#ytProjectList .selected'))return;
    event.preventDefault();event.stopImmediatePropagation();hidden=false;host.classList.remove('collapsed');host.querySelector('.flow-hide').textContent='−';host.querySelector('.flow-hide').setAttribute('aria-label','Свернуть помощника');
    document.getElementById('ytFetchStatusShort').textContent='Выберите пресет или хотя бы один проект перед загрузкой.';update();reveal(projectHint);
  },true);
  host.querySelector('.flow-hide').onclick=()=>{hidden=!hidden;host.classList.toggle('collapsed',hidden);host.querySelector('.flow-hide').textContent=hidden?'?':'−';host.querySelector('.flow-hide').setAttribute('aria-label',hidden?'Развернуть помощника':'Свернуть помощника');update();};
  host.querySelector('.flow-jump').onclick=()=>{const target=targets[0];target?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});target?.focus({preventScroll:true});};
  function update(){
    document.querySelectorAll('.flow-target').forEach(e=>e.classList.remove('flow-target'));targets=[];
    const data=typeof workItemsData==='undefined'?null:workItemsData,result=typeof lastComputed==='undefined'?null:lastComputed;
    if(data!==lastData){lastData=data;built=false;}
    if(result&&result!==lastResult){lastResult=result;built=true;}
    const fetchButton=document.getElementById('ytFetchBtn');if(!fetchButton)return;
    const missingProject=!document.querySelector('#ytProjectList .selected');projectHint.hidden=!connected||!missingProject;
    let title,text,selectors;
    if(!connected){title='Нет сессии YouTrack';text=globalThis.SensorFeatureFlags?.youtrackTokenCapture!==false?'Откройте отчёт с открытой страницы YouTrack (иконка расширения на вкладке YouTrack) или нажмите «Обновить подключение».':'Сбор токена YouTrack отключён в этой сборке (флаг youtrackTokenCapture в extension/feature-flags.js).';selectors=['#ytCaptureBtn'];}
    else if(fetchButton.disabled){title='Загружаю списания';text='Дождитесь завершения загрузки. Вы можете открыть Network — сбор продолжится.';selectors=[];}
    else if(missingProject){title='Выберите пресет или проекты';text=document.querySelector('#ytPresetList .selected')?'В выбранном пресете не нашлось доступных проектов. Выберите другой пресет или отметьте доступные проекты вручную.':'Можно выбрать пресет с командами — проекты отметятся автоматически. Или выберите проекты вручную в блоке загрузки.';selectors=['#ytProjectList','#ytPresetList'];}
    else if(document.getElementById('ytFetchStatusShort')?.textContent==='Выберите пресет или хотя бы один проект перед загрузкой.'){document.getElementById('ytFetchStatusShort').textContent='Проекты выбраны. Проверьте период и нажмите «Загрузить».';schedule();return;}
    else if(document.getElementById('ytFetchStatusShort')?.textContent.startsWith('Ошибка')){title='Загрузка не завершена';text='Проверьте сообщение об ошибке в блоке загрузки. После исправления повторите запрос.';selectors=['#ytFetchBtn'];}
    else if(!data){title='Выберите период и нажмите «Загрузить»';text='Выберите проекты, проверьте даты начала и окончания, затем загрузите списания.';selectors=['#ytDateFromBtn','#ytDateToBtn','#ytFetchBtn'];}
    else if(built){title='Отчёт готов';text='Раскрывайте команды и показатели. Сводку и детализацию можно скачать в Excel.';selectors=['#tablePanel .export-btn'];}
    else if(document.querySelector('#ytPresetList .selected')){title='Постройте отчёт';text='Пресет выбран. Нажмите «Применить пресет и построить отчёт».';selectors=['#ytApplyPresetBtn'];}
    else if(document.querySelector('#ytPresetList .yt-chip')){title='Выберите пресет';text='Списания загружены. Выберите пресет с вашими командами и правилами.';selectors=['#ytPresetList'];}
    else {title='Добавьте пресет';text='Списания загружены. Импортируйте свои пресеты или откройте «Создать / обновить пресет» и добавьте teams.json.';selectors=['#ytPresetsPanel details summary','#ytImportPresetsFile'];}
    host.querySelector('strong').textContent=title;host.querySelector('p').textContent=text;
    targets=selectors.map(s=>document.querySelector(s)).filter(Boolean).map(e=>e.hidden?e.closest('label')||e:e);
    if(!hidden)targets.forEach(e=>e.classList.add('flow-target'));
    host.querySelector('.flow-jump').hidden=!targets.length;
  }
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;update();});};
  async function session(){connected=Boolean((await chrome.runtime.sendMessage({type:'get-youtrack-session-status'}))?.connected);schedule();}
  chrome.storage.onChanged.addListener((c,a)=>{if((a==='local'&&c.ytToken)||(a==='session'&&(c.youtrackExplicitConnection||c.youtrackLiveToken)))session();});
  const observer=new MutationObserver(records=>{if(records.some(r=>r.type==='childList'||r.attributeName==='disabled'||r.attributeName==='class'&&r.target.matches('.yt-chip')))schedule();});
  for(const id of ['ytFetchPanel','ytPresetsPanel','tableContainer']){const el=document.getElementById(id);if(el)observer.observe(el,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','class']});}
  document.addEventListener('change',schedule);session();
});
