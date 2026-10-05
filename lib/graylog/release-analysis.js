function aggregateBySignature(points) {
  const totals = new Map();
  for (const point of points || []) {
    const count = Number(point.count);
    if (!point.signature || !Number.isFinite(count) || count < 0) continue;
    totals.set(String(point.signature), (totals.get(String(point.signature)) || 0) + count);
  }
  return totals;
}

function summarizeTimeBuckets(points) {
  const totals = new Map();
  for (const point of points || []) {
    const time = String(point?.time || "").trim();
    const count = Number(point?.count);
    if (!time || !Number.isFinite(count) || count < 0) continue;
    totals.set(time, (totals.get(time) || 0) + count);
  }
  const buckets = [...totals.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  if (!buckets.length) return null;
  const peak = buckets.reduce((selected, item) => item[1] > selected[1] ? item : selected, buckets[0]);
  const latestCount = buckets.at(-1)[1];
  const previousCount = buckets.length > 1 ? buckets.at(-2)[1] : null;
  const change = previousCount === null ? null : latestCount - previousCount;
  return {
    bucketCount: buckets.length,
    peakTime: peak[0],
    peakCount: peak[1],
    previousCount,
    latestCount,
    change,
    direction: change === null ? "single" : change > 0 ? "up" : change < 0 ? "down" : "flat"
  };
}

function comparePeriods(currentPoints, historyPoints) {
  const current = aggregateBySignature(currentPoints);
  const history = aggregateBySignature(historyPoints);
  const rows = [...current.entries()]
    .map(([signature, count]) => ({
      signature,
      count,
      previous: history.get(signature) || 0,
      isNew: !history.has(signature)
    }))
    .sort((left, right) => Number(right.isNew) - Number(left.isNew) || right.count - left.count);
  return {
    rows,
    newCount: rows.filter((row) => row.isNew).length,
    knownCount: rows.filter((row) => !row.isNew).length
  };
}

function branchVersion(value) {
  const text = String(value ?? "").trim();
  // A branch/tag name can carry other numbers before the real version (a
  // ticket id, a date, a sprint number). A dotted release version is
  // conventionally the trailing one (e.g. "JIRA-1234-release-2.5.0"), so the
  // last dotted match wins instead of the first. With no dotted match at
  // all, only accept a version if the whole name is just digits - a bare
  // number embedded in an unrelated branch name (a ticket id) is not a
  // version and must not be compared as one.
  const dotted = [...text.matchAll(/\d+(?:\.\d+)+/g)];
  const match = dotted.length ? dotted[dotted.length - 1][0] : (/^\d+$/.test(text) ? text : null);
  if (!match) return null;
  const parts = match.split(".").map(Number);
  if (!parts.every(Number.isFinite)) return null;
  while (parts.length > 1 && parts.at(-1) === 0) parts.pop();
  return { raw: String(value), normalized: parts.join("."), parts };
}

function compareBranchVersions(left, right) {
  const leftVersion = typeof left === "object" && left?.parts ? left : branchVersion(left);
  const rightVersion = typeof right === "object" && right?.parts ? right : branchVersion(right);
  if (!leftVersion && !rightVersion) return 0;
  if (!leftVersion) return -1;
  if (!rightVersion) return 1;
  const length = Math.max(leftVersion.parts.length, rightVersion.parts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftVersion.parts[index] || 0) - (rightVersion.parts[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

// Совпадение по факту присутствия скрывает регрессию: признак, встречавшийся
// вчера один раз и выстреливший тысячей событий в релизном часе, остаётся
// "известным". Период и история разной длины, поэтому сравнивать можно только
// частоты (событий в час), а не сырые счётчики.
const SPIKE_MIN_EVENTS = 10;
const SPIKE_MIN_RATIO = 5;

// Возвращает описание всплеска или null. Заявлять рост на единичных событиях
// нельзя: при малом объёме в периоде или нулевой базе в истории отношение
// частот ничего не доказывает.
function signatureSpike(count, previous, periodMs, historySpanMs) {
  if (!(periodMs > 0) || !(historySpanMs > 0)) return null;
  if (!Number.isFinite(count) || !Number.isFinite(previous)) return null;
  if (count < SPIKE_MIN_EVENTS || !(previous > 0)) return null;
  const periodPerHour = count / (periodMs / 3600000);
  const historyPerHour = previous / (historySpanMs / 3600000);
  if (!(historyPerHour > 0)) return null;
  const ratio = periodPerHour / historyPerHour;
  return ratio >= SPIKE_MIN_RATIO ? { ratio, periodPerHour, historyPerHour } : null;
}

function compareServiceSignatures(currentPoints, historyPoints, releaseAware, options = {}) {
  const latestByService = new Map();
  const versionsByService = new Map();
  for (const point of currentPoints || []) {
    const service = String(point.service || "").trim();
    const version = branchVersion(point.branch);
    if (!service) continue;
    if (!versionsByService.has(service)) versionsByService.set(service, new Map());
    const rawBranch = String(point.branch || "").trim();
    if (rawBranch) versionsByService.get(service).set(version?.normalized || rawBranch, version || { raw: rawBranch, normalized: rawBranch, parts: [] });
    if (version) {
      const selected = latestByService.get(service);
      if (!selected || compareBranchVersions(version, selected) > 0) latestByService.set(service, version);
    }
  }

  const current = new Map();
  const history = new Map();
  const add = (target, point) => {
    const service = String(point.service || "").trim();
    const signature = String(point.signature || "").trim();
    const count = Number(point.count);
    if (!service || !signature || !Number.isFinite(count) || count < 0) return;
    const key = `${service}\u0000${signature}`;
    const existing = target.get(key) || { service, signature, count: 0, branches: new Set(), versions: new Set(), fields: { ...(point.fields || {}) } };
    existing.count += count;
    const rawBranch = String(point.branch || "").trim();
    if (rawBranch) {
      existing.branches.add(rawBranch);
      existing.versions.add(branchVersion(rawBranch)?.normalized || rawBranch);
    }
    target.set(key, existing);
  };

  for (const point of currentPoints || []) add(current, point);
  for (const point of historyPoints || []) add(history, point);

  const rows = [...current.values()].map((item) => {
    const key = `${item.service}\u0000${item.signature}`;
    const historical = history.get(key);
    const latest = latestByService.get(item.service);
    const currentBranches = [...item.branches].sort((left, right) => compareBranchVersions(right, left));
    const hasMultipleCurrentBranches = item.versions.size > 1;
    return {
      service: item.service,
      signature: item.signature,
      fields: { ...item.fields },
      branch: latest?.raw || currentBranches[0] || "",
      branchVersion: latest?.normalized || "",
      count: item.count,
      previous: historical?.count || 0,
      previousBranches: historical ? [...historical.branches].sort((left, right) => compareBranchVersions(right, left)) : [],
      currentBranches,
      hasMultipleCurrentBranches,
      isSingleVersion: !hasMultipleCurrentBranches,
      isNew: !historical && (!releaseAware || !hasMultipleCurrentBranches),
      // Всплеск считается только там, где сравниваются два разных по длине
      // окна (период против истории). В режиме релиза сравниваются версии
      // внутри одного периода - там это отношение означало бы другое.
      spike: releaseAware || !historical ? null : signatureSpike(item.count, historical.count, options.periodMs, options.historySpanMs)
    };
  }).sort((left, right) => Number(right.isNew) - Number(left.isNew) || Number(Boolean(right.spike)) - Number(Boolean(left.spike)) || right.count - left.count);
  return {
    rows,
    latestByService: Object.fromEntries([...latestByService].map(([service, version]) => [service, version.raw])),
    versionCounts: Object.fromEntries([...versionsByService].map(([service, versions]) => [service, versions.size])),
    newCount: rows.filter((row) => row.isNew).length,
    knownCount: rows.filter((row) => !row.isNew).length,
    newEventCount: rows.filter((row) => row.isNew).reduce((sum, row) => sum + row.count, 0),
    knownEventCount: rows.filter((row) => !row.isNew).reduce((sum, row) => sum + row.count, 0),
    spikeCount: rows.filter((row) => row.spike).length,
    spikeEventCount: rows.filter((row) => row.spike).reduce((sum, row) => sum + row.count, 0)
  };
}

function comparePeriodSignatures(currentPoints, historyPoints, options = {}) {
  return compareServiceSignatures(currentPoints, historyPoints, false, options);
}

function compareReleaseBranches(currentPoints, historyPoints, options = {}) {
  const current = Array.isArray(currentPoints) ? currentPoints : [];
  const history = Array.isArray(historyPoints) ? historyPoints : [];
  const inventory = Array.isArray(options?.versionPoints) ? options.versionPoints : [];
  const complete = options?.complete !== false;
  const services = new Map();
  const serviceName = point => String(point?.service ?? "").trim();
  // branchVersion() already normalizes trailing-zero components (2.5.0 and
  // 2.5 compare and group as the same version), so this is a thin wrapper
  // that only trims the display value for this comparison mode.
  const versionOf = value => {
    const version = branchVersion(value);
    return version ? { ...version, raw: String(value).trim() } : null;
  };
  for (const point of [...current, ...history, ...inventory]) {
    const service = serviceName(point);
    if (!service) continue;
    if (!services.has(service)) services.set(service, { service, versions: new Map() });
    const version = versionOf(point?.branch);
    if (!version) continue;
    const versions = services.get(service).versions;
    if (!versions.has(version.normalized)) versions.set(version.normalized, { ...version, branches: new Set() });
    versions.get(version.normalized).branches.add(version.raw);
  }
  for (const state of services.values()) {
    const versions = [...state.versions.values()].sort((a, b) => compareBranchVersions(b, a));
    [state.latest, state.previous] = versions;
    state.current = new Map();
    state.unversioned = new Map();
    state.prior = new Map();
  }
  const add = (target, point) => {
    const signature = String(point?.signature ?? "").trim();
    const count = Number(point?.count);
    if (!signature || !Number.isFinite(count) || count <= 0) return;
    const entry = target.get(signature) || { signature, count: 0, branches: new Set(), fields: { ...(point.fields || {}) } };
    entry.count += count;
    const branch = String(point.branch ?? "").trim();
    if (branch) entry.branches.add(branch);
    target.set(signature, entry);
  };
  for (const point of current) {
    const state = services.get(serviceName(point));
    if (!state) continue;
    const version = versionOf(point?.branch);
    if (!version) add(state.unversioned, point);
    else if (version.normalized === state.latest?.normalized) add(state.current, point);
  }
  for (const point of [...current, ...history]) {
    const state = services.get(serviceName(point));
    if (state?.previous && versionOf(point?.branch)?.normalized === state.previous.normalized) add(state.prior, point);
  }
  const rows = [];
  const serviceSummaries = [];
  for (const state of services.values()) {
    const summary = {
      service: state.service, latestBranch: state.latest?.raw || "", previousBranch: state.previous?.raw || "",
      versionCount: state.versions.size, latestEventCount: 0, newEventCount: 0, knownEventCount: 0, unknownEventCount: 0, unversionedEventCount: 0
    };
    const entries = [...state.current.values()].map(item => ({item, versioned:true}));
    entries.push(...[...state.unversioned.values()].map(item => ({item, versioned:false})));
    for (const {item, versioned} of entries) {
      const previous = versioned ? state.prior.get(item.signature)?.count || 0 : 0;
      const novelty = previous > 0 ? "known" : versioned && state.previous && complete ? "new" : "unknown";
      const reason = !versioned ? "no-numeric-version" : previous > 0 ? "previous-version-match" : !state.latest ? "no-numeric-version"
        : !state.previous ? "single-version" : !complete ? "incomplete-data" : "previous-version-absent";
      rows.push({
        service: state.service, signature: item.signature, fields: { ...item.fields },
        branch: versioned ? summary.latestBranch : "", branchVersion: versioned ? state.latest?.normalized || "" : "",
        latestBranch: summary.latestBranch, previousBranch: summary.previousBranch,
        count: item.count, previous, novelty, reason, isNew: novelty === "new",
        currentBranches: versioned ? [...item.branches].sort() : [],
        previousBranches: versioned && state.previous ? [...state.previous.branches].sort() : [],
        hasMultipleCurrentBranches: false, isSingleVersion: state.versions.size === 1
      });
      if (versioned) summary.latestEventCount += item.count;
      else summary.unversionedEventCount += item.count;
      summary[`${novelty}EventCount`] += item.count;
    }
    serviceSummaries.push(summary);
  }
  const rank = { new: 0, unknown: 1, known: 2 };
  rows.sort((a, b) => rank[a.novelty] - rank[b.novelty] || b.count - a.count || a.service.localeCompare(b.service) || a.signature.localeCompare(b.signature));
  return {
    rows, serviceSummaries,
    latestByService: Object.fromEntries([...services].filter(([, state]) => state.latest).map(([service, state]) => [service, state.latest.raw])),
    previousByService: Object.fromEntries([...services].filter(([, state]) => state.previous).map(([service, state]) => [service, state.previous.raw])),
    versionCounts: Object.fromEntries([...services].map(([service, state]) => [service, state.versions.size])),
    newCount: rows.filter(row => row.novelty === "new").length,
    knownCount: rows.filter(row => row.novelty === "known").length,
    unknownCount: rows.filter(row => row.novelty === "unknown").length,
    newEventCount: serviceSummaries.reduce((sum, item) => sum + item.newEventCount, 0),
    knownEventCount: serviceSummaries.reduce((sum, item) => sum + item.knownEventCount, 0),
    unknownEventCount: serviceSummaries.reduce((sum, item) => sum + item.unknownEventCount, 0),
    unversionedEventCount: serviceSummaries.reduce((sum, item) => sum + item.unversionedEventCount, 0)
  };
}

const ReleaseAnalysis = { aggregateBySignature, summarizeTimeBuckets, comparePeriods, comparePeriodSignatures, branchVersion, compareBranchVersions, compareReleaseBranches, signatureSpike, SPIKE_MIN_EVENTS, SPIKE_MIN_RATIO };
if (typeof module !== "undefined" && module.exports) module.exports = ReleaseAnalysis;
if (typeof globalThis !== "undefined") globalThis.ReleaseAnalysis = ReleaseAnalysis;
