(function initializeTraceErrorTimeline(root) {
  "use strict";
  const chain = typeof module !== "undefined" && module.exports ? require("./exception-chain") : root.GraylogExceptionChain;
  const heuristicResolver = typeof module !== "undefined" && module.exports ? require("./trace-heuristic-resolver") : root.TraceHeuristicResolver;
  const MAX_EVENTS = 40, MAX_RECORDS = 10000, MAX_EVIDENCE = 2000, MAX_DEPTH = 32;
  const scalar = value => Array.isArray(value) ? value[0] : value;
  const safeId = value => { const text = scalar(value); return typeof text === "string" && /^[a-z0-9_-]{1,128}$/i.test(text) ? text : ""; };
  const serviceName = value => typeof scalar(value) === "string" ? scalar(value).replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,160) : "";
  const eventId = value => typeof value === "string" && /^ev1_[a-f0-9]{16}$/.test(value) ? value : null;
  const generic = /^(?:Exception|Error|Throwable|RuntimeException|ResponseCodeException|CompletionException|ExecutionException|UndeclaredThrowableException|InvocationTargetException|ReactiveException)$/;
  function fieldsOf(record) {
    if (!record || typeof record !== "object") return null;
    // A flat successful event need not expose its message at all.
    if (record.level !== undefined) return record;
    return record.message && typeof record.message === "object" ? record.message : record;
  }
  function nodeKey(service, span) { return JSON.stringify([service, span]); }
  function exceptionProfile(fields) {
    for (const field of [chain.stackSource(fields)?.field].filter(Boolean)) {
      const text = scalar(fields?.[field]);
      if (typeof text !== "string") continue;
      const parsed = chain?.parse(text) || [];
      if (!parsed.length) continue;
      const entries=parsed.map(entry=>{
        const tail=text.slice(entry.end,entry.end+2049).split('\n',1)[0];
        // Compare original bounded header text locally. Masking before matching
        // could join different account IDs; neither this text nor its hash is emitted.
        const signature=tail.length<=2048?tail.replace(/^\s*:\s*/,'').trim().replace(/[ \t]+/g,' '):'';
        const meaningful=Boolean(signature && !/^(?:null|unknown|error|failure|failed|test|wrapper|exception|timeout|request failed|internal server error)[.;\s]*$/i.test(signature)
          && (/^[A-Z][A-Z0-9_]{2,63}(?:\s*[;:]|$)/.test(signature) || (signature.length>=12 && /[A-Za-zА-Яа-я]/.test(signature))));
        return {name:entry.name,signature,meaningful,generic:generic.test(entry.name.split('.').at(-1))};
      });
      const site=chain?.callsite?.(text),calls=chain?.outgoingHttp?.(text)||[];
      return {entries,trace:safeId(fields.traceId??fields.trace_id),
        siteKey:site&&site.method&&site.file&&Number.isFinite(site.line)?`${site.method}\u0000${site.file}\u0000${site.line}`:'',
        httpKeys:new Set(calls.map(call=>`${call.method}\u0000${call.origin||''}\u0000${call.path||''}`))};
    }
    return null;
  }
  function matchingException(source,target) {
    if(!source||!target||(source.trace&&target.trace&&source.trace!==target.trace))return null;
    for(let left=source.entries.length-1;left>=0;left--)for(let right=target.entries.length-1;right>=0;right--){
      const a=source.entries[left],b=target.entries[right];
      if(a.name!==b.name)continue;
      const signature=a.meaningful&&b.meaningful&&a.signature===b.signature;
      // A common outer wrapper must not overrule two incompatible concrete causes.
      const sourceLeaf=source.entries.at(-1),targetLeaf=target.entries.at(-1);
      if((left!==source.entries.length-1||right!==target.entries.length-1)&&!sourceLeaf.generic&&!targetLeaf.generic&&
        (sourceLeaf.name!==targetLeaf.name||(sourceLeaf.signature&&targetLeaf.signature&&sourceLeaf.signature!==targetLeaf.signature)))continue;
      const callsite=Boolean(source.siteKey&&source.siteKey===target.siteKey);
      const http=Boolean(source.httpKeys?.size&&target.httpKeys?.size&&[...source.httpKeys].some(key=>target.httpKeys.has(key)));
      if(signature)return {signature:true,callsite,http};
      if(a.signature&&b.signature&&a.signature!==b.signature)continue;
      if(!a.generic&&left===source.entries.length-1&&right===target.entries.length-1)return {signature:false,callsite,http};
    }
    return null;
  }
  function* collect(records, groups) {
    const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
    let sliceStarted = now();
    const input = Array.isArray(records) ? records : [], groupList = Array.isArray(groups) ? groups : [];
    const candidates = [];
    let evidenceCount = 0, representedCount = 0, unknownTimestampCount=0;
    const byTime=(a,b)=>(a.at===null)-(b.at===null)||(a.at??0)-(b.at??0)||String(a.eventKey||'').localeCompare(String(b.eventKey||''));
    for (let groupIndex = 0; groupIndex < groupList.length; groupIndex++) {
      if(groupIndex%32 === 0 || now()-sliceStarted >= 4) { yield; sliceStarted=now(); }
      const group = groupList[groupIndex], evidence = Array.isArray(group?.timelineEvidence) ? group.timelineEvidence : Array.isArray(group?.evidence) ? group.evidence : [];
      evidenceCount += evidence.length;
      representedCount += Number.isFinite(group?.count) ? Math.max(0,group.count) : evidence.length;
      for (let index = 0; index < evidence.length; index++) {
        if(index && (index%32 === 0 || now()-sliceStarted >= 4)) { yield; sliceStarted=now(); }
        const entry = evidence[index];
        if (!entry || typeof entry !== "object") continue;
        candidates.push({id:`error-${groupIndex}-${index}`,eventKey:eventId(entry.eventKey),groupIndex,
          service:serviceName(group.service),spanId:safeId(group.spanId),at:typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : null,
          exceptionType:typeof group.exceptionType === "string" && /^[\w.$]{1,320}$/.test(group.exceptionType) ? group.exceptionType : null,
          sourceAvailable:chain.FIELD_NAMES.includes(entry.sourceField), relation:"unlinked",predecessorId:null});
        if(candidates.at(-1).at===null)unknownTimestampCount++;
        if(candidates.length>MAX_EVENTS){candidates.sort(byTime);candidates.length=MAX_EVENTS;}
      }
    }
    candidates.sort(byTime);
    const events = candidates.slice(0,MAX_EVENTS), wanted = new Set(events.map(event=>event.eventKey).filter(Boolean));
    const nodes = new Map(), bySpan = new Map(), eventRecords = new Map();
    for (let index = 0; index < Math.min(input.length,MAX_RECORDS); index++) {
      if(index%32 === 0 || now()-sliceStarted >= 4) { yield; sliceStarted=now(); }
      const fields = fieldsOf(input[index]);
      if (!fields) continue;
      const service = serviceName(fields["service-name"]) || serviceName(fields.service_name) || serviceName(fields.serviceName) || serviceName(fields.service) || serviceName(fields["instance-name"]), span = safeId(fields.spanId ?? fields.span_id);
      if (span) {
        const key = nodeKey(service,span);
        let node = nodes.get(key);
        if (!node) { node = {key,parents:new Set(),traces:new Set()}; nodes.set(key,node); const list = bySpan.get(span) || new Set(); list.add(key); bySpan.set(span,list); }
        for (const field of ["parentSpanId","parent_span_id","parent-span-id"]) {
          const parent = safeId(fields[field]); if(parent)node.parents.add(parent);
        }
        const trace = safeId(fields.traceId ?? fields.trace_id); if(trace)node.traces.add(trace);
      }
      if (Number(scalar(fields.level)) !== 3 || !wanted.size) continue;
      const key = chain?.eventKey(fields);
      if (!wanted.has(key)) continue;
      // Duplicated keys cannot be used as identity or to choose a cause silently.
      eventRecords.set(key,eventRecords.has(key) ? null : fields);
    }
    const profiles = new Map();
    for (const event of events) {
      yield;
      const fields = eventRecords.get(event.eventKey); profiles.set(event.id,fields ? exceptionProfile(fields) : null);
    }
    function distance(child,parent) {
      if (!child.spanId || !parent.spanId || child.spanId === parent.spanId) return null;
      let node = nodes.get(nodeKey(child.service,child.spanId));
      const target = nodeKey(parent.service,parent.spanId), seen = new Set(), traces = new Set();
      let found = null;
      for (let depth = 1; node && depth <= MAX_DEPTH; depth++) {
        if (seen.has(node.key) || node.parents.size > 1 || node.traces.size > 1) return null;
        seen.add(node.key); for(const trace of node.traces)traces.add(trace); if(traces.size>1)return null;
        if(!node.parents.size)return found;
        const keys = bySpan.get([...node.parents][0]);
        if (!keys)return found;
        if (keys.size !== 1)return null;
        node = nodes.get([...keys][0]);
        for(const trace of node.traces)traces.add(trace); if(traces.size>1)return null;
        if (node.key === target)found=depth;
      }
      return null;
    }
    const links = []; let orderConflictCount = 0, ambiguousLinkCount = 0;
    const connectedRoot=event=>{let current=event,depth=0;while(current.predecessorId&&depth++<MAX_EVENTS)current=events.find(candidate=>candidate.id===current.predecessorId)||current;return current.id;};
    const validNode=event=>{const node=nodes.get(nodeKey(event.service,event.spanId));return Boolean(node&&node.parents.size<=1&&node.traces.size<=1&&bySpan.get(event.spanId)?.size===1&&!node.parents.has(event.spanId));};
    const sharedSpan=(a,b)=>{
      if(!a.spanId||a.spanId!==b.spanId||a.service===b.service)return false;
      const left=nodes.get(nodeKey(a.service,a.spanId)),right=nodes.get(nodeKey(b.service,b.spanId));
      if(!left||!right||left.parents.size>1||right.parents.size>1||left.traces.size>1||right.traces.size>1||left.parents.has(a.spanId)||right.parents.has(b.spanId))return false;
      return !left.parents.size||!right.parents.size||[...left.parents][0]===[...right.parents][0];
    };
    for (const target of events) {
      yield;
      if (target.at === null || !profiles.get(target.id)) continue;
      const matches = [];
      for (const source of events) {
        if (source === target || source.at === null) continue;
        const match=matchingException(profiles.get(source.id),profiles.get(target.id));if(!match)continue;
        const hops=distance(source,target),sameSpan=source.spanId&&source.spanId===target.spanId&&source.service===target.service&&validNode(source);
        let evidence=null,kind=null,rank=0;
        if(hops!==null){evidence=match.signature?'span-ancestor-and-signature':'span-ancestor-and-exception';kind='propagated';}
        else if(sameSpan&&match.signature){evidence='same-span-and-signature';kind='relogged';rank=1;}
        else if(match.signature&&profiles.get(source.id).trace&&profiles.get(source.id).trace===profiles.get(target.id).trace&&sharedSpan(source,target)){
          evidence='shared-span-and-signature';kind='similar';rank=2;
        }
        else {
          const a=profiles.get(source.id),b=profiles.get(target.id),sourceNode=nodes.get(nodeKey(source.service,source.spanId));
          // Without an explicit path require exact meaningful header equality
          // and an explicit common trace. Never override a known contrary path.
          if(!match.signature||!a.trace||a.trace!==b.trace||(sourceNode?.parents.size)||
            (source.spanId&&!validNode(source))||(target.spanId&&!validNode(target))||distance(target,source)!==null)continue;
          evidence='trace-and-signature';kind='similar';rank=2;
        }
        if(source.at > target.at) { if(hops!==null)orderConflictCount++; continue; }
        if(source.at === target.at)continue;
        const heuristicEvidence=[...(hops!==null?['explicit-parent']:sameSpan?['same-span']:[]),
          ...(match.callsite?['exception-callsite']:[]),...(match.http?['exact-route-method']:[]),
          ...(match.signature?['exception-signature']:[]),'nearest-event'];
        matches.push({source,hops,evidence,kind,rank,heuristicEvidence,distance:target.at-source.at});
      }
      if(!matches.length)continue;
      matches.sort((a,b)=>a.rank-b.rank || (a.hops??0)-(b.hops??0) || b.source.at-a.source.at);
      const semantic=matches.filter(match=>match.rank===matches[0].rank&&match.hops===matches[0].hops);
      const decision=heuristicResolver?.resolveUnique?.(semantic.map(match=>({match,evidence:match.heuristicEvidence,
        hops:match.hops,distance:match.distance})))||null;
      const nearest=semantic;
      const origins=new Set(nearest.map(match=>match.kind==='similar'?connectedRoot(match.source):nodeKey(match.source.service,match.source.spanId)));
      if(!decision?.winner||origins.size !== 1 || nearest.filter(match=>match.source.at===nearest[0].source.at).length>1) { ambiguousLinkCount++; continue; }
      const match = decision.winner.match; target.relation = "probable-propagation"; target.predecessorId = match.source.id;
      links.push({from:match.source.id,to:target.id,relationship:"probable",evidence:match.evidence,kind:match.kind,hops:match.hops,
        confidence:decision.confidence,heuristicEvidence:decision.evidence});
    }
    const known = events.filter(event=>event.at !== null), counts = new Map();
    for(const event of known)counts.set(event.at,(counts.get(event.at)||0)+1);
    return {events,firstObservedIds:known.filter(event=>event.at === known[0].at).map(event=>event.id),links,
      incomplete:input.length>MAX_RECORDS || representedCount>events.length,
      observedEventCount:representedCount,shownEventCount:events.length,omittedEventCount:Math.max(0,representedCount-events.length),
      unknownTimestampCount,
      tiedTimestampCount:known.filter(event=>counts.get(event.at)>1).length,orderConflictCount,ambiguousLinkCount};
  }
  function build(records,groups) {
    const iterator=collect(records,groups);
    let step=iterator.next();
    while(!step.done)step=iterator.next();
    return step.value;
  }
  async function buildAsync(records,groups,options={}) {
    const signal=options.signal, yieldControl=typeof options.yieldControl === "function" ? options.yieldControl : () => new Promise(resolve=>setTimeout(resolve,0));
    const checkAbort=()=>{if(signal?.aborted) { const error=new Error("Trace analysis cancelled"); error.name="AbortError"; throw error; }};
    const iterator=collect(records,groups);
    try {
      for(;;) {
        checkAbort();
        const step=iterator.next();
        if(step.done)return step.value;
        await yieldControl(signal);
      }
    } finally { iterator.return(); }
  }
  const api = Object.freeze({build,buildAsync,MAX_EVENTS,MAX_RECORDS,MAX_DEPTH});
  if(typeof module !== "undefined" && module.exports)module.exports=api;
  root.TraceErrorTimeline=api;
})(globalThis);
