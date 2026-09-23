import {AGENTS,VERSION,cleanOutput,analysisInput,bypass,withoutOwn,inject,deadline,guarded,responseJSON,parseStored} from './core.js';
import {loadConfig,legacyConfig,validate,vaultKey,fullKey,exportPack,defaults,resolve,FIELDS} from './config.js';
import {HISTORY_LIMIT,recordRun} from './diagnostics.js';
import {openDashboard} from './ui.js';
import {pdfPodNote} from './pdfpod.js';
import {createRetryCache,retryCacheKey} from './retry-cache.js';
export async function start(host,{full=false,analyze,defaultPrompts,clearTokens,checkConnection}={}){
 let alive=true,ui=null,lastRun=null,runtime=null,runtimePending=null;
 const jobs=new Set(),parts=[],history=[];let loaded,nextId=0,manualPending=false;
 const retryCache=createRetryCache(),pendingAnalyses=new Map();
 const remember=(result,meta,c)=>{
  const record=recordRun(result,{id:++nextId,edition:full?'full':'lite',...meta},c);
  if(alive){history.unshift(record);history.length=Math.min(history.length,HISTORY_LIMIT);if(meta.kind!=='connection')lastRun=record}
  return record;
 };
 const getHistory=()=>structuredClone(history);
 const clearHistory=()=>{history.length=0;lastRun=null};
 const config=()=>loaded??=(loadConfig(host,full).catch(e=>{loaded=null;throw e}));
 const request=async(path,{method='GET',body,signal,base}={})=>{
  const c=await config();if(!alive)throw Error('플러그인 해제');
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason);jobs.add(controller);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const d=deadline(controller.signal,Math.min(120000,(c.analysis_timeout||120)*1000));
  try{if(d.signal.aborted)throw d.signal.reason;return await guarded(responseJSON(await guarded(host.nativeFetch((base||c.server_url).replace(/\/+$/,'')+path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),d.signal)),d.signal)}finally{d.close();signal?.removeEventListener('abort',abort);jobs.delete(controller)}
 };
 const runtimeConfig=async(c,signal)=>{
  if(runtime&&runtime.url===c.server_url&&Date.now()-runtime.at<60000)return runtime.value;
  if(runtimePending)return guarded(runtimePending,signal);
  runtimePending=(async()=>{const d=deadline(signal,5000);try{
   let value;try{value=await request('/runtime-config',{signal:d.signal})}catch(e){if(e.status!==404&&e.status!==405)throw e;const status=await request('/status',{signal:d.signal});value=status.config||status}
   runtime={url:c.server_url,at:Date.now(),value};return value;
  }finally{d.close();runtimePending=null}})();
  return guarded(runtimePending,signal);
 };
 const save=async draft=>{
  validate(draft);
  if(full){await request('/config',{method:'PUT',body:draft,base:draft.server_url});const local=legacyConfig(draft);delete local.marpConfig;delete local.agents;for(const k of ['provider','baseUrl','apiKey','model','temperature','maxTokens','extraBodyJson','pdfMode'])delete local[k];await host.pluginStorage.setItem(fullKey,{version:1,...local,savedAt:new Date().toISOString()});runtime=null}
  else await host.pluginStorage.setItem(vaultKey,{version:1,scope:'lite',savedAt:new Date().toISOString(),config:legacyConfig(draft)});
  // Arguments were historically authoritative. Update existing arguments too.
  const names={server_url:'server_url',context_window:'context_window',main_model_only:'main_model_only',bypass_hypamemory:'bypass_hypamemory',bypass_translate:'bypass_translate',bypass_lb_process:'bypass_lb_process',strict_mode:'strict_mode',injection_position:'injection_position',injection_format:'injection_format',analysis_language:'analysis_language'};
  if(!full)for(const k of ['provider','base_url','api_key','model','temperature','max_tokens','extra_body_json'])names['default_'+k]='agent_'+k;
  if(host.setArgument)await Promise.all(Object.entries(names).map(([key,arg])=>host.setArgument(arg,typeof draft[key]==='boolean'?(draft[key]?'1':'0'):String(draft[key]??''))));
  retryCache.clear();loaded=Promise.resolve({...draft});
  if(full)await runtimeConfig(draft).catch(()=>{});return draft;
 };
 const before=async(messages,mode)=>{
  if(!alive||!Array.isArray(messages))return messages;
  // Re-read arguments only on activity; no timer, no conversation cache.
  loaded=null;let c;try{c=await config()}catch{return messages}
  if(!alive||bypass(messages,mode,c))return messages;
  const clean=withoutOwn(messages),start=performance.now(),started_at=new Date().toISOString(),controller=new AbortController();jobs.add(controller);
  const d=deadline(controller.signal,(c.analysis_timeout||120)*1000);
  try{
   const server=full?await runtimeConfig(c,d.signal):c;
   const input=analysisInput(clean,Number(server.context_window)||10);
   input.analysis_language=c.analysis_language;
   const agents=full?null:Object.fromEntries(AGENTS.map(name=>[name,{enabled:c[name+'_enabled'],system_prompt:c[name+'_system_prompt'],user_prompt_template:c[name+'_user_prompt_template'],...Object.fromEntries(FIELDS.map(field=>[field,resolve(c,name)[field]]))}]));
   const identity=full?server.revision&&{edition:'full',server_url:c.server_url,revision:server.revision}:{edition:'lite',version:VERSION,agents};
   const key=identity?await retryCacheKey({input,identity}):null,entry=key&&retryCache.get(key);
   let pending=key&&pendingAnalyses.get(key),shared=!!pending;
   if(!entry&&!pending){
    pending=full?request('/analyze',{method:'POST',body:input,signal:d.signal}):guarded(analyze(host,c,input,d.signal),d.signal);
    if(key){pendingAnalyses.set(key,pending);pending.then(()=>{if(pendingAnalyses.get(key)===pending)pendingAnalyses.delete(key)},()=>{if(pendingAnalyses.get(key)===pending)pendingAnalyses.delete(key)})}
   }
   const result=entry?entry.result:await guarded(pending,d.signal);
   if(!alive)return clean;
   if(d.signal.aborted)throw d.signal.reason;
   const failed=Object.keys(result.errors||{}).length>0;
   const useful=['world','plot','char'].some(k=>cleanOutput(result['context_'+k]));
   const injected=useful&&!(c.strict_mode&&failed);
   const record=remember(result,{kind:'analysis',started_at,elapsed_ms:Math.round(performance.now()-start),history_messages:input.chat_history.length,input_chars:input.user_input.length,system_chars:input.system_context.length,status:injected?'injected':failed?'failed-no-injection':'empty-no-injection',cache_hit:!!entry,shared_analysis:shared,...(entry?{cache_age_ms:entry.age_ms,cache_source_id:entry.source_run_id}:{}),pdf_pod_note:!full&&failed?pdfPodNote(c):'',strict_note:c.strict_mode?'PDF Pod가 훅 오류를 흡수할 수 있어 메인 호출 차단은 보장되지 않습니다.':''},c);
   if(key&&!entry&&!shared&&!failed&&useful)retryCache.set(key,result,record.id);
   return injected?inject(clean,result,c):clean;
  }catch(e){
   if(alive)remember({},{kind:'analysis',started_at,status:'failed-no-injection',error:e.message,pdf_pod_note:full?'':pdfPodNote(c),elapsed_ms:Math.round(performance.now()-start),strict_note:c.strict_mode?'분석 주입 중단. PDF Pod 환경에서 메인 호출 차단은 보장되지 않습니다.':''},c);
   return clean;
  }finally{d.close();jobs.delete(controller)}
 };
 const manual=async(draft,kind,execute)=>{
  if(!alive)throw Error('플러그인 해제');
  if(manualPending)throw Error('진행 중인 테스트가 끝난 뒤 다시 실행해 주세요');
  validate(draft);manualPending=true;
  const c={...draft},started_at=new Date().toISOString(),started=performance.now(),controller=new AbortController();jobs.add(controller);
  const d=deadline(controller.signal,c.analysis_timeout*1000);
  try{
   const result=await guarded(execute(c,d.signal),d.signal);
   const failed=kind==='connection'?result.success===false:Object.keys(result.errors||{}).length>0;
   const useful=kind==='connection'?result.results?.some(r=>r.success):['world','plot','char'].some(k=>cleanOutput(result['context_'+k]));
   // Connection checks are bodyless GETs PDF Pod never converts, so warn even on success.
   return remember(result,{kind,started_at,elapsed_ms:Math.round(performance.now()-started),status:failed?(useful?'test-partial':'test-failed'):useful?'test-success':'test-empty',pdf_pod_note:full?'':pdfPodNote(c)},c);
  }catch(e){return remember({},{kind,started_at,elapsed_ms:Math.round(performance.now()-started),status:'test-failed',error:e.message,pdf_pod_note:full?'':pdfPodNote(c)},c)}
  finally{d.close();jobs.delete(controller);manualPending=false}
 };
 const test=(draft,pdf=false)=>manual(draft,pdf?'pdf-test':'text-test',async(c,signal)=>{
  c.default_pdf_mode=pdf?'quality':'off';for(const n of AGENTS)c[n+'_pdf_mode']='';
  const input={user_input:'Analyze this synthetic test turn.',system_context:'A fictional observatory. Only established facts may be treated as canon. '.repeat(30),chat_history:[],pdf_mode:c.default_pdf_mode};
  return full?request('/analyze',{method:'POST',body:input,signal,base:c.server_url}):analyze(host,c,input,signal);
 });
 const testConnection=(draft,target='')=>{
  if(target&&!AGENTS.includes(target))throw Error('에이전트를 확인해 주세요');
  return manual(draft,'connection',async(c,signal)=>{
   if(full)return request('/test/llm'+(target?'?agent='+encodeURIComponent(target):''),{signal,base:c.server_url});
   const results=await Promise.all(AGENTS.filter(n=>!target||n===target).map(async name=>{
    const a=resolve(c,name),base={name,provider:a.provider,model:a.model};
    if(!c[name+'_enabled'])return {...base,skipped:true,reason:'disabled'};
    const started=performance.now(),d=deadline(signal,Math.min(30,c.request_timeout)*1000);
    try{return {...base,...await guarded(checkConnection(host,a,d.signal),d.signal),success:true,latency_ms:Math.round(performance.now()-started)}}
    catch(e){return {...base,success:false,error:e.message,status_code:e.status,latency_ms:Math.round(performance.now()-started)}}
    finally{d.close()}
   }));
   return {success:results.every(r=>r.skipped||r.success),results};
  });
 };
 const presets={
  async list(){if(full)return (await request('/presets')).presets;return (parseStored(await host.pluginStorage.getItem('risu_multiagent_lite_preset_library_v1'))||{presets:[]}).presets},
  async get(id){if(full)return (await request('/presets/'+encodeURIComponent(id))).pack;const item=parseStored(await host.pluginStorage.getItem('risu_multiagent_lite_preset_v1:'+id));if(item)return item.pack||item;return (await this.list()).find(p=>p.id===id)?.pack},
  async put(name,pack){if(full)return request('/presets',{method:'POST',body:{name,pack}});const id='preset-'+crypto.randomUUID(),list=await this.list();await host.pluginStorage.setItem('risu_multiagent_lite_preset_v1:'+id,pack);const all=[{id,name,savedAt:new Date().toISOString()},...list];for(const old of all.slice(30))await host.pluginStorage.removeItem?.('risu_multiagent_lite_preset_v1:'+old.id);await host.pluginStorage.setItem('risu_multiagent_lite_preset_library_v1',{version:1,presets:all.slice(0,30)})},
  async remove(id){if(full)return request('/presets/'+encodeURIComponent(id),{method:'DELETE'});const list=(await this.list()).filter(p=>p.id!==id);await host.pluginStorage.setItem('risu_multiagent_lite_preset_library_v1',{version:1,presets:list});await host.pluginStorage.removeItem?.('risu_multiagent_lite_preset_v1:'+id)}
 };
 const open=async()=>{
  if(!alive)return;ui?.close();
  ui=openDashboard({full,host,connect:async url=>{const c=await config();loaded=Promise.resolve({...c,server_url:url});runtime=null;await host.setArgument?.('server_url',url);await host.pluginStorage.setItem(fullKey,{version:1,serverUrl:url,mainModelOnly:c.main_model_only,bypassHypaMemory:c.bypass_hypamemory,bypassTranslate:c.bypass_translate,bypassLbProcess:c.bypass_lb_process,strictMode:c.strict_mode,injectionPosition:c.injection_position,injectionFormat:c.injection_format,analysisLanguage:c.analysis_language})},getConfig:async()=>{const c=await config();return full?{...c,...await request('/config'),server_url:c.server_url}:c},save,presets,
   getPrompts:async()=>full?request('/prompts/defaults'):defaultPrompts(),
   getDiagnostics:async base=>({lastRun,server:full?await request('/status',{base}):undefined,version:VERSION}),
   test,testConnection,getHistory,clearHistory
  });
  await host.showContainer?.('fullscreen');
 };
 // Await hook registration before exposing UI; dispose late registrations too.
 let hook,hookRegistered=false;
 const dispose=async()=>{
  if(!alive)return;alive=false;for(const job of jobs)job.abort(Error('플러그인 해제'));jobs.clear();clearTokens?.();ui?.close();clearHistory();retryCache.clear();pendingAnalyses.clear();runtime=null;loaded=null;
  if(hookRegistered&&host.removeRisuReplacer)try{await host.removeRisuReplacer('beforeRequest',typeof hook==='string'?hook:before)}catch{}
  if(typeof hook==='function'&&hook!==before)try{await hook()}catch{}
  for(const id of parts)await host.unregisterUIPart?.(id);
  await host.hideContainer?.();
 };
 await host.onUnload?.(dispose);
 hook=await host.addRisuReplacer('beforeRequest',before);hookRegistered=true;
 if(!alive){await host.removeRisuReplacer?.('beforeRequest',before);return {before,open,dispose}}
 for(const register of [()=>host.registerSetting('MARP '+(full?'Full':'Lite'),open,'🔱','html'),()=>host.registerButton?.({name:'MARP '+(full?'Full':'Lite'),icon:'🔱',iconType:'html',location:'chat'},open)]){
  if(!alive)break;const part=await register();if(part?.id){if(alive)parts.push(part.id);else await host.unregisterUIPart?.(part.id)}
 }
 return {before,open,dispose,test,testConnection,getHistory,clearHistory,get lastRun(){return lastRun}};
}
