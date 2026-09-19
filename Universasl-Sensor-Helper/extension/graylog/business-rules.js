(function initializeBusinessRulesUi(root) {
  "use strict";

  const rulesApi = root.BusinessErrorRules;
  if (!rulesApi || typeof document === "undefined") return;

  const ui = {
    form: document.querySelector("#business-rule-form"),
    code: document.querySelector("#business-rule-code"),
    title: document.querySelector("#business-rule-title"),
    meaning: document.querySelector("#business-rule-meaning"),
    priority: document.querySelector("#business-rule-priority"),
    list: document.querySelector("#business-rules-list"),
    empty: document.querySelector("#business-rules-empty"),
    error: document.querySelector("#business-rules-error"),
    file: document.querySelector("#business-rules-file"),
    importButton: document.querySelector("#import-business-rules"),
    exportButton: document.querySelector("#export-business-rules")
  };
  if (Object.values(ui).some((element) => !element)) return;

  const PRIORITY_LABELS = Object.freeze({
    low: "Низкий",
    medium: "Средний",
    high: "Высокий"
  });

  function showError(value) {
    ui.error.textContent = value?.message || String(value);
    ui.error.hidden = false;
  }

  function clearError() {
    ui.error.textContent = "";
    ui.error.hidden = true;
  }

  async function syncRules() {
    try {
      const reply = await chrome.runtime.sendMessage({ type:"set-business-error-rules", rules:rulesApi.list() });
      if (!reply?.synced) throw new Error("Не удалось передать бизнес-правила локальному анализатору.");
    } catch (error) {
      showError(error);
    }
  }

  function ruleRow(rule) {
    const row = document.createElement("div");
    const code = document.createElement("code");
    const title = document.createElement("strong");
    const meaning = document.createElement("span");
    const priority = document.createElement("span");
    const remove = document.createElement("button");

    row.className = "business-rule-row";
    code.textContent = rule.code;
    title.textContent = rule.title;
    meaning.className = "business-meaning";
    meaning.textContent = rule.meaning;
    priority.textContent = PRIORITY_LABELS[rule.priority] || rule.priority;
    remove.type = "button";
    remove.className = "secondary compact";
    remove.textContent = "Удалить";
    remove.dataset.code = rule.code;
    remove.setAttribute("aria-label", `Удалить правило ${rule.code}`);
    row.append(code, title, meaning, priority, remove);
    return row;
  }

  function render() {
    const rules = rulesApi.list();
    ui.list.replaceChildren(...rules.map(ruleRow));
    ui.empty.hidden = rules.length > 0;
    void syncRules();
  }

  function addRule() {
    const nextRules = rulesApi.list();
    nextRules.push({
      code: ui.code.value,
      title: ui.title.value,
      meaning: ui.meaning.value,
      priority: ui.priority.value
    });
    rulesApi.replace(nextRules);
  }

  async function loadBundledRules() {
    const initialRevision = rulesApi.revision;
    try {
      const url = chrome.runtime.getURL("extension/graylog/business-error-rules.csv");
      const response = await fetch(url, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("Не удалось загрузить встроенный CSV.");
      const bundledRules = rulesApi.parseCsv(await response.text());

      // A slow initial fetch must not overwrite an edit already made by the user.
      if (rulesApi.revision === initialRevision) rulesApi.replace(bundledRules);
      render();
    } catch (error) {
      showError(error);
    }
  }

  function downloadRules() {
    const blob = new Blob([rulesApi.toCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "business-error-rules.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearError();
    try {
      addRule();
      ui.form.reset();
      ui.priority.value = "low";
      render();
    } catch (error) {
      showError(error);
    }
  });

  ui.list.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-code]");
    if (!button) return;
    clearError();
    try {
      rulesApi.replace(rulesApi.list().filter((rule) => rule.code !== button.dataset.code));
      render();
    } catch (error) {
      showError(error);
    }
  });

  ui.importButton.addEventListener("click", () => ui.file.click());
  ui.file.addEventListener("change", async () => {
    clearError();
    try {
      const selected = ui.file.files?.[0];
      if (!selected) return;
      if (selected.size > rulesApi.MAX_CSV_BYTES) throw new Error("CSV больше 128 КБ.");
      rulesApi.replace(rulesApi.parseCsv(await selected.text()));
      render();
    } catch (error) {
      showError(error);
    } finally {
      ui.file.value = "";
    }
  });

  ui.exportButton.addEventListener("click", () => {
    clearError();
    try {
      downloadRules();
    } catch (error) {
      showError(error);
    }
  });

  render();
  loadBundledRules();
})(globalThis);
