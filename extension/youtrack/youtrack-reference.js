

// ===== dashboard_main.js =====

let workItemsData = null;
let teamsData = null;
const capacityStore = {};
let lastComputed = null;
const expandedTeams = new Set();
let lastBreakdownExport = null;

function toNormalizedArray(v) {
  const arr = Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]);
  return arr.filter(Boolean).map(normalizeStr);
}

let WORK_TYPE_DEV, WORK_TYPE_MEETING, WORK_TYPE_OVERS;
let ISSUE_TYPE_FIELD_NAME, ISSUE_TYPE_FEATURE, ISSUE_TYPE_TECH, ISSUE_TYPE_BUG, ISSUE_TYPE_WORKS;
let STATUS_FIELD_NAME, DONE_STATUSES, ESTIMATE_FIELD_NAME, ACTUAL_FIELD_NAME, METRIC_LABELS;
let STATUS_FIELD_FROM_USER_CONFIG = false;

const DEFAULT_FIELD_CONFIG = {
  workItemTypeField: {
    dev: ['Разработка'],
    meeting: ['Встречи/Проектные коммуникации'],
    overs: ['Оверы. Разработка']
  },
  issueTypeField: {
    fieldName: 'Type',
    values: {
      feature: ['Фича'],
      tech: ['Техническая', 'Техдолг'],
      bug: ['Bug'],
      works: ['Работы']
    }
  },
  statusField: { fieldName: 'Статус', doneStatuses: ['READY FOR RELEASE', 'CLOSED', 'DONE'] },
  estimateField: { fieldName: 'Оценка разработка' },
  actualField: { fieldName: 'Факт разработки' },
  columnLabels: { biz: 'Бизнес', tech: 'Техн-кие', bug: 'Баги', overs: 'Оверы', meeting: 'Встречи/Иное' }
};

let fieldConfig = DEFAULT_FIELD_CONFIG;

function applyFieldConfig(userCfg) {
  const c = userCfg && typeof userCfg === 'object' ? userCfg : {};
  fieldConfig = {
    workItemTypeField: { ...DEFAULT_FIELD_CONFIG.workItemTypeField, ...(c.workItemTypeField || {}) },
    issueTypeField: {
      fieldName: (c.issueTypeField && c.issueTypeField.fieldName) || DEFAULT_FIELD_CONFIG.issueTypeField.fieldName,
      values: { ...DEFAULT_FIELD_CONFIG.issueTypeField.values, ...((c.issueTypeField && c.issueTypeField.values) || {}) }
    },
    statusField: { ...DEFAULT_FIELD_CONFIG.statusField, ...(c.statusField || {}) },
    estimateField: { ...DEFAULT_FIELD_CONFIG.estimateField, ...(c.estimateField || {}) },
    actualField: { ...DEFAULT_FIELD_CONFIG.actualField, ...(c.actualField || {}) },
    columnLabels: { ...DEFAULT_FIELD_CONFIG.columnLabels, ...(c.columnLabels || {}) }
  };

  STATUS_FIELD_FROM_USER_CONFIG = !!(c.statusField && typeof c.statusField === 'object');

  WORK_TYPE_DEV = toNormalizedArray(fieldConfig.workItemTypeField.dev);
  WORK_TYPE_MEETING = toNormalizedArray(fieldConfig.workItemTypeField.meeting);
  WORK_TYPE_OVERS = toNormalizedArray(fieldConfig.workItemTypeField.overs);

  ISSUE_TYPE_FIELD_NAME = fieldConfig.issueTypeField.fieldName;
  ISSUE_TYPE_FEATURE = toNormalizedArray(fieldConfig.issueTypeField.values.feature);
  ISSUE_TYPE_TECH = toNormalizedArray(fieldConfig.issueTypeField.values.tech);
  ISSUE_TYPE_BUG = toNormalizedArray(fieldConfig.issueTypeField.values.bug);
  ISSUE_TYPE_WORKS = toNormalizedArray(fieldConfig.issueTypeField.values.works);

  STATUS_FIELD_NAME = fieldConfig.statusField.fieldName;
  DONE_STATUSES = (fieldConfig.statusField.doneStatuses || []).map(normalizeStr);

  ESTIMATE_FIELD_NAME = fieldConfig.estimateField.fieldName;
  ACTUAL_FIELD_NAME = fieldConfig.actualField.fieldName;

  METRIC_LABELS = { ...fieldConfig.columnLabels };
}

applyFieldConfig(null);

function getRawFieldValue(issue, fieldName) {
  if (!issue || !issue.customFields) return null;
  const target = normalizeStr(fieldName);
  const f = issue.customFields.find(cf => normalizeStr(cf.name || '') === target);
  if (!f) return null;
  return f.value;
}

function estimateFieldToHours(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value / 60;
  if (typeof value === 'object') {
    if (typeof value.minutes === 'number') return value.minutes / 60;
    if (typeof value.presentation === 'string') {
      const w = value.presentation.match(/(\d+)\s*w/i);
      const d = value.presentation.match(/(\d+)\s*d/i);
      const h = value.presentation.match(/(\d+)\s*h/i);
      const mi = value.presentation.match(/(\d+)\s*m/i);
      let total = 0;
      let found = false;
      if (w) { total += parseInt(w[1], 10) * 5 * 8; found = true; }
      if (d) { total += parseInt(d[1], 10) * 8; found = true; }
      if (h) { total += parseInt(h[1], 10); found = true; }
      if (mi) { total += parseInt(mi[1], 10) / 60; found = true; }
      if (found) return total;
    }
    return null;
  }
  if (typeof value === 'string') {
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num / 60;
  }
  return null;
}

function normalizeStr(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '').trim();
}

function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function setDefaultPeriod() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  document.getElementById('dateFrom').value = formatLocalDate(first);
  document.getElementById('dateTo').value = formatLocalDate(last);
}
setDefaultPeriod();

function showError(msg) { document.getElementById('errorBox').textContent = msg; }
function showDebug(msg) { /* отладочная информация скрыта из UI */ console.debug(msg); }
function clearMessages() { document.getElementById('errorBox').textContent=''; }

document.getElementById('fileInputData').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      workItemsData = JSON.parse(evt.target.result);
      document.getElementById('statusData').textContent = 'Загружено: ' + file.name;
    } catch (err) { showError('Ошибка разбора work items JSON: ' + err.message); }
  };
  reader.readAsText(file);
});

document.getElementById('fileInputTeams').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      teamsData = JSON.parse(evt.target.result);
      const parsed = parseTeamsStructure(teamsData);
      const teamCount = parsed.flatTeams.length;
      const projectCount = parsed.projects.length;
      document.getElementById('statusTeams').textContent = `Загружено: ${file.name} (${projectCount} проект(ов), ${teamCount} команд)`;
      parsed.flatTeams.forEach(t => {
        capacityStore[t.name] = (t.initialCapacity !== undefined) ? t.initialCapacity : (capacityStore[t.name] || 0);
      });
    } catch (err) { showError('Ошибка разбора файла команд: ' + err.message); }
  };
  reader.readAsText(file);
});

document.getElementById('fileInputConfig').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const parsedConfig = JSON.parse(evt.target.result);
      applyFieldConfig(parsedConfig);
      document.getElementById('statusConfig').textContent = `Загружено: ${file.name}`;
      if (lastComputed) { recalculate(); }
    } catch (err) { showError('Ошибка разбора config.json: ' + err.message); }
  };
  reader.readAsText(file);
});

function parseClosedCondition(conditionStr) {
  // Пример: "Статус: {READY FOR RELEASE}, {DONE}, {CLOSED}"
  if (!conditionStr || typeof conditionStr !== 'string') return null;
  const colonIdx = conditionStr.indexOf(':');
  if (colonIdx === -1) return null;
  const fieldName = conditionStr.slice(0, colonIdx).trim();
  const valuesPart = conditionStr.slice(colonIdx + 1);
  const matches = [...valuesPart.matchAll(/\{([^}]+)\}/g)].map(m => normalizeStr(m[1]));
  if (!fieldName || matches.length === 0) return null;
  return { fieldName, values: matches };
}

function parseTeamsStructure(data) {
  // Формат 3 (новый): массив проектов [{ projectName, closed_tasks_condition, teams: [{name, capacity_in_hours, lead, members}] }]
  if (Array.isArray(data)) {
    const projects = [];
    const flatTeams = [];
    const projectClosedCondition = {};
    data.forEach(proj => {
      const projectName = proj.projectName || 'Без проекта';
      projects.push(projectName);
      projectClosedCondition[projectName] = parseClosedCondition(proj.closed_tasks_condition);
      (proj.teams || []).forEach(t => {
        const capacity = t.capacity_in_hours !== undefined ? parseFloat(t.capacity_in_hours) || 0 : undefined;
        flatTeams.push({ ...t, project: projectName, initialCapacity: capacity });
      });
    });
    return { projects, flatTeams, projectClosedCondition };
  }
  // Старый формат: { "teams": [ { name, lead, members } ] }
  if (Array.isArray(data.teams)) {
    const teams = data.teams.map(t => ({ ...t, project: 'Без проекта' }));
    return { projects: ['Без проекта'], flatTeams: teams, projectClosedCondition: { 'Без проекта': null } };
  }
  // Формат 2: { "Имя проекта": [ { name, lead, members } ], "Другой проект": [...] }
  const projects = [];
  const flatTeams = [];
  const projectClosedCondition = {};
  Object.keys(data).forEach(projectName => {
    if (!Array.isArray(data[projectName])) return;
    projects.push(projectName);
    projectClosedCondition[projectName] = null;
    data[projectName].forEach(t => { flatTeams.push({ ...t, project: projectName }); });
  });
  return { projects, flatTeams, projectClosedCondition };
}

function getCustomFieldValue(issue, fieldName) {
  if (!issue || !issue.customFields) return null;
  const target = normalizeStr(fieldName);
  const f = issue.customFields.find(cf => normalizeStr(cf.name || '') === target);
  if (!f || !f.value) return null;
  if (Array.isArray(f.value)) return f.value.map(v => v.name || v.login || v).join(', ');
  return f.value.name || f.value.login || f.value;
}

function projectAliases(project) {
  if (!project) return [];
  return [project.name, project.shortName, project.id, project.idReadable]
    .filter(Boolean).map(normalizeStr);
}

function buildLoginToTeamMap(flatTeams) {
  const map = {};
  flatTeams.forEach(team => {
    const aliases = projectAliases({ name: team.project });
    [...(team.members || []), team.lead].filter(Boolean).forEach(login => {
      const loginKey = normalizeStr(login);
      if (!map[loginKey]) map[loginKey] = {};
      aliases.forEach(projectKey => { map[loginKey][projectKey] = team.name; });
    });
  });
  return map;
}

function getIssueProjectKeys(issue) {
  const project = issue && issue.project;
  return projectAliases(project);
}

function resolveTeamForItem(login, issue, loginToTeam) {
  const teamsByProject = loginToTeam[login];
  if (!teamsByProject) return null;
  const projectKeys = getIssueProjectKeys(issue);
  for (const projectKey of projectKeys) {
    if (teamsByProject[projectKey]) return teamsByProject[projectKey];
  }
  const candidates = [...new Set(Object.values(teamsByProject))];
  return candidates.length === 1 ? candidates[0] : null;
}

function parseItemDate(rawDate) {
  if (rawDate === undefined || rawDate === null) return null;
  if (typeof rawDate === 'number') return new Date(rawDate);
  if (typeof rawDate === 'string') {
    const asNum = Number(rawDate);
    if (!isNaN(asNum) && rawDate.trim() !== '') return new Date(asNum);
    const parsed = new Date(rawDate);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function emptyStats() {
  return { biz: 0, tech: 0, bug: 0, meeting: 0, overs: 0, featureIssueIds: new Set(), bizItems: [], techItems: [], bugItems: [], meetingItems: [], oversItems: [], closedFeatureItems: [], estimateHits: 0, estimateTotal: 0, estimateRatioSum: 0, estimateItems: [] };
}

function computeEstimateStats(target, issueEstimateHours, issueActualHoursByAuthor) {
  target.closedFeatureItems.forEach(entry => {
    const estimate = issueEstimateHours[entry.issueId];
    if (estimate === null || estimate === undefined || estimate <= 0) return;
    const authorsList = entry.authors ? Array.from(entry.authors) : [entry.author].filter(Boolean);
    const perIssueHours = issueActualHoursByAuthor[entry.issueId] || {};
    const actual = authorsList.reduce((sum, a) => sum + (perIssueHours[a] || 0), 0);
    const ratioPct = (actual / estimate) * 100;
    target.estimateTotal += 1;
    target.estimateRatioSum += ratioPct;
    if (actual <= estimate) target.estimateHits += 1;
    target.estimateItems.push({
      idReadable: entry.idReadable,
      author: authorsList.join(', '),
      estimate: estimate,
      actual: actual,
      ratioPct: ratioPct
    });
  });
}

function estimateDisplay(stats) {
  if (!stats) return '—';
  const totalClosed = stats.featureIssueIds ? stats.featureIssueIds.size : 0;
  if (!stats.estimateTotal) return totalClosed > 0 ? `— (0 из ${totalClosed})` : '—';
  const avgPct = Math.round(stats.estimateRatioSum / stats.estimateTotal);
  const overCount = stats.estimateTotal - stats.estimateHits;
  return `${avgPct}% (${stats.estimateTotal} из ${totalClosed}, превысили: ${overCount})`;
}

function processFiles() {
  clearMessages();
  if (!workItemsData) { showError('Сначала выберите файл work items.'); return; }
  if (!teamsData) { showError('Сначала выберите файл со структурой команд.'); return; }
  const items = Array.isArray(workItemsData) ? workItemsData : (workItemsData.workItems || workItemsData.items || []);
  if (!Array.isArray(items) || items.length === 0) { showError('В файле work items не найден массив данных.'); return; }
  recalculate();
}

function recalculate() {
  clearMessages();
  try {
    if (!workItemsData || !teamsData) { showError('Сначала загрузите оба файла.'); return; }
    const items = Array.isArray(workItemsData) ? workItemsData : (workItemsData.workItems || workItemsData.items || []);
    if (!Array.isArray(items) || items.length === 0) { showError('В файле work items не найден массив данных.'); return; }

    const parsedTeams = parseTeamsStructure(teamsData);
    const flatTeams = parsedTeams.flatTeams;
    const projectNames = parsedTeams.projects;
    const projectClosedCondition = parsedTeams.projectClosedCondition || {};
    const loginToTeam = buildLoginToTeamMap(flatTeams);
    const teamToProject = {};
    flatTeams.forEach(t => { teamToProject[t.name] = t.project; });

    const typeFieldName = ISSUE_TYPE_FIELD_NAME;
    const ignorePeriod = document.getElementById('ignorePeriod').checked;
    const fromStr = document.getElementById('dateFrom').value;
    const toStr = document.getElementById('dateTo').value;
    const fromDate = (!ignorePeriod && fromStr) ? new Date(fromStr + 'T00:00:00') : null;
    const toDate = (!ignorePeriod && toStr) ? new Date(toStr + 'T23:59:59') : null;

    const definedTeamNames = flatTeams.map(t => t.name);
    const teamStats = {};
    const teamMembersStats = {};
    definedTeamNames.forEach(name => { teamStats[name] = emptyStats(); teamMembersStats[name] = {}; });

    const unmatchedLogins = {};
    let matchedCount = 0, skippedByDate = 0;

    const issueEstimateHours = {};
    const issueActualHoursByAuthor = {};
    items.forEach(item => {
      const issue = item.issue || {};
      if (!issue.id) return;
      const workTypeName = normalizeStr((item.type && item.type.name) || '');
      if (WORK_TYPE_DEV.includes(workTypeName)) {
        const minutes = (item.duration && item.duration.minutes) || 0;
        const loginRaw = (item.author && item.author.login) || 'unknown';
        if (!issueActualHoursByAuthor[issue.id]) issueActualHoursByAuthor[issue.id] = {};
        issueActualHoursByAuthor[issue.id][loginRaw] = (issueActualHoursByAuthor[issue.id][loginRaw] || 0) + minutes / 60;
      }
      if (issueEstimateHours[issue.id] === undefined) {
        const rawEstimate = getRawFieldValue(issue, ESTIMATE_FIELD_NAME);
        const estHours = estimateFieldToHours(rawEstimate);
        issueEstimateHours[issue.id] = estHours;
      }
    });

    items.forEach(item => {
      const itemDate = parseItemDate(item.date);
      if (fromDate && itemDate && itemDate < fromDate) { skippedByDate++; return; }
      if (toDate && itemDate && itemDate > toDate) { skippedByDate++; return; }

      const minutes = (item.duration && item.duration.minutes) || 0;
      const hours = minutes / 60;
      const loginRaw = (item.author && item.author.login) || 'unknown';
      const login = normalizeStr(loginRaw);
      const issue = item.issue || {};
      let teamName = resolveTeamForItem(login, issue, loginToTeam);
      if (!teamName) {
        teamName = 'Без команды';
        unmatchedLogins[loginRaw] = (unmatchedLogins[loginRaw] || 0) + hours;
      }
      if (!teamStats[teamName]) { teamStats[teamName] = emptyStats(); teamMembersStats[teamName] = {}; }
      if (!teamMembersStats[teamName][loginRaw]) teamMembersStats[teamName][loginRaw] = emptyStats();

      const workTypeName = normalizeStr((item.type && item.type.name) || '');
      const issueTypeName = normalizeStr(getCustomFieldValue(issue, typeFieldName) || '');

      const makeItemEntry = () => ({
        idReadable: issue.idReadable || issue.id || '—',
        author: loginRaw,
        date: itemDate ? itemDate.toISOString().slice(0,10) : '—',
        hours: hours
      });

      const addTo = (target) => {
        if (WORK_TYPE_OVERS.includes(workTypeName)) {
          target.overs += hours;
          target.oversItems.push(makeItemEntry());
        } else if (WORK_TYPE_MEETING.includes(workTypeName)) {
          if (ISSUE_TYPE_WORKS.includes(issueTypeName)) {
            target.meeting += hours;
            target.meetingItems.push(makeItemEntry());
          }
        } else if (WORK_TYPE_DEV.includes(workTypeName)) {
          if (ISSUE_TYPE_FEATURE.includes(issueTypeName)) {
            target.biz += hours;
            target.bizItems.push(makeItemEntry());
            const proj = teamToProject[teamName] || 'Без проекта';
            const closedCond = STATUS_FIELD_FROM_USER_CONFIG ? null : projectClosedCondition[proj];
            const fieldToCheck = closedCond ? closedCond.fieldName : STATUS_FIELD_NAME;
            const allowedValues = closedCond ? closedCond.values : DONE_STATUSES;
            const rawStatusValue = getCustomFieldValue(issue, fieldToCheck) || '—';
            const statusValue = normalizeStr(rawStatusValue);
            if (issue.id && allowedValues.includes(statusValue)) {
              if (!target.featureIssueIds.has(issue.id)) {
                target.closedFeatureItems.push({
                  idReadable: issue.idReadable || issue.id || '—',
                  status: rawStatusValue,
                  authors: new Set([loginRaw]),
                  issueId: issue.id
                });
              } else {
                const existingEntry = target.closedFeatureItems.find(e => e.issueId === issue.id);
                if (existingEntry) existingEntry.authors.add(loginRaw);
              }
              target.featureIssueIds.add(issue.id);
            }
          } else if (ISSUE_TYPE_TECH.includes(issueTypeName)) {
            target.tech += hours;
            target.techItems.push(makeItemEntry());
          } else if (ISSUE_TYPE_BUG.includes(issueTypeName)) {
            target.bug += hours;
            target.bugItems.push(makeItemEntry());
          }
        }
      };

      addTo(teamStats[teamName]);
      addTo(teamMembersStats[teamName][loginRaw]);
      matchedCount++;
    });

    Object.keys(teamStats).forEach(teamName => {
      computeEstimateStats(teamStats[teamName], issueEstimateHours, issueActualHoursByAuthor);
      Object.keys(teamMembersStats[teamName] || {}).forEach(loginRaw => {
        computeEstimateStats(teamMembersStats[teamName][loginRaw], issueEstimateHours, issueActualHoursByAuthor);
      });
    });

    if (matchedCount === 0) {
      showDebug(`Диагностика: всего work items = ${items.length}, отфильтровано по периоду = ${skippedByDate}. Проверьте период или включите "Не учитывать период".`);
      showError('После применения фильтров не осталось ни одной записи.');
      document.getElementById('tablePanel').style.display = 'none';
      return;
    }

    const teams = [...definedTeamNames];

    try {
      const devItems = items.filter(i => WORK_TYPE_DEV.includes(normalizeStr((i.type && i.type.name) || '')));
      const devIssueTypesRaw = devItems.map(i => getCustomFieldValue(i.issue || {}, typeFieldName));
      const devIssueTypeCounts = {};
      devIssueTypesRaw.forEach(v => {
        const key = v === null || v === undefined ? 'null/пусто' : v;
        devIssueTypeCounts[key] = (devIssueTypeCounts[key] || 0) + 1;
      });
      const bugLikeExamples = devItems.filter(i => {
        const v = normalizeStr(getCustomFieldValue(i.issue || {}, typeFieldName) || '');
        return v.includes('баг') || v.includes('bug');
      }).slice(0, 3);

      showDebug(
        'ДИАГНОСТИКА типов задач при списании "Разработка":\n' +
        'Всего записей с типом списания "Разработка": ' + devItems.length + '\n' +
        'Распределение значений поля "' + typeFieldName + '" (тип задачи) среди этих записей:\n' +
        JSON.stringify(devIssueTypeCounts, null, 2) + '\n\n' +
        'Ожидаемое значение для багов (константа в коде): "' + ISSUE_TYPE_BUG.join('", "') + '"\n' +
        'Найдено записей, где значение поля содержит "баг"/"bug": ' + bugLikeExamples.length + '\n' +
        (bugLikeExamples.length ? 'Пример: ' + JSON.stringify(bugLikeExamples[0].issue.customFields.find(cf => normalizeStr(cf.name)===normalizeStr(typeFieldName)), null, 2) : '')
      );
    } catch(e) { showDebug('Ошибка диагностики: ' + e.message); }
    const periodLabel = ignorePeriod
      ? 'за весь период данных'
      : `за период ${fromStr ? fromStr.split('-').reverse().join('.') : '…'} — ${toStr ? toStr.split('-').reverse().join('.') : '…'}`;
    lastComputed = { teams, teamStats, teamMembersStats, projectNames, teamToProject, projectClosedCondition, periodLabel, issueActualHoursByAuthor };
    renderTable();
    document.getElementById('tablePanel').style.display = 'block';

  } catch (err) {
    showError('Внутренняя ошибка: ' + err.message);
    showDebug(err.stack || String(err));
  }
}

function utilClass(util) {
  if (util > 100) return 'util-over';
  if (util >= 80) return 'util-ok';
  return 'util-warn';
}

function renderTable() {
  if (!lastComputed) return;
  const { teams, teamStats, teamMembersStats, projectNames, teamToProject } = lastComputed;

  const teamsByProject = {};
  projectNames.forEach(p => { teamsByProject[p] = []; });
  teams.forEach(team => {
    const proj = teamToProject[team] || 'Без проекта';
    if (!teamsByProject[proj]) teamsByProject[proj] = [];
    teamsByProject[proj].push(team);
  });

  let containerHtml = '';
  projectNames.forEach(project => {
    containerHtml += renderProjectTable(project, teamsByProject[project] || [], teamStats, teamMembersStats);
  });
  document.getElementById('tableContainer').innerHTML = containerHtml;

  document.querySelectorAll('.capacityInput').forEach(inp => {
    inp.addEventListener('change', e => {
      capacityStore[e.target.dataset.team] = parseFloat(e.target.value) || 0;
      renderTable();
      renderProjectChart();
    });
  });

  renderProjectChart();
}

function teamInitials(name) {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(name).slice(0,2).toUpperCase();
}

function renderProjectTable(project, teams, teamStats, teamMembersStats) {
  const totalTasks = teams.reduce((sum, t) => sum + teamStats[t].featureIssueIds.size, 0);
  let html = `<div class="project-block">
    <div class="project-header">
      <span class="project-dot"></span>
      <span class="project-title">${project}</span>
      <span class="project-badge">${totalTasks} задач</span>
    </div>
    <table class="main"><thead>
    <tr class="col-header">
      <th>Команда</th>
      <th>Бизнес Емкость</th>
      <th>Кол-во выпол. БЗ</th>
      <th>${METRIC_LABELS.biz}</th>
      <th>${METRIC_LABELS.tech}</th>
      <th>${METRIC_LABELS.bug}</th>
      <th>${METRIC_LABELS.overs}</th>
      <th>${METRIC_LABELS.meeting}</th>
      <th>Утилизация</th>
      <th>В оценке</th>
    </tr>
  </thead><tbody>`;

  teams.forEach(team => {
    const s = teamStats[team];
    const capacity = capacityStore[team] || 0;
    const util = capacity > 0 ? (s.biz / capacity * 100) : 0;
    const isExpanded = expandedTeams.has(team);
    const teamAttr = escapeAttr(team);
    html += `<tr class="team-row${isExpanded ? ' expanded' : ''}" data-team="${teamAttr}">
      <td class="teamname"><span class="chev">▶</span><span class="team-avatar">${teamInitials(team)}</span>${team}</td>
      <td class="capacity">
        <input type="number" min="0" step="1" value="${capacity}" data-team="${teamAttr}" class="capacityInput">
      </td>
      <td class="count biz-cell" data-action="showClosedBreakdown" data-team="${teamAttr}"><span class="pill">${s.featureIssueIds.size}</span></td>
      <td class="biz-cell" data-action="showBreakdown" data-team="${teamAttr}" data-metric="biz">${s.biz.toFixed(1)}</td>
      <td class="biz-cell" data-action="showBreakdown" data-team="${teamAttr}" data-metric="tech">${s.tech.toFixed(1)}</td>
      <td class="biz-cell" data-action="showBreakdown" data-team="${teamAttr}" data-metric="bug">${s.bug.toFixed(1)}</td>
      <td class="biz-cell" data-action="showBreakdown" data-team="${teamAttr}" data-metric="overs">${s.overs.toFixed(1)}</td>
      <td class="biz-cell" data-action="showBreakdown" data-team="${teamAttr}" data-metric="meeting">${s.meeting.toFixed(1)}</td>
      <td class="util biz-cell" data-action="showUtilBreakdown" data-team="${teamAttr}"><span class="util ${capacity > 0 ? utilClass(util) : ''}">${capacity > 0 ? util.toFixed(0) + '%' : '—'}</span></td>
      <td class="biz-cell" data-action="showEstimateBreakdown" data-team="${teamAttr}">${estimateDisplay(s)}</td>
    </tr>`;

    if (isExpanded) {
      const members = teamMembersStats[team] || {};
      const logins = Object.keys(members).sort((a,b) => (members[b].biz+members[b].tech+members[b].bug+members[b].overs+members[b].meeting) - (members[a].biz+members[a].tech+members[a].bug+members[a].overs+members[a].meeting));
      let detailHtml = `<div class="detail-wrap"><div class="detail-title">Детализация по сотрудникам — ${team}</div>
        <table class="detail"><thead><tr>
          <th style="text-align:left;">Сотрудник</th><th>Кол-во выпол. БЗ</th><th>${METRIC_LABELS.biz}</th><th>${METRIC_LABELS.tech}</th><th>${METRIC_LABELS.bug}</th><th>${METRIC_LABELS.overs}</th><th>${METRIC_LABELS.meeting}</th><th>В оценке</th>
        </tr></thead><tbody>`;
      if (logins.length === 0) {
        detailHtml += `<tr><td colspan="8" style="text-align:center; color:#9aa1ac;">Нет данных за выбранный период</td></tr>`;
      } else {
        logins.forEach(login => {
          const m = members[login];
          const loginAttr = escapeAttr(login);
          detailHtml += `<tr>
            <td class="login"><span class="member-avatar">${teamInitials(login)}</span>${login}</td>
            <td class="biz-cell" data-action="showClosedBreakdown" data-team="${teamAttr}" data-login="${loginAttr}">${m.featureIssueIds.size}</td>
            <td class="biz-cell" data-action="showBreakdown" data-team="${teamAttr}" data-login="${loginAttr}" data-metric="biz">${m.biz.toFixed(1)}</td>
            <td class="biz-cell" data-action="showBreakdown" data-team="${teamAttr}" data-login="${loginAttr}" data-metric="tech">${m.tech.toFixed(1)}</td>
            <td class="biz-cell" data-action="showBreakdown" data-team="${teamAttr}" data-login="${loginAttr}" data-metric="bug">${m.bug.toFixed(1)}</td>
            <td class="biz-cell" data-action="showBreakdown" data-team="${teamAttr}" data-login="${loginAttr}" data-metric="overs">${m.overs.toFixed(1)}</td>
            <td class="biz-cell" data-action="showBreakdown" data-team="${teamAttr}" data-login="${loginAttr}" data-metric="meeting">${m.meeting.toFixed(1)}</td>
            <td class="biz-cell" data-action="showEstimateBreakdown" data-team="${teamAttr}" data-login="${loginAttr}">${estimateDisplay(m)}</td>
          </tr>`;
        });
      }
      detailHtml += `</tbody></table></div>`;
      html += `<tr class="detail-row"><td colspan="10">${detailHtml}</td></tr>`;
    }
  });

  html += '</tbody></table></div>';
  return html;
}


function toggleTeam(team) {
  if (expandedTeams.has(team)) expandedTeams.delete(team);
  else expandedTeams.add(team);
  renderTable();
}

const METRIC_ITEMS_KEY = { biz: 'bizItems', tech: 'techItems', bug: 'bugItems', overs: 'oversItems', meeting: 'meetingItems' };

function showBreakdown(team, login, metric) {
  if (!lastComputed) return;
  const { teamStats, teamMembersStats } = lastComputed;
  const source = login ? teamMembersStats[team][login] : teamStats[team];
  const itemsKey = METRIC_ITEMS_KEY[metric] || 'bizItems';
  const items = source ? source[itemsKey] : [];
  const label = METRIC_LABELS[metric] || 'Бизнес';
  const title = login
    ? `Детализация часов "${label}" — ${team} / ${login}`
    : `Детализация часов "${label}" — ${team}`;
  document.getElementById('breakdownTitle').textContent = title;

  let total = 0;
  let html = `<table class="breakdown"><thead><tr>
      <th>Задача</th><th>Сотрудник</th><th>Дата списания</th><th>Часы</th>
    </tr></thead><tbody>`;
  if (!items || items.length === 0) {
    html += `<tr><td colspan="4" style="text-align:center; color:#9aa1ac;">Нет записей</td></tr>`;
  } else {
    items.slice().sort((a,b) => a.date.localeCompare(b.date)).forEach(it => {
      total += it.hours;
      html += `<tr>
        <td><a href="https://youtrack-mapps.sovcombank.ru/issue/${it.idReadable}" target="_blank" rel="noopener" class="yt-issue-link">${it.idReadable}</a></td>
        <td>${it.author}</td>
        <td>${it.date}</td>
        <td>${it.hours.toFixed(2)}</td>
      </tr>`;
    });
  }
  html += `</tbody><tfoot><tr><td colspan="3">Итого записей: ${items.length}</td><td>${total.toFixed(2)} ч</td></tr></tfoot></table>`;
  html += `<div class="breakdown-sum">Сумма всех строк выше и есть то число, которое показано в колонке "${label}".</div>`;

  document.getElementById('breakdownContent').innerHTML = html;
  document.getElementById('breakdownModal').classList.add('open');

  const rowsForExport = (items || []).slice().sort((a,b) => a.date.localeCompare(b.date)).map(it => [it.idReadable, it.author, it.date, it.hours]);
  rowsForExport.push(['Итого', '', '', total]);
  lastBreakdownExport = { title, headers: ['Задача', 'Сотрудник', 'Дата списания', 'Часы'], rows: rowsForExport, sheetName: 'Детализация' };
}

function closeBreakdown() {
  document.getElementById('breakdownModal').classList.remove('open');
}

function showClosedBreakdown(team, login) {
  if (!lastComputed) return;
  const { teamStats, teamMembersStats, issueActualHoursByAuthor } = lastComputed;
  const source = login ? teamMembersStats[team][login] : teamStats[team];
  const items = source ? source.closedFeatureItems : [];
  const title = login
    ? `Детализация закрытых БЗ — ${team} / ${login}`
    : `Детализация закрытых БЗ — ${team}`;
  document.getElementById('breakdownTitle').textContent = title;

  const authorsOf = (it) => it.authors ? Array.from(it.authors) : [it.author].filter(Boolean);
  const hoursFor = (it) => {
    const perIssue = (issueActualHoursByAuthor && issueActualHoursByAuthor[it.issueId]) || {};
    return authorsOf(it).reduce((sum, a) => sum + (perIssue[a] || 0), 0);
  };

  let html = `<table class="breakdown"><thead><tr>
      <th>Задача</th><th>Статус</th><th>Автор(ы) списания</th><th>Списано часов</th>
    </tr></thead><tbody>`;
  let totalHours = 0;
  if (!items || items.length === 0) {
    html += `<tr><td colspan="4" style="text-align:center; color:#9aa1ac;">Нет закрытых бизнес-задач</td></tr>`;
  } else {
    items.forEach(it => {
      const hrs = hoursFor(it);
      totalHours += hrs;
      html += `<tr>
        <td><a href="https://youtrack-mapps.sovcombank.ru/issue/${it.idReadable}" target="_blank" rel="noopener" class="yt-issue-link">${it.idReadable}</a></td>
        <td>${it.status}</td>
        <td>${authorsOf(it).join(', ')}</td>
        <td>${hrs.toFixed(2)}</td>
      </tr>`;
    });
  }
  html += `</tbody><tfoot><tr><td colspan="3">Итого задач: ${items.length}</td><td>${totalHours.toFixed(2)}</td></tr></tfoot></table>`;
  html += `<div class="breakdown-sum">Это список уникальных задач с Тип: Фича, попавших в счётчик "Кол-во выпол. БЗ" по условию закрытия. Если над задачей время по типу "${METRIC_LABELS.biz}" списывали НЕСКОЛЬКО человек — все они перечислены в "Автор(ы) списания", а "Списано часов" — сумма их часов по этой задаче.</div>`;

  document.getElementById('breakdownContent').innerHTML = html;
  document.getElementById('breakdownModal').classList.add('open');

  const rowsForExport = (items || []).map(it => [it.idReadable, it.status, authorsOf(it).join(', '), Number(hoursFor(it).toFixed(2))]);
  lastBreakdownExport = { title, headers: ['Задача', 'Статус', 'Автор(ы) списания', 'Списано часов'], rows: rowsForExport, sheetName: 'Закрытые БЗ' };
}

function showUtilBreakdown(team) {
  if (!lastComputed) return;
  const { teamStats } = lastComputed;
  const s = teamStats[team];
  if (!s) return;
  const capacity = capacityStore[team] || 0;
  const bizHours = s.biz || 0;
  const util = capacity > 0 ? (bizHours / capacity * 100) : null;

  document.getElementById('breakdownTitle').textContent = `Расчёт утилизации — ${team}`;

  let html = '<table class="breakdown"><tbody>';
  html += `<tr><td>Бизнес Емкость команды (план), ч</td><td>${capacity.toFixed(1)}</td></tr>`;
  html += `<tr><td>Часы "${METRIC_LABELS.biz}" за выбранный период (факт), ч</td><td>${bizHours.toFixed(1)}</td></tr>`;
  html += `<tr><td>Формула</td><td>Утилизация = Часы "${METRIC_LABELS.biz}" / Бизнес Емкость &times; 100%</td></tr>`;
  html += capacity > 0
    ? `<tr><td>Расчёт</td><td>${bizHours.toFixed(1)} / ${capacity.toFixed(1)} &times; 100% = <b>${util.toFixed(1)}%</b></td></tr>`
    : `<tr><td>Расчёт</td><td>Бизнес Емкость не задана (0) — утилизация не считается</td></tr>`;
  html += '</tbody></table>';
  html += `<div class="breakdown-sum">Из чего сложились часы "${METRIC_LABELS.biz}" — можно посмотреть по клику на сам столбец "${METRIC_LABELS.biz}" в таблице.</div>`;

  document.getElementById('breakdownContent').innerHTML = html;
  document.getElementById('breakdownModal').classList.add('open');

  const rowsForExport = [
    ['Бизнес Емкость команды (план), ч', Number(capacity.toFixed(1))],
    [`Часы "${METRIC_LABELS.biz}" за период (факт), ч`, Number(bizHours.toFixed(1))],
    ['Утилизация, %', util !== null ? Number(util.toFixed(1)) : '—']
  ];
  lastBreakdownExport = { title: `Расчёт утилизации — ${team}`, headers: ['Показатель', 'Значение'], rows: rowsForExport, sheetName: 'Утилизация' };
}

function showEstimateBreakdown(team, login) {
  if (!lastComputed) return;
  const { teamStats, teamMembersStats } = lastComputed;
  const source = login ? teamMembersStats[team][login] : teamStats[team];
  const items = source ? source.estimateItems : [];
  const title = login
    ? `Детализация "В оценке" — ${team} / ${login}`
    : `Детализация "В оценке" — ${team}`;
  document.getElementById('breakdownTitle').textContent = title;

  const withinCount = items.filter(it => it.ratioPct <= 100).length;
  const overCount = items.filter(it => it.ratioPct > 100).length;

  let html = `<table class="breakdown"><thead><tr>
      <th>Задача</th><th>Автор(ы)</th><th>Оценка, ч</th><th>Факт, ч</th><th>% от оценки</th>
    </tr></thead><tbody>`;
  if (!items || items.length === 0) {
    html += `<tr><td colspan="5" style="text-align:center; color:#9aa1ac;">Нет задач с указанной оценкой</td></tr>`;
  } else {
    items.slice().sort((a,b) => b.ratioPct - a.ratioPct).forEach(it => {
      const colorClass = it.ratioPct > 100 ? 'util-over' : (it.ratioPct >= 80 ? 'util-warn' : 'util-ok');
      html += `<tr>
        <td><a href="https://youtrack-mapps.sovcombank.ru/issue/${it.idReadable}" target="_blank" rel="noopener" class="yt-issue-link">${it.idReadable}</a></td>
        <td>${it.author}</td>
        <td>${it.estimate.toFixed(1)}</td>
        <td>${it.actual.toFixed(1)}</td>
        <td><span class="util ${colorClass}">${Math.round(it.ratioPct)}%</span></td>
      </tr>`;
    });
  }
  const avgPct = items && items.length ? Math.round(items.reduce((s,it) => s + it.ratioPct, 0) / items.length) : 0;
  html += `</tbody><tfoot>
    <tr><td colspan="4">Средний % по ${items.length} задачам:</td><td>${avgPct}%</td></tr>
    <tr><td colspan="4">Уложились в оценку (&le;100%):</td><td>${withinCount}</td></tr>
    <tr><td colspan="4">Превысили оценку (&gt;100%):</td><td>${overCount}</td></tr>
  </tfoot></table>`;
  html += `<div class="breakdown-sum">Процент = (суммарные фактические часы по типу "Разработка" ВСЕХ авторов задачи / оценка "Оценка разработка") × 100%. Если над задачей работали несколько человек — в "Автор(ы)" перечислены все, а "Факт" — их суммарные часы.</div>`;

  document.getElementById('breakdownContent').innerHTML = html;
  document.getElementById('breakdownModal').classList.add('open');

  const rowsForExport = (items || []).slice().sort((a,b) => b.ratioPct - a.ratioPct).map(it => [it.idReadable, it.author, it.estimate.toFixed(1), it.actual.toFixed(1), Math.round(it.ratioPct), it.ratioPct > 100 ? 'Превышена' : 'В пределах']);
  lastBreakdownExport = { title, headers: ['Задача', 'Автор(ы)', 'Оценка, ч', 'Факт, ч', '% от оценки', 'Статус оценки'], rows: rowsForExport, sheetName: 'В оценке' };
}

function renderProjectChart() {
  if (!lastComputed) return;
  loadPlotly().then(function() {
    renderProjectChartInner();
  }).catch(function(e) {
    document.getElementById('chartPanel').style.display = 'block';
    document.getElementById('chartTitle').textContent = 'Ошибка загрузки библиотеки графиков';
    document.getElementById('projectChart').innerHTML = '<div style="color:#dc2626;font-size:13px;padding:12px;">' + e.message + ' Проверьте подключение к интернету или доступность CDN (cdn.plot.ly).</div>';
  });
}

function renderProjectChartInner() {
  if (!lastComputed) return;
  const { teams, teamStats, projectNames, teamToProject, periodLabel } = lastComputed;
  document.getElementById('chartTitle').textContent = `Утилизация бизнес-емкости по проектам — ${periodLabel || ''}`;

  const projectAgg = {};
  projectNames.forEach(p => { projectAgg[p] = { biz: 0, capacity: 0 }; });

  teams.forEach(team => {
    const proj = teamToProject[team] || 'Без проекта';
    if (!projectAgg[proj]) projectAgg[proj] = { biz: 0, capacity: 0 };
    projectAgg[proj].biz += teamStats[team].biz;
    projectAgg[proj].capacity += (capacityStore[team] || 0);
  });

  const labels = projectNames.filter(p => projectAgg[p].capacity > 0 || projectAgg[p].biz > 0);
  if (labels.length === 0) {
    document.getElementById('chartPanel').style.display = 'none';
    return;
  }

  const utilValues = labels.map(p => {
    const a = projectAgg[p];
    return a.capacity > 0 ? Math.round((a.biz / a.capacity) * 100) : 0;
  });

  const colors = utilValues.map(v => v > 100 ? '#dc2626' : (v >= 80 ? '#16a34a' : '#f59e0b'));

  const trace = {
    x: labels,
    y: utilValues,
    type: 'bar',
    text: utilValues.map(v => v + '%'),
    textposition: 'outside',
    marker: { color: colors }
  };

  const layout = {
    margin: { t: 20, r: 20, b: 60, l: 50 },
    yaxis: { title: 'Утилизация, %', rangemode: 'tozero' },
    xaxis: { title: '' },
    font: { family: 'Segoe UI, Arial, sans-serif', size: 13 },
    plot_bgcolor: '#fff',
    paper_bgcolor: '#fff'
  };

  YouTrackReferenceDesign.plot('projectChart', [trace], layout, { displayModeBar: false, responsive: true });
  document.getElementById('chartPanel').style.display = 'block';
}


function exportSummaryToExcel() {
  if (!lastComputed) { showError('Сначала постройте дашборд.'); return; }
  const { teams, teamStats, projectNames, teamToProject, periodLabel } = lastComputed;

  const teamsByProject = {};
  projectNames.forEach(p => { teamsByProject[p] = []; });
  teams.forEach(team => {
    const proj = teamToProject[team] || 'Без проекта';
    if (!teamsByProject[proj]) teamsByProject[proj] = [];
    teamsByProject[proj].push(team);
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Сводка по командам');

  const colDefs = [
    { header: 'Проект/Команда', width: 30 },
    { header: 'Бизнес Емкость', width: 16 },
    { header: 'Кол-во выпол. БЗ', width: 16 },
    { header: METRIC_LABELS.biz, width: 12 },
    { header: METRIC_LABELS.tech + '**', width: 12 },
    { header: METRIC_LABELS.bug, width: 12 },
    { header: METRIC_LABELS.overs, width: 12 },
    { header: METRIC_LABELS.meeting, width: 14 },
    { header: 'Утилизация биз.емкости', width: 16 },
    { header: 'Общий факт. утилизированной емкости', width: 18 }
  ];
  sheet.columns = colDefs;

  const COLOR_GREEN = 'FFD9E7CE';
  const COLOR_YELLOW = 'FFFCE7A6';
  const COLOR_PINK = 'FFF6C7CE';
  const COLOR_GREY = 'FFE7E6E6';
  const COLOR_RED_TEXT = 'FFC00000';

  sheet.mergeCells(1, 2, 1, 10);
  sheet.getCell('A1').value = (periodLabel || '').replace(/^за /, '').replace(/^период /, '') || 'Период';
  sheet.getCell('B1').value = 'ФАКТ чч/мес';
  sheet.getRow(1).height = 20;
  for (let c = 1; c <= 10; c++) {
    const cell = sheet.getCell(1, c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GREEN } };
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  const headerRow = sheet.getRow(2);
  colDefs.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.font = { bold: (i === 0), italic: (i >= 3 && i <= 6) };
  });
  headerRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_GREY } };
  headerRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_YELLOW } };
  headerRow.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_YELLOW } };
  headerRow.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PINK } };

  let rowIdx = 3;
  projectNames.forEach(project => {
    const teamList = teamsByProject[project] || [];
    let projCapacity = 0, projTasks = 0, projBiz = 0, projTech = 0, projBug = 0, projOvers = 0, projMeeting = 0;
    teamList.forEach(team => {
      const s = teamStats[team];
      projCapacity += (capacityStore[team] || 0);
      projTasks += s.featureIssueIds.size;
      projBiz += s.biz; projTech += s.tech; projBug += s.bug; projOvers += s.overs; projMeeting += s.meeting;
    });
    const projUtil = projCapacity > 0 ? (projBiz / projCapacity * 100) : null;
    const projFact = projBiz + projTech + projBug + projOvers + projMeeting;

    const pr = sheet.getRow(rowIdx);
    pr.getCell(1).value = project;
    pr.getCell(2).value = Number(projCapacity.toFixed(1));
    pr.getCell(3).value = projTasks > 0 ? projTasks : '-';
    pr.getCell(4).value = Number(projBiz.toFixed(1));
    pr.getCell(5).value = Number(projTech.toFixed(1));
    pr.getCell(6).value = Number(projBug.toFixed(1));
    pr.getCell(7).value = Number(projOvers.toFixed(1));
    pr.getCell(8).value = Number(projMeeting.toFixed(1));
    pr.getCell(9).value = projUtil !== null ? Number((projUtil/100).toFixed(4)) : '-';
    pr.getCell(9).numFmt = '0%';
    pr.getCell(10).value = Number(projFact.toFixed(1));
    for (let c = 1; c <= 10; c++) {
      pr.getCell(c).font = { bold: true, color: { argb: COLOR_RED_TEXT } };
      pr.getCell(c).alignment = { horizontal: c === 1 ? 'left' : 'center' };
    }
    pr.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_YELLOW } };
    pr.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PINK } };
    rowIdx++;

    teamList.forEach(team => {
      const s = teamStats[team];
      const capacity = capacityStore[team] || 0;
      const util = capacity > 0 ? (s.biz / capacity * 100) : null;
      const fact = s.biz + s.tech + s.bug + s.overs + s.meeting;

      const tr = sheet.getRow(rowIdx);
      tr.outlineLevel = 1;
      tr.getCell(1).value = '    ' + team;
      tr.getCell(2).value = capacity > 0 ? Number(capacity.toFixed(1)) : '';
      tr.getCell(3).value = s.featureIssueIds.size > 0 ? s.featureIssueIds.size : '-';
      tr.getCell(4).value = Number(s.biz.toFixed(1));
      tr.getCell(5).value = Number(s.tech.toFixed(1));
      tr.getCell(6).value = Number(s.bug.toFixed(1));
      tr.getCell(7).value = Number(s.overs.toFixed(1));
      tr.getCell(8).value = Number(s.meeting.toFixed(1));
      tr.getCell(9).value = util !== null ? Number((util/100).toFixed(4)) : '-';
      tr.getCell(9).numFmt = '0%';
      tr.getCell(10).value = Number(fact.toFixed(1));
      for (let c = 2; c <= 10; c++) tr.getCell(c).alignment = { horizontal: 'center' };
      tr.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_YELLOW } };
      tr.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PINK } };
      rowIdx++;
    });
  });

  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];
  sheet.properties.outlineLevelRow = 1;
  sheet.eachRow(row => { row.eachCell(cell => { cell.border = { top:{style:'thin',color:{argb:'FFD9D9D9'}}, left:{style:'thin',color:{argb:'FFD9D9D9'}}, bottom:{style:'thin',color:{argb:'FFD9D9D9'}}, right:{style:'thin',color:{argb:'FFD9D9D9'}} }; }); });

  const fileLabel = (periodLabel || 'период').replace(/[\\/:*?"<>|]/g, '_');
  workbook.xlsx.writeBuffer().then(buffer => {
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Сводная_таблица_${fileLabel}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  });
}

function exportBreakdownToExcel() {
  if (!lastBreakdownExport) { showError('Нет данных для экспорта.'); return; }
  const { title, headers, rows, sheetName } = lastBreakdownExport;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet((sheetName || 'Детализация').slice(0, 31));

  sheet.mergeCells(1, 1, 1, headers.length);
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { bold: true, size: 12 };
  sheet.getCell('A1').alignment = { horizontal: 'left' };

  const headerRow = sheet.getRow(2);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F7F9' } };
    cell.alignment = { horizontal: 'center' };
  });

  rows.forEach((r, idx) => {
    const row = sheet.getRow(3 + idx);
    r.forEach((val, i) => { row.getCell(i + 1).value = val; row.getCell(i+1).alignment = { horizontal: i === 0 ? 'left' : 'center' }; });
    if (idx === rows.length - 1 && String(r[0]).toLowerCase().includes('итого')) {
      row.eachCell(c => c.font = { bold: true });
    }
  });

  sheet.columns.forEach(c => { c.width = 22; });
  sheet.eachRow(row => { row.eachCell(cell => { cell.border = { top:{style:'thin',color:{argb:'FFE0E0E0'}}, left:{style:'thin',color:{argb:'FFE0E0E0'}}, bottom:{style:'thin',color:{argb:'FFE0E0E0'}}, right:{style:'thin',color:{argb:'FFE0E0E0'}} }; }); });

  const safeTitle = String(title).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  workbook.xlsx.writeBuffer().then(buffer => {
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  });
}

// ==== Навигация по отчётам через File System Access API + manifest.json ====
// Работает в Chrome/Edge, в том числе при открытии HTML напрямую через file://
let projectRootHandle = null;
let manifestData = null;
let pendingReport = null; // { label, path } — выбранный, но ещё не применённый отчёт

async function pickProjectRoot() {
  clearMessages();
  if (!('showDirectoryPicker' in window)) {
    showError('Навигация по папкам отчётов требует Chrome или Edge. Загрузите файлы вручную через блоки выше.');
    return;
  }
  try {
    projectRootHandle = await window.showDirectoryPicker({ mode: 'read' });
    pendingReport = null;
    manifestData = null;
    document.getElementById('reportsRootLabel').textContent = `Выбрана папка: "${projectRootHandle.name}"`;
    document.getElementById('reportsSelected').textContent = 'Отчёт не выбран.';
    document.getElementById('applyReportBtn').disabled = true;
    document.getElementById('reportsCurrent').textContent = '';

    try {
      const manifestHandle = await projectRootHandle.getFileHandle('manifest.json');
      manifestData = JSON.parse(await (await manifestHandle.getFile()).text());
    } catch (e) {
      manifestData = null; // манифеста нет — сработает автоопределение
    }

    await renderReportsNav();
  } catch (err) {
    if (err.name !== 'AbortError') {
      showError('Не удалось открыть папку: ' + err.message);
    }
  }
}

// Разбирает относительный путь вида "emp/Сентябрь 2026" на сегменты
// и последовательно спускается по вложенным папкам от корневого handle.
async function resolveDirByPath(rootHandle, relativePath) {
  if (!relativePath || relativePath === '.' || relativePath === '') return rootHandle;
  const segments = String(relativePath).split('/').map(s => s.trim()).filter(Boolean);
  let dir = rootHandle;
  for (const seg of segments) {
    dir = await dir.getDirectoryHandle(seg);
  }
  return dir;
}

async function renderReportsNav() {
  const nav = document.getElementById('reportsNav');
  const hint = document.getElementById('reportsHint');
  nav.innerHTML = '';
  hint.textContent = '';
  if (!projectRootHandle) return;

  const entries = [];

  if (manifestData && Array.isArray(manifestData.reports)) {
    // Список отчётов и их пути явно заданы в manifest.json
    if (manifestData.default) {
      entries.push({
        label: manifestData.default.label || 'Общий (по умолчанию)',
        path: manifestData.default.path || '.'
      });
    }
    manifestData.reports.forEach(r => {
      if (r && r.path) entries.push({ label: r.label || r.path, path: r.path });
    });
    hint.textContent = `Список отчётов взят из manifest.json (${entries.length} шт.).`;
  } else {
    // Автоопределение: общий отчёт в корне + любые подпапки первого уровня
    // с парой work_items.json + teams.json, независимо от названия папки.
    try {
      await projectRootHandle.getFileHandle('work_items.json');
      await projectRootHandle.getFileHandle('teams.json');
      entries.push({ label: 'Общий (по умолчанию)', path: '.' });
    } catch (e) { /* нет файлов по умолчанию в корне */ }

    for await (const [name, handle] of projectRootHandle.entries()) {
      if (handle.kind !== 'directory') continue;
      try {
        await handle.getFileHandle('work_items.json');
        await handle.getFileHandle('teams.json');
        entries.push({ label: name, path: name });
      } catch (e) { /* в этой подпапке нет нужной пары файлов — пропускаем */ }
    }

    if (entries.length === 0) {
      hint.textContent = 'Не найдено ни файлов work_items.json/teams.json в корне, ни подпапок с такой парой файлов. Добавьте manifest.json, чтобы явно указать пути к отчётам.';
    } else {
      hint.textContent = `Отчёты определены автоматически (${entries.length} шт.). Добавьте manifest.json, чтобы явно перечислить нужные подпапки, включая вложенные пути вида "emp/Сентябрь 2026".`;
    }
  }

  entries.forEach(entry => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = entry.label;
    btn.className = 'export-btn';
    btn.onclick = () => selectReportCandidate(entry.label, entry.path, btn);
    nav.appendChild(btn);
  });
}

function selectReportCandidate(label, path, btnEl) {
  pendingReport = { label, path };

  document.querySelectorAll('#reportsNav button').forEach(b => { b.style.outline = 'none'; });
  if (btnEl) btnEl.style.outline = '2px solid #16a37e';

  document.getElementById('reportsSelected').textContent =
    `Выбрано: ${label}. Нажмите «Применить выбранный отчёт», чтобы загрузить его данные.`;
  document.getElementById('applyReportBtn').disabled = false;
}

async function applySelectedReport() {
  if (!pendingReport) return;
  await loadReport(pendingReport.label, pendingReport.path);
}

async function loadReport(label, path) {
  clearMessages();
  document.getElementById('reportsCurrent').textContent = '';

  try {
    const sourceDir = await resolveDirByPath(projectRootHandle, path);

    // Полный сброс состояния предыдущего отчёта — иначе Бизнес Емкость,
    // раскрытые строки команд и т.п. "прилипают" от ранее загруженного отчёта.
    workItemsData = null;
    teamsData = null;
    Object.keys(capacityStore).forEach(k => delete capacityStore[k]);
    expandedTeams.clear();
    lastComputed = null;
    lastBreakdownExport = null;
    document.getElementById('tablePanel').style.display = 'none';
    document.getElementById('chartPanel').style.display = 'none';

    const dataHandle = await sourceDir.getFileHandle('work_items.json');
    workItemsData = JSON.parse(await (await dataHandle.getFile()).text());
    document.getElementById('statusData').textContent = `${label} / work_items.json`;

    const teamsHandle = await sourceDir.getFileHandle('teams.json');
    teamsData = JSON.parse(await (await teamsHandle.getFile()).text());
    const parsed = parseTeamsStructure(teamsData);
    parsed.flatTeams.forEach(t => {
      if (t.initialCapacity !== undefined) capacityStore[t.name] = t.initialCapacity;
    });
    document.getElementById('statusTeams').textContent =
      `${label} / teams.json (${parsed.projects.length} проект(ов), ${parsed.flatTeams.length} команд)`;

    try {
      const configHandle = await sourceDir.getFileHandle('config.json');
      applyFieldConfig(JSON.parse(await (await configHandle.getFile()).text()));
      document.getElementById('statusConfig').textContent = `${label} / config.json`;
    } catch (e) {
      applyFieldConfig(null);
      document.getElementById('statusConfig').textContent = `${label}: config.json не найден, используются настройки по умолчанию`;
    }

    processFiles();

    document.getElementById('reportsCurrent').textContent = `✅ Применён отчёт: ${label} (путь: ${path})`;
  } catch (err) {
    showError(`Не удалось загрузить отчёт "${label}" (путь: ${path}): ${err.message}`);
  }
}



function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const DASHBOARD_ACTIONS = {
  pickProjectRoot: () => pickProjectRoot(),
  applySelectedReport: () => applySelectedReport(),
  processFiles: () => processFiles(),
  exportSummaryToExcel: () => exportSummaryToExcel(),
  exportBreakdownToExcel: () => exportBreakdownToExcel(),
  closeBreakdown: () => closeBreakdown(),
  showClosedBreakdown: (el) => showClosedBreakdown(el.dataset.team, el.dataset.login || null),
  showBreakdown: (el) => showBreakdown(el.dataset.team, el.dataset.login || null, el.dataset.metric),
  showUtilBreakdown: (el) => showUtilBreakdown(el.dataset.team),
  showEstimateBreakdown: (el) => showEstimateBreakdown(el.dataset.team, el.dataset.login || null),
};

document.addEventListener('click', function (e) {
  if (e.target.id === 'breakdownModal') { closeBreakdown(); return; }

  const actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    e.stopPropagation();
    const fn = DASHBOARD_ACTIONS[actionEl.dataset.action];
    if (fn) fn(actionEl);
    return;
  }

  if (e.target.closest('.capacity')) return;

  const row = e.target.closest('tr.team-row[data-team]');
  if (row) toggleTeam(row.dataset.team);
});


// ===== dashboard_plotly_loader.js =====
function loadPlotly() {
  if (window.Plotly) return Promise.resolve(window.Plotly);
  return Promise.reject(new Error('Plotly не найден. Убедитесь, что libs/plotly.min.js лежит в папке расширения и подключён в dashboard.html.'));
}

// ===== youtrack_fetch.js =====
(function () {
  const BASE_URL = "https://youtrack-mapps.sovcombank.ru";
  const HOST_PATTERN = "https://youtrack-mapps.sovcombank.ru/*";
  const TOKEN_CAPTURE_ENABLED = globalThis.SensorFeatureFlags?.youtrackTokenCapture !== false;
  const FIELDS =
    "duration(minutes),author(login),type(name),date,issue(id,idReadable,project(name),customFields(name,value(name,minutes,presentation)))";
  const PAGE_SIZE = 500;

  const selectedProjects = new Set();
  let pendingProjectSelection = null;

  window.ytSetWorkItems = function (items) {
    workItemsData = items;
    const el = document.getElementById("statusData");
    if (el) el.textContent = `Загружено из YouTrack: ${items.length} записей`;
  };

  window.ytSelectProjectsByNames = function (names) {
    const listEl = document.getElementById("ytProjectList");
    const chips = listEl ? listEl.querySelectorAll(".yt-chip") : [];
    if (!listEl || chips.length === 0) {
      pendingProjectSelection = names;
      return;
    }
    selectedProjects.clear();
    chips.forEach((chip) => {
      const match = names.includes(chip.dataset.name);
      chip.classList.toggle("selected", match);
      if (match) selectedProjects.add(chip.dataset.name);
    });
    updateCount();
  };

  // ===================== Кастомный календарь =====================
  const MONTH_NAMES = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  const WEEKDAY_NAMES = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  let openCalendarPopup = null;

  function isoOf(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function formatRu(isoStr) {
    if (!isoStr) return "Выберите дату";
    const [y, m, d] = isoStr.split("-");
    return `${d}.${m}.${y}`;
  }

  function closeCalendar() {
    if (openCalendarPopup) {
      openCalendarPopup.remove();
      openCalendarPopup = null;
    }
    document.removeEventListener("mousedown", outsideClickHandler, true);
  }
  window.YouTrackReferenceCalendar = Object.freeze({ close: closeCalendar });
  function outsideClickHandler(e) {
    if (openCalendarPopup && !openCalendarPopup.contains(e.target)) closeCalendar();
  }

  function openCalendar(input, btn) {
    if (openCalendarPopup) {
      const wasForThisBtn = openCalendarPopup.dataset.forBtn === btn.id;
      closeCalendar();
      if (wasForThisBtn) return;
    }

    const initial = input.value ? new Date(input.value + "T00:00:00") : new Date();
    let viewYear = initial.getFullYear();
    let viewMonth = initial.getMonth();

    const popup = document.createElement("div");
    popup.className = "yt-cal-popup";
    popup.dataset.forBtn = btn.id;
    document.body.appendChild(popup);
    openCalendarPopup = popup;

    function render() {
      const firstDay = new Date(viewYear, viewMonth, 1);
      let startWeekday = (firstDay.getDay() + 6) % 7;
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      const selectedIso = input.value;
      const todayIso = isoOf(new Date());

      let cells = "";
      for (let i = 0; i < startWeekday; i++) cells += `<span class="yt-cal-day yt-cal-empty"></span>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateIso = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const cls = ["yt-cal-day"];
        if (dateIso === selectedIso) cls.push("selected");
        if (dateIso === todayIso) cls.push("today");
        cells += `<button type="button" class="${cls.join(" ")}" data-date="${dateIso}">${d}</button>`;
      }

      popup.innerHTML = `
        <div class="yt-cal-header">
          <button type="button" class="yt-cal-nav" data-nav="-1">‹</button>
          <span class="yt-cal-title">${MONTH_NAMES[viewMonth]} ${viewYear}</span>
          <button type="button" class="yt-cal-nav" data-nav="1">›</button>
        </div>
        <div class="yt-cal-weekdays">${WEEKDAY_NAMES.map((w) => `<span>${w}</span>`).join("")}</div>
        <div class="yt-cal-grid">${cells}</div>
      `;

      popup.querySelectorAll(".yt-cal-nav").forEach((navBtn) => {
        navBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          viewMonth += parseInt(navBtn.dataset.nav, 10);
          if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
          if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
          render();
        });
      });
      popup.querySelectorAll(".yt-cal-day:not(.yt-cal-empty)").forEach((cell) => {
        cell.addEventListener("click", (e) => {
          e.stopPropagation();
          input.value = cell.dataset.date;
          btn.textContent = formatRu(cell.dataset.date);
          closeCalendar();
        });
      });
    }

    render();

    const rect = btn.getBoundingClientRect();
    popup.style.position = "fixed";
    popup.style.top = `${rect.bottom + 6}px`;
    popup.style.left = `${rect.left}px`;

    requestAnimationFrame(() => {
      const popupRect = popup.getBoundingClientRect();
      if (popupRect.right > window.innerWidth - 8) {
        popup.style.left = `${Math.max(8, window.innerWidth - popupRect.width - 8)}px`;
      }
    });

    setTimeout(() => document.addEventListener("mousedown", outsideClickHandler, true), 0);
  }

  function initDatePicker(inputId, btnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    btn.textContent = formatRu(input.value);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCalendar(input, btn);
    });
  }
  // ===================== конец календаря =====================

  function injectStyles() {
    if (document.getElementById("ytSharedStyles")) return;
    const style = document.createElement("style");
    style.id = "ytSharedStyles";
    style.textContent = `
      .yt-chip-list { display:flex; flex-wrap:wrap; gap:8px; }
      .yt-chip {
        border: 1px solid var(--yt-line, #dfe1e6);
        background: #fff;
        color: var(--yt-ink, #202124);
        padding: 6px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background .15s, color .15s, border-color .15s;
        line-height: 1.3;
      }
      .yt-chip:hover { border-color: var(--yt-blue, #3574f0); }
      .yt-chip.selected {
        background: var(--yt-blue, #3574f0);
        color: #fff;
        border-color: var(--yt-blue, #3574f0);
      }
      .yt-chip-empty { color: var(--yt-muted, #9aa1ac); font-size: 13px; }

      .yt-row { display:flex; flex-wrap:wrap; gap:20px; align-items:flex-end; margin-top:14px; }
      .yt-field label { display:block; font-size:12px; font-weight:600; color: var(--yt-muted, #5e6064); margin-bottom:6px; }

      .yt-date-btn {
        height: 38px;
        padding: 0 14px;
        border: 1px solid var(--yt-line, #bfc3c9);
        border-radius: 8px;
        font-size: 13px;
        font-family: inherit;
        color: var(--yt-ink, #202124);
        background: #fff url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%233574f0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2'/%3E%3Cline x1='16' y1='2' x2='16' y2='6'/%3E%3Cline x1='8' y1='2' x2='8' y2='6'/%3E%3Cline x1='3' y1='10' x2='21' y2='10'/%3E%3C/svg%3E") no-repeat right 10px center;
        background-size: 15px 15px;
        padding-right: 34px;
        min-width: 150px;
        text-align: left;
        cursor: pointer;
        box-sizing: border-box;
        transition: border-color .15s, box-shadow .15s;
      }
      .yt-date-btn:hover { border-color: var(--yt-blue, #3574f0); }
      .yt-date-btn:focus, .yt-date-btn.yt-date-open {
        outline: none;
        border-color: var(--yt-blue, #3574f0);
        box-shadow: 0 0 0 2px rgba(53,116,240,.18);
      }

      .yt-cal-popup {
        background: #fff;
        border: 1px solid var(--yt-line, #dfe1e6);
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(23,24,25,.15);
        padding: 12px;
        width: 240px;
        box-sizing: border-box;
        overflow: hidden;
        z-index: 99999;
        font-family: inherit;
      }
      .yt-cal-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      .yt-cal-title { font-size:13px; font-weight:700; color: var(--yt-ink, #202124); }
      .yt-cal-nav {
        width:26px; height:26px; border-radius:6px; border:none; background:#f4f5f7;
        color: var(--yt-blue, #3574f0); font-size:15px; cursor:pointer; line-height:1;
        padding:0; box-sizing:border-box; flex-shrink:0;
      }
      .yt-cal-nav:hover { background:#e9f0ff; }
      .yt-cal-weekdays {
        display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:2px; margin-bottom:4px; width:100%;
      }
      .yt-cal-weekdays span {
        font-size:10.5px; color: var(--yt-muted, #9aa1ac); text-align:center; font-weight:600;
        min-width:0; overflow:hidden;
      }
      .yt-cal-grid {
        display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:2px; width:100%;
      }
      .yt-cal-day {
        border:none; background:transparent; height:28px; border-radius:6px; font-size:12.5px;
        color: var(--yt-ink, #202124); cursor:pointer;
        width:100%; min-width:0; padding:0; margin:0; box-sizing:border-box;
      }
      .yt-cal-day:hover { background:#f2f6ff; }
      .yt-cal-day.today { font-weight:700; color: var(--yt-blue, #3574f0); }
      .yt-cal-day.selected { background: var(--yt-blue, #3574f0); color:#fff; }
      .yt-cal-day.selected:hover { background: var(--yt-blue, #3574f0); }
      .yt-cal-empty { pointer-events:none; width:100%; min-width:0; padding:0; margin:0; box-sizing:border-box; }

      .yt-actions { margin-left:auto; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
      .yt-actions button { height: 38px; box-sizing: border-box; }
      .yt-actions button.secondary { background:#eef1f6; color:#303236; }
      .yt-links { margin-top:8px; display:flex; gap:14px; }
      .yt-links a { font-size:11.5px; color: var(--yt-blue, #2563eb); text-decoration:none; cursor:pointer; }
      .yt-links a:hover { text-decoration:underline; }
      .yt-status-line { font-size:12.5px; color: var(--yt-muted, #5e6064); margin-top:14px; font-weight:600; }
      details.yt-log-details { margin-top:6px; }
      details.yt-log-details summary {
        cursor:pointer; font-size:11.5px; color: var(--yt-blue, #2563eb); list-style:none; user-select:none;
      }
      details.yt-log-details summary::-webkit-details-marker { display:none; }
      details.yt-log-details summary::before { content: "▸ "; }
      details.yt-log-details[open] summary::before { content: "▾ "; }
      .yt-log {
        margin-top:8px; font-family: 'SFMono-Regular', Consolas, monospace; font-size:11.5px;
        color:#5e6064; background:#fafbfc; border:1px solid #eceef1; border-radius:8px;
        padding:10px 12px; max-height:220px; overflow-y:auto; white-space:pre-wrap;
      }

      /* Кликабельный номер задачи в модалках детализации */
      .yt-issue-link {
        color: var(--yt-blue, #3574f0);
        text-decoration: none;
        font-weight: 600;
      }
      .yt-issue-link:hover { text-decoration: underline; color: var(--yt-blue-hover, #245ed7); }
    `;
    document.head.appendChild(style);
  }

  function injectPanel() {
    injectStyles();

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.id = "ytFetchPanel";
    panel.innerHTML = `
      <div class="panel-header-row">
        <h3 style="margin-top:0">Загрузка work items из YouTrack</h3>
      </div>
      <div class="hint" style="margin-top:-4px">Выберите один или несколько проектов и период, затем нажмите «Загрузить work items». Отчёт строится ниже, кнопкой «Применить пресет и построить отчёт».</div>

      <div class="yt-field" style="margin-top:10px">
        <label>Проекты <span id="ytProjectCount" style="color:#9aa1ac;font-weight:400"></span></label>
        <div id="ytProjectList" class="yt-chip-list">
          <span class="yt-chip-empty">Проекты появятся после подключения к YouTrack.</span>
        </div>
        <div class="yt-links">
          <a id="ytSelectAll">Выбрать все</a>
          <a id="ytSelectNone">Снять всё</a>
        </div>
        <div id="ytPresetHint" style="margin-top:6px;font-size:11.5px;color:#16a37e"></div>
      </div>

      <div class="yt-row">
        <div class="yt-field">
          <label>Дата с</label>
          <button type="button" id="ytDateFromBtn" class="yt-date-btn"></button>
          <input type="date" id="ytDateFrom" hidden>
        </div>
        <div class="yt-field">
          <label>Дата по</label>
          <button type="button" id="ytDateToBtn" class="yt-date-btn"></button>
          <input type="date" id="ytDateTo" hidden>
        </div>
        <div class="yt-actions">
          <button type="button" id="ytCaptureBtn" class="secondary" style="width:auto">Поймать токен</button>
          <button type="button" id="ytFetchBtn" style="width:auto">Загрузить</button>
        </div>
      </div>

      <div id="ytFetchStatusShort" class="yt-status-line"></div>
      <details class="yt-log-details" id="ytFetchDetails">
        <summary>Показать детали загрузки</summary>
        <div id="ytFetchStatus" class="yt-log"></div>
      </details>
    `;

    const firstPanel = document.querySelector(".panel, .upload-panel");
    if (firstPanel && firstPanel.parentNode) {
      firstPanel.parentNode.insertBefore(panel, firstPanel);
    } else {
      document.body.prepend(panel);
    }

    setDefaultYtPeriod();
    initDatePicker("ytDateFrom", "ytDateFromBtn");
    initDatePicker("ytDateTo", "ytDateToBtn");

    document.getElementById("ytFetchBtn").addEventListener("click", onFetchClick);
    const captureButton = document.getElementById("ytCaptureBtn");
    captureButton.addEventListener("click", onCaptureClick);
    captureButton.textContent = "Обновить подключение";
    captureButton.title = "Получить сессию YouTrack заново: обновляет вкладку YouTrack и берёт токен из её штатного запроса.";
    if (!TOKEN_CAPTURE_ENABLED) {
      captureButton.disabled = true;
      captureButton.title = "Сбор токена отключён флагом youtrackTokenCapture в extension/feature-flags.js";
    }
    document.getElementById("ytSelectAll").addEventListener("click", (e) => {
      e.preventDefault();
      toggleAll(true);
    });
    document.getElementById("ytSelectNone").addEventListener("click", (e) => {
      e.preventDefault();
      toggleAll(false);
    });
    refreshTokenHint();
  }

  function setDefaultYtPeriod() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    document.getElementById("ytDateFrom").value = isoOf(first);
    document.getElementById("ytDateTo").value = isoOf(last);
  }

  async function getToken() {
    if (!(await chrome.runtime.sendMessage({type:'get-youtrack-session-status'}))?.connected) return null;
    const { ytToken } = await chrome.storage.local.get("ytToken");
    return ytToken || null;
  }

  function setShortStatus(text) {
    const el = document.getElementById("ytFetchStatusShort");
    if (el) el.textContent = text;
  }

  async function refreshTokenHint(options = {}) {
    // Сессия появляется только двумя путями: переход на отчёт со страницы
    // YouTrack (иконка расширения на вкладке YouTrack) или кнопка «Обновить
    // подключение». Простое открытие страницы расширения токен не получает.
    const token = await getToken();

    const { ytTokenCapturedAt } = await chrome.storage.local.get("ytTokenCapturedAt");
    if (token) {
      const when = ytTokenCapturedAt ? new Date(ytTokenCapturedAt).toLocaleTimeString() : "";
      setShortStatus(`YouTrack подключён (сессия от ${when}). Загружаю список проектов...`);
      loadProjects(false);
    } else {
      setShortStatus("Нет сессии YouTrack. Откройте отчёт с открытой страницы YouTrack или нажмите «Обновить подключение».");
    }
  }

  function waitForFreshToken(timeoutMs) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setTimeout(() => {
        chrome.storage.onChanged.removeListener(listener);
        resolve(null);
      }, timeoutMs);

      function listener(changes, area) {
        if (area !== "local" || !changes.ytTokenCapturedAt) return;
        if (changes.ytTokenCapturedAt.newValue >= startedAt) {
          clearTimeout(timer);
          chrome.storage.onChanged.removeListener(listener);
          chrome.storage.local.get("ytToken", ({ ytToken }) => resolve(ytToken));
        }
      }
      chrome.storage.onChanged.addListener(listener);
    });
  }

  // Ручное обновление сессии: нужно только если токен устарел.
  async function onCaptureClick() {
    if (!TOKEN_CAPTURE_ENABLED) return;
    const btn = document.getElementById("ytCaptureBtn");
    btn.disabled = true;
    setShortStatus("Обновляю сессию YouTrack…");
    try {
      await chrome.storage.local.remove(["ytToken", "ytTokenCapturedAt", "ytTokenSourceUrl"]);
      const result = await chrome.runtime.sendMessage({ type: "ensure-youtrack-session" });
      if (result?.ok && (await getToken())) {
        setShortStatus("Сессия обновлена. Загружаю список проектов...");
        loadProjects(true);
      } else {
        setShortStatus("Не удалось обновить сессию. Убедитесь, что вы залогинены в YouTrack.");
      }
    } catch (err) {
      setShortStatus("Ошибка: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function fetchAccessibleProjects(token) {
    const url = new URL("/api/admin/projects", BASE_URL);
    url.searchParams.set("fields", "id,name,shortName,archived");
    url.searchParams.set("$top", "200");

    const resp = await YouTrackReferenceNetwork.fetch(url.toString(), {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} при получении списка проектов: ${(await resp.text()).slice(0, 200)}`);
    }
    const list = await resp.json();
    if (!Array.isArray(list)) throw new Error("Сервер вернул не массив проектов.");
    return list.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
  }

  async function loadProjects(forceReload) {
    const token = await getToken();
    const listEl = document.getElementById("ytProjectList");
    if (!token) {
      listEl.innerHTML = `<span class="yt-chip-empty">Сначала поймайте токен...</span>`;
      return;
    }

    if (!forceReload) {
      const { ytProjectsCache, ytProjectsCachedAt } = await chrome.storage.local.get([
        "ytProjectsCache",
        "ytProjectsCachedAt",
      ]);
      if (ytProjectsCache && ytProjectsCachedAt && Date.now() - ytProjectsCachedAt < 30 * 60 * 1000) {
        renderProjectChips(ytProjectsCache);
        setShortStatus("Список проектов загружен из кэша. Отметьте нужные.");
        return;
      }
    }

    listEl.innerHTML = `<span class="yt-chip-empty">Загрузка списка проектов...</span>`;
    try {
      const projects = await fetchAccessibleProjects(token);
      renderProjectChips(projects);
      await chrome.storage.local.set({ ytProjectsCache: projects, ytProjectsCachedAt: Date.now() });
      setShortStatus(`Доступно проектов: ${projects.length}. Отметьте нужные и жмите «Загрузить work items».`);
    } catch (err) {
      listEl.innerHTML = `<span class="yt-chip-empty" style="color:#dc2626">Не удалось загрузить список</span>`;
      setShortStatus("Ошибка списка проектов: " + err.message);
    }
  }

  function renderProjectChips(projects) {
    const listEl = document.getElementById("ytProjectList");
    selectedProjects.clear();
    if (projects.length === 0) {
      listEl.innerHTML = `<span class="yt-chip-empty">Нет доступных проектов</span>`;
      updateCount();
      return;
    }
    listEl.innerHTML = projects
      .map(
        (p) => `<button type="button" class="yt-chip" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}${
          p.shortName ? ` · ${escapeHtml(p.shortName)}` : ""
        }</button>`
      )
      .join("");

    listEl.querySelectorAll(".yt-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        chip.classList.toggle("selected");
        if (chip.classList.contains("selected")) selectedProjects.add(chip.dataset.name);
        else selectedProjects.delete(chip.dataset.name);
        updateCount();
        checkPresetHint();
      });
    });
    updateCount();

    if (pendingProjectSelection) {
      window.ytSelectProjectsByNames(pendingProjectSelection);
      pendingProjectSelection = null;
    }
  }

  function toggleAll(checked) {
    document.querySelectorAll("#ytProjectList .yt-chip").forEach((chip) => {
      chip.classList.toggle("selected", checked);
      if (checked) selectedProjects.add(chip.dataset.name);
      else selectedProjects.delete(chip.dataset.name);
    });
    updateCount();
    checkPresetHint();
  }

  function updateCount() {
    const el = document.getElementById("ytProjectCount");
    if (el) el.textContent = selectedProjects.size ? `(выбрано: ${selectedProjects.size})` : "";
  }

  async function checkPresetHint() {
    const hintEl = document.getElementById("ytPresetHint");
    if (!hintEl) return;
    if (selectedProjects.size !== 1 || typeof window.ytGetPresetForProject !== "function") {
      hintEl.textContent = "";
      return;
    }
    const projectName = [...selectedProjects][0];
    const presetName = await window.ytGetPresetForProject(projectName);
    hintEl.textContent = presetName
      ? `Для проекта «${projectName}» есть пресет «${presetName}» — примените его в блоке «Конфигурации» ниже.`
      : "";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  async function fetchAllWorkItems(token, query, onProgress) {
    const results = [];
    let skip = 0;
    let page = 0;
    while (true) {
      page += 1;
      onProgress?.(`Запрашиваю страницу ${page} (записей загружено: ${results.length})...`);

      const url = new URL("/api/workItems", BASE_URL);
      url.searchParams.set("fields", FIELDS);
      url.searchParams.set("query", query);
      url.searchParams.set("$top", String(PAGE_SIZE));
      url.searchParams.set("$skip", String(skip));

      const resp = await YouTrackReferenceNetwork.fetch(url.toString(), {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        const bodyText = await resp.text();
        throw new Error(`HTTP ${resp.status} (skip=${skip}): ${bodyText.slice(0, 300)}`);
      }
      const pageItems = await resp.json();
      if (!Array.isArray(pageItems)) {
        throw new Error(`Сервер вернул не массив (skip=${skip})`);
      }
      if (pageItems.length === 0) {
        onProgress?.(`Страница ${page} пустая — загрузка завершена. Всего записей: ${results.length}.`);
        break;
      }

      results.push(...pageItems);
      onProgress?.(`Страница ${page} получена: +${pageItems.length} записей (всего: ${results.length}).`);
      skip += PAGE_SIZE;
    }
    return results;
  }

  async function onFetchClick() {
    const btn = document.getElementById("ytFetchBtn");
    const logEl = document.getElementById("ytFetchStatus");
    btn.disabled = true;
    logEl.textContent = "";
    let log = "";
    const appendLog = (line) => {
      log += (log ? "\n" : "") + line;
      logEl.textContent = log;
      setShortStatus(line);
    };

    try {
      const token = await getToken();
      if (!token) throw new Error("Сначала нажмите «Поймать токен».");
      if (selectedProjects.size === 0) throw new Error("Выберите хотя бы один проект.");

      const dateFrom = document.getElementById("ytDateFrom").value;
      const dateTo = document.getElementById("ytDateTo").value;
      if (!dateFrom || !dateTo) throw new Error("Заполните период.");

      const projectClause = [...selectedProjects].map((p) => `{${p}}`).join(", ");
      const query = `project: ${projectClause} work date: ${dateFrom} .. ${dateTo}`;

      appendLog(`Начинаю загрузку. Проекты: ${[...selectedProjects].join(", ")}. Период: ${dateFrom} .. ${dateTo}.`);
      const items = await fetchAllWorkItems(token, query, appendLog);

      window.ytSetWorkItems(items);

      const mainFrom = document.getElementById("dateFrom");
      const mainTo = document.getElementById("dateTo");
      if (mainFrom) mainFrom.value = dateFrom;
      if (mainTo) mainTo.value = dateTo;

      const finalLine = `Готово: ${items.length} записей загружено. Теперь примените пресет ниже, чтобы построить отчёт.`;
      appendLog(finalLine);
      setShortStatus(finalLine);
    } catch (err) {
      appendLog("Ошибка: " + err.message);
      setShortStatus("Ошибка: " + err.message);
      if (/401|403/.test(err.message)) {
        appendLog("Токен устарел — нажмите «Поймать токен».");
      }
    } finally {
      btn.disabled = false;
    }
  }

  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&(changes.youtrackExplicitConnection?.newValue||changes.youtrackLiveToken?.newValue)&&!document.getElementById('ytCaptureBtn')?.disabled)refreshTokenHint();});
  document.addEventListener("DOMContentLoaded", injectPanel);
})();

// ===== youtrack_presets.js =====
(function () {
  const STORAGE_KEY_PRESETS = "ytPresets";
  let selectedPresetName = null;
  let pendingTeamsJson = null;
  let pendingConfigJson = null;

  window.ytApplyTeamsAndConfig = function (teamsObj, configObj) {
    if (!configObj) applyFieldConfig(null);
    teamsData = teamsObj;
    let parsed;
    try {
      parsed = parseTeamsStructure(teamsData);
    } catch (err) {
      throw new Error("Не удалось разобрать teams.json: " + err.message);
    }

    parsed.flatTeams.forEach((t) => {
      if (t.initialCapacity !== undefined) capacityStore[t.name] = t.initialCapacity;
    });

    const statusTeamsEl = document.getElementById("statusTeams");
    if (statusTeamsEl) {
      statusTeamsEl.textContent = `teams.json (${parsed.projects.length} проект(ов), ${parsed.flatTeams.length} команд)`;
    }

    if (configObj) {
      try {
        applyFieldConfig(configObj);
      } catch (err) {
        throw new Error("Не удалось применить config.json: " + err.message);
      }
      const statusConfigEl = document.getElementById("statusConfig");
      if (statusConfigEl) statusConfigEl.textContent = "config.json применён";
    }
  };

  function getProjectsFromPreset(preset) {
    try {
      const parsed = parseTeamsStructure(preset.teams);
      return parsed.projects || [];
    } catch (err) {
      return [];
    }
  }

  function syncProjectSelection(preset) {
    if (typeof window.ytSelectProjectsByNames !== "function") return;
    window.ytSelectProjectsByNames(preset ? getProjectsFromPreset(preset) : []);
  }

  function injectPanel() {
    if (document.getElementById("ytPresetsPanel")) return;

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.id = "ytPresetsPanel";
    panel.innerHTML = `
      <div class="panel-header-row">
        <h3 style="margin-top:0">Пресеты</h3>
        <div style="display:flex;gap:8px">
          <button type="button" id="ytExportPresetsBtn" class="export-btn">Экспорт всех пресетов</button>
          <label class="export-btn" style="cursor:pointer;margin:0">
            Импорт пресетов
            <input type="file" id="ytImportPresetsFile" accept=".json" hidden>
          </label>
        </div>
      </div>
      <div class="hint">
        Сохраните teams.json (и опционально config.json) один раз под именем — дальше просто выбирайте
        из списка. При выборе пресета проекты из его teams.json автоматически подсветятся в блоке
        «Загрузка work items из YouTrack» выше.
      </div>

      <div class="yt-field" style="margin-top:10px">
        <label>Сохранённые пресеты</label>
        <div id="ytPresetList" class="yt-chip-list">
          <span class="yt-chip-empty">— нет пресетов —</span>
        </div>
      </div>

      <div class="yt-row" style="margin-top:16px">
        <div class="yt-actions" style="margin-left:0">
          <button type="button" id="ytApplyPresetBtn" style="width:auto">Применить пресет и построить отчёт</button>
          <button type="button" id="ytDeletePresetBtn" style="width:auto;background:#fdecec;color:#b92e2e">Удалить</button>
        </div>
      </div>

      <details style="margin-top:10px">
        <summary style="cursor:pointer;font-size:12.5px;color:#6b7280;margin-bottom:10px">
          Создать / обновить пресет
        </summary>

        <div class="field" style="margin-bottom:14px">
          <label>Название пресета</label>
          <input type="text" id="ytPresetName" placeholder="напр. Общий" style="width:280px">
        </div>

        <div class="upload-grid" style="grid-template-columns: 1fr 1fr; margin-bottom:14px">
          <label class="dropzone" for="ytPresetTeamsFile">
            <div class="dropzone-icon"></div>
            <div class="dropzone-title">teams.json</div>
            <div class="dropzone-sub">Нажмите, чтобы выбрать файл</div>
            <input type="file" id="ytPresetTeamsFile" accept=".json,application/json" hidden>
            <div class="status" id="ytPresetTeamsFileStatus"></div>
          </label>
          <label class="dropzone" for="ytPresetConfigFile">
            <div class="dropzone-icon"></div>
            <div class="dropzone-title">config.json</div>
            <div class="dropzone-sub">Необязательно</div>
            <input type="file" id="ytPresetConfigFile" accept=".json,application/json" hidden>
            <div class="status" id="ytPresetConfigFileStatus"></div>
          </label>
        </div>

        <button type="button" id="ytSavePresetBtn" style="width:auto">Сохранить пресет</button>
      </details>

      <div id="ytPresetStatus" class="hint" style="margin-top:10px"></div>
    `;

    const fetchPanel = document.getElementById("ytFetchPanel");
    if (fetchPanel) {
      fetchPanel.insertAdjacentElement("afterend", panel);
    } else {
      const firstPanel = document.querySelector(".panel, .upload-panel");
      if (firstPanel && firstPanel.parentNode) {
        firstPanel.parentNode.insertBefore(panel, firstPanel);
      } else {
        document.body.prepend(panel);
      }
    }

    document.getElementById("ytApplyPresetBtn").addEventListener("click", onApplyClick);
    document.getElementById("ytDeletePresetBtn").addEventListener("click", onDeleteClick);
    document.getElementById("ytSavePresetBtn").addEventListener("click", onSaveClick);
    document.getElementById("ytExportPresetsBtn").addEventListener("click", onExportAllClick);
    document.getElementById("ytImportPresetsFile").addEventListener("change", onImportAllChange);

    document.getElementById("ytPresetTeamsFile").addEventListener("change", (e) =>
      readFileAsJson(e, "teams")
    );
    document.getElementById("ytPresetConfigFile").addEventListener("change", (e) =>
      readFileAsJson(e, "config")
    );

    refreshPresetList();
  }

  function readFileAsJson(event, kind) {
    const statusEl = document.getElementById("ytPresetStatus");
    const dzStatusEl = document.getElementById(
      kind === "teams" ? "ytPresetTeamsFileStatus" : "ytPresetConfigFileStatus"
    );
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (kind === "teams") {
          pendingTeamsJson = parsed;
        } else {
          pendingConfigJson = parsed;
        }
        if (dzStatusEl) dzStatusEl.textContent = file.name;
        statusEl.textContent = `Файл «${file.name}» загружен. Укажите название и нажмите «Сохранить пресет».`;
      } catch (err) {
        if (kind === "teams") pendingTeamsJson = null;
        else pendingConfigJson = null;
        if (dzStatusEl) dzStatusEl.textContent = "";
        statusEl.textContent = `Файл «${file.name}» — невалидный JSON: ${err.message}`;
      }
    };
    reader.onerror = () => {
      statusEl.textContent = `Не удалось прочитать файл «${file.name}».`;
    };
    reader.readAsText(file);
  }

  async function getPresets() {
    const { [STORAGE_KEY_PRESETS]: presets } = await chrome.storage.local.get(STORAGE_KEY_PRESETS);
    return presets || {};
  }

  async function setPresets(presets) {
    await chrome.storage.local.set({ [STORAGE_KEY_PRESETS]: presets });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  async function refreshPresetList(preserveSelection) {
    const presets = await getPresets();
    const names = Object.keys(presets).sort();
    const listEl = document.getElementById("ytPresetList");

    if (!preserveSelection || !names.includes(selectedPresetName)) {
      selectedPresetName = null;
    }

    if (names.length === 0) {
      listEl.innerHTML = `<span class="yt-chip-empty">— нет сохранённых пресетов —</span>`;
      return;
    }

    listEl.innerHTML = names
      .map((n) => {
        const projects = getProjectsFromPreset(presets[n]);
        const label = projects.length ? `${n} → ${projects.join(", ")}` : n;
        const isSelected = n === selectedPresetName ? " selected" : "";
        return `<button type="button" class="yt-chip${isSelected}" data-name="${escapeHtml(n)}">${escapeHtml(label)}</button>`;
      })
      .join("");

    listEl.querySelectorAll(".yt-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const alreadySelected = chip.classList.contains("selected");
        listEl.querySelectorAll(".yt-chip").forEach((c) => c.classList.remove("selected"));
        if (alreadySelected) {
          selectedPresetName = null;
          syncProjectSelection(null);
        } else {
          chip.classList.add("selected");
          selectedPresetName = chip.dataset.name;
          syncProjectSelection(presets[selectedPresetName]);
        }
      });
    });

    if (selectedPresetName) {
      syncProjectSelection(presets[selectedPresetName]);
    }
  }

  async function onApplyClick() {
    const statusEl = document.getElementById("ytPresetStatus");
    if (!selectedPresetName) {
      statusEl.textContent = "Выберите пресет из списка (нажмите на него).";
      return;
    }
    const presets = await getPresets();
    const preset = presets[selectedPresetName];
    if (!preset) {
      statusEl.textContent = "Пресет не найден (возможно, был удалён).";
      return;
    }

    const errorBoxEl = document.getElementById("errorBox");
    if (errorBoxEl) errorBoxEl.textContent = "";

    try {
      window.ytApplyTeamsAndConfig(preset.teams, preset.config || null);
      if (typeof window.processFiles === "function") {
        window.processFiles();
      }
      const errText = document.getElementById("errorBox")?.textContent?.trim();
      statusEl.textContent = errText
        ? `Пресет «${selectedPresetName}» применён, но при построении отчёта есть сообщение: ${errText}`
        : `Пресет «${selectedPresetName}» применён, отчёт построен.`;
    } catch (err) {
      statusEl.textContent = "Ошибка применения пресета: " + err.message;
    }
  }

  async function onDeleteClick() {
    const statusEl = document.getElementById("ytPresetStatus");
    if (!selectedPresetName) {
      statusEl.textContent = "Выберите пресет из списка (нажмите на него).";
      return;
    }
    const nameToDelete = selectedPresetName;
    const presets = await getPresets();
    delete presets[nameToDelete];
    await setPresets(presets);
    selectedPresetName = null;
    await refreshPresetList();
    statusEl.textContent = `Пресет «${nameToDelete}» удалён.`;
  }

  async function onSaveClick() {
    const statusEl = document.getElementById("ytPresetStatus");
    const name = document.getElementById("ytPresetName").value.trim();

    if (!name) {
      statusEl.textContent = "Укажите название пресета.";
      return;
    }
    if (!pendingTeamsJson) {
      statusEl.textContent = "Загрузите файл teams.json.";
      return;
    }

    const presets = await getPresets();
    presets[name] = { teams: pendingTeamsJson, config: pendingConfigJson };
    await setPresets(presets);
    selectedPresetName = name;
    await refreshPresetList(true);
    const projects = getProjectsFromPreset(presets[name]);
    statusEl.textContent = `Пресет «${name}» сохранён${projects.length ? ` (проекты: ${projects.join(", ")})` : ""}.`;

    document.getElementById("ytPresetName").value = "";
    document.getElementById("ytPresetTeamsFileStatus").textContent = "";
    document.getElementById("ytPresetConfigFileStatus").textContent = "";
    document.getElementById("ytPresetTeamsFile").value = "";
    document.getElementById("ytPresetConfigFile").value = "";
    pendingTeamsJson = null;
    pendingConfigJson = null;
  }

  async function onExportAllClick() {
    const statusEl = document.getElementById("ytPresetStatus");
    const presets = await getPresets();
    if (Object.keys(presets).length === 0) {
      statusEl.textContent = "Нет сохранённых пресетов для экспорта.";
      return;
    }
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename: "youtrack_presets_export.json", saveAs: false });
      statusEl.textContent = `Экспортировано пресетов: ${Object.keys(presets).length}.`;
    } catch (err) {
      statusEl.textContent = "Ошибка экспорта: " + err.message;
    }
  }

  function onImportAllChange(event) {
    const statusEl = document.getElementById("ytPresetStatus");
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (typeof imported !== "object" || imported === null || Array.isArray(imported)) {
          throw new Error("Ожидался объект вида { имя_пресета: {teams, config} }.");
        }
        const presets = await getPresets();
        const names = Object.keys(imported);
        names.forEach((n) => {
          presets[n] = imported[n];
        });
        await setPresets(presets);
        await refreshPresetList();
        statusEl.textContent = `Импортировано пресетов: ${names.length} (${names.join(", ")}).`;
      } catch (err) {
        statusEl.textContent = "Ошибка импорта: " + err.message;
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  window.ytGetPresetForProject = async function (projectName) {
    const presets = await getPresets();
    for (const [name, preset] of Object.entries(presets)) {
      if (getProjectsFromPreset(preset).includes(projectName)) return name;
    }
    return null;
  };

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      if (!document.getElementById("ytPresetsPanel")) injectPanel();
    }, 50);
  });
})();


