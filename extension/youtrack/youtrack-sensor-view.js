(function(root){
  'use strict';
  const A=root.YouTrackSensorAnalysis,f=A.fmt;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,fn)=>{const b=el('button',text);b.type='button';b.addEventListener('click',fn);return b;};
  function draw(model,canvas){
    const width=1100,height=model.type==='scatter'?640:Math.max(260,130+model.rows.length*36+(model.type==='heatmap'?35:0));canvas.width=width;canvas.height=height;
    const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,width,height);c.fillStyle='#27253d';c.font='bold 25px Arial';c.fillText(model.title,28,38);c.font='18px Arial';c.fillStyle='#655f78';c.fillText(model.note||'Часы в выбранной выгрузке',28,68);
    const trim=(text,max)=>{let s=String(text);while(c.measureText(s).width>max&&s.length>1)s=s.slice(0,-1);return s===String(text)?s:s.slice(0,-1)+'…';};
    if(model.type==='scatter'){
      const x0=110,y0=550,range=780,yrange=420,max=model.rows.reduce((n,r)=>Math.max(n,r.estimate,r.actual),1);
      c.strokeStyle='#d9d6e2';for(const t of [0,.25,.5,.75,1]){const x=x0+t*range,y=y0-t*yrange;c.beginPath();c.moveTo(x,120);c.lineTo(x,y0);c.moveTo(x0,y);c.lineTo(x0+range,y);c.stroke();c.fillStyle='#655f78';c.fillText(f(max*t),x-10,y0+25);c.fillText(f(max*t),35,y+5);}
      c.strokeStyle='#8f82b5';c.setLineDash([7,5]);c.beginPath();c.moveTo(x0,y0);c.lineTo(x0+range,130);c.stroke();c.setLineDash([]);
      for(const r of model.rows){c.fillStyle=r.actual>r.estimate*1.1?'#bc475d':r.actual<r.estimate*.9?'#24877d':'#7356c3';c.globalAlpha=.65;c.beginPath();c.arc(x0+r.estimate/max*range,y0-r.actual/max*yrange,5,0,Math.PI*2);c.fill();}c.globalAlpha=1;c.fillStyle='#494257';c.fillText('Оценка, ч →',450,605);c.fillText('Факт разработки, ч',35,102);return;
    }
    const x0=290,plot=700;
    if(model.type==='heatmap'){
      const cw=plot/Math.max(1,model.days.length),max=Math.max(1,...model.rows.flatMap(r=>r.values));
      c.font='18px Arial';model.days.forEach((d,i)=>c.fillText(d.slice(8),x0+i*cw+10,100));
      model.rows.forEach((r,i)=>{const y=115+i*36;c.fillStyle='#423a53';c.fillText(trim(r.label,245),28,y+20);r.values.forEach((v,j)=>{const alpha=v>0?.15+.85*v/max:0;c.fillStyle=v>0?`rgba(101,70,185,${alpha})`:'#f0eef5';c.fillRect(x0+j*cw,y,cw-2,30);c.fillStyle=v/max>.5?'#fff':'#514466';c.fillText(v?f(v):'·',x0+j*cw+8,y+20);});});
      c.fillStyle='#655f78';c.fillText('Темнее = больше часов. Точка = нет списаний, а не отсутствие работы.',28,height-14);return;
    }
    const max=Math.max(1,...model.rows.map(r=>r.values.reduce((s,v)=>s+v.value,0)));
    c.font='18px Arial';for(const t of [0,.5,1]){c.fillStyle='#767181';c.fillText(f(t*max)+' '+(model.unit||'ч'),x0+t*plot,100);}
    model.rows.forEach((r,i)=>{const y=115+i*36;c.fillStyle='#423a53';c.fillText(trim(r.label,245),28,y+18);c.fillStyle='#f1eff6';c.fillRect(x0,y,plot,24);let x=x0;for(const v of r.values){const w=v.value/max*plot;c.fillStyle=v.color||'#7356c3';c.fillRect(x,y,w,24);x+=w;}c.fillStyle='#423a53';c.fillText(f(r.values.reduce((s,v)=>s+v.value,0)),1010,y+18);});
    if(model.rows.some(r=>r.values.length>1)){let lx=28;c.font='15px Arial';const values=model.rows[0].values;for(const v of values){c.fillStyle=v.color;c.fillRect(lx,height-18,10,10);c.fillStyle='#423a53';c.fillText(v.label||'',lx+16,height-9);lx+=Math.max(115,c.measureText(v.label||'').width+40);}}
  }
  function heatModels(model){
    const result=[],months=[...new Set(model.raw.cells.map(c=>c.day.slice(0,7)))].sort();
    for(const month of months){
      const cells=model.raw.cells.filter(c=>c.day.startsWith(month)),people=new Map();
      for(const c of cells){const key=JSON.stringify([c.project,c.team,c.author]);if(!people.has(key))people.set(key,{label:`${c.project} / ${c.team} / ${c.author}`,values:new Map()});const p=people.get(key);p.values.set(c.day,(p.values.get(c.day)||0)+c.hours);}
      const rows=[...people.values()].sort((a,b)=>a.label.localeCompare(b.label,'ru')),last=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();
      for(let day=1;day<=last;day+=14){const days=Array.from({length:Math.min(14,last-day+1)},(_,i)=>month+'-'+String(day+i).padStart(2,'0')).filter(d=>(!model.from||d>=model.from)&&(!model.to||d<=model.to));if(!days.length)continue;
        for(let start=0;start<rows.length;start+=12)result.push({type:'heatmap',title:'Карта списаний · '+month,note:`${days[0]} — ${days.at(-1)} · участники ${start+1}–${Math.min(start+12,rows.length)} из ${rows.length} · UTC`,days,rows:rows.slice(start,start+12).map(r=>({label:r.label,values:days.map(d=>r.values.get(d)||0)}))});
      }
    }return result;
  }
  function models(m,labels={}){
    const charts=[{type:'bars',title:'Топ-10 задач по часам',note:'Все типы списаний; доля и команды указаны в таблице ниже',rows:m.top.map(t=>({label:t.issue,values:[{value:t.hours,color:'#7356c3'}]}))}];
    for(let i=0;i<m.weeks.length;i+=16)charts.push({type:'stack',title:'Состав списаний по неделям',note:'Пн–вс · * неполная неделя · часы, UTC',rows:m.weeks.slice(i,i+16).map(w=>({label:w.week+(w.partial?' *':''),values:A.KEYS.map(k=>({value:w.values[k],color:A.COLORS[k],label:labels[k]||A.LABELS[k]}))}))});
    charts.push({type:'scatter',title:'Оценка и факт разработки',note:'Пунктир: факт = оценка. Красный: выше +10%; зелёный: ниже −10%; фиолетовый: ±10%.',rows:m.calibrated.map(t=>({label:t.issue,estimate:t.estimate,actual:t.developmentHours}))});
    charts.push(...heatModels(m));return charts;
  }
  function sections(m,result){
    const taskRows=list=>list.map(t=>({issue:t.issue,values:[t.issue,t.project,t.authors.join(', '),f(t.hours),t.estimate==null?'—':f(t.estimate),f(t.developmentHours),t.status||'Нет статуса']}));
    return [
      {title:'Главные выводы',paragraphs:m.summary.map(s=>s.title+'. '+s.text)},
      {title:'Полнота и правила анализа',paragraphs:m.notes},
      {title:'Топ-10 задач по часам',headers:['Задача','Проект / команды','Часы','Доля'],rows:m.top.map(t=>({issue:t.issue,values:[t.issue,t.project+' / '+t.teams.map(x=>x.name).join(', '),f(t.hours),f(t.share)+'%']}))},
      {title:'Незакрытые задачи около оценки',paragraphs:['Порог 80%: сравниваются часы разработки в выбранном периоде и текущая оценка. Это повод проверить остаток работы, а не прогноз срока.'],headers:['Задача','Проект','Факт разработки, ч','Оценка, ч','Отношение'],rows:m.risks.map(t=>({issue:t.issue,values:[t.issue,t.project,f(t.developmentHours),f(t.estimate),f(t.ratio)+'%']}))},
      {title:'Калибровка оценок',paragraphs:['Закрытые задачи с однозначными статусом и оценкой. Ниже 90%, в диапазоне 90–110%, выше 110% - взаимоисключающие группы. При n < 5 выборка мала. Факт ограничен периодом; это не оценка продуктивности команды.'],headers:['Проект / команда','n','Среднее Δ, ч','Медиана Δ, ч','<90%','±10%','>110%'],rows:m.calibration.map(g=>({values:[g.group,String(g.n),f(g.mean),f(g.median),f(g.below/g.n*100)+'%',f(g.within/g.n*100)+'%',f(g.above/g.n*100)+'%']}))},
      {title:'Изменение состава работы',paragraphs:['Сравниваются только соседние полные недели с часами в обеих. Порог изменения доли: 10 процентных пунктов.'],headers:['Категория','С недели','На неделю','Δ доли, п.п.'],rows:m.changes.map(c=>({values:[result.profile.labels[c.key]||A.LABELS[c.key],c.from,c.to,(c.delta>0?'+':'')+f(c.delta)]}))},
      {title:'Распределение по задачам за день',paragraphs:['Дни с пятью и более задачами в списаниях. Это не доказательство переключений или неэффективности.'],headers:['День UTC','Проект / команда','Участник','Задач','Часы'],rows:m.fragmented.map(c=>({values:[c.day,c.project+' / '+c.team,c.author,String(c.issues.length),f(c.hours)]}))},
      {title:'Все задачи в загруженных данных',paragraphs:['Списания агрегированы по проекту и задаче, повторные work items исключены. Оценка и статус - из загруженных записей; расхождения отмечены отдельно.'],headers:['Задача','Проект','Участники','Все часы','Оценка, ч','Разработка, ч','Статус'],rows:taskRows(m.tasks)}
    ];
  }
  function render(host,result,{issueUrl,download,onPdf}){
    document.getElementById('sensor-report-navigation')?.remove();host.replaceChildren();const m=A.build(result);if(!m)return null;
    const charts=models(m,result.profile.labels),dataSections=sections(m,result);
    const nav=el('nav',null,'sensor-section-nav');nav.setAttribute('aria-label','Группы разбора');for(const [id,label] of [['sensor-overview','Главное'],['sensor-top','Задачи и оценки'],['sensor-weekly','Время'],['sensor-quality','Полнота'],['sensor-checks','Проверки'],['project-chart-panel','Графики команд']]){const b=button(label,()=>{const target=document.getElementById(id);if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}});b.dataset.sensorJump=id;nav.append(b);}nav.id='sensor-report-navigation';const panel=host.closest('#insights-panel');if(panel)panel.before(nav);else host.prepend(nav);
    const headline=el('div',null,'sensor-headlines');headline.id='sensor-overview';
    for(const s of m.summary){const card=el('article',null,'sensor-headline '+s.tone);card.append(el('strong',s.title),el('p',s.text),button('Посмотреть',()=>document.getElementById(s.target)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})));root.YouTrackSensorHelp.attach(card,s.title,s.target==='sensor-risks'?'Число незакрытых задач с однозначной положительной оценкой и факт/оценка ≥ 80%. Факт — только разработка из выбранного периода.':s.target==='sensor-top'?'Сумма часов пяти крупнейших задач / сумма всех уникальных часов × 100%. В расчёте все категории работ; задачи не дублируются по командам.':s.target==='sensor-weekly'?'Δ = доля категории в новой полной неделе минус доля в предыдущей полной неделе, в процентных пунктах. Изменение доли не объясняет его причину.':'Счётчики пропущенных и несопоставленных записей. Данные неполны, если достигнут предел анализа; подробности в блоке полноты.');headline.append(card);}host.append(headline);
    const actions=el('div',null,'sensor-export-actions'),pdf=button('Скачать полный отчёт · PDF',()=>onPdf({model:m,charts,sections:dataSections}));pdf.id='export-sensor-pdf';pdf.className='primary';const stop=button('Отменить выгрузку',()=>root.YouTrackSensorPdf?.cancel());stop.id='stop-sensor-pdf';stop.hidden=true;const status=el('span','PDF включает все группы анализа, графики и списки задач.');status.id='sensor-export-status';status.setAttribute('role','status');actions.append(pdf,stop,status);host.append(actions);
    function section(id,title,note){const s=el('section',null,'sensor-block');s.id=id;s.append(el('h3',title),el('p',note,'sensor-block-note'));host.append(s);root.YouTrackSensorHelp.attach(s,title,id==='sensor-top'?'Часы задачи = сумма всех её уникальных work items в периоде. Доля = часы задачи / все уникальные часы × 100%. Топ отсортирован по часам; задача, над которой работали несколько команд, считается один раз.':id==='sensor-weekly'?'Каждый недельный сегмент — сумма часов категории. Доля категории = часы категории / все часы недели. Δ доли считается в процентных пунктах между соседними полными неделями с данными. Heatmap: сумма часов участника за календарный день UTC. Пять задач за день — порог для списка распределения; это не доказательство переключений.':'Повторы удалены по id work item. Полнота сопоставления = (уникальные часы − часы без команды) / уникальные часы × 100%. Без даты запись остаётся в итогах, но исключается из дневных и недельных графиков. Новые сводки не используют обрезанные details.');return s;}
    function table(parent,def){
      if(!def.rows?.length){parent.append(el('p','Подходящих записей нет.'));return;}
      const wrap=el('div',null,'sensor-data-table'),table=el('table'),head=el('thead'),tr=el('tr');for(const h of def.headers)tr.append(el('th',h));head.append(tr);table.append(head);const body=el('tbody');table.append(body);wrap.append(table);parent.append(wrap);let page=0;const controls=el('div',null,'sensor-pager'),info=el('span'),prev=button('Назад',()=>{page--;show();}),next=button('Дальше',()=>{page++;show();});controls.append(prev,info,next);parent.append(controls);
      function show(){body.replaceChildren();for(const row of def.rows.slice(page*20,(page+1)*20)){const tr=el('tr');row.values.forEach((v,i)=>{const td=el('td');if(i===0&&row.issue&&issueUrl(row.issue)){const a=el('a',v);a.href=issueUrl(row.issue);a.target='_blank';a.rel='noopener noreferrer';td.append(a);}else td.textContent=v;tr.append(td);});body.append(tr);}info.textContent=`${page*20+1}–${Math.min((page+1)*20,def.rows.length)} из ${def.rows.length}`;prev.disabled=!page;next.disabled=(page+1)*20>=def.rows.length;}show();
    }
    function chart(parent,collection){
      if(!collection.length||!collection.some(c=>c.rows.length)){parent.append(el('p','Для графика нет данных.'));return;}
      const canvas=el('canvas');canvas.setAttribute('role','img');canvas.className='sensor-canvas';const box=el('div',null,'sensor-chart-scroll');box.append(canvas);parent.append(box);root.YouTrackSensorHelp.attach(box,collection[0].title,collection[0].type==='scatter'?'X = оценка, Y = часы разработки за период для закрытой задачи. Пунктир Y = X. Среднее Δ = сумма (факт − оценка) / n; медиана Δ — середина отсортированных отклонений. Доля попаданий ±10% = число задач с 0.9 ≤ факт/оценка ≤ 1.1, делённое на n. По текущей выгрузке могут быть не все часы задачи.':collection[0].type==='heatmap'?'Ячейка = сумма часов участника за день UTC. Интенсивность нормирована на максимальное значение текущего окна; сравнивайте числа при переходе между окнами. Точка означает отсутствие списаний.':collection[0].type==='stack'?'Длина сегмента = сумма часов категории за неделю Пн–Вс. Неполные граничные недели помечены *. В сравнении долей используются только соседние полные недели с ненулевыми часами.':'Длина полосы = сумма часов уникальных work items задачи в выбранном периоде. Отбор топ-10 по убыванию суммы.');let index=0;const controls=el('div',null,'sensor-pager'),info=el('span'),prev=button('Назад',()=>{index--;show();}),next=button('Дальше',()=>{index++;show();}),save=button('Скачать PNG',()=>canvas.toBlob(blob=>{if(blob)download(blob,'sensor-'+collection[index].type+'.png');},'image/png'));
      controls.append(prev,info,next,save);parent.append(controls);function show(){const model=collection[index];draw(model,canvas);canvas.setAttribute('aria-label',model.title+'. '+model.note);info.textContent=`${index+1} / ${collection.length}`;prev.disabled=!index;next.disabled=index===collection.length-1;}show();
    }
    const tasks=section('sensor-top','Задачи и оценки','Куда ушло время и какие оценки стоит проверить.');chart(tasks,charts.filter(c=>c.type==='bars'));table(tasks,dataSections[2]);
    const risk=el('div');risk.id='sensor-risks';risk.append(el('h4',dataSections[3].title),el('p',dataSections[3].paragraphs[0]));tasks.append(risk);root.YouTrackSensorHelp.attach(risk,'Незакрытые задачи около оценки','Отношение = часы разработки в выбранном периоде / положительная оценка × 100%. Показываются значения от 80%, текущий статус не закрыт, статус и оценка не противоречат другим записям. При отсутствии статуса задача не считается открытой.');table(risk,dataSections[3]);
    tasks.append(el('h4','Калибровка оценок'),el('p',dataSections[4].paragraphs[0]));chart(tasks,charts.filter(c=>c.type==='scatter'));table(tasks,dataSections[4]);
    const time=section('sensor-weekly','Распределение времени','Состав списаний по неделям и дням. Отсутствие записей не означает отсутствие работы.');
    const legend=el('div',null,'sensor-legend');for(const k of A.KEYS){const span=el('span',(result.profile.labels[k]||A.LABELS[k]));span.style.borderColor=A.COLORS[k];legend.append(span);}time.append(legend);chart(time,charts.filter(c=>c.type==='stack'));table(time,dataSections[5]);
    time.append(el('h4','Тепловая карта · участник × день'),el('p','Листайте двухнедельные окна и группы участников. Полный PDF содержит все окна. Точные значения доступны в таблице под картой.'));chart(time,charts.filter(c=>c.type==='heatmap'));
    const dates=el('details');dates.append(el('summary','Точные значения по дням'));time.append(dates);table(dates,{headers:['Дата UTC','Проект / команда','Участник','Часы','Задач'],rows:m.raw.cells.slice().sort((a,b)=>a.day.localeCompare(b.day)).map(c=>({values:[c.day,c.project+' / '+c.team,c.author,f(c.hours),String(c.issues.length)]}))});
    time.append(el('h4',dataSections[6].title),el('p',dataSections[6].paragraphs[0]));table(time,dataSections[6]);
    const quality=section('sensor-quality','Полнота данных','На какой объём опираются выводы.');for(const note of m.notes)quality.append(el('p',note));
    const all=el('details');all.className='sensor-block';all.append(el('summary','Все задачи в загруженных данных'));host.append(all);root.YouTrackSensorHelp.attach(all,'Все задачи','Одна строка на комбинацию проект + id задачи. Все часы включают любые типы списаний; часы разработки отбираются по правилам профиля. Оценка и статус берутся из записей задачи. При расхождении они исключаются из калибровки и рисков, но часы сохраняются.');table(all,dataSections[7]);
    return {model:m,charts,sections:dataSections};
  }
  root.YouTrackSensorView={render,draw,models,sections};
})(globalThis);
