import {test} from 'node:test';import assert from 'node:assert/strict';
import {createHud,DEFAULT_TOP} from '../src/hud-host.js';import {fakeRoot} from './fake-root.mjs';
const agents={worldbuilding:'pending',plot:'pending',character:'pending'};
function setup({noDoc=false}={}){
 const f=fakeRoot(),timers=new Map();let on=true,now=0,opened=0,seq=0;
 const hud=createHud({enabled:async()=>on,rootDocument:async()=>noDoc?null:f.doc,openPanel:()=>{opened++},now:()=>now,
  setTimer:(fn,ms)=>{timers.set(++seq,{fn,at:now+ms});return seq},clearTimer:id=>{timers.delete(id)},debug:()=>{}});
 const advance=async ms=>{now+=ms;for(const[id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn()}await hud.settled()};
 return {hud,f,timers,advance,setOn:v=>{on=v},get opened(){return opened},pill:()=>f.body.children[0]};
}
test('draws one pill in the top-right corner and ticks the elapsed time',async()=>{
 const s=setup();s.f.doc.stale=s.f.el('div');
 s.hud.event({type:'start',live:true,agents});await s.hud.settled();
 const pill=s.pill();assert.equal(s.f.doc.stale.removed,true,'a pill left by an earlier load is removed');
 assert.ok(pill.classes.includes('marp-hud'));assert.match(pill.style,/top:calc\(8px \+ env\(safe-area-inset-top\)\)/);assert.match(pill.style,/right:calc\(8px \+ env\(safe-area-inset-right\)\)/);
 assert.equal(pill.children.length,4);assert.equal(pill.children[3].text,'분석 중… 0.0s');
 s.hud.event({type:'agent',name:'worldbuilding',status:'running'});await s.hud.settled();
 await s.advance(1000);assert.equal(pill.children[3].text,'세계관 분석 중… 1.0s');assert.equal(s.timers.size,1);assert.equal(s.f.body.children.length,1);
});
test('shows the outcome for four seconds, then removes the pill and its listener',async()=>{
 const s=setup();
 s.hud.event({type:'start',live:false,agents});s.hud.event({type:'end',outcome:'injected',chars:1284,cache:false,agents:{worldbuilding:'success',plot:'error',character:'success'}});await s.hud.settled();
 const pill=s.pill();assert.equal(pill.children[3].text,'✓ 분석 주입 · 1,284자');assert.match(pill.children[1].style,/#ff9a9a/);assert.match(pill.children[0].style,/#7ee0b5/);
 await s.advance(3999);assert.equal(pill.removed,false);await s.advance(1);assert.equal(pill.removed,true);assert.equal(s.f.listening,false);assert.equal(s.timers.size,0);
});
test('moves below an NMOS pill in the top-right band, and back when it leaves',async()=>{
 const s=setup(),at=rect=>({getBoundingClientRect:async()=>rect});
 s.f.doc.nmos=at({left:250,right:382,top:8,bottom:40});
 s.hud.event({type:'start',live:true,agents});await s.hud.settled();const pill=s.pill();assert.equal(pill.props.top,'46px');
 s.f.doc.nmos=at({left:250,right:382,top:400,bottom:432});await s.advance(1000);assert.equal(pill.props.top,DEFAULT_TOP,'NMOS at the right middle is not in the way');
 s.f.doc.nmos=at({left:0,right:120,top:8,bottom:40});const writes=s.f.log.filter(l=>l==='setStyle top').length;await s.advance(1000);
 assert.equal(s.f.log.filter(l=>l==='setStyle top').length,writes,'NMOS on the other side changes nothing, and an unchanged top is not rewritten');
 s.f.doc.nmos=null;await s.advance(1000);assert.equal(pill.props.top,DEFAULT_TOP);
});
test('a tap inside the pill opens the panel; taps elsewhere do not',async()=>{
 const s=setup();s.hud.event({type:'start',live:true,agents});await s.hud.settled();
 s.f.click({clientX:10,clientY:10});await new Promise(r=>setTimeout(r,0));assert.equal(s.opened,0);
 s.f.click({clientX:320,clientY:20});await new Promise(r=>setTimeout(r,0));assert.equal(s.opened,1);
});
test('a drawing failure stops the display for the session and never throws',async()=>{
 const s=setup({noDoc:true});s.hud.event({type:'start',live:true,agents});await s.hud.settled();
 assert.match(s.hud.problem(),/권한/);s.hud.event({type:'end',outcome:'failed',chars:0,agents:{}});await s.hud.settled();assert.equal(s.f.body.children.length,0);
 s.hud.refresh();await s.hud.settled();assert.equal(s.hud.problem(),null);
});
test('turning the display off removes it at once and ignores later events',async()=>{
 const s=setup();s.hud.event({type:'start',live:true,agents});await s.hud.settled();const pill=s.pill();
 s.setOn(false);s.hud.refresh();await s.hud.settled();assert.equal(pill.removed,true);assert.equal(s.timers.size,0);
 s.hud.event({type:'start',live:true,agents});await s.hud.settled();assert.equal(s.f.body.children.length,1);
 s.setOn(true);s.hud.event({type:'start',live:true,agents});s.hud.dispose();await s.hud.settled();assert.equal(s.f.body.children.at(-1).removed,true);assert.equal(s.timers.size,0);
});
test('a failed listener registration removes the pill and never leaves it stuck',async()=>{
 const s=setup();s.f.failNextAdd();
 s.hud.event({type:'start',live:true,agents});await s.hud.settled();
 assert.equal(s.pill().removed,true);assert.match(s.hud.problem(),/addEventListener failed/);
});
test('a failed listener removal still removes the pill',async()=>{
 const s=setup();s.hud.event({type:'start',live:true,agents});await s.hud.settled();const pill=s.pill();
 s.f.failNextRemove();s.setOn(false);s.hud.refresh();await s.hud.settled();
 assert.equal(pill.removed,true);
});
test('accounts for the safe-area offset when comparing MARP against NMOS',async()=>{
 // On a notched phone both pills sit near y=65, well past the old absolute TOP_BAND=60 cutoff.
 const s=setup();
 s.hud.event({type:'start',live:true,agents});await s.hud.settled();
 const pill=s.pill();pill.rect={left:300,right:380,top:65,bottom:95};
 s.f.doc.nmos={getBoundingClientRect:async()=>({left:250,right:382,top:65,bottom:97})};
 await s.advance(1000);
 assert.equal(pill.props.top,'103px');
});
test('sets the text color only when the outcome kind changes, not every tick',async()=>{
 const s=setup();s.hud.event({type:'start',live:true,agents});await s.hud.settled();
 const colorWrites=()=>s.f.log.filter(l=>l==='setStyle color').length;
 assert.equal(colorWrites(),1);
 await s.advance(1000);await s.advance(1000);
 assert.equal(colorWrites(),1);
});
test('a tap racing an erase does not open the panel',async()=>{
 const s=setup();s.hud.event({type:'start',live:true,agents});await s.hud.settled();
 const pill=s.pill();let resolveRect;
 pill.getBoundingClientRect=()=>new Promise(r=>{resolveRect=r});
 s.f.click({clientX:320,clientY:20});
 s.setOn(false);s.hud.refresh();await s.hud.settled();
 resolveRect(pill.rect);
 await new Promise(r=>setTimeout(r,0));
 assert.equal(s.opened,0);
});
test('fail() never throws for a null-prototype error or a throwing debug(), so the queue stays alive',async()=>{
 const f=fakeRoot();
 const hud=createHud({enabled:async()=>{throw Object.create(null)},rootDocument:async()=>f.doc,openPanel:()=>{},now:()=>0,
  setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:id=>clearTimeout(id),debug:()=>{throw Error('debug boom')}});
 hud.event({type:'start',live:true,agents});
 await assert.doesNotReject(hud.settled());
 assert.equal(typeof hud.problem(),'string');
 hud.event({type:'start',live:true,agents});
 await assert.doesNotReject(hud.settled());
});
test('dispose() sets a disposed state so a later event draws nothing',async()=>{
 const s=setup();
 s.hud.dispose();s.hud.event({type:'start',live:true,agents});await s.hud.settled();
 assert.equal(s.f.body.children.length,0);
});
