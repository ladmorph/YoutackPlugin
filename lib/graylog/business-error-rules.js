(function initializeBusinessErrorRules(root) {
  "use strict";

  const MAX_RULES = 200;
  const MAX_CSV_BYTES = 128 * 1024;
  const PRIORITIES = new Set(["low", "medium", "high"]);
  const CSV_HEADER = ["code", "title", "meaning", "priority"];
  const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

  const DEFAULT_RULES = [
    {
      code: "INSUFFICIENT_FUNDS",
      title: "Недостаточно средств",
      meaning: "Операция отклонена из-за недостаточного доступного остатка.",
      priority: "low"
    },
    {
      code: "BUSINESS_RULE_VIOLATION",
      title: "Нарушено бизнес-правило",
      meaning: "Операция отклонена известным бизнес-правилом.",
      priority: "low"
    },
    { code: "EXAMPLE", title: "Example", meaning: "Example", priority: "low" }
  ];

  let activeRules = freezeRules(DEFAULT_RULES);
  let rulesByCode = buildIndex(activeRules);
  let revision = 0;

  function freezeRules(rules) {
    return Object.freeze(rules.map((rule) => Object.freeze({ ...rule })));
  }

  function buildIndex(rules) {
    return new Map(rules.map((rule) => [rule.code, rule]));
  }

  function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
  }

  function normalize(rule) {
    const code = String(rule?.code || "").trim().toUpperCase();
    const title = String(rule?.title || "").trim();
    const meaning = String(rule?.meaning || "").trim();
    const priority = String(rule?.priority || "low").trim().toLowerCase();

    if (!CODE_PATTERN.test(code)) {
      throw new Error("Код: 2–64 символа A–Z, 0–9 или _; первый символ — буква.");
    }
    if (!title || title.length > 100) {
      throw new Error("Название обязательно и не длиннее 100 символов.");
    }
    if (!meaning || meaning.length > 300) {
      throw new Error("Описание обязательно и не длиннее 300 символов.");
    }
    if (!PRIORITIES.has(priority)) {
      throw new Error("Приоритет должен быть low, medium или high.");
    }

    return { code, title, meaning, priority };
  }

  function normalizeList(rules) {
    if (!Array.isArray(rules) || rules.length > MAX_RULES) {
      throw new Error(`Допустимо не более ${MAX_RULES} правил.`);
    }

    const seen = new Set();
    return rules.map((value) => {
      const rule = normalize(value);
      if (seen.has(rule.code)) throw new Error(`Повтор кода: ${rule.code}`);
      seen.add(rule.code);
      return rule;
    });
  }

  function replace(rules) {
    const normalized = normalizeList(rules);
    activeRules = freezeRules(normalized);
    rulesByCode = buildIndex(activeRules);
    revision += 1;
    return list();
  }

  function list() {
    return activeRules.map((rule) => ({ ...rule }));
  }

  function get(code) {
    const token = typeof code === "string" ? code.trim().toUpperCase() : "";
    const found = rulesByCode.get(token);
    return found ? { ...found } : null;
  }

  function parseRows(text) {
    const source = String(text ?? "").replace(/^\uFEFF/, "");
    if (byteLength(source) > MAX_CSV_BYTES) throw new Error("CSV больше 128 КБ.");

    const normalizedLines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    let quoteClosed = false;

    function finishCell() {
      row.push(cell);
      cell = "";
      quoteClosed = false;
    }

    function finishRow() {
      finishCell();
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    }

    for (let index = 0; index < normalizedLines.length; index += 1) {
      const character = normalizedLines[index];

      if (quoted) {
        if (character === '"' && normalizedLines[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
          quoteClosed = true;
        } else {
          cell += character;
        }
        continue;
      }

      if (quoteClosed && character !== "," && character !== "\n") {
        throw new Error("После закрывающей кавычки ожидается запятая или новая строка.");
      }
      if (character === '"') {
        if (cell) throw new Error("Кавычка допустима только в начале значения CSV.");
        quoted = true;
      } else if (character === ",") {
        finishCell();
      } else if (character === "\n") {
        finishRow();
      } else {
        cell += character;
      }
    }

    if (quoted) throw new Error("В CSV не закрыта кавычка.");
    if (cell || row.length || quoteClosed) finishRow();
    return rows;
  }

  function parseCsv(text) {
    const rows = parseRows(text);
    if (!rows.length) return [];

    const header = rows.shift().map((value) => value.trim().toLowerCase());
    if (header.length !== CSV_HEADER.length || header.some((value, index) => value !== CSV_HEADER[index])) {
      throw new Error(`Ожидается заголовок: ${CSV_HEADER.join(",")}`);
    }
    if (rows.length > MAX_RULES) throw new Error(`Допустимо не более ${MAX_RULES} правил.`);

    const rules = rows.map((values, index) => {
      if (values.length !== CSV_HEADER.length) {
        throw new Error(`Строка ${index + 2}: ожидается 4 колонки.`);
      }
      return {
        code: values[0],
        title: values[1],
        meaning: values[2],
        priority: values[3]
      };
    });
    return normalizeList(rules);
  }

  function quote(value) {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function toCsv(rules = activeRules) {
    const rows = normalizeList(rules).map((rule) => (
      [rule.code, rule.title, rule.meaning, rule.priority].map(quote).join(",")
    ));
    return [CSV_HEADER.join(","), ...rows].join("\r\n") + "\r\n";
  }

  const api = Object.freeze({
    MAX_RULES,
    MAX_CSV_BYTES,
    defaults: freezeRules(DEFAULT_RULES),
    normalize,
    replace,
    list,
    get,
    parseCsv,
    toCsv,
    get revision() {
      return revision;
    }
  });

  root.BusinessErrorRules = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
