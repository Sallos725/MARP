const stable=value=>{
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
 return value;
};

export async function retryCacheKey(value){
 const source=JSON.stringify(stable(value));
 if(!globalThis.crypto?.subtle){
  let h1=1779033703,h2=3144134277,h3=1013904242,h4=2773480762;
  for(let i=0;i<source.length;i++){const k=source.charCodeAt(i);h1=h2^Math.imul(h1^k,597399067);h2=h3^Math.imul(h2^k,2869860233);h3=h4^Math.imul(h3^k,951274213);h4=h1^Math.imul(h4^k,2716044179)}
  h1=Math.imul(h3^(h1>>>18),597399067);h2=Math.imul(h4^(h2>>>22),2869860233);h3=Math.imul(h1^(h3>>>17),951274213);h4=Math.imul(h2^(h4>>>19),2716044179);
  return 'hash128:'+source.length+':'+[h1^h2^h3^h4,h2^h1,h3^h1,h4^h1].map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');
 }
 const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
 return 'sha256:'+Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function createRetryCache({ttl=10*60*1000,limit=8,now=Date.now}={}){
 const entries=new Map();
 const prune=()=>{
  const cutoff=now()-ttl;
  for(const [key,entry]of entries)if(entry.created_at<=cutoff)entries.delete(key);
  while(entries.size>limit)entries.delete(entries.keys().next().value);
 };
 return {
  get(key){
   prune();const entry=entries.get(key);if(!entry)return null;
   entries.delete(key);entries.set(key,entry);
   return {...entry,age_ms:Math.max(0,now()-entry.created_at)};
  },
  set(key,result,source_run_id){
   entries.delete(key);entries.set(key,{result,source_run_id,created_at:now()});prune();
  },
  clear(){entries.clear()},
  get size(){prune();return entries.size}
 };
}
