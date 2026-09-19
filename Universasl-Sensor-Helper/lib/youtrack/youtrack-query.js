(function exposeYouTrackQuery(root) {
  "use strict";

  const MAX_PAGE_SIZE = 500;
  const MAX_FETCH_SIZE = MAX_PAGE_SIZE + 1;
  const WORK_ITEM_FIELDS = [
    "id", "date", "duration(minutes)",
    "author(login)", "type(name)",
    "issue(id,idReadable,project(name),customFields(name,value(name,minutes,presentation,isResolved)))"
  ].join(",");

  function normalizeBaseUrl(value) {
    let parsed;
    try { parsed = new URL(String(value || "").trim()); }
    catch { throw new Error("Укажите корректный адрес YouTrack"); }
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("Адрес YouTrack должен содержать только http(s), host и базовый путь");
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/(?:api|hub)$/i, "") || "/";
    return parsed.toString().replace(/\/$/, "");
  }

  function normalizeHubUrl(value, youTrackBase) {
    if (String(value || "").trim()) {
      const normalized = normalizeBaseUrl(value);
      const parsed = new URL(normalized);
      parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/hub`.replace(/\/hub\/hub$/i, "/hub");
      return parsed.toString().replace(/\/$/, "");
    }
    const parsed = new URL(normalizeBaseUrl(youTrackBase));
    const path = parsed.pathname.replace(/\/$/, "");
    parsed.pathname = /\/youtrack$/i.test(path) ? path.replace(/\/youtrack$/i, "/hub") : `${path}/hub`;
    return parsed.toString().replace(/\/$/, "");
  }

  function apiUrl(baseUrl, path) {
    const base = new URL(`${normalizeBaseUrl(baseUrl)}/`);
    const relative = String(path || "").replace(/^\/+/, "");
    if (!/^(?:api\/(?:users\/me|workItems|admin\/projects)(?:[/?]|$))/.test(relative)) {
      throw new Error("Endpoint YouTrack не разрешён");
    }
    const result = new URL(relative, base);
    if (result.origin !== base.origin || !result.pathname.startsWith(base.pathname)) throw new Error("Endpoint YouTrack вышел за базовый путь");
    return result;
  }

  function projectQuery(value) {
    const clean = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (!clean || clean.length > 160 || /[{}\\]/.test(clean)) throw new Error("Некорректное название проекта");
    return `project: {${clean}}`;
  }

  function currentUserUrl(baseUrl) {
    const url = apiUrl(baseUrl, "api/users/me");
    url.searchParams.set("fields", "id,login,fullName,ringId,guest,banned");
    return url.toString();
  }

  function projectsUrl(baseUrl, skip = 0, top = 100) {
    const safeSkip = Number(skip), safeTop = Number(top);
    if (!Number.isSafeInteger(safeSkip) || safeSkip < 0 || !Number.isSafeInteger(safeTop) || safeTop < 1 || safeTop > 200) {
      throw new Error("Некорректная страница проектов");
    }
    const url = apiUrl(baseUrl, "api/admin/projects");
    url.searchParams.set("fields", "id,name,shortName,archived");
    url.searchParams.set("$skip", String(safeSkip));
    url.searchParams.set("$top", String(safeTop));
    return url.toString();
  }

  function workItemsUrl(baseUrl, options = {}) {
    const skip = Number(options.skip || 0);
    const top = Number(options.top ?? MAX_PAGE_SIZE);
    if (!Number.isSafeInteger(skip) || skip < 0 || !Number.isSafeInteger(top) || top < 1 || top > MAX_FETCH_SIZE) {
      throw new Error("Некорректная страница work items");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(options.startDate || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(options.endDate || ""))) {
      throw new Error("Период должен быть в формате YYYY-MM-DD");
    }
    const url = apiUrl(baseUrl, "api/workItems");
    url.searchParams.set("fields", WORK_ITEM_FIELDS);
    // /api/workItems filters work dates through the YouTrack query language.
    // Keeping the period in `query` also matches the already proven export script.
    url.searchParams.set("query", `${projectQuery(options.project)} work date: ${options.startDate} .. ${options.endDate}`);
    url.searchParams.set("$skip", String(skip));
    url.searchParams.set("$top", String(top));
    return url.toString();
  }

  const api = Object.freeze({ MAX_PAGE_SIZE, MAX_FETCH_SIZE, WORK_ITEM_FIELDS, normalizeBaseUrl, normalizeHubUrl, apiUrl, projectQuery, currentUserUrl, projectsUrl, workItemsUrl });
  root.YouTrackQuery = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
