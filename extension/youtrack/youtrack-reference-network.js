/* Explicit transport for both reports. Never patches window.fetch. */
(() => {
  'use strict';
  const send=row=>chrome.runtime.sendMessage({type:'youtrack-request-log',row}).catch(()=>{});
  async function request(url,init){
    const u=new URL(url),start=performance.now();
    const row={id:crypto.randomUUID(),at:Date.now(),source:location.pathname.endsWith('youtrack-fields.html')?'fields':'report',path:u.pathname,method:init?.method||'GET',top:u.searchParams.has('$top')?Number(u.searchParams.get('$top')):null,skip:u.searchParams.has('$skip')?Number(u.searchParams.get('$skip')):null,state:'pending'};
    send(row);
    try{const response=await fetch(url,init);send({...row,status:response.status,state:response.ok?'success':'error',ms:performance.now()-start});return response;}
    catch(error){send({...row,state:'error',ms:performance.now()-start});throw error;}
  }
  globalThis.YouTrackReferenceNetwork=Object.freeze({fetch:request});
})();
