(function exposeGraylogNativeSearch(root,factory){
  "use strict";
  const api=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  root.GraylogNativeSearch=api;
})(globalThis,function graylogNativeSearchModule(){
  "use strict";
  const CAPTURE_TTL_MS=5*60*1000;
  const FUTURE_SKEW_MS=10*1000;
  const MAX_OFFSET=10_000;
  const id=value=>typeof value==='string'&&/^[a-z0-9_-]{8,128}$/i.test(value)?value:'';
  const exactTrace=value=>{
    const match=/^traceId\s*:\s*(?:"([a-z0-9_-]{1,128})"|([a-z0-9_-]{1,128}))$/i.exec(String(value||'').trim());
    return match?.[1]||match?.[2]||'';
  };
  const own=(object,key)=>object&&typeof object==='object'?Object.getOwnPropertyDescriptor(object,key)?.value:undefined;
  function safeJson(value,budget={nodes:0}){
    if(++budget.nodes>200)return null;
    if(value===null||typeof value==='boolean')return value;
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    if(typeof value==='string')return value.length<=2048?value:null;
    if(Array.isArray(value)){
      if(value.length>50)return null;
      const copy=[];for(const item of value){const next=safeJson(item,budget);if(next===null&&item!==null)return null;copy.push(next);}return copy;
    }
    if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;
    const keys=Object.keys(value);if(keys.length>50)return null;
    const copy={};for(const key of keys){
      if(!/^[a-zA-Z0-9_.-]{1,128}$/.test(key)||["__proto__","prototype","constructor"].includes(key))return null;
      const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!Object.hasOwn(descriptor,'value'))return null;
      const next=safeJson(descriptor.value,budget);if(next===null&&descriptor.value!==null)return null;copy[key]=next;
    }return copy;
  }
  function freezeJson(value){
    if(value&&typeof value==='object'){for(const item of Array.isArray(value)?value:Object.values(value))freezeJson(item);Object.freeze(value);}return value;
  }
  function absoluteRange(value){
    if(!value||own(value,'type')!=='absolute')return null;
    const from=String(own(value,'from')||''),to=String(own(value,'to')||''),startMs=Date.parse(from),endMs=Date.parse(to);
    if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||startMs>=endMs||endMs-startMs>7*86400*1000)return null;
    return {type:'absolute',from:new Date(startMs).toISOString(),to:new Date(endMs).toISOString(),startMs,endMs};
  }
  function capture(urlValue,body,capturedAt=Date.now(),context={}){
    let url;try{url=new URL(String(urlValue||''));}catch{return null;}
    if(!/^https?:$/.test(url.protocol)||url.username||url.password||url.hash||url.search
      ||!/\/api\/views\/search\/[a-z0-9_-]{8,128}\/execute(?:\/sync)?\/?$/i.test(url.pathname))return null;
    const captured=Number(capturedAt);
    if(!Number.isSafeInteger(captured)||captured<0)return null;
    const override=own(body,'global_override');
    if(!override||typeof override!=='object'||Array.isArray(override))return null;
    const states=own(override,'search_types'),keep=own(override,'keep_search_types');
    if(!states||typeof states!=='object'||Array.isArray(states)||!Array.isArray(keep)||keep.length!==1)return null;
    const searchTypeId=id(own(keep,'0')),state=own(states,searchTypeId);
    if(!searchTypeId||Object.keys(states).length!==1||!state||typeof state!=='object'||Array.isArray(state))return null;
    const limit=Number(own(state,'limit')),offset=Number(own(state,'offset'));
    if(!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(offset)||offset<0||offset>MAX_OFFSET||offset+limit>MAX_OFFSET)return null;
    const timerange=absoluteRange(own(override,'timerange'));
    if(!timerange)return null;
    const query=own(override,'query'),queryOverride=query!==undefined;
    if(queryOverride&&(!query||typeof query!=='object'||Array.isArray(query)))return null;
    const queryString=queryOverride?String(own(query,'query_string')||''):'';
    const bodyTrace=queryString?exactTrace(queryString):'',contextTrace=exactTrace(`traceId:${String(context?.traceId||'')}`);
    if(bodyTrace&&contextTrace&&bodyTrace!==contextTrace)return null;
    const traceId=bodyTrace||contextTrace;
    // Chrome may omit documentUrl for fetch/XHR and expose only the initiator
    // origin. A query-less native override can be retained provisionally; it
    // is usable only after validate() proves the exact trace from the current
    // URL of the same tab. An explicit override must always prove its trace.
    if(queryOverride&&!traceId)return null;
    const bindings=own(body,'parameter_bindings');
    if(bindings!==undefined&&(!bindings||typeof bindings!=='object'||Array.isArray(bindings)||Object.keys(bindings).length))return null;
    const bodyTemplate=safeJson(body),overrideTemplate=own(bodyTemplate,'global_override'),bindingsTemplate=own(bodyTemplate,'parameter_bindings');
    if(!bodyTemplate||!overrideTemplate||(bindings!==undefined&&!bindingsTemplate))return null;
    freezeJson(bodyTemplate);
    const endpoint=`${url.origin}${url.pathname}`;
    return Object.freeze({version:1,endpoint,origin:url.origin,searchTypeId,limit,offset,
      timerange:{type:'absolute',from:timerange.from,to:timerange.to},startMs:timerange.startMs,endMs:timerange.endMs,
      traceId,capturedAt:captured,queryOverride,bodyTemplate,bindingsPresent:bindings!==undefined});
  }
  function validate(descriptor,{sourceUrl,traceId,now=Date.now()}={}){
    const checkedNow=Number(now),captured=Number(own(descriptor,'capturedAt'));
    if(!descriptor||own(descriptor,'version')!==1||!Number.isSafeInteger(checkedNow)||!Number.isSafeInteger(captured)
      ||captured<checkedNow-CAPTURE_TTL_MS||captured>checkedNow+FUTURE_SKEW_MS)return false;
    let source,endpoint;try{source=new URL(String(sourceUrl||''));endpoint=new URL(descriptor.endpoint);}catch{return false;}
    if(!/^https?:$/.test(source.protocol)||source.username||source.password||!/(?:^|\/)search(?:\/|$)/i.test(source.pathname)
      ||source.origin!==endpoint.origin||own(descriptor,'origin')!==endpoint.origin||endpoint.username||endpoint.password||endpoint.search||endpoint.hash
      ||!/\/api\/views\/search\/[a-z0-9_-]{8,128}\/execute(?:\/sync)?\/?$/i.test(endpoint.pathname))return false;
    const expectedTrace=exactTrace(`traceId:${traceId}`),storedTrace=exactTrace(`traceId:${own(descriptor,'traceId')}`);
    if(!expectedTrace||(storedTrace&&storedTrace!==expectedTrace))return false;
    const sourceQuery=source.searchParams.get('q');
    if(sourceQuery!==null&&exactTrace(sourceQuery)!==expectedTrace)return false;
    if(!storedTrace&&exactTrace(sourceQuery)!==expectedTrace)return false;
    const timerange=absoluteRange(own(descriptor,'timerange'));
    const limit=Number(own(descriptor,'limit')),offset=Number(own(descriptor,'offset'));
    const bodyTemplate=own(descriptor,'bodyTemplate'),template=own(bodyTemplate,'global_override'),states=own(template,'search_types'),keep=own(template,'keep_search_types');
    const state=own(states,own(descriptor,'searchTypeId')),templateQuery=own(template,'query'),queryOverride=own(descriptor,'queryOverride')===true;
    const templateRange=absoluteRange(own(template,'timerange'));
    const bindings=own(bodyTemplate,'parameter_bindings'),bindingsPresent=own(descriptor,'bindingsPresent')===true;
    return Boolean(timerange&&timerange.startMs===Number(own(descriptor,'startMs'))&&timerange.endMs===Number(own(descriptor,'endMs'))
      &&templateRange&&templateRange.startMs===timerange.startMs&&templateRange.endMs===timerange.endMs
      &&id(own(descriptor,'searchTypeId'))&&Array.isArray(keep)&&keep.length===1&&own(keep,'0')===own(descriptor,'searchTypeId')
      &&states&&typeof states==='object'&&!Array.isArray(states)&&Object.keys(states).length===1&&state&&typeof state==='object'
      &&Number(own(state,'limit'))===limit&&Number(own(state,'offset'))===offset
      &&(queryOverride?exactTrace(String(own(templateQuery,'query_string')||''))===storedTrace:templateQuery===undefined)
      &&safeJson(bodyTemplate)!==null
      &&(bindingsPresent?bindings&&typeof bindings==='object'&&!Array.isArray(bindings)&&Object.keys(bindings).length===0:bindings===undefined)
      &&Number.isSafeInteger(limit)&&limit>=1&&limit<=200&&offset===0&&limit<=MAX_OFFSET);
  }
  function pagePayload(descriptor,traceId,offset,limit){
    if(!validate(descriptor,{sourceUrl:`${descriptor.origin}/search?q=${encodeURIComponent(`traceId:${traceId}`)}`,traceId}))return null;
    const pageOffset=Number(offset),pageLimit=Number(limit);
    if(!Number.isSafeInteger(pageOffset)||pageOffset<0||!Number.isSafeInteger(pageLimit)||pageLimit<1||pageLimit>200||pageOffset+pageLimit>MAX_OFFSET)return null;
    const searchTypeId=descriptor.searchTypeId;
    const payload=safeJson(descriptor.bodyTemplate),globalOverride=own(payload,'global_override');
    if(!payload||!globalOverride)return null;
    globalOverride.search_types[searchTypeId].limit=pageLimit;
    globalOverride.search_types[searchTypeId].offset=pageOffset;
    return payload;
  }
  function result(data,searchTypeId){
    const results=own(data,'results');if(!results||typeof results!=='object')return null;
    const found=[];
    for(const queryId of Object.keys(results).slice(0,16)){
      const searchTypes=own(own(results,queryId),'search_types'),value=own(searchTypes,searchTypeId);
      if(value&&typeof value==='object')found.push(value);
    }
    return found.length===1&&Array.isArray(own(found[0],'messages'))?found[0]:null;
  }
  return Object.freeze({CAPTURE_TTL_MS,exactTrace,absoluteRange,capture,validate,pagePayload,result});
});
