const DEFAULTS = {
  minimumClusterSize: 3,
  naturalGapFloor: 0.1,
  naturalGapMultiplier: 2.5,
  maximumBands: 3,
  maximumUpperShare: 0.25,
  watchRatio: 1.2,
  highRatio: 1.4,
  criticalRatio: 1.5,
  criticalExcess: 10_000
};
const ANALYZER_HOUR_MS = 60 * 60 * 1000;
const MOSCOW_OFFSET_MS = 3 * ANALYZER_HOUR_MS;
const MOSCOW_STANDARD_START_HOUR = globalThis.GraylogConstants?.MOSCOW_STANDARD_START_HOUR ?? 11;

function latestCompletedMoscowStandardHour(now = Date.now()) {
  const moscow = new Date(now + MOSCOW_OFFSET_MS);
  let start = Date.UTC(
    moscow.getUTCFullYear(),
    moscow.getUTCMonth(),
    moscow.getUTCDate(),
    MOSCOW_STANDARD_START_HOUR
  ) - MOSCOW_OFFSET_MS;
  const end = start + ANALYZER_HOUR_MS;
  if (now < end) start -= 24 * ANALYZER_HOUR_MS;
  return start;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clusterTrafficBands(items, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const sorted = [...items].filter((item) => Number.isFinite(item.count) && item.count >= 0).sort((a, b) => a.count - b.count || a.uri.localeCompare(b.uri, "ru"));
  if (sorted.length < settings.minimumClusterSize + 1) {
    return { bands: [{ key: "medium", label: "Средняя", items: sorted }], boundaries: [], threshold: null };
  }

  const gaps = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index].count;
    const next = sorted[index + 1].count;
    const ratio = current > 0 ? next / current - 1 : next > 0 ? Infinity : 0;
    gaps.push({ index, ratio });
  }
  const finiteGaps = gaps.map((gap) => gap.ratio).filter(Number.isFinite);
  const typicalGap = finiteGaps.length ? median(finiteGaps) : 0;
  const threshold = Math.max(settings.naturalGapFloor, typicalGap * settings.naturalGapMultiplier);
  const boundaries = gaps
    .filter((gap) => gap.ratio >= threshold)
    .sort((a, b) => b.ratio - a.ratio || b.index - a.index)
    .slice(0, settings.maximumBands - 1)
    .sort((a, b) => a.index - b.index);

  const slices = [];
  let start = 0;
  for (const boundary of boundaries) {
    slices.push(sorted.slice(start, boundary.index + 1));
    start = boundary.index + 1;
  }
  slices.push(sorted.slice(start));
  const labels = slices.length === 3
    ? [["low", "Мало"], ["medium", "Средняя"], ["high", "Высокая"]]
    : slices.length === 2
      ? [["low", "Мало"], ["high", "Высокая"]]
      : [["medium", "Средняя"]];
  const bands = slices.map((bandItems, index) => ({ key: labels[index][0], label: labels[index][1], items: bandItems }));
  return { bands, boundaries, threshold };
}

function findBaseline(items, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const clustered = clusterTrafficBands(items, settings);
  if (clustered.bands.length < 2) {
    return { value: null, members: [], candidates: [], bands: clustered.bands, confidence: "low", reason: "Изолированная верхняя группа не найдена" };
  }
  const upper = clustered.bands.at(-1);
  const normal = clustered.bands.at(-2);
  const maximumUpperSize = Math.max(2, Math.ceil(items.length * settings.maximumUpperShare));
  if (upper.items.length > maximumUpperSize || normal.items.length < settings.minimumClusterSize) {
    return { value: null, members: [], candidates: [], bands: clustered.bands, confidence: "low", reason: "Верхняя группа не является небольшим изолированным выбросом" };
  }
  const boundary = clustered.boundaries.at(-1);
  const value = median(normal.items.map((item) => item.count));
  const confidence = boundary.ratio >= 0.4 && normal.items.length >= 4 ? "high" : "medium";

  return {
    value,
    members: normal.items.map((item) => item.uri),
    candidates: upper.items.map((item) => item.uri),
    bands: clustered.bands,
    confidence,
    reason: `Верхняя группа отделена разрывом ${(boundary.ratio * 100).toFixed(0)}%`
  };
}

function riskFor(ratio, excess, settings) {
  if (ratio < settings.watchRatio) return { key: "normal", label: "Норма", rank: 0 };
  if (ratio >= settings.criticalRatio && excess >= settings.criticalExcess) {
    return { key: "critical", label: "Критический", rank: 3 };
  }
  if (ratio >= settings.highRatio) return { key: "high", label: "Высокий", rank: 2 };
  return { key: "watch", label: "Подозрение", rank: 1 };
}

function parseSpamPivotRows(searchType, fallbackTimeBucket = null) {
  const rows = [];
  for (const row of searchType?.rows || []) {
    if (row.source && row.source !== "leaf") continue;
    const timeBucket = Array.isArray(row.key) && row.key[0] ? String(row.key[0]) : fallbackTimeBucket;
    for (const cell of row.values || []) {
      if (cell.source && cell.source !== "col-leaf") continue;
      if (cell.rollup === true || cell.value === null || cell.value === undefined || !Number.isFinite(Number(cell.value)) || !Array.isArray(cell.key)) continue;
      const metric = String(cell.key[cell.key.length - 1]).toLowerCase();
      if (!["count", "count()"].includes(metric)) continue;
      const dimensions = cell.key.slice(0, -1);
      if (dimensions.length !== 3) continue;
      rows.push({
        version: String(dimensions[0]),
        terminalType: String(dimensions[1]),
        uri: String(dimensions[2]),
        count: Number(cell.value),
        timeBucket
      });
    }
  }
  return rows;
}

function parseSpamUriTotals(searchType) {
  const totals = new Map();
  if(searchType?.errors?.length)return totals;
  for(const row of searchType?.rows || []){
    if(row.source && row.source !== 'leaf')continue;
    for(const cell of row.values || []){
      if(cell.source && cell.source !== 'col-leaf' || cell.rollup === true)continue;
      if(!Array.isArray(cell.key)||cell.key.length!==3||!['count','count()'].includes(String(cell.key[2]).toLowerCase()))continue;
      if(typeof cell.key[0]!=='string'||!cell.key[0]||typeof cell.key[1]!=='string'||!cell.key[1]||cell.value===null||cell.value===undefined)continue;
      const value=Number(cell.value);if(!Number.isSafeInteger(value)||value<0)continue;
      // This pivot has no time/type dimensions: duplicate version+URI cells
      // are ambiguous and must never be added together as another request.
      const key=JSON.stringify(cell.key.slice(0,2));
      if(totals.has(key))totals.set(key,null);else totals.set(key,value);
    }
  }
  return new Map([...totals].filter(([,value])=>value!==null));
}

function parseSpamVersions(searchType) {
  if(!Array.isArray(searchType?.rows)||searchType?.errors?.length)throw new Error('Graylog не подтвердил список версий. Полнота загрузки неизвестна.');
  const versions=new Set();
  for(const row of searchType.rows){
    if(row.source&&row.source!=='leaf')continue;
    for(const cell of row.values||[]){
      if(cell.source&&cell.source!=='col-leaf'||cell.rollup===true)continue;
      if(!Array.isArray(cell.key)||cell.key.length!==2||!['count','count()'].includes(String(cell.key[1]).toLowerCase()))continue;
      const version=cell.key[0];if(typeof version!=='string'||!version||version.length>256||/[\u0000-\u001f\u007f]/.test(version))throw new Error('Некорректное имя версии в ответе Graylog.');
      if(cell.value==null||!Number.isSafeInteger(Number(cell.value))||Number(cell.value)<0)throw new Error('Не удалось подтвердить число событий версии.');
      versions.add(version);
    }
  }
  if(!versions.size&&Number(searchType.total)>0)throw new Error('Graylog вернул события, но не список версий. Полнота загрузки неизвестна.');
  return [...versions];
}

function analyzeRows(rows, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const groups = new Map();

  for (const row of rows) {
    const key = `${row.timeBucket || "all"}\u0000${row.version}\u0000${row.terminalType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const analyzedGroups = [];
  const findings = [];

  for (const items of groups.values()) {
    const baseline = findBaseline(items, settings);
    const head = items[0];
    const groupInfo = {
      version: head.version,
      terminalType: head.terminalType,
      timeBucket: head.timeBucket || null,
      baseline: baseline.value,
      baselineMembers: baseline.members,
      candidateUris: baseline.candidates,
      bands: baseline.bands.map((band) => ({
        key: band.key,
        label: band.label,
        size: band.items.length,
        min: band.items[0]?.count ?? null,
        max: band.items.at(-1)?.count ?? null
      })),
      confidence: baseline.confidence,
      reason: baseline.reason,
      uriCount: items.length
    };
    analyzedGroups.push(groupInfo);

    if (!baseline.value) continue;
    const candidates = new Set(baseline.candidates);
    for (const item of items) {
      if (!candidates.has(item.uri)) continue;
      const ratio = item.count / baseline.value;
      const excess = Math.max(0, Math.round(item.count - baseline.value));
      const risk = riskFor(ratio, excess, settings);
      if (risk.rank === 0) continue;
      findings.push({
        ...item,
        baseline: Math.round(baseline.value),
        ratio,
        excess,
        risk: risk.key,
        riskLabel: risk.label,
        riskRank: risk.rank,
        confidence: baseline.confidence,
        explanation: `${item.count.toLocaleString("ru-RU")} против базы ${Math.round(baseline.value).toLocaleString("ru-RU")} (${ratio.toFixed(2)}×)`
      });
    }
  }

  findings.sort((a, b) => b.riskRank - a.riskRank || b.excess - a.excess);
  analyzedGroups.sort((a, b) => (b.baseline || 0) - (a.baseline || 0));

  return {
    findings,
    groups: analyzedGroups,
    summary: {
      totalRows: rows.length,
      totalGroups: analyzedGroups.length,
      totalHours: new Set(rows.map((row) => row.timeBucket).filter(Boolean)).size,
      critical: findings.filter((item) => item.risk === "critical").length,
      high: findings.filter((item) => item.risk === "high").length,
      watch: findings.filter((item) => item.risk === "watch").length,
      totalExcess: findings.reduce((sum, item) => sum + item.excess, 0),
      unresolved: analyzedGroups.filter((group) => !group.baseline).length
    },
    settings
  };
}

const SpamAnalyzer = { DEFAULTS, analyzeRows, clusterTrafficBands, findBaseline, latestCompletedMoscowStandardHour, median, parseSpamPivotRows, parseSpamUriTotals, parseSpamVersions, riskFor };
if (typeof module !== "undefined" && module.exports) module.exports = SpamAnalyzer;
if (typeof globalThis !== "undefined") globalThis.SpamAnalyzer = SpamAnalyzer;
