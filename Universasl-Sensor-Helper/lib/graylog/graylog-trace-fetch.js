(function exposeGraylogTraceFetch(root) {
  "use strict";
  const GATEWAY_SERVICE_NAME = "online-banking-gateway";
async function fetchTraceDiagramInGraylog(queryString, startMs, endMs, streamIds, nodeLimit, groups = [], groupLimit = 25, businessRules = [], options = {}) {
  const localPage=options.localPage, local=localPage!==undefined;
  const localLimit=local&&Number.isInteger(localPage?.collectedPages)&&localPage.collectedPages>=2&&localPage.collectedPages<=5?1000:200;
  const requestAbort=typeof AbortController==="function"?new AbortController():null;
  const explicitRunId=typeof options.runId==='string'&&/^[a-z0-9_-]{1,128}$/i.test(options.runId)?options.runId:'';
  const explicitRuns=globalThis.__advancedGraylogExplicitTraceRuns ||= new Map();
  let explicitRun=null;
  if(!local&&explicitRunId&&requestAbort){
    const existing=explicitRuns.get(explicitRunId);
    if(existing&&!existing.finished){
      if(existing.abort)return {error:'Эта операция уже выполняется'};
      if(existing.cancelled){existing.finished=true;explicitRuns.delete(explicitRunId);return {error:'Операция остановлена.'};}
      explicitRun=existing;explicitRun.abort=requestAbort;
    }else{explicitRun={abort:requestAbort,cancelled:false,finished:false,prepared:false};explicitRuns.set(explicitRunId,explicitRun);}
  }
  let requestTimeout=null,pageSession=null,pageSessionToken=null,pageSessions=null,nextPageToken=null,ownsPageSession=false;
  const dropPage=token=>{const session=pageSessions?.get(token);if(session?.expiryTimer!==undefined&&typeof clearTimeout==='function')clearTimeout(session.expiryTimer);pageSessions?.delete(token);};
  const armPage=()=>{
    if(pageSession.expiryTimer!==undefined&&typeof clearTimeout==='function')clearTimeout(pageSession.expiryTimer);
    if(typeof setTimeout==='function'){
      const token=pageSessionToken,session=pageSession;
      session.expiryTimer=setTimeout(()=>{if(pageSessions.get(token)===session){pageSessions.delete(token);session.messages.length=0;session.seenIds?.clear();}},120000);session.expiryTimer?.unref?.();
    }
  };
  try {
    const clock = () => globalThis.performance?.now?.() ?? Date.now();
    const deadlineAt = !local && Number.isFinite(options.deadlineAt) ? Math.min(options.deadlineAt, Date.now() + 65_000) : Date.now() + 65_000;
    if (!local && deadlineAt <= Date.now()) throw new Error("Истекло общее время поиска. Повторите вручную.");
    // Keep the isolated overlay, Search input and this serializable MAIN entry
    // point on the same exact-query grammar. Canonicalization is only for our
    // explicit analysis request; it never edits Graylog's native query/state.
    const traceMatch = /^traceId\s*:\s*(?:"([a-z0-9_-]{1,128})"|([a-z0-9_-]{1,128}))$/i.exec(String(queryString || "").trim());
    if (!traceMatch) throw new Error("Блок-схема доступна только для точного traceId");
    const exactTraceId = traceMatch[1] || traceMatch[2];
    queryString = `traceId:"${exactTraceId}"`;
    if(local&&(!localPage||localPage.scope!=='current-page'||!Array.isArray(localPage.messages)))throw new Error('Некорректный снимок текущей страницы');
    if (!local&&(!Array.isArray(streamIds) || !streamIds.length || streamIds.length > 16)) {
      throw new Error("Stream для traceId не выбран");
    }
    globalThis.BusinessErrorRules?.replace(Array.isArray(businessRules) ? businessRules : []);
    let requestStarted=clock(),responseReceived=requestStarted,parsedAt=requestStarted,searchType,endpoint,headers;
    const allowedGroups = new Set(["service-name", "initUri", "traceId", "level", "httpStatus", "errorCode", "Terminal-Version", "Terminal-Type", "logger_name", "source", "branch", "abbrev"]);
    const selectedGroups = Array.isArray(groups) ? groups.map(String) : [];
    if (selectedGroups.some((field) => !allowedGroups.has(field)) || new Set(selectedGroups).size !== selectedGroups.length) throw new Error("Недопустимые поля группировки");
    const resultLimit = Math.max(50, Math.min(200, Number(nodeLimit) || 200));
    if(local){
      const scalarId=value=>Array.isArray(value)&&value.length===1?value[0]:value;
      const messages=localPage.messages.slice(0,localLimit).filter(item=>{
        const fields=item?.message;
        const ids=[fields?.traceId,fields?.trace_id].filter(value=>value!==undefined);
        return ids.length>0&&ids.every(value=>scalarId(value)===exactTraceId);
      });
      const nativeTotal=Number(localPage.nativeTotal);
      searchType={messages,total_results:Number.isSafeInteger(nativeTotal)&&nativeTotal>=messages.length?nativeTotal:messages.length};
    }else{
    const paging=options.pagination===true||typeof options.pageToken==='string';
    if(paging){
      pageSessions=globalThis.__advancedGraylogTracePageSessions ||= new Map();
      const now=Date.now();for(const [token,session] of pageSessions)if(!session.busy&&session.expiresAt<=now)dropPage(token);
      const scope=JSON.stringify([location.href,queryString,startMs,endMs,streamIds,selectedGroups]);
      if(options.pageToken){
        pageSessionToken=options.pageToken;pageSession=pageSessions.get(pageSessionToken);
        if(!pageSession||pageSession.scope!==scope||pageSession.expiresAt<=now||pageSession.busy)throw new Error('Продолжение загрузки устарело. Повторите поиск.');
      }else{
        if(pageSessions.size>=2){const removable=[...pageSessions].find(([,session])=>!session.busy);if(removable)dropPage(removable[0]);else throw new Error('Уже выполняется загрузка trace. Дождитесь завершения.');}
        pageSessionToken=crypto.randomUUID();pageSession={scope,messages:[],seenIds:new Set(),offset:0,pageSize:Math.max(1,Math.min(50,Math.floor(Number(options.pageSize))||50)),expiresAt:now+120000,busy:false};
        pageSessions.set(pageSessionToken,pageSession);
      }
      pageSession.busy=true;pageSession.expiresAt=now+120000;ownsPageSession=true;armPage();
    }
    const current = new URL(location.href);
    const searchIndex = current.pathname.toLowerCase().lastIndexOf("/search");
    if (searchIndex < 0) throw new Error("Текущая вкладка не является страницей поиска Graylog");
    const beforeSearch = current.pathname.slice(0, searchIndex);
    const streamRouteIndex = beforeSearch.toLowerCase().lastIndexOf("/streams/");
    const basePath = streamRouteIndex >= 0 ? beforeSearch.slice(0, streamRouteIndex) : beforeSearch;
    endpoint = new URL(`${basePath}/api/views/search/sync?timeout=60000`, current.origin).toString();
    const searchId = crypto.randomUUID(), queryId = crypto.randomUUID(), searchTypeId = crypto.randomUUID();
    const messageDefinition = { id: searchTypeId, type: "messages", limit: pageSession?Math.min(pageSession.pageSize,200-pageSession.messages.length):resultLimit, offset: pageSession?.offset||0, sort: [{ field: "timestamp", order: "ASC" }], filter: null };
    headers = { Accept: "application/json", "Content-Type": "application/json", "X-Requested-By": "graylog-trace-diagram" };
    const storedSession = globalThis.localStorage?.getItem("sessionId") || "";
    let sessionId = storedSession;
    try { sessionId = JSON.parse(storedSession); } catch {}
    if (typeof sessionId === "string" && sessionId) headers.Authorization = `Basic ${btoa(`${sessionId}:session`)}`;
    requestStarted = clock();
    // Bound the whole transport (including body read and the optional pivot).
    // Aborting fetch cannot guarantee cancellation of work already accepted by
    // the Graylog server; its own sync timeout remains 60 seconds.
    if(requestAbort){requestTimeout=setTimeout(()=>{if(explicitRun)explicitRun.timedOut=true;requestAbort.abort();},Math.max(1,deadlineAt-Date.now()));requestTimeout?.unref?.();}
    const response = await fetch(endpoint, {
      method: "POST", credentials: "include", cache: "no-store",
      ...(requestAbort?{signal:requestAbort.signal}:{}),
      headers,
      body: JSON.stringify({ id: searchId, parameters: [], queries: [{
        id: queryId,
        query: { type: "elasticsearch", query_string: queryString },
        timerange: { type: "absolute", from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString() },
        filter: { type: "or", filters: streamIds.map((id) => ({ type: "stream", id })) },
        search_types: [messageDefinition]
      }] })
    });
    const text = await response.text();
    responseReceived = clock();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`Graylog вернул не JSON: HTTP ${response.status}`); }
    parsedAt = clock();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message || data.type || "ошибка Graylog"}`);
    searchType = data.results?.[queryId]?.search_types?.[searchTypeId];
    if (data.execution?.done === false || data.execution?.cancelled || data.execution?.completed_exceptionally || data.errors?.length || searchType?.errors?.length) throw new Error("Graylog вернул неполный результат поиска. Повторите поиск после завершения обработки.");
    if (!searchType) {
      const details = data.errors?.map((item) => item.description || item.message).filter(Boolean).join("; ");
      throw new Error(`Graylog не вернул список сообщений${details ? `: ${details}` : ""}`);
    }
    if (!Array.isArray(searchType.messages)) throw new Error("Graylog не вернул корректный список сообщений");
    if(pageSession&&!local){
      const batch=searchType.messages.slice(0,messageDefinition.limit),total=Number(searchType.total_results??searchType.totalResults)||0;
      if(pageSession.total!==undefined&&pageSession.total!==total)throw new Error('Выдача Graylog изменилась во время загрузки. Повторите поиск.');
      pageSession.total=total;
      for(const item of batch){
        const rawId=item?.message?._id,rawIndex=item?.index;
        const id=Array.isArray(rawId)&&rawId.length===1?rawId[0]:rawId,index=Array.isArray(rawIndex)&&rawIndex.length===1?rawIndex[0]:rawIndex;
        if(typeof id!=='string'||typeof index!=='string'||id.length>256||index.length>256)continue;
        const key=JSON.stringify([id,index]);if(pageSession.seenIds.has(key))throw new Error('Выдача Graylog изменилась: сообщения между страницами повторяются. Повторите поиск.');pageSession.seenIds.add(key);
      }
      pageSession.messages.push(...batch);pageSession.offset+=batch.length;
      searchType={...searchType,messages:pageSession.messages.slice(0,200)};
      const more=batch.length>0&&pageSession.messages.length<Math.min(total,200);
      dropPage(pageSessionToken);
      if(more){nextPageToken=crypto.randomUUID();pageSessionToken=nextPageToken;pageSession.expiresAt=Date.now()+120000;pageSessions.set(nextPageToken,pageSession);armPage();}
    }
    }
    const parts = new Map(["request", "response", "openapi", "openapi-response", "gorod-client", "gorod-client-response", "partner-backend", "partner-backend-response", "kafka-produce", "kafka-consume", "kafka-broker", "xml-procedure-request", "xml-procedure-response", "cache-access", "outgoing-failure"].map((kind) => [kind, { kind, messages: [], total: 0 }]));
    const messageValues = (source) => {
      if (!source || typeof source !== "object") return [source];
      const allowed = new Set(["message", "fullmessage", "shortmessage", "logmessage"]);
      return Object.entries(source)
        .filter(([key, value]) => allowed.has(String(key).toLowerCase().replace(/[^a-z]/g, "")) && (typeof value === "string" || typeof value === "number"))
        .map(([, value]) => value);
    };
    const isLogPrefix = (value) => {
      let prefix = String(value || "").trim();
      if (!prefix) return true;
      const hadTimestamp = /^(?:<\d{1,3}>)?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\b/.test(prefix);
      const hadBracket = /^(?:<\d{1,3}>)?(?:\[[^\]\r\n]{1,120}\]\s*)+/.test(prefix);
      const hadLevel = /\b(?:TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\b/i.test(prefix);
      if (!hadTimestamp && !hadBracket && !hadLevel) return false;
      prefix = prefix.replace(/^<\d{1,3}>\s*/, "");
      prefix = prefix.replace(/^(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s*/, "");
      for (let step = 0; step < 8; step += 1) {
        const before = prefix;
        prefix = prefix.replace(/^\[[^\]\r\n]{1,120}\]\s*/, "");
        prefix = prefix.replace(/^(?:TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\b\s*/i, "");
        prefix = prefix.replace(/^(?:[A-Za-z_$][\w$]*(?:[./:$-][\w$-]+)+|\d+)\s*/, "");
        if (prefix === before) break;
      }
      return /^(?:[-|:]\s*)?$/.test(prefix);
    };
    const isStandaloneMarker = (value, marker) => {
      const token = String(marker || "").toUpperCase();
      // A response body or stack trace can quote another log marker. Only the
      // first non-empty header line identifies the event, never later payload.
      return String(value ?? "").slice(0, 2048).split(/\r?\n/).filter((line) => line.trim()).slice(0, 1).some((line) => {
        const upper = line.toUpperCase();
        let at = upper.indexOf(token);
        while (at >= 0) {
          const beforeBoundary = at === 0 || /[^A-Z0-9_]/.test(upper[at - 1]);
          const end = at + token.length;
          const afterBoundary = end === upper.length || /[^A-Z0-9_]/.test(upper[end]);
          const suffix = line.slice(end).trim();
          const markerTail = !suffix || /^(?:[:.]\s*|[\[{])/.test(suffix);
          if (beforeBoundary && afterBoundary && markerTail && isLogPrefix(line.slice(0, at))) return true;
          if (line[at - 1] === "[" && line[end] === "]") {
            const bracketTail = line.slice(end + 1).trim();
            if ((!bracketTail || /^(?:[:.]\s*|[\[{])/.test(bracketTail)) && isLogPrefix(line.slice(0, at - 1))) return true;
          }
          at = upper.indexOf(token, at + token.length);
        }
        return false;
      });
    };
    // Keep the historic gorod-client transport fields for saved graph compatibility.
    // The family now accepts any named CLIENT, while its raw name stays on the page.
    const clientNames = new Map(), clientHeaders = new Map();
    const namedClient = (value) => {
      const line = String(value ?? '').slice(0, 2048).split(/\r?\n/).find(part => part.trim()) || '';
      if (clientHeaders.has(line)) return clientHeaders.get(line);
      let found = null;
      if (/CLIENT[_\s]+(?:REQUEST|RESPONSE)\b/i.test(line)) {
        for (const boundary of line.matchAll(/(?:^|[\s\]-])(?=[\p{L}\p{N}])/gu)) {
          const at = boundary.index + boundary[0].length;
          if (!isLogPrefix(line.slice(0, at))) continue;
          const match = /^([\p{L}\p{N}][\p{L}\p{N}_. \t-]{0,127}?)[_\s]+CLIENT[_\s]+(REQUEST|RESPONSE)\b/iu.exec(line.slice(at));
          if (!match || !/^(?:\s*$|\s*[:.\[{])/.test(line.slice(at + match[0].length))) continue;
          // Do not promote explanatory prose or quoted bodies into call headers.
          if (/\b(?:failed|exception|payload|body|request|response|parse)\b/i.test(match[1])) continue;
          const name = match[1].trim().toUpperCase().replace(/[_\s]+/g, ' ');
          if (!clientNames.has(name)) clientNames.set(name, `client-${clientNames.size + 1}`);
          found = {kind:`gorod-client${/^RESPONSE$/i.test(match[2]) ? '-response' : ''}`,clientKey:clientNames.get(name)};
        }
      }
      clientHeaders.set(line, found);
      return found;
    };
    const sourceClient = source => messageValues(source).map(namedClient).find(Boolean);
    const externalMarker = (value) => {
      const client = namedClient(value);
      if (client) return client.kind;
      const line = String(value ?? "").slice(0, 2048).split(/\r?\n/).find((part) => part.trim()) || "";
      const marker = /\b(GOROD[_\s]+CLIENT|PARTNER[_\s]+BACKEND|OPENAPI)[_\s]+(?:[A-Z0-9.:-]+[_\s]+)*?(REQUEST|RESPONSE)\b/i.exec(line);
      if (!marker || !isLogPrefix(line.slice(0, marker.index))) return null;
      if (/^RESPONSE$/i.test(marker[2]) && !/^(?:\s*$|\s*[:.\[{])/.test(line.slice(marker.index + marker[0].length))) return null;
      const normalized = marker[1].toUpperCase().replace(/\s+/g, "_");
      const family = normalized === "OPENAPI" ? "openapi" : normalized === "PARTNER_BACKEND" ? "partner-backend" : "gorod-client";
      return `${family}${/^RESPONSE$/i.test(marker[2]) ? "-response" : ""}`;
    };
    const isTwoLevelCacheAccess = (value) => String(value ?? "").slice(0, 2048).split(/\r?\n/).slice(0, 16).some((line) => {
      const match = /\[?LOCAL_CACHE\]\s+(?:GOT|PUT)\s+MONO(?:\s|$)/i.exec(line);
      return Boolean(match && isLogPrefix(line.slice(0, match.index)));
    });
    // Only the explicit name field is exported. Preserve readable namespaces,
    // replacing values and opaque identifiers before leaving the Graylog tab.
    const cacheSafeKey = (source) => {
      for (const value of messageValues(source)) {
        for (const line of String(value ?? "").slice(0, 2048).split(/\r?\n/).slice(0, 16)) {
          const marker = /\[?LOCAL_CACHE\]\s+(GOT|PUT)\s+MONO(?:\s|$)/i.exec(line);
          if (!marker || !isLogPrefix(line.slice(0, marker.index))) continue;
          // PUT's first opening bracket starts payload, never a key field.
          const tail = line.slice(marker.index + marker[0].length);
          const name = /^PUT$/i.test(marker[1]) ? [null, tail.split("[", 1)[0].trim()] : tail.match(/\bname\s*=\s*(?:\[([^\]\r\n]*)\]|"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s;,]+))/i);
          if (!name) return "";
          const raw = (name[1] ?? name[2] ?? name[3] ?? name[4] ?? "").trim();
          if (!raw || raw.length > 300) return raw ? "*" : "";
          return raw.split(/(:+)/).map((segment) => {
            if (!segment || /^:+$/.test(segment)) return segment;
            // Encodings, digits, UUIDs, long tokens and sensitive names are opaque.
            if (!/^[a-z][a-z_-]{0,31}$/i.test(segment) || /token|secret|password|bearer|private|credential/i.test(segment)) return "*";
            return segment;
          }).join("");
        }
      }
      return "";
    };
    const cacheOperation = (source) => messageValues(source).some((value) => String(value).slice(0,2048).split(/\r?\n/).slice(0,16).some((line) => {
      const marker = /\[?LOCAL_CACHE\]\s+PUT\s+MONO(?:\s|$)/i.exec(line);
      return marker && isLogPrefix(line.slice(0,marker.index));
    })) ? "put" : "get";
    const clientFailure = (source) => hasLevel3(source) ? messageValues(source).map((value) => globalThis.TraceClientCheckpoint?.parse(value)).find(Boolean) : null;
    const classify = (source) => {
      if (clientFailure(source)) return "outgoing-failure";
      if (messageValues(source).some(value=>kafkaEvent(value)?.kind==='kafka-consume')) return "kafka-consume";
      for (const value of messageValues(source)) {
        const kafka = kafkaEvent(value);
        if (kafka) return kafka.kind;
        if (instanceSendTopic(source, value)) return "kafka-produce";
        const broker = hasInstanceName(source) ? kafkaBrokerEvent(value) : null;
        if (broker) return broker.kind;
        const procedure = xmlProcedureEvent(value);
        if (procedure) return procedure.kind;
        if (isTwoLevelCacheAccess(value)) return "cache-access";
        const external = externalMarker(value);
        if (external) return external;
        if (isStandaloneMarker(value, "RESPONSE")) return "response";
        if (isStandaloneMarker(value, "REQUEST")) return "request";
      }
      return null;
    };
    // Shared with TraceErrorCatalog.classify() so both agree on which
    // field-name aliases (level/loglevel/sysloglevel/severitylevel) count as
    // syslog severity 3, instead of drifting into two separate definitions.
    const hasLevel3 = (...records) => globalThis.TraceErrorCatalog?.isLevel3(...records) ?? false;
    // Some loggers concatenate the URI and "RESPONSE BODY:" without a space.
    // The explicit compound marker needs no leading word boundary; otherwise
    // only BODY is removed and RESPONSE becomes part of the displayed URI.
    const beforeBody = (value) => String(value ?? "").slice(0, 2048).split(/(?:(?:REQUEST|RESPONSE)[_\s]+BODY|\bBODY)["']?\s*[:=]/i, 1)[0];
    const requestLabels = (source) => {
      const labels = {};
      const normalizedName = (name) => {
        const normalized = String(name).toLowerCase().replace(/-/g, "");
        return normalized === "action" ? "action" : normalized === "requesttype" ? "requestType" : null;
      };
      const add = (name, raw) => {
        const key = normalizedName(name);
        if (!key || raw === undefined || raw === null) return;
        const value = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
        const segment = typeof value === "string" ? value.trim() : "";
        const safe = /^[a-z][a-z_.-]{0,39}$/i.test(segment) && !/token|secret|password|bearer|private|credential/i.test(segment) ? segment : "*";
        labels[key] = labels[key] && labels[key] !== safe ? "*" : safe;
      };
      const objectLabels = (container) => {
        if (!container || typeof container !== "object" || Array.isArray(container)) return;
        for (const [name, value] of Object.entries(container)) add(name, value);
      };
      objectLabels(source);
      objectLabels(source?.fields);
      for (const [name, value] of Object.entries(source || {})) {
        if (/^(?:request|response)?headers$/i.test(name.replace(/[-_]/g, ""))) objectLabels(value);
      }
      for (const value of messageValues(source)) {
        // Inspect only an explicit headers section, before any body. JSON
        // strings and arbitrary payload text are never searched for keys.
        const headerText = beforeBody(value);
        const lines = headerText.split(/\r?\n/).slice(0, 32);
        const start = lines.findIndex((line) => /^\s*(?:\[(?:REQUEST|RESPONSE)[_\s]+HEADERS\]|(?:REQUEST|RESPONSE)[_\s]+HEADERS|\[HEADERS\]|HEADERS)\s*[:=]?/i.test(line));
        if (start < 0) continue;
        const content = lines[start].replace(/^\s*(?:\[(?:REQUEST|RESPONSE)[_\s]+HEADERS\]|(?:REQUEST|RESPONSE)[_\s]+HEADERS|\[HEADERS\]|HEADERS)\s*[:=]?\s*/i, "");
        const section = [content, ...lines.slice(start + 1)].join("\n").split(/\n\s*\n|\n\s*(?:REQUEST|RESPONSE|ERROR|DETAIL|STACKTRACE)\b(?![-_]TYPE)/i, 1)[0].trim();
        if (section.startsWith("{")) {
          // Only complete JSON objects are accepted; no regex salvage on errors.
          try { objectLabels(JSON.parse(section)); } catch {}
          continue;
        }
        const block = section.replace(/^\[(.*)\]$/s, "$1");
        for (const entry of block.split(/[,;\r\n]+/)) {
          const match = /^\s*(action|request-?type)\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|\[([^\]\r\n]*)\]|([^\s]+))\s*$/i.exec(entry);
          if (match) add(match[1], match[2] ?? match[3] ?? match[4] ?? match[5]);
        }
      }
      return labels;
    };
    // Equality is calculated before display masking. These per-build ordinals
    // reveal neither a host nor a customer ID and cannot join different builds.
    const routeOrdinals = new Map(), callOrdinals = new Map();
    const targetInput = raw => typeof raw === "string" && /^[^\s/:?#@\[\]<>]+(?::\d{1,5})?\/[^\s<>]*$/.test(raw) ? `https://${raw}` : raw;
    const targetFromTail = tail => {
      const text=String(tail||'').trim();
      const wrapped=/^(?:url|uri)\s*=\s*\[?([^\s<>"'\]]+)/i.exec(text)?.[1];
      const leading=/^[^\s<>"'\]]+/.exec(text)?.[0];
      const candidate=wrapped||leading;
      if(candidate && /^(?:https?:\/\/|\/)/i.test(targetInput(candidate)))return candidate.replace(/[),;]+$/,'');
      return text.match(/(?:https?:\/\/|\/)[^\s<>"'\]]+/i)?.[0]?.replace(/[),;]+$/,'')||'';
    };
    const routeEvidence = (raw, method, at, provenance) => {
      raw=targetInput(raw);
      if (typeof raw !== "string" || raw.length > 2048 || !/^(?:https?:\/\/|\/)/i.test(raw)) return null;
      try {
        const parsed = new URL(raw, "https://trace.invalid");
        if (!/^https?:$/.test(parsed.protocol)) return null;
        const path = parsed.pathname.replace(/%[0-9a-f]{2}/gi, value => {
          const char = String.fromCharCode(parseInt(value.slice(1), 16));
          return /[a-z0-9._~-]/i.test(char) ? char : value.toUpperCase();
        }).replace(/\/+$/, "") || "/";
        if (path === "/" || /[{}*]/.test(path)) return null;
        if (!routeOrdinals.has(path)) routeOrdinals.set(path, `route-${routeOrdinals.size + 1}`);
        const safe = httpTarget(`REQUEST [${method || "GET"}] ${raw}`);
        if (!safe) return null;
        return { routeKey:routeOrdinals.get(path), callKey:safe.callKey, url:safe.url.split(/[?#]/, 1)[0], ...(method ? {method} : {}), at, provenance };
      } catch { return null; }
    };
    const httpTarget = (value, response = false) => {
      const text = beforeBody(value);
      const requestAt = text.search(response ? /(?:^|[^A-Z])RESPONSE(?:$|[^A-Z])/i : /(?:^|[^A-Z])REQUEST(?:$|[^A-Z])/i);
      if (response && requestAt < 0) return null;
      const requestText = requestAt >= 0 ? text.slice(requestAt) : text;
      const method = requestText.match(/\[(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\]/i);
      // Headers often start with [duration] [HTTP status]. A 150 ms duration
      // must not become status 150 (and conceal a subsequent 404).
      const statusMatch = response ? [...requestText.split(/\r?\n/,1)[0].matchAll(/\[([1-5]\d{2})(?:\s+([A-Z][A-Z _-]{0,24}))?\]/gi)].at(-1) : null;
      const status = statusMatch ? `${statusMatch[1]}${statusMatch[2] ? ` ${statusMatch[2].trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toUpperCase()}` : ""}` : null;
      if (!method && !response) return null;
      const start = method ? (method.index || 0) + method[0].length : 0;
      const tail = (response ? requestText.split(/\r?\n/, 1)[0] : requestText).slice(start, start + 1024);
      const url = targetInput(targetFromTail(tail));
      if (!url) return response && status ? { status } : null;
      const maskSegment = (segment) => {
        let decoded = segment;
        try { decoded = decodeURIComponent(segment); } catch {}
        if (/^v\d+(?:\.\d+)*$/i.test(decoded)) return segment;
        if (/^\{[^}]+\}$/.test(decoded) || /^:[a-z_][a-z0-9_]*$/i.test(decoded)) return "*";
        if (/^\d+$/.test(decoded)) return "*";
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)) return "*";
        if (/^[0-9a-f]{16,}$/i.test(decoded)) return "*";
        if (decoded.length >= 20 && /\d/.test(decoded) && /^[a-z0-9._~-]+$/i.test(decoded)) return "*";
        return segment;
      };
      const absolute = /^https?:\/\//i.test(url);
      try {
        const parsed = new URL(url, "https://trace.invalid");
        if(!callOrdinals.has(url))callOrdinals.set(url, `call-${callOrdinals.size+1}`);
        const callKey=callOrdinals.get(url);
        parsed.username = "";
        parsed.password = "";
        parsed.pathname = parsed.pathname.split("/").map(maskSegment).join("/");
        const parameterNames = [...parsed.searchParams.keys()];
        parsed.search = "";
        for (const name of parameterNames) parsed.searchParams.append(name, "*");
        parsed.hash = parsed.hash ? "#*" : "";
        const safeUrl = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        return { ...(method ? { method: method[1].toUpperCase() } : {}), ...(status ? { status } : {}), url: safeUrl.slice(0, 500), callKey };
      } catch {
        if (absolute) return null;
        return { ...(method ? { method: method[1].toUpperCase() } : {}), ...(status ? { status } : {}), url: url.split("?")[0].split("#")[0].split("/").map(maskSegment).join("/").slice(0, 500) };
      }
    };
    const kafkaEvent = (value) => {
      // Kafka checkpoints are accepted only from the first non-empty log line.
      // Export the bounded Kafka topic only; offset, partition and trailing text
      // never leave the source page.
      const line = String(value ?? "").slice(0, 2048).split(/\r?\n/).find((part) => part.trim()) || "";
      const marker = /\[kafka\]\s*Message\s+(produced|consumed)\.\s*/i.exec(line);
      if (!marker || !isLogPrefix(line.slice(0, marker.index))) return null;
      const tail = line.slice(marker.index + marker[0].length, marker.index + marker[0].length + 512);
      const topic = (tail.match(/\bTopic\s+([a-z0-9._-]{1,249})\s*;/i)?.[1] || "").trim();
      if (!topic) return null;
      return { kind:/^consumed$/i.test(marker[1]) ? "kafka-consume" : "kafka-produce", topic };
    };
    const kafkaBrokerEvent = (value) => {
      // This infrastructure schema also contains a broker address and offset.
      // Ignore both and export only a bounded, display-safe topic.
      const line = String(value ?? "").slice(0, 2048).split(/\r?\n/).find((part) => part.trim()) || "";
      const marker = /\[kafka\]\s*broker\s*-\s*\[[^\]\r\n]{1,300}\]\s*topic\s*-\s*\[([a-z0-9._-]{1,249})\]\s*offset\s*-\s*\[[^\]\r\n]{1,160}\]/i.exec(line);
      if (!marker || !isLogPrefix(line.slice(0, marker.index))) return null;
      return { kind:"kafka-broker", topic:marker[1] };
    };
    const hasInstanceName = source => {
      const value = Array.isArray(source?.['instance-name']) ? source['instance-name'][0] : source?.['instance-name'];
      return typeof value === 'string' && value.trim().length > 0;
    };
    const instanceSendTopic = (source, value) => {
      // Deployment convention supplied by the user: Send is a name token,
      // not an arbitrary substring such as Sender or Resend.
      const name = String(Array.isArray(source?.["instance-name"]) ? source["instance-name"][0] : source?.["instance-name"] || "").slice(0,160);
      const tokens = name.replace(/([A-Z])([A-Z][a-z])/g,"$1 $2").replace(/([a-z0-9])([A-Z])/g,"$1 $2").split(/[^a-z0-9]+/i);
      if (!tokens.some(token=>/^send$/i.test(token))) return null;
      const line = beforeBody(value).slice(0,2048).split(/\r?\n/).find(part=>part.trim()) || "";
      const topic = kafkaBrokerEvent(line)?.topic
        || line.match(/\btopic\s*(?:[-:=]\s*)?\[([a-z0-9._-]{1,249})\]/i)?.[1]
        || line.match(/\btopic\s+([a-z0-9._-]{1,249})\s*;/i)?.[1];
      return topic ? {topic, inferred:true, provenance:"instance-send-topic"} : null;
    };
    const xmlProcedureEvent = (value) => {
      // Inspect only a bounded XML header. The payload and all attributes other
      // than numeric Document.elapsed remain in the Graylog page.
      const head = String(value ?? "").slice(0, 4096);
      const marker = /\b(xmlRequest|resultElement)\b\s*/i.exec(head);
      if (!marker || !isLogPrefix(head.slice(0, marker.index))) return null;
      const xml = head.slice(marker.index + marker[0].length);
      const documentTag = /^\s*<Document\b([^>]*)>/i.exec(xml);
      if (!documentTag) return null;
      const childText = xml.slice(documentTag[0].length, documentTag[0].length + 512);
      const child = /^\s*<(?:[A-Za-z_][A-Za-z0-9_.-]{0,63}:)?([A-Za-z_][A-Za-z0-9_.-]{0,127})(?=[\s/>])/.exec(childText);
      if (!child) return null;
      const response = /^resultElement$/i.test(marker[1]);
      let elapsedMs = null;
      if (response) {
        const elapsed = /\belapsed\s*=\s*["'](\d{0,8}(?:\.\d{1,9})?|\.\d{1,9})["']/i.exec(documentTag[1]);
        const seconds = elapsed ? Number(elapsed[1]) : NaN;
        if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400) elapsedMs = seconds * 1000;
      }
      return { kind:response ? "xml-procedure-response" : "xml-procedure-request", procedure:child[1], elapsedMs };
    };
    const rawMessages = Array.isArray(searchType.messages) ? searchType.messages : [];
    // A graph step and a Graylog row are different coordinates once the model
    // reconstructs a missing boundary. Preserve a bounded chronological row
    // number before the messages are split into pivots. This is local metadata;
    // no raw text or native identifier leaves the source tab.
    const chronologicalLogStep = new Map(rawMessages.map((item, index) => {
      const source = item?.message && typeof item.message === "object" ? item.message : item;
      const at = Date.parse(String(Array.isArray(source?.timestamp) ? source.timestamp[0] : source?.timestamp ?? ""));
      return { item, index, at:Number.isFinite(at) ? at : Number.POSITIVE_INFINITY };
    }).sort((left, right) => left.at - right.at || left.index - right.index)
      .map((entry, index) => [entry.item, index + 1]));
    // The exact trace is already in memory. Summarize its structured fields
    // here rather than executing independent server aggregations. Keep all
    // allowed fields so graph/search and grouping changes share one dataset.
    const scalar = (value) => Array.isArray(value) ? value[0] : value;
    const safeMetadata = (value, limit = 160) => {
      const text = scalar(value);
      return typeof text === "string" ? text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "";
    };
    // Cross-stream traces can use the deployment metadata names. Treat them
    // as fallbacks only: an explicit canonical field always wins, including
    // when both schemas occur in the same result page.
    const sourceService = (source) => safeMetadata(source?.["service-name"]) || safeMetadata(source?.["instance-name"]);
    const batchOrdinals=new Map();
    const batchKey=source=>{
      // Batch ownership is the instance-name infrastructure convention. A
      // similarly named field in ordinary service logs does not establish it.
      if(!hasInstanceName(source))return null;
      const value=scalar(source?.batchRequestId);
      if(!['string','number'].includes(typeof value)||!String(value)||String(value).length>256)return null;
      const key=String(value);if(!batchOrdinals.has(key))batchOrdinals.set(key,`batch-${batchOrdinals.size+1}`);
      return batchOrdinals.get(key);
    };
    const sourceBranch = (source) => safeMetadata(source?.branch) || safeMetadata(source?.["instance-version"]);
    const sourceInitUri = (source) => {
      const canonical=source?.initUri;
      if(Array.isArray(canonical)?canonical.length>0:canonical!==undefined&&canonical!==null&&canonical!=="")return canonical;
      return source?.publicUri;
    };
    const completionEvent = source => {
      for(const value of messageValues(source).slice(0,2)){
        const line=beforeBody(value).slice(0,2048).split(/\r?\n/).find(part=>part.trim())||'';
        const uri=/\buri\s*=\s*\[([^\]\r\n]{1,1500})\]/i.exec(line);
        const status=/\bresponseStatus\s*=\s*\[([1-5]\d{2})(?:\s+[A-Z ]{1,32})?\]/i.exec(line);
        const duration=/\bduration(?:Ms)?\s*=\s*\[(\d{1,8}(?:\.\d{1,6})?)\s*(?:ms)?\]/i.exec(line);
        const rawUri=uri?.[1]??scalar(source?.publicUri);
        if(!rawUri||!status||!duration||!isLogPrefix(line.slice(0,Math.min(uri?.index??Infinity,status.index,duration.index))))continue;
        const numeric=Number(duration[1]);
        const method=/\b(?:method|requestMethod)\s*=\s*\[(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\]/i.exec(line)?.[1]?.toUpperCase();
        if(numeric<=86400000 && routeEvidence(rawUri,method,null,'access-completion'))return {rawUri,status:status[1],duration:numeric,...(method?{method}:{})};
      }
      return null;
    };
    const completionRoles=new Map();
    const sourceRouteHints = (source, kind) => {
      const outgoing = kind === "openapi" || kind === "gorod-client" || kind === "partner-backend";
      const incoming = kind === "request" || (!kind && !safeMetadata(source?.["service-name"]) && safeMetadata(source?.["instance-name"]));
      const reply = kind === "response" || kind === "openapi-response" || kind === "gorod-client-response" || kind === "partner-backend-response";
      if (!outgoing && !incoming && !reply) return [];
      const stamp = Date.parse(String(scalar(source?.timestamp) ?? ""));
      if (!Number.isFinite(stamp)) return [];
      const hints = [];
      const completion=completionEvent(source);
      if(completion){
        const hint=routeEvidence(completion.rawUri,completion.method,stamp-completion.duration,'access-completion');
        if(hint)return [{...hint,direction:kind==='response'?'incoming':'outgoing-response',endAt:stamp,duration:completion.duration,status:completion.status,inferredStart:true}];
      }
      const structuredMethod = String(scalar(source?.httpMethod ?? source?.requestMethod ?? source?.method) ?? "").trim().toUpperCase();
      const validMethod = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)$/;
      for (const value of messageValues(source).slice(0, 2)) {
        const line = beforeBody(value).slice(0, 2048).split(/\r?\n/).find(part => part.trim()) || "";
        // URI-looking payloads and arbitrary prose are not HTTP evidence.
        const method = /\[(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\]|\b(?:HTTP\s+)?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s+(?=(?:https?:\/\/|\/))/i.exec(line);
        const tail = method ? line.slice(method.index + method[0].length) : reply ? line : "";
        // A labelled uri=[...] / url=[...] on the first message line is bounded
        // route evidence for an existing instance operation. It may contain a
        // deployment segment such as /middle/. Do not scan arbitrary prose or a
        // body and do not create a REQUEST solely from this diagnostic line.
        const explicit = incoming ? /\b(?:publicUri|uri|url)\s*=\s*\[([^\]\r\n]{1,1500})\]/i.exec(line)?.[1] : null;
        const raw = explicit || targetFromTail(tail);
        const hint = raw && routeEvidence(raw, method ? (method[1] || method[2]).toUpperCase() : null, stamp, "message");
        if (hint) hints.push({...hint, direction:reply ? kind === "response" ? "incoming-response" : "outgoing-response" : outgoing ? "outgoing" : "incoming"});
      }
      // A publicUri-only diagnostic enriches an existing operation of this span;
      // it does not manufacture a REQUEST or a new graph node.
      if (incoming) {
        const raw = scalar(source?.publicUri ?? source?.initUri);
        const headerMethod = messageValues(source).slice(0, 2).map(value => beforeBody(value).slice(0, 2048).split(/\r?\n/,1)[0].match(/\[(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\]/i)?.[1]).find(Boolean);
        const method = headerMethod?.toUpperCase() || (validMethod.test(structuredMethod) ? structuredMethod : null);
        const hint = routeEvidence(raw, method, stamp, source?.publicUri !== undefined ? "publicUri" : "initUri");
        if (hint) hints.push({...hint, direction:"incoming"});
      }
      return hints.slice(0, 4);
    };
    const canonicalField = (source, field) => field === "service-name"
      ? sourceService(source)
      : field === "branch" ? sourceBranch(source)
      : field === "initUri" ? sourceInitUri(source) : source?.[field];
    const fieldPivots = [...allowedGroups].map(field => {
      const counts = new Map();
      for (const item of rawMessages) {
        const source = item?.message && typeof item.message === "object" ? item.message : item;
        const raw = canonicalField(source, field);
        const values = new Set((Array.isArray(raw) ? raw.slice(0, 50) : [raw])
          .filter(value => ["string", "number", "boolean"].includes(typeof value) && String(value).length <= 2048 && String(value) !== "")
          .map(value => field === "initUri" ? httpTarget(`REQUEST [GET] ${value}`)?.url || "[скрыт]" : field === "traceId" ? "[скрыт]" : String(value)));
        for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
      }
      const values = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return { field, pivot: { total: rawMessages.length, rows: [{ key: [], values: values.map(([value, count]) => ({ key: [value, "count()"], value: count })) }] } };
    });
    const firstSource = rawMessages[0]?.message && typeof rawMessages[0].message === "object" ? rawMessages[0].message : rawMessages[0];
    const outgoingRecords=rawMessages.flatMap(item=>{
      const source=item?.message&&typeof item.message==='object'?item.message:item;
      const kind=classify(source);
      return kind==='openapi'||kind==='gorod-client'||kind==='partner-backend'?[{source,kind,hints:sourceRouteHints(source,kind)}]:[];
    });
    for(const item of rawMessages){
      const source=item?.message&&typeof item.message==='object'?item.message:item,completion=completionEvent(source);
      if(!completion)continue;
      const end=Date.parse(String(scalar(source.timestamp)||'')),start=end-completion.duration;
      const evidence=routeEvidence(completion.rawUri,completion.method,start,'access-completion');
      const owned=outgoingRecords.filter(record=>sourceService(record.source)===sourceService(source)&&String(scalar(record.source.spanId)||'')===String(scalar(source.spanId)||''));
      const matches=owned.filter(record=>record.hints.some(hint=>hint.routeKey===evidence?.routeKey&&(!completion.method||!hint.method||completion.method===hint.method)&&hint.at<=start&&hint.at<=end));
      completionRoles.set(source,matches.length===1?`${matches[0].kind}-response`:owned.length?null:'response');
    }
    for (const item of rawMessages) {
      const source = item?.message && typeof item.message === "object" ? item.message : item;
      const kind = completionRoles.has(source)?completionRoles.get(source):classify(source);
      if (kind) parts.get(kind).messages.push(item);
    }
    for (const part of parts.values()) part.total = part.messages.length;
    // Span ancestry may be logged on a plain diagnostic line rather than the
    // REQUEST/RESPONSE header. Retain only structured fields from the already
    // fetched exact trace, keyed by both service and span. This does not create
    // events or nodes from diagnostic messages, nor inspect their payloads.
    const spanStructure = new Map(), schedulerJobs = new Set();
    for (const item of rawMessages) {
      const source = item?.message && typeof item.message === "object" ? item.message : item;
      const observedJob=safeMetadata(source['job-name'] ?? source.fields?.['job-name']);
      if(observedJob&&schedulerJobs.size<20)schedulerJobs.add(observedJob);
      const service = sourceService(source);
      const spanId = String(scalar(source?.spanId) ?? "").trim();
      if (!service || !spanId) continue;
      const key = `${service}\u0000${spanId}`;
      const structure = spanStructure.get(key) || { parentSpanIds: new Set(), spanKinds: new Set(), httpRouteHints:[] };
      structure.jobNames ||= new Set();
      const jobName=safeMetadata(source['job-name'] ?? source.fields?.['job-name']);
      if(jobName&&structure.jobNames.size<8)structure.jobNames.add(jobName);
      structure.httpRouteHints.push(...sourceRouteHints(source, completionRoles.has(source)?completionRoles.get(source):classify(source)));
      structure.httpRouteHints = structure.httpRouteHints.slice(0, 24);
      for (const field of ["span.kind", "spanKind", "span_kind"]) {
        const role = String(scalar(source?.[field]) ?? "").trim().toLowerCase();
        if (["client", "server", "internal", "producer", "consumer"].includes(role)) structure.spanKinds.add(role);
      }
      for (const field of ["parentSpanId", "parent_span_id", "parent-span-id"]) {
        const parent = String(scalar(source?.[field]) ?? "").trim();
        if (parent && parent !== spanId && /^[a-z0-9_-]{1,128}$/i.test(parent) && structure.parentSpanIds.size < 16) structure.parentSpanIds.add(parent);
      }
      spanStructure.set(key, structure);
    }
    // A rendered REQUEST/RESPONSE can name an intermediate span which only
    // appears on ordinary diagnostic rows. Walk through those structured
    // parentSpanId fields until the nearest rendered ancestor is reached.
    // Payload text and timestamps are deliberately not used: ambiguous or
    // cyclic ancestry stays unresolved instead of inventing a graph edge.
    const renderedSpanKeys = new Map();
    const structuralKinds = new Set(["request", "response", "openapi", "openapi-response", "gorod-client", "gorod-client-response", "partner-backend", "partner-backend-response", "kafka-produce", "kafka-consume", "kafka-broker", "xml-procedure-request", "xml-procedure-response"]);
    for (const part of parts.values()) {
      if (!structuralKinds.has(part.kind)) continue;
      for (const item of part.messages) {
        const source = item?.message && typeof item.message === "object" ? item.message : item;
        const service = sourceService(source);
        const spanId = String(scalar(source?.spanId) ?? "").trim();
        if (!service || !spanId) continue;
        const owners = renderedSpanKeys.get(spanId) || new Set();
        owners.add(`${service}\u0000${spanId}`);
        renderedSpanKeys.set(spanId, owners);
      }
    }
    const structureKeysBySpan = new Map();
    for (const key of spanStructure.keys()) {
      const spanId = key.slice(key.indexOf("\u0000") + 1);
      const owners = structureKeysBySpan.get(spanId) || new Set();
      owners.add(key);
      structureKeysBySpan.set(spanId, owners);
    }
    for (const [originKey, structure] of spanStructure) {
      const pending = [...structure.parentSpanIds].map((spanId) => ({ spanId, depth:0 }));
      const visited = new Set();
      while (pending.length && structure.parentSpanIds.size < 16) {
        const { spanId, depth } = pending.shift();
        if (!spanId || depth >= 16 || visited.has(spanId)) continue;
        visited.add(spanId);
        const renderedOwners = renderedSpanKeys.get(spanId);
        if (renderedOwners?.size) continue;
        const hiddenOwners = structureKeysBySpan.get(spanId);
        // A repeated span ID cannot prove which diagnostic chain belongs to
        // this node, even when both candidates point to the same timestamp.
        if (hiddenOwners?.size !== 1) continue;
        const hiddenKey = [...hiddenOwners][0];
        if (hiddenKey === originKey) continue;
        const hidden = spanStructure.get(hiddenKey);
        for (const ancestorId of hidden?.parentSpanIds || []) {
          if (!structure.parentSpanIds.has(ancestorId)) structure.parentSpanIds.add(ancestorId);
          pending.push({ spanId:ancestorId, depth:depth + 1 });
        }
      }
    }
    let percentileContextStatus = "missing";
    let percentileContextRequestMs = 0;
    async function createPercentileContext() {
      if(local){percentileContextStatus='page-only';return null;}
      const uris = new Set();
      const validUri = uri => typeof uri === "string" && uri.startsWith("/") && !uri.startsWith("//") && uri.length <= 2048 && !/[\s?#*\\\u0000-\u001f]/.test(uri);
      for (const item of rawMessages) {
        const source = item?.message && typeof item.message === "object" ? item.message : item;
        // Only gateway initUri authorizes the gateway percentile dataset.
        if (sourceService(source) !== GATEWAY_SERVICE_NAME) continue;
        const canonicalUri=sourceInitUri(source);
        const values = Array.isArray(canonicalUri) ? canonicalUri : [canonicalUri];
        for (const uri of values) {
          if (uri === undefined || uri === null || uri === "") continue;
          if (!validUri(uri)) { percentileContextStatus = "invalid"; return null; }
          uris.add(uri);
        }
      }
      if (uris.size > 1) { percentileContextStatus = "ambiguous"; return null; }
      if ((Number(searchType.total_results ?? searchType.totalResults) || rawMessages.length) > rawMessages.length) {
        percentileContextStatus = "incomplete";
        if(nextPageToken||options.skipPercentileFallback)return null;
        // A capped message page cannot establish uniqueness. Resolve at most
        // two exact field values across the same trace scope and time range.
        // This is one bounded fallback, never a wildcard URI or message crawl.
        const fallbackStarted = clock();
        try {
          const fallbackQueryId = crypto.randomUUID(), fallbackTypeId = crypto.randomUUID();
          const fallback = await fetch(endpoint, {
            method:"POST", credentials:"include", cache:"no-store", headers,
            ...(requestAbort?{signal:requestAbort.signal}:{}),
            body:JSON.stringify({id:crypto.randomUUID(),parameters:[],queries:[{
              id:fallbackQueryId, query:{type:"elasticsearch",query_string:`${queryString} AND (service-name:"${GATEWAY_SERVICE_NAME}" OR (NOT _exists_:service-name AND instance-name:"${GATEWAY_SERVICE_NAME}"))`},
              timerange:{type:"absolute",from:new Date(startMs).toISOString(),to:new Date(endMs).toISOString()},
              filter:{type:"or",filters:streamIds.map(id=>({type:"stream",id}))},
              search_types:[{id:fallbackTypeId,type:"pivot",name:"trace-init-uri-context",row_groups:[{type:"values",field:"initUri",limit:2}],column_groups:[],series:[{type:"count",id:"count()",field:null}],rollup:false}]
            }]})
          });
          const fallbackData = JSON.parse(await fallback.text());
          const queryResult = fallbackData.results?.[fallbackQueryId];
          const pivot = queryResult?.search_types?.[fallbackTypeId];
          if (!fallback.ok || fallbackData.execution?.done === false || fallbackData.execution?.cancelled || fallbackData.execution?.completed_exceptionally || fallbackData.errors?.length || queryResult?.errors?.length || pivot?.errors?.length || !Array.isArray(pivot?.rows)) return null;
          const exactRows = pivot.rows.filter(row=>row?.source !== "row-inner" && Array.isArray(row?.key) && row.key.length === 1);
          if (exactRows.length > 1) { percentileContextStatus = "ambiguous"; return null; }
          if (!exactRows.length) { percentileContextStatus = "missing"; return null; }
          if (!validUri(exactRows[0].key[0])) { percentileContextStatus = "invalid"; return null; }
          uris.add(exactRows[0].key[0]);
        } catch(error) { if(requestAbort?.signal.aborted)throw error;return null; }
        finally { percentileContextRequestMs += Math.max(0, clock() - fallbackStarted); }
      }
      if (uris.size !== 1) { if (uris.size > 1) percentileContextStatus = "ambiguous"; return null; }
      const uri = [...uris][0];
      const display = httpTarget(`REQUEST [GET] ${uri}`)?.url;
      if (!display) return null;
      // Keep the exact path inside the source tab; the UI receives an opaque
      // short-lived handle so a masked wildcard never broadens a query.
      const contexts = globalThis.__advancedGraylogTraceUriContexts ||= new Map();
      const now = Date.now();
      for (const [key, entry] of contexts) if (entry.expiresAt <= now) contexts.delete(key);
      while (contexts.size >= 16) contexts.delete(contexts.keys().next().value);
      const contextToken = crypto.randomUUID();
      contexts.set(contextToken, { uri, expiresAt:now + 10 * 60 * 1000 });
      percentileContextStatus = "ready";
      return { traceId:exactTraceId, initUri:display, contextToken, masked:display !== uri };
    }
    const toPivot = (part) => {
      const grouped = new Map();
      const messageStreamIds=(item,source)=>{
        const ids=[];
        for(const raw of [item?.streamIds,item?.stream_ids,source?.streamIds,source?.stream_ids,source?.streams,source?.gl2_streams]){
          for(const value of (Array.isArray(raw)?raw:[raw])){
            if(typeof value!=='string')continue;
            const normalized=value.trim().toLowerCase();
            if(/^[a-f0-9]{24}$/.test(normalized)&&!ids.includes(normalized)&&ids.length<32)ids.push(normalized);
          }
        }
        return ids;
      };
      for (const item of part.messages) {
        const source = item?.message && typeof item.message === "object" ? item.message : item;
        const service = sourceService(source);
        const spanId = String(scalar(source?.spanId) ?? "").trim();
        if (!service || !spanId) continue;
        const key = `${service}\u0000${spanId}`;
        const structure = spanStructure.get(key);
        const existing = grouped.get(key) || { service, spanId, identityFields:new Set(), count: 0, firstSeen: null, eventTimes: [], eventLogSteps: [], durations: new Map(), durationSamples: [], responseSamples: [], requestLabels: [], parentSpanIds: new Set(structure?.parentSpanIds), spanKinds: new Set(structure?.spanKinds), streamIds:new Set(), streamMetadataComplete:true, level3Count: 0, httpRequests: [], httpResponses: [], kafkaProduces: [], kafkaConsumes: [], kafkaBrokers: [], xmlProcedures: [], cacheAccesses: [], outgoingFailures: [] };
        existing.identityFields.add(source?.__graylogIdentityField==='instance-name' ? 'instance-name' : safeMetadata(source?.['service-name']) ? 'service-name' : 'instance-name');
        existing.batchKeys ||= new Set();const batch=batchKey(source);if(batch)existing.batchKeys.add(batch);
        existing.threadKinds ||= new Set();const threadKind=globalThis.TraceApplicationGroups?.classifyThread(source.thread_name??source.threadName);if(threadKind&&threadKind!=='unknown')existing.threadKinds.add(threadKind);
        existing.jobNames ||= new Set(structure?.jobNames);
        const job=safeMetadata(source['job-name'] ?? source.fields?.['job-name']);
        if(job && existing.jobNames.size<8)existing.jobNames.add(job);
        existing.count += 1;
        const membership=messageStreamIds(item,source);
        if(!membership.length)existing.streamMetadataComplete=false;
        for(const id of membership)existing.streamIds.add(id);
        const stamp = Date.parse(String(scalar(source?.timestamp) ?? ""));
        if (Number.isFinite(stamp)) {
          existing.eventTimes.push(stamp);
          existing.eventLogSteps.push({ at:stamp, step:chronologicalLogStep.get(item) || null });
          if (existing.firstSeen === null || stamp < existing.firstSeen) existing.firstSeen = stamp;
        }
        if (["request", "response", "openapi", "openapi-response", "gorod-client", "gorod-client-response", "partner-backend", "partner-backend-response"].includes(part.kind)) {
          const labels = requestLabels(source);
          if (Object.keys(labels).length) existing.requestLabels.push({ at:Number.isFinite(stamp) ? stamp : null, ...labels });
        }
        if (part.kind === "response" || part.kind === "openapi-response" || part.kind === "gorod-client-response" || part.kind === "partner-backend-response") {
          const completion=completionEvent(source);
          let numericDuration = completion?.duration ?? NaN;
          for (const [field, factor] of [["durationMs", 1], ["duration_ms", 1], ["duration", 1], ["duration_us", .001], ["duration_ns", .000001], ["duration_s", 1000]]) {
            const rawDuration = String(scalar(source?.[field]) ?? "").trim().replace(",", ".");
            const value = rawDuration ? Number(rawDuration) * factor : NaN;
            if (Number.isFinite(value) && value >= 0) { numericDuration = value; break; }
          }
          const validDuration = Number.isFinite(numericDuration) && numericDuration >= 0;
          if (validDuration) {
            existing.durations.set(numericDuration, (existing.durations.get(numericDuration) || 0) + 1);
            if (Number.isFinite(stamp)) existing.durationSamples.push({ at: stamp, value: numericDuration });
          }
          const level3 = hasLevel3(source, item);
          if (level3) existing.level3Count += 1;
          const completionHint=completion&&routeEvidence(completion.rawUri,completion.method,stamp-completion.duration,'access-completion');
          const target = completionHint ? {url:completionHint.url,status:completion.status,...(completion.method?{method:completion.method}:{}),completionObserved:true}
            : messageValues(source).map(value => httpTarget(value, true)).find(Boolean) || null;
          const clientKey = part.kind === 'gorod-client-response' ? sourceClient(source)?.clientKey : null;
          if (target || clientKey) existing.httpResponses.push({ ...target, ...(clientKey ? {clientKey} : {}), at: Number.isFinite(stamp) ? stamp : null });
          existing.responseSamples.push({ at: Number.isFinite(stamp) ? stamp : null, duration: validDuration ? numericDuration : null, level3, ...(target || {}), ...(clientKey ? {clientKey} : {}) });
        }
        if (part.kind === "request" || part.kind === "openapi" || part.kind === "gorod-client" || part.kind === "partner-backend") {
          const target = messageValues(source).map(value => httpTarget(value)).find(Boolean)
            || (structure?.httpRouteHints || []).find(hint => hint.direction === (part.kind === "request" ? "incoming" : "outgoing") && hint.at === stamp)
            || null;
          if (part.kind !== "request") {
            const clientKey = part.kind === 'gorod-client' ? sourceClient(source)?.clientKey : null;
            existing.httpRequests.push(target
              ? { ...target, ...(clientKey ? {clientKey} : {}), count:1, at:Number.isFinite(stamp) ? stamp : null }
              : { ...(clientKey ? {clientKey} : {}), at:Number.isFinite(stamp) ? stamp : null });
          } else if (target) {
            const existingTarget = existing.httpRequests.find((item) => item.method === target.method && item.url === target.url);
            const at = Number.isFinite(stamp) ? stamp : null;
            if (existingTarget) {
              if(existingTarget.callKey!==target.callKey)delete existingTarget.callKey;
              existingTarget.count += 1;
              existingTarget.times.push(at);
            } else existing.httpRequests.push({ ...target, count:1, at, times:[at] });
          }
        }
        if (part.kind === "kafka-produce") {
          const event = messageValues(source).map(kafkaEvent).find((item) => item?.kind === "kafka-produce")
            || messageValues(source).map(value=>instanceSendTopic(source,value)).find(Boolean);
          if (event) existing.kafkaProduces.push({ topic:event.topic, at:Number.isFinite(stamp) ? stamp : null,
            ...(event.inferred ? {inferred:true,provenance:event.provenance} : {}) });
        }
        if (part.kind === "kafka-consume") {
          const event = messageValues(source).map(kafkaEvent).find((item) => item?.kind === "kafka-consume");
          if (event) existing.kafkaConsumes.push({ topic:event.topic, at:Number.isFinite(stamp) ? stamp : null });
        }
        if (part.kind === "kafka-broker") {
          const event = messageValues(source).map(kafkaBrokerEvent).find(Boolean);
          if (event) existing.kafkaBrokers.push({ topic:event.topic, at:Number.isFinite(stamp) ? stamp : null,
            ...(hasInstanceName(source)?{directionHint:batch?'consume':'produce',directionInferred:true}:{}) });
        }
        if (part.kind === "xml-procedure-request" || part.kind === "xml-procedure-response") {
          const event = messageValues(source).map(xmlProcedureEvent).find((item) => item?.kind === part.kind);
          if (event) {
            const at = Number.isFinite(stamp) ? stamp : null;
            existing.xmlProcedures.push({ procedure:event.procedure, at, ...(event.elapsedMs === null ? {} : {elapsedMs:event.elapsedMs}) });
            if (part.kind === "xml-procedure-response") {
              existing.responseSamples.push({ procedure:event.procedure, at, duration:event.elapsedMs });
              if (event.elapsedMs !== null) existing.durationSamples.push({at, value:event.elapsedMs});
            }
          }
        }
        if (part.kind === "cache-access") existing.cacheAccesses.push({ kind:"local-redis", operation:cacheOperation(source), at:Number.isFinite(stamp) ? stamp : null, safeKey:cacheSafeKey(source) });
        if (part.kind === "outgoing-failure") {
          const failure = clientFailure(source);
          const target = failure && httpTarget(`REQUEST [${failure.method}] ${failure.target}`);
          if (target) existing.outgoingFailures.push({ method:target.method, url:target.url, at:Number.isFinite(stamp) ? stamp : null, failureType:"WebClientRequestException", level3:true });
        }
        grouped.set(key, existing);
      }
      const rows = [...grouped.values()].map((group) => {
        const values = [{ key: [group.spanId, "count()"], value: group.count }];
        if (group.firstSeen !== null) values.push({ key: [group.spanId, "min(timestamp)"], value: group.firstSeen });
        for (const [duration, count] of group.durations) values.push({ key: [group.spanId, String(duration), "count()"], value: count });
        group.eventTimes.sort((left, right) => left - right);
        group.durationSamples.sort((left, right) => (left.at ?? Number.MAX_SAFE_INTEGER) - (right.at ?? Number.MAX_SAFE_INTEGER));
        return {
          source: "row-leaf", key: [group.service], values, eventTimes: group.eventTimes,
          eventLogSteps: group.eventLogSteps.sort((left,right)=>left.at-right.at||Number(left.step)-Number(right.step)).map(item=>item.step),
          durationSamples: group.durationSamples.map((sample) => sample.value),
          level3Count: group.level3Count,
          responseSamples: group.responseSamples.sort((left, right) => (left.at ?? Number.MAX_SAFE_INTEGER) - (right.at ?? Number.MAX_SAFE_INTEGER)),
          parentSpanIds: [...group.parentSpanIds],
          spanKinds: [...group.spanKinds],
          identityFields: [...group.identityFields],
          httpRouteHints: spanStructure.get(`${group.service}\u0000${group.spanId}`)?.httpRouteHints || [],
          batchKeys: [...group.batchKeys],
          threadKinds: [...group.threadKinds],
          jobNames: [...group.jobNames],
          streamIds: [...group.streamIds],
          streamMetadataComplete: group.streamMetadataComplete,
          requestLabels: group.requestLabels.sort((left, right) => (left.at ?? Number.MAX_SAFE_INTEGER) - (right.at ?? Number.MAX_SAFE_INTEGER)),
          httpRequests: group.httpRequests,
          httpResponses: group.httpResponses,
          kafkaProduces: group.kafkaProduces.sort((left, right) => (left.at ?? Number.MAX_SAFE_INTEGER) - (right.at ?? Number.MAX_SAFE_INTEGER)).slice(0, 10),
          kafkaConsumes: group.kafkaConsumes.sort((left, right) => (left.at ?? Number.MAX_SAFE_INTEGER) - (right.at ?? Number.MAX_SAFE_INTEGER)).slice(0, 10),
          kafkaBrokers: group.kafkaBrokers.sort((left, right) => (left.at ?? Number.MAX_SAFE_INTEGER) - (right.at ?? Number.MAX_SAFE_INTEGER)).slice(0, 40),
          xmlProcedures: group.xmlProcedures.sort((left, right) => (left.at ?? Number.MAX_SAFE_INTEGER) - (right.at ?? Number.MAX_SAFE_INTEGER)).slice(0, 40),
          cacheAccesses: group.cacheAccesses.sort((left, right) => (left.at ?? Number.MAX_SAFE_INTEGER) - (right.at ?? Number.MAX_SAFE_INTEGER)).slice(0, 10),
          outgoingFailures: group.outgoingFailures
        };
      });
      return { total: part.total, rows };
    };
    const pivots = Object.fromEntries([...parts.values()].map((part) => [part.kind, toPivot(part)]));
    pivots.request.schedulerJobs=[...schedulerJobs];
    const total = Number(searchType.total_results ?? searchType.totalResults) || rawMessages.length;
    const classified = [...parts.values()].reduce((sum, part) => sum + part.total, 0);
    return {
      requestPivot: pivots.request, responsePivot: pivots.response,
      openApiPivot: pivots.openapi, openApiResponsePivot: pivots["openapi-response"],
      gorodClientPivot: pivots["gorod-client"], gorodClientResponsePivot: pivots["gorod-client-response"],
      partnerBackendPivot: pivots["partner-backend"], partnerBackendResponsePivot: pivots["partner-backend-response"],
      kafkaProducePivot: pivots["kafka-produce"],
      kafkaConsumePivot: pivots["kafka-consume"],
      kafkaBrokerPivot: pivots["kafka-broker"],
      xmlProcedureRequestPivot: pivots["xml-procedure-request"],
      xmlProcedureResponsePivot: pivots["xml-procedure-response"],
      cacheAccessPivot: pivots["cache-access"],
      outgoingFailurePivot: pivots["outgoing-failure"],
      percentileContext: await createPercentileContext(),
      // Otobrazhaemyy initUri - eto NE percentileContext. Tot trebuet
      // dokazannoy edinstvennosti URI i dlya razbora tekushchey stranicy ne
      // vychislyaetsya voobshche. Zdes perechislyayutsya nablyudennye initUri
      // gateway, chtoby zhurnal mog pokazat, kakaya eto ruchka.
      // KRITICHNO: naruzhu uhodit tolko maskirovannyy vid (httpTarget), tot
      // zhe, chto u percentileContext. Syroy initUri soderzhit identifikatory
      // (/v1/clients/999999) и iz stranicy ne vyhodit. Dlya rascheta
      // protsentiley eti znacheniya ispolzovat nelzya.
      observedInitUris: (() => {
        const masked = new Set();
        for (const item of rawMessages) {
          const source = item?.message && typeof item.message === "object" ? item.message : item;
          if (sourceService(source) !== GATEWAY_SERVICE_NAME) continue;
          const canonical = sourceInitUri(source);
          for (const uri of (Array.isArray(canonical) ? canonical : [canonical])) {
            if (typeof uri !== "string" || !uri.startsWith("/") || uri.startsWith("//") || uri.length > 2048) continue;
            if (/[\s?#*\\\u0000-\u001f]/.test(uri)) continue;
            const display = httpTarget(`REQUEST [GET] ${uri}`)?.url;
            if (display) masked.add(display);
            if (masked.size >= 5) break;
          }
          if (masked.size >= 5) break;
        }
        return [...masked];
      })(),
      percentileContextStatus,
      fieldPivots,
      fieldSummarySource: "loaded-messages",
      errorAnalysis: await (globalThis.TraceErrors?.analyzeAsync || globalThis.TraceErrors?.analyze)?.(rawMessages.map((item) => {
        const source = item?.message && typeof item.message === "object" ? item.message : item;
        if (!clientFailure(source) || source.exceptionType) return item;
        const enriched = { ...source, exceptionType:"org.springframework.web.reactive.function.client.WebClientRequestException" };
        return source === item ? enriched : { ...item, message:enriched };
      }), local&&(localPage.truncated||localPage.contentTruncated)?total+1:total, {signal:options.signal||requestAbort?.signal}) || { available:false, groups:[] },
      timings: {
        // Includes connection, server execution and response-body transfer.
        requestMs: Math.max(0, Math.round(responseReceived - requestStarted + percentileContextRequestMs)),
        parseMs: Math.max(0, Math.round(parsedAt - responseReceived)),
        processingMs: Math.max(0, Math.round(clock() - parsedAt - percentileContextRequestMs))
      },
      total, returned: rawMessages.length, classified,...(pageSession?{nextPageToken,loaded:rawMessages.length,pageSize:pageSession.pageSize}:{}),
      availableFields: firstSource && typeof firstSource === "object" ? Object.keys(firstSource).sort().slice(0, 40) : [],
      contentTruncated:local&&localPage.contentTruncated===true,
      truncated: local?Boolean(localPage.truncated)||total>rawMessages.length||localPage.messages.length>localLimit:total > rawMessages.length, searchMode: local?(localPage.complete===true?"native-complete":localPage.nativePayload===true?"native-first-page":"current-page"):"single-message-list",...(local?{scope:localPage.nativePayload===true?'graylog-native-search':'current-page'}:{scope:'configured-streams'})
    };
  } catch (error) { if(ownsPageSession&&pageSessionToken)dropPage(pageSessionToken);return { error: requestAbort?.signal.aborted?(explicitRun?.cancelled?'Операция остановлена.':'Истекло время ожидания Graylog (65 с). Повторите разбор позже.'):error?.message || String(error) }; }
  finally {if(requestTimeout!==null)clearTimeout(requestTimeout);if(ownsPageSession&&pageSession)pageSession.busy=false;if(explicitRun){explicitRun.finished=true;if(explicitRuns.get(explicitRunId)===explicitRun)explicitRuns.delete(explicitRunId);}}
}

  async function fetchNativeTraceInGraylog(queryString,descriptor,businessRules=[],options={}) {
    const Native=globalThis.GraylogNativeSearch;
    const sessions=globalThis.__advancedGraylogNativeTraceSessions ||= new Map();
    const drop=token=>{
      const session=sessions.get(token);
      if(session?.expiryTimer!==undefined&&typeof clearTimeout==='function')clearTimeout(session.expiryTimer);
      session?.messages?.splice?.(0);session?.seenIds?.clear?.();sessions.delete(token);
    };
    const arm=(token,session)=>{
      if(session.expiryTimer!==undefined&&typeof clearTimeout==='function')clearTimeout(session.expiryTimer);
      if(typeof setTimeout==='function'){
        session.expiryTimer=setTimeout(()=>{if(sessions.get(token)===session&&!session.busy)drop(token);},120000);
        session.expiryTimer?.unref?.();
      }
    };
    let token='',session=null,abort=null,timeout=null,owns=false,acceptedSeed=false;
    try{
      if(!Native?.exactTrace||!Native?.validate||!Native?.pagePayload||!Native?.result)throw new Error('Модуль штатного поиска Graylog не загружен');
      const exactTraceId=Native.exactTrace(queryString);
      if(!exactTraceId)throw new Error('Блок-схема доступна только для точного traceId');
      if(!Native.validate(descriptor,{sourceUrl:location.href,traceId:exactTraceId})||descriptor.offset!==0)throw new Error('Контекст штатного поиска Graylog устарел. Повторите поиск traceId.');
      const endpoint=new URL(descriptor.endpoint);
      if(endpoint.origin!==location.origin||!/\/api\/views\/search\/[^/]{8,128}\/execute(?:\/sync)?\/?$/i.test(endpoint.pathname))throw new Error('Некорректный endpoint штатного поиска Graylog');
      const now=Date.now();
      for(const [oldToken,oldSession] of sessions)if(!oldSession.busy&&oldSession.expiresAt<=now)drop(oldToken);
      const scope=JSON.stringify([location.origin,endpoint.pathname,descriptor.searchTypeId,descriptor.startMs,descriptor.endMs,exactTraceId]);
      if(options.pageToken!==undefined){
        token=String(options.pageToken||'');session=sessions.get(token);
        if(!/^[a-z0-9_-]{1,128}$/i.test(token)||!session||session.scope!==scope||session.expiresAt<=now||session.busy)throw new Error('Продолжение штатного поиска устарело. Повторите поиск traceId.');
      }else{
        if(sessions.size>=2){const removable=[...sessions].find(([,value])=>!value.busy);if(removable)drop(removable[0]);else throw new Error('Уже выполняется загрузка trace. Дождитесь завершения.');}
        const requestedRunId=typeof options.runId==='string'&&/^[a-z0-9_-]{1,128}$/i.test(options.runId)?options.runId:'';
        token=requestedRunId||crypto.randomUUID();
        if(requestedRunId){
          const runs=globalThis.__advancedGraylogExplicitTraceRuns ||= new Map();
          const run=runs.get(requestedRunId);
          if(run?.cancelled){releaseExplicitTraceRunInGraylog(requestedRunId);return {error:'Операция остановлена.'};}
          if(!run)runs.set(requestedRunId,{abort:null,cancelled:false,finished:false,prepared:false});
        }
        if(sessions.has(token))throw new Error('Эта операция уже выполняется');
        session={scope,descriptor,messages:[],seenIds:new Set(),offset:0,total:null,pageSize:Math.max(1,Math.min(200,Math.floor(Number(descriptor.limit))||50)),expiresAt:now+120000,busy:false,expiryTimer:undefined};
        const seed=options.seedPage;
        if(seed!==undefined){
          if(!seed||seed.scope!=='current-page'||seed.nativePayload!==true||!Array.isArray(seed.messages))throw new Error('Некорректная первая страница штатного поиска Graylog');
          const seedTotal=Number(seed.nativeTotal),seedMessages=seed.messages.slice(0,200);
          if(!Number.isSafeInteger(seedTotal)||seedTotal<seedMessages.length||seedMessages.length>session.pageSize)throw new Error('Некорректный размер первой страницы штатного поиска Graylog');
          session.total=seedTotal;
          for(const item of seedMessages){
            const source=item?.message&&typeof item.message==='object'?item.message:item;
            const scalar=value=>Array.isArray(value)&&value.length===1?value[0]:value;
            const traces=[source?.traceId,source?.trace_id].filter(value=>value!==undefined).map(scalar);
            if(!traces.length||traces.some(value=>value!==exactTraceId))throw new Error('Первая страница содержит сообщения другого traceId');
            const id=scalar(source?._id??item?.id),index=scalar(item?.index??source?._index);
            if(typeof id!=='string'||!id||id.length>256||typeof index!=='string'||!index||index.length>256)throw new Error('Первая страница не содержит native identity сообщения');
            const key=JSON.stringify([id,index]);if(session.seenIds.has(key))throw new Error('Первая страница содержит повторяющиеся сообщения');session.seenIds.add(key);
            session.messages.push(item);
          }
          session.offset=session.messages.length;
          acceptedSeed=true;
        }
        sessions.set(token,session);
      }
      session.busy=true;session.expiresAt=now+120000;owns=true;arm(token,session);
      const cap=200,remaining=Math.max(0,Math.min(session.total??cap,cap)-session.messages.length);
      let requestMs=0,parseMs=0,requestOffset=session.offset,requestLimit=Math.min(session.pageSize,remaining),didRequest=false,pollCount=0;
      if(!acceptedSeed&&requestLimit>0&&(session.total===null||session.messages.length<session.total)){
        const payload=Native.pagePayload(session.descriptor,exactTraceId,requestOffset,requestLimit);
        if(!payload)throw new Error('Не удалось подготовить продолжение штатного поиска Graylog');
        const headers={Accept:'application/json','Content-Type':'application/json','X-Requested-By':'graylog-trace-diagram'};
        const storedSession=globalThis.localStorage?.getItem('sessionId')||'';let sessionId=storedSession;
        try{sessionId=JSON.parse(storedSession);}catch{}
        if(typeof sessionId==='string'&&sessionId)headers.Authorization=`Basic ${btoa(`${sessionId}:session`)}`;
        abort=typeof AbortController==='function'?new AbortController():null;
        if(abort){session.abort=abort;session.cancelled=false;session.timedOut=false;const run=globalThis.__advancedGraylogExplicitTraceRuns?.get?.(token);if(run){run.abort=abort;if(run.cancelled){session.cancelled=true;abort.abort();}}timeout=setTimeout(()=>{session.timedOut=true;abort.abort();},65000);timeout?.unref?.();}
        const clock=()=>globalThis.performance?.now?.()??Date.now();didRequest=true;
        const own=(object,key)=>object&&typeof object==='object'?Object.getOwnPropertyDescriptor(object,key)?.value:undefined;
        const parseResponse=async response=>{
          const started=clock(),text=await response.text();requestMs+=Math.max(0,Math.round(clock()-started));
          const parseStarted=clock();let data;try{data=text?JSON.parse(text):{};}catch{throw new Error(`Graylog вернул не JSON: HTTP ${response.status}`);}parseMs+=Math.max(0,Math.round(clock()-parseStarted));return data;
        };
        const resultFrom=data=>Native.result(data,session.descriptor.searchTypeId)
          ||Native.result(own(data,'result'),session.descriptor.searchTypeId)
          ||Native.result(own(data,'search_result'),session.descriptor.searchTypeId);
        const failed=data=>{
          const execution=own(data,'execution'),state=String(own(data,'state')||own(data,'status')||own(execution,'state')||own(execution,'status')||'').toUpperCase();
          return own(data,'cancelled')===true||own(data,'completed_exceptionally')===true||own(execution,'cancelled')===true
            ||own(execution,'completed_exceptionally')===true||Array.isArray(own(data,'errors'))&&own(data,'errors').length>0
            ||['FAILED','FAILURE','ERROR','CANCELLED','CANCELED'].includes(state);
        };
        const completeWithoutResult=data=>{
          const execution=own(data,'execution'),state=String(own(data,'state')||own(data,'status')||own(execution,'state')||own(execution,'status')||'').toUpperCase();
          return own(data,'done')===true||own(execution,'done')===true||['DONE','COMPLETED','COMPLETE','FINISHED'].includes(state);
        };
        const executionId=data=>{
          const execution=own(data,'execution'),groups=[
            [own(data,'execution_id'),own(data,'executionId'),own(execution,'id')],
            [own(data,'search_id'),own(data,'searchId')]
          ];
          for(const group of groups){
            const present=group.filter(value=>value!==undefined&&value!==null);
            if(!present.length)continue;
            if(present.some(value=>typeof value!=='string'||!/^[a-z0-9_-]{8,128}$/i.test(value)))return '';
            const unique=[...new Set(present)];return unique.length===1?unique[0]:'';
          }
          return '';
        };
        const waitForPoll=()=>new Promise((resolve,reject)=>{
          if(abort?.signal.aborted){reject(new Error('aborted'));return;}
          const timer=setTimeout(done,200);
          function done(){abort?.signal.removeEventListener('abort',cancel);resolve();}
          function cancel(){clearTimeout(timer);reject(new Error('aborted'));}
          abort?.signal.addEventListener('abort',cancel,{once:true});
        });
        const request=async(url,init)=>{
          const started=clock(),response=await fetch(url,{credentials:'include',cache:'no-store',redirect:'error',...(abort?{signal:abort.signal}:{}),headers,...init});
          requestMs+=Math.max(0,Math.round(clock()-started));
          const data=await parseResponse(response);
          if(!response.ok)throw new Error(`Штатный поиск Graylog завершился с HTTP ${response.status}`);
          return data;
        };
        let data=await request(session.descriptor.endpoint,{method:'POST',body:JSON.stringify(payload)});
        if(failed(data))throw new Error('Graylog вернул ошибку выполнения штатного поиска');
        let searchType=resultFrom(data);
        if(!searchType){
          const id=executionId(data);
          if(!id)throw new Error(completeWithoutResult(data)?'Graylog завершил штатный поиск без сообщений':'Graylog не вернул безопасный идентификатор выполнения штатного поиска');
          const executePath=new URL(session.descriptor.endpoint).pathname;
          const statusPrefixIndex=executePath.toLowerCase().lastIndexOf('/api/views/search/');
          if(statusPrefixIndex<0)throw new Error('Некорректный endpoint штатного поиска Graylog');
          const statusEndpoint=new URL(`${executePath.slice(0,statusPrefixIndex)}/api/views/search/status/${encodeURIComponent(id)}`,location.origin);
          if(statusEndpoint.origin!==location.origin)throw new Error('Некорректный endpoint статуса Graylog');
          while(!searchType&&pollCount<300){
            await waitForPoll();pollCount++;
            data=await request(statusEndpoint.toString(),{method:'GET'});
            if(failed(data))throw new Error('Graylog вернул ошибку выполнения штатного поиска');
            searchType=resultFrom(data);
            if(!searchType&&completeWithoutResult(data))throw new Error('Graylog завершил штатный поиск без сообщений');
          }
          if(!searchType)throw new Error('Graylog не завершил штатный поиск за отведённое время');
        }
        if(!searchType||searchType.errors?.length)throw new Error('Graylog не вернул сообщения штатного search type');
        const total=Number(searchType.total_results??searchType.totalResults),batch=searchType.messages.slice(0,requestLimit);
        if(!Number.isSafeInteger(total)||total<0||total<requestOffset+batch.length)throw new Error('Graylog вернул некорректное число сообщений');
        if(session.total!==null&&session.total!==total)throw new Error('Выдача Graylog изменилась во время загрузки. Повторите поиск.');
        session.total=total;
        for(const item of batch){
          const source=item?.message&&typeof item.message==='object'?item.message:item;
          const scalar=value=>Array.isArray(value)&&value.length===1?value[0]:value;
          const traces=[source?.traceId,source?.trace_id].filter(value=>value!==undefined).map(scalar);
          if(!traces.length||traces.some(value=>value!==exactTraceId))throw new Error('Graylog вернул сообщение другого traceId');
          const id=scalar(source?._id??item?.id),index=scalar(item?.index??source?._index);
          if(typeof id!=='string'||!id||id.length>256||typeof index!=='string'||!index||index.length>256)throw new Error('Graylog не вернул native identity сообщения');
          const key=JSON.stringify([id,index]);if(session.seenIds.has(key))throw new Error('Выдача Graylog изменилась: сообщения между страницами повторяются. Повторите поиск.');session.seenIds.add(key);
          session.messages.push(item);
        }
        session.offset+=batch.length;
      }
      const total=session.total??session.messages.length,cumulative=session.messages.slice(0,cap);
      const more=cumulative.length<Math.min(total,cap)&&(acceptedSeed||(didRequest&&session.offset>requestOffset));
      const processed=await fetchTraceDiagramInGraylog(`traceId:"${exactTraceId}"`,0,0,[],cap,[],25,businessRules,{localPage:{scope:'current-page',messages:cumulative,nativePayload:true,nativeTotal:total,truncated:total>cumulative.length},skipPercentileFallback:true});
      if(processed?.error)throw new Error(processed.error);
      if(!more){drop(token);releaseExplicitTraceRunInGraylog(token);}else{session.busy=false;session.expiresAt=Date.now()+120000;arm(token,session);}
      owns=false;
      return {...processed,total,returned:cumulative.length,loaded:cumulative.length,pageSize:session.pageSize,nextPageToken:more?token:null,truncated:total>cumulative.length,searchMode:'graylog-native-search',scope:'graylog-native-search',timings:{...(processed.timings||{}),requestMs,parseMs},networkRequest:didRequest?{method:'POST',kind:'native-search-execution',offset:requestOffset,limit:requestLimit,pollCount}:null};
    }catch(error){if(owns&&token)drop(token);if(token)releaseExplicitTraceRunInGraylog(token);return {error:abort?.signal?.aborted?(session?.cancelled?'Загрузка штатного поиска отменена.':'Истекло время ожидания Graylog (65 с). Повторите разбор позже.'):error?.message||String(error)};}
    finally{if(timeout!==null)clearTimeout(timeout);if(session?.abort===abort)session.abort=null;if(owns&&session)session.busy=false;}
  }

  function cancelNativeTraceInGraylog(pageToken){
    if(typeof pageToken!=='string'||!/^[a-z0-9_-]{1,128}$/i.test(pageToken))return false;
    const sessions=globalThis.__advancedGraylogNativeTraceSessions,session=sessions?.get?.(pageToken);if(!session)return false;
    session.cancelled=true;session.abort?.abort?.();
    if(session.expiryTimer!==undefined&&typeof clearTimeout==='function')clearTimeout(session.expiryTimer);
    session.messages.splice(0);session.seenIds.clear();sessions.delete(pageToken);return true;
  }

  function cancelExplicitTraceRunInGraylog(runId){
    if(typeof runId!=='string'||!/^[a-z0-9_-]{1,128}$/i.test(runId))return false;
    let cancelled=cancelNativeTraceInGraylog(runId);
    const runs=globalThis.__advancedGraylogExplicitTraceRuns,run=runs?.get?.(runId);
    if(run&&!run.finished){run.cancelled=true;run.abort?.abort?.();cancelled=true;}
    return cancelled;
  }

  function prepareExplicitTraceRunInGraylog(runId){
    if(typeof runId!=='string'||!/^[a-z0-9_-]{1,128}$/i.test(runId))return false;
    const runs=globalThis.__advancedGraylogExplicitTraceRuns ||= new Map(),existing=runs.get(runId);
    if(existing&&!existing.finished)return false;
    if(runs.size>=4){for(const [id,run] of runs)if(run.finished||run.cancelled)runs.delete(id);}
    if(runs.size>=4)return false;
    runs.set(runId,{abort:null,cancelled:false,finished:false,prepared:true});return true;
  }

  function releaseExplicitTraceRunInGraylog(runId){
    if(typeof runId!=='string'||!/^[a-z0-9_-]{1,128}$/i.test(runId))return false;
    const runs=globalThis.__advancedGraylogExplicitTraceRuns,run=runs?.get?.(runId);if(!run)return false;
    run.finished=true;runs.delete(runId);return true;
  }

  function processPageTraceInGraylog(queryString,localPage,businessRules=[],options={}) {
    return fetchTraceDiagramInGraylog(queryString,0,0,[],200,[],25,businessRules,{...options,localPage});
  }
  function cancelPageTraceInGraylog(pageToken) {
    if(typeof pageToken!=='string'||!/^[a-z0-9_-]{1,128}$/i.test(pageToken))return false;
    const sessions=globalThis.__advancedGraylogTracePageSessions;
    const session=sessions?.get?.(pageToken);
    if(!session)return false;
    if(session.expiryTimer!==undefined&&typeof clearTimeout==='function')clearTimeout(session.expiryTimer);
    session.messages.length=0;session.seenIds?.clear?.();sessions.delete(pageToken);return true;
  }
  const api = Object.freeze({ fetchTraceDiagramInGraylog,fetchNativeTraceInGraylog,processPageTraceInGraylog,cancelPageTraceInGraylog,cancelNativeTraceInGraylog,cancelExplicitTraceRunInGraylog,prepareExplicitTraceRunInGraylog,releaseExplicitTraceRunInGraylog });
  root.GraylogTraceFetch = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
