(function(root){
  'use strict';
  const labels={closed:'Завершённые',open:'Незавершённые',unknown:'Статус не определён'};
  const names=v=>(Array.isArray(v)?v:v==null?[]:[v]).map(v=>String(v?.name??v).trim()).filter(Boolean);
  const field=(i,n)=>i.customFields?.find(f=>f.name===n)?.value;
  function create({rows,state,people,typeField='Тип',from,to}){
    const teams=(people?.teams||[]).map(t=>({id:t.id,name:t.name,ids:new Set(t.issueIds)}));
    return {from,to,teams:teams.map(({id,name})=>({id,name})),records:rows.map(i=>{
      const raw=field(i,'ТТМ. Разработка'),minutes=raw?.minutes,valid=typeof minutes==='number'&&Number.isFinite(minutes)&&minutes>=0,s=state(i),types=names(field(i,typeField));
      return {id:i.id,idReadable:i.idReadable,state:s===true?'closed':s===false?'open':'unknown',hours:valid?minutes/60:null,quality:valid?'valid':raw==null||raw===''?'missing':'invalid',type:types.length===1?types[0]:'Тип не определён',releases:names(field(i,'Релиз')),teams:teams.filter(t=>t.ids.has(i.id)).map(t=>t.id)};
    })};
  }
  function stats(rows){
    const valid=rows.filter(r=>r.hours!=null).sort((a,b)=>a.hours-b.hours),n=valid.length,median=n?(valid[Math.floor((n-1)/2)].hours+valid[Math.floor(n/2)].hours)/2:null,p90=n?valid[Math.ceil(.9*n)-1].hours:null;
    return {total:rows.length,n,median,p90,missing:rows.filter(r=>r.quality==='missing').length,invalid:rows.filter(r=>r.quality==='invalid').length,zero:valid.filter(r=>r.hours===0).length,ids:valid.map(r=>r.id),tail:valid.filter(r=>r.hours>p90).map(r=>r.id)};
  }
  function view(model,{state='closed',type='all',team='all',group='type'}={}){
    if(!Object.hasOwn(labels,state)||!['type','team','release'].includes(group))throw Error('Некорректный разрез ТТМ');
    const records=model.records.filter(r=>(type==='all'||r.type===type)&&(team==='all'||r.teams.includes(team))),rows=records.filter(r=>r.state===state),summary=stats(rows),buckets=new Map();
    for(const r of rows){const groups=group==='type'?[r.type]:group==='team'?(r.teams.length?r.teams.map(id=>model.teams.find(t=>t.id===id)?.name||id):['Без команды']):(r.releases.length?r.releases:['Без релиза']);for(const name of new Set(groups)){if(!buckets.has(name))buckets.set(name,[]);buckets.get(name).push(r);}}
    const groups=[...buckets].map(([name,items])=>({name,...stats(items)}));
    const bins=summary.n?[{label:'До медианы включительно',ids:rows.filter(r=>r.hours!=null&&r.hours<=summary.median).map(r=>r.id)},{label:'Выше медианы, до P90',ids:rows.filter(r=>r.hours>summary.median&&r.hours<=summary.p90).map(r=>r.id)},{label:'Дольше P90',ids:summary.tail}]:[];
    return {state,label:labels[state],type,team,group,summary,groups,bins,counts:Object.fromEntries(Object.keys(labels).map(s=>[s,records.filter(r=>r.state===s).length])),overlap:group==='team'||group==='release'};
  }
  function sections(model,current,fmt,pool){
    const s=current.summary,scope=`${current.label}; тип: ${current.type==='all'?'все':current.type}; команда: ${current.team==='all'?'все':model.teams.find(t=>t.id===current.team)?.name||current.team}.`,method='Поле «ТТМ. Разработка» — накопленная длительность процесса, не лимит трудозатрат. Медиана: середина отсортированных значений, среднее двух центральных при чётном количестве. P90: значение ceil(0,9 × n) в отсортированном ряду. Ноль учитывается; пустые/некорректные значения исключены. Таймер не продолжается. Часы не переводятся в рабочие дни.',bounds='Статус на момент сбора. Это задачи текущей выборки, не обязательно завершённые за выбранный период. У незавершённых ТТМ ещё может вырасти. При n < 10 P90 близок к максимуму и неустойчив. Дольше P90 — относительно этой выборки, не нарушение SLA.';
    return [{id:'ttm-summary',title:'ТТМ разработки',paragraphs:[scope,method,bounds],headers:['Состояние','С полем / задач','Типичная длительность, ч','У 90% не больше, ч'],rows:[{poolKey:pool('ТТМ · '+current.label,s.ids),values:[current.label,`${s.n} / ${s.total}`,fmt(s.median),fmt(s.p90)]}]},
      {id:'ttm-coverage',title:'ТТМ · полнота данных',paragraphs:[scope,'Отсутствие поля не означает нулевую длительность. Нулевые значения отдельно показаны и входят в расчёт.'],headers:['Показатель','Задач'],rows:[{values:['Без поля',String(s.missing)]},{values:['Некорректное поле',String(s.invalid)]},{values:['Нулевой ТТМ',String(s.zero)]},{poolKey:pool('ТТМ · дольше P90',s.tail),values:['Дольше P90',String(s.tail.length)]}]},
      {id:'ttm-groups',title:'ТТМ · сравнение по '+({type:'типам задач',team:'командам',release:'релизам'}[current.group]),paragraphs:[scope,'Сравнивайте похожие задачи. '+(current.overlap?'Одна задача может входить в несколько групп; общий итог рассчитан по уникальным задачам.':'Каждая задача входит в один тип.'),'P90 не норматив; малая выборка отмечена отдельно.'],headers:['Группа','С полем / задач','Медиана, ч','P90, ч','Надёжность выборки'],rows:current.groups.map(g=>({poolKey:pool('ТТМ · '+g.name,g.ids),values:[g.name,`${g.n} / ${g.total}`,fmt(g.median),fmt(g.p90),g.n<10?'Мало данных · '+g.n:'Задач: '+g.n]}))}];
  }
  function chart(current){const rows=current.groups.filter(g=>g.n).sort((a,b)=>b.median-a.median).map(g=>({label:g.name,values:[{value:g.median,color:'#7356c3'}]}));return {type:'bars',title:'ТТМ · медиана по группам',unit:'ч',note:current.label+' · типичная накопленная длительность; P90 и покрытие — в таблице. Не трудозатраты и не SLA.',allRows:rows,rows:rows.slice(0,8)};}
  const api={create,view,stats,sections,chart,labels};root.YouTrackTtm=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
