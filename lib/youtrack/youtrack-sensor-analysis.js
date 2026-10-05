(function(root){
  'use strict';
  const KEYS=['business','technical','bug','overtime','meeting','other'];
  const LABELS={business:'Бизнес',technical:'Технические',bug:'Баги',overtime:'Оверы',meeting:'Встречи',other:'Без категории'};
  const COLORS={business:'#6554c0',technical:'#9c80df',bug:'#d84b66',overtime:'#cb850f',meeting:'#208c88',other:'#949aa9'};
  const blank=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
  const clean=v=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,240);
  const fmt=n=>Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:1});
  function dayOf(value){
    if(value==null||value==='')return null;
    const n=typeof value==='number'?value:typeof value==='string'&&/^\d+$/.test(value)?Number(value):Date.parse(value);
    if(!Number.isFinite(n))return null;const d=new Date(n);return Number.isFinite(d.getTime())&&d.getUTCFullYear()>=1970&&d.getUTCFullYear()<=2200?d.toISOString().slice(0,10):null;
  }
  const weekOf=day=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
  function createCollector(){
    const issues=new Map(),cells=new Map(),weeks=new Map();let count=0,totalHours=0,invalidDates=0,invalidHours=0,unmatchedHours=0,otherHours=0,omitted=0;
    function add(row){
      if(count>=100000){omitted++;return;}count++;
      const valid=typeof row.minutes==='number'&&Number.isFinite(row.minutes)&&row.minutes>=0;
      if(!valid)invalidHours++;const hours=valid?row.minutes/60:0;totalHours+=hours;
      if(!row.teamId)unmatchedHours+=hours;const category=KEYS.includes(row.category)?row.category:'other';if(category==='other')otherHours+=hours;
      const project=clean(row.project)||'Без проекта',issue=clean(row.issue)||'Без номера',id=JSON.stringify([project,clean(row.issueId)||issue]);
      let task=issues.get(id);if(!task){task={id,issue,project,hours:0,developmentHours:0,estimate:row.estimate>0?row.estimate:null,closed:row.closed,status:clean(row.status),teams:new Map(),authors:new Set(),categories:blank(),conflict:false};issues.set(id,task);}
      if(task.closed!==row.closed||task.estimate!==(row.estimate>0?row.estimate:null))task.conflict=true;
      task.hours+=hours;if(row.development)task.developmentHours+=hours;task.categories[category]+=hours;task.authors.add(clean(row.author)||'Без автора');
      const team=clean(row.teamName)||'Не сопоставлено';task.teams.set(team,(task.teams.get(team)||0)+hours);
      const day=dayOf(row.date);if(!day){invalidDates++;return;}
      const week=weekOf(day);if(!weeks.has(week))weeks.set(week,blank());weeks.get(week)[category]+=hours;
      const key=JSON.stringify([project,clean(row.teamId),clean(row.author),day]);
      if(!cells.has(key))cells.set(key,{project,teamId:clean(row.teamId),team,author:clean(row.author)||'Без автора',day,hours:0,issues:new Set()});
      const cell=cells.get(key);cell.hours+=hours;cell.issues.add(id);
    }
    function finish(){return {schema:1,count,totalHours,invalidDates,invalidHours,unmatchedHours,otherHours,omitted,issues:[...issues.values()].map(t=>({...t,teams:[...t.teams].map(([name,hours])=>({name,hours})),authors:[...t.authors]})),cells:[...cells.values()].map(c=>({...c,issues:[...c.issues]})),weeks:[...weeks].sort(([a],[b])=>a.localeCompare(b)).map(([week,values])=>({week,values}))};}
    return {add,finish};
  }
  function build(result){
    const raw=result.sensorData;if(!raw)return null;
    const tasks=raw.issues.slice().sort((a,b)=>b.hours-a.hours||a.issue.localeCompare(b.issue));
    const top=tasks.slice(0,10).map(t=>({...t,share:raw.totalHours?t.hours/raw.totalHours*100:0}));
    const risks=tasks.filter(t=>t.closed===false&&!t.conflict&&t.estimate>0&&t.developmentHours/t.estimate>=.8).map(t=>({...t,ratio:t.developmentHours/t.estimate*100})).sort((a,b)=>b.ratio-a.ratio);
    const fragmented=raw.cells.filter(c=>c.issues.length>=5).sort((a,b)=>b.issues.length-a.issues.length||a.day.localeCompare(b.day));
    const from=result.sensorContext?.from||raw.cells.map(c=>c.day).sort()[0],to=result.sensorContext?.to||raw.cells.map(c=>c.day).sort().at(-1);
    const weeks=raw.weeks.map(w=>({...w,total:KEYS.reduce((s,k)=>s+w.values[k],0),partial:Boolean(from&&w.week<from||to&&new Date(w.week+'T12:00:00Z').getTime()+6*86400000>new Date(to+'T12:00:00Z').getTime())}));
    // Include zero weeks between the selected bounds, without fabricating hours.
    if(from&&to){let at=new Date(weekOf(from)+'T12:00:00Z'),end=new Date(to+'T12:00:00Z'),n=0;const known=new Set(weeks.map(w=>w.week));while(at<=end&&n++<12000){const week=at.toISOString().slice(0,10);if(!known.has(week))weeks.push({week,values:blank(),total:0,partial:week<from||at.getTime()+6*86400000>end.getTime()});at.setUTCDate(at.getUTCDate()+7);}weeks.sort((a,b)=>a.week.localeCompare(b.week));}
    const changes=[];for(let i=1;i<weeks.length;i++){const a=weeks[i-1],b=weeks[i];if(a.partial||b.partial||!a.total||!b.total)continue;for(const key of KEYS){const delta=(b.values[key]/b.total-a.values[key]/a.total)*100;if(Math.abs(delta)>=10)changes.push({key,from:a.week,to:b.week,delta});}}
    changes.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
    const calibrated=tasks.filter(t=>t.closed===true&&!t.conflict&&t.estimate>0).map(t=>({...t,delta:t.developmentHours-t.estimate,ratio:t.developmentHours/t.estimate}));
    const groups=new Map();for(const task of calibrated){const group=task.project+' / '+(task.teams.length===1?task.teams[0].name:'Несколько команд');if(!groups.has(group))groups.set(group,[]);groups.get(group).push(task);}
    const calibration=[...groups].map(([group,list])=>{const sorted=list.map(t=>t.delta).sort((a,b)=>a-b),n=sorted.length;return {group,n,mean:sorted.reduce((s,n)=>s+n,0)/n,median:n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2,below:list.filter(t=>t.ratio<.9-1e-9).length,within:list.filter(t=>t.ratio>=.9-1e-9&&t.ratio<=1.1+1e-9).length,above:list.filter(t=>t.ratio>1.1+1e-9).length};});
    const detailOmitted=result.teams.reduce((n,t)=>n+(t.stats.detailsTruncated||0),0);
    const duplicateHours=result.diagnostics?.duplicateHours||0;
    const notes=[`Учтено уникальных записей: ${raw.count}; повторов исключено: ${result.duplicates||0} (${fmt(duplicateHours)} ч).`,
      `С командой сопоставлено ${fmt(Math.max(0,raw.totalHours-raw.unmatchedHours))} из ${fmt(raw.totalHours)} ч. Без команды: ${fmt(raw.unmatchedHours)} ч; без категории: ${fmt(raw.otherHours)} ч. Эти группы могут пересекаться.`,
      `Некорректная дата: ${raw.invalidDates}; некорректные часы: ${raw.invalidHours}. Дневные и недельные графики не включают записи без даты.`,
      `Детализация таблицы отчёта пропустила ${detailOmitted} строк по лимиту. Новые сводки Сенсора рассчитаны отдельно по ${raw.count} записям.`];
    if(raw.omitted)notes.unshift(`Анализ НЕПОЛНЫЙ: после лимита 100 000 пропущено ${raw.omitted} записей. Выводы относятся только к обработанной части.`);
    const conflicts=tasks.filter(t=>t.conflict).length;if(conflicts)notes.push(`У ${conflicts} задач различаются статус или оценка между записями. Они исключены из предупреждений о приближении к оценке.`);
    notes.push('Часы относятся к выбранной выгрузке и периоду, а не обязательно ко всей истории задачи. Статус - текущий из ответа. Дни work items показаны по UTC, неделя начинается в понедельник.');
    const summary=[];
    if(raw.omitted||raw.unmatchedHours||raw.invalidHours||raw.invalidDates)summary.push({tone:'warning',title:'Сначала проверьте полноту данных',text:`Без команды ${fmt(raw.unmatchedHours)} ч; записей с некорректной датой ${raw.invalidDates}, с некорректными часами ${raw.invalidHours}${raw.omitted?`; не обработано ${raw.omitted}`:''}.`,target:'sensor-quality'});
    if(risks.length)summary.push({tone:'warning',title:'Незакрытые задачи близки к оценке',text:`${risks.length} задач с учтённым временем разработки от 80% оценки. Проверьте остаток работы и полноту списаний.`,target:'sensor-risks'});
    if(top.length&&raw.totalHours>0){const n=Math.min(5,top.length),sum=top.slice(0,n).reduce((s,t)=>s+t.hours,0);summary.push({tone:'info',title:'Где сосредоточено время',text:`${n} задач: ${fmt(sum)} ч, ${fmt(sum/raw.totalHours*100)}% загруженных часов. Это концентрация списаний, не оценка сложности.`,target:'sensor-top'});}
    if(summary.length<3&&changes.length){const c=changes[0];summary.push({tone:'info',title:'Изменился состав списаний',text:`${LABELS[c.key]}: ${c.delta>0?'+':''}${fmt(c.delta)} п.п. доли между неделями ${c.from} и ${c.to}. Причину стоит уточнить по задачам.`,target:'sensor-weekly'});}
    if(!summary.length)summary.push({tone:'info',title:'Данных для выводов пока нет',text:'За этот период не загружены часы. Это не означает отсутствие работы.',target:'sensor-quality'});
    return {raw,top,tasks,risks,fragmented,weeks,changes,notes,calibrated,calibration,summary:summary.slice(0,3),from,to,detailOmitted};
  }
  const api={KEYS,LABELS,COLORS,createCollector,build,dayOf,weekOf,fmt};root.YouTrackSensorAnalysis=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
