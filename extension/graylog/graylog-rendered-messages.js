(function initRenderedMessages(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root.document?.documentElement || !root.MutationObserver) return;
  if (root.GraylogPage && !root.GraylogPage.isSupported(root.document, root.location)) return;
  root.__advancedGraylogRenderedMessages?.dispose?.();
  root.__advancedGraylogRenderedMessages = api.createController(root.document, root.MutationObserver);
})(globalThis, function renderedMessagesModule() {
  "use strict";
  const nodeChain = typeof module !== "undefined" && module.exports ? require("../../lib/graylog/exception-chain") : null;
  // MAIN helpers can be injected again after this controller starts. Never
  // retain an absent/older helper for the lifetime of the page.
  const getChainApi = () => nodeChain || own(globalThis, "GraylogExceptionChain");
  const COMPLETE_EVENT = "advanced-graylog-rendered-message-complete";
  const REQUEST_EVENT = "advanced-graylog-rendered-message-request";
  const UPDATE_EVENT = "advanced-graylog-rendered-message-update";
  const ROW_ATTRIBUTE = "data-advanced-graylog-rendered-message";
  const ROW_SELECTOR = "table > tbody,[data-message-id],.message-row,[data-testid*='message'][data-testid*='row']";
  // Graylog MessageTableEntry (4.3–6.3) owns one tbody and receives
  // props.message.fields even while MessageDetail is not rendered.
  // Read bounded message/table/paginator props only; never walk React state,
  // stores or children. The current native messages array is capped below.
  function own(object, key) {
    if (!object || typeof object !== "object") return undefined;
    try { return Object.getOwnPropertyDescriptor(object, key)?.value; } catch { return undefined; }
  }
  function committedFiber(fiber) {
    let top = fiber;
    for (let depth = 0; depth < 48 && own(top, "return"); depth++) top = own(top, "return");
    const current = own(own(top, "stateNode"), "current");
    return current && current === own(top, "alternate") ? own(fiber, "alternate") || fiber : fiber;
  }
  function messageSnapshot(row) {
    let keys;
    try { keys = Object.getOwnPropertyNames(row).slice(0, 120); } catch { return null; }
    for (const key of keys) {
      if (/^__reactProps\$/.test(key)) {
        const props = own(row, key);
        const fields = own(own(props, "message"), "fields");
        if (fields && typeof fields === "object") return { fields, message:own(props,"message"), expanded: own(props, "expanded") };
      }
      if (!/^__react(?:Fiber|InternalInstance)\$/.test(key)) continue;
      let fiber = committedFiber(own(row, key));
      for (let depth = 0; fiber && depth < 12; depth++, fiber = own(fiber, "return")) {
        // React 16 can reuse a host subtree when an ancestor bails out of
        // rendering. That host has no alternate, but its component parent
        // does. Resolve each ancestor before reading its committed props.
        fiber=committedFiber(fiber);
        const props = own(fiber, "memoizedProps");
        const fields = own(own(props, "message"), "fields");
        if (fields && typeof fields === "object") return { fields, message:own(props,"message"), expanded: own(props, "expanded") };
      }
    }
    return null;
  }
  function messageFields(row) { return messageSnapshot(row)?.fields || null; }
  const PAGE_FIELDS = Object.freeze(['_id','job-name','batchRequestId','thread_name','threadName','timestamp','traceId','trace_id','service-name','service_name','serviceName','service','instance-name','instance-version','spanId','span_id','parentSpanId','parent_span_id','parentSpan','span.kind','spanKind','span_kind','level','duration','durationMs','duration_ms','duration_us','duration_ns','duration_s','initUri','publicUri','message','full_message','stack_trace','stacktrace','stackTrace','exception_stack_trace','exception_stacktrace','exceptionStackTrace','httpStatus','errorCode','exceptionType','exception_type','Terminal-Version','Terminal-Type','logger_name','source','branch','abbrev']);
  // The message table may contain only selected fields while its already open
  // detail table exposes additional metadata. Read a literal field/value pair
  // belonging to this matched message, never search the message/body text.
  function expandedJobName(row) {
    const values=new Set();
    for(const label of Array.from(row.querySelectorAll?.("dt,th,td,[role='rowheader'],[data-testid*='field-name'],.field-name,.field-name-cell")||[]).slice(0,300)){
      if(String(label.textContent||'').trim()!=='job-name')continue;
      const sibling=label.nextElementSibling;
      if(!sibling||!row.contains?.(sibling))continue;
      const value=String(sibling.textContent||'').trim();
      if(value&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value))values.add(value);
    }
    return values.size===1?[...values][0]:null;
  }
  function streamIds(fields,message) {
    const found=[];
    for(const source of [own(message,'stream_ids'),own(message,'streamIds'),own(fields,'stream_ids'),own(fields,'streamIds'),own(fields,'streams'),own(fields,'gl2_streams')]){
      const values=Array.isArray(source)?source:[source];
      for(const value of values){
        if(typeof value!=='string')continue;
        const normalized=value.trim().toLowerCase();
        if(/^[a-f0-9]{24}$/.test(normalized)&&!found.includes(normalized)&&found.length<32)found.push(normalized);
      }
    }
    return found;
  }
  function resultPageEvidence(row) {
    let evidence=null, messages=null;
    let keys;
    try { keys=Object.getOwnPropertyNames(row).slice(0,120); } catch { return null; }
    for(const key of keys){
      if(!/^__react(?:Fiber|InternalInstance)\$/.test(key))continue;
      let fiber=committedFiber(own(row,key));
      for(let depth=0;fiber&&depth<32;depth++,fiber=own(fiber,'return')){
        fiber=committedFiber(fiber);
        const props=own(fiber,'memoizedProps');
        const data=own(props,'data');
        // MessageTable receives messages directly; MessageList owns data.total
        // further up. Do not require both to be present on the same ancestor.
        const list=own(props,'messages')??own(data,'messages');
        if(Array.isArray(list)&&!messages)messages=list;
        const paginatedTotal=own(props,'totalItems'),messageList=Array.isArray(own(data,'messages'));
        const total=paginatedTotal??(messageList?own(data,'total'):undefined);
        const pageSize=own(props,'pageSize')??(messageList?own(data,'messages').length:undefined);
        const activePage=paginatedTotal===undefined?null:own(props,'activePage');
        const numericTotal=Number(total),numericPageSize=Number(pageSize),numericPage=Number(activePage);
        // Graylog 3.1 defaults activePage to 0 for an uncontrolled paginator.
        // It means "page is owned by the paginator", never page zero. The caller
        // can attest the visible DOM page without reading component state.
        const validPaginator=paginatedTotal===undefined?messageList:Number.isSafeInteger(numericPageSize)&&numericPageSize>0&&Number.isSafeInteger(numericPage)&&numericPage>=0;
        if(validPaginator&&Number.isSafeInteger(numericTotal)&&numericTotal>=0&&numericTotal<=1_000_000_000){
          const next={total:numericTotal,pageSize:Number.isSafeInteger(numericPageSize)&&numericPageSize>0?numericPageSize:null,activePage:Number.isSafeInteger(numericPage)&&numericPage>0?numericPage:null,
            messages};
          if(evidence&&evidence.total!==next.total)return null;
          evidence={total:next.total,pageSize:paginatedTotal!==undefined?next.pageSize:evidence?.pageSize??next.pageSize,activePage:next.activePage??evidence?.activePage??null,messages:next.messages??evidence?.messages??null};
          if(paginatedTotal!==undefined&&evidence.messages)return evidence;
        }
      }
    }
    return evidence?{...evidence,messages:messages??evidence.messages}:null;
  }
  async function snapshotTrace(traceId,{signal,document:doc=globalThis.document,queryExact=false,pageNumber=null}={}) {
    if(typeof traceId!=='string'||!/^[a-z0-9_-]{1,128}$/i.test(traceId))throw new Error('Не найден точный traceId');
    const abort=()=>{if(signal?.aborted){const error=new Error('Снимок страницы отменён');error.name='AbortError';throw error;}};
    const pause=()=>new Promise((resolve,reject)=>{
      abort();let handle,idle=typeof globalThis.requestIdleCallback==='function'&&!doc?.hidden;
      const cancelled=()=>{if(idle)globalThis.cancelIdleCallback?.(handle);else clearTimeout(handle);const error=new Error('Снимок страницы отменён');error.name='AbortError';reject(error);};
      const resume=deadline=>{signal?.removeEventListener('abort',cancelled);if(signal?.aborted)return cancelled();if((!doc?.hidden&&globalThis.navigator?.scheduling?.isInputPending?.())||(idle&&deadline.timeRemaining()<2&&!deadline.didTimeout)){pause().then(resolve,reject);return;}resolve();};
      signal?.addEventListener('abort',cancelled,{once:true});handle=idle?globalThis.requestIdleCallback(resume,{timeout:1000}):setTimeout(resume,20);
    });
    const result={messages:[],total_results:0,truncated:false,contentTruncated:false,truncationReasons:[],complete:false,nativePayload:false,completeness:'unproven-query',scope:'current-page',scannedCandidates:0,readableCandidates:0,matchedCount:0,pageMessageCount:0,nativeTotal:null,nativePageSize:null,nativePage:Number.isSafeInteger(pageNumber)&&pageNumber>0?pageNumber:null};
    const incomplete=reason=>{result.truncated=true;if(!result.truncationReasons.includes(reason))result.truncationReasons.push(reason);};
    // Reserve room for identities/routing fields on every message. Long bodies
    // must not consume the whole page budget and hide later message identities.
    const textLimit=count=>Math.min(65536,Math.floor((2*1024*1024-256*1024)/(2*Math.max(1,Math.min(count,200)))));
    if(!doc?.querySelectorAll)return result;
    await pause();
    const candidates=doc.querySelectorAll(ROW_SELECTOR),selected=[],seenObjects=new WeakSet(),seenIds=new Set(),pageObjects=new WeakSet(),pageIds=new Set();
    let nativeMessages=null;
    if(candidates.length>500)incomplete('candidate-limit');
    let bytes=0,sliceAt=Date.now();
    const primitive=value=>typeof value==='string'||typeof value==='number'||typeof value==='boolean';
    const exact=value=>{
      if(Array.isArray(value)){if(own(value,'length')!==1)return '';value=own(value,'0');}
      return typeof value==='string'&&/^[a-z0-9_-]{1,128}$/i.test(value)?value:'';
    };
    for(let index=0;index<Math.min(candidates.length,500);index++){
      if(index%5===0||Date.now()-sliceAt>=4){await pause();sliceAt=Date.now();}abort();
      const row=candidates[index];result.scannedCandidates++;
      if(!row?.isConnected)continue;
      const snapshot=messageSnapshot(row);if(!snapshot)continue;
      result.readableCandidates++;
      const {fields,message}=snapshot,ids=[own(fields,'traceId'),own(fields,'trace_id')].filter(value=>value!==undefined);
      const pageEvidence=resultPageEvidence(row);
      if(pageEvidence){
        for(const [target,value] of [['nativeTotal',pageEvidence.total],['nativePageSize',pageEvidence.pageSize],['nativePage',pageEvidence.activePage]]){
          if(value===null)continue;
          if(result[target]!==null&&result[target]!==value)incomplete('metadata-changed');
          else result[target]=value;
        }
        if(Array.isArray(pageEvidence.messages)){
          if(nativeMessages&&nativeMessages!==pageEvidence.messages)incomplete('result-changed');
          else nativeMessages=pageEvidence.messages;
        }
      }
      const key=getChainApi()?.navigationKey?.(fields,message);
      if(!pageObjects.has(message)&&(!key||!pageIds.has(key))){result.pageMessageCount++;pageObjects.add(message);if(key)pageIds.add(key);}
      if(!ids.length||ids.some(value=>exact(value)!==traceId))continue;
      if(seenObjects.has(message)||key&&seenIds.has(key))continue;
      seenObjects.add(message);if(key)seenIds.add(key);result.matchedCount++;
      if(selected.length>=200||bytes>=2*1024*1024){incomplete('page-limit');continue;}
      const copied={};
      for(const field of PAGE_FIELDS){
        const raw=own(fields,field);if(raw===undefined)continue;
        const copy=value=>{
          if(!primitive(value))return undefined;
          if(typeof value!=='string')return value;
          const body=(getChainApi()?.FIELD_NAMES || ['message','full_message']).includes(field);
          const limit=body?textLimit(candidates.length):['job-name','service-name','service_name','serviceName','service','instance-name','instance-version','branch'].includes(field)?160:2048;
          if(bytes+Math.min(limit,value.length)>2*1024*1024){incomplete('page-limit');return undefined;}
          const part=value.slice(0,limit);bytes+=part.length;
          if(part.length<value.length){if(body)result.contentTruncated=true;else incomplete('field-limit');}
          return part;
        };
        if(Array.isArray(raw)){
          const length=own(raw,'length');if(!Number.isInteger(length)||length>8){incomplete('field-limit');continue;}
          const values=[];for(let i=0;i<length;i++){const value=copy(own(raw,String(i)));if(value!==undefined)values.push(value);}
          if(values.length)copied[field]=values.length===1?values[0]:values;
        }else{const value=copy(raw);if(value!==undefined)copied[field]=value;}
      }
      copied.__graylogIdentityField=['service-name','service_name','serviceName','service'].some(field=>own(fields,field)!==undefined)?'service-name':own(fields,'instance-name')!==undefined?'instance-name':null;
      if(copied['job-name']===undefined){const job=expandedJobName(row);if(job)copied['job-name']=job;}
      if(copied['service-name']===undefined)copied['service-name']=copied.service_name??copied.serviceName??copied.service??copied['instance-name'];
      if(copied.branch===undefined)copied.branch=copied['instance-version'];
      if(copied.spanId===undefined)copied.spanId=copied.span_id;
      if(copied.parentSpanId===undefined)copied.parentSpanId=copied.parent_span_id??copied.parentSpan;
      const nativeId=own(fields,'_id')??own(message,'id'),nativeIndex=own(message,'index');
      if(typeof nativeId==='string'&&nativeId.length<=256)copied._id=nativeId;
      const item={message:copied};if(typeof nativeIndex==='string'&&nativeIndex.length<=256)item.index=nativeIndex;
      const membership=streamIds(fields,message);if(membership.length)item.streamIds=membership;
      selected.push({row,fields,message,item,key});
    }
    // React may have replaced rows while we yielded. Never retain such a row.
    for(let index=0;index<selected.length;index++){
      if(index%5===0){await pause();}abort();
      const candidate=selected[index],current=candidate.row.isConnected&&messageSnapshot(candidate.row);
      const currentIds=current?[own(current.fields,'traceId'),own(current.fields,'trace_id')].filter(value=>value!==undefined):[];
      if(current?.message===candidate.message&&current?.fields===candidate.fields&&currentIds.length&&currentIds.every(value=>exact(value)===traceId)&&getChainApi()?.navigationKey?.(current.fields,current.message)===candidate.key)result.messages.push(candidate.item);else incomplete('rows-changed');
    }
    // Graylog already keeps the bounded native messages response in committed
    // result props. Reading that exact array avoids repeating its expensive
    // offset=0 search merely because only part of the list is currently rendered.
    // This is a bounded read of the current result contract, never a store walk.
    if(queryExact===true&&nativeMessages&&result.nativeTotal!==null&&nativeMessages.length<=200){
      const offset=result.nativePage&&result.nativePageSize?(result.nativePage-1)*result.nativePageSize:0;
      const expected=Math.min(Math.max(0,result.nativeTotal-offset),result.nativePageSize||nativeMessages.length,200);
      const copiedMessages=[];let nativeBytes=0,nativeValid=nativeMessages.length===expected;
      const copyValue=(value,field)=>{
        if(!primitive(value))return undefined;
        if(typeof value!=='string')return value;
        const body=(getChainApi()?.FIELD_NAMES || ['message','full_message']).includes(field);
        const limit=body?textLimit(nativeMessages.length):['job-name','service-name','service_name','serviceName','service','instance-name','instance-version','branch'].includes(field)?160:2048;
        if(nativeBytes+Math.min(limit,value.length)>2*1024*1024){nativeValid=false;incomplete('page-limit');return undefined;}
        const part=value.slice(0,limit);nativeBytes+=part.length;
        if(part.length<value.length){if(body)result.contentTruncated=true;else{nativeValid=false;incomplete('field-limit');}}
        return part;
      };
      for(let index=0;nativeValid&&index<nativeMessages.length;index++){
        if(index%10===0)await pause();abort();
        const outer=own(nativeMessages,String(index)),nested=own(outer,'message');
        const message=own(outer,'fields')?outer:nested;
        const fields=own(message,'fields')||((nested&&typeof nested==='object')?nested:null);
        if(!fields||typeof fields!=='object'){nativeValid=false;break;}
        const ids=[own(fields,'traceId'),own(fields,'trace_id')].filter(value=>value!==undefined);
        if(!ids.length||ids.some(value=>exact(value)!==traceId)){nativeValid=false;break;}
        const copied={};
        for(const field of PAGE_FIELDS){
          const raw=own(fields,field);if(raw===undefined)continue;
          if(Array.isArray(raw)){
            const length=own(raw,'length');if(!Number.isInteger(length)||length>8){nativeValid=false;break;}
            const values=[];for(let i=0;i<length;i++){const value=copyValue(own(raw,String(i)),field);if(value!==undefined)values.push(value);}
            if(values.length)copied[field]=values.length===1?values[0]:values;
          }else{const value=copyValue(raw,field);if(value!==undefined)copied[field]=value;}
        }
        if(!nativeValid)break;
        copied.__graylogIdentityField=['service-name','service_name','serviceName','service'].some(field=>own(fields,field)!==undefined)?'service-name':own(fields,'instance-name')!==undefined?'instance-name':null;
        if(copied['service-name']===undefined)copied['service-name']=copied.service_name??copied.serviceName??copied.service??copied['instance-name'];
        if(copied.branch===undefined)copied.branch=copied['instance-version'];
        if(copied.spanId===undefined)copied.spanId=copied.span_id;
        if(copied.parentSpanId===undefined)copied.parentSpanId=copied.parent_span_id??copied.parentSpan;
        const nativeId=own(fields,'_id')??own(message,'id')??own(outer,'id'),nativeIndex=own(outer,'index')??own(message,'index');
        if(typeof nativeId==='string'&&nativeId.length<=256)copied._id=nativeId;
        if(copied['job-name']===undefined){
          const key=getChainApi()?.navigationKey?.(fields,message);
          const owners=selected.filter(candidate=>candidate.row.isConnected&&((key&&candidate.key===key)||candidate.message===message
            ||typeof nativeId==='string'&&typeof nativeIndex==='string'&&candidate.item.index===nativeIndex&&candidate.item.message._id===nativeId));
          if(owners.length===1&&messageSnapshot(owners[0].row)?.message===owners[0].message){const job=expandedJobName(owners[0].row);if(job)copied['job-name']=job;}
        }
        const item={message:copied};if(typeof nativeIndex==='string'&&nativeIndex.length<=256)item.index=nativeIndex;
        const membership=[...new Set([...streamIds(fields,message),...streamIds(fields,outer)])];if(membership.length)item.streamIds=membership;
        copiedMessages.push(item);
      }
      if(nativeValid&&copiedMessages.length===expected){
        result.messages=copiedMessages;result.pageMessageCount=copiedMessages.length;result.matchedCount=copiedMessages.length;result.nativePayload=true;
      }
    }
    // Some Graylog versions do not expose the containing backend array on a
    // nearby ancestor. A complete set of committed message props is sufficient:
    // require the exact native page count, unique identities and only this trace.
    const expectedRows=result.nativePage&&result.nativePageSize&&result.nativeTotal!==null
      ?Math.min(result.nativePageSize,Math.max(0,result.nativeTotal-(result.nativePage-1)*result.nativePageSize)):null;
    if(queryExact===true&&!nativeMessages&&!result.nativePayload&&!result.truncated&&expectedRows>0&&
      result.messages.length===expectedRows&&result.pageMessageCount===expectedRows&&result.matchedCount===expectedRows){
      const identities=result.messages.map(item=>typeof item.index==='string'&&item.index&&typeof item.message._id==='string'&&item.message._id?JSON.stringify([item.index,item.message._id]):null);
      if(identities.every(Boolean)&&new Set(identities).size===expectedRows){result.nativePayload=true;result.pageSource='rendered-rows';}
    }
    result.total_results=result.messages.length;
    if(queryExact!==true)result.completeness='unproven-query';
    else if(result.truncated)result.completeness='snapshot-truncated';
    else if(result.nativePayload&&result.nativeTotal!==result.messages.length)result.completeness='more-native-results';
    else if(result.nativePayload){result.complete=true;result.completeness='complete';}
    else if(result.readableCandidates!==result.scannedCandidates)result.completeness='unreadable-rows';
    else if(result.pageMessageCount!==result.messages.length||result.matchedCount!==result.messages.length)result.completeness='non-trace-rows';
    else if(result.nativeTotal===null)result.completeness='unknown-native-total';
    else if(result.nativePage!==null&&result.nativePage!==1)result.completeness='not-first-page';
    else if(result.nativeTotal!==result.messages.length)result.completeness='more-native-results';
    else {result.complete=true;result.completeness='complete';}
    return result;
  }
  function scalar(value, max = 128) {
    if(Array.isArray(value))value=own(value,'0');
    return typeof value === "string" || typeof value === "number"
      ? String(value).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max).trim() : "";
  }
  function firstScalar(fields, keys, max = 128) {
    for (const key of keys) {
      const value = scalar(own(fields, key), max);
      if (value) return value;
    }
    return "";
  }
  function exceptionChain(fields, chainApi = getChainApi()) {
    let best=[];
    for (const key of chainApi?.FIELD_NAMES || ["message", "full_message"]) {
      const value=own(fields,key);
      const names = chainApi?.names?.(Array.isArray(value)?own(value,'0'):value) || [];
      if(names.length && names.length>=best.length)best=names;
    }
    if(best.length)return best;
    const structured = scalar(own(fields,"exceptionType") ?? own(fields,"exception_type"),160);
    return chainApi?.validName?.(structured) ? [structured] : [];
  }
  function metadata(fields, message) {
    if (!fields) return null;
    const chainApi=getChainApi();
    const level = scalar(own(fields, "level"), 3);
    let duration = "";
    for (const [key, unit] of [["durationMs", "ms"], ["duration_ms", "ms"], ["duration", "ms"], ["duration_us", "us"], ["duration_ns", "ns"], ["duration_s", "s"]]) {
      const value = scalar(own(fields, key), 40);
      if (/^\d{1,10}(?:[.,]\d{1,6})?\s*(?:ns|us|µs|ms|s|мс)?$/.test(value)) {
        duration = /[a-zµа-я]/i.test(value) ? value : `${value} ${unit}`;
        break;
      }
    }
    const service = firstScalar(fields, ["service-name", "service_name", "serviceName", "service", "instance-name"]);
    const exceptions = level === "3" ? exceptionChain(fields,chainApi) : [];
    const exception = exceptions[0] || "";
    // Navigation needs to distinguish a stack from its later proxy summary.
    // Only this finite evidence category crosses worlds, never methods or text.
    let stackEvidence = exception ? "exception" : "none";
    const ranks = { none: 0, exception: 1, cause: 2, stack: 3, "causal-stack": 4, application: 5 };
    if (level === "3") for (const key of chainApi?.FIELD_NAMES || ["message", "full_message"]) {
      const raw = own(fields, key), value=Array.isArray(raw)?own(raw,'0'):raw;
      const entries = chainApi?.parse?.(value) || [];
      if (!entries.length && !chainApi?.callsite?.(value)) continue;
      const cause = entries.some(entry => entry.relation === "cause");
      const stack = Boolean(chainApi?.origin?.(value));
      const evidence = chainApi?.callsite?.(value) ? "application" : stack ? (cause ? "causal-stack" : "stack") : cause ? "cause" : "exception";
      if (ranks[evidence] > ranks[stackEvidence]) stackEvidence = evidence;
      if (stackEvidence === "application") break;
    }
    const sourceEvidence=level==='3'?chainApi?.sourceEvidence?.(fields,message):null;
    return { eventKey:sourceEvidence?.eventKey||null, navigationKey:chainApi?.navigationKey?.(fields,message)||null, sourceField:sourceEvidence?.sourceField||null, version: 1, bridgeVersion:2, identityFields:identityFields(fields,message), helperReady:helperReady(), level: /^[0-7]$/.test(level) ? level : "", duration, service, exception, exceptionChain: exceptions, stackEvidence };
  }
  function capabilities() {
    const api=getChainApi();
    return Object.fromEntries(['eventKey','navigationKey','sourceEvidence'].map(key=>[key,typeof own(api,key)==='function']));
  }
  function helperReady() { return Object.values(capabilities()).every(Boolean); }
  function identityFields(fields,message) {
    return {id:Boolean(scalar(own(fields,'_id')??own(message,'id'),257)),index:Boolean(scalar(own(message,'index'),257)),timestamp:Boolean(scalar(own(fields,'timestamp'),129)),message:Boolean(scalar(own(fields,'message'),129)),level:Boolean(scalar(own(fields,'level'),3))};
  }
  function createController(doc, Observer) {
    let disposed = false;
    let scheduled = false;
    const pending = new Map();
    const pendingRoots = new Map();
    let quietUntil=0;
    const nativeInput=event=>{if(!ownUi(event.target))quietUntil=Date.now()+250;};
    for(const type of ['input','keydown','submit'])doc.addEventListener(type,nativeInput,{capture:true,passive:true});
    let workTimer=null;
    const idleWork=typeof globalThis.requestIdleCallback==='function';
    const deferWork=fn=>idleWork?globalThis.requestIdleCallback(fn,{timeout:1000}):setTimeout(fn,25);
    const cancelWork=id=>idleWork?globalThis.cancelIdleCallback(id):clearTimeout(id);
    const signatures = new WeakMap();
    let sweep=null,lastStats=null;
    const newCounts=()=>({rowsRequested:0,rowsRead:0,rowsPublished:0,indexedRows:0,nativeIdRows:0,errorRows:0,identitylessRows:0,fieldCounts:{id:0,index:0,timestamp:0,message:0,level:0}});
    function completeSweep(status='complete') {
      if(!sweep)return;
      const result={version:2,requestId:sweep.requestId,status,...sweep.counts,capabilities:capabilities()};
      sweep=null;lastStats=result;
      doc.dispatchEvent(new CustomEvent(COMPLETE_EVENT,{detail:JSON.stringify(result)}));
    }
    function recordSweep(row,data,published) {
      if(!sweep?.rows.delete(row))return;
      if(data){
        const count=sweep.counts;count.rowsRead++;
        if(published)count.rowsPublished++;
        if(data.eventKey||data.navigationKey)count.indexedRows++;else count.identitylessRows++;
        if(data.navigationKey)count.nativeIdRows++;if(data.level==='3')count.errorRows++;
        for(const key of Object.keys(count.fieldCounts))if(data.identityFields[key])count.fieldCounts[key]++;
      }
      if(!sweep.rows.size)completeSweep();
    }
    function active() { return /(?:^|\/)search(?:\/|$)/i.test(doc.location?.pathname || ""); }
    function publish(row, force = false) {
      if (!active() || !row?.isConnected || row.closest?.("td table,td tbody")) {recordSweep(row,null,false);return;}
      const snapshot = messageSnapshot(row);
      if (!snapshot) {recordSweep(row,null,false);return;}
      const data = metadata(snapshot.fields,snapshot.message);
      if (typeof snapshot.expanded === "boolean") data.expanded = snapshot.expanded;
      let json = JSON.stringify(data);
      // Keep the existing cross-world 2KiB ceiling even with the optional
      // diagnostic flags and maximally long exception names.
      if(json.length>2048){data.service=data.service.slice(0,64);json=JSON.stringify(data);}
      if (!force && signatures.get(row) === json) {recordSweep(row,data,false);return;}
      signatures.set(row, json);
      row.setAttribute(ROW_ATTRIBUTE, "");
      row.dispatchEvent(new CustomEvent(UPDATE_EVENT, { bubbles: true, detail: json }));
      recordSweep(row,data,true);
    }
    function ownUi(node) {
      const element=node?.nodeType===1?node:node?.parentElement;
      return Boolean(element?.closest?.('[data-advanced-graylog-message-badges],[id^="advanced-graylog-"]'));
    }
    function queue(row,force=false){if(row)pending.set(row,force||pending.get(row)||false);}
    function collect(node,descendants=false) {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      if (!element || ownUi(element)) return;
      const owner = element.matches?.(ROW_SELECTOR) ? element : element.closest?.(ROW_SELECTOR);
      if (owner) queue(owner);
      if(descendants&&!owner)for (const row of Array.from(element.querySelectorAll?.(ROW_SELECTOR) || []).slice(0, 500)) queue(row);
    }
    function flush(deadline) {
      scheduled=false;workTimer=null;if(disposed)return;
      if(Date.now()<quietUntil||globalThis.navigator?.scheduling?.isInputPending?.()){schedule();return;}
      // DOM discovery belongs in idle work too. Mutation callbacks must not
      // synchronously scan every newly mounted table during native search.
      const discoveryStart=Date.now();let discovered=0;
      for(const [node,descendants] of pendingRoots){pendingRoots.delete(node);if(node.isConnected!==false)collect(node,descendants);if(++discovered>=5||Date.now()-discoveryStart>=4)break;}
      if(pendingRoots.size){schedule();return;}
      const start=Date.now();let count=0;
      for(const [row,force] of pending){pending.delete(row);publish(row,force);if(++count>=5||Date.now()-start>=4||(deadline&&deadline.timeRemaining()<1))break;}
      schedule();
    }
    function schedule() { if (!scheduled && (pending.size||pendingRoots.size)) { scheduled = true; workTimer=deferWork(flush); } }
    function request(event) {
      if(disposed)return;
      const rows=event.target===doc?Array.from(doc.querySelectorAll(ROW_SELECTOR)).slice(0,500):event.target?.matches?.(ROW_SELECTOR)?[event.target]:[];
      let requestId=null;
      if(typeof event.detail==='string'&&event.detail.length<160)try{
        const payload=JSON.parse(event.detail);
        if(payload?.version===2&&typeof payload.requestId==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(payload.requestId))requestId=payload.requestId;
      }catch{/* Legacy requests have no acknowledgement token. */}
      if(requestId){
        completeSweep('superseded');
        const counts=newCounts();counts.rowsRequested=rows.length;
        sweep={requestId,rows:new Set(rows),counts};
        if(!active()){completeSweep('inactive');return;}
        if(!rows.length)completeSweep();
      }
      if (event.target === doc) {
        for (const row of rows) queue(row,true);
      } else if (event.target?.matches?.(ROW_SELECTOR)) queue(event.target,true);
      schedule();
    }
    const observer = new Observer((mutations) => {
      const targets=new Set(),added=new Set();
      for (const change of mutations) {
        if(ownUi(change.target))continue;
        const changed=[...(change.addedNodes||[]),...(change.removedNodes||[])];
        if(changed.length&&changed.every(ownUi))continue;
        targets.add(change.target);for(const node of change.addedNodes||[])added.add(node);
      }
      for(const node of targets)pendingRoots.set(node,pendingRoots.get(node)||false);
      for(const node of added)pendingRoots.set(node,true);
      if(pendingRoots.size>500){pendingRoots.clear();pendingRoots.set(doc.documentElement,true);}
      schedule();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
    doc.addEventListener(REQUEST_EVENT, request);
    request({ target: doc });
    return Object.freeze({ snapshotTrace:(traceId,options={})=>snapshotTrace(traceId,{...options,document:doc}), stats() { return lastStats?JSON.parse(JSON.stringify(lastStats)):{version:2,...newCounts(),capabilities:capabilities()}; }, dispose() { completeSweep('superseded');disposed = true;if(workTimer!==null)cancelWork(workTimer); observer.disconnect(); doc.removeEventListener(REQUEST_EVENT, request);for(const type of ['input','keydown','submit'])doc.removeEventListener(type,nativeInput,true); pending.clear();pendingRoots.clear(); } });
  }
  return Object.freeze({ REQUEST_EVENT, UPDATE_EVENT, COMPLETE_EVENT, ROW_ATTRIBUTE, ROW_SELECTOR, messageFields, metadata, snapshotTrace, createController });
});
