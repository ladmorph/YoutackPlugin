const DEFAULT_GRAYLOG_STREAMS = Object.freeze([
  "64da082989d8671b26f341bc",
  "670764dd4e3e1a1cca09b223",
  "64da0edf05e24c149ed8d740",
  "64da0c9b05e24c149ed8d494",
  "670765d52338cf2a286aff09",
  "6707631a2338cf2a286afb5e",
  "67076246c4c24e10106b636f",
  "5e21be17a07e950775117d8e",
  "6707654f2338cf2a286afe41",
  "6731c46455c2594deb1be5af"
]);
const TEST_GRAYLOG_STREAMS = Object.freeze([
  "5e00aed04500f33eee1d8e97",
  "628cbd92d3b23f5e43ac7b3b",
  "62619fafaed92c33f08bf4ea",
  "62cd59e3cf1ab647409a0b56"
]);
const productionGraylogStreams = [...DEFAULT_GRAYLOG_STREAMS];
const GRAYLOG_STREAMS = [...productionGraylogStreams];
let graylogEnvironment = "default";
const DEFAULT_GRAYLOG_STREAM = "67076246c4c24e10106b636f";
const DEFAULT_PERCENTILE_STREAMS = Object.freeze([
  DEFAULT_GRAYLOG_STREAM,
  "6731c46455c2594deb1be5af"
]);
const MONITOR_STREAM_MODES = Object.freeze({
  o: Object.freeze(DEFAULT_GRAYLOG_STREAMS.filter((id) => id !== "6731c46455c2594deb1be5af")),
  r: Object.freeze(["6731c46455c2594deb1be5af"])
});
const graylogStreamListeners = new Set();

function populateGraylogStreamSelect(select, preferred = DEFAULT_GRAYLOG_STREAM, options = {}) {
  if (!select) return;
  const previous = String(select.value || preferred);
  const includeAll = Boolean(options?.includeAll);
  const allValue = "__all_streams__";
  select.innerHTML = `${includeAll ? `<option value="${allValue}">Все настроенные streams (${GRAYLOG_STREAMS.length})</option>` : ""}${GRAYLOG_STREAMS.map((id) => `<option value="${id}">${id}</option>`).join("")}`;
  if (includeAll && (previous === allValue || preferred === allValue)) select.value = allValue;
  else select.value = GRAYLOG_STREAMS.includes(previous) ? previous : GRAYLOG_STREAMS.includes(preferred) ? preferred : GRAYLOG_STREAMS[0];
}

function selectedGraylogStream(select) {
  const value = String(select?.value || "").trim();
  if (!GRAYLOG_STREAMS.includes(value)) throw new Error("Выберите stream для запроса");
  return value;
}

function graylogStreamList() { return [...GRAYLOG_STREAMS]; }

function monitorStreamList(mode = "o") {
  if (graylogEnvironment === "test") return [...TEST_GRAYLOG_STREAMS];
  const normalized = String(mode || "o").toLowerCase();
  return [...(MONITOR_STREAM_MODES[normalized] || MONITOR_STREAM_MODES.o)];
}

function graylogHostname(value) {
  try {
    const text = String(value || "").trim();
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    return parsed.hostname.toLowerCase();
  } catch { return ""; }
}

function isTestGraylogHost(value) { return graylogHostname(value).includes("test"); }
function environmentForHost(value) { return isTestGraylogHost(value) ? "test" : "default"; }
function streamsForHost(value) { return environmentForHost(value) === "test" ? [...TEST_GRAYLOG_STREAMS] : [...productionGraylogStreams]; }
function percentileStreamList() { return graylogEnvironment === "test" ? [] : [...DEFAULT_PERCENTILE_STREAMS]; }
function percentilesEnabled() { return graylogEnvironment !== "test"; }
function currentEnvironment() { return graylogEnvironment; }

function setGraylogEnvironment(environment) {
  const next = environment === "test" ? "test" : "default";
  const changed = next !== graylogEnvironment;
  graylogEnvironment = next;
  GRAYLOG_STREAMS.splice(0, GRAYLOG_STREAMS.length, ...(next === "test" ? TEST_GRAYLOG_STREAMS : productionGraylogStreams));
  if (changed) notifyGraylogStreams();
  return graylogEnvironment;
}

function setGraylogHost(value) { return setGraylogEnvironment(environmentForHost(value)); }

function notifyGraylogStreams() {
  const snapshot = graylogStreamList();
  for (const listener of graylogStreamListeners) listener(snapshot);
}

function addGraylogStream(value) {
  if (graylogEnvironment === "test") throw new Error("В test-режиме используется фиксированный список из 4 streams");
  const id = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error("Stream ID должен содержать 24 шестнадцатеричных символа");
  if (GRAYLOG_STREAMS.includes(id)) throw new Error("Такой stream уже есть в списке");
  productionGraylogStreams.push(id);
  GRAYLOG_STREAMS.push(id);
  notifyGraylogStreams();
  return id;
}

function removeGraylogStream(value) {
  if (graylogEnvironment === "test") throw new Error("В test-режиме используется фиксированный список из 4 streams");
  const id = String(value || "").trim().toLowerCase();
  if (DEFAULT_PERCENTILE_STREAMS.includes(id)) throw new Error("Этот stream обязателен для вкладки «Процентили»");
  if (GRAYLOG_STREAMS.length <= 1) throw new Error("В списке должен остаться хотя бы один stream");
  const index = GRAYLOG_STREAMS.indexOf(id);
  if (index < 0) throw new Error("Stream не найден");
  const productionIndex = productionGraylogStreams.indexOf(id);
  if (productionIndex >= 0) productionGraylogStreams.splice(productionIndex, 1);
  GRAYLOG_STREAMS.splice(index, 1);
  notifyGraylogStreams();
}

function resetGraylogStreams() {
  if (graylogEnvironment === "test") throw new Error("В test-режиме используется фиксированный список из 4 streams");
  productionGraylogStreams.splice(0, productionGraylogStreams.length, ...DEFAULT_GRAYLOG_STREAMS);
  GRAYLOG_STREAMS.splice(0, GRAYLOG_STREAMS.length, ...productionGraylogStreams);
  notifyGraylogStreams();
}

function subscribeGraylogStreams(listener) {
  graylogStreamListeners.add(listener);
  listener(graylogStreamList());
  return () => graylogStreamListeners.delete(listener);
}

const GraylogStreamsApi = {
  GRAYLOG_STREAMS, DEFAULT_GRAYLOG_STREAMS, TEST_GRAYLOG_STREAMS, DEFAULT_GRAYLOG_STREAM, DEFAULT_PERCENTILE_STREAMS, MONITOR_STREAM_MODES,
  populateGraylogStreamSelect, selectedGraylogStream, list: graylogStreamList,
  monitorStreams: monitorStreamList, percentileStreams: percentileStreamList, percentilesEnabled,
  hostname: graylogHostname, isTestHost: isTestGraylogHost, environmentForHost, streamsForHost,
  environment: currentEnvironment, setEnvironment: setGraylogEnvironment, setHost: setGraylogHost,
  add: addGraylogStream, remove: removeGraylogStream, reset: resetGraylogStreams, subscribe: subscribeGraylogStreams
};
if (typeof module !== "undefined" && module.exports) module.exports = GraylogStreamsApi;
globalThis.GraylogStreams = GraylogStreamsApi;
