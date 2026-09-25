// Progress display state as pure data. No DOM and no timers: hud-host.js draws it.
import {AGENTS,LABELS} from './core.js';
export const OUTCOME_MS=4000;
export const EMPTY={run:null,done:null};
export function reduce(state,event,now){
 switch(event.type){
  case 'start':return {run:{started:now,live:!!event.live,agents:{...event.agents}},done:null};
  case 'agent':return state.run&&event.name in state.run.agents?{...state,run:{...state.run,agents:{...state.run.agents,[event.name]:event.status}}}:state;
  case 'end':return {run:null,done:{outcome:event.outcome,chars:event.chars||0,cache:!!event.cache,agents:{...event.agents},until:now+OUTCOME_MS}};
  default:return state;
 }
}
const seconds=ms=>(Math.max(0,ms)/1000).toFixed(1)+'s';
const dotsOf=agents=>AGENTS.map(n=>agents[n]||'off');
export function view(state,now){
 const r=state.run;
 if(r){const running=r.live?AGENTS.filter(n=>r.agents[n]==='running'):[];return {kind:'busy',text:(running.length?running.map(n=>LABELS[n]).join('·')+' ':'')+'분석 중… '+seconds(now-r.started),dots:dotsOf(r.agents)}}
 const d=state.done;if(!d||now>=d.until)return null;
 if(d.outcome==='injected')return {kind:'ok',text:(d.cache?'↺ 캐시 재사용 · ':'✓ 분석 주입 · ')+d.chars.toLocaleString('en-US')+'자',dots:dotsOf(d.agents)};
 if(d.outcome==='empty')return {kind:'muted',text:'– 결과 없음',dots:dotsOf(d.agents)};
 return {kind:'warn',text:'⚠ 실패 · 미주입',dots:dotsOf(d.agents)};
}
// When the view next changes by itself: the elapsed-time tick while running, or the outcome expiring.
export function nextChange(state,now){
 const r=state.run;if(r)return r.started+(Math.floor((now-r.started)/1000)+1)*1000;
 return state.done&&state.done.until>now?state.done.until:null;
}
