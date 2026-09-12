import {AGENTS,LABELS,VERSION} from './core.js';
import {FIELDS,defaults,exportPack,importPack,resolve} from './config.js';
const css='.marp-shell{position:fixed;inset:0;z-index:10000;background:#11161d;color:#e7edf5;font:15px/1.5 system-ui,sans-serif;overflow:auto;color-scheme:dark}.marp-shell *{box-sizing:border-box}.marp-wrap{max-width:960px;margin:auto;padding:24px 18px 80px}.marp-top,.marp-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.marp-top{justify-content:space-between}.marp-shell h1{font-size:25px;letter-spacing:.08em;margin:0}.marp-shell h2{font-size:19px;margin:8px 0 20px}.marp-shell p{color:#aebbc9}.marp-shell button,.marp-shell select,.marp-shell input,.marp-shell textarea{font:inherit;border:1px solid #364451;border-radius:8px;padding:10px;background:#1b242f;color:inherit;min-height:44px}.marp-shell button{cursor:pointer}.marp-shell button:hover,.marp-shell button[aria-selected=true]{border-color:#61d4bd;background:#1c3935}.marp-shell button:disabled{opacity:.45;cursor:wait}.marp-shell :focus-visible{outline:2px solid #61d4bd;outline-offset:2px}.marp-nav{display:flex;gap:8px;overflow:auto;margin:24px 0 18px;padding-bottom:5px}.marp-panel{background:#161e28;border:1px solid #2c3846;border-radius:12px;padding:20px;min-height:180px}.marp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}.marp-field{display:flex;flex-direction:column;gap:6px;min-width:0}.marp-field input,.marp-field textarea,.marp-field select{width:100%}.marp-field small{color:#aebbc9}.marp-field textarea{min-height:120px;resize:vertical}.marp-wide{grid-column:1/-1}.marp-check{flex-direction:row;align-items:center}.marp-check input{width:20px}.marp-status{white-space:pre-wrap;overflow-wrap:anywhere;min-height:24px;margin:12px 0;color:#9aead9}.marp-shell pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#10151c;border-radius:8px;padding:12px;max-height:480px;overflow:auto}.marp-primary{background:#24564c!important;border-color:#61d4bd!important}.marp-footer{margin-top:18px}.marp-badge{color:#72dfc8;font-size:13px}.marp-shell hr{border:0;border-top:1px solid #364451;margin:20px 0}@media(max-width:600px){.marp-grid{grid-template-columns:1fr}.marp-wrap{padding:18px 12px 60px}.marp-panel{padding:14px}.marp-nav button{white-space:nowrap}.marp-shell h1{font-size:22px}}';
const labels={provider:'공급자',base_url:'API 기본 URL',api_key:'Credential / 서비스 계정 JSON',model:'모델',temperature:'온도',max_tokens:'출력 토큰 제한',extra_body_json:'추가 JSON',pdf_mode:'내장 PDF'};
const options={provider:['','openai','custom','google','vertex-ai','anthropic'],pdf_mode:['','off','quality','standard','max'],analysis_language:['auto','ko','en','ja'],injection_position:['system-end','before-last-user'],injection_format:['classic','xml','markdown-table']};
export function openDashboard(api){
 let alive=true,draft=null,tab='common',epoch=0,pack=null;
 const root=document.createElement('section');root.className='marp-shell';root.setAttribute('aria-label','MARP 설정');
 root.innerHTML='<style>'+css+'</style><div class="marp-wrap"><header class="marp-top"><div><h1>MARP <span class="marp-badge">'+(api.full?'Full':'Lite')+' · '+VERSION+'</span></h1><p>세계관 · 플롯 · 등장인물 분석</p></div><button type="button" data-close>닫기</button></header><nav class="marp-nav" aria-label="설정 탭"></nav><div class="marp-panel" aria-live="polite">설정을 읽는 중입니다…</div><div class="marp-status" role="status"></div><footer class="marp-actions marp-footer"><button class="marp-primary" data-save disabled>설정 저장</button><span>표시하지 않은 탭의 편집 내용도 함께 저장합니다.</span></footer></div>';
 document.body.append(root);
 const panel=root.querySelector('.marp-panel'),nav=root.querySelector('nav'),status=root.querySelector('[role=status]'),save=root.querySelector('[data-save]');
 const message=(text,error=false)=>{if(alive){status.textContent=text;status.style.color=error?'#ffb4b4':'#9aead9'}};
 const action=(label,fn,parent=panel)=>{
  const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await fn()}catch(e){message(e.message,true)}finally{if(alive)b.disabled=false}};parent.append(b);return b;
 };
 const text=(value,parent=panel)=>{const p=document.createElement('p');p.textContent=value;parent.append(p);return p};
 const group=()=>{const g=document.createElement('div');g.className='marp-grid';panel.append(g);return g};
 const field=(key,label,parent,{area=false,check=false,hint='',choices}={})=>{
  const wrap=document.createElement('label');wrap.className='marp-field'+(area?' marp-wide':'')+(check?' marp-check':'');
  const name=document.createElement('span');name.textContent=label;wrap.append(name);
  const list=choices||options[key],input=document.createElement(check?'input':area?'textarea':list?'select':'input');
  input.name=key;input.dataset.field=key;
  if(check){input.type='checkbox';input.checked=!!draft[key]}
  else if(list){for(const value of list){const o=document.createElement('option');o.value=value;o.textContent=value===''?'공통 설정 상속':value==='quality'?'quality · 권장 (앞부분 80%)':value;input.append(o)}if(!list.includes(draft[key])){const o=document.createElement('option');o.value=draft[key]||'';o.textContent=draft[key]||'상속';input.append(o)}input.value=draft[key]??''}
  else{if(!area)input.type=key.endsWith('api_key')?'password':'text';input.value=draft[key]??'';if(area)input.spellcheck=false}
  input.oninput=()=>{const v=check?input.checked:input.value;draft[key]=/(?:temperature|max_tokens)$/.test(key)?v===''?null:Number(v):['context_window','request_timeout','analysis_timeout'].includes(key)?Number(v):v};
  wrap.append(input);if(hint){const small=document.createElement('small');small.textContent=hint;wrap.append(small)}parent.append(wrap);return input;
 };
 const providerFields=prefix=>{
  const g=group();for(const k of FIELDS)field(prefix+'_'+k,labels[k],g,{area:k==='extra_body_json',choices:options[k],hint:k==='api_key'?'프리셋 export에서 제외됩니다.':k==='pdf_mode'?'off는 기존 텍스트 요청을 유지합니다. 품질·절감 효과는 모델에 따라 달라 진단 탭에서 먼저 비교해 주세요.':prefix==='default'?'':'비워두면 공통 설정을 사용합니다.'});
  const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','서비스 계정 JSON 파일');file.onchange=async()=>{const f=file.files?.[0];if(!f)return;try{const value=await f.text();const sa=JSON.parse(value);if(!sa.client_email||!sa.private_key)throw Error('서비스 계정 JSON이 아닙니다');draft[prefix+'_api_key']=value;await render(tab);message('서비스 계정 JSON을 불러왔습니다. 저장하면 적용됩니다.')}catch(e){message(e.message,true)}};panel.append(file);
 };
 const download=(name,value)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;root.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0)};
 async function render(next){
  tab=next;const seq=++epoch;for(const b of nav.children)b.setAttribute('aria-selected',String(b.dataset.tab===tab));panel.replaceChildren();
  if(!draft){text('설정을 읽는 중입니다…');return}
  const title=document.createElement('h2');title.textContent=({common:'공통 설정',prompts:'프롬프트',presets:'프리셋',diagnostics:'진단'})[tab]||LABELS[tab];panel.append(title);
  if(tab==='common'){
   if(api.full)field('server_url','Full 서버 URL',group(),{hint:'새 URL을 저장하면 해당 서버에 현재 설정이 저장됩니다.'});
   providerFields('default');panel.append(document.createElement('hr'));
   const g=group();for(const[k,label]of [['context_window','최근 대화 수'],['request_timeout','에이전트 제한 (초)'],['analysis_timeout','전체 제한 (초)'],['analysis_language','분석 언어'],['injection_position','주입 위치'],['injection_format','주입 형식']])field(k,label,g);
   for(const[k,label]of [['main_model_only','메인 모델에서만 실행'],['bypass_hypamemory','메모리 요청 건너뛰기'],['bypass_translate','번역 요청 건너뛰기'],['bypass_lb_process','lb-process 요청 건너뛰기'],['strict_mode','실패하면 분석 주입 중단 (Strict)']])field(k,label,g,{check:true});
   text('Lenient는 성공한 분석만 사용합니다. 모두 OFF이거나 결과가 비어 있으면 주입하지 않습니다. PDF Pod는 훅 예외를 흡수할 수 있어 Strict의 메인 호출 차단은 보장되지 않습니다.');
   text('PDF Pod 병용: API 감지 auto · OpenAI → Gemini 변환 none. MARP 내장 PDF는 보조 분석 요청에 적용되며, PDF Pod의 메인 대화 압축 설정과 별개입니다.');
  }else if(AGENTS.includes(tab)){field(tab+'_enabled',LABELS[tab]+' 분석 사용',group(),{check:true});providerFields(tab)}
  else if(tab==='prompts'){
   text('기본값을 사용하려면 override를 비우세요. 자료는 분석 대상이며, 최종 RP 답변은 메인 모델이 작성합니다.');
   if(!pack){text('기본 프롬프트를 읽는 중입니다…');pack=await api.getPrompts();if(!alive||seq!==epoch)return;return render(tab)}
   for(const n of AGENTS){const h=document.createElement('h3');h.textContent=LABELS[n];panel.append(h);const g=group();field(n+'_system_prompt','System override',g,{area:true});field(n+'_user_prompt_template','User template override',g,{area:true});
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='기본 프롬프트 보기';details.append(summary);details.ontoggle=()=>{if(details.open&&details.children.length===1){const pre=document.createElement('pre');pre.textContent=JSON.stringify(pack.agents?.[n]||pack[n],null,2);details.append(pre)}};panel.append(details);
    action('기본값 복원',async()=>{draft[n+'_system_prompt']='';draft[n+'_user_prompt_template']='';await render(tab);message('기본값 복원은 설정 저장 후 적용됩니다.')});
   }
   text('변수: {{system_context}}, {{world_summary}}, {{char_summary}}, {{user_input}}, {{chat_history}}, {{context_world}}');
  }else if(tab==='presets'){
   const actions=document.createElement('div');actions.className='marp-actions';panel.append(actions);
   action('JSON export',()=>download('marp-'+(api.full?'full':'lite')+'-preset-v'+VERSION+'.json',exportPack(draft,api.full?'full':'lite')),actions);
   const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.setAttribute('aria-label','프리셋 JSON import');input.onchange=async()=>{try{draft=importPack(draft,JSON.parse(await input.files[0].text()));message('프리셋을 불러왔습니다. 저장하면 적용됩니다.')}catch(e){message(e.message,true)}finally{input.value=''}};actions.append(input);
   const name=document.createElement('input');name.placeholder='프리셋 이름';name.setAttribute('aria-label','프리셋 이름');panel.append(name);
   action('현재 편집 내용을 프리셋으로 저장',async()=>{await api.presets.put(name.value.trim()||'Preset',exportPack(draft,api.full?'full':'lite'));await render(tab)});
   const list=await api.presets.list();if(!alive||seq!==epoch)return;
   for(const p of list){const row=document.createElement('div');row.className='marp-actions';text(p.name,row);action('불러오기',async()=>{draft=importPack(draft,await api.presets.get(p.id));message('불러왔습니다. 설정 저장 후 적용됩니다.')},row);action('삭제',async()=>{await api.presets.remove(p.id);await render(tab)},row);panel.append(row)}
  }else{
   if(api.full)text('Full 테스트는 서버에 저장된 설정으로 실행합니다.');
   text('실제 사용량은 공급자 응답의 usage, 토큰 추정치는 estimated_source_tokens로 구분합니다. 아래 테스트 버튼을 누를 때만 합성 자료로 추가 LLM 호출이 발생합니다.');
   const actions=document.createElement('div');actions.className='marp-actions';panel.append(actions);
   action('텍스트 분석 테스트',async()=>showResult(await api.test(draft,false)),actions);
   action('PDF 분석 테스트',async()=>showResult(await api.test(draft,true)),actions);
   const pre=document.createElement('pre');panel.append(pre);
   function showResult(r){if(alive&&tab==='diagnostics')pre.textContent=JSON.stringify(r,null,2)}
   const data=await api.getDiagnostics();if(alive&&seq===epoch)showResult(data);
  }
 }
 for(const[k,label]of [['common','공통'],...AGENTS.map(n=>[n,LABELS[n]]),['prompts','프롬프트'],['presets','프리셋'],['diagnostics','진단']]){const b=action(label,()=>render(k),nav);b.dataset.tab=k}
 save.onclick=async()=>{if(!draft)return;save.disabled=true;try{await api.save({...draft});message('설정을 저장했습니다.')}catch(e){message(e.message,true)}finally{if(alive)save.disabled=false}};
 const close=()=>{alive=false;epoch++;root.remove();draft=null;pack=null};
 root.querySelector('[data-close]').onclick=()=>{close();api.host.hideContainer?.()};
 api.getConfig().then(c=>{if(!alive)return;draft={...defaults(),...c};save.disabled=false;return render(tab)}).catch(e=>{if(alive){panel.textContent='설정을 읽지 못했습니다.';message(e.message,true);if(api.full){draft=defaults();field('server_url','연결할 서버 URL',panel);action('서버 연결 및 설정 읽기',async()=>{await api.connect?.(draft.server_url);draft=await api.getConfig();save.disabled=false;await render(tab)})}}});
 return {close,root};
}
