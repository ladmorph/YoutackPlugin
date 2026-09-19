// Local presentation only. No network, storage or raw log parsing.
(function initializeTraceErrorView() {
  const priorities = { high:"Высокий", medium:"Средний", low:"Низкий", unknown:"Не определён" };
  const ranks = { high:0, medium:1, low:2, unknown:3 };
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  function renderHttpCall(parent,httpCall,service) {
    if(!httpCall||!["matched-request","unmatched-context","ambiguous"].includes(httpCall.relation)||!["webclient-checkpoint","webclient-response","http-stack-context"].includes(httpCall.kind))return false;
    const block=element("section",undefined,"trace-error-http-call");
    block.dataset.relation=httpCall.relation;
    block.append(element("strong","Исходящий HTTP-вызов","trace-error-http-heading"));
    if(httpCall.method&&httpCall.target){
      const target=element("div",undefined,"trace-error-http-target");
      target.append(element("span",httpCall.method,"trace-error-http-verb"),element("code",httpCall.target));
      block.append(target);
    }
    const labels={
      "matched-request":`Связан с записью REQUEST · ${service || "этот сервис"} · тот же span`,
      "unmatched-context":"Вызов указан в стеке; соответствующая запись REQUEST в полученной выборке не найдена.",
      ambiguous:httpCall.method&&httpCall.target?"Найдено несколько подходящих REQUEST. Конкретная запись не выбрана.":"В стеке несколько HTTP-вызовов. Конкретный вызов не выбран."
    };
    block.append(element("p",labels[httpCall.relation],"trace-error-http-status"));
    block.append(element("small",httpCall.kind==="webclient-response"?"Из исключения HTTP-клиента при ответе":httpCall.kind==="http-stack-context"?"Из отдельной HTTP-строки принадлежащего сообщению стека":"Из checkpoint HTTP-клиента"));
    parent.append(block);
    return true;
  }

  function renderStackMeaning(parent,evidence,hasHttp) {
    const stack=evidence.stack,outer=evidence.exceptionSite;
    if(!stack&&!outer){parent.append(element("p","Метод с файлом и номером строки в разобранном стеке не установлен.","hint"));return;}
    const type=outer?.exceptionType||stack?.exceptionType;
    const cause=stack?.causeExceptionType;
    const chain=element("div",undefined,"trace-error-stack-chain");
    chain.append(element("small","Исключение"),element("code",type));
    if(cause&&cause!==type){chain.append(element("span","→ Caused by →","trace-error-stack-cause-arrow"),element("code",cause));}
    parent.append(chain);
    const method=(site,title,note)=>{
      const block=element("section",undefined,"trace-error-method-fact");
      block.append(element("strong",title),element("code",`${site.method}(${site.file}:${site.line})`,"trace-error-source-method"),element("p",note,"hint"));
      parent.append(block);
    };
    const outerTitle=outer?.role==='cause-exception'?"Метод в стеке причины":"Метод в стеке внешнего исключения";
    const outerNote="Место в сохранённом стеке исключения. Здесь оно могло быть создано или преобразовано; это не доказывает ошибку этого метода.";
    const same=outer&&stack&&outer.method===stack.method&&outer.file===stack.file&&outer.line===stack.line;
    if(outer&&(!same||stack?.kind==='assembly'||stack?.kind==='original'))method(outer,outerTitle,outerNote);
    if(stack){
      const labels={"reactor-assembly":"Сборка реактивной операции","original-stack":"Метод в Original Stack Trace","enclosing-exception":"Метод в стеке внешнего исключения","exception-stack":cause?"Метод в стеке причины":"Метод в стеке исключения"};
      const role=stack.role||(stack.kind==='assembly'?'reactor-assembly':stack.kind==='original'?'original-stack':'exception-stack');
      const notes={
        "reactor-assembly":"Reactor сохранил место сборки операции. Это контекст её создания, а не доказательство дефекта этого метода.",
        "original-stack":"Это метод из исходного стека Reactor. Он может относиться к выполнению или подписке; место создания исходящего вызова по нему не установлено.",
        "enclosing-exception":"Метод относится к внешнему исключению; исходный вызов по нему не установлен. Он может только преобразовывать ошибку из Caused by.",
        "exception-stack":"Метод присутствует в стеке этого исключения. По одной строке стека нельзя установить, какой вызов или участок кода стал причиной сбоя."
      };
      method(stack,labels[role]||"Метод в стеке исключения",stack.partial?"Показан метод из начала стека. Окончание не разобрано; полная причина и исходный вызов не установлены.":notes[role]||notes['exception-stack']);
    }
    parent.append(element("p",hasHttp?"HTTP-контекст показан отдельно. Его наличие в событии не доказывает, что указанный метод выполнял этот запрос.":"Исходящий HTTP-вызов из этого стека не определён.","hint"));
  }

  function renderTimeline(panel,timeline,groups=[],openGroup=null) {
    if(!timeline?.events?.length)return;
    const events=timeline.events.slice(0,40),positions=new Map(events.map((event,index)=>[event.id,index+1]));
    const byId=new Map(events.map(event=>[event.id,event]));
    const links=(timeline.links||[]).slice(0,40).filter(link=>link.relationship==="probable"&&byId.has(link.from)&&byId.has(link.to));
    const incoming=new Map(links.map(link=>[link.to,link]));
    const elapsed=value=>value<1000?`${Math.round(value)} мс`:`${(value/1000).toLocaleString("ru-RU",{maximumFractionDigits:3})} с`;
    const block=element("section",undefined,"trace-error-timeline");
    block.append(element("h4","История пути ошибки"));
    block.append(element("p","Одно исключение могут поймать и записать несколько сервисов. Стрелки показывают вероятную передачу или повторную запись; под каждой связью указано основание.","hint"));
    const connectionList=element("div",undefined,"trace-error-connections");
    const connectionMore=element("details",undefined,"trace-error-connections-more");
    connectionMore.append(element("summary",`Ещё связей: ${Math.max(0,links.length-4)}`));
    for(const [index,link] of links.entries()){
      const from=byId.get(link.from),to=byId.get(link.to);
      const connection=element("div",undefined,"trace-error-connection");
      connection.dataset.from=String(positions.get(from.id));connection.dataset.to=String(positions.get(to.id));
      connection.dataset.evidence=link.evidence||"span-ancestor-and-exception";
      const endpoints=element("div",undefined,"trace-error-connection-path");
      for(const [position,event] of [["from",from],["to",to]]){
        if(position==="to"){const arrow=element("span","→","trace-error-connection-arrow");arrow.setAttribute("aria-hidden","true");endpoints.append(arrow);}
        const endpoint=element("div",undefined,"trace-error-connection-endpoint");
        endpoint.append(element("small",`Событие №${positions.get(event.id)}`),element("strong",event.service||"Сервис не определён"));
        endpoints.append(endpoint);
      }
      const interval=Number.isFinite(from.at)&&Number.isFinite(to.at)&&to.at>from.at?` · +${elapsed(to.at-from.at)} между записями`:"";
      const relationLabel=link.kind==="relogged"?"Вероятная повторная запись":link.kind==="similar"?"Возможно, та же ошибка":"Вероятная передача ошибки";
      const evidenceLabels={
        "span-ancestor-and-exception":"Вызывающий сервис записал совместимое исключение · связь по parentSpanId",
        "span-ancestor-and-signature":"Совпали исключение и его сообщение · связь с вызывающим сервисом по parentSpanId",
        "same-span-and-signature":"Тот же сервис и span · совпали исключение и его сообщение",
        "shared-span-and-signature":"Общий spanId и одинаковое сообщение исключения внутри trace; направление вызова не установлено",
        "trace-and-signature":"Совпали исключение и его сообщение внутри trace; путь вызовов не установлен"
      };
      const confidenceLabel={observed:'подтверждена структурой span',high:'высокая',medium:'средняя',low:'низкая'}[link.confidence]||'требует проверки';
      connection.append(endpoints,element("p",relationLabel+interval,"trace-error-connection-caption"),
        element("p",`${evidenceLabels[link.evidence]||"Связь по данным trace требует проверки"} · уверенность: ${confidenceLabel}`,"trace-error-connection-evidence"));
      (index<4?connectionList:connectionMore).append(connection);
    }
    if(links.length){block.append(connectionList);if(links.length>4)block.append(connectionMore);}
    else block.append(element("p","Связи между ошибками не установлены. Нужны совместимые причины или совпавшие сообщения исключения; одного времени или общего названия ResponseCodeException недостаточно.","trace-error-no-connections"));
    block.append(element("h5","События по времени"));
    block.append(element("p","№ — номер события в этом разборе. Первая среди найденных записей не обязательно является первопричиной.","hint"));
    const earliest=new Set(timeline.firstObservedIds||[]);
    const list=element("ol",undefined,"trace-error-event-list");
    const more=element("details"),rest=element("ol",undefined,"trace-error-event-list");rest.start=9;more.append(element("summary","Ещё события ("+Math.max(0,timeline.events.length-8)+")"),rest);
    let index=0;
    for(const event of events){
      const row=element("li",undefined,"trace-error-event");
      const first=earliest.has(event.id),link=incoming.get(event.id),linked=Boolean(link);
      row.dataset.relation=first?"first":linked?"linked":"unlinked";
      const number=element("span",String(positions.get(event.id)),"trace-error-event-number");number.setAttribute("aria-label",`Событие №${positions.get(event.id)}`);
      const body=element("div",undefined,"trace-error-event-body"),heading=element("div",undefined,"trace-error-event-heading");
      heading.append(element("strong",event.service||"Сервис не определён"));
      const date=Number.isFinite(event.at)?new Date(event.at):null,validDate=date&&Number.isFinite(date.getTime());
      const time=element("time",validDate?date.toISOString().replace("T"," · ").replace("Z"," UTC"):"Время неизвестно","trace-error-event-time");
      if(validDate)time.dateTime=date.toISOString();
      body.append(heading,time,element("p",event.exceptionType||"Тип исключения не установлен","trace-error-context"));
      const predecessor=linked?byId.get(link.from):null;
      const relatedLabel=link?.kind==="relogged"?"Вероятно, повторная запись события":link?.kind==="similar"?"Возможно, та же ошибка, что в событии":"Вероятно, продолжение события";
      const label=first?"Первая среди найденных":linked?`↳ ${relatedLabel} №${positions.get(predecessor.id)} · ${predecessor.service}`:"Связь с предыдущими ошибками не установлена";
      body.append(element("p",label,"trace-error-event-label"));
      const group=groups[event.groupIndex],evidence=event.eventKey?(group?.evidence||[]).find(entry=>entry.eventKey===event.eventKey):null;
      if(evidence?.stack){
        const stack=evidence.stack;
        body.append(element("code",`${stack.method}(${stack.file}:${stack.line})`,"trace-error-event-method"));
        if(stack.partial)body.append(element("span","Метод из начала стека; окончание не разобрано","trace-error-context"));
        else body.append(element("span",stack.role==='enclosing-exception'?"Метод внешнего исключения; исходный вызов не установлен":stack.role==='reactor-assembly'?"Место сборки реактивной операции":stack.role==='original-stack'?"Метод из Original Stack Trace":"Метод в стеке; дефект этого метода не установлен","trace-error-context"));
      }
      if(event.sourceAvailable&&openGroup&&group){
        const details=element("button",evidence?.stack?"Метод и объяснение ↓":"Описание ошибки ↓","trace-error-method-link");details.type="button";
        details.addEventListener("click",()=>openGroup(event.groupIndex));body.append(details);
      }else if(event.sourceAvailable)body.append(element("span","Стек доступен в описании причины ниже","trace-error-context"));
      row.append(number,body);
      (index++<8?list:rest).append(row);
    }
    block.append(list);if(timeline.events.length>8)block.append(more);
    if(timeline.tiedTimestampCount)block.append(element("p","Одинаковое время у части событий: их взаимный порядок не определён.","hint"));
    if(timeline.unknownTimestampCount)block.append(element("p","Без времени: "+timeline.unknownTimestampCount+". Они не участвуют в выборе первой записи.","hint"));
    if(timeline.ambiguousLinkCount)block.append(element("p","Для части ошибок есть несколько возможных предшественников. Однозначная связь не выбрана.","hint"));
    if(timeline.orderConflictCount)block.append(element("p","Время противоречит направлению части span-связей. Такие ошибки не соединены; проверьте синхронизацию часов.","hint"));
    if(timeline.incomplete)block.append(element("p",Number.isFinite(timeline.observedEventCount)
      ? `Ошибок в загруженных данных: ${timeline.observedEventCount}. В хронологии: ${timeline.shownEventCount}; не показано: ${timeline.omittedEventCount}. Показаны самые ранние события с известным временем. Выборка может быть неполной.`
      : "Хронология ограничена полученной выборкой и лимитом событий.","hint"));
    panel.append(block);
  }

  function render(panel, report, options={}) {
    panel.replaceChildren(element("h3", "Разбор ошибок traceId"));
    if (!report?.available) {
      panel.append(element("p", "Анализ недоступен для сохранённого результата. Повторите поиск после обновления расширения.", "hint")); return;
    }
    panel.append(element("p", `В полученных ${report.scanned} сообщениях: level:3 — ${report.events}, распознано — ${report.recognized}, причина не распознана — ${report.unknown}. ${report.truncated ? "Выдача ограничена: часть ошибок может отсутствовать. " : ""}Дополнительных запросов и сравнения с историей нет.`, "hint"));
    const help = element("details"); help.append(element("summary", "Как определяется приоритет и характер ошибки?"));
    help.append(element("p", "Приоритет — рекомендация для проверки, а не оценка масштаба инцидента. Источник ответа и характер ошибки определяются отдельно. HTTP 5xx у внешней системы — системный сбой; HTTP 400 — повод проверить запрос и контракт. Бизнес-отказ требует известного кода. Неизвестные причины не угадываются. Сырые тексты, SQL и стек не выводятся. Метод, причина из Caused by и контекст Reactor показаны раздельно: строка стека сама по себе не доказывает дефект метода.", "hint"));
    if (!report.events) {panel.append(help);return;}
    if(options.timeline!==false)renderTimeline(panel,report.timeline,report.groups,openGroup);
    panel.append(help);
    const tools = element("div", undefined, "trace-error-tools");
    const label = element("label", "Приоритет проверки ");
    const filter = element("select"); filter.setAttribute("aria-label", "Приоритет проверки ошибок trace");
    for (const [value, text] of [["all", "Все"], ...Object.entries(priorities)]) {
      const option = element("option", text); option.value=value; filter.append(option);
    }
    label.append(filter); tools.append(label);
    const count = element("span", "", "hint"); tools.append(count); panel.append(tools);
    const list = element("div"); panel.append(list);
    const more = element("button", "Показать все причины", "secondary compact"); more.type="button"; panel.append(more);
    const groups = [...(report.groups || [])].sort((a,b) => (ranks[a.priority] ?? 3) - (ranks[b.priority] ?? 3) || b.count-a.count);
    const cards=new Map();
    let expanded = false;
    function draw() {
      const selected = groups.filter(item => filter.value === "all" || item.priority === filter.value);
      const shown = expanded ? selected : selected.slice(0, 5);
      count.textContent = `Показано причин: ${shown.length} из ${selected.length}`;
      list.replaceChildren();
      cards.clear();
      for (const item of shown) {
        const card = element("details", undefined, "trace-error-entry");
        cards.set(item,card);
        const summary = element("summary");
        summary.append(element("strong", item.title || "Причина не распознана"));
        summary.append(element("span", `Приоритет: ${priorities[item.priority] || priorities.unknown}`, `trace-error-priority ${Object.hasOwn(priorities,item.priority) ? item.priority : "unknown"}`));
        summary.append(element("span", `${item.system ? `${item.system} → ` : ""}${item.service} · ${item.natureLabel} · событий: ${item.count}`, "trace-error-context"));
        card.append(summary);
        card.append(element("p", `spanId: ${item.spanId || "не указан"}`, "trace-error-context"));
        card.append(element("p", TraceErrors.describe(item)));
        card.append(element("p", item.explanation));
        const sources=(item.evidence || []).filter(evidence=>evidence.sourceField||evidence.httpCall).slice(0,8);
        if(sources.length){
          const evidenceBlock=element("div",undefined,"trace-error-sources");
          evidenceBlock.append(element("strong","Что видно в стеке"));
          const unique=[...new Map(sources.map(evidence=>[JSON.stringify([evidence.sourceField,evidence.stack,evidence.exceptionSite,evidence.httpCall]),evidence])).values()];
          for(const evidence of unique){
            if(evidence.sourceField)evidenceBlock.append(element("p",`Поле: ${evidence.sourceField}`,"trace-error-context"));
            const hasHttp=renderHttpCall(evidenceBlock,evidence.httpCall,item.service);
            renderStackMeaning(evidenceBlock,evidence,hasHttp);
          }
          card.append(evidenceBlock);
        }
        if (item.meaning) card.append(element("p", `Что означает: ${item.meaning}`));
        if (item.causes?.length) card.append(element("p", `Возможные причины (не подтверждены): ${item.causes.join("; ")}`));
        card.append(element("p", `Почему такой приоритет: ${item.reason}`));
        card.append(element("p", `Что проверить: ${item.recommendation}`));
        if (item.checks?.length) {
          const checks = element("ul");
          for (const check of item.checks) checks.append(element("li", check));
          card.append(checks);
        }
        // Sources are fixed reference links; never construct a URL from trace content.
        const reference = globalThis.ErrorReference?.entries?.find(entry => entry.id === item.referenceId);
        if (reference?.source) {
          const source = element("a", "Документация: значение ошибки");
          source.href = reference.source; source.target = "_blank"; source.rel = "noopener noreferrer"; source.referrerPolicy = "no-referrer";
          card.append(source);
        }
        card.append(element("p", `Правило: ${item.matchedRule || "не найдено"}. Уверенность распознавания: ${{high:"высокая",medium:"средняя",low:"низкая"}[item.confidence] || "низкая"}.`, "hint"));
        list.append(card);
      }
      if (!selected.length) list.append(element("p", "Причин с этим приоритетом в полученных данных нет.", "hint"));
      more.hidden = selected.length <= 5;
      more.textContent = expanded ? "Свернуть до 5 причин" : `Показать все причины (${selected.length})`;
    }
    filter.addEventListener("change", () => { expanded=false; draw(); });
    more.addEventListener("click", () => { expanded=!expanded; draw(); });
    function openGroup(index) {
      const group=report.groups?.[index];if(!group)return;
      filter.value="all";expanded=true;draw();
      const card=cards.get(group);if(!card)return;
      card.open=true;card.scrollIntoView({block:"start",behavior:"auto"});
      card.querySelector("summary")?.focus({preventScroll:true});
    }
    draw();
    return {openGroup};
  }
  function downloadTextFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function buildTraceReviewMarkdown(review, diagram) {
    const esc = value => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    const lines = [];
    const push = (line = "") => lines.push(line);
    push("# Разбор трейса");
    push("");
    push(`Экспортировано: ${new Date().toISOString()}`);
    push(`Span: ${review.spanCount} · Сервисов: ${review.serviceCount}${review.partial ? " · выдача неполная, часть данных могла быть отброшена" : ""}`);
    push("");
    push(`- Ошибок level:3: ${review.errorEvents ?? "—"}`);
    push(`- Медленных вызовов (> ${review.thresholdMs} мс): ${review.slowCalls.length}`);
    push(`- Повторных URI: ${review.repeated.length}`);
    push(`- Неполных пар REQUEST/RESPONSE: ${review.incomplete.length}`);
    push("");
    const table = (title, items, columns, row) => {
      push(`## ${title} (${items.length})`);
      push("");
      if (!items.length) { push("Нет данных."); push(""); return; }
      push(`| ${columns.join(" | ")} |`);
      push(`| ${columns.map(() => "---").join(" | ")} |`);
      for (const item of items) push(`| ${row(item).map(esc).join(" | ")} |`);
      push("");
    };
    table("Медленные вызовы", review.slowCalls, ["Сервис", "Тип", "Длительность, мс", "spanId"],
      item => [item.service, item.label, item.durationMs, item.spanId || "—"]);
    table("Повторные URI", review.repeated, ["Отправитель", "URI", "Повторов"],
      item => [item.callerService || item.service || "—", item.url, item.count]);
    table("Неполные пары REQUEST / RESPONSE", review.incomplete, ["Сервис", "Тип", "spanId", "Отсутствует"],
      item => [item.service, item.label, item.spanId || "—", [item.missingRequest ? "REQUEST" : "", item.missingResponse ? "RESPONSE" : ""].filter(Boolean).join(", ")]);
    table("Возможные разрывы span", review.recovered, ["Сервис", "REQUEST span", "RESPONSE span(ы)"],
      item => [item.service, item.spanId, (item.responseSpanIds || []).join(", ")]);
    table("Взаимодействие сервисов", review.interactions, ["Из", "В", "Тип", "Основание"],
      item => [item.fromService, item.toService, item.kind === "kafka" ? "KAFKA PRODUCE" : `${item.requestObserved ? "REQUEST" : "нет REQUEST"} / ${item.responseObserved ? "RESPONSE" : "нет RESPONSE"}`, item.evidence || "—"]);
    const groups = diagram?.errorAnalysis?.groups || [];
    push(`## Ошибки и объяснения (${groups.length})`);
    push("");
    if (!groups.length) push("Нет распознанных причин.");
    for (const item of groups) {
      push(`### ${esc(item.title || "Причина не распознана")} — приоритет: ${item.priority || "unknown"}`);
      push("");
      push(`- Сервис: ${esc(item.service)}${item.system ? ` (${esc(item.system)})` : ""} · событий: ${item.count}`);
      if (item.spanId) push(`- spanId: ${esc(item.spanId)}`);
      if (item.reason) push(`- Почему: ${esc(item.reason)}`);
      if (item.recommendation) push(`- Что проверить: ${esc(item.recommendation)}`);
      if (item.matchedRule) push(`- Правило: ${esc(item.matchedRule)} · уверенность: ${esc(item.confidence)}`);
      push("");
    }
    push("## Ограничения");
    push("- Порядок по времени наблюдения не доказывает причинную связь.");
    push("- Количество level:3 — события журнала, а не число независимых сбоев.");
    push("- Повторы сервиса сами по себе не считаются повтором URI.");
    return lines.join("\n");
  }
  function dialogContent(dialog, title) {
    const header = element("div", undefined, "trace-dialog-header");
    const heading = element("h2", title); heading.id="trace-review-title";
    const close = element("button", "Закрыть"); close.type="button"; close.autofocus=true; close.addEventListener("click", () => dialog.close());
    header.append(heading, close);
    const content = element("section", undefined, "trace-dialog-body");
    content.tabIndex=0; content.setAttribute("aria-label", title);
    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.replaceChildren(header, content);
    return content;
  }
  function showDialog(report) {
    let dialog = document.querySelector("#trace-error-dialog");
    if (!dialog) { dialog = element("dialog", undefined, "trace-error-dialog"); dialog.id="trace-error-dialog"; document.body.append(dialog); }
    dialog.classList.remove("trace-review-dialog");
    const content = dialogContent(dialog, "Разбор ошибок traceId"); render(content, report);
    content.querySelector("h3")?.remove(); dialog.showModal();
    globalThis.Clippy?.show?.("analysis");
  }
  function configureButton(button, diagram) {
    const review = globalThis.TraceReview?.analyze(diagram);
    if (review) globalThis.Clippy?.setTraceReview?.({
      verdict:globalThis.ClippyState?.traceVerdict(review) || "unknown",
      finding:globalThis.ClippyState?.traceFinding(diagram?.errorAnalysis,globalThis.ErrorReference?.entries),
      open:()=>showTraceDialog(diagram)
    });
    const count = review?.errorEvents ?? "нет данных";
    const priority = review?.priority || "unknown";
    const label = priority === "none" ? "Замечаний в полученных данных нет" : `Приоритет проверки: ${priorities[priority]}`;
    button.classList.add("trace-error-action"); button.dataset.priority = priority;
    button.hidden = !diagram;
    const icon = element("span", priority === "none" ? "✓" : "!", "trace-error-action-icon"); icon.setAttribute("aria-hidden", "true");
    const content = element("span", undefined, "trace-error-action-content");
    content.append(element("strong", "Разбор трейса →"), element("small", `${label} · Ошибок: ${count}`));
    button.replaceChildren(icon, content);
    button.title = "Взаимодействие сервисов, медленные вызовы, повторные URI, неполные пары и объяснения ошибок. Цвет — приоритет проверки, не масштаб инцидента.";
    button.setAttribute("aria-label", `Разбор трейса. ${label}. Ошибок: ${count}. Открыть пояснения`);
    button.setAttribute("aria-haspopup", "dialog");
  }
  function showTraceDialog(diagram) {
    const review = globalThis.TraceReview?.analyze(diagram);
    if (!review) return;
    let dialog = document.querySelector("#trace-error-dialog");
    if (!dialog) { dialog = element("dialog", undefined, "trace-error-dialog"); dialog.id="trace-error-dialog"; document.body.append(dialog); }
    dialog.classList.add("trace-review-dialog");
    dialog.onclose = () => globalThis.Clippy?.show?.("idle");
    const content = dialogContent(dialog, "Разбор трейса");
    const exportButton = element("button", "Экспорт · Markdown", "secondary compact trace-review-export");
    exportButton.type = "button";
    exportButton.addEventListener("click", () => {
      const traceId = /traceId\s*:\s*"([a-z0-9_-]{1,128})"/i.exec(String(diagram?.query || ""))?.[1] || "trace";
      downloadTextFile(`${traceId}-review-${new Date().toISOString().replace(/[:.]/g, "-")}.md`, buildTraceReviewMarkdown(review, diagram), "text/markdown;charset=utf-8");
    });
    dialog.querySelector(".trace-dialog-header")?.insertBefore(exportButton, dialog.querySelector(".trace-dialog-header button:last-child"));
    content.append(element("p", `${review.spanCount} span · ${review.serviceCount} сервисов. Только полученные данные, без дополнительных запросов.`, "hint"));
    if (review.partial) content.append(element("p", "Выдача неполная: часть взаимодействий и ошибок может отсутствовать.", "trace-review-warning"));
    const stats = element("div", undefined, "trace-review-stats");
    for (const [label,value] of [["Ошибок level:3",review.errorEvents],["Медленных вызовов",review.slowCalls.length],["Повторных URI",review.repeated.length],["Неполных пар",review.incomplete.length]]) {
      const stat = element("div"); stat.append(element("strong", value === null ? "—" : String(value)),element("span", label)); stats.append(stat);
    }
    content.append(stats);
    let errorsController;
    const errorsSection=element("details",undefined,"trace-review-section"); errorsSection.open=review.errorEvents>0;
    renderTimeline(content,diagram.errorAnalysis?.timeline,diagram.errorAnalysis?.groups,index=>{errorsSection.open=true;errorsController?.openGroup(index);});
    const section = (title,items,format,empty,open=false) => {
      const block=element("details",undefined,"trace-review-section"); block.open=open;
      block.append(element("summary",`${title} · ${items.length}`));
      const addItems=(target,rows)=>{const list=element("ul"); for(const row of rows) list.append(element("li",format(row))); target.append(list);};
      if(items.length) {
        addItems(block,items.slice(0,8));
        if(items.length>8) {const rest=element("details");rest.append(element("summary",`Ещё ${items.length-8}`));addItems(rest,items.slice(8));block.append(rest);}
      } else block.append(element("p",empty,"hint"));
      content.append(block); return block;
    };
    const evidenceLabels = {"parent-span":"связь по родительскому span","recovered-response":"предполагаемая восстановленная пара","kafka-timestamp":"связь по времени Kafka","duration-window":"предположение по времени и длительности",interval:"предположение по временному интервалу","single-timestamp":"предположение по единственному времени",inferred:"предполагаемая связь"};
    const interaction=section("Взаимодействие сервисов",review.interactions,item=>`${item.fromService} → ${item.toService} · ${item.kind === "kafka" ? "KAFKA PRODUCE" : `${item.requestObserved ? "REQUEST" : "REQUEST не найден"} · ${item.responseObserved ? "RESPONSE" : "RESPONSE не найден"}`} · ${evidenceLabels[item.evidence] || "связь по данным trace"}`,"Межсервисные связи в полученной части не найдены.");
    interaction.append(element("p",`Kafka produce: ${review.kafkaCount}; обращений к кешу: ${review.cacheCount}. Порядок по времени наблюдения не доказывает последовательное выполнение. Вложенные длительности не складываются.`,"hint"));
    section("Сервисы в полученных span",review.serviceCounts,item=>`${item.service} · span: ${item.spanCount} · записей REQUEST: ${item.requestEvents}, RESPONSE: ${item.responseEvents}`,"Сервисы не определены.");
    section(`Медленные вызовы — больше ${review.thresholdMs} мс`,review.slowCalls,item=>`${item.service} · ${item.label} · ${item.durationMs} мс · span: ${item.spanId || "не указан"}`,"Превышений среди известных длительностей не найдено.",review.slowCalls.length>0);
    section("Повторные URI — требует проверки",review.repeated,item=>`${item.callerService || item.service || "Отправитель не установлен"} · ${item.url} · REQUEST ×${item.count}`,"Повторных URI в полученных данных не найдено.",review.repeated.length>0);
    section("Неполные пары REQUEST / RESPONSE",review.incomplete,item=>`${item.service} · ${item.label} · span: ${item.spanId || "не указан"} · ${[item.missingRequest ? "Нет REQUEST" : "",item.missingResponse ? "Нет RESPONSE" : ""].filter(Boolean).join("; ")}`,"Неполных пар не найдено.");
    section("Возможные разрывы span",review.recovered,item=>`${item.service} · REQUEST span: ${item.spanId} · RESPONSE span: ${(item.responseSpanIds || []).join(", ")} · восстановленная пара требует проверки логирования`,"Восстановленных пар нет.");
    errorsSection.append(element("summary",`Ошибки и объяснения · ${review.errorEvents ?? "нет данных"}`));
    const errors=element("section"); errorsController=render(errors,diagram.errorAnalysis,{timeline:false}); errorsSection.append(errors); content.append(errorsSection);
    dialog.showModal();
    globalThis.Clippy?.show?.("analysis");
  }
  globalThis.TraceErrorView = { render, showDialog, showTraceDialog, configureButton };
})();
