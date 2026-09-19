// Presentation only. Never aggregates, rounds, filters or changes exported data.
(() => {
  'use strict';
  const colors={'#dc2626':'#c44358','#16a34a':'#168f8a','#f59e0b':'#6545d8'};
  function plot(target,traces,layout,options){
    const styled=traces.map(trace=>({...trace,
      marker:{...trace.marker,color:Array.isArray(trace.marker?.color)?trace.marker.color.map(c=>colors[c]||c):trace.marker?.color,line:{width:0}},
      textfont:{family:'Segoe UI, Arial, sans-serif',size:14,color:'#252637'},
      hovertemplate:'%{x}<br><b>%{y}%</b><extra></extra>'
    }));
    return Plotly.newPlot(target,styled,{...layout,
      font:{family:'Segoe UI, Arial, sans-serif',size:14,color:'#252637'},
      margin:{t:36,r:24,b:64,l:64},bargap:.5,
      yaxis:{...layout.yaxis,gridcolor:'#eae6f4',zerolinecolor:'#dcdde7',tickfont:{color:'#5b5e72'},title:{text:typeof layout.yaxis?.title==='string'?layout.yaxis.title:layout.yaxis?.title?.text,font:{size:13,color:'#5b5e72'},standoff:16}},
      xaxis:{...layout.xaxis,tickfont:{size:13,color:'#252637'},showline:false,automargin:true},
      hoverlabel:{bgcolor:'#252637',bordercolor:'#252637',font:{family:'Segoe UI, Arial, sans-serif',size:14,color:'#ffffff'}}
    },options);
  }
  globalThis.YouTrackReferenceDesign=Object.freeze({plot});
})();
