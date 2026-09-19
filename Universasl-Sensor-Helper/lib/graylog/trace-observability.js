(function initializeTraceObservability(root){
  "use strict";
  const finite=value=>Number.isFinite(Number(value))?Number(value):null;
  const values=node=>[
    ...(node?.requestTimes||[]),...(node?.responseTimes||[]),...(node?.openApiRequestTimes||[]),...(node?.openApiResponseTimes||[]),
    ...(node?.gorodClientRequestTimes||[]),...(node?.gorodClientResponseTimes||[]),...(node?.kafkaProduceTimes||[]),...(node?.kafkaConsumeTimes||[]),
    ...(node?.partnerBackendRequestTimes||[]),...(node?.partnerBackendResponseTimes||[]),
    ...(node?.xmlProcedureRequestTimes||[]),...(node?.xmlProcedureResponseTimes||[]),...(node?.cacheAccessTimes||[])
  ].map(finite).filter(value=>value!==null);
  function interval(node){
    const times=values(node);if(!times.length)return null;
    const start=finite(node?.completedOperation?.start)??Math.min(...times);
    let end=finite(node?.completedOperation?.end)??Math.max(...times);
    const duration=finite(node?.responseDuration);
    if(end===start&&duration!==null&&duration>=0)end=start+duration;
    return end>=start?{start,end,duration:end-start}:null;
  }
  const legitimateRoot=island=>['sync-entry','async-kafka','reconstructed-gateway'].includes(island?.kind);
  const completed=node=>Boolean((Number(node?.requestCount)>0&&Number(node?.responseCount)>0)
    ||(Number(node?.openApiRequestCount)>0&&Number(node?.openApiResponseCount)>0)
    ||(Number(node?.gorodClientRequestCount)>0&&Number(node?.gorodClientResponseCount)>0)
    ||(Number(node?.partnerBackendRequestCount)>0&&Number(node?.partnerBackendResponseCount)>0)
    ||Number(node?.kafkaProduceCount)>0||Number(node?.kafkaConsumeCount)>0||Number(node?.kafkaBrokerCount)>0
    ||Number(node?.xmlProcedureResponseCount)>0||Number(node?.cacheAccessCount)>0);
  function confidenceRank(value){return {observed:3,high:2,medium:1,low:0}[value]??0;}
  function summarize(model){
    const nodes=Array.isArray(model?.nodes)?model.nodes:[],edges=Array.isArray(model?.edges)?model.edges:[],roots=Array.isArray(model?.rootIslands)?model.rootIslands:[];
    const intervals=nodes.map(interval),connected=new Set(edges.map(edge=>edge.to)),rootMap=new Map(roots.map(item=>[item.rootIndex,item]));
    const accounted=nodes.reduce((sum,_node,index)=>sum+(connected.has(index)||legitimateRoot(rootMap.get(index))?1:0),0);
    const completion=nodes.filter(completed).length,timed=intervals.filter(Boolean).length;
    const observedEdges=edges.filter(edge=>nodes[edge.to]?.parentInference==='parent-span').length;
    const highEdges=edges.filter(edge=>['high','observed'].includes(nodes[edge.to]?.heuristicConfidence)).length;
    const inferredEdges=Math.max(0,edges.length-observedEdges);
    const unresolvedRoots=roots.filter(item=>!legitimateRoot(item)).length;
    const missingParentRefs=nodes.filter(node=>node?.parentSpanIds?.length&&node.parentIndex===null).length;
    const clockSkew=[];
    for(const [edgeIndex,edge] of edges.entries()){
      const parent=intervals[edge.from],child=intervals[edge.to];
      if(parent&&child&&child.start+2<parent.start)clockSkew.push({edgeIndex,deltaMs:parent.start-child.start});
    }
    const topologyPart=nodes.length?accounted/nodes.length:0,completionPart=nodes.length?completion/nodes.length:0,timePart=nodes.length?timed/nodes.length:0;
    const confidencePart=edges.length?(observedEdges+0.8*(highEdges-observedEdges)+0.45*Math.max(0,edges.length-highEdges))/edges.length:1;
    const score=Math.max(0,Math.min(100,Math.round(45*topologyPart+30*completionPart+15*timePart+10*confidencePart-5*Math.min(3,clockSkew.length))));
    const children=Array.from({length:nodes.length},()=>[]),hasParent=new Set();
    for(const edge of edges)if(nodes[edge.from]&&nodes[edge.to]&&edge.from!==edge.to){children[edge.from].push(edge.to);hasParent.add(edge.to);}
    let best=null;
    function walk(index,path,seen,minConfidence){
      if(seen.has(index)||path.length>nodes.length)return;
      const nextSeen=new Set(seen);nextSeen.add(index);const nextPath=[...path,index];
      const start=intervals[nextPath[0]]?.start,end=intervals[index]?.end;
      if(!children[index].length&&start!==undefined&&end!==undefined&&end>=start){const candidate={nodeIndexes:nextPath,durationMs:end-start,confidence:minConfidence};
        if(!best||candidate.durationMs>best.durationMs)best=candidate;else if(candidate.durationMs===best.durationMs)best={...best,ambiguous:true};}
      for(const child of children[index])walk(child,nextPath,nextSeen,Math.min(minConfidence,confidenceRank(nodes[child]?.heuristicConfidence||'low')));
    }
    for(let index=0;index<nodes.length;index++)if(!hasParent.has(index))walk(index,[],new Set(),3);
    if(best)best.confidence=['low','medium','high','observed'][best.confidence]||'low';
    return Object.freeze({score,grade:score>=85?'good':score>=65?'partial':'weak',observedEdges,inferredEdges,unresolvedRoots,missingParentRefs,
      clockSkewWarnings:clockSkew.length,longestBranch:best?Object.freeze(best):null});
  }
  const api=Object.freeze({summarize,interval});
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  root.TraceObservability=api;
})(globalThis);
