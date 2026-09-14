export const VERSION='0.9.1';
export const AGENTS=['worldbuilding','plot','character'];
export const LABELS={worldbuilding:'세계관',plot:'플롯',character:'등장인물'};
const START='<!--MARP:v1:begin-->', END='<!--MARP:v1:end-->';
const owned=/<!--MARP:v1:begin-->[\s\S]*?<!--MARP:v1:end-->/g;
export function contentText(value) {
 if(typeof value==='string') return value;
 if(!Array.isArray(value)) return '';
 return value.map(p=>typeof p==='string'?p:(!p?.thought&&(!p.type||p.type==='text'||p.type==='output_text'||p.type==='input_text')?p.text||'':'')).filter(Boolean).join('\n');
}
export function withoutOwn(messages) {
 let changed=false;
 const out=[];
 for(const m of messages){
  if(!m||typeof m!=='object'){out.push(m);continue}
  const clean=s=>s.replace(owned,'');
  let c=m.content;
  if(typeof c==='string') c=clean(c);
  else if(Array.isArray(c)) c=c.map(p=>typeof p==='string'?clean(p):(p&&(!p.type||['text','input_text','output_text'].includes(p.type))&&typeof p.text==='string'?({...p,text:clean(p.text)}):p));
  const differs=typeof c==='string'?c!==m.content:Array.isArray(c)&&c.some((p,i)=>p!==m.content[i]&&(typeof p==='string'||p.text!==m.content[i]?.text));
  if(!differs){out.push(m);continue}
  changed=true;
  if(m.role==='system'&&typeof c==='string'&&!c.trim()&&Object.keys(m).every(k=>k==='role'||k==='content'))continue;
  out.push({...m,content:c});
 }
 return changed?out:messages;
}
export function bypass(messages,mode,c) {
 const kind=String(mode||'').toLowerCase();
 if(c.main_model_only&&kind&&kind!=='model')return true;
 if(c.bypass_hypamemory&&/memory|hypa/.test(kind))return true;
 if(c.bypass_translate&&/translat/.test(kind))return true;
 return c.bypass_lb_process&&messages.some(m=>/<\/?\s*lb-process\b/i.test(contentText(m?.content)));
}
export function analysisInput(messages,window=10) {
 const safe=withoutOwn(messages);let last=-1;
 for(let i=safe.length-1;i>=0;i--)if(safe[i]?.role==='user'){last=i;break}
 const after=[],before=[],systems=[];
 for(let i=0;i<safe.length;i++){
  const m=safe[i];if(!m)continue;
  if(m.role==='system'||m.role==='developer')systems.push(contentText(m.content));
  else if(i!==last){if(i>last&&last>=0)after.push(m);else before.push(m)}
 }
 const selected=before.slice(-Math.max(0,window-after.length)); // corrected below for slice(-0)
 const recent=Math.max(0,window-after.length)===0?[]:selected;
 return {user_input:last<0?'':contentText(safe[last].content),system_context:systems.filter(Boolean).join('\n\n'),chat_history:recent.concat(after).map(m=>({role:m.role||'user',content:contentText(m.content)})),context_window:Math.max(window,after.length)};
}
export function cleanOutput(text) {
 return String(text||'').replace(/<\s*(think|thinking|reasoning)\s*>[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi,'')
 .replace(/<｜begin▁of▁(?:thinking|thought|reasoning)｜>[\s\S]*?(?:<｜end▁of▁(?:thinking|thought|reasoning)｜>|$)/gi,'')
 .replace(/<\|begin[_▁]of[_▁](?:thinking|thought|reasoning)\|>[\s\S]*?(?:<\|end[_▁]of[_▁](?:thinking|thought|reasoning)\|>|$)/gi,'')
 .replace(/<\s*\/\s*(?:think|thinking|reasoning)\s*>|<｜end▁of▁(?:thinking|thought|reasoning)｜>|<\|end[_▁]of[_▁](?:thinking|thought|reasoning)\|>/gi,'').trim();
}
export function inject(messages,result,c) {
 const sections=[['world','세계관'],['plot','플롯'],['char','등장인물']].map(([key,label])=>[key,label,cleanOutput(result['context_'+key])]).filter(s=>s[2]);
 const safe=withoutOwn(messages);if(!sections.length)return safe;
 const escape=s=>s.replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
 let body=sections.map(([k,l,t])=>c.injection_format==='xml'?'<'+k+'>'+escape(t)+'</'+k+'>':c.injection_format==='markdown-table'?'| '+l+' | '+t.replaceAll('|','\\|').replaceAll('\n','<br>')+' |':'['+l+']\n'+t).join('\n\n');
 if(c.injection_format==='markdown-table')body='| 분석 | 메모 |\n| --- | --- |\n'+body;
 const note={role:'system',content:START+'\nAnalysis notes: facts and tentative suggestions; preserve user agency.\n'+body+'\n'+END};
 let at=safe.length;
 if(c.injection_position==='before-last-user'){for(let i=safe.length-1;i>=0;i--)if(safe[i]?.role==='user'){at=i;break}}
 else{at=0;for(let i=0;i<safe.length;i++)if(safe[i]?.role==='system')at=i+1}
 return [...safe.slice(0,at),note,...safe.slice(at)];
}
export function deadline(parent,ms) {
 const c=new AbortController();const abort=()=>c.abort(parent?.reason||new Error('분석 취소'));
 if(parent?.aborted)abort();else parent?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>c.abort(new Error('분석 시간 제한 초과')),Math.max(1,ms));
 return {signal:c.signal,close(){clearTimeout(timer);parent?.removeEventListener('abort',abort)}};
}
export async function guarded(promise,signal) {
 if(!signal)return promise;
 if(signal.aborted){Promise.resolve(promise).catch(()=>{});throw signal.reason}
 let reject,listener;const stopped=new Promise((_,r)=>{reject=r;listener=()=>reject(signal.reason);signal.addEventListener('abort',listener,{once:true})});
 try{return await Promise.race([promise,stopped])}finally{signal.removeEventListener('abort',listener)}
}
export async function responseJSON(response){
 if(!response)throw new Error('빈 HTTP 응답');
 let data;if(typeof response.json==='function'){try{data=await response.json()}catch{data=null}}
 else{data=response.data;if(typeof data==='string'){try{data=JSON.parse(data)}catch{data=null}}}
 const status=Number(response.status??200);
 if(response.ok===false||status>=400){const e=new Error(String(data?.error?.message||data?.detail||'HTTP '+status).slice(0,300));e.status=status;throw e}
 if(!data||typeof data!=='object')throw new Error('JSON 응답이 아닙니다');
 return data;
}
export const parseStored=v=>{try{return typeof v==='string'?JSON.parse(v):v}catch{return null}};
