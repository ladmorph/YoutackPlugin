// Read-only view of the reference result. Colors match the workbook headers.
document.addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('section');panel.id='reference-sensor-report';panel.className='panel';panel.hidden=true;
  const heading=document.createElement('h2');heading.textContent='Отчёт Сенсора';const note=document.createElement('p');note.textContent='Показатели рассчитанного отчёта. Цвета кружков повторяют заголовки Excel: жёлтый — ёмкость и выполненные БЗ, розовый — утилизация.';
  const content=document.createElement('div');content.id='reference-sensor-content';
  const controls=document.createElement('div');controls.className='sensor-controls';
  const toggle=document.createElement('button');toggle.type='button';toggle.textContent='Свернуть отчёт';toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-controls',content.id);
  toggle.onclick=()=>{content.hidden=!content.hidden;note.hidden=content.hidden;toggle.textContent=content.hidden?'Развернуть отчёт':'Свернуть отчёт';toggle.setAttribute('aria-expanded',String(!content.hidden));};
  controls.append(toggle);
  for(const [label,open] of [['Развернуть все команды',true],['Свернуть все команды',false]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>{if(content.hidden)toggle.click();content.querySelectorAll('details').forEach(d=>{d.open=open;});};controls.append(button);}
  panel.append(heading,controls,note,content);document.getElementById('chartPanel').after(panel);
  const number=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(v);
  function metric(title,value,tone,text,action){const card=document.createElement('article');card.className='sensor-metric';const circle=document.createElement('span');circle.className='sensor-metric-circle '+tone;circle.textContent=value;const h=document.createElement('h4');h.textContent=title;const p=document.createElement('p');p.textContent=text;card.append(circle,h,p);if(action){const button=document.createElement('button');button.type='button';button.className='export-btn';button.textContent='Подробнее';button.addEventListener('click',action);card.append(button);}return card;}
  function render(){
    if(typeof lastComputed==='undefined'||!lastComputed){panel.hidden=true;return;}panel.hidden=false;
    const expanded=new Map([...content.querySelectorAll('details')].map(e=>[e.dataset.team,e.open]));content.replaceChildren();
    for(const project of lastComputed.projectNames){const block=document.createElement('section');block.className='sensor-project';const title=document.createElement('h3');title.textContent=project;block.append(title);
      for(const team of lastComputed.teams.filter(t=>lastComputed.teamToProject[t]===project)){
        const stats=lastComputed.teamStats[team],capacity=capacityStore[team]||0,total=stats.biz+stats.tech+stats.bug+stats.overs+stats.meeting;
        const detail=document.createElement('details');detail.dataset.team=team;detail.open=expanded.get(team)??true;const summary=document.createElement('summary');summary.textContent=`${team} · ${number(total)} ч · выполнено БЗ: ${stats.featureIssueIds.size}`;
        const grid=document.createElement('div');grid.className='sensor-metric-grid';
        const teamToggle=document.createElement('button');teamToggle.type='button';teamToggle.className='sensor-team-toggle';
        const sync=()=>{teamToggle.textContent=detail.open?'Свернуть':'Развернуть';teamToggle.setAttribute('aria-expanded',String(detail.open));teamToggle.setAttribute('aria-label',`${teamToggle.textContent} команду ${team}`);};
        teamToggle.onclick=event=>{event.preventDefault();event.stopPropagation();detail.open=!detail.open;sync();};detail.addEventListener('toggle',sync);sync();summary.append(teamToggle);
        grid.append(metric('Бизнес-ёмкость',capacity>0?number(capacity)+' ч':'—','yellow','Плановая ёмкость из настроек команды. Нулевое значение означает, что ёмкость не задана.'),metric('Выполнено БЗ',String(stats.featureIssueIds.size),'yellow','Уникальные бизнес-задачи с разработкой в выборке и статусом из правил закрытия.',()=>showClosedBreakdown(team)));
        for(const key of ['biz','tech','bug','overs','meeting'])grid.append(metric(METRIC_LABELS[key],number(stats[key])+' ч','neutral','Списания, отнесённые к категории действующими правилами.',()=>showBreakdown(team,null,key)));
        grid.append(metric('Утилизация',capacity>0?number(stats.biz/capacity*100)+'%':'—','pink',capacity>0?`${number(stats.biz)} ч бизнеса / ${number(capacity)} ч ёмкости × 100%.`:'Ёмкость не задана — процент не рассчитывается.',()=>showUtilBreakdown(team)),metric('Общий факт',number(total)+' ч','neutral','Сумма бизнеса, технических работ, багов, оверов и встреч/иного.'));
        detail.append(summary,grid);block.append(detail);
      }content.append(block);
    }
  }
  let frame=0;const observer=new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;render();});});observer.observe(document.getElementById('tableContainer'),{childList:true});render();
});
