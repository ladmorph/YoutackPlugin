(function (root) {
  'use strict';
  const kindLabels = {request:'REQUEST', response:'RESPONSE', cache:'CACHE', kafka:'KAFKA', 'kafka-broker':'KAFKA', 'kafka-infra':'KAFKA INFRA', 'kafka-consume':'CONSUME'};
  const text = (value, fallback = '') => typeof value === 'string' ? value.slice(0, 180) : fallback;
  function describe(model, event) {
    if (!event || !kindLabels[event.kind]) return null;
    const [family, indexText] = String(event.pathKey || '').split(':');
    const index = Number(indexText), nodes = model.nodes || [];
    let from = '', to = '', detail = '', reference = '';
    if(family === 'root') {
      const node=nodes[index];if(!node)return null;
      from=event.reconstructed ? 'Внешний вход · запись потеряна' : event.kind === 'request' ? 'Входящий REQUEST' : 'Ответ сформирован';to=text(node.service,'Сервис');
      detail=event.reconstructed ? 'Реконструкция по финальному RESPONSE gateway и единственной ветке той же семьи сервисов' : event.kind === 'request' ? 'Начало обработки' : 'Итоговый RESPONSE';
    } else if (family === 'edge') {
      const edge = model.edges?.[index];
      if (!edge || edge.spanAssociation || edge.assumption) return null;
      from = text(nodes[edge.from]?.service, 'Сервис'); to = text(nodes[edge.to]?.service, 'Сервис');
      const parentCall = model.subcalls?.[model.positions?.[edge.to]?.parentSubcallIndex];
      if (parentCall) from = `${from} · ${text(parentCall.label, 'Внешний вызов')}`;
    } else if (family === 'subcall') {
      const call = model.subcalls?.[index];
      if (!call || call.diagnostic) return null;
      from = text(nodes[call.parentIndex]?.service, 'Сервис');
      if (call.cacheChain) {
        to = 'Local Cache → Redis';
        detail = `${call.cacheWrite ? 'PUT · запись' : 'GET · чтение'}${call.detail?.safeKey ? ` · ${text(call.detail.safeKey)}` : ''}`;
      } else {
        to = call.kafkaProduce ? 'Kafka' : text(call.label, 'Внешний вызов');
        detail = call.kafkaProduce ? text(call.detail?.topic) : call.xmlProcedure ? `Процедура: ${text(call.detail?.procedure,'не определена')}` : [text(call.detail?.method), text(call.detail?.url)].filter(Boolean).join(' ');
      }
    } else if (family === 'broker') {
      const broker = model.kafkaEndpoints?.[index];
      if (!broker) return null;
      if (event.kind === 'kafka-consume') {
        const consumeIndex = Number(String(event.pathKey || '').split(':')[3]);
        const link = broker.consumerLinks?.[consumeIndex];
        const consumer = nodes[link?.consumerNodeIndex];
        if (!link || !consumer) return null;
        from = 'Kafka broker'; to = text(consumer.service, 'Сервис'); detail = text(broker.topic);
      } else {
      const owner = broker.ownerType === 'node' ? nodes[broker.ownerIndex] : model.subcalls?.[broker.ownerIndex];
      from = text(owner?.service || nodes[owner?.parentIndex]?.service, 'Сервис');
      to = broker.brokerObservation ? 'Kafka infra' : 'Kafka broker'; detail = text(broker.topic);
      }
    } else return null;
    if (event.kind === 'response') [from, to] = [to, from];
    if (Number.isFinite(event.latencyMs)) detail = [detail, `${event.latencyMs} мс`].filter(Boolean).join(' · ');
    return {kind:event.kind, label:event.reconstructed?'ВОССТАНОВЛЕНО':kindLabels[event.kind], route:`${from} → ${to}`, detail, reference};
  }
  // Cards identify their first observed step; request and response remain
  // separate chronological events in the list and playback.
  function numbering(model = {}, events = []) {
    const result = {eventNumbers:[],nodeNumbers:[],subcallNumbers:[],brokerNumbers:[]};
    let number = 0;
    events.forEach((event,index) => {
      if (!describe(model,event)) return;
      result.eventNumbers[index] = ++number;
      const [family,key] = String(event.pathKey || '').split(':'), at = Number(key);
      const type = event.targetType || ({edge:'node',root:'node',subcall:'subcall',broker:'broker'})[family];
      const target = Number.isInteger(event.targetIndex) ? event.targetIndex : family === 'edge' ? model.edges?.[at]?.to : at;
      const values = result[`${type}Numbers`];
      if (values && Number.isInteger(target) && target >= 0 && values[target] === undefined) values[target] = number;
    });
    return result;
  }
  function create({container, onSelect, onToggle} = {}) {
    const doc = container?.ownerDocument || root.document;
    const element = (tag, className, value) => {
      const node = doc.createElement(tag); if (className) node.className = className;
      if (value !== undefined) node.textContent = value; return node;
    };
    const panel = element('aside', 'trace-steps'); panel.id = 'trace-steps'; panel.hidden = true;
    panel.setAttribute('aria-label', 'Шаги взаимодействий');
    const header = element('div', 'trace-steps-header');
    const heading = element('div'); heading.append(element('strong', '', 'Шаги'));
    const status = element('small', 'trace-steps-status', 'Нет шагов'); heading.append(status);
    const closeButton = element('button', 'trace-steps-close', '←'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Свернуть шаги');
    header.append(heading, closeButton);
    const list = element('ol', 'trace-steps-list'); list.setAttribute('aria-label', 'Порядок взаимодействий');
    const empty = element('p', 'trace-steps-empty', 'Наблюдаемых взаимодействий пока нет.');
    panel.append(header, list, empty);
    const toggleButton = element('button', 'trace-steps-toggle', 'Шаги'); toggleButton.type = 'button';
    toggleButton.setAttribute('aria-controls', panel.id); toggleButton.setAttribute('aria-expanded', 'false');
    toggleButton.title = 'Показать список шагов и перейти к взаимодействию';
    const workspace = container || doc.querySelector('.trace-workspace') || doc.body;
    workspace.append(panel);
    let rows = [], current = -1, state = 'idle', open = false, disposed = false;
    function reveal(row) {
      if (!open || !row) return;
      const top = row.item.offsetTop - list.offsetTop, bottom = top + row.item.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, bottom - list.clientHeight);
    }
    function updateStatus() {
      const row = rows.find(item => item.index === current);
      status.textContent = row ? `Шаг ${row.number} из ${rows.length}${state === 'paused' ? ' · пауза' : ''}` : rows.length ? `Всего шагов: ${rows.length}` : 'Нет шагов';
    }
    function setOpen(value) {
      if (disposed || open === Boolean(value)) return;
      open = Boolean(value); panel.hidden = !open; toggleButton.setAttribute('aria-expanded', String(open));
      workspace.classList.toggle('trace-steps-open', open);
      if (open) reveal(rows.find(row => row.index === current));
      onToggle?.(open);
    }
    function sync(index, nextState = 'idle') {
      if (disposed) return;
      current = Number.isInteger(index) && rows.some(row => row.index === index) ? index : -1;
      state = ['idle','playing','paused','complete'].includes(nextState) ? nextState : 'idle';
      panel.dataset.playbackState = state;
      for (const row of rows) {
        if (row.index === current) row.button.setAttribute('aria-current', 'step');
        else row.button.removeAttribute('aria-current');
      }
      updateStatus(); reveal(rows.find(row => row.index === current));
    }
    function render(model = {}, events = []) {
      if (disposed) return;
      rows = []; list.replaceChildren(); current = -1; state = 'idle'; panel.dataset.playbackState = state;
      const numbers = numbering(model,events);
      for (const [index, event] of events.entries()) {
        const info = describe(model, event); if (!info) continue;
        const number = numbers.eventNumbers[index], item = element('li', 'trace-steps-item');
        const button = element('button', 'trace-step'); button.type = 'button'; button.dataset.kind = info.kind;
        const numberNode = element('span', 'trace-step-number', String(number)); numberNode.setAttribute('aria-hidden', 'true');
        const body = element('span', 'trace-step-body');
        const kind = `${info.label}${info.reference ? ` · ${info.reference}` : ''}`;
        const coordinates=element('span','trace-step-coordinates',event.reconstructed
          ? `Граф: шаг ${number} · Лог: записи нет`
          : `Граф: шаг ${number} · Лог: ${Number.isInteger(event.logStep)?`шаг ${event.logStep}`:'номер недоступен'}`);
        body.append(element('span', 'trace-step-kind', kind),coordinates, element('span', 'trace-step-route', info.route));
        if (info.detail) body.append(element('span', 'trace-step-detail', info.detail));
        button.setAttribute('aria-label', `Шаг графа ${number}. ${event.reconstructed?'Записи в логе нет':Number.isInteger(event.logStep)?`Шаг лога ${event.logStep}`:'Номер в логе недоступен'}. ${kind}. ${info.route}${info.detail ? `. ${info.detail}` : ''}`);
        button.title = `${kind}\n${coordinates.textContent}\n${info.route}${info.detail ? `\n${info.detail}` : ''}`;
        button.append(numberNode, body); item.append(button); list.append(item);
        button.addEventListener('click', () => { if (!disposed) onSelect?.(index); });
        rows.push({index, number, item, button});
      }
      empty.hidden = rows.length > 0; list.hidden = !rows.length; list.scrollTop = 0; updateStatus();
    }
    const toggle = () => setOpen(!open);
    const close = () => { setOpen(false); toggleButton.focus(); };
    const keydown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    toggleButton.addEventListener('click', toggle); closeButton.addEventListener('click', close); panel.addEventListener('keydown', keydown);
    return {panel, toggleButton, render, sync, setOpen,
      getState:() => ({open, index:current, state, total:rows.length}),
      destroy:() => { disposed = true; rows = []; workspace.classList.remove('trace-steps-open'); toggleButton.removeEventListener('click', toggle); closeButton.removeEventListener('click', close); panel.removeEventListener('keydown', keydown); panel.remove(); toggleButton.remove(); }
    };
  }
  const api = {create, describe, numbering}; root.TraceSteps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
