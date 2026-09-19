(() => {
  "use strict";
  const DB = "youtrack-plus-folders";
  let root=null, selected="", configured=false;
  async function stored(value) {
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore("settings");req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    try{return await new Promise((resolve,reject)=>{const tx=db.transaction("settings",value===undefined?"readonly":"readwrite"),store=tx.objectStore("settings");const req=value===undefined?store.get("root"):store.put(value,"root");tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
  }
  const remember=()=>stored({handle:root,selected});
  function projectName(value) {
    const name=String(value||"").trim();
    if(!name||name.length>100||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^\./.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error("Укажите имя папки до 100 символов без служебных знаков и точек в конце.");
    return name;
  }
  async function granted(mode="read") { return Boolean(root)&&await root.queryPermission({mode})==="granted"; }
  async function restore() {
    const entry=await stored();configured=Boolean(entry?.handle);root=entry?.handle||null;selected=entry?.selected||"";
    return {configured,granted:await granted()};
  }
  async function choose() {
    const parent=await showDirectoryPicker({id:"youtrack-plus",mode:"readwrite"});
    const next=parent.name==="YouTrackPlus"?parent:await parent.getDirectoryHandle("YouTrackPlus",{create:true});
    root=next;selected="";configured=true;await remember();return list();
  }
  async function reconnect() {
    if(!root)return choose();
    if(await root.requestPermission({mode:"readwrite"})!=="granted")throw Error("Доступ к YouTrackPlus не разрешён.");
    return list();
  }
  async function list() {
    if(!await granted())throw Error("Разрешите доступ к сохранённой папке YouTrackPlus.");
    const names=[];
    for await(const [name,handle] of root.entries()) { if(handle.kind!=="directory")continue;try{projectName(name);}catch{continue;}names.push(name);if(names.length>200)throw Error("В YouTrackPlus больше 200 папок. Уменьшите число проектов."); }
    return names.sort((a,b)=>a.localeCompare(b,"ru"));
  }
  async function select(name) {
    if(!name){selected="";await remember();return;}
    name=projectName(name);await root.getDirectoryHandle(name);selected=name;await remember();
  }
  async function create(value) {
    const name=projectName(value);
    if(!await granted("readwrite"))throw Error("Нужно разрешить запись в YouTrackPlus кнопкой «Разрешить доступ».");
    if((await list()).some(existing=>existing.toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error("Проект с таким именем уже существует.");
    await root.getDirectoryHandle(name,{create:true});await select(name);return name;
  }
  async function read(name,maxBytes) {
    if(!selected)return null;
    if(!["teams.json","config.json","work_items.json"].includes(name))throw Error("Неизвестный файл проекта");
    const dir=await root.getDirectoryHandle(selected);let handle;
    try{handle=await dir.getFileHandle(name);}catch(error){if(error.name==="NotFoundError")return null;throw error;}
    const file=await handle.getFile();if(file.size>maxBytes)throw Error(`${selected}/${name}: файл слишком большой`);
    try{return {data:JSON.parse((await file.text()).replace(/^\uFEFF/,"")),path:`YouTrackPlus/${selected}/${name}`};}catch{throw Error(`${selected}/${name}: некорректный JSON`);}
  }
  async function saveSettings(teams,config) {
    if(!selected)throw Error("Сначала выберите проект.");
    if(!await granted("readwrite"))throw Error("Разрешите запись в папку YouTrackPlus.");
    const dir=await root.getDirectoryHandle(selected);
    for(const [name,value] of [["teams.json",teams],["config.json",config]]) {
      const handle=await dir.getFileHandle(name,{create:true}),writer=await handle.createWritable();
      try{await writer.write(JSON.stringify(value,null,2)+"\n");await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}
    }
  }
  function profileFiles(profile) {
    const c=profile.classification||{};
    const teams=(profile.projects||[]).map(project=>{
      const members=(profile.teams||[]).filter(team=>team.projectName===project.name||team.projectId===project.id),completion=members.find(team=>team.completion)?.completion;
      return {projectName:project.name,...(completion?{closed_tasks_condition:`${completion.fieldName}: ${completion.values.map(value=>`{${value}}`).join(", ")}`} : {}),teams:members.map(team=>({name:team.name,members:team.members,capacity_in_hours:team.capacityHours}))};
    });
    const config={workItemTypeField:{dev:c.workItemTypes?.development,meeting:c.workItemTypes?.meeting,overs:c.workItemTypes?.overtime},issueTypeField:{fieldName:c.issueType?.fieldName,values:{feature:c.issueType?.business,tech:c.issueType?.technical,bug:c.issueType?.bug,works:c.issueType?.works}},statusField:{fieldName:c.completion?.fieldName,doneStatuses:c.completion?.values},estimateField:{fieldName:c.estimateFieldName},columnLabels:{biz:c.labels?.business,tech:c.labels?.technical,bug:c.labels?.bug,overs:c.labels?.overtime,meeting:c.labels?.meeting}};
    if(!profile.statusOverridesProjects)delete config.statusField;
    return {teams,config};
  }
  globalThis.YouTrackFolders=Object.freeze({restore,choose,reconnect,list,select,create,read,saveSettings,projectName,profileFiles,get configured(){return configured;},get selected(){return selected;}});
})();
