(function initializePercentileFormat(global) {
  function durationValue(value) {
    return value === null ? "—" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
  }

  function durationWithUnit(value) {
    return value === null ? "—" : `${durationValue(value)} мс`;
  }

  function card(label, value, escapeText) {
    return `<div class="card"><span>${escapeText(label)}</span><strong>${escapeText(value)}</strong></div>`;
  }

  global.PercentileFormat = Object.freeze({ durationValue, durationWithUnit, card });
})(globalThis);
