(function installGraylogPreviewPanel(root) {
  "use strict";
  if (root.GraylogPage && !root.GraylogPage.isSupported(root.document, root.location)) return;
  const runtime = root.GraylogRuntime;
  if (runtime && !runtime.available()) return;
  const sendMessage = async (message,options) => runtime ? runtime.sendMessage(message,options) : chrome.runtime.sendMessage(message);
  if (root.GraylogPreviewPanel || !document.documentElement) return;

  const host = document.createElement("div");
  host.id = "advanced-graylog-preview-root";
  // A content-sized utility card leaves the message list and assistant visible.
  host.style.cssText = "all:initial;position:fixed;top:76px;right:16px;z-index:2147483646;width:min(380px,calc(100vw - 24px));pointer-events:none;color-scheme:light";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial}
    *,*::before,*::after{box-sizing:border-box}
    .drawer{display:flex;flex-direction:column;width:100%;max-height:min(590px,calc(100dvh - 240px));padding:14px;overflow:hidden;border:1px solid #d6dfe1;border-radius:12px;background:#fff;box-shadow:0 8px 28px #243b4b24,0 2px 7px #243b4b12;color:#283b43;font:400 12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;transform:translateX(16px);opacity:0;visibility:hidden;transition:transform .18s ease-out,opacity .18s ease-out,visibility .18s;pointer-events:auto}
    .drawer.open{transform:none;opacity:1;visibility:visible}
    .head{display:flex;flex:none;align-items:flex-start;justify-content:space-between;gap:12px;margin:0 0 12px}
    h2{margin:0;font-size:14px;font-weight:650;letter-spacing:-.15px}
    .head>div{min-width:0}.head .hint{margin:3px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
    button{font-family:inherit}
    .close,.collapse,.resume-close{display:grid;place-items:center;flex:none;width:30px;height:30px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:#6b7b82;cursor:pointer;font-size:22px;line-height:1}
    .close:hover,.collapse:hover,.resume-close:hover{background:#f0f4f5;color:#263c44}
    .head-controls{display:flex;flex:none;gap:2px}.collapse{font-size:18px}
    .resume{position:fixed;right:16px;bottom:200px;display:flex;align-items:center;gap:3px;width:fit-content;max-width:calc(100vw - 24px);padding:4px;border:1px solid #d6dfe1;border-radius:9px;background:#fff;box-shadow:0 3px 12px #243b4b19;pointer-events:auto;font:400 12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#283b43}
    .restore{display:flex;align-items:center;gap:8px;min-width:0;min-height:32px;padding:5px 8px;border:0;border-radius:5px;background:transparent;color:#36717a;cursor:pointer;text-align:left;font:inherit}
    .restore:hover{background:#f0f6f7}.restore-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px}.resume-close{width:28px;height:28px;font-size:19px}
    .restore:focus-visible,.collapse:focus-visible,.resume-close:focus-visible{outline:2px solid #197f92;outline-offset:2px}
    .tabs{display:flex;flex:none;gap:2px;margin-bottom:12px;padding:3px;border:1px solid #e2e8ea;border-radius:8px;background:#f4f7f8}
    .tabs button{flex:1;min-height:30px;padding:5px 10px;border:1px solid transparent;border-radius:5px;background:transparent;color:#63767e;cursor:pointer;font:500 12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif}
    .tabs button.active{border-color:#dce4e6;background:#fff;color:#126b76;box-shadow:0 1px 3px #243b4b0d}
    .graph-panel,.percentile-panel{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#c2d0d5 transparent}
    .graph-panel{padding:0 2px 0 0}
    .summary{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:9px}
    .badge{padding:3px 7px;border:1px solid #e1e8ea;border-radius:5px;background:#f7f9fa;color:#647980;font-size:10px}
    .badge.error{border-color:#efc4c5;background:#fff4f4;color:#ac363f}
    .latency-guide{display:flex;align-items:center;flex-wrap:wrap;gap:5px 9px;margin:0 0 11px;color:#687f87;font-size:9px}
    .latency-guide b{margin-right:2px;color:#465f68;font-size:10px;font-weight:500}
    .latency-key,.latency-pill{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
    .latency-key::before,.latency-pill::before{content:"";width:6px;height:6px;flex:none;border-radius:50%;background:var(--latency-color)}
    .band-fast{--latency-color:#289466}.band-normal{--latency-color:#7d963b}.band-warning{--latency-color:#bd951d}.band-slow{--latency-color:#cb791d}.band-critical{--latency-color:#c9444d}
    .status,.jump-status{flex:none;margin:0 0 10px;padding:10px;border:1px solid #dce6e9;border-radius:7px;background:#f5f9fa;color:#506c76;font-size:12px;line-height:1.45;overflow-wrap:anywhere}
    .status{max-height:130px;overflow-y:auto}
    .jump-status{margin:8px 0;padding:8px 10px}
    .jump-status.success{border-color:#b4d8c9;background:#f4faf7;color:#2c7257}.jump-status.missing{border-color:#e4d0aa;background:#fffbf3;color:#856120}
    .route{display:grid;gap:7px;margin:0}
    .node-group{--depth:0;width:calc(100% - calc(var(--depth) * 11px));margin-left:calc(var(--depth) * 11px)}
    .node{--depth:0;position:relative;display:grid;grid-template-columns:25px minmax(0,1fr);gap:7px;width:calc(100% - calc(var(--depth) * 11px));margin:0 0 0 calc(var(--depth) * 11px);padding:8px;border:1px solid #dfe7e9;border-radius:7px;background:#fafcfc;color:#30474f;font:inherit;text-align:left}
    .node.child::before{content:"";position:absolute;left:-8px;top:-8px;width:5px;height:21px;border-left:1px solid #aec8ce;border-bottom:1px solid #aec8ce;border-radius:0 0 0 4px}
    .index{display:grid;place-items:center;width:23px;height:23px;border-radius:5px;background:#eaf2f3;color:#36717a;font-size:11px;font-weight:650}
    .service{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:650}
    .relation{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#68818a;font-size:9px}
    .node.child.inferred::before{border-left-style:dashed;border-bottom-style:dashed}
    .node.reconstructed{border-color:#9bd6dd;background:#f3fbfc;box-shadow:inset 2px 0 #45a7b4}
    .node.cross-service{border-color:#c8d9df;background:#f8fbfc}
    .meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px 7px;margin-top:4px;color:#6e8188;font-size:9px}
    .latency-pill{padding:1px 5px;border:1px solid color-mix(in srgb,var(--latency-color) 26%,white);border-radius:4px;background:color-mix(in srgb,var(--latency-color) 7%,white);color:#42595e;font-variant-numeric:tabular-nums}
    .error-label{display:inline-flex;align-items:center;padding:1px 5px;border-radius:4px;background:#fae4e5;color:#a8313b;font-size:8px;font-weight:650;letter-spacing:.02em}
    .reconstruction-label,.duplicate-label{display:inline-flex;align-items:center;padding:1px 5px;border-radius:4px;background:#e5f5f7;color:#28727c;font-size:8px;font-weight:650;letter-spacing:.02em}
    .duplicate-label{background:#f1edfa;color:#6e5792}
    .node.failed{cursor:pointer;border-color:#e5aeb2;background:#fff6f6;box-shadow:inset 2px 0 #ce505b}.node.failed .index{background:#f7dfe2;color:#ad3440}.node.failed:hover{border-color:#cb6871;background:#ffeded}
    .source-row{display:flex;align-items:center;gap:6px;margin:3px 0 1px 32px;min-width:0}
    .source-link{display:flex;align-items:center;gap:5px;min-width:0;min-height:28px;max-width:100%;padding:4px 7px;border:1px solid #d9d1e8;border-radius:5px;background:#faf8fd;color:#6b5389;font:500 10px/1.35 system-ui,sans-serif;cursor:pointer;text-align:left}
    .source-link:hover{background:#f1ebf9;border-color:#b6a6cf}.source-link:focus-visible,.evidence-choices summary:focus-visible{outline:2px solid #197f92;outline-offset:2px}
    .source-link:disabled{opacity:.6;cursor:wait}.source-link span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-link::before{content:"↳";flex:none;color:#9b8aae}
    .source-unavailable{margin:3px 0 0 33px;font-size:9px;color:#879399}.evidence-choices{margin:4px 0 0 32px;color:#73818b;font-size:10px}.evidence-choices summary{cursor:pointer;padding:4px 0}.evidence-choice{display:flex;align-items:center;gap:5px;margin:4px 0}.evidence-choice .message-link{border-color:#ebc6ca;color:#a44552;background:#fff8f8}.evidence-choice .message-link::before{content:""}.evidence-choice .source-unavailable{margin:0;font-size:9px}.evidence-help{margin:3px 0 6px;color:#77858d;font-size:9px}.message-hint{color:#a25560;font-size:9px}
    .node.slow{border-color:#e2cea9}
    .node.failed:focus-visible,.close:focus-visible,.tabs button:focus-visible,.action:focus-visible{outline:2px solid #197f92;outline-offset:2px}
    .actions{display:flex;flex:none;align-items:center;justify-content:space-between;gap:8px;margin:12px -14px -14px;padding:11px 14px;border-top:1px solid #e5ecee;background:#fbfcfc}
    .action{min-height:32px;padding:7px 10px;border:1px solid #d5e0e3;border-radius:6px;background:#fff;color:#526d76;cursor:pointer;font:500 12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif}
    .action:hover{background:#f0f6f7;border-color:#abc8d0}.action.primary{border-color:#28798a;background:#28798a;color:#fff}.action.primary:hover{border-color:#1d6473;background:#1d6473}
    .action:disabled{cursor:wait;opacity:.55}
    .percentile-card{padding:12px;border:1px solid #e0e8ea;border-radius:8px;background:#f8fafb}
    .percentile-card h3{margin:0 0 6px;font-size:13px;font-weight:650}
    .percentile-card code{display:block;margin:9px 0 0;padding:8px;border:1px solid #e0e8ea;border-radius:5px;background:#fff;color:#276775;font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
    .journal-panel{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#c2d0d5 transparent}
    .journal-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 8px;color:#526d76;font-size:11px;font-weight:600}
    .journal-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;padding:8px 0;border-bottom:1px solid #eef2f3}
    .journal-row:last-of-type{border-bottom:0}
    .journal-trace{grid-column:1;min-width:0;border:0;background:transparent;padding:0;color:#126b76;cursor:pointer;font:600 11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .journal-trace:hover{text-decoration:underline}
    .journal-uri{grid-column:1;min-width:0;color:#526d76;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .journal-state{grid-column:2;grid-row:1;align-self:start;flex:none;padding:2px 7px;border-radius:99px;font-size:9px;font-weight:800;white-space:nowrap}
    .journal-state.ok{color:#1b7f63;background:#1b7f631f}
    .journal-state.failed{color:#a3364a;background:#a3364a1c}
    .journal-state.unknown{color:#7b6520;background:#c99a1f1f}
    .journal-actions{grid-column:1/-1;display:flex;gap:6px;margin-top:2px}
    .journal-actions button{padding:3px 8px;border:1px solid #dce4e6;border-radius:5px;background:#f7f9fa;color:#3a545c;cursor:pointer;font-size:10px}
    .journal-actions button:hover{background:#eef3f4}
    .journal-actions button[disabled]{opacity:.55;cursor:default}
    .journal-all{margin-top:10px;width:100%}
    .journal-note{grid-column:1/-1;margin:2px 0 0;color:#526d76;font-size:10px}
    .journal-trace:focus-visible,.journal-actions button:focus-visible,.journal-all:focus-visible{outline:2px solid #197f92;outline-offset:2px}
    .recent{flex:none;margin:0 0 12px}
    .recent-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 6px;color:#526d76;font-size:11px;font-weight:600}
    .recent-clear{padding:2px 6px;border:1px solid transparent;border-radius:4px;background:transparent;color:#7b8f96;cursor:pointer;font-size:10px}
    .recent-clear:hover{background:#f0f4f5;color:#3a545c}
    .recent-list{display:flex;flex-wrap:wrap;gap:5px}
    .recent-chip{display:inline-flex;align-items:center;gap:2px;max-width:100%;padding:3px 3px 3px 9px;border:1px solid #dce4e6;border-radius:14px;background:#f7f9fa;color:#3a545c;font-size:10px}
    .recent-chip .open{border:0;background:transparent;color:inherit;cursor:pointer;padding:0;font:inherit;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .recent-chip .remove{display:grid;place-items:center;flex:none;width:16px;height:16px;border:0;border-radius:50%;background:transparent;color:#8a9aa0;cursor:pointer;font-size:12px;line-height:1;padding:0}
    .recent-chip .remove:hover{background:#e5ecee;color:#3a545c}
    .recent-chip .open:focus-visible,.recent-chip .remove:focus-visible,.recent-clear:focus-visible{outline:2px solid #197f92;outline-offset:2px}
    .hint{margin:7px 0;color:#71858d;font-size:11px;line-height:1.45}
    [hidden]{display:none!important}
    @media(max-height:650px){:host{top:60px!important}.drawer{max-height:calc(100dvh - 220px)}}
    @media(max-width:600px){:host{right:12px!important}.drawer{padding:12px;max-height:calc(100dvh - 240px)}.actions{margin-inline:-12px;margin-bottom:-12px;padding-inline:12px}.node{grid-template-columns:24px minmax(0,1fr)}}
    @media(prefers-reduced-motion:reduce){.drawer{transition:none}.node{scroll-behavior:auto}}
  `;
  const drawer = document.createElement("aside");
  drawer.className = "drawer";
  drawer.id = "graylog-preview-drawer";
  drawer.setAttribute("aria-label", "Быстрый разбор trace");
  drawer.innerHTML = `<header class="head"><div><h2>Быстрый разбор trace</h2><div class="hint">Текущая страница · без запросов к серверу</div></div><button class="close" type="button" aria-label="Закрыть">×</button></header><nav class="tabs" aria-label="Вид разбора"><button class="graph active" type="button">Схема</button><button class="percentiles" type="button">Процентили</button><button class="journal" type="button">Журнал</button></nav><section class="graph-panel"><div class="summary"></div><div class="latency-guide" aria-label="Шкала скорости ответа"><b>Ответ, мс:</b><span class="latency-key band-fast">&lt;100</span><span class="latency-key band-normal">100–499</span><span class="latency-key band-warning">500–999</span><span class="latency-key band-slow">1–2 с</span><span class="latency-key band-critical">≥2 с</span></div><div class="status">Схема по сообщениям текущей страницы.</div><div class="jump-status" role="status" aria-live="polite" hidden></div><div class="route"></div></section><section class="journal-panel" hidden><div class="journal-head"><span>Разобранные trace</span><button class="recent-clear" type="button">Очистить</button></div><div class="journal-list"></div><p class="journal-empty hint" hidden>Здесь появятся trace, которые вы разбирали. Ссылка сохраняется с зафиксированным периодом.</p><button class="action journal-all" type="button">Показать всё</button></section><section class="percentile-panel" hidden><div class="percentile-card"><h3>Время ответа gateway</h3><p class="hint">Рассчитаем p95 и p99 по initUri gateway за выбранный период.</p><code>Отдельный расчёт по gateway за выбранный период</code></div></section><footer class="actions"><button class="action refresh" type="button">Обновить</button><button class="action primary full" type="button">Открыть полный граф</button></footer>`;
  const headControls = document.createElement("div");
  headControls.className = "head-controls";
  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "collapse";
  collapseButton.textContent = "−";
  collapseButton.title = "Свернуть, сохранив разбор";
  collapseButton.setAttribute("aria-label", "Свернуть разбор");
  headControls.append(collapseButton, drawer.querySelector(".close"));
  drawer.querySelector(".head").append(headControls);
  const resume = document.createElement("div");
  resume.className = "resume";
  resume.hidden = true;
  resume.innerHTML = `<button class="restore" type="button" aria-controls="graylog-preview-drawer" aria-expanded="false"><span aria-hidden="true">↗</span><span class="restore-label">Вернуться к схеме</span></button><button class="resume-close" type="button" aria-label="Закрыть разбор" title="Закрыть разбор">×</button>`;
  if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in shadow) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(style.textContent);
    shadow.adoptedStyleSheets = [sheet];
    shadow.append(drawer);
  } else {
    shadow.append(style, drawer);
  }
  document.documentElement.append(host);
  shadow.append(resume);

  const closeButton = drawer.querySelector(".close:not(.collapse)");
  const restoreButton = resume.querySelector(".restore");
  const restoreLabel = resume.querySelector(".restore-label");
  const graphTab = drawer.querySelector(".graph");
  const percentilesTab = drawer.querySelector(".percentiles");
  const graphPanel = drawer.querySelector(".graph-panel");
  const percentilePanel = drawer.querySelector(".percentile-panel");
  const journalPanel = drawer.querySelector(".journal-panel");
  const journalList = drawer.querySelector(".journal-list");
  const journalEmpty = drawer.querySelector(".journal-empty");
  const journalClear = drawer.querySelector(".recent-clear");
  const journalAll = drawer.querySelector(".journal-all");
  const journalTab = drawer.querySelector(".tabs .journal");
  const summary = drawer.querySelector(".summary");
  const status = drawer.querySelector(".status");
  // Shared errors/loading must also remain visible on the percentiles tab.
  drawer.insertBefore(status, graphPanel);
  const route = drawer.querySelector(".route");
  const jumpStatus = drawer.querySelector(".jump-status");
  const jumpDiagnostics=document.createElement('details');jumpDiagnostics.hidden=true;
  jumpDiagnostics.style.cssText='font-size:11px;color:#526d76;margin:6px 0;';
  const diagnosticTitle=document.createElement('summary');diagnosticTitle.textContent='Диагностика перехода · без текста логов';
  const diagnosticText=document.createElement('pre');diagnosticText.style.cssText='white-space:pre-wrap;user-select:text;padding:8px;background:#f1f5f6;';
  jumpDiagnostics.append(diagnosticTitle,diagnosticText);jumpStatus.after(jumpDiagnostics);
  const uri = drawer.querySelector(".percentile-card code");
  const refreshButton = drawer.querySelector(".refresh");
  const fullButton = drawer.querySelector(".full");
  const pagesCard=document.createElement('section');pagesCard.className='pages-card';pagesCard.hidden=true;
  pagesCard.style.cssText='margin:0 0 9px;padding:8px;border:1px solid #c9dfe2;border-radius:7px;background:#f2f9fa;';
  const pagesText=document.createElement('div');pagesText.setAttribute('role','status');pagesText.setAttribute('aria-live','polite');
  const pagesHint=document.createElement('div');pagesHint.className='hint';pagesHint.textContent='Перелистаем выдачу Graylog и вернёмся на первую страницу.';
  const pagesButton=document.createElement('button');pagesButton.type='button';pagesButton.className='action collect-pages';pagesButton.textContent='Собрать страницы';pagesButton.style.marginTop='8px';
  const pagesStop=document.createElement('button');pagesStop.type='button';pagesStop.className='action stop-pages';pagesStop.textContent='Остановить';pagesStop.hidden=true;pagesStop.style.cssText='margin:8px 0 0 6px;color:#b02f3b;';
  pagesCard.append(pagesText,pagesHint,pagesButton,pagesStop);graphPanel.prepend(pagesCard);
  let collectingPages=false,collectedReady=false,pagesInfo=null,pagesProgressTimer=null,pagesInspectPending=false;
  const pageContext=url=>{try{const value=new URL(url);for(const key of ['page','offset','pageNumber','page_number','pageno','pageNo','page_no'])value.searchParams.delete(key);return value.href;}catch{return url;}};
  async function inspectPages(){
    if(collectingPages||!currentTraceId||pagesInspectPending)return;
    const ticket=generation;
    pagesInspectPending=true;pagesButton.disabled=true;
    try{
      const reply=await sendMessage({type:'page-collection-info',traceId:currentTraceId,sourceUrl:currentSourceUrl});
      if(ticket!==generation||collectingPages)return;
      pagesInfo=reply?.info || {available:false,reason:'inspection-failed'};
      pagesCard.hidden=['single-page','too-many-pages'].includes(pagesInfo.reason);
      pagesButton.disabled=false;pagesButton.hidden=false;
      if(pagesInfo.available){pagesText.textContent=`Давай заполним до конца · 1 / ${pagesInfo.totalPages}`;pagesButton.textContent='Собрать страницы';pagesHint.textContent=`Сейчас страница ${pagesInfo.currentPage}. Перелистаем выдачу и вернёмся на первую страницу.`;}
      else {
        pagesText.textContent='Сбор страниц пока недоступен';pagesButton.textContent='Проверить страницы';
        const explanations={
          'missing-total':'Страницы видны, но не удалось прочитать общее число сообщений из выдачи Graylog.',
          'missing-page-size':'Не удалось определить число сообщений на одной странице Graylog.',
          'page-count-mismatch':'Число страниц в переключателе не совпало с данными выдачи.',
          'page-changed':'Страница изменилась во время проверки. Повторите проверку после загрузки.',
          'snapshot-truncated':'Снимок страницы неполный: данные изменились при чтении или превышен лимит объёма сообщений.',
          'incomplete-messages':'Не удалось прочитать все сообщения текущей страницы с их идентификаторами.',
          'missing-identities':'У сообщений отсутствуют уникальные ID или индексы. Без них нельзя безопасно объединить страницы.'
        };
        pagesHint.textContent=pagesInfo.reason==='unconfirmed-page-total'?(explanations[pagesInfo.detail]||'Не удалось подтвердить полноту текущей страницы.'):'Не удалось однозначно распознать переключатель страниц у сообщений.';
        const d=pagesInfo.diagnostic;
        if(d){const n=v=>Number.isSafeInteger(v)&&v>=0?String(v):'не определено';pagesHint.textContent+=` Страница ${n(d.current)} / ${n(d.pages)}; прочитано ${n(d.read)}, размер страницы ${n(d.size)}, всего ${n(d.total)}.`;
          const causes={'candidate-limit':'слишком много строк для одного чтения','metadata-changed':'изменились параметры страницы','result-changed':'изменился массив выдачи','page-limit':'превышен объём снимка','field-limit':'превышен лимит структурного поля','rows-changed':'строки заменены во время чтения'};
          const details=(d.causes||[]).map(code=>causes[code]).filter(Boolean);if(details.length)pagesHint.textContent+=` Причина: ${details.join('; ')}.`;
        }
        pagesHint.textContent+=' Проверка не отправляет запросы к Graylog.';
      }
      if(pagesInfo.available&&pagesInfo.contentTruncated)pagesHint.textContent+=' Длинные тексты сокращены для анализа; все сообщения страницы учтены.';
    }catch{if(ticket!==generation||collectingPages)return;pagesInfo={available:false};pagesCard.hidden=false;pagesText.textContent='Не удалось проверить страницы';pagesHint.textContent='Повторная проверка читает страницу без запросов к Graylog.';pagesButton.textContent='Проверить страницы';pagesButton.hidden=false;pagesButton.disabled=false;}
    finally{pagesInspectPending=false;if(ticket!==generation&&hasResult&&!collectingPages)void inspectPages();}
  }
  async function stopPages(){
    if(!collectingPages)return;
    pagesStop.disabled=true;pagesText.textContent='Останавливаю сбор…';
    await sendMessage({type:'cancel-trace-pages',traceId:currentTraceId,sourceUrl:location.href}).catch(()=>{});
  }
  function publishCollected(reply,returning){
    const newlyReady=!collectedReady;
    if(reply.preview&&newlyReady)render(reply.preview);
    currentSourceUrl=location.href;hasResult=true;collectedReady=true;
    pagesText.textContent=`Граф готов · ${reply.collection.pagesRead} / ${reply.collection.totalPages} страниц`;
    const ending=returning?'Можно открыть сейчас. Graylog возвращается на первую страницу.':reply.returnStatus==='cancelled'?'Ожидание возврата остановлено. Граф сохранён.':reply.returnStatus==='failed'?'Граф сохранён; возврат первой страницы не подтверждён.':'Первая страница восстановлена.';
    pagesHint.textContent=`Собрано сообщений: ${reply.collection.messagesRead}. ${ending}`;
    pagesButton.textContent='Открыть собранный граф';pagesButton.hidden=true;
    fullButton.textContent=activeView==='graph'?'Открыть собранный граф':'Открыть расчёт p95';
    fullButton.disabled=fullOpenPending||!currentTraceId||(returning&&activeView!=='graph');
    if(newlyReady)root.__advancedGraylogClippy?.reportCollection?.();
  }
  async function collectPages(){
    if(collectingPages||activeRequestId||fullOpenPending||!currentTraceId)return;
    if(collectedReady){
      pagesButton.disabled=true;
      try{const reply=await sendMessage({type:'open-collected-trace',traceId:currentTraceId,sourceUrl:location.href});if(!reply?.opened)throw new Error(reply?.error||'Граф недоступен.');}
      catch(error){pagesText.textContent=error.message;collectedReady=false;pagesButton.textContent='Собрать заново';}
      finally{pagesButton.disabled=false;}return;
    }
    const ticket=generation,id=currentTraceId,operationId=`pages-${Date.now()}`;
    collectingPages=true;pagesButton.disabled=true;pagesStop.hidden=false;pagesStop.disabled=false;refreshButton.disabled=true;fullButton.disabled=true;
    root.__advancedGraylogClippy?.beginCancelableOperation?.({token:operationId,kind:'compact-graph',cancel:stopPages});
    async function pollProgress(){
      if(!collectingPages)return;
      try{const reply=await sendMessage({type:'page-collection-progress',traceId:id,sourceUrl:location.href,readyAcknowledged:collectedReady});
        if(ticket!==generation)return;
        if(collectingPages&&reply?.progress?.ready&&reply.collection)publishCollected(reply,true);
        else if(collectingPages&&reply?.progress?.active&&!collectedReady){const p=reply.progress;pagesText.textContent=p.phase==='returning'?'Возвращаю первую страницу…':`Собираю страницы · ${p.pagesRead} / ${p.totalPages}`;}
      }catch{}
      if(collectingPages)pagesProgressTimer=setTimeout(pollProgress,400);
    }
    pagesProgressTimer=setTimeout(pollProgress,400);
    try{
      const reply=await sendMessage({type:'collect-trace-pages',traceId:id,sourceUrl:location.href},{timeoutMs:100000});
      if(ticket!==generation)return;
      if(!reply?.ok)throw new Error(reply?.error||'Не удалось собрать страницы.');
      publishCollected(reply,false);
    }catch(error){if(ticket===generation){pagesText.textContent=error.message;pagesButton.textContent='Повторить сбор';}}
    finally{collectingPages=false;clearTimeout(pagesProgressTimer);pagesProgressTimer=null;pagesStop.hidden=true;pagesButton.disabled=false;refreshButton.disabled=!currentTraceId;fullButton.disabled=!currentTraceId||fullOpenPending;root.__advancedGraylogClippy?.endCancelableOperation?.(operationId);}
  }
  pagesButton.addEventListener('click',()=>pagesInfo?.available||collectedReady?collectPages():inspectPages());pagesStop.addEventListener('click',stopPages);
  let currentTraceId = "";
  let currentSourceUrl = "";
  let activeView = "graph";
  let generation = 0;
  let activeRequestId = null;
  let fullOpenPending = false;
  let hasResult = false;
  const JOURNAL = root.TraceJournal;
  const NAVIGATOR_KEY = "personalNavigator.v1";
  const journalTime = (ms) => {
    try { return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(ms)); }
    catch { return new Date(ms).toISOString(); }
  };

  async function loadJournal() {
    if (!JOURNAL) return [];
    try {
      const stored = await chrome.storage?.local?.get(JOURNAL.KEY);
      return JOURNAL.list(stored?.[JOURNAL.KEY]);
    } catch { return []; }
  }

  // Карточка Навигатора обновляется по идентификатору, выведенному из traceId:
  // повторное добавление того же trace не плодит вторую карточку, а заменяет
  // описание свежим разбором.
  async function addToNavigator(entry, button) {
    const card = JOURNAL?.navigatorEntry(entry, journalTime);
    if (!card || !chrome.storage?.local) return;
    button.disabled = true;
    const previous = button.textContent;
    try {
      const write = async () => {
        const stored = await chrome.storage.local.get(NAVIGATOR_KEY);
        const state = stored?.[NAVIGATOR_KEY] && typeof stored[NAVIGATOR_KEY] === "object" ? stored[NAVIGATOR_KEY] : {};
        const entries = Array.isArray(state.entries) ? state.entries : [];
        const deleted = Array.isArray(state.deleted) ? state.deleted : [];
        const existed = entries.some((item) => item?.id === card.id);
        await chrome.storage.local.set({
          [NAVIGATOR_KEY]: {
            version: 1,
            entries: [...entries.filter((item) => item?.id !== card.id), card].slice(-2000),
            deleted: deleted.filter((id) => id !== card.id)
          }
        });
        return existed;
      };
      const existed = root.navigator?.locks?.request
        ? await root.navigator.locks.request(NAVIGATOR_KEY, write)
        : await write();
      button.textContent = existed ? "Обновлено" : "Добавлено";
    } catch {
      button.textContent = "Не вышло";
    }
    setTimeout(() => { button.textContent = previous; button.disabled = false; }, 2000);
  }

  function journalRow(entry, onRemoved) {
    const row = document.createElement("div");
    row.className = "journal-row";

    const trace = document.createElement("button");
    trace.type = "button";
    trace.className = "journal-trace";
    trace.textContent = entry.traceId;
    trace.title = `${entry.traceId} · открыть страницу Graylog за зафиксированный период`;
    trace.addEventListener("click", () => openRecentTrace(entry));

    const state = JOURNAL.status(entry);
    const badge = document.createElement("span");
    badge.className = `journal-state ${state.kind}`;
    badge.textContent = state.label;
    badge.title = state.kind === "unknown"
      ? "Эта запись сделана прежней версией: признаков ошибок в ней не сохранено."
      : state.kind === "failed"
        ? "В разобранной выдаче найдены события уровня 3."
        : "В разобранной выдаче событий уровня 3 не найдено.";

    const uri = document.createElement("div");
    uri.className = "journal-uri";
    uri.textContent = entry.initUri
      ? (entry.initUriCount && entry.initUriCount > 1 ? `${entry.initUri} · и ещё ${entry.initUriCount - 1}` : entry.initUri)
      : "initUri не определён";
    uri.title = entry.initUri
      ? (entry.initUriExact
        ? entry.initUri
        : `${entry.initUri} · взят из сообщений gateway, единственность не доказана`)
      : "В сообщениях gateway этого разбора initUri не нашёлся";

    const actions = document.createElement("div");
    actions.className = "journal-actions";
    const toNavigator = document.createElement("button");
    toNavigator.type = "button";
    toNavigator.textContent = "В навигатор";
    toNavigator.title = "Сохранить карточку: имя из initUri, ссылка с зафиксированным периодом, в заметке — статус и повторы";
    toNavigator.addEventListener("click", () => void addToNavigator(entry, toNavigator));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Убрать";
    remove.title = `Убрать ${entry.traceId} из журнала`;
    remove.addEventListener("click", () => void onRemoved(entry.traceId));
    actions.append(toNavigator, remove);

    row.append(trace, badge, uri, actions);
    const facts = [];
    if (entry.durationMs !== null) facts.push(JOURNAL.duration(entry.durationMs));
    if (entry.failedService) facts.push(`упал ${entry.failedService}`);
    if (entry.repeats) facts.push(`повторов HTTP ${entry.repeats}`);
    if (entry.nodes) facts.push(`компонентов ${entry.nodes}`);
    if (facts.length) {
      const note = document.createElement("p");
      note.className = "journal-note";
      note.textContent = facts.join(" · ");
      row.append(note);
    }
    return row;
  }

  async function renderRecentTraces() {
    if (!JOURNAL) return;
    const list = await loadJournal();
    journalList.replaceChildren();
    journalEmpty.hidden = list.length > 0;
    journalClear.hidden = list.length === 0;
    journalAll.hidden = list.length === 0;
    for (const entry of list.slice(0, JOURNAL.PREVIEW_LIMIT)) journalList.append(journalRow(entry, removeRecentTrace));
    journalAll.textContent = list.length > JOURNAL.PREVIEW_LIMIT
      ? `Показать всё · ${list.length}`
      : "Показать всё";
  }

  // Запоминается только удавшийся непустой разбор: он достаточно намеренный.
  // Диапазон в ссылке фиксируется абсолютным, иначе через час она откроет
  // другое окно и trace в нём не найдётся.
  // Korneviy vyzov - samyy melkiy po glubine uzel s izmerennoy dlitelnostyu:
  // eto vremya vsego zaprosa, a ne otdelnoy chasti.
  function rootDurationMs(preview) {
    const measured = (preview?.nodes || []).filter((node) => typeof node?.durationMs === "number" && node.durationMs >= 0);
    if (!measured.length) return null;
    return measured.reduce((best, node) => (node.depth ?? 99) < (best.depth ?? 99) ? node : best).durationMs;
  }

  function firstFailedService(preview) {
    return (preview?.nodes || []).find((node) => node?.failed === true)?.service || "";
  }

  async function recordRecentTrace(traceId, url, preview) {
    if (!JOURNAL || !chrome.storage?.local) return;
    const pinned = JOURNAL.pinRange(url);
    if (!pinned) return;
    try {
      const stored = await chrome.storage.local.get(JOURNAL.KEY);
      const next = JOURNAL.upsert(stored?.[JOURNAL.KEY], {
        traceId,
        url: pinned.href,
        at: Date.now(),
        startMs: pinned.startMs,
        endMs: pinned.endMs,
        // percentileContext dlya razbora tekushchey stranicy ne vychislyaetsya,
        // poetomu initUri beretsya iz nablyudennyh znacheniy gateway. Flag
        // initUriExact razlichaet eti dva sluchaya v opisanii kartochki.
        initUri: preview?.initUri || preview?.observedInitUris?.[0] || "",
        initUriExact: Boolean(preview?.initUri),
        initUriCount: Array.isArray(preview?.observedInitUris) ? preview.observedInitUris.length : null,
        errorEvents: preview?.errorEvents,
        repeats: preview?.repeatedHttpTargets,
        nodes: preview?.nodes?.length,
        durationMs: rootDurationMs(preview),
        failedService: firstFailedService(preview)
      });
      await chrome.storage.local.set({ [JOURNAL.KEY]: next });
      await renderRecentTraces();
    } catch {}
  }

  async function removeRecentTrace(traceId) {
    if (!JOURNAL) return;
    try {
      const stored = await chrome.storage.local.get(JOURNAL.KEY);
      await chrome.storage.local.set({ [JOURNAL.KEY]: JOURNAL.remove(stored?.[JOURNAL.KEY], traceId) });
      await renderRecentTraces();
    } catch {}
  }

  async function clearRecentTraces() {
    if (!JOURNAL) return;
    try { await chrome.storage.local.set({ [JOURNAL.KEY]: [] }); await renderRecentTraces(); } catch {}
  }
  async function openRecentTrace(item) {
    try {
      const reply = await sendMessage({ type: "open-recent-trace-url", url: item.url });
      if (!reply?.opened) throw new Error();
    } catch {
      status.hidden = false;
      status.textContent = "Не удалось открыть сохранённую страницу Graylog.";
    }
  }
  journalClear.addEventListener("click", () => void clearRecentTraces());
  journalTab.addEventListener("click", () => select("journal"));
  journalAll.addEventListener("click", () => void openFullJournal());
  void renderRecentTraces();
  function cancelPendingPreview() {
    if(!activeRequestId)return;
    const requestId=activeRequestId;activeRequestId=null;
    root.__advancedGraylogClippy?.endCancelableOperation?.(requestId);
    sendMessage({type:'cancel-preview-from-graylog',requestId}).catch(()=>{});
  }
  let collapsed = false;
  let savedScroll = { graph: 0, percentiles: 0 };

  function updateResume() {
    restoreLabel.textContent = activeView === "graph" ? "Вернуться к схеме" : "Вернуться к процентилям";
    restoreButton.title = currentTraceId ? `traceId: ${currentTraceId}` : "Нет точного traceId";
  }

  function readContext(fallbackTraceId = "") {
    return root.__advancedGraylogClippy?.resolveTraceContext?.() || {
      traceId: root.GraylogOverlay?.exactTraceId(root.GraylogOverlay.queryFromUrl(location.href)) || fallbackTraceId,
      sourceUrl: location.href
    };
  }

  // Changing a search invalidates its result immediately, without querying on
  // keystrokes. Each explicit action takes a fresh snapshot of trace and period.
  function syncContext(context) {
    const nextTraceId = /^[a-z0-9_-]{1,128}$/i.test(String(context?.traceId || "")) ? String(context.traceId) : "";
    const nextUrl = String(context?.sourceUrl || location.href);
    if((collectingPages||collectedReady)&&nextTraceId===currentTraceId&&pageContext(nextUrl)===pageContext(currentSourceUrl)){currentSourceUrl=nextUrl;return;}
    if (nextTraceId === currentTraceId && nextUrl === currentSourceUrl) return;
    cancelPendingPreview();
    if(collectingPages)void stopPages();
    collectedReady=false;pagesCard.hidden=true;
    currentTraceId = nextTraceId;
    currentSourceUrl = nextUrl;
    savedScroll = { graph: 0, percentiles: 0 };
    updateResume();
    const contextLabel = drawer.querySelector(".head .hint");
    contextLabel.textContent = currentTraceId ? `Текущая страница · traceId: ${currentTraceId}` : "Текущая страница · нет точного traceId";
    contextLabel.title = contextLabel.textContent;
    generation += 1;
    hasResult = false;
    route.replaceChildren();
    summary.replaceChildren();
    jumpStatus.hidden = true;
    drawer.setAttribute("aria-busy", "false");
    refreshButton.disabled = !currentTraceId;
    fullButton.disabled = !currentTraceId || fullOpenPending;
    status.hidden = false;
    status.textContent = currentTraceId ? "Поиск изменился. Нажмите «Обновить», чтобы построить текущий trace." : "Укажите один точный traceId в поиске Graylog.";
    uri.textContent = "initUri gateway определится после обновления.";
  }

  function latencyBand(milliseconds) {
    const value = Number(milliseconds);
    if (!Number.isFinite(value) || value < 0) return "";
    if (value < 100) return "fast";
    if (value < 500) return "normal";
    if (value < 1000) return "warning";
    if (value < 2000) return "slow";
    return "critical";
  }

  function latencyLabel(band) {
    return ({ fast: "быстро", normal: "нормально", warning: "заметно", slow: "медленно", critical: "критично" })[band] || "";
  }

  async function jumpToGraylogEvidence(evidence, field, button) {
    const ticket = generation;
    jumpStatus.hidden = false;
    jumpStatus.className = "jump-status";
    jumpStatus.textContent = "Ищу сообщение на текущей странице…";
    jumpDiagnostics.hidden=true;diagnosticText.textContent='';
    if (button) button.disabled = true;
    let result;
    try {
      result = await root.__advancedGraylogMessageBadges?.jumpToEvidence?.({eventKey:evidence?.eventKey,navigationKey:evidence?.navigationKey,field});
    } catch { result = {moved:false, reason:"unavailable"}; }
    finally { if (button?.isConnected) button.disabled = false; }
    if (ticket !== generation) return false;
    const moved = result?.moved === true;
    if(!moved&&result?.diagnostics){
      const d=result.diagnostics,safe={};
      for(const key of ['schema','rowsRead','indexedRows','nativeIdRows','errorRows','badges','pendingDecoration','identitylessRows','bridgeVersion','readerRowsRequested','readerRowsRead','readerRowsPublished','readerIndexedRows','readerNativeIdRows','readerErrorRows','readerIdentitylessRows','fieldsId','fieldsIndex','fieldsTimestamp','fieldsMessage','fieldsLevel'])if(Number.isSafeInteger(d[key])&&d[key]>=0)safe[key]=d[key];
      for(const key of ['targetNativeId','targetFingerprint','refreshComplete','canEventKey','canNavigationKey','canSourceEvidence'])if(typeof d[key]==='boolean')safe[key]=d[key];
      if(['not-on-page','stale','ambiguous','field-unavailable','index-unavailable','index-pending'].includes(d.reason))safe.reason=d.reason;
      if(['message','full_message','stack_trace','stacktrace','stackTrace','exception_stack_trace','exception_stacktrace','exceptionStackTrace'].includes(d.field))safe.field=d.field;
      diagnosticText.textContent=JSON.stringify(safe,null,2);jumpDiagnostics.hidden=false;
    }
    jumpStatus.className = `jump-status ${moved ? "success" : "missing"}`;
    jumpStatus.textContent = moved
      ? `Сообщение раскрыто, открыто исходное поле ${field}.`
      : ({ambiguous:"Несколько сообщений совпали. Автоматический переход отменён.",
          "index-unavailable":"Строки видны, но расширение не получило их идентификаторы. Это сбой чтения выдачи, а не отсутствие сообщения.",
          "index-pending":"Чтение строк ещё не завершено. Переход отложен, чтобы не мешать работе Graylog.",
          "field-unavailable":"Сообщение найдено, но нужное поле сейчас не отображается.",
          "not-on-page":"Не удалось сопоставить сообщение со строкой текущей выдачи Graylog.",
          stale:"Выдача изменилась. Обновите разбор перед переходом."})[result?.reason]
        || "Точный источник сейчас недоступен. Обновите выдачу и разбор.";
    if(moved && evidence?.sourceField===field)collapse();
    return moved;
  }

  function sourceButton(evidence) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "source-link";
    const label = document.createElement("span");
    label.textContent = "К стеку →";
    button.append(label);
    const site = evidence.stack;
    button.title = site?.method
      ? `${site.role==='enclosing-exception'?'Метод внешнего исключения':site.role==='reactor-assembly'?'Сборка реактивной операции':'Метод в стеке'}: ${site.method}${site.file ? ` (${site.file}:${site.line || "?"})` : ""}.${site.partial ? " Метод из начала стека; окончание не разобрано." : site.role==='enclosing-exception'?" Исходный вызов по этому методу не установлен.":""} Открыть поле ${evidence.sourceField}.`
      : `Открыть стек в ${evidence.sourceField}. Метод с файлом и номером строки не найден.`;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", () => jumpToGraylogEvidence(evidence, evidence.sourceField, button));
    return button;
  }

  function unavailableSource() {
    const hint = document.createElement("div"); hint.className = "source-unavailable";
    hint.textContent = "Стек не определён";
    return hint;
  }

  function select(view) {
    activeView = ["percentiles", "journal"].includes(view) ? view : "graph";
    graphTab.classList.toggle("active", activeView === "graph");
    percentilesTab.classList.toggle("active", activeView === "percentiles");
    journalTab.classList.toggle("active", activeView === "journal");
    graphPanel.hidden = activeView !== "graph";
    percentilePanel.hidden = activeView !== "percentiles";
    journalPanel.hidden = activeView !== "journal";
    // Журнал показывает прежние разборы, а нижняя кнопка действует на текущий
    // trace: в этом виде она не к месту, поэтому прячется целиком.
    fullButton.hidden = activeView === "journal";
    if (activeView !== "journal") {
      fullButton.textContent = activeView === "graph" ? (collectedReady ? "Открыть собранный граф" : "Граф текущей страницы") : "Открыть расчёт p95";
      fullButton.disabled = !currentTraceId || fullOpenPending || (collectingPages && !(collectedReady && activeView === 'graph'));
    }
    if (activeView === "journal") void renderRecentTraces();
    updateResume();
  }

  // «Показать всё» открывает вкладку «Журнал» в Сенсоре: в узкой панели
  // длинный список читать неудобно.
  async function openFullJournal() {
    try {
      const reply = await sendMessage({ type: "open-tools-from-graylog", view: "journal", sourceUrl: location.href });
      if (!reply?.opened) throw new Error(reply?.error || "Не удалось открыть Сенсор.");
    } catch (error) {
      status.hidden = false;
      status.textContent = error?.message || "Не удалось открыть журнал в Сенсоре.";
    }
  }

  function render(preview) {
    jumpStatus.hidden = true;
    summary.replaceChildren();
    const badges = [`${preview.nodes.length} компонентов`, `${preview.edges.length} связей`];
    if (preview.errorEvents !== null) badges.push(`${preview.errorEvents} ошибок`);
    for(const job of (preview.schedulerJobs||[]).slice(0,20))badges.push(`Шедулер · ${String(job).slice(0,160)}`);
    for (const [index, label] of badges.entries()) {
      const badge = document.createElement("span");
      badge.className = `badge${index === 2 && preview.errorEvents ? " error" : ""}`;
      badge.textContent = label;
      summary.append(badge);
    }
    if (preview.unboundErrors) {
      const badge = document.createElement("span"); badge.className = "badge";
      badge.textContent = `${preview.unboundErrors} ошибок без точного span`;
      badge.title = "Источник не привязан к компоненту: точного однозначного совпадения service и span нет.";
      summary.append(badge);
    }
    route.replaceChildren();
    const nodeByIndex = new Map(preview.nodes.map((node) => [node.index, node]));
    const parentsByChild = new Map();
    for (const edge of preview.edges) {
      if (!nodeByIndex.has(edge.from) || !nodeByIndex.has(edge.to)) continue;
      const parents = parentsByChild.get(edge.to) || [];
      parents.push(edge);
      parentsByChild.set(edge.to, parents);
    }
    for (const [position, node] of preview.nodes.entries()) {
      const group = document.createElement("div"); group.className = "node-group";
      group.style.setProperty("--depth", String(Math.max(0, Math.min(6, Number(node.depth) || 0))));
      const evidence = (Array.isArray(node.errorEvidence) ? node.errorEvidence : []).slice(0, 8);
      const card = document.createElement(node.failed ? "button" : "div");
      let choices = null;
      const band = latencyBand(node.durationMs);
      const slow = ["warning", "slow", "critical"].includes(band);
      const parents = parentsByChild.get(node.index) || [];
      card.className = `node${parents.length ? " child" : ""}${node.failed ? " failed" : slow ? " slow" : ""}`;
      card.style.setProperty("--depth", "0");
      if (['openapi-window','openapi-name-uri','openapi-gateway-window','partner-backend-window','partner-backend-name-uri','gateway-envelope'].includes(node.parentInference)) card.classList.add('inferred');
      if (node.reconstructedEntry) card.classList.add('reconstructed');
      if (node.parentInference === 'cross-service-response') card.classList.add('cross-service');
      if (node.failed) {
        card.type = "button";
        card.title = `Перейти к ошибке сервиса ${node.service} в Graylog`;
        card.setAttribute("aria-label", `Ошибка в ${node.service}. Перейти к сообщению в Graylog`);
        card.addEventListener("click", () => {
          if (evidence.length === 1) void jumpToGraylogEvidence(evidence[0], "message", card);
          else if (choices) { choices.open = true; choices.querySelector("button")?.focus(); }
          else { jumpStatus.hidden = false; jumpStatus.className = "jump-status missing"; jumpStatus.textContent = "Нет точной привязки к сообщению. Переход к другой ошибке сервиса не выполняется."; }
        });
      }
      const index = document.createElement("span"); index.className = "index"; index.textContent = String(position + 1);
      const body = document.createElement("div");
      const name = document.createElement("div"); name.className = "service"; name.textContent = node.service;
      if(node.jobNames?.length){const job=document.createElement('div');job.className='reconstruction-label';job.textContent='ШЕДУЛЕР · '+node.jobNames.join(' · ');body.append(job);}
      if (parents.length) {
        const relation = document.createElement("div");
        relation.className = "relation";
        const callers = parents.map((edge) => nodeByIndex.get(edge.from)?.service).filter(Boolean);
        const inferred = ['openapi-window','openapi-name-uri','openapi-gateway-window','partner-backend-window','partner-backend-name-uri','gateway-envelope'].includes(node.parentInference);
        const suffix = node.parentInference === 'openapi-name-uri' ? ' · OpenAPI: имя + URI'
          : node.parentInference === 'openapi-gateway-window' ? ' · через OpenAPI gateway'
          : node.parentInference === 'partner-backend-name-uri' ? ' · Partner Backend: имя + URI'
          : node.parentInference === 'partner-backend-window' ? ' · окно Partner Backend'
          : node.parentInference === 'gateway-envelope' ? ' · вход восстановлен'
            : node.parentInference === 'cross-service-response' ? ' · URI + время'
              : inferred ? ' · по времени' : parents.every((edge) => edge.responseObserved) ? " · ответ получен" : "";
        relation.textContent = node.parentInference === 'cross-service-response'
          ? `Вызов: ${callers.join(", ")} → ${node.service} · ответ: ${node.service} → ${callers.join(", ")} · URI + время`
          : `${inferred ? '◇' : '←'} ${callers.join(", ")}${suffix}`;
        if (inferred) relation.title = node.parentInference === 'openapi-name-uri' ? 'Ветка OpenAPI выбрана по окну времени и совпадению service-name с URI.'
          : node.parentInference === 'openapi-gateway-window' ? 'Операция попала во временное окно входящего запроса OpenAPI gateway; при нескольких gateway-кандидатах учитывается совпадение service-name и URI.'
          : node.parentInference === 'partner-backend-name-uri' ? 'Ветка PARTNER BACKEND выбрана по закрытому окну, URI и совпадению имени сервиса.'
          : node.parentInference === 'partner-backend-window' ? 'Операция попала в единственное закрытое окно PARTNER BACKEND.'
          : node.parentInference === 'gateway-envelope' ? 'Начальная запись REQUEST gateway потеряна; вход восстановлен по финальному RESPONSE.'
            : 'Ветка OpenAPI по времени; прямой вызов не подтверждён';
        body.append(name, relation);
      } else body.append(name);
      const meta = document.createElement("div"); meta.className = "meta";
      if (node.xmlProcedureName) meta.append(document.createTextNode(`Процедура: ${node.xmlProcedureName} `));
      const counters = [node.requestCount ? `REQ ${node.requestCount}` : "", node.responseCount ? `RESP ${node.responseCount}` : "", node.partnerBackendRequestCount ? `PARTNER REQ ${node.partnerBackendRequestCount}` : "", node.partnerBackendResponseCount ? `PARTNER RESP ${node.partnerBackendResponseCount}` : "", node.cacheCount ? `CACHE ${node.cacheCount}` : "", node.kafkaProduceCount ? `↑ Отправка Kafka ${node.kafkaProduceCount}` : "", node.kafkaConsumeCount ? `↓ Получение Kafka ${node.kafkaConsumeCount}` : "", node.kafkaBrokerCount ? `◇ Kafka · ${node.kafkaRoleHint === "produce" ? "вероятная отправка" : node.kafkaRoleHint === "consume" ? "вероятное получение" : "направление неизвестно"} ${node.kafkaBrokerCount}` : ""].filter(Boolean);
      if (counters.length) meta.append(document.createTextNode(counters.join(" · ")));
      if (Number.isFinite(node.durationMs)) {
        const latency = document.createElement("span");
        latency.className = `latency-pill band-${band}`;
        latency.textContent = `${Math.round(node.durationMs)} мс`;
        latency.title = `Скорость ответа: ${latencyLabel(band)}`;
        latency.setAttribute("aria-label", `Задержка ${Math.round(node.durationMs)} миллисекунд, ${latencyLabel(band)}`);
        meta.append(latency);
      }
      if (node.reconstructedEntry) { const label=document.createElement('span');label.className='reconstruction-label';label.textContent='ВХОД ВОССТАНОВЛЕН';meta.append(label); }
      if (node.duplicateGatewayEntries) { const label=document.createElement('span');label.className='duplicate-label';label.textContent=`ДУБЛЬ GATEWAY ×${node.duplicateGatewayEntries}`;meta.append(label); }
      if (node.failed) {
        const error = document.createElement("span"); error.className = "error-label"; error.textContent = "ОШИБКА"; meta.append(error);
        if (evidence.length === 1) { const hint = document.createElement("span");hint.className="message-hint";hint.textContent="К сообщению →";meta.append(hint); }
      }
      if (!meta.childNodes.length) meta.textContent = "Служебный span";
      body.append(meta); card.append(index, body); group.append(card);
      if (node.failed) {
        if (evidence.length === 1 && evidence[0].sourceField) {
          const source = document.createElement("div"); source.className = "source-row";
          source.append(sourceButton(evidence[0])); group.append(source);
        } else if (evidence.length > 1) {
          choices = document.createElement("details"); choices.className = "evidence-choices";
          const heading = document.createElement("summary"); heading.textContent = `${evidence.length} ошибок · выбрать запись`;
          choices.append(heading);
          const help = document.createElement("p");help.className="evidence-help";help.textContent="Сообщение — запись в выдаче. Стек — детали той же записи.";choices.append(help);
          evidence.forEach((item, ordinal) => {
            const row = document.createElement("div"); row.className = "evidence-choice";
            const message = document.createElement("button"); message.type = "button"; message.className = "source-link message-link";
            message.textContent = `${ordinal + 1} · К сообщению`;
            message.addEventListener("click", () => jumpToGraylogEvidence(item, "message", message));
            row.append(message, item.sourceField ? sourceButton(item) : unavailableSource()); choices.append(row);
          });
          group.append(choices);
        } else group.append(unavailableSource());
      }
      route.append(group);
    }
    status.hidden = preview.nodes.length > 0;
    if (!preview.nodes.length) { status.hidden = false; status.textContent = "В текущей выдаче компоненты этого trace не найдены. Дождитесь результатов Graylog или откройте полный граф."; }
    // Для разбора текущей страницы percentileContext не вычисляется вовсе,
    // но саму ручку показать можно: она есть в сообщениях gateway. Расчёт
    // процентилей по ней не разрешён — об этом и говорит текст ниже.
    const observed = Array.isArray(preview.observedInitUris) ? preview.observedInitUris : [];
    uri.textContent = preview.initUri || (observed.length === 1
      ? `${observed[0]} · расчёт процентилей — отдельной кнопкой ниже`
      : observed.length > 1
        ? `${observed[0]} и ещё ${observed.length - 1}: в gateway несколько initUri`
        : "") || ({
      "page-only": "Расчёт выполнится отдельно по gateway и выбранному периоду после нажатия кнопки ниже.",
      missing: "В сообщениях gateway этого trace нет initUri.",
      ambiguous: "В gateway найдено несколько initUri — однозначный расчёт недоступен.",
      invalid: "initUri gateway имеет неподдерживаемый формат.",
      incomplete: "Не удалось полностью проверить initUri gateway. Повторите загрузку."
    })[preview.percentileContextStatus] || "initUri gateway пока не определён.";
    if (preview.truncated) {
      const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = "Показана часть"; summary.append(badge);
    }
    if(preview.contentTruncated){
      const badge=document.createElement('span');badge.className='badge';badge.textContent='Тексты сокращены';badge.title='Длинные message/full_message прочитаны частично. Связи и ошибки за пределами прочитанного текста могут быть пропущены; оригиналы в Graylog не изменены.';summary.append(badge);
    }
  }

  async function load() {
    if (runtime && !runtime.available()) return;
    syncContext(readContext());
    if (!currentTraceId) return;
    // A second click for the same trace joins the visible operation. Cancelling
    // the browser-side waiter would not guarantee that Graylog stops its request.
    if (activeRequestId || collectingPages || fullOpenPending) return;
    collectedReady=false; select(activeView);
    cancelPendingPreview();
    const ticket = ++generation;
    hasResult = false;
    const requestId = `${Date.now()}-${ticket}-${Math.random().toString(36).slice(2)}`;
    activeRequestId = requestId;
    root.__advancedGraylogClippy?.beginCancelableOperation?.({token:requestId,kind:"compact-graph",cancel:cancelPendingPreview});
    refreshButton.disabled = true;
    drawer.setAttribute("aria-busy", "true");
    status.hidden = false;
    status.textContent = "Разбираю сообщения текущей страницы…";
    uri.textContent = "Процентили gateway рассчитываются отдельно по нажатию.";
    route.replaceChildren();
    summary.replaceChildren();
    try {
      const reply = await sendMessage({ type: "preview-trace-from-graylog", requestId, traceId: currentTraceId, sourceUrl: currentSourceUrl });
      syncContext(readContext());
      if (ticket !== generation) return;
      if (!reply?.ok) throw new Error(reply?.error || "Не удалось построить preview.");
      render(reply.preview);
      hasResult = true;
      void inspectPages();
      if (reply.preview.nodes.length > 0) void recordRecentTrace(currentTraceId, currentSourceUrl, reply.preview);
      root.__advancedGraylogClippy?.reportPreview?.({traceId:currentTraceId,sourceUrl:currentSourceUrl,errorEvents:reply.preview.errorEvents});
    } catch (error) {
      syncContext(readContext());
      if (ticket !== generation) return;
      status.hidden = false;
      status.textContent = error?.message || String(error);
      uri.textContent = "initUri gateway не проверен — загрузка завершилась ошибкой.";
    } finally {
      if(activeRequestId===requestId)activeRequestId=null;
      root.__advancedGraylogClippy?.endCancelableOperation?.(requestId);
      if (ticket === generation) {
        refreshButton.disabled = false;
        drawer.setAttribute("aria-busy", "false");
      }
    }
  }

  function open(traceId, view = "graph") {
    syncContext(readContext(traceId));
    collapsed = false;
    drawer.hidden = false;
    resume.hidden = true;
    select(view);
    drawer.classList.add("open");
    root.__advancedGraylogClippy?.setPanelOpen?.(true);
    void renderRecentTraces();
    load();
  }

  // An explicit assistant action may reveal the result already loaded for this
  // exact context. Merely receiving a finding never starts a request.
  function reveal(traceId, view = "graph") {
    syncContext(readContext(traceId));
    if (!hasResult) { open(traceId, view); return; }
    collapsed = false; drawer.hidden = false; resume.hidden = true;
    select(view); drawer.classList.add("open");
    root.__advancedGraylogClippy?.setPanelOpen?.(true);
  }

  function collapse() {
    if (!drawer.classList.contains("open") || collapsed) return;
    savedScroll = { graph: graphPanel.scrollTop, percentiles: percentilePanel.scrollTop };
    collapsed = true;
    root.__advancedGraylogClippy?.setPanelOpen?.(false);
    drawer.hidden = true;
    resume.hidden = false;
    updateResume();
    restoreButton.focus();
  }

  function restore() {
    if (!collapsed) return;
    // Re-check context, but never repeat a request merely to reveal this card.
    syncContext(readContext());
    collapsed = false;
    drawer.hidden = false;
    resume.hidden = true;
    graphPanel.scrollTop = savedScroll.graph;
    root.__advancedGraylogClippy?.setPanelOpen?.(true);
    percentilePanel.scrollTop = savedScroll.percentiles;
    collapseButton.focus();
  }

  function close() { root.__advancedGraylogClippy?.setPanelOpen?.(false); cancelPendingPreview(); if(collectingPages)void stopPages(); generation += 1; collapsed = false; resume.hidden = true; drawer.hidden = false; drawer.classList.remove("open"); drawer.setAttribute("aria-busy", "false"); refreshButton.disabled = !currentTraceId; fullButton.disabled = !currentTraceId || fullOpenPending; root.__advancedGraylogClippy?.focusTraceTools?.(activeView); }
  closeButton.addEventListener("click", close);
  collapseButton.addEventListener("click", collapse);
  restoreButton.addEventListener("click", restore);
  resume.querySelector(".resume-close").addEventListener("click", close);
  graphTab.addEventListener("click", () => select("graph"));
  percentilesTab.addEventListener("click", () => select("percentiles"));
  refreshButton.addEventListener("click", load);
  async function openFullView() {
    syncContext(readContext());
    if ((collectingPages && !(collectedReady && activeView === 'graph')) || activeRequestId || fullOpenPending || !/^[a-z0-9_-]{1,128}$/i.test(currentTraceId)) return;
    fullOpenPending = true;
    fullButton.disabled = true;
    const ticket = generation;
    try {
      const reply = await sendMessage({
        type: activeView === "graph" ? (collectedReady ? "open-collected-trace" : "open-current-page-trace") : "open-tools-from-graylog",
        view: activeView === "graph" ? "search" : "percentiles",
        traceId: currentTraceId,
        sourceUrl: location.href,
        autoGraph: false,
        nativeSnapshotExact: false,
        autoPercentiles: activeView === "percentiles"
      });
      if (!reply?.opened) throw new Error(reply?.error || "Не удалось открыть расширение.");
    } catch (error) {
      if (ticket !== generation) return;
      status.hidden = false;
      status.textContent = error?.message || "Не удалось открыть расширение.";
    } finally {
      fullOpenPending = false;
      fullButton.disabled = !currentTraceId || (collectingPages && !(collectedReady && activeView === 'graph'));
    }
  }
  fullButton.addEventListener("click", openFullView);
  // Only keys from our panel can dismiss it. Escape in the native query editor
  // belongs to Graylog (for example, closing its completion list).
  function onEscape(event) { if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing && drawer.classList.contains("open")) close(); }
  shadow.addEventListener("keydown", onEscape);
  // The guided tour exposes local controls without loading or changing Graylog.
  let tourState = null;
  function beginTour() {
    if (tourState) return;
    tourState = { open: drawer.classList.contains("open"), collapsed, view: activeView,
      graphScroll: graphPanel.scrollTop, percentileScroll: percentilePanel.scrollTop };
    collapsed = false; drawer.hidden = false; resume.hidden = true;
    drawer.classList.add("open"); select("graph");
    root.__advancedGraylogClippy?.setPanelOpen?.(true);
  }
  function getTourTarget(name) {
    if (name === "percentiles") select("percentiles");
    else if (name === "summary" || name === "collection" || name === "full") select("graph");
    const target = ({ summary: summary.childElementCount ? summary : status.hidden ? graphTab : status,
      collection: pagesCard.hidden ? fullButton : pagesCard, percentiles: percentilePanel,
      collapse: collapseButton, full: fullButton })[name] || drawer;
    if (name === "summary" || name === "collection") graphPanel.scrollTop = 0;
    return target;
  }
  function endTour() {
    if (!tourState) return;
    const saved = tourState; tourState = null;
    select(saved.view); collapsed = saved.collapsed;
    drawer.classList.toggle("open", saved.open); drawer.hidden = saved.collapsed;
    resume.hidden = !saved.collapsed;
    graphPanel.scrollTop = saved.graphScroll; percentilePanel.scrollTop = saved.percentileScroll;
    root.__advancedGraylogClippy?.setPanelOpen?.(saved.open && !saved.collapsed);
  }
  function dispose() {
    generation++;
    if(collectingPages)void stopPages();
    clearTimeout(pagesProgressTimer);
    cancelPendingPreview();
    drawer.setAttribute("aria-busy","false");
    shadow.removeEventListener("keydown",onEscape);
    host.remove();
    if(root.GraylogPreviewPanel?.dispose===dispose)delete root.GraylogPreviewPanel;
  }
  root.GraylogPreviewPanel = Object.freeze({ open, reveal, close, collapse, restore, syncContext, dispose, beginTour, getTourTarget, endTour, getState: () => ({ open: drawer.classList.contains("open"), collapsed, view: activeView, traceId: currentTraceId, loading: Boolean(activeRequestId), collectingPages, collectedReady, openingFull: fullOpenPending }) });
  runtime?.onInvalidated(dispose);
})(globalThis);
