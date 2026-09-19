(function exposeYouTrackWorkItems(root) {
  "use strict";

  const DEFAULT_CLASSIFICATION = Object.freeze({
    workItemTypes:{development:["Разработка"],meeting:["Встречи/Проектные коммуникации"],overtime:["Оверы. Разработка"]},
    issueType:{fieldName:"Type",business:["Фича"],technical:["Техническая","Техдолг"],bug:["Bug"],works:["Работы"]},
    completion:{fieldName:"Статус",values:["READY FOR RELEASE","CLOSED","DONE"],useResolved:false},
    estimateFieldName:"Оценка разработка",
    labels:{business:"Бизнес",technical:"Техн-кие",bug:"Баги",overtime:"Оверы",meeting:"Встречи/Иное"}
  });

  const scalar = value => Array.isArray(value) && value.length === 1 ? value[0] : value;
  const clean = value => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240);
  const normalized = value => clean(value).toLocaleLowerCase("ru").replace(/\s+/g, "");
  const normalizedList = value => (Array.isArray(value) ? value : value == null ? [] : [value]).map(normalized).filter(Boolean);
  const stableId = value => normalized(value).replace(/[^a-zа-я0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "item";

  function mergeClassification(input = {}) {
    const work = input.workItemTypes || {}, issue = input.issueType || {}, completion = input.completion || {}, labels = input.labels || {};
    return {
      workItemTypes:{
        development:normalizedList(work.development ?? DEFAULT_CLASSIFICATION.workItemTypes.development),
        meeting:normalizedList(work.meeting ?? DEFAULT_CLASSIFICATION.workItemTypes.meeting),
        overtime:normalizedList(work.overtime ?? DEFAULT_CLASSIFICATION.workItemTypes.overtime)
      },
      issueType:{
        fieldName:clean(issue.fieldName || DEFAULT_CLASSIFICATION.issueType.fieldName),
        business:normalizedList(issue.business ?? DEFAULT_CLASSIFICATION.issueType.business),
        technical:normalizedList(issue.technical ?? DEFAULT_CLASSIFICATION.issueType.technical),
        bug:normalizedList(issue.bug ?? DEFAULT_CLASSIFICATION.issueType.bug),
        works:normalizedList(issue.works ?? DEFAULT_CLASSIFICATION.issueType.works)
      },
      completion:{fieldName:clean(completion.fieldName || DEFAULT_CLASSIFICATION.completion.fieldName),values:normalizedList(completion.values ?? DEFAULT_CLASSIFICATION.completion.values),useResolved:completion.useResolved === true},
      estimateFieldName:clean(input.estimateFieldName || DEFAULT_CLASSIFICATION.estimateFieldName),
      labels:{
        business:clean(labels.business || DEFAULT_CLASSIFICATION.labels.business), technical:clean(labels.technical || DEFAULT_CLASSIFICATION.labels.technical),
        bug:clean(labels.bug || DEFAULT_CLASSIFICATION.labels.bug), overtime:clean(labels.overtime || DEFAULT_CLASSIFICATION.labels.overtime), meeting:clean(labels.meeting || DEFAULT_CLASSIFICATION.labels.meeting)
      }
    };
  }

  function parseClosedCondition(value) {
    const text = clean(value), colon = text.indexOf(":");
    if (colon < 1) return null;
    const values = [...text.slice(colon + 1).matchAll(/\{([^}]+)\}/g)].map(match => normalized(match[1])).filter(Boolean);
    return values.length ? {fieldName:clean(text.slice(0, colon)),values} : null;
  }

  function migrateLegacy(teamsData, configData = null) {
    const source = Array.isArray(teamsData)
      ? teamsData
      : teamsData?.teams
        ? [{projectName:"Без проекта",teams:teamsData.teams}]
        : teamsData && typeof teamsData === "object"
          ? Object.entries(teamsData).filter(([, teams]) => Array.isArray(teams)).map(([projectName, teams]) => ({projectName, teams}))
          : [];
    if (!source.length) throw new Error("В teams.json не найдены проекты и команды");
    const teams = [], projects = [];
    for (const project of source.slice(0, 100)) {
      const projectName = clean(project?.projectName || "Без проекта"), projectId = stableId(projectName);
      if (!projects.some(item => item.id === projectId)) projects.push({id:projectId,name:projectName});
      const closed = parseClosedCondition(project?.closed_tasks_condition);
      for (const team of (Array.isArray(project?.teams) ? project.teams : []).slice(0, 200)) {
        const name = clean(team?.name); if (!name) continue;
        const members = [...new Set([...(Array.isArray(team.members) ? team.members : []), team.lead].map(clean).filter(Boolean))].slice(0, 500);
        const capacity = Number(team.capacity_in_hours);
        teams.push({id:`${projectId}-${stableId(name)}`,name,projectId,projectName,members,capacityHours:Number.isFinite(capacity)&&capacity>=0?capacity:null,...(closed?{completion:closed}:{})});
      }
    }
    const cfg = configData && typeof configData === "object" ? configData : {};
    const item = cfg.workItemTypeField || {}, issue = cfg.issueTypeField || {}, status = cfg.statusField || {}, labels = cfg.columnLabels || {};
    const classification = mergeClassification({
      workItemTypes:{development:item.dev,meeting:item.meeting,overtime:item.overs},
      issueType:{fieldName:issue.fieldName,business:issue.values?.feature,technical:issue.values?.tech,bug:issue.values?.bug,works:issue.values?.works},
      ...(cfg.statusField?{completion:{fieldName:status.fieldName,values:status.doneStatuses}}:{}),
      estimateFieldName:cfg.estimateField?.fieldName,
      labels:{business:labels.biz,technical:labels.tech,bug:labels.bug,overtime:labels.overs,meeting:labels.meeting}
    });
    return {schema:1,id:"legacy-import",name:"Импортированный профиль",projects,teams,classification,statusOverridesProjects:Boolean(cfg.statusField),...(cfg.actualField?.fieldName?{actualFieldName:clean(cfg.actualField.fieldName)}:{})};
  }

  function automaticProfile(projects) {
    const safe = (Array.isArray(projects) ? projects : []).filter(project => project && !project.archived).slice(0, 100).map(project => ({id:clean(project.id || project.shortName || project.name),name:clean(project.name || project.shortName)})).filter(project => project.id && project.name);
    return {schema:1,id:"automatic",name:"Автоматически: проект = команда",projects:safe,teams:safe.map(project => ({id:`project-${stableId(project.id)}`,name:project.name,projectId:project.id,projectName:project.name,members:[],capacityHours:null,automatic:true})),classification:mergeClassification()};
  }

  function fieldRecord(issue, fieldName) {
    const target = normalized(fieldName);
    return (Array.isArray(issue?.customFields) ? issue.customFields : []).find(field => normalized(field?.name) === target) || null;
  }

  function fieldValue(issue, fieldName) {
    const value = fieldRecord(issue, fieldName)?.value;
    if (Array.isArray(value)) return value.map(item => clean(item?.name ?? item?.presentation ?? item)).filter(Boolean).join(", ");
    return clean(value?.name ?? value?.presentation ?? value);
  }

  function hoursOf(value) {
    const current = scalar(value);
    if (typeof current === "number" && Number.isFinite(current)) return current / 60;
    if (current && typeof current === "object") {
      if (Number.isFinite(Number(current.minutes))) return Number(current.minutes) / 60;
      return hoursOf(current.presentation);
    }
    const text = clean(current); if (!text) return null;
    if (/^\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(",", ".")) / 60;
    let total = 0, found = false;
    for (const [pattern, multiplier] of [[/(\d+)\s*w/ig,40],[/(\d+)\s*d/ig,8],[/(\d+)\s*h/ig,1],[/(\d+)\s*m/ig,1/60]]) {
      for (const match of text.matchAll(pattern)) { total += Number(match[1]) * multiplier; found = true; }
    }
    return found ? total : null;
  }

  function blankStats() {
    return {business:0,technical:0,bug:0,overtime:0,meeting:0,featureIssueIds:new Set(),details:{business:[],technical:[],bug:[],overtime:[],meeting:[],closed:[],estimate:[]},closedByIssue:new Map(),estimateTotal:0,estimateHits:0,estimateRatioSum:0,detailsTruncated:0};
  }

  function dateValue(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function safeTeam(team) {
    const memberNames=[...new Set((team.members||[]).map(clean).filter(Boolean))];
    return {id:clean(team.id),name:clean(team.name),projectId:clean(team.projectId),projectName:clean(team.projectName),members:new Set(memberNames.map(normalized)),memberNames,capacityHours:Number.isFinite(Number(team.capacityHours))?Math.max(0,Number(team.capacityHours)):null,automatic:team.automatic===true,completion:team.completion||null,stats:blankStats(),memberStats:new Map()};
  }

  function createAccumulator(profileInput) {
    const sensorModule=root.YouTrackSensorAnalysis||(typeof require==='function'?require('./youtrack-sensor-analysis.js'):null);
    const sensor=sensorModule?.createCollector();
    const profile = profileInput && typeof profileInput === "object" ? profileInput : automaticProfile([]);
    const classification = mergeClassification(profile.classification);
    const teams = (Array.isArray(profile.teams) ? profile.teams : []).map(safeTeam);
    const seen = new Set(), unmatched = new Map(), issueFacts = new Map();
    let issueFactsSeeded = false;
    let scanned = 0, accepted = 0, duplicates = 0;
    const diagnostics = {rawHours:0,classifiedHours:0,unmatchedHours:0,unclassifiedHours:0,duplicateHours:0,invalidDuration:0,invalidDate:0,missingAuthor:0,missingProject:0,missingType:0};

    const statFor = (team, author) => {
      if (!team.memberStats.has(author)) team.memberStats.set(author, blankStats());
      return [team.stats, team.memberStats.get(author)];
    };
    const teamFor = (project, author) => {
      const keys = new Set([project?.id,project?.shortName,project?.name].map(normalized).filter(Boolean));
      const candidates = teams.filter(team => keys.has(normalized(team.projectId)) || keys.has(normalized(team.projectName)));
      const exact = candidates.filter(team => team.members.has(normalized(author)));
      if (exact.length === 1) return exact[0];
      if (candidates.length === 1 && candidates[0].automatic) return candidates[0];
      const memberMatches = teams.filter(team => team.members.has(normalized(author)));
      return memberMatches.length === 1 ? memberMatches[0] : null;
    };
    const classify = (item, issue) => {
      const work = normalized(item?.type?.name), issueType = normalized(fieldValue(issue, classification.issueType.fieldName));
      if (classification.workItemTypes.overtime.includes(work)) return "overtime";
      if (classification.workItemTypes.meeting.includes(work) && classification.issueType.works.includes(issueType)) return "meeting";
      if (!classification.workItemTypes.development.includes(work)) return null;
      if (classification.issueType.business.includes(issueType)) return "business";
      if (classification.issueType.technical.includes(issueType)) return "technical";
      if (classification.issueType.bug.includes(issueType)) return "bug";
      return null;
    };
    const completionRule = team => profile.statusOverridesProjects ? classification.completion : team.completion || classification.completion;
    const isClosed = (team, issue) => {
      const rule = completionRule(team);
      const field = fieldRecord(issue, rule.fieldName), value = normalized(fieldValue(issue, rule.fieldName));
      if (rule.useResolved && field?.value && !Array.isArray(field.value) && field.value.isResolved === true) return true;
      return rule.values.includes(value);
    };

    const collectIssueFact = item => {
      const issue=item?.issue||{},issueId=clean(issue.id);
      if(!issueId||!classification.workItemTypes.development.includes(normalized(item?.type?.name)))return;
      const author=clean(item?.author?.login||item?.author?.id||"unknown"),minutes=Number(item?.duration?.minutes),hours=Number.isFinite(minutes)?minutes/60:0;
      const fact=issueFacts.get(issueId)||{estimate:hoursOf(fieldRecord(issue,classification.estimateFieldName)?.value),actualByAuthor:new Map()};
      fact.actualByAuthor.set(author,(fact.actualByAuthor.get(author)||0)+hours);issueFacts.set(issueId,fact);
    };

    function seedIssueFacts(items) {
      if(!Array.isArray(items)||scanned>0)throw new Error("Estimate facts must be seeded before report rows");
      issueFacts.clear();for(const item of items)collectIssueFact(item);issueFactsSeeded=true;
    }

    function addPage(items) {
      if (!Array.isArray(items) || items.length > 500) throw new Error("Некорректная страница work items");
      for (const item of items) {
        scanned++;
        const rawMinutes = Number(item?.duration?.minutes), validDuration = Number.isFinite(rawMinutes) && rawMinutes >= 0;
        const hours = validDuration ? rawMinutes / 60 : 0;
        diagnostics.rawHours += hours;
        if (!validDuration) diagnostics.invalidDuration++;
        if (dateValue(item?.date) == null) diagnostics.invalidDate++;
        if (!clean(item?.author?.login || item?.author?.id)) diagnostics.missingAuthor++;
        if (!clean(item?.issue?.project?.name || item?.issue?.project?.id)) diagnostics.missingProject++;
        if (!clean(item?.type?.name)) diagnostics.missingType++;
        const id = clean(item?.id);
        if (id && seen.has(id)) { duplicates++; diagnostics.duplicateHours += hours; continue; }
        if (id) seen.add(id);
        const issue = item?.issue || {}, author = clean(item?.author?.login || item?.author?.id || "unknown"), team = teamFor(issue.project, author);
        const sensorStatus=fieldValue(issue,completionRule(team||{}).fieldName);
        sensor?.add({minutes:item?.duration?.minutes!=null&&item.duration.minutes!==''?Number(item.duration.minutes):NaN,date:item?.date,project:issue.project?.name||issue.project?.id,issue:issue.idReadable||issue.id,issueId:issue.id,author,teamId:team?.id,teamName:team?.name,category:classify(item,issue),development:classification.workItemTypes.development.includes(normalized(item?.type?.name)),estimate:hoursOf(fieldRecord(issue,classification.estimateFieldName)?.value),closed:sensorStatus?isClosed(team||{},issue):null,status:sensorStatus});
        if (!team) { const key=`${clean(issue?.project?.name||"Без проекта")}\u0000${author}`; unmatched.set(key,(unmatched.get(key)||0)+hours); diagnostics.unmatchedHours += hours; continue; }
        accepted++;
        const category = classify(item, issue), issueId = clean(issue.id), issueReadable = clean(issue.idReadable || issue.id || "—"), date = dateValue(item.date);
        const detail = {issue:issueReadable,author,date,hours};
        const stats = statFor(team, author);
        if (category) { diagnostics.classifiedHours += hours; for (const target of stats) { target[category] += hours; if (target.details[category].length < 5000) target.details[category].push(detail); else target.detailsTruncated++; } }
        else diagnostics.unclassifiedHours += hours;
        if (!issueFactsSeeded) collectIssueFact(item);
        if (category === "business" && issueId && isClosed(team, issue)) {
          for (const target of stats) {
            let entry = target.closedByIssue.get(issueId);
            if (!entry) { entry={issueId,issue:issueReadable,status:fieldValue(issue,completionRule(team).fieldName),authors:new Set()}; target.closedByIssue.set(issueId,entry); }
            entry.authors.add(author); target.featureIssueIds.add(issueId);
          }
        }
      }
      return {scanned,accepted,duplicates};
    }

    const finalizeStats = stats => {
      for (const entry of stats.closedByIssue.values()) {
        const fact = issueFacts.get(entry.issueId), estimate = fact?.estimate;
        const actual = [...entry.authors].reduce((sum, author) => sum + (fact?.actualByAuthor.get(author) || 0), 0);
        stats.details.closed.push({issue:entry.issue,status:entry.status,authors:[...entry.authors],hours:actual});
        if (Number.isFinite(estimate) && estimate > 0) {
          const ratioPct = actual / estimate * 100; stats.estimateTotal++; stats.estimateRatioSum += ratioPct; if (actual <= estimate) stats.estimateHits++;
          stats.details.estimate.push({issue:entry.issue,authors:[...entry.authors],estimate,actual,ratioPct});
        }
      }
      return {business:stats.business,technical:stats.technical,bug:stats.bug,overtime:stats.overtime,meeting:stats.meeting,closedFeatures:stats.featureIssueIds.size,estimateTotal:stats.estimateTotal,estimateHits:stats.estimateHits,estimateAveragePct:stats.estimateTotal?stats.estimateRatioSum/stats.estimateTotal:null,details:stats.details,detailsTruncated:stats.detailsTruncated};
    };
    function finish() {
      return {schema:1,sensorData:sensor?.finish(),profile:{id:clean(profile.id),name:clean(profile.name),labels:classification.labels},scanned,accepted,duplicates,diagnostics,unmatched:[...unmatched].map(([key,hours])=>{const [project,author]=key.split("\u0000");return {project,author,hours};}),teams:teams.map(team=>{
        const members=new Map(team.memberNames.map(login=>[normalized(login),{login,stats:blankStats()}]));
        for(const [login,stats]of team.memberStats)members.set(normalized(login),{login,stats});
        return {id:team.id,name:team.name,projectId:team.projectId,projectName:team.projectName,capacityHours:team.capacityHours,stats:finalizeStats(team.stats),members:[...members.values()].map(member=>({login:member.login,stats:finalizeStats(member.stats)})).sort((a,b)=>a.login.localeCompare(b.login,"ru"))};
      })};
    }
    return Object.freeze({addPage,seedIssueFacts,finish});
  }

  const api = Object.freeze({DEFAULT_CLASSIFICATION,mergeClassification,migrateLegacy,automaticProfile,fieldValue,hoursOf,createAccumulator});
  root.YouTrackWorkItems = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
