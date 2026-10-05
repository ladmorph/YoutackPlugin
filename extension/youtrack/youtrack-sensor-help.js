(function(root){
  'use strict';let dialog=null,mascot=null,trigger=null;
  function close(){mascot?.dispose();mascot=null;dialog?.remove();dialog=null;trigger?.setAttribute('aria-expanded','false');trigger?.focus({preventScroll:true});trigger=null;}
  function open(button,title,body){close();trigger=button;button.setAttribute('aria-expanded','true');dialog=document.createElement('aside');dialog.className='sensor-formula-help';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Как рассчитано: '+title);
    const figure=document.createElement('div');figure.className='sensor-help-mascot';const content=document.createElement('div'),heading=document.createElement('strong'),text=document.createElement('p'),quit=document.createElement('button');heading.textContent=title;text.textContent=body;quit.type='button';quit.textContent='Понятно · закрыть';quit.addEventListener('click',close);content.append(heading,text,quit);dialog.append(figure,content);document.body.append(dialog);
    if(root.SensorMascot){mascot=SensorMascot.mount(figure,{baseUrl:chrome.runtime.getURL('extension/shared/living-signal-mascot.png'),waveUrl:chrome.runtime.getURL('extension/shared/living-signal-mascot-wave.png')});mascot.setIntro('final');mascot.setState('analysis');mascot.setScene('point');}quit.focus();
  }
  function attach(element,title,body){element.classList.add('sensor-help-owner');element.querySelector(':scope > .sensor-formula-button')?.remove();const b=document.createElement('button');b.type='button';b.className='sensor-formula-button';b.textContent='?';b.setAttribute('aria-label','Как рассчитано: '+title);b.setAttribute('aria-expanded','false');b.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(trigger===b)close();else open(b,title,body);});element.append(b);}
  document.addEventListener('keydown',e=>{if(dialog&&e.key==='Escape'){e.preventDefault();close();}});document.addEventListener('youtrack-view-changed',close);document.addEventListener('youtrack-folder-changed',close);
  root.YouTrackSensorHelp={attach,close};
})(globalThis);
