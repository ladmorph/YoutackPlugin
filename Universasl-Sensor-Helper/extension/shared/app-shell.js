/* Navigation presentation only. No network, persistence, or query state. */
const GraylogAppShell = (() => {
  const pages = {
    "release-tab": ["Мониторинг", "Новые и известные ошибки за выбранный период."],
    "percentiles-tab": ["Поиск", "Процентили ответов gateway по initUri выбранного трейса."],
    "search-tab": ["Поиск", "События, временная диаграмма и путь запроса по traceId."],
    "spam-tab": ["Спам запросов", "Повторные вызовы и отклонения от базы по версии и типу."],
    "technical-log-tab": ["Техническая информация", "Состояние запросов, доступные streams и справочник ошибок."],
    "journal-tab": ["Журнал trace", "Разобранные трейсы: initUri, статус ошибок и ссылка с зафиксированным периодом."],
    "navigator-tab": ["Личный Навигатор", "Ваши ссылки и заметки. Всегда под рукой — без подключения к сервисам."]
  };

  function select(tabId) {
    globalThis.Clippy?.refreshContext?.();
    const page = pages[tabId];
    if (!page) return;
    if(document.body?.dataset)document.body.dataset.currentTool=tabId;
    const title = document.querySelector("#view-title");
    const description = document.querySelector("#view-description");
    if (title) title.textContent = page[0];
    if (description) description.textContent = page[1];
    document.title = `${page[0]} · Advanced Graylog`;
    const inSearch = tabId === "search-tab" || tabId === "percentiles-tab";
    const localTabs = document.querySelector("#search-local-tabs");
    if (localTabs) localTabs.hidden = !inSearch;
    const searchTab = document.querySelector("#search-tab");
    if (tabId === "percentiles-tab" && searchTab) {
      searchTab.classList?.add("active");
      searchTab.setAttribute?.("aria-current", "page");
    }
    for (const [id, selected] of [["search-trace-tab",tabId === "search-tab"],["search-percentiles-tab",tabId === "percentiles-tab"]]) {
      const tab = document.querySelector(`#${id}`);
      tab?.classList?.toggle("active",selected);
      tab?.setAttribute?.("aria-pressed",String(selected));
    }
  }

  return Object.freeze({ select });
})();
