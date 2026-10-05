(function initializeTraceHeuristicResolver(root) {
  "use strict";

  // Evidence is compared lexicographically. Several weak hints can therefore
  // never outweigh one stronger observation. Unknown labels are ignored.
  const EVIDENCE_ORDER = Object.freeze([
    "explicit-parent", "same-span", "exact-route-method-duration",
    "exact-route-method", "exact-route", "exception-callsite",
    "exception-signature", "batch-topic", "closed-window",
    "service-uri-token", "duration-window", "nearest-event", "time-window"
  ]);
  const EVIDENCE_INDEX = new Map(EVIDENCE_ORDER.map((name, index) => [name, index]));
  const HARD_CONTRADICTIONS = new Set([
    "trace-mismatch", "explicit-parent-mismatch", "route-mismatch",
    "method-mismatch", "reverse-time", "outside-window", "self-cycle"
  ]);
  const finite = value => value === null || value === undefined || value === "" ? Infinity : Number.isFinite(Number(value)) ? Number(value) : Infinity;
  const list = value => Array.isArray(value) ? value : [];

  function normalized(candidate) {
    if (!candidate || typeof candidate !== "object") return null;
    const contradictions = [...new Set(list(candidate.contradictions).filter(value => HARD_CONTRADICTIONS.has(value)))];
    if (contradictions.length) return null;
    const evidence = [...new Set(list(candidate.evidence).filter(value => EVIDENCE_INDEX.has(value)))];
    if (!evidence.length) return null;
    const vector = EVIDENCE_ORDER.map(name => evidence.includes(name) ? 1 : 0);
    return { candidate, evidence, vector,
      hops:finite(candidate.hops), distance:finite(candidate.distance), width:finite(candidate.width) };
  }

  function compare(left, right) {
    for (let index = 0; index < EVIDENCE_ORDER.length; index += 1) {
      if (left.vector[index] !== right.vector[index]) return right.vector[index] - left.vector[index];
    }
    if (left.hops !== right.hops) return left.hops - right.hops;
    if (left.distance !== right.distance) return left.distance - right.distance;
    if (left.width !== right.width) return left.width - right.width;
    return 0;
  }

  function confidence(evidence) {
    const strongest = EVIDENCE_ORDER.find(name => evidence.includes(name));
    if (["explicit-parent", "same-span"].includes(strongest)) return "observed";
    if (["exact-route-method-duration", "exact-route-method", "exception-callsite"].includes(strongest)) return "high";
    if (["exact-route", "exception-signature", "batch-topic", "closed-window"].includes(strongest)) return "medium";
    return "low";
  }

  function resolveUnique(candidates) {
    const ranked = list(candidates).map(normalized).filter(Boolean).sort(compare);
    if (!ranked.length) return Object.freeze({ winner:null, ambiguous:false, alternatives:0, confidence:null, evidence:[] });
    const tied = ranked.filter(item => compare(item, ranked[0]) === 0);
    if (tied.length !== 1) return Object.freeze({ winner:null, ambiguous:true, alternatives:tied.length,
      confidence:confidence(ranked[0].evidence), evidence:[...ranked[0].evidence] });
    return Object.freeze({ winner:ranked[0].candidate, ambiguous:false, alternatives:ranked.length - 1,
      confidence:confidence(ranked[0].evidence), evidence:[...ranked[0].evidence] });
  }

  // A pair is accepted only when both endpoints choose one another. This
  // avoids greedy matching where an early response steals a request from a
  // later, stronger pair. Endpoints and raw values never enter the result.
  function resolveMutual(proposals) {
    let remaining = list(proposals).filter(item => item && item.leftKey !== undefined && item.rightKey !== undefined);
    const accepted = [];
    while (remaining.length) {
      const byLeft = new Map(), byRight = new Map();
      for (const proposal of remaining) {
        const left = byLeft.get(proposal.leftKey) || []; left.push(proposal); byLeft.set(proposal.leftKey,left);
        const right = byRight.get(proposal.rightKey) || []; right.push(proposal); byRight.set(proposal.rightKey,right);
      }
      const round=[];
      for (const proposal of remaining) {
        const left=resolveUnique(byLeft.get(proposal.leftKey)),right=resolveUnique(byRight.get(proposal.rightKey));
        if(left.winner===proposal&&right.winner===proposal)round.push({proposal,confidence:left.confidence,
          evidence:left.evidence.filter(name=>right.evidence.includes(name))});
      }
      if(!round.length)break;
      const usedLeft=new Set(round.map(item=>item.proposal.leftKey)),usedRight=new Set(round.map(item=>item.proposal.rightKey));
      accepted.push(...round);remaining=remaining.filter(item=>!usedLeft.has(item.leftKey)&&!usedRight.has(item.rightKey));
    }
    return Object.freeze({matches:accepted.map(item=>Object.freeze(item)),unresolved:remaining.length});
  }

  const api=Object.freeze({EVIDENCE_ORDER,HARD_CONTRADICTIONS,resolveUnique,resolveMutual,confidence});
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  root.TraceHeuristicResolver=api;
})(globalThis);
