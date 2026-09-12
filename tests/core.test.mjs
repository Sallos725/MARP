import {test} from 'node:test';import assert from 'node:assert/strict';
import {analysisInput,inject,withoutOwn,bypass,cleanOutput,responseJSON,deadline,guarded} from '../src/core.js';
import {defaults,migrate,resolve,exportPack,importPack} from '../src/config.js';
test('preserves structured content, foreign metadata and idempotent ownership',()=>{
 const attachment={type:'image_url',image_url:{url:'data:fixture'}},meta={cache_control:{type:'ephemeral'}};
 const input=[{role:'system',content:[{type:'text',text:'setting',...meta},attachment],name:'foreign'},{role:'user',content:'go'}];const snapshot=JSON.stringify(input);
 const once=inject(input,{context_world:'fact'},defaults()),twice=inject(once,{context_world:'new fact'},defaults());
 assert.equal(JSON.stringify(input),snapshot);assert.equal(twice.length,3);assert.equal(twice[0],input[0]);assert.deepEqual(withoutOwn(twice),input);assert.equal(inject(input,{},defaults()),input);
});
test('continuation retains newest assistant and limits serialization',()=>{const m=[{role:'system',content:'setting'},...Array.from({length:1000},()=>({role:'assistant',content:'old'})),{role:'user',content:'current'},{role:'assistant',content:'continue this'}];const r=analysisInput(m,10);assert.equal(r.user_input,'current');assert.equal(r.chat_history.length,10);assert.equal(r.chat_history.at(-1).content,'continue this');assert.equal(r.system_context,'setting');assert.equal(analysisInput(m,1).chat_history.length,1)});
test('bypass and reasoning output',()=>{for(const m of ['memory','translate','submodel','emotion'])assert.ok(bypass([],m,defaults()));assert.equal(bypass([],'model',defaults()),false);assert.equal(cleanOutput('<think>hidden</think>fact'),'fact');assert.equal(cleanOutput('<think>unfinished'),'')});
test('configuration migration, zero values and credential-free legacy presets',()=>{const c=migrate({temperature:0,apiKey:'secret',agents:{plot:{model:'override'}}});assert.equal(resolve(c,'worldbuilding').temperature,0);assert.equal(resolve(c,'plot').model,'override');c.plot_api_key='agent-secret';const pack=exportPack(c,'lite');assert.ok(!JSON.stringify(pack).includes('secret'));const imported=importPack(defaults(),pack);assert.equal(imported.default_temperature,0);assert.equal(imported.plot_model,'override')});
test('Response and data adapters and cancellation',async()=>{assert.deepEqual(await responseJSON(new Response('{"ok":true}')),{ok:true});assert.deepEqual(await responseJSON({data:'{"ok":true}',status:200}),{ok:true});await assert.rejects(()=>responseJSON({data:{error:{message:'denied'}},status:401}));const d=deadline(null,5);try{await assert.rejects(guarded(new Promise(()=>{}),d.signal),/시간/)}finally{d.close()}});

test('preset export strips credentials in advanced JSON and endpoint URLs',()=>{
 const c=defaults();c.default_base_url='https://user:password@proxy.test/v1?api_key=hidden';c.default_extra_body_json=JSON.stringify({providerOptions:{authorization:'secret',cache:true}});const text=JSON.stringify(exportPack(c,'lite'));for(const secret of ['password','hidden','secret'])assert.ok(!text.includes(secret));assert.ok(text.includes('cache'));
});
