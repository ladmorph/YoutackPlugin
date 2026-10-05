(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.TraceCallGroups=api;})(globalThis,function(){
  'use strict';
  // Presentation only: indices, topology, counts and chronological steps stay intact.
  function plan(nodes,positions,subcalls,edges=[],expanded=new Set()){
    const refs=positions.map((box,index)=>({key:'n'+index,type:'node',index,box,data:nodes[index],children:[]}));
    const calls=subcalls.map((box,index)=>({key:'s'+index,type:'subcall',index,box,data:box,children:[]}));
    const all=[...refs,...calls],groups=[];
    for(const r of all){r.parent=r.type==='node'?(calls[r.box.parentSubcallIndex]||refs[r.data.parentIndex]):refs[r.data.parentIndex];if(r.parent&&r.parent!==r)r.parent.children.push(r);}
    const closure=r=>{const result=[],seen=new Set();const visit=x=>{if(seen.has(x))return;seen.add(x);result.push(x);x.children.forEach(visit);};visit(r);return result;};
    const safe=members=>{
      const nodeSet=new Set(members.filter(r=>r.type==='node').map(r=>r.index));
      if(members.some(r=>r.data.kafkaProduce||r.data.kafkaProduceCount||r.data.kafkaConsumeCount||r.data.kafkaBrokerCount))return false;
      // A cross-branch edge must remain visible; never silently discard it.
      for(const e of edges){if(nodeSet.has(e.from)&&!nodeSet.has(e.to))return false;if(nodeSet.has(e.to)&&!nodeSet.has(e.from)){
        const target=refs[e.to];if(target.data.parentIndex!==e.from)return false;
      }}return true;
    };
    const add=(kind,owner,roots,title)=>{
      const members=[...new Set(roots.flatMap(closure))];
      const hidden=members.filter(r=>r!==owner);
      if(!hidden.length||!safe(members))return;
      const group={id:kind+':'+owner.key+':'+roots.map(r=>r.key).join(','),kind,owner,roots,members,title,count:roots.length,collapsed:false};
      group.errors=[...new Set([...members,owner])].filter(r=>r.type==='node'?Number(r.data.responseLevel3Count)>0:r.data.responseLevel3||r.data.clientFailure||r.data.diagnostic).length;
      group.collapsed=!expanded.has(group.id);groups.push(group);owner.box.foldGroup=group;
      owner.box.width=Math.max(owner.box.width,350);owner.box.height+=62;
      if(group.collapsed){owner.box.height=164;for(const r of hidden){r.box.foldHidden=true;r.box.foldOwner=owner.box;}}
    };
    const signature=r=>{
      const d=r.data;if(!r.parent||d.jobNames?.length||d.diagnostic||d.assumption||d.cacheChain||d.kafkaProduce||d.xmlProcedure||d.kafkaProduceCount||d.kafkaConsumeCount||d.kafkaBrokerCount)return null;
      if(r.type==='node'&&d.requestCount!==1 || r.type==='subcall'&&d.requestObserved!==true)return null;
      const targets=r.type==='node'?d.requestTargets:[d.detail];if(targets?.length!==1)return null;
      const t=targets[0];if(!t?.method||!/^call-\d+$/.test(t.callKey||''))return null;
      const response=r.type==='node'?d.responseCount>0:d.responseObserved;
      const statuses=r.type==='node'?(d.responseTargets||[]).map(t=>t.status||'?').sort():[d.responseStatus||'?'];
      const labels=[...new Set((d.labels||d.requestLabels||[]).map(v=>JSON.stringify([v.action||'',v.requestType||''])))].sort();
      return JSON.stringify([labels,r.parent.key,r.type,d.service||'',d.label||'',t.clientKey||'',t.method,t.callKey,response,Boolean(d.responseLevel3||d.responseLevel3Count||d.clientFailure),statuses]);
    };
    const buckets=new Map();for(const r of all){const key=signature(r);if(key){if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}}
    for(const bucket of buckets.values())if(bucket.length>1){const first=bucket[0],t=first.type==='node'?first.data.requestTargets[0]:first.data.detail;add('repeat',first,bucket,`${t.method} ${t.url}`);}
    // job-name is evidence of a scheduled context, never an edge between spans.
    for(const r of refs){const names=r.data.jobNames||[];if(!names.length)continue;
      let p=r.parent,seen=new Set(),inherited=false;while(p&&!seen.has(p)){seen.add(p);if(p.data.jobNames?.some(n=>names.includes(n))){inherited=true;break;}p=p.parent;}
      if(inherited)continue;r.box.schedulerNames=names;
      const roots=r.children.filter(child=>safe(closure(child)));
      if(roots.length)add('scheduler',r,roots,names.join(' · '));
      if(!r.box.foldGroup){r.box.height+=62;r.box.width=Math.max(350,r.box.width);}
    }
    return groups;
  }
  return {plan};
});
