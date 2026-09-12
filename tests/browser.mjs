import {chromium,webkit} from 'playwright';import {build} from 'esbuild';import {createServer} from 'node:http';import {writeFile,mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';
const code=(await build({entryPoints:['tests/harness.js'],bundle:true,write:false,format:'iife',target:'es2020'})).outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'application/javascript':'text/html');res.end(req.url==='/bundle.js'?code:'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><script src="/bundle.js"></script></body></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const metrics={date:new Date().toISOString(),browsers:[]};
try{for(const[name,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch({headless:true,args:name==='chromium'?['--js-flags=--expose-gc']:[]});
 try{for(const full of [false,true]){
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);const cdp=name==='chromium'?await page.context().newCDPSession(page):null;if(cdp)await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.evaluate(full=>setup(full),full);
 const timings=await page.evaluate(async()=>{const values=[];for(let i=0;i<20;i++){const start=performance.now();await instance.open();if(!document.querySelector('.marp-shell'))throw Error('shell missing');values.push(performance.now()-start);document.querySelector('[data-close]').click()}return values.sort((a,b)=>a-b)});
 await page.evaluate(()=>instance.open());await page.getByRole('heading',{name:'공통 설정',exact:true}).waitFor();
 await page.locator('[data-field=default_temperature]').fill('0');await page.getByRole('button',{name:'프롬프트',exact:true}).click();await page.locator('[data-field=plot_system_prompt]').fill('Saved while hidden');await page.getByRole('button',{name:'등장인물',exact:true}).click();await page.getByRole('button',{name:'설정 저장',exact:true}).click();await page.getByRole('status').filter({hasText:'설정을 저장했습니다.'}).waitFor();
 await page.getByRole('button',{name:'프롬프트',exact:true}).click();assert.equal(await page.locator('[data-field=plot_system_prompt]').inputValue(),'Saved while hidden');
 await page.getByRole('button',{name:'닫기',exact:true}).click();
 const beforeIdle=await page.evaluate(()=>({...testState}));await page.waitForTimeout(120);assert.deepEqual(await page.evaluate(()=>({...testState})),beforeIdle);
 const r=await page.evaluate(async full=>{
  const input=[{role:'system',content:[{type:'text',text:'한글 日本語 😀 설정 '.repeat(100),cache_control:{type:'ephemeral'}},{type:'image_url',image_url:{url:'data:fixture'}}]},...Array.from({length:100},()=>({role:'assistant',content:'older'})),{role:'user',content:'Current user'},{role:'assistant',content:'Newest continuation'}];
  const once=await run(input),twice=await run(once);if(once.length!==input.length+1||twice.length!==once.length)throw Error('duplicate injection');
  if(JSON.stringify(once[0])!==JSON.stringify(input[0]))throw Error('metadata lost');
  const bypass=await run(input,'memory');if(bypass!==input)throw Error('auxiliary request ran');
  if(full&&(lastPayload.chat_history.length!==10||lastPayload.chat_history.at(-1).content!=='Newest continuation'||!lastPayload.system_context))throw Error('history lost');
  return {state:{...testState},diag:instance.lastRun};
 },full);
 assert.equal(r.state.workers,0);assert.equal(r.state.urls,0);
 if(cdp)await cdp.send('HeapProfiler.collectGarbage');
 const heapBefore=cdp?(await cdp.send('Runtime.getHeapUsage')).usedSize:0;
 const longTasks=await page.evaluate(async()=>{
  const tasks=[];let observer;if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('longtask')){observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask',buffered:false})}
  for(let i=0;i<20;i++)await marpHarness.makePDF('한글 日本語 😀\\n'.repeat(5000));
  await new Promise(r=>setTimeout(r,30));observer?.disconnect();return tasks;
 });
 if(cdp)await cdp.send('HeapProfiler.collectGarbage');
 const heapAfter=cdp?(await cdp.send('Runtime.getHeapUsage')).usedSize:0;
 assert.equal(await page.evaluate(()=>testState.workers),0);assert.equal(await page.evaluate(()=>testState.urls),0);
 assert.equal(await page.evaluate(()=>testState.listeners),0);
 assert.ok(heapAfter-heapBefore<=2*1024*1024,'retained heap limit');
 assert.ok(timings[18]<=100,'shell p95 '+timings[18]);
 assert.equal(longTasks.length,0,'PDF main-thread long tasks: '+longTasks);
 await page.evaluate(async()=>{dataResponse=true;await run([{role:'user',content:'test'}]);delayResponse=100;const pending=run([{role:'user',content:'late'}]);await new Promise(r=>setTimeout(r,10));await unload();const result=await pending;if(result.length!==1)throw Error('late result injected')});
 assert.equal(await page.evaluate(()=>testState.workers),0);assert.equal(await page.evaluate(()=>testState.hooks),0);
 assert.deepEqual(errors,[]);
 metrics.browsers.push({name,edition:full?'full':'lite',shell_p95_ms:timings[18],pdf_long_tasks:longTasks,retained_heap_bytes:cdp?heapAfter-heapBefore:null,workers:0,object_urls:0,idle_requests:0,idle_storage_writes:0});
 console.log(name,full?'full':'lite',metrics.browsers.at(-1));await page.close();
 }}finally{await browser.close()}
 }}finally{server.close()}
await mkdir('test-results',{recursive:true});await writeFile('test-results/browser-metrics.json',JSON.stringify(metrics,null,2)+'\n');
