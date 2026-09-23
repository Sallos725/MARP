const stable=value=>{
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
 return value;
};

export async function retryCacheKey(value){
 const source=JSON.stringify(stable(value));
 if(!globalThis.crypto?.subtle)return null;
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
