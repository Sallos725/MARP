import {test} from 'node:test';import assert from 'node:assert/strict';import {start} from '../src/runtime.js';import {defaults,legacyConfig,loadConfig} from '../src/config.js';
function fixture({full=false,result={context_world:'fact',errors:{}},old=false}={}){
 const c=defaults();c.default_api_key='fake';const store=new Map([['risu_multiagent_lite_config_vault_v1',{config:legacyConfig(c)}]]);const calls=[];let unload,hook,remove=0;
 const host={pluginStorage:{getItem:async k=>store.get(k),setItem:async(k,v)=>store.set(k,v)},getArgument:async()=>'',addRisuReplacer:async(_,fn)=>{hook=fn},removeRisuReplacer:async()=>{remove++},onUnload:async fn=>{unload=fn},registerSetting:async()=>{},registerButton:async()=>{},
 nativeFetch:async(url,req)=>{calls.push({url,body:req.body&&JSON.parse(req.body)});if(url.endsWith('/runtime-config'))return old?{status:404,data:{detail:'not found'}}:{status:200,data:{context_window:3,revision:'fixture'}};if(url.endsWith('/status'))return {data:{config:{context_window:3}}};return {data:result}}};
 return {host,calls,c,get hook(){return hook},get remove(){return remove},unload:()=>unload(),result,store};
}
test('Full falls back to old status and caches only runtime config for activity',async()=>{const f=fixture({full:true,old:true});const app=await start(f.host,{full:true});const m=[{role:'system',content:'settings'},...Array.from({length:100},()=>({role:'assistant',content:'old'})),{role:'user',content:'now'},{role:'assistant',content:'continue'}];await app.before(m,'model');await app.before(m,'model');assert.equal(f.calls.filter(c=>c.url.endsWith('/status')).length,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/analyze')).length,2,'old servers without a config revision are not cached');const body=f.calls.find(c=>c.url.endsWith('/analyze')).body;assert.equal(body.chat_history.length,3);assert.equal(body.chat_history.at(-1).content,'continue');assert.equal(body.system_context,'settings');await app.dispose()});
test('Full reuses an identical successful analysis with a server config revision',async()=>{const f=fixture({full:true,result:{context_world:'fact',context_plot:'plot',context_char:'character',errors:{}}}),app=await start(f.host,{full:true}),input=[{role:'user',content:'continue'}];const first=await app.before(input,'model');await app.before(first,'model');assert.equal(f.calls.filter(c=>c.url.endsWith('/analyze')).length,1);assert.equal(app.lastRun.cache_hit,true);await app.dispose()});
test('successful identical analyses are reused until the input or config changes',async()=>{
 const f=fixture();let analyses=0;const app=await start(f.host,{analyze:async()=>{analyses++;return {context_world:'world',context_plot:'plot',context_char:'character',errors:{}}}}),input=[{role:'system',content:'setting'},{role:'user',content:'continue'}];
 const first=await app.before(input,'model');assert.equal(analyses,1);assert.equal(app.lastRun.cache_hit,false);
 const retry=await app.before(first,'model');assert.equal(analyses,1);assert.equal(retry.length,first.length);assert.equal(app.lastRun.cache_hit,true);assert.equal(app.lastRun.cache_source_id,1);
 await app.before([{role:'system',content:'setting'},{role:'user',content:'changed'}],'model');assert.equal(analyses,2);
 f.c.default_model='different';f.store.set('risu_multiagent_lite_config_vault_v1',{config:legacyConfig(f.c)});await app.before(input,'model');assert.equal(analyses,3);
 await app.dispose();
});
test('failed, partial, and empty analyses are never reused',async()=>{
 const f=fixture(),results=[{errors:{worldbuilding:'down'}},{context_world:'partial',errors:{plot:'down'}},{context_world:'<think>hidden</think>',errors:{}},{context_world:'complete',errors:{}}];let analyses=0;
 const app=await start(f.host,{analyze:async()=>results[Math.min(analyses++,results.length-1)]}),input=[{role:'user',content:'continue'}];
 for(let i=0;i<4;i++)await app.before(input,'model');assert.equal(analyses,4);
 await app.before(input,'model');assert.equal(analyses,4);assert.equal(app.lastRun.cache_hit,true);await app.dispose();
});
test('concurrent identical requests share one in-flight analysis',async()=>{
 const f=fixture();let analyses=0,release,markStarted;const ready=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{markStarted=resolve});
 const app=await start(f.host,{analyze:async()=>{analyses++;markStarted();await ready;return {context_world:'complete',errors:{}}}}),input=[{role:'user',content:'continue'}];
 const first=app.before(input,'model'),second=app.before(input,'model');await started;await new Promise(resolve=>setTimeout(resolve,0));assert.equal(analyses,1);release();await Promise.all([first,second]);
 assert.equal(analyses,1);assert.equal(app.getHistory().filter(record=>record.shared_analysis).length,1);await app.dispose();
});
test('partial results, empty output and disabled agents do not fabricate context',async()=>{const f=fixture();let result={context_world:'fact',errors:{plot:'failed'}};const app=await start(f.host,{analyze:async()=>result});const messages=[{role:'user',content:'now'}];assert.equal((await app.before(messages,'model')).length,2);result={context_world:'<think>hidden</think>',errors:{}};assert.deepEqual(await app.before(messages,'model'),messages);assert.equal(app.lastRun.status,'empty-no-injection');result={errors:{worldbuilding:'bad'}};assert.deepEqual(await app.before(messages,'model'),messages);await app.dispose()});
test('late registration and late analysis are disposed without injection',async()=>{const f=fixture();let resolve;f.host.addRisuReplacer=async()=>new Promise(r=>{resolve=r});const pending=start(f.host,{analyze:async()=>({context_world:'late',errors:{}})});await new Promise(r=>setTimeout(r,0));await f.unload();resolve();const app=await pending;assert.equal(f.remove,1);const m=[{role:'user',content:'current'}];assert.equal(await app.before(m,'model'),m)});

test('history is bounded, detached, redacted, and never persisted',async()=>{
 const f=fixture(),app=await start(f.host,{analyze:async()=>({context_world:'fact '.repeat(2000),errors:{plot:'fake credential'},diagnostics:{worldbuilding:{status:'success',usage:{prompt_tokens:30,secret:'fake'}}}})});
 const before=JSON.stringify([...f.store]);
 for(let i=0;i<55;i++)await app.before([{role:'user',content:'private input'}],'model');
 const history=app.getHistory();assert.equal(history.length,50);assert.equal(history[0].id,55);assert.equal(history.at(-1).id,6);
 assert.equal(history[0].previews.worldbuilding.text.length,2001);assert.equal(history[0].previews.worldbuilding.truncated,true);
 assert.ok(!JSON.stringify(history).includes('private input'));assert.ok(!JSON.stringify(history).includes('fake'));
 history[0].status='mutated';assert.equal(app.getHistory()[0].status,'injected');assert.equal(JSON.stringify([...f.store]),before);
 app.clearHistory();assert.equal(app.lastRun,null);assert.equal(app.getHistory().length,0);await app.dispose();
});
test('manual connection checks skip OFF agents, record errors, and never analyze',async()=>{
 const f=fixture(),called=[];let analyses=0;
 const app=await start(f.host,{analyze:async()=>{analyses++;return {context_world:'ok'}},checkConnection:async(_,a)=>{called.push(a.model);if(a.model==='denied'){const e=Error('denied');e.status=401;throw e}return {status_code:200,check:'models'}}});
 f.c.plot_model='denied';f.c.character_enabled=false;
 const record=await app.testConnection(f.c);assert.equal(analyses,0);assert.equal(called.length,2);assert.equal(record.status,'test-partial');assert.equal(record.diagnostics.plot.status_code,401);assert.equal(record.diagnostics.character.status,'skipped');assert.equal(app.lastRun,null);
 const test=await app.test(f.c);assert.equal(test.kind,'text-test');assert.equal(app.getHistory().length,2);assert.equal(analyses,1);await app.dispose();assert.equal(app.getHistory().length,0);
});
test('timeouts and rejected tests leave records, while unload drops late records',async()=>{
 const f=fixture(),app=await start(f.host,{analyze:async()=>new Promise(()=>{})});
 f.c.analysis_timeout=.01;f.store.set('risu_multiagent_lite_config_vault_v1',{config:legacyConfig(f.c)});
 const input=[{role:'user',content:'now'}];assert.deepEqual(await app.before(input,'model'),input);assert.equal(app.lastRun.status,'failed-no-injection');assert.ok(app.lastRun.error);
 const pending=app.test(f.c);await assert.rejects(app.test(f.c),/진행 중/);assert.equal((await pending).status,'test-failed');
 const late=app.test(f.c);await app.dispose();await late;assert.equal(app.getHistory().length,0);
});
test('Full connection tests use the selected server and legacy GET agent route',async()=>{
 const f=fixture({full:true,result:{success:true,results:[{name:'plot',success:true,provider:'custom',model:'saved-model',latency_ms:8,status_code:200}]}}),app=await start(f.host,{full:true});
 f.c.server_url='https://selected.example';const r=await app.testConnection(f.c,'plot');assert.equal(f.calls[0].url,'https://selected.example/test/llm?agent=plot');assert.equal(f.calls[0].body,undefined);assert.equal(r.diagnostics.plot.model,'saved-model');assert.equal(r.diagnostics.worldbuilding.status,'skipped');await app.dispose();
});
test('PDF Pod child runs attach the fix to failed analyses and connection checks only',async()=>{
 const f=fixture();let result={context_world:'fact',errors:{}};globalThis.document={__pdfPodHost:{}};
 try{
  const app=await start(f.host,{analyze:async()=>result,checkConnection:async()=>({status_code:200,check:'models'})});
  await app.before([{role:'user',content:'now'}],'model');assert.equal(app.lastRun.pdf_pod_note,'');
  result={errors:{worldbuilding:'Agent API 400'}};await app.before([{role:'user',content:'changed'}],'model');assert.match(app.lastRun.pdf_pod_note,/API 형식 변환 "끄기"/);
  const check=await app.testConnection(f.c);assert.equal(check.status,'test-success');assert.match(check.pdf_pod_note,/세계관·플롯·등장인물/);
  f.c.default_provider='anthropic';assert.equal((await app.testConnection(f.c)).pdf_pod_note,'');
  await app.dispose();
 }finally{delete globalThis.document}
});
test('the progress display setting defaults off and follows its argument',async()=>{
 assert.equal(defaults().hud,false);
 const host={pluginStorage:{getItem:async()=>null},getArgument:async k=>k==='hud'?'1':''};
 assert.equal((await loadConfig(host)).hud,true);assert.equal((await loadConfig(host,true)).hud,true);
 assert.equal(legacyConfig({...defaults(),hud:true}).hud,true);
});
