import {checkConnection} from '../src/providers.js';
import {start} from '../src/runtime.js';import {analyze,defaultPrompts} from '../src/pipeline.js';import {defaults,legacyConfig} from '../src/config.js';import {makePDF} from '../src/pdf.js';
window.marpHarness={start,analyze,defaultPrompts,makePDF,defaults};
window.testState={requests:0,writes:0,workers:0,urls:0,listeners:0,hooks:0,hudListeners:0};
const BaseWorker=window.Worker;
window.Worker=class extends BaseWorker{constructor(...args){super(...args);testState.workers++;this.live=true}terminate(){if(this.live){testState.workers--;this.live=false}return super.terminate()}};
const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),urls=new Set();
URL.createObjectURL=v=>{const u=create(v);urls.add(u);testState.urls=urls.size;return u};URL.revokeObjectURL=u=>{urls.delete(u);testState.urls=urls.size;revoke(u)};
const add=AbortSignal.prototype.addEventListener,remove=AbortSignal.prototype.removeEventListener;
const tracked=new WeakMap();AbortSignal.prototype.addEventListener=function(type,fn,opt){if(type==='abort'){let set=tracked.get(this);if(!set)tracked.set(this,set=new Set());if(!set.has(fn)){set.add(fn);testState.listeners++}}return add.call(this,type,fn,opt)};
AbortSignal.prototype.removeEventListener=function(type,fn,...args){if(type==='abort'&&tracked.get(this)?.delete(fn))testState.listeners--;return remove.call(this,type,fn,...args)};
// A SafeDocument over the real page, so the progress display runs on a real layout engine.
const hudListeners=new Map();let hudListenerId=0;
const safe=el=>({el,remove:async()=>el.remove(),appendChild:async c=>{el.appendChild(c.el)},addClass:async n=>el.classList.add(n),setStyleAttribute:async v=>el.setAttribute('style',v),setStyle:async(p,v)=>{el.style[p]=v},setTextContent:async v=>{el.textContent=v},getBoundingClientRect:async()=>el.getBoundingClientRect().toJSON(),
 addEventListener:async(type,fn)=>{const id='hud'+(++hudListenerId),l=e=>fn({clientX:e.clientX,clientY:e.clientY});hudListeners.set(id,[type,l]);document.addEventListener(type,l);testState.hudListeners=hudListeners.size;return id},
 removeEventListener:async(type,id)=>{const entry=hudListeners.get(id);if(entry){document.removeEventListener(entry[0],entry[1]);hudListeners.delete(id);testState.hudListeners=hudListeners.size}}});
window.fakeRoot={querySelector:async s=>{const el=document.querySelector(s);return el?safe(el):null},createElement:async t=>safe(document.createElement(t))};
window.setup=async full=>{
 window.menuButtons=new Map();
 const c=defaults();c.default_api_key='fixture';c.default_pdf_mode='quality';
 const storage=new Map([['risu_multiagent_lite_config_vault_v1',{version:1,scope:'lite',config:legacyConfig(c)}]]);let before,unload,part=0;
 const host={getArgument:async k=>k==='hud'?(window.hudArg||''):'',setArgument:async(k,v)=>{if(k==='hud')window.hudArg=String(v)},getRootDocument:async()=>window.hudGranted?fakeRoot:null,requestPluginPermission:async()=>{if(window.permissionDelay)await new Promise(r=>setTimeout(r,window.permissionDelay));window.hudGranted=true;return true},pluginStorage:{getItem:async k=>storage.get(k),setItem:async(k,v)=>{testState.writes++;storage.set(k,v)},removeItem:async k=>storage.delete(k)},
 addRisuReplacer:async(t,fn)=>{await new Promise(r=>setTimeout(r,5));before=fn;testState.hooks++;return undefined},
 removeRisuReplacer:async()=>{testState.hooks--},onUnload:async fn=>{unload=fn},registerSetting:async()=>({id:'setting'+(++part)}),registerButton:async(config,callback)=>{const id='button'+(++part);menuButtons.set(id,{...config,callback});return {id}},unregisterUIPart:async id=>{menuButtons.delete(id)},showContainer:async()=>{},hideContainer:async()=>{},
 nativeFetch:async(url,req={})=>{
  testState.requests++;if(window.delayResponse)await new Promise(r=>setTimeout(r,window.delayResponse));
  const path=new URL(url).pathname;
  let data;
  if(path==='/runtime-config'){if(window.oldSidecar)return new Response('{"detail":"Not Found"}',{status:404});data={context_window:10,analysis_timeout:120,request_timeout:60,revision:'mock'}}
  else if(path==='/status')data={config:{context_window:10},version:'0.9.0'};
  else if(path==='/config'){data=c;if(req.method==='PUT')Object.assign(c,JSON.parse(req.body))}
  else if(path==='/prompts/defaults')data=defaultPrompts();
  else if(path==='/presets')data={presets:[]};
  else if(path==='/test/llm')data={success:!window.failConnection,results:['worldbuilding','plot','character'].filter(n=>!new URL(url).searchParams.get('agent')||n===new URL(url).searchParams.get('agent')).map(name=>({name,model:c.default_model,provider:c.default_provider,success:!window.failConnection,status_code:window.failConnection?401:200,error:window.failConnection?'Unauthorized':'',latency_ms:15,check:'models'}))};
  else if(path.endsWith('/models')){if(window.failConnection)return new Response('{}',{status:401});data={data:[]}}
  else if(path==='/analyze'){window.lastPayload=JSON.parse(req.body);data={context_world:'World fact',context_plot:'Plot note',context_char:'Character motive',errors:{},latency_ms:{worldbuilding:20,plot:30,character:25},diagnostics:{worldbuilding:{status:'success',start_offset_ms:1},plot:{status:'success',start_offset_ms:21},character:{status:'success',start_offset_ms:21}}}}
  else{const body=JSON.parse(req.body);window.lastProviderBody=body;const system=body.messages?.find(m=>m.role==='system')?.content||'';if(window.failWorld&&system.startsWith('You are the worldbuilding'))return new Response('{"error":{"message":"fixture failure"}}',{status:500});data={choices:[{message:{content:window.emptyResult?'<think>hidden</think>':'Established fact; tentative possibility.'}}],usage:{prompt_tokens:20,completion_tokens:10}}}
  return window.dataResponse?{data:JSON.stringify(data),status:200,ok:true}:new Response(JSON.stringify(data));
 }};
 window.host=host;window.instance=await start(host,{full,analyze,defaultPrompts,checkConnection});window.run=(m,mode='model')=>before(m,mode);window.unload=()=>unload();
};
