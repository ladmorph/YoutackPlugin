(function installPreviewOnboarding(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document?.documentElement || root.GraylogPreviewOnboarding) return;
  if (root.GraylogPage && !root.GraylogPage.isSupported(root.document, root.location)) return;
  root.GraylogPreviewOnboarding = api.create(root);
})(globalThis, function previewOnboardingModule() {
  'use strict';
  const steps = Object.freeze([
    { target: 'summary', title: 'Я покажу короткий путь', text: 'Вставьте один traceId в поиск Graylog. «Давай разберёмся» открывает схему по сообщениям текущей страницы — можно быстро увидеть маршрут, задержки и ошибки.', scene: 'trace' },
    { target: 'collection', title: 'Дополним историю', text: 'Если в выдаче от 2 до 5 страниц, «Собрать страницы» последовательно перелистает их и вернётся на первую. После каждой готовой страницы — пауза 100 мс. Красный «Стоп» останавливает сбор.', scene: 'graph' },
    { target: 'summary', title: 'От схемы — к сообщению', text: 'Цвет времени подсказывает задержку. Красная карточка ведёт к сообщению с ошибкой, а «Источник» — к полю со стеком. Связи показывают найденный путь вызовов.', scene: 'warning' },
    { target: 'percentiles', title: 'Посмотрим на gateway', text: 'Здесь отдельный расчёт p95 и p99 по initUri gateway за выбранный период. Он запускается только вашей кнопкой. Шаги обучения ничего не запрашивают.', scene: 'percentiles' },
    { target: 'full', title: 'Когда нужен большой граф', text: 'Отдельное окно показывает текущую страницу или уже собранные страницы без повторного поиска. Если нужен прежний ограниченный поиск по настроенным streams, он остаётся во вкладке «Поиск» расширения.', scene: 'graph' },
    { target: 'collapse', title: 'Освободим место', text: 'Минус сворачивает панель и сохраняет результат. Нажмите «Вернуться к схеме», чтобы продолжить. Крестик закрывает панель. Я остаюсь рядом — обучение всегда доступно по «?».', scene: 'success' }
  ]);

  function place(rect, width, height, viewport) {
    const gap = 16, pad = 12;
    const maxX = Math.max(pad, viewport.width - width - pad), maxY = Math.max(pad, viewport.height - height - pad);
    let x = rect.left - width - gap, y = rect.top + Math.min(rect.height, 80) / 2 - height / 2;
    if (x < pad) { x = rect.right + gap; if (x > maxX) { x = rect.left; y = rect.bottom + gap; if (y > maxY) y = rect.top - height - gap; } }
    return { x: Math.max(pad, Math.min(maxX, x)), y: Math.max(pad, Math.min(maxY, y)) };
  }

  function create(env) {
    const doc = env.document;
    let active = false, index = 0, host = null, shadow = null, coach = null, ring = null, title = null, text = null, counter = null, back = null, next = null, closeButton = null, actor = null, oldFocus = null, panelTicket = null, frame = null, teleportTimer = null;
    const companion = () => env.__advancedGraylogClippy;
    const panel = () => env.GraylogPreviewPanel;
    const asset = path => env.GraylogRuntime?.getURL?.(path) || env.chrome?.runtime?.getURL?.(path) || path;
    function ensure() {
      if (host) return;
      host = doc.createElement('div'); host.id = 'advanced-graylog-preview-onboarding';
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
      shadow = host.attachShadow({ mode: 'closed' });
      const style = doc.createElement('style');
      style.textContent = `:host{all:initial}*{box-sizing:border-box}.coach{position:fixed;width:min(300px,calc(100vw - 24px));padding:20px 16px 14px;border:1px solid #c8e0e3;border-radius:14px;background:#fff;color:#29464e;box-shadow:0 9px 28px #254b5529;pointer-events:auto;font:12px/1.5 system-ui,sans-serif;isolation:isolate}.coach.teleport{animation:materialize .72s cubic-bezier(.2,.82,.2,1) both}.mini{position:absolute;top:-51px;left:9px;width:69px;height:79px;filter:drop-shadow(0 3px 4px #2b859033);pointer-events:none}.mini img{width:100%;height:100%;object-fit:contain}h2{margin:5px 18px 8px 0;font-size:15px;font-weight:650;line-height:1.3}p{margin:0;color:#536d75}.step{display:block;margin:0 24px 7px 67px;color:#61929b;font-size:10px;letter-spacing:.08em}.controls{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px}button{padding:6px 11px;border:1px solid #d4e2e5;border-radius:6px;background:#fff;color:#416f79;cursor:pointer;font:500 12px/1.3 system-ui,sans-serif}button:hover{background:#edf7f8}button:focus-visible{outline:2px solid #208191;outline-offset:3px}button:disabled{opacity:.35;cursor:default}.next{background:#287b88;color:#fff;border-color:#287b88}.next:hover{background:#206875}.close{position:absolute;right:8px;top:7px;padding:0;width:25px;height:25px;border:0;color:#768e94;font-size:19px}.ring{position:fixed;border:2px solid #52aab7;border-radius:9px;box-shadow:0 0 0 4px #84c6ce22;pointer-events:none;transition:all .18s ease}.portal{position:fixed;width:62px;height:82px;pointer-events:none;transform:translate(-50%,-50%)}.portal::before{content:"";position:absolute;left:50%;top:-8px;width:6px;height:98px;border-radius:99px;background:linear-gradient(180deg,transparent,#79fff4 25%,#2fcfc4 60%,transparent);box-shadow:0 0 10px #5bf5ec,0 0 22px #39d8cb;transform:translateX(-50%)}.portal::after{content:"";position:absolute;inset:14px 4px;border:2px solid #4cd4c8;border-radius:50%}.portal.departure::before{animation:departBeam .22s ease-in both}.portal.departure::after{animation:departRing .22s ease-in both}.portal.arrival::before{animation:arriveBeam .34s .28s ease-out both}.portal.arrival::after{animation:arriveRing .34s .28s ease-out both}.escape{font-size:10px;color:#94a4a9;margin-top:9px}@keyframes materialize{0%,40%{opacity:0;transform:scaleX(.1) scaleY(1.15);filter:brightness(2.4)}72%{opacity:1;transform:scale(1.04,.97);filter:brightness(1.15)}100%{opacity:1;transform:none;filter:none}}@keyframes departBeam{0%{opacity:0;transform:translateX(-50%) scaleY(.2)}45%{opacity:1;transform:translateX(-50%) scaleY(1)}100%{opacity:0;transform:translateX(-50%) scaleX(2) scaleY(.25)}}@keyframes departRing{0%{opacity:0;transform:scale(1.3)}45%{opacity:1}100%{opacity:0;transform:scale(.2)}}@keyframes arriveBeam{0%{opacity:0;transform:translateX(-50%) scaleX(2) scaleY(.25)}45%{opacity:1;transform:translateX(-50%) scaleY(1)}100%{opacity:0;transform:translateX(-50%) scaleY(.1)}}@keyframes arriveRing{0%{opacity:0;transform:scale(.2)}60%{opacity:1;transform:scale(1.08)}100%{opacity:0;transform:scale(1.45)}}@media(prefers-reduced-motion:reduce){.coach,.ring{transition:none}.coach.teleport,.portal::before,.portal::after{animation:none}}`;
      ring = doc.createElement('div'); ring.className = 'ring'; ring.setAttribute('aria-hidden', 'true');
      coach = doc.createElement('section'); coach.className = 'coach'; coach.setAttribute('role', 'dialog'); coach.setAttribute('aria-label', 'Обучение с Сенсором');
      const mini = doc.createElement('div'); mini.className = 'mini'; mini.setAttribute('aria-hidden', 'true');
      const img = doc.createElement('img'); img.alt = ''; img.src = asset('extension/graylog/living-signal-mascot.png'); mini.append(img);
      counter = doc.createElement('span'); counter.className = 'step'; title = doc.createElement('h2'); text = doc.createElement('p');
      const explanation = doc.createElement('div'); explanation.setAttribute('aria-live', 'polite'); explanation.append(counter, title, text);
      closeButton = doc.createElement('button'); closeButton.className = 'close'; closeButton.textContent = '×'; closeButton.setAttribute('aria-label', 'Закрыть обучение');
      back = doc.createElement('button'); back.textContent = 'Назад'; next = doc.createElement('button'); next.className = 'next';
      const controls = doc.createElement('div'); controls.className = 'controls'; controls.append(back, next);
      const escape = doc.createElement('div'); escape.className = 'escape'; escape.textContent = 'Esc — закончить обучение';
      coach.append(mini, explanation, closeButton, controls, escape);
      if (typeof env.CSSStyleSheet === 'function' && 'adoptedStyleSheets' in shadow) { const sheet = new env.CSSStyleSheet(); sheet.replaceSync(style.textContent); shadow.adoptedStyleSheets = [sheet]; shadow.append(ring, coach); }
      else shadow.append(style, ring, coach);
      doc.documentElement.append(host);
      actor = env.SensorMascot?.mount(mini, { baseUrl: img.src, waveUrl: asset('extension/graylog/living-signal-mascot-wave.png') });
      if (actor) img.hidden = true;
      actor?.setIntro('final');
      closeButton.addEventListener('click', finish); back.addEventListener('click', () => move(-1)); next.addEventListener('click', () => move(1));
    }
    function teleport(sourceRect, destination) {
      if (!sourceRect || env.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      clearTimeout(teleportTimer);shadow.querySelectorAll?.('.portal')?.forEach(item => item.remove());
      const departure = doc.createElement('i'), arrival = doc.createElement('i');
      departure.className = 'portal departure'; arrival.className = 'portal arrival';
      departure.style.left = `${sourceRect.left + sourceRect.width / 2}px`; departure.style.top = `${sourceRect.top + Math.min(sourceRect.height, 80) / 2}px`;
      arrival.style.left = `${destination.x + 43}px`; arrival.style.top = `${destination.y - 10}px`;
      shadow.append(departure, arrival);coach.classList?.remove?.('teleport');void coach.offsetWidth;coach.classList?.add?.('teleport');
      teleportTimer = setTimeout(() => { departure.remove(); arrival.remove(); coach?.classList?.remove?.('teleport'); }, 820);
    }
    function layout(initial = false, animate = false) {
      if (!active) return;
      const target = panel()?.getTourTarget?.(steps[index].target) || companion()?.getTourAnchor?.('figure');
      const rect = target?.getBoundingClientRect?.();
      if (!rect || !rect.width || !rect.height) { ring.hidden = true; return; }
      ring.hidden = false;
      Object.assign(ring.style, { left: `${Math.max(2, rect.left - 3)}px`, top: `${Math.max(2, rect.top - 3)}px`, width: `${Math.min(env.innerWidth - 4, rect.width + 6)}px`, height: `${Math.min(env.innerHeight - 4, rect.height + 6)}px` });
      const previous = coach.getBoundingClientRect();
      const width = Math.min(300, env.innerWidth - 24), height = previous.height || 235;
      const position = place(rect, width, height, { width: env.innerWidth, height: env.innerHeight });
      coach.style.left = `${position.x}px`; coach.style.top = `${Math.max(58, position.y)}px`;
      const destination = {x:position.x,y:Math.max(58,position.y)};
      if (initial) teleport(companion()?.getTourAnchor?.('figure')?.getBoundingClientRect?.(), destination);
      else if (animate && (Math.abs(previous.left - destination.x) > 4 || Math.abs(previous.top - destination.y) > 4)) teleport(previous, destination);
    }
    function render(initial = false) {
      const step = steps[index]; title.textContent = step.title; text.textContent = step.text; counter.textContent = `СЕНСОР · ${index + 1} / ${steps.length}`;
      back.disabled = index === 0; next.textContent = index === steps.length - 1 ? 'Понятно!' : 'Дальше →';
      actor?.setState(step.scene); layout(initial, !initial); if (!initial) next.focus({ preventScroll: true });
    }
    function move(delta) { if (!active) return; const value = index + delta; if (value >= steps.length) { finish(); return; } index = Math.max(0, value); render(); }
    function start() {
      if (active) { next?.focus({ preventScroll: true }); return false; }
      if (!companion() || !panel()?.beginTour) return false;
      const state = panel().getState?.() || {};
      if (state.loading || state.openingFull || state.collectingPages || companion().getState?.().cancelCount > 0) return false;
      oldFocus = companion().getTourAnchor?.('launch') || doc.activeElement;
      companion().setTourActive(true); panelTicket = panel().beginTour();
      active = true; index = 0; ensure(); host.hidden = false;
      doc.addEventListener('keydown', keydown, true); env.addEventListener('resize', reposition, { passive: true }); env.addEventListener('pagehide', finish, { once: true });
      render(true); next.focus({ preventScroll: true }); return true;
    }
    function keydown(event) {
      if (!active || event.key !== 'Escape') return;
      // The tour owns Escape only while focus is inside its isolated dialog.
      if (event.composedPath?.().includes(host) || doc.activeElement === host) { event.preventDefault(); event.stopPropagation(); finish(); }
    }
    function reposition() { if (frame !== null) return; frame = env.requestAnimationFrame(() => { frame = null; layout(); }); }
    function finish() {
      if (!active) return; active = false;
      doc.removeEventListener('keydown', keydown, true); env.removeEventListener('resize', reposition); env.removeEventListener('pagehide', finish);
      if (frame !== null) env.cancelAnimationFrame(frame); frame = null; clearTimeout(teleportTimer); teleportTimer = null;
      actor?.dispose(); actor = null; host?.remove(); host = null;
      panel()?.endTour?.(panelTicket); panelTicket = null; companion()?.setTourActive(false);
      if (oldFocus?.isConnected) oldFocus.focus({ preventScroll: true }); oldFocus = null;
    }
    env.GraylogRuntime?.onInvalidated?.(finish);
    return Object.freeze({ start, close: finish, next: () => move(1), back: () => move(-1), getState: () => ({ active, step: active ? index + 1 : 0, total: steps.length }) });
  }
  return Object.freeze({ create, place, steps });
});
