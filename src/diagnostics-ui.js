import {LABELS} from './core.js';
import {HISTORY_LIMIT,PREVIEW_LIMIT,waterfallRows} from './diagnostics.js';

export const diagnosticsCSS=`.marp-summary{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.marp-pill{padding:5px 10px;border:1px solid #364451;border-radius:8px}.marp-run{margin:16px 0;padding:14px;border:1px solid #364451;border-radius:10px;overflow-wrap:anywhere}.marp-run summary{cursor:pointer;min-height:44px;padding:10px 0}.marp-waterfall-row{margin:16px 0}.marp-row-label{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}.marp-track{height:12px;border-radius:6px;background:#29323e;position:relative;overflow:hidden;margin-top:6px}.marp-bar{position:absolute;height:100%;border-radius:6px;background:#61d4bd}.marp-waterfall-row[data-agent=plot] .marp-bar{background:#85adff}.marp-waterfall-row[data-agent=character] .marp-bar{background:#e8bd70}.marp-waterfall-row[data-state=error] .marp-bar{background:#ff9a9a}.marp-error{color:#ffb4b4!important}.marp-shell summary:focus-visible{outline:2px solid #61d4bd}.marp-shell .marp-records{padding:0;list-style:none}.marp-shell .marp-records>li{margin:10px 0}.marp-shell .marp-muted{color:#aebbc9;font-size:13px}`;
const statusLabels={injected:'분석 주입 완료','failed-no-injection':'실패 · 미주입','empty-no-injection':'결과 없음 · 미주입','test-success':'테스트 성공','test-partial':'일부 테스트 실패','test-failed':'테스트 실패','test-empty':'테스트 대상 또는 결과 없음',success:'성공',error:'실패',skipped:'건너뜀',unknown:'정보 없음'};
const kinds={analysis:'대화 분석','text-test':'텍스트 분석 테스트','pdf-test':'PDF 분석 테스트',connection:'연결 테스트'};
const label=s=>statusLabels[s]||s;
const duration=ms=>ms==null?'측정 없음':ms<1000?ms+' ms':(ms/1000).toFixed(2)+' s';
const date=s=>s?new Date(s).toLocaleString():'시각 없음';
const add=(parent,tag,value,cls)=>{const el=document.createElement(tag);if(value!=null)el.textContent=value;if(cls)el.className=cls;parent.append(el);return el};
const json=(parent,title,value)=>{const d=add(parent,'details'),s=add(d,'summary',title);d.ontoggle=()=>{if(d.open&&d.children.length===1)add(d,'pre',JSON.stringify(value,null,2))};return s};

export function renderRun(parent,record){
 if(!record){add(parent,'p','아직 호출 기록이 없습니다. 대화를 보내거나 진단 탭에서 분석 테스트를 실행해 주세요.');return}
 const summary=add(parent,'div',null,'marp-summary');
 for(const value of [kinds[record.kind]||'대화 분석',label(record.status),duration(record.elapsed_ms),date(record.started_at)])add(summary,'span',value,'marp-pill');
 if(record.error)add(parent,'p',record.error,'marp-error');
 if(record.strict_note)add(parent,'p',record.strict_note);
 if(record.kind==='analysis')add(parent,'p',`입력 ${record.input_chars??'—'}자 · 시스템 ${record.system_chars??'—'}자 · 최근 대화 ${record.history_messages??'—'}개`,'marp-muted');
 const rows=waterfallRows(record);
 if(record.kind!=='connection'){
  add(parent,'p','세계관 분석 → 플롯 · 등장인물 병렬 분석. 막대는 각 단계의 소요 시간입니다.');
  const total=Math.max(1,...rows.map(r=>r.offset+(r.duration||0)));
  if(rows.some(r=>r.estimated))add(parent,'p','이 기록에는 시작 시각이 없어 기존 지연 시간과 실행 순서로 막대 위치를 추정했습니다.','marp-muted');
  else if(rows.some(r=>r.duration!=null))add(parent,'p','분석 시작 기준 실측 시간입니다. Full의 전체 소요 시간에는 서버 왕복 시간도 포함됩니다.','marp-muted');
  for(const row of rows){
   const wrap=add(parent,'div',null,'marp-waterfall-row');wrap.dataset.agent=row.name;wrap.dataset.state=row.status;
   const line=add(wrap,'div',null,'marp-row-label');add(line,'span',LABELS[row.name]+' · '+label(row.status));add(line,'span',duration(row.duration));
   const track=add(wrap,'div',null,'marp-track');track.setAttribute('aria-hidden','true');
   if(row.duration!=null&&row.status!=='skipped'){const bar=add(track,'div',null,'marp-bar');bar.style.left=(row.offset/total*100)+'%';bar.style.width=(row.duration/total*100)+'%';if(row.duration>0)bar.style.minWidth='2px'}
   if(row.duration!=null)add(wrap,'span','시작 +'+duration(row.offset)+(row.estimated?' (추정)':''),'marp-muted');
  }
 }
 for(const row of rows){
  const details=add(parent,'details',null,'marp-run');
  const title=LABELS[row.name]+' · '+label(row.status)+(row.model?' · '+row.model:'');
  add(details,'summary',title);
  details.ontoggle=()=>{
   if(!details.open||details.children.length>1)return;
   add(details,'p',[row.provider,row.model,duration(row.duration),row.status_code?'HTTP '+row.status_code:''].filter(Boolean).join(' · '));
   if(row.error)add(details,'p',row.error,'marp-error');
   if(row.status==='skipped')add(details,'p',row.reason==='disabled'?'분석 OFF':'이번 테스트 대상이 아닙니다.');
   if(row.check)add(details,'p',row.check==='oauth'?'서비스 계정 OAuth 인증 확인. 실제 모델 호출 권한은 분석 테스트에서 확인하세요.':'모델 조회 API 연결 확인. 실제 응답 생성은 분석 테스트에서 확인하세요.');
   if(row.chars!=null)add(details,'p','분석 결과 '+row.chars+'자');
   if(row.usage&&Object.keys(row.usage).length)json(details,'공급자 토큰 사용량',row.usage);
   if(row.pdf)json(details,'PDF 처리 · 자료 토큰 추정치',row.pdf);
   const preview=record.previews?.[row.name];if(preview){add(details,'p','분석 결과 미리보기'+(preview.truncated?' · 앞 '+PREVIEW_LIMIT+'자':''));add(details,'pre',preview.text)}
  };
 }
 json(parent,'진단 JSON 보기',record);
}

export async function renderDiagnostics(panel,api,tab,draft,{current,refresh,download,message}){
 const actions=add(panel,'div',null,'marp-actions');
 const button=(title,fn)=>{const b=add(actions,'button',title);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn()}catch(e){if(current())message(e.message,true)}finally{if(current())b.disabled=false}};return b};
 if(tab==='history'){
  const records=await api.getHistory();if(!current())return;
  add(panel,'p',`최근 ${records.length} / ${HISTORY_LIMIT}건 · 현재 플러그인 세션의 기록입니다. 다시 로드하면 초기화됩니다. 분석 미리보기는 에이전트당 ${PREVIEW_LIMIT}자까지 보관합니다.`);
  button('새로고침',refresh);button('기록 JSON 내보내기',()=>download('marp-call-history.json',records)).disabled=!records.length;
  button('기록 비우기',async()=>{await api.clearHistory();if(current())await refresh()}).disabled=!records.length;
  const filter=add(panel,'select');filter.setAttribute('aria-label','호출 기록 필터');
  for(const [value,title]of [['all','전체'],['analysis','대화 분석'],['connection','연결 테스트'],['tests','분석 테스트'],['failed','실패 포함']]){const o=add(filter,'option',title);o.value=value}
  const list=add(panel,'ul',null,'marp-records');
  const show=()=>{
   list.replaceChildren();const selected=records.filter(r=>filter.value==='all'||filter.value===r.kind||filter.value==='tests'&&['text-test','pdf-test'].includes(r.kind)||filter.value==='failed'&&(r.error||Object.keys(r.errors).length));
   if(!selected.length)add(list,'li','표시할 호출 기록이 없습니다.');
   for(const record of selected){const item=add(list,'li'),details=add(item,'details',null,'marp-run');add(details,'summary',date(record.started_at)+' · '+kinds[record.kind]+' · '+label(record.status)+' · '+duration(record.elapsed_ms));details.ontoggle=()=>{if(details.open&&details.children.length===1)renderRun(add(details,'div'),record)}}
  };filter.onchange=show;show();return;
 }
 if(tab==='waterfall'){
  button('새로고침',refresh);
  const records=await api.getHistory();if(!current())return;
  renderRun(panel,records.find(r=>r.kind!=='connection'));return;
 }
 const output=add(panel,'div');
 let revision=0;
 const show=record=>{if(current()){output.replaceChildren();renderRun(output,record)}};
 const run=async fn=>{
  const rev=++revision;for(const b of actions.querySelectorAll('button'))b.disabled=true;
  output.replaceChildren();add(output,'p','테스트 실행 중…','marp-muted');
  try{const record=await fn();if(rev===revision)show(record)}catch(e){if(current()){output.replaceChildren();add(output,'p',e.message,'marp-error')}throw e}finally{if(current())for(const b of actions.querySelectorAll('button'))b.disabled=false}
 };
 if(tab==='connection'){
  add(panel,'p',api.full?'Full은 입력한 서버 URL의 저장된 설정을 검사합니다. 공급자 설정을 수정했다면 먼저 저장해 주세요.':'현재 편집한 설정으로 연결을 검사합니다. 저장하지 않고도 확인할 수 있습니다.');
  add(panel,'p','모델 조회 API와 인증을 확인하며 응답 생성은 하지 않습니다. Vertex는 OAuth 인증을 확인합니다. 실제 모델·PDF 동작은 진단 탭의 분석 테스트로 확인하세요. OFF인 에이전트는 건너뜁니다.');
  button('전체 연결 테스트',()=>run(()=>api.testConnection({...draft})));
  for(const [name,title]of Object.entries(LABELS))button(title+' 연결 테스트',()=>run(()=>api.testConnection({...draft},name)));
  if(api.full){
   const serverOutput=add(panel,'div');
   button('Full 서버 상태 확인',async()=>{const {server}=await api.getDiagnostics(draft.server_url);if(!current())return;serverOutput.replaceChildren();add(serverOutput,'p','서버 연결 확인 완료 · '+(server.version||'버전 정보 없음'));json(serverOutput,'서버 상태', {status:server.status,version:server.version,ready:server.ready,agents:server.agents?.map(a=>({name:a.name,enabled:a.enabled,provider:a.provider,model:a.model,ready:a.ready}))})});
  }
 }else{
  add(panel,'p',api.full?'Full 테스트는 입력한 서버 URL에 저장된 설정으로 실행합니다.':'현재 편집한 설정으로 분석 테스트를 실행합니다.');
  add(panel,'p','아래 버튼을 누르면 합성 자료로 LLM을 호출합니다. 분석 결과는 대화에 주입하지 않습니다. 공급자의 usage는 실제 사용량, estimated_source_tokens는 자료의 토큰 추정치입니다.');
  button('텍스트 분석 테스트',()=>run(()=>api.test({...draft},false)));
  button('PDF 분석 테스트',()=>run(()=>api.test({...draft},true)));
 }
 panel.append(output);
 const before=revision,records=await api.getHistory();if(!current()||before!==revision)return;
 const previous=records.find(r=>tab==='connection'?r.kind==='connection':['text-test','pdf-test'].includes(r.kind));
 if(previous)show(previous);else add(output,'p','버튼을 눌러 테스트를 실행해 주세요.');
}
