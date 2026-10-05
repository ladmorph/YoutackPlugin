/* Personal bookmarks only: no Graylog/YouTrack sessions, queries or tokens. */
(() => {
  'use strict';
  const D=globalThis.PersonalNavigatorData,KEY='personalNavigator.v1';
  const el=id=>document.getElementById('navigator-'+id);
  if(!D||!el('view'))return;
  let seed=[],saved=D.state(null),visible=[],limit=60,editing=null,busy=false,loadTicket=0;
  const status=(message,error=false)=>{el('status').textContent=message;el('status').classList.toggle('error',error);};
  const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  async function read(){if(!chrome.storage?.local)throw Error('Локальное хранилище недоступно. Откройте установленное расширение.');return D.state((await chrome.storage.local.get(KEY))[KEY]);}
  async function change(mutator){
    const write=async()=>{const fresh=await read();mutator(fresh);if(fresh.entries.length>D.MAX_ROWS)throw Error('Допускается не больше 2000 личных карточек.');
      await chrome.storage.local.set({[KEY]:fresh});saved=fresh;render();};
    if(globalThis.navigator?.locks?.request)await navigator.locks.request(KEY,write);else await write();
  }
  function edit(item){editing=item?.id||null;el('editor-title').textContent=item?'Редактировать карточку':'Новая карточка';
    el('name').value=item?.name||'';el('url').value=item?.url||'';el('description').value=item?.description||'';el('editor-error').textContent='';el('editor').showModal();el('name').focus();}
  async function remove(item){
    try{await change(state=>{state.entries=state.entries.filter(v=>v.id!==item.id);if(item.id.startsWith('csv:')&&!state.deleted.includes(item.id))state.deleted.push(item.id);});
      status('Карточка удалена.');const undo=element('button','Вернуть','navigator-undo secondary');undo.type='button';
      undo.addEventListener('click',async()=>{undo.disabled=true;try{await change(state=>{state.deleted=state.deleted.filter(id=>id!==item.id);state.entries=state.entries.filter(v=>v.id!==item.id);state.entries.push(item);});status('Карточка восстановлена.');}catch(error){status(error.message,true);}});el('status').append(undo);
    }catch(error){status(error.message,true);}
  }
  function render(){
    const all=D.merge(seed,saved),query=el('search').value.trim().toLocaleLowerCase('ru');
    visible=all.filter(item=>[item.name,item.url,item.description].some(value=>value.toLocaleLowerCase('ru').includes(query)));
    el('count').textContent=query?`Найдено: ${visible.length} из ${all.length}`:`Карточек: ${all.length} · ссылки открываются в новой вкладке`;
    el('grid').replaceChildren();el('more').hidden=visible.length<=limit;
    if(!visible.length){const empty=element('div',undefined,'navigator-empty');empty.append(element('strong',query?'Ничего не найдено':'Соберите свой рабочий набор'),element('p',query?'Попробуйте другое название или слово из заметки.':'Добавьте полезную ссылку, сохраните заметку или импортируйте CSV. Подключение к сервисам не требуется.'));el('grid').append(empty);return;}
    for(const item of visible.slice(0,limit)){
      const card=element('article',undefined,'navigator-card'),heading=element('h2');
      if(item.url){const open=element('button',item.name+' ↗','navigator-link');open.type='button';open.title='Открыть в новой вкладке: '+item.url;
        open.addEventListener('click',async()=>{open.disabled=true;try{await chrome.tabs.create({url:D.entry(item).url,active:true});}catch{status('Не удалось открыть вкладку.',true);}finally{open.disabled=false;}});heading.append(open);
      }else heading.textContent=item.name;
      card.append(heading,element('span',item.url?new URL(item.url).host:'Личная заметка','navigator-domain'));
      if(item.description){card.append(element('p',item.description,'navigator-description'));if(item.description.length>180||item.description.split('\n').length>4){const details=element('details');details.append(element('summary','Читать полностью'),element('p',item.description));card.append(details);}}
      const actions=element('div',undefined,'navigator-card-actions'),editButton=element('button','Изменить'),deleteButton=element('button','Удалить');
      editButton.type=deleteButton.type='button';editButton.setAttribute('aria-label','Изменить: '+item.name);deleteButton.setAttribute('aria-label','Удалить: '+item.name);
      editButton.addEventListener('click',()=>edit(item));deleteButton.addEventListener('click',()=>remove(item));actions.append(editButton,deleteButton);card.append(actions);el('grid').append(card);
    }
  }
  async function loadSeed(){
    const ticket=++loadTicket;el('source').textContent='Читаю Navigator/links.csv…';
    try{const response=await fetch(chrome.runtime.getURL('Navigator/links.csv'),{cache:'no-store'});if(!response.ok)throw Error();
      const length=Number(response.headers.get('content-length'));if(length>D.MAX_BYTES)throw Error();
      const rows=D.parse(await response.text());if(ticket!==loadTicket)return;seed=rows;
      el('source').textContent=`Файл Navigator/links.csv найден. Записей: ${seed.length}. Ваши локальные правки сохранены.`;render();
    }catch(error){if(ticket!==loadTicket)return;el('source').textContent='CSV не прочитан. Личные карточки доступны; файл можно импортировать вручную.';}
  }
  el('add').addEventListener('click',()=>edit(null));el('cancel').addEventListener('click',()=>el('editor').close());
  el('search').addEventListener('input',()=>{limit=60;render();});el('more').addEventListener('click',()=>{limit+=60;render();});
  el('refresh').addEventListener('click',loadSeed);
  el('tab').addEventListener('click',()=>{void loadSeed();void read().then(state=>{saved=state;render();}).catch(error=>status(error.message,true));});
  el('form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;el('save').disabled=true;
    try{const item={id:editing||'local:'+crypto.randomUUID(),...D.entry({name:el('name').value,url:el('url').value,description:el('description').value})};
      await change(state=>{state.deleted=state.deleted.filter(id=>id!==item.id);state.entries=state.entries.filter(v=>v.id!==item.id);state.entries.push(item);});
      el('editor').close();status('Сохранено в этом браузере.');
    }catch(error){el('editor-error').textContent=error.message;}finally{busy=false;el('save').disabled=false;}
  });
  el('import').addEventListener('click',()=>el('file').click());
  el('file').addEventListener('change',async()=>{
    const file=el('file').files[0];el('file').value='';if(!file)return;
    try{if(file.size>D.MAX_BYTES)throw Error('CSV должен быть не больше 2 МБ.');const rows=D.parse(await file.text());
      await change(state=>{const current=D.merge(seed,state),byIdentity=new Map(current.map(item=>[D.seedId(item),item.id]));
        for(const value of rows){const id=byIdentity.get(value.id)||value.id;state.entries=state.entries.filter(item=>item.id!==id);state.entries.push({...value,id});state.deleted=state.deleted.filter(key=>key!==id);}
      });status(`Импортировано записей: ${rows.length}. Остальные карточки сохранены.`);
    }catch(error){status(error.message,true);}
  });
  el('export').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([D.serialize(D.merge(seed,saved))],{type:'text/csv;charset=utf-8'})),link=element('a');link.href=url;link.download='links.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('CSV скачан. Это копия текущего списка.');
  });
  chrome.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes[KEY]){saved=D.state(changes[KEY].newValue);render();}});
  render();
  // Read storage without requiring an authenticated tab. Seed is loaded on entry.
  void read().then(state=>{saved=state;render();}).catch(error=>status(error.message,true));
})();
