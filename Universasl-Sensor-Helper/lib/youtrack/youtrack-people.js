(function(root){
  'use strict';
  const norm=v=>String(v??'').trim().toLocaleLowerCase('ru').replace(/\s+/g,'');
  const legacy=()=>root.YouTrackWorkItems||require('./youtrack-workitems.js');
  const keys=['business','technical','bug','overtime','meeting'];
  function defaultProfile(){return {classification:legacy().mergeClassification({issueType:{fieldName:'Тип',bug:['Баг','Bug']},completion:{fieldName:'Статус',values:[],useResolved:true}}),statusOverridesProjects:false};}
  function scope({issues,workItems,teams,project,from,to}){
    if(!teams)return null;
    const selected=teams.filter(t=>[norm(project.name),norm(project.shortName)].includes(norm(t.projectName))).map((t,i)=>({...t,id:'team-'+i,members:[...new Map((t.members||[]).map(m=>[norm(m),String(m).trim()])).values()]}));
    if(!selected.length||!selected.some(t=>t.members.length))throw Error('В teams.json нет участников выбранного проекта. Проверьте проект и состав команд.');
    const owners=new Map();for(const t of selected)for(const m of t.members){const n=norm(m);if(!owners.has(n))owners.set(n,[]);owners.get(n).push(t);}
    const start=Date.parse(from),end=Date.parse(to)+86400000,seen=new Set(),entries=[],ids=new Set(),excluded={outsideRoster:0,outsideRosterHours:0,ambiguous:0,ambiguousHours:0,invalid:0,duplicate:0,outsidePeriod:0};
    for(const w of workItems){if(seen.has(w.id)){excluded.duplicate++;continue;}seen.add(w.id);if(typeof w.date!=='number'||w.date<start||w.date>=end){excluded.outsidePeriod++;continue;}const minutes=w.duration?.minutes;if(typeof minutes!=='number'||!Number.isFinite(minutes)||minutes<0){excluded.invalid++;continue;}
      const matching=owners.get(norm(w.author?.login))||[];
      if(matching.length!==1){const key=matching.length?'ambiguous':'outsideRoster';excluded[key]++;excluded[key+'Hours']+=minutes/60;continue;}
      const team=matching[0],login=team.members.find(m=>norm(m)===norm(w.author.login));entries.push({...w,author:{...w.author,login},teamId:team.id});ids.add(w.issue?.id);
    }
    return {teams:selected,workItems:entries,issues:issues.filter(i=>ids.has(i.id)),excluded,projectIssueCount:issues.length};
  }
  function analyze(scoped,project,rulesProfile,from,to){
    const W=legacy(),defaults=defaultProfile().classification;
    const profile={schema:1,teams:scoped.teams,classification:rulesProfile?.classification||defaults,statusOverridesProjects:rulesProfile?.statusOverridesProjects||false};
    const byId=new Map(scoped.issues.map(i=>[i.id,i])),entries=scoped.workItems.map(w=>({...w,issue:byId.get(w.issue?.id)||{...w.issue,project,customFields:[]}}));
    const activityNames=[...new Map(entries.map(w=>[norm(w.type?.name)||'missing',String(w.type?.name||'Вид работы не указан').trim()])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'ru'));
    const activities=Object.fromEntries(activityNames.map(([,name],i)=>['activity-'+i,name])),activityKey=new Map(activityNames.map(([name],i)=>[name,'activity-'+i]));
    const accumulator=W.createAccumulator(profile);for(let n=0;n<entries.length;n+=500)accumulator.addPage(entries.slice(n,n+500));
    const result=accumulator.finish(),maps=new Map();
    const empty=()=>Object.fromEntries(Object.keys(activities).map(k=>[k,{hours:0,items:0}]));
    const fill=(target,rows)=>{target.totalHours=rows.reduce((s,w)=>s+w.duration.minutes/60,0);target.unclassifiedHours=Math.max(0,target.totalHours-keys.reduce((s,k)=>s+target.stats[k],0));target.issueIds=[...new Set(rows.map(w=>w.issue?.id).filter(Boolean))];target.activeDays=new Set(rows.map(w=>new Date(w.date).toISOString().slice(0,10))).size;target.activities=empty();
      const days=new Map();for(const w of rows){const date=new Date(w.date).toISOString().slice(0,10),k=activityKey.get(norm(w.type?.name)||'missing'),h=w.duration.minutes/60;if(!days.has(date))days.set(date,{hours:0,items:0,categories:empty()});const d=days.get(date);d.hours+=h;d.items++;d.categories[k].hours+=h;d.categories[k].items++;target.activities[k].hours+=h;target.activities[k].items++;}target.days=[...days].map(([date,v])=>({date,...v}));
    };
    for(const w of entries){const k=w.teamId+'\0'+norm(w.author.login);if(!maps.has(k))maps.set(k,[]);maps.get(k).push(w);}
    for(const t of result.teams){const all=[];for(const m of t.members){const rows=maps.get(t.id+'\0'+norm(m.login))||[];fill(m,rows);all.push(...rows);}fill(t,all);}
    return {teams:result.teams,labels:result.profile.labels,activities,excluded:scoped.excluded,from,to,projectIssueCount:scoped.projectIssueCount,method:'Виды работ разделены по точному workItem.type: анализ, тестирование и разработка не смешиваются. Категории первого отчёта — отдельный разрез по его правилам. Расчёт первого отчёта: факт — списания разработки выбранного периода; оценка — поле задачи. Закрытые бизнес-задачи — с бизнес-списаниями участника в периоде и текущим закрытым статусом. Факт / оценка — среднее отношений по задачам, не отношение сумм. Оценка задачи не делится между участниками; персональные числа закрытых задач не складываются. Ёмкость — заданная бизнес-ёмкость команды, она должна соответствовать периоду. Нулевые списания не доказывают свободное время.'};
  }
  function trend(model,target){const days=new Map(target.days.map(d=>[d.date,d])),out=[];for(let t=Date.parse(model.from);t<=Date.parse(model.to);t+=86400000){const date=new Date(t).toISOString().slice(0,10),d=days.get(date)||{hours:0,items:0,categories:Object.fromEntries(Object.keys(model.activities).map(k=>[k,{hours:0,items:0}]))};out.push({date,...d});}return {from:model.from,to:model.to,categories:model.activities,days:out,dimension:'activity'};}
  function activityTrend(workItems,from,to){
    const seen=new Set(),items=workItems.filter(w=>{if(seen.has(w.id))return false;seen.add(w.id);return typeof w.date==='number'&&w.date>=Date.parse(from)&&w.date<Date.parse(to)+86400000&&typeof w.duration?.minutes==='number'&&Number.isFinite(w.duration.minutes)&&w.duration.minutes>=0;});
    const types=[...new Map(items.map(w=>[norm(w.type?.name)||'missing',String(w.type?.name||'Вид работы не указан').trim()])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'ru')),categories=Object.fromEntries(types.map(([,name],i)=>['activity-'+i,name])),lookup=new Map(types.map(([key],i)=>[key,'activity-'+i])),days=new Map();
    for(let d=Date.parse(from);d<=Date.parse(to);d+=86400000){const date=new Date(d).toISOString().slice(0,10);days.set(date,{date,hours:0,items:0,categories:Object.fromEntries(Object.keys(categories).map(k=>[k,{hours:0,items:0}]))});}
    for(const w of items){const d=days.get(new Date(w.date).toISOString().slice(0,10)),c=d.categories[lookup.get(norm(w.type?.name)||'missing')];d.hours+=w.duration.minutes/60;d.items++;c.hours+=w.duration.minutes/60;c.items++;}
    return {from,to,categories,days:[...days.values()],dimension:'activity'};
  }
  function capacity(team){const hours=team.stats.business,limit=team.capacityHours,known=typeof limit==='number'&&Number.isFinite(limit)&&limit>0;return {hours,limit,percent:known?hours/limit*100:null,fill:known?Math.min(100,hours/limit*100):0,excess:known?Math.max(0,hours-limit):null};}
  const api={capacity,scope,analyze,trend,activityTrend,keys,defaultProfile};root.YouTrackPeople=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
