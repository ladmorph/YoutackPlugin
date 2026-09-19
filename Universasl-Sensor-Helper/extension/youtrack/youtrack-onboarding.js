(() => {
  "use strict";
  const start=document.querySelector("#start-youtrack-onboarding");
  if(!start||!globalThis.SensorMascot)return;
  const steps=[
    {target:".folder-projects",title:"Проекты YouTrackPlus",text:"Один раз подключи папку YouTrackPlus. Каждая её подпапка — отдельный проект отчёта со своими teams.json и config.json. Выбирай проект в списке или создавай новый. Переключение не запускает HTTP. После правок в конструкторе нажми «Сохранить команды и правила в проект», чтобы записать JSON в его папку."},
    {target:"#tab-session-card",title:"Подключение",text:"Сессия берётся сама, но только по явному переходу: открой отчёт иконкой расширения с вкладки YouTrack либо нажми «Обновить подключение» в отчёте. На сайте YouTrack ничего включать не нужно. Отчёт сам не запускается: выбери проекты и период и нажми «Построить отчёт»."},
    {target:"#json-mode-panel",title:"teams.json — кто входит в команды",text:"Здесь видно, найден ли teams.json и работаем ли мы с ним. Он задаёт команды, участников и ёмкость; без него проект считается командой. Положил файл рядом с manifest.json или в extension? Нажми «Проверить папку ещё раз». «Редактировать команды» откроет текущий профиль в конструкторе; изменения можно применить и скачать новым JSON."},
    {target:"#profile-panel",title:"config.json — как считать показатели",text:"Необязательный config.json задаёт названия полей оценки и статуса, типы бизнес-задач, багов и списаний. Без него работают встроенные правила исходного HTML. Чтение config.json не обращается к YouTrack."},
    {target:"#offline-report",title:"Отчёт из файла — необязательно",text:"Для обычного отчёта списания загрузятся из подключённого YouTrack. Если у тебя уже есть выгрузка work_items.json, раскрой «Отчёт из файла» и выбери её: расчёт пойдёт локально, без запросов. В заголовке раздела видно, когда используется файл."},
    {target:"#run-panel",title:"Сбор отчёта",text:"Задай период и нажми «Построить отчёт». Повторный запуск заблокирован, а «Стоп» отменяет текущую загрузку и не начинает следующий проект."},
    {target:"#result-panel",fallback:"#run-panel",title:"Разбор результата",text:"Клик по числу открывает строки, команда раскрывает сотрудников. Карточки «Превысили оценку» и «Закрыты без оценки» раскрывают задачи: список можно скопировать и закрыть. Разбор Сенсора не меняет Excel."},
    {target:"#run-panel",title:"Возврат и обновление",text:"Готовый расчёт хранится в памяти открытой вкладки. Повторный расчёт с теми же параметрами до 2 минут не делает запросов. «Обновить данные из YouTrack» запускает свежую загрузку; между порциями пауза 20 мс после ответа."},
    {target:"#tab-analysis",title:"Сенсор тоже проверил отчёт",text:"После расчёта я предложу посмотреть разбор. Во вкладке «Разбор Сенсора» — оценки задач, полнота данных и списания. Карточки раскрывают задачи со ссылками и копированием. «Позже» убирает только приглашение; вкладка остаётся. Новых запросов здесь нет. Здесь же графики, тепловая карта и полный PDF. Знаки вопроса открывают мои объяснения формул."},
    {target:"#tab-log",title:"Что было запрошено",text:"В Network и запросы видны штатные вызовы и запросы расширения, наличие Bearer, HTTP-статус и время порций. Значение токена, host и сырые ответы туда не попадают."}
  ];
  let host=null,figure=null,bubble=null,title=null,text=null,next=null,back=null,sensor=null,index=0,highlight=null,busy=false;

  function elementFor(step){const target=document.querySelector(step.target);return target&&!target.hidden?target:document.querySelector(step.fallback||step.target);}
  function clearHighlight(){highlight?.classList.remove("yt-guide-target");highlight=null;}
  function portal(rect,kind){const node=document.createElement("span");node.className=`yt-guide-portal ${kind}`;node.style.left=`${Math.round(rect.left+rect.width/2)}px`;node.style.top=`${Math.round(rect.top+rect.height/2)}px`;document.body.append(node);setTimeout(()=>node.remove(),620);}
  function place(target){
    const rect=target.getBoundingClientRect(),width=Math.min(420,innerWidth-24),height=host.offsetHeight||180,gap=18;
    const left=Math.max(12,Math.min(innerWidth-width-12,rect.right+gap+width<innerWidth?rect.right+gap:rect.left-width-gap));
    const top=Math.max(12,Math.min(innerHeight-height-12,rect.top+Math.min(rect.height/2,90)-height/2));
    host.style.left=`${left}px`;host.style.top=`${top}px`;
  }
  async function showStep(nextIndex,first=false){
    if(busy)return;busy=true;const activeHost=host;const step=steps[nextIndex],target=elementFor(step);if(!target){busy=false;return;}
    if(!first){const old=figure.getBoundingClientRect();portal(old,"depart");host.dataset.teleport="out";await new Promise(resolve=>setTimeout(resolve,180));if(host!==activeHost)return;}
    clearHighlight();target.scrollIntoView({behavior:first?"auto":"smooth",block:"center"});await new Promise(resolve=>setTimeout(resolve,first?20:260));if(host!==activeHost)return;
    index=nextIndex;highlight=target;highlight.classList.add("yt-guide-target");place(target);title.textContent=step.title;text.textContent=step.text;back.disabled=index===0;next.textContent=index===steps.length-1?"Готово":"Дальше";host.dataset.teleport="in";portal(figure.getBoundingClientRect(),"arrive");sensor.setState(index===steps.length-1?"success":"analysis");sensor.setScene(index===steps.length-1?"celebrate":"point");setTimeout(()=>{if(host)delete host.dataset.teleport;},430);busy=false;
  }
  function close(){busy=false;clearHighlight();sensor?.dispose();host?.remove();host=null;window.removeEventListener("resize",reposition);}
  function reposition(){if(host&&highlight)place(highlight);}
  function open(){
    if(host){close();return;}index=0;host=document.createElement("aside");host.className="yt-guide";host.setAttribute("aria-live","polite");
    figure=document.createElement("div");figure.className="yt-guide-sensor";bubble=document.createElement("div");bubble.className="yt-guide-bubble";title=document.createElement("strong");text=document.createElement("p");
    const controls=document.createElement("div");controls.className="yt-guide-controls";back=document.createElement("button");back.type="button";back.textContent="Назад";next=document.createElement("button");next.type="button";next.className="primary";next.textContent="Дальше";const quit=document.createElement("button");quit.type="button";quit.className="quiet";quit.textContent="Закрыть";controls.append(back,next,quit);bubble.append(title,text,controls);host.append(figure,bubble);document.body.append(host);
    sensor=SensorMascot.mount(figure,{baseUrl:chrome.runtime.getURL("extension/graylog/living-signal-mascot.png"),waveUrl:chrome.runtime.getURL("extension/graylog/living-signal-mascot-wave.png")});sensor.setIntro("final");sensor.setState("welcome");sensor.setScene("point");
    back.addEventListener("click",()=>showStep(Math.max(0,index-1)));next.addEventListener("click",()=>index===steps.length-1?close():showStep(index+1));quit.addEventListener("click",close);window.addEventListener("resize",reposition,{passive:true});showStep(0,true);
  }
  document.addEventListener("youtrack-view-changed",()=>{if(host)close();});
  start.addEventListener("click",()=>{if(document.querySelector("#report-view")?.dataset.view!=="builder")open();});
})();
