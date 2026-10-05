(function initializeTraceErrors(root) {
  "use strict";
  const businessApi = typeof module !== "undefined" && module.exports
    ? require("./business-error-rules")
    : root.BusinessErrorRules;
  const chainApi = typeof module !== "undefined" && module.exports ? require("./exception-chain") : root.GraylogExceptionChain;
  const timelineApi = typeof module !== "undefined" && module.exports ? require("./trace-error-timeline") : root.TraceErrorTimeline;
  const names = {
    "http.not_found": "HTTP: ресурс не найден", "http.input_unreadable": "HTTP: не удалось прочитать запрос",
    "http.system_error": "HTTP: системная ошибка", "client.request_not_found": "Клиент: запрос не найден",
    "db.numeric_overflow": "SQL: переполнение числового поля", unknown: "Причина не распознана"
  };
  const scalar = value => Array.isArray(value) ? value[0] : value;
  function explicitBusinessCode(value) {
    if (typeof value !== "string") return "";
    const normalized = value.trim().toUpperCase();
    return /^[A-Z][A-Z0-9_]{1,63}$/.test(normalized) ? normalized : "";
  }

  function responseBodyCode(text, responseHeader) {
    if (!responseHeader) return "";
    const bodyAt = /\bRESPONSE BODY\s*:\s*(?=\{)/i.exec(text);
    if (!bodyAt) return "";
    try {
      const body = JSON.parse(text.slice(bodyAt.index + bodyAt[0].length));
      return body && typeof body === "object" && !Array.isArray(body)
        ? explicitBusinessCode(body.errorCode)
        : "";
    } catch {
      return ""; // Incomplete or non-JSON bodies provide no evidence.
    }
  }

  // Only a top-level errorCode field or an exact errorCode in a JSON RESPONSE BODY
  // is evidence. A 4xx response, level=FAIL, nested JSON, or arbitrary prose is not.
  function responseContext(record, event) {
    const fields = record?.message && typeof record.message === "object" ? record.message : record;
    const text = typeof fields?.message === "string" ? fields.message.slice(0, 2048) : "";
    const responseHeader = /^\s*(?:(OPENAPI(?:\s+\d+(?:\.\d+)*)?|GOROD[_ ]CLIENT|PARTNER[_ ]BACKEND|[A-Z][A-Z _.-]{0,48} CLIENT)\s+)?RESPONSE\s*:/i.exec(text);
    const sourceLabel = responseHeader?.[1] || "";
    const system = /^OPENAPI/i.test(sourceLabel)
      ? "OPENAPI"
      : /^GOROD/i.test(sourceLabel)
        ? "GOROD"
        : sourceLabel ? "Внешняя система" : "";

    const fieldCode = explicitBusinessCode(fields?.errorCode);
    const bodyCode = responseBodyCode(text, responseHeader);
    const conflictingCodes = Boolean(fieldCode && bodyCode && fieldCode !== bodyCode);
    const conflict = event.classification === "conflict" || conflictingCodes;
    const businessRule = businessApi?.get(fieldCode) || businessApi?.get(bodyCode);
    const code = businessRule?.code || "";
    const status = event.responseStatus;
    let nature = "unknown";
    let natureLabel = "Характер ошибки не определён";
    let explanation = "Недостаточно признаков; один trace не определяет влияние на пользователей.";
    if (!conflict) {
      if (status >= 500) {
        nature = "system";
        natureLabel = "Системная ошибка";
        explanation = system
          ? "Внешняя система вернула HTTP 5xx. Это не доказывает сбой самого вызывающего сервиса."
          : "Зафиксирован HTTP 5xx; место возникновения требует проверки по trace.";
      } else if (businessRule) {
        nature = "business";
        natureLabel = "Бизнес-отказ по коду";
        explanation = `${businessRule.title}: ${businessRule.meaning} Классификация по точному коду ${code}.`;
      } else if (status === 400) {
        nature = "contract";
        natureLabel = "Запрос отклонён: проверить контракт";
        explanation = "HTTP 400: проверьте параметры, формат и правила валидации. Код ответа сам по себе не доказывает, какая сторона нарушила контракт.";
      } else if (status === 401 || status === 403) {
        nature = "access";
        natureLabel = "Аутентификация или доступ";
        explanation = "Проверьте контекст авторизации и права вызова; это не подтверждение бизнес-отказа.";
      } else if (status >= 400) {
        nature = "rejection";
        natureLabel = "Запрос отклонён";
        explanation = "Ответ HTTP 4xx без известного бизнес-кода: причина требует уточнения.";
      }
    }
    return {
      system,
      nature,
      natureLabel,
      explanation,
      businessCode: code || null,
      businessTitle: businessRule?.title || null,
      businessPriority: businessRule?.priority || null,
      conflict
    };
  }
  function collector(records, total) {
    const classifier = root.ErrorAnalysis;
    if (!classifier?.classifyError) return null;
    const groups = new Map();
    const requestIndex=new Map(),httpPending=new Map();
    let events = 0, recognized = 0;
    const list = Array.isArray(records) ? records : [];
    const fieldsOf=record=>record&&Object.hasOwn(record,'level')?record:record?.message&&typeof record.message==='object'?record.message:record;
    const stringField=(fields,key,alias)=>{const value=scalar(fields?.[key]??fields?.[alias]);return typeof value==='string'?value:'';};
    const firstStringField=(fields,names)=>{for(const name of names){const value=stringField(fields,name).trim().slice(0,160);if(value)return value;}return '';};
    const scope=(fields,call)=>{
      const service=firstStringField(fields,['service-name','service_name','serviceName','service','instance-name']),span=stringField(fields,'spanId','span_id');
      return service&&span?JSON.stringify([service,span,call.method,call.path]):null;
    };
    function indexRequest(record) {
      const fields=fieldsOf(record),call=chainApi?.requestCall?.(fields);if(!call)return;
      const key=scope(fields,call);if(!key)return;
      const bucket=requestIndex.get(key)||{rows:[],overflow:false};
      if(bucket.rows.length<8)bucket.rows.push({origin:call.origin,trace:stringField(fields,'traceId','trace_id'),eventKey:chainApi.eventKey(fields),navigationKey:chainApi.navigationKey(fields,record)});else bucket.overflow=true;
      requestIndex.set(key,bucket);
    }
    function resolveHttp() {
      for(const pending of httpPending.values()){
        const {evidence,calls,fields}=pending,call=calls[0];
        const detail={method:calls.length===1?call.method:null,target:calls.length===1?chainApi.httpTargetLabel(call.target):null,kind:call.kind,relation:calls.length>1?'ambiguous':'unmatched-context',requestEventKey:null,requestNavigationKey:null};
        if(calls.length===1){
          const bucket=requestIndex.get(scope(fields,call)),trace=stringField(fields,'traceId','trace_id');
          const matches=bucket?.rows.filter(row=>(!row.origin||!call.origin||row.origin===call.origin)&&(!row.trace||!trace||row.trace===trace))||[];
          if(bucket?.overflow||matches.length>1)detail.relation='ambiguous';
          else if(matches.length===1){detail.relation='matched-request';detail.requestEventKey=matches[0].eventKey;detail.requestNavigationKey=matches[0].navigationKey;}
        }
        evidence.httpCall=detail;
      }
    }
    function add(record) {
      indexRequest(record); // Header-only index, built once; no error × records scan.
      const event = classifier.classifyError(record);
      if (!event) return; // Outer level:3 only; successful payloads are not parsed.
      const fields = record?.message && typeof record.message === "object" ? record.message : record;
      const sourceEvidence = chainApi?.sourceEvidence(fields,record);
      // Classify validated headers from the same event's full stack; never pass
      // full_message payloads or stack frames into the report/catalogue.
      const stackSource=chainApi?.stackSource(fields);
      const stackHeaders=stackSource && stackSource.field!=='message'
        ? chainApi.primaryHeaders(stackSource.text).map((entry,index)=>(index?'Caused by: ':'')+entry.name+': '
          + (entry.name.endsWith('ResponseCodeException')?'':entry.diagnostic.replace(/^\s*:\s*/,''))).join('\n') : '';
      const catalogRecord = stackHeaders ? {...fields,message:stackHeaders} : record;
      const catalogResult = root.TraceErrorCatalog?.classify(catalogRecord);
      const catalog = root.ErrorReference?.classify(catalogRecord, catalogResult) || catalogResult;
      let evidenceConflict = event.classification === "conflict" || catalog?.matchedRule === "conflicting_evidence";
      let specific = catalog && catalog.priority !== "unknown" && !evidenceConflict;
      if (evidenceConflict) event.classification = "conflict";
      const response = responseContext(record, event);
      if (response.conflict) {
        evidenceConflict = true;
        specific = false;
        event.classification = "conflict";
      }
      const technicalCategory = ["sql", "database", "java", "runtime", "system", "postgres", "oracle", "redis", "network", "spring"].includes(catalog?.category);
      const technicalWebFlux = ["webflux.server_error", "webflux.client_request"].includes(catalog?.referenceId);
      const responseCodeException = specific && catalog.exceptionType === "ResponseCodeException";
      if (specific && response.nature === "business" && (technicalCategory || technicalWebFlux) && !responseCodeException) {
        evidenceConflict = true; specific = false; event.classification = "conflict";
        response.conflict = true; response.nature = "unknown"; response.natureLabel = "Противоречивые признаки";
        response.explanation = "Одновременно распознаны техническое исключение и код бизнес-отказа; характер события требует проверки.";
      }
      events++;
      const spanValue = scalar(fields?.spanId ?? fields?.span_id);
      const rawSpan = typeof spanValue === "string" || (typeof spanValue === "number" && Number.isFinite(spanValue)) ? String(spanValue) : "";
      const spanId = /^[a-z0-9_-]{1,128}$/i.test(rawSpan) ? rawSpan : "";
      const detail = {
        service:event.service, spanId, errorType: evidenceConflict ? "unknown" : specific ? catalog.errorType : names[event.errorType] ? event.errorType : "unknown",
        errorCode:event.errorCode, responseStatus:event.responseStatus, causeStatus:event.causeStatus,
        exceptionType:specific ? catalog.exceptionType : event.exceptionType,
        classification:specific ? "recognized" : event.classification, truncated:event.truncated || Boolean(catalog?.truncated),
        title:evidenceConflict ? "Противоречивые признаки ошибки" : specific ? catalog.title : names[event.errorType] || names.unknown,
        priority:specific ? catalog.priority : event.classification === "recognized" ? "medium" : "unknown",
        confidence:specific ? catalog.confidence : event.classification === "recognized" ? "medium" : "low",
        reason:specific ? catalog.reason : event.classification === "recognized" ? "Распознан тип ошибки по HTTP-статусу и разрешённым признакам. Масштаб влияния по одному trace неизвестен." : "В справочнике нет достаточных признаков для определения причины и приоритета.",
        recommendation:specific ? catalog.recommendation : "Проверьте соответствующий span и контекст вызова в Graylog.",
        sqlState:specific ? catalog.sqlState : null, matchedRule:specific ? catalog.matchedRule : event.errorType,
        category:specific ? catalog.category : "http",
        oracleCode:specific ? catalog.oracleCode || null : null,
        referenceId:specific ? catalog.referenceId || null : null,
        meaning:specific ? catalog.meaning || "" : "",
        causes:specific && Array.isArray(catalog.causes) ? [...catalog.causes] : [],
        checks:specific && Array.isArray(catalog.checks) ? [...catalog.checks] : [],
        source:specific ? catalog.source || null : null,
        ...response
      };
      if (responseCodeException) {
        detail.exceptionMessage=root.TraceErrorCatalog.safeResponseText(catalog.exceptionMessage);
        if (catalog.responseCode) detail.errorCode=catalog.responseCode;
      }
      if (response.businessCode && !response.conflict && response.nature === "business" && !responseCodeException) {
        detail.title = response.businessTitle || response.explanation.split(". ")[0]; detail.errorCode=response.businessCode;
        detail.priority=response.businessPriority || "low"; detail.reason="Ответ содержит известный код бизнес-отказа; проверьте ожидаемость такого результата для сценария.";
        detail.classification="recognized"; detail.confidence="medium"; detail.matchedRule=`business.${response.businessCode}`;
        detail.recommendation="Сверьте бизнес-условия операции и корректность обработки отказа вызывающим сервисом.";
      }
      if (response.nature === "unknown" && !response.conflict && specific && !responseCodeException && ["sql", "database", "java", "runtime", "system", "postgres", "oracle", "redis", "network", "spring", "webflux"].includes(catalog.category)) {
        detail.nature="system"; detail.natureLabel="Техническая ошибка"; detail.explanation="Распознано техническое исключение. Влияние на операцию требует проверки по trace.";
      }
      if (detail.classification === "recognized") recognized++;
      if (responseCodeException) {
        detail.nature="application"; detail.natureLabel="Исключение приложения"; detail.explanation=catalog.reason;
        if(stackHeaders){detail.reason="В поле стека распознан класс ResponseCodeException. Его текст и фактическая причина проверяются в исходном событии Graylog.";detail.explanation=detail.reason;}
      }
      const key = JSON.stringify(detail);
      if (!groups.has(key)) groups.set(key, { ...detail, count:0, evidence:[],timelineEvidence:[],firstAt:null,lastAt:null });
      const group=groups.get(key); group.count++;
      if(sourceEvidence) {
        const compare=(a,b)=>(a.at===null)-(b.at===null)||(a.at??0)-(b.at??0)||String(a.eventKey||'').localeCompare(String(b.eventKey||''));
        if(sourceEvidence.at!==null){group.firstAt=group.firstAt===null?sourceEvidence.at:Math.min(group.firstAt,sourceEvidence.at);group.lastAt=group.lastAt===null?sourceEvidence.at:Math.max(group.lastAt,sourceEvidence.at);}
        group.timelineEvidence.push(sourceEvidence);group.timelineEvidence.sort(compare);group.timelineEvidence.length=Math.min(group.timelineEvidence.length,40);
        group.evidence.push(sourceEvidence);group.evidence.sort(compare);
        if(group.evidence.length>8)httpPending.delete(group.evidence.pop());
        for(const field of group.evidence.includes(sourceEvidence)?chainApi.SOURCE_FIELDS:[]){
          const value=scalar(fields?.[field]);
          if(typeof value!=='string')continue;
          // outgoingHttp performs its own bounded ownership checks. This also
          // preserves a generated WebClientResponseException header when the
          // server omitted frames, while generic HTTP lines still require an
          // actual owned exception stack.
          const calls=chainApi.outgoingHttp(value);if(calls.length){httpPending.set(sourceEvidence,{evidence:sourceEvidence,calls,fields});break;}
        }
      }
    }
    function finish(timeline) {
    resolveHttp();
    const numericTotal = typeof total === "number" || typeof total === "string" ? Number(total) : NaN;
    if(timeline && Number.isFinite(numericTotal) && numericTotal>list.length)timeline.incomplete=true;
    return { available:true, scanned:list.length, events, recognized, unknown:events-recognized,
      truncated:Number.isFinite(numericTotal) && numericTotal > list.length,
      groups:[...groups.values()].map(({timelineEvidence,...group})=>({...group,evidenceOmitted:Math.max(0,group.count-group.evidence.length)})),
      timeline };
    }
    return {list,groups,add,finish};
  }
  const unavailable=()=>({available:false,groups:[]});
  const clock=()=>root.performance?.now?.() ?? Date.now();
  const inputPending=()=>{try{return Boolean(root.navigator?.scheduling?.isInputPending?.());}catch{return false;}};
  function aborted(signal) { if(signal?.aborted){const error=new Error("Анализ отменён");error.name="AbortError";throw error;} }
  function yieldControl(signal) {
    return new Promise((resolve,reject)=>{
      let handle=null, idle=false, done=false;
      const cleanup=()=>{if(handle!==null){if(idle)root.cancelIdleCallback?.(handle);else clearTimeout(handle);}handle=null;signal?.removeEventListener?.('abort',cancel);};
      const cancel=()=>{if(done)return;done=true;cleanup();const error=new Error('Анализ отменён');error.name='AbortError';reject(error);};
      const schedule=()=>{idle=typeof root.requestIdleCallback==='function';handle=idle?root.requestIdleCallback(run,{timeout:200}):setTimeout(run,20);};
      const run=(deadline)=>{handle=null;if(signal?.aborted){cancel();return;}if(inputPending()||(deadline&&!deadline.didTimeout&&deadline.timeRemaining()<1)){schedule();return;}done=true;cleanup();resolve();};
      if(signal?.aborted){cancel();return;}signal?.addEventListener?.('abort',cancel,{once:true});schedule();
    });
  }
  function analyze(records,total) {
    const state=collector(records,total);if(!state)return unavailable();
    for(const record of state.list)state.add(record);
    return state.finish(timelineApi?.build(state.list,[...state.groups.values()]) || null);
  }
  async function analyzeAsync(records,total,{signal}={}) {
    aborted(signal);const state=collector(records,total);if(!state)return unavailable();
    let count=0,started=0;
    for(const record of state.list){
      if(!count||count>=5||clock()-started>=4||inputPending()){await yieldControl(signal);started=clock();count=0;}
      aborted(signal);state.add(record);count++;
    }
    await yieldControl(signal);aborted(signal);
    const timeline=timelineApi?.buildAsync ? await timelineApi.buildAsync(state.list,[...state.groups.values()],{signal,yieldControl}) : timelineApi?.build(state.list,[...state.groups.values()]) || null;
    aborted(signal);return state.finish(timeline);
  }
  function describe(item) {
    const parts = [item.title || names[item.errorType] || names.unknown];
    if (item.responseStatus) parts.push(`HTTP ${item.responseStatus}`);
    if (item.causeStatus) parts.push(`причина: HTTP ${item.causeStatus}`);
    if (item.errorCode && item.errorCode !== "unknown") parts.push(item.errorCode);
    if (item.exceptionType && item.exceptionType !== "unknown" && item.exceptionType !== item.title) parts.push(item.exceptionType);
    if (item.exceptionType === "ResponseCodeException" && item.exceptionMessage) parts.push(root.TraceErrorCatalog.safeResponseText(item.exceptionMessage));
    if (item.sqlState) parts.push(`SQLSTATE ${item.sqlState}`);
    if (item.oracleCode) parts.push(item.oracleCode);
    if (item.classification === "conflict") parts.push("поля и сообщение противоречат друг другу");
    if (item.truncated) parts.push("разобрано начало сообщения");
    return parts.join(" · ");
  }
  const api = { analyze, analyzeAsync, describe };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TraceErrors = api;
})(globalThis);
