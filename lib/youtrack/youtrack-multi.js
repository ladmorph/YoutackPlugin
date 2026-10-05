(function(root){
  'use strict';
  const api=name=>root[name]||(typeof require==='function'?require('./'+({YouTrackAdvanced:'youtrack-advanced',YouTrackPeople:'youtrack-people',YouTrackAdvancedRules:'youtrack-advanced-rules'}[name])+'.js'):null);
  const norm=v=>String(v??'').normalize('NFKC').trim().toLocaleLowerCase('ru');
  function plan(teams,available){
    if(!Array.isArray(teams)||!teams.length)throw Error('В teams.json нет команд.');
    const selected=new Map(),skippedProjects=new Map();
    for(const team of teams){
      const matches=(available||[]).filter(p=>!p.archived&&[p.name,p.shortName].some(n=>n&&norm(n)===norm(team.projectName)));
      if(matches.length>1)throw Error(`Проект «${team.projectName}» из teams.json неоднозначен. Уточните название. Сбор не запущен.`);
      if(!matches.length){skippedProjects.set(norm(team.projectName),{projectName:team.projectName,reason:'not-visible',message:'Нет доступа или проект не найден среди доступных. Проект не учитывается.'});continue;}
      const p=matches[0];if(!selected.has(p.id))selected.set(p.id,{project:p,teams:[]});
      selected.get(p.id).teams.push({...team,projectId:p.id,projectName:p.name});
    }
    return {projects:[...selected.values()],skippedProjects:[...skippedProjects.values()]};
  }
  async function collect(options){
    const A=api('YouTrackAdvanced'),P=api('YouTrackPeople'),R=api('YouTrackAdvancedRules'),selection=plan(options.teams,options.projects),plans=selection.projects,skippedProjects=selection.skippedProjects.slice();
    const none=()=>Error('Нет доступных проектов для отчёта. Не учтены: '+skippedProjects.map(p=>p.projectName).join(', ')+'.');
    if(!plans.length)throw none();
    // Validate every project before the first request, not halfway through a run.
    A.dates(options.from,options.to);
    for(const p of plans){P.scope({...options,...p,issues:[],workItems:[]});R.resolve(options.rulesProfile||P.defaultProfile(),p.project,p.teams);}
    let last=0,totalIssues=0,totalWork=0;
    const fetchPage=async(url,signal)=>{
      const delay=Math.max(0,100-(Date.now()-last));
      if(delay)await new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new DOMException('Остановлено','AbortError'));const stop=()=>{clearTimeout(timer);reject(new DOMException('Остановлено','AbortError'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},delay);signal?.addEventListener('abort',stop,{once:true});});
      if(signal?.aborted)throw new DOMException('Остановлено','AbortError');
      try{return await options.fetchPage(url,signal);}finally{last=Date.now();}
    };
    const reports=[];
    for(const p of plans){
      let data;try{data=await A.collect({...options,...p,fetchPage,progress:s=>options.progress?.(p.project.name+' · '+s)});}
      catch(e){if(options.signal?.aborted)throw new DOMException('Остановлено','AbortError');if(e.name==='AbortError')throw e;if(e.status!==403&&e.message!=='HTTP 403')throw e;const skipped={projectName:p.project.name,reason:'forbidden',message:'У вас нет доступа к данным проекта. Проект не учитывается.'};skippedProjects.push(skipped);options.progress?.(p.project.name+' · нет доступа, проект пропущен');continue;}
      totalIssues+=data.issues.length;totalWork+=data.workItems.length;if(totalIssues>20000||totalWork>20000)throw Error('Больше 20 000 записей одного вида по всем проектам. Уменьшите период. Неполный отчёт не опубликован.');
      reports.push({...p,...data});
    }
    if(!reports.length)throw none();
    return {reports,skippedProjects};
  }
  function summary(models,from,to,profileMode=false){
    const A=api('YouTrackAdvanced'),P=api('YouTrackPeople'),pools={},teams=[],activities={},activityIds=new Map();
    for(const m of models)for(const label of Object.values(m.people.activities)){const n=norm(label);if(!activityIds.has(n)){const id='activity-'+activityIds.size;activityIds.set(n,id);activities[id]=label;}}
    const empty=()=>Object.fromEntries(Object.keys(activities).map(k=>[k,{hours:0,items:0}]));
    for(const [n,m] of models.entries()){
      const remap=new Map(Object.entries(m.people.activities).map(([key,label])=>[key,activityIds.get(norm(label))]));
      for(const [key,pool]of Object.entries(m.pools))pools['project-'+n+'-'+key]=pool;
      const rewrite=x=>{const next={...x,activities:empty(),days:x.days.map(d=>{const categories=empty();for(const [key,value]of Object.entries(d.categories))categories[remap.get(key)]={...value};return {...d,categories};})};for(const [key,value]of Object.entries(x.activities))next.activities[remap.get(key)]={...value};if(x.poolKey)next.poolKey='project-'+n+'-'+x.poolKey;return next;};
      for(const t of m.people.teams){const copy=rewrite(t);copy.id='project-'+n+'-'+t.id;copy.projectName=m.project.name;copy.displayName=models.length>1?m.project.name+' / '+t.name:t.name;copy.members=t.members.map(rewrite);teams.push(copy);}
    }
    const totalHours=models.reduce((s,m)=>s+m.totalHours,0),count=models.reduce((s,m)=>s+m.count,0),members=teams.reduce((s,t)=>s+t.members.length,0);
    const people={...models[0].people,teams,activities,from,to,multipleProjects:models.length>1};
    const sections=[],add=(title,paragraphs,headers,rows,id)=>sections.push({title,paragraphs,headers,rows,...(id?{id}:{})});
    const poolForTeams=selected=>{const byProject=new Map();for(const t of selected){const p=pools[t.poolKey];if(!p)continue;if(!byProject.has(p.project))byProject.set(p.project,new Set());for(const id of p.issueIds)byProject.get(p.project).add(id);}const groups=[...byProject].map(([project,ids])=>({project,issueIds:[...ids],count:ids.size}));if(!groups.length)return null;const key='group-'+Object.keys(pools).length;pools[key]={label:'Задачи команд',count:groups.reduce((s,p)=>s+p.count,0),groups};return key;};
    const note='Проекты и команды заданы teams.json. Списания ограничены участниками и периодом; одинаковый логин в разных проектах учитывается отдельно. Специальные поля ОМП показаны только в разборе ОМП.';
    add('Проекты из teams.json',[note],['Проект','Команд','Участников','Задач','Списано, ч'],models.map(m=>({poolKey:poolForTeams(teams.filter(t=>t.projectName===m.project.name)),values:[m.project.name,String(m.people.teams.length),String(m.people.teams.reduce((s,t)=>s+t.members.length,0)),String(m.count),A.fmt(m.totalHours)]})));
    const labels=models[0].people.labels;
    add('Команды · показатели первого отчёта',['Прежние формулы по списаниям разработки. Все команды сохраняются, в том числе без списаний.'],['Проект / команда','Все часы',...P.keys.map(k=>labels[k]+', ч'),'Вне категорий, ч'],teams.map(t=>({poolKey:t.poolKey,values:[t.displayName,A.fmt(t.totalHours),...P.keys.map(k=>A.fmt(t.stats[k])),A.fmt(t.unclassifiedHours)]})));
    add('Участники · показатели первого отчёта',[people.method],['Проект / команда / участник','Часы','Закрытые БЗ','С оценкой','В оценке','Среднее факт/оценка, %'],teams.flatMap(t=>t.members.map(m=>({poolKey:m.poolKey,values:[t.displayName+' / '+m.login,A.fmt(m.totalHours),String(m.stats.closedFeatures),String(m.stats.estimateTotal),String(m.stats.estimateHits),A.fmt(m.stats.estimateAveragePct)]}))));
    add('Команды · закрытие и оценка',[people.method],['Проект / команда','Закрытые БЗ','С оценкой','В оценке','Выше оценки','Среднее факт/оценка, %'],teams.map(t=>({poolKey:t.poolKey,values:[t.displayName,String(t.stats.closedFeatures),String(t.stats.estimateTotal),String(t.stats.estimateHits),String(t.stats.estimateTotal-t.stats.estimateHits),A.fmt(t.stats.estimateAveragePct)]})));
    add('Ёмкость команд',['Ёмкость задана в teams.json и должна соответствовать периоду. Это не оценка индивидуальной доступности.'],['Проект / команда','Бизнес, ч','Ёмкость, ч','Использовано, %'],teams.map(t=>({values:[t.displayName,A.fmt(t.stats.business),A.fmt(t.capacityHours),t.capacityHours>0?A.fmt(t.stats.business/t.capacityHours*100):'Нет данных']})));
    const activityRows=Object.entries(activities).map(([k,label])=>{const h=teams.reduce((s,t)=>s+t.activities[k].hours,0);return {values:[label,A.fmt(h),totalHours?A.fmt(h/totalHours*100)+'%':'Нет данных']};});
    add('Виды списаний · отдельно от типов задач',['Точные названия видов работ. Проекты и команды не объединяются в одну команду; часы здесь — общий итог.'],['Вид работы','Списано, ч','Доля'],activityRows,'activity-breakdown');
    const categories=P.keys.map(k=>({values:[labels[k],A.fmt(teams.reduce((s,t)=>s+t.stats[k],0)),'']}));categories.push({values:['Вне категорий первого отчёта',A.fmt(teams.reduce((s,t)=>s+t.unclassifiedHours,0)),'']});
    for(const row of categories)row.values[2]=totalHours?A.fmt(Number(row.values[1].replace(/[\s\u00a0\u202f]/g,'').replace(',','.'))/totalHours*100)+'%':'Нет данных';
    add('Категории первого отчёта',['Применяются правила профиля к виду списания и типу задачи. Анализ и тестирование отдельно доступны в видах списаний.'],['Категория','Списано, ч','Доля'],categories,'category-breakdown');
    add('Границы данных',[note,people.method],['Проект','Исключено неоднозначных списаний','Их часы'],models.map(m=>({values:[m.project.name,String(m.people.excluded.ambiguous),A.fmt(m.people.excluded.ambiguousHours)]})));
    const buckets=models.map(m=>teams.filter(t=>t.projectName===m.project.name)),ordered=[];for(let i=0;buckets.some(b=>b[i]);i++)for(const b of buckets)if(b[i])ordered.push(b[i]);
    const findings=ordered.slice(0,4).map(t=>({title:t.displayName,text:`${A.fmt(t.totalHours)} ч; участников ${t.members.length}. Бизнес — ${A.fmt(t.stats.business)} ч, технические — ${A.fmt(t.stats.technical)} ч, баги — ${A.fmt(t.stats.bug)} ч. ${t.members.filter(m=>!m.totalHours).length} участников без списаний.`,poolKey:t.poolKey,count:t.issueIds.length,tone:'neutral'}));
    const dayMap=new Map();for(const t of teams)for(const d of t.days){if(!dayMap.has(d.date))dayMap.set(d.date,{date:d.date,hours:0,items:0,categories:empty()});const total=dayMap.get(d.date);total.hours+=d.hours;total.items+=d.items;for(const [k,v]of Object.entries(d.categories)){total.categories[k].hours+=v.hours;total.categories[k].items+=v.items;}}
    const days=[];for(let d=Date.parse(from);d<=Date.parse(to);d+=86400000){const date=new Date(d).toISOString().slice(0,10);days.push(dayMap.get(date)||{date,hours:0,items:0,categories:empty()});}
    const activityTrend={from,to,categories:activities,days,dimension:'activity'};
    const allRows=teams.map(t=>({label:t.displayName,values:[{value:t.totalHours,color:'#7356c3'}]}));
    const H=root.YouTrackHeatmap||require('./youtrack-heatmap.js');
    return {heatmap:H.create({people,from,to}),project:models.length===1?models[0].project:{id:'all-teams-projects',name:'Все проекты из teams.json'},from,to,createdAt:Date.now(),count,totalHours,people,pools,sections,findings,charts:[{type:'bars',title:'Виды работ · раздельно',unit:'ч',note:'Точные виды списаний. Можно выбрать команду или участника.',rows:activityRows.map(r=>({label:r.values[0],values:[{value:teams.reduce((sum,t)=>sum+t.activities[Object.keys(activities).find(k=>activities[k]===r.values[0])].hours,0),color:'#7356c3'}]}))},{type:'bars',title:'Проекты и команды · списания',unit:'ч',note:'Все команды из файла, включая нулевые.',allRows,rows:allRows.slice(0,10)}],kpis:[{label:'Проекты / команды',value:models.length+' / '+teams.length,note:'Состав teams.json'},{label:'Списано',value:A.fmt(totalHours)+' ч',note:'За выбранный период'},{label:'Участники команд',value:String(members),note:'Один человек может входить в разные проекты'},{label:'Задачи со списаниями',value:String(count),note:'Только состав команд'}],scopeNote:note,rulesMode:profileMode?'profile':'teams',typeField:'По правилам проекта',trend:activityTrend,activityTrend};
  }
  function analyze(options){
    const A=api('YouTrackAdvanced'),P=api('YouTrackPeople'),R=api('YouTrackAdvancedRules');
    const models=options.reports.map(data=>{
      const args={...options,...data};if(A.supportsProject(data.project))return A.analyze(args);
      const issues=R.prepareIssues(data.issues,Boolean(options.rulesProfile)),scoped=P.scope({...args,issues}),people=P.analyze(scoped,data.project,options.rulesProfile,options.from,options.to),pools={};
      const byId=new Map(scoped.issues.map(i=>[i.id,i]));let index=0;
      for(const t of people.teams)for(const target of [t,...t.members])if(target.issueIds.length){const key='p'+index++;pools[key]={project:data.project.shortName||data.project.name,label:data.project.name+' / '+(target.name||target.login),issueIds:target.issueIds.map(id=>byId.get(id)?.idReadable).filter(Boolean),count:target.issueIds.length};target.poolKey=key;}
      return summary([{project:data.project,count:scoped.issues.length,totalHours:people.teams.reduce((s,t)=>s+t.totalHours,0),people,pools}],options.from,options.to,Boolean(options.rulesProfile));
    });
    if(!models.length)throw Error('Нет доступных проектов для отчёта.');
    const skipped=options.skippedProjects||[];
    const annotate=model=>{model.skippedProjects=structuredClone(skipped);if(!skipped.length)return model;const note='Не учтены проекты: '+skipped.map(p=>p.projectName+' — '+p.message).join(' ');if(model.project.id==='all-teams-projects')model.project={...model.project,name:'Доступные проекты из teams.json'};model.scopeNote+=' '+note;model.sections.unshift({id:'skipped-projects',title:'Проекты, не включённые в отчёт',paragraphs:['Итоги, участники, графики и ёмкость рассчитаны только по доступным проектам.'],headers:['Проект','Причина'],rows:skipped.map(p=>({values:[p.projectName,p.message]}))});return model;};
    if(models.length===1)return annotate(models[0]);
    const result=summary(models,options.from,options.to,Boolean(options.rulesProfile));result.projectReports=models.map(annotate);return annotate(result);
  }
  const exported={plan,collect,analyze};root.YouTrackMulti=exported;if(typeof module!=='undefined'&&module.exports)module.exports=exported;
})(globalThis);
