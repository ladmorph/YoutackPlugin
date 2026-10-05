(function(root){
  'use strict';
  const legacy=()=>root.YouTrackWorkItems||require('./youtrack-workitems.js');
  const norm=v=>String(v??'').trim().toLocaleLowerCase('ru').replace(/\s+/g,'');
  const keys=['workItemTypeField','issueTypeField','statusField','estimateField','actualField','columnLabels'];
  // UI translations may expose Type as «Тип». Only the built-in OMP profile
  // accepts these aliases; an explicit config always keeps its field name.
  function prepareIssues(issues,explicit=false){
    return issues.map(issue=>{
      let customFields=(issue.customFields||[]).map(f=>({...f,name:f.name||f.projectCustomField?.field?.name||''}));
      if(!explicit){
        const candidates=customFields.filter(f=>['тип','type'].includes(norm(f.name)));
        const values=candidates.flatMap(f=>Array.isArray(f.value)?f.value:f.value==null?[]:[f.value]);
        const unique=[...new Map(values.map(v=>[norm(v?.name??v),v])).values()];
        customFields=customFields.filter(f=>norm(f.name)!=='тип');
        if(candidates.length)customFields.push({name:'Тип',value:unique.length===1?unique[0]:unique});
      }
      return {...issue,customFields};
    });
  }
  function parseConfig(data){
    const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
    if(!object(data)||!keys.some(k=>Object.hasOwn(data,k)))throw Error('config.json: нужны правила workItemTypeField, issueTypeField, statusField, estimateField или columnLabels.');
    for(const key of Object.keys(data))if(!keys.includes(key))throw Error('Неизвестный раздел config.json: '+key);
    for(const key of keys)if(data[key]!=null&&!object(data[key]))throw Error('config.json: раздел '+key+' должен быть объектом.');
    const list=(v,path)=>{if(v!=null&&(!Array.isArray(v)||v.length>200||v.some(x=>typeof x!=='string'||!x.trim()||x.length>240)))throw Error('config.json: '+path+' — массив непустых строк.');};
    const name=(v,path)=>{if(v!=null&&(typeof v!=='string'||!v.trim()||v.length>240))throw Error('config.json: '+path+' — непустая строка до 240 символов.');};
    for(const k of ['dev','meeting','overs'])list(data.workItemTypeField?.[k],'workItemTypeField.'+k);
    if(data.issueTypeField?.values!=null&&!object(data.issueTypeField.values))throw Error('config.json: issueTypeField.values должен быть объектом.');
    for(const k of ['feature','tech','bug','works'])list(data.issueTypeField?.values?.[k],'issueTypeField.values.'+k);
    list(data.statusField?.doneStatuses,'statusField.doneStatuses');
    for(const k of ['issueTypeField','statusField','estimateField','actualField'])name(data[k]?.fieldName,k+'.fieldName');
    for(const k of ['biz','tech','bug','overs','meeting'])name(data.columnLabels?.[k],'columnLabels.'+k);
    const p=legacy().migrateLegacy([{projectName:'rules',teams:[]}],data);
    return {classification:p.classification,statusOverridesProjects:p.statusOverridesProjects,actualFieldName:data.actualField?.fieldName?.trim()||'Факт разработка'};
  }
  function resolve(profile,project,teams){
    if(!profile)return null;
    const scoped=(teams||[]).filter(t=>t.projectName===project.name||t.projectName===project.shortName);
    if(!scoped.length)throw Error('Для правил профиля нужен teams.json с выбранным проектом.');
    if(!profile.classification||typeof profile.classification!=='object')throw Error('В профиле нет правил классификации.');
    const c=legacy().mergeClassification(profile.classification);
    const rules=scoped.map(t=>profile.statusOverridesProjects?c.completion:t.completion||c.completion).map(r=>({fieldName:r.fieldName,values:[...new Set((r.values||[]).map(norm))].sort(),useResolved:r.useResolved===true}));
    const unique=[...new Map(rules.map(r=>[JSON.stringify(r),r])).values()];
    if(unique.length!==1)throw Error('В teams.json разные правила закрытия для одного проекта. Задайте единый statusField в config.json для общего разбора.');
    const completion=unique[0],actualFieldName=profile.actualFieldName||'Факт разработка';
    const values=(issue,name)=>{const v=issue?.customFields?.find(f=>f.name===name)?.value;return Array.isArray(v)?v:v==null?[]:[v];};
    const one=(issue,name)=>{const v=values(issue,name);return v.length===1?v[0]:null;};
    const type=issue=>norm(one(issue,c.issueType.fieldName)?.name??one(issue,c.issueType.fieldName));
    return {classification:c,completion,actualFieldName,fields:[c.issueType.fieldName,completion.fieldName,c.estimateFieldName,actualFieldName],
      classify(item,issue){const w=norm(item?.type?.name),t=type(issue);if(c.workItemTypes.overtime.includes(w))return 'overtime';if(!t)return 'unknown';if(c.workItemTypes.meeting.includes(w)&&c.issueType.works.includes(t))return 'meeting';if(!c.workItemTypes.development.includes(w))return 'unknown';for(const k of ['business','technical','bug'])if(c.issueType[k].includes(t))return k;return 'unknown';},
      business:issue=>c.issueType.business.includes(type(issue)),
      state(issue){const v=one(issue,completion.fieldName);if(v==null)return null;const n=norm(v.name??v);if(completion.useResolved&&v.isResolved===true)return true;if(completion.values.includes(n))return true;return n||v.isResolved===false?false:null;}
    };
  }
  const api={parseConfig,resolve,prepareIssues};root.YouTrackAdvancedRules=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
