(function installTraceDiagnostics(root) {
  'use strict';
  // An explicit allowlist, never redaction of a serialized source object.
  // Aliases exist only for this download; no salt, reverse map or raw text leaves it.
  const list = value => Array.isArray(value) ? value : [];
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const kinds = ['request','response','openApiRequest','openApiResponse','gorodClientRequest','gorodClientResponse',
    'partnerBackendRequest','partnerBackendResponse','kafkaProduce','kafkaConsume','kafkaBroker',
    'xmlProcedureRequest','xmlProcedureResponse','cacheAccess'];
  const details = {kafkaProduce:'kafkaProduces',kafkaConsume:'kafkaConsumes',kafkaBroker:'kafkaBrokers',
    xmlProcedureRequest:'xmlProcedureRequests',xmlProcedureResponse:'xmlProcedureResponseSamples',cacheAccess:'cacheAccesses'};
  const evidenceNames = ['existing-candidate','batch','kafka-topic','exact-uri','service-uri','init-uri-service','service-family','closed-window',
    'exact-route','duration','time-window','parent-span','response-only'];
  const directionNames = ['incoming','outgoing','incoming-response','outgoing-response'];
  const provenanceNames = ['message','initUri','publicUri','access-completion'];
  const inferenceNames = ['user-assumption','parent-span','gateway-envelope','recovered-response','filtered-ancestry',
    'client-response-window','client-window','http-client','time-window','uri','batch','kafka-topic'];
  const enumValue = (value, choices) => choices.includes(value) ? value : value == null ? null : 'other';
  const MAX_NODES = 1000, MAX_EVENTS = 50000, MAX_ITEMS = 1000;

  function build(loaded, before, after, options = {}) {
    const dictionaries = new Map();
    let limited = false, eventBudget = MAX_EVENTS;
    const take = (value, limit = MAX_ITEMS) => {
      const items = list(value); if (items.length > limit) limited = true; return items.slice(0,limit);
    };
    function alias(kind, raw) {
      if (typeof raw !== 'string' || !raw.trim()) return null;
      if (!dictionaries.has(kind)) dictionaries.set(kind,new Map());
      const map = dictionaries.get(kind);
      if (!map.has(raw)) map.set(raw,`${kind}-${map.size+1}`);
      return map.get(raw);
    }
    let origin = Infinity;
    for (const graph of [loaded,before,after]) for (const node of take(graph?.nodes,MAX_NODES)) {
      for (const kind of kinds) for (const t of take(node[kind+'Times'])) if (number(t)!==null) origin=Math.min(origin,t);
      for (const t of [...kinds.map(kind=>node[kind+'At']),node.reconstructedEntry?.at]) if(number(t)!==null) origin=Math.min(origin,t);
    }
    const relative = value => number(value)!==null && Number.isFinite(origin) ? Math.round((value-origin)*1000)/1000 : null;
    const evidence = value => take(value).map(item=>enumValue(item,evidenceNames));
    const families = ['openApi','gorodClient','partnerBackend'];
    function target(item) {
      if (!item || typeof item!=='object') return null;
      const status = /^(\d{3})(?:\s|$)/.exec(String(item.status ?? ''));
      return {route:alias('route',item.routeKey || item.url || item.uri || item.path),
        method:enumValue(item.method,['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','CONNECT','TRACE']),
        status:status && Number(status[1])>=100 && Number(status[1])<=599 ? Number(status[1]) : null,
        topic:alias('topic',item.topic), key:alias('key',item.key),
        procedure:alias('procedure',item.procedure || item.name),atMs:relative(item.at),
        // Which side of the call a route hint came from and which log field
        // supplied it (a REQUEST line vs. the initUri/publicUri field) - the
        // difference between "this node was called on X" and "X is the
        // whole request's entry URL", which the linking heuristics treat
        // very differently.
        direction:enumValue(item.direction,directionNames), provenance:enumValue(item.provenance,provenanceNames)};
    }
    function call(item) {
      return item ? {family:enumValue(item.family,families),requestMs:relative(item.requestAt),responseMs:relative(item.responseAt),
        requestInferred:item.requestInferred===true,targetOrdinal:number(item.targetOrdinal)} : null;
    }
    function graph(source, includeSequence) {
      const nodes=take(source?.nodes,MAX_NODES), nodeId=index=>Number.isInteger(index)&&index>=0&&index<nodes.length ? `node-${index+1}` : null;
      const sequence=[];
      // The assumption pass's own view of this graph: for every node it could
      // not link, which parents it scored and why it stopped (no eligible
      // candidate at all, or several tied). Reported, never applied here.
      let explanation=null;
      try { explanation=root.TraceAssumptionMatcher?.explain?.(source) || null; } catch { explanation=null; }
      const result=nodes.map((node,index)=>{
        const operations={};
        for(const kind of kinds) {
          const times=take(node[kind+'Times']);
          if(!times.length && number(node[kind+'At'])!==null) times.push(node[kind+'At']);
          const targets=take(node[kind+'Targets'] || node[details[kind]]).map(target);
          const count=number(node[kind+'Count']);
          if(count>MAX_ITEMS) limited=true;
          if(!times.length && !targets.length && !count) continue;
          const logSteps=take(node[kind+'LogSteps']).map(number), durations=take(node[kind+'Durations']).map(number);
          operations[kind]={count,timesMs:times.map(relative),logSteps,durationsMs:durations,targets};
          if(includeSequence) for(let ordinal=0;ordinal<Math.max(times.length,count ? Math.min(count,MAX_ITEMS) : 0);ordinal++) {
            if(eventBudget<=0){limited=true;break;}
            eventBudget--;
            sequence.push({node:nodeId(index),kind,ordinal,atMs:relative(times[ordinal]),logStep:logSteps[ordinal] ?? null});
          }
        }
        return {id:nodeId(index),service:alias('service',node.service),span:alias('span',node.spanId),
          parentSpans:take(node.parentSpanIds).map(value=>alias('span',value)),
          identityFields:take(node.identityFields).map(value=>enumValue(value,['service-name','instance-name'])),
          jobs:take(node.jobNames).map(value=>alias('job',value)),streams:take(node.streamIds).map(value=>alias('stream',value)),
          batches:take(node.batchKeys).map(value=>alias('batch',typeof value==='string'?value:value?.key)),
          gateway:!!node.reconstructedEntry || (list(node.identityFields).includes('service-name') && /(?:^|[-_.])gateway$/i.test(node.service||'')),
          parent:nodeId(node.parentIndex),depth:number(node.depth),
          inference:enumValue(node.parentInference,inferenceNames),evidence:evidence(node.heuristicEvidence),
          confidence:enumValue(node.heuristicConfidence,['low','medium','high','inferred']),
          reconstructedEntry:node.reconstructedEntry ? {atMs:relative(node.reconstructedEntry.at),child:nodeId(node.reconstructedEntry.childIndex)} : null,
          parentCall:call(node.parentCall),clientExchanges:take(node.clientExchanges).map(call),
          candidateParents:take(node.unresolvedParentCandidates).map(nodeId),
          routeHints:take(node.httpRouteHints).map(target),responseDurationMs:number(node.responseDuration),
          initUriService:explanation?.serviceMatchesInitUri?.[index] ?? null,operations};
      });
      const assumptions=explanation ? {
        initUri:explanation.initUri,
        unlinked:take(explanation.unlinked).map(entry=>({node:nodeId(entry.childIndex),islandKind:entry.islandKind,outcome:entry.outcome,tied:entry.tied,
          candidates:take(entry.candidates,8).map(item=>({parent:nodeId(item.parentIndex),score:item.score,distanceMs:number(item.distance),evidence:evidence(item.evidence)}))}))
      } : null;
      sequence.sort((a,b)=>(a.atMs??Infinity)-(b.atMs??Infinity)||(a.logStep??Infinity)-(b.logStep??Infinity));
      const edges=take(source?.edges,10000).map(edge=>({from:nodeId(edge.from),to:nodeId(edge.to),
        assumption:edge.assumption===true,inferred:edge.inferred===true,requestObserved:edge.requestObserved===true,
        responseObserved:edge.responseObserved===true,evidence:evidence(edge.evidence)}));
      return {nodeCount:list(source?.nodes).length,nodes:result,edges,
        roots:take(source?.rootIslands).map(island=>({node:nodeId(island.rootIndex),
          kind:enumValue(island.kind,['sync-entry','standalone','unresolved-parent','async-kafka','reconstructed-gateway']),
          candidates:take(island.likelyNodeIndexes).map(nodeId)})),
        kafkaLinks:take(source?.kafkaLinks).map(link=>({from:nodeId(link.producerNodeIndex),to:nodeId(link.consumerNodeIndex),topic:alias('topic',link.topic)})),
        assumptions,
        ...(includeSequence?{sequence}: {})};
    }
    const result={schema:'sensor-trace-diagnostic/1',
      source:'Loaded graph model; not raw logs. Node IDs are local to each graph; service/span aliases are shared.',
      privacy:'Names, routes and identifiers replaced by per-export aliases. No raw messages, bodies, query, host or absolute dates. Topology, counts and relative milliseconds retained.',
      version:typeof options.version==='string'?options.version.slice(0,32):null,
      assumptionsEnabled:options.assumptionsEnabled===true,scope:options.scope==='configured'?'configured':'all',
      loadedMessages:number(loaded?.loadedMessages),totalMessages:number(loaded?.totalMessages),
      loading:loaded?.loadingMore===true,partial:!!loaded?.loadError || loaded?.complete===false || loaded?.loadingMore===true,
      loaded:graph(loaded,true),before:graph(before,false),after:graph(after,false),
      display:take(options.positions,MAX_NODES).map((p,index)=>({node:`node-${index+1}`,x:number(p?.x),y:number(p?.y),
        depth:number(p?.depth),hidden:p?.foldHidden===true,parentSubcallIndex:number(p?.parentSubcallIndex)}))};
    result.truncated=limited;
    result.limits={nodesPerGraph:MAX_NODES,events:MAX_EVENTS,itemsPerField:MAX_ITEMS};
    return result;
  }
  const api=Object.freeze({build});
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  root.TraceDiagnostics=api;
})(typeof globalThis!=='undefined'?globalThis:this);
