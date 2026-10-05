// Worker-only bounded, sanitized session journal. No report data or credentials.
(() => {
  const key='youtrackRequestLog';let queue=Promise.resolve();
  const paths=new Set(['/api/workItems','/api/issues','/api/activities','/api/admin/projects','/api/users/me']);
  function sanitize(row){
    if(!row||typeof row.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(row.id))return null;
    return {id:row.id,at:Number.isFinite(row.at)?row.at:Date.now(),source:['fields','cdr'].includes(row.source)?row.source:'report',detail:row.source==='cdr'&&typeof row.detail==='string'?row.detail.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,400):'',
      path:paths.has(row.path)?row.path:/^\/api\/admin\/projects\/[^/]+\/customFields$/.test(row.path)?'/api/admin/projects/:project/customFields':'/api/…',
      method:['GET','POST','TOKEN'].includes(row.method)?row.method:'GET',top:Number.isSafeInteger(row.top)&&row.top>=0?row.top:null,skip:Number.isSafeInteger(row.skip)&&row.skip>=0?row.skip:null,
      state:['pending','success','error','token'].includes(row.state)?row.state:'pending',status:Number.isSafeInteger(row.status)?row.status:null,ms:Number.isFinite(row.ms)?Math.max(0,Math.round(row.ms)):null};
  }
  function write(row){const clean=sanitize(row);if(!clean)return Promise.resolve();queue=queue.catch(()=>{}).then(async()=>{const stored=await chrome.storage.session.get(key),rows=Array.isArray(stored[key])?stored[key]:[];const next=rows.filter(r=>r.id!==clean.id);next.push(clean);next.sort((a,b)=>b.at-a.at);await chrome.storage.session.set({[key]:next.slice(0,200)});});return queue;}
  function clear(){queue=queue.catch(()=>{}).then(()=>chrome.storage.session.set({[key]:[]}));return queue;}
  globalThis.YouTrackRequestStore={write,clear};
})();
