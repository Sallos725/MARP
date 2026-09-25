import {AGENTS,LABELS,VERSION} from './core.js';
import {FIELDS,defaults,exportPack,importPack,resolve} from './config.js';
import {diagnosticsCSS,renderDiagnostics} from './diagnostics-ui.js';
import {hostedInPdfPod,pdfPodReport,PDF_POD_FIX} from './pdfpod.js';
export const shellCSS='.marp-shell{--m-bg:#0b1120;--m-surface:#131b2e;--m-sunken:#0e1526;--m-border:#26324a;--m-text:#e7ecf5;--m-muted:#a3b0c6;--m-accent:#e2b865;--m-accent-bg:#2a2414;--m-on-accent:#1a1405;--m-ok:#7ee0b5;--m-err:#ff9a9a;--m-world:#e2b865;--m-plot:#7fb2ff;--m-char:#c7a6ff;position:fixed;inset:0;z-index:10000;background:var(--m-bg);color:var(--m-text);font:15px/1.5 system-ui,-apple-system,"Noto Sans KR",sans-serif;overflow:auto;color-scheme:dark}.marp-shell *{box-sizing:border-box}.marp-wrap{max-width:960px;margin:auto;padding:24px 18px 80px}.marp-top,.marp-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.marp-top{justify-content:space-between}.marp-shell h1{font-size:24px;letter-spacing:.08em;margin:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.marp-shell h2{font-size:19px;margin:4px 0 18px}.marp-shell h3{font-size:16px;margin:0 0 8px;color:var(--m-accent)}.marp-shell p{color:var(--m-muted)}.marp-shell button,.marp-shell select,.marp-shell input,.marp-shell textarea{font:inherit;border:1px solid var(--m-border);border-radius:10px;padding:10px 12px;background:var(--m-surface);color:inherit;min-height:44px}.marp-shell button{cursor:pointer;transition:border-color .15s,background .15s}.marp-shell button:hover{border-color:var(--m-accent)}.marp-shell button:disabled{opacity:.45;cursor:wait}.marp-shell :focus-visible{outline:2px solid var(--m-accent);outline-offset:2px}.marp-nav{display:flex;gap:6px;overflow:auto;margin:22px 0 16px;padding-bottom:6px}.marp-nav button{border-radius:999px;padding:8px 16px;white-space:nowrap}.marp-nav button[aria-selected=true]{background:var(--m-accent-bg);border-color:var(--m-accent);color:var(--m-accent);box-shadow:inset 0 -2px var(--m-accent)}.marp-panel{background:var(--m-surface);border:1px solid var(--m-border);border-radius:14px;padding:20px;min-height:180px}.marp-panel input,.marp-panel select,.marp-panel textarea{background:var(--m-sunken)}.marp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}.marp-field{display:flex;flex-direction:column;gap:6px;min-width:0}.marp-field input,.marp-field textarea,.marp-field select{width:100%}.marp-field small{color:var(--m-muted)}.marp-field textarea{min-height:120px;resize:vertical}.marp-wide{grid-column:1/-1}.marp-check{flex-direction:row;align-items:center;gap:12px;cursor:pointer}.marp-check input{appearance:none;-webkit-appearance:none;flex:none;width:44px;min-height:0;height:26px;padding:0;border:0;border-radius:999px;background:var(--m-border);position:relative;cursor:pointer;transition:background .15s}.marp-check input::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--m-text);transition:transform .15s}.marp-check input:checked{background:var(--m-accent)}.marp-check input:checked::after{transform:translateX(18px);background:var(--m-on-accent)}.marp-status{white-space:pre-wrap;overflow-wrap:anywhere;min-height:24px;margin:12px 0;color:var(--m-ok)}.marp-status[data-error]{color:var(--m-err)}.marp-shell pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--m-sunken);border:1px solid var(--m-border);border-radius:10px;padding:12px;max-height:480px;overflow:auto}.marp-primary{background:var(--m-accent)!important;border-color:var(--m-accent)!important;color:var(--m-on-accent)!important;font-weight:600}.marp-footer{margin-top:18px}.marp-footer span{color:var(--m-muted);font-size:13px}.marp-badge{color:var(--m-accent);font-size:13px;letter-spacing:.02em;border:1px solid var(--m-border);border-radius:999px;padding:2px 10px}.marp-shell hr{border:0;border-top:1px solid var(--m-border);margin:20px 0}@media(max-width:600px){.marp-grid{grid-template-columns:1fr}.marp-wrap{padding:18px 12px 60px}.marp-panel{padding:14px}.marp-shell h1{font-size:21px}}';
const labels={provider:'공급자',base_url:'API 기본 URL',api_key:'Credential / 서비스 계정 JSON',model:'모델',temperature:'온도',max_tokens:'출력 토큰 제한',extra_body_json:'추가 JSON',pdf_mode:'내장 PDF'};
const options={provider:['','openai','custom','google','vertex-ai','anthropic'],pdf_mode:['','off','quality','standard','max'],analysis_language:['auto','ko','en','ja'],injection_position:['system-end','before-last-user'],injection_format:['classic','xml','markdown-table']};
export function openDashboard(api){
 let alive=true,draft=null,tab='common',epoch=0,pack=null,hudBusy=false;
 const root=document.createElement('section');root.className='marp-shell';root.setAttribute('aria-label','MARP 설정');
 root.innerHTML='<style>'+shellCSS+diagnosticsCSS+'</style><div class="marp-wrap"><header class="marp-top"><div><h1><span aria-hidden="true">🔱</span> MARP <span class="marp-badge">'+(api.full?'Full':'Lite')+' · '+VERSION+'</span></h1><p>세계관 · 플롯 · 등장인물 분석</p></div><button type="button" data-close>닫기</button></header><nav class="marp-nav" aria-label="설정 탭"></nav><div class="marp-panel" aria-live="polite">설정을 읽는 중입니다…</div><div class="marp-status" role="status"></div><footer class="marp-actions marp-footer"><button class="marp-primary" data-save disabled>설정 저장</button><span>표시하지 않은 탭의 편집 내용도 함께 저장합니다.</span></footer></div>';
 document.body.append(root);
 const panel=root.querySelector('.marp-panel'),nav=root.querySelector('nav'),status=root.querySelector('[role=status]'),save=root.querySelector('[data-save]');
 const message=(text,error=false)=>{if(alive){status.textContent=text;status.toggleAttribute('data-error',error)}};
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
 const routeLabels={passthrough:'변환 없이 전송',gemini:'Gemini 변환 · 동작',converted:'설정 필요'};
 const pdfPodCard=()=>{
  const {agents,broken,internalPdf}=pdfPodReport(draft),card=document.createElement('div');card.className='marp-run';card.dataset.pdfPod=broken.length?'broken':'ok';panel.append(card);
  const h=document.createElement('h3');h.textContent='PDF Pod 연동';card.append(h);
  text(broken.length?'설정 필요 · '+broken.map(a=>a.label).join('·')+' 요청은 PDF Pod 기본 설정에서 Gemini 주소로 바뀌어 실패합니다.':'호환 · 현재 공급자는 PDF Pod 기본 설정에서도 동작합니다.',card).className=broken.length?'marp-error':'';
  const pills=document.createElement('div');pills.className='marp-summary';card.append(pills);
  for(const a of agents){const pill=document.createElement('span');pill.className='marp-pill';pill.textContent=a.label+' · '+routeLabels[a.route];pills.append(pill)}
  if(!agents.length)text('켜진 분석 에이전트가 없습니다.',card);
  if(broken.length)text(PDF_POD_FIX+'. 또는 공급자를 Google AI Studio·Vertex·Anthropic으로 바꾸면 기본 설정 그대로 동작합니다.',card);
  if(internalPdf)text('Lite 내장 PDF를 켰다면 PDF Pod의 PDF 압축 수준은 "끄기"로 두어 재압축을 막으세요.',card);
  if(![draft.default_api_key,...AGENTS.map(n=>draft[n+'_api_key'])].some(Boolean))text('PDF Pod는 자식 플러그인마다 저장 공간을 따로 씁니다. 단독 설치 때 저장한 설정은 보이지 않으니 다시 입력하고 저장해 주세요.',card);
 };
 const hudCard=()=>{
  const mine=epoch;
  const card=document.createElement('div');card.className='marp-run';panel.append(card);
  const h=document.createElement('h3');h.textContent='채팅 화면 진행 표시';card.append(h);
  text('분석 진행과 결과를 채팅 화면 오른쪽 위에 작게 띄웁니다. 켜면 RisuAI가 "메인 Document 접근" 권한을 묻습니다. MARP는 이 권한으로 표시 하나를 그리고, 겹치지 않도록 NMOS 표시의 위치만 읽습니다. 표시를 누르면 이 설정 화면이 열립니다.',card);
  const wrap=document.createElement('label');wrap.className='marp-field marp-check';
  const box=document.createElement('input');box.type='checkbox';box.checked=!!draft.hud;box.disabled=hudBusy;
  const name=document.createElement('span');name.textContent='채팅 화면에 진행 표시 띄우기';wrap.append(box,name);card.append(wrap);
  const note=text('',card),say=(value,error=false)=>{note.textContent=value;note.className=error?'marp-error':''};
  const problem=api.hud?.problem();if(problem)say('이번 세션에서 표시를 그리지 못해 멈췄습니다: '+problem,true);
  const outcome=(value,error=false)=>{if(epoch===mine){box.checked=!!draft.hud;say(value,error)}else{message(value,error);if(alive&&tab==='common')render('common')}};
  box.onchange=async()=>{
   box.disabled=true;hudBusy=true;
   try{
    if(!box.checked){await api.hud.disable();draft.hud=false;hudBusy=false;outcome('껐습니다.');return}
    const result=await api.hud.enable();draft.hud=result==='on';hudBusy=false;
    if(result==='on')outcome('켰습니다. 다음 메시지부터 표시됩니다.');
    else outcome(result==='denied'?'권한이 거부되어 켜지 않았습니다. 설정 → 플러그인 → MARP 줄 메뉴 → "권한 응답 초기화" 후 다시 켜세요.':'이 RisuAI 버전은 플러그인이 채팅 화면에 표시를 그리는 기능을 지원하지 않습니다.',true);
   }catch(e){hudBusy=false;if(epoch===mine)box.checked=!!draft.hud;message(e.message,true)}
   finally{hudBusy=false;if(alive&&epoch===mine)box.disabled=false}
  };
 };
 const download=(name,value)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;root.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0)};
 async function render(next){
  tab=next;const seq=++epoch;for(const b of nav.children)b.setAttribute('aria-selected',String(b.dataset.tab===tab));panel.replaceChildren();
  if(!draft){text('설정을 읽는 중입니다…');return}
  const title=document.createElement('h2');title.textContent=({common:'공통 설정',prompts:'프롬프트',presets:'프리셋',diagnostics:'진단',waterfall:'워터폴',connection:'연결 테스트',history:'호출 기록'})[tab]||LABELS[tab];panel.append(title);
  if(tab==='common'){
   if(!api.full&&hostedInPdfPod())pdfPodCard();
   hudCard();
   const behavior=group();
   for(const[k,label]of [['main_model_only','메인 모델에서만 실행'],['bypass_hypamemory','메모리 요청 건너뛰기'],['bypass_translate','번역 요청 건너뛰기'],['bypass_lb_process','lb-process 요청 건너뛰기'],['strict_mode','실패하면 분석 주입 중단 (Strict)']])field(k,label,behavior,{check:true});
   text('OOC 등 특정 system 프롬프트만 제외하려면 활성화되는 조건문 안에 <!--MARP:bypass-->를 넣으세요. 해당 요청은 MARP 분석 전체를 건너뜁니다.');
   panel.append(document.createElement('hr'));
   if(api.full)field('server_url','Full 서버 URL',group(),{hint:'새 URL을 저장하면 해당 서버에 현재 설정이 저장됩니다.'});
   providerFields('default');panel.append(document.createElement('hr'));
   const g=group();for(const[k,label]of [['context_window','최근 대화 수'],['request_timeout','에이전트 제한 (초)'],['analysis_timeout','전체 제한 (초)'],['analysis_language','분석 언어'],['injection_position','주입 위치'],['injection_format','주입 형식']])field(k,label,g);
   text('Lenient는 성공한 분석만 사용합니다. 모두 OFF이거나 결과가 비어 있으면 주입하지 않습니다. PDF Pod는 훅 예외를 흡수할 수 있어 Strict의 메인 호출 차단은 보장되지 않습니다.');
   if(api.full||!hostedInPdfPod())text('PDF Pod 병용: API 형식 감지 "자동" · API 형식 변환 "끄기". Lite 내장 PDF를 켜면 PDF Pod의 PDF 압축 수준은 "끄기"로 두어 텍스트 복귀의 재압축을 막으세요. Full 서버 요청은 PDF Pod를 통과하지 않습니다.');
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
  }else{await renderDiagnostics(panel,api,tab,draft,{current:()=>alive&&seq===epoch,refresh:()=>render(tab),download,message})}

 }
 for(const[k,label]of [['common','공통'],...AGENTS.map(n=>[n,LABELS[n]]),['prompts','프롬프트'],['presets','프리셋'],['waterfall','워터폴'],['connection','연결 테스트'],['history','호출 기록'],['diagnostics','진단']]){const b=action(label,()=>render(k),nav);b.dataset.tab=k}
 save.onclick=async()=>{if(!draft)return;save.disabled=true;try{await api.save({...draft});if(tab==='common'&&hostedInPdfPod())await render(tab);message('설정을 저장했습니다.')}catch(e){message(e.message,true)}finally{if(alive)save.disabled=false}};
 const close=()=>{alive=false;epoch++;root.remove();draft=null;pack=null};
 root.querySelector('[data-close]').onclick=()=>{close();api.host.hideContainer?.()};
 api.getConfig().then(c=>{if(!alive)return;draft={...defaults(),...c};save.disabled=false;return render(tab)}).catch(e=>{if(alive){panel.textContent='설정을 읽지 못했습니다.';message(e.message,true);if(api.full){draft=defaults();field('server_url','연결할 서버 URL',panel);action('서버 연결 및 설정 읽기',async()=>{await api.connect?.(draft.server_url);draft=await api.getConfig();save.disabled=false;await render(tab)})}}});
 return {close,root};
}
