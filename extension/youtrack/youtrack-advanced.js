(function(root){
  'use strict';
  const A=root.YouTrackAdvanced,M=root.YouTrackMulti;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,fn,cls)=>{const b=el('button',text,cls);b.type='button';b.addEventListener('click',fn);return b;};
  function mount(adapter){
    const host=document.querySelector('#advanced-report-panel'),setup=document.querySelector('#advanced-setup-panel');
    let imported=null, importedRules=null, reportRoot=null, result=null, resultBase='', running=false, exporting=false, controller=null, cache=null, readyMascot=null;
    const title=el('div',null,'analysis-hero');title.append(el('span','✦','sensor-mark'));
    const heading=el('div');heading.append(el('span','СЕНСОР / ОБЗОР ПРОЕКТА','analysis-eyebrow'),el('h2','Разбор по полям проекта'),el('p','Категории работ, оценки, качество и ТТМ — в одном разборе. От коротких выводов — к нужной подборке в YouTrack.'));title.append(heading);host.append(title);
    const setupTitle=el('div',null,'analysis-hero');setupTitle.append(el('h2','Собрать отчёт по полям YouTrack'));setup.append(setupTitle);
    const settings=el('details',null,'advanced-settings');settings.open=true;const settingsTitle=el('summary','Настроить отчёт');settings.append(settingsTitle);setup.append(settings);
    const connectionNote=el('p',null,'advanced-notice');settings.append(connectionNote);
    const profileNote=el('p','Набор полей настроен только для проекта «'+A.SUPPORTED_PROJECT+'». Для сбора других проектов выберите teams.json.','advanced-scope');settings.append(profileNote);
    const controls=el('div',null,'grid advanced-controls'), project=el('select'), from=el('input'), to=el('input'), useTeams=el('input');
    project.id='advanced-project';from.id='advanced-from';to.id='advanced-to';from.type=to.type='date';useTeams.type='checkbox';useTeams.id='advanced-use-teams';
    const today=new Date().toISOString().slice(0,10);to.value=today;from.value=new Date(Date.parse(today+'T00:00:00Z')-6*86400000).toISOString().slice(0,10);
    function dateLimits(){const start=Date.parse(from.value+'T00:00:00Z');to.min=from.value;if(Number.isFinite(start))to.max=A.maxEnd(from.value);else to.removeAttribute('max');}dateLimits();
    function label(text,input){const l=el('label',text);l.append(input);return l;}
    controls.append(label('Один проект',project),label('Списания с · UTC',from),label('По · включительно',to));settings.append(controls);
    const scope=el('p','До 3 календарных месяцев за сбор; по умолчанию — последние 7 дней. С teams.json в разбор входят его участники и задачи с их списаниями в периоде. Без файла — выбранный проект ОМП. С файлом — все доступные проекты, перечисленные в нём. Поля задач показывают текущее накопленное состояние.','advanced-scope');settings.append(scope);
    const presets=el('div',null,'trend-windows');presets.setAttribute('role','group');presets.setAttribute('aria-label','Период сбора');for(const [name,months,days]of [['Неделя',0,7],['2 недели',0,14],['Месяц',1,0],['3 месяца',3,0]]){const b=button(name,()=>{if(running||exporting)return;to.value=today;const next=new Date(Date.parse(today)+86400000).toISOString().slice(0,10);from.value=months?A.shiftMonth(next,-months):new Date(Date.parse(next)-days*86400000).toISOString().slice(0,10);while(A.maxEnd(from.value)<today)from.value=new Date(Date.parse(from.value)+86400000).toISOString().slice(0,10);changed();});presets.append(b);}settings.append(presets);
    const teamLine=el('div',null,'advanced-teams'), teamNote=el('p'), teamsFile=el('input');teamsFile.id='advanced-teams-file';teamsFile.type='file';teamsFile.accept='.json,application/json';teamsFile.hidden=true;
    const importButton=button('Выбрать teams.json',()=>teamsFile.click());importButton.id='advanced-import-teams';
    const teamLabel=label('Состав отчёта из teams.json',useTeams);teamLabel.className='advanced-checkbox';teamLine.append(teamLabel,importButton,teamsFile,teamNote);settings.append(teamLine);
    const rulesLine=el('div',null,'advanced-teams'),useRules=el('input'),rulesFile=el('input'),rulesNote=el('p');useRules.type='checkbox';useRules.id='advanced-use-rules';rulesFile.id='advanced-config-file';rulesFile.type='file';rulesFile.accept='.json,application/json';rulesFile.hidden=true;
    const rulesLabel=label('Применить правила профиля · teams + config',useRules);rulesLabel.className='advanced-checkbox';
    const importRules=button('Выбрать config.json',()=>rulesFile.click());importRules.id='advanced-import-config';rulesNote.id='advanced-rules-note';
    rulesLine.append(rulesLabel,importRules,rulesFile,rulesNote);settings.append(rulesLine);
    const rulesFormat=el('details',null,'advanced-calculation');rulesFormat.append(el('summary','Что меняет config.json'));
    rulesFormat.append(el('p','Категории и названия берутся из workItemTypeField, issueTypeField и columnLabels; закрытие — из statusField, оценка разработки — из estimateField, факт — из actualField. Без statusField действует closed_tasks_condition выбранного проекта из teams.json. Неизвестные значения остаются отдельно. teams.json задаёт состав участников и связанные с их списаниями задачи. teams.json задаёт все проекты и команды файла. Специальные расчёты по полям ОМП доступны только внутри разбора ОМП; для других проектов используются командные показатели по правилам.'));
    const example=el('pre',JSON.stringify({workItemTypeField:{dev:['Разработка'],meeting:['Встречи/Проектные коммуникации'],overs:['Оверы. Разработка']},issueTypeField:{fieldName:'Тип',values:{feature:['Фича'],tech:['Техническая','Техдолг'],bug:['Bug'],works:['Работы']}},statusField:{fieldName:'Статус',doneStatuses:['Готово','Закрыто']},estimateField:{fieldName:'Оценка разработка'}},null,2));rulesFormat.append(example);rulesLine.append(rulesFormat);
    const skippedNotice=el('aside',null,'advanced-access-warning');skippedNotice.id='advanced-skipped-setup';skippedNotice.setAttribute('role','status');skippedNotice.hidden=true;setup.append(skippedNotice);
    function showSkipped(node,items){node.replaceChildren();node.hidden=!items.length;if(!items.length)return;node.append(el('strong','Эти проекты не будут учтены'));const list=el('ul');for(const item of items)list.append(el('li',item.projectName+' — '+item.message));node.append(list,el('p','Продолжим сбор по остальным доступным проектам.'));}
    const actions=el('div',null,'actions'), run=button('Построить отчёт Сенсора',()=>build(false),'primary'), refresh=button('Обновить с сервера',()=>build(true)), stop=button('Остановить',()=>controller?.abort(),'danger-link');
    run.id='advanced-run';stop.id='advanced-stop';refresh.id='advanced-refresh';stop.disabled=true;
    actions.append(run,refresh,stop);
    const help=el('div',null,'advanced-help');actions.append(help);setup.append(actions);root.YouTrackSensorHelp?.attach(help,'Сбор по полям YouTrack','Выберите период списаний. Если найден teams.json, собираются все указанные в нём проекты и команды. Недоступные проекты пропускаются с предупреждением; доступные собираются дальше. Без teams.json доступен выбор одного проекта ОМП. Без файла — обзор всего проекта. Кнопка построения запускает сбор задач и списаний. Результат открывается в «Разборе Сенсора». Стоп отменяет ожидание и следующие запросы; уже принятый сервером запрос может завершиться. PDF и CSV строятся локально.');
    const helpButton=help.querySelector('button');if(helpButton)helpButton.textContent='? Как работает отчёт';
    const status=el('p','Выберите проект и запустите сбор.','advanced-status');status.id='advanced-status';status.setAttribute('role','status');
    const error=el('p',null,'error');error.id='advanced-error';error.hidden=true;error.setAttribute('role','alert');
    setup.append(status,error);
    const openResult=button('Открыть разбор Сенсора',()=>adapter.showResult(),'primary');openResult.id='advanced-open-result';openResult.hidden=true;setup.append(openResult);
    const back=button('К настройке отчёта',()=>adapter.showSetup());back.id='advanced-back-setup';host.append(back);
    const empty=el('p','Здесь появится готовый разбор по полям YouTrack. Выберите новый способ на вкладке «Отчёт» и запустите сбор.','advanced-notice');host.append(empty);
    const exportStatus=el('p',null,'advanced-status');exportStatus.setAttribute('role','status');host.append(exportStatus);
    const output=el('div');output.id='advanced-result';host.append(output);
    const tabs=document.querySelector('.yt-tabs');
    const stickySize=new ResizeObserver(()=>{host.style.setProperty('--report-tabs-height',(tabs?.getBoundingClientRect().height||0)+'px');const nav=output.querySelector('.advanced-result-nav');host.style.setProperty('--report-nav-height',(nav?.getBoundingClientRect().height||64)+'px');});
    if(tabs)stickySize.observe(tabs);stickySize.observe(output);
    let navigationFrame=0;
    window.addEventListener('scroll',()=>{if(navigationFrame||host.hidden)return;navigationFrame=requestAnimationFrame(()=>{navigationFrame=0;const nav=output.querySelector('.advanced-result-nav');if(!nav)return;const boundary=nav.getBoundingClientRect().bottom+30;let active=null;for(const b of nav.querySelectorAll('button[data-target]')){const section=output.querySelector(b.dataset.target);if(section?.getBoundingClientRect().top<=boundary)active=b;}for(const b of nav.children){if(b===active)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');}});},{passive:true});
    function dismissReady(){readyMascot?.dispose();readyMascot=null;setup.querySelector('#advanced-ready')?.remove();}
    function announceReady(){
      dismissReady();const invite=el('aside',null,'advanced-ready');invite.id='advanced-ready';
      const figure=el('div',null,'advanced-ready-figure');figure.setAttribute('aria-hidden','true');
      const copy=el('div'),message=el('strong',result?.skippedProjects?.length?'Отчёт готов. Есть пропущенные проекты.':'Всё готово. Начнём с главного?');message.setAttribute('role','status');copy.append(message,el('p','Я собрал выводы, графики и подборки задач. Полный разбор можно скачать в PDF.'));
      const actions=el('div',null,'actions');
      function jump(selector){const target=output.querySelector(selector);if(!target)return;adapter.showResult();dismissReady();focusSection(target);}
      actions.append(button('Посмотреть выводы',()=>jump('.advanced-brief'),'primary'),button('К графикам',()=>jump('.advanced-visuals')),button('Закрыть подсказку',dismissReady,'quiet'));
      copy.append(actions);invite.append(figure,copy);setup.insertBefore(invite,openResult);adapter.ready?.();
      if(root.SensorMascot){readyMascot=root.SensorMascot.mount(figure,{baseUrl:chrome.runtime.getURL('extension/shared/living-signal-mascot.png'),waveUrl:chrome.runtime.getURL('extension/shared/living-signal-mascot-wave.png')});readyMascot.setIntro('final');readyMascot.setState('success');readyMascot.setScene('celebrate');}
    }
    function context(){return adapter.context();}
    function teamProfile(){const p=imported||context().profile;return p?.teams?.some(t=>!t.automatic)?p:null;}
    function selectedRules(){const c=context();return importedRules||(c.profile?.classification?{classification:c.profile.classification,statusOverridesProjects:c.profile.statusOverridesProjects,actualFieldName:c.actualFieldName||'Факт разработка'}:null);}
    function sync(){
      const c=context(), current=project.value, available=c.projects || [];
      if(!running){project.replaceChildren(new Option('Выберите проект',''));for(const p of available){const option=new Option(p.name+(A.supportsProject(p)?'':' · нет профиля полей'),p.id);option.disabled=!A.supportsProject(p);project.append(option);}const eligible=available.filter(A.supportsProject);if(eligible.some(p=>p.id===current))project.value=current;else if(eligible.length===1)project.value=eligible[0].id;}
      profileNote.textContent=c.connected&&!available.some(A.supportsProject)?'Среди доступных проектов нет «'+A.SUPPORTED_PROJECT+'». Выберите teams.json для сбора по его проектам и командам.':'Набор полей настроен только для проекта «'+A.SUPPORTED_PROJECT+'». Для сбора других проектов выберите teams.json.';
      connectionNote.hidden=c.connected;connectionNote.textContent='Подключите YouTrack и получите список проектов на вкладке «Отчёт». Файл work_items.json здесь не используется.';
      const teams=teamProfile()?.teams;showSkipped(skippedNotice,[]);useTeams.checked=Boolean(teams?.length);
      if(teams?.length){
        project.parentElement.hidden=true;profileNote.textContent='Состав берём целиком из teams.json: все доступные проекты и их команды. Недоступные пропускаются с предупреждением. Специальные поля ОМП — только в разборе ОМП.';
        try{const selection=M.plan(teams,available),plans=selection.projects;if(c.connected)showSkipped(skippedNotice,result?.skippedProjects?.length?result.skippedProjects:selection.skippedProjects);teamNote.textContent=`${imported?'Выбран teams.json':'Найден профиль команд'} · проектов: ${plans.length}; команд: ${plans.reduce((n,p)=>n+p.teams.length,0)}. `+plans.map(p=>p.project.name+': '+p.teams.map(t=>t.name+' ('+t.members.length+')').join(', ')).join(' · ');}
        catch(e){teamNote.textContent=e.message;}
      }else{project.parentElement.hidden=false;teamNote.textContent='teams.json не выбран. Выберите один проект ОМП либо импортируйте состав всех проектов.';}
      rulesNote.textContent=selectedRules()?`${importedRules?'config.json прочитан':'Доступны правила сохранённого профиля обычного отчёта'}. ${useRules.checked?'Применим к категориям, закрытию и оценке разработки.':'Сейчас действуют стандартные поля YouTrack.'}`:'Без конфига действуют стандартные поля YouTrack. Для своих правил выберите config.json и teams.json. Импорт не запускает запросы.';
      useRules.disabled=importRules.disabled=running||exporting;
      run.disabled=refresh.disabled=running||exporting||!c.connected||(!teams?.length&&!project.value);useTeams.disabled=true;project.disabled=from.disabled=to.disabled=importButton.disabled=running||exporting;stop.disabled=!running;stop.hidden=!running;refresh.hidden=!result;run.hidden=Boolean(result)&&!running;run.textContent=running?'Собираю данные…':'Построить отчёт Сенсора';setup.setAttribute('aria-busy',String(running));empty.hidden=Boolean(result);empty.textContent=running?'Данные ещё собираются. Статус и остановка доступны во вкладке «Отчёт».':'Здесь появится готовый разбор по полям YouTrack. Выберите новый способ на вкладке «Отчёт» и запустите сбор.';openResult.hidden=!result||running;
    }
    function changed(){dismissReady();dateLimits();cache=null;reportRoot=result=null;output.replaceChildren();exportStatus.textContent='';error.hidden=true;settings.open=true;settingsTitle.textContent='Настроить отчёт';status.textContent='Параметры изменены. Постройте отчёт.';sync();}
    for(const control of [project,from,to,useTeams])control.addEventListener('change',changed);
    useRules.addEventListener('change',()=>{if(useRules.checked)useTeams.checked=true;changed();});
    rulesFile.addEventListener('change',async()=>{
      const f=rulesFile.files?.[0];if(!f||running||exporting)return;
      try{if(f.size>2*1024*1024)throw Error('config.json больше 2 МБ.');const parsed=root.YouTrackAdvancedRules.parseConfig(JSON.parse((await f.text()).replace(/^\uFEFF/,'')));if(running||exporting)return;importedRules=parsed;useRules.checked=useTeams.checked=true;changed();}
      catch(e){error.textContent=e instanceof SyntaxError?'Некорректный JSON.':adapter.safeMessage(e);error.hidden=false;}finally{rulesFile.value='';}
    });
    teamsFile.addEventListener('change',async()=>{
      const f=teamsFile.files?.[0];if(!f||running)return;
      try{if(f.size>2*1024*1024)throw Error('teams.json больше 2 МБ.');const data=JSON.parse((await f.text()).replace(/^\uFEFF/,''));if(running)return;const parsed=root.YouTrackWorkItems.migrateLegacy(data);if(!parsed.teams.length)throw Error('В файле нет команд.');imported=parsed;useTeams.checked=true;changed();error.hidden=true;}
      catch(e){error.textContent=e instanceof SyntaxError?'Некорректный JSON.':adapter.safeMessage(e);error.hidden=false;}finally{teamsFile.value='';}
    });
    async function build(force){
      if(running||exporting)return;
      if(adapter.busy()){status.textContent='Дождитесь завершения текущей операции YouTrack или остановите её.';return;}
      error.hidden=true;
      let snapshot;
      try{
        const c=context();if(!c.connected)throw Error('Сначала подключите YouTrack.');
        const teams=teamProfile()?.teams||null;A.dates(from.value,to.value);
        const selection=teams?M.plan(teams,c.projects):null,plans=selection?.projects,p=teams?plans[0]?.project:c.projects.find(p=>p.id===project.value);
        if(teams&&!p)throw Error('Нет доступных проектов для отчёта. Не учтены: '+selection.skippedProjects.map(p=>p.projectName).join(', ')+'.');
        if(!p)throw Error('Выберите один доступный проект или teams.json.');
        if(!teams&&!A.supportsProject(p))throw Error('Этот набор полей настроен только для проекта «'+A.SUPPORTED_PROJECT+'».');
        const rulesProfile=useRules.checked?selectedRules():null;if(useRules.checked&&!rulesProfile)throw Error('Выберите config.json либо отключите правила профиля.');
        if(!teams)root.YouTrackAdvancedRules.resolve(rulesProfile,p,teams);
        snapshot={...c,project:{...p},from:from.value,to:to.value,teams:teams?structuredClone(teams):null,rulesProfile:rulesProfile?structuredClone(rulesProfile):null};
        const key=JSON.stringify([c.baseUrl,c.sessionKey,plans?.map(p=>p.project.id)||p.id,snapshot.from,snapshot.to,snapshot.teams,snapshot.rulesProfile]);
        if(!force&&cache?.key===key&&Date.now()-cache.at<120000){reportRoot=result=cache.result;resultBase=c.baseUrl;render();status.textContent='Готово · из памяти этой вкладки, без запросов.';return;}
        controller=new AbortController();if(!adapter.acquire(controller))return;dismissReady();running=true;cache=null;result=null;sync();output.replaceChildren();exportStatus.textContent='';
        const deadline=setTimeout(()=>controller?.abort(),300000);
        try{
          const data=await (teams?M:A).collect({...snapshot,fetchPage:adapter.fetchPage,signal:controller.signal,progress:s=>{status.textContent=s;}});
          if(controller.signal.aborted)throw new DOMException('Остановлено','AbortError');
          const latest=context();if(latest.sessionKey!==snapshot.sessionKey||latest.baseUrl!==snapshot.baseUrl||!latest.connected)throw Error('Подключение изменилось. Повторите сбор.');
          reportRoot=result=(teams?M:A).analyze({...snapshot,...data});resultBase=snapshot.baseUrl;cache={key,at:Date.now(),result};render();status.textContent=`Графики и разбор готовы · ${result.count} задач · ${A.fmt(result.totalHours)} ч за период. Можно скачать PDF.`;announceReady();
        }finally{clearTimeout(deadline);adapter.release(controller);controller=null;running=false;sync();}
      }catch(e){error.textContent=e.name==='AbortError'?'Сбор остановлен или превышены 5 минут. Неполный отчёт не опубликован.':adapter.safeMessage(e);error.hidden=false;status.textContent='Не завершено';}
    }
    function link(issue){return resultBase+'/issue/'+encodeURIComponent(issue);}
    function focusSection(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
    function save(blob,name){const u=URL.createObjectURL(blob),a=el('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
    function poolLink(key){
      const pool=result.pools?.[key], links=pool&&A.buildPoolLinks(resultBase,pool);
      if(!links?.length)return null;
      function anchor(item){const a=el('a',item.label,'advanced-pool-link');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';return a;}
      if(links.length===1){const a=anchor(links[0]);a.textContent=`Открыть ${pool.count} задач ↗`;a.setAttribute('aria-label',`${pool.label} · ${pool.count} задач в YouTrack`);return a;}
      const details=el('details',null,'advanced-pool-parts');details.append(el('summary',`Подборка · ${pool.count} задач ↗`));
      details.append(el('p','Точный набор разделён на части, чтобы ссылка оставалась рабочей.'));
      const list=el('div',null,'advanced-pool-links');for(const part of links)list.append(anchor(part));details.append(list);return details;
    }
    function table(parent,def){
      if(!def.rows?.length){parent.append(el('p','Подходящих данных нет.'));return;}
      const search=el('input');search.type='search';search.placeholder='Поиск в таблице';search.setAttribute('aria-label','Поиск: '+def.title);parent.append(search);
      parent.append(el('p','Сортировка — по заголовку столбца.','advanced-caption'));
      parent.append(el('p','Прокрутите таблицу вправо, чтобы увидеть остальные столбцы →','advanced-scroll-hint'));
      const wrap=el('div',null,'sensor-data-table'),t=el('table'),head=el('thead'),tr=el('tr'),body=el('tbody');
      let page=0,sortIndex=-1,direction=1;const headers=[];
      def.headers.forEach((h,i)=>{const th=el('th');th.scope='col';th.setAttribute('aria-sort','none');const b=button(h+' ↕',()=>{direction=sortIndex===i?-direction:1;sortIndex=i;page=0;draw();},'advanced-sort');b.setAttribute('aria-label','Сортировать: '+h);th.append(b);headers.push({th,b,h});tr.append(th);});
      if(def.rows.some(r=>r.poolKey))tr.append(el('th','В YouTrack'));head.append(tr);t.append(head,body);wrap.append(t);parent.append(wrap);
      const nav=el('div',null,'sensor-pager'),info=el('span'),prev=button('Назад',()=>{page--;draw();}),next=button('Дальше',()=>{page++;draw();});nav.append(prev,info,next);parent.append(nav);
      function draw(){
        if(sortIndex>=0)def.rows.sort((a,b)=>A.compareValues(a.values[sortIndex],b.values[sortIndex],direction));
        headers.forEach(({th,b,h},i)=>{th.setAttribute('aria-sort',i===sortIndex?direction===1?'ascending':'descending':'none');b.textContent=h+' '+(i===sortIndex?direction===1?'↑':'↓':'↕');});
        const needle=search.value.toLocaleLowerCase('ru');const rows=def.rows.filter(r=>r.values.join(' ').toLocaleLowerCase('ru').includes(needle));body.replaceChildren();for(const r of rows.slice(page*8,page*8+8)){const tr=el('tr');r.values.forEach((v,i)=>{const td=el('td');if(i===0&&r.open)td.append(button(v,r.open,'advanced-text-button'));else td.textContent=v;tr.append(td);});if(def.rows.some(r=>r.poolKey)){const td=el('td'),a=r.poolKey&&poolLink(r.poolKey);if(a)td.append(a);else td.textContent='—';tr.append(td);}body.append(tr);}info.textContent=`${rows.length?page*8+1:0}–${Math.min(rows.length,page*8+8)} из ${rows.length} групп`;prev.disabled=page===0;next.disabled=(page+1)*8>=rows.length;nav.hidden=rows.length<=8;
      }
      search.addEventListener('input',()=>{page=0;draw();});draw();
    }
    function render(){
      output.replaceChildren();const r=result;let trendPanel=null,ttmPanel=null,heatmapPanel=null;if(reportRoot?.projectReports){const choose=el('select');choose.id='advanced-project-view';choose.append(new Option(reportRoot.skippedProjects?.length?'Все доступные проекты и команды':'Все проекты и команды','all'));reportRoot.projectReports.forEach((p,i)=>choose.append(new Option(p.project.name,String(i))));choose.value=r===reportRoot?'all':String(reportRoot.projectReports.indexOf(r));choose.addEventListener('change',()=>{result=choose.value==='all'?reportRoot:reportRoot.projectReports[Number(choose.value)];render();});output.append(label('Просмотр собранного отчёта · без новых запросов',choose));}
      settings.open=false;settingsTitle.textContent=`${r.project.name} · ${r.from} — ${r.to} · Изменить параметры`;
      if(r.skippedProjects?.length){const warning=el('aside',null,'advanced-access-warning');warning.id='advanced-skipped-result';warning.setAttribute('role','status');showSkipped(warning,r.skippedProjects);warning.querySelector('strong').textContent='Отчёт построен по доступным проектам';warning.querySelector('p').textContent='Перечисленные проекты исключены из всех итогов, графиков и ёмкости.';output.append(warning);}
      const heading=el('div',null,'advanced-report-heading'),summary=el('div');
      summary.append(el('span','РАЗБОР ГОТОВ','analysis-eyebrow'),el('h3',r.project.name),el('p',`Списания: ${r.from} — ${r.to} · Снимок полей: ${new Date(r.createdAt).toLocaleString('ru-RU')}`),el('p',r.scopeNote),el('p',r.rulesMode==='profile'?'Правила: teams.json + профиль config.json':r.rulesMode==='teams'?'Состав teams.json · стандартные поля и правила закрытия проекта':'Правила: стандартные поля YouTrack'));heading.append(summary);
      const exports=el('div',null,'advanced-exports');
      const pdf=button('Скачать PDF',async()=>{
        if(exporting||running)return;exporting=true;pdf.disabled=true;cancel.hidden=false;sync();
        try{
          const ttmSnapshot=ttmPanel?.snapshot(),heatmapSnapshot=heatmapPanel?.snapshot();const sections=structuredClone(ttmSnapshot?[...r.sections.filter(s=>!s.id?.startsWith('ttm-')),...ttmSnapshot.sections]:r.sections),trendSnapshot=trendPanel?.snapshot();if(trendSnapshot)sections.push(trendSnapshot.section);if(heatmapSnapshot)sections.push(heatmapSnapshot.summary);
          for(const s of [...sections])if(s.headers?.length===12&&s.title.includes('показатели первого отчёта')){
            const delivery=structuredClone(s);delivery.title=s.title+' · закрытие и оценка';delivery.headers=['Команда / участник','Закрытые БЗ','В оценке / сравнимых','Среднее факт/оценка, %','Дней со списаниями'];for(const row of delivery.rows){const v=row.values;row.values=[v[0],v[8],v[9],v[10],v[11]];}sections.splice(sections.indexOf(s)+1,0,delivery);
            s.headers=['Команда / участник','Всего / не распознано, ч',...s.headers.slice(2,7)];for(const row of s.rows){const v=row.values;row.values=[v[0],v[1]+' / '+v[7],...v.slice(2,7)];}
          }
          const issueUrl=key=>A.buildPoolLinks(resultBase,r.pools[key])[0]?.url||'';
          function linkLabel(key){const pool=r.pools[key],links=pool?A.buildPoolLinks(resultBase,pool):[];return !links.length?'':links.length>1?`Открыть первую часть: ${links[0].count} из ${pool.count} задач. Все части - в интерфейсе.`:`Открыть подборку: ${pool.count} задач`;}
          const summaries={'План и факт':'Оценки и накопленный факт сравниваются только у задач с заполненной парой полей. Открытые и закрытые задачи разделены.','Качество и доработки':'Накопленные счётчики задач. Это не количество событий выбранного периода.','ТТМ разработки':'Накопленная длительность процесса у закрытых задач. Медиана и P90 описывают распределение, а не превышение норматива.','Достоверность и границы':'Заполненность полей и состав данных. Пропущенное значение не считается нулём.'};
          for(const s of sections){if(!s.summary)s.summary=s.id==='category-breakdown'?'Списания периода по типам работ и задач. Часы категорий не пересекаются; нераспознанные значения сохранены отдельно.':s.id==='unclassified-types'?'Сочетания типов, которые не попали в правила. Их часы сохранены в общем итоге, но не отнесены к категориям по догадке.':summaries[s.title]||'Текущий состав групп и списания выбранного периода. Правила учёта приведены в методике.';for(const row of s.rows||[])if(row.poolKey){row.issue=row.poolKey;const parts=A.buildPoolLinks(resultBase,r.pools[row.poolKey]);if(parts.length>1)row.linkLabel=`Первая часть: ${parts[0].count} из ${r.pools[row.poolKey].count} задач`;}
            if(s.title==='План и факт'&&s.headers?.length===8){s.headers=['Этап / состояние','Пар / задач','Оценка / факт, ч','Δ, ч / факт к оценке','Выше оценки'];for(const row of s.rows){const v=row.values;row.values=[v[0]+' · '+v[1],v[2],v[3]+' / '+v[4],v[5]+' / '+v[6],v[7]];}}
          }
          const findings=r.findings.map(f=>({...f,issue:f.poolKey,linkLabel:linkLabel(f.poolKey)}));
          const blob=await root.YouTrackSensorPdf.download({layout:'executive',title:r.project.name+' · разбор Сенсора',period:r.from+' — '+r.to,kpis:structuredClone(r.kpis),findings,sections,charts:[...structuredClone(r.charts).filter(c=>!c.title.startsWith('ТТМ')).slice(0,3),...(ttmSnapshot&&ttmSnapshot.chart.rows.length?[ttmSnapshot.chart]:[]),...(heatmapSnapshot&&heatmapSnapshot.chart.rows.length?[heatmapSnapshot.chart]:[]),...(trendSnapshot&&trendSnapshot.chart.rows.length<=20?[trendSnapshot.chart]:[])],scopeNote:r.scopeNote+' Поля задач - текущий накопленный снимок; только списания ограничены периодом. Формулы и ограничения сохранены ниже. Ссылки открывают подборки в YouTrack. Если подборка разделена, PDF открывает первую часть с указанным числом задач; все части доступны в интерфейсе. Текст PDF растровый.',issueUrl,onProgress:n=>{exportStatus.textContent=`Подготавливаю PDF · страниц ${n}`;}});
          if(blob){save(blob,'sensor-advanced.pdf');exportStatus.textContent='Краткий PDF готов. Запросов к YouTrack не было.';}else exportStatus.textContent='Выгрузка отменена.';
        }catch(e){exportStatus.textContent=adapter.safeMessage(e);}finally{exporting=false;pdf.disabled=false;cancel.hidden=true;sync();}
      },'primary');pdf.id='advanced-pdf';
      const cancel=button('Отменить PDF',()=>root.YouTrackSensorPdf.cancel());cancel.hidden=true;
      const csv=button('Агрегаты CSV',()=>{const cell=v=>'"'+String(/^[=+\-@]/.test(String(v))?'\''+v:v).replaceAll('"','""')+'"';const lines=[];for(const s of [...(ttmPanel?[...r.sections.filter(s=>!s.id?.startsWith('ttm-')),...ttmPanel.snapshot().sections]:r.sections),...(trendPanel?[trendPanel.snapshot().section]:[]),...(heatmapPanel?[heatmapPanel.snapshot().section]:[])]){lines.push([s.title],...(s.paragraphs||[]).map(p=>[p]));if(s.headers)lines.push(s.headers,...s.rows.map(row=>row.values));lines.push([]);}save(new Blob(['\uFEFF'+lines.map(row=>row.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'sensor-advanced.csv');});csv.id='advanced-csv';exports.append(pdf,csv,cancel);heading.append(exports);output.append(heading);
      const navigation=el('nav',null,'advanced-result-nav');navigation.setAttribute('aria-label','Разделы готового разбора');
      for(const [label,selector]of [['Краткие выводы','.advanced-brief'],...(r.people?[['Команды и участники','#advanced-people']]:[]),['Категории работ','#advanced-work-structure'],['Динамика','#advanced-trend'],...(r.heatmap?[['Хитмап','#advanced-heatmap']]:[]),...(r.ttm?[['ТТМ','#advanced-ttm']]:[]),['Графики','#advanced-charts'],['Таблицы','#advanced-tables']]){const b=button(label,()=>{const target=output.querySelector(selector);if(!target)return;for(const other of navigation.children)other.removeAttribute('aria-current');b.setAttribute('aria-current','true');focusSection(target);});b.dataset.target=selector;navigation.append(b);}output.append(navigation);
      const kpis=el('div',null,'advanced-kpis');for(const k of r.kpis){const card=el('article',null,'advanced-kpi');card.append(el('span',k.label),el('strong',k.value),el('p',k.note||''));kpis.append(card);}output.append(kpis);
      const brief=el('section',null,'advanced-brief'),briefHead=el('div',null,'advanced-section-heading');briefHead.append(el('span','✦','advanced-sensor-spark'),el('div'));briefHead.lastChild.append(el('h3','Главное за минуту'),el('p','Наблюдения по данным. Откройте подборку, если нужен контекст.'));brief.append(briefHead);
      const findings=el('div',null,'advanced-findings');for(const [i,f] of r.findings.entries()){
        const card=el('article',null,'advanced-finding');card.dataset.tone=f.tone||'neutral';const number=el('span',String(i+1).padStart(2,'0'),'advanced-finding-index');const copy=el('div');copy.append(el('h4',f.title),el('p',f.text));const a=f.poolKey&&poolLink(f.poolKey);if(a)copy.append(a);card.append(number,copy);findings.append(card);
      }brief.append(findings);output.append(brief);
      if(r.people)root.YouTrackPeopleView.mount(output,r.people,{table,poolLink,save});
      const category=r.sections.find(s=>s.id==='category-breakdown');
      if(category){
        const block=el('section',null,'advanced-card advanced-category-report');block.id='advanced-work-structure';
        block.append(el('span','НАЗНАЧЕНИЕ ЗАДАЧИ И ВИД РАБОТЫ','analysis-eyebrow'),el('h3','На что ушло время'));
        const mode=el('select');mode.id='classification-view';mode.setAttribute('aria-label','Разрез классификации');
        for(const [id,title]of [['task-type-breakdown','Типы задач · Фича / Техдолг / Баг / Анализ / QA'],['activity-breakdown','Виды списаний · разработка / анализ / тестирование'],['category-breakdown','Категории первого отчёта · правила']])if(r.sections.some(s=>s.id===id))mode.append(new Option(title,id));
        mode.value=r.rulesMode==='profile'?'category-breakdown':r.sections.some(s=>s.id==='task-type-breakdown')?'task-type-breakdown':'activity-breakdown';block.append(label('Показать',mode));
        const body=el('div');block.append(body);
        function showClassification(){
          const section=r.sections.find(s=>s.id===mode.value)||category;body.replaceChildren();
          body.append(el('p',section.paragraphs[0],'advanced-caption'));
          const grid=el('div',null,'advanced-category-grid');for(const row of section.rows){const card=el('article');card.append(el('h4',row.values[0]),el('strong',row.values[1]+' ч'),el('p',row.values[2]+' всех часов'));const link=row.poolKey&&poolLink(row.poolKey);if(link)card.append(link);grid.append(card);}body.append(grid);
          const details=el('details',null,'advanced-calculation');details.append(el('summary','Таблица и проверка классификации'));let populated=false;
          details.addEventListener('toggle',()=>{if(!details.open||populated)return;populated=true;table(details,section);if(section.id==='category-breakdown'){const unknown=r.sections.find(s=>s.id==='unclassified-types');if(unknown){details.append(el('h4',unknown.title));table(details,unknown);}}});
          body.append(details);
        }
        mode.addEventListener('change',showClassification);showClassification();
        root.YouTrackSensorHelp?.attach(block,'Как разделены часы','Типы задач показывают назначение: Фича, Техдолг, Баг, Анализ, QA и Работы. Виды списаний показывают, что делал участник: разработка, тестирование, анализ и другое. Это два разреза одних часов, их не складывают. Категории первого отчёта используют прежние правила по виду работы и типу задачи; факт разработки не включает тестирование и анализ.');output.append(block);
      }
      if(r.ttm){const lookup=new Map(r.ttm.records.map(i=>[i.id,i.idReadable])),cache=new Map();const register=(label,ids)=>{if(!ids.length)return null;const signature=label+'|'+ids.join('|');if(cache.has(signature))return cache.get(signature);const key='ttm-view-'+Object.keys(r.pools).length;r.pools[key]={label,project:r.project.shortName||r.project.name,count:ids.length,issueIds:ids.map(id=>lookup.get(id)).filter(Boolean)};cache.set(signature,key);return key;};ttmPanel=root.YouTrackTtmView.mount(output,r.ttm,{table,pool:register,poolLink,save});}
      const visuals=el('section',null,'advanced-visuals');const charts=r.charts||[];
      if(r.trend)trendPanel=root.YouTrackTrend.mount(visuals,r.activityTrend||r.trend,save);
      if(r.heatmap)heatmapPanel=root.YouTrackHeatmapView.mount(visuals,r.heatmap,{table,save});
      if(charts.length){
        const chartBox=el('section',null,'advanced-card'),head=el('div',null,'advanced-section-heading');chartBox.id='advanced-charts';head.append(el('div'));head.firstChild.append(el('span','ВИЗУАЛЬНЫЙ ОБЗОР','analysis-eyebrow'),el('h3','Графики'));chartBox.append(head);
        const chartSelect=el('select');chartSelect.id='advanced-chart-select';chartSelect.setAttribute('aria-label','Разрез графика');charts.forEach((m,i)=>chartSelect.append(new Option(m.title,String(i))));
        const sort=el('select');sort.setAttribute('aria-label','Сортировка графика');for(const [value,name]of [['hours-desc','Значение ↓'],['hours-asc','Значение ↑'],['name-asc','Название А—Я'],['name-desc','Название Я—А']])sort.append(new Option(name,value));
        const controls=el('div',null,'advanced-chart-controls');controls.append(label('Разрез',chartSelect),label('Сортировка',sort));chartBox.append(controls);
        const participant=el('select');participant.id='advanced-chart-participant';participant.append(new Option('Весь выбранный состав','all'));const chartTargets=new Map();for(const t of r.people?.teams||[]){chartTargets.set(t.id,{label:t.displayName||t.name,target:t});participant.append(new Option(t.displayName||t.name,t.id));for(const m of t.members){const key=t.id+' / '+m.login;chartTargets.set(key,{label:(t.displayName||t.name)+' / '+m.login,target:m});participant.append(new Option((t.displayName||t.name)+' / '+m.login,key));}}const participantLabel=label('Команда или участник из teams.json',participant);controls.append(participantLabel);
        const canvas=el('canvas',null,'sensor-canvas');canvas.hidden=true;const bars=el('div',null,'advanced-bars');bars.setAttribute('role','list');chartBox.append(bars,canvas);const chartNote=el('p',null,'advanced-caption');chartBox.append(chartNote);
        function draw(){const model=structuredClone(charts[Number(chartSelect.value)]),activity=!!r.people&&model.title.startsWith('Виды работ');participantLabel.hidden=!activity;participant.disabled=!activity;const selected=activity&&chartTargets.get(participant.value);if(selected){model.title='Виды работ · '+(selected.target.login||selected.target.name);model.note=selected.label+' · '+r.from+' — '+r.to+' · точные виды списания';model.allRows=Object.entries(r.people.activities).map(([k,label])=>({label,values:[{value:selected.target.activities[k].hours,color:'#7356c3'}]}));}const byName=sort.value.startsWith('name'),dir=sort.value.endsWith('desc')?-1:1;const all=model.allRows||model.rows;model.rows=all.slice().sort((a,b)=>byName?A.compareValues(a.label,b.label,dir):A.compareValues(a.values.reduce((s,v)=>s+v.value,0),b.values.reduce((s,v)=>s+v.value,0),dir)).slice(0,8);chartNote.textContent=`${model.rows.length} из ${all.length} групп. ${model.note||''}`;root.YouTrackSensorView.draw(model,canvas);
          bars.replaceChildren();bars.setAttribute('aria-label',model.title);const max=Math.max(0,...model.rows.map(row=>row.values.reduce((sum,v)=>sum+v.value,0)));
          for(const row of model.rows){const value=row.values.reduce((sum,v)=>sum+v.value,0),item=el('div',null,'advanced-bar-row');item.setAttribute('role','listitem');const labels=el('div',null,'advanced-bar-label');labels.append(el('span',row.label),el('strong',`${A.fmt(value)} ${model.unit||'ч'}`));const track=el('div',null,'advanced-bar-track'),fill=el('div');track.setAttribute('aria-hidden','true');fill.style.width=(max>0?value/max*100:0)+'%';track.append(fill);item.append(labels,track);bars.append(item);}
        }
        sort.addEventListener('change',draw);chartSelect.addEventListener('change',draw);participant.addEventListener('change',draw);draw();chartBox.append(button('Скачать этот график · PNG',()=>canvas.toBlob(blob=>{if(blob)save(blob,'sensor-advanced-chart.png');},'image/png'),'advanced-text-button'));visuals.append(chartBox);
      }
      const tableBox=el('section',null,'advanced-card'),tableHead=el('div',null,'advanced-section-heading');tableBox.id='advanced-tables';tableHead.append(el('div'));tableHead.firstChild.append(el('span','ПОДРОБНЕЕ ПО ГРУППАМ','analysis-eyebrow'),el('h3','Таблицы'));tableBox.append(tableHead);
      const selector=el('select');selector.id='advanced-section-select';selector.setAttribute('aria-label','Раздел агрегатов');const tabular=r.sections.filter(s=>s.headers&&!['category-breakdown','unclassified-types','task-type-breakdown','activity-breakdown'].includes(s.id));tabular.forEach((s,i)=>selector.append(new Option(s.title,String(i))));tableBox.append(label('Раздел анализа',selector));const tableBody=el('div',null,'advanced-block-body');tableBox.append(tableBody);
      function sectionChanged(){tableBody.replaceChildren();const s=tabular[Number(selector.value)];if(!s)return;
        tableBody.append(el('h4',s.title,'advanced-table-title'));
        const formula=el('details',null,'advanced-calculation');formula.append(el('summary','Как читать эти цифры и как они рассчитаны'));
        for(const p of s.paragraphs||[])formula.append(el('p',p,'advanced-table-note'));tableBody.append(formula);
        table(tableBody,s);root.YouTrackSensorHelp?.attach(tableBox,s.title,(s.paragraphs||[]).join(' '));}
      selector.addEventListener('change',sectionChanged);sectionChanged();visuals.append(tableBox);output.append(visuals);
      const methodology=el('details',null,'advanced-methodology');methodology.append(el('summary','О данных и расчётах'));
      for(const s of r.sections.filter(s=>!s.headers)){methodology.append(el('h4',s.title));for(const p of s.paragraphs||[])methodology.append(el('p',p));}
      methodology.append(el('p','В отчёте показаны агрегаты. Ссылки открывают точные подборки задач в YouTrack; отдельные задачи здесь не перечисляются. Сортировка и выгрузки работают локально.'));output.append(methodology);
    }
    document.addEventListener('youtrack-folder-changed',()=>{imported=null;importedRules=null;useRules.checked=false;controller?.abort();changed();});
    document.addEventListener('youtrack-view-changed',e=>{if(['advanced','report'].includes(e.detail.view))sync();});
    document.addEventListener('youtrack-connection-changed',()=>{dismissReady();controller?.abort();cache=null;result=null;output.replaceChildren();exportStatus.textContent='';sync();});
    window.addEventListener('pagehide',dismissReady,{once:true});
    return {sync};
  }
  root.YouTrackAdvancedView={mount};
})(globalThis);
