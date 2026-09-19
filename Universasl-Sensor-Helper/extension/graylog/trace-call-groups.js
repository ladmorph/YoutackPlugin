// Full trace presentation helpers. No network and no changes to the trace model.
function traceCallGroupTitle(group){return group.kind==='scheduler'?`ШЕДУЛЕР · ${group.count} ветвей`:`ОДИНАКОВЫЕ ВЫЗОВЫ × ${group.count}`;}
function expandTraceCallGroups(){
  const collapsed=traceInteractionModel?.callGroups?.filter(g=>g.collapsed)||[];
  if(!collapsed.length)return false;
  collapsed.forEach(g=>traceExpandedCallGroups.add(g.id));
  renderTrace(traceCallGroupDiagram,{preserveLocalFilters:true});return true;
}
function renderTraceCallGroups(model){
  for(const [items,elements] of [[model.positions,model.cardElements],[model.subcalls,model.subcallElements]])items.forEach((box,index)=>{
    const el=elements[index];if(!el)return;
    if(box.foldHidden){el.hidden=true;el.classList.add('trace-call-hidden');return;}
    if(box.schedulerNames&&!box.foldGroup){const badge=document.createElement('span');badge.className='trace-scheduler-badge';badge.textContent='ШЕДУЛЕР · '+box.schedulerNames.join(' · ');el.classList.add('trace-scheduler-card');el.prepend(badge);}
    const group=box.foldGroup;if(!group)return;
    el.classList.add('trace-call-group',group.collapsed?'trace-call-group-closed':'trace-call-group-open');el.dataset.callGroup=group.kind;
    const button=document.createElement('button');button.type='button';button.className='trace-call-group-toggle';button.setAttribute('aria-expanded',String(!group.collapsed));
    button.textContent=`${group.collapsed?'＋':'−'} ${traceCallGroupTitle(group)} · ${group.collapsed?'Развернуть':'Свернуть'}`;
    button.title=group.kind==='scheduler'?'job-name указан в логах. Сгруппированы связанные ветви; новые причинные связи не добавлены.':'Один источник, семейство, метод, точный URI до маскирования и результат. Время и span различаются; равенство body не проверяется.';
    button.addEventListener('pointerdown',event=>event.stopPropagation());button.addEventListener('keydown',event=>event.stopPropagation());
    button.addEventListener('click',event=>{event.stopPropagation();if(group.collapsed)traceExpandedCallGroups.add(group.id);else traceExpandedCallGroups.delete(group.id);renderTrace(traceCallGroupDiagram,{preserveLocalFilters:true});
      const next=[...traceInteractionModel.positions,...traceInteractionModel.subcalls].find(b=>b.foldGroup?.id===group.id);
      const target=[...traceInteractionModel.cardElements,...traceInteractionModel.subcallElements].find(e=>e?.dataset.groupId===group.id);target?.querySelector('button')?.focus({preventScroll:true});if(next&&target)showTraceSource(target);
    });
    el.dataset.groupId=group.id;
    if(group.collapsed){el.replaceChildren();const title=document.createElement('strong');title.className='trace-call-group-target';title.textContent=group.title;title.title=group.title;
      const note=document.createElement('p');note.className='trace-call-group-note';note.textContent=`${group.members.length} блоков сохранено${group.errors?` · с ошибками: ${group.errors}`:''}. Разверните для времени, шагов и деталей.`;
      if(group.errors)el.classList.add('trace-call-group-errors');el.append(title,note);
    }
    el.prepend(button);
  });
  let controls=document.querySelector('#trace-call-group-controls');
  if(!controls){controls=document.createElement('div');controls.id='trace-call-group-controls';controls.className='trace-call-group-controls';document.querySelector('#trace-local-tools')?.prepend(controls);}
  controls.replaceChildren();
  const jobs=traceCallGroupDiagram?.schedulerJobs||[];
  controls.hidden=!model.callGroups.length&&!jobs.length;
  if(jobs.length){const badge=document.createElement('span');badge.className='trace-scheduler-context';badge.textContent='Шедулер · '+jobs.join(' · ');badge.title='job-name в загруженном trace. Группы строятся только для связанных ветвей; само совпадение имени не создаёт стрелку.';controls.append(badge);}
  if(model.callGroups.length){const hint=document.createElement('span');hint.textContent=`Группы: ${model.callGroups.length} · данные и шаги сохранены`;controls.append(hint);
    for(const [label,open] of [['Развернуть группы',true],['Свернуть группы',false]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>{for(const g of model.callGroups)open?traceExpandedCallGroups.add(g.id):traceExpandedCallGroups.delete(g.id);if(!open){tracePage.localSearch.value='';tracePage.localMode.value='all';}renderTrace(traceCallGroupDiagram,{preserveLocalFilters:true});});controls.append(b);}
  }
}
function paintTraceCallGroup(context,box){
  const group=box.foldGroup||(box.schedulerNames?{kind:'scheduler',count:0,title:box.schedulerNames.join(' · '),collapsed:false}:null);if(!group)return false;
  context.save();context.setLineDash([]);context.textAlign='left';context.fillStyle='#142e3b';context.strokeStyle=group.errors?'#ef8993':'#57c5cf';context.lineWidth=2;
  roundedRect(context,box.x,box.y,box.width,group.collapsed?box.height:56,10);context.fill();context.stroke();context.fillStyle='#ddf8fb';context.font='700 13px system-ui';canvasText(context,traceCallGroupTitle(group),box.x+14,box.y+25,box.width-28);
  context.font='12px system-ui';context.fillStyle='#bfdee7';canvasText(context,group.title,box.x+14,box.y+48,box.width-28);
  if(group.collapsed){canvasText(context,`${group.members.length} блоков сохранено · ошибки: ${group.errors}`,box.x+14,box.y+90,box.width-28);canvasText(context,'Группа свёрнута',box.x+14,box.y+117,box.width-28);}
  context.restore();return group.collapsed;
}
