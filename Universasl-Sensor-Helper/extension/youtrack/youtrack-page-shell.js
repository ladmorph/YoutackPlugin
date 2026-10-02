// Shared presentation and onboarding; no report data or requests.
(() => {
  'use strict';
  const fields=location.pathname.endsWith('youtrack-fields.html');
  const network=location.pathname.endsWith('youtrack-network.html');
  const cdr=location.pathname.endsWith('youtrack-cdr.html');
  document.addEventListener('DOMContentLoaded',()=>{
    const header=document.createElement('header');header.className='youtrack-shared-header';
    header.innerHTML='<div><span>UNIVERSASL SENSOR HELPER</span><h1>+ YouTrack</h1><p>Отчёты по работе команд</p></div>';
    if(!fields&&!network&&!cdr){const help=document.createElement('button');help.id='reference-onboarding-start';help.type='button';help.textContent='? Как здесь работать';help.addEventListener('click',startTour);header.append(help);}
    document.body.prepend(header);
    if(fields){
      const nav=document.createElement('nav');nav.className='reference-nav';nav.setAttribute('aria-label','Разделы YouTrack');
      nav.innerHTML='<a href="youtrack.html">Отчёт</a><a href="youtrack-fields.html" aria-current="page">Дополнительно · по полям</a><button type="button">Network и запросы</button>';
      nav.querySelector('button').dataset.youtrackView='network';header.after(nav);
      const status=document.getElementById('connection-state');if(status)header.append(status);
      document.getElementById('tab-report').textContent='Настройка';
    }
    document.body.classList.add('youtrack-shared-page');
    document.getElementById('reference-network-toggle')?.setAttribute('data-youtrack-view','network');
    document.querySelectorAll('.reference-nav').forEach(nav=>{if(nav.querySelector('a[href="youtrack-cdr.html"]'))return;const link=document.createElement('a');link.href='youtrack-cdr.html';link.textContent='ЦДР';if(cdr)link.setAttribute('aria-current','page');nav.insertBefore(link,nav.querySelector('button'));});
    document.querySelectorAll('.reference-nav a').forEach(a=>{const file=a.getAttribute('href');if(file==='youtrack-cdr.html')return;a.dataset.youtrackView=file==='youtrack.html'?'report':file==='youtrack-fields.html'?'fields':'network';});
    document.querySelectorAll('[data-youtrack-view="fields"]').forEach(a=>{a.removeAttribute('href');a.removeAttribute('data-youtrack-view');a.setAttribute('aria-disabled','true');a.setAttribute('tabindex','-1');a.title='Отчёт по полям временно недоступен';});
    document.addEventListener('click',event=>{const control=event.target.closest('[data-youtrack-view]');if(!control)return;event.preventDefault();chrome.runtime.sendMessage({type:'open-youtrack-view',view:control.dataset.youtrackView});});
    // Hide the fixed calendar on page/ancestor scrolling, but allow its own scrolling.
    const dismiss=()=>window.YouTrackReferenceCalendar?.close();
    document.addEventListener('scroll',e=>{if(!e.target?.closest?.('.yt-cal-popup'))dismiss();},{capture:true,passive:true});
    window.addEventListener('resize',dismiss,{passive:true});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')dismiss();});
    const observer=new MutationObserver(()=>{
      const popup=document.querySelector('.yt-cal-popup');if(!popup||popup.dataset.positioned)return;
      popup.dataset.positioned='true';requestAnimationFrame(()=>{
        const button=document.getElementById(popup.dataset.forBtn);if(!button||!popup.isConnected)return;
        const a=button.getBoundingClientRect(),r=popup.getBoundingClientRect();
        popup.style.left=Math.max(8,Math.min(a.left,innerWidth-r.width-8))+'px';
        popup.style.top=Math.max(8,Math.min(a.bottom+6,innerHeight-r.height-8))+'px';
      });
    });
    buildRail();
    observer.observe(document.body,{childList:true});
  });

  // Разделы живут в левой панели, которую можно скрыть. Состояние запоминается
  // в этом браузере, поэтому выбор сохраняется между страницами и заходами.
  function buildRail(){
    const nav=document.querySelector('.reference-nav');
    if(!nav||document.getElementById('youtrack-rail'))return;
    const rail=document.createElement('aside');rail.id='youtrack-rail';rail.setAttribute('aria-label','Разделы YouTrack');
    rail.innerHTML='<div class="rail-head"><span class="rail-title">Разделы</span><button type="button" class="rail-collapse" aria-label="Скрыть панель разделов" title="Скрыть панель разделов">\u2039</button></div>';
    nav.before(rail);rail.append(nav);
    const open=document.createElement('button');open.type='button';open.id='youtrack-rail-open';open.setAttribute('aria-label','Показать панель разделов');open.title='Показать панель разделов';open.textContent='\u2261';document.body.append(open);
    const KEY='youtrackRailHidden';
    const apply=hidden=>{
      document.body.classList.toggle('rail-hidden',hidden);
      document.body.classList.add('with-rail');
      rail.setAttribute('aria-hidden',String(hidden));
      try{localStorage.setItem(KEY,hidden?'1':'0');}catch{}
    };
    rail.querySelector('.rail-collapse').onclick=()=>{apply(true);open.focus({preventScroll:true});};
    // Панель закрывают только клик по пустому месту и Esc; переход в раздел её оставляет открытой.
    document.addEventListener('pointerdown',event=>{
      if(document.body.classList.contains('rail-hidden'))return;
      if(event.target.closest('#youtrack-rail')||event.target.closest('#youtrack-rail-open'))return;
      apply(true);
    },true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.body.classList.contains('rail-hidden'))apply(true);});
    open.onclick=()=>{apply(false);rail.querySelector('.rail-collapse').focus({preventScroll:true});};
    // По умолчанию панель скрыта: показывается только по кнопке.
    let hidden=true;try{hidden=localStorage.getItem(KEY)!=='0';}catch{}
    apply(hidden);
  }
  function startTour(){
    if(document.getElementById('reference-onboarding'))return;
    const steps=[['Подключение','Сессия берётся из штатного запроса YouTrack в двух случаях: вы открыли отчёт иконкой расширения на вкладке YouTrack или нажали «Обновить подключение». Простое открытие этой страницы токен не получает.','#ytCaptureBtn'],['Проекты и период','Выберите проекты и даты, затем нажмите «Загрузить». Этот шаг получает списания. Сам отчёт ещё не строится.','#ytFetchPanel'],['Команды и правила','Создайте пресет: загрузите свой teams.json и при необходимости config.json. teams.json задаёт команды, участников и ёмкости; config.json — правила расчёта. Личных данных в поставке нет.','#ytPresetsPanel'],['Построение и экспорт','Нажмите «Применить пресет и построить отчёт». В таблице можно раскрывать команды и детализацию показателей, выгружать сводку и детализацию в Excel. Network показывает запросы и статус получения токена.','#ytApplyPresetBtn']];
    let index=0;const dialog=document.createElement('dialog');dialog.id='reference-onboarding';dialog.className='reference-tour';
    dialog.innerHTML='<form method="dialog"><button class="tour-close" aria-label="Закрыть обучение">×</button></form><small></small><h2></h2><p></p><div class="tour-actions"><button type="button" data-back>Назад</button><button type="button" data-next>Далее</button></div>';
    const paint=()=>{const [title,text,selector]=steps[index];dialog.querySelector('small').textContent=`Шаг ${index+1} из ${steps.length}`;dialog.querySelector('h2').textContent=title;dialog.querySelector('p').textContent=text;dialog.querySelector('[data-back]').disabled=index===0;dialog.querySelector('[data-next]').textContent=index===steps.length-1?'Понятно':'Далее';document.querySelector(selector)?.scrollIntoView({block:'center'});};
    dialog.querySelector('[data-back]').onclick=()=>{index--;paint();};dialog.querySelector('[data-next]').onclick=()=>{if(index===steps.length-1)dialog.close();else{index++;paint();}};
    dialog.addEventListener('close',()=>{dialog.remove();document.getElementById('reference-onboarding-start')?.focus();});document.body.append(dialog);paint();dialog.showModal();
  }
})();



