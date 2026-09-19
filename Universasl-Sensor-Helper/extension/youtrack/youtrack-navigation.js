(function(){
  'use strict';
  const main=document.getElementById('report-view'),tabs=document.querySelector('.yt-tabs');
  if(!main||!tabs)return;
  const ordinary=main.querySelector('.result-jump-nav'),result=document.getElementById('result-panel');
  if(ordinary&&result)main.insertBefore(ordinary,result);
  const observed=new Set(),selector=':scope > .result-jump-nav, :scope > .sensor-section-nav';
  function size(){
    main.style.setProperty('--legacy-tabs-height',tabs.getBoundingClientRect().height+'px');
    const nav=[...main.querySelectorAll(selector)].find(n=>n.getClientRects().length);
    main.style.setProperty('--legacy-nav-height',(nav?.getBoundingClientRect().height||0)+'px');
  }
  const resize=new ResizeObserver(size);resize.observe(tabs);
  function refresh(){for(const n of observed)if(!n.isConnected){resize.unobserve(n);observed.delete(n);}for(const n of main.querySelectorAll(selector))if(!observed.has(n)){observed.add(n);resize.observe(n);}size();}
  new MutationObserver(refresh).observe(main,{childList:true});
  document.addEventListener('youtrack-view-changed',refresh);refresh();
  let frame=0;
  window.addEventListener('scroll',()=>{if(frame||!['report','analysis'].includes(main.dataset.view))return;frame=requestAnimationFrame(()=>{frame=0;const nav=[...observed].find(n=>n.getClientRects().length);if(!nav)return;const buttons=[...nav.querySelectorAll('button')],boundary=nav.getBoundingClientRect().bottom+25;let active=null;for(const b of buttons){const target=document.getElementById(b.dataset.reportJump||b.dataset.sensorJump);if(target?.getClientRects().length&&target.getBoundingClientRect().top<=boundary)active=b;}for(const b of buttons){if(b===active)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');}});},{passive:true});
})();
