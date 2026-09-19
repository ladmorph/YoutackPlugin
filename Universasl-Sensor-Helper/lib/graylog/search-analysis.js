function searchMetricValue(value) {
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

function searchPivotCells(row) {
  const raw = row?.values;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.entries(raw).map(([key, entry]) => entry && typeof entry === "object" && !Array.isArray(entry) ? { key: entry.key ?? [key], ...entry } : { key: [key], value: entry });
  if (row && Object.prototype.hasOwnProperty.call(row, "value")) return [{ key: ["value"], value: row.value }];
  if (row && Object.prototype.hasOwnProperty.call(row, "count")) return [{ key: ["count()"], value: row.count }];
  return [];
}

function parseSearchPivot(searchType, groupDepth) {
  const rows = [];
  for (const row of searchType?.rows || []) {
    const rowKey = Array.isArray(row.key) ? row.key : [];
    const cells = searchPivotCells(row);
    if (rowKey.length === groupDepth) {
      const count = cells.map((cell) => searchMetricValue(cell?.value)).find((value) => value !== null);
      if (count !== undefined) rows.push({ groups: rowKey.map(String), count });
      continue;
    }
    for (const cell of cells) {
      if (!Array.isArray(cell.key) || !cell.key.length) continue;
      const count = searchMetricValue(cell?.value);
      if (count === null) continue;
      const hasNamedMetric = cell.key.map(String).some((part) => /count/i.test(part));
      const groups = [...rowKey, ...cell.key.slice(0, hasNamedMetric ? -1 : undefined)];
      if (groups.length !== groupDepth) continue;
      rows.push({ groups: groups.map(String), count });
    }
  }
  return rows.sort((left, right) => right.count - left.count || left.groups.join("\u0000").localeCompare(right.groups.join("\u0000"), "ru"));
}

function parseIndependentSearchPivots(fieldPivots) {
  return (fieldPivots || []).flatMap(({ field, pivot }) =>
    parseColumnSearchPivot(pivot).map((row) => ({ field: String(field), value: row.value, count: row.count }))
  );
}

function parseColumnSearchPivot(searchType) {
  const totals = new Map();
  for (const row of searchType?.rows || []) {
    const rowKey = Array.isArray(row?.key) ? row.key : [];
    for (const cell of searchPivotCells(row)) {
      if (cell?.rollup === true || !Array.isArray(cell?.key) || !cell.key.length) continue;
      const parts = cell.key.map(String);
      const metricIndex = parts.findIndex((part) => /^(?:count\(\)|count)$/i.test(part));
      const dimensions = metricIndex >= 0 ? parts.slice(0, metricIndex) : parts;
      if (!dimensions.length) continue;
      const count = searchMetricValue(cell.value);
      if (count === null) continue;
      const value = rowKey.length === 1 && /^(?:metric|value)$/i.test(dimensions[0]) ? String(rowKey[0]) : dimensions[0];
      totals.set(value, (totals.get(value) || 0) + count);
    }
  }
  if (!totals.size) {
    for (const row of parseSearchPivot(searchType, 1)) totals.set(row.groups[0], (totals.get(row.groups[0]) || 0) + row.count);
  }
  return [...totals.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "ru"));
}

const SearchAnalysis = { parseSearchPivot, parseIndependentSearchPivots, parseColumnSearchPivot, searchMetricValue, searchPivotCells };
if (typeof module !== "undefined" && module.exports) module.exports = SearchAnalysis;
if (typeof globalThis !== "undefined") globalThis.SearchAnalysis = SearchAnalysis;
