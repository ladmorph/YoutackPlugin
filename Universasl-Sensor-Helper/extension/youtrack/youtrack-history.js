// Local, in-memory report snapshots. No API or persistent storage access.
document.addEventListener('DOMContentLoaded',()=>{
  const reports=[];let last=null,active=null,restoring=false;
  const aside=document.createElement('aside');aside.id='youtrack-history';aside.setAttribute('aria-label','История отчётов');
  aside.innerHTML='<div class="history-head"><h2>История отчётов</h2><button type="button" class="history-close" aria-label="Закрыть историю" title="Закрыть">\u00d7</button></div><p class="history-note">Отчёты, построенные в этой вкладке. Открытие отчёта из истории работает без запросов к YouTrack.</p><div class="history-list"></div><p class="history-status" role="status"></p>';
  document.body.append(aside);
  const backdrop=document.createElement('div');backdrop.className='history-backdrop';backdrop.hidden=true;document.body.append(backdrop);
  // Кнопка живёт в общей навигации страницы; панель выезжает поверх контента и
  // по умолчанию закрыта, поэтому вёрстка отчёта не сдвигается.
  const toggle=document.createElement('button');toggle.type='button';toggle.id='youtrack-history-toggle';toggle.className='history-open-button';toggle.textContent='\u21ba История отчётов';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','youtrack-history');
  // Кнопка стоит в шапке самого отчёта — так видно, к какому разделу относится история.
  const head=document.querySelector('.youtrack-shared-header');
  const help=document.getElementById('reference-onboarding-start');
  if(head){const bar=document.createElement('div');bar.className='header-actions';head.append(bar);bar.append(toggle);if(help)bar.append(help);}
  else (document.querySelector('.app-header')||document.body).append(toggle);
  let open=false;
  function setOpen(value,moveFocus=true){
    open=value;
    document.body.classList.toggle('history-open',open);
    aside.classList.toggle('open',open);
    backdrop.hidden=!open;
    toggle.setAttribute('aria-expanded',String(open));
    aside.setAttribute('aria-hidden',String(!open));
    if(moveFocus)(open?aside.querySelector('.history-close'):toggle).focus({preventScroll:true});
  }
  toggle.onclick=()=>setOpen(!open);
  aside.querySelector('.history-close').onclick=()=>setOpen(false);
  backdrop.onclick=()=>setOpen(false);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&open)setOpen(false);});
  setOpen(false,false);
  const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  function paint(){
    const list=aside.querySelector('.history-list');list.replaceChildren();
    if(!reports.length)list.append(el('p','Здесь появятся построенные отчёты.'));
    for(const r of [...reports].reverse()){
      const row=el('div');row.className='history-entry';
      const button=el('button',r.label);button.type='button';button.setAttribute('aria-pressed',String(active===r));button.onclick=()=>restore(r);
      const projects=(r.loadedProjects&&r.loadedProjects.length?r.loadedProjects:r.model.projectNames)||[];
      row.append(button,el('small',projects.length?projects.join(', '):'Без проектов в данных'));list.append(row);
    }
  }
  function capture(){
    if(restoring||!lastComputed)return;
    if(lastComputed===last){if(active)active.capacity=structuredClone(capacityStore);return;}
    last=lastComputed;
    const values={};for(const id of ['dateFrom','dateTo','ytDateFrom','ytDateTo','ignorePeriod']){const e=document.getElementById(id);if(e)values[id]=e.type==='checkbox'?e.checked:e.value;}
    const r={model:structuredClone(lastComputed),data:structuredClone(workItemsData),teams:structuredClone(teamsData),config:structuredClone(fieldConfig),explicit:STATUS_FIELD_FROM_USER_CONFIG,capacity:structuredClone(capacityStore),values,projects:[...document.querySelectorAll('#ytProjectList .selected')].map(e=>e.dataset.name)};
    // Показываем проекты, по которым реально есть загруженные списания, а не
    // весь список проектов из пресета.
    const fromData=[...new Set((Array.isArray(workItemsData)?workItemsData:[]).map(w=>w?.issue?.project?.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    r.loadedProjects=fromData.length?fromData:r.projects.filter(Boolean);
    r.label=`${lastComputed.periodLabel || 'Без периода'} · №${reports.length+1}`;reports.push(r);active=r;paint();
  }
  function restore(r){
    if(document.getElementById('ytFetchBtn')?.disabled){aside.querySelector('.history-status').textContent='Дождитесь окончания текущей загрузки, затем откройте отчёт из истории.';return;}
    const keepScroll=window.scrollY,wasOpen=!!active;
    restoring=true;
    try{
      workItemsData=structuredClone(r.data);teamsData=structuredClone(r.teams);applyFieldConfig(structuredClone(r.config));STATUS_FIELD_FROM_USER_CONFIG=r.explicit;
      Object.keys(capacityStore).forEach(k=>delete capacityStore[k]);Object.assign(capacityStore,structuredClone(r.capacity));lastComputed=structuredClone(r.model);last=lastComputed;active=r;expandedTeams.clear();lastBreakdownExport=null;closeBreakdown();
      for(const [id,value] of Object.entries(r.values)){const e=document.getElementById(id);if(e){if(e.type==='checkbox')e.checked=value;else e.value=value;}}
      for(const chip of document.querySelectorAll('#ytPresetList .selected'))chip.click();
      window.ytSelectProjectsByNames(r.projects);
      for(const [id,source] of [['ytDateFrom','dateFrom'],['ytDateTo','dateTo']]){const input=document.getElementById(id),button=document.getElementById(id+'Btn');input.value=r.values[source]||r.values[id];button.textContent=input.value?input.value.split('-').reverse().join('.'):'Выберите дату';input.dispatchEvent(new Event('change',{bubbles:true}));}
      renderTable();renderProjectChart();aside.querySelector('.history-status').textContent='Открыт сохранённый отчёт: '+r.label;paint();setOpen(false,false);
      document.getElementById('tablePanel').style.display='block';
      // Переключение между отчётами истории сохраняет место просмотра;
      // первое открытие показывает начало отчёта.
      const smooth=!matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(wasOpen)requestAnimationFrame(()=>window.scrollTo({top:Math.min(keepScroll,Math.max(0,document.documentElement.scrollHeight-innerHeight)),behavior:'auto'}));
      else (document.querySelector('.app-header')||document.body).scrollIntoView({block:'start',behavior:smooth?'smooth':'auto'});
    }finally{restoring=false;}
  }
  new MutationObserver(capture).observe(document.getElementById('tableContainer'),{childList:true});paint();capture();
});
