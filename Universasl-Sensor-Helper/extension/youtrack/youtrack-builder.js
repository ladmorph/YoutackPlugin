(() => {
  "use strict";

  const Builder = globalThis.YouTrackProfileBuilder;
  if (!Builder) return;
  const $ = selector => document.querySelector(selector);
  const ui = {
    panel:$("#json-builder-panel"), projects:$("#builder-projects"), rules:$("#builder-rules"), status:$("#builder-status"), preview:$("#builder-preview"), error:$("#builder-error"),
    addProject:$("#builder-add-project"), importTeams:$("#builder-import-teams"), teamsFile:$("#builder-teams-file"), importConfig:$("#builder-import-config"), configFile:$("#builder-config-file"),
    validate:$("#builder-validate"), apply:$("#builder-apply"), downloadTeams:$("#builder-download-teams"), downloadConfig:$("#builder-download-config"), onboarding:$("#start-builder-onboarding")
  };
  if (!ui.panel) return;

  const DEFAULT_TEAMS = [{ projectName:"Новый проект", closed_tasks_condition:"Статус: {DONE}", teams:[{ name:"Команда", capacity_in_hours:null, lead:"", members:[] }] }];
  const DEFAULT_CONFIG = {
    workItemTypeField:{ dev:["Разработка"], meeting:["Встречи/Проектные коммуникации"], overs:["Оверы. Разработка"] },
    issueTypeField:{ fieldName:"Type", values:{ feature:["Фича"], tech:["Техническая","Техдолг"], bug:["Bug"], works:["Работы"] } },
    statusField:{ fieldName:"Статус", doneStatuses:["READY FOR RELEASE","CLOSED","DONE"] },
    estimateField:{ fieldName:"Оценка разработка" },
    columnLabels:{ biz:"Бизнес", tech:"Техн-кие", bug:"Баги", overs:"Оверы", meeting:"Встречи/Иное" }
  };
  const RULE_FIELDS = [
    ["work.dev","Типы списаний · разработка"],["work.meeting","Типы списаний · встречи"],["work.overs","Типы списаний · оверы"],
    ["issue.field","Поле типа задачи"],["issue.feature","Бизнесовые типы"],["issue.tech","Технические типы"],["issue.bug","Баги"],["issue.works","Тип задачи для встреч"],
    ["status.field","Поле статуса"],["status.done","Завершённые статусы"],["estimate.field","Поле оценки"],
    ["labels.biz","Заголовок · бизнес"],["labels.tech","Заголовок · тех"],["labels.bug","Заголовок · баги"],["labels.overs","Заголовок · оверы"],["labels.meeting","Заголовок · встречи"]
  ];
  let teams = structuredClone(DEFAULT_TEAMS), config = structuredClone(DEFAULT_CONFIG), previewKind="teams", validated=null, guide=null, dirty=false;

  function split(value) { return String(value || "").split(/[,;\n]/).map(item => item.trim()).filter(Boolean); }
  function field(labelText, value, options={}) {
    const label=document.createElement("label"),caption=document.createElement("span"),input=options.multiline?document.createElement("textarea"):document.createElement("input");
    caption.textContent=labelText;input.value=value ?? "";if(options.type)input.type=options.type;if(options.placeholder)input.placeholder=options.placeholder;
    label.append(caption,input);return {label,input};
  }
  function button(textValue,className="") { const node=document.createElement("button");node.type="button";node.textContent=textValue;if(className)node.className=className;return node; }
  function markDirty() { dirty=true;validated=null;ui.status.textContent="Есть непроверенные изменения";ui.status.className="builder-status pending";ui.apply.disabled=true;refreshPreview(false); }
  function showError(message) { ui.error.textContent=String(message || "Ошибка");ui.error.hidden=false;ui.status.textContent="Нужны исправления";ui.status.className="builder-status invalid"; }
  function clearError() { ui.error.textContent="";ui.error.hidden=true; }

  function renderTeams() {
    ui.projects.replaceChildren();
    teams.forEach((project,projectIndex) => {
      const card=document.createElement("article");card.className="builder-project";
      const header=document.createElement("div");header.className="builder-project-head";
      const title=document.createElement("strong");title.textContent=project.projectName || `Проект ${projectIndex + 1}`;
      const remove=button("Удалить проект","danger-link");remove.disabled=teams.length===1;remove.addEventListener("click",()=>{teams.splice(projectIndex,1);renderTeams();markDirty();});header.append(title,remove);
      const projectGrid=document.createElement("div");projectGrid.className="builder-project-fields";
      const projectName=field("Название проекта",project.projectName),closed=field("Условие закрытия",project.closed_tasks_condition,{placeholder:"Статус: {DONE}, {CLOSED}"});
      projectName.input.maxLength=240;closed.input.maxLength=240;
      projectName.input.addEventListener("input",()=>{project.projectName=projectName.input.value;title.textContent=project.projectName || `Проект ${projectIndex + 1}`;markDirty();});
      closed.input.addEventListener("input",()=>{project.closed_tasks_condition=closed.input.value;markDirty();});projectGrid.append(projectName.label,closed.label);
      const list=document.createElement("div");list.className="builder-team-list";
      project.teams.forEach((team,teamIndex)=>list.append(renderTeam(project,team,projectIndex,teamIndex)));
      const add=button("+ Добавить команду","quiet builder-add-team");add.addEventListener("click",()=>{if(project.teams.length>=Builder.LIMITS.teamsPerProject)return showError("Достигнут лимит команд");project.teams.push({name:"Новая команда",capacity_in_hours:null,lead:"",members:[]});renderTeams();markDirty();});
      card.append(header,projectGrid,list,add);ui.projects.append(card);
    });
  }

  function renderTeam(project,team,projectIndex,teamIndex) {
    const row=document.createElement("section");row.className="builder-team";
    const head=document.createElement("div");head.className="builder-team-head";const title=document.createElement("b");title.textContent=team.name || `Команда ${teamIndex + 1}`;
    const remove=button("Удалить","danger-link");remove.disabled=project.teams.length===1;remove.addEventListener("click",()=>{project.teams.splice(teamIndex,1);renderTeams();markDirty();});head.append(title,remove);
    const grid=document.createElement("div");grid.className="builder-team-fields";
    const name=field("Название",team.name),capacity=field("Ёмкость, ч",team.capacity_in_hours ?? "",{type:"number",placeholder:"не задана"}),lead=field("Тимлид",team.lead,{placeholder:"login"}),members=field("Участники",(team.members||[]).join("\n"),{multiline:true,placeholder:"по одному login на строку"});
    name.input.maxLength=240;capacity.input.min="0";capacity.input.max="100000";capacity.input.step="0.5";lead.input.maxLength=240;members.input.maxLength=120000;
    name.input.addEventListener("input",()=>{team.name=name.input.value;title.textContent=team.name||`Команда ${teamIndex+1}`;markDirty();});
    capacity.input.addEventListener("input",()=>{team.capacity_in_hours=capacity.input.value;markDirty();});lead.input.addEventListener("input",()=>{team.lead=lead.input.value;markDirty();});members.input.addEventListener("input",()=>{team.members=split(members.input.value);markDirty();});
    grid.append(name.label,capacity.label,lead.label,members.label);row.append(head,grid);return row;
  }

  function configValue(key) {
    const values={
      "work.dev":config.workItemTypeField.dev,"work.meeting":config.workItemTypeField.meeting,"work.overs":config.workItemTypeField.overs,
      "issue.field":config.issueTypeField.fieldName,"issue.feature":config.issueTypeField.values.feature,"issue.tech":config.issueTypeField.values.tech,"issue.bug":config.issueTypeField.values.bug,"issue.works":config.issueTypeField.values.works,
      "status.field":config.statusField.fieldName,"status.done":config.statusField.doneStatuses,"estimate.field":config.estimateField.fieldName,
      "labels.biz":config.columnLabels.biz,"labels.tech":config.columnLabels.tech,"labels.bug":config.columnLabels.bug,"labels.overs":config.columnLabels.overs,"labels.meeting":config.columnLabels.meeting
    };return Array.isArray(values[key])?values[key].join(", "):values[key];
  }
  function setConfigValue(key,value) {
    const valueOrList=["work.dev","work.meeting","work.overs","issue.feature","issue.tech","issue.bug","issue.works","status.done"].includes(key)?split(value):value;
    const paths={"work.dev":["workItemTypeField","dev"],"work.meeting":["workItemTypeField","meeting"],"work.overs":["workItemTypeField","overs"],"issue.field":["issueTypeField","fieldName"],"issue.feature":["issueTypeField","values","feature"],"issue.tech":["issueTypeField","values","tech"],"issue.bug":["issueTypeField","values","bug"],"issue.works":["issueTypeField","values","works"],"status.field":["statusField","fieldName"],"status.done":["statusField","doneStatuses"],"estimate.field":["estimateField","fieldName"],"labels.biz":["columnLabels","biz"],"labels.tech":["columnLabels","tech"],"labels.bug":["columnLabels","bug"],"labels.overs":["columnLabels","overs"],"labels.meeting":["columnLabels","meeting"]};
    const path=paths[key];let target=config;for(let i=0;i<path.length-1;i++)target=target[path[i]];target[path.at(-1)]=valueOrList;markDirty();
  }
  function renderRules() { ui.rules.replaceChildren();for(const [key,labelText]of RULE_FIELDS){const control=field(labelText,configValue(key),{multiline:Array.isArray(configValue(key))});control.input.maxLength=4000;control.input.dataset.rule=key;control.input.addEventListener("input",()=>setConfigValue(key,control.input.value));ui.rules.append(control.label);} }

  function getValidated() {
    const safeTeams=Builder.serializeTeams(teams),safeConfig=Builder.normalizeConfig(config);validated={teams:safeTeams,config:safeConfig};return validated;
  }
  function refreshPreview(validate=true) {
    try { clearError();if(validate)getValidated();const value=validated?.[previewKind] || (previewKind==="teams"?teams:config);ui.preview.textContent=JSON.stringify(value,null,2);if(validate){ui.status.textContent=`Проверено · ${validated.teams.length} проектов`;ui.status.className="builder-status valid";ui.apply.disabled=false;}return true; }
    catch(error){showError(error.message);ui.preview.textContent="Исправьте отмеченные данные и повторите проверку.";ui.apply.disabled=true;return false;}
  }
  function download(kind) { if(!refreshPreview(true))return;const blob=new Blob([JSON.stringify(validated[kind],null,2),"\n"],{type:"application/json;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`${kind}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  async function importFile(file,kind) {
    clearError();try{if(!file)return;if(file.size>Builder.LIMITS.bytes)throw new Error("JSON-файл слишком большой");const parsed=Builder.parseJsonText(await file.text());if(kind==="teams"){teams=Builder.normalizeTeams(parsed);renderTeams();}else{config=Builder.normalizeConfig(parsed);renderRules();}markDirty();refreshPreview(true);}
    catch(error){showError(error.message);}finally{(kind==="teams"?ui.teamsFile:ui.configFile).value="";}
  }
  function configFromClassification(c) {
    if(!c)return structuredClone(DEFAULT_CONFIG);
    return {workItemTypeField:{dev:c.workItemTypes?.development||[],meeting:c.workItemTypes?.meeting||[],overs:c.workItemTypes?.overtime||[]},issueTypeField:{fieldName:c.issueType?.fieldName||"Type",values:{feature:c.issueType?.business||[],tech:c.issueType?.technical||[],bug:c.issueType?.bug||[],works:c.issueType?.works||[]}},statusField:{fieldName:c.completion?.fieldName||"Статус",doneStatuses:c.completion?.values||[]},estimateField:{fieldName:c.estimateFieldName||"Оценка разработка"},columnLabels:{biz:c.labels?.business||"Бизнес",tech:c.labels?.technical||"Техн-кие",bug:c.labels?.bug||"Баги",overs:c.labels?.overtime||"Оверы",meeting:c.labels?.meeting||"Встречи/Иное"}};
  }
  function teamsFromProfile(profile) {
    if(!profile?.teams?.length)return structuredClone(DEFAULT_TEAMS);return (profile.projects||[]).map(project=>{const current=profile.teams.filter(team=>team.projectId===project.id||team.projectName===project.name),completion=current.find(team=>team.completion)?.completion;return {projectName:project.name,closed_tasks_condition:completion?`${completion.fieldName}: ${completion.values.map(value=>`{${value}}`).join(", ")}`:"",teams:current.map(team=>({name:team.name,capacity_in_hours:team.capacityHours,lead:"",members:team.members||[]}))};}).filter(project=>project.teams.length);
  }

  function closeGuide(){guide?.remove();guide=null;document.querySelectorAll(".builder-guide-target").forEach(node=>node.classList.remove("builder-guide-target"));}
  function startGuide(){
    closeGuide();const steps=[{target:"#builder-teams-section",title:"Команды",text:"Добавь проекты и команды, укажи логины и ёмкость. Условие закрытия записывается в формате «Статус: {DONE}»."},{target:"#builder-rules-section",title:"Правила",text:"Настрой типы списаний, задачи, статусы и названия колонок. Эти правила совместимы со старым config.json."},{target:"#builder-preview-section",title:"Проверка",text:"Сначала проверь черновик. Затем скачай JSON или явно примени его к текущему отчёту."}];let index=0,sensor;
    guide=document.createElement("aside");guide.className="builder-guide";const figure=document.createElement("div");figure.className="builder-guide-sensor";const bubble=document.createElement("div");bubble.className="builder-guide-bubble";const title=document.createElement("strong"),copy=document.createElement("p"),controls=document.createElement("div");controls.className="builder-guide-controls";const back=button("Назад"),next=button("Дальше","primary"),close=button("Закрыть","quiet");controls.append(back,next,close);bubble.append(title,copy,controls);guide.append(figure,bubble);document.body.append(guide);
    if(globalThis.SensorMascot){sensor=SensorMascot.mount(figure,{baseUrl:chrome.runtime.getURL("extension/graylog/living-signal-mascot.png"),waveUrl:chrome.runtime.getURL("extension/graylog/living-signal-mascot-wave.png")});sensor.setIntro("final");sensor.setState("analysis");sensor.setScene("point");}
    function show(nextIndex){document.querySelectorAll(".builder-guide-target").forEach(node=>node.classList.remove("builder-guide-target"));index=nextIndex;const target=$(steps[index].target);target.classList.add("builder-guide-target");target.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"center"});title.textContent=steps[index].title;copy.textContent=steps[index].text;back.disabled=index===0;next.textContent=index===steps.length-1?"Готово":"Дальше";guide.classList.remove("arrive");requestAnimationFrame(()=>guide.classList.add("arrive"));}
    back.addEventListener("click",()=>show(Math.max(0,index-1)));next.addEventListener("click",()=>index===steps.length-1?(sensor?.dispose(),closeGuide()):show(index+1));close.addEventListener("click",()=>{sensor?.dispose();closeGuide();});show(0);
  }

  ui.addProject.addEventListener("click",()=>{if(teams.length>=Builder.LIMITS.projects)return showError("Достигнут лимит проектов");teams.push({projectName:"Новый проект",closed_tasks_condition:"Статус: {DONE}",teams:[{name:"Команда",capacity_in_hours:null,lead:"",members:[]}]});renderTeams();markDirty();});
  ui.importTeams.addEventListener("click",()=>ui.teamsFile.click());ui.teamsFile.addEventListener("change",()=>importFile(ui.teamsFile.files?.[0],"teams"));
  ui.importConfig.addEventListener("click",()=>ui.configFile.click());ui.configFile.addEventListener("change",()=>importFile(ui.configFile.files?.[0],"config"));
  ui.validate.addEventListener("click",()=>refreshPreview(true));ui.downloadTeams.addEventListener("click",()=>download("teams"));ui.downloadConfig.addEventListener("click",()=>download("config"));
  ui.apply.addEventListener("click",()=>{if(!refreshPreview(true))return;ui.apply.disabled=true;ui.status.textContent="Применяю профиль…";document.dispatchEvent(new CustomEvent("youtrack-profile-builder-apply",{detail:structuredClone(validated)}));});
  document.addEventListener("youtrack-profile-builder-applied",()=>{dirty=false;ui.apply.disabled=false;ui.status.textContent="Применено к отчёту";ui.status.className="builder-status valid";});
  document.addEventListener("youtrack-profile-builder-rejected",event=>{ui.apply.disabled=false;showError(event.detail?.message||"Не удалось применить профиль");});
  document.querySelector(".builder-preview-tabs")?.addEventListener("click",event=>{const control=event.target.closest("[data-builder-preview]");if(!control)return;previewKind=control.dataset.builderPreview;document.querySelectorAll("[data-builder-preview]").forEach(node=>node.classList.toggle("active",node===control));refreshPreview(Boolean(validated));});
  ui.onboarding.addEventListener("click",startGuide);
  document.addEventListener("youtrack-view-changed",event=>{if(event.detail?.view!=="builder")closeGuide();});
  document.addEventListener("youtrack-folder-changed",()=>{dirty=false;teams=structuredClone(DEFAULT_TEAMS);config=structuredClone(DEFAULT_CONFIG);loadStoredProfile().catch(()=>{});});

  async function loadStoredProfile(){const stored=await chrome.storage.local.get("youtrackReportProfile"),existing=stored.youtrackReportProfile;if(existing?.builderSource){teams=Builder.normalizeTeams(existing.builderSource.teams);config=Builder.normalizeConfig(existing.builderSource.config);}else if(existing?.teams?.length){teams=teamsFromProfile(existing);config=configFromClassification(existing.classification);}renderTeams();renderRules();refreshPreview(true);dirty=false;}
  $("#tab-builder")?.addEventListener("click",()=>{if(!dirty)loadStoredProfile().catch(()=>{});});
  loadStoredProfile().catch(()=>{renderTeams();renderRules();refreshPreview(true);});
})();
