//@name risu_multiagent_full
//@display-name MultiAgent RP — Full판
//@api 3.0
//@version 1.0.0
//@arg server_url string Full판 서버 URL (e.g. http://localhost:8000)
//@link https://github.com/your-repo/risu-multiagent Documentation

/**
 * MultiAgent RP Pipeline — Full판 플러그인 (RisuAI Plugin API v3.0)
 *
 * 역할 1: Custom AI Provider
 *   → RisuAI 모델 목록에 "MultiAgent-Full" 등록
 *   → 선택 시 Full판 서버(/generate)를 통해 4에이전트 파이프라인 실행
 *
 * 역할 2: 설정 GUI
 *   → 플러그인 설정 메뉴에서 서버 설정값 조회/수정
 */

(async () => {
  try {

    // ── 서버 URL 헬퍼 ─────────────────────────────────────────────────────────

    async function getServerUrl() {
      return ((await Risuai.getArgument('server_url')) || 'http://localhost:8000').replace(/\/$/, '');
    }

    let lastRunState = null;

    // ── Custom AI Provider 등록 ───────────────────────────────────────────────

    await Risuai.addProvider('MultiAgent-Full', async (args, abortSignal) => {
      const serverUrl = await getServerUrl();
      const messages  = args.prompt_chat || [];
      const startedAt = Date.now();

      // OpenAI messages → /generate 요청 형식 변환
      const systemMsg    = messages.find(m => m.role === 'system');
      const nonSystem    = messages.filter(m => m.role !== 'system');
      const userMsgs     = nonSystem.filter(m => m.role === 'user');
      const userInput    = userMsgs.length ? userMsgs[userMsgs.length - 1].content : '';
      // 마지막 유저 메시지를 제외한 나머지를 히스토리로
      const chatHistory  = nonSystem.slice(0, -1).map(m => ({ role: m.role, content: m.content }));
      const runBase = {
        provider: 'MultiAgent-Full',
        server_url: serverUrl,
        started_at: new Date(startedAt).toISOString(),
        input_chars: stringLength(userInput),
        system_chars: stringLength(systemMsg ? systemMsg.content : ''),
        history_messages: chatHistory.length,
      };

      try {
        const res = await Risuai.nativeFetch(`${serverUrl}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_input:    userInput,
            chat_history:  chatHistory,
            world_summary: systemMsg ? systemMsg.content : '',
            char_summary:  '',
          }),
          signal: abortSignal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          const content = `서버 오류 ${res.status}: ${errText.slice(0, 200)}`;
          await recordLastRun({
            ...runBase,
            success: false,
            status_code: res.status,
            duration_ms: Date.now() - startedAt,
            error: content,
          });
          return { success: false, content };
        }

        const data = await res.json();
        await recordLastRun({
          ...runBase,
          success: true,
          status_code: res.status,
          duration_ms: Date.now() - startedAt,
          response_chars: stringLength(data.response),
          debug_available: Boolean(data.debug),
          debug: data.debug || null,
        });
        return { success: true, content: data.response };

      } catch (err) {
        const content = err.name === 'AbortError' ? '요청이 취소되었습니다.' : `연결 실패: ${err.message}`;
        await recordLastRun({
          ...runBase,
          success: false,
          aborted: err.name === 'AbortError',
          duration_ms: Date.now() - startedAt,
          error: content,
        });
        return { success: false, content };
      }
    });

    // ── 설정 GUI ──────────────────────────────────────────────────────────────

    async function openDashboard() {
      const serverUrl = await getServerUrl();
      const data = await loadDashboardData(serverUrl);

      document.body.innerHTML = buildUI(data, serverUrl);
      setupHandlers(data, serverUrl);
      await Risuai.showContainer('fullscreen');
    }

    Risuai.registerSetting('MultiAgent Full판 상태', openDashboard, 'MA', 'html');

    async function loadDashboardData(serverUrl) {
      const data = {
        status: null,
        config: {},
        lastRun: await loadLastRun(),
        connected: false,
        statusError: '',
      };

      try {
        const statusRes = await Risuai.nativeFetch(`${serverUrl}/status`);
        if (statusRes.ok) {
          data.status = await statusRes.json();
          data.connected = true;
        } else {
          data.statusError = `상태 조회 실패: HTTP ${statusRes.status}`;
        }
      } catch (err) {
        data.statusError = `연결 실패: ${err.message}`;
      }

      try {
        const configRes = await Risuai.nativeFetch(`${serverUrl}/config`);
        if (configRes.ok) data.config = await configRes.json();
      } catch (_) {}

      return data;
    }

    // ── UI 빌더 ───────────────────────────────────────────────────────────────

    function buildUI(data, serverUrl) {
      const cfg = data.config || {};
      const status = data.status || null;
      const publicCfg = status?.config || {};
      const connected = data.connected;
      const ready = Boolean(status?.ready);
      const agents = status?.agents || fallbackAgents(cfg);
      const lastRun = data.lastRun || null;

      const v = (key, fallback = '') => {
        const val = cfg[key];
        return (val !== undefined && val !== null) ? String(val) : fallback;
      };

      const field = (id, label, type = 'text', placeholder = '') => `
        <div class="field">
          <label for="${id}">${label}</label>
          <input id="${id}" type="${type}" value="${escHtml(fieldValue(cfg, id))}" placeholder="${escHtml(placeholder)}">
        </div>`;

      const apiKeyField = (id, label, isSet) => `
        <div class="field">
          <label for="${id}">${label}</label>
          <input id="${id}" type="password" value="" placeholder="${isSet ? '설정됨 - 비워두면 유지' : '입력 필요'}" autocomplete="off">
        </div>`;

      const agentSettings = (name, label, apiKeySet) => `
        <details>
          <summary>
            <span>${label}</span>
            <span class="summary-note">비워두면 기본값 사용</span>
          </summary>
          <div class="details-body">
            ${field(`${name}_provider`, 'Provider', 'text', '기본값 사용')}
            ${field(`${name}_base_url`, 'Endpoint Base URL', 'text', '기본값 사용')}
            <div class="example-url">예시 URL: ${escHtml(exampleChatUrl(v(`${name}_base_url`) || v('default_base_url', 'https://api.openai.com/v1')))}</div>
            ${apiKeyField(`${name}_api_key`, 'API Key', apiKeySet)}
            ${field(`${name}_model`, 'Model', 'text', '기본값 사용')}
            <div class="row2">
              ${field(`${name}_temperature`, 'Temperature', 'number', '기본값 사용')}
              ${field(`${name}_max_tokens`, 'Max Tokens', 'number', '기본값 사용')}
            </div>
          </div>
        </details>`;

      return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101114;color:#eceff4;min-height:100vh;line-height:1.45}
.wrap{max-width:1040px;margin:0 auto;padding:22px 16px 84px}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}
h1{font-size:1.34rem;font-weight:720;letter-spacing:0;margin-bottom:4px}
.subtitle{color:#98a2b3;font-size:.84rem}
.header-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.status-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}
.metric{background:#191b20;border:1px solid #292d35;border-radius:8px;padding:12px;min-height:72px}
.metric-label{font-size:.72rem;color:#8d96a5;margin-bottom:5px}
.metric-value{font-size:.92rem;font-weight:680;overflow-wrap:anywhere}
.metric-sub{font-size:.74rem;color:#a8b0bd;margin-top:2px;overflow-wrap:anywhere}
.test-results{display:none;margin-bottom:12px}
.test-results.active{display:block}
.test-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.test-card{background:#15171b;border:1px solid #262a31;border-radius:8px;padding:10px}
.test-card-title{font-size:.8rem;font-weight:700;margin-bottom:6px}
.test-card-line{font-size:.73rem;color:#a8b0bd;overflow-wrap:anywhere}
.example-url{font-size:.73rem;color:#8d96a5;background:#111318;border:1px solid #272c34;border-radius:6px;padding:7px 9px;margin:-3px 0 10px;overflow-wrap:anywhere}
.tabs{display:flex;gap:6px;align-items:center;border-bottom:1px solid #2a2e36;margin-bottom:14px;overflow-x:auto}
.tab-btn{appearance:none;background:transparent;border:0;color:#a8b0bd;border-radius:6px 6px 0 0;padding:10px 12px;white-space:nowrap}
.tab-btn.active{background:#20242b;color:#fff}
.panel{display:none}
.panel.active{display:block}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.agent-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.card{background:#191b20;border:1px solid #292d35;border-radius:8px;padding:14px;margin-bottom:12px}
.card h2{font-size:.91rem;margin-bottom:10px;color:#f2f4f7}
.card p{font-size:.82rem;color:#a8b0bd}
.agent-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.agent-name{font-weight:700;font-size:.9rem}
.badge{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:.72rem;font-weight:680}
.badge.ok{background:#123323;color:#6ee7a8}
.badge.warn{background:#3a2b0d;color:#f7c66f}
.badge.err{background:#3a1717;color:#ff8a8a}
.badge.neutral{background:#27313c;color:#a8c7e6}
.kv{display:grid;grid-template-columns:82px minmax(0,1fr);gap:5px 8px;font-size:.78rem;margin-top:8px}
.k{color:#8792a2}
.v{color:#dde3ec;overflow-wrap:anywhere}
.check-list{display:grid;gap:8px}
.check-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;background:#15171b;border:1px solid #262a31;border-radius:8px}
.check-title{font-size:.84rem;font-weight:620}
.check-desc{font-size:.74rem;color:#8d96a5;margin-top:2px}
details{background:#191b20;border:1px solid #292d35;border-radius:8px;margin-bottom:8px}
summary{cursor:pointer;padding:13px 14px;font-size:.88rem;font-weight:650;color:#eef2f7;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px}
summary::before{content:'>';color:#8d96a5;margin-right:8px}
details[open]>summary::before{content:'v'}
.summary-note{font-size:.72rem;color:#8d96a5;font-weight:500}
.details-body{padding:0 14px 14px}
.field{margin-bottom:10px}
label{display:block;font-size:.75rem;color:#9aa4b2;margin-bottom:4px}
input{width:100%;padding:9px 10px;border-radius:6px;border:1px solid #343944;background:#0f1115;color:#eef2f7;font-size:.86rem}
input:focus{outline:none;border-color:#5585d9}
input[type=checkbox]{width:auto;margin-right:7px}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.msg{font-size:.82rem;padding:10px 12px;border-radius:8px;margin-bottom:12px;display:none}
.msg.ok{display:block;background:#10291e;color:#7ee2a8;border:1px solid #1d6b45}
.msg.err{display:block;background:#341515;color:#ff9b9b;border:1px solid #793333}
.help-list{display:grid;gap:9px;font-size:.84rem;color:#c7ced9}
.help-list li{margin-left:18px}
.debug-block{white-space:pre-wrap;overflow:auto;max-height:220px;background:#0f1115;border:1px solid #303640;border-radius:7px;padding:10px;color:#d9e1ec;font-size:.78rem;line-height:1.5;margin-top:8px}
.error-text{color:#ff9b9b;overflow-wrap:anywhere}
.actions{position:fixed;left:0;right:0;bottom:0;background:rgba(16,17,20,.96);border-top:1px solid #2a2e36;padding:10px 16px}
.actions-inner{max-width:1040px;margin:0 auto;display:flex;gap:8px;justify-content:flex-end}
button{padding:9px 14px;border-radius:7px;border:1px solid #343944;background:#20242b;color:#eef2f7;cursor:pointer;font-size:.86rem;font-weight:650}
button:hover{background:#2a3039}
button.primary{background:#2f6fed;border-color:#2f6fed;color:#fff}
button.primary:hover{background:#275fce}
button.ghost{background:#15171b;color:#a8b0bd}
@media (max-width: 860px){
  .top{display:block}
  .header-actions{justify-content:flex-start;margin-top:12px}
  .status-strip,.grid,.agent-grid,.test-grid{grid-template-columns:1fr}
  .row2{grid-template-columns:1fr}
}
</style></head><body>
<div class="wrap">
  <div class="top">
    <div>
      <h1>MultiAgent RP Full판</h1>
      <p class="subtitle">서버 연결, 에이전트 준비 상태, 파이프라인 설정을 확인합니다.</p>
    </div>
    <div class="header-actions">
      <button id="refresh-btn" class="ghost">새로고침</button>
      <button id="sidecar-test-btn">사이드카 테스트</button>
      <button id="llm-test-btn">LLM 테스트</button>
      <button id="all-test-btn" class="primary">전체 테스트</button>
    </div>
  </div>

  <div class="status-strip">
    <div class="metric">
      <div class="metric-label">Full 사이드카</div>
      <div class="metric-value">${connected ? '연결됨' : '연결 실패'}</div>
      <div class="metric-sub">${escHtml(serverUrl)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">준비 상태</div>
      <div class="metric-value">${ready ? '실행 가능' : '설정 필요'}</div>
      <div class="metric-sub">${ready ? '4개 에이전트 준비 완료' : 'API Key 또는 모델 설정 확인 필요'}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Provider</div>
      <div class="metric-value">${escHtml(publicCfg.default_provider || v('default_provider', 'openai-compatible'))}</div>
      <div class="metric-sub">${escHtml(publicCfg.default_model || v('default_model', 'gpt-4o-mini'))}</div>
    </div>
    <div class="metric">
      <div class="metric-label">LLM Endpoint</div>
      <div class="metric-value">${escHtml(formatEndpoint(publicCfg.default_base_url || v('default_base_url', 'https://api.openai.com/v1')))}</div>
      <div class="metric-sub">${escHtml(exampleChatUrl(publicCfg.default_base_url || v('default_base_url', 'https://api.openai.com/v1')))}</div>
    </div>
  </div>

  <div id="msg" class="msg"></div>
  <div id="test-results" class="test-results"></div>

  <div class="tabs" role="tablist">
    <button class="tab-btn active" data-tab="overview">개요</button>
    <button class="tab-btn" data-tab="pipeline">파이프라인</button>
    <button class="tab-btn" data-tab="recent">최근 실행</button>
    <button class="tab-btn" data-tab="settings">설정</button>
    <button class="tab-btn" data-tab="help">도움말</button>
  </div>

  <section id="tab-overview" class="panel active">
    <div class="grid">
      <div class="card">
        <h2>준비 체크</h2>
        <div class="check-list">
          ${checkItem('Full 서버 연결', connected, data.statusError || '서버 상태 API 응답 확인')}
          ${checkItem('기본 API Key', Boolean(publicCfg.default_api_key_set || cfg.default_api_key), '기본값 또는 에이전트별 키 사용')}
          ${checkItem('에이전트 준비', ready, ready ? '전체 에이전트 실행 가능' : '파이프라인 탭에서 누락 항목 확인')}
          ${checkItem('LLM Endpoint 예시', Boolean(publicCfg.default_base_url || cfg.default_base_url), exampleChatUrl(publicCfg.default_base_url || cfg.default_base_url || 'https://api.openai.com/v1'))}
        </div>
      </div>
      <div class="card">
        <h2>현재 구성</h2>
        <div class="kv">
          <div class="k">서버 버전</div><div class="v">${escHtml(status?.version || '-')}</div>
          <div class="k">사이드카</div><div class="v">${escHtml(serverUrl)}</div>
          <div class="k">Provider</div><div class="v">${escHtml(publicCfg.default_provider || v('default_provider', 'openai-compatible'))}</div>
          <div class="k">기본 모델</div><div class="v">${escHtml(publicCfg.default_model || v('default_model', 'gpt-4o-mini'))}</div>
          <div class="k">기본 URL</div><div class="v">${escHtml(publicCfg.default_base_url || v('default_base_url', 'https://api.openai.com/v1'))}</div>
          <div class="k">예시 URL</div><div class="v">${escHtml(exampleChatUrl(publicCfg.default_base_url || v('default_base_url', 'https://api.openai.com/v1')))}</div>
          <div class="k">Temperature</div><div class="v">${escHtml(publicCfg.default_temperature ?? v('default_temperature', '0.7'))}</div>
          <div class="k">Max Tokens</div><div class="v">${escHtml(publicCfg.default_max_tokens ?? v('default_max_tokens', '제한 없음'))}</div>
          <div class="k">타임아웃</div><div class="v">${escHtml(publicCfg.request_timeout ?? v('request_timeout', '60'))}초</div>
        </div>
      </div>
    </div>
  </section>

  <section id="tab-pipeline" class="panel">
    <div class="agent-grid">
      ${agents.map(agentCard).join('')}
    </div>
  </section>

  <section id="tab-recent" class="panel">
    ${lastRunPanel(lastRun)}
  </section>

  <section id="tab-settings" class="panel">
    <div class="card">
      <h2>Full 사이드카</h2>
      <div class="field">
        <label for="server_url">Sidecar URL</label>
        <input id="server_url" type="text" value="${escHtml(serverUrl)}" placeholder="http://localhost:8000">
      </div>
      <div class="example-url">예시 URL: ${escHtml(normalizeUrl(serverUrl) + '/generate')}</div>
    </div>

    <div class="card">
      <h2>기본 LLM 설정</h2>
      <p>에이전트별 설정이 비어 있을 때 사용됩니다.</p>
      <div style="height:10px"></div>
      ${field('default_provider', 'Provider', 'text', 'openai-compatible')}
      ${field('default_base_url', 'Endpoint Base URL', 'text', 'https://api.openai.com/v1')}
      <div class="example-url">예시 URL: ${escHtml(exampleChatUrl(v('default_base_url', 'https://api.openai.com/v1')))}</div>
      ${apiKeyField('default_api_key', 'API Key', Boolean(publicCfg.default_api_key_set || cfg.default_api_key))}
      ${field('default_model', 'Model', 'text', 'gpt-4o-mini')}
      <div class="row2">
        ${field('default_temperature', 'Temperature', 'number', '0.7')}
        ${field('default_max_tokens', 'Max Tokens', '비우면 제한 없음')}
      </div>
    </div>

    ${agentSettings('worldbuilding', '세계관 에이전트', Boolean(findAgent(agents, 'worldbuilding')?.api_key_set || cfg.worldbuilding_api_key))}
    ${agentSettings('plot', '플롯 에이전트', Boolean(findAgent(agents, 'plot')?.api_key_set || cfg.plot_api_key))}
    ${agentSettings('character', '등장인물 에이전트', Boolean(findAgent(agents, 'character')?.api_key_set || cfg.character_api_key))}
    ${agentSettings('reviewer', '검수 에이전트', Boolean(findAgent(agents, 'reviewer')?.api_key_set || cfg.reviewer_api_key))}

    <div class="card">
      <h2>파이프라인 설정</h2>
      <div class="row2">
        <div class="field">
          <label for="context_window">컨텍스트 윈도우</label>
          <input id="context_window" type="number" min="1" max="50" value="${escHtml(v('context_window', '10'))}">
        </div>
        <div class="field">
          <label for="request_timeout">타임아웃 초</label>
          <input id="request_timeout" type="number" min="10" max="300" value="${escHtml(v('request_timeout', '60'))}">
        </div>
      </div>
      <label>
        <input id="debug_mode" type="checkbox" ${cfg.debug_mode ? 'checked' : ''}>
        디버그 모드
      </label>
    </div>
  </section>

  <section id="tab-help" class="panel">
    <div class="card">
      <h2>운영 메모</h2>
      <ul class="help-list">
        <li>RisuAI는 이 플러그인을 Custom AI Provider로 호출하고, Full 서버가 4단계 에이전트 파이프라인을 실행합니다.</li>
        <li>Full판의 Sidecar URL은 RisuAI 플러그인이 호출하는 FastAPI 서버 주소입니다. 예시는 http://localhost:8000 입니다.</li>
        <li>LLM Endpoint Base URL은 OpenAI-compatible API의 /v1 주소입니다. 예시는 https://api.openai.com/v1 입니다.</li>
        <li>API Key 입력칸은 저장된 값을 다시 표시하지 않습니다. 빈칸으로 두면 기존 값이 유지됩니다.</li>
        <li>디버그 모드는 서버 응답에 에이전트 분석 컨텍스트를 포함합니다. RP 몰입이 필요할 때는 꺼두는 편이 좋습니다.</li>
        <li>서버가 연결되지 않으면 Docker 컨테이너 실행 상태와 서버 URL을 먼저 확인하세요.</li>
      </ul>
    </div>
  </section>
</div>

<div class="actions">
  <div class="actions-inner">
    <button id="close-btn" class="ghost">닫기</button>
    <button id="save-btn" class="primary">저장</button>
  </div>
</div>
</body></html>`;
    }

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function fieldValue(cfg, key) {
      const value = cfg[key];
      return value !== undefined && value !== null ? String(value) : '';
    }

    function checkItem(title, ok, desc) {
      return `
        <div class="check-item">
          <div>
            <div class="check-title">${escHtml(title)}</div>
            <div class="check-desc">${escHtml(desc)}</div>
          </div>
          <span class="badge ${ok ? 'ok' : 'err'}">${ok ? '정상' : '확인 필요'}</span>
        </div>`;
    }

    function agentCard(agent) {
      const readyClass = agent.ready ? 'ok' : 'err';
      return `
        <div class="card">
          <div class="agent-head">
            <div class="agent-name">${escHtml(agent.label)}</div>
            <span class="badge ${readyClass}">${agent.ready ? '준비됨' : '미완료'}</span>
          </div>
          <div class="kv">
            <div class="k">Provider</div><div class="v">${escHtml(agent.provider || '-')}</div>
            <div class="k">Endpoint</div><div class="v">${escHtml(agent.base_url || '-')}</div>
            <div class="k">예시 URL</div><div class="v">${escHtml(exampleChatUrl(agent.base_url))}</div>
            <div class="k">API Key</div><div class="v">${agent.api_key_set ? '설정됨' : '없음'}</div>
            <div class="k">모델</div><div class="v">${escHtml(agent.model || '-')}</div>
            <div class="k">Temp</div><div class="v">${escHtml(agent.temperature ?? '-')}</div>
            <div class="k">Max</div><div class="v">${escHtml(agent.max_tokens ?? '제한 없음')}</div>
            <div class="k">상속</div><div class="v">${sourceText(agent)}</div>
          </div>
        </div>`;
    }

    function fallbackAgents(cfg) {
      const labels = {
        worldbuilding: '세계관 에이전트',
        plot: '플롯 에이전트',
        character: '등장인물 에이전트',
        reviewer: '검수 에이전트',
      };
      return Object.entries(labels).map(([name, label]) => {
        const baseUrl = cfg[`${name}_base_url`] || cfg.default_base_url || '';
        const apiKey = cfg[`${name}_api_key`] || cfg.default_api_key || '';
        const model = cfg[`${name}_model`] || cfg.default_model || '';
        const temperature = cfg[`${name}_temperature`] ?? cfg.default_temperature ?? 0.7;
        const maxTokens = cfg[`${name}_max_tokens`] ?? cfg.default_max_tokens ?? null;
        return {
          name,
          label,
          provider: cfg[`${name}_provider`] || cfg.default_provider || 'openai-compatible',
          base_url: baseUrl,
          model,
          temperature,
          max_tokens: maxTokens,
          provider_source: cfg[`${name}_provider`] ? 'override' : 'default',
          base_url_source: cfg[`${name}_base_url`] ? 'override' : 'default',
          api_key_source: cfg[`${name}_api_key`] ? 'override' : 'default',
          model_source: cfg[`${name}_model`] ? 'override' : 'default',
          temperature_source: cfg[`${name}_temperature`] !== undefined && cfg[`${name}_temperature`] !== null ? 'override' : 'default',
          max_tokens_source: cfg[`${name}_max_tokens`] !== undefined && cfg[`${name}_max_tokens`] !== null ? 'override' : 'default',
          api_key_set: Boolean(apiKey),
          ready: Boolean(baseUrl && apiKey && model),
        };
      });
    }

    function findAgent(agents, name) {
      return agents.find(agent => agent.name === name);
    }

    function formatEndpoint(baseUrl) {
      try {
        const url = new URL(baseUrl);
        return url.host || baseUrl;
      } catch (_) {
        return baseUrl || '-';
      }
    }

    function sourceText(agent) {
      const parts = [];
      if (agent.provider_source === 'override') parts.push('Provider 개별');
      if (agent.base_url_source === 'override') parts.push('URL 개별');
      if (agent.api_key_source === 'override') parts.push('키 개별');
      if (agent.model_source === 'override') parts.push('모델 개별');
      if (agent.temperature_source === 'override') parts.push('온도 개별');
      if (agent.max_tokens_source === 'override') parts.push('토큰 개별');
      return parts.length ? parts.join(', ') : '전체 기본값';
    }

    function lastRunPanel(lastRun) {
      if (!lastRun) {
        return `
          <div class="card">
            <h2>최근 실행 기록 없음</h2>
            <p>MultiAgent-Full Provider로 응답을 생성하면 이곳에 실행 결과가 표시됩니다.</p>
          </div>`;
      }

      const debug = lastRun.debug;
      return `
        <div class="grid">
          <div class="card">
            <h2>마지막 요청</h2>
            <div class="kv">
              <div class="k">결과</div><div class="v"><span class="badge ${lastRun.success ? 'ok' : 'err'}">${lastRun.success ? '성공' : '실패'}</span></div>
              <div class="k">완료 시각</div><div class="v">${escHtml(formatDateTime(lastRun.completed_at))}</div>
              <div class="k">소요 시간</div><div class="v">${escHtml(formatDuration(lastRun.duration_ms))}</div>
              <div class="k">서버</div><div class="v">${escHtml(lastRun.server_url || '-')}</div>
              <div class="k">HTTP</div><div class="v">${escHtml(lastRun.status_code || '-')}</div>
            </div>
            ${lastRun.error ? `<div class="error-text" style="margin-top:10px">${escHtml(lastRun.error)}</div>` : ''}
          </div>
          <div class="card">
            <h2>요청 규모</h2>
            <div class="kv">
              <div class="k">현재 입력</div><div class="v">${escHtml(lastRun.input_chars ?? '-')}자</div>
              <div class="k">시스템</div><div class="v">${escHtml(lastRun.system_chars ?? '-')}자</div>
              <div class="k">히스토리</div><div class="v">${escHtml(lastRun.history_messages ?? '-')}개 메시지</div>
              <div class="k">응답</div><div class="v">${escHtml(lastRun.response_chars ?? '-')}자</div>
              <div class="k">디버그</div><div class="v">${lastRun.debug_available ? '반환됨' : '없음'}</div>
            </div>
          </div>
        </div>
        ${debug ? `
          <div class="card">
            <h2>디버그 컨텍스트</h2>
            ${debugBlock('세계관', debug.context_world)}
            ${debugBlock('플롯', debug.context_plot)}
            ${debugBlock('등장인물', debug.context_char)}
            ${debugBlock('검수', debug.reviewer_notes)}
          </div>` : ''}
      `;
    }

    function debugBlock(label, text) {
      if (!text) return '';
      return `
        <details>
          <summary><span>${escHtml(label)}</span><span class="summary-note">펼쳐 보기</span></summary>
          <pre class="debug-block">${escHtml(text)}</pre>
        </details>`;
    }

    function setupHandlers(data, serverUrl) {
      const initialConfig = data.config || {};

      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
          document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
          btn.classList.add('active');
          document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
        });
      });

      document.getElementById('refresh-btn')?.addEventListener('click', openDashboard);

      document.getElementById('sidecar-test-btn')?.addEventListener('click', () => testSidecar(serverUrl));
      document.getElementById('llm-test-btn')?.addEventListener('click', () => testLlm(serverUrl));
      document.getElementById('all-test-btn')?.addEventListener('click', () => testAll(serverUrl));

      document.getElementById('save-btn')?.addEventListener('click', async () => {
        const currentServerUrl = normalizeUrl(getInputValue('server_url') || serverUrl);
        try {
          await Risuai.setArgument('server_url', currentServerUrl);
          const res = await Risuai.nativeFetch(`${currentServerUrl}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(collectConfig(initialConfig)),
          });
          if (res.ok) showMsg('저장 완료', true);
          else showMsg(`저장 실패: HTTP ${res.status}`, false);
        } catch (err) {
          showMsg(`저장 오류: ${err.message}`, false);
        }
      });

      document.getElementById('close-btn')?.addEventListener('click', async () => {
        await Risuai.hideContainer();
      });
    }

    function collectConfig(initialConfig) {
      const secret = key => getInputValue(key) || initialConfig[key] || '';
      return {
        default_provider:       getInputValue('default_provider') || 'openai-compatible',
        default_base_url:       getInputValue('default_base_url'),
        default_api_key:        secret('default_api_key'),
        default_model:          getInputValue('default_model'),
        default_temperature:    requiredFloat('default_temperature', 0.7),
        default_max_tokens:     optionalInt('default_max_tokens'),
        worldbuilding_provider: getInputValue('worldbuilding_provider'),
        worldbuilding_base_url: getInputValue('worldbuilding_base_url'),
        worldbuilding_api_key:  secret('worldbuilding_api_key'),
        worldbuilding_model:    getInputValue('worldbuilding_model'),
        worldbuilding_temperature: optionalFloat('worldbuilding_temperature'),
        worldbuilding_max_tokens:  optionalInt('worldbuilding_max_tokens'),
        plot_provider:          getInputValue('plot_provider'),
        plot_base_url:          getInputValue('plot_base_url'),
        plot_api_key:           secret('plot_api_key'),
        plot_model:             getInputValue('plot_model'),
        plot_temperature:       optionalFloat('plot_temperature'),
        plot_max_tokens:        optionalInt('plot_max_tokens'),
        character_provider:     getInputValue('character_provider'),
        character_base_url:     getInputValue('character_base_url'),
        character_api_key:      secret('character_api_key'),
        character_model:        getInputValue('character_model'),
        character_temperature:  optionalFloat('character_temperature'),
        character_max_tokens:   optionalInt('character_max_tokens'),
        reviewer_provider:      getInputValue('reviewer_provider'),
        reviewer_base_url:      getInputValue('reviewer_base_url'),
        reviewer_api_key:       secret('reviewer_api_key'),
        reviewer_model:         getInputValue('reviewer_model'),
        reviewer_temperature:   optionalFloat('reviewer_temperature'),
        reviewer_max_tokens:    optionalInt('reviewer_max_tokens'),
        context_window:         parseInt(getInputValue('context_window')) || 10,
        request_timeout:        parseFloat(getInputValue('request_timeout')) || 60,
        debug_mode:             document.getElementById('debug_mode')?.checked || false,
      };
    }

    function getInputValue(id) {
      return document.getElementById(id)?.value?.trim() || '';
    }

    function optionalFloat(id) {
      const value = getInputValue(id);
      if (!value) return null;
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function optionalInt(id) {
      const value = getInputValue(id);
      if (!value) return null;
      const parsed = parseInt(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function requiredFloat(id, fallback) {
      const parsed = parseFloat(getInputValue(id));
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    function normalizeUrl(url) {
      return String(url || 'http://localhost:8000').replace(/\/$/, '');
    }

    function exampleChatUrl(baseUrl) {
      const normalized = String(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
      return `${normalized}/chat/completions`;
    }

    function showMsg(text, isOk) {
      const el = document.getElementById('msg');
      if (!el) return;
      el.textContent = text;
      el.className = `msg ${isOk ? 'ok' : 'err'}`;
      setTimeout(() => {
        if (el.textContent === text) el.className = 'msg';
      }, 4000);
    }

    async function testSidecar(serverUrl) {
      const currentServerUrl = normalizeUrl(getInputValue('server_url') || serverUrl);
      setTestResults('');
      try {
        const res = await Risuai.nativeFetch(`${currentServerUrl}/health`);
        if (res.ok) {
          showMsg('사이드카 연결 성공', true);
          setTestResults(`
            <div class="card">
              <h2>사이드카 테스트</h2>
              <div class="kv">
                <div class="k">URL</div><div class="v">${escHtml(currentServerUrl + '/health')}</div>
                <div class="k">결과</div><div class="v"><span class="badge ok">성공</span></div>
              </div>
            </div>`);
          return true;
        }
        showMsg(`사이드카 응답 오류: HTTP ${res.status}`, false);
        setTestResults(`
          <div class="card">
            <h2>사이드카 테스트</h2>
            <div class="error-text">HTTP ${escHtml(res.status)}</div>
          </div>`);
      } catch (err) {
        showMsg(`사이드카 연결 실패: ${err.message}`, false);
        setTestResults(`
          <div class="card">
            <h2>사이드카 테스트</h2>
            <div class="error-text">${escHtml(err.message)}</div>
          </div>`);
      }
      return false;
    }

    async function testLlm(serverUrl) {
      const currentServerUrl = normalizeUrl(getInputValue('server_url') || serverUrl);
      try {
        const res = await Risuai.nativeFetch(`${currentServerUrl}/test/llm`);
        if (!res.ok) {
          showMsg(`LLM 테스트 호출 실패: HTTP ${res.status}`, false);
          setTestResults(`
            <div class="card">
              <h2>LLM 테스트</h2>
              <div class="error-text">HTTP ${escHtml(res.status)}</div>
            </div>`);
          return false;
        }

        const data = await res.json();
        showMsg(data.success ? 'LLM 연결 테스트 성공' : 'LLM 연결 테스트 실패', data.success);
        setTestResults(renderLlmTestResults(data));
        return data.success;
      } catch (err) {
        showMsg(`LLM 테스트 실패: ${err.message}`, false);
        setTestResults(`
          <div class="card">
            <h2>LLM 테스트</h2>
            <div class="error-text">${escHtml(err.message)}</div>
          </div>`);
        return false;
      }
    }

    async function testAll(serverUrl) {
      const sidecarOk = await testSidecar(serverUrl);
      if (!sidecarOk) return;
      await testLlm(serverUrl);
    }

    function renderLlmTestResults(data) {
      const results = data.results || [];
      return `
        <div class="card">
          <h2>LLM 연결 테스트</h2>
          <div class="test-grid">
            ${results.map(result => `
              <div class="test-card">
                <div class="test-card-title">${escHtml(result.label)}</div>
                <div><span class="badge ${result.success ? 'ok' : 'err'}">${result.success ? '성공' : '실패'}</span></div>
                <div class="test-card-line">Provider: ${escHtml(result.provider || '-')}</div>
                <div class="test-card-line">Model: ${escHtml(result.model || '-')}</div>
                <div class="test-card-line">URL: ${escHtml(result.example_url || '-')}</div>
                <div class="test-card-line">HTTP: ${escHtml(result.status_code ?? '-')}</div>
                <div class="test-card-line">Latency: ${escHtml(result.latency_ms ?? '-')}ms</div>
                ${result.error ? `<div class="error-text" style="font-size:.73rem;margin-top:6px">${escHtml(result.error)}</div>` : ''}
              </div>`).join('')}
          </div>
        </div>`;
    }

    function setTestResults(html) {
      const el = document.getElementById('test-results');
      if (!el) return;
      el.innerHTML = html;
      el.className = html ? 'test-results active' : 'test-results';
    }

    async function recordLastRun(run) {
      const completedRun = {
        completed_at: new Date().toISOString(),
        ...run,
      };
      lastRunState = completedRun;

      const persistedRun = { ...completedRun };
      delete persistedRun.debug;

      try {
        await Risuai.pluginStorage.setItem('last_run', JSON.stringify(persistedRun));
      } catch (_) {}
    }

    async function loadLastRun() {
      if (lastRunState) return lastRunState;
      try {
        const raw = await Risuai.pluginStorage.getItem('last_run');
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    }

    function stringLength(value) {
      return String(value || '').length;
    }

    function formatDateTime(value) {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString();
    }

    function formatDuration(ms) {
      if (!Number.isFinite(ms)) return '-';
      if (ms < 1000) return `${ms}ms`;
      return `${(ms / 1000).toFixed(1)}초`;
    }

    console.log('MultiAgent RP Full판 플러그인 v1.0.0 로드됨');

  } catch (err) {
    console.log(`MultiAgent Full판 init error: ${err.message}`);
  }
})();
