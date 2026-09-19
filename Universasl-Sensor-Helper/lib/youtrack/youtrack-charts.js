(function exposeYouTrackCharts(root) {
  "use strict";

  const DEFAULT_LIMIT = 40;
  const PALETTE = Object.freeze({
    business: "#5b5bd6",
    technical: "#8b5cf6",
    bug: "#e84c5b",
    overtime: "#f59e0b",
    meeting: "#22a699",
    capacity: "#c8c9d2",
    actual: "#5b5bd6",
    estimate: "#b8a9f2"
  });
  const CATEGORY_KEYS = Object.freeze(["business", "technical", "bug", "overtime", "meeting"]);
  const text = (value, limit = 100) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
  const number = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const total = stats => CATEGORY_KEYS.reduce((sum, key) => sum + number(stats?.[key]), 0);
  const labelsOf = result => ({business:"Бизнес",technical:"Тех",bug:"Баги",overtime:"Оверы",meeting:"Встречи/Иное",...(result?.profile?.labels || {})});
  const safeLimit = value => Math.max(1, Math.min(60, Math.floor(Number(value) || DEFAULT_LIMIT)));

  function peopleModel(result, options) {
    const labels = labelsOf(result), teamId = text(options.teamId, 120), limit = safeLimit(options.limit);
    const teams = (Array.isArray(result?.teams) ? result.teams : []).filter(team => !teamId || text(team.id, 120) === teamId);
    const rows = [];
    for (const team of teams) for (const member of (Array.isArray(team?.members) ? team.members : [])) {
      const segments = CATEGORY_KEYS.map(key => ({key,label:text(labels[key], 40),value:number(member?.stats?.[key]),color:PALETTE[key]}));
      rows.push({id:`${text(team.id,60)}:${text(member?.login,80)}`,label:text(member?.login || "Без логина", 80),group:text(team.name || team.projectName || "Команда", 80),segments,total:segments.reduce((sum,item)=>sum+item.value,0)});
    }
    rows.sort((a,b) => b.total-a.total || a.group.localeCompare(b.group,"ru") || a.label.localeCompare(b.label,"ru"));
    const shown = rows.slice(0, limit), oneTeam = teams.length === 1;
    return {
      schema:1,kind:"people",title:"Списания по людям",
      subtitle:"Учтённые work items за выбранный период. Это не фактическая занятость и не оценка свободной ёмкости.",
      ariaLabel:`Списания по людям, показано ${shown.length} из ${rows.length}`,
      legend:CATEGORY_KEYS.map(key=>({key,label:text(labels[key],40),color:PALETTE[key]})),
      rows:shown.map(row=>({...row,label:oneTeam?row.label:`${row.group} · ${row.label}`})),
      totalRows:rows.length,truncated:rows.length>shown.length,maxValue:Math.max(1,...shown.map(row=>row.total))
    };
  }

  function capacityModel(result, options) {
    const limit=safeLimit(options.limit), rows=(Array.isArray(result?.teams)?result.teams:[]).map(team=>({
      id:text(team.id,120),label:text(team.name||"Команда",80),group:text(team.projectName||"Проект",80),
      actual:number(team?.stats?.business),capacity:number(team?.capacityHours),hasCapacity:team?.capacityHours!=null&&Number.isFinite(Number(team.capacityHours))
    })).filter(row=>row.actual>0||row.hasCapacity);
    rows.sort((a,b)=>(b.capacity?b.actual/b.capacity:0)-(a.capacity?a.actual/a.capacity:0)||a.label.localeCompare(b.label,"ru"));
    const shown=rows.slice(0,limit);
    return {schema:1,kind:"capacity",title:"Факт и ёмкость",subtitle:"Бизнес-часы команд и настроенная ёмкость. Вертикальная отметка на строке — 100% ёмкости.",ariaLabel:`Факт и ёмкость команд, показано ${shown.length} из ${rows.length}`,legend:[{key:"actual",label:"Бизнес-часы",color:PALETTE.actual},{key:"capacity",label:"Ёмкость / 100%",color:PALETTE.capacity}],rows:shown,totalRows:rows.length,truncated:rows.length>shown.length,maxValue:Math.max(1,...shown.flatMap(row=>[row.actual,row.capacity]))};
  }

  function estimateModel(result, options) {
    const limit=safeLimit(options.limit), rows=[];
    for (const team of (Array.isArray(result?.teams)?result.teams:[])) for (const item of (Array.isArray(team?.stats?.details?.estimate)?team.stats.details.estimate:[])) {
      const estimate=number(item.estimate),actual=number(item.actual);
      rows.push({id:`${text(team.id,60)}:${text(item.issue,80)}`,label:text(item.issue||"Задача",80),group:text(team.name||team.projectName||"Команда",80),estimate,actual,exceeded:actual>estimate,ratioPct:estimate>0?actual/estimate*100:null});
    }
    rows.sort((a,b)=>Number(b.exceeded)-Number(a.exceeded)||(b.ratioPct||0)-(a.ratioPct||0)||b.actual-a.actual||a.label.localeCompare(b.label,"ru"));
    const shown=rows.slice(0,limit);
    return {schema:1,kind:"estimate",title:"Оценка и факт",subtitle:"Закрытые бизнес-задачи с доступной оценкой. Сначала показаны превышения.",ariaLabel:`Оценка и факт закрытых задач, показано ${shown.length} из ${rows.length}`,legend:[{key:"estimate",label:"Оценка",color:PALETTE.estimate},{key:"actual",label:"Факт",color:PALETTE.actual},{key:"exceeded",label:"Факт выше оценки",color:PALETTE.bug}],rows:shown,totalRows:rows.length,truncated:rows.length>shown.length,maxValue:Math.max(1,...shown.flatMap(row=>[row.actual,row.estimate]))};
  }

  function createModel(result, type = "people", options = {}) {
    if (type === "capacity") return capacityModel(result, options);
    if (type === "estimate") return estimateModel(result, options);
    return peopleModel(result, options);
  }

  function exportProjection(model) {
    const base={schema:1,kind:text(model?.kind,20),title:text(model?.title,100),subtitle:text(model?.subtitle,240),legend:(Array.isArray(model?.legend)?model.legend:[]).slice(0,8).map(item=>({key:text(item.key,30),label:text(item.label,60),color:/^#[0-9a-f]{6}$/i.test(item.color)?item.color:"#777777"})),truncated:model?.truncated===true,totalRows:number(model?.totalRows),maxValue:Math.max(1,number(model?.maxValue)),rows:[]};
    for(const row of (Array.isArray(model?.rows)?model.rows:[]).slice(0,60)){
      const safe={label:text(row.label,100),group:text(row.group,100)};
      if(base.kind==="people")safe.segments=(Array.isArray(row.segments)?row.segments:[]).slice(0,8).map(item=>({label:text(item.label,60),value:number(item.value),color:/^#[0-9a-f]{6}$/i.test(item.color)?item.color:"#777777"}));
      else if(base.kind==="capacity"){safe.actual=number(row.actual);safe.capacity=number(row.capacity);safe.hasCapacity=row.hasCapacity===true;}
      else{safe.actual=number(row.actual);safe.estimate=number(row.estimate);safe.exceeded=row.exceeded===true;}
      base.rows.push(safe);
    }
    return base;
  }

  const api=Object.freeze({CATEGORY_KEYS,PALETTE,createModel,exportProjection});
  root.YouTrackCharts=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
