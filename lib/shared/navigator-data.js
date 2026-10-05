(function(root){
  'use strict';
  const MAX_ROWS=2000,MAX_BYTES=2*1024*1024;
  function entry(value){
    const name=String(value?.name||'').trim(),description=String(value?.description||'').trim(),raw=String(value?.url||'').trim();
    if(!name||name.length>120)throw Error('Название: от 1 до 120 символов.');
    if(description.length>10000)throw Error('Заметка слишком длинная: максимум 10 000 символов.');
    let url='';
    if(raw){let parsed;try{parsed=new URL(raw);}catch{throw Error('Укажите полную ссылку, начиная с https:// или http://.');}
      if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||raw.length>2048)throw Error('Нужна ссылка http/https без логина и пароля в адресе.');url=parsed.href;}
    return {name,url,description};
  }
  const seedId=item=>'csv:'+JSON.stringify([item.name,item.url]);
  function parse(text){
    if(typeof text!=='string'||text.length>MAX_BYTES)throw Error('CSV должен быть не больше 2 МБ.');
    text=text.replace(/^\uFEFF/,'');
    const first=text.split(/\r?\n/,1)[0],delimiter=first.includes(';')?';':first.includes('\t')?'\t':',';
    const rows=[];let row=[],cell='',quoted=false,closed=false;
    const flush=()=>{row.push(cell);cell='';closed=false;};
    for(let i=0;i<=text.length;i++){
      const ch=text[i];
      if(quoted){if(ch===undefined)throw Error('В CSV не закрыты кавычки.');if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
      if(ch==='"'&&!cell&&!closed){quoted=true;continue;}
      if(ch===delimiter){flush();continue;}
      if(ch===undefined||ch==='\n'||ch==='\r'){
        if(ch==='\r'&&text[i+1]==='\n')i++;flush();if(row.some(v=>v.trim()))rows.push(row);row=[];
        if(rows.length>MAX_ROWS+1)throw Error('В CSV допускается не больше 2000 записей.');continue;
      }
      if(closed&&ch.trim())throw Error('После закрывающей кавычки должен быть разделитель.');
      if(!closed)cell+=ch;
    }
    if(!rows.length)return [];
    const headers=rows.shift().map(v=>v.trim().toLowerCase());
    if(headers.join('|')!=='название|ссылка|описание')throw Error('Первая строка CSV: Название;Ссылка;Описание');
    const unique=new Map();
    for(const [i,cells] of rows.entries()){
      if(cells.length!==3)throw Error(`Строка ${i+2}: нужны три столбца.`);
      const clean=cells.map(v=>/^'[=+@\-\t\r]/.test(v)?v.slice(1):v);
      let value;try{value=entry({name:clean[0],url:clean[1],description:clean[2]});}catch(e){throw Error(`Строка ${i+2}: ${e.message}`);}
      const id=seedId(value);unique.set(id,{id,...value});
    }
    return [...unique.values()];
  }
  function serialize(items){
    const cell=value=>'"'+(/^[=+@\-\t\r]/.test(value)?"'"+value:value).replace(/"/g,'""')+'"';
    return '\uFEFFНазвание;Ссылка;Описание\r\n'+items.map(item=>{const value=entry(item);return [value.name,value.url,value.description].map(cell).join(';');}).join('\r\n')+'\r\n';
  }
  function state(raw){
    const entries=[];
    for(const value of Array.isArray(raw?.entries)?raw.entries.slice(0,MAX_ROWS):[]){try{if(typeof value.id==='string'&&value.id.length<=4096)entries.push({id:value.id,...entry(value)});}catch{}}
    return {version:1,entries,deleted:(Array.isArray(raw?.deleted)?raw.deleted:[]).filter(id=>typeof id==='string'&&id.length<=4096).slice(0,10000)};
  }
  function merge(seed,raw){const saved=state(raw),deleted=new Set(saved.deleted),map=new Map(seed.map(item=>[item.id,item]));for(const item of saved.entries)map.set(item.id,item);return [...map.values()].filter(item=>!deleted.has(item.id)).sort((a,b)=>a.name.localeCompare(b.name,'ru'));}
  const api=Object.freeze({entry,seedId,parse,serialize,state,merge,MAX_ROWS,MAX_BYTES});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;root.PersonalNavigatorData=api;
})(globalThis);
