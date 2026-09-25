// A stand-in for RisuAI's SafeDocument/SafeElement proxy: every method is async, like the frame bridge.
export function fakeRoot(){
 const log=[];const listeners=new Map();let seq=0,failAdd=false,failRemove=false;
 const el=tag=>{const e={tag,classes:[],style:'',props:{},text:'',children:[],removed:false,rect:{left:300,right:380,top:8,bottom:38},
  remove:async()=>{e.removed=true},appendChild:async c=>{e.children.push(c)},addClass:async n=>{e.classes.push(n)},
  setStyleAttribute:async v=>{e.style=v},setStyle:async(p,v)=>{e.props[p]=v;log.push('setStyle '+p)},setTextContent:async v=>{e.text=v},
  getBoundingClientRect:async()=>e.rect,
  addEventListener:async(type,fn)=>{if(failAdd){failAdd=false;throw Error('addEventListener failed')}const id=++seq;listeners.set(id,fn);return id},
  removeEventListener:async(type,id)=>{if(failRemove){failRemove=false;throw Error('removeEventListener failed')}listeners.delete(id)}};return e};
 const body=el('body');
 const doc={nmos:null,stale:null,querySelector:async s=>s==='body'?body:s==='.nmos-hud'?doc.nmos:s==='.marp-hud'?doc.stale:null,createElement:async t=>el(t)};
 return {doc,body,log,el,click:e=>{for(const fn of [...listeners.values()])fn(e)},get listening(){return listeners.size>0},
  failNextAdd:()=>{failAdd=true},failNextRemove:()=>{failRemove=true}};
}
