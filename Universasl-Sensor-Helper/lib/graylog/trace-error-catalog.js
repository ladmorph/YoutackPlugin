(function initializeTraceErrorCatalog() {
  'use strict';

  const HEAD_LIMIT = 4096;
  const RESPONSE_TEXT_LIMIT = 240;
  // Only this application's explicit exception header can supply display prose.
  // Mask before truncating, so a value crossing the display boundary cannot leak.
  function safeResponseText(value) {
    if (typeof value !== 'string') return '';
    return value.slice(0, HEAD_LIMIT).split(/\r|\n|\b(?:(?:REQUEST|RESPONSE)\s+)?BODY\s*:|\b(?:HEADERS|Caused by)\s*:|\s+at\s+[\w.$]+\(|[{}]/i, 1)[0]
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?/g, '[masked]')
      .replace(/\b(?:https?|redis|rediss):\/\/[^\s;,]+/gi, '[masked]')
      .replace(/(?:^|\s)\/[^\s;,]+/g, ' [masked]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[masked]')
      .replace(/\b(?:Bearer|Basic)\s+[^\s;,]+/gi, '[masked]')
      .replace(/\b([\w.-]*(?:id|uuid|guid|token|secret|password|passwd|credential|authorization|cookie|key|session|account|phone|email|login|username)[\w.-]*)\b\s*(?::|=)\s*(?:\[masked\]|[^\s;,]+)/gi, '$1=[masked]')
      .replace(/\b(?:id|uuid|guid|token|secret|password|session)\s+(?:is\s+)?(?:\[masked\]|[^\s;,]+)/gi, '[masked]')
      .replace(/\b\w+(?:Id|ID|Uuid|UUID|Token|Key)\s+(?:\[masked\]|[^\s;,]+)/g, '[masked]')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[masked]')
      .replace(/\b[0-9a-f]{16,}\b/gi, '[masked]')
      .replace(/\b(?=[\w.-]*\d)[\w.-]+\b/g, '[masked]')
      .replace(/\b[A-Za-z0-9_+/=-]{40,}\b/g, '[masked]')
      .replace(/\s+/g, ' ').trim().slice(0, RESPONSE_TEXT_LIMIT);
  }
  const rules = {
    'java.null_pointer': ['java', 'Обращение к null', 'medium', 'Известное исключение NullPointerException указывает на обращение к отсутствующему объекту.', 'Проверить контракт данных и обработку null в месте возникновения; частоту и влияние оценить отдельно.'],
    'java.out_of_memory': ['java', 'Недостаточно памяти JVM', 'high', 'OutOfMemoryError может затронуть обработку других запросов процесса.', 'Проверить состояние процесса, лимиты памяти и динамику heap; причину утечки или нехватки ресурсов устанавливать отдельно.'],
    'java.stack_overflow': ['java', 'Переполнение стека JVM', 'high', 'StackOverflowError означает исчерпание стека выполнения; повторяемый путь может снова завершаться ошибкой.', 'Проверить рекурсию и глубину вызовов; высокий приоритет расследования не доказывает недоступность всего сервиса.'],
    'db.numeric_overflow': ['sql', 'SQL: числовое значение вне диапазона', 'medium', 'Распознан код или диагностический маркер числового переполнения.', 'Сверить диапазон входного значения с типом и точностью столбца; не выводить сами значения или SQL.'],
    'db.unique_violation': ['sql', 'SQL: нарушение уникальности', 'medium', 'Распознано нарушение ограничения уникальности; это может быть конфликт данных или гонка.', 'Проверить идемпотентность, конкурирующие записи и бизнес-обработку дубликата; не считать повтор безопасным автоматически.'],
    'db.foreign_key_violation': ['sql', 'SQL: нарушение внешнего ключа', 'medium', 'Распознано нарушение ссылочной целостности.', 'Проверить порядок операций и существование связанной сущности без раскрытия её идентификатора.'],
    'db.not_null_violation': ['sql', 'SQL: отсутствует обязательное значение', 'medium', 'Распознано нарушение ограничения NOT NULL.', 'Проверить валидацию и преобразование обязательных полей до записи.'],
    'db.deadlock': ['sql', 'SQL: взаимная блокировка', 'medium', 'База обнаружила deadlock; одно событие не доказывает массовый сбой.', 'Проверить порядок блокировок и повторяемость. При повторе требуется заново выполнить всю транзакцию с учётом идемпотентности.'],
    'db.serialization_failure': ['sql', 'SQL: конфликт сериализации транзакций', 'medium', 'Распознан конфликт конкурентных транзакций, а не ошибка десериализации сообщения.', 'Проверить предусмотренный приложением ограниченный повтор всей транзакции и корректность операций при конкуренции.'],
    'db.connection_failure': ['sql', 'SQL: ошибка подключения', 'high', 'Не удалось установить или сохранить соединение с базой; проблема может затронуть несколько запросов.', 'Проверить доступность базы, соединения и пул; масштаб отказа подтвердить метриками.'],
    'db.resource_exhausted': ['sql', 'SQL: исчерпан ресурс базы', 'high', 'Распознан код нехватки соединений, памяти, диска или превышения ограничения ресурса.', 'Проверить соответствующие лимиты и загрузку базы; не увеличивать частоту повторов автоматически.'],
    'db.query_timeout': ['sql', 'SQL: превышено время выполнения', 'medium', 'Таймаут подтверждён известным исключением или конкретным маркером statement timeout.', 'Проверить блокировки, длительность и план запроса; один таймаут не доказывает перегрузку базы.'],
    'db.query_cancelled': ['sql', 'SQL: запрос отменён', 'low', 'Код query_canceled не различает отмену пользователем и таймаут.', 'Сначала выяснить источник отмены. Повысить приоритет при подтверждённом влиянии на пользовательские операции.'],
    'db.integrity_violation': ['sql', 'SQL: нарушение целостности данных', 'medium', 'Известна обёртка исключения целостности, но конкретное ограничение не определено.', 'Найти SQLSTATE или конкретную причину в исходном Graylog; тип ограничения не угадывается.'],
    'http.input_unreadable': ['http', 'HTTP: не удалось прочитать запрос', 'medium', 'Распознана ошибка чтения входного HTTP-сообщения.', 'Проверить формат входных данных и соответствие внешнего HTTP-ответа причине; код 500 и причина 400 различаются.'],
    'http.transport_failure': ['network', 'Сбой сетевого соединения', 'medium', 'Известное сетевое исключение подтверждает сбой подключения или ожидания.', 'Проверить доступность зависимости и таймауты; единичное событие не доказывает отказ всей зависимости.'],
  };
  const sqlStates = {
    '22003': 'db.numeric_overflow', '23505': 'db.unique_violation', '23503': 'db.foreign_key_violation', '23502': 'db.not_null_violation',
    '40P01': 'db.deadlock', '40001': 'db.serialization_failure', '08001': 'db.connection_failure', '08003': 'db.connection_failure', '08006': 'db.connection_failure',
    '53100': 'db.resource_exhausted', '53200': 'db.resource_exhausted', '53300': 'db.resource_exhausted', '53400': 'db.resource_exhausted', '57014': 'db.query_cancelled',
  };
  const exceptionRules = {
    'java.lang.NullPointerException': 'java.null_pointer', 'java.lang.OutOfMemoryError': 'java.out_of_memory', 'java.lang.StackOverflowError': 'java.stack_overflow',
    'org.springframework.dao.DataIntegrityViolationException': 'db.integrity_violation', 'java.sql.SQLIntegrityConstraintViolationException': 'db.integrity_violation',
    'org.springframework.dao.DuplicateKeyException': 'db.unique_violation', 'org.springframework.dao.DeadlockLoserDataAccessException': 'db.deadlock',
    'org.springframework.dao.CannotSerializeTransactionException': 'db.serialization_failure',
    'org.springframework.dao.DataAccessResourceFailureException': null, 'org.springframework.jdbc.CannotGetJdbcConnectionException': 'db.connection_failure',
    'java.sql.SQLNonTransientConnectionException': 'db.connection_failure', 'java.sql.SQLTransientConnectionException': 'db.connection_failure',
    'org.springframework.dao.QueryTimeoutException': 'db.query_timeout', 'java.sql.SQLTimeoutException': 'db.query_timeout',
    'org.springframework.web.server.ServerWebInputException': 'http.input_unreadable',
    'java.net.ConnectException': 'http.transport_failure', 'java.net.SocketTimeoutException': 'http.transport_failure',
    'java.sql.SQLException': null, 'org.postgresql.util.PSQLException': null,
  };
  const knownExceptions = new Map();
  for (const name of Object.keys(exceptionRules)) { knownExceptions.set(name, name); knownExceptions.set(name.slice(name.lastIndexOf('.') + 1), name); }
  const exceptionPattern = /^([A-Za-z_$][\w.$]{0,180}(?:Exception|Error))(?=\s*:|\s*$)/;

  // Graylog exposes the syslog severity under several field-name aliases
  // depending on the pipeline; a record logged under one of the non-default
  // aliases must still be recognized as level 3. Shared with
  // GraylogTraceFetch's hasLevel3() so both agree on what counts as an error.
  const LEVEL3_FIELD_ALIASES = new Set(['level', 'loglevel', 'sysloglevel', 'severitylevel']);
  function fieldsHaveLevel3(container) {
    if (!container || typeof container !== 'object' || Array.isArray(container)) return false;
    // Object.entries материализует значения всех полей ещё до фильтрации по
    // имени, то есть трогает message у каждой записи, включая заведомо
    // не-ошибки. Читаем значение только у подходящего ключа.
    for (const key of Object.keys(container)) {
      if (!LEVEL3_FIELD_ALIASES.has(String(key).toLowerCase().replace(/[^a-z]/g, ''))) continue;
      const rawValue = container[key];
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      if (values.some((value) => typeof value !== 'boolean' && String(value).trim() !== '' && Number(value) === 3)) return true;
    }
    return false;
  }
  function isLevel3(...records) {
    for (const record of records) {
      if (!record || typeof record !== 'object') continue;
      const containers = [record, record.fields, record._source].filter((value) => value && typeof value === 'object' && !Array.isArray(value));
      if (containers.some(fieldsHaveLevel3)) return true;
    }
    return false;
  }

  // TraceErrorGraph needs the display title for a recognized db.* errorType
  // without duplicating this table itself.
  function titleFor(errorType) {
    return typeof errorType === 'string' && Object.hasOwn(rules, errorType) ? rules[errorType][1] : null;
  }

  function unknown(truncated, status, conflict = false) {
    return { category: 'unknown', errorType: 'unknown', title: conflict ? 'Противоречивые признаки ошибки' : 'Тип ошибки не определён', priority: 'unknown', confidence: 'low',
      reason: conflict ? 'Допустимые признаки указывают на разные причины; приоритет автоматически не выбран.' : 'Одного level 3 недостаточно для определения причины и приоритета.',
      recommendation: 'Проверить исходное событие и контекст в Graylog; неизвестный тип не означает отсутствие проблемы.',
      exceptionType: 'unknown', sqlState: null, status, matchedRule: conflict ? 'conflicting_evidence' : 'unrecognized', truncated };
  }

  function stripLogPrefix(line) {
    let value = line.trim();
    value = value.replace(/^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?\]?\s+/, '');
    value = value.replace(/^(?:ERROR|WARN|INFO|DEBUG|TRACE)\s+(?:\[[^\]\r\n]{0,160}\]\s*)?(?:[A-Za-z_$][\w.$]{0,160}\s+-\s+)?/, '');
    return value;
  }

  function safeStatus(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const code = Number(value);
    return Number.isInteger(code) && code >= 100 && code <= 599 ? code : null;
  }

  function allowedState(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(sqlStates, value.toUpperCase()) ? value.toUpperCase() : null;
  }

  function responseCode(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return /^[A-Z][A-Z0-9_]{1,63}$/.test(normalized) ? normalized : null;
  }

  function omitQuotedValues(value) {
    let result = '', quote = null;
    for (let index = 0; index < value.length; index++) {
      const character = value[index];
      if (quote) {
        if (character === '\\') index++;
        else if (character === quote) {
          if (value[index + 1] === quote) index++;
          else quote = null;
        }
      } else if (character === '"' || character === "'") { quote = character; result += ' '; }
      else result += character;
    }
    return result;
  }

  function classify(record) {
    const fields = record && typeof record === 'object' ? Object.prototype.hasOwnProperty.call(record, 'level') ? record : record.message && typeof record.message === 'object' ? record.message : record : {};
    if (!fieldsHaveLevel3(fields)) return null;
    const text = typeof fields.message === 'string' ? fields.message : '';
    const truncated = text.length > HEAD_LIMIT;
    // Bodies are never parsed, including healthy responses and nested errors.
    const head = text.slice(0, HEAD_LIMIT).split(/\b(?:(?:REQUEST|RESPONSE)\s+)?BODY\s*:/i, 1)[0];
    const lines = head.split(/\r?\n/);
    let first = stripLogPrefix(lines[0] || '');
    const header = first.match(/^(?:ERROR(?: RESPONSE)?|OPENAPI RESPONSE|[A-Z0-9][A-Z0-9_. -]{0,127}\s+CLIENT RESPONSE)\s*:\s*(?:\[\d+\]\s*)?\[([1-5]\d\d)(?:\s+[^\]\r\n]*)?\]\s*/i);
    const fieldStatus = safeStatus(fields.httpStatus);
    const headerStatus = header ? safeStatus(header[1]) : null;
    const status = fieldStatus ?? headerStatus;
    if (fieldStatus !== null && headerStatus !== null && fieldStatus !== headerStatus) return unknown(truncated, status, true);
    if (header) first = first.slice(header[0].length).replace(/^(?:\[\/[^\]\r\n]{0,512}\]|\/[^\s\r\n]{0,512})\s*/, '');
    else first = first.replace(/^ERROR\s*:\s*/, '');
    const root = first.match(exceptionPattern);
    const chainApi=typeof module!=='undefined'&&module.exports?require('./exception-chain'):globalThis.GraylogExceptionChain;
    const candidates=chainApi?.primaryHeaders ? chainApi.primaryHeaders(head).map(item=>({name:item.name,text:item.diagnostic}))
      : root ? [{name:root[1],text:first.slice(root[0].length)}] : [];
    const structured = knownExceptions.get(fields.exceptionType) || knownExceptions.get(fields.exception_type);
    if (!candidates.length && structured) candidates.push({ name: structured, text: '' });
    const selected = [...candidates].reverse().find(candidate => knownExceptions.has(candidate.name));
    const exceptionName = selected ? knownExceptions.get(selected.name) : null;
    const exceptionType = exceptionName ? exceptionName.slice(exceptionName.lastIndexOf('.') + 1) : 'unknown';
    const databaseContext = exceptionName && (exceptionName.startsWith('java.sql.') || exceptionName.startsWith('org.postgresql.') || exceptionName.startsWith('org.springframework.dao.') || exceptionName.startsWith('org.springframework.jdbc.'));
    // Restrict text heuristics to the diagnostic part of a real DB exception.
    // Do not inspect SQL statements, Detail values, quoted error payloads or frames.
    const diagnostic = databaseContext ? omitQuotedValues(selected.text.split(/\bDetail\s*:|\[\s*(?:insert|update|delete|select|merge)\b|;\s*SQL\b/i, 1)[0]) : '';
    const fieldState = allowedState(fields.sqlState ?? fields.sqlstate ?? fields.SQLState);
    const diagnosticStates = [...diagnostic.matchAll(/\bSQLSTATE\s*[:=]\s*\[?([0-9A-Z]{5})\]?\b/gi)].map(match => allowedState(match[1])).filter(Boolean);
    const states = [...new Set([fieldState, ...diagnosticStates].filter(Boolean))];
    const stateTypes = [...new Set(states.map(state => sqlStates[state]))];
    if (stateTypes.length > 1) return unknown(truncated, status, true);
    let errorType = exceptionName ? exceptionRules[exceptionName] : null;
    let confidence = errorType ? 'high' : 'low';
    let matchedRule = errorType ? 'known_exception' : 'unrecognized';
    const phraseRules = [
      [/\bnumeric field overflow\b/i, 'db.numeric_overflow'],
      [/\bduplicate key value violates unique constraint\b/i, 'db.unique_violation'],
      [/\bviolates foreign key constraint\b/i, 'db.foreign_key_violation'],
      [/\bviolates not-null constraint\b/i, 'db.not_null_violation'],
      [/\bdeadlock detected\b/i, 'db.deadlock'],
      [/\bcould not serialize access\b/i, 'db.serialization_failure'],
      [/\btoo many (?:clients|connections)\b/i, 'db.resource_exhausted'],
      [/\bcanceling statement due to statement timeout\b/i, 'db.query_timeout'],
    ];
    const phraseTypes = [...new Set(phraseRules.filter(([pattern]) => pattern.test(diagnostic)).map(([, type]) => type))];
    if (phraseTypes.length > 1) return unknown(truncated, status, true);
    const stateType = stateTypes[0];
    const phraseType = phraseTypes[0];
    // Application prose is accepted only after this exact exception header and
    // outside BODY. The response code is a bounded UPPER_SNAKE token at the very
    // beginning of the tail; arbitrary prose and nested payloads cannot supply it.
    const application = [...candidates].reverse().find(candidate => candidate.name === 'ru.online.banking.commons.webflux.ResponseCodeException' && /^\s*:/.test(candidate.text));
    if (application) {
      const rawTail = application.text.replace(/^\s*:\s*/, '');
      const codeMatch = rawTail.match(/^([A-Z][A-Z0-9_]{1,63})(?=\s*(?:;|$))/);
      const parsedCode = responseCode(codeMatch?.[1]);
      const structuredCode = responseCode(fields.errorCode);
      if (stateType || errorType || (parsedCode && structuredCode && parsedCode !== structuredCode)) return unknown(truncated, status, true);
      const exceptionMessage = safeResponseText(rawTail);
      const messageTruncated = rawTail.length > RESPONSE_TEXT_LIMIT;
      const redisContext = /\bRedis\b/i.test(exceptionMessage);
      return {
        category:redisContext ? 'redis' : 'application',
        errorType:redisContext ? 'application.response_code.redis_context' : 'application.response_code',
        title:'ResponseCodeException',priority:'medium',confidence:'high',
        reason:redisContext
          ? 'Текст ResponseCodeException содержит явное упоминание Redis. Это подтверждает только диагностический контекст зависимости; команда, ответ и доступность Redis не установлены.'
          : 'Приложение записало ResponseCodeException. Текст исключения показан с маскированием; тип зависимости и причина отдельно не устанавливаются.',
        recommendation:'Сопоставьте код ответа и сообщение исключения с контекстом span и правилами приложения.',
        exceptionType:'ResponseCodeException',exceptionMessage,responseCode:parsedCode,
        sqlState:null,status,matchedRule:redisContext ? 'application.response_code.redis_context' : 'application.response_code',
        truncated:truncated || messageTruncated
      };
    }
    if (stateType && errorType && !errorType.startsWith('db.')) return unknown(truncated, status, true);
    if (stateType && errorType && !['db.integrity_violation', 'db.query_timeout'].includes(errorType) && errorType !== stateType) return unknown(truncated, status, true);
    if (phraseType && errorType && errorType !== 'db.integrity_violation' && errorType !== phraseType) return unknown(truncated, status, true);
    if (stateType && phraseType && stateType !== phraseType && !(stateType === 'db.query_cancelled' && phraseType === 'db.query_timeout')) return unknown(truncated, status, true);
    if (stateType) {
      errorType = stateType === 'db.query_cancelled' && (phraseType === 'db.query_timeout' || errorType === 'db.query_timeout') ? 'db.query_timeout' : stateType;
      confidence = 'high'; matchedRule = errorType === 'db.query_timeout' ? 'sqlstate_and_timeout' : 'allowed_sqlstate';
    } else if (phraseType) { errorType = phraseType; confidence = 'medium'; matchedRule = 'db_diagnostic_marker'; }
    if (!errorType || !rules[errorType]) return unknown(truncated, status);
    // A simple ServerWebInputException does not prove the specific unreadable
    // HTTP-message case; require its known cause phrase outside BODY.
    if (errorType === 'http.input_unreadable' && !/\bFailed to read HTTP message\b/.test(selected?.text || '')) return unknown(truncated, status);
    const [category, title, priority, reason, recommendation] = rules[errorType];
    return { category, errorType, title, priority, confidence, reason, recommendation, exceptionType, sqlState: states[0] || null, status, matchedRule, truncated };
  }

  const api = Object.freeze({ HEAD_LIMIT, RESPONSE_TEXT_LIMIT, safeResponseText, classify, isLevel3, fieldsHaveLevel3, titleFor });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.TraceErrorCatalog = api;
})();
