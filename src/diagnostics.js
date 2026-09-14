import {AGENTS,VERSION,cleanOutput} from './core.js';
import {resolve} from './config.js';

export const HISTORY_LIMIT=50;
export const PREVIEW_LIMIT=2000;
const contexts={worldbuilding:'context_world',plot:'context_plot',character:'context_char'};
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;

// Keep bounded, displayable summaries only; never retain request/config objects.
export function recordRun(result,meta,c={}){
 const secrets=[];
 for(const [k,v] of Object.entries(c))if(k.endsWith('api_key')&&typeof v==='string'&&v){
  secrets.push(v);try{const sa=JSON.parse(v);if(sa.private_key)secrets.push(sa.private_key)}catch{}
 }
 const safe=(v,limit=400)=>{let s=String(v??'');for(const secret of secrets)s=s.replaceAll(secret,'[redacted]');return s.length>limit?s.slice(0,limit)+'…':s};
 const out={version:1,plugin_version:VERSION,...meta,errors:{},latency_ms:{},diagnostics:{},previews:{}};
 if(meta.error)out.error=safe(meta.error);
 for(const name of AGENTS){
  const connection=result.results?.find(r=>r.name===name);
  const d=connection?{...connection,status:connection.skipped?'skipped':connection.success?'success':'error'}:result.diagnostics?.[name]||(meta.kind==='connection'&&!meta.error?{status:'skipped',reason:result.skipped?.includes(name)||c[name+'_enabled']===false?'disabled':'not-tested'}:{});
  const preview=cleanOutput(result[contexts[name]]||'');
  const a=meta.edition==='full'?{}:resolve(c,name),error=result.errors?.[name]||d.error;
  const status=d.status||(error?'error':preview?'success':c[name+'_enabled']===false?'skipped':'unknown');
  const entry={status,provider:safe(d.provider??a.provider,100),model:safe(d.model??a.model,200)};
  for(const k of ['start_offset_ms','duration_ms','chars','status_code'])if(finite(d[k]))entry[k]=d[k];
  const duration=result.latency_ms?.[name]??d.duration_ms??d.latency_ms;
  if(finite(duration))out.latency_ms[name]=duration;
  if(error){out.errors[name]=safe(error);entry.error=safe(error)}
  if(d.reason)entry.reason=safe(d.reason);
  if(d.check)entry.check=safe(d.check);
  if(d.usage&&typeof d.usage==='object')entry.usage=Object.fromEntries(Object.entries(d.usage).filter(([k,v])=>/token/i.test(k)&&finite(v)).slice(0,20).map(([k,v])=>[k.slice(0,80),v]));
  if(d.pdf){entry.pdf={};for(const k of ['mode','applied','reason','estimated_source_tokens','bytes','text_retry'])if(['string','number','boolean'].includes(typeof d.pdf[k]))entry.pdf[k]=typeof d.pdf[k]==='string'?safe(d.pdf[k]):d.pdf[k]}
  out.diagnostics[name]=entry;
  if(preview)out.previews[name]={text:safe(preview,PREVIEW_LIMIT),truncated:preview.length>PREVIEW_LIMIT};
 }
 return out;
}

export function waterfallRows(record){
 const world=record.latency_ms?.worldbuilding||0;
 return AGENTS.map(name=>{
  const d=record.diagnostics?.[name]||{},duration=record.latency_ms?.[name];
  const measured=finite(d.start_offset_ms);
  return {name,...d,duration:finite(duration)?duration:null,offset:measured?d.start_offset_ms:name==='worldbuilding'?0:world,estimated:!measured&&finite(duration)};
 });
}
