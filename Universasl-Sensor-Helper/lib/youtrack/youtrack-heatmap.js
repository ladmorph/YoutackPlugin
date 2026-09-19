(function(root){
  'use strict';
  function create({people,workItems=[],project,from,to}){
    if(people)return {from,to,rows:people.teams.flatMap(t=>t.members.map(m=>({id:t.id+' / '+m.login,project:t.projectName||project.name,team:t.name,member:m.login,days:m.days.map(d=>({date:d.date,hours:d.hours}))})))};
    const rows=new Map(),seen=new Set();for(const w of workItems){const minutes=w.duration?.minutes;if(seen.has(w.id)||typeof w.date!=='number'||w.date<Date.parse(from)||w.date>=Date.parse(to)+86400000||typeof minutes!=='number'||!Number.isFinite(minutes)||minutes<0)continue;seen.add(w.id);const member=w.author?.login||'Автор не указан',id=project.id+' / '+member;if(!rows.has(id))rows.set(id,{id,project:project.name,team:'Без teams.json',member,days:new Map()});const row=rows.get(id),date=new Date(w.date).toISOString().slice(0,10);row.days.set(date,(row.days.get(date)||0)+minutes/60);}
    return {from,to,rows:[...rows.values()].map(r=>({...r,days:[...r.days].map(([date,hours])=>({date,hours}))}))};
  }
  function view(model,{project='all',team='all',start=model.from,page=0,sort='hours'}={}){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||start<model.from||start>model.to)throw Error('Дата карты вне собранного периода');
    const days=[];for(let t=Date.parse(start);t<=Date.parse(model.to)&&days.length<14;t+=86400000)days.push(new Date(t).toISOString().slice(0,10));
    const rows=model.rows.filter(r=>(project==='all'||r.project===project)&&(team==='all'||r.project+' / '+r.team===team)).map(r=>{const d=new Map(r.days.map(x=>[x.date,x.hours])),values=days.map(day=>d.get(day)||0);return {...r,label:r.project+' / '+r.team+' / '+r.member,values,total:values.reduce((a,b)=>a+b,0)};});
    rows.sort((a,b)=>sort==='name'?a.label.localeCompare(b.label,'ru'):b.total-a.total||a.label.localeCompare(b.label,'ru'));
    const pages=Math.max(1,Math.ceil(rows.length/12)),index=Math.max(0,Math.min(Number(page)||0,pages-1)),visible=rows.slice(index*12,index*12+12),max=Math.max(0,...visible.flatMap(r=>r.values));
    return {days,rows:visible,allCount:rows.length,page:index,pages,max,total:rows.reduce((s,r)=>s+r.total,0),chart:{type:'heatmap',title:'Карта списаний · участник × день',note:`${days[0]} — ${days.at(-1)} UTC · участники ${rows.length?index*12+1:0}–${Math.min((index+1)*12,rows.length)} из ${rows.length}. Часы, не доступность.`,days,rows:visible.map(r=>({label:r.member+' / '+r.team+' / '+r.project,values:r.values}))}};
  }
  const api={create,view};root.YouTrackHeatmap=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
