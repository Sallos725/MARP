import {test} from 'node:test';import assert from 'node:assert/strict';
import {EMPTY,OUTCOME_MS,reduce,view,nextChange} from '../src/hud.js';
const pending={worldbuilding:'pending',plot:'pending',character:'off'};
const step=(s,events,now=0)=>events.reduce((st,e)=>reduce(st,e,now),s);
test('Lite progress names the running agents and the elapsed time',()=>{
 let s=step(EMPTY,[{type:'start',live:true,agents:pending}],1000);
 assert.deepEqual(view(s,1000),{kind:'busy',text:'분석 중… 0.0s',dots:['pending','pending','off']});
 s=step(s,[{type:'agent',name:'worldbuilding',status:'running'}]);assert.equal(view(s,3100).text,'세계관 분석 중… 2.1s');
 s=step(s,[{type:'agent',name:'worldbuilding',status:'success'},{type:'agent',name:'plot',status:'running'},{type:'agent',name:'character',status:'running'}]);
 assert.equal(view(s,5000).text,'플롯·등장인물 분석 중… 4.0s');assert.deepEqual(view(s,5000).dots,['success','running','running']);
 assert.equal(nextChange(s,5000),6000);
});
test('Full progress shows only the elapsed time',()=>{
 const s=step(EMPTY,[{type:'start',live:false,agents:{worldbuilding:'pending',plot:'pending',character:'pending'}},{type:'agent',name:'plot',status:'running'}],0);
 assert.equal(view(s,4000).text,'분석 중… 4.0s');
});
test('outcomes last four seconds and mark failed agents',()=>{
 const agents={worldbuilding:'success',plot:'error',character:'success'};
 let s=step(EMPTY,[{type:'start',live:true,agents:pending},{type:'end',outcome:'injected',chars:1284,cache:false,agents}],0);
 assert.deepEqual(view(s,0),{kind:'ok',text:'✓ 분석 주입 · 1,284자',dots:['success','error','success']});
 assert.equal(nextChange(s,0),OUTCOME_MS);assert.equal(view(s,OUTCOME_MS),null);assert.equal(nextChange(s,OUTCOME_MS),null);
 s=step(EMPTY,[{type:'end',outcome:'injected',chars:12,cache:true,agents}]);assert.equal(view(s,0).text,'↺ 캐시 재사용 · 12자');
 s=step(EMPTY,[{type:'end',outcome:'failed',chars:0,agents:{}}]);assert.deepEqual(view(s,0),{kind:'warn',text:'⚠ 실패 · 미주입',dots:['off','off','off']});
 s=step(EMPTY,[{type:'end',outcome:'empty',chars:0,agents}]);assert.equal(view(s,0).text,'– 결과 없음');
});
test('the elapsed tick stays aligned to whole seconds from the start time',()=>{
 const s=step(EMPTY,[{type:'start',live:true,agents:pending}],1000);
 assert.equal(nextChange(s,1300),2000);
});
test('agent events outside a run clear nothing extra',()=>{
 assert.equal(step(EMPTY,[{type:'agent',name:'plot',status:'running'}]),EMPTY);
 assert.equal(view(EMPTY,0),null);
});
