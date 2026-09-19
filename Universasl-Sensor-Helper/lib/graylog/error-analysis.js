(function initializeErrorAnalysis() {
  'use strict';

  const HEAD_LIMIT = 2048;
  const BUCKET_MS = 5 * 60 * 1000;
  const HISTORY_MS = 24 * 60 * 60 * 1000;
  const ERROR_CODES = new Set(['SYSTEM_ERROR', 'REQUEST_NOT_FOUND']);
  const ERROR_TYPES = new Set(['http.not_found', 'http.input_unreadable', 'http.system_error', 'db.numeric_overflow', 'client.request_not_found']);

  function fieldsOf(record) {
    if (!record || typeof record !== 'object') return {};
    if (Object.prototype.hasOwnProperty.call(record, 'level')) return record;
    return record.message && typeof record.message === 'object' ? record.message : record;
  }

  function statusOf(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 100 && number <= 599 ? number : null;
  }

  // Metadata retains the existing internal service/release context. It is not
  // anonymous and must not be included in external telemetry.
  function metadata(value, fallback = '') {
    if(typeof value !== 'string')return fallback;
    const clean=value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,160);
    return clean || fallback;
  }

  function firstMetadata(fields, names, fallback = '') {
    for (const name of names) {
      const value = metadata(fields?.[name]);
      if (value) return value;
    }
    return fallback;
  }

  function timestampOf(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // Inspect a bounded JSON object, not arbitrary regex matches inside quoted
  // messages or nested fields. Only a top-level approved errorCode leaves here.
  function readBodyCode(tail) {
    const marker = tail.match(/\bRESPONSE BODY\s*:\s*(?=\{)/);
    if (!marker) return null;
    const start = marker.index + marker[0].length;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < tail.length; index++) {
      const character = tail[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === '{') depth++;
      else if (character === '}') {
        depth--;
        if (depth === 0) {
          try {
            const body = JSON.parse(tail.slice(start, index + 1));
            return ERROR_CODES.has(body.errorCode) ? body.errorCode : null;
          } catch (_) { return null; }
        }
      }
    }
    return null;
  }

  function classifyError(record) {
    const fields = fieldsOf(record);
    if (fields.level !== 3 && fields.level !== '3') return null;
    const message = typeof fields.message === 'string' ? fields.message : '';
    const head = message.slice(0, HEAD_LIMIT);
    const truncated = message.length > HEAD_LIMIT;
    const header = head.match(/^\s*(OPENAPI RESPONSE|PARTNER[ _]+BACKEND RESPONSE|ERROR RESPONSE|ERROR|[A-Z0-9][A-Z0-9_. -]{0,127}\s+CLIENT RESPONSE)\s*:\s*(?:\[\d+\]\s*)?\[([1-5]\d\d)(?:\s+[^\]\r\n]*)?\]/i);
    const clientHeader = Boolean(header && /\sCLIENT RESPONSE$/i.test(header[1]));
    const headerStatus = header ? statusOf(header[2]) : null;
    const fieldStatus = statusOf(fields.httpStatus);
    const outerStatus = fieldStatus ?? headerStatus;
    const responseStatus = outerStatus >= 400 ? outerStatus : null;
    const codeField = ERROR_CODES.has(fields.errorCode) ? fields.errorCode : null;
    const tail = header ? head.slice(header[0].length) : '';
    const bodyCode = header ? readBodyCode(tail) : null;
    const errorCode = codeField || bodyCode || 'unknown';
    const conflict = (fieldStatus !== null && headerStatus !== null && fieldStatus !== headerStatus)
      || Boolean(codeField && bodyCode && codeField !== bodyCode);
    const narrative = head.split(/\bRESPONSE BODY\s*:/, 1)[0];
    let errorType = 'unknown';
    let origin = clientHeader ? 'client' : 'unknown';
    let causeStatus = null;
    let exceptionType = 'unknown';
    if (/^\s*(?:ERROR\s*:\s*)?org\.springframework\.dao\.DataIntegrityViolationException\b/.test(narrative)
      && /\bnumeric field overflow\b/i.test(narrative)) {
      errorType = 'db.numeric_overflow'; origin = 'sql'; exceptionType = 'DataIntegrityViolationException';
    } else if (header && responseStatus === 500
      && /\borg\.springframework\.web\.server\.ServerWebInputException\s*:\s*400\s+BAD_REQUEST\b/.test(narrative)
      && /Failed to read HTTP message/.test(narrative)) {
      errorType = 'http.input_unreadable'; origin = clientHeader ? 'client' : 'http'; causeStatus = 400; exceptionType = 'ServerWebInputException';
    } else if (header && /^OPENAPI/i.test(header[1]) && responseStatus === 404) {
      errorType = 'http.not_found'; origin = 'openapi';
    } else if (clientHeader && responseStatus === 400 && errorCode === 'REQUEST_NOT_FOUND') {
      errorType = 'client.request_not_found'; origin = 'client';
    } else if (responseStatus === 500 && errorCode === 'SYSTEM_ERROR' && (header || codeField)) {
      errorType = 'http.system_error'; origin = clientHeader ? 'client' : 'http';
    }
    if (conflict) errorType = 'unknown';
    const timestamp = timestampOf(fields.timestamp);
    return {
      service: firstMetadata(fields, ['service-name', 'service_name', 'serviceName', 'service', 'instance-name'], 'unknown'),
      branch: firstMetadata(fields, ['branch', 'release', 'instance-version']),
      bucket: timestamp === null ? null : Math.floor(timestamp / BUCKET_MS) * BUCKET_MS,
      errorType, origin, responseStatus, causeStatus, exceptionType, errorCode,
      classification: conflict ? 'conflict' : errorType !== 'unknown' ? 'recognized' : truncated ? 'truncated' : 'unknown',
      truncated,
    };
  }

  function createAccumulator() {
    const groups = new Map();
    const totals = { processed: 0, classified: 0, unknown: 0, skipped: 0, invalidTimestamps: 0, truncated: 0, conflicts: 0 };
    return {
      add(event) {
        totals.processed++;
        if (!event || typeof event !== 'object') { totals.skipped++; return; }
        const service = metadata(event.service, 'unknown');
        const errorType = ERROR_TYPES.has(event.errorType) && event.classification === 'recognized' ? event.errorType : 'unknown';
        const branch = metadata(event.branch);
        const bucket = typeof event.bucket === 'number' && Number.isFinite(event.bucket) ? Math.floor(event.bucket / BUCKET_MS) * BUCKET_MS : null;
        if (errorType === 'unknown') totals.unknown++; else totals.classified++;
        if (bucket === null) totals.invalidTimestamps++;
        if (event.truncated) totals.truncated++;
        if (event.classification === 'conflict') totals.conflicts++;
        const key = JSON.stringify([service, errorType]);
        if (!groups.has(key)) groups.set(key, { service, errorType, count: 0, branches: new Set(), buckets: new Map(), invalidTimestamps: 0 });
        const group = groups.get(key);
        group.count++;
        if (branch) group.branches.add(branch);
        if (bucket === null) group.invalidTimestamps++;
        else group.buckets.set(bucket, (group.buckets.get(bucket) || 0) + 1);
      },
      snapshot() {
        const rows = [...groups.values()].map(group => ({
          service: group.service, errorType: group.errorType, count: group.count,
          branches: [...group.branches].sort(), invalidTimestamps: group.invalidTimestamps,
          buckets: [...group.buckets.entries()].sort((a, b) => a[0] - b[0]).map(([time, count]) => ({ time, count })),
        }));
        rows.sort((a, b) => a.service.localeCompare(b.service) || a.errorType.localeCompare(b.errorType));
        return { ...totals, groupCount: rows.length, groups: rows };
      },
    };
  }

  function median(values) {
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  }

  function branchVersion(value) {
    const match = String(value).match(/\d+(?:\.\d+)+/) || String(value).match(/\d+/);
    if (!match) return null;
    const parts = match[0].split('.').map(Number);
    if (!parts.every(Number.isFinite)) return null;
    while (parts.length > 1 && parts.at(-1) === 0) parts.pop();
    return parts.join('.');
  }

  function trendOf(current, history, options) {
    const start = Number(options.startMs);
    const end = Number(options.endMs);
    if (!options.currentComplete || !options.historyComplete) return ['insufficient', 'Для оценки фона нужна полная выборка обоих периодов.'];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > HISTORY_MS) return ['insufficient', 'Нужен корректный текущий период не длиннее суток.'];
    if (current.invalidTimestamps || history?.invalidTimestamps) return ['insufficient', 'Есть события без времени.'];
    const first = Math.ceil(start / BUCKET_MS) * BUCKET_MS;
    const last = Math.floor(end / BUCKET_MS) * BUCKET_MS;
    if (last - first < 3 * BUCKET_MS) return ['insufficient', 'Нужно минимум три полных интервала по 5 минут.'];
    const currentCounts = new Map((current.buckets || []).map(point => [point.time, point.count]));
    const recent = [last - 3 * BUCKET_MS, last - 2 * BUCKET_MS, last - BUCKET_MS].map(time => currentCounts.get(time) || 0);
    const historyCounts = new Map((history?.buckets || []).map(point => [point.time, point.count]));
    const baseline = [];
    // History contract: exactly [startMs - 24h, startMs). Only complete
    // intervals are zero-filled, and only after completeness was established.
    for (let time = Math.ceil((start - HISTORY_MS) / BUCKET_MS) * BUCKET_MS; time + BUCKET_MS <= start; time += BUCKET_MS) baseline.push(historyCounts.get(time) || 0);
    if (baseline.length < 12) return ['insufficient', 'Недостаточно полных интервалов истории.'];
    const typical = median(baseline);
    const mad = median(baseline.map(value => Math.abs(value - typical)));
    const tolerance = Math.max(3, 3 * 1.4826 * mad, typical);
    if (recent.every(value => value >= typical + tolerance)) return ['growth', 'Рост в трёх полных интервалах: выше медианы фона с учётом MAD и абсолютного порога.'];
    const historicalEvents = baseline.reduce((sum, count) => sum + count, 0);
    const nonzeroHistory = baseline.filter(count => count > 0).length;
    if (historicalEvents >= 10 && nonzeroHistory >= 6 && recent.every(value => value > 0 && Math.abs(value - typical) <= tolerance)) {
      return ['stable', 'Три полных интервала сопоставимы с фоном предыдущих суток.'];
    }
    return ['insufficient', 'Недостаточно устойчивых наблюдений для вывода о стабильном фоне или росте.'];
  }

  function compare(currentSnapshot, historySnapshot, options = {}) {
    const currentGroups = currentSnapshot?.groups || [];
    const historyGroups = historySnapshot?.groups || [];
    const history = new Map(historyGroups.map(group => [JSON.stringify([group.service, group.errorType]), group]));
    const uncertainForService = (groups, service) => groups.some(group => group.count > 0
      && (group.service === 'unknown' || (group.service === service && !ERROR_TYPES.has(group.errorType))));
    return currentGroups.map(group => {
      const previousGroup = history.get(JSON.stringify([group.service, group.errorType]));
      const previous = previousGroup?.count || 0;
      const uncertainHistory = historySnapshot?.skipped > 0 || uncertainForService(historyGroups, group.service);
      let novelty = 'unknown';
      let noveltyReason = 'Тип ошибки или владелец не определён; новизна не подтверждена.';
      if (ERROR_TYPES.has(group.errorType) && group.service !== 'unknown') {
        const versions = new Set((group.branches || []).map(branchVersion).filter(value => value !== null));
        if (previous > 0) {
          novelty = 'known'; noveltyReason = 'Такой тип ошибки этого сервиса найден в предыдущие сутки.';
        } else if (options.mode === 'release' && versions.size >= 2) {
          novelty = 'known'; noveltyReason = 'Такой тип ошибки есть у сервиса в нескольких версиях релиза текущего периода.';
        } else if (uncertainHistory) {
          noveltyReason = 'В истории есть нераспознанные ошибки этого сервиса, события без владельца или пропущенные записи; они могут скрывать тот же тип.';
        } else if (options.historyComplete) {
          novelty = 'new'; noveltyReason = 'В полной выборке предыдущих суток этот тип ошибки этого сервиса не найден.';
        } else noveltyReason = 'История неполная; отсутствие совпадения не подтверждает новизну.';
      }
      const [trend, trendReason] = !ERROR_TYPES.has(group.errorType) ? ['insufficient', 'Для неизвестного типа фон не определяется.']
        : uncertainHistory || currentSnapshot?.skipped > 0 || uncertainForService(currentGroups, group.service) ? ['insufficient', 'Нераспознанные ошибки, пропущенные записи или события без владельца не позволяют достоверно оценить фон этого типа.']
        : trendOf(group, previousGroup, options);
      return { service: group.service, errorType: group.errorType, count: group.count, previous, novelty, trend, reason: `${noveltyReason} ${trendReason}` };
    }).sort((a, b) => b.count - a.count || a.service.localeCompare(b.service) || a.errorType.localeCompare(b.errorType));
  }

  const api = { HEAD_LIMIT, BUCKET_MS, classifyError, createAccumulator, compare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.ErrorAnalysis = api;
})();
