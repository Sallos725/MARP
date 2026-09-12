// Self-contained function: its source is also executed in a disposable worker.
export async function encodePDF(text,pause=async()=>{}) {
 const limit=1<<20;let bytes=0,count=0;
 for(const c of text){bytes+=c.codePointAt(0)<128?1:c.codePointAt(0)<2048?2:c.length===2?4:3;if(bytes>limit)throw Error('source-limit');if(++count%4096===0)await pause()}
 const ids=new Map(),chars=[],lines=[];let line=[];
 const hex=n=>n.toString(16).toUpperCase().padStart(4,'0');
 count=0;
 for(const c of text.replaceAll('\r\n','\n')){
  if(c==='\n'){lines.push(line.join(''));line=[]}
  else{if(!ids.has(c)){ids.set(c,chars.length+1);chars.push(c)}line.push(hex(ids.get(c)));
  }
  if(++count%4096===0)await pause();
 }
 lines.push(line.join(''));
 if(chars.length>65534)throw Error('glyph-limit');
 let cmap='/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /MARPUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
 for(let i=0;i<chars.length;i+=100){const end=Math.min(i+100,chars.length);cmap+=(end-i)+' beginbfchar\n';for(let j=i;j<end;j++){let h='';for(let k=0;k<chars[j].length;k++)h+=hex(chars[j].charCodeAt(k));cmap+='<'+hex(j+1)+'> <'+h+'>\n'}cmap+='endbfchar\n';await pause()}
 cmap+='endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
 const stream=s=>'<< /Length '+s.length+' >>\nstream\n'+s+'\nendstream';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','','<< /Type /Font /Subtype /Type0 /BaseFont /MARPText /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>','<< /Type /Font /Subtype /CIDFontType2 /BaseFont /MARPText /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 600 /CIDToGIDMap /Identity >>','<< /Type /FontDescriptor /FontName /MARPText /Flags 4 /FontBBox [0 -200 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>',stream(cmap)];
 const kids=[];
 for(let i=0;i<lines.length;i+=100){const id=objects.length+1;kids.push(id+' 0 R');objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents '+(id+1)+' 0 R >>',stream('BT /F1 6 Tf 7 TL 20 820 Td\n'+lines.slice(i,i+100).map(l=>Math.min(100,555/(Math.max(1,l.length/4)*3.6)*100)+' Tz <'+l+'> Tj T*\n').join('')+'ET'));await pause()}
 objects[1]='<< /Type /Pages /Count '+kids.length+' /Kids ['+kids.join(' ')+'] >>';
 const chunks=['%PDF-1.7\n'],offsets=[0];let length=chunks[0].length;
 for(let i=0;i<objects.length;i++){offsets.push(length);const s=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';chunks.push(s);length+=s.length;if(length>8<<20)throw Error('pdf-limit');await pause()}
 const xref=length;chunks.push('xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 const pdf=chunks.join('');if(pdf.length>8<<20)throw Error('pdf-limit');
 // Base64 is generated here, so large PDF encoding stays in the worker.
 return {data:btoa(pdf),bytes:pdf.length};
}
export async function makePDF(text,signal,{worker=true}={}) {
 if(signal?.aborted)throw signal.reason;
 if(text.length>1<<20)throw Error('source-limit');
 const fallback=()=>encodePDF(text,async()=>{if(signal?.aborted)throw signal.reason;await new Promise(r=>setTimeout(r,0));if(signal?.aborted)throw signal.reason});
 if(!worker||typeof Worker==='undefined')return {...await fallback(),worker:false};
 let instance,url;
 try{
  url=URL.createObjectURL(new Blob(['onmessage=async(e)=>{try{const result=await ('+encodePDF.toString()+')(e.data);postMessage({result})}catch(error){postMessage({error:error.message})}}'],{type:'application/javascript'}));
  instance=new Worker(url);
  const result=await new Promise((resolve,reject)=>{
   const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason)};
   const clear=()=>signal?.removeEventListener('abort',abort);
   instance.onmessage=e=>{clear();e.data.error?reject(Error(e.data.error)):resolve(e.data.result)};
   instance.onerror=()=>{clear();reject(Error('worker-unavailable'))};
   signal?.addEventListener('abort',abort,{once:true});
   instance.postMessage(text);
  });
  return {...result,worker:true};
 }catch(error){
  if(signal?.aborted)throw signal.reason;
  if(['source-limit','pdf-limit','glyph-limit'].includes(error.message))throw error;
  return {...await fallback(),worker:false};
 }finally{instance?.terminate();if(url)URL.revokeObjectURL(url)}
}
export const PDF_TASK='Analyze the attached source transcript using your agent instructions. Preserve facts and distinguish uncertainty. Return concise analysis notes, never the final roleplay reply.';
export function hasPDF(messages){return messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p?.type==='file'||p?.type==='document'||p?.inlineData?.mimeType==='application/pdf'))}
export function pdfSource(messages,mode){
 let source='';const kept=[];
 messages.forEach((m,i)=>{if(m.role==='system'&&mode!=='max')kept.push(m);else source+='['+(i+1)+' '+m.role+']\n'+m.content+'\n\n'});
 if(mode==='quality'){let split=Math.floor(source.length*.8);if(split>0&&/[\uD800-\uDBFF]/.test(source[split-1]))split--;kept.push({role:'user',content:'Transcript continues:\n'+source.slice(split)});source=source.slice(0,split)}
 return {source,kept};
}
export const unsupportedPDF=e=>[400,415,422].includes(e.status)&&/(pdf|document|file|application\/pdf).{0,100}(not supported|unsupported|not allowed|invalid|only text)|(not supported|unsupported|does not support).{0,100}(pdf|document|file)/i.test(e.message);
