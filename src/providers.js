import {cleanOutput,contentText,responseJSON,guarded} from './core.js';
import {makePDF,pdfSource,hasPDF,PDF_TASK,unsupportedPDF} from './pdf.js';
const kind=a=>String(a.provider).toLowerCase().replaceAll('_','-');
const anthropic=a=>['claude','anthropic'].includes(kind(a));
const vertex=a=>['vertex','vertex-ai'].includes(kind(a));
const gemini=a=>vertex(a)||['google','gemini','google-ai-studio'].includes(kind(a))||/generativelanguage\.googleapis\.com/.test(a.base_url);
const tokens=new Map();export function clearTokens(){tokens.clear()}
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export async function headers(host,a,signal) {
 const h={'Content-Type':'application/json'};
 if(!a.api_key)throw Error('Credential을 설정해 주세요');
 if(anthropic(a))return {...h,'x-api-key':a.api_key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'};
 if(!vertex(a))return {...h,Authorization:'Bearer '+a.api_key};
 let cached=tokens.get(a.api_key);if(cached&&cached.expires>Date.now()+60000)return {...h,Authorization:'Bearer '+cached.token};
 if(!cached?.pending){
  const pending=(async()=>{
   let sa;try{sa=JSON.parse(a.api_key)}catch{throw Error('Vertex 서비스 계정 JSON을 확인해 주세요')}
   if(!sa.client_email||!sa.private_key)throw Error('Vertex 서비스 계정 필드가 없습니다');
   const enc=new TextEncoder(),now=Math.floor(Date.now()/1000);
   const head=base64url(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT'}))),body=base64url(enc.encode(JSON.stringify({iss:sa.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})));
   const der=Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g,'')),c=>c.charCodeAt(0));
   const key=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
   const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(head+'.'+body));
   const res=await responseJSON(await host.nativeFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:head+'.'+body+'.'+base64url(new Uint8Array(signature))}).toString()}));
   if(!res.access_token)throw Error('Vertex 토큰 응답을 확인해 주세요');
   return {token:res.access_token,expires:Date.now()+Number(res.expires_in||3600)*1000};
  })();
  cached={pending};if(tokens.size>=4)tokens.clear();tokens.set(a.api_key,cached);
  pending.then(v=>{if(tokens.get(a.api_key)===cached)tokens.set(a.api_key,v)},()=>{if(tokens.get(a.api_key)===cached)tokens.delete(a.api_key)});
 }
 const v=await guarded(cached.pending,signal);return {...h,Authorization:'Bearer '+v.token};
}
export function extraBody(a){if(!a.extra_body_json)return {};const v=JSON.parse(a.extra_body_json);if(!v||Array.isArray(v)||typeof v!=='object')throw Error('추가 JSON은 객체여야 합니다');return v}
export function merge(base,extra){const out={...base};for(const[k,v]of Object.entries(extra)){if(['__proto__','constructor','prototype','messages','contents','systemInstruction'].includes(k))continue;out[k]=v&&typeof v==='object'&&!Array.isArray(v)&&out[k]&&typeof out[k]==='object'?merge(out[k],v):v}return out}
export function textRequest(a,messages) {
 const url=String(a.base_url).replace(/\/+$/,'');if(!url||!a.model)throw Error('API URL과 모델을 설정해 주세요');
 let body={model:a.model,messages,temperature:a.temperature,stream:false};if(a.max_tokens!=null)body.max_tokens=a.max_tokens;
 if(anthropic(a)){body.messages=messages.filter(m=>m.role!=='system');body.system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');body.max_tokens??=1024;return {url:url+'/messages',body}}
 body=merge(body,extraBody(a));body.stream=false;return {url:url+'/chat/completions',body};
}
export function nativeURL(a){
 const u=new URL(a.base_url),model=a.model.replace(/^(google|models)\//,'');if(model.includes('/'))throw Error('native-model');
 if(u.pathname.endsWith(':generateContent'))return u.toString();
 if(u.pathname.includes('/endpoints/openapi'))u.pathname=u.pathname.split('/endpoints/openapi')[0]+'/publishers/google/models/'+model+':generateContent';
 else if(u.hostname==='generativelanguage.googleapis.com')u.pathname='/v1beta/models/'+model+':generateContent';
 else throw Error('native-endpoint');
 return u.toString();
}
export async function pdfRequest(a,messages,h,signal){
 const mode=a.pdf_mode||'off',diag={mode,applied:false};
 if(mode==='off'||hasPDF(messages))return {diag};
 const extra=extraBody(a);
 if(Object.keys(extra).some(k=>['messages','contents','system','systemInstruction'].includes(k)))throw Error('extra-content');
 if(gemini(a)&&Object.keys(extra).some(k=>!['generationConfig','safetySettings'].includes(k)))throw Error('extra-native-options');
 const {source,kept}=pdfSource(messages,mode);diag.estimated_source_tokens=Math.ceil(source.length/3);
 if(source.length<=840)return {diag:{...diag,reason:'short-input'}};
 const pdf=await makePDF(source,signal);Object.assign(diag,{applied:true,bytes:pdf.bytes,worker:pdf.worker});
 if(gemini(a)){
  const url=nativeURL(a),generationConfig={temperature:a.temperature};if(a.max_tokens!=null)generationConfig.maxOutputTokens=a.max_tokens;
  const body={contents:[{role:'user',parts:[{inlineData:{mimeType:'application/pdf',data:pdf.data}},{text:PDF_TASK+'\n'+kept.filter(m=>m.role!=='system').map(m=>m.content).join('\n')}]}],generationConfig};
  const system=kept.filter(m=>m.role==='system').map(m=>m.content).join('\n');if(system)body.systemInstruction={parts:[{text:system}]};
  const headers={...h};if(!vertex(a)){delete headers.Authorization;headers['x-goog-api-key']=a.api_key}
  return {url,body:merge(body,extra),headers,diag};
 }
 const req=textRequest(a,kept);
 const file=anthropic(a)?{type:'document',source:{type:'base64',media_type:'application/pdf',data:pdf.data}}:{type:'file',file:{filename:'marp-conversation.pdf',file_data:'data:application/pdf;base64,'+pdf.data}};
 req.body.messages=[...req.body.messages,{role:'user',content:[file,{type:'text',text:PDF_TASK}]}];
 return {...req,headers:h,diag};
}
export function extract(data){
 const choice=data.choices?.[0],candidate=data.candidates?.[0];
 const text=cleanOutput(choice?contentText(choice.message?.content||choice.text):candidate?contentText(candidate.content?.parts):contentText(data.content||data.output_text));
 if(!text)throw Error('표시할 분석 결과가 없습니다');
 return {text,usage:data.usage||data.usageMetadata||null};
}
export async function callAgent(host,a,messages,signal){
 if(signal?.aborted)throw signal.reason;
 const h=await headers(host,a,signal),original=textRequest(a,messages);
 const post=async req=>{if(signal?.aborted)throw signal.reason;return extract(await responseJSON(await guarded(host.nativeFetch(req.url,{method:'POST',headers:req.headers||h,body:JSON.stringify(req.body)}),signal)))};
 let pdf;try{pdf=await pdfRequest(a,messages,h,signal)}catch(e){if(signal?.aborted)throw signal.reason;pdf={diag:{mode:a.pdf_mode,applied:false,reason:e.message}}}
 if(pdf.body){try{return {...await post(pdf),pdf:pdf.diag}}catch(e){if(!unsupportedPDF(e))throw e;pdf.diag={...pdf.diag,applied:false,reason:'provider-unsupported',text_retry:true}}}
 return {...await post(original),pdf:pdf.diag};
}
