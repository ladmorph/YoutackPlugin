(function exposeGraylogExceptionHighlights(root) {
  "use strict";
  const CHAIN = "advanced-graylog-exception-chain", CAUSE = "advanced-graylog-exception-cause", ORIGIN = "advanced-graylog-exception-origin", WRAPPER = "advanced-graylog-exception-wrapper-method";
  function createController(doc) {
    const registry = root.CSS?.highlights;
    if (!registry || typeof root.Highlight !== "function" || !root.GraylogExceptionChain || !doc.createTreeWalker) return null;
    const chainHighlight = new root.Highlight(), causeHighlight = new root.Highlight(), originHighlight = new root.Highlight(), wrapperHighlight = new root.Highlight();
    registry.set(CHAIN,chainHighlight);registry.set(CAUSE,causeHighlight);registry.set(ORIGIN,originHighlight);registry.set(WRAPPER,wrapperHighlight);
    const rows = new Map();let sheet=null, connectorHost=null, connectorSvg=null, frame=0, disposed=false, connectorCount=0, continuationCount=0, gutterUnavailable=0;
    const CONNECTOR="advanced-graylog-exception-connectors", SVG="http://www.w3.org/2000/svg";
    const resizeObserver=typeof root.ResizeObserver==="function"?new root.ResizeObserver(scheduleConnectors):null;
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(`::highlight(${CHAIN}){background-color:#d7edf5;color:#163d54;text-decoration:underline}::highlight(${CAUSE}){background-color:#ffe1a0;color:#662f00;text-decoration:underline}::highlight(${ORIGIN}){background-color:#e8dcff;color:#4c2575;text-decoration:underline}::highlight(${WRAPPER}){background-color:#e8eff3;color:#365666}#${CONNECTOR}{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147482000;contain:strict}`);
      doc.adoptedStyleSheets=[...doc.adoptedStyleSheets,sheet];
    } catch { registry.delete(CHAIN);registry.delete(CAUSE);registry.delete(ORIGIN);registry.delete(WRAPPER);return null; }

    function svgElement(name, attributes) {
      const element=doc.createElementNS(SVG,name);
      for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));
      return element;
    }
    function clearConnectors() {
      connectorHost?.remove();connectorHost=null;connectorSvg=null;connectorCount=0;continuationCount=0;
    }
    function scheduleConnectors() {
      if(!disposed&&!frame)frame=root.requestAnimationFrame(renderConnectors);
    }
    function visibleClip(row,element) {
      const bounds=row.getBoundingClientRect();
      const clip={left:Math.max(0,bounds.left),right:Math.min(doc.documentElement.clientWidth,bounds.right),top:Math.max(0,bounds.top),bottom:Math.min(root.innerHeight,bounds.bottom)};
      const fieldStyle=root.getComputedStyle(element),fieldRect=element.getBoundingClientRect();
      if(/auto|scroll|hidden|clip/.test(fieldStyle.overflowY)){clip.top=Math.max(clip.top,fieldRect.top);clip.bottom=Math.min(clip.bottom,fieldRect.bottom);}
      // Use ancestor clipping, leaving the field's existing left gutter free.
      for(let parent=element.parentElement;parent;parent=parent.parentElement){
        const style=root.getComputedStyle(parent),rect=parent.getBoundingClientRect();
        if(/auto|scroll|hidden|clip/.test(style.overflowX)){clip.left=Math.max(clip.left,rect.left);clip.right=Math.min(clip.right,rect.right);}
        if(/auto|scroll|hidden|clip/.test(style.overflowY)){clip.top=Math.max(clip.top,rect.top);clip.bottom=Math.min(clip.bottom,rect.bottom);}
      }
      return clip;
    }
    function renderConnectors() {
      frame=0;if(disposed)return;
      const paths=[];gutterUnavailable=0;
      for(const [row,highlights] of rows){
        if(!row.isConnected){remove(row);continue;}
        if(paths.length>=12)break;
        for(const origin of highlights.filter(item=>item.relation==="origin"||item.relation==="wrapper-method")){
          if(paths.length>=12)break;
          const causes=highlights.filter(item=>item.element===origin.element&&(item.relation==="cause"||item.relation==="root")&&item.start===origin.causeStart);
          const cause=causes.at(-1);
          const wrapper=origin.relation==='wrapper-method';
          const target=wrapper?highlights.find(item=>item.element===origin.element&&(item.relation==='root'||item.relation==='cause')&&item.start===origin.ownerStart):origin;
          if(!cause||!target||!origin.element.isConnected||!cause.range.startContainer.isConnected||!target.range.startContainer.isConnected)continue;
          const from=cause.range.getClientRects()[0],to=target.range.getClientRects()[0];
          if(!from||!to||!from.width||!to.width||Math.abs(to.top-from.top)<4)continue;
          const clip=visibleClip(row,origin.element),field=origin.element.getBoundingClientRect();
          if(clip.bottom-clip.top<24)continue;
          const fromY=from.top+from.height/2,toY=to.top+to.height/2;
          const fromVisible=fromY>=clip.top+3&&fromY<=clip.bottom-3,toVisible=toY>=clip.top+3&&toY<=clip.bottom-3;
          if(!fromVisible&&!toVisible)continue;
          const end=Math.max(field.left-3,Math.min(from.left,to.left)-3),width=Math.min(12,end-clip.left-3),x=end-width;
          if(width<3||end>clip.right-3||from.left<clip.left||to.left<clip.left){gutterUnavailable++;continue;}
          const y1=Math.max(clip.top+8,Math.min(clip.bottom-8,fromY)),y2=Math.max(clip.top+8,Math.min(clip.bottom-8,toY));
          // Test only endpoints which are actually visible; the hidden endpoint
          // belongs to this exact field and is represented by a clipped stub.
          const unoccluded=(rect,y)=>{const target=doc.elementFromPoint(Math.min(rect.left+8,clip.right-1),y);return target&&origin.element.contains(target);};
          if((fromVisible&&!unoccluded(from,fromY))||(toVisible&&!unoccluded(to,toY)))continue;
          const direction=Math.sign(y2-y1),corner=Math.min(5,Math.abs(y2-y1)/3,width/2);
          const d=`M ${end} ${y1} H ${x+corner} Q ${x} ${y1} ${x} ${y1+direction*corner} V ${y2-direction*corner} Q ${x} ${y2} ${x+corner} ${y2} H ${end} M ${end-3} ${y2-3} L ${end} ${y2} L ${end-3} ${y2+3}`;
          const continuation=!fromVisible||!toVisible;
          paths.push({d,continuation,wrapper,x,y:(!fromVisible?fromY:toY)<clip.top?Math.min(clip.bottom-10,clip.top+90):(!fromVisible?y1:y2),label:!fromVisible?(cause.relation==='cause'?'Причина':'Исключение')+(fromY>clip.bottom?' ниже':' выше'):(wrapper?'Исключение':'Метод')+(toY>clip.bottom?' ниже':' выше'),labelFits:x-clip.left>=14});

        }
      }
      if(!paths.length){clearConnectors();return;}
      if(!connectorHost){
        connectorHost=doc.createElement("div");connectorHost.id=CONNECTOR;connectorHost.setAttribute("aria-hidden","true");
        const shadow=connectorHost.attachShadow({mode:"closed"});
        connectorSvg=svgElement("svg",{width:"100%",height:"100%","aria-hidden":"true",focusable:"false"});
        shadow.append(connectorSvg);doc.documentElement.append(connectorHost);
      }
      connectorSvg.replaceChildren(...paths.flatMap(item=>{
        const line=svgElement("path",{d:item.d,fill:"none",stroke:item.wrapper?"#477789":"#7657a2","stroke-width":1.8,"stroke-opacity":1,"stroke-linecap":"round","stroke-linejoin":"round",...(item.continuation?{"stroke-dasharray":"4 3"}:{})});
        if(!item.continuation||!item.labelFits)return [line];
        const label=svgElement("text",{x:item.x-5,y:item.y-8,fill:"#68458f","font-size":10,"font-family":"Arial,sans-serif","text-anchor":"start",transform:`rotate(-90 ${item.x-5} ${item.y-8})`});label.textContent=item.label;
        return [line,label];
      }));
      connectorCount=paths.length;continuationCount=paths.filter(item=>item.continuation).length;
    }
    doc.addEventListener("scroll",scheduleConnectors,{capture:true,passive:true});
    root.addEventListener("resize",scheduleConnectors,{passive:true});
    root.visualViewport?.addEventListener("resize",scheduleConnectors,{passive:true});
    root.visualViewport?.addEventListener("scroll",scheduleConnectors,{passive:true});
    function remove(row) {
      for (const {range,highlight} of rows.get(row)||[]) highlight.delete(range);
      resizeObserver?.unobserve(row);
      rows.delete(row);
      scheduleConnectors();
    }
    function update(row, elements, level3) {
      remove(row);
      if (!level3 || !row.isConnected) return;
      const highlights=[];
      for (const element of elements.slice(0,4)) {
        if (!element?.isConnected) continue;
        const {text,segments:nodes,truncated}=root.GraylogExceptionChain.readDomText(element);
        const entries=root.GraylogExceptionChain.parse(text);
        const origin=root.GraylogExceptionChain.callsite(text,{truncated});
        if(origin){
          const wrapper=origin.kind!=='assembly'&&!origin.partial&&Number.isFinite(origin.ownerStart)&&Number.isFinite(origin.causeStart)&&origin.ownerStart!==origin.causeStart;
          entries.push({...origin,highlightStart:origin.start,relation:wrapper?"wrapper-method":"origin"});
        }
        for (const entry of entries) {
          const rangeStart=entry.highlightStart;
          const start=nodes.find(item=>item.start<=rangeStart&&item.end>rangeStart);
          const end=nodes.find(item=>item.start<entry.end&&item.end>=entry.end);
          if (!start||!end) continue;
          const range=doc.createRange();range.setStart(start.node,rangeStart-start.start);range.setEnd(end.node,entry.end-end.start);
          const highlight=entry.relation==="origin"?originHighlight:entry.relation==="wrapper-method"?wrapperHighlight:entry.relation==="cause"?causeHighlight:chainHighlight;
          highlight.add(range);highlights.push({range,highlight,relation:entry.relation,start:entry.start,causeStart:entry.causeStart,ownerStart:entry.ownerStart,element});
        }
      }
      if(highlights.length){rows.set(row,highlights);resizeObserver?.observe(row);}
      for (const known of rows.keys()) if(!known.isConnected)remove(known);
    }
    return Object.freeze({update,remove,dispose(){disposed=true;if(frame)root.cancelAnimationFrame(frame);resizeObserver?.disconnect();doc.removeEventListener("scroll",scheduleConnectors,true);root.removeEventListener("resize",scheduleConnectors);root.visualViewport?.removeEventListener("resize",scheduleConnectors);root.visualViewport?.removeEventListener("scroll",scheduleConnectors);clearConnectors();for(const row of rows.keys())remove(row);if(registry.get(CHAIN)===chainHighlight)registry.delete(CHAIN);if(registry.get(CAUSE)===causeHighlight)registry.delete(CAUSE);if(registry.get(ORIGIN)===originHighlight)registry.delete(ORIGIN);if(registry.get(WRAPPER)===wrapperHighlight)registry.delete(WRAPPER);if(sheet)doc.adoptedStyleSheets=doc.adoptedStyleSheets.filter(item=>item!==sheet);},getState:()=>({rows:rows.size,chain:chainHighlight.size,causes:causeHighlight.size,origins:originHighlight.size,wrappers:wrapperHighlight.size,connectors:connectorCount,continuations:continuationCount,gutterUnavailable})});
  }
  root.GraylogExceptionHighlights=Object.freeze({createController});
})(globalThis);
