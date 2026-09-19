// Explicit UI pagination only. Raw messages remain in the Graylog MAIN world.
(function installPageCollectionBridge(){
  const jobs=new Map(),ready=new Map(),opening=new Set();
  const files=['lib/graylog/graylog-overlay.js','lib/graylog/exception-chain.js','lib/graylog/trace-heuristic-resolver.js','lib/graylog/trace-observability.js','extension/graylog/graylog-rendered-messages.js','extension/graylog/graylog-page-collector.js','lib/graylog/error-analysis.js','lib/graylog/business-error-rules.js','lib/graylog/trace-error-catalog.js','lib/graylog/java-error-reference.js','lib/graylog/integration-error-reference.js','lib/graylog/postgres-error-reference.js','lib/graylog/kafka-error-reference.js','lib/graylog/error-reference.js','lib/graylog/trace-error-timeline.js','lib/graylog/trace-errors.js','lib/graylog/trace-client-checkpoint.js','lib/graylog/trace-application-groups.js','lib/graylog/graylog-trace-fetch.js','lib/graylog/trace-latency.js','lib/graylog/trace-analysis.js'];
  const execute=async(tabId,func,args=[])=>{
    const response=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func,args});
    if(response?.[0]?.error)throw new Error('Не удалось обработать выдачу Graylog.');
    return response?.[0]?.result;
  };
  const prune=()=>{for(const [tabId,item] of ready)if(Date.now()-item.at>300000)ready.delete(tabId);};
  const context=url=>{const value=new URL(url);for(const key of ['page','offset','pageNumber','page_number','pageno','pageNo','page_no'])value.searchParams.delete(key);return value.href;};
  async function prepareReady(tab,id,job,result){
    if(job.readyPromise)return job.readyPromise;
    job.readyPromise=(async()=>{
      const current=await chrome.tabs.get(tab.id);
      if(context(current.url)!==context(job.url)||job.traceId!==id)throw new Error('Поиск изменился. Собранные страницы не используются.');
      const bounds=tracePreviewBounds(job.url);
      const preview=await execute(tab.id,buildGraylogTracePreview,[`traceId:"${id}"`,bounds.startMs,bounds.endMs,bounds.streamIds,result.token]);
      const checked=await chrome.tabs.get(tab.id);
      if(context(checked.url)!==context(job.url))throw new Error('Поиск изменился. Собранные страницы не используются.');
      const collection={pagesRead:result.pagesRead,totalPages:result.totalPages,messagesRead:result.messagesRead};
      ready.set(tab.id,{token:result.token,traceId:id,url:checked.url,at:Date.now()});
      return {preview,collection};
    })();
    return job.readyPromise;
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type==='get-page-collection-audit'){
      if(sender.id!==chrome.runtime.id||!String(sender.url||'').startsWith(chrome.runtime.getURL(''))){respond({ok:false});return false;}
      respond({ok:true,records:previewOperationLog.filter(entry=>entry.pageCollection===true).slice(0,100)});return false;
    }
    const legacyGraph = message?.type==='open-tools-from-graylog' && message.view==='search' && (message.autoGraph===true || message.autoAnalysis===true);
    if(legacyGraph) message={...message,type:'open-current-page-trace'};
    if(!['open-current-page-trace','page-collection-info','collect-trace-pages','page-collection-progress','cancel-trace-pages','open-collected-trace'].includes(message?.type))return false;
    const tab=graylogSenderTab(sender,message.sourceUrl);
    const traceId=String(message.traceId||'');
    if(!tab||!(/^[a-z0-9_-]{1,128}$/i.test(traceId))){respond({ok:false,error:'Нужен точный traceId в поиске Graylog.'});return false;}
    (async()=>{
      prune();
      if(message.type==='page-collection-info'){
        if(jobs.has(tab.id))return {ok:true,info:{available:false,reason:'busy'}};
        await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files});
        return {ok:true,info:await execute(tab.id,async id=>{
          const info=globalThis.GraylogPageCollector.inspect();if(!info.available)return info;
          const page=await globalThis.__advancedGraylogRenderedMessages.snapshotTrace(id,{queryExact:true,pageNumber:info.currentPage});
          const total=page.nativeTotal,size=page.nativePageSize,count=Number.isSafeInteger(total)&&Number.isSafeInteger(size)&&size>0?Math.ceil(total/size):0;
          const identities=page.messages.map(item=>typeof item.index==='string'&&item.index&&typeof item.message?._id==='string'&&item.message._id?JSON.stringify([item.index,item.message._id]):null);
          const detail=total===null?'missing-total':!size?'missing-page-size':count!==info.totalPages?'page-count-mismatch':page.nativePage!==info.currentPage?'page-changed':page.truncated?'snapshot-truncated':page.nativePayload!==true?'incomplete-messages':!identities.length||identities.some(key=>!key)||new Set(identities).size!==identities.length?'missing-identities':null;
          const causes=(page.truncationReasons||[]).filter(code=>['candidate-limit','metadata-changed','result-changed','page-limit','field-limit','rows-changed'].includes(code));
          if(detail)return {...info,available:false,reason:'unconfirmed-page-total',detail,diagnostic:{pages:info.totalPages,current:info.currentPage,total,size,read:page.messages.length,readable:page.readableCandidates,causes}};
          if(count>5||count<2)return {...info,available:false,reason:count>5?'too-many-pages':'single-page'};
          globalThis.GraylogPageCollector.rememberCurrent?.(id,page,info.currentPage);
          return {...info,nativeTotal:total,pageSize:size,contentTruncated:page.contentTruncated===true};
        },[traceId])};
      }
      if(message.type==='page-collection-progress'){
        const progress=await execute(tab.id,()=>globalThis.GraylogPageCollector?.getProgress?.()||{active:false});
        const job=jobs.get(tab.id),{readyToken,...safeProgress}=progress||{};
        if(readyToken&&job&&job.traceId===traceId){
          const prepared=await prepareReady(tab,traceId,job,{token:readyToken,...safeProgress});
          return {ok:true,progress:{...safeProgress,ready:true},collection:prepared.collection,...(message.readyAcknowledged===true?{}:{preview:prepared.preview})};
        }
        return {ok:true,progress:{...safeProgress,ready:false}};
      }
      if(message.type==='cancel-trace-pages'){
        const job=jobs.get(tab.id);if(job)job.cancelled=true;
        return {ok:true,cancelled:await execute(tab.id,()=>globalThis.GraylogPageCollector?.cancel?.()===true)};
      }
      if(message.type==='open-current-page-trace'){
        if(opening.has(tab.id))throw new Error('Граф уже открывается.');
        if(jobs.has(tab.id))throw new Error('Дождитесь сбора страниц или остановите его.');
        opening.add(tab.id);
        try{
          await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files});
          const diagram=await execute(tab.id,async id=>{
            const url=new URL(location.href);
            const editor=document.querySelector('[data-testid="query-editor"],[data-testid="QueryEditor"],#query,[name="query"],[class*="QueryEditor"],[class*="query-editor"]');
            const query=editor?globalThis.GraylogOverlay.readQueryText(editor):url.searchParams.get('q');
            if(globalThis.GraylogOverlay.exactTraceId(query)!==id)throw new Error('Поиск изменился. Откройте текущий trace заново.');
            const pageInfo=globalThis.GraylogPageCollector?.inspect?.();
            const snapshot=await globalThis.__advancedGraylogRenderedMessages.snapshotTrace(id,{queryExact:true,pageNumber:pageInfo?.currentPage});
            const result=await globalThis.GraylogTraceFetch.processPageTraceInGraylog(`traceId:"${id}"`,snapshot,globalThis.BusinessErrorRules?.list?.()||[]);
            if(globalThis.GraylogOverlay.exactTraceId(editor?globalThis.GraylogOverlay.readQueryText(editor):new URL(location.href).searchParams.get('q'))!==id)throw new Error('Поиск изменился. Откройте текущий trace заново.');
            if(result?.error)throw new Error(result.error);
            const graph=globalThis.TraceAnalysis.buildRequestResponseTrace(result.requestPivot,result.responsePivot,result.openApiPivot,result.openApiResponsePivot,result.gorodClientPivot,result.gorodClientResponsePivot,result.kafkaProducePivot,result.cacheAccessPivot,result.outgoingFailurePivot,result.kafkaConsumePivot,result.kafkaBrokerPivot,result.xmlProcedureRequestPivot,result.xmlProcedureResponsePivot,result.partnerBackendPivot,result.partnerBackendResponsePivot);
            return {...graph,query:`traceId:"${id}" · текущая страница Graylog`,searchMode:'current-page',source:'current-graylog-page',loadedMessages:result.returned,totalMessages:snapshot.nativeTotal??result.total,truncated:snapshot.complete!==true,contentTruncated:result.contentTruncated===true,errorAnalysis:result.errorAnalysis,percentileContext:result.percentileContext,timings:result.timings};
          },[traceId]);
          if(!diagram||!Array.isArray(diagram.nodes)||diagram.nodes.length>200)throw new Error('Не удалось построить граф текущей страницы.');
          diagram.configuredStreamIds=tracePreviewBounds(tab.url).streamIds;
          const current=await chrome.tabs.get(tab.id);if(current.url!==tab.url)throw new Error('Страница изменилась. Откройте граф заново.');
          const token=crypto.randomUUID();transientTraceDiagrams.set(token,{diagram,savedAt:Date.now(),ownerTabId:tab.id});pruneTraceDiagrams();
          await chrome.tabs.create({url:chrome.runtime.getURL(`extension/graylog/trace.html?token=${encodeURIComponent(token)}`),active:true,openerTabId:tab.id});
          return {ok:true,opened:true};
        }finally{opening.delete(tab.id);}
      }
      if(message.type==='open-collected-trace'){
        if(opening.has(tab.id))throw new Error('Граф уже открывается.');
        opening.add(tab.id);
        try {
        const entry=ready.get(tab.id);
        if(!entry||entry.traceId!==traceId||context(entry.url)!==context(tab.url))throw new Error('Собранный граф устарел. Повторите сбор страниц.');
        const diagram=await execute(tab.id,(token,id)=>{
          const current=globalThis.__advancedGraylogCollectedDiagram;
          return globalThis.GraylogPageCollector?.peek(token,id) && current?.token===token&&current.traceId===id?current.diagram:null;
        },[entry.token,traceId]);
        if(!diagram||!Array.isArray(diagram.nodes)||diagram.nodes.length>1000)throw new Error('Собранный граф недоступен. Повторите сбор страниц.');
        const checked=await chrome.tabs.get(tab.id);if(context(checked.url)!==context(entry.url))throw new Error('Поиск изменился. Откройте граф заново.');
        const token=crypto.randomUUID();
        transientTraceDiagrams.set(token,{diagram:{...diagram,query:`traceId:"${traceId}"`,source:'collected-graylog-pages'},savedAt:Date.now(),ownerTabId:tab.id});pruneTraceDiagrams();
        await chrome.tabs.create({url:chrome.runtime.getURL(`extension/graylog/trace.html?token=${encodeURIComponent(token)}`),active:true,openerTabId:tab.id});
        return {ok:true,opened:true};
        } finally {opening.delete(tab.id);}
      }
      if(jobs.has(tab.id))throw new Error('Страницы уже собираются.');
      if(explicitOperationBySourceTab.has(tab.id))throw new Error('Сначала дождитесь полного разбора или остановите его.');
      const job={cancelled:false,traceId,url:tab.url,readyPromise:null};jobs.set(tab.id,job);ready.delete(tab.id);
      const started=Date.now();
      const record={id:++previewOperationSequence,pageCollection:true,area:'Сбор штатных страниц Graylog',status:'pending',startedAt:started,elapsedMs:null,waitMs:0,joined:0};
      previewOperationLog.unshift(record);if(previewOperationLog.length>200)previewOperationLog.length=200;
      try{
        await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files});
        if(job.cancelled)throw new Error('Сбор страниц остановлен.');
        const result=await execute(tab.id,async id=>await globalThis.GraylogPageCollector.collect(id),[traceId]);
        if(result?.error)throw new Error(result.error);
        if(!result?.token)throw new Error('Сбор страниц остановлен.');
        const prepared=await prepareReady(tab,traceId,job,result);
        const current=await chrome.tabs.get(tab.id);
        // Pagination may be encoded in the URL; compare non-page context.
        if(context(current.url)!==context(tab.url))throw new Error('Поиск изменился. Собранные страницы не используются.');
        ready.set(tab.id,{token:result.token,traceId,url:current.url,at:Date.now()});
        record.status='success';record.pagesRead=result.pagesRead;record.messagesRead=result.messagesRead;record.returnStatus=['returned','cancelled','failed'].includes(result.returnStatus)?result.returnStatus:'returned';
        for(const step of (result.steps||[]).slice(0,12)){
          if(!Number.isInteger(step.page)||step.page<1||step.page>5||!Number.isFinite(step.elapsedMs))continue;
          const fromPage=Number.isInteger(step.fromPage)&&step.fromPage>=1&&step.fromPage<=5?step.fromPage:null;
          const action=step.action==='native-click'?'native-click':'snapshot';
          const area=action==='snapshot'?`Чтение страницы ${step.page} · без HTTP`:step.kind==='return'?`Возврат ${fromPage??'?'} → ${step.page} · штатный переход`:`Страницы ${fromPage??'?'} → ${step.page} · штатный переход`;
          previewOperationLog.unshift({id:++previewOperationSequence,pageCollection:true,area,status:'success',startedAt:started,elapsedMs:Math.max(0,step.elapsedMs),page:step.page,fromPage,targetPage:step.page,action});
        }
        if(previewOperationLog.length>200)previewOperationLog.length=200;
        return {ok:true,...prepared,returnStatus:record.returnStatus};
      }catch(error){record.status=job.cancelled?'cancelled':'error';throw error;}
      finally{record.elapsedMs=Date.now()-started;if(jobs.get(tab.id)===job)jobs.delete(tab.id);}
    })().then(respond).catch(error=>respond({ok:false,error:error?.message||'Не удалось собрать страницы.'}));
    return true;
  });
  chrome.tabs.onRemoved.addListener(tabId=>{jobs.delete(tabId);ready.delete(tabId);opening.delete(tabId);});
})();
