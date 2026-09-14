import {test} from 'node:test';import assert from 'node:assert/strict';
import {checkConnection} from '../src/providers.js';import {recordRun,waterfallRows} from '../src/diagnostics.js';import {analyze} from '../src/pipeline.js';import {defaults,resolve} from '../src/config.js';
test('connection checks use only metadata GETs with inherited provider authentication',async()=>{
 const c=defaults();c.default_api_key='key';const calls=[];const host={nativeFetch:async(url,req)=>{calls.push({url,...req});return {status:200,data:'{}'}}};
 for(const provider of ['openai','google','custom','anthropic']){c.default_provider=provider;await checkConnection(host,resolve(c,'plot'))}
 assert.ok(calls.every(c=>c.method==='GET'&&!c.body));assert.equal(calls[0].headers.Authorization,'Bearer key');assert.equal(calls[3].headers['x-api-key'],'key');assert.ok(calls[3].url.endsWith('/models/gpt-4o-mini'));
 await assert.rejects(checkConnection({nativeFetch:async()=>({status:401})},resolve(c,'plot')),e=>e.status===401);
});
test('measured waterfall retains parallel offsets and legacy records label estimated offsets',()=>{
 const r=recordRun({latency_ms:{worldbuilding:20,plot:35,character:25},diagnostics:{worldbuilding:{start_offset_ms:2},plot:{start_offset_ms:22},character:{start_offset_ms:22}}},{kind:'analysis'});
 assert.deepEqual(waterfallRows(r).map(r=>r.offset),[2,22,22]);assert.ok(waterfallRows(r).every(r=>!r.estimated));
 const old=waterfallRows({latency_ms:{worldbuilding:20,plot:35}});assert.equal(old[1].offset,20);assert.equal(old[1].estimated,true);assert.equal(old[2].duration,null);
});
test('Lite records stage timing, overrides, parallel execution and failure durations',async()=>{
 const c=defaults();c.default_api_key='key';c.plot_model='plot-model';c.character_model='char-model';let active=0,peak=0;
 const host={nativeFetch:async(_,req)=>{const b=JSON.parse(req.body);if(b.model==='plot-model'||b.model==='char-model'){active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--}if(b.model==='char-model')return {status:500,data:{error:{message:'failed'}}};return {data:{choices:[{message:{content:'note'}}],usage:{prompt_tokens:20}}}}};
 const r=await analyze(host,c,{chat_history:[],user_input:'now'},new AbortController().signal);assert.equal(peak,2);assert.equal(r.diagnostics.plot.model,'plot-model');assert.equal(r.diagnostics.character.status,'error');assert.ok(r.diagnostics.character.duration_ms>=10);assert.ok(r.diagnostics.plot.start_offset_ms>=r.diagnostics.worldbuilding.start_offset_ms+r.diagnostics.worldbuilding.duration_ms-1);
});
