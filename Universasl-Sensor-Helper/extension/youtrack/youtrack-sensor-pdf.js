(function(root){
  'use strict';
  // Local canvas pages in a PDF container. No remote renderer, font or library.
  let controller=null;
  const encode=s=>new TextEncoder().encode(s),ascii=s=>s.replace(/[^\x20-\x7e]/g,'').replace(/([\\()])/g,'\\$1');
  function pdfBlob(pages){
    const chunks=[],offsets=[0];let length=0,next=3;const pageIds=pages.map(()=>{const n=next;next+=3;return n;});
    const add=v=>{const b=typeof v==='string'?encode(v):v;chunks.push(b);length+=b.length;};
    const object=(id,body)=>{offsets[id]=length;add(`${id} 0 obj\n`);add(body);add('\nendobj\n');};
    add('%PDF-1.4\n');object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(n=>n+' 0 R').join(' ')}] >>`);
    pages.forEach((p,i)=>{const id=pageIds[i],links=p.links.filter(l=>/^https?:\/\//i.test(l.url)).map(l=>`<< /Type /Annot /Subtype /Link /Rect [${l.x/2} ${(1684-l.y-l.h)/2} ${(l.x+l.w)/2} ${(1684-l.y)/2}] /Border [0 0 0] /A << /S /URI /URI (${ascii(new URL(l.url).href)}) >> >>`).join(' ');
      object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im${i} ${id+1} 0 R >> >> /Contents ${id+2} 0 R /Annots [${links}] >>`);
      offsets[id+1]=length;add(`${id+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1190 /Height 1684 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);add(p.bytes);add('\nendstream\nendobj\n');
      const content=`q 595 0 0 842 0 0 cm /Im${i} Do Q`;object(id+2,`<< /Length ${encode(content).length} >>\nstream\n${content}\nendstream`);
    });
    const xref=length;add(`xref\n0 ${next}\n0000000000 65535 f \n`);for(let i=1;i<next;i++)add(String(offsets[i]).padStart(10,'0')+' 00000 n \n');add(`trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);return new Blob(chunks,{type:'application/pdf'});
  }
  // The advanced report is a brief, not a printed issue catalogue. Keep its
  // editorial layout separate so the original report retains its export.
  async function createExecutive({title,period,sections,charts=[],kpis=[],findings=[],issueUrl,onProgress,signal,scopeNote}){
    const pages=[],canvas=document.createElement('canvas');canvas.width=1190;canvas.height=1684;
    const c=canvas.getContext('2d'),left=72,width=1046,bottom=1540;let y=130,links=[],chapter='Обзор проекта';
    const check=()=>{if(signal?.aborted)throw new DOMException('Выгрузка отменена','AbortError');};
    function wrap(value,w,font){c.font=font;const lines=[];let line='';for(const word of String(value??'').replace(/[\u0000-\u001f]/g,' ').split(/\s+/)){if(c.measureText((line?line+' ':'')+word).width<=w){line+=(line?' ':'')+word;continue;}if(line)lines.push(line);line='';for(const ch of word){if(c.measureText(line+ch).width>w){lines.push(line);line='';}line+=ch;}}if(line||!lines.length)lines.push(line);return lines;}
    function box(x,top,w,h,fill='#f6f3fc',stroke='#e4deee'){c.beginPath();c.roundRect(x,top,w,h,14);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}}
    function linesAt(lines,x,top,{size=21,bold=false,color='#383248',lineHeight=30}={}){c.font=`${bold?'bold ':''}${size}px Arial`;c.fillStyle=color;lines.forEach((line,i)=>c.fillText(line,x,top+size+i*lineHeight));}
    function start(){c.fillStyle='#fff';c.fillRect(0,0,1190,1684);c.fillStyle='#6b49ba';c.fillRect(0,0,1190,9);c.font='bold 17px Arial';c.fillText('СЕНСОР / YOUTRACK',left,54);c.fillStyle='#5a5369';c.font='17px Arial';c.fillText(period,left,83);c.textAlign='right';c.fillText(chapter,1118,54);c.textAlign='left';y=128;links=[];}
    async function flush(){check();c.strokeStyle='#e6e1ed';c.beginPath();c.moveTo(left,1586);c.lineTo(1118,1586);c.stroke();c.font='16px Arial';c.fillStyle='#625b71';c.fillText('Сенсор · локальный анализ загруженных данных',left,1620);c.textAlign='right';c.fillText(String(pages.length+1),1118,1620);c.textAlign='left';const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));if(!blob)throw Error('Не удалось подготовить страницу PDF');pages.push({bytes:new Uint8Array(await blob.arrayBuffer()),links:links.slice()});onProgress?.(pages.length);await new Promise(resolve=>setTimeout(resolve,0));check();if(pages.length>1500)throw Error('Отчёт больше 1500 страниц. Неполный PDF не сохранён.');start();}
    async function reserve(height){if(y+height>bottom&&y>128)await flush();}
    function methodPoints(value){const source=String(value),points=[];let start=0,quotes=0;for(let i=0;i<source.length;i++){if(source[i]==='«')quotes++;else if(source[i]==='»')quotes=Math.max(0,quotes-1);if(!quotes&&/[.!?]/.test(source[i])){const space=source.slice(i+1).match(/^\s+(?=[А-ЯA-Z0-9])/u);if(space){points.push(source.slice(start,i+1));i+=space[0].length;start=i+1;}}}if(start<source.length)points.push(source.slice(start));return points;}
    async function paragraph(value,{size=21,color='#565063',after=16,indent=0}={}){const rows=wrap(value,width-indent,`${size}px Arial`);for(const line of rows){await reserve(size+12);linesAt([line],left+indent,y,{size,color});y+=size+10;}y+=after;}
    async function sectionHeading(label,number){await reserve(120);c.font='bold 15px Arial';c.fillStyle='#7b64a6';c.fillText(number,left,y+18);y+=31;const rows=wrap(label,width,'bold 30px Arial');linesAt(rows,left,y,{size:30,bold:true,color:'#332541',lineHeight:37});y+=rows.length*37+20;}
    function measuredCard(title,body,w){return {title:wrap(title,w-42,'bold 23px Arial'),body:wrap(body,w-42,'20px Arial')};}
    async function insight(f,index){const data=measuredCard(f.title,f.text,width-60),url=f.issue&&issueUrl?.(f.issue),label=f.linkLabel||'Открыть подборку в YouTrack';const linkLines=url?wrap(label,width-104,'bold 18px Arial'):[];const height=44+data.title.length*29+data.body.length*28+(url?linkLines.length*25+12:0);await reserve(height+16);box(left,y,width,height,'#faf9fc');c.font='bold 16px Arial';c.fillStyle='#7d639f';c.fillText(String(index+1).padStart(2,'0'),left+18,y+35);let top=y+17;linesAt(data.title,left+61,top,{size:23,bold:true,lineHeight:29});top+=data.title.length*29+9;linesAt(data.body,left+61,top,{size:20,lineHeight:28,color:'#565063'});top+=data.body.length*28+9;if(url){linesAt(linkLines,left+61,top,{size:18,bold:true,lineHeight:25,color:'#6242a4'});links.push({x:left+55,y:top,w:width-90,h:linkLines.length*25+5,url});}y+=height+16;}
    async function renderTable(def){
      const n=def.headers.length,first=n===2?.48:n===3?.46:n===4?.35:.27;
      const widths=def.headers.map((_,i)=>i===0?width*first:width*(1-first)/(n-1));
      async function row(values,head=false,entry={}){const size=head?17:19,lineHeight=25,font=`${head?'bold ':''}${size}px Arial`;const cells=values.map((v,i)=>wrap(v,widths[i]-24,font));if(entry.linkLabel)cells[0].push(...wrap(entry.linkLabel,widths[0]-24,'17px Arial'));const total=Math.max(1,...cells.map(x=>x.length));let offset=0;
        while(offset<total){if(y+Math.min(total-offset,3)*lineHeight+22>bottom){await flush();await paragraph(def.title+' · продолжение',{size:23,color:'#563879',after:14});if(!head)await row(def.headers,true);}
          const take=Math.max(1,Math.min(total-offset,Math.floor((bottom-y-22)/lineHeight))),height=take*lineHeight+22;let x=left;c.fillStyle=head?'#eee8f8':'#faf9fc';c.fillRect(left,y,width,height);values.forEach((_,i)=>{linesAt(cells[i].slice(offset,offset+take),x+12,y+9,{size,bold:head,lineHeight,color:!head&&entry.issue&&i===0?'#6242a4':'#393147'});if(!head&&entry.issue&&i===0){const url=issueUrl?.(entry.issue);if(url)links.push({x,y,w:widths[i],h:height,url});}x+=widths[i];});y+=height+3;offset+=take;}
      }
      await row(def.headers,true);for(const entry of def.rows||[]){check();await row(entry.values,false,entry);}y+=16;
    }
    start();await sectionHeading(title,'01 / ГЛАВНОЕ');
    await paragraph('Ключевые показатели и наблюдения. Подробности по задачам открываются по ссылкам.',{size:22,after:24});
    for(let index=0;index<kpis.length;index+=2){const pair=kpis.slice(index,index+2),w=(width-18)/2;const data=pair.map(k=>({label:wrap(k.label,w-40,'bold 18px Arial'),value:wrap(k.value,w-40,'bold 39px Arial'),note:wrap(k.note,w-40,'18px Arial')}));const height=Math.max(...data.map(d=>40+d.label.length*24+d.value.length*46+d.note.length*25));await reserve(height+18);data.forEach((d,i)=>{const x=left+i*(w+18);box(x,y,w,height,index===0&&i===0?'#f0eafa':'#f8f7fb');let top=y+17;linesAt(d.label,x+20,top,{size:18,bold:true,lineHeight:24});top+=d.label.length*24+9;linesAt(d.value,x+20,top,{size:39,bold:true,lineHeight:46,color:'#443064'});top+=d.value.length*46+6;linesAt(d.note,x+20,top,{size:18,lineHeight:25,color:'#5b536c'});});y+=height+18;}
    y+=7;for(let i=0;i<findings.length;i++)await insight(findings[i],i);
    await paragraph('Поля задач - текущий накопленный снимок. Выбранный период ограничивает только списания.',{size:18,color:'#6b6179',after:0});
    chapter='Показатели по группам';await flush();
    await sectionHeading('Показатели по группам','02 / ДАННЫЕ');
    for(const def of sections){check();if(!def.headers)continue;
      const columns=def.headers.length,first=columns===2?.48:columns===3?.46:columns===4?.35:.27,cellWidths=def.headers.map((_,i)=>(i===0?width*first:width*(1-first)/(columns-1))-24);
      const headHeight=Math.max(...def.headers.map((v,i)=>wrap(v,cellWidths[i],'bold 17px Arial').length))*25+25;
      const firstRow=def.rows?.[0],rowHeight=firstRow?Math.max(...firstRow.values.map((v,i)=>wrap(v,cellWidths[i],'19px Arial').length+(i===0&&firstRow.linkLabel?wrap(firstRow.linkLabel,cellWidths[i],'17px Arial').length:0)))*25+25:40;
      const summaryHeight=def.summary?wrap(def.summary,width,'20px Arial').length*30+14:0;
      await reserve(Math.min(1300,78+summaryHeight+headHeight+rowHeight));box(left,y,width,64,'#f0ecf7',null);linesAt(wrap(def.title,width-36,'bold 24px Arial'),left+18,y+16,{size:24,bold:true,color:'#4a3467'});y+=78;
      if(def.summary)await paragraph(def.summary,{size:20,after:14});
      if(def.rows?.length)await renderTable(def);else await paragraph('Подходящих данных нет.',{size:20});
      y+=24;
    }
    if(charts.length){chapter='Визуальный обзор';await flush();await sectionHeading('Распределение по группам','03 / ГРАФИКИ');for(const model of charts){check();const chart=document.createElement('canvas');root.YouTrackSensorView.draw({...model,note:model.unit==='задач'?'Количество задач':'Списания выбранного периода, ч'},chart);const scale=Math.min(width/chart.width,1100/chart.height),height=chart.height*scale;const captionHeight=model.note?wrap(model.note,width,'18px Arial').length*28+12:0;await reserve(height+captionHeight+35);box(left-10,y-5,width+20,height+20,'#fff');c.drawImage(chart,left,y,chart.width*scale,height);y+=height+22;if(model.note)await paragraph(model.note,{size:18,after:18});y+=20;chart.width=chart.height=1;}}
    chapter='Методика и ограничения';await flush();await sectionHeading('Как читать этот отчёт','04 / МЕТОДИКА');
    await paragraph(scopeNote||'Все расчёты выполнены локально по загруженным данным.',{size:20,after:22});
    for(const def of sections){const paragraphs=def.paragraphs||[];if(!paragraphs.length)continue;const points=paragraphs.flatMap(methodPoints),blockHeight=88+points.reduce((height,point)=>height+wrap(point,width-22,'20px Arial').length*30+12,0);await reserve(blockHeight<=1350?blockHeight:160);box(left,y,width,56,'#f0ecf7',null);linesAt(wrap(def.title,width-36,'bold 22px Arial'),left+18,y+14,{size:22,bold:true,color:'#4a3467'});y+=72;
      for(const point of points){await reserve(70);c.fillStyle='#8c75b2';c.beginPath();c.arc(left+5,y+12,3,0,Math.PI*2);c.fill();await paragraph(point,{size:20,indent:22,after:12});}y+=16;
    }
    if(y>128)await flush();canvas.width=canvas.height=1;check();return pdfBlob(pages);
  }
  async function create({title,period,sections,charts,issueUrl,onProgress,signal,scopeNote,layout,kpis,findings}){
    if(layout==='executive')return createExecutive({title,period,sections,charts,issueUrl,onProgress,signal,scopeNote,kpis,findings});
    const pages=[],canvas=document.createElement('canvas');canvas.width=1190;canvas.height=1684;const c=canvas.getContext('2d');let y=0,links=[],pageStarted=false;
    const check=()=>{if(signal?.aborted)throw new DOMException('Выгрузка отменена','AbortError');};
    const start=()=>{c.fillStyle='#fff';c.fillRect(0,0,1190,1684);c.fillStyle='#6042a5';c.fillRect(0,0,1190,12);c.font='bold 19px Arial';c.fillText('СЕНСОР  /  РАЗБОР YOUTRACK',72,57);c.fillStyle='#665e73';c.font='17px Arial';c.fillText(period,72,85);y=130;links=[];pageStarted=true;};
    async function flush(){
      check();if(!pageStarted)return;c.fillStyle='#756e80';c.font='17px Arial';c.fillText('Локальный анализ загруженных данных',72,1627);c.fillText('Страница '+(pages.length+1),990,1627);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));if(!blob)throw Error('Не удалось подготовить страницу PDF');pages.push({bytes:new Uint8Array(await blob.arrayBuffer()),links:links.slice()});
      onProgress?.(pages.length);await new Promise(resolve=>setTimeout(resolve,0));check();if(pages.length>1500)throw Error('Отчёт больше 1500 страниц. Уменьшите период; неполный PDF не сохранён.');start();
    }
    const wrap=(text,width,font)=>{c.font=font;const lines=[];let line='';for(const word of String(text??'').replace(/[\u0000-\u001f]/g,' ').split(/\s+/)){if(c.measureText((line?line+' ':'')+word).width<=width){line+=(line?' ':'')+word;continue;}if(line)lines.push(line);line='';for(const ch of word){if(c.measureText(line+ch).width>width){lines.push(line);line='';}line+=ch;}}if(line||!lines.length)lines.push(line);return lines;};
    async function text(value,{size=22,bold=false,color='#342d43',after=14}={}){const font=`${bold?'bold ':''}${size}px Arial`,lines=wrap(value,1046,font);for(const line of lines){if(y+size+8>1575)await flush();c.font=font;c.fillStyle=color;c.fillText(line,72,y+size);y+=size+9;}y+=after;}
    async function table(def){
      const widths=def.headers.map((_,i)=>i===0?190:(1046-190)/(def.headers.length-1));
      async function row(values,head=false,issue=null){
        const font=(head?'bold ':'')+'19px Arial',lines=values.map((v,i)=>wrap(v,widths[i]-20,font)),n=Math.max(...lines.map(a=>a.length));let lineOffset=0;
        while(lineOffset<n){
          if(y+Math.min(n-lineOffset,4)*26+18>1560){await flush();if(!head)await row(def.headers,true);}
          const take=Math.max(1,Math.min(n-lineOffset,Math.floor((1560-y-18)/26))),height=take*26+18;
          let x=72;c.fillStyle=head?'#ece6f7':'#f8f7fb';c.fillRect(x,y,1046,height);
          values.forEach((_,i)=>{c.font=font;c.fillStyle=issue&&i===0?'#5635a0':'#342d43';lines[i].slice(lineOffset,lineOffset+take).forEach((line,j)=>c.fillText(line,x+10,y+27+j*26));if(issue&&i===0&&issueUrl(issue))links.push({x,y,w:widths[i],h:height,url:issueUrl(issue)});x+=widths[i];});y+=height+3;lineOffset+=take;
        }
      }
      await row(def.headers,true);for(let i=0;i<def.rows.length;i++){check();const r=def.rows[i];await row(r.values,false,r.issue);if(i%80===0)await new Promise(resolve=>setTimeout(resolve,0));}y+=18;
    }
    start();await text(title,{size:38,bold:true});await text('Выводы, задачи и оценки, распределение времени, полнота данных и графики.',{size:24});await text(scopeNote||'Факт ограничен загруженной выгрузкой и выбранным периодом. PDF не изменяет исходный Excel. Текст страниц растровый; ссылки на задачи активны.',{size:20,color:'#665e73'});
    for(const def of sections){check();if(y>1380)await flush();await text(def.title,{size:29,bold:true,color:'#58359b'});for(const p of def.paragraphs||[])await text(p);if(def.headers){if(def.rows?.length)await table(def);else await text('Подходящих записей нет.',{color:'#665e73'});}}
    await flush();await text('Графики по загруженным данным',{size:30,bold:true});
    for(const model of charts){check();const chart=document.createElement('canvas');root.YouTrackSensorView.draw(model,chart);const scale=Math.min(1046/chart.width,1380/chart.height),height=chart.height*scale;if(y+height>1560)await flush();c.drawImage(chart,72,y,chart.width*scale,height);y+=height+26;chart.width=chart.height=1;}
    if(y>130)await flush();canvas.width=canvas.height=1;check();return pdfBlob(pages);
  }
  async function download(args){if(controller)return false;controller=new AbortController();try{return await create({...args,signal:controller.signal});}finally{controller=null;}}
  root.YouTrackSensorPdf={download,cancel:()=>controller?.abort()};
})(globalThis);
