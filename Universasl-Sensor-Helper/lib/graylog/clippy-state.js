(function (root) {
  "use strict";
  const actions = new Set(["welcome","idle","search","loading","analysis","success","empty","error","warning","export","exported","playback","pause"]);
  function create(notify) {
    const pending = new Map();
    let sequence=0, action="idle", outcomes=[];
    const publish = next => { if (!actions.has(next)) return false; action=next; notify?.({action,pending:pending.size}); return true; };
    function show(next) {
      if (!actions.has(next)) return false;
      if (pending.size && !["error","warning"].includes(next)) return false;
      return publish(next);
    }
    function begin(next) {
      if (!actions.has(next)) return () => {};
      const id=++sequence;
      if (!pending.size) outcomes=[];
      pending.set(id,next);publish(next);
      let finished=false;
      return outcome => {
        if(finished)return;finished=true;pending.delete(id);
        outcomes.push(["success","empty","error","warning","exported"].includes(outcome)?outcome:"warning");
        if(pending.size) {publish([...pending.values()].at(-1));return;}
        publish(outcomes.includes("error")?"error":outcomes.includes("warning")?"warning":outcomes.every(item=>item==="empty")?"empty":outcomes.includes("exported")?"exported":"success");
        outcomes=[];
      };
    }
    return Object.freeze({begin,show,getState:()=>({action,pending:pending.size})});
  }
  function traceVerdict(review) {
    if(!review||typeof review!=="object")return "unknown";
    if(Number(review.errorEvents)>0 || ["slowCalls","repeated","incomplete","recovered"].some(key=>Array.isArray(review[key])&&review[key].length))return "work";
    if(review.errorsAvailable!==true||review.partial||!Number.isInteger(review.spanCount)||review.spanCount<1||review.errorEvents!==0||review.priority!=="none"||review.unknownDurations!==0)return "unknown";
    return "clear";
  }
  function traceFinding(report,references) {
    if(!report?.available||!Array.isArray(report.groups)||!Array.isArray(references))return null;
    const byId=new Map(references.filter(item=>item&&typeof item.id==="string").map(item=>[item.id,item]));
    const ranks={high:0,medium:1,low:2,unknown:3};
    const found=report.groups.filter(item=>item?.classification==="recognized"&&item.nature!=="business"&&byId.has(item.referenceId)&&Number.isInteger(item.count)&&item.count>0)
      .sort((left,right)=>(ranks[left.priority]??3)-(ranks[right.priority]??3)||right.count-left.count||String(left.referenceId).localeCompare(String(right.referenceId)));
    if(!found.length)return null;
    const first=found[0],reference=byId.get(first.referenceId),types=new Set(found.map(item=>item.referenceId)).size;
    return Object.freeze({referenceId:reference.id,count:first.count,types});
  }
  root.ClippyState=Object.freeze({create,traceVerdict,traceFinding});
  if(typeof module!=="undefined"&&module.exports)module.exports=root.ClippyState;
})(globalThis);
