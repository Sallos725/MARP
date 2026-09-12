import {AGENTS,VERSION,parseStored} from './core.js';
export const FIELDS=['provider','base_url','api_key','model','temperature','max_tokens','extra_body_json','pdf_mode'];
const camel={provider:'provider',base_url:'baseUrl',api_key:'apiKey',model:'model',temperature:'temperature',max_tokens:'maxTokens',extra_body_json:'extraBodyJson',pdf_mode:'pdfMode'};
const flags={main_model_only:'mainModelOnly',bypass_hypamemory:'bypassHypaMemory',bypass_translate:'bypassTranslate',bypass_lb_process:'bypassLbProcess',strict_mode:'strictMode',injection_position:'injectionPosition',injection_format:'injectionFormat',analysis_language:'analysisLanguage'};
export const vaultKey='risu_multiagent_lite_config_vault_v1';
export const fullKey='risu_multiagent_full_plugin_settings_v1';
export function defaults(){
 const c={default_provider:'openai',default_base_url:'https://api.openai.com/v1',default_api_key:'',default_model:'gpt-4o-mini',default_temperature:0.7,default_max_tokens:null,default_extra_body_json:'',default_pdf_mode:'off',context_window:10,request_timeout:60,analysis_timeout:120,main_model_only:true,bypass_hypamemory:true,bypass_translate:true,bypass_lb_process:true,strict_mode:false,injection_position:'system-end',injection_format:'classic',analysis_language:'auto',server_url:'http://localhost:6009'};
 for(const n of AGENTS){c[n+'_enabled']=true;c[n+'_system_prompt']='';c[n+'_user_prompt_template']='';for(const k of FIELDS)c[n+'_'+k]=['temperature','max_tokens'].includes(k)?null:''}
 return c;
}
export function migrate(raw={}){
 const c={...defaults(),...(raw.marpConfig||{})};
 for(const [k,v]of Object.entries(flags))if(raw[v]!=null)c[k]=raw[v];
 for(const k of FIELDS)if(raw[camel[k]]!=null)c['default_'+k]=raw[camel[k]];
 if(raw.window!=null)c.context_window=raw.window;
 if(raw.serverUrl)c.server_url=raw.serverUrl;
 for(const n of AGENTS){const a=raw.agents?.[n];if(!a)continue;if(a.enabled!=null)c[n+'_enabled']=a.enabled;c[n+'_system_prompt']=a.systemPrompt||'';c[n+'_user_prompt_template']=a.userPromptTemplate||'';for(const k of FIELDS)if(a[camel[k]]!=null)c[n+'_'+k]=a[camel[k]]}
 return c;
}
export function legacyConfig(c){
 const out={marpConfig:c,window:c.context_window,serverUrl:c.server_url,agents:{}};
 for(const[k,v]of Object.entries(flags))out[v]=c[k];
 for(const k of FIELDS)out[camel[k]]=c['default_'+k];
 for(const n of AGENTS){const a={enabled:c[n+'_enabled'],systemPrompt:c[n+'_system_prompt'],userPromptTemplate:c[n+'_user_prompt_template']};for(const k of FIELDS)a[camel[k]]=c[n+'_'+k];out.agents[n]=a}
 return out;
}
export async function loadConfig(host,full=false){
 const raw=parseStored(await host.pluginStorage.getItem(full?fullKey:vaultKey))||{};
 const c=migrate(full?(raw.settings||raw.config||raw):(raw.config||{}));
 const keys={...Object.fromEntries(Object.keys(flags).map(k=>[k,k])),context_window:'context_window',server_url:'server_url'};
 if(!full)for(const k of FIELDS.filter(k=>k!=='pdf_mode'))keys['agent_'+k]='default_'+k;
 const args=await Promise.all(Object.entries(keys).map(async([arg,key])=>[key,await host.getArgument(arg)]));
 for(const[k,v]of args){if(v==null||v===''||(k==='context_window'&&Number(v)===0))continue;const def=c[k];c[k]=typeof def==='boolean'?!['0','false','off','no'].includes(String(v).toLowerCase()):['context_window','default_temperature','default_max_tokens'].includes(k)?Number(v):v}
 c.context_window=Math.max(1,Math.floor(Number(c.context_window)||10));return c;
}
export function resolve(c,n){const a={};for(const k of FIELDS)a[k]=c[n+'_'+k]===null||c[n+'_'+k]===undefined||c[n+'_'+k]===''?c['default_'+k]:c[n+'_'+k];return a}
export function validate(c){
 for(const k of ['context_window','request_timeout','analysis_timeout'])if(!Number.isFinite(Number(c[k]))||Number(c[k])<=0)throw new Error(k+': 양수가 필요합니다');
 for(const prefix of ['default',...AGENTS]){
  const raw=c[prefix+'_extra_body_json'];if(raw){const p=JSON.parse(raw);if(!p||Array.isArray(p)||typeof p!=='object')throw new Error('추가 JSON은 객체여야 합니다')}
  const mode=c[prefix+'_pdf_mode'];if(!['','off','quality','standard','max'].includes(mode))throw new Error('PDF 수준을 확인해 주세요');
  for(const k of ['temperature','max_tokens']){const v=c[prefix+'_'+k];if(v!=null&&v!==''&&(!Number.isFinite(Number(v))||(k==='max_tokens'&&Number(v)<=0)))throw new Error(k+' 값을 확인해 주세요')}
 }
}
export function exportPack(c,edition){
 const global={};for(const k of FIELDS)if(k!=='api_key')global[camel[k]]=c['default_'+k];
 return {risuMultiagentPresetPackVersion:1,edition,pluginVersion:VERSION,exportedAt:new Date().toISOString(),global,agents:AGENTS.map(n=>{const a={name:n,enabled:c[n+'_enabled'],system_prompt_override:c[n+'_system_prompt'],user_prompt_template_override:c[n+'_user_prompt_template']};for(const k of FIELDS)if(k!=='api_key')a[k]=c[n+'_'+k];return a})};
}
export function importPack(c,pack){
 if(!pack||typeof pack!=='object')throw new Error('프리셋 JSON을 확인해 주세요');
 const out={...c};const g=pack.global||pack.config||pack;
 for(const k of FIELDS)if(k!=='api_key'){const v=g[camel[k]]??g[k]??g['default_'+k];if(v!==undefined)out['default_'+k]=v}
 const entries=Array.isArray(pack.agents)?pack.agents:Array.isArray(pack.prompts)?pack.prompts:[];
 for(const a of entries){if(!AGENTS.includes(a.name))continue;const n=a.name;if(typeof a.enabled==='boolean')out[n+'_enabled']=a.enabled;
  for(const k of FIELDS)if(k!=='api_key'&&a[k]!==undefined)out[n+'_'+k]=a[k];
  for(const k of ['system_prompt','user_prompt_template']){const v=a[k+'_override']??a[k];if(typeof v==='string')out[n+'_'+k]=v}
 }
 validate(out);return out;
}
