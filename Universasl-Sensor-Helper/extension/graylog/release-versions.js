// This function is injected into the active Graylog search tab; keep all dependencies local.
async function fetchReleaseVersionsInGraylog(streamIds, startMs, endMs) {
  try {
    if (!Array.isArray(streamIds) || streamIds.some(id => typeof id !== 'string' || !id.trim()) ||
        !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new Error('Некорректные streams или период инвентаризации версий');
    }
    const current = new URL(location.href);
    const searchIndex = current.pathname.toLowerCase().lastIndexOf('/search');
    if (searchIndex < 0) throw new Error('Текущая вкладка не является страницей поиска Graylog');
    const beforeSearch = current.pathname.slice(0, searchIndex);
    const streamRouteIndex = beforeSearch.toLowerCase().lastIndexOf('/streams/');
    const basePath = streamRouteIndex >= 0 ? beforeSearch.slice(0, streamRouteIndex) : beforeSearch;
    const endpoint = new URL(`${basePath}/api/views/search/sync?timeout=60000`, current.origin).toString();
    const searchId = crypto.randomUUID(), queryId = crypto.randomUUID();
    const versionsId = crypto.randomUUID(), totalId = crypto.randomUUID();
    const limit = 100;
    const pivot = (id, name, fields) => ({
      id, type: 'pivot', name, row_groups: [],
      column_groups: fields.map(field => ({ type: 'values', field, limit })),
      series: [{ type: 'count', id: 'count()', field: null }], rollup: false
    });
    const query = {
      id: queryId, query: { type: 'elasticsearch', query_string: '*' },
      timerange: { type: 'absolute', from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString() },
      filter: { type: 'or', filters: streamIds.map(id => ({ type: 'stream', id })) },
      search_types: [pivot(versionsId, 'release-version-inventory', ['service-name', 'branch']), pivot(totalId, 'release-version-inventory-total', [])]
    };
    // The default schema keeps its existing query. Three disjoint variants
    // cover only rows where a canonical field is absent, so aliases never
    // overwrite or double-count service-name/branch values.
    const aliases = [
      { fields:['service-name','instance-version'], suffix:'service-instance-version', filter:'_exists_:service-name AND NOT _exists_:branch AND _exists_:instance-version' },
      { fields:['instance-name','branch'], suffix:'instance-service-branch', filter:'NOT _exists_:service-name AND _exists_:instance-name AND _exists_:branch' },
      { fields:['instance-name','instance-version'], suffix:'instance-service-version', filter:'NOT _exists_:service-name AND _exists_:instance-name AND NOT _exists_:branch AND _exists_:instance-version' }
    ].map(item => {
      const id=crypto.randomUUID(), typeId=crypto.randomUUID();
      return {...item,id,typeId,query:{
        id, query:{type:'elasticsearch',query_string:item.filter},
        timerange:query.timerange, filter:query.filter,
        search_types:[pivot(typeId,`release-version-inventory-${item.suffix}`,item.fields)]
      }};
    });
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-By': 'graylog-release-monitor' };
    const storedSession = globalThis.localStorage?.getItem('sessionId') || '';
    let sessionId = storedSession;
    try { sessionId = JSON.parse(storedSession); } catch {}
    if (typeof sessionId === 'string' && sessionId) headers.Authorization = `Basic ${btoa(`${sessionId}:session`)}`;
    const response = await fetch(endpoint, {
      method: 'POST', credentials: 'include', cache: 'no-store', headers,
      body: JSON.stringify({ id: searchId, parameters: [], queries: [query, ...aliases.map(item=>item.query)] })
    });
    const responseText = await response.text();
    let data;
    try { data = responseText ? JSON.parse(responseText) : {}; }
    catch { throw new Error(`Graylog вернул не JSON: HTTP ${response.status}`); }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ошибка инвентаризации версий Graylog`);

    const queryResult = data?.results?.[queryId];
    const versions = queryResult?.search_types?.[versionsId], total = queryResult?.search_types?.[totalId];
    const hasErrors = value => Boolean(value && (Array.isArray(value) ? value.length : typeof value === 'object' ? Object.keys(value).length : true));
    const failed = item => !item || hasErrors(item.errors) || hasErrors(item.error) || item.execution?.completed_exceptionally === true || item.execution?.cancelled === true || item.execution?.done === false;
    let incomplete = [data, queryResult, versions, total, ...aliases.flatMap(item=>[data?.results?.[item.id],data?.results?.[item.id]?.search_types?.[item.typeId]])].some(failed);
    const countValue = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    const dimension = value => {
      if(typeof value !== 'string')return '';
      const clean=value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,160);
      return clean && !['(empty value)', '(missing)', '__missing__'].includes(clean.toLowerCase()) ? clean : '';
    };
    const isCountKey = key => Array.isArray(key) && key.length === 1 && ['count', 'count()'].includes(String(key[0]).toLowerCase());
    const points = new Map(), branchesByService = new Map();
    let pivotCount = 0;
    const versionSources=[{pivot:versions},...aliases.map(item=>({pivot:data?.results?.[item.id]?.search_types?.[item.typeId]}))];
    for (const source of versionSources) {
    if (!Array.isArray(source.pivot?.rows)) incomplete = true;
    for (const row of Array.isArray(source.pivot?.rows) ? source.pivot.rows : []) {
      if (!Array.isArray(row.key) || row.key.length || !Array.isArray(row.values)) { incomplete = true; continue; }
      for (const cell of row.values) {
        const count = countValue(cell?.value), key = cell?.key;
        const service=dimension(key?.[0]),branch=dimension(key?.[1]);
        if (count === null || !Array.isArray(key) || key.length !== 3 || !isCountKey(key.slice(2)) || !service || !branch) {
          incomplete = true; continue;
        }
        const pair = JSON.stringify([service, branch]);
        if (points.has(pair)) incomplete = true;
        const combined = (points.get(pair)?.count || 0) + count;
        if (!Number.isSafeInteger(combined)) { incomplete = true; continue; }
        points.set(pair, { service, branch, count: combined });
        if (!branchesByService.has(service)) branchesByService.set(service, new Set());
        branchesByService.get(service).add(branch);
        pivotCount += count;
      }
    }
    }
    if (branchesByService.size >= limit || [...branchesByService.values()].some(branches => branches.size >= limit)) incomplete = true;
    let totalCount = null;
    if (!Array.isArray(total?.rows)) incomplete = true;
    for (const row of Array.isArray(total?.rows) ? total.rows : []) {
      if (!Array.isArray(row.key) || row.key.length || !Array.isArray(row.values)) { incomplete = true; continue; }
      for (const cell of row.values) {
        const count = countValue(cell?.value);
        if (!isCountKey(cell?.key) || count === null || totalCount !== null) { incomplete = true; continue; }
        totalCount = count;
      }
    }
    if (totalCount === null || !Number.isSafeInteger(pivotCount) || pivotCount !== totalCount) incomplete = true;
    return { versionPoints: [...points.values()], incomplete };
  } catch (error) {
    return { error: error?.message || String(error) };
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { fetchReleaseVersionsInGraylog };
