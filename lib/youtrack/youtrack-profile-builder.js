(function exposeYouTrackProfileBuilder(root) {
  "use strict";

  const LIMITS = Object.freeze({ bytes:1024 * 1024, projects:100, teamsPerProject:200, membersPerTeam:500, text:240 });
  const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const clean = value => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, LIMITS.text);
  const list = value => (Array.isArray(value) ? value : value == null ? [] : [value]).map(clean).filter(Boolean).slice(0, 500);
  const unique = values => [...new Set(values)];

  function assertSafeTree(value, depth = 0, budget = { nodes:0 }) {
    if (depth > 12 || ++budget.nodes > 25000) throw new Error("JSON слишком сложный");
    if (!value || typeof value !== "object") return;
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`Недопустимое поле: ${key}`);
      assertSafeTree(value[key], depth + 1, budget);
    }
  }

  function parseJsonText(text, maxBytes = LIMITS.bytes) {
    const source = String(text ?? "");
    if (new TextEncoder().encode(source).length > maxBytes) throw new Error("JSON-файл слишком большой");
    let value;
    try { value = JSON.parse(source); } catch { throw new Error("JSON содержит синтаксическую ошибку"); }
    assertSafeTree(value);
    return value;
  }

  function normalizeTeams(input) {
    assertSafeTree(input);
    const source = Array.isArray(input)
      ? input
      : Array.isArray(input?.teams)
        ? [{ projectName:clean(input.projectName || "Без проекта"), teams:input.teams }]
      : input && typeof input === "object"
        ? Object.entries(input).filter(([, teams]) => Array.isArray(teams)).map(([projectName, teams]) => ({ projectName, teams }))
        : [];
    if (!source.length) throw new Error("Добавьте хотя бы один проект");
    if (source.length > LIMITS.projects) throw new Error(`Допустимо не больше ${LIMITS.projects} проектов`);
    const projects = source.map((project, projectIndex) => {
      const projectName = clean(project?.projectName);
      if (!projectName) throw new Error(`У проекта ${projectIndex + 1} нет названия`);
      const condition = clean(project?.closed_tasks_condition);
      if (condition && !/^[^:]+:\s*\{[^{}]+\}(?:\s*,?\s*\{[^{}]+\})*$/.test(condition)) throw new Error(`Некорректное условие закрытия проекта «${projectName}»`);
      const rawTeams = Array.isArray(project?.teams) ? project.teams : [];
      if (!rawTeams.length) throw new Error(`В проекте «${projectName}» нет команд`);
      if (rawTeams.length > LIMITS.teamsPerProject) throw new Error(`В проекте «${projectName}» больше ${LIMITS.teamsPerProject} команд`);
      const teams = rawTeams.map((team, teamIndex) => {
        const name = clean(team?.name);
        if (!name) throw new Error(`У команды ${teamIndex + 1} проекта «${projectName}» нет названия`);
        const lead = clean(team?.lead);
        const members = unique(list(team?.members).filter(member => member !== lead));
        if (members.length + (lead ? 1 : 0) > LIMITS.membersPerTeam) throw new Error(`В команде «${name}» больше ${LIMITS.membersPerTeam} участников`);
        const rawCapacity = team?.capacity_in_hours ?? team?.capacityHours;
        const capacity = rawCapacity === "" || rawCapacity == null ? null : Number(rawCapacity);
        if (capacity !== null && (!Number.isFinite(capacity) || capacity < 0 || capacity > 100000)) throw new Error(`Некорректная ёмкость команды «${name}»`);
        return { name, capacity_in_hours:capacity, lead, members };
      });
      const teamNames=new Set();for(const team of teams){const key=team.name.toLocaleLowerCase("ru");if(teamNames.has(key))throw new Error(`Команда «${team.name}» повторяется в проекте «${projectName}»`);teamNames.add(key);}
      return { projectName, closed_tasks_condition:condition, teams };
    });
    const seen = new Set();
    for (const project of projects) {
      const key = project.projectName.toLocaleLowerCase("ru");
      if (seen.has(key)) throw new Error(`Проект «${project.projectName}» повторяется`);
      seen.add(key);
    }
    return projects;
  }

  function serializeTeams(projects) {
    return normalizeTeams(projects).map(project => ({
      projectName:project.projectName,
      ...(project.closed_tasks_condition ? { closed_tasks_condition:project.closed_tasks_condition } : {}),
      teams:project.teams.map(team => ({
        name:team.name,
        ...(team.capacity_in_hours !== null ? { capacity_in_hours:team.capacity_in_hours } : {}),
        ...(team.lead ? { lead:team.lead } : {}),
        members:team.members
      }))
    }));
  }

  function normalizeConfig(input = {}) {
    assertSafeTree(input);
    const work = input.workItemTypeField || {}, issue = input.issueTypeField || {}, status = input.statusField || {}, estimate = input.estimateField || {}, labels = input.columnLabels || {};
    const value = {
      workItemTypeField:{ dev:unique(list(work.dev)), meeting:unique(list(work.meeting)), overs:unique(list(work.overs)) },
      issueTypeField:{ fieldName:clean(issue.fieldName || "Type"), values:{ feature:unique(list(issue.values?.feature)), tech:unique(list(issue.values?.tech)), bug:unique(list(issue.values?.bug)), works:unique(list(issue.values?.works)) } },
      statusField:{ fieldName:clean(status.fieldName || "Статус"), doneStatuses:unique(list(status.doneStatuses)) },
      estimateField:{ fieldName:clean(estimate.fieldName || "Оценка разработка") },
      columnLabels:{ biz:clean(labels.biz || "Бизнес"), tech:clean(labels.tech || "Техн-кие"), bug:clean(labels.bug || "Баги"), overs:clean(labels.overs || "Оверы"), meeting:clean(labels.meeting || "Встречи/Иное") }
    };
    if (!value.workItemTypeField.dev.length) throw new Error("Укажите хотя бы один тип списания для разработки");
    if (!value.issueTypeField.fieldName) throw new Error("Укажите поле типа задачи");
    if (!value.statusField.fieldName || !value.statusField.doneStatuses.length) throw new Error("Укажите поле и значения завершённого статуса");
    return value;
  }

  const api = Object.freeze({ LIMITS, parseJsonText, normalizeTeams, serializeTeams, normalizeConfig });
  root.YouTrackProfileBuilder = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
