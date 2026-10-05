const PERCENTILE_KEYS = ["p50", "p75", "p95", "p99"];

function normalizePercentileRows(rows) {
  return (rows || [])
    .map((row) => {
      const normalized = { uri: String(row.uri || "не указан"), count: Number(row.count) || 0 };
      for (const key of PERCENTILE_KEYS) {
        const raw = row[key];
        const value = Number(raw);
        normalized[key] = raw !== null && raw !== undefined && raw !== "" && Number.isFinite(value) && value >= 0 ? value : null;
      }
      return normalized;
    })
    .filter((row) => PERCENTILE_KEYS.some((key) => row[key] !== null))
    .sort((left, right) => {
      for (const key of ["p99", "p95", "p75", "p50"]) {
        const difference = (right[key] ?? -1) - (left[key] ?? -1);
        if (difference) return difference;
      }
      return left.uri.localeCompare(right.uri, "ru");
    });
}

function filterPercentileRows(rows, query) {
  const needle = String(query || "").trim().toLocaleLowerCase("ru");
  if (!needle) return rows;
  return rows.filter((row) => row.uri.toLocaleLowerCase("ru").includes(needle));
}

// Presentation selection only: never changes the population used to calculate percentiles.
function percentileHiddenUris(rows, previousHidden = new Set(), manual = false) {
  const selected = new Set(normalizePercentileRows(rows).slice(0, 10).map((row) => row.uri));
  return new Set(rows.filter((row) => manual ? previousHidden.has(row.uri) : !selected.has(row.uri)).map((row) => row.uri));
}

function summarizeTailLatency(rows) {
  let selected = null;
  for (const row of rows || []) {
    const p50 = Number(row?.p50);
    const p99 = Number(row?.p99);
    if (!Number.isFinite(p50) || p50 <= 0 || !Number.isFinite(p99) || p99 < 0) continue;
    const candidate = { uri: String(row.uri || "не указан"), ratio: p99 / p50, gap: p99 - p50, p50, p99 };
    if (!selected || candidate.ratio > selected.ratio || (candidate.ratio === selected.ratio && candidate.gap > selected.gap)) selected = candidate;
  }
  return selected;
}

function parseDuration(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function weightedPercentile(points, percentile) {
  const total = points.reduce((sum, point) => sum + point.count, 0);
  if (!total) return null;
  const rank = Math.max(1, Math.ceil(total * percentile / 100));
  let cumulative = 0;
  for (const point of points) {
    cumulative += point.count;
    if (cumulative >= rank) return point.value;
  }
  return points.at(-1)?.value ?? null;
}

function percentileRowsFromBuckets(buckets) {
  const grouped = new Map();
  let invalidTotal = 0;
  for (const bucket of buckets || []) {
    const count = Number(bucket.count);
    const value = parseDuration(bucket.duration);
    if (!Number.isFinite(count) || count <= 0) continue;
    if (value === null) { invalidTotal += count; continue; }
    const uri = String(bucket.uri || "не указан");
    if (!grouped.has(uri)) grouped.set(uri, new Map());
    const points = grouped.get(uri);
    points.set(value, (points.get(value) || 0) + count);
  }
  let sampledTotal = 0;
  const rows = [];
  for (const [uri, counts] of grouped) {
    const points = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value - b.value);
    const count = points.reduce((sum, point) => sum + point.count, 0);
    sampledTotal += count;
    rows.push({ uri, count, p50: weightedPercentile(points, 50), p75: weightedPercentile(points, 75), p95: weightedPercentile(points, 95), p99: weightedPercentile(points, 99) });
  }
  return { rows: normalizePercentileRows(rows), sampledTotal, invalidTotal };
}

function metricValue(value) {
  let current = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current === null || current === undefined || current === "") return null;
    if (typeof current !== "object") {
      const numeric = Number(current);
      return Number.isFinite(numeric) ? numeric : null;
    }
    if (Array.isArray(current)) {
      if (current.length !== 1) return null;
      [current] = current;
      continue;
    }
    const nestedKey = ["value", "result", "number", "long", "double"].find((key) => Object.prototype.hasOwnProperty.call(current, key));
    if (!nestedKey) return null;
    current = current[nestedKey];
  }
  return null;
}

function pivotCells(row) {
  const raw = row?.values;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([key, entry]) => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) return { key: entry.key ?? [key], ...entry };
      return { key: [key], value: entry };
    });
  }
  if (row && Object.prototype.hasOwnProperty.call(row, "value")) return [{ key: ["value"], value: row.value }];
  if (row && Object.prototype.hasOwnProperty.call(row, "count")) return [{ key: ["count()"], value: row.count }];
  return [];
}

function parseDurationBuckets(searchType) {
  const buckets = [];
  for (const row of searchType?.rows || []) {
    const rowKey = Array.isArray(row.key) ? row.key : [];
    const cells = pivotCells(row);
    if (rowKey.length === 2) {
      const count = cells.map((item) => metricValue(item?.value)).find((value) => value !== null);
      if (count !== undefined) buckets.push({ uri: String(rowKey[0]), duration: String(rowKey[1]), count });
      continue;
    }
    for (const item of cells) {
      const metricKey = Array.isArray(item.key) ? item.key.map(String) : [String(item.key || "")];
      const count = metricValue(item?.value);
      if (count === null) continue;
      const hasNamedMetric = metricKey.some((part) => /count/i.test(part));
      const cellDimensions = Array.isArray(item.key) ? item.key.slice(0, hasNamedMetric ? -1 : undefined) : [];
      const dimensions = [...rowKey, ...cellDimensions];
      if (dimensions.length !== 2) continue;
      buckets.push({ uri: String(dimensions[0]), duration: String(dimensions[1]), count });
    }
  }
  return buckets;
}

function parseTimedDurationBuckets(searchType) {
  const buckets = [];
  for (const row of searchType?.rows || []) {
    const rowKey = Array.isArray(row.key) ? row.key : [];
    if (!rowKey.length) continue;
    const rawTime = rowKey[0];
    const numeric = Number(rawTime);
    const time = Number.isFinite(numeric) ? (numeric < 10_000_000_000 ? numeric * 1000 : numeric) : Date.parse(String(rawTime));
    if (!Number.isFinite(time)) continue;
    for (const item of pivotCells(row)) {
      if (item?.rollup === true || !Array.isArray(item?.key)) continue;
      const key = item.key.map(String);
      const metricIndex = key.findIndex((part) => /^(?:count\(\)|count)$/i.test(part));
      const dimensions = metricIndex >= 0 ? key.slice(0, metricIndex) : key;
      if (dimensions.length !== 2) continue;
      const count = metricValue(item.value);
      if (count === null) continue;
      buckets.push({ time, uri: dimensions[0], duration: dimensions[1], count });
    }
  }
  return buckets;
}

function percentileTimelineFromBuckets(buckets) {
  const grouped = new Map();
  for (const bucket of buckets || []) {
    const key = `${bucket.time}\u0000${bucket.uri}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(bucket);
  }
  return [...grouped.entries()].flatMap(([key, items]) => {
    const [time, uri] = key.split("\u0000");
    const calculated = percentileRowsFromBuckets(items);
    const row = calculated.rows[0];
    return row ? [{ ...row, time: Number(time), uri }] : [];
  }).sort((a, b) => a.time - b.time || a.uri.localeCompare(b.uri, "ru"));
}

function describePivotRow(row) {
  if (!row) return "отсутствует";
  const raw = row.values;
  const kind = Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw;
  const cells = pivotCells(row);
  const sample = cells.slice(0, 2).map((cell) => ({
    key: cell?.key,
    valueType: Array.isArray(cell?.value) ? "array" : cell?.value === null ? "null" : typeof cell?.value,
    numeric: metricValue(cell?.value) !== null
  }));
  return `key=${JSON.stringify(row.key || [])}, source=${row.source || "—"}, values=${kind}(${cells.length}), cells=${JSON.stringify(sample)}`;
}

const PercentileAnalysis = { PERCENTILE_KEYS, normalizePercentileRows, filterPercentileRows, percentileHiddenUris, summarizeTailLatency, parseDuration, weightedPercentile, percentileRowsFromBuckets, parseDurationBuckets, parseTimedDurationBuckets, percentileTimelineFromBuckets, metricValue, pivotCells, describePivotRow };
if (typeof module !== "undefined" && module.exports) module.exports = PercentileAnalysis;
if (typeof globalThis !== "undefined") globalThis.PercentileAnalysis = PercentileAnalysis;
