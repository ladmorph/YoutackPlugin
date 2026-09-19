(function initializeOnboarding() {
  "use strict";
  const launch = document.querySelector("#start-onboarding");
  if (!launch || globalThis.AdvancedGraylogOnboarding) return;

  // The tour only switches already rendered UI tabs. It never clicks an action
  // that can query Graylog, import a file, mutate a rule or contact local AI.
  const steps = [
    { id:"sections", target:"#tool-tabs", title:"Основные разделы", text:"Выберите мониторинг, поиск traceId, проверку повторных запросов или техническую информацию. Сам переход между разделами ничего не запрашивает." },
    { id:"monitor-controls", activate:["#release-tab"], target:"#release-view .monitor-control-grid", title:"Настройка мониторинга", text:"Сначала выберите режим, период и время окончания. «Запустить» начинает проверку, а «Обновить» повторяет её без кеша; во время запроса повторные нажатия блокируются." },
    { id:"monitor-results", activate:["#release-tab"], target:"#release-view .monitor-overview", title:"Результат мониторинга", text:"После проверки здесь появятся новые, известные и не сопоставленные группы ошибок. Карточки ниже можно разворачивать, сворачивать и открывать в Graylog." },
    { id:"monitor-rules", activate:["#release-tab"], target:"#release-view .monitor-explanation", title:"Как сравниваются ошибки", text:"Раскройте этот блок, чтобы увидеть признаки одной группы. Метка «новое» относится к доступной выборке и не доказывает, что причиной был релиз." },
    { id:"spam", activate:["#spam-tab"], target:"#checker", title:"Спам запросов", text:"Выберите stream и час, затем загрузите его. Фильтры результата работают локально; переход по часам во время активной загрузки заблокирован." },
    { id:"technical-tabs", activate:["#technical-log-tab"], target:"#technical-log-view > .technical-subtabs", title:"Техническая информация", text:"Внутри есть журнал запросов расширения, настройка streams, справочник ошибок и экспериментальный локальный ИИ." },
    { id:"query-log", activate:["#technical-log-tab","#technical-queries-tab"], target:"#technical-queries-panel .technical-log-panel", title:"Журнал запросов", text:"Здесь видно, какой анализ вы запускали, его период, stream, длительность и результат. Сырые сообщения, адрес Graylog и идентификаторы в журнал не записываются." },
    { id:"streams", activate:["#technical-log-tab","#technical-streams-tab"], target:"#technical-streams-panel .stream-manager", title:"Управление streams", text:"Добавляйте разрешённые вашей учётке stream ID или возвращайте стандартный локальный список. Сервер Graylog всё равно проверяет права; изменения списка живут только в текущей вкладке расширения." },
    { id:"system-reference", activate:["#technical-log-tab","#technical-reference-tab","#reference-system-tab"], target:"#reference-system-panel .reference-head", title:"Системный справочник", text:"Ищите Java, Spring, WebFlux, сетевые, Redis и SQL-ошибки. Карточка объясняет возможные причины и проверки; поиск по справочнику локальный." },
    { id:"business-reference", activate:["#technical-log-tab","#technical-reference-tab","#reference-business-tab"], target:"#reference-business-panel .business-rules-head", title:"Бизнесовые правила", text:"Правила сопоставляются по точному errorCode. Их можно добавить вручную, импортировать или выгрузить в CSV; изменение не перезапускает анализ автоматически." },
    { id:"local-ai", activate:["#technical-log-tab","#technical-local-ai-tab"], target:"#technical-local-ai-panel .local-ai-head", title:"Локальный ИИ · WIP", text:"До запуска можно проверить обезличенный payload. Обращение идёт только по вашему нажатию и только к 127.0.0.1 или localhost; сырые сообщения модели не передаются." },
    { id:"connection", target:"#page-state", title:"Состояние подключения", text:"Эта строка показывает, подключена ли исходная вкладка Graylog. Сенсор сообщает о ходе явно запущенных действий и найденных проблемах." }
  ];

  let index = 0, active = false, target = null, origin = null, renderGeneration = 0;

  const visible = element => element && !element.hidden && element.getClientRects().length > 0;
  function clickSelectors(selectors = []) {
    for (const selector of selectors) document.querySelector(selector)?.click();
  }
  function render() {
    const generation = ++renderGeneration;
    const step = steps[index];
    target?.classList.remove("onboarding-target");
    target = null;
    clickSelectors(step.activate);
    requestAnimationFrame(() => {
      if (!active || generation !== renderGeneration) return;
      target = document.querySelector(step.target);
      if (!visible(target)) {
        const next = steps.findIndex((candidate, candidateIndex) => candidateIndex > index && document.querySelector(candidate.target));
        if (next < 0) { finish(); return; }
        index = next;
        render();
        return;
      }
      target.classList.add("onboarding-target");
      target.scrollIntoView({ block:"center", inline:"nearest", behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth" });
      globalThis.Clippy?.setTourStep?.({target,index,total:steps.length,last:index===steps.length-1,message:`${step.title}. ${step.text}`,onBack:()=>move(-1),onNext:()=>move(1),onClose:finish});
    });
  }
  function start() {
    if (active) return;
    const selected = document.querySelector(".tool-tab.active");
    origin = {
      tab:selected?.id || "release-tab", x:scrollX, y:scrollY,
      searchSubtab:document.querySelector("#search-local-tabs .technical-subtab.active")?.id || "search-trace-tab",
      technicalSubtab:document.querySelector("#technical-log-view > .technical-subtabs .technical-subtab.active")?.id || "technical-queries-tab",
      referenceSubtab:document.querySelector("#technical-reference-panel .reference-kind-tabs .technical-subtab.active")?.id || "reference-system-tab"
    };
    active = true; index = 0; launch.setAttribute("aria-pressed", "true"); render();
  }
  function finish() {
    if (!active) return;
    active = false;
    renderGeneration += 1;
    target?.classList.remove("onboarding-target"); target = null; launch.setAttribute("aria-pressed", "false");
    if (origin?.tab) document.querySelector(`#${origin.tab}`)?.click();
    if (origin?.tab === "search-tab" && origin.searchSubtab === "search-percentiles-tab") document.querySelector("#search-percentiles-tab")?.click();
    document.querySelector(`#${origin?.technicalSubtab || "technical-queries-tab"}`)?.click();
    document.querySelector(`#${origin?.referenceSubtab || "reference-system-tab"}`)?.click();
    scrollTo({ left:origin?.x || 0, top:origin?.y || 0, behavior:"auto" });
    globalThis.Clippy?.clearTour?.(); launch.focus({ preventScroll:true });
  }
  function move(delta) {
    const nextIndex = index + delta;
    if (nextIndex >= steps.length) { finish(); return; }
    index = Math.max(0, nextIndex); render();
  }
  launch.addEventListener("click", start);
  addEventListener("resize", () => active&&render(), { passive:true });
  document.addEventListener("keydown", event => {
    if (!active) return;
    if (event.key === "Escape") finish();
    else if (event.key === "ArrowRight") move(1);
    else if (event.key === "ArrowLeft") move(-1);
  });
  globalThis.AdvancedGraylogOnboarding = Object.freeze({ start, finish, getState:()=>({active,index,total:steps.length,stepId:steps[index]?.id || null,target:target?.id || target?.className || null}) });
})();
