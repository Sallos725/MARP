// Draws the progress display on the RisuAI page through the host's main-DOM proxy (mainDom permission).
// Best effort: an error stops the display for this session and never reaches the request path.
import {EMPTY,nextChange,reduce,view} from './hud.js';
const CLASS='marp-hud';
export const DEFAULT_TOP='calc(8px + env(safe-area-inset-top))';
// NMOS draws `.nmos-hud`; when it sits in the top-right band, MARP stacks below it. Nothing else is read.
const NMOS='.nmos-hud',TOP_BAND=60,GAP=6;
// Under the settings frame (z-index 1000) so an open panel covers it.
const ROOT_STYLE='position:fixed;top:'+DEFAULT_TOP+';right:calc(8px + env(safe-area-inset-right));z-index:900;display:flex;align-items:center;gap:6px;max-width:min(260px,calc(100vw - 32px));padding:6px 12px;background:#131b2e;border:1px solid #26324a;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.35);font:13px/1.4 system-ui,-apple-system,"Noto Sans KR",sans-serif;cursor:pointer;user-select:none;-webkit-user-select:none';
const DOT_STYLE='flex:none;width:8px;height:8px;border-radius:50%;box-sizing:border-box;';
const DOTS={pending:'border:1.5px solid #e2b865',running:'background:#e2b865',success:'background:#7ee0b5',error:'background:#ff9a9a',off:'background:#4a5670'};
const TEXT_STYLE='min-width:0;margin-left:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
const COLORS={busy:'#e7ecf5',ok:'#7ee0b5',muted:'#a3b0c6',warn:'#ff9a9a'};
export function createHud(deps){
 let state=EMPTY,problem=null,drawn=null,timer=null,queue=Promise.resolve(),dead=false;
 // All work runs in order on one chain; nothing here ever rejects to the caller.
 const run=task=>{queue=queue.then(task).catch(fail)};
 async function fail(e){
  try{problem=e?.message||String(e)}catch{problem='unknown'}
  try{deps.debug?.('[MARP] 진행 표시 중단:',problem)}catch{}
  await erase().catch(()=>{})
 }
 const stopTimer=()=>{if(timer!==null)deps.clearTimer(timer);timer=null};
 async function erase(){stopTimer();const d=drawn;drawn=null;if(!d)return;await Promise.allSettled([d.root.removeEventListener('click',d.listener),d.root.remove()])}
 async function draw(){
  const doc=await deps.rootDocument();if(!doc)throw Error('메인 화면 접근 권한이 없습니다');
  await (await doc.querySelector('.'+CLASS))?.remove();
  const body=await doc.querySelector('body');if(!body)throw Error('메인 화면에 body가 없습니다');
  const root=await doc.createElement('div');await root.addClass(CLASS);await root.setStyleAttribute(ROOT_STYLE);
  const dots=[];for(let i=0;i<3;i++){const dot=await doc.createElement('span');await dot.setStyleAttribute(DOT_STYLE+DOTS.off);await root.appendChild(dot);dots.push(dot)}
  const text=await doc.createElement('span');await text.setStyleAttribute(TEXT_STYLE);await root.appendChild(text);
  await body.appendChild(root);
  // The host listens on the whole document: act only on taps inside the pill. A failed registration
  // must not leave an unremovable, unlistenable pill behind.
  let listener;
  try{listener=await root.addEventListener('click',e=>{void hit(e)})}
  catch(e){await root.remove().catch(()=>{});throw e}
  return {doc,root,dots,text,listener,key:'',kind:'',dotKeys:[],top:DEFAULT_TOP};
 }
 async function hit(e){
  try{
   const d=drawn;if(!d)return;const r=await d.root.getBoundingClientRect();
   if(drawn!==d||r.right<=r.left)return;
   if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom)deps.openPanel()
  }catch(err){deps.debug?.('[MARP] 진행 표시 클릭 실패:',err?.message)}
 }
 async function place(d){
  let top=DEFAULT_TOP;const nmos=await d.doc.querySelector(NMOS);
  if(nmos){
   const [n,m]=await Promise.all([nmos.getBoundingClientRect(),d.root.getBoundingClientRect()]);
   if(d.top===DEFAULT_TOP)d.base=m.top;
   if(n.bottom>n.top&&n.top<(d.base??8)+TOP_BAND-8&&n.left<m.right&&n.right>m.left)top=Math.round(n.bottom+GAP)+'px'
  }
  if(top!==d.top){d.top=top;await d.root.setStyle('top',top)}
 }
 async function render(){
  if(dead)return;
  stopTimer();const now=deps.now(),v=view(state,now);
  if(!v)return erase();
  drawn??=await draw();const d=drawn,key=v.kind+'|'+v.text;
  if(d.key!==key){d.key=key;await d.text.setTextContent(v.text);if(d.kind!==v.kind){d.kind=v.kind;await d.text.setStyle('color',COLORS[v.kind])}}
  for(let i=0;i<3;i++)if(d.dotKeys[i]!==v.dots[i]){d.dotKeys[i]=v.dots[i];await d.dots[i].setStyleAttribute(DOT_STYLE+DOTS[v.dots[i]])}
  await place(d);
  const next=nextChange(state,now);if(next!==null)timer=deps.setTimer(()=>{timer=null;run(render)},Math.max(0,next-now));
 }
 async function active(){if(!problem&&await deps.enabled())return true;state=EMPTY;await erase();return false}
 return {
  event(e){run(async()=>{if(dead)return;if(!await active())return;state=reduce(state,e,deps.now());await render()})},
  // The toggle changed: off erases at once; on clears an earlier failure.
  refresh(){run(async()=>{if(dead)return;if(await deps.enabled()){problem=null;return}state=EMPTY;await erase()})},
  dispose(){dead=true;run(async()=>{state=EMPTY;await erase()})},
  problem:()=>problem,
  settled:()=>queue
 };
}
