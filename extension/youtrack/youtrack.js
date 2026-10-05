(() => {
  "use strict";

  const CONFIG_KEY = "youtrackConnectionConfig";
  const PROFILE_KEY = "youtrackReportProfile";
  const SESSION_KEY = "youtrackAuthSession";
  const MAX_PROJECTS = 1000;
  const MAX_WORK_ITEMS = 20000;
  const PAGE_SIZE = YouTrackQuery.MAX_PAGE_SIZE;
  const FETCH_SIZE = YouTrackQuery.MAX_FETCH_SIZE;
  const REQUEST_PAUSE_MS = 20;

  const $ = (selector) => document.querySelector(selector);
  const ui = {
    state: $("#connection-state"), disconnect: $("#disconnect"), base: $("#base-url"), hub: $("#hub-url"), client: $("#client-id"), scope: $("#oauth-scope"),
    tabCard: $("#tab-session-card"), tabNote: $("#tab-session-note"), tabConnect: $("#connect-tab"), oauth: $("#connect-oauth"), redirect: $("#oauth-redirect"), token: $("#permanent-token"), tokenConnect: $("#connect-token"), loadProjects: $("#load-projects"), connectionError: $("#connection-error"),
    profilePanel: $("#profile-panel"), projectList: $("#project-list"), profileNote: $("#profile-note"), profileKind: $("#profile-kind"), selectAll: $("#select-all-projects"), clearProjects: $("#clear-projects"),
    importTeams: $("#import-teams"), importWorkItems: $("#import-work-items"), importConfig: $("#import-config"), teamsFile: $("#teams-file"), workItemsFile: $("#work-items-file"), configFile: $("#config-file"), forgetProfile: $("#forget-profile"), profileError: $("#profile-error"), saveRules: $("#save-rules"),
    development: $("#rule-development"), meeting: $("#rule-meeting"), overtime: $("#rule-overtime"), issueField: $("#rule-issue-field"), business: $("#rule-business"), technical: $("#rule-technical"), bug: $("#rule-bug"), works: $("#rule-works"), statusField: $("#rule-status-field"), statuses: $("#rule-statuses"), estimate: $("#rule-estimate"),
    runPanel: $("#run-panel"), from: $("#date-from"), to: $("#date-to"), ignorePeriod: $("#ignore-period"), run: $("#run-report"), stop: $("#stop-report"), progress: $("#progress"), runError: $("#run-error"),
    resultPanel: $("#result-panel"), resultMeta: $("#result-meta"), summary: $("#summary"), rows: $("#result-rows"), exportCsv: $("#export-csv"), exportXlsx: $("#export-xlsx"), unmatchedWrap: $("#unmatched-wrap"), unmatchedCount: $("#unmatched-count"), unmatchedList: $("#unmatched-list"),
    chartPanel: $("#project-chart-panel"), chart: $("#project-chart"), chartLegend: $("#chart-legend"), chartNote: $("#chart-note"), chartTeam: $("#chart-team-filter"), chartTeamWrap: $("#chart-team-filter-wrap"), downloadChart: $("#download-chart-png"), insightsPanel: $("#insights-panel"), insights: $("#insights"), modal: $("#breakdown-modal"), modalTitle: $("#breakdown-title"), modalMeta: $("#breakdown-meta"), modalContent: $("#breakdown-content"), modalClose: $("#close-breakdown"), exportBreakdown: $("#export-breakdown-xlsx"),
    jsonNote: $("#json-mode-note"), tabReport: $("#tab-report"), tabBuilder: $("#tab-builder"), tabLog: $("#tab-log"), builderPanel: $("#json-builder-panel"), technicalPanel: $("#technical-log-panel"), technicalRows: $("#technical-log-rows"), clearTechnicalLog: $("#clear-technical-log")
  };

  let connection = null;
  let authSession = null;
  let projects = [];
  let profile = null;
  let selectedProjectIds = new Set();
  let activeController = null;
  let latestResult = null;
  let pendingLegacyConfig = null;
  let sourceTabId = null;
  let sourceOrigin = "";
  let sourceBaseUrl = "";
  let offlineWorkItems = null;
  let latestPeriod = null;
  let latestBreakdown = null;
  let activeChartKind = "people";
  let currentChartModel = null;
  let reportTabId = null;
  let connecting = false;
  const reportCache = new Map();
  const CACHE_TTL_MS = 2 * 60 * 1000;
  let projectsCache = null;
  const expandedTeams = new Set();
  const actionStartedAt = new Map();
  const technicalLog = [];
  const networkTechnicalLog = [];
  let folderSettingsSignature = "";
  let checkingFiles = false;
  const fileSources = {teams:"",work:"",config:""};
  let folderBusy=false, connectedProjects=[], onlineAuthSession=null;

  function folderAccess() {
    if(!YouTrackFolders.configured)return {allowed:true,text:""};
    if(!YouTrackFolders.selected)return {allowed:false,text:"Выберите проект отчёта."};
    if(offlineWorkItems)return {allowed:true,text:"Отчёт из локального файла. Права YouTrack не проверяются; запросов к серверу нет."};
    if(!profile?.projects?.length)return {allowed:false,text:"Добавьте teams.json с проектами YouTrack или настройте их в конструкторе."};
    if(!authSession||!projectsCache||projectsCache.baseUrl!==connection?.baseUrl||projectsCache.user!==authSession.userLabel||Date.now()-projectsCache.at>=CACHE_TTL_MS)return {allowed:false,text:"Доступ к проектам ещё не проверен. Подключитесь к YouTrack и нажмите «Проверить доступ»."};
    const available=new Set(connectedProjects.flatMap(project=>[project.name,project.shortName].filter(Boolean).map(name=>name.toLowerCase())));
    const missing=profile.projects.filter(project=>!available.has(String(project.name).toLowerCase())).map(project=>project.name);
    if(missing.length)return {allowed:false,text:`Построение заблокировано. Среди доступных этой учётке проектов не найдены: ${missing.join(", ")}. Проверьте доступ, название в teams.json и архивность проекта.`};
    return {allowed:true,text:"Проекты доступны текущей учётке. Право чтения списаний дополнительно проверит сервер при загрузке."};
  }
  function updateFolderAccess() {
    const state=folderAccess();$("#folder-access-status").textContent=state.text;
    $("#folder-access-status").dataset.allowed=String(state.allowed);
    $("#check-folder-access").disabled=folderBusy||Boolean(activeController)||!authSession||authSession.kind==="offline";
    if(YouTrackFolders.configured)ui.run.disabled=folderBusy||Boolean(activeController)||!state.allowed;
  }

  function folderControls() {
    const linked=YouTrackFolders.configured;
    $("#plus-project").disabled=folderBusy||!linked;
    $("#refresh-plus-projects").disabled=folderBusy||!linked;
    $("#new-plus-project").disabled=folderBusy||!linked;
    $("#choose-plus-folder").disabled=folderBusy;
    $("#create-plus-project").disabled=folderBusy;
    $("#save-plus-settings").disabled=folderBusy||!YouTrackFolders.selected||!profile?.teams?.length;
    updateFolderAccess();
  }
  async function folderAction(action) {
    if(folderBusy||activeController||connecting||checkingFiles)return;
    folderBusy=true;folderControls();clearError($("#plus-project-error"));
    try{await action();}catch(error){if(error.name==="NotAllowedError")$("#choose-plus-folder").textContent="Разрешить доступ";if(error.name!=="AbortError")showError($("#plus-project-error"),safeMessage(error));}
    finally{folderBusy=false;folderControls();}
  }
  async function folderList() {
    const names=await YouTrackFolders.list();
    $("#plus-project").replaceChildren(new Option(names.length?"Выберите проект":"Нет проектов — создайте первый",""));
    for(const name of names)$("#plus-project").append(new Option(name,name));
    $("#plus-project").value=YouTrackFolders.selected;
    $("#folder-projects-note").textContent=`YouTrackPlus · папок проектов: ${names.length}. Читаются JSON только выбранного проекта.`;
    return names;
  }
  async function switchFolder(name) {
    await YouTrackFolders.select(name);
    if(authSession?.kind!=="offline") {onlineAuthSession=authSession;if(projects.length)connectedProjects=projects;}
    authSession=onlineAuthSession;offlineWorkItems=null;pendingLegacyConfig=null;profile=null;
    projects=connectedProjects.slice();selectedProjectIds.clear();reportCache.clear();expandedTeams.clear();
    latestResult=null;latestBreakdown=null;latestPeriod=null;closeBreakdown();resetAnalysis();
    ui.resultPanel.hidden=true;ui.chartPanel.hidden=true;ui.insightsPanel.hidden=true;
    $("#refresh-report-data").hidden=true;ui.ignorePeriod.checked=false;ui.ignorePeriod.disabled=true;ui.from.disabled=false;ui.to.disabled=false;
    fileSources.teams="";fileSources.config="";fileSources.work="";folderSettingsSignature="";
    await chrome.storage.local.remove(PROFILE_KEY);fillRules(YouTrackWorkItems.DEFAULT_CLASSIFICATION);
    ui.runPanel.hidden=!authSession;ui.progress.textContent="Готово к запуску";
    renderProjects();updateConnectionUi();
    if(name)await loadBundledOfflineFiles();else renderFileSources();
    $("#plus-project").value=name;folderControls();
    $("#folder-projects-note").textContent=name?`Выбран: YouTrackPlus / ${name}. Отчёт запускается отдельно.`:"Выберите или создайте папку проекта.";
    document.dispatchEvent(new CustomEvent("youtrack-folder-changed"));
  }
  async function restoreFolders() {
    try{
      const state=await YouTrackFolders.restore();
      if(!state.configured)return false;
      if(!state.granted){
        profile=null;fillRules(YouTrackWorkItems.DEFAULT_CLASSIFICATION);renderFileSources();
        $("#folder-projects-note").textContent="YouTrackPlus сохранена. Разрешите доступ к ней, чтобы прочитать проекты.";
        $("#choose-plus-folder").textContent="Разрешить доступ";
        return true;
      }
      const names=await folderList(),name=names.includes(YouTrackFolders.selected)?YouTrackFolders.selected:names[0]||"";
      await switchFolder(name);return true;
    }catch(error){showError($("#plus-project-error"),safeMessage(error));return YouTrackFolders.configured;}
    finally{folderControls();}
  }

  function renderFileSources() {
    const hasTeams = profile?.teams?.length > 0;
    $("#teams-source-state").textContent = fileSources.teams || (hasTeams ? `Работаем с сохранённым профилем · ${profile.teams.length} команд` : "Не подключён · сейчас проект = команда");
    $("#work-source-state").textContent = offlineWorkItems ? `${fileSources.work || "Работаем с выгрузкой"} · ${offlineWorkItems.length} записей` : "Файл не нужен · списания загрузим из YouTrack";
    $("#config-source-state").textContent = fileSources.config || (profile?.classification ? "Используем правила сохранённого профиля" : "Используем стандартные правила");
    $("[data-file=teams]").dataset.ready = String(hasTeams);
    $("#offline-report-status").textContent = offlineWorkItems ? `Используется выгрузка · ${offlineWorkItems.length} записей` : "Для готовой выгрузки · необязательно";
    $("[data-file=work]").dataset.ready = String(Boolean(offlineWorkItems));
    $("[data-file=config]").dataset.ready = String(Boolean(pendingLegacyConfig));
    $("#edit-teams").hidden = !hasTeams;
  }

  async function recheckFolder(settingsOnly = false) {
    if (folderBusy || checkingFiles || activeController || connecting) return;
    checkingFiles = true; $("#recheck-json").disabled = true;
    try {
      clearError(ui.profileError);
      if (!settingsOnly) { await loadBundledOfflineFiles(); return; }
      const [teams, config] = await Promise.all([readBundledJson("teams.json",1024*1024),readBundledJson("config.json",1024*1024)]);
      const signature = JSON.stringify([teams?.data,config?.data]);
      if (teams && signature !== folderSettingsSignature) {
        const migrated = YouTrackWorkItems.migrateLegacy(teams.data,config?.data || pendingLegacyConfig);
        await saveProfile(migrated); fillRules(migrated.classification);
        if(config) { pendingLegacyConfig=config.data; fileSources.config=`Найден ${config.path} · работаем с ним`; }
        fileSources.teams=`Найден ${teams.path} · работаем с ним`;
        ui.jsonNote.textContent=`Настройки из ${teams.path} обновлены. Для нового результата нажмите «Построить отчёт».`;
        syncFileProjects(migrated);
        folderSettingsSignature=signature;
      }
    } catch(error) { showError(ui.profileError,safeMessage(error)); ui.jsonNote.textContent="Файл не удалось применить. Подробности ниже; можно выбрать файл вручную."; }
    finally { checkingFiles=false; $("#recheck-json").disabled=false; renderFileSources(); }
  }

  function syncFileProjects(migrated) {
    if(!projects.length || offlineWorkItems) projects=migrated.projects.map(project=>({id:project.id,name:project.name,shortName:"",archived:false}));
    selectedProjectIds=new Set(projects.filter(projectMatchesProfile).map(project=>project.id));
    renderProjects();
    ui.profileNote.textContent=`Настроено команд: ${migrated.teams.length}.`;
  }

  function renderTechnicalLog() {
    ui.technicalRows.replaceChildren();
    const rows = [...technicalLog, ...networkTechnicalLog].sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
    for (const entry of rows) {
      const row=document.createElement("tr");
      for (const value of [entry.time,entry.action,entry.query,entry.page,entry.result]) { const cell=document.createElement("td"); cell.textContent=value; row.append(cell); }
      ui.technicalRows.append(row);
    }
  }

  async function refreshNetworkTechnicalLog() {
    let origin = sourceOrigin;
    if (!origin) { try { origin = new URL(connection?.baseUrl || "").origin; } catch {} }
    if (!origin) { networkTechnicalLog.length=0; renderTechnicalLog(); return; }
    const response = await chrome.runtime.sendMessage({ type:"get-youtrack-network-audit", origin }).catch(() => ({ rows:[] }));
    const rows = Array.isArray(response?.rows) ? response.rows : [];
    networkTechnicalLog.splice(0, networkTechnicalLog.length, ...rows.map(row => {
      const createdAt=Number(row.at || 0);
      const status=String(row.status || "Выполняется");
      const duration=Number.isFinite(row.durationMs) ? ` · ${row.durationMs} мс` : "";
      return {
        createdAt,
        time:createdAt ? new Date(createdAt).toLocaleTimeString("ru-RU") : "—",
        action:`Network · ${row.source === "YouTrack" ? "штатный" : "расширение"}`,
        query:`${String(row.method || "GET")} ${String(row.path || "—")}`,
        page:`Authorization: ${row.authorization === "Bearer" ? "Bearer есть" : "нет"}`,
        result:`${status}${duration}`
      };
    }));
    renderTechnicalLog();
  }

  function recordTechnical(action, url, startedAt, outcome) {
    let query="—", page="—";
    try { const parsed=new URL(url); query=parsed.searchParams.get("query")||parsed.pathname.split("/").pop()||"—"; const top=parsed.searchParams.get("$top")||"—"; page=action==="Work items"&&Number(top)===FETCH_SIZE?`500 + 1 признак продолжения, skip ${parsed.searchParams.get("$skip")||"—"}`:`top ${top}, skip ${parsed.searchParams.get("$skip")||"—"}`; } catch {}
    technicalLog.unshift({createdAt:Date.now(),time:new Date().toLocaleTimeString("ru-RU"),action,query,page,result:`${outcome} · ${Math.max(0,Math.round(performance.now()-startedAt))} мс`});
    if(technicalLog.length>200)technicalLog.length=200;renderTechnicalLog();
  }

  let sensorView='advanced',reportPath='fields';
  function chooseReportPath(value){
    if(activeController)return;
    reportPath='fields';sensorView=reportPath==='fields'?'advanced':'analysis';
    $('#report-view').dataset.reportPath=reportPath;
    $('#report-mode-legacy').setAttribute('aria-pressed',String(reportPath==='legacy'));$('#report-mode-fields').setAttribute('aria-pressed',String(reportPath==='fields'));
    $('#report-path-note').textContent=reportPath==='fields'?'ОМП. Backend: поля YouTrack или ваши правила teams.json + config.json. Файлы необязательны. Готовый результат — в «Разборе Сенсора».':'Прежние проекты, teams.json, config.json, списания и Excel. Все настройки и расчёты сохранены.';
    selectView('report');
  }
  function selectView(view) {
    const log=view==="log",builder=view==="builder",analysis=view==="analysis",advanced=view==="advanced";
    document.querySelector("#report-view").dataset.view=advanced?"advanced":log?"log":builder?"builder":analysis?"analysis":"report";
    const advancedPanel=$("#advanced-report-panel");
    if(advancedPanel)advancedPanel.hidden=!advanced;
    $('#advanced-setup-panel').hidden=view!=='report'||reportPath!=='fields';
    $("#sensor-source-controls").hidden=!(advanced||analysis);
    if(advanced||analysis){sensorView=view;$("#sensor-analysis-source").value=view;}
    ui.technicalPanel.hidden=!log;
    ui.builderPanel.hidden=!builder;
    ui.insightsPanel.hidden=!analysis;
    if(analysis&&latestResult)requestAnimationFrame(()=>renderAnalytics());
    ui.tabReport.classList.toggle("active",!log&&!builder&&!analysis&&!advanced); ui.tabReport.setAttribute("aria-selected",String(!log&&!builder&&!analysis&&!advanced));
    $("#tab-analysis").classList.toggle("active",analysis||advanced); $("#tab-analysis").setAttribute("aria-selected",String(analysis||advanced));
    if(advanced){$("#analysis-ready").hidden=true;$("#tab-analysis").classList.remove("has-analysis");}
    if(analysis){dismissAnalysisInvite();$("#analysis-ready").hidden=true;$("#tab-analysis").classList.remove("has-analysis");requestAnimationFrame(()=>$("#analysis-title").focus());}
    ui.tabBuilder.classList.toggle("active",builder); ui.tabBuilder.setAttribute("aria-selected",String(builder));
    ui.tabLog.classList.toggle("active",log); ui.tabLog.setAttribute("aria-selected",String(log));
    $("#start-youtrack-onboarding").hidden=builder||analysis||advanced||reportPath==='fields';
    document.dispatchEvent(new CustomEvent("youtrack-view-changed",{detail:{view}}));
  }

  function actionAllowed(name, cooldownMs = 800) {
    const now = Date.now();
    if (now - (actionStartedAt.get(name) || 0) < cooldownMs) return false;
    actionStartedAt.set(name, now);
    return true;
  }

  function showError(element, value) {
    element.textContent = String(value || "Неизвестная ошибка");
    element.hidden = false;
  }

  function clearError(element) {
    element.textContent = "";
    element.hidden = true;
  }

  function safeMessage(error) {
    if (error?.name === "AbortError") return "Операция остановлена.";
    const message = String(error?.message || error || "Неизвестная ошибка");
    if (/401|403/.test(message)) return "YouTrack отклонил доступ. Подключитесь заново или проверьте права учётной записи.";
    if (/429/.test(message)) return "YouTrack временно ограничил запросы. Повторите позже.";
    if (/HTTP\s+\d+/.test(message)) return message.match(/HTTP\s+\d+/)?.[0] || "Ошибка YouTrack";
    return message.slice(0, 280);
  }

  function waitBetweenRequests(signal) {
    if(signal?.aborted)return Promise.reject(new DOMException("Stopped","AbortError"));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(done,REQUEST_PAUSE_MS);
      function done(){signal?.removeEventListener("abort",stop);resolve();}
      function stop(){clearTimeout(timer);signal?.removeEventListener("abort",stop);reject(new DOMException("Stopped","AbortError"));}
      signal?.addEventListener("abort",stop,{once:true});
    });
  }

  function splitList(value) {
    return String(value || "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  }

  function isoDate(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function setDefaultDates() {
    const now = new Date();
    ui.from.value = isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    ui.to.value = isoDate(new Date(now.getFullYear(), now.getMonth(), 0));
  }

  async function localGet(keys) {
    return chrome.storage.local.get(keys);
  }

  async function localSet(value) {
    return chrome.storage.local.set(value);
  }

  async function sessionGet(key) {
    return chrome.storage.session.get(key);
  }

  async function clearSession() {
    document.dispatchEvent(new CustomEvent("youtrack-connection-changed"));
    reportCache.clear(); projectsCache = null;
    onlineAuthSession=null;connectedProjects=[];
    const capturedOrigin = connection?.baseUrl ? new URL(connection.baseUrl).origin : "";
    activeController?.abort();
    authSession = null;
    offlineWorkItems = null;
    sourceTabId = null;
    sourceOrigin = "";
    sourceBaseUrl = "";
    await chrome.storage.session.remove(SESSION_KEY);
    if (capturedOrigin) await chrome.runtime.sendMessage({ type:"clear-youtrack-captured-auth", origin:capturedOrigin }).catch(() => {});
    projects = [];
    selectedProjectIds.clear();
    ui.projectList.replaceChildren();
    ui.profilePanel.hidden = true;
    ui.runPanel.hidden = true;
    ui.resultPanel.hidden = true;
    ui.chartPanel.hidden = true; ui.insightsPanel.hidden = true; resetAnalysis();
    document.querySelector("#refresh-report-data").hidden = true;
    ui.tabCard.classList.remove("connected");
    ui.tabConnect.disabled = true;
    ui.ignorePeriod.checked = false; ui.ignorePeriod.disabled = true; ui.from.disabled=false; ui.to.disabled=false;
    ui.tabNote.textContent = "Откройте YouTrack и нажмите значок расширения на его странице.";
    updateConnectionUi();
  }

  function updateConnectionUi() {
    const valid = Boolean(authSession?.kind === "offline" || (authSession?.kind === "tab" ? Number.isInteger(authSession.sourceTabId) : authSession?.accessToken && (!authSession.expiresAt || authSession.expiresAt > Date.now())));
    const mode = authSession?.kind === "captured" ? "Bearer" : authSession?.kind === "offline" ? "Файлы" : authSession?.kind === "tab" ? "Вкладка" : "Подключено";
    ui.state.textContent = valid ? `${mode}: ${authSession.userLabel || "YouTrack"}` : "Не подключено";
    ui.state.title = !valid ? "Получите токен в основном отчёте YouTrack."
      : authSession?.kind === "captured" ? "Исходную вкладку YouTrack можно закрыть: отчёт использует Bearer из сессии браузера."
      : authSession?.kind === "tab" ? "Не закрывайте исходную вкладку YouTrack до завершения сбора."
      : "Сессия из основного отчёта YouTrack.";
    ui.state.classList.toggle("connected", valid);
    ui.disconnect.hidden = !valid;
    ui.loadProjects.disabled = !valid;
  }

  function exactOrigins(...urls) {
    return [...new Set(urls.filter(Boolean).map((value) => `${new URL(value).origin}/*`))];
  }

  function launchSourceTabId(search = location.search) {
    const raw = new URLSearchParams(search).get("tabId");
    if (!/^[1-9]\d*$/.test(String(raw || ""))) return null;
    const tabId = Number(raw);
    return Number.isSafeInteger(tabId) ? tabId : null;
  }

  function launchSourceOrigin(search = location.search) {
    const raw = new URLSearchParams(search).get("origin");
    try {
      const parsed = new URL(String(raw || ""));
      return /^https?:$/.test(parsed.protocol) && parsed.origin === raw ? parsed.origin : "";
    } catch { return ""; }
  }

  function launchSourceBaseUrl(search = location.search, expectedOrigin = "") {
    const raw = new URLSearchParams(search).get("base");
    try {
      const normalized = YouTrackQuery.normalizeBaseUrl(raw);
      return new URL(normalized).origin === expectedOrigin ? normalized : "";
    } catch { return ""; }
  }

  async function wait(ms, signal) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Stopped", "AbortError")); }, { once:true });
    });
  }

  async function apiFetch(url, options = {}) {
    YouTrackFeature.assert();
    if (authSession?.kind === "tab") throw new Error("Сессия YouTrack недоступна. Нажмите «Обновить подключение».");
    if (!authSession?.accessToken) throw new Error("Сначала подключите YouTrack");
    const target = new URL(url);
    const allowedOrigins = new Set(exactOrigins(connection.baseUrl, connection.hubUrl).map((item) => new URL(item).origin));
    if (!allowedOrigins.has(target.origin)) throw new Error("Запрос вышел за настроенный сервер YouTrack");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await YouTrackFeature.fetch(target.toString(), {
        method:options.method || "GET", body:options.body, signal:options.signal,
        headers:{ Accept:"application/json", Authorization:`Bearer ${authSession.accessToken}`, ...(options.headers || {}) },
        credentials:"omit", cache:"no-store", redirect:"error", referrerPolicy:"no-referrer"
      });
      if (response.ok) {
        const data = await response.json();
        return data;
      }
      if (response.status === 401 && authSession?.kind === "captured" && Number.isInteger(sourceTabId)) {
        const origin = new URL(connection.baseUrl).origin;
        await chrome.runtime.sendMessage({ type:"clear-youtrack-captured-auth", origin }).catch(() => {});
        authSession = null;
        updateConnectionUi();
        throw new Error("Сессия YouTrack истекла. Откройте YouTrack в браузере (вход при необходимости) или нажмите «Обновить подключение».");
      }
      if (![429, 502, 503].includes(response.status) || attempt === 2) throw new Error(`HTTP ${response.status}`);
      const retrySeconds = Math.min(5, Math.max(.25, Number(response.headers.get("Retry-After")) || .5 * (attempt + 1)));
      await wait(retrySeconds * 1000, options.signal);
    }
    throw new Error("YouTrack не ответил");
  }

  function projectMatchesProfile(project) {
    const values = new Set([project.id, project.name, project.shortName].filter(Boolean).map((v) => String(v).toLocaleLowerCase("ru")));
    return (profile?.projects || []).some((item) => values.has(String(item.id).toLocaleLowerCase("ru")) || values.has(String(item.name).toLocaleLowerCase("ru")));
  }

  function renderProjects() {
    ui.projectList.replaceChildren();
    for (const project of projects) {
      const label = document.createElement("label"); label.className = "project-option";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = project.id; checkbox.checked = selectedProjectIds.has(project.id);
      const text = document.createElement("span"); text.textContent = project.name;
      checkbox.addEventListener("change", () => checkbox.checked ? selectedProjectIds.add(project.id) : selectedProjectIds.delete(project.id));
      label.append(checkbox, text); ui.projectList.append(label);
    }
  }

  async function loadProjects(internal = false) {
    if(!YouTrackFeature.enabled)return false;
    if ((!internal && ui.loadProjects.disabled) || activeController || (!internal && !actionAllowed("load-projects"))) return false;
    clearError(ui.connectionError);
    ui.loadProjects.disabled = true;
    const controller = new AbortController(); activeController = controller;
    try {
      const loaded = [];
      const cacheHit = internal && projectsCache?.baseUrl === connection.baseUrl && projectsCache?.user === authSession?.userLabel && Date.now() - projectsCache.at < CACHE_TTL_MS;
      if (cacheHit) loaded.push(...projectsCache.rows);
      for (let skip = 0; !cacheHit && skip < MAX_PROJECTS; skip += 100) {
        if (skip) await waitBetweenRequests(controller.signal);
        const url = YouTrackQuery.projectsUrl(connection.baseUrl, skip, 100), startedAt = performance.now();
        let page;
        try { page = await apiFetch(url, { signal:controller.signal }); recordTechnical("Проекты", url, startedAt, `Успешно · ${Array.isArray(page) ? page.length : 0}`); }
        catch (error) { recordTechnical("Проекты", url, startedAt, error?.name === "AbortError" ? "Остановлено" : "Ошибка"); throw error; }
        if (!Array.isArray(page)) throw new Error("YouTrack вернул некорректный список проектов");
        loaded.push(...page.filter((item) => item && !item.archived).slice(0, MAX_PROJECTS - loaded.length));
        if (page.length < 100) break;
      }
      projects = loaded.sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
      connectedProjects=projects.slice();onlineAuthSession=authSession;
      projectsCache = {baseUrl:connection.baseUrl,user:authSession?.userLabel,at:Date.now(),rows:projects};
      selectedProjectIds = new Set(projects.filter(projectMatchesProfile).map((item) => item.id));
      renderProjects(); fillRules(profile?.classification || YouTrackWorkItems.DEFAULT_CLASSIFICATION);
      ui.profilePanel.hidden = false; ui.runPanel.hidden = false;
      ui.profileNote.textContent = profile?.id === "legacy-import" ? "Команды перенесены из старого teams.json. Исходный файл больше не нужен." : "Выберите проекты. Для простого отчёта каждый проект считается одной командой.";
      ui.profileKind.textContent = profile?.id === "legacy-import" ? "Импортированный" : "Автоматический";
      return true;
    } catch (error) { showError(ui.connectionError, safeMessage(error)); return false; }
    finally { activeController = null; ui.loadProjects.disabled = false; updateFolderAccess(); }
  }

  function fillRules(value) {
    const c = YouTrackWorkItems.mergeClassification(value);
    ui.development.value = c.workItemTypes.development.join(", "); ui.meeting.value = c.workItemTypes.meeting.join(", "); ui.overtime.value = c.workItemTypes.overtime.join(", ");
    ui.issueField.value = c.issueType.fieldName; ui.business.value = c.issueType.business.join(", "); ui.technical.value = c.issueType.technical.join(", "); ui.bug.value = c.issueType.bug.join(", "); ui.works.value = c.issueType.works.join(", ");
    ui.statusField.value = c.completion.fieldName; ui.statuses.value = c.completion.values.join(", "); ui.estimate.value = c.estimateFieldName;
  }

  function rulesFromUi() {
    return YouTrackWorkItems.mergeClassification({
      workItemTypes:{development:splitList(ui.development.value),meeting:splitList(ui.meeting.value),overtime:splitList(ui.overtime.value)},
      issueType:{fieldName:ui.issueField.value,business:splitList(ui.business.value),technical:splitList(ui.technical.value),bug:splitList(ui.bug.value),works:splitList(ui.works.value)},
      completion:{fieldName:ui.statusField.value,values:splitList(ui.statuses.value)}, estimateFieldName:ui.estimate.value
    });
  }

  function currentSelectedProjects() {
    return projects.filter((item) => selectedProjectIds.has(item.id));
  }

  async function saveProfile(next) {
    reportCache.clear();
    profile = next;
    await localSet({ [PROFILE_KEY]:next });
    folderControls();
  }

  async function saveRules() {
    clearError(ui.profileError);
    const chosen = currentSelectedProjects();
    const base = profile?.id === "legacy-import" ? profile : YouTrackWorkItems.automaticProfile(chosen);
    await saveProfile({ ...base, projects:chosen.map(({id,name,shortName}) => ({id,name,shortName})), classification:rulesFromUi(), statusOverridesProjects:true });
    ui.profileNote.textContent = profile.id === "legacy-import" ? "Импортированные команды и правила сохранены локально." : "Выбранные проекты и правила сохранены локально.";
  }

  async function readJsonFile(file, maxBytes) {
    if (!file || file.size > maxBytes) throw new Error("Файл слишком большой");
    return JSON.parse(await file.text());
  }

  function workItemsArray(value) {
    const items = Array.isArray(value) ? value : Array.isArray(value?.workItems) ? value.workItems : Array.isArray(value?.items) ? value.items : null;
    if (!items) throw new Error("В work_items.json не найден массив данных");
    if (items.length > MAX_WORK_ITEMS) throw new Error(`В файле больше ${MAX_WORK_ITEMS} work items. Уменьшите период.`);
    return items;
  }

  function projectsFromWorkItems(value) {
    const found = new Map();
    for (const item of workItemsArray(value)) {
      const project = item?.issue?.project || {}, name = String(project.name || project.shortName || project.id || "").trim();
      if (!name) continue;
      const id = String(project.id || project.shortName || name).trim();
      if (!found.has(id)) found.set(id, {id,name,shortName:String(project.shortName || "")});
    }
    return [...found.values()].sort((a,b)=>a.name.localeCompare(b.name,"ru"));
  }

  function itemDate(value) {
    const numeric=Number(value); if(Number.isFinite(numeric))return numeric;
    const parsed=Date.parse(String(value||"")); return Number.isFinite(parsed)?parsed:null;
  }

  async function activateOfflineData(items, migrated, label) {
    offlineWorkItems = workItemsArray(items);
    await saveProfile(migrated);
    projects = migrated.projects.map(project => ({ id:project.id, name:project.name, shortName:"", archived:false }));
    selectedProjectIds = new Set(projects.map(project => project.id));
    authSession = { kind:"offline", userLabel:label };
    ui.ignorePeriod.disabled = false;
    ui.profilePanel.hidden = false; ui.runPanel.hidden = false;
    ui.profileKind.textContent = "Файлы";
    ui.profileNote.textContent = `Загружены teams.json и work_items.json · ${offlineWorkItems.length} записей. Данные находятся только в памяти вкладки.`;
    renderProjects(); fillRules(migrated.classification); updateConnectionUi();
  }

  async function readBundledJson(name, maxBytes) {
    if(globalThis.YouTrackFolders?.configured)return YouTrackFolders.read(name,maxBytes);
    for (const candidate of [name, `extension/youtrack/${name}`, `extension/${name}`]) {
      let response;
      try { response = await fetch(chrome.runtime.getURL(candidate), { cache:"no-store" }); }
      catch { continue; }
      if (!response.ok) continue;
      const text = await response.text();
      if (text.length > maxBytes) throw new Error(`${candidate}: превышен размер файла`);
      try { return {data:JSON.parse(text.replace(/^\uFEFF/, "")),path:candidate}; }
      catch { throw new Error(`${candidate}: файл найден, но содержит некорректный JSON`); }
    }
    return null;
  }

  async function loadBundledOfflineFiles() {
    try {
      const reads = await Promise.allSettled([readBundledJson("teams.json", 1024 * 1024), readBundledJson("work_items.json", 64 * 1024 * 1024), readBundledJson("config.json", 1024 * 1024)]);
      const files = reads.map(result => result.status === "fulfilled" ? result.value : null);
      const [teams, items, config] = files.map(file => file?.data ?? null);
      const errors = reads.filter(result => result.status === "rejected").map(result => result.reason.message);
      if (errors.length) showError(ui.profileError, errors.join(". "));
      if (config) pendingLegacyConfig = config;
      if(config) fileSources.config=`Найден ${files[2].path} · работаем с ним`;
      folderSettingsSignature=JSON.stringify([teams || undefined,config || undefined]);
      if (!items) {
        ui.jsonNote.textContent = teams ? `Команды: ${files[0].path}. Записи списаний: из YouTrack после подключения.` : profile?.teams?.length ? `Команды: сохранённый профиль (${profile.teams.length}). Записи списаний: из YouTrack после подключения.` : "teams.json не прочитан рядом с manifest.json и в extension/. Импортируйте файл через «Импорт teams.json»; без него проект считается командой.";
        if (teams) { const migrated=YouTrackWorkItems.migrateLegacy(teams,config); await saveProfile(migrated); fillRules(migrated.classification); ui.profileKind.textContent="Из файла"; fileSources.teams=`Найден ${files[0].path} · работаем с ним`; syncFileProjects(migrated); }
        return false;
      }
      const migrated = teams ? YouTrackWorkItems.migrateLegacy(teams, config) : profile?.teams?.length ? profile : YouTrackWorkItems.automaticProfile(projectsFromWorkItems(items));
      await activateOfflineData(items, migrated, "папка расширения");
      fileSources.work=`Найден ${files[1].path} · работаем с ним`;
      if(teams)fileSources.teams=`Найден ${files[0].path} · работаем с ним`;
      ui.jsonNote.textContent = teams ? "Используются teams.json и work_items.json из папки расширения." : "Используется work_items.json из папки; каждый проект считается отдельной командой.";
      return true;
    } catch (error) { showError(ui.profileError, `Не удалось прочитать JSON из папки расширения. ${safeMessage(error)}`); ui.jsonNote.textContent="Файл найден, но не применён. Проверьте сообщение об ошибке ниже."; return false; }
    finally { renderFileSources(); }
  }

  async function importLegacyTeams(file) {
    clearError(ui.profileError);
    try {
      const data = await readJsonFile(file, 1024 * 1024);
      const migrated = YouTrackWorkItems.migrateLegacy(data, pendingLegacyConfig);
      await saveProfile(migrated); fillRules(migrated.classification);
      if (!projects.length) projects = migrated.projects.map((project) => ({ id:project.id, name:project.name, shortName:"", archived:false }));
      selectedProjectIds = new Set(projects.filter(projectMatchesProfile).map((item) => item.id)); renderProjects();
      ui.profileKind.textContent = "Импортированный";
      ui.profileNote.textContent = `Перенесено команд: ${migrated.teams.length}. Исходный teams.json больше не используется.`;
      fileSources.teams="Выбран teams.json · работаем с ним";
      ui.jsonNote.textContent="teams.json применён. Команды можно изменить кнопкой «Редактировать команды».";
      if (offlineWorkItems) await activateOfflineData(offlineWorkItems, migrated, "выбранные JSON");
    } catch (error) { showError(ui.profileError, safeMessage(error)); }
    finally { ui.teamsFile.value = ""; renderFileSources(); }
  }

  async function importLegacyWorkItems(file) {
    clearError(ui.profileError);
    try {
      offlineWorkItems = workItemsArray(await readJsonFile(file, 64 * 1024 * 1024));
      ui.ignorePeriod.disabled = false;
      const hasTeams = profile?.id === "legacy-import";
      const nextProfile = hasTeams ? profile : YouTrackWorkItems.automaticProfile(projectsFromWorkItems(offlineWorkItems));
      await activateOfflineData(offlineWorkItems, nextProfile, "выбранные JSON");
      fileSources.work="Выбран work_items.json · работаем с ним";
      ui.jsonNote.textContent = hasTeams ? "Используются выбранные teams.json и work_items.json." : "Используется выбранный work_items.json; каждый проект считается отдельной командой.";
    } catch (error) { showError(ui.profileError, safeMessage(error)); }
    finally { ui.workItemsFile.value = ""; renderFileSources(); }
  }

  async function importLegacyConfig(file) {
    clearError(ui.profileError);
    try {
      pendingLegacyConfig = await readJsonFile(file, 256 * 1024);
      if (!profile || profile.id !== "legacy-import") throw new Error("Сначала импортируйте teams.json");
      const reconstructed = profile.projects.map((project) => {
        const projectTeams = profile.teams.filter((team) => team.projectName === project.name);
        const completion = projectTeams.find((team) => team.completion)?.completion;
        return {
          projectName:project.name,
          ...(completion ? { closed_tasks_condition:`${completion.fieldName}: ${completion.values.map((value) => `{${value}}`).join(", ")}` } : {}),
          teams:projectTeams.map((team) => ({name:team.name,capacity_in_hours:team.capacityHours,members:team.members}))
        };
      });
      const migrated = YouTrackWorkItems.migrateLegacy(reconstructed, pendingLegacyConfig);
      await saveProfile(migrated); fillRules(migrated.classification);
      ui.profileNote.textContent = "Правила config.json перенесены в локальный профиль. Исходный файл больше не используется.";
      fileSources.config="Выбран config.json · работаем с ним";
    } catch (error) { showError(ui.profileError, safeMessage(error)); }
    finally { ui.configFile.value = ""; renderFileSources(); }
  }

  function formatHours(value) {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits:1 }).format(Number(value) || 0);
  }

  function summaryCard(label, value) {
    const card = document.createElement("div"); card.className = "summary-card";
    const caption = document.createElement("span"); caption.textContent = label;
    const strong = document.createElement("strong"); strong.textContent = value;
    card.append(caption, strong); return card;
  }

  function estimateText(stats) {
    if (!stats?.estimateTotal) return stats?.closedFeatures ? `— (0 из ${stats.closedFeatures})` : "—";
    const average = Math.round(stats.estimateAveragePct || 0);
    return `${average}% (${stats.estimateTotal} из ${stats.closedFeatures}, превысили: ${stats.estimateTotal - stats.estimateHits})`;
  }

  function detailButton(label, onClick) {
    const button = document.createElement("button"); button.type="button"; button.className="cell-action"; button.textContent=label; button.addEventListener("click", onClick); return button;
  }

  function appendValueCell(row, value, onClick = null, className = "") {
    const cell=document.createElement("td"); if (className) cell.className=className;
    if (onClick) cell.append(detailButton(value,onClick)); else cell.textContent=value;
    row.append(cell); return cell;
  }

  function closeBreakdown() { ui.modal.hidden=true; ui.modalContent.replaceChildren(); latestBreakdown=null; }

  function issueUrl(issue) {
    if (!connection?.baseUrl || !issue || issue === "—") return "";
    try {
      const base = new URL(connection.baseUrl);
      if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) return "";
      base.search = ""; base.hash = "";
      base.pathname = `${base.pathname.replace(/\/$/, "")}/issue/${encodeURIComponent(String(issue))}`;
      return base.href;
    } catch { return ""; }
  }

  function issueLabel(issue) {
    const url = issueUrl(issue), label = document.createElement(url ? "a" : "span");
    label.textContent = String(issue ?? "—");
    if (url) { label.href = url; label.target = "_blank"; label.rel = "noopener noreferrer"; label.className = "issue-link"; label.title = `Открыть ${issue} в YouTrack`; }
    return label;
  }

  function openBreakdown(title, headers, rows, meta = "") {
    latestBreakdown = {title,headers,rows}; ui.modalTitle.textContent=title; ui.modalMeta.textContent=meta; ui.modalContent.replaceChildren();
    const table=document.createElement("table"), head=document.createElement("thead"), headRow=document.createElement("tr"), body=document.createElement("tbody");
    for (const header of headers) { const th=document.createElement("th"); th.textContent=header; headRow.append(th); }
    for (const values of rows) { const row=document.createElement("tr"); values.forEach((value,index) => { const cell=document.createElement("td"); if(headers[index]==="Задача")cell.append(issueLabel(value));else cell.textContent=String(value ?? "—"); row.append(cell); }); body.append(row); }
    head.append(headRow); table.append(head,body); ui.modalContent.append(table); ui.modal.hidden=false;
  }

  function metricBreakdown(team, stats, metric, label, member = "") {
    const rows=(stats.details?.[metric] || []).slice().sort((a,b)=>(a.date||0)-(b.date||0)).map(item=>[item.issue,item.author,item.date?new Date(item.date).toLocaleDateString("ru-RU"):"—",formatHours(item.hours)]);
    openBreakdown(`${label} · ${member || team.name}`, ["Задача","Сотрудник","Дата","Часы"], rows, `Всего: ${formatHours(stats[metric])} ч`);
  }

  function closedBreakdown(team, stats, member = "") {
    const rows=(stats.details?.closed || []).map(item=>[item.issue,(item.authors||[]).join(", "),item.status,formatHours(item.hours)]);
    openBreakdown(`Закрытые БЗ · ${member || team.name}`, ["Задача","Сотрудники","Статус","Факт, ч"], rows, `Задач: ${stats.closedFeatures}`);
  }

  function estimateBreakdown(team, stats, member = "") {
    const rows=(stats.details?.estimate || []).map(item=>[item.issue,(item.authors||[]).join(", "),formatHours(item.estimate),formatHours(item.actual),`${Math.round(item.ratioPct)}%`,item.ratioPct>100?"Превышена":"В пределах"]);
    openBreakdown(`Оценка · ${member || team.name}`, ["Задача","Сотрудники","Оценка","Факт","Факт / оценка","Результат"], rows, estimateText(stats));
  }

  function utilizationBreakdown(team, stats) {
    const utilization=team.capacityHours>0?stats.business/team.capacityHours*100:null;
    openBreakdown(`Утилизация · ${team.name}`, ["Показатель","Значение"], [["Бизнес-часы",formatHours(stats.business)],["Бизнес-ёмкость",team.capacityHours==null?"—":formatHours(team.capacityHours)],["Расчёт",utilization==null?"—":`${formatHours(stats.business)} / ${formatHours(team.capacityHours)} × 100 = ${Math.round(utilization)}%`]]);
  }

  async function changeCapacity(team, value) {
    const number=Number(String(value).replace(",",".")); if (!Number.isFinite(number)||number<0||number>100000) return;
    team.capacityHours=number;
    if (profile?.teams) await saveProfile({...profile,teams:profile.teams.map(item=>item.id===team.id?{...item,capacityHours:number}:item)});
    renderResult(latestResult,latestPeriod);
  }

  function metricLabels(result = latestResult) {
    return {business:"Бизнес",technical:"Тех",bug:"Баги",overtime:"Оверы",meeting:"Встречи/Иное",...(result?.profile?.labels||{})};
  }

  function renderStatsCells(row, team, stats, member = "") {
    if (!member) {
      const capacity=document.createElement("td"), input=document.createElement("input"); input.className="capacity-input"; input.type="number"; input.min="0"; input.step="0.5"; input.value=team.capacityHours??""; input.setAttribute("aria-label",`Ёмкость ${team.name}`); input.addEventListener("change",()=>changeCapacity(team,input.value)); capacity.append(input); row.append(capacity);
    } else appendValueCell(row,"—");
    appendValueCell(row,String(stats.closedFeatures),()=>closedBreakdown(team,stats,member));
    const labels=metricLabels();
    for (const metric of ["business","technical","bug","overtime","meeting"]) appendValueCell(row,formatHours(stats[metric]),()=>metricBreakdown(team,stats,metric,labels[metric],member));
    const utilization=!member&&team.capacityHours>0?stats.business/team.capacityHours*100:null;
    appendValueCell(row,utilization==null?"—":`${Math.round(utilization)}%`,member?null:()=>utilizationBreakdown(team,stats),utilization==null?"":utilization>100?"util-over":utilization>=80?"util-ok":"util-warn");
    appendValueCell(row,formatHours(stats.business+stats.technical+stats.bug+stats.overtime+stats.meeting));
    appendValueCell(row,estimateText(stats),()=>estimateBreakdown(team,stats,member));
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgNode(name, attributes = {}, value = "") {
    const node=document.createElementNS(SVG_NS,name);
    for(const [key,current] of Object.entries(attributes))node.setAttribute(key,String(current));
    if(value)node.textContent=value;
    return node;
  }

  function chartTooltip(row, model) {
    if(model.kind==="people")return `${row.label}: ${row.segments.map(item=>`${item.label} ${formatHours(item.value)} ч`).join(", ")}`;
    if(model.kind==="capacity")return `${row.label}: бизнес ${formatHours(row.actual)} ч, ёмкость ${row.hasCapacity?`${formatHours(row.capacity)} ч`:"не задана"}`;
    return `${row.label}: оценка ${formatHours(row.estimate)} ч, факт ${formatHours(row.actual)} ч${row.exceeded?", превышение":""}`;
  }

  function renderChartLegend(model) {
    ui.chartLegend.replaceChildren();
    for(const item of model.legend){const entry=document.createElement("span"),dot=document.createElement("i");dot.style.background=item.color;entry.append(dot,document.createTextNode(item.label));ui.chartLegend.append(entry);}
  }

  function renderChartSvg(model) {
    ui.chart.replaceChildren();
    if(!model.rows.length){const empty=document.createElement("div");empty.className="chart-empty";empty.textContent=model.kind==="estimate"?"Нет закрытых бизнес-задач с оценкой в выбранном периоде.":"Для этого графика пока нет данных.";ui.chart.append(empty);return;}
    const width=Math.max(340,Math.round(ui.chart.clientWidth||760)),compact=width<560,labelWidth=compact?116:Math.min(220,Math.round(width*.27)),right=compact?48:70,plotWidth=Math.max(130,width-labelWidth-right-22),rowHeight=compact?42:38,top=30,height=top+model.rows.length*rowHeight+28;
    const svg=svgNode("svg",{viewBox:`0 0 ${width} ${height}`,width:"100%",height,role:"img","aria-label":model.ariaLabel,preserveAspectRatio:"xMinYMin meet"});
    svg.append(svgNode("title",{},model.ariaLabel));
    const x=value=>labelWidth+12+Math.max(0,Number(value)||0)/model.maxValue*plotWidth;
    for(const tick of [0,.5,1]){const px=labelWidth+12+plotWidth*tick;svg.append(svgNode("line",{x1:px,y1:top-12,x2:px,y2:height-22,class:"chart-grid-line"}));svg.append(svgNode("text",{x:px,y:14,class:"chart-axis-label","text-anchor":tick===0?"start":tick===1?"end":"middle"},`${formatHours(model.maxValue*tick)} ч`));}
    model.rows.forEach((row,index)=>{
      const y=top+index*rowHeight,label=svgNode("text",{x:0,y:y+15,class:"chart-row-label"},row.label);label.append(svgNode("title",{},`${row.group} · ${row.label}`));
      const url=model.kind==="estimate"?issueUrl(row.label):"";
      if(url){const link=svgNode("a",{href:url,target:"_blank",rel:"noopener noreferrer",class:"issue-link","aria-label":`Открыть ${row.label} в YouTrack`});link.append(label);svg.append(link);}else svg.append(label);
      const trackY=y+3,trackH=compact?18:16;svg.append(svgNode("rect",{x:labelWidth+12,y:trackY,width:plotWidth,height:trackH,rx:5,class:"chart-svg-track"}));
      if(model.kind==="people"){
        let cursor=labelWidth+12;
        for(const segment of row.segments){const w=segment.value/model.maxValue*plotWidth;if(w>0){const rect=svgNode("rect",{x:cursor,y:trackY,width:w,height:trackH,fill:segment.color});rect.append(svgNode("title",{},`${row.label} · ${segment.label}: ${formatHours(segment.value)} ч`));svg.append(rect);cursor+=w;}}
        svg.append(svgNode("text",{x:width-2,y:y+15,class:"chart-value","text-anchor":"end"},`${formatHours(row.total)} ч`));
      }else if(model.kind==="capacity"){
        if(row.hasCapacity)svg.append(svgNode("rect",{x:labelWidth+12,y:trackY,width:Math.max(1,x(row.capacity)-(labelWidth+12)),height:trackH,rx:5,fill:YouTrackCharts.PALETTE.capacity}));
        const actual=svgNode("rect",{x:labelWidth+12,y:trackY+4,width:Math.max(0,x(row.actual)-(labelWidth+12)),height:trackH-8,rx:3,fill:row.hasCapacity&&row.actual>row.capacity?YouTrackCharts.PALETTE.bug:YouTrackCharts.PALETTE.actual});actual.append(svgNode("title",{},chartTooltip(row,model)));svg.append(actual);
        if(row.hasCapacity)svg.append(svgNode("line",{x1:x(row.capacity),y1:trackY-3,x2:x(row.capacity),y2:trackY+trackH+3,class:"chart-capacity-marker"}));
        svg.append(svgNode("text",{x:width-2,y:y+15,class:"chart-value","text-anchor":"end"},row.hasCapacity?`${Math.round(row.actual/Math.max(row.capacity,.0001)*100)}%`:"—"));
      }else{
        svg.append(svgNode("rect",{x:labelWidth+12,y:trackY,width:Math.max(0,x(row.estimate)-(labelWidth+12)),height:trackH,rx:5,fill:YouTrackCharts.PALETTE.estimate}));
        const actual=svgNode("rect",{x:labelWidth+12,y:trackY+4,width:Math.max(0,x(row.actual)-(labelWidth+12)),height:trackH-8,rx:3,fill:row.exceeded?YouTrackCharts.PALETTE.bug:YouTrackCharts.PALETTE.actual});actual.append(svgNode("title",{},chartTooltip(row,model)));svg.append(actual);
        svg.append(svgNode("text",{x:width-2,y:y+15,class:`chart-value${row.exceeded?" exceeded":""}`,"text-anchor":"end"},row.ratioPct==null?"—":`${Math.round(row.ratioPct)}%`));
      }
    });
    ui.chart.append(svg);
  }

  function fillChartTeams(result) {
    const selected=ui.chartTeam.value;ui.chartTeam.replaceChildren(new Option("Все команды",""));
    for(const team of result.teams)ui.chartTeam.append(new Option(`${team.projectName} · ${team.name}`,team.id));
    if([...ui.chartTeam.options].some(option=>option.value===selected))ui.chartTeam.value=selected;
  }

  function renderAnalytics(result=latestResult) {
    if(!result||!globalThis.YouTrackCharts)return;
    const model=YouTrackCharts.createModel(result,activeChartKind,{teamId:ui.chartTeam.value,limit:40});currentChartModel=model;
    document.querySelectorAll("[data-chart-kind]").forEach(button=>button.setAttribute("aria-selected",String(button.dataset.chartKind===activeChartKind)));
    ui.chartTeamWrap.hidden=activeChartKind!=="people";renderChartLegend(model);renderChartSvg(model);
    const countNote=model.truncated?`Показано ${model.rows.length} из ${model.totalRows}. PNG содержит тот же сокращённый набор.`:`Показано строк: ${model.rows.length}.`;
    ui.chartNote.textContent=`${model.subtitle} ${countNote}`;
    YouTrackSensorHelp.attach(ui.chartPanel,model.title,model.kind==="people"?"Каждый сегмент — сумма часов work items участника в категории. Все часы = бизнес + технические + баги + оверы + встречи. Это списания за период, не фактическая занятость. Показанный набор ограничен: число строк указано под графиком.":model.kind==="capacity"?"Утилизация = бизнес-часы команды / настроенная бизнес-ёмкость × 100%. Ёмкость задаётся пользователем для периода; при отсутствии ёмкости процент не вычисляется.":"Сравниваются оценка и учтённые часы разработки закрытых бизнес-задач. Отношение = факт / оценка × 100%. Для файла факт старого отчёта может включать записи за пределами выбранного периода; новые расчёты Сенсора явно ограничены выбранным периодом.");
    ui.downloadChart.disabled=!model.rows.length;ui.chartPanel.hidden=false;
  }

  function renderProjectChart(result) {
    fillChartTeams(result);renderAnalytics(result);
  }

  function paintPng(projection, canvas) {
    const width=1400,rowHeight=34,height=Math.max(360,150+projection.rows.length*rowHeight),ctx=canvas.getContext("2d");canvas.width=width;canvas.height=height;
    ctx.fillStyle="#ffffff";ctx.fillRect(0,0,width,height);ctx.fillStyle="#242532";ctx.font="700 30px system-ui, sans-serif";ctx.fillText(projection.title,52,48);ctx.fillStyle="#6f7180";ctx.font="16px system-ui, sans-serif";ctx.fillText(projection.subtitle.slice(0,145),52,78);
    let legendX=52;ctx.font="15px system-ui, sans-serif";for(const item of projection.legend){ctx.fillStyle=item.color;ctx.fillRect(legendX,98,14,14);ctx.fillStyle="#555766";ctx.fillText(item.label,legendX+21,110);legendX+=Math.max(115,ctx.measureText(item.label).width+48);}
    const labelWidth=330,plotX=labelWidth+52,plotWidth=width-plotX-110,max=Math.max(1,projection.maxValue);ctx.font="15px system-ui, sans-serif";
    projection.rows.forEach((row,index)=>{const y=138+index*rowHeight;ctx.fillStyle="#3d3f4c";ctx.fillText(row.label.slice(0,38),52,y+17);ctx.fillStyle="#f0f0f4";ctx.fillRect(plotX,y,plotWidth,18);
      if(projection.kind==="people"){let x=plotX;for(const part of row.segments){const w=part.value/max*plotWidth;ctx.fillStyle=part.color;ctx.fillRect(x,y,w,18);x+=w;}}
      else if(projection.kind==="capacity"){if(row.hasCapacity){ctx.fillStyle="#c8c9d2";ctx.fillRect(plotX,y,row.capacity/max*plotWidth,18);}ctx.fillStyle=row.hasCapacity&&row.actual>row.capacity?"#e84c5b":"#5b5bd6";ctx.fillRect(plotX,y+5,row.actual/max*plotWidth,8);if(row.hasCapacity){const marker=plotX+row.capacity/max*plotWidth;ctx.fillStyle="#3e3f4e";ctx.fillRect(marker-1,y-3,2,24);}}
      else{ctx.fillStyle="#b8a9f2";ctx.fillRect(plotX,y,row.estimate/max*plotWidth,18);ctx.fillStyle=row.exceeded?"#e84c5b":"#5b5bd6";ctx.fillRect(plotX,y+5,row.actual/max*plotWidth,8);}
    });
    ctx.fillStyle="#8a8c98";ctx.font="13px system-ui, sans-serif";ctx.fillText(projection.truncated?`Показано ${projection.rows.length} из ${projection.totalRows}`:`Строк: ${projection.rows.length}`,52,height-28);
  }

  function downloadCurrentChart() {
    if(!currentChartModel||ui.downloadChart.disabled||!actionAllowed("export-chart",500))return;
    const projection=YouTrackCharts.exportProjection(currentChartModel),canvas=document.createElement("canvas");paintPng(projection,canvas);
    ui.downloadChart.disabled=true;canvas.toBlob(blob=>{if(blob)downloadBlob(blob,`youtrack-${projection.kind}-${filePeriod()}.png`);ui.downloadChart.disabled=false;},"image/png");
  }

  let analysisMascot=null;
  function rootResetSensor(){YouTrackSensorPdf.cancel();YouTrackSensorHelp.close();$("#sensor-expanded-analysis").replaceChildren();latestResult=null;latestPeriod=null;currentChartModel=null;ui.chartPanel.hidden=true;ui.chart.replaceChildren();}
  function insightFormula(title){
    if(title.startsWith('Списания участников'))return 'Для каждого участника складываются бизнес-часы, технические, баги, оверы и встречи за выбранный период. Среднее = сумма часов участников / число участников команды (включая участников без списаний). Это не фактическая занятость: отпуска и незаписанная работа неизвестны.';
    if(title==='Выше 100%'||title==='Нет бизнес-ёмкости')return 'Утилизация = бизнес-часы / настроенная ёмкость команды × 100%. Без положительной ёмкости процент не считается. Сверьте ёмкость с выбранным периодом.';
    if(title==='Закрыты без оценки')return 'Число закрытых бизнес-задач минус число таких задач с положительной оценкой. Статус закрытия и поле оценки задаются правилами профиля. Отсутствующая и нулевая оценки не входят в сравнение.';
    if(title==='Превысили оценку')return 'Для закрытых бизнес-задач: факт разработки / оценка × 100%. Превышение — строго более 100%. В исходном отчёте по файлу факт может учитывать все записи файла для задачи; новые сводки Сенсора используют только выбранный период. Задачи разных команд здесь могут повторяться.';
    if(title==='Не сопоставлено с командой')return 'Сумма часов записей, для которых профиль не дал однозначную команду. Доля = эти часы / все сырые часы × 100%. В новых сводках Сенсора дополнительно исключены повторные work items.';
    if(title==='Не попало в категории')return 'Часы сопоставленных с командой записей, которым правила типа списания и типа задачи не назначили категорию. Проверьте config.json и значения полей.';
    if(title==='Повторы отброшены')return 'Повтором считается повторный work item с тем же id. Повторная запись исключается из расчёта часов; её часы отдельно учитываются в диагностике.';
    if(title==='Неполные записи')return 'Счётчики отсутствующих/некорректных полей исходного отчёта. Одна запись может иметь несколько недостатков, поэтому складывать счётчики как число уникальных записей нельзя.';
    return 'Проверяются загруженные work items по правилам выбранного профиля и периода. Выводы описывают учтённые данные; они не доказывают отсутствие работы или полную загрузку человека.';
  }
  async function exportSensorPdf(payload){
    const button=$("#export-sensor-pdf"),stop=$("#stop-sensor-pdf"),status=$("#sensor-export-status");if(!latestResult||button.disabled)return;
    const result=latestResult,period=latestPeriod;button.disabled=true;stop.hidden=false;status.textContent='Готовлю PDF локально…';
    const fmt=YouTrackSensorAnalysis.fmt,sections=payload.sections.slice(),charts=payload.charts.slice();
    sections.splice(1,0,{title:'Источник и сводка отчёта',paragraphs:[`${result.sensorContext?.source||'Загруженные данные'}; ${period}; проекты: ${(result.sensorContext?.projects||[]).join(', ')}.`,...Array.from(ui.insights.children).map(card=>`${card.querySelector('strong')?.textContent||''}. ${card.querySelector('span')?.textContent||''}`)],headers:['Проект / команда','Бизнес, ч','Тех., ч','Баги, ч','Оверы, ч','Встречи, ч','Ёмкость, ч'],rows:result.teams.map(t=>({values:[t.projectName+' / '+t.name,...['business','technical','bug','overtime','meeting'].map(k=>fmt(t.stats[k])),t.capacityHours==null?'—':fmt(t.capacityHours)]}))});
    sections.push({title:'Списания участников',headers:['Проект / команда','Участник','Бизнес, ч','Тех., ч','Баги, ч','Оверы, ч','Встречи, ч'],rows:result.teams.flatMap(t=>t.members.map(m=>({values:[t.projectName+' / '+t.name,m.login,...['business','technical','bug','overtime','meeting'].map(k=>fmt(m.stats[k]))]})))});
    const people=result.teams.flatMap(t=>t.members.map(m=>({label:t.name+' / '+m.login,values:YouTrackCharts.CATEGORY_KEYS.map(k=>({value:m.stats[k]||0,color:YouTrackCharts.PALETTE[k],label:metricLabels(result)[k]}))})));
    const capacity=result.teams.flatMap(t=>[{label:t.name+' / бизнес',values:[{value:t.stats.business||0,color:'#7356c3'}]},...(t.capacityHours>0?[{label:t.name+' / ёмкость',values:[{value:t.capacityHours,color:'#9993ad'}]}]:[])]);
    const estimates=result.teams.flatMap(t=>(t.stats.details?.estimate||[]).flatMap(e=>[{label:e.issue+' / оценка',values:[{value:e.estimate,color:'#aaa0ce'}]},{label:e.issue+' / факт',values:[{value:e.actual,color:'#7356c3'}]}]));
    for(const [title,rows] of [['Списания по участникам',people],['Факт и ёмкость',capacity],['Оценка и факт исходного отчёта',estimates]])for(let i=0;i<rows.length;i+=24)charts.push({type:'bars',title,note:`Строки ${i+1}–${Math.min(i+24,rows.length)} из ${rows.length}. Значения в часах.`,rows:rows.slice(i,i+24)});
    try{const blob=await YouTrackSensorPdf.download({title:'Полный отчёт Сенсора',period,sections,charts,issueUrl,onProgress:n=>{if(status.isConnected)status.textContent=`Готовлю PDF · страниц ${n}`;}});if(blob){downloadBlob(blob,`sensor-report-${Date.now()}.pdf`);if(status.isConnected)status.textContent='PDF готов. Дополнительных запросов не было.';}}
    catch(error){if(status.isConnected)status.textContent=error.name==='AbortError'?'Выгрузка отменена.':`PDF не создан: ${safeMessage(error)}`;}
    finally{if(button.isConnected)button.disabled=false;if(stop.isConnected)stop.hidden=true;}
  }
  function dismissAnalysisInvite(){analysisMascot?.dispose();analysisMascot=null;$("#sensor-analysis-invite")?.remove();}
  function resetAnalysis(){
    dismissAnalysisInvite();$("#analysis-ready").hidden=true;$("#tab-analysis").classList.remove("has-analysis");
    ui.insights.replaceChildren();rootResetSensor();
    $("#analysis-context").textContent="Сначала постройте отчёт. Здесь появятся наблюдения по его данным.";
  }
  function showAnalysisInvite(){
    sensorView='analysis';
    dismissAnalysisInvite();
    if(document.querySelector("#report-view").dataset.view==="analysis")return;
    $("#analysis-ready").hidden=false;$("#tab-analysis").classList.add("has-analysis");
    const invite=document.createElement("aside");invite.id="sensor-analysis-invite";invite.className="analysis-invite";
    const figure=document.createElement("div");figure.className="analysis-invite-mascot";figure.setAttribute("aria-hidden","true");
    const copy=document.createElement("div"),title=document.createElement("strong"),note=document.createElement("p");
    title.textContent="Я тоже сделал анализ, посмотрим?";title.setAttribute("role","status");
    note.textContent="Проверил оценки, списания и полноту данных этого отчёта.";copy.append(title,note);
    const actions=document.createElement("div");actions.className="actions";
    const open=document.createElement("button");open.type="button";open.className="primary";open.textContent="Посмотреть разбор";open.addEventListener("click",()=>selectView("analysis"));
    const later=document.createElement("button");later.type="button";later.className="quiet";later.textContent="Позже";later.addEventListener("click",()=>{dismissAnalysisInvite();$("#tab-analysis").focus({preventScroll:true});});
    actions.append(open,later);invite.append(figure,copy,actions);ui.resultPanel.prepend(invite);
    if(globalThis.SensorMascot){analysisMascot=SensorMascot.mount(figure,{baseUrl:chrome.runtime.getURL("extension/shared/living-signal-mascot.png"),waveUrl:chrome.runtime.getURL("extension/shared/living-signal-mascot-wave.png")});analysisMascot.setIntro("final");analysisMascot.setState("success");analysisMascot.setScene("celebrate");}
  }

  function renderInsights(result) {
    ui.insights.replaceChildren();
    const d=result.diagnostics||{}, total=Math.max(0,Number(d.rawHours)||0), observations=[];
    if(d.unmatchedHours>0)observations.push(["Не сопоставлено с командой",`${formatHours(d.unmatchedHours)} ч · ${total?Math.round(d.unmatchedHours/total*100):0}% всех часов}`,"warning"]);
    if(d.unclassifiedHours>0)observations.push(["Не попало в категории",`${formatHours(d.unclassifiedHours)} ч · проверьте тип списания и тип задачи`,"warning"]);
    const noCapacity=result.teams.filter(team=>team.stats.business>0&&!(team.capacityHours>0));
    if(noCapacity.length)observations.push(["Нет бизнес-ёмкости",`${noCapacity.length} команд(ы) с бизнес-часами; утилизация для них не считается`,"info"]);
    const over=result.teams.filter(team=>team.capacityHours>0&&team.stats.business/team.capacityHours>1);
    if(over.length)observations.push(["Выше 100%",over.map(team=>`${team.name} · ${Math.round(team.stats.business/team.capacityHours*100)}%`).join("; "),"danger"]);
    const noEstimate=result.teams.reduce((sum,team)=>sum+Math.max(0,team.stats.closedFeatures-team.stats.estimateTotal),0), exceeded=result.teams.reduce((sum,team)=>sum+Math.max(0,team.stats.estimateTotal-team.stats.estimateHits),0);
    const missingEstimateRows = result.teams.flatMap(team => {
      const estimated = new Set((team.stats.details?.estimate || []).map(item => item.issue));
      return (team.stats.details?.closed || []).filter(item => !estimated.has(item.issue)).map(item => ({id:item.issue,description:`${team.projectName} / ${team.name} · ${(item.authors || []).join(", ")} · факт ${formatHours(item.hours)} ч`}));
    });
    const exceededRows = result.teams.flatMap(team => (team.stats.details?.estimate || []).filter(item => item.ratioPct > 100).map(item => ({id:item.issue,description:`${team.projectName} / ${team.name} · оценка ${formatHours(item.estimate)} ч, факт ${formatHours(item.actual)} ч (${Math.round(item.ratioPct)}%)`})));
    if(noEstimate)observations.push(["Закрыты без оценки",`${noEstimate} бизнес-задач не вошли в расчёт «В оценке»`,"info",missingEstimateRows]);
    if(exceeded)observations.push(["Превысили оценку",`${exceeded} закрытых бизнес-задач`,"warning",exceededRows]);
    if(result.duplicates)observations.push(["Повторы отброшены",`${result.duplicates} work items · ${formatHours(d.duplicateHours)} ч`,"info"]);
    const invalid=(d.invalidDuration||0)+(d.invalidDate||0)+(d.missingAuthor||0)+(d.missingProject||0)+(d.missingType||0);
    if(invalid)observations.push(["Неполные записи",`duration: ${d.invalidDuration||0}; дата: ${d.invalidDate||0}; автор: ${d.missingAuthor||0}; проект: ${d.missingProject||0}; тип: ${d.missingType||0}`,"warning"]);
    const memberComparisons=[];
    for(const team of result.teams){
      if(!Array.isArray(team.members)||team.members.length<2)continue;
      const members=team.members.map(member=>({
        login:member.login,
        hours:["business","technical","bug","overtime","meeting"].reduce((sum,key)=>sum+(Number(member.stats?.[key])||0),0)
      })).sort((a,b)=>a.hours-b.hours||a.login.localeCompare(b.login,"ru"));
      const average=members.reduce((sum,member)=>sum+member.hours,0)/members.length;
      const spread=members.at(-1).hours-members[0].hours;
      const roster=members.slice(0,8).map(member=>`${member.login} — ${formatHours(member.hours)} ч`).join(" · ");
      const tail=members.length>8?` · ещё ${members.length-8}`:"";
      const summary=spread<0.1
        ? `Списания распределены ровно: ${formatHours(average)} ч на человека.`
        : `Меньше всего: ${members[0].login} — ${formatHours(members[0].hours)} ч; больше всего: ${members.at(-1).login} — ${formatHours(members.at(-1).hours)} ч; среднее — ${formatHours(average)} ч.`;
      memberComparisons.push([`Списания участников · ${team.name}`,`${summary} ${roster}${tail}`,spread>Math.max(8,average*.5)?"warning":"info"]);
    }
    if(memberComparisons.length){
      observations.push(["Как читать сравнение людей","Это только учтённые work items за выбранный период. Без личной ёмкости, отпусков и незалогированной работы Сенсор не называет человека свободным или перегруженным.","info"]);
      observations.push(...memberComparisons);
    }
    if(!observations.length)observations.push(total>0?["Расхождений не найдено","В выполненных проверках загруженных списаний расхождений не найдено.","ok"]:["Нет списаний для анализа","За выбранный период не загружены часы. Это не означает, что работы не было.","info"]);
    for(const [title,description,tone,issues] of observations){
      const card=document.createElement(issues?.length ? "details" : "article");card.className=`insight ${tone}`;
      const heading=issues?.length ? document.createElement("summary") : card;
      const strong=document.createElement("strong");strong.textContent=title;const text=document.createElement("span");text.textContent=description;heading.append(strong,text);
      if(issues?.length){
        card.append(heading);
        const hint=document.createElement("small");hint.textContent=`Показать задачи · ${issues.length}`;heading.append(hint);
        card.addEventListener("toggle",()=>{hint.textContent=`${card.open ? "Скрыть" : "Показать"} задачи · ${issues.length}`;});
        const list=document.createElement("ul");list.className="insight-issues";list.tabIndex=0;list.setAttribute("aria-label",title);
        for(const issue of issues){const row=document.createElement("li");row.append(issueLabel(issue.id),document.createTextNode(` · ${issue.description}`));list.append(row);}
        const actions=document.createElement("div");actions.className="actions";
        const copy=document.createElement("button");copy.type="button";copy.className="quiet";copy.textContent="Скопировать список";
        copy.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(issues.map(issue=>`${issue.id} · ${issue.description}${issueUrl(issue.id)?` · ${issueUrl(issue.id)}`:""}`).join("\n"));copy.textContent="Скопировано";}catch{copy.textContent="Выделите список и нажмите Ctrl+C";const range=document.createRange();range.selectNodeContents(list);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}});
        const close=document.createElement("button");close.type="button";close.className="quiet";close.textContent="Закрыть список";close.addEventListener("click",()=>{card.open=false;heading.focus();});
        actions.append(copy,close);card.append(list,actions);
      }
      ui.insights.append(card);
      YouTrackSensorHelp.attach(card,title,insightFormula(title));
    }
    YouTrackSensorView.render($("#sensor-expanded-analysis"),result,{issueUrl,download:downloadBlob,onPdf:exportSensorPdf});
    $("#analysis-context").textContent=`${latestPeriod || "Выбранный период"} · ${result.teams.length} команд(ы) · ${formatHours(result.sensorData?.totalHours ?? total)} уникальных часов в загруженных записях`;
    ui.insightsPanel.hidden=document.querySelector("#report-view").dataset.view!=="analysis";
  }

  function projectTotals(teams) {
    const stats={business:0,technical:0,bug:0,overtime:0,meeting:0,closedFeatures:0,estimateTotal:0,estimateHits:0,estimateRatioSum:0}; let capacity=0;
    for(const team of teams){capacity+=Number(team.capacityHours)||0;for(const key of ["business","technical","bug","overtime","meeting","closedFeatures","estimateTotal","estimateHits"])stats[key]+=Number(team.stats[key])||0;stats.estimateRatioSum+=(Number(team.stats.estimateAveragePct)||0)*(Number(team.stats.estimateTotal)||0);}
    stats.estimateAveragePct=stats.estimateTotal?stats.estimateRatioSum/stats.estimateTotal:null; return {capacity,stats};
  }

  function renderProjectRow(name, teams) {
    const {capacity,stats}=projectTotals(teams), row=document.createElement("tr");row.className="project-row";
    appendValueCell(row,name);appendValueCell(row,capacity?formatHours(capacity):"—");appendValueCell(row,String(stats.closedFeatures));
    for(const metric of ["business","technical","bug","overtime","meeting"])appendValueCell(row,formatHours(stats[metric]));
    appendValueCell(row,capacity>0?`${Math.round(stats.business/capacity*100)}%`:"—");appendValueCell(row,formatHours(stats.business+stats.technical+stats.bug+stats.overtime+stats.meeting));appendValueCell(row,estimateText(stats));ui.rows.append(row);
  }

  function renderResult(result, periodLabel) {
    document.querySelector("#refresh-report-data").hidden = false;
    document.querySelector("#refresh-report-data").textContent = offlineWorkItems ? "Пересчитать файл" : "Обновить данные из YouTrack";
    latestResult = result; latestPeriod=periodLabel; ui.rows.replaceChildren(); ui.summary.replaceChildren();
    const labels=metricLabels(result);for(const key of ["business","technical","bug","overtime","meeting"]){const head=document.querySelector(`#head-${key}`);if(head)head.textContent=labels[key];}
    const totals = result.teams.reduce((sum, team) => { for (const key of ["business","technical","bug","overtime","meeting"]) sum[key] += team.stats[key]; sum.closed += team.stats.closedFeatures; return sum; }, {business:0,technical:0,bug:0,overtime:0,meeting:0,closed:0});
    ui.summary.append(summaryCard("Work items", String(result.scanned)), summaryCard("Учтено", String(result.accepted)), summaryCard("Бизнес, ч", formatHours(totals.business)), summaryCard("Закрыто БЗ", String(totals.closed)));
    let currentProject="";
    for (const team of result.teams) {
      if(team.projectName!==currentProject){currentProject=team.projectName;renderProjectRow(currentProject,result.teams.filter(item=>item.projectName===currentProject));}
      const row=document.createElement("tr"); row.className="team-row";
      const name=document.createElement("td");name.className="team-cell";const toggle=detailButton(`${expandedTeams.has(team.id)?"▾":"▸"} ${team.name}`,()=>{expandedTeams.has(team.id)?expandedTeams.delete(team.id):expandedTeams.add(team.id);renderResult(latestResult,periodLabel);});const small=document.createElement("small");small.textContent=`${team.members.length} сотрудник(ов)`;name.append(toggle,small);row.append(name);renderStatsCells(row,team,team.stats);ui.rows.append(row);
      if(expandedTeams.has(team.id)) for(const member of team.members){const memberRow=document.createElement("tr");memberRow.className="member-row";const memberName=document.createElement("td");memberName.textContent=`↳ ${member.login}`;memberRow.append(memberName);renderStatsCells(memberRow,team,member.stats,member.login);ui.rows.append(memberRow);}
    }
    ui.unmatchedList.replaceChildren();
    for (const item of result.unmatched.slice(0, 200)) { const row=document.createElement("div"); row.className="unmatched-row"; const left=document.createElement("span"); left.textContent=`${item.project} · ${item.author}`; const right=document.createElement("strong"); right.textContent=`${formatHours(item.hours)} ч`; row.append(left,right); ui.unmatchedList.append(row); }
    ui.unmatchedCount.textContent = String(result.unmatched.length); ui.unmatchedWrap.hidden = !result.unmatched.length;
    ui.resultMeta.textContent = `${periodLabel} · проектов: ${currentSelectedProjects().length} · дубликатов отброшено: ${result.duplicates}`;
    ui.resultPanel.hidden = false; renderProjectChart(result); renderInsights(result);
    for (const button of document.querySelectorAll("[data-report-jump]")) {
      const target = document.getElementById(button.dataset.reportJump);
      button.disabled = !target || (target !== ui.insightsPanel && target.hidden);
    }
  }

  function reducedMotion() {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  }

  function focusReportSection(target, move = true) {
    if(target===ui.insightsPanel||target===ui.chartPanel)selectView("analysis");
    if (!target || target.hidden) return;
    target.classList.remove("report-jump-target");
    if (move) target.scrollIntoView({ behavior:reducedMotion()?"auto":"smooth", block:"start" });
    if (reducedMotion()) return;
    requestAnimationFrame(() => {
      target.classList.add("report-jump-target");
      setTimeout(() => target.classList.remove("report-jump-target"), 1100);
    });
  }

  function revealFinishedReport() {
    showAnalysisInvite();
    const targets=[ui.resultPanel.querySelector(".section-head"),ui.summary,ui.chartPanel,ui.insightsPanel].filter(item=>item&&!item.hidden);
    for(const [index,target] of targets.entries()){
      target.classList.remove("report-reveal");
      target.style.setProperty("--reveal-delay",`${index*55}ms`);
      if(!reducedMotion())requestAnimationFrame(()=>target.classList.add("report-reveal"));
    }
    requestAnimationFrame(()=>focusReportSection(ui.resultPanel,true));
  }

  async function runReport(internal = false) {
    if(!YouTrackFeature.enabled)return false;
    if (folderBusy || checkingFiles) return false;
    const access=folderAccess();if(!access.allowed){updateFolderAccess();showError(ui.runError,access.text);return false;}
    if (activeController || (!internal && ui.run.disabled) || (!internal && !actionAllowed("run-report"))) return false;
    clearError(ui.runError); ui.resultPanel.hidden = true;
    const chosen = currentSelectedProjects();
    if (!chosen.length) { showError(ui.runError, "Выберите хотя бы один проект."); return false; }
    const allFilePeriod = Boolean(offlineWorkItems && ui.ignorePeriod.checked);
    if (!allFilePeriod && (!/^\d{4}-\d{2}-\d{2}$/.test(ui.from.value) || !/^\d{4}-\d{2}-\d{2}$/.test(ui.to.value) || ui.from.value > ui.to.value)) { showError(ui.runError, "Проверьте период отчёта."); return false; }
    resetAnalysis();
    const controller = new AbortController(); activeController = controller; ui.run.disabled = true; ui.stop.disabled = false; ui.loadProjects.disabled = true;
    document.querySelector("#refresh-report-data").disabled = true;
    try {
      let runProfile;
      if (profile?.id === "legacy-import") {
        const chosenKeys=new Set(chosen.flatMap(project=>[project.id,project.name,project.shortName]).filter(Boolean).map(value=>String(value).toLocaleLowerCase("ru")));
        runProfile = { ...profile, teams:(profile.teams||[]).filter(team=>chosenKeys.has(String(team.projectId).toLocaleLowerCase("ru"))||chosenKeys.has(String(team.projectName).toLocaleLowerCase("ru"))), projects:profile.projects.filter(project=>chosenKeys.has(String(project.id).toLocaleLowerCase("ru"))||chosenKeys.has(String(project.name).toLocaleLowerCase("ru"))), classification:rulesFromUi() };
      }
      else runProfile = { ...YouTrackWorkItems.automaticProfile(chosen), classification:rulesFromUi() };
      const cacheKey = JSON.stringify([connection?.baseUrl,authSession?.userLabel,chosen.map(project=>project.id).sort(),ui.from.value,ui.to.value,allFilePeriod,runProfile]);
      const cached = reportCache.get(cacheKey);
      if (cached && Date.now()-cached.at < CACHE_TTL_MS) {
        renderResult(cached.result,cached.period); ui.progress.textContent="Готово · из памяти, без запросов"; revealFinishedReport(); return true;
      }
      const accumulator = YouTrackWorkItems.createAccumulator(runProfile);
      let loaded = 0;
      if (offlineWorkItems) {
        accumulator.seedIssueFacts(offlineWorkItems);
        const selectedNames = new Set(chosen.map(project => String(project.name).toLocaleLowerCase("ru")));
        const fromAt = ui.ignorePeriod.checked ? null : new Date(`${ui.from.value}T00:00:00`).getTime();
        const toAt = ui.ignorePeriod.checked ? null : new Date(`${ui.to.value}T23:59:59.999`).getTime();
        const filtered = offlineWorkItems.filter(item => {
          if (!selectedNames.has(String(item?.issue?.project?.name || "").toLocaleLowerCase("ru"))) return false;
          const at = itemDate(item?.date);
          return at == null || ((fromAt == null || at >= fromAt) && (toAt == null || at <= toAt));
        });
        for (let offset = 0; offset < filtered.length; offset += PAGE_SIZE) {
          if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError");
          const page = filtered.slice(offset, offset + PAGE_SIZE);
          accumulator.addPage(page); loaded += page.length;
          ui.progress.textContent = `Файл · ${loaded}/${filtered.length} записей`;
          await new Promise(requestAnimationFrame);
        }
      } else {
        let pauseBeforeNextRequest = false;
        for (let projectIndex = 0; projectIndex < chosen.length; projectIndex += 1) {
          const project = chosen[projectIndex];
          for (let skip = 0; loaded < MAX_WORK_ITEMS;) {
            if(pauseBeforeNextRequest)await waitBetweenRequests(controller.signal);
            pauseBeforeNextRequest=false;
            ui.progress.textContent = `${projectIndex + 1}/${chosen.length} · ${project.name} · ${loaded} записей`;
            const url = YouTrackQuery.workItemsUrl(connection.baseUrl, { project:project.name, startDate:ui.from.value, endDate:ui.to.value, skip, top:FETCH_SIZE });
            const startedAt = performance.now();
            let page;
            try { page = await apiFetch(url, { signal:controller.signal }); recordTechnical("Work items", url, startedAt, `Успешно · ${Array.isArray(page) ? page.length : 0}`); }
            catch (error) { recordTechnical("Work items", url, startedAt, error?.name === "AbortError" ? "Остановлено" : "Ошибка"); throw error; }
            if (!Array.isArray(page)) throw new Error("YouTrack вернул некорректную страницу work items");
            if(page.length>FETCH_SIZE)throw new Error("YouTrack вернул страницу больше запрошенного лимита");
            const hasMore=page.length>PAGE_SIZE,pageForReport=hasMore?page.slice(0,PAGE_SIZE):page;
            if (loaded + pageForReport.length > MAX_WORK_ITEMS) throw new Error(`Достигнут безопасный лимит ${MAX_WORK_ITEMS} work items. Уменьшите период.`);
            accumulator.addPage(pageForReport); loaded += pageForReport.length;
            if (!hasMore) { pauseBeforeNextRequest=projectIndex<chosen.length-1; break; }
            skip += pageForReport.length;
            if (loaded >= MAX_WORK_ITEMS) throw new Error(`Достигнут безопасный лимит ${MAX_WORK_ITEMS} work items. Уменьшите период.`);
            pauseBeforeNextRequest=true;
          }
        }
      }
      const period = allFilePeriod ? "за весь период данных" : `${ui.from.value} — ${ui.to.value}`;
      const result = accumulator.finish(); result.sensorContext={from:allFilePeriod?null:ui.from.value,to:allFilePeriod?null:ui.to.value,source:offlineWorkItems?"Файл work_items.json":"YouTrack API",projects:chosen.map(p=>p.name)}; renderResult(result, period); ui.progress.textContent = `Готово · ${result.scanned} записей`; revealFinishedReport();
      reportCache.clear(); reportCache.set(cacheKey,{at:Date.now(),result,period});
      return true;
    } catch (error) { showError(ui.runError, safeMessage(error)); ui.progress.textContent = error?.name === "AbortError" ? "Остановлено" : "Не завершено"; return false; }
    finally { activeController = null; ui.run.disabled = false; ui.stop.disabled = true; ui.loadProjects.disabled = !authSession; document.querySelector("#refresh-report-data").disabled = false; updateFolderAccess(); }
  }

  function csvCell(value) {
    let text = String(value ?? ""); if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    if (!latestResult) return;
    const labels=metricLabels(), lines = [["Проект","Команда","Ёмкость","Закрыто БЗ",labels.business,labels.technical,labels.bug,labels.overtime,labels.meeting,"Утилизация","Общий факт","В оценке"]];
    for (const team of latestResult.teams) lines.push([team.projectName,team.name,team.capacityHours ?? "",team.stats.closedFeatures,team.stats.business,team.stats.technical,team.stats.bug,team.stats.overtime,team.stats.meeting,team.capacityHours>0?team.stats.business/team.capacityHours:"",team.stats.business+team.stats.technical+team.stats.bug+team.stats.overtime+team.stats.meeting,estimateText(team.stats)]);
    const blob = new Blob(["\uFEFF", lines.map((row) => row.map(csvCell).join(";")).join("\r\n")], { type:"text/csv;charset=utf-8" });
    downloadBlob(blob, `youtrack-report-${filePeriod()}.csv`);
  }

  function filePeriod() {
    return latestPeriod === "за весь период данных" ? "all-data" : `${ui.from.value || "from"}-${ui.to.value || "to"}`;
  }

  function downloadBlob(blob, filename) {
    const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function styleSheet(sheet, columnCount) {
    sheet.views=[{state:"frozen",xSplit:1,ySplit:2}];
    sheet.getRow(1).font={bold:true,size:14,color:{argb:"FFFFFFFF"}}; sheet.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF176B75"}};
    sheet.getRow(2).font={bold:true,color:{argb:"FFFFFFFF"}}; sheet.getRow(2).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF224454"}};
    sheet.autoFilter={from:{row:2,column:1},to:{row:2,column:columnCount}};
    sheet.columns.forEach(column=>{column.width=Math.min(42,Math.max(12,column.width||14));});
  }

  async function exportSummaryXlsx() {
    if(!latestResult||!globalThis.ExcelJS||ui.exportXlsx.disabled||!actionAllowed("export-xlsx"))return;
    ui.exportXlsx.disabled=true;
    try {
      const workbook=new ExcelJS.Workbook();workbook.creator="Advanced Tools";workbook.created=new Date();
      const sheet=workbook.addWorksheet("Сводка"),labels=metricLabels();
      sheet.addRow([`YouTrack · ${latestPeriod}`]);sheet.mergeCells(1,1,1,11);
      sheet.addRow(["Проект / команда","Ёмкость","Закрыто БЗ",labels.business,labels.technical,labels.bug,labels.overtime,labels.meeting,"Утилизация","Общий факт","В оценке"]);
      const grouped=new Map();for(const team of latestResult.teams){if(!grouped.has(team.projectName))grouped.set(team.projectName,[]);grouped.get(team.projectName).push(team);}
      for(const [project,teams]of grouped){const total=projectTotals(teams),s=total.stats;const projectRow=sheet.addRow([project,total.capacity||"",s.closedFeatures,s.business,s.technical,s.bug,s.overtime,s.meeting,total.capacity>0?s.business/total.capacity:"",s.business+s.technical+s.bug+s.overtime+s.meeting,estimateText(s)]);projectRow.font={bold:true};projectRow.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFE3F4F3"}};
        for(const team of teams){const t=team.stats,row=sheet.addRow([`  ${team.name}`,team.capacityHours??"",t.closedFeatures,t.business,t.technical,t.bug,t.overtime,t.meeting,team.capacityHours>0?t.business/team.capacityHours:"",t.business+t.technical+t.bug+t.overtime+t.meeting,estimateText(t)]);row.outlineLevel=1;}
      }
      sheet.getColumn(1).width=34;for(const column of [2,4,5,6,7,8,10])sheet.getColumn(column).numFmt="0.0";sheet.getColumn(9).numFmt="0%";styleSheet(sheet,11);
      const buffer=await workbook.xlsx.writeBuffer();downloadBlob(new Blob([buffer],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),`youtrack-report-${filePeriod()}.xlsx`);
    } catch(error){showError(ui.runError,`Не удалось создать Excel. ${safeMessage(error)}`);} finally{ui.exportXlsx.disabled=false;}
  }

  async function exportBreakdownXlsx() {
    if(!latestBreakdown||!globalThis.ExcelJS||ui.exportBreakdown.disabled||!actionAllowed("export-breakdown"))return;
    ui.exportBreakdown.disabled=true;
    try{const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet("Детализация");sheet.addRow([latestBreakdown.title]);sheet.mergeCells(1,1,1,latestBreakdown.headers.length);sheet.addRow(latestBreakdown.headers);for(const row of latestBreakdown.rows)sheet.addRow(row);styleSheet(sheet,latestBreakdown.headers.length);sheet.columns.forEach(column=>column.width=22);const buffer=await workbook.xlsx.writeBuffer();downloadBlob(new Blob([buffer],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),`youtrack-details-${filePeriod()}.xlsx`);}catch(error){showError(ui.runError,`Не удалось создать Excel. ${safeMessage(error)}`);}finally{ui.exportBreakdown.disabled=false;}
  }

  async function syncReferenceSession() {
    // Сессия только читается: получать токен могут лишь переход со страницы
    // YouTrack и кнопка «Обновить подключение» на вкладке «Отчёт».
    const {ytToken}=await chrome.storage.local.get('ytToken');
    const connected=(await chrome.runtime.sendMessage({type:'get-youtrack-session-status'}))?.connected;
    if(authSession?.accessToken===ytToken)return;
    activeController?.abort();reportCache.clear();projectsCache=null;
    authSession=connected&&ytToken?{kind:'reference',accessToken:ytToken,userLabel:'Сессия основного отчёта'}:null;
    onlineAuthSession=authSession;connectedProjects=[];
    connection={baseUrl:'https://youtrack-mapps.sovcombank.ru',hubUrl:'https://youtrack-mapps.sovcombank.ru/hub'};
    updateConnectionUi();
    document.dispatchEvent(new CustomEvent('youtrack-connection-changed'));
    if(authSession)await loadProjects(true);
  }

  async function initialize() {
    await YouTrackFeature.ready;
    $('#report-view').dataset.youtrackEnabled='true';
    $('#youtrack-connection-controls').disabled=false;
    setDefaultDates();
    const stored=await localGet([PROFILE_KEY]);profile=stored[PROFILE_KEY]||null;
    fillRules(profile?.classification||YouTrackWorkItems.DEFAULT_CLASSIFICATION);
    await syncReferenceSession();
    await restoreFolders();
    chooseReportPath('fields');
  }

  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area==='local'&&changes.ytToken||area==='session'&&(changes.youtrackExplicitConnection||changes.youtrackLiveToken))syncReferenceSession().catch(error=>showError(ui.connectionError,safeMessage(error)));
  });
  $("#choose-plus-folder").addEventListener("click",()=>folderAction(async()=>{
    const access=YouTrackFolders.configured&&$("#choose-plus-folder").textContent==="Разрешить доступ"?YouTrackFolders.reconnect():YouTrackFolders.choose();
    await access;$("#choose-plus-folder").textContent="Сменить папку";
    const names=await folderList();await switchFolder(names.includes(YouTrackFolders.selected)?YouTrackFolders.selected:names[0]||"");
  }));
  $("#refresh-plus-projects").addEventListener("click",()=>folderAction(async()=>{const names=await folderList();if(!names.includes(YouTrackFolders.selected))await switchFolder("");}));
  $("#check-folder-access").addEventListener("click",()=>loadProjects(false));
  $("#plus-project").addEventListener("change",()=>folderAction(()=>switchFolder($("#plus-project").value)));
  $("#new-plus-project").addEventListener("click",()=>{$("#new-plus-form").hidden=false;$("#new-plus-name").focus();});
  $("#cancel-plus-project").addEventListener("click",()=>{$("#new-plus-form").hidden=true;});
  $("#create-plus-project").addEventListener("click",()=>folderAction(async()=>{const name=await YouTrackFolders.create($("#new-plus-name").value);await folderList();await switchFolder(name);$("#new-plus-form").hidden=true;$("#new-plus-name").value="";ui.jsonNote.textContent="Папка создана. Выберите teams.json или настройте команды в конструкторе, затем сохраните настройки в проект.";}));
  $("#save-plus-settings").addEventListener("click",()=>folderAction(async()=>{
    const {teams,config}=YouTrackFolders.profileFiles(profile);
    await YouTrackFolders.saveSettings(teams,config);
    fileSources.teams=`Сохранён YouTrackPlus/${YouTrackFolders.selected}/teams.json`;fileSources.config=`Сохранён YouTrackPlus/${YouTrackFolders.selected}/config.json`;renderFileSources();
    $("#folder-projects-note").textContent=`Команды и правила сохранены в «${YouTrackFolders.selected}».`;
  }));
  $("#recheck-json").addEventListener("click",()=>recheckFolder(false));
  $("#edit-teams").addEventListener("click",()=>ui.tabBuilder.click());
  $("#edit-config").addEventListener("click",()=>ui.tabBuilder.click());
  ui.disconnect.addEventListener("click", clearSession);
  ui.loadProjects.addEventListener("click", () => loadProjects(false));
  ui.selectAll.addEventListener("click", () => { selectedProjectIds = new Set(projects.map((item) => item.id)); renderProjects(); });
  ui.clearProjects.addEventListener("click", () => { selectedProjectIds.clear(); renderProjects(); });
  ui.importTeams.addEventListener("click", () => ui.teamsFile.click()); ui.teamsFile.addEventListener("change", () => importLegacyTeams(ui.teamsFile.files?.[0]));
  ui.importWorkItems.addEventListener("click", () => ui.workItemsFile.click()); ui.workItemsFile.addEventListener("change", () => importLegacyWorkItems(ui.workItemsFile.files?.[0]));
  ui.importConfig.addEventListener("click", () => ui.configFile.click()); ui.configFile.addEventListener("change", () => importLegacyConfig(ui.configFile.files?.[0]));
  ui.forgetProfile.addEventListener("click", async () => { profile=null; pendingLegacyConfig=null; await chrome.storage.local.remove(PROFILE_KEY); selectedProjectIds.clear(); renderProjects(); fillRules(YouTrackWorkItems.DEFAULT_CLASSIFICATION); ui.profileKind.textContent="Автоматический"; ui.profileNote.textContent="Локальный профиль удалён.";fileSources.teams="";fileSources.config="";renderFileSources(); });
  ui.saveRules.addEventListener("click", () => saveRules().catch((error) => showError(ui.profileError, safeMessage(error))));
  ui.run.addEventListener("click", () => runReport(false)); ui.stop.addEventListener("click", () => { activeController?.abort(); }); ui.exportCsv.addEventListener("click", exportCsv);
  document.querySelector("#refresh-report-data").addEventListener("click",()=>{if(activeController || connecting || !actionAllowed("refresh-report"))return;reportCache.clear();runReport(true);});
  ui.exportXlsx.addEventListener("click", exportSummaryXlsx); ui.exportBreakdown.addEventListener("click", exportBreakdownXlsx);
  document.querySelector(".chart-switch")?.addEventListener("click",event=>{const button=event.target.closest("[data-chart-kind]");if(!button||!latestResult)return;activeChartKind=button.dataset.chartKind;renderAnalytics();});
  ui.chartTeam.addEventListener("change",()=>renderAnalytics());ui.downloadChart.addEventListener("click",downloadCurrentChart);
  ui.modalClose.addEventListener("click", closeBreakdown); ui.modal.addEventListener("click",event=>{if(event.target===ui.modal)closeBreakdown();});
  ui.tabReport.addEventListener("click",()=>selectView("report"));ui.tabBuilder.addEventListener("click",()=>selectView("builder"));ui.tabLog.addEventListener("click",()=>{selectView("log");refreshNetworkTechnicalLog();});ui.clearTechnicalLog.addEventListener("click",async()=>{technicalLog.length=0;networkTechnicalLog.length=0;let origin=sourceOrigin;try{if(!origin)origin=new URL(connection?.baseUrl||"").origin;}catch{}if(origin)await chrome.runtime.sendMessage({type:"clear-youtrack-network-audit",origin}).catch(()=>{});renderTechnicalLog();});
  document.addEventListener("youtrack-profile-builder-apply",async event=>{
    try{
      const teamsData=event.detail?.teams,configData=event.detail?.config,migrated=YouTrackWorkItems.migrateLegacy(teamsData,configData);
      pendingLegacyConfig=configData;await saveProfile({...migrated,builderSource:{teams:teamsData,config:configData}});fillRules(migrated.classification);
      if(!projects.length)projects=migrated.projects.map(project=>({id:project.id,name:project.name,shortName:"",archived:false}));
      selectedProjectIds=new Set(projects.filter(projectMatchesProfile).map(item=>item.id));renderProjects();
      ui.profilePanel.hidden=false;ui.profileKind.textContent="Конструктор";ui.profileNote.textContent=`Профиль из конструктора применён · ${migrated.teams.length} команд.`;
      if(offlineWorkItems)await activateOfflineData(offlineWorkItems,migrated,"конструктор JSON");
      document.dispatchEvent(new CustomEvent("youtrack-profile-builder-applied"));
      fileSources.teams="Работаем с изменениями из конструктора";fileSources.config="Правила из конструктора";renderFileSources();
      selectView("report");setTimeout(()=>ui.profilePanel.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"center"}),30);
    }catch(error){const message=safeMessage(error);showError(ui.profileError,message);document.dispatchEvent(new CustomEvent("youtrack-profile-builder-rejected",{detail:{message}}));selectView("report");}
  });
  $("#tab-analysis").addEventListener("click",()=>selectView(sensorView));
  $("#sensor-analysis-source").addEventListener("change",e=>selectView(e.target.value));
  $('#report-mode-legacy').addEventListener('click',()=>chooseReportPath('legacy'));
  $('#report-mode-fields').addEventListener('click',()=>chooseReportPath('fields'));
  $("#analysis-back").addEventListener("click",()=>{selectView("report");if(!ui.resultPanel.hidden)focusReportSection(ui.resultPanel);else ui.tabReport.focus();});
  document.querySelector(".result-jump-nav")?.addEventListener("click",event=>{const button=event.target.closest("[data-report-jump]");if(!button||button.disabled)return;focusReportSection(document.getElementById(button.dataset.reportJump),true);});
  ui.ignorePeriod.addEventListener("change",()=>{const disabled=ui.ignorePeriod.checked;ui.from.disabled=disabled;ui.to.disabled=disabled;});
  let chartResizeFrame=0;window.addEventListener("resize",()=>{if(!latestResult||ui.chartPanel.hidden)return;cancelAnimationFrame(chartResizeFrame);chartResizeFrame=requestAnimationFrame(()=>renderAnalytics());},{passive:true});
  window.addEventListener("pagehide",()=>{activeController?.abort();},{once:true});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!ui.modal.hidden)closeBreakdown();});
  if(globalThis.YouTrackAdvancedView){
    const identities=new WeakMap();let identity=0;
    YouTrackAdvancedView.mount({
      context:()=>{
        if(authSession&&!identities.has(authSession))identities.set(authSession,++identity);
        return {connected:Boolean(YouTrackFeature.enabled&&authSession?.accessToken&&(!authSession.expiresAt||authSession.expiresAt>Date.now())),
          baseUrl:connection?.baseUrl||'',sessionKey:authSession?identities.get(authSession):0,
          projects:connectedProjects.slice(),profile,actualFieldName:(pendingLegacyConfig||profile?.builderSource?.config)?.actualField?.fieldName||profile?.actualFieldName||'Факт разработка'};
      },
      busy:()=>Boolean(activeController||connecting||folderBusy||checkingFiles),
      acquire:controller=>{if(!YouTrackFeature.enabled||activeController||connecting||folderBusy||checkingFiles)return false;activeController=controller;ui.run.disabled=true;ui.loadProjects.disabled=true;return true;},
      release:controller=>{if(activeController===controller)activeController=null;ui.run.disabled=false;ui.loadProjects.disabled=!authSession;updateFolderAccess();},
      safeMessage,
      showResult:()=>selectView('advanced'),
      showSetup:()=>{chooseReportPath('fields');if(reportPath==='fields')selectView('report');},
      ready:()=>{sensorView='advanced';if(document.querySelector('#report-view').dataset.view!=='advanced'){$('#analysis-ready').hidden=false;$('#tab-analysis').classList.add('has-analysis');}},
      fetchPage:async(url,signal)=>{
        const started=performance.now(),request=new AbortController();
        const stop=()=>request.abort();signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
        const timeout=setTimeout(stop,45000);
        const path=new URL(url).pathname.endsWith('/workItems')?'/api/workItems':'/api/issues';
        const record=outcome=>{
          const u=new URL(url);technicalLog.unshift({createdAt:Date.now(),time:new Date().toLocaleTimeString('ru-RU'),action:'Продвинутый отчёт',query:'GET '+path,page:`top ${u.searchParams.get('$top')}, skip ${u.searchParams.get('$skip')}`,result:`${outcome} · ${Math.round(performance.now()-started)} мс`});
          if(technicalLog.length>200)technicalLog.length=200;renderTechnicalLog();
        };
        try{const data=await apiFetch(url,{signal:request.signal});const fieldCount=path==='/api/issues'&&Array.isArray(data)?new Set(data.flatMap(i=>(i.customFields||[]).map(f=>f.name||f.projectCustomField?.field?.name).filter(Boolean))).size:null;record(`Успешно · ${Array.isArray(data)?data.length:0}${fieldCount==null?'':' · customFields: '+fieldCount}`);return data;}
        catch(e){record(e.name==='AbortError'?'Остановлено / таймаут':'Ошибка');throw e;}
        finally{clearTimeout(timeout);signal.removeEventListener('abort',stop);}
      }
    });
  }
  initialize().catch((error) => showError(ui.connectionError, safeMessage(error)));
})();
