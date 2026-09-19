(() => {
  let revision=0;
  async function render(){const n=++revision;const stored=await chrome.storage.session.get('youtrackRequestLog');if(n!==revision)return;const body=document.getElementById('reference-network-rows');body.replaceChildren();
    for(const row of stored.youtrackRequestLog||[]){const tr=document.createElement('tr');const result=row.state==='pending'?'Выполняется':row.state==='token'?'Получен новый токен':row.state==='error'?'Ошибка'+(row.status?' · HTTP '+row.status:''):'HTTP '+row.status;
      for(const value of [new Date(row.at).toLocaleTimeString('ru-RU'),row.method==='TOKEN'?'Сессия':row.source==='fields'?'По полям':'Основной отчёт',row.method==='TOKEN'?'Авторизация получена':`${row.method} ${row.path}`,[row.top!=null?'top '+row.top:'',row.skip!=null?'skip '+row.skip:''].filter(Boolean).join(' · '),result+(row.ms!=null?' · '+row.ms+' мс':'')]){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);
    }if(!body.children.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='Запросов пока нет. Запустите загрузку в отчёте — события появятся здесь автоматически.';tr.append(td);body.append(tr);}
  }
  chrome.storage.onChanged.addListener((c,a)=>{if(a==='session'&&c.youtrackRequestLog)render();});document.getElementById('reference-network-clear').addEventListener('click',()=>chrome.runtime.sendMessage({type:'youtrack-request-clear'}));render();
})();
