function summarizeTechnicalEntries(entries) {
  const completed = (entries || []).filter((entry) => entry?.status !== "pending" && Number.isFinite(Number(entry?.elapsedMs)) && Number(entry.elapsedMs) >= 0);
  const ordered = completed.map((entry) => Number(entry.elapsedMs)).sort((left, right) => left - right);
  const totalTime = ordered.reduce((sum, value) => sum + value, 0);
  const slowestEntry = completed.reduce((selected, entry) => !selected || Number(entry.elapsedMs) > Number(selected.elapsedMs) ? entry : selected, null);
  return {
    completed: completed.length,
    failed: completed.filter((entry) => entry.status === "error").length,
    totalTime,
    averageMs: completed.length ? Math.round(totalTime / completed.length) : 0,
    p95Ms: ordered.length ? ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] : 0,
    slowest: slowestEntry ? { area: String(slowestEntry.area || "Запрос"), elapsedMs: Number(slowestEntry.elapsedMs) } : null
  };
}

function systemReferenceEntries(entries) {
  const categories = new Set(["java","spring","webflux","network","redis","postgres","oracle"]);
  return (Array.isArray(entries) ? entries : []).filter((entry) => entry && categories.has(entry.category) && typeof entry.id === "string" && typeof entry.title === "string")
    .map((entry) => ({
      id: entry.id, category: entry.category, title:entry.title, meaning:String(entry.meaning || ""), priority:String(entry.priority || "unknown"),
      exceptions:Array.isArray(entry.exceptions) ? entry.exceptions.filter((value) => typeof value === "string") : [],
      sqlStates:Array.isArray(entry.sqlStates) ? entry.sqlStates.filter((value) => typeof value === "string") : [],
      oracleCodes:Array.isArray(entry.oracleCodes) ? entry.oracleCodes.filter((value) => typeof value === "string") : [],
      causes:Array.isArray(entry.causes) ? entry.causes.filter((value) => typeof value === "string") : [],
      checks:Array.isArray(entry.checks) ? entry.checks.filter((value) => typeof value === "string") : [], source:typeof entry.source === "string" ? entry.source : ""
    })).sort((left,right) => left.category.localeCompare(right.category) || left.title.localeCompare(right.title));
}

function auditCallPresentation(call) {
  if (!call) return null;
  const source = call.source === "graylog-native" ? "Graylog · штатный поиск"
    : call.source === "extension-graph" ? "Расширение · полный граф"
      : call.source === "extension-search" ? "Расширение · поиск traceId" : "";
  if (!source || !/^(GET|POST)$/.test(call.method) || typeof call.path !== "string" || !call.path.startsWith("/")) return null;
  const paging = [Number.isSafeInteger(call.limit) ? `limit ${call.limit}` : "", Number.isSafeInteger(call.offset) ? `offset ${call.offset}` : ""].filter(Boolean).join(" · ");
  return { source, request: `${call.method} ${call.path}`, paging };
}

if (typeof module !== "undefined" && module.exports) module.exports = { summarizeTechnicalEntries, systemReferenceEntries, auditCallPresentation };

if (typeof document !== "undefined") (function initializeTechnicalLog() {
  const rowsElement = document.querySelector("#technical-log-rows");
  const summaryElement = document.querySelector("#technical-log-summary");
  const clearButton = document.querySelector("#clear-technical-log");
  const queriesTab = document.querySelector("#technical-queries-tab");
  const streamsTab = document.querySelector("#technical-streams-tab");
  const referenceTab = document.querySelector("#technical-reference-tab");
  const localAiTab = document.querySelector("#technical-local-ai-tab");
  const queriesPanel = document.querySelector("#technical-queries-panel");
  const streamsPanel = document.querySelector("#technical-streams-panel");
  const referencePanel = document.querySelector("#technical-reference-panel");
  const localAiPanel = document.querySelector("#technical-local-ai-panel");
  const streamList = document.querySelector("#stream-list");
  const streamForm = document.querySelector("#add-stream-form");
  const streamInput = document.querySelector("#new-stream-id");
  const streamReset = document.querySelector("#reset-streams");
  const streamError = document.querySelector("#stream-manager-error");
  const systemReferenceTab = document.querySelector("#reference-system-tab");
  const businessReferenceTab = document.querySelector("#reference-business-tab");
  const systemReferencePanel = document.querySelector("#reference-system-panel");
  const businessReferencePanel = document.querySelector("#reference-business-panel");
  const referenceSearch = document.querySelector("#reference-search");
  const referenceCount = document.querySelector("#technical-reference-count");
  const referenceList = document.querySelector("#system-reference-list");

  function html(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function time(value) {
    return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
  }

  function period(entry) {
    if (!Number.isFinite(entry.startMs) || !Number.isFinite(entry.endMs)) return "—";
    const formatter = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `${formatter.format(new Date(entry.startMs))} — ${formatter.format(new Date(entry.endMs))}`;
  }

  function render(entries) {
    const counts = new Map();
    for (const entry of entries) counts.set(entry.signature, (counts.get(entry.signature) || 0) + 1);
    const metrics = summarizeTechnicalEntries(entries);
    const slowest = metrics.slowest ? `<span>Самый медленный: <strong>${html(metrics.slowest.area)} · ${metrics.slowest.elapsedMs} мс</strong></span>` : "";
    summaryElement.innerHTML = `<span>Операций: <strong>${entries.length}</strong></span><span>Вариантов: <strong>${counts.size}</strong></span><span>Ошибок: <strong>${metrics.failed}</strong></span><span>Суммарно: <strong>${(metrics.totalTime / 1000).toFixed(1)} с</strong></span><span>Среднее: <strong>${metrics.averageMs} мс</strong></span><span>P95: <strong>${metrics.p95Ms} мс</strong></span>${slowest}`;
    rowsElement.innerHTML = entries.length ? entries.map((entry) => {
      const status = entry.status === "pending" ? "Выполняется…" : entry.status === "success" ? "Успешно" : entry.status === "cancelled" ? "Отменено" : "Ошибка";
      const result = entry.resultCount === null ? "" : `<br><span class="audit-result">Событий в ответе: ${new Intl.NumberFormat("ru-RU").format(entry.resultCount)}</span>`;
      const detail = typeof entry.detail === "string" && entry.detail ? `<br><span class="muted">${html(entry.detail)}</span>` : "";
      const elapsed = entry.elapsedMs === null ? "" : `<br><span class="muted">Длительность операции: ${entry.elapsedMs} мс</span>`;
      const call = auditCallPresentation(entry.call);
      const operation = call ? `<div class="audit-call"><strong>${html(call.source)}</strong><code>${html(call.request)}</code>${call.paging ? `<span>${html(call.paging)}</span>` : ""}</div><div class="audit-aggregation">${html(entry.aggregation)}</div>` : html(entry.aggregation);
      const scope = entry.call?.source === "graylog-native" ? "Область штатного поиска"
        : entry.call?.source === "extension-graph" ? "Текущая выдача Graylog"
          : entry.streams.join(", ") || "все индексы";
      return `<tr><td><strong>#${entry.id}</strong><br><span class="muted">${html(time(entry.startedAt))}</span></td><td>${html(entry.area)}</td><td class="technical-query"><code>${html(entry.query)}</code></td><td><code>${html(scope)}</code><br><span class="muted">${html(period(entry))}</span></td><td>${operation}</td><td><span class="audit-status audit-${entry.status}">${html(status)}</span>${result}${detail}${elapsed}</td><td>${counts.get(entry.signature)}</td></tr>`;
    }).join("") : '<tr><td class="empty" colspan="7">В этой вкладке тулы запросы к Graylog ещё не выполнялись.</td></tr>';
  }

  QueryAudit.subscribe(render);
  const importedPageRecords=new Set();
  async function importPageAudit(){
    try{
      const response=await chrome.runtime.sendMessage({type:'get-page-collection-audit'});
      for(const record of (response?.records||[]).slice().reverse()){
        if(record.status==='pending'||importedPageRecords.has(record.id))continue;
        importedPageRecords.add(record.id);
        QueryAudit.observe({area:record.area,query:'traceId:"[скрыт]"',streams:['Страницы текущей выдачи Graylog'],
          aggregation:record.action==='snapshot'?`Локальное чтение уже показанной страницы ${record.page} · 0 HTTP`:record.page?`Штатный переход ${record.fromPage??'?'} → ${record.page} · пауза 100 мс после готовности выдачи`:'Сбор по штатным страницам · без собственных API-запросов расширения',
          startedAt:record.startedAt,elapsedMs:record.elapsedMs,status:record.status,resultCount:record.messagesRead??null});
      }
    }catch{}
  }
  document.querySelector('#technical-log-tab')?.addEventListener('click',importPageAudit);
  queriesTab?.addEventListener('click',importPageAudit);
  clearButton.addEventListener("click", () => QueryAudit.clear());

  function selectSubtab(selected) {
    const streamsSelected = selected === "streams";
    const referenceSelected = selected === "reference";
    const localAiSelected = selected === "local-ai";
    queriesTab.classList.toggle("active", !streamsSelected && !referenceSelected && !localAiSelected);
    streamsTab.classList.toggle("active", streamsSelected);
    referenceTab.classList.toggle("active", referenceSelected);
    localAiTab.classList.toggle("active", localAiSelected);
    queriesPanel.hidden = streamsSelected || referenceSelected || localAiSelected;
    streamsPanel.hidden = !streamsSelected;
    referencePanel.hidden = !referenceSelected;
    localAiPanel.hidden = !localAiSelected;
  }

  const categoryLabels={java:"Java",spring:"Spring",webflux:"WebFlux",network:"Сеть",redis:"Redis",postgres:"PostgreSQL",oracle:"Oracle"};
  const priorityLabels={high:"Высокий",medium:"Средний",low:"Низкий",unknown:"Не определён"};
  const references=systemReferenceEntries(globalThis.ErrorReference?.entries);
  function validSource(value){try{const url=new URL(value);return url.protocol==="https:"?url.href:"";}catch{return"";}}
  function renderReferenceList(filterValue="") {
    const filter=String(filterValue).trim().toLocaleLowerCase("ru");
    const matched=references.filter(entry=>!filter||[entry.id,entry.category,entry.title,...entry.exceptions,...entry.sqlStates,...entry.oracleCodes].join(" ").toLocaleLowerCase("ru").includes(filter));
    const groups=new Map();for(const entry of matched){if(!groups.has(entry.category))groups.set(entry.category,[]);groups.get(entry.category).push(entry);}
    referenceList.innerHTML="";
    for(const [category,items] of groups){
      const section=document.createElement("section");section.className="reference-group";
      const heading=document.createElement("h3");heading.textContent=`${categoryLabels[category] || category} · ${items.length}`;section.append(heading);
      for(const entry of items){
        const card=document.createElement("details");card.className="reference-entry";
        const summary=document.createElement("summary"),title=document.createElement("strong"),tokens=document.createElement("code"),priority=document.createElement("span");
        title.textContent=entry.title;tokens.textContent=[...entry.exceptions,...entry.sqlStates,...entry.oracleCodes].join(", ") || entry.id;priority.className="reference-priority";priority.textContent=priorityLabels[entry.priority] || priorityLabels.unknown;summary.append(title,tokens,priority);card.append(summary);
        const body=document.createElement("div");body.className="reference-entry-body";
        const meaning=document.createElement("p");meaning.textContent=`Что означает: ${entry.meaning}`;body.append(meaning);
        const appendList=(caption,values)=>{if(!values.length)return;const label=document.createElement("p");label.textContent=caption;const list=document.createElement("ul");for(const value of values){const item=document.createElement("li");item.textContent=value;list.append(item);}body.append(label,list);};
        appendList("Возможные причины:",entry.causes);appendList("Что проверить:",entry.checks);
        const source=validSource(entry.source);if(source){const link=document.createElement("a");link.textContent="Официальная документация";link.href=source;link.target="_blank";link.rel="noopener noreferrer";link.referrerPolicy="no-referrer";body.append(link);}
        card.append(body);section.append(card);
      }
      referenceList.append(section);
    }
    if(!matched.length){const empty=document.createElement("p");empty.className="panel reference-empty";empty.textContent="Совпадений в системном справочнике нет.";referenceList.append(empty);}
    referenceCount.textContent=`Показано ${matched.length} из ${references.length}`;
  }

  function selectReferenceKind(selected) {
    const business=selected==="business";systemReferenceTab.classList.toggle("active",!business);businessReferenceTab.classList.toggle("active",business);systemReferencePanel.hidden=business;businessReferencePanel.hidden=!business;
  }

  function showStreamError(message) {
    streamError.textContent = message;
    streamError.hidden = false;
  }

  function refreshManagedSelects() {
    for (const id of ["safe-search-stream"]) {
      const select = document.querySelector(`#${id}`);
      if (select) GraylogStreams.populateGraylogStreamSelect(select, select.value, { includeAll: id === "safe-search-stream" });
    }
  }

  function renderStreams(streams) {
    const standard = new Set(GraylogStreams.DEFAULT_GRAYLOG_STREAMS);
    const testMode = GraylogStreams.environment?.() === "test";
    const testStreams = new Set(GraylogStreams.TEST_GRAYLOG_STREAMS || []);
    const managerNote = document.querySelector("#stream-manager-note");
    if (managerNote) managerNote.textContent = testMode
      ? "Список выбран автоматически по hostname Graylog и действует для всех запросов test-режима."
      : "Изменения действуют до закрытия вкладки тулы. Обязательный stream процентилей удалить нельзя.";
    for (const control of streamForm.elements || []) control.disabled = testMode;
    streamForm.title = testMode ? "Test-окружение использует фиксированный список streams" : "";
    streamError.textContent = testMode ? "Test-режим определён по hostname: список из 4 streams фиксирован, процентили отключены." : "";
    streamError.hidden = !testMode;
    streamList.innerHTML = streams.map((id, index) => {
      const required = GraylogStreams.DEFAULT_PERCENTILE_STREAMS.includes(id);
      const origin = testMode && testStreams.has(id) ? "test · фиксированный" : standard.has(id) ? "стандартный" : "добавленный";
      const disabled = testMode || required;
      const title = testMode ? "Фиксированный stream test-окружения" : required ? "Обязательный stream процентилей" : "";
      return `<div class="stream-list-row"><span class="stream-index">${index + 1}</span><code>${html(id)}</code><span class="stream-origin">${origin}${required && !testMode ? " · процентили" : ""}</span><button class="secondary compact remove-stream" type="button" data-stream-id="${html(id)}" ${disabled ? `disabled title="${title}"` : ""}>Удалить</button></div>`;
    }).join("");
    refreshManagedSelects();
  }

  GraylogStreams.subscribe(renderStreams);
  queriesTab.addEventListener("click", () => selectSubtab("queries"));
  streamsTab.addEventListener("click", () => selectSubtab("streams"));
  referenceTab.addEventListener("click", () => selectSubtab("reference"));
  localAiTab.addEventListener("click", () => selectSubtab("local-ai"));
  systemReferenceTab.addEventListener("click", () => selectReferenceKind("system"));
  businessReferenceTab.addEventListener("click", () => selectReferenceKind("business"));
  referenceSearch.addEventListener("input", () => renderReferenceList(referenceSearch.value));
  renderReferenceList();
  streamForm.addEventListener("submit", (event) => {
    event.preventDefault();
    streamError.hidden = true;
    try { GraylogStreams.add(streamInput.value); streamInput.value = ""; }
    catch (error) { showStreamError(error.message || String(error)); }
  });
  streamReset.addEventListener("click", () => {
    streamError.hidden = true;
    try { GraylogStreams.reset(); }
    catch (error) { showStreamError(error.message || String(error)); }
  });
  streamList.addEventListener("click", (event) => {
    const button = event.target.closest(".remove-stream");
    if (!button || button.disabled) return;
    streamError.hidden = true;
    try { GraylogStreams.remove(button.dataset.streamId); }
    catch (error) { showStreamError(error.message || String(error)); }
  });
})();
