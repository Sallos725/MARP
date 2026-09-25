// A stand-in for RisuAI's SafeDocument/SafeElement proxy: every method is async, like the frame bridge.
export function fakeRoot(){
 const log=[];let click=null;
 const el=tag=>{const e={tag,classes:[],style:'',props:{},text:'',children:[],removed:false,rect:{left:300,right:380,top:8,bottom:38},
  remove:async()=>{e.removed=true},appendChild:async c=>{e.children.push(c)},addClass:async n=>{e.classes.push(n)},
  setStyleAttribute:async v=>{e.style=v},setStyle:async(p,v)=>{e.props[p]=v;log.push('setStyle '+p)},setTextContent:async v=>{e.text=v},
  getBoundingClientRect:async()=>e.rect,addEventListener:async(type,fn)=>{click=fn;return 'listener'},removeEventListener:async()=>{click=null}};return e};
 const body=el('body');
 const doc={nmos:null,stale:null,querySelector:async s=>s==='body'?body:s==='.nmos-hud'?doc.nmos:s==='.marp-hud'?doc.stale:null,createElement:async t=>el(t)};
 return {doc,body,log,el,click:e=>click?.(e),get listening(){return !!click}};
}
