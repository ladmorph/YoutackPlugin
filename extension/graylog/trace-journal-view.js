// Вкладка «Журнал» в Сенсоре: полный список разобранных trace.
// Ничего не запрашивает — читает те же записи, что кладёт панель на странице
// Graylog, и пишет карточки в тот же личный Навигатор.
(function initializeTraceJournalView(root) {
  "use strict";
  const JOURNAL = root.TraceJournal;
  const NAVIGATOR_KEY = "personalNavigator.v1";
  const el = (id) => document.getElementById(`journal-${id}`);
  const rows = el("rows");
  const empty = el("empty");
  const search = el("search");
  const clear = el("clear");
  const statusLine = el("status");
  const tab = document.getElementById("journal-tab");
  if (!JOURNAL || !rows || !tab) return;

  let entries = [];
  const formatTime = (ms) => {
    try { return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(ms)); }
    catch { return new Date(ms).toISOString(); }
  };

  function report(message, isError) {
    if (!statusLine) return;
    statusLine.hidden = !message;
    statusLine.textContent = message || "";
    statusLine.classList.toggle("error", Boolean(isError));
  }

  async function load() {
    try {
      const stored = await chrome.storage?.local?.get(JOURNAL.KEY);
      entries = JOURNAL.list(stored?.[JOURNAL.KEY]);
    } catch { entries = []; }
    render();
  }

  async function saveList(next) {
    await chrome.storage.local.set({ [JOURNAL.KEY]: next });
    entries = next;
    render();
  }

  // Карточка обновляется по идентификатору из traceId: повторное добавление
  // заменяет прежнюю заметку свежим разбором, а не создаёт вторую.
  async function addToNavigator(entry, button) {
    const card = JOURNAL.navigatorEntry(entry, formatTime);
    if (!card) return;
    button.disabled = true;
    try {
      const write = async () => {
        const stored = await chrome.storage.local.get(NAVIGATOR_KEY);
        const state = stored?.[NAVIGATOR_KEY] && typeof stored[NAVIGATOR_KEY] === "object" ? stored[NAVIGATOR_KEY] : {};
        const saved = Array.isArray(state.entries) ? state.entries : [];
        const deleted = Array.isArray(state.deleted) ? state.deleted : [];
        const existed = saved.some((item) => item?.id === card.id);
        await chrome.storage.local.set({
          [NAVIGATOR_KEY]: {
            version: 1,
            entries: [...saved.filter((item) => item?.id !== card.id), card].slice(-2000),
            deleted: deleted.filter((id) => id !== card.id)
          }
        });
        return existed;
      };
      const existed = root.navigator?.locks?.request
        ? await root.navigator.locks.request(NAVIGATOR_KEY, write)
        : await write();
      report(existed
        ? `Карточка «${card.name}» обновлена в Навигаторе.`
        : `Карточка «${card.name}» добавлена в Навигатор.`);
    } catch (error) {
      report(error?.message || "Не удалось сохранить карточку в Навигатор.", true);
    }
    button.disabled = false;
  }

  function row(entry) {
    const item = document.createElement("article");
    item.className = "journal-card";

    const head = document.createElement("div");
    head.className = "journal-card-head";
    const link = document.createElement("a");
    link.className = "journal-card-trace";
    link.href = entry.url;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = entry.traceId;
    link.title = "Открыть страницу Graylog за зафиксированный период";
    const state = JOURNAL.status(entry);
    const badge = document.createElement("span");
    badge.className = `journal-state ${state.kind}`;
    badge.textContent = state.label;
    badge.title = state.kind === "unknown"
      ? "Запись сделана прежней версией: признаков ошибок в ней не сохранено."
      : state.kind === "failed"
        ? "В разобранной выдаче найдены события уровня 3."
        : "В разобранной выдаче событий уровня 3 не найдено.";
    head.append(link, badge);

    const uri = document.createElement("p");
    uri.className = "journal-card-uri";
    uri.textContent = entry.initUri
      ? (entry.initUriCount && entry.initUriCount > 1 ? `${entry.initUri} · и ещё ${entry.initUriCount - 1}` : entry.initUri)
      : "initUri не определён";
    uri.title = entry.initUri && !entry.initUriExact
      ? "initUri взят из сообщений gateway без доказательства единственности: для процентилей нужен отдельный расчёт"
      : "";

    const meta = document.createElement("p");
    meta.className = "journal-card-meta";
    const bits = [];
    if (entry.at) bits.push(`Разобран ${formatTime(entry.at)}`);
    if (entry.startMs && entry.endMs) bits.push(`период ${formatTime(entry.startMs)} — ${formatTime(entry.endMs)}`);
    if (entry.durationMs !== null) bits.push(`длительность ${JOURNAL.duration(entry.durationMs)}`);
    if (entry.failedService) bits.push(`упал ${entry.failedService}`);
    if (entry.nodes) bits.push(`компонентов ${entry.nodes}`);
    if (entry.repeats) bits.push(`повторов HTTP ${entry.repeats}`);
    meta.textContent = bits.join(" · ");

    const actions = document.createElement("div");
    actions.className = "journal-card-actions";
    const toNavigator = document.createElement("button");
    toNavigator.type = "button";
    toNavigator.className = "secondary";
    toNavigator.textContent = "Добавить в навигатор";
    toNavigator.addEventListener("click", () => void addToNavigator(entry, toNavigator));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Убрать";
    remove.addEventListener("click", async () => {
      try { await saveList(JOURNAL.remove(entries, entry.traceId)); report(`Запись ${entry.traceId} убрана.`); }
      catch (error) { report(error?.message || "Не удалось убрать запись.", true); }
    });
    actions.append(toNavigator, remove);

    item.append(head, uri, meta, actions);
    return item;
  }

  function render() {
    const query = String(search?.value || "").trim().toLocaleLowerCase("ru");
    const visible = query
      ? entries.filter((entry) => entry.traceId.toLocaleLowerCase("ru").includes(query) || entry.initUri.toLocaleLowerCase("ru").includes(query))
      : entries;
    rows.replaceChildren();
    for (const entry of visible) rows.append(row(entry));
    if (empty) {
      empty.hidden = visible.length > 0;
      empty.textContent = entries.length && !visible.length
        ? "По этому запросу в журнале ничего нет."
        : "Журнал пуст. Откройте trace в Graylog и нажмите разбор — запись появится здесь.";
    }
    if (clear) clear.disabled = entries.length === 0;
  }

  search?.addEventListener("input", render);
  clear?.addEventListener("click", async () => {
    try { await saveList([]); report("Журнал очищен."); }
    catch (error) { report(error?.message || "Не удалось очистить журнал.", true); }
  });
  tab.addEventListener("click", () => { report(""); void load(); });
  // Панель на странице Graylog пишет в то же хранилище: открытая вкладка
  // должна увидеть новую запись без перезагрузки.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && Object.hasOwn(changes, JOURNAL.KEY)) void load();
  });
  void load();
})(globalThis);
