(function(root) {
  'use strict';
  const PAGE = 500, ISSUE_PAGE = 500, ISSUE_FIRST_PAGE = 500, LIMIT = 20000;
  const SUPPORTED_PROJECT='ОМП. Backend';
  const supportsProject=project=>String(project?.name||'').normalize('NFKC').trim().toLocaleLowerCase('ru')===SUPPORTED_PROJECT.toLocaleLowerCase('ru');
  const CUSTOM_FIELDS = ['Статус','Оценка разработка','Факт разработка','Оценка тестирование','Факт тестирование','Оценка общая','Факт общая','Возврат из тестирования','Количество багов','Перенос из релиза','ТТМ. Разработка','Релиз','Бизнес релиз','Компонент','Бизнес стек','Приоритет','Тип'];
  const ISSUE_FIELDS = 'id,idReadable,project(id,name,shortName),customFields(id,name,projectCustomField(field(id,name,fieldType(id,valueType))),value(id,name,login,fullName,minutes,presentation,isResolved,text))';
  const text = v => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 1000);
  const names = v => (Array.isArray(v) ? v : v == null ? [] : [v]).map(x => text(x && typeof x === 'object' ? x.name ?? x.login ?? '' : x)).filter(Boolean);
  const field = (issue, name) => issue.customFields?.find(f => f.name === name)?.value;
  const number = v => v == null || v === '' ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  const hours = v => v && typeof v === 'object' && number(v.minutes) != null ? v.minutes / 60 : null;
  const fmt = n => n == null ? 'Нет данных' : new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2}).format(n);
  const collator = new Intl.Collator('ru', {numeric:true,sensitivity:'base'});
  const DAY=86400000;
  const rulesApi=()=>root.YouTrackAdvancedRules||require('./youtrack-advanced-rules.js');
  const peopleApi=()=>root.YouTrackPeople||require('./youtrack-people.js');
  function shiftMonth(value,months){const d=new Date(value+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);}
  function maxEnd(from){return new Date(Date.parse(shiftMonth(from,3))-DAY).toISOString().slice(0,10);}
  function compareValues(a,b,direction=1) {
    const missing = v => v == null || ['', '—', 'Нет данных', 'Не указан', 'Не указано'].includes(String(v));
    if(missing(a)||missing(b))return missing(a)===missing(b)?0:missing(a)?1:-1;
    const numeric = v => {
      const s=String(v).replace(/[\s\u00a0\u202f]/g,'').replace(',','.').replace(/%$/,'');
      return /^[+-]?\d+(?:\.\d+)?$/.test(s)?Number(s):null;
    };
    const x=numeric(a),y=numeric(b);
    return (x!=null&&y!=null?x-y:collator.compare(String(a),String(b)))*direction;
  }
  function dates(from, to) {
    const valid = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
    if (!valid(from) || !valid(to) || from > to) throw Error('Укажите корректный период списаний: начало не позже конца.');
    const start=Date.parse(from),end=Date.parse(to)+86400000;
    if(to>maxEnd(from))throw Error('Выберите не больше 3 календарных месяцев списаний.');
    return [start,end];
  }
  function url(baseUrl, project, kind, skip, from, to, extraFields=[]) {
    const Q = root.YouTrackQuery || require('./youtrack-query.js');
    if (!['issues','workItems'].includes(kind) || !Number.isSafeInteger(skip) || skip < 0) throw Error('Некорректная страница отчёта');
    const base = Q.normalizeBaseUrl(baseUrl), u = new URL(base + '/api/' + kind);
    u.searchParams.set('query', Q.projectQuery(project) + (kind === 'issues' ? ' sort by: created asc' : ''));
    u.searchParams.set('$top', String((kind === 'issues' ? skip===0?ISSUE_FIRST_PAGE:ISSUE_PAGE : PAGE) + 1)); u.searchParams.set('$skip', String(skip));
    u.searchParams.set('fields', kind === 'issues' ? ISSUE_FIELDS : 'id,date,duration(minutes),author(id,login),type(name),issue(id,idReadable,project(id,name,shortName))');
    // No customFields name filter: fetch every readable custom field, with values and field types.
    if (kind === 'workItems') { dates(from,to); u.searchParams.set('startDate',from); u.searchParams.set('endDate',to); }
    return u.href;
  }
  async function collect({baseUrl, project, from, to, teams=null, rulesProfile=null, fetchPage, signal, progress = () => {}}) {
    if(!supportsProject(project)&&!teams)throw Error('Этот набор полей настроен только для проекта «'+SUPPORTED_PROJECT+'». Для других проектов используйте teams.json или обычный отчёт.');
    const [start, end] = dates(from,to); let called = false;
    const roster=teams?peopleApi().scope({issues:[],workItems:[],teams,project,from,to}).teams:null;
    const rules=rulesApi().resolve(rulesProfile||(teams?peopleApi().defaultProfile():null),project,teams);
    const result = {issues:[], workItems:[], outsidePeriod:0};
    const check = () => { if(signal?.aborted) throw new DOMException('Остановлено','AbortError'); };
    async function pause() {
      check(); await new Promise((resolve,reject) => {
        const timer = setTimeout(done,100);
        function done(){signal?.removeEventListener('abort',stop);resolve();}
        function stop(){clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(new DOMException('Остановлено','AbortError'));}
        signal?.addEventListener('abort',stop,{once:true});
      });
    }
    const globalSeen={issues:new Set(),workItems:new Set()};
    async function collectPart(kind,{authors=null,issueIds=null,label=''}={}) {
      const seen = new Set();
      for(let skip=0;;) {
        const pageSize=kind==='issues'?(skip===0?ISSUE_FIRST_PAGE:ISSUE_PAGE):PAGE;
        check(); if(called) await pause(); called = true;
        progress(`${label?label+' · ':''}${kind === 'issues' ? 'Задачи' : 'Списания'} · собрано ${globalSeen[kind].size}`);
        const request=new URL(url(baseUrl,project.shortName || project.name,kind,skip,from,to,rules?.fields||[]));
        if(authors)for(const author of authors)request.searchParams.append('author',author);
        if(issueIds){const Q=root.YouTrackQuery||require('./youtrack-query.js');request.searchParams.set('query',Q.projectQuery(project.shortName||project.name)+' issue ID: '+issueIds.join(', ')+' sort by: created asc');}
        const page = await fetchPage(request.href,signal);
        check(); if(!Array.isArray(page) || page.length > pageSize+1) throw Error('Неожиданный формат страницы YouTrack. Неполный отчёт не опубликован.');
        const more = page.length > pageSize, rows = more ? page.slice(0,pageSize) : page;
        for(const row of rows) {
          if(!row?.id || seen.has(row.id)) throw Error('Выдача изменилась или сервер повторил страницу. Повторите сбор.');
          seen.add(row.id); if(seen.size > LIMIT) throw Error('Больше 20 000 записей одного вида. Отчёт не опубликован.');
          const p = kind === 'issues' ? row.project : row.issue?.project;
          if(!p || (p.id ? p.id !== project.id : p.name !== project.name)) throw Error('Сервер вернул другой проект. Сбор остановлен.');
          if(authors&&!authors.some(a=>a.toLocaleLowerCase()===String(row.author?.login||'').toLocaleLowerCase()))throw Error('YouTrack вернул списания вне запрошенного состава команды. Неполный отчёт не опубликован.');
          if(issueIds&&!issueIds.includes(row.idReadable))throw Error('YouTrack вернул задачи вне запрошенной подборки команды. Сбор остановлен.');
          if(kind === 'workItems' && (typeof row.date !== 'number' || row.date < start || row.date >= end)) { result.outsidePeriod++; continue; }
          if(globalSeen[kind].has(row.id))continue;
          globalSeen[kind].add(row.id);if(globalSeen[kind].size>LIMIT)throw Error('Больше 20 000 записей одного вида. Отчёт не опубликован.');
          result[kind].push(row);
        }
        if(!more) break;
        if(seen.size >= LIMIT) throw Error('Достигнут предел 20 000 записей одного вида. Отчёт не опубликован.');
        skip+=pageSize;
      }
    }
    if(roster){
      // Query each team's roster on the server. Shared authors are fetched once;
      // ambiguous membership is still surfaced by the local scope validator.
      const fetchedAuthors=new Set();
      for(const team of roster){
        const authors=team.members.filter(a=>{const key=a.toLocaleLowerCase();if(fetchedAuthors.has(key))return false;fetchedAuthors.add(key);return true;});
        let part=[];for(const author of authors){
          if(typeof author!=='string'||!author.trim()||author.length>240||/[\u0000-\u001f]/.test(author))throw Error('Некорректный логин участника в teams.json.');
          if(part.length&&(part.length>=50||part.reduce((n,a)=>n+encodeURIComponent(a).length+8,0)+encodeURIComponent(author).length>4000)){await collectPart('workItems',{authors:part,label:team.name});part=[];}
          part.push(author);
        }
        if(part.length)await collectPart('workItems',{authors:part,label:team.name});
      }
      const ids=[...new Set(result.workItems.map(w=>w.issue?.idReadable))];
      if(ids.some(id=>typeof id!=='string'||id.length>256||!/^[-\p{L}\p{N}_]+-\d+$/u.test(id)))throw Error('В списаниях нет корректных номеров задач. Поля задач не собраны.');
      const links=buildPoolLinks(baseUrl,{project:project.shortName||project.name,issueIds:ids});
      for(const link of links){const part=new URL(link.url).searchParams.get('q').split(' issue ID: ')[1].split(', ');await collectPart('issues',{issueIds:part,label:'Задачи команд'});}
      const received=new Set(result.issues.map(i=>i.idReadable));
      if(ids.some(id=>!received.has(id)))throw Error('Не получены поля части задач команд. Проверьте доступ и повторите сбор; неполный отчёт не опубликован.');
      result.collection={mode:'teams',teams:roster.length,authors:fetchedAuthors.size};
    }else{
      for(const kind of ['issues','workItems'])await collectPart(kind);
      result.collection={mode:'project'};
    }
    return result;
  }
  function buildPoolLinks(baseUrl,pool) {
    if(pool?.groups){return pool.groups.flatMap(group=>buildPoolLinks(baseUrl,group).map(link=>({...link,label:group.project+' · '+link.label})));}
    const Q=root.YouTrackQuery||require('./youtrack-query.js'),base=Q.normalizeBaseUrl(baseUrl),ids=[...new Set(pool?.issueIds||[])];
    if(!ids.length||(pool.count!=null&&pool.count!==ids.length)||ids.some(id=>id.length>256||!/^[-\p{L}\p{N}_]+-\d+$/u.test(id)))return [];
    const prefix=Q.projectQuery(pool.project)+' issue ID: ',make=part=>{const u=new URL(base+'/issues');u.searchParams.set('q',prefix+part.join(', '));return u.href;};
    const parts=[];let part=[];
    for(const id of ids){if(part.length&&(part.length>=100||make([...part,id]).length>5800)){parts.push(part);part=[];}part.push(id);}
    if(part.length)parts.push(part);
    return parts.map((p,i)=>({label:parts.length===1?`Открыть подборку · ${ids.length} задач`:`Часть ${i+1} из ${parts.length} · ${p.length} задач`,url:make(p),count:p.length}));
  }
  // Default field mode. An explicitly selected profile uses its own classifier.
  function classifyWork(item,issue) {
    const normalize=v=>text(v).toLocaleLowerCase('ru').replace(/\s+/g,''),work=normalize(item?.type?.name),types=names(issue?field(issue,'Тип'):null);
    if(work==='оверы.разработка')return 'overtime';
    if(types.length!==1)return 'unknown';
    const type=normalize(types[0]);
    if(work==='встречи/проектныекоммуникации'&&type==='работы')return 'meeting';
    if(work!=='разработка')return 'unknown';
    if(type==='фича')return 'business';
    if(['техническая','техдолг'].includes(type))return 'technical';
    if(['баг','bug'].includes(type))return 'bug';
    return 'unknown';
  }
  function analyze({issues,workItems,outsidePeriod=0,project,from,to,teams=null,rulesProfile=null,collection=null}) {
    if(!supportsProject(project))throw Error('Разбор по этому набору полей доступен только для «'+SUPPORTED_PROJECT+'».');
    const [start,end]=dates(from,to),byId=new Map(),seen=new Set(),diagnostics={invalidHours:0,outsidePeriod,orphanItems:0,orphanHours:0,duplicateItems:0};
    issues=rulesApi().prepareIssues(issues,Boolean(rulesProfile));
    const scoped=peopleApi().scope({issues,workItems,teams,project,from,to}),explicitRules=Boolean(rulesProfile);
    let people=null;if(scoped){people=peopleApi().analyze(scoped,project,rulesProfile,from,to);issues=scoped.issues;workItems=scoped.workItems;teams=scoped.teams;rulesProfile=rulesProfile||peopleApi().defaultProfile();}
    const rules=rulesApi().resolve(rulesProfile,project,teams),typeField=rules?.classification.issueType.fieldName||'Тип',estimateField=rules?.classification.estimateFieldName||'Оценка разработка',actualField=rules?.actualFieldName||'Факт разработка';
    for(const i of issues)if(i?.id&&!byId.has(i.id))byId.set(i.id,{...i,periodHours:0});
    const teamHours=new Map(),teamList=(teams||[]).filter(t=>t.projectName===project.name||t.projectName===project.shortName);let totalHours=0,validItems=0;
    const categoryLabels={business:'Бизнес',technical:'Технические',bug:'Баги',meeting:'Встречи',overtime:'Овертайм',unknown:'Не классифицировано'};
    if(rules)Object.assign(categoryLabels,rules.classification.labels);
    const categoryStats=new Map(Object.keys(categoryLabels).map(key=>[key,{hours:0,items:0,issues:new Map(),orphanHours:0}])),unknownTypes=new Map(),daily=new Map();
    for(let t=start;t<end;t+=DAY){const date=new Date(t).toISOString().slice(0,10);daily.set(date,{date,hours:0,items:0,categories:Object.fromEntries(Object.keys(categoryLabels).map(k=>[k,{hours:0,items:0}]))});}
    for(const w of workItems){
      if(seen.has(w.id)){diagnostics.duplicateItems++;continue;}seen.add(w.id);
      if(typeof w.date!=='number'||w.date<start||w.date>=end){diagnostics.outsidePeriod++;continue;}
      const h=hours(w.duration);if(h==null){diagnostics.invalidHours++;continue;}totalHours+=h;validItems++;
      const i=byId.get(w.issue?.id);if(i)i.periodHours+=h;else{diagnostics.orphanItems++;diagnostics.orphanHours+=h;}
      const category=rules?rules.classify(w,i):classifyWork(w,i),bucket=categoryStats.get(category);bucket.hours+=h;bucket.items++;if(i)bucket.issues.set(i.id,i);else bucket.orphanHours+=h;
      const day=daily.get(new Date(w.date).toISOString().slice(0,10));day.hours+=h;day.items++;day.categories[category].hours+=h;day.categories[category].items++;
      if(category==='unknown'){
        const workLabel=text(w.type?.name)||'Нет типа списания',issueLabel=i?(names(field(i,typeField)).join(', ')||'Нет типа задачи'):'Нет задачи в снимке',key=JSON.stringify([workLabel,issueLabel]);
        if(!unknownTypes.has(key))unknownTypes.set(key,{workLabel,issueLabel,hours:0,items:0,issues:new Map()});
        const unknown=unknownTypes.get(key);unknown.hours+=h;unknown.items++;if(i)unknown.issues.set(i.id,i);
      }
      if(teams){const login=String(w.author?.login||'').toLowerCase(),matches=teamList.filter(t=>login&&(t.members||[]).some(m=>String(m).toLowerCase()===login));const key=matches.length===1?matches[0].name:matches.length?'Несколько команд — не распределено':'Без команды';teamHours.set(key,(teamHours.get(key)||0)+h);}
    }
    const rows=[...byId.values()],sections=[],charts=[],pools={},findings=[];
    const present=v=>v!=null&&v!==''&&(!Array.isArray(v)||v.length>0),state=i=>rules?rules.state(i):typeof field(i,'Статус')?.isResolved==='boolean'?field(i,'Статус').isResolved:null;
    const closed=rows.filter(i=>state(i)===true),open=rows.filter(i=>state(i)===false),unknown=rows.filter(i=>state(i)===null);
    const pool=(label,items)=>{if(!items.length)return null;const key='p'+Object.keys(pools).length,unique=[...new Map(items.map(i=>[i.id,i])).values()];pools[key]={label,count:unique.length,project:project.shortName||project.name,issueIds:unique.map(i=>i.idReadable).filter(Boolean)};return key;};
    const add=(title,paragraphs,headers,items)=>sections.push({title,paragraphs,headers,rows:items}),sum=(items,get)=>items.reduce((n,i)=>n+get(i),0);
    // Task purpose and work activity are independent dimensions. All valid
    // work hours participate here, not only development as in legacy stats.
    const normType=v=>text(v).normalize('NFKC').trim().toLocaleLowerCase('ru').replace(/\s+/g,'');
    const taskGroups=[['Бизнес · Фича',['фича']],['Технические · Техдолг',['техдолг','техническая']],['Баги',['баг','bug']],['Анализ',['анализ']],['QA',['qa']],['Работы',['работы']],['Тип не определён',[]]].map(([label,values])=>({label,values,hours:0,items:[],count:0}));
    for(const i of rows){const values=names(field(i,typeField));const group=values.length===1?taskGroups.find(g=>g.values.includes(normType(values[0])))||taskGroups.at(-1):taskGroups.at(-1);group.items.push(i);group.hours+=i.periodHours;}
    taskGroups.at(-1).hours+=diagnostics.orphanHours;
    add('Типы задач · все списания периода',[`Тип задачи берётся из «${typeField}» (в стандартном режиме принимаются Тип и Type). Фича — бизнес, Техдолг/Техническая — технические, Баг/Bug — баги; Анализ, QA и Работы — самостоятельные типы. В каждом типе учитываются все виды списаний.`,`Это назначение задачи, а не вид выполненной работы. Разработка, анализ, тестирование, встречи и овертайм показаны отдельно по workItem.type. Часы двух разрезов нельзя складывать. При конфликте Type/Тип категория не угадывается.`],['Тип задачи','Списано, ч','Доля часов','Задач'],taskGroups.map(g=>({poolKey:pool('Тип задач · '+g.label,g.items),values:[g.label,fmt(g.hours),totalHours?fmt(g.hours/totalHours*100)+'%':'Нет данных',String(g.items.length)]})));
    sections.at(-1).id='task-type-breakdown';
    const activityGroups=new Map(),activitySeen=new Set();
    for(const w of workItems){if(activitySeen.has(w.id)||typeof w.date!=='number'||w.date<start||w.date>=end||hours(w.duration)==null)continue;activitySeen.add(w.id);const name=text(w.type?.name).trim()||'Вид работы не указан',key=normType(name);if(!activityGroups.has(key))activityGroups.set(key,{name,hours:0,issues:new Map()});const g=activityGroups.get(key);g.hours+=hours(w.duration);const i=byId.get(w.issue?.id);if(i)g.issues.set(i.id,i);}
    add('Виды списаний · отдельно от типов задач',['Точные названия workItem.type. Анализ, разработка и тестирование не объединяются. Для каждой записи учитываются её часы один раз.'],['Вид работы','Списано, ч','Доля часов','Задач'],[...activityGroups.values()].sort((a,b)=>b.hours-a.hours).map(g=>({poolKey:pool('Вид работы · '+g.name,[...g.issues.values()]),values:[g.name,fmt(g.hours),totalHours?fmt(g.hours/totalHours*100)+'%':'Нет данных',String(g.issues.size)]})));
    sections.at(-1).id='activity-breakdown';
    const unclassified=categoryStats.get('unknown');
    add('Структура списаний · по полям',[
      `Источник — тип записи work item и текущее поле «Тип» задачи из API. config.json не используется. Классифицировано ${fmt(totalHours-unclassified.hours)} из ${fmt(totalHours)} ч периода; остаток ${fmt(unclassified.hours)} ч не распределён по догадке.`,
      'Правила: «Разработка» + «Фича» → бизнес; + «Техническая» или «Техдолг» → технические; + «Баг» или «Bug» → баги. «Встречи/Проектные коммуникации» + «Работы» → встречи. «Оверы. Разработка» → овертайм независимо от типа задачи. Регистр и пробелы не влияют; прочие значения остаются не классифицированными.',
      'Категории списаний не пересекаются: часы можно складывать. Доля = часы категории / все корректные часы периода. Одна задача может иметь разные виды списаний и входить в несколько подборок; числа задач не складываются. Тип задачи взят на момент сбора, история его изменений не запрашивается.'
    ],['Категория','Списано, ч','Доля часов','Записей','Задач в снимке','Без задачи, ч'],[...categoryStats].map(([key,x])=>({poolKey:pool('Списания · '+categoryLabels[key],[...x.issues.values()]),values:[categoryLabels[key],fmt(x.hours),totalHours>0?fmt(x.hours/totalHours*100)+'%':'Нет данных',String(x.items),String(x.issues.size),fmt(x.orphanHours)]})));
    sections.at(-1).id='category-breakdown';
    if(validItems){const allRows=[...categoryStats].filter(([,x])=>x.items).map(([key,x])=>({label:categoryLabels[key],values:[{value:x.hours,color:key==='unknown'?'#78869b':'#7356c3'}]}));charts.push({type:'bars',title:'Структура списаний · по полям',unit:'ч',note:'Непересекающиеся категории work items выбранного периода. Не классифицированные часы сохранены в общем итоге.',allRows,rows:allRows});}
    if(unknownTypes.size){
      const sorted=[...unknownTypes.values()].sort((a,b)=>b.hours-a.hours||b.items-a.items||collator.compare(a.workLabel,b.workLabel)),unknownRows=sorted.slice(0,5).map(x=>({poolKey:pool('Не классифицировано · '+x.workLabel+' / '+x.issueLabel,[...x.issues.values()]),values:[x.workLabel,x.issueLabel,String(x.items),fmt(x.hours)]}));
      if(sorted.length>5)unknownRows.push({values:[`Остальные ${sorted.length-5} сочетаний`,'—',String(sum(sorted.slice(5),x=>x.items)),fmt(sum(sorted.slice(5),x=>x.hours))]});
      add('Какие типы не распознаны',['Первые 5 сочетаний по часам. Значения приведены как получены из API; неизвестные названия не считаются ни бизнесом, ни багами. Для проверки подборка содержит задачи с такими списаниями, а не все их списания.'],['Тип списания','Тип задачи','Записей','Часы'],unknownRows);
      sections.at(-1).id='unclassified-types';
    }
    const finding=(title,message,items,tone='attention')=>{if(items.length&&findings.length<4)findings.push({title,text:message,count:items.length,poolKey:pool(title,items),tone});};
    const comparable=(items,e,a)=>items.filter(i=>hours(field(i,e))>0&&hours(field(i,a))!=null),planRows=[],closedOver=new Map(),openOver=new Map(),missingEstimate=new Map();
    for(const [label,e,a] of [['Разработка',estimateField,actualField],['Тестирование','Оценка тестирование','Факт тестирование'],['Общая','Оценка общая','Факт общая']]){
      for(const [status,items] of [['Закрытые',closed],['Открытые',open],['Статус не определён',unknown]]){
        if(!items.length)continue;const valid=comparable(items,e,a),estimate=sum(valid,i=>hours(field(i,e))),actual=sum(valid,i=>hours(field(i,a))),over=valid.filter(i=>hours(field(i,a))>hours(field(i,e)));
        for(const i of over)if(status==='Закрытые')closedOver.set(i.id,i);else if(status==='Открытые')openOver.set(i.id,i);
        planRows.push({poolKey:pool(label+' · '+status+' · сравнимые',valid),values:[label,status,`${valid.length} / ${items.length}`,valid.length?fmt(estimate):'Нет данных',valid.length?fmt(actual):'Нет данных',valid.length?fmt(actual-estimate):'Нет данных',estimate>0?fmt(actual/estimate*100)+'%':'Нет данных',String(over.length)]});
      }
      for(const i of rows)if(hours(field(i,a))>0&&hours(field(i,e))==null)missingEstimate.set(i.id,i);
    }
    add('План и факт',['Накопленные поля задач, не списания периода. В расчёте пары: оценка > 0, факт заполнен. Покрытие = сравнимые / задачи данного состояния. Ноль не равен пропуску. Общая оценка не складывается с этапами.','Закрытые — завершённый результат; открытые — текущие затраты, которые ещё могут вырасти. Состояние определяется по isResolved поля «Статус», без догадок по названию. Отношение = сумма факта / сумма оценок сравнимых задач.'],['Этап','Состояние','Покрытие','Оценка, ч','Факт поля, ч','Δ, ч','Факт / оценка','Выше оценки'],planRows);
    finding('Превышение у закрытых задач',`${closedOver.size} из ${closed.length} закрытых задач имеют превышение хотя бы по одному этапу с положительной оценкой и заполненным фактом. Покрытие сравнения — в таблице «План и факт».`,[...closedOver.values()]);
    finding('Открытые задачи уже выше оценки',`${openOver.size} из ${open.length} открытых задач уже превысили положительную оценку хотя бы по одному этапу. Это незавершённый факт, а не итоговая точность планирования.`,[...openOver.values()]);
    finding('Есть факт без оценки',`${missingEstimate.size} из ${rows.length} задач имеют положительный факт этапа без распознанной оценки; сравнение этих пар исключено.`,[...missingEstimate.values()]);
    const qualityRows=[],qualityIssues=new Map();
    for(const name of ['Возврат из тестирования','Количество багов','Перенос из релиза']){const filled=rows.filter(i=>Number.isSafeInteger(field(i,name))&&field(i,name)>=0),affected=filled.filter(i=>field(i,name)>0);for(const i of affected)qualityIssues.set(i.id,i);qualityRows.push({poolKey:pool(name,affected),values:[name,`${filled.length} / ${rows.length}`,String(affected.length),filled.length?fmt(sum(filled,i=>field(i,name))):'Нет данных']});}
    add('Качество и доработки',['Накопленные счётчики, не события за период. Покрытие = задачи с целым неотрицательным значением / все задачи. Пустое или некорректное значение не равно нулю.','Один дефект может быть учтён в нескольких задачах: сумма поля «Количество багов» не является числом уникальных дефектов проекта.'],['Показатель','Покрытие','Задач с признаком','Сумма поля'],qualityRows);
    finding('Возвраты, баги или переносы',`${qualityIssues.size} из ${rows.length} задач имеют положительный накопленный счётчик. В подборке каждая задача один раз; это не события выбранного периода.`,[...qualityIssues.values()],'neutral');
    if(!findings.length)findings.push({title:'Что видно по данным',text:'Выбранные проверки не обнаружили признаков. Это не подтверждение отсутствия проблем: оцените заполненность полей ниже.',count:0,tone:'neutral'});
    const T=root.YouTrackTtm||require('./youtrack-ttm.js');
    const ttm=T.create({rows,state,people,typeField,from,to}),ttmView=T.view(ttm),ttmPool=(label,ids)=>pool(label,ids.map(id=>byId.get(id)).filter(Boolean));
    sections.push(...T.sections(ttm,ttmView,fmt,ttmPool));
    if(ttmView.summary.n)charts.push(T.chart(ttmView));
    function groups(fieldName){
      if(!rows.some(i=>present(field(i,fieldName))))return;const map=new Map();let multi=false;
      for(const i of rows){const values=[...new Set(names(field(i,fieldName)))];if(values.length>1)multi=true;for(const name of values.length?values:['Не указано']){if(!map.has(name))map.set(name,[]);map.get(name).push(i);}}
      const sorted=[...map].map(([name,items])=>({name,items,count:items.length,hours:sum(items,i=>i.periodHours)})).sort((a,b)=>b.hours-a.hours||b.count-a.count||collator.compare(a.name,b.name));
      const items=sorted.slice(0,8).map(x=>({poolKey:pool(fieldName+' · '+x.name,x.items),values:[x.name,String(x.count),fmt(x.hours)]}));
      if(sorted.length>8){const rest=[...new Map(sorted.slice(8).flatMap(x=>x.items).map(i=>[i.id,i])).values()];items.push({poolKey:pool(fieldName+' · остальные группы',rest),values:[`Остальные ${sorted.length-8} групп · уникальные задачи`,String(rest.length),fmt(sum(rest,i=>i.periodHours))]});}
      add(fieldName,[`Первые 8 групп по списаниям периода. Всего групп: ${sorted.length}. ${multi?'Группы пересекаются: складывать их часы и задачи нельзя; в остатке задачи объединены без дублей.':'Каждая задача относится к одной группе.'} Общий итог проекта рассчитан по уникальным списаниям.`],['Группа','Задач','Списано, ч'],items);
      if(sorted.some(x=>x.hours>0)){const allRows=sorted.map(x=>({label:x.name,values:[{value:x.hours,color:'#7356c3'}]}));charts.push({type:'bars',title:fieldName+' · списания',note:'Группы после выбранной сортировки. Часы только за период.'+(multi?' Группы пересекаются, итоги не складываются.':''),allRows,rows:allRows.slice(0,10)});}
    }
    for(const key of ['Релиз','Бизнес релиз','Компонент','Бизнес стек','Приоритет',rules?.completion.fieldName||'Статус'])groups(key);

    const required=[...new Set([rules?.completion.fieldName||'Статус',estimateField,actualField,'Оценка тестирование','Факт тестирование','Оценка общая','Факт общая','Релиз',...(rules?.fields||[])])];
    add('Достоверность и границы',[`Текущий состав отчёта: ${rows.length} задач. Статус распознан у ${closed.length+open.length}; не определён у ${unknown.length}. Сбор не является атомарным снимком сервера.`,`Списания за ${from} — ${to}, даты UTC: ${validItems} корректных записей, ${fmt(totalHours)} ч. Без задачи в снимке: ${diagnostics.orphanItems} записей (${fmt(diagnostics.orphanHours)} ч); они включены в общий итог, но не в разрезы задач.`,`Исключены: некорректная длительность — ${diagnostics.invalidHours}, вне периода/без даты — ${diagnostics.outsidePeriod}, повторы — ${diagnostics.duplicateItems}. Поля задач относятся ко всему времени; факты полей со списаниями не складываются.`],['Поле','Заполнено','Всего задач'],required.map(k=>({values:[k,String(rows.filter(i=>present(field(i,k))).length),String(rows.length)]})));
    const totalComparable=comparable(closed,'Оценка общая','Факт общая');
    const kpis=[{label:'Задачи проекта',value:fmt(rows.length),note:`${closed.length} закрытых · ${open.length} открытых · ${unknown.length} без статуса`},{label:'Списано за период',value:fmt(totalHours)+' ч',note:`${validItems} корректных записей · UTC`},{label:'Общий план/факт · покрытие',value:closed.length?fmt(totalComparable.length/closed.length*100)+'%':'Нет данных',note:`${totalComparable.length} из ${closed.length} закрытых имеют общую оценку > 0 и факт`},{label:'Медиана ТТМ разработки',value:ttmView.summary.median==null?'Нет данных':fmt(ttmView.summary.median)+' ч',note:ttmView.summary.n+' из '+closed.length+' закрытых задач · накопленная длительность'}];
    if(rules){
      const c=rules.classification,categorySection=sections.find(s=>s.id==='category-breakdown');
      const rulesDescription=`Поле типа: «${typeField}». Разработка: ${c.workItemTypes.development.join(', ')||'нет значений'}; бизнес: ${c.issueType.business.join(', ')||'нет значений'}; технические: ${c.issueType.technical.join(', ')||'нет значений'}; баги: ${c.issueType.bug.join(', ')||'нет значений'}. Встречи: ${c.workItemTypes.meeting.join(', ')} + ${c.issueType.works.join(', ')}. Овертайм: ${c.workItemTypes.overtime.join(', ')} независимо от типа задачи. При пересечении приоритет: овертайм, встречи, бизнес, технические, баги. Остальное — не классифицировано.`;
      const completionDescription=`Закрытие по профилю: поле «${rules.completion.fieldName}», значения ${rules.completion.values.join(', ')||'не заданы'}${rules.completion.useResolved?'; также isResolved=true':''}. Заполненное другое значение — открытая задача; отсутствующее или неоднозначное — статус не определён.`;
      categorySection.title='Структура списаний · по профилю';categorySection.paragraphs[0]=`Состав teams.json и выбранные правила. Значения берутся из API. Классифицировано ${fmt(totalHours-unclassified.hours)} из ${fmt(totalHours)} ч; остаток сохранён отдельно.`;categorySection.paragraphs[1]=rulesDescription;
      const structureChart=charts.find(c=>c.title==='Структура списаний · по полям');if(structureChart)structureChart.title=categorySection.title;
      sections.find(s=>s.title==='План и факт').paragraphs[1]=completionDescription+` Оценка разработки — «${estimateField}», факт — «${actualField}». Тестирование и общая оценка используют штатные поля ОМП. Backend. Отношение = сумма факта / сумма оценок сравнимых задач; факты полей не заменяются списаниями периода.`;
      const business=closed.filter(rules.business),pairs=comparable(business,estimateField,actualField),within=pairs.filter(i=>hours(field(i,actualField))<=hours(field(i,estimateField)));
      add('Бизнес-задачи · правила профиля',[completionDescription,`Закрытые бизнес-задачи текущего состава отчёта, не только закрытые за период. Тип определяется по «${typeField}». «В оценке» = факт разработки ≤ оценка при оценке > 0 и заполненном факте. Используются накопленные поля, поэтому результат может отличаться от старого отчёта по списаниям. Часы команд — списания периода; ёмкость из teams.json без периода не используется как текущая доступность.`],['Показатель','Задач'],[
        {poolKey:pool('Закрытые бизнес-задачи',business),values:['Закрытые бизнес-задачи',String(business.length)]},
        {poolKey:pool('Бизнес-задачи с парой оценка / факт',pairs),values:['Сравнимая оценка / факт',String(pairs.length)]},
        {poolKey:pool('Бизнес-задачи в оценке',within),values:['В оценке',String(within.length)]},
        {poolKey:pool('Бизнес-задачи без сравнимой пары',business.filter(i=>!pairs.includes(i))),values:['Без сравнимой пары',String(business.length-pairs.length)]}
      ]);
      add('Применённые правила',[rulesDescription,completionDescription,'Правила сохранены со снимком отчёта и действуют также в динамике и выгрузках.'],['Назначение','Поле / источник'],[
        {values:['Классификация задач',typeField]},{values:['Закрытие задач',rules.completion.fieldName]},{values:['Оценка разработки',estimateField]},{values:['Факт разработки',actualField]},{values:['Команды','teams.json · участники выбранного проекта']}
      ]);
    }
    const scopeNote=people?`Состав по teams.json: ${people.teams.length} команд; только списания однозначно сопоставленных участников и ${rows.length} связанных задач. ${collection?.mode==='teams'?'На сервере запрошены участники команд и поля только связанных задач.':'Состав применён к загруженным данным.'}`:'Весь текущий проект; период ограничивает списания.';
    const detected=new Map();for(const i of rows)for(const f of i.customFields||[]){if(!f.name)continue;if(!detected.has(f.name))detected.set(f.name,{type:f.projectCustomField?.field?.fieldType?.valueType||f.$type||'Тип не передан',count:0});if(present(f.value))detected.get(f.name).count++;}
    add('Custom fields · полученные поля',['Запрашиваются все доступные customFields задач: значения и метаданные типа, без фильтра по 17 именам. Нет доступа к полю или поле отсутствует в ответе — значение не угадывается. Здесь показаны поля задач текущего состава отчёта, не каталог всех возможных значений проекта.'],['Поле','Тип','Заполнено / задач'],[...detected].sort((a,b)=>collator.compare(a[0],b[0])).map(([name,v])=>({values:[name,v.type,`${v.count} / ${rows.length}`]})));
    if(people){
      kpis[0]={label:'Команды / участники',value:`${people.teams.length} / ${people.teams.reduce((n,t)=>n+t.members.length,0)}`,note:'Состав teams.json · включая участников без списаний'};
      kpis[2]={label:'Закрытые БЗ · первый отчёт',value:String(people.teams.reduce((n,t)=>n+t.stats.closedFeatures,0)),note:'Сумма командных показателей; общая задача может входить в разные команды'};
      const format=(t,m)=>{const x=m||t,s=x.stats;return [(m?t.name+' / '+m.login:t.name),fmt(x.totalHours),...peopleApi().keys.map(k=>fmt(s[k])),fmt(x.unclassifiedHours),String(s.closedFeatures),`${s.estimateHits} / ${s.estimateTotal}`,fmt(s.estimateAveragePct),String(x.activeDays)];};
      const headers=['Команда / участник','Все часы',...peopleApi().keys.map(k=>people.labels[k]+', ч'),'Не распознано, ч','Закрытые БЗ','В оценке / сравнимых','Среднее факт/оценка, %','Дней со списаниями'];
      for(const t of people.teams){t.poolKey=pool('Команда '+t.name,t.issueIds.map(id=>byId.get(id)).filter(Boolean));for(const m of t.members)m.poolKey=pool(t.name+' / '+m.login,m.issueIds.map(id=>byId.get(id)).filter(Boolean));}
      add('Команды · показатели первого отчёта',[scopeNote,'Формулы — в разделе «Методика команд и участников».'],headers,people.teams.map(t=>({poolKey:t.poolKey,values:format(t)})));
      add('Участники · показатели первого отчёта',['Состав teams.json, включая участников без списаний. Формулы — в разделе «Методика команд и участников».'],headers,people.teams.flatMap(t=>t.members.map(m=>({poolKey:m.poolKey,values:format(t,m)}))));
      add('Методика команд и участников',[people.method],null,[]);
      const activityRows=people.teams.flatMap(t=>t.members.flatMap(m=>Object.entries(people.activities).map(([k,label])=>({poolKey:m.poolKey,values:[t.name,m.login,label,fmt(m.activities[k].hours)]}))));
      add('Участники · виды работ',['Отдельные строки для каждого workItem.type: разработка, анализ, тестирование и другие виды не смешиваются. Нули сохранены для участников состава. Вид работы и категория задачи — разные разрезы; часы этих таблиц между собой не складываются.'],['Команда','Участник','Вид работы','Часы'],activityRows);
      const activityChart=Object.entries(people.activities).map(([k,label])=>({label,values:[{value:people.teams.reduce((n,t)=>n+t.activities[k].hours,0),color:'#7356c3'}]}));charts.unshift({type:'bars',title:'Виды работ · раздельно',unit:'ч',note:'Точные виды workItem.type, без объединения анализа, разработки и тестирования.',allRows:activityChart,rows:activityChart});
      const peopleRows=people.teams.flatMap(t=>t.members.map(m=>({label:t.name+' / '+m.login,values:[{value:m.totalHours,color:'#7356c3'}]})));charts.unshift({type:'bars',title:'Списания участников',unit:'ч',note:'Только состав teams.json, включая нулевые списания. Часы не показывают свободную ёмкость.',allRows:peopleRows,rows:peopleRows.slice(0,8)});
      add('Ёмкость команд',['Бизнес-часы / заданная бизнес-ёмкость × 100%. Ёмкость из teams.json должна относиться к выбранному периоду; она не пересчитывается автоматически. Это не оценка доступности отдельного человека.'],['Команда','Бизнес, ч','Ёмкость, ч','Использовано, %'],people.teams.map(t=>({values:[t.name,fmt(t.stats.business),fmt(t.capacityHours),t.capacityHours>0?fmt(t.stats.business/t.capacityHours*100):'Нет данных']})));
      const excluded=people.excluded;add('Границы teams.json',[scopeNote,'Списания запрашиваются с фильтром author по составу каждой команды. Общий участник запрашивается один раз. Неоднозначное членство отдельно проверяется локально и исключается из итогов.'],['Причина','Записей','Часы'],[{values:['Автор вне состава',String(excluded.outsideRoster),fmt(excluded.outsideRosterHours)]},{values:['Автор в нескольких командах',String(excluded.ambiguous),fmt(excluded.ambiguousHours)]}]);
      const insights=[];for(const t of people.teams){const s=t.stats,zero=t.members.filter(m=>m.totalHours===0),over=s.estimateTotal-s.estimateHits;
        if(over)insights.push({title:t.name+' · выше оценки',text:`${over} из ${s.estimateTotal} сравнимых закрытых бизнес-задач превысили оценку по списаниям разработки. Среднее отношение — ${fmt(s.estimateAveragePct)}%. Откройте команду, чтобы увидеть участников.`,count:over,poolKey:t.poolKey,tone:'attention'});
        if(s.bug>0||s.overtime>0)insights.push({title:t.name+' · баги и овертайм',text:`Баги — ${fmt(s.bug)} ч; овертайм — ${fmt(s.overtime)} ч из ${fmt(t.totalHours)} ч. В разборе команды доступны авторы и подборки задач.`,count:0,poolKey:t.poolKey,tone:'attention'});
        if(zero.length)insights.push({title:t.name+' · нет списаний',text:`У ${zero.length} из ${t.members.length} участников нет списаний в этом периоде. Они сохранены в составе. Это повод проверить данные, а не вывод о свободном времени.`,count:zero.length,tone:'neutral'});
        if(s.estimateTotal&&!over)insights.push({title:t.name+' · оценка разработки',text:`В оценке ${s.estimateHits} из ${s.estimateTotal} сравнимых закрытых БЗ. Всего закрытых БЗ со списаниями — ${s.closedFeatures}; среднее факт/оценка — ${fmt(s.estimateAveragePct)}%. Факт ограничен списаниями периода, а не всем сроком задачи.`,count:s.estimateTotal,poolKey:t.poolKey,tone:'neutral'});
        const activityText=Object.entries(people.activities).filter(([k])=>t.activities[k].hours>0).map(([k,name])=>`${name} — ${fmt(t.activities[k].hours)} ч`).join('; ');if(activityText)insights.push({title:t.name+' · виды работ',text:activityText+'. Разрез по видам работы доступен для каждого участника и в динамике.',count:0,poolKey:t.poolKey,tone:'neutral'});
        const sorted=t.members.slice().sort((a,b)=>b.totalHours-a.totalHours);if(sorted.length>1&&sorted[0].totalHours>sorted.at(-1).totalHours)insights.push({title:t.name+' · различие списаний',text:`${sorted[0].login} — ${fmt(sorted[0].totalHours)} ч; ${sorted.at(-1).login} — ${fmt(sorted.at(-1).totalHours)} ч. Сравните виды работ и дни списаний в карточках участников; одни часы не определяют загрузку или результативность.`,count:0,tone:'neutral'});
        if(!over&&!zero.length&&!s.bug&&!s.overtime)insights.push({title:t.name+' · структура работы',text:`${fmt(t.totalHours)} ч у ${t.members.length} участников; бизнес — ${fmt(s.business)} ч, технические — ${fmt(s.technical)} ч, встречи — ${fmt(s.meeting)} ч. Закрытых БЗ — ${s.closedFeatures}, с оценкой — ${s.estimateTotal}.`,count:0,poolKey:t.poolKey,tone:'neutral'});
      }
      findings.splice(0,findings.length,...insights.slice(0,4));
    }
    const H=root.YouTrackHeatmap||require('./youtrack-heatmap.js');
    return {ttm,heatmap:H.create({people,workItems,project,from,to}),project,from,to,createdAt:Date.now(),count:rows.length,totalHours,kpis,findings,pools,sections,charts,diagnostics,people,scopeNote,fieldCount:detected.size,activityTrend:peopleApi().activityTrend(workItems,from,to),rulesMode:explicitRules?'profile':teams?'teams':'fields',typeField,trend:{from,to,categories:categoryLabels,days:[...daily.values()]}};
  }
  function trendOptions(trend){
    const [start,end]=dates(trend.from,trend.to),days=(end-start)/DAY,exclusive=new Date(end).toISOString().slice(0,10);
    const hasMonth=exclusive>=shiftMonth(trend.from,1),hasTwoMonths=exclusive>=shiftMonth(trend.from,2);
    return {days,windows:[...(days>=7?['week']:[]),...(days>=14?['fortnight']:[]),...(hasMonth?['month']:[]),...(hasTwoMonths?['two-months']:[]),'all'],grains:['day',...(days>=7?['week']:[]),...(hasTwoMonths?['month']:[])],defaultGrain:hasTwoMonths?'month':days>14?'week':'day'};
  }
  function trendView(trend,{window='all',end=trend.to,grain='day',metric='hours',category='all'}={}){
    if(!['week','fortnight','month','two-months','all'].includes(window)||!['day','week','month'].includes(grain)||!['hours','items'].includes(metric)||category!=='all'&&!Object.hasOwn(trend.categories,category))throw Error('Некорректный вид динамики');
    end=end<trend.from?trend.from:end>trend.to?trend.to:end;
    const endExclusive=new Date(Date.parse(end)+DAY).toISOString().slice(0,10);
    let start=window==='all'?trend.from:window==='week'||window==='fortnight'?new Date(Date.parse(endExclusive)-(window==='week'?7:14)*DAY).toISOString().slice(0,10):shiftMonth(endExclusive,window==='month'?-1:-2);
    const partial=start<trend.from;start=start<trend.from?trend.from:start;
    const buckets=new Map();let total=0;
    for(const day of trend.days){if(day.date<start||day.date>end)continue;let key=day.date;
      if(grain==='month')key=day.date.slice(0,7)+'-01';
      if(grain==='week'){const d=new Date(day.date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);key=d.toISOString().slice(0,10);}
      if(!buckets.has(key))buckets.set(key,{key,from:day.date,to:day.date,value:0,days:0});
      const bucket=buckets.get(key),value=(category==='all'?day:day.categories[category])[metric];bucket.to=day.date;bucket.value+=value;bucket.days++;total+=value;
    }
    const rows=[...buckets.values()].map(b=>({...b,label:b.from===b.to?b.from:b.from+' — '+b.to}));
    const nextCandidate=window==='week'||window==='fortnight'?new Date(Date.parse(end)+(window==='week'?7:14)*DAY).toISOString().slice(0,10):window==='all'?trend.to:new Date(Date.parse(shiftMonth(endExclusive,window==='month'?1:2))-DAY).toISOString().slice(0,10);
    return {from:start,to:end,partial,rows,total,unit:metric==='hours'?'ч':'записей',previousEnd:start>trend.from?new Date(Date.parse(start)-DAY).toISOString().slice(0,10):null,nextEnd:end<trend.to?(nextCandidate>trend.to?trend.to:nextCandidate):null};
  }
  const api={url,collect,analyze,dates,maxEnd,shiftMonth,trendView,trendOptions,supportsProject,SUPPORTED_PROJECT,fmt,compareValues,buildPoolLinks};root.YouTrackAdvanced=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
