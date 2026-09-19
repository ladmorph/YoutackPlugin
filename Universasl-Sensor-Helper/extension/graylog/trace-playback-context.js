(function (root) {
  'use strict';
  const labels = {request:'REQUEST',response:'RESPONSE',cache:'CACHE',kafka:'KAFKA','kafka-broker':'KAFKA','kafka-infra':'KAFKA INFRA','kafka-consume':'CONSUME'};
  const safe = (value, fallback) => typeof value === 'string' && value.trim() ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'').slice(0,120) : fallback;
  const shortSpan = value => typeof value === 'string' && /^[a-f\d]{8,64}$/i.test(value) ? `${value.slice(0,4)}…${value.slice(-4)}` : '';
  function sourceVisible(source, viewport, overlay) {
    if (!source || !viewport || source.width <= 0 || source.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return false;
    const within = source.left >= viewport.left && source.right <= viewport.right && source.top >= viewport.top && source.bottom <= viewport.bottom;
    const covered = overlay && overlay.width > 0 && overlay.height > 0 && source.left < overlay.right && source.right > overlay.left && source.top < overlay.bottom && source.bottom > overlay.top;
    return within && !covered;
  }
  function eventOwner(model,event) {
    const match = /^(edge|subcall|broker|root):(\d+):/.exec(String(event?.pathKey || ''));
    if (!match) return null;
    const index = Number(match[2]);
    if (match[1] === 'root') return {index,http:false};
    if (match[1] === 'edge') {
      const edge = model.edges?.[index];
      if (!edge || edge.spanAssociation) return null;
      return {index:edge.from,http:!edge.kafkaObserved && edge[`${event.kind}Observed`] !== false};
    }
    if (match[1] === 'subcall') {
      const call = model.subcalls?.[index]; if (!call || call.diagnostic) return null;
      return {index:call.parentIndex,http:!call.cacheChain && !call.kafkaProduce && !call.oneWay && call[`${event.kind}Observed`] !== false};
    }
    const broker = model.kafkaEndpoints?.[index];
    if (!broker) return null;
    return {index:broker.ownerType === 'node' ? broker.ownerIndex : model.subcalls?.[broker.ownerIndex]?.parentIndex,http:false};
  }
  function countOwner(model,owner,index,events) {
    if (!owner || !model.nodes?.[owner.index] || !Array.isArray(events) || !Number.isInteger(index)) return null;
    let requests = 0, responses = 0;
    for (let i=0;i<=index && i<events.length;i++) {
      const step = events[i];
      if (step?.kind !== 'request' && step?.kind !== 'response') continue;
      const candidate = eventOwner(model,step);
      if (!candidate?.http || candidate.index !== owner.index) continue;
      if (step.kind === 'request') requests++; else responses++;
    }
    return {ownerIndex:owner.index,service:safe(model.nodes[owner.index].service,'Сервис'),requests,responses};
  }
  function counters(model,event,index,events) {
    return countOwner(model,eventOwner(model,event),index,events);
  }
  function counterRows(model,event,index,events) {
    const owner = counters(model,event,index,events);
    if (!owner) return [];
    const match = event?.kind === 'response' && /^edge:(\d+):/.exec(String(event.pathKey || ''));
    const senderIndex = match ? model.edges?.[Number(match[1])]?.to : null;
    const sender = Number.isInteger(senderIndex) && senderIndex !== owner.ownerIndex ? countOwner(model,{index:senderIndex},index,events) : null;
    return sender && (sender.requests > 0 || sender.responses > 0) ? [sender,owner] : [owner];
  }
  function describe(model, event) {
    if (!model || !event || !labels[event.kind]) return null;
    const match = /^(edge|subcall|broker|root):(\d+):/.exec(String(event.pathKey || ''));
    if (!match) return null;
    const index = Number(match[2]);
    const node = i => model.nodes?.[i] ? {text:`${safe(model.nodes[i].service,'Сервис')}${model.nodes[i].stepNumber != null ? ` · ${model.nodes[i].stepNumber}` : ''}`,name:safe(model.nodes[i].service,'Сервис'),number:model.nodes[i].stepNumber == null ? '' : String(model.nodes[i].stepNumber),span:shortSpan(model.nodes[i].spanId),element:model.cardElements?.[i]} : null;
    const subcall = i => {
      const call = model.subcalls?.[i];
      if (!call || call.diagnostic) return null;
      const ref = call.stepNumber == null ? '' : String(call.stepNumber);
      const name = call.cacheChain ? `Local Cache → Redis · ${call.cacheWrite?'PUT':'GET'}` : call.kafkaProduce ? 'Kafka' : call.xmlProcedure ? `Процедура: ${safe(call.detail?.procedure,'не определена')}` : safe(call.label,'Внешний вызов');
      return {text:`${name}${ref?` · ${ref}`:''}`,name,number:ref,span:'',element:model.subcallElements?.[i]};
    };
    let from, to;
    if (match[1] === 'root') {
      if (!['request','response'].includes(event.kind) || event.boundary !== true) return null;
      from = event.kind === 'request' ? {text:'Входящий REQUEST',element:null} : node(index);
      to = event.kind === 'request' ? node(index) : {text:'Ответ сформирован',element:null};
    } else if (match[1] === 'edge') {
      const edge = model.edges?.[index]; if (!edge || edge.spanAssociation) return null;
      const parentCallIndex=model.positions?.[edge.to]?.parentSubcallIndex;
      from = Number.isInteger(parentCallIndex) ? subcall(parentCallIndex) : node(edge.from); to = node(edge.to);
    } else if (match[1] === 'subcall') {
      const call = model.subcalls?.[index]; if (!call || call.diagnostic) return null;
      from = node(call.parentIndex); to = subcall(index);
    } else {
      const broker = model.kafkaEndpoints?.[index]; if (!broker) return null;
      if (event.kind === 'kafka-consume') {
        const consumeIndex = Number(String(event.pathKey || '').split(':')[3]);
        const link = broker.consumerLinks?.[consumeIndex];
        from = link ? {text:'Kafka broker',name:'Kafka broker',number:'',span:'',element:model.kafkaEndpointElements?.[index]} : null;
        to = link ? node(link.consumerNodeIndex) : null;
      } else {
        from = broker.ownerType === 'node' ? node(broker.ownerIndex) : broker.ownerType === 'subcall' ? subcall(broker.ownerIndex) : null;
        const target=broker.brokerObservation?'Kafka infra':'Kafka broker';
        to = {text:target,name:target,number:'',span:'',element:model.kafkaEndpointElements?.[index]};
      }
    }
    if (!from || !to) return null;
    if (event.kind === 'response' && match[1] !== 'root') [from,to] = [to,from];
    return {label:labels[event.kind],from:from.text,to:to.text,sourceElement:from.element,sourceName:from.name,sourceNumber:from.number,sourceSpan:from.span,
      latencyMs:typeof event.latencyMs === 'number' && Number.isFinite(event.latencyMs) && event.latencyMs >= 0 ? event.latencyMs : null};
  }
  function create({container,canvas,onSource} = {}) {
    const doc = container?.ownerDocument || root.document;
    const node = doc.createElement('aside'); node.className = 'trace-playback-context'; node.hidden = true;
    node.setAttribute('role','status'); node.setAttribute('aria-live','polite'); node.setAttribute('aria-atomic','true');
    const heading = doc.createElement('div'); heading.className = 'trace-playback-context-heading';
    const route = doc.createElement('div'); route.className = 'trace-playback-context-route';
    const status = doc.createElement('div'); status.className = 'trace-playback-context-status';
    const counts = doc.createElement('div'); counts.className = 'trace-playback-context-counts'; counts.hidden = true;
    const sourceCard = doc.createElement('div'); sourceCard.className = 'trace-playback-source-card'; sourceCard.hidden = true;
    const sourceRole = doc.createElement('div'); sourceRole.className = 'trace-playback-source-role';
    const sourceIdentity = doc.createElement('div'); sourceIdentity.className = 'trace-playback-source-identity';
    const sourceNumber = doc.createElement('span'); sourceNumber.className = 'trace-playback-source-number';
    const sourceName = doc.createElement('strong'); sourceName.className = 'trace-playback-source-name';
    const sourceSpan = doc.createElement('code'); sourceSpan.className = 'trace-playback-source-span';
    const sourceButton = doc.createElement('button'); sourceButton.type = 'button'; sourceButton.className = 'trace-playback-source-button'; sourceButton.textContent = 'Показать источник'; sourceButton.hidden = typeof onSource !== 'function';
    sourceIdentity.append(sourceNumber,sourceName); sourceCard.append(sourceRole,sourceIdentity,sourceSpan,sourceButton);
    node.append(heading,route,status,counts,sourceCard); (container || doc.querySelector('.trace-workspace') || doc.body).append(node);
    let source = null;
    sourceButton.addEventListener?.('click',()=>{if(source)onSource?.(source);});
    function clearSource() {source?.classList.remove('trace-step-source');source = null;}
    function hide() {clearSource();node.hidden = true;sourceCard.hidden = true;}
    function updateSourceVisibility() {
      const viewport = canvas || container?.querySelector?.('#trace-canvas') || doc.querySelector?.('#trace-canvas');
      const sourceRect = source?.getBoundingClientRect?.(), viewportRect = viewport?.getBoundingClientRect?.();
      // Measure only the fixed banner: the miniature must not keep itself visible by covering its source.
      sourceCard.hidden = true;
      const bannerRect = node.getBoundingClientRect?.();
      sourceCard.hidden = node.hidden || !sourceRect || !viewportRect || sourceVisible(sourceRect,viewportRect,bannerRect);
      return !sourceCard.hidden;
    }
    function inspectEvidence(model,subcallIndex) {
      clearSource();
      const call = model?.subcalls?.[subcallIndex];
      if (!call?.diagnostic) {hide();return false;}
      const owner = Number.isInteger(call.parentIndex) ? model.nodes?.[call.parentIndex] : null;
      const dependency = safe(call.label,call.detail?.dependency === 'redis' ? 'Redis' : 'База данных');
      node.dataset.kind = 'evidence';
      heading.textContent = 'Диагностическая связь';
      counts.hidden = true; counts.textContent = '';
      sourceRole.textContent = 'Сервис источника · вне кадра';
      sourceNumber.textContent = owner?.stepNumber == null ? '' : String(owner.stepNumber); sourceNumber.hidden = !sourceNumber.textContent;
      sourceName.textContent = owner ? safe(owner.service,'Сервис') : '';
      const span = owner ? shortSpan(owner.spanId) : '';
      sourceSpan.textContent = span ? `span ${span}` : ''; sourceSpan.hidden = !span;
      if (owner) {
        source = model.cardElements?.[call.parentIndex]; source?.classList.add('trace-step-source');
        route.textContent = `${sourceName.textContent}${owner?.stepNumber == null ? '' : ` · ${owner.stepNumber}`} → ${dependency}`;
        status.textContent = 'Связь по диагностике service + span';
      } else {
        route.textContent = dependency;
        status.textContent = 'Связь с сервисом не определена';
      }
      route.title = route.textContent;
      node.hidden = false; updateSourceVisibility();
      return true;
    }
    function render(model,event,index,total,state = 'playing') {
      clearSource();
      const info = describe(model,event);
      if (!info) {hide();return;}
      source = info.sourceElement; source?.classList.add('trace-step-source');
      sourceRole.textContent = event.kind === 'response' ? 'Источник ответа · вне кадра' : event.kind === 'kafka-consume' ? 'Kafka broker · вне кадра' : 'Вызывающая сторона · вне кадра';
      sourceNumber.textContent = info.sourceNumber || ''; sourceNumber.hidden = !info.sourceNumber;
      sourceName.textContent = info.sourceName || info.from;
      sourceSpan.textContent = info.sourceSpan ? `span ${info.sourceSpan}` : ''; sourceSpan.hidden = !info.sourceSpan;
      node.dataset.kind = event.kind;
      heading.textContent = `Шаг ${index+1} из ${total} · ${info.label}`;
      route.textContent = `${info.from} → ${info.to}`;
      route.title = route.textContent;
      const phase = typeof state === 'object' ? state?.phase : state;
      const playbackState = typeof state === 'object' ? state?.state : state;
      let message = playbackState === 'paused' ? 'Пауза' : ['done','complete'].includes(playbackState) || phase === 'done' ? 'Проигрывание завершено'
        : ['transition','settling','preparing','framing'].includes(phase) ? 'Переход к шагу'
        : event.kind === 'response' ? 'Возврат ответа' : event.kind === 'cache' ? 'Взаимодействие с кешем'
        : event.kind === 'kafka-consume' ? 'Получение из Kafka' : event.kind.startsWith('kafka') ? 'Передача в Kafka' : 'Запрос выполняется';
      if (info.latencyMs !== null) message += ` · REQUEST → RESPONSE: ${info.latencyMs} мс`;
      const progress = counterRows(model,event,index,typeof state === 'object' ? state?.events : null);
      counts.hidden = !progress.length;
      counts.textContent = progress.map(row => `${row.service}: отправлено ${row.requests} · ответов ${row.responses} · по шагам лога`).join('\n');
      status.textContent = message; node.hidden = false; updateSourceVisibility();
    }
    function reservedHeight() {
      if(node.hidden)return 0;
      const hidden=sourceCard.hidden;sourceCard.hidden=!source;
      const height=node.getBoundingClientRect?.().height || 0;
      sourceCard.hidden=hidden;return height;
    }
    return {node,sourceCard,render,hide,inspectEvidence,updateSourceVisibility,reservedHeight};
  }
  const api = {create,describe,counters,counterRows,sourceVisible}; root.TracePlaybackContext = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
