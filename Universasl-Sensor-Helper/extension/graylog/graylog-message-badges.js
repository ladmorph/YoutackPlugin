(function initGraylogMessageBadges(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GraylogMessageBadges = api;

  if (typeof document === "undefined" || !document.documentElement || !root.MutationObserver) return;
  if (root.GraylogPage && !root.GraylogPage.isSupported(document, root.location)) return;
  root.__advancedGraylogMessageBadges?.dispose?.();
  root.__advancedGraylogMessageBadges = api.createController(document, {
    MutationObserver: root.MutationObserver,
    getLocation: () => root.location,
    errorReference: root.ErrorReference,
    exceptionHighlights: root.GraylogExceptionHighlights?.createController(document),
    repairIndex: () => root.GraylogRuntime ? root.GraylogRuntime.sendMessage({type:"repair-graylog-message-index"}) : root.chrome?.runtime?.sendMessage?.({type:"repair-graylog-message-index"}),
    onFinding(finding) {
      const assistant = root.__advancedGraylogClippy;
      if (assistant?.reportFinding) assistant.reportFinding(finding);
      else root.__advancedGraylogPendingFinding = finding;
    }
  });
  const controller = root.__advancedGraylogMessageBadges;
  root.GraylogRuntime?.onInvalidated(()=>{
    controller.dispose();
    if(root.__advancedGraylogMessageBadges===controller)delete root.__advancedGraylogMessageBadges;
    delete root.__advancedGraylogPendingFinding;
  });
})(globalThis, function createGraylogMessageBadgesModule() {
  "use strict";

  const HOST_ATTRIBUTE = "data-advanced-graylog-message-badges";
  const RENDERED_ROW_ATTRIBUTE = "data-advanced-graylog-rendered-message";
  const RENDERED_UPDATE_EVENT = "advanced-graylog-rendered-message-update";
  const RENDERED_REQUEST_EVENT = "advanced-graylog-rendered-message-request";
  const RENDERED_COMPLETE_EVENT = "advanced-graylog-rendered-message-complete";
  const renderedMetadata = new WeakMap();
  const exceptionChain = typeof module !== "undefined" && module.exports ? require("../../lib/graylog/exception-chain") : globalThis.GraylogExceptionChain;
  const ROW_SELECTOR = [
    "table > tbody",
    "table tbody tr",
    "[role='row']",
    "[data-testid*='message'][data-testid*='row']",
    "[data-testid*='result'][data-testid*='row']",
    "[data-message-id]",
    ".message-row",
    ".search-result",
    ".result-message"
  ].join(",");
  const FIELD_ATTRIBUTES = ["data-field", "data-field-name", "data-column", "data-testid", "aria-label", "title"];
  const MAX_FIELD_NODES = 240;
  const ERROR_TARGET_ATTRIBUTE = "data-advanced-graylog-error-target";

  function cleanText(value) {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizedFieldName(value) {
    return cleanText(value).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[\s-]+/g, "_").replace(/^field_/, "");
  }

  function fieldKind(value) {
    const name = normalizedFieldName(value);
    if (/^(?:message_)?level$/.test(name)) return "level";
    if (/^(?:message_)?duration(?:_(?:ns|us|ms|s|sec|seconds))?$/.test(name)) return "duration";
    return "";
  }

  function parseLevelValue(value) {
    const text = cleanText(value);
    if (/^["']?3["']?$/.test(text)) return true;
    return /(?:^|[\s,{[(;|])(?:["']?level["']?)\s*[:=]\s*["']?3["']?(?=$|[\s,}\]);|])/i.test(text);
  }

  function normalizeDuration(numberText, unitText, fallbackUnit) {
    const normalized = String(numberText || "").replace(",", ".");
    if (!/^\d{1,10}(?:\.\d{1,6})?$/.test(normalized)) return "";
    const value = Number(normalized);
    if (!Number.isFinite(value) || value < 0) return "";
    const unit = String(unitText || fallbackUnit || "ms").toLowerCase()
      .replace("µ", "u")
      .replace(/^мс$/, "ms").replace(/^мкс$/, "us").replace(/^нс$/, "ns")
      .replace(/^(?:с|сек|секунда|секунды|секунд|seconds?|sec)$/, "s");
    if (!/^(?:ns|us|ms|s)$/.test(unit)) return "";
    return `${normalized} ${unit}`;
  }

  function parseDurationValue(value, fallbackUnit = "ms", allowBare = false) {
    const text = cleanText(value);
    const explicit = /(?:^|[\s,{[(;|])(?:["']?duration(?:_(ns|us|ms|s|sec|seconds))?["']?)\s*[:=]\s*["']?(\d{1,10}(?:[.,]\d{1,6})?)\s*(ns|µs|us|ms|s|sec|seconds?|нс|мкс|мс|с|сек|секунда|секунды|секунд)?["']?(?=$|[\s,}\]);|])/i.exec(text);
    if (explicit) return normalizeDuration(explicit[2], explicit[3], explicit[1] || fallbackUnit);
    if (!allowBare) return "";
    const bare = /^["']?(\d{1,10}(?:[.,]\d{1,6})?)\s*(ns|µs|us|ms|s|sec|seconds?|нс|мкс|мс|с|сек|секунда|секунды|секунд)?["']?$/i.exec(text);
    return bare ? normalizeDuration(bare[1], bare[2], fallbackUnit) : "";
  }

  function durationToMilliseconds(value) {
    const match = /^(\d{1,10}(?:\.\d{1,6})?)\s+(ns|us|ms|s)$/.exec(cleanText(value));
    if (!match) return null;
    const number = Number(match[1]);
    const multiplier = match[2] === "s" ? 1000 : match[2] === "ms" ? 1 : match[2] === "us" ? 0.001 : 0.000001;
    const milliseconds = number * multiplier;
    return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : null;
  }

  function durationBand(milliseconds) {
    const value = Number(milliseconds);
    if (!Number.isFinite(value) || value < 0) return "";
    if (value < 100) return "fast";
    if (value < 500) return "normal";
    if (value < 1000) return "warning";
    if (value < 2000) return "slow";
    return "critical";
  }

  function explicitFields(row) {
    const result = [];
    if (!row?.querySelectorAll) return result;
    const selector = FIELD_ATTRIBUTES.map((name) => `[${name}]`).join(",");
    const nodes = Array.from(row.querySelectorAll(selector)).slice(0, MAX_FIELD_NODES);
    for (const node of nodes) {
      for (const attribute of FIELD_ATTRIBUTES) {
        const marker = node.getAttribute?.(attribute);
        const kind = fieldKind(marker);
        if (!kind) continue;
        result.push({ kind, marker: normalizedFieldName(marker), text: node.textContent });
        break;
      }
    }
    return result;
  }

  function tableFields(row) {
    const result = [];
    if (String(row?.tagName || "").toUpperCase() !== "TR" || !row.closest) return result;
    const table = row.closest("table");
    if (!table?.querySelectorAll) return result;
    const headers = Array.from(table.querySelectorAll("thead tr:last-child th, thead tr:last-child [role='columnheader']"));
    const cells = Array.from(row.cells || row.querySelectorAll?.("td,[role='cell']") || []);
    headers.slice(0, cells.length).forEach((header, index) => {
      const kind = fieldKind(header.textContent);
      if (kind) result.push({ kind, marker: normalizedFieldName(header.textContent), text: cells[index]?.textContent });
    });
    return result;
  }

  function pairedFields(row) {
    const result = [];
    if (!row?.querySelectorAll) return result;
    const labels = Array.from(row.querySelectorAll("dt,th,[role='rowheader'],[data-testid*='field-name'],.field-name,.field-name-cell")).slice(0, MAX_FIELD_NODES);
    for (const label of labels) {
      const kind = fieldKind(label.textContent);
      if (!kind) continue;
      const sibling = label.nextElementSibling;
      const value = sibling || label.parentElement?.querySelector?.("[role='cell'],dd,[data-testid*='field-value'],.field-value,.field-value-cell");
      if (value && value !== label) result.push({ kind, marker: normalizedFieldName(label.textContent), text: value.textContent });
    }
    return result;
  }

  function rowDataFields(row) {
    const result = [];
    const rendered = renderedMetadata.get(row);
    if (rendered?.level) result.push({ kind: "level", marker: "level", text: rendered.level });
    if (rendered?.duration) result.push({ kind: "duration", marker: "duration", text: rendered.duration });
    const level = row?.getAttribute?.("data-level");
    const duration = row?.getAttribute?.("data-duration");
    const durationMs = row?.getAttribute?.("data-duration-ms");
    if (level !== null && level !== undefined) result.push({ kind: "level", marker: "level", text: level });
    if (duration !== null && duration !== undefined) result.push({ kind: "duration", marker: "duration", text: duration });
    if (durationMs !== null && durationMs !== undefined) result.push({ kind: "duration", marker: "duration_ms", text: durationMs });
    return result;
  }

  function extractMessageIndicators(row) {
    if (!row) return { level3: false, durationText: "" };
    // Evidence is intentionally limited to a field/value DOM contract. A word
    // such as "level=3" inside the free-form message is not metadata.
    const fields = [...rowDataFields(row), ...tableFields(row), ...explicitFields(row), ...pairedFields(row)];
    let level3 = fields.some((field) => field.kind === "level" && parseLevelValue(field.text));
    let durationText = "";
    for (const field of fields) {
      if (field.kind !== "duration") continue;
      const unit = /duration_(ns|us|ms|s|sec|seconds)$/.exec(field.marker)?.[1] || "ms";
      durationText = parseDurationValue(field.text, unit, true);
      if (durationText) break;
    }
    const durationMs = durationToMilliseconds(durationText);
    return { level3, durationText, durationMs, durationBand: durationBand(durationMs) };
  }

  function isServiceField(value) {
    return /^(?:service|service_name|instance_name)$/.test(normalizedFieldName(value));
  }

  function extractServiceName(row) {
    if (renderedMetadata.get(row)?.service) return renderedMetadata.get(row).service;
    const direct = row?.getAttribute?.("data-service-name") ?? row?.getAttribute?.("data-service") ?? row?.getAttribute?.("data-instance-name");
    if (cleanText(direct)) return cleanText(direct).slice(0, 128);
    if (!row?.querySelectorAll) return "";
    const explicitSelector = FIELD_ATTRIBUTES.map((name) => `[${name}]`).join(",");
    for (const node of Array.from(row.querySelectorAll(explicitSelector)).slice(0, MAX_FIELD_NODES)) {
      if (FIELD_ATTRIBUTES.some((attribute) => isServiceField(node.getAttribute?.(attribute)))) {
        return cleanText(node.textContent).slice(0, 128);
      }
    }
    for (const label of Array.from(row.querySelectorAll("dt,th,[role='rowheader'],[data-testid*='field-name'],.field-name,.field-name-cell")).slice(0, MAX_FIELD_NODES)) {
      if (!isServiceField(label.textContent)) continue;
      const value = label.nextElementSibling || label.parentElement?.querySelector?.("[role='cell'],dd,[data-testid*='field-value'],.field-value,.field-value-cell");
      if (value && value !== label) return cleanText(value.textContent).slice(0, 128);
    }
    if (String(row.tagName || "").toUpperCase() === "TR" && row.closest) {
      const table = row.closest("table");
      const headers = Array.from(table?.querySelectorAll?.("thead tr:last-child th, thead tr:last-child [role='columnheader']") || []);
      const index = headers.findIndex((header) => isServiceField(header.textContent));
      const cells = Array.from(row.cells || row.querySelectorAll("td,[role='cell']"));
      if (index >= 0 && cells[index]) return cleanText(cells[index].textContent).slice(0, 128);
    }
    return "";
  }

  function isMessageField(value) {
    return /^(?:(?:full_)?message|stack_?trace|exception_?stack_?trace)$/.test(normalizedFieldName(value));
  }

  function extractMessageElements(row) {
    const elements=[];
    if (!row?.querySelectorAll) return [];
    const explicitSelector = FIELD_ATTRIBUTES.map((name) => `[${name}]`).join(",");
    for (const node of Array.from(row.querySelectorAll(explicitSelector)).slice(0, MAX_FIELD_NODES)) {
      if (FIELD_ATTRIBUTES.some((attribute) => isMessageField(node.getAttribute?.(attribute)))) elements.push(node);
    }
    for (const label of Array.from(row.querySelectorAll("dt,th,[role='rowheader'],[data-testid*='field-name'],.field-name,.field-name-cell")).slice(0, MAX_FIELD_NODES)) {
      if (!isMessageField(label.textContent)) continue;
      const value = label.nextElementSibling || label.parentElement?.querySelector?.("[role='cell'],dd,[data-testid*='field-value'],.field-value,.field-value-cell");
      if (value && value !== label) elements.push(value);
    }
    if (String(row.tagName || "").toUpperCase() === "TR" && row.closest) {
      const table = row.closest("table");
      const headers = Array.from(table?.querySelectorAll?.("thead tr:last-child th, thead tr:last-child [role='columnheader']") || []);
      const index = headers.findIndex((header) => isMessageField(header.textContent));
      const cells = Array.from(row.cells || row.querySelectorAll("td,[role='cell']"));
      if (index >= 0 && cells[index]) elements.push(cells[index]);
    }
    for(const marked of row.querySelectorAll("[data-message-text],.message-text,.message-value,[data-testid='message-value']"))elements.push(marked);
    return [...new Set(elements)].filter(element=>!elements.some(other=>other!==element&&other.contains?.(element))).slice(0,4);
  }

  function extractMessageText(row) {
    // Preserve causal order, but only class names cross the MAIN boundary.
    const rendered=renderedMetadata.get(row);
    let bestCount=rendered?.exceptionChain?.length || (rendered?.exception?1:0);
    let best=exceptionChain?.evidence(rendered?.exceptionChain) || rendered?.exception || "";
    const elements=extractMessageElements(row);
    // Keep newlines: collapsing whitespace destroys `Caused by` evidence.
    for(const element of elements){
      const text=exceptionChain?.readDomText(element).text || String(element.textContent||"").slice(0,4096);
      const count=exceptionChain?.parse(text).length || 0;
      if(count && count>=bestCount){best=exceptionChain.compact(text);bestCount=count;}
    }
    return best || String(elements[0]?.textContent||"").slice(0,4096);
  }

  function extractKnownSystemFinding(row, indicators, errorReference) {
    if (!indicators?.level3 || typeof errorReference?.classify !== "function" || !Array.isArray(errorReference.entries)) return null;
    const message = extractMessageText(row);
    if (!message) return null;
    let result;
    try { result = errorReference.classify({ level: 3, message }); } catch { return null; }
    if (!result?.referenceId) return null;
    const reference = errorReference.entries.find((entry) => entry?.id === result.referenceId);
    if (!reference) return null;
    const labels = (reference.exceptions || []).map((value) => cleanText(value).split(".").at(-1)).filter(Boolean);
    const label = labels.includes(result.exceptionType) ? result.exceptionType : labels[0]
      || (reference.sqlStates || [])[0] || (reference.oracleCodes || [])[0] || cleanText(reference.title);
    if (!label) return null;
    return Object.freeze({ referenceId: reference.id, label, priority: reference.priority || "unknown" });
  }

  function isMessageRow(row) {
    if (!row || row.nodeType !== 1 || row.hasAttribute?.(HOST_ATTRIBUTE)) return false;
    const tag = String(row.tagName || "").toUpperCase();
    if (row.hasAttribute?.(RENDERED_ROW_ATTRIBUTE)) return true;
    if (tag === "TBODY") {
      if (row.closest?.("td table,td tbody")) return false;
      return Boolean(row.querySelector?.(":scope > tr > [data-testid^='message-summary-field-']"))
        || /MessageTableEntry.*TableBody/.test(row.getAttribute?.("class") || "");
    }
    if (tag === "DETAILS") return Boolean(row.querySelector?.("summary"));
    if (tag === "TR") {
      if (row.closest?.("td table,td tbody") || isMessageRow(row.parentElement)) return false;
      return String(row.parentElement?.tagName || "").toUpperCase() === "TBODY";
    }
    const role = row.getAttribute?.("role");
    if (role === "row") return !row.querySelector?.("[role='columnheader']");
    const marker = [row.getAttribute?.("data-testid"), row.getAttribute?.("class"), row.getAttribute?.("data-message-id")]
      .filter(Boolean).join(" ");
    return /(?:^|[\s_-])(?:message|result)(?:[\s_-]|$)/i.test(marker);
  }

  function isSearchLocation(locationLike) {
    const path = String(locationLike?.pathname || "");
    return /(?:^|\/)search(?:\/|$)/i.test(path);
  }

  function setShadowContent(shadow, styleText, level3, durationText) {
    if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in shadow) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(styleText);
        shadow.adoptedStyleSheets = [sheet];
      } catch {}
    }
    if (!shadow.adoptedStyleSheets?.length) {
      const style = shadow.ownerDocument.createElement("style");
      style.textContent = styleText;
      shadow.append(style);
    }
    const wrap = shadow.ownerDocument.createElement("span");
    wrap.className = "badges";
    if (level3) {
      const warning = shadow.ownerDocument.createElement("span");
      warning.className = "level";
      warning.textContent = "!";
      warning.title = "Ошибка: level 3";
      warning.setAttribute("aria-label", "Ошибка: level 3");
      wrap.append(warning);
    }
    if (durationText) {
      const duration = shadow.ownerDocument.createElement("span");
      duration.className = `duration duration-${durationBand(durationToMilliseconds(durationText)) || "unknown"}`;
      duration.textContent = durationText;
      duration.title = `Длительность: ${durationText}`;
      duration.setAttribute("aria-label", `Длительность: ${durationText}`);
      wrap.append(duration);
    }
    shadow.append(wrap);
  }

  function createBadge(documentRef, indicators) {
    const host = documentRef.createElement("span");
    host.setAttribute(HOST_ATTRIBUTE, "");
    host.setAttribute("aria-label", [indicators.level3 ? "Ошибка: level 3" : "", indicators.durationText ? `Длительность: ${indicators.durationText}` : ""].filter(Boolean).join(". "));
    host.style.cssText = "all:initial;display:inline-flex;vertical-align:middle;flex:0 0 auto;margin:0 7px 0 0;position:relative;z-index:1;";
    const shadow = host.attachShadow({ mode: "closed" });
    setShadowContent(shadow, ":host{all:initial}.badges{display:inline-flex;align-items:center;gap:5px;font:700 11px/1.1 system-ui,sans-serif;white-space:nowrap}.level{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#c52a32;color:#fff;box-shadow:0 0 0 1px #861820,0 2px 5px #0004;font-size:14px}.duration{display:inline-flex;align-items:center;min-height:18px;padding:1px 6px;border:1px solid currentColor;border-radius:9px;box-sizing:border-box;font-variant-numeric:tabular-nums}.duration-fast{background:#e6f7ee;color:#16794b}.duration-normal{background:#eff8d9;color:#54730d}.duration-warning{background:#fff2bd;color:#866000}.duration-slow{background:#ffe0b2;color:#9a4d00}.duration-critical{background:#ffd8db;color:#a51d27}.duration-unknown{background:#edf4f6;color:#405963}@media(prefers-color-scheme:dark){.duration{filter:saturate(.9) brightness(.82);box-shadow:inset 0 0 0 20px #ffffff18}}", indicators.level3, indicators.durationText);
    return host;
  }

  function badgeAnchor(row) {
    if (String(row?.tagName || "").toUpperCase() === "TBODY") {
      return row.querySelector?.(":scope > tr:first-child > td:first-child") || null;
    }
    const heading = row?.querySelector?.("[data-message-header],summary,.message-header,.message-summary,.message-row-header");
    if (heading) return heading;
    if (String(row?.tagName || "").toUpperCase() === "TR") return row.cells?.[0] || row.querySelector?.("td,[role='cell']") || null;
    return row;
  }

  function messageOwner(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    if (!element) return null;
    const tableOwner = element.closest?.("tbody");
    if (isMessageRow(tableOwner)) return tableOwner;
    const outerTableOwner = tableOwner?.parentElement?.closest?.("tbody");
    if (isMessageRow(outerTableOwner)) return outerTableOwner;
    const strong = element.closest?.("[data-message-id],details,.message-row,.search-result,.result-message,[data-testid*='message'][data-testid*='row'],[data-testid*='result'][data-testid*='row']");
    if (strong && isMessageRow(strong)) return strong;
    const row = isMessageRow(element) ? element : element.closest?.(ROW_SELECTOR);
    if (isMessageRow(row)) return row;
    return null;
  }

  function createController(documentRef, options = {}) {
    const Observer = options.MutationObserver;
    const getLocation = options.getLocation || (() => documentRef.location);
    const errorReference = options.errorReference;
    const exceptionHighlights = options.exceptionHighlights;
    const onFinding = typeof options.onFinding === "function" ? options.onFinding : null;
    const records = new Map();
    const hostOwners = new WeakMap();
    const findings = new Map();
    const evidenceRows = new Map(), metadataVersions = new WeakMap(), observedRows=new Set();
    let navigationTicket = 0;
    let stackHelpCleanup=null;
    function clearStackHelp(){stackHelpCleanup?.();stackHelpCleanup=null;}
    function showStackHelp(field,row,valid) {
      clearStackHelp();
      if(!documentRef.createElement || !field?.getBoundingClientRect)return;
      const host=documentRef.createElement('div');host.setAttribute(HOST_ATTRIBUTE,'stack-help');
      host.setAttribute('data-advanced-graylog-stack-help','');
      const shadow=host.attachShadow?.({mode:'open'});if(!shadow)return;
      const style=documentRef.createElement('style');style.textContent=`:host{position:fixed;z-index:2147483647;font:14px/1.5 system-ui;color:#183443}button{cursor:pointer;font:inherit}button:focus-visible{outline:3px solid #9671ad;outline-offset:3px}.question{width:30px;height:30px;border:2px solid #fff;border-radius:50%;background:#167b88;color:white;font-weight:800;box-shadow:0 2px 9px #0005}.card{position:absolute;right:0;top:36px;box-sizing:border-box;width:min(360px,calc(100vw - 24px));padding:16px;border:1px solid #b9ced7;border-radius:14px;background:#fff;box-shadow:0 10px 30px #0004}.card[hidden]{display:none}h3{font-size:15px;margin:0 28px 8px 0}p{margin:8px 0;overflow-wrap:anywhere}.close{position:absolute;right:8px;top:6px;border:0;background:transparent;font-size:22px;color:#345}.hint{font-size:12px;color:#45616f}`;
      const button=documentRef.createElement('button');button.type='button';button.className='question';button.textContent='?';button.title='Почему произошла ошибка?';button.setAttribute('aria-label','Объяснить ошибку в этом стеке');button.setAttribute('aria-expanded','false');
      const card=documentRef.createElement('section');card.className='card';card.hidden=true;card.setAttribute('role','dialog');card.setAttribute('aria-label','Сенсор: объяснение ошибки');
      const heading=documentRef.createElement('h3');heading.textContent='Сенсор · что произошло';
      const close=documentRef.createElement('button');close.type='button';close.className='close';close.textContent='×';close.setAttribute('aria-label','Закрыть объяснение');
      const text=documentRef.createElement('p'),basis=documentRef.createElement('p');basis.className='hint';
      card.append(heading,close,text,basis);shadow.append(style,button,card);documentRef.documentElement.append(host);
      let frame=null;
      const position=()=>{frame=null;if(!valid()||!field.isConnected||!row.isConnected){clearStackHelp();return;}
        const rect=field.getBoundingClientRect(),width=documentRef.defaultView?.innerWidth||1024,height=documentRef.defaultView?.innerHeight||768;
        host.hidden=rect.bottom<0||rect.top>height||rect.width===0;
        const x=Math.max(12,Math.min(width-44,rect.right-32));host.style.left=x+'px';host.style.top=Math.max(8,Math.min(height-42,rect.top+4))+'px';
        card.style.right=x+30<Math.min(360,width-24)?'auto':'0';card.style.left=x+30<Math.min(360,width-24)?'0':'auto';
        card.style.top=rect.top>height/2?'auto':'36px';card.style.bottom=rect.top>height/2?'36px':'auto';
        card.style.maxHeight=Math.max(160,Math.floor(height/2)-30)+'px';card.style.overflow='auto';
      };
      const schedule=()=>{if(frame===null)frame=requestAnimationFrame(position);};
      const dismiss=()=>{card.hidden=true;button.setAttribute('aria-expanded','false');button.focus();};
      close.addEventListener('click',dismiss);
      shadow.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();dismiss();}});
      button.addEventListener('click',()=>{
        if(!valid()||!field.isConnected){clearStackHelp();return;}
        if(!card.hidden){dismiss();return;}
        // Read only this explicit navigation target, never neighbouring logs.
        const source=exceptionChain.readDomText(field).text;
        const result=(options.errorReference||globalThis.ErrorReference)?.classify?.({level:3,message:exceptionChain.compact(source)});
        const known=result&&result.priority!=='unknown'&&result.matchedRule!=='conflicting_evidence';
        text.textContent=known?`${result.title}. ${result.meaning||result.reason||''}`.slice(0,600):'По этому стеку точную причину установить не удалось. Проверьте исходное событие и контекст вызова.';
        const primary=exceptionChain.names(source).at(-1);
        basis.textContent=known?`Основание: ${primary?.split('.').at(-1)||'диагностический код'}. Это объяснение записи; первопричина сбоя системы может требовать проверки.`:'Недостаточно подтверждённых признаков — догадка не выдаётся за причину.';
        card.hidden=false;button.setAttribute('aria-expanded','true');position();
        globalThis.__advancedGraylogClippy?.explainStack?.(text.textContent);close.focus();
      });
      documentRef.addEventListener('scroll',schedule,{capture:true,passive:true});documentRef.defaultView?.addEventListener('resize',schedule,{passive:true});
      stackHelpCleanup=()=>{if(frame!==null)cancelAnimationFrame(frame);documentRef.removeEventListener('scroll',schedule,true);documentRef.defaultView?.removeEventListener('resize',schedule);host.remove();};
      position();
    }
    let lastNavigationDiagnostics=null;
    let indexRequestSequence=0, lastIndexCompletion=null;
    let identityCleanupPending=false;
    const scheduleTimeout = options.setTimeout || setTimeout;
    const cancelTimeout = options.clearTimeout || clearTimeout;
    let disposed = false;
    let scheduled = false;
    let workTimer=null;
    const idleWork=typeof globalThis.requestIdleCallback==='function';
    const deferWork=fn=>idleWork?globalThis.requestIdleCallback(fn,{timeout:1000}):setTimeout(fn,25);
    const cancelWork=id=>idleWork?globalThis.cancelIdleCallback(id):clearTimeout(id);
    let fullScans = 0;
    const pendingRows = new Map();
    const highlightTimers = new Map();
    let evidenceStyle=null;
    const evidenceFocus=new Map();

    function ensureHighlightStyle() {
      const existing = documentRef.querySelector?.(`style[${ERROR_TARGET_ATTRIBUTE}-style]`);
      if (existing) return;
      const style = documentRef.createElement?.("style");
      if (!style) return;
      style.setAttribute(`${ERROR_TARGET_ATTRIBUTE}-style`, "");
      style.textContent = `[${ERROR_TARGET_ATTRIBUTE}="active"]{outline:3px solid #df2f3c!important;outline-offset:3px!important;box-shadow:0 0 0 6px rgba(223,47,60,.22)!important;scroll-margin-block:96px!important}@media(prefers-reduced-motion:no-preference){[${ERROR_TARGET_ATTRIBUTE}="active"]{animation:advanced-graylog-error-focus .7s ease-out 2}}@keyframes advanced-graylog-error-focus{0%{box-shadow:0 0 0 0 rgba(223,47,60,.55)}100%{box-shadow:0 0 0 10px rgba(223,47,60,0)}}`;
      (documentRef.head || documentRef.documentElement)?.append?.(style);
    }

    function revealErrorRow(row) {
      if (!row?.isConnected) return false;
      ensureHighlightStyle();
      // The Graylog summary remains visible while MessageDetail is collapsed.
      // Highlight that stable owner rather than a transient detail field row.
      if (String(row.tagName || "").toUpperCase() === "DETAILS") row.open = true;
      else if (renderedMetadata.get(row)?.expanded === false && String(row.tagName || "").toUpperCase() === "TBODY") {
        row.querySelector?.(":scope > tr:first-child")?.click?.();
      }
      const reducedMotion = options.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
        ?? globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
        ?? false;
      row.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "center", inline: "nearest" });
      const hadTabIndex = row.hasAttribute?.("tabindex") === true;
      const previousTabIndex = row.getAttribute?.("tabindex");
      if (!hadTabIndex) row.setAttribute?.("tabindex", "-1");
      try { row.focus?.({ preventScroll: true }); } catch { try { row.focus?.(); } catch {} }
      row.setAttribute?.(ERROR_TARGET_ATTRIBUTE, "active");
      if (highlightTimers.has(row)) cancelTimeout(highlightTimers.get(row));
      const timer = scheduleTimeout(() => {
        row.removeAttribute?.(ERROR_TARGET_ATTRIBUTE);
        if (!hadTabIndex) row.removeAttribute?.("tabindex");
        else if (previousTabIndex !== null) row.setAttribute?.("tabindex", previousTabIndex);
        highlightTimers.delete(row);
      }, reducedMotion ? 1800 : 2600);
      highlightTimers.set(row, timer);
      return true;
    }

    function jumpToError(serviceName) {
      const expected = cleanText(serviceName).toLowerCase();
      if (!expected) return false;
      const ranks = { none: 0, exception: 1, cause: 2, stack: 3, "causal-stack": 4, application: 5 };
      const candidates = [];
      for (const [row, record] of records) {
        if (!row?.isConnected || !record?.level3 || cleanText(record.serviceName).toLowerCase() !== expected) continue;
        let rank = ranks[renderedMetadata.get(row)?.stackEvidence] || 0;
        // Read only already rendered fields, and only on this explicit action.
        // Collapsed messages use the finite MAIN evidence category instead.
        for (const element of extractMessageElements(row)) {
          const value = exceptionChain?.readDomText(element).text || "";
          const entries = exceptionChain?.parse(value) || [];
          if (!entries.length && !exceptionChain?.callsite(value)) continue;
          const cause = entries.some(entry => entry.relation === "cause");
          const stack = Boolean(exceptionChain?.origin(value));
          const evidence = exceptionChain?.callsite(value) ? "application" : stack ? (cause ? "causal-stack" : "stack") : cause ? "cause" : "exception";
          rank = Math.max(rank, ranks[evidence]);
        }
        candidates.push({ row, rank });
      }
      // Map insertion order may predate Graylog sorting or React row reuse.
      candidates.sort((a, b) => b.rank - a.rank || ((a.row.compareDocumentPosition?.(b.row) || 0) & 2 ? 1 : -1));
      return candidates.length ? revealErrorRow(candidates[0].row) : false;
    }

    function removeBadge(row) {
      const record = records.get(row);
      if (record?.host) hostOwners.delete(record.host);
      record?.host?.remove?.();
      records.delete(row);
    }


    function clearEvidenceFocus(field) {
      field.removeAttribute?.('data-advanced-graylog-evidence-target');
      if(evidenceFocus.has(field)){const old=evidenceFocus.get(field);if(old===null)field.removeAttribute?.('tabindex');else field.setAttribute?.('tabindex',old);evidenceFocus.delete(field);}
    }
    function evidenceField(row, field) {
      const nodes=[];
      const selector=FIELD_ATTRIBUTES.map(name=>'['+name+']').join(',');
      for(const node of Array.from(row.querySelectorAll?.(selector)||[]).slice(0,MAX_FIELD_NODES)){
        if(FIELD_ATTRIBUTES.some(attr=>normalizedFieldName(node.getAttribute?.(attr))===normalizedFieldName(field))||node.getAttribute?.('data-testid')==='message-field-value-'+field)nodes.push(node);
      }
      for(const label of Array.from(row.querySelectorAll?.("dt,th,[role='rowheader'],[data-testid*='field-name'],.field-name,.field-name-cell")||[]).slice(0,MAX_FIELD_NODES)){
        if(normalizedFieldName(label.textContent)!==normalizedFieldName(field))continue;
        const value=label.nextElementSibling||label.parentElement?.querySelector?.("[role='cell'],dd,[data-testid*='field-value'],.field-value,.field-value-cell");
        if(value&&value!==label)nodes.push(value);
      }
      // A summary is an explicit message target, never a full_message target.
      if(field==='message'){
        const summary=row.querySelector?.('[data-message-text],[data-testid="message-summary-field-message"],.message-text,.message-value');
        if(summary)nodes.unshift(summary);
        // Native MessageTableEntry 4.3/5.2/6.0: FieldsRow, MessagePreview,
        // optional MessageDetailRow. Preview has one colspan cell and a
        // MessageFieldRow wrapper, without a field attribute or test id.
        if(String(row.tagName).toUpperCase()==='TBODY'){
          const preview=row.children?.[1],cell=preview?.children?.[0];
          if(preview?.tagName==='TR'&&preview.children.length===1&&cell?.tagName==='TD'&&cell.hasAttribute('colspan')){
            const wrapper=cell.firstElementChild;
            if(wrapper?.tagName==='DIV'&&wrapper.textContent?.trim())nodes.unshift(wrapper);
          }
        }
      }
      return nodes.find(node=>node.isConnected&&node.getClientRects?.().length&&!node.closest?.('[hidden]'))||null;
    }
    async function jumpToEvidence(target) {
      clearStackHelp();
      const nativeKey=/^nv1_[a-f0-9]{16}$/.test(target?.navigationKey||'')?target.navigationKey:null;
      const contentKey=/^ev1_[a-f0-9]{16}$/.test(target?.eventKey||'')?target.eventKey:null;
      if((!nativeKey&&!contentKey)||!exceptionChain.FIELD_NAMES.includes(target?.field))return {moved:false,reason:'invalid'};
      const ticket=++navigationTicket;
      lastIndexCompletion=null;
      const context=()=>JSON.stringify(globalThis.__advancedGraylogClippy?.resolveTraceContext?.()||{url:documentRef.location?.href});
      const initial=context(),valid=()=>!disposed&&ticket===navigationTicket&&isSearchLocation(getLocation())&&context()===initial;
      const pause=()=>new Promise(resolve=>setTimeout(resolve,40));
      const diagnostics=(reason)=>{
        const rows=new Set();for(const set of evidenceRows.values())for(const row of set)if(row.isConnected)rows.add(row);
        for(const row of observedRows)if(!row.isConnected)observedRows.delete(row);
        const state={schema:2,reason,field:target.field,targetNativeId:Boolean(nativeKey),targetFingerprint:Boolean(contentKey),rowsRead:observedRows.size,indexedRows:rows.size,nativeIdRows:0,errorRows:0,badges:records.size,pendingDecoration:pendingRows.size,identitylessRows:0};
        for(const row of observedRows){const data=renderedMetadata.get(row);if(data?.navigationKey)state.nativeIdRows++;if(data?.level==='3')state.errorRows++;if(!data?.eventKey&&!data?.navigationKey)state.identitylessRows++;}
        if(lastIndexCompletion){state.bridgeVersion=2;state.refreshComplete=lastIndexCompletion.status==='complete';
          for(const key of ['rowsRequested','rowsRead','rowsPublished','indexedRows','nativeIdRows','errorRows','identitylessRows'])if(Number.isSafeInteger(lastIndexCompletion[key])&&lastIndexCompletion[key]>=0)state['reader'+key[0].toUpperCase()+key.slice(1)]=lastIndexCompletion[key];
          for(const key of ['eventKey','navigationKey','sourceEvidence'])if(typeof lastIndexCompletion.capabilities?.[key]==='boolean')state['can'+key[0].toUpperCase()+key.slice(1)]=lastIndexCompletion.capabilities[key];
          for(const key of ['id','index','timestamp','message','level'])if(Number.isSafeInteger(lastIndexCompletion.fieldCounts?.[key]))state['fields'+key[0].toUpperCase()+key.slice(1)]=lastIndexCompletion.fieldCounts[key];
        }
        lastNavigationDiagnostics=Object.freeze(state);return state;
      };
      const matches=()=>{
        const stable=nativeKey?[...(evidenceRows.get(nativeKey)||[])].filter(row=>row.isConnected&&renderedMetadata.get(row)?.navigationKey===nativeKey):[];
        if(stable.length)return stable;
        // Legacy rows without a native id can still use the exact fingerprint.
        // A DIFFERENT native id is never replaced with a text/service guess.
        return contentKey?[...(evidenceRows.get(contentKey)||[])].filter(row=>row.isConnected&&renderedMetadata.get(row)?.eventKey===contentKey&&(!nativeKey||!renderedMetadata.get(row)?.navigationKey)):[];
      };
      const refresh=async(row=documentRef)=>{
        const requestId='nav_'+Date.now().toString(36)+'_'+(++indexRequestSequence).toString(36);
        let completion=null;
        const receive=event=>{if(typeof event.detail!=='string'||event.detail.length>2048)return;try{const data=JSON.parse(event.detail);if(data.version===2&&data.requestId===requestId&&['complete','superseded','inactive'].includes(data.status))completion=data;}catch{}};
        documentRef.addEventListener(RENDERED_COMPLETE_EVENT,receive);
        try{
          row.dispatchEvent?.(new CustomEvent(RENDERED_REQUEST_EVENT,{bubbles:row!==documentRef,detail:JSON.stringify({version:2,requestId})}));
          const end=Date.now()+1500;
          while(valid()&&!completion&&Date.now()<end)await pause();
          lastIndexCompletion=completion;
          return completion;
        }finally{documentRef.removeEventListener(RENDERED_COMPLETE_EVENT,receive);}
      };
      let found=matches(),completion=null;
      if(!found.length){
        completion=await refresh();found=matches();
        // Repair only the local reader, on an explicit navigation action. No
        // Graylog query, native expansion or permission request is involved.
        const noKeys=!evidenceRows.size;
        if(valid()&&!found.length&&noKeys&&typeof options.repairIndex==='function'&&(!completion||!completion.capabilities?.eventKey||!completion.capabilities?.navigationKey)){
          try{const repaired=await Promise.race([Promise.resolve(options.repairIndex()),new Promise(resolve=>setTimeout(()=>resolve(null),1200))]);if(repaired?.ok&&valid()){completion=await refresh();found=matches();}}catch{}
        }
      }
      if(!valid())return {moved:false,reason:'cancelled'};
      if(found.length!==1){const reason=found.length?'ambiguous':completion?.status==='complete'?(evidenceRows.size?'not-on-page':'index-unavailable'):'index-pending';return {moved:false,reason,diagnostics:diagnostics(reason)};}
      const row=found[0],version=metadataVersions.get(row)||0;
      // A React row can be reused before its idle metadata catches up. Re-read
      // this single committed row before any scroll or expansion.
      await refresh(row);
      if(!valid())return {moved:false,reason:'cancelled'};
      found=matches();
      if(!row.isConnected||found.length!==1||found[0]!==row||(metadataVersions.get(row)||0)===version)return {moved:false,reason:'stale',diagnostics:diagnostics('stale')};
      // Navigation is an explicit user action. Expand the exact matched
      // MessageTableEntry even when its compact `message` preview is already
      // visible, so every error jump opens the native Graylog details. Never
      // click a row whose committed metadata does not say it is collapsed.
      if(String(row.tagName).toUpperCase()==='DETAILS')row.open=true;
      else if(renderedMetadata.get(row)?.expanded===false&&String(row.tagName).toUpperCase()==='TBODY'){
        row.querySelector?.(':scope > tr:first-child')?.click?.();
        const expandedDeadline=Date.now()+2000;
        while(valid()&&row.isConnected&&renderedMetadata.get(row)?.expanded===false&&Date.now()<expandedDeadline)await pause();
      }
      let field=evidenceField(row,target.field);
      if(!field){
        const mountedDeadline=Date.now()+2000;
        while(valid()&&row.isConnected&&!field&&Date.now()<mountedDeadline){await pause();field=evidenceField(row,target.field);}
        if(field&&valid()){
          const freshVersion=metadataVersions.get(row)||0;
          await refresh(row);
          const fresh=matches();
          if((metadataVersions.get(row)||0)===freshVersion||fresh.length!==1||fresh[0]!==row)return {moved:false,reason:'stale'};
        }
      }
      if(!valid())return {moved:false,reason:'cancelled'};
      const finalMatches=matches();if(finalMatches.length!==1||finalMatches[0]!==row)return {moved:false,reason:'stale'};
      if(!field)return {moved:false,reason:'field-unavailable',diagnostics:diagnostics('field-unavailable')};
      const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      field.scrollIntoView?.({behavior:reduced?'auto':'smooth',block:'center',inline:'nearest'});
      for(const previous of [...evidenceFocus.keys()]){if(highlightTimers.has(previous))cancelTimeout(highlightTimers.get(previous));highlightTimers.delete(previous);clearEvidenceFocus(previous);}
      evidenceFocus.set(field,field.getAttribute('tabindex'));
      field.setAttribute('tabindex','-1');field.focus?.({preventScroll:true});
      // Focus only the requested value, not the message toolbar or whole row.
      const attr='data-advanced-graylog-evidence-target';field.setAttribute(attr,target.field);
      try {
        if(!evidenceStyle){
          const sheet=new CSSStyleSheet();sheet.replaceSync('['+attr+']{outline:2px solid #9671ad;outline-offset:4px;scroll-margin-block:96px}');
          documentRef.adoptedStyleSheets=[...documentRef.adoptedStyleSheets,sheet];
          evidenceStyle=sheet;
        }
      } catch {}
      if(highlightTimers.has(field))cancelTimeout(highlightTimers.get(field));
      highlightTimers.set(field,scheduleTimeout(()=>{clearEvidenceFocus(field);highlightTimers.delete(field);},2600));
      if(target.field!=='message'||renderedMetadata.get(row)?.sourceField==='message')showStackHelp(field,row,()=>valid()&&matches().length===1&&matches()[0]===row);
      diagnostics('moved');return {moved:true,field:target.field};
    }

    function forgetEvidence(row) {
      for(const key of [renderedMetadata.get(row)?.eventKey,renderedMetadata.get(row)?.navigationKey]){
        const rows=evidenceRows.get(key);rows?.delete(row);if(rows&&!rows.size)evidenceRows.delete(key);
      }
    }
    function removeRow(row, keepIdentity=false) {
      if(!keepIdentity)forgetEvidence(row);
      exceptionHighlights?.remove(row);
      removeBadge(row);
      findings.delete(row);
      if (highlightTimers.has(row)) cancelTimeout(highlightTimers.get(row));
      highlightTimers.delete(row);
      row?.removeAttribute?.(ERROR_TARGET_ATTRIBUTE);
    }

    function updateFinding(row, indicators, preserveMissing) {
      exceptionHighlights?.update(row, extractMessageElements(row), indicators.level3);
      const finding = extractKnownSystemFinding(row, indicators, errorReference) || (indicators.level3 ? Object.freeze({kind:'level3'}) : null);
      if (!finding) {
        if (!preserveMissing) findings.delete(row);
        return;
      }
      const identity=renderedMetadata.get(row)?.navigationKey||renderedMetadata.get(row)?.eventKey||'';
      const signature = `${identity}|${finding.kind||''}|${finding.referenceId}|${finding.label}|${finding.priority}`;
      if (findings.get(row)?.signature === signature) return;
      findings.set(row, { signature, finding });
      try { onFinding?.(finding); } catch {}
    }

    function updateRow(row, preserveMissing = false) {
      const owner = messageOwner(row);
      if (owner && owner !== row) {
        removeRow(row);
        row = owner;
      }
      if (!isMessageRow(row) || !row.isConnected) return;
      // MAIN metadata can arrive after a provisional TR has been decorated.
      // Retire its record when the containing message TBODY becomes the owner.
      // Only hosts created by this controller are eligible; native badges stay.
      for (const host of row.querySelectorAll?.(`[${HOST_ATTRIBUTE}]`) || []) {
        const previousOwner = hostOwners.get(host);
        if (previousOwner && previousOwner !== row && messageOwner(previousOwner) === row) removeRow(previousOwner);
      }
      const indicators = extractMessageIndicators(row);
      updateFinding(row, indicators, preserveMissing);
      const signature = `${indicators.level3 ? 1 : 0}|${indicators.durationText}`;
      if (!indicators.level3 && !indicators.durationText) {
        if (preserveMissing && records.has(row)) return;
        removeRow(row,true);
        return;
      }
      const current = records.get(row);
      const serviceName = extractServiceName(row);
      const anchor = badgeAnchor(row);
      if (current?.signature === signature && current.host?.isConnected && current.anchor === anchor) {
        if (serviceName) current.serviceName = serviceName;
        return;
      }
      removeBadge(row);
      if (!anchor?.prepend) return;
      const host = createBadge(documentRef, indicators);
      anchor.prepend(host);
      hostOwners.set(host, row);
      records.set(row, { host, anchor, signature, level3: indicators.level3, serviceName });
    }

    function scan() {
      if (disposed) return;
      if (!isSearchLocation(getLocation())) {
        evidenceRows.clear();observedRows.clear();
        for (const row of new Set([...records.keys(), ...findings.keys()])) removeRow(row);
        return;
      }
      fullScans++;
      const rows = Array.from(new Set(Array.from(documentRef.querySelectorAll(ROW_SELECTOR)).map(messageOwner).filter(Boolean)));
      const current = new Set(rows);
      for(const row of rows)queueRow(row,false);scheduleFlush();
      for (const row of new Set([...records.keys(), ...findings.keys()])) if (!current.has(row) || !row.isConnected) removeRow(row);
    }

    const pendingRoots=new Map();let quietUntil=0;
    const nativeInput=event=>{if(!ownUi(event.target)){quietUntil=Date.now()+250;clearStackHelp();}};
    for(const type of ['input','keydown','submit'])documentRef.addEventListener?.(type,nativeInput,{capture:true,passive:true});
    function flushRows(deadline) {
      scheduled = false;
      workTimer = null;
      if (disposed) return;
      if (!isSearchLocation(getLocation())) {
        evidenceRows.clear();observedRows.clear();
        for (const row of new Set([...records.keys(), ...findings.keys()])) removeRow(row);
        pendingRows.clear();
        return;
      }
      if(Date.now()<quietUntil||globalThis.navigator?.scheduling?.isInputPending?.()){scheduleFlush();return;}
      const discoveryStart=Date.now();let discovered=0;
      for(const [node,options] of pendingRoots){pendingRoots.delete(node);if(node.isConnected!==false)collectRows(node,options.preserve,options.descendants);if(++discovered>=5||Date.now()-discoveryStart>=4)break;}
      if(pendingRoots.size){scheduleFlush();return;}
      const start=Date.now();let count=0;
      for (const [row, preserveMissing] of pendingRows) {
        pendingRows.delete(row);updateRow(row, preserveMissing);
        if(++count>=5||Date.now()-start>=4||(deadline&&deadline.timeRemaining()<1))break;
      }
      for (const row of new Set([...records.keys(), ...findings.keys()])) {
        if (!row.isConnected || messageOwner(row) !== row) removeRow(row);
      }
      if(pendingRows.size)scheduleFlush();
      else if(identityCleanupPending){for(const row of observedRows)if(!row.isConnected){forgetEvidence(row);observedRows.delete(row);}identityCleanupPending=false;}
    }

    function queueRow(row, preserveMissing) {
      if (!row) return;
      const previous = pendingRows.get(row);
      // A concrete field/text update wins over the collapse-only preservation.
      pendingRows.set(row, previous === false ? false : Boolean(preserveMissing));
    }

    function ownUi(node) {
      const element=node?.nodeType===1?node:node?.parentElement;
      const owner=element?.closest?.('[data-advanced-graylog-message-badges],[id^="advanced-graylog-"]');
      return Boolean(element?.hasAttribute?.(HOST_ATTRIBUTE)||owner?.hasAttribute?.(HOST_ATTRIBUTE)||/^advanced-graylog-/.test(owner?.id||""));
    }
    function collectRows(node, preserveMissing = false, descendants = false) {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      if (!element || ownUi(element)) return;
      const owner=messageOwner(element);
      queueRow(owner, preserveMissing);
      if(!descendants||owner)return;
      const children = element.querySelectorAll?.(ROW_SELECTOR) || [];
      let count = 0;
      for (const candidate of children) {
        queueRow(messageOwner(candidate), preserveMissing);
        if (++count >= 500) break;
      }
    }

    function scheduleFlush() {
      if (disposed || scheduled) return;
      scheduled = true;
      workTimer=deferWork(flushRows);
    }

    function onMutations(mutations = []) {
      const targets=new Map(),added=new Set();let removed=false;
      for (const mutation of mutations) {
        if(ownUi(mutation.target))continue;
        if (mutation.type === "childList") {
          const changed=[...(mutation.addedNodes||[]),...(mutation.removedNodes||[])];
          if(changed.length&&changed.every(ownUi))continue;
          const preserve=mutation.removedNodes?.length > 0 && !mutation.addedNodes?.length;
          targets.set(mutation.target,targets.get(mutation.target)===false?false:Boolean(preserve));
          removed ||= Boolean(mutation.removedNodes?.length);
          for (const node of mutation.addedNodes || []) added.add(node);
        } else targets.set(mutation.target,false);
      }
      for(const [node,preserve] of targets)pendingRoots.set(node,{preserve,descendants:pendingRoots.get(node)?.descendants||false});
      for(const node of added)pendingRoots.set(node,{preserve:false,descendants:true});
      if(pendingRoots.size>500){pendingRoots.clear();pendingRoots.set(documentRef.documentElement,{preserve:false,descendants:true});}
      if(removed)identityCleanupPending=true;
      if (pendingRows.size||pendingRoots.size||removed) scheduleFlush();
    }

    function onRenderedMetadata(event) {
      const row = event.target;
      if (!row?.isConnected || !row.hasAttribute?.(RENDERED_ROW_ATTRIBUTE) || !isMessageRow(row)) return;
      if (typeof event.detail !== "string" || event.detail.length > 2048) return;
      let data;
      try { data = JSON.parse(event.detail); } catch { return; }
      if (data?.version !== 1) return;
      // Page events are untrusted. Only bounded display metadata is accepted;
      // the bridge cannot invoke extension actions or pass executable content.
      const safe = {
        eventKey:typeof data.eventKey==='string'&&/^ev1_[a-f0-9]{16}$/.test(data.eventKey)?data.eventKey:null,
        navigationKey:typeof data.navigationKey==='string'&&/^nv1_[a-f0-9]{16}$/.test(data.navigationKey)?data.navigationKey:null,
        sourceField:exceptionChain.FIELD_NAMES.includes(data.sourceField)?data.sourceField:null,
        level: typeof data.level === "string" && /^[0-7]$/.test(data.level) ? data.level : "",
        duration: typeof data.duration === "string" && data.duration.length < 48 ? parseDurationValue(data.duration, "ms", true) : "",
        service: typeof data.service === "string" ? cleanText(data.service).slice(0, 128) : "",
        expanded: typeof data.expanded === "boolean" ? data.expanded : undefined,
        exceptionChain: Array.isArray(data.exceptionChain) && data.exceptionChain.length <= 8 && data.exceptionChain.every(value=>exceptionChain?.validName(value)) ? data.exceptionChain : [],
        stackEvidence: ["none", "exception", "cause", "stack", "causal-stack", "application"].includes(data.stackEvidence) ? data.stackEvidence : "none",
        exception: typeof data.exception === "string" && /^(?:[a-zA-Z_$][\w$]*\.)*[a-zA-Z_$][\w$]*(?:Exception|Error)$/.test(data.exception) ? data.exception.slice(0, 160) : ""
      };
      const owner=messageOwner(row)||row;
      observedRows.add(owner);if(observedRows.size>500){const oldest=observedRows.values().next().value;forgetEvidence(oldest);observedRows.delete(oldest);}
      forgetEvidence(owner);
      renderedMetadata.set(owner, safe);
      metadataVersions.set(owner,(metadataVersions.get(owner)||0)+1);
      for(const key of [safe.eventKey,safe.navigationKey].filter(Boolean)){const rows=evidenceRows.get(key)||new Set();rows.add(owner);evidenceRows.set(key,rows);}
      queueRow(owner,false);
      scheduleFlush();
    }

    const observer = new Observer(onMutations);
    observer.observe(documentRef.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-level", "data-duration", "data-duration-ms", "data-service", "data-service-name", "data-field", "data-field-name", "data-column"]
    });
    documentRef.addEventListener?.(RENDERED_UPDATE_EVENT, onRenderedMetadata);
    scan();
    if (typeof CustomEvent === "function") documentRef.dispatchEvent?.(new CustomEvent(RENDERED_REQUEST_EVENT));
    return Object.freeze({
      scan,
      dispose() {
        if (disposed) return;
        disposed = true; clearStackHelp();navigationTicket++; evidenceRows.clear();observedRows.clear();
        if(workTimer!==null)cancelWork(workTimer);
        observer.disconnect();
        pendingRoots.clear();for(const type of ['input','keydown','submit'])documentRef.removeEventListener?.(type,nativeInput,true);
        exceptionHighlights?.dispose();
        if(evidenceStyle)documentRef.adoptedStyleSheets=documentRef.adoptedStyleSheets.filter(sheet=>sheet!==evidenceStyle);
        for(const [element,timer]of highlightTimers){cancelTimeout(timer);clearEvidenceFocus(element);}
        highlightTimers.clear();
        documentRef.removeEventListener?.(RENDERED_UPDATE_EVENT, onRenderedMetadata);
        for (const row of new Set([...records.keys(), ...findings.keys()])) removeRow(row);
      },
      jumpToError,
      jumpToEvidence,
      getNavigationDiagnostics:()=>lastNavigationDiagnostics,
      getFindings: () => Object.freeze([...findings.values()].map((item) => item.finding)),
      getState: () => Object.freeze({ active: !disposed && isSearchLocation(getLocation()), badges: records.size, findings: findings.size, fullScans, pendingRows: pendingRows.size })
    });
  }

  return Object.freeze({
    HOST_ATTRIBUTE,
    RENDERED_ROW_ATTRIBUTE,
    ROW_SELECTOR,
    extractMessageIndicators,
    extractMessageText,
    extractMessageElements,
    extractServiceName,
    extractKnownSystemFinding,
    durationToMilliseconds,
    durationBand,
    ERROR_TARGET_ATTRIBUTE,
    isMessageRow,
    messageOwner,
    isSearchLocation,
    createController
  });
});
