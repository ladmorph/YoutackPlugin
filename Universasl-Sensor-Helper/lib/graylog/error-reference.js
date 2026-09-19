(function initializeErrorReference(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const entries = Object.freeze([
    ...(node ? require('./java-error-reference') : root.JavaErrorReference || []),
    ...(node ? require('./integration-error-reference') : root.IntegrationErrorReference || []),
    ...(node ? require('./postgres-error-reference') : root.PostgresErrorReference || []),
    ...(node ? require('./kafka-error-reference') : root.KafkaErrorReference || []),
  ]);
  const catalogApi = node ? require('./trace-error-catalog') : root.TraceErrorCatalog;
  const HEAD_LIMIT = 4096;
  const byException = new Map(), byState = new Map(), byOracle = new Map(), byId = new Map();
  const simpleKnown = new Set(['SQLException', 'PSQLException', 'DataIntegrityViolationException', 'DuplicateKeyException', 'SQLIntegrityConstraintViolationException', 'SQLTimeoutException', 'QueryTimeoutException']);
  const canonicalDatabase = new Set(['java.sql.SQLException', 'java.sql.SQLIntegrityConstraintViolationException', 'java.sql.SQLTimeoutException', 'org.postgresql.util.PSQLException', 'org.springframework.dao.DataIntegrityViolationException', 'org.springframework.dao.DuplicateKeyException', 'org.springframework.dao.QueryTimeoutException', 'org.hibernate.exception.ConstraintViolationException', 'org.hibernate.exception.GenericJDBCException', 'org.hibernate.exception.SQLGrammarException', 'org.hibernate.exception.JDBCConnectionException']);
  for (const entry of entries) {
    byId.set(entry.id, entry);
    for (const code of entry.sqlStates || []) byState.set(code, entry);
    for (const code of entry.oracleCodes || []) byOracle.set(code, entry);
    for (const name of entry.exceptions || []) {
      byException.set(name, entry); simpleKnown.add(name);
      const sourcePath = entry.source.split('/api/java.base/')[1] || entry.source.split('/javadoc-api/')[1] || entry.source.split('/src/main/java/')[1] || entry.source.split('/api/')[1];
      if (sourcePath) byException.set(sourcePath.replace(/\.(?:html|java)$/, '').replaceAll('/', '.'), entry);
    }
  }
  const oldToReference = {
    'db.numeric_overflow': 'postgres.numeric', 'db.unique_violation': 'postgres.unique', 'db.foreign_key_violation': 'postgres.foreign_key',
    'db.not_null_violation': 'postgres.not_null', 'db.deadlock': 'postgres.deadlock', 'db.serialization_failure': 'postgres.serialization',
    'db.query_cancelled': 'postgres.cancelled',
  };
  const compatible = {
    'db.numeric_overflow': new Set(['postgres.numeric', 'oracle.numeric_precision']),
    'db.unique_violation': new Set(['postgres.unique', 'oracle.unique']),
    'db.foreign_key_violation': new Set(['postgres.foreign_key', 'oracle.parent_missing', 'oracle.child_exists']),
    'db.not_null_violation': new Set(['postgres.not_null', 'oracle.not_null']),
    'db.deadlock': new Set(['postgres.deadlock', 'oracle.deadlock']),
    'db.serialization_failure': new Set(['postgres.serialization']),
    'db.connection_failure': new Set(['postgres.connect', 'postgres.connection_failure', 'oracle.connect_identifier', 'oracle.service_unregistered', 'oracle.no_listener']),
    'db.resource_exhausted': new Set(['postgres.connections', 'postgres.disk', 'postgres.memory']),
    'db.query_timeout': new Set(['postgres.cancelled']), 'db.query_cancelled': new Set(['postgres.cancelled']),
  };
  function fieldsOf(record) {
    if (!record || typeof record !== 'object') return {};
    return Object.prototype.hasOwnProperty.call(record, 'level') ? record : record.message && typeof record.message === 'object' ? record.message : record;
  }
  function stripPrefix(line) {
    return line.trim().replace(/^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?\]?\s+/, '')
      .replace(/^(?:ERROR|WARN|INFO|DEBUG|TRACE)\s+(?:\[[^\]\r\n]{0,160}\]\s*)?(?:[A-Za-z_$][\w.$]{0,160}\s+-\s+)?/, '');
  }
  function omitQuoted(value) {
    let result = '', quote = null;
    for (let index = 0; index < value.length; index++) {
      const character = value[index];
      if (quote) {
        if (character === '\\') index++;
        else if (character === quote) { if (value[index + 1] === quote) index++; else quote = null; }
      } else if (character === '"' || character === "'") { quote = character; result += ' '; }
      else result += character;
    }
    return result;
  }
  const tokenPattern = /^([A-Za-z_$][\w.$]{0,180}(?:Exception|Error))(?=\s*:|\s*$)/;
  function parseEvidence(record) {
    const fields = fieldsOf(record);
    const message = typeof fields.message === 'string' ? fields.message : '';
    const lines = message.slice(0, HEAD_LIMIT).split(/\b(?:(?:REQUEST|RESPONSE)\s+)?BODY\s*:/i, 1)[0].split(/\r?\n/);
    let first = stripPrefix(lines[0] || '');
    const header = first.match(/^(?:ERROR(?: RESPONSE)?|OPENAPI(?:\s+\d+(?:\.\d+)*)? RESPONSE|PARTNER[ _]+BACKEND RESPONSE|[A-Z0-9][A-Z0-9_. -]{0,127}\s+CLIENT RESPONSE)\s*:\s*(?:\[\d+\]\s*)?\[([1-5]\d\d)(?:\s+[^\]\r\n]*)?\]\s*/i);
    if (header) first = first.slice(header[0].length).replace(/^(?:\[\/[^\]\r\n]{0,512}\]|\/[^\s\r\n]{0,512})\s*/, '');
    else first = first.replace(/^ERROR\s*:\s*/, '');
    const rootToken = first.match(tokenPattern);
    const chainApi=node?require('./exception-chain'):root.GraylogExceptionChain;
    const chain=chainApi?.primaryHeaders ? chainApi.primaryHeaders(message.slice(0,HEAD_LIMIT))
      : rootToken ? [{name:rootToken[1],diagnostic:first.slice(rootToken[0].length)}] : [];
    const structured = fields.exceptionType ?? fields.exception_type;
    if (!chain.length && typeof structured === 'string' && (byException.has(structured) || canonicalDatabase.has(structured) || simpleKnown.has(structured))) chain.push({ name: structured, diagnostic: '' });
    const database = chain.filter(item => canonicalDatabase.has(item.name) || (simpleKnown.has(item.name) && /^(?:SQL|PSQL|DataIntegrity|DuplicateKey|QueryTimeout)/.test(item.name)));
    const diagnostics = database.map(item => omitQuoted(item.diagnostic.split(/\bDetail\s*:|\[\s*(?:insert|update|delete|select|merge)\b|;\s*SQL\b/i, 1)[0]));
    // A standalone database code is accepted only at the event start.
    if (!rootToken && /^(?:ORA-\d{5}(?![\w-])|SQLSTATE\s*[:=])/i.test(first)) diagnostics.push(omitQuoted(first.split(/\bDetail\s*:|\[\s*(?:insert|update|delete|select|merge)\b|;\s*SQL\b/i, 1)[0]));
    const states = new Set(), oracles = new Set();
    const add = (map, set, value) => { if (typeof value === 'string' && map.has(value.toUpperCase())) set.add(value.toUpperCase()); };
    add(byState, states, fields.sqlState ?? fields.sqlstate ?? fields.SQLState);
    add(byOracle, oracles, fields.oracleCode ?? fields.oraCode ?? fields.errorCode);
    for (const diagnostic of diagnostics) {
      for (const match of diagnostic.matchAll(/\bSQLSTATE\s*[:=]\s*\[?([0-9A-Z]{5})(?![\w-])/gi)) add(byState, states, match[1]);
      for (const match of diagnostic.matchAll(/(?<![\w-])(ORA-\d{5})(?![\w-])/g)) add(byOracle, oracles, match[1]);
    }
    return { chain, states: [...states], oracles: [...oracles], truncated: message.length > HEAD_LIMIT };
  }
  function emptyFields() { return { referenceId: null, meaning: '', causes: [], checks: [], source: null, oracleCode: null }; }
  function conflict(base) {
    return { ...base, ...emptyFields(), category: 'unknown', errorType: 'unknown', title: 'Противоречивые признаки ошибки', priority: 'unknown', confidence: 'low',
      reason: 'Коды или известные причины противоречат друг другу; автоматическое объяснение не выбрано.', recommendation: 'Проверьте исходное событие и цепочку причин в Graylog.',
      exceptionType: 'unknown', exceptionMessage: '', sqlState: null, matchedRule: 'conflicting_evidence' };
  }
  function classify(record, suppliedCatalog) {
    const fields = fieldsOf(record);
    if (fields.level !== 3 && fields.level !== '3') return null;
    const base = suppliedCatalog || catalogApi?.classify(record) || { category: 'unknown', errorType: 'unknown', title: 'Тип ошибки не определён', priority: 'unknown', confidence: 'low', reason: 'Недостаточно признаков.', recommendation: 'Проверьте исходное событие в Graylog.', exceptionType: 'unknown', sqlState: null, status: null, matchedRule: 'unrecognized', truncated: false };
    if (base.matchedRule === 'conflicting_evidence') return { ...base, ...emptyFields() };
    const evidence = parseEvidence(record);
    const refs = [...evidence.states.map(code => byState.get(code)), ...evidence.oracles.map(code => byOracle.get(code))];
    if (new Set(refs.map(entry => entry.id)).size > 1) return conflict(base);
    let reference = refs[0] || null;
    let picked = null;
    for (let index = evidence.chain.length - 1; index >= 0; index--) {
      const candidate = evidence.chain[index];
      if (base.priority !== 'unknown' && base.exceptionType !== 'unknown' && candidate.name.split('.').at(-1) === base.exceptionType && !byException.has(candidate.name)) break;
      if (byException.has(candidate.name)) { picked = candidate; break; }
    }
    if (reference && picked && !['spring.bean_creation', 'webflux.client_response', 'webflux.client_request'].includes(byException.get(picked.name).id)) return conflict(base);
    const hasSpecificCatalog = base.priority !== 'unknown' && base.errorType !== 'db.integrity_violation';
    if (reference && hasSpecificCatalog && (!compatible[base.errorType] || !compatible[base.errorType].has(reference.id))) return conflict(base);
    if (!reference && picked) reference = byException.get(picked.name);
    if (!reference && oldToReference[base.errorType] && base.matchedRule === 'db_diagnostic_marker' && evidence.chain.some(item => item.name === 'org.postgresql.util.PSQLException' || item.name === 'PSQLException')) reference = byId.get(oldToReference[base.errorType]);
    if (!reference) return { ...base, ...emptyFields(), truncated: base.truncated || evidence.truncated };
    if (picked && hasSpecificCatalog && base.exceptionType !== 'unknown' && picked.name.split('.').at(-1) !== base.exceptionType) return conflict(base);
    // Specific SQL phrases and input-reading causes remain precise. The static
    // reference supplements them instead of replacing them with a wrapper.
    const preserve = hasSpecificCatalog && base.errorType !== 'http.transport_failure'
      && (!refs.length || ['db_diagnostic_marker', 'sqlstate_and_timeout'].includes(base.matchedRule));
    const exceptionType = picked ? picked.name.split('.').at(-1) : base.exceptionType;
    return { ...base,
      category: preserve ? base.category : reference.category,
      errorType: preserve ? base.errorType : reference.id,
      title: preserve ? base.title : reference.title,
      priority: preserve ? base.priority : reference.priority,
      confidence: preserve ? base.confidence : 'high',
      reason: preserve ? base.reason : reference.meaning,
      recommendation: preserve ? base.recommendation : reference.checks.join(' '),
      exceptionType, sqlState: evidence.states[0] || base.sqlState, oracleCode: evidence.oracles[0] || null,
      matchedRule: preserve ? base.matchedRule : refs.length ? 'reference_database_code' : 'reference_exception',
      truncated: base.truncated || evidence.truncated,
      referenceId: reference.id, meaning: reference.meaning, causes: [...reference.causes], checks: [...reference.checks], source: reference.source,
    };
  }
  const api = Object.freeze({ HEAD_LIMIT, entries, classify });
  if (node) module.exports = api;
  root.ErrorReference = api;
})(globalThis);
