(function installSensorMascot() {
  "use strict";
  if (globalThis.SensorMascot) return;

  // The original volumetric artwork remains the shell. Only its face and the
  // raised arm are articulated; this module never reads page content.
  const css = `
    :host{display:block;width:100%;height:100%;pointer-events:none}
    svg{display:block;width:100%;height:100%;overflow:visible}
    .actor{transform-origin:625px 1120px;animation:live-settle 5.6s ease-in-out infinite}
    .raised,.walk-rig{opacity:0}.arm{transform-origin:472px 849px}
    .walk-rig{transition:opacity .12s}.walk-leg-left{transform-origin:548px 1042px}.walk-leg-right{transform-origin:748px 1042px}
    .face{transform-origin:693px 589px}
    .gaze{transform:translate(var(--gaze-x,0px),var(--gaze-y,0px));transition:transform .24s ease-out}
    .eye-left{transform-origin:600px 601px}.eye-right{transform-origin:829px 574px}
    .eye-left,.eye-right{animation:live-blink 6.4s linear infinite}
    .look{animation:live-look 11s ease-in-out infinite}
    .happy-eyes,.alert-mouth,.smile,.brows,.scan,.scene-prop{opacity:0;transition:opacity .2s}
    .rest-mouth{opacity:.78}.scan{transform-origin:698px 602px}
    [data-expression="curious"] .look,[data-expression="greeting"] .look{animation:none}
    [data-expression="curious"] .brows{opacity:.6;transform:translateY(-9px)}
    [data-expression="curious"] .smile{opacity:.8}
    [data-expression="curious"] .rest-mouth{opacity:0}
    [data-expression="focus"] .look{animation:live-search 2.1s ease-in-out infinite}
    [data-expression="focus"] .brows{opacity:.85}
    [data-expression="focus"] .scan{opacity:.55;animation:live-scan 2.1s ease-in-out infinite}
    [data-expression="focus"] .actor{animation:live-attention 2.8s ease-in-out infinite}
    [data-expression="warning"] .open-eyes{transform:translateY(-4px) scaleY(1.08);transform-origin:700px 590px}
    [data-expression="warning"] .eye-left,[data-expression="warning"] .eye-right{animation-duration:3.9s}
    [data-expression="warning"] .look{animation:none}
    [data-expression="warning"] .brows{opacity:.8;transform:translateY(-22px)}
    [data-expression="warning"] .alert-mouth{opacity:1}
    [data-expression="warning"] .rest-mouth{opacity:0}
    [data-expression="warning"] .actor{animation:live-notice .65s ease-in-out 1}
    [data-expression="happy"] .open-eyes,[data-expression="greeting"] .open-eyes{opacity:0}
    [data-expression="happy"] .happy-eyes,[data-expression="greeting"] .happy-eyes{opacity:1}
    [data-expression="happy"] .smile,[data-expression="greeting"] .smile{opacity:.9}
    [data-expression="happy"] .rest-mouth,[data-expression="greeting"] .rest-mouth{opacity:0}
    [data-expression="happy"] .actor{animation:live-nod .9s ease-in-out 2}
    [data-wave="true"] .rest{opacity:0}
    [data-wave="true"] .raised{opacity:1}
    [data-wave="true"] .arm{animation:live-wave .58s ease-in-out 3}
    [data-wave="true"] .actor{animation:live-nod 1.15s ease-in-out 2}
    [data-scene="patrol"] .rest{opacity:0}
    [data-scene="patrol"] .walk-rig{opacity:1}
    [data-scene="patrol"] .actor{animation:live-walk-body .54s ease-in-out infinite}
    [data-scene="patrol"] .walk-leg-left{animation:live-step-left .54s ease-in-out infinite}
    [data-scene="patrol"] .walk-leg-right{animation:live-step-right .54s ease-in-out infinite}
    [data-scene="patrol"] .look{animation:live-patrol-look 2.4s ease-in-out infinite}
    [data-scene="inspect"] .actor{animation:live-inspect 1.35s ease-in-out infinite}
    [data-scene="inspect"] .inspect-tool{opacity:1;animation:live-magnifier 1.35s ease-in-out infinite}
    [data-scene="inspect"] .look{animation:live-inspect-look 1.35s ease-in-out infinite}
    [data-scene="scan"] .actor{animation:live-scan-lean 1.6s ease-in-out infinite}
    [data-scene="scan"] .scan{opacity:.85;animation:live-scan .95s ease-in-out infinite}
    [data-scene="scan"] .scan-band{opacity:.72;animation:live-scan-band 1.3s ease-in-out infinite}
    [data-scene="point"] .rest{opacity:0}
    [data-scene="point"] .raised{opacity:1}
    [data-scene="point"] .actor{animation:live-point-lean 1.1s ease-in-out infinite}
    [data-scene="point"] .arm{animation:live-point .7s ease-in-out infinite}
    [data-scene="point"] .look{animation:none;transform:translate(-14px,-7px)}
    [data-scene="point"] .point-signal{opacity:1;animation:live-point-signal 1s ease-out infinite}
    [data-scene="celebrate"] .rest{opacity:0}
    [data-scene="celebrate"] .raised{opacity:1}
    [data-scene="celebrate"] .arm{animation:live-wave .38s ease-in-out 7}
    [data-scene="celebrate"] .actor{animation:live-celebrate .62s ease-in-out 4}
    [data-scene="celebrate"] .celebrate-sparks{opacity:1;animation:live-sparks .8s ease-out 4}
    [data-scene="alert"] .actor{animation:live-alert-shake .42s ease-in-out 5}
    [data-scene="alert"] .brows{opacity:.9;transform:translateY(-22px)}
    [data-scene="alert"] .alert-mouth{opacity:1}
    [data-scene="alert"] .rest-mouth{opacity:0}
    [data-scene="alert"] .alert-signal{opacity:1;animation:live-alert-signal .72s ease-in-out infinite}
    .rest,.raised{transition:opacity .14s}
    [data-motion="false"] *,[data-paused="true"] *{animation:none!important;transition:none!important}
    [data-motion="false"] .gaze{transform:none}
    @keyframes live-blink{0%,36%,40%,74%,78%,81%,85%,100%{transform:scaleY(1)}38%,76%,83%{transform:scaleY(.08)}}
    @keyframes live-look{0%,18%,48%,100%{transform:translate(0,0)}23%,39%{transform:translate(-18px,-5px)}60%,74%{transform:translate(15px,4px)}}
    @keyframes live-search{0%,100%{transform:translate(-22px,0)}50%{transform:translate(23px,-3px)}}
    @keyframes live-scan{0%,100%{transform:translateX(-85px);opacity:.15}50%{transform:translateX(82px);opacity:.55}}
    @keyframes live-wave{0%,100%{transform:rotate(0deg)}30%{transform:rotate(10deg)}70%{transform:rotate(-9deg)}}
    @keyframes live-settle{0%,100%{transform:translateY(0) rotate(-.35deg)}50%{transform:translateY(-8px) rotate(.35deg)}}
    @keyframes live-attention{0%,100%{transform:rotate(-.7deg)}50%{transform:rotate(1deg)}}
    @keyframes live-nod{0%,100%{transform:translateY(0) rotate(0)}42%{transform:translateY(-16px) rotate(-2deg)}70%{transform:translateY(3px) rotate(1deg)}}
    @keyframes live-notice{0%,100%{transform:rotate(0)}30%{transform:rotate(-2.4deg)}70%{transform:rotate(1.6deg)}}
    @keyframes live-walk-body{0%,50%,100%{transform:translateY(0) rotate(0)}25%{transform:translateY(-24px) rotate(2deg)}75%{transform:translateY(-24px) rotate(-2deg)}}
    @keyframes live-step-left{0%,100%{transform:rotate(-15deg) translateY(2px)}50%{transform:rotate(18deg) translateY(-12px)}}
    @keyframes live-step-right{0%,100%{transform:rotate(18deg) translateY(-12px)}50%{transform:rotate(-15deg) translateY(2px)}}
    @keyframes live-patrol-look{0%,42%,100%{transform:translate(-16px,-2px)}50%,92%{transform:translate(17px,-2px)}}
    @keyframes live-inspect{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-12px) rotate(3deg)}}
    @keyframes live-inspect-look{0%,100%{transform:translate(14px,8px)}50%{transform:translate(28px,14px)}}
    @keyframes live-magnifier{0%,100%{transform:translate(-18px,8px) rotate(-8deg)}50%{transform:translate(14px,-16px) rotate(7deg)}}
    @keyframes live-scan-lean{0%,100%{transform:translateX(-10px) rotate(-2deg)}50%{transform:translateX(14px) rotate(2deg)}}
    @keyframes live-scan-band{0%,100%{transform:translateX(-110px) scaleX(.35);opacity:.15}50%{transform:translateX(100px) scaleX(1);opacity:.78}}
    @keyframes live-point{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(22deg)}}
    @keyframes live-point-lean{0%,100%{transform:translateX(0) rotate(0)}50%{transform:translateX(-18px) rotate(-4deg)}}
    @keyframes live-point-signal{0%{transform:scale(.45);opacity:1}75%,100%{transform:scale(1.55);opacity:0}}
    @keyframes live-celebrate{0%,100%{transform:translateY(0) rotate(0)}42%{transform:translateY(-48px) rotate(-5deg)}72%{transform:translateY(6px) rotate(3deg)}}
    @keyframes live-sparks{0%{transform:scale(.55) rotate(-8deg);opacity:0}35%{opacity:1}100%{transform:scale(1.18) rotate(8deg);opacity:0}}
    @keyframes live-alert-shake{0%,100%{transform:translateX(0) rotate(0)}25%{transform:translateX(-18px) rotate(-3deg)}75%{transform:translateX(18px) rotate(3deg)}}
    @keyframes live-alert-signal{0%,100%{transform:scale(.88);opacity:.55}50%{transform:scale(1.12);opacity:1}}
    @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.gaze{transform:none}}
  `;

  function mount(figure, { baseUrl, waveUrl }) {
    const element = document.createElement("span");
    element.className = "sensor-live";
    element.setAttribute("aria-hidden", "true");
    const shadow = element.attachShadow({mode:"open"});
    const markup = `<svg viewBox="0 0 1254 1254" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="live-face" cx="69%" cy="22%" r="94%"><stop stop-color="#fff"/><stop offset=".48" stop-color="#f7f7f7"/><stop offset=".84" stop-color="#e3e3e3"/><stop offset="1" stop-color="#c4c6c7"/></radialGradient>
        <linearGradient id="live-eye" x1="0" y1="0" x2=".3" y2="1"><stop stop-color="#151e23"/><stop offset=".6" stop-color="#243a43"/><stop offset="1" stop-color="#47dfef"/></linearGradient>
        <radialGradient id="live-iris"><stop stop-color="#d2ffff"/><stop offset=".65" stop-color="#64eff7"/><stop offset="1" stop-color="#39c9df" stop-opacity=".1"/></radialGradient>
        <clipPath id="live-arm"><path d="M254 731Q257 671 329 698Q356 645 390 677Q417 694 423 751Q438 796 504 820L505 883Q473 912 409 891Q324 867 282 801Q255 766 254 731Z"/></clipPath>
        <mask id="live-body"><rect width="1254" height="1254" fill="white"/><path d="M254 731Q257 671 329 698Q356 645 390 677Q417 694 423 751Q438 796 504 820L505 883Q473 912 409 891Q324 867 282 801Q255 766 254 731Z" fill="black"/></mask>
        <clipPath id="walk-left"><path d="M430 1000Q472 966 569 990Q641 1012 650 1090Q652 1181 574 1216Q485 1240 442 1170Q410 1100 430 1000Z"/></clipPath>
        <clipPath id="walk-right"><path d="M625 990Q710 960 795 990Q865 1025 866 1110Q859 1195 790 1217Q697 1230 651 1166Q619 1093 625 990Z"/></clipPath>
        <mask id="walk-body-mask"><rect width="1254" height="1254" fill="white"/><path d="M430 1000Q472 966 569 990Q641 1012 650 1090Q652 1181 574 1216Q485 1240 442 1170Q410 1100 430 1000Z" fill="black"/><path d="M625 990Q710 960 795 990Q865 1025 866 1110Q859 1195 790 1217Q697 1230 651 1166Q619 1093 625 990Z" fill="black"/></mask>
      </defs>
      <g class="rig" data-expression="idle" data-motion="true" data-wave="false">
        <g class="actor">
          <image class="rest" width="1254" height="1254"/>
          <g class="walk-rig"><image class="walk-body" width="1254" height="1254" mask="url(#walk-body-mask)"/><g class="walk-leg-left"><image class="walk-leg-image" width="1254" height="1254" clip-path="url(#walk-left)"/></g><g class="walk-leg-right"><image class="walk-leg-image" width="1254" height="1254" clip-path="url(#walk-right)"/></g></g>
          <g class="raised"><image class="arm-backfill" width="1254" height="1254" clip-path="url(#live-arm)"/><image class="wave-body" width="1254" height="1254" mask="url(#live-body)"/><g class="arm"><image class="wave-arm" width="1254" height="1254" clip-path="url(#live-arm)"/></g></g>
          <g class="face">
            <path d="M463 568C479 509 572 479 658 460C741 438 822 458 863 493C905 527 927 572 922 613C919 658 887 680 834 694C746 718 640 725 563 710C510 701 474 682 462 649C451 626 454 594 463 568Z" fill="url(#live-face)"/>
            <path d="M684 474Q790 444 859 497Q874 512 881 535Q797 556 720 529Z" fill="#fff" opacity=".2"/>
            <g class="gaze"><g class="look">
              <g class="open-eyes">
                <g class="eye-left"><ellipse cx="600" cy="601" rx="42" ry="51" transform="rotate(9 600 601)" fill="url(#live-eye)" stroke="#17282f" stroke-width="3"/><ellipse cx="605" cy="622" rx="25" ry="24" fill="url(#live-iris)"/><ellipse cx="587" cy="576" rx="8" ry="10" fill="#fff" opacity=".9"/></g>
                <g class="eye-right"><ellipse cx="829" cy="574" rx="34" ry="43" transform="rotate(-7 829 574)" fill="url(#live-eye)" stroke="#17282f" stroke-width="3"/><ellipse cx="827" cy="592" rx="21" ry="20" fill="url(#live-iris)"/><ellipse cx="819" cy="554" rx="7" ry="8" fill="#fff" opacity=".9"/></g>
              </g>
              <g class="happy-eyes" fill="url(#live-eye)" stroke="#162b32" stroke-width="2"><path d="M540 632C544 563 606 542 646 586C674 626 659 637 641 622C613 597 578 605 560 637C550 649 538 645 540 632Z"/><path d="M781 593C784 535 828 520 860 555C886 585 879 609 860 592C841 574 815 578 799 602C789 615 778 607 781 593Z"/></g>
              <g class="brows" fill="none" stroke="#34464d" stroke-width="9" stroke-linecap="round"><path d="M557 533Q580 521 602 530"/><path d="M807 505Q830 493 850 501"/></g>
            </g></g>
            <path class="rest-mouth" d="M685 658Q699 666 713 655" stroke="#486770" stroke-width="7" fill="none" stroke-linecap="round"/>
            <path class="smile" d="M674 647Q701 681 729 641Q703 651 674 647Z" fill="#21404a"/>
            <ellipse class="alert-mouth" cx="704" cy="658" rx="13" ry="17" fill="#254550"/>
            <path class="scan" d="M697 527V630" stroke="#52e7ed" stroke-width="6" stroke-linecap="round"/>
          </g>
          <g class="scene-prop scan-band" transform-origin="625 610"><rect x="365" y="485" width="560" height="230" rx="110" fill="#49eaf0" opacity=".13"/><path d="M380 602H910" stroke="#7effff" stroke-width="15" stroke-linecap="round" opacity=".85"/></g>
          <g class="scene-prop inspect-tool" transform-origin="875 655"><circle cx="856" cy="615" r="105" fill="#071820" fill-opacity=".28" stroke="#72f6f3" stroke-width="20"/><circle cx="856" cy="615" r="74" fill="#baffff" fill-opacity=".12"/><path d="M925 691L1048 824" stroke="#e9ffff" stroke-width="35" stroke-linecap="round"/><path d="M938 703L1047 822" stroke="#43d9c7" stroke-width="17" stroke-linecap="round"/></g>
          <g class="scene-prop point-signal" transform-origin="292 700"><circle cx="292" cy="700" r="75" fill="#43d9c7" fill-opacity=".16" stroke="#83fff5" stroke-width="12"/><path d="M292 574V620M166 700H212M372 700H418M203 611L237 645" stroke="#83fff5" stroke-width="15" stroke-linecap="round"/></g>
          <g class="scene-prop celebrate-sparks" fill="#61f2e6" stroke="#fff" stroke-width="5" transform-origin="625 620"><path d="M338 411l18 44 45 10-39 25 4 47-36-30-43 19 18-43-31-35 47 4z"/><path d="M986 498l14 34 36 8-31 20 3 37-29-24-34 15 14-34-24-28 37 3z" fill="#ff5964"/><circle cx="1010" cy="385" r="21" fill="#f5c451"/><circle cx="410" cy="320" r="17" fill="#ff5964"/></g>
          <g class="scene-prop alert-signal" transform-origin="982 350"><circle cx="982" cy="350" r="105" fill="#ef3543" fill-opacity=".92" stroke="#ffd5d8" stroke-width="12"/><path d="M982 280V374M982 420V425" stroke="#fff" stroke-width="35" stroke-linecap="round"/></g>
        </g>
      </g>
    </svg>`;
    shadow.innerHTML = markup;
    if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in shadow) {
      const sheet = new CSSStyleSheet(); sheet.replaceSync(css); shadow.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement("style"); style.textContent = css; shadow.prepend(style);
    }
    shadow.querySelector(".rest").setAttribute("href", baseUrl);
    for (const image of shadow.querySelectorAll(".walk-body,.walk-leg-image")) image.setAttribute("href", baseUrl);
    shadow.querySelector(".arm-backfill").setAttribute("href", baseUrl);
    for (const image of shadow.querySelectorAll(".wave-body,.wave-arm")) image.setAttribute("href", waveUrl);
    figure.append(element);
    figure.dataset.sensorRig = "true";
    const rig = shadow.querySelector(".rig");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let state = "idle", scene = "rest", intro = "pending", motion = true, enabled = true, hovered = false, disposed = false, waveTimer = null;
    let waving = false, lastWave = -Infinity;
    function render() {
      if (disposed) return;
      const expression = intro === "start" ? "greeting" :
        ["warning","error"].includes(state) ? "warning" :
        ["search","loading","analysis","graph","percentiles","export","playback"].includes(state) ? "focus" :
        ["success","exported","trace","open"].includes(state) ? "happy" : hovered ? "curious" : "idle";
      rig.dataset.expression = expression;
      rig.dataset.scene = scene;
      rig.dataset.motion = String(motion && !reduced.matches);
      rig.dataset.paused = String(document.hidden || !enabled);
      rig.dataset.wave = String((intro === "start" || waving) && enabled);
    }
    function greet() {
      if (!enabled || !motion || reduced.matches || document.hidden || intro !== "final" || Date.now()-lastWave < 8000 || !["idle","welcome","empty","pause"].includes(state)) return;
      lastWave = Date.now(); waving = true; render();
      clearTimeout(waveTimer); waveTimer = setTimeout(()=>{waving=false;render();},1800);
    }
    function enter(){hovered=true;greet();render();}
    function leave(){hovered=false;rig.style.removeProperty("--gaze-x");rig.style.removeProperty("--gaze-y");render();}
    function track(event){
      if(!enabled||!motion||reduced.matches||document.hidden)return;
      // Read only this 120px figure, never the query or the document tree.
      const rect=figure.getBoundingClientRect();
      if(!rect.width||!rect.height)return;
      rig.style.setProperty("--gaze-x",`${Math.max(-20,Math.min(20,(event.clientX-rect.left-rect.width/2)/rect.width*40))}px`);
      rig.style.setProperty("--gaze-y",`${Math.max(-12,Math.min(12,(event.clientY-rect.top-rect.height/2)/rect.height*24))}px`);
    }
    function visibility(){render();}
    figure.addEventListener("pointerenter",enter);figure.addEventListener("pointerleave",leave);figure.addEventListener("pointermove",track,{passive:true});figure.addEventListener("focus",enter);figure.addEventListener("blur",leave);
    document.addEventListener("visibilitychange",visibility);reduced.addEventListener("change",visibility);
    render();
    return Object.freeze({
      setState(value){state=String(value);if(!["idle","welcome","greeting"].includes(state)){clearTimeout(waveTimer);waving=false;}render();},
      setScene(value){scene=["rest","patrol","inspect","scan","point","celebrate","alert"].includes(value)?value:"rest";render();},
      setIntro(value){intro=value;render();},
      setMotion(value){motion=Boolean(value);if(!motion){clearTimeout(waveTimer);waving=false;}render();},
      setEnabled(value){enabled=Boolean(value);if(!enabled){clearTimeout(waveTimer);waving=false;}render();},
      getState(){return {expression:rig.dataset.expression,scene:rig.dataset.scene,waving:rig.dataset.wave==="true",motion:rig.dataset.motion==="true",paused:rig.dataset.paused==="true"};},
      dispose(){disposed=true;clearTimeout(waveTimer);figure.removeEventListener("pointerenter",enter);figure.removeEventListener("pointerleave",leave);figure.removeEventListener("pointermove",track);figure.removeEventListener("focus",enter);figure.removeEventListener("blur",leave);document.removeEventListener("visibilitychange",visibility);reduced.removeEventListener("change",visibility);element.remove();delete figure.dataset.sensorRig;}
    });
  }
  globalThis.SensorMascot = Object.freeze({mount});
})();
