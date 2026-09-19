(function exposeGraylogOverlay(root) {
  "use strict";

  function exactTraceId(value) {
    const text = String(value ?? "").trim();
    const match = /^traceId\s*:\s*(?:"([a-z0-9_-]{1,128})"|([a-z0-9_-]{1,128}))$/i.exec(text);
    return match ? match[1] || match[2] : "";
  }

  function queryFromUrl(value) {
    try { return new URL(String(value)).searchParams.get("q") || ""; }
    catch { return ""; }
  }

  const RICH_EDITOR_SELECTOR = '.CodeMirror,.ace_editor,.monaco-editor,.cm-editor,[class*="QueryEditor"],[class*="query-editor"]';
  function queryTextReady(field) {
    if(!field)return false;
    const editor=field.closest?.(RICH_EDITOR_SELECTOR)||field;
    const rich=editor.matches?.('.CodeMirror,.ace_editor,.monaco-editor,.cm-editor')||editor.querySelector?.('.CodeMirror,.ace_editor,.monaco-editor,.cm-editor');
    return !rich||Boolean(editor.querySelector?.('.CodeMirror-line,.ace_line,.cm-line,.view-line'));
  }
  function readQueryText(field) {
    if (!field) return "";
    const editor = field.closest?.(RICH_EDITOR_SELECTOR) || field;
    // CodeMirror/Ace textareas are keyboard/IME buffers, not the query model.
    // Read syntax-token text in order; joining lines preserves AND/OR clauses.
    const lineSelectors = ['.CodeMirror-code .CodeMirror-line', '.ace_text-layer .ace_line', '.cm-content .cm-line', '.view-lines .view-line'];
    for (const selector of lineSelectors) {
      const lines = editor.querySelectorAll?.(selector);
      if (lines?.length) {
        if (lines.length > 64) return "";
        const text = Array.from(lines, line => line.textContent || "").join("\n").replace(/[\u200b\ufeff]/g, '').replace(/\u00a0/g, ' ');
        return text.length <= 8192 ? text : "";
      }
    }
    const editable = field.matches?.('input,textarea,[contenteditable="true"],[role="textbox"]')
      ? field : field.querySelector?.('[contenteditable="true"],[role="textbox"],textarea,input');
    // A rich editor whose lines have not mounted yet must not expose its buffer.
    if (editor.matches?.('.CodeMirror,.ace_editor,.monaco-editor,.cm-editor') || editor.querySelector?.('.CodeMirror,.ace_editor,.monaco-editor,.cm-editor')) return "";
    const text = typeof editable?.value === "string" ? editable.value
      : (editable?.innerText ?? editable?.textContent ?? field.innerText ?? field.textContent ?? "");
    return text.length <= 8192 ? text : "";
  }

  function isSearchControl(description = {}) {
    const tag = String(description.tagName || "").toLowerCase();
    const type = String(description.type || "").toLowerCase();
    if (tag !== "button" && !(tag === "input" && ["submit", "button", "image"].includes(type))) return false;
    if (type === "submit") return true;
    const label = [description.textContent, description.ariaLabel, description.title]
      .map(value => String(value || "").trim().replace(/\s+/g, " ").toLowerCase()).find(Boolean) || "";
    if (/^(?:search|поиск|найти|execute(?: search)?|run query|выполнить(?: поиск)?|запустить поиск)$/i.test(label)) return true;
    const identifier = [description.testId, description.name].map(value => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
    return /(?:^|[\s_-])(?:execute-search|search-submit|run-query)(?:[\s_-]|$)/i.test(identifier);
  }

  const api = Object.freeze({ exactTraceId, queryFromUrl, readQueryText, queryTextReady, isSearchControl });
  root.GraylogOverlay = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
