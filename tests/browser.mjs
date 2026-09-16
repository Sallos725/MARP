import {chromium,webkit} from 'playwright';import {build} from 'esbuild';import {createServer} from 'node:http';import {writeFile,mkdir} from 'node:fs/promises';import assert from 'node:assert/strict';
const code=(await build({entryPoints:['tests/harness.js'],bundle:true,write:false,format:'iife',target:'es2020'})).outputFiles[0].text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'application/javascript':'text/html');res.end(req.url==='/bundle.js'?code:'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><script src="/bundle.js"></script></body></html>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
await mkdir('test-results',{recursive:true});
const metrics={date:new Date().toISOString(),browsers:[]};
try{for(const[name,type]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch({headless:true,args:name==='chromium'?['--js-flags=--expose-gc']:[]});
 try{for(const full of [false,true]){
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);const cdp=name==='chromium'?await page.context().newCDPSession(page):null;if(cdp)await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.evaluate(full=>setup(full),full);
 const timings=await page.evaluate(async()=>{const values=[];for(let i=0;i<20;i++){const start=performance.now();await instance.open();if(!document.querySelector('.marp-shell'))throw Error('shell missing');values.push(performance.now()-start);document.querySelector('[data-close]').click()}return values.sort((a,b)=>a-b)});
 await page.evaluate(()=>[...menuButtons.values()].find(b=>b.location==='chat').callback());await page.getByRole('heading',{name:'공통 설정',exact:true}).waitFor();
 assert.equal(await page.locator('.marp-panel [data-field]').first().getAttribute('data-field'),'main_model_only');
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
  const ooc=[{role:'system',content:'<!--MARP:bypass-->\n# HELENA OOC System Prompt'},{role:'user',content:'Help me'}];if(await run(ooc)!==ooc)throw Error('marked OOC request ran');
  const sameName=[{role:'system',content:'Helena is the protagonist.'},{role:'user',content:'Continue the story'}];if((await run(sameName)).length!==3)throw Error('unmarked same-name character was bypassed');
  return {state:{...testState},diag:instance.lastRun};
 },full);
 assert.equal(r.state.workers,0);assert.equal(r.state.urls,0);
 await page.evaluate(()=>instance.open());
 await page.getByRole('button',{name:'워터폴',exact:true}).click();
 await page.locator('.marp-waterfall-row').first().waitFor();assert.equal(await page.locator('.marp-waterfall-row').count(),3);
 assert.ok(await page.locator('.marp-waterfall-row[data-agent=plot] .marp-bar').count());
 assert.equal(await page.evaluate(()=>document.querySelector('.marp-shell').scrollWidth<=innerWidth),true,'mobile overflow');
 await page.screenshot({path:`test-results/${name}-${full?'full':'lite'}-waterfall.png`,fullPage:true});
 const beforeView=await page.evaluate(()=>({...testState}));
 await page.getByRole('button',{name:'호출 기록',exact:true}).click();await page.locator('.marp-records>li').first().waitFor();
 assert.equal(await page.locator('.marp-records>li').count(),3);
 await page.locator('.marp-records>li').first().locator('summary').first().click();
 await page.locator('.marp-records .marp-waterfall-row').first().waitFor();assert.equal(await page.locator('.marp-records .marp-waterfall-row').count(),3);
 assert.equal(await page.evaluate(()=>testState.requests),beforeView.requests);
 assert.equal(await page.evaluate(()=>testState.writes),beforeView.writes);
 await page.getByRole('button',{name:'연결 테스트',exact:true}).click();
 if(full){await page.getByRole('button',{name:'Full 서버 상태 확인',exact:true}).click();await page.getByText('서버 연결 확인 완료',{exact:false}).waitFor()}
 await page.getByRole('button',{name:'플롯 연결 테스트',exact:true}).click();
 await page.locator('.marp-summary').filter({hasText:'테스트 성공'}).waitFor();
 assert.equal(await page.evaluate(()=>instance.getHistory()[0].kind),'connection');
 await page.evaluate(()=>{failConnection=true});await page.getByRole('button',{name:'전체 연결 테스트',exact:true}).click();
 await page.locator('.marp-summary').filter({hasText:'테스트 실패'}).waitFor();await page.evaluate(()=>{failConnection=false});
 await page.getByRole('button',{name:'진단',exact:true}).click();await page.getByRole('button',{name:'텍스트 분석 테스트',exact:true}).click();
 await page.locator('.marp-summary').filter({hasText:'테스트 성공'}).waitFor();
 assert.equal(await page.evaluate(()=>instance.getHistory()[0].kind),'text-test');
 // Delayed manual results may update history, but never replace another tab.
 await page.evaluate(()=>{delayResponse=30});await page.getByRole('button',{name:'PDF 분석 테스트',exact:true}).click();
 await page.getByRole('button',{name:'공통',exact:true}).click();await page.waitForFunction(()=>instance.getHistory()[0].kind==='pdf-test');
 assert.equal(await page.getByRole('heading',{name:'공통 설정',exact:true}).count(),1);await page.evaluate(()=>{delayResponse=0});
 await page.getByRole('button',{name:'호출 기록',exact:true}).click();await page.getByLabel('호출 기록 필터').selectOption('failed');
 assert.equal(await page.locator('.marp-records>li').count(),1);
 await page.screenshot({path:`test-results/${name}-${full?'full':'lite'}-history.png`,fullPage:true});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'기록 JSON 내보내기',exact:true}).click();assert.equal((await download).suggestedFilename(),'marp-call-history.json');
 await page.getByRole('button',{name:'기록 비우기',exact:true}).click();await page.waitForFunction(()=>instance.getHistory().length===0);
 await page.getByRole('button',{name:'닫기',exact:true}).click();

 if(cdp)await cdp.send('HeapProfiler.collectGarbage');
 const heapBefore=cdp?(await cdp.send('Runtime.getHeapUsage')).usedSize:0;
 const longTasks=await page.evaluate(async()=>{
  const tasks=[];let observer;if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('longtask')){observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask',buffered:false})}
  for(let i=0;i<20;i++)await run([{role:'system',content:'A fictional observatory with established facts. '.repeat(100)},{role:'user',content:'Continue the current turn.'}]);
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
 assert.equal(await page.evaluate(()=>menuButtons.size),0);
 assert.deepEqual(errors,[]);
 metrics.browsers.push({name,edition:full?'full':'lite',shell_p95_ms:timings[18],pdf_long_tasks:longTasks,retained_heap_bytes:cdp?heapAfter-heapBefore:null,workers:0,object_urls:0,idle_requests:0,idle_storage_writes:0});
 // Exercise the actual minified release entry after the source harness checks.
 await page.evaluate(()=>{window.Risuai=host;host.registerSetting=async(label,open)=>{window.packagedOpen=open;return {id:'packaged-setting'}}});
 await page.addScriptTag({path:full?'full/plugin/risu-multiagent-full.js':'lite/risu-multiagent.js'});
 await page.waitForFunction(()=>typeof window.packagedOpen==='function'&&[...menuButtons.values()].some(b=>b.location==='chat'));
 await page.evaluate(async()=>{
  if([...menuButtons.values()].some(b=>b.location==='hamburger'))throw Error('old character-list menu entry remains');
  await [...menuButtons.values()].find(b=>b.location==='chat').callback();if(!document.querySelector('.marp-shell'))throw Error('chat menu did not open dashboard');document.querySelector('[data-close]').click();
  delayResponse=0;
  const out=await run([{role:'system',content:'Unicode 한글 日本語 😀 setting. '.repeat(100)},{role:'user',content:'Packaged plugin test'}]);
  if(out.length!==3)throw Error('packaged plugin did not inject');
  await unload();
 });
 assert.equal(await page.evaluate(()=>testState.hooks),0);
 assert.equal(await page.evaluate(()=>testState.workers),0);
 assert.equal(await page.evaluate(()=>testState.urls),0);
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>menuButtons.size),0);
 console.log(name,full?'full':'lite',metrics.browsers.at(-1));await page.close();
 }}finally{await browser.close()}
 }}finally{server.close()}
await mkdir('test-results',{recursive:true});await writeFile('test-results/browser-metrics.json',JSON.stringify(metrics,null,2)+'\n');
