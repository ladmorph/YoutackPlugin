(function exposeExceptionChain(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GraylogExceptionChain = api;
})(globalThis, function exceptionChainModule() {
  "use strict";
  const HEAD_LIMIT = 65536, MAX_CHAIN = 8, MAX_NAME = 160;
  const FIELD_NAMES = Object.freeze(["message", "full_message", "stack_trace", "stacktrace", "stackTrace", "exception_stack_trace", "exception_stacktrace", "exceptionStackTrace"]);
  const token = /^([A-Za-z_$][\w.$]{0,149}(?:Exception|Error))(?=\s*:|\s*$)/;
  const validName = value => typeof value === "string" && value.length <= MAX_NAME && /^(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:Exception|Error)$/.test(value);

  function headerText(line) {
    return line.trim()
      .replace(/^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?\]?\s+/, "")
      .replace(/^(?:ERROR|WARN|INFO|DEBUG|TRACE)\s+(?:\[[^\]\r\n]{0,160}\]\s*)?(?:[A-Za-z_$][\w.$]{0,160}\s+-\s+)?/, "")
      .replace(/^(?:ERROR(?: RESPONSE)?|OPENAPI(?:\s+\d+(?:\.\d+)*)? RESPONSE|PARTNER[ _]+BACKEND RESPONSE|[A-Z0-9][A-Z0-9_. -]{0,127}\s+CLIENT RESPONSE)\s*:\s*(?:\[\d+\]\s*)?\[[1-5]\d\d(?:\s+[^\]\r\n]*)?\]\s*(?:(?:\[\/[^\]\r\n]{0,512}\]|\/[^\s\r\n]{0,512})\s*)?/i, "")
      .replace(/^ERROR\s*:\s*/, "")
      .replace(/^Exception in thread "[^"\r\n]{0,160}"\s+/, "");
  }

  function boundedHead(value) {
    const boundary = value.slice(0, HEAD_LIMIT).search(/\b(?:(?:REQUEST|RESPONSE)\s+)?BODY\s*:/i);
    return value.slice(0, boundary < 0 ? HEAD_LIMIT : boundary);
  }
  function primaryHead(value) {
    const head=boundedHead(value), lines=head.split('\n');let offset=0,seen=false;
    for(let index=0;index<lines.length;index++){
      const line=lines[index];
      const candidate=token.exec(headerText(line));
      if(candidate && (index===0 || /^[^\S\r\n]*at\s+[\w.$/@+-]+\(/.test(lines[index+1]||''))){
        if(seen)return head.slice(0,offset);seen=true;
      }
      offset+=line.length+1;
    }
    return head;
  }
  function parse(value) {
    if (typeof value !== "string") return [];
    const head = primaryHead(value);
    const lines = []; let offset = 0;
    for (const line of head.split(/\n/)) { lines.push({text:line.replace(/\r$/, ""),offset});offset += line.length + 1; }
    const result = [];
    function add(line, name, relation) {
      if (!validName(name)) return;
      const start = line.offset + line.text.indexOf(name);
      const marker = relation === "cause" ? line.text.indexOf("Caused by:") : -1;
      if(result.length>=MAX_CHAIN)result.splice(1,1);
      result.push({name,relation,start,end:start+name.length,highlightStart:marker < 0 ? start : line.offset+marker});
    }
    let firstIndex = lines.findIndex(line=>line.text.trim());
    if (firstIndex < 0) return result;
    const first = lines[firstIndex];
    let text = headerText(first.text);
    const standaloneCause = /^Caused by:\s*/.exec(text);
    if (standaloneCause) text = text.slice(standaloneCause[0].length);
    let root = token.exec(text);
    if (root) add(first, root[1], standaloneCause ? "cause" : "root");
    else {
      // A logger description may precede a stack, but a bare mention on the next
      // line is insufficient: require its real `at package.method(...)` frame.
      let found = false;
      for (let index = firstIndex+1; index < lines.length-1; index++) {
        const candidate = lines[index], frame = lines[index+1];
        root = token.exec(candidate.text.trim());
        if (!root || !/^\s+at\s+[\w.$/]+\([^\r\n]*\)/.test(frame.text)) continue;
        firstIndex=index; add(candidate,root[1],"root"); found=true; break;
      }
      if(!found && reactorSites(head)) {
        const original=head.indexOf('Original Stack Trace:');
        const index=lines.findIndex(line=>line.offset>original && /^\s*Caused by:\s*/.test(line.text) && token.test(line.text.replace(/^\s*Caused by:\s*/,'')));
        if(index>=0){firstIndex=index;add(lines[index],token.exec(lines[index].text.replace(/^\s*Caused by:\s*/,''))[1],'cause');found=true;}
      }
      if (!found) return result;
    }
    // Ignore causes belonging to a suppressed branch (greater indentation).
    let suppressedIndent = null;
    for (const line of lines.slice(firstIndex+1)) {
      const indent = /^\s*/.exec(line.text)[0].replace(/\t/g,"    ").length;
      if (/^\s*Suppressed:\s*/.test(line.text)) { if(suppressedIndent===null)suppressedIndent = indent;continue; }
      if (suppressedIndent !== null && line.text.trim() && indent < suppressedIndent) suppressedIndent=null;
      if (suppressedIndent !== null) continue;
      const cause = /^\s*Caused by:\s*(.*)$/.exec(line.text);
      const match = cause && token.exec(cause[1]);
      if (match) add(line,match[1],"cause");
    }
    return result;
  }
  function names(value) { return parse(value).map(entry=>entry.name); }
  // Internal classification input only. Diagnostic tails never become UI text
  // unless a catalogue explicitly sanitizes its own allowed display field.
  function primaryHeaders(value) {
    if(typeof value!=='string')return [];
    const head=primaryHead(value);
    return parse(value).map(entry=>({name:entry.name,
      diagnostic:head.slice(entry.end).split(/\r?\n/,1)[0]}));
  }
  const SOURCE_FIELDS=Object.freeze(['full_message',...FIELD_NAMES.filter(field=>field!=='full_message')]);
  function stackSource(fields) {
    let fallback=null;
    for(const field of SOURCE_FIELDS){
      const text=fieldText(fields,field);
      if(!parse(text).length)continue;
      const source={field,text};fallback ||= source;
      if(/^\s*at\s+[\w.$/@+<>-]+\([^\r\n]*\)/m.test(primaryHead(text)))return source;
    }
    return fallback;
  }
  function origin(value) {
    if(typeof value!=="string" || value.length>=HEAD_LIMIT)return null;
    const entries=parse(value), deepest=entries.at(-1);
    if(!deepest)return null;
    const head=primaryHead(value);
    const newline=head.indexOf("\n",deepest.end);
    if(newline<0)return null;
    const tail=head.slice(newline+1);
    // First concrete frame of the deepest primary cause. Elided/shared frames
    // and suppressed branches cannot establish where that cause originated.
    const frame=/^(?:[ \t]*\r?\n)*[^\S\r\n]+at[^\S\r\n]+((?:[\w.$@+-]*\/){0,2}[\w.$<>]+)\([^\r\n]*\)/.exec(tail);
    if(!frame)return null;
    const start=newline+1+frame[0].indexOf(frame[1]);
    return {method:frame[1],start,end:start+frame[1].length,exception:deepest.name};
  }

  const FRAMEWORK = /^(?:java\.|javax\.|jakarta\.|jdk\.|sun\.|com\.sun\.|org\.springframework\.|reactor\.|io\.netty\.|io\.lettuce\.|redis\.clients\.|org\.redisson\.|io\.r2dbc\.|com\.mysql\.|com\.microsoft\.sqlserver\.|oracle\.jdbc\.|org\.mariadb\.|com\.mongodb\.|org\.mongodb\.|com\.datastax\.|org\.apache\.|org\.hibernate\.|org\.postgresql\.|org\.slf4j\.|org\.aspectj\.|ch\.qos\.|com\.zaxxer\.|com\.fasterxml\.|com\.google\.common\.|kotlin\.|kotlinx\.|scala\.|io\.reactivex\.|rx\.|okhttp3\.|okio\.|retrofit2\.|feign\.)/;
  function sourceFrame(line, offset=0, assembly=false) {
    const frame=/^[^\S\r\n]*(?:at[^\S\r\n]+)?((?:[\w.$@+-]*\/){0,2}[\w.$<>]+)\(([^\r\n():]+):(\d{1,7})\)/.exec(line);
    if(!frame || (!assembly&&!/^\s*at\s/.test(line)))return null;
    const method=frame[1].split('/').at(-1);
    if(FRAMEWORK.test(method)||/\$\$(?:Enhancer|SpringCGLIB|FastClass)|\$Proxy\d/.test(method))return null;
    return {method:frame[1],file:frame[2],line:Number(frame[3]),start:offset+frame[0].indexOf(frame[1]),end:offset+frame[0].length,relation:'callsite',kind:assembly?'assembly':'stack'};
  }
  // Reactor diagnostic sections describe assembly/observation, not Java causes.
  // Only inspect a single enclosing primary exception's section at a time.
  function reactorSites(value, base=0) {
    if(typeof value!=='string'||value.length>=HEAD_LIMIT)return null;
    const head=primaryHead(value);
    const observed=/^[^\S\r\n]*Error has been observed at the following site\(s\):[^\r\n]*$/m.exec(head);
    const original=/^[^\S\r\n]*Original Stack Trace:[^\r\n]*$/m.exec(head);
    if(!observed||!original||observed.index>=original.index)return null;
    let handler=null,source=null,originalSource=null;const roots=[],rootIdentities=new Set();
    const assembly=/^[^\S\r\n]*Assembly trace from producer [^\r\n]*$/m.exec(head);
    // Do not borrow diagnostics from a normal suppressed exception's subtree.
    const before=head.slice(0,assembly?.index??observed.index);
    const branches=[];
    for(const match of before.matchAll(/^([^\S\r\n]*)Suppressed:\s*([^\r\n]*)/gm)){
      const indent=match[1].replace(/\t/g,'    ').length;
      while(branches.length&&branches.at(-1).indent>=indent)branches.pop();
      branches.push({indent,reactor:/OnAssemblyException|stacktrace has been enhanced by Reactor/.test(match[2])});
    }
    if(branches.some(branch=>!branch.reactor))return null;
    if(assembly&&assembly.index<observed.index){
      let offset=assembly.index+assembly[0].length+1;
      for(const line of head.slice(offset,observed.index).split('\n')){
        source=sourceFrame(line,base+offset,true);if(source)break;offset+=line.length+1;
      }
    }
    let offset=observed.index+observed[0].length+1;
    for(const line of head.slice(offset,original.index).split('\n')){
      const h=/^[\s*_\\|\-]*checkpoint\s+(?:⇢|->)\s+Handler\s+([\w.$]+#[\w$<>]+)\([^\r\n]{0,600}\)/.exec(line);
      if(h&&!handler){const start=base+offset+h[0].indexOf(h[1]);handler={method:h[1],start,end:start+h[1].length,relation:'checkpoint',kind:'handler'};}
      const root=/^\s*\*[_\s]*[^\r\n]*?(?:⇢|->)\s+(at\s+[^\r\n]+)$/.exec(line);
      if(root){rootIdentities.add(root[1]);const site=sourceFrame(root[1],base+offset+root[0].lastIndexOf(root[1]));if(site)roots.push({...site,kind:'assembly'});}
      offset+=line.length+1;
    }
    const unique=[...new Map(roots.map(site=>[site.method+':'+site.file+':'+site.line,site])).values()];
    if(!source&&unique.length===1&&rootIdentities.size===1)source=unique[0];
    offset=original.index+original[0].length+1;
    for(const line of head.slice(offset).split('\n')){
      if(/^\s*(?:Caused by:|Suppressed:|\[CIRCULAR REFERENCE:)/.test(line))break;
      originalSource=sourceFrame(line,base+offset);if(originalSource){originalSource.kind='original';break;}offset+=line.length+1;
    }
    return {handler,assembly:source,original:originalSource,ambiguous:!source&&rootIdentities.size>1};
  }

  function prefixCallsite(value) {
    // A bounded prefix can establish a method belonging to its first visible
    // exception, but cannot establish the deepest cause in the omitted tail.
    const raw=boundedHead(value),end=raw.lastIndexOf('\n');
    if(end<0)return null;
    const head=primaryHead(raw.slice(0,end)),entry=parse(head)[0];if(!entry)return null;
    const newline=head.indexOf('\n',entry.end);if(newline<0)return null;
    let offset=newline+1;
    for(const line of head.slice(offset).split('\n')){
      if(/^\s*(?:Caused by:|Suppressed:|Assembly trace from producer |Error has been observed at|Original Stack Trace:|\[CIRCULAR REFERENCE:)/.test(line))break;
      const frame=sourceFrame(line,offset);
      if(frame)return {...frame,exception:entry.name,ownerStart:entry.start,causeStart:entry.start,partial:true};
      offset+=line.length+1;
    }
    return null;
  }
  function callsite(value, {truncated=false}={}) {
    if(typeof value!=="string")return null;
    if(truncated||value.length>=HEAD_LIMIT)return prefixCallsite(value);
    const head=primaryHead(value), entries=parse(head);
    if(!entries.length || (entries[0].relation==='cause' && head.indexOf('Original Stack Trace:')>=0 && head.indexOf('Original Stack Trace:')<entries[0].start)){const sites=reactorSites(head),site=sites?.assembly||sites?.original;return sites?.ambiguous||!site?null:{...site,ownerStart:entries[0]?.start,causeStart:entries.at(-1)?.start};}
    // A cause may contain only I/O/framework frames. Walk its enclosing causes
    // towards the wrapper until an application call with source location exists.
    // This is a call-site candidate, not proof that its implementation is faulty.
    for(let index=entries.length-1;index>=0;index--){
      const entry=entries[index],end=entries[index+1]?.highlightStart ?? head.length;
      const sectionStart=head.lastIndexOf("\n",entry.start)+1;
      const sites=reactorSites(head.slice(sectionStart,end),sectionStart);
      if(sites?.ambiguous)return null;
      if(sites?.assembly)return {...sites.assembly,exception:entry.name,ownerStart:entry.start,causeStart:entries.at(-1)?.start};
      const newline=head.indexOf("\n",entry.end);
      if(newline<0||newline>=end)continue;
      let offset=newline+1,suppressedIndent=null;
      for(const line of head.slice(offset,end).split('\n')){
        if(/^\s*(?:Assembly trace from producer |Error has been observed at the following site|Original Stack Trace:)/.test(line))break;
        const indent=/^\s*/.exec(line)[0].replace(/\t/g,'    ').length;
        if(/^\s*Suppressed:/.test(line)){if(suppressedIndent===null)suppressedIndent=indent;}
        else {
          if(suppressedIndent!==null && line.trim() && (indent<suppressedIndent || (indent===suppressedIndent && /^[ \t]+at\s/.test(line))))suppressedIndent=null;
          if(suppressedIndent===null){
            const frame=sourceFrame(line,offset);
            if(frame)return {...frame,exception:entry.name,ownerStart:entry.start,causeStart:entries.at(-1)?.start};
          }
        }
        offset+=line.length+1;
      }
      if(sites?.original)return {...sites.original,exception:entry.name,ownerStart:entry.start,causeStart:entries.at(-1)?.start};
    }
    return null;
  }
  function compact(value) {
    // Keep validated headers near the front for the bounded error catalogue;
    // retain short diagnostics for SQLSTATE/driver error classification.
    return parse(value).map((entry,index)=> {
      const lineEnd=value.indexOf("\n",entry.end);
      const diagnostic=value.slice(entry.end,lineEnd<0?undefined:lineEnd).slice(0,256).replace(/\r$/, "");
      return (index?"Caused by: ":"")+entry.name+diagnostic;
    }).join("\n");
  }

  const ownValue=(object,key)=>{if(!object||typeof object!=='object')return undefined;const descriptor=Object.getOwnPropertyDescriptor(object,key);return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;};
  const scalar = value => Array.isArray(value) ? ownValue(value,'0') : value;
  const fieldText = (fields, key, alias) => {
    const value=scalar(ownValue(fields,key) ?? (alias ? ownValue(fields,alias) : undefined));
    return typeof value==='string' ? value : typeof value==='number'&&Number.isFinite(value) ? String(value) : '';
  };
  // Navigation identity only, not anonymisation or an authentication boundary.
  // The same committed event can arrive as API scalars or React field arrays.
  // Collisions and duplicate records must be rejected by the unique-row caller.
  function eventKey(fields) {
    const timestamp=fieldText(fields,'timestamp'), message=fieldText(fields,'message');
    if(!timestamp||!message)return null;
    const parsed=Date.parse(timestamp);
    const numeric=typeof scalar(ownValue(fields,'timestamp'))==='number' ? Number(timestamp) : null;
    const submillis=/[T ]\d{2}:\d{2}:\d{2}[.,]\d{3}(\d+)(?:Z|[+-]\d{2}:?\d{2})?$/.exec(timestamp)?.[1]?.replace(/0+$/,'')||'';
    const time=numeric!==null ? String(numeric)+':' : Number.isFinite(parsed) ? String(parsed)+':'+submillis : timestamp.slice(0,96);
    const values=[time,fieldText(fields,'service-name','service_name').slice(0,160),fieldText(fields,'source').slice(0,160),fieldText(fields,'spanId','span_id').slice(0,160),String(message.length),message.slice(0,8192)];
    let a=2166136261,b=2246822507;
    for(const value of values){const part=value.length+':'+value+';';for(let i=0;i<part.length;i++){const c=part.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b^c,3266489909);}}
    return 'ev1_'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }
  // Graylog decorators may change displayed fields while preserving the
  // message's native id/index. Keep that navigation identity independent of
  // content evidence used by chronology. Never send the raw id across worlds.
  function navigationKey(fields, record) {
    const id=fieldText(fields,'_id') || fieldText(record,'id');
    const index=fieldText(record,'index');
    if(!id||!index||id.length>256||index.length>256)return null;
    let a=2166136261,b=2246822507;
    for(const value of [id,index])for(const c of value.length+':'+value+';'){const code=c.charCodeAt(0);a=Math.imul(a^code,16777619);b=Math.imul(b^code,3266489909);}
    return 'nv1_'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }
  // Raw URL parts stay inside local analysis for exact matching. Never copy
  // this return value into a report; httpTargetLabel is the display boundary.
  function httpTarget(value) {
    if(typeof value!=='string'||value.length>2048||! /^(?:https?:\/\/|\/)/i.test(value)||value.startsWith('//')||/[\s<>"'\\]/.test(value))return null;
    try {const url=new URL(value,'https://trace.invalid');if(!['http:','https:'].includes(url.protocol))return null;return {origin:value.startsWith('/')?null:url.origin,path:url.pathname+url.search};}catch{return null;}
  }
  function httpTargetLabel(value) {
    const parsed=httpTarget(value);if(!parsed)return null;
    const pathname=parsed.path.split('?')[0];
    return pathname.split('/').map(part=>!part?'':/^(?:v\d{1,2}|[a-z][a-z_-]{0,39})$/.test(part)&&!/[a-f0-9]{16,}/i.test(part)?part:':id').join('/').slice(0,320);
  }
  function outgoingHttp(value) {
    if(typeof value!=='string'||value.length>=HEAD_LIMIT)return [];
    const head=primaryHead(value),calls=new Map(),entries=parse(head);
    const add=(method,target,kind)=>{const parsed=httpTarget(target);if(!parsed)return;const key=method+' '+(parsed.origin||'')+parsed.path;if(!calls.has(key)&&calls.size<8)calls.set(key,{method,target,kind,...parsed});};
    // A real Reactor traceback owns its checkpoints. An inbound server
    // ExceptionHandlingWebHandler checkpoint is deliberately not accepted.
    if(entries.length&&reactorSites(head)){
      const observed=head.indexOf('Error has been observed at the following site(s):'),original=head.indexOf('Original Stack Trace:',observed);
      const area=head.slice(observed,original);
      for(const line of area.split('\n')){
        const match=/^[\s*_\\|\-]*checkpoint\s+(?:⇢|->|→)\s+(?:Request to |HTTP(?:\s+REQUEST)?\s*:?\s*|[1-5]\d\d(?:\s+[A-Z_]+)?\s+from\s+)?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+((?:https?:\/\/|\/)[^\s<>"']{1,2048})(?:\s+\[(?:DefaultWebClient|WebClient|HttpClient|ReactorNetty)\])?\s*$/.exec(line);
        if(match)add(match[1],match[2],'webclient-checkpoint');
      }
    }
    // Some client wrappers keep only a compact HTTP line in the owned stack:
    // `HTTP GET https://host/path` or `GET https://host/path`. Accept only an
    // entire bounded line of an actual exception stack. Relative targets need
    // the explicit HTTP marker so inbound handler paths are not guessed.
    for(const line of head.split('\n')){
      const explicit=/^\s*HTTP(?:\s+REQUEST)?\s*:?\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+((?:https?:\/\/|\/)[^\s<>"']{1,2048})(?:\s+\[(?:DefaultWebClient|WebClient|HttpClient|ReactorNetty)\])?\s*$/i.exec(line);
      const absolute=explicit?null:/^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+(https?:\/\/[^\s<>"']{1,2048})(?:\s+\[(?:DefaultWebClient|WebClient|HttpClient|ReactorNetty)\])?\s*$/i.exec(line);
      const match=explicit||absolute;if(match)add(match[1].toUpperCase(),match[2],'http-stack-context');
    }
    // WebClientResponseException's own generated header can include the
    // request even without assembly instrumentation. Quoted/body prose cannot.
    const first=headerText(head.split('\n').find(line=>line.trim())||'');
    const response=/^(?:org\.springframework\.web\.reactive\.function\.client\.)?WebClientResponseException(?:\$[A-Za-z]+)?:\s*[1-5]\d\d\s+[^\r\n]{0,100}?\s+from\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+((?:https?:\/\/|\/)[^\s<>"']{1,2048})\s*$/.exec(first);
    if(response)add(response[1],response[2],'webclient-response');
    return [...calls.values()];
  }
  function requestCall(fields) {
    const value=fieldText(fields,'message').slice(0,2048),line=headerText(value.split('\n').find(part=>part.trim())||'').split(/\b(?:REQUEST\s+)?BODY\s*:/i)[0].trim();
    const request=/^((?:OPENAPI(?:\s+\d+(?:\.\d+)*)?|PARTNER[ _]+BACKEND|[A-Z][A-Z0-9_. -]{0,60} CLIENT)\s+)?REQUEST\s*:\s*\[?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\]?\s+((?:https?:\/\/|\/)[^\s<>"']{1,2048})\s*$/.exec(line);
    const role=fieldText(fields,'span.kind')||fieldText(fields,'spanKind','span_kind');
    if(!request||(!request[1]&&role.toLowerCase()!=='client'))return null;
    const parsed=httpTarget(request[3]);return parsed?{method:request[2],target:request[3],...parsed}:null;
  }
  function sourceEvidence(fields, record) {
    let sourceField=null,stack=null,exceptionSite=null;
    // full_message belongs to this event, never borrow a neighbouring proxy's stack.
    for(const field of SOURCE_FIELDS){
      const value=fieldText(fields,field),entries=parse(value);
      if(!entries.length||!/^\s*at\s+[\w.$/@+<>-]+\([^\r\n]*\)/m.test(primaryHead(value)))continue;
      sourceField=field;
      const candidate=callsite(value);
      const safeSite=site=>site&&site.method.length<=320&&site.file.length<=160&&/^[\w.$@/+<>-]+$/.test(site.method)&&/^[\w.$ -]+$/.test(site.file);
      const deepest=entries.at(-1),causeExceptionType=value.length<HEAD_LIMIT&&deepest.relation==='cause'?deepest.name.split('.').at(-1):null;
      if(safeSite(candidate)){
        const role=candidate.kind==='assembly'?'reactor-assembly':candidate.kind==='original'?'original-stack':!candidate.partial&&candidate.ownerStart!==deepest.start?'enclosing-exception':'exception-stack';
        stack={kind:candidate.kind,role,method:candidate.method,file:candidate.file,line:candidate.line,exceptionType:(candidate.exception||deepest.name).split('.').at(-1),causeExceptionType,...(candidate.partial?{partial:true}:{})};
      }
      // Preserve ownership separately when the preferred site is a Reactor
      // assembly frame or belongs to a nested cause. A Java stack location is
      // not proof of a faulty method, nor of a logging/transformation operation.
      const head=primaryHead(value),root=entries[0];
      let offset=head.indexOf('\n',root.end)+1;
      if(offset>0)for(const line of head.slice(offset).split('\n')){
        if(/^\s*(?:Caused by:|Suppressed:|Assembly trace from producer |Error has been observed at|Original Stack Trace:|\[CIRCULAR REFERENCE:)/.test(line))break;
        const frame=sourceFrame(line,offset);
        if(safeSite(frame)){
          exceptionSite={method:frame.method,file:frame.file,line:frame.line,exceptionType:root.name.split('.').at(-1),role:root.relation==='cause'?'cause-exception':'outer-exception',...(value.length>=HEAD_LIMIT?{partial:true}:{})};break;
        }
        offset+=line.length+1;
      }
      break;
    }
    const rawTime=scalar(ownValue(fields,'timestamp')), parsedTime=typeof rawTime==='number'?rawTime:typeof rawTime==='string'?Date.parse(rawTime):NaN;
    return {eventKey:eventKey(fields),navigationKey:navigationKey(fields,record),at:Number.isFinite(parsedTime)?parsedTime:null,messageField:'message',sourceField,stack,exceptionSite};
  }

  function readDomText(element) {
    const segments=[]; let text="",visited=0,truncated=false;
    const appendBreak=()=>{if(text && !text.endsWith("\n") && text.length<HEAD_LIMIT)text+="\n";};
    function visit(node,depth) {
      if (!node) return;
      if (text.length>=HEAD_LIMIT || ++visited>4096 || depth>64) {truncated=true;return;}
      if (node.nodeType===3) {
        const part=String(node.data||"").slice(0,HEAD_LIMIT-text.length);
        if(part.length<String(node.data||"").length)truncated=true;
        segments.push({node,start:text.length,end:text.length+part.length});text+=part;return;
      }
      if (node.nodeType!==1) return;
      const tag=String(node.tagName||"").toUpperCase();
      if (/^(?:SCRIPT|STYLE|BUTTON|SVG)$/.test(tag) || node.hasAttribute?.("data-advanced-graylog-message-badges")) return;
      if (tag==="BR") {appendBreak();return;}
      const block=/^(?:DIV|P|PRE|LI|TR|DD)$/.test(tag)||node.style?.display==="block";
      if(block)appendBreak();
      for(const child of node.childNodes||[]) {if(visited>=4096||text.length>=HEAD_LIMIT){truncated=true;break;}visit(child,depth+1);}
      if(block)appendBreak();
    }
    if(element?.childNodes) visit(element,0);
    else {const value=String(element?.textContent||"");text=value.slice(0,HEAD_LIMIT);truncated=value.length>HEAD_LIMIT;}
    return {text,segments,truncated};
  }
  function evidence(chain) {
    if (!Array.isArray(chain) || chain.length > MAX_CHAIN || !chain.every(validName)) return "";
    return chain.map((name,index)=>(index ? "Caused by: " : "")+name).join("\n");
  }
  return Object.freeze({HEAD_LIMIT,MAX_CHAIN,MAX_NAME,FIELD_NAMES,SOURCE_FIELDS,primaryHeaders,stackSource,validName,parse,names,origin,callsite,reactorSites,eventKey,navigationKey,sourceEvidence,httpTargetLabel,outgoingHttp,requestCall,evidence,compact,readDomText});
});
