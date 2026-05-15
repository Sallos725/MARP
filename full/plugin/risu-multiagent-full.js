//@name risu_multiagent_full
//@display-name MultiAgent RP — Full판
//@api 3.0
//@version 2.0.2
//@arg server_url string Full판 서버 URL (e.g. http://localhost:6009 or https://example.com/multi-agent)
//@arg bypass_translate string Skip MultiAgent analysis for RisuAI built-in LLM translation requests (default: 1)
//@arg bypass_lb_process string Skip MultiAgent analysis for <lb-process> helper LLM requests (default: 1)

/**
 * MultiAgent RP Pipeline — Full판 플러그인 (RisuAI Plugin API v3.0)
 *
 * 역할 1: beforeRequest 훅
 *   → RisuAI가 메인 모델로 요청 보내기 직전에 끼어들어
 *   → Full판 서버(/analyze)로 분석 3개(세계관/플롯/캐릭터) 호출
 *   → system 프롬프트에 분석 컨텍스트 주입
 *   → RisuAI 메인 모델이 그대로 최종 응답 생성 (검수 역할 겸함)
 *
 * 역할 2: 설정 GUI
 *   → 플러그인 설정 메뉴에서 서버/에이전트 설정값 조회/수정
 */

(async () => {
  try {
    const PLUGIN_SETTINGS_KEY = 'risu_multiagent_full_plugin_settings_v1';
    const SIDECAR_CONFIG_BACKUP_KEY = 'risu_multiagent_full_sidecar_config_backup_v1';
    const STORAGE_VERSION = 1;

    // ── 서버 URL 헬퍼 ─────────────────────────────────────────────────────────

    async function getServerUrl() {
      const settings = await loadPluginSettings();
      return ((await Risuai.getArgument('server_url')) || settings.serverUrl || 'http://localhost:6009').replace(/\/$/, '');
    }

    async function getBypassSettings() {
      const settings = await loadPluginSettings();
      return {
        bypassTranslate: parseEnabled(await Risuai.getArgument('bypass_translate'), settings.bypassTranslate ?? true),
        bypassLbProcess: parseEnabled(await Risuai.getArgument('bypass_lb_process'), settings.bypassLbProcess ?? true),
      };
    }

    let lastRunState = null;

    // ── beforeRequest 훅 등록 ─────────────────────────────────────────────────

    Risuai.addRisuReplacer('beforeRequest', async (messages, type) => {
      const bypass = await getBypassSettings();
      const bypassReason = getBypassReason(messages, type, bypass);
      if (bypassReason) {
        console.log(`MultiAgent Full판: ${bypassReason} bypassed`);
        return messages;
      }

      const startedAt = Date.now();
      const serverUrl = await getServerUrl();

      // OpenAI messages → /analyze 요청 형식 변환
      const systemMsg   = messages.find(m => m.role === 'system');
      const nonSystem   = messages.filter(m => m.role !== 'system');
      const lastUserIdx = findLastIndex(nonSystem, m => m.role === 'user');
      const userInput   = lastUserIdx >= 0 ? nonSystem[lastUserIdx].content : '';
      const chatHistory = (lastUserIdx >= 0 ? nonSystem.slice(0, lastUserIdx) : nonSystem)
        .map(m => ({ role: m.role, content: m.content }));

      const runBase = {
        server_url: serverUrl,
        started_at: new Date(startedAt).toISOString(),
        input_chars: stringLength(userInput),
        system_chars: stringLength(systemMsg ? systemMsg.content : ''),
        history_messages: chatHistory.length,
        mode: type || '',
      };

      try {
        const res = await Risuai.nativeFetch(`${serverUrl}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_input:    userInput,
            chat_history:  chatHistory,
            world_summary: systemMsg ? systemMsg.content : '',
            char_summary:  '',
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          await recordLastRun({
            ...runBase,
            success: false,
            status_code: res.status,
            duration_ms: Date.now() - startedAt,
            error: `서버 오류 ${res.status}: ${errText.slice(0, 200)}`,
          });
          // 분석 실패해도 채팅은 막지 않도록 원본 메시지 그대로 통과
          return messages;
        }

        const data = await res.json();
        await recordLastRun({
          ...runBase,
          success: true,
          status_code: res.status,
          duration_ms: Date.now() - startedAt,
          world_chars: stringLength(data.context_world),
          plot_chars: stringLength(data.context_plot),
          char_chars: stringLength(data.context_char),
          debug: {
            context_world: data.context_world,
            context_plot: data.context_plot,
            context_char: data.context_char,
          },
        });

        return injectContext(messages, data.context_world, data.context_plot, data.context_char);

      } catch (err) {
        await recordLastRun({
          ...runBase,
          success: false,
          duration_ms: Date.now() - startedAt,
          error: `연결 실패: ${err.message}`,
        });
        console.log(`MultiAgent pipeline error: ${err.message}`);
        return messages;
      }
    });

    function findLastIndex(arr, predicate) {
      for (let i = arr.length - 1; i >= 0; i -= 1) {
        if (predicate(arr[i])) return i;
      }
      return -1;
    }

    function injectContext(messages, contextWorld, contextPlot, contextChar) {
      const injection = [
        '',
        '---',
        '[MultiAgent RP Analysis Context]',
        '',
        '[Worldbuilding Agent]',
        contextWorld || '(none)',
        '',
        '[Plot Agent]',
        contextPlot || '(none)',
        '',
        '[Character Agent]',
        contextChar || '(none)',
        '',
        '[Review Instructions]',
        'Use the analysis above to detect and correct worldbuilding violations, plot regressions, and OOC errors before writing the final RP response.',
        '---',
      ].join('\n');

      const lastSystemIdx = findLastIndex(messages, m => m.role === 'system');
      if (lastSystemIdx >= 0) {
        return messages.map((m, idx) =>
          idx === lastSystemIdx ? { ...m, content: m.content + injection } : m
        );
      }
      return [{ role: 'system', content: injection.replace(/^\n/, '') }, ...messages];
    }

    // ── 설정 GUI ──────────────────────────────────────────────────────────────

    async function openDashboard() {
      const serverUrl = await getServerUrl();
      const data = await loadDashboardData(serverUrl);

      document.body.innerHTML = buildUI(data, serverUrl);
      setupHandlers(data, serverUrl);
      await Risuai.showContainer('fullscreen');
    }

    const menuIcon = '🔱';

    Risuai.registerSetting('MultiAgent Full판 상태', openDashboard, menuIcon, 'html');
    await Risuai.registerButton({
      name: 'MultiAgent Full',
      icon: menuIcon,
      iconType: 'html',
      location: 'hamburger',
    }, openDashboard);

    async function loadDashboardData(serverUrl) {
      const data = {
        status: null,
        config: {},
        lastRun: await loadLastRun(),
        bypass: await getBypassSettings(),
        configBackup: await getSidecarConfigBackupInfo(),
        connected: false,
        statusError: '',
      };

      try {
        const statusRes = await Risuai.nativeFetch(`${serverUrl}/status`, { method: 'GET' });
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
        const configRes = await Risuai.nativeFetch(`${serverUrl}/config`, { method: 'GET' });
        if (configRes.ok) {
          data.config = await configRes.json();
          await saveSidecarConfigBackup(serverUrl, data.config);
          data.configBackup = await getSidecarConfigBackupInfo();
        } else {
          data.config = await loadSidecarConfigBackup(serverUrl) || {};
        }
      } catch (_) {
        data.config = await loadSidecarConfigBackup(serverUrl) || {};
      }

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
      const bypass = data.bypass || { bypassTranslate: true, bypassLbProcess: true };
      const configBackup = data.configBackup || { exists: false, savedAt: '' };

      const v = (key, fallback = '') => {
        const val = cfg[key];
        return (val !== undefined && val !== null) ? String(val) : fallback;
      };

      const field = (id, label, type = 'text', placeholder = '') => `
        <div class="field">
          <label for="${id}">${label}</label>
          <input id="${id}" type="${type}" value="${escHtml(fieldValue(cfg, id))}" placeholder="${escHtml(placeholder)}">
        </div>`;

      const credentialField = (id, isSet) => `
        <div class="field credential-field" data-credential="${id}">
          <div class="api-key-credential">
            <label for="${id}">API Key</label>
            <input id="${id}" type="password" value="" placeholder="${isSet ? '설정됨 - 비워두면 유지' : '입력 필요'}" autocomplete="off">
          </div>
          <div class="vertex-credential">
            <label for="${id}_file">Vertex AI Service Account JSON</label>
            <input id="${id}_file" type="file" accept="application/json,.json">
            <textarea id="${id}_json" class="credential-json" aria-label="Vertex AI service account JSON"></textarea>
            <div class="example-url">JSON 파일을 선택하면 credential로 저장됩니다. 원문은 화면에 표시하지 않습니다.</div>
          </div>
        </div>`;

      const agentSettings = (name, label, apiKeySet) => `
        <details>
          <summary>
            <span>${label}</span>
            <span class="summary-note">비워두면 기본값 사용</span>
          </summary>
          <div class="details-body">
            ${providerSelect(`${name}_provider`, 'Provider', v(`${name}_provider`), true)}
            ${field(`${name}_base_url`, 'Endpoint Base URL', 'text', '기본값 사용')}
            <div class="example-url" data-example-for="${name}_base_url">예시 URL: ${escHtml(exampleChatUrl(v(`${name}_base_url`) || v('default_base_url', 'https://api.openai.com/v1')))}</div>
            ${credentialField(`${name}_api_key`, apiKeySet)}
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
.test-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
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
.agent-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
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
input,select,textarea{width:100%;padding:9px 10px;border-radius:6px;border:1px solid #343944;background:#0f1115;color:#eef2f7;font-size:.86rem}
textarea{min-height:92px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:none;border-color:#5585d9}
input[type=checkbox]{width:auto;margin-right:7px}
.custom-provider,.vertex-credential{display:none;margin-top:8px}
.credential-json{display:none}
.provider-custom-active .custom-provider{display:block}
.credential-vertex-active .api-key-credential{display:none}
.credential-vertex-active .vertex-credential{display:block}
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
      <p class="subtitle">RisuAI 메인 모델 호출 직전에 분석 3개(세계관/플롯/캐릭터)를 끼워 넣어 system 프롬프트에 주입합니다.</p>
    </div>
    <div class="header-actions">
      <button id="refresh-btn" class="ghost">새로고침</button>
      <button id="sidecar-test-btn">사이드카 테스트</button>
      <button id="llm-test-btn">LLM 인증 테스트</button>
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
      <div class="metric-label">분석 준비</div>
      <div class="metric-value">${ready ? '실행 가능' : '설정 필요'}</div>
      <div class="metric-sub">${ready ? '3개 분석 에이전트 준비 완료' : 'API Key 또는 모델 설정 확인 필요'}</div>
    </div>
    <div class="metric">
      <div class="metric-label">분석 모델</div>
      <div class="metric-value">${escHtml(publicCfg.default_provider || v('default_provider', 'openai'))}</div>
      <div class="metric-sub">${escHtml(publicCfg.default_model || v('default_model', 'gpt-4o-mini'))}</div>
    </div>
    <div class="metric">
      <div class="metric-label">최종 응답</div>
      <div class="metric-value">RisuAI 메인 모델</div>
      <div class="metric-sub">현재 선택된 채팅 모델이 그대로 사용됩니다</div>
    </div>
  </div>

  <div id="msg" class="msg"></div>
  <div id="test-results" class="test-results"></div>

  <div class="tabs" role="tablist">
    <button class="tab-btn active" data-tab="overview">개요</button>
    <button class="tab-btn" data-tab="pipeline">분석 에이전트</button>
    <button class="tab-btn" data-tab="recent">최근 분석</button>
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
          ${checkItem('분석 에이전트 준비', ready, ready ? '3개 분석 에이전트 실행 가능' : '분석 에이전트 탭에서 누락 항목 확인')}
          ${checkItem('LLM Endpoint 예시', Boolean(publicCfg.default_base_url || cfg.default_base_url), exampleChatUrl(publicCfg.default_base_url || cfg.default_base_url || 'https://api.openai.com/v1'))}
        </div>
      </div>
      <div class="card">
        <h2>현재 구성</h2>
        <div class="kv">
          <div class="k">서버 버전</div><div class="v">${escHtml(status?.version || '-')}</div>
          <div class="k">사이드카</div><div class="v">${escHtml(serverUrl)}</div>
          <div class="k">Provider</div><div class="v">${escHtml(publicCfg.default_provider || v('default_provider', 'openai'))}</div>
          <div class="k">기본 모델</div><div class="v">${escHtml(publicCfg.default_model || v('default_model', 'gpt-4o-mini'))}</div>
          <div class="k">기본 URL</div><div class="v">${escHtml(publicCfg.default_base_url || v('default_base_url', 'https://api.openai.com/v1'))}</div>
          <div class="k">예시 URL</div><div class="v">${escHtml(exampleChatUrl(publicCfg.default_base_url || v('default_base_url', 'https://api.openai.com/v1')))}</div>
          <div class="k">Temperature</div><div class="v">${escHtml(publicCfg.default_temperature ?? v('default_temperature', '0.7'))}</div>
          <div class="k">Max Tokens</div><div class="v">${escHtml(publicCfg.default_max_tokens ?? v('default_max_tokens', '제한 없음'))}</div>
          <div class="k">타임아웃</div><div class="v">${escHtml(publicCfg.request_timeout ?? v('request_timeout', '60'))}초</div>
          <div class="k">번역 우회</div><div class="v">${bypass.bypassTranslate ? '켜짐' : '꺼짐'}</div>
          <div class="k">LB 우회</div><div class="v">${bypass.bypassLbProcess ? '켜짐' : '꺼짐'}</div>
          <div class="k">설정 백업</div><div class="v">${configBackup.exists ? `있음 (${escHtml(formatDateTime(configBackup.savedAt))})` : '없음'}</div>
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
        <input id="server_url" type="text" value="${escHtml(serverUrl)}" placeholder="http://localhost:6009">
      </div>
      <div class="example-url">예시 URL: ${escHtml(normalizeUrl(serverUrl) + '/analyze')}</div>
    </div>

    <div class="card">
      <h2>기본 LLM 설정</h2>
      <p>에이전트별 설정이 비어 있을 때 사용됩니다.</p>
      <div style="height:10px"></div>
      ${providerSelect('default_provider', 'Provider', publicCfg.default_provider || v('default_provider', 'openai'), false)}
      ${field('default_base_url', 'Endpoint Base URL', 'text', 'https://api.openai.com/v1')}
      <div class="example-url" data-example-for="default_base_url">예시 URL: ${escHtml(exampleChatUrl(v('default_base_url', 'https://api.openai.com/v1')))}</div>
      ${credentialField('default_api_key', Boolean(publicCfg.default_api_key_set || cfg.default_api_key))}
      ${field('default_model', 'Model', 'text', 'gpt-4o-mini')}
      <div class="row2">
        ${field('default_temperature', 'Temperature', 'number', '0.7')}
        ${field('default_max_tokens', 'Max Tokens', 'number', '비우면 제한 없음')}
      </div>
    </div>

    ${agentSettings('worldbuilding', '세계관 에이전트', Boolean(findAgent(agents, 'worldbuilding')?.api_key_set || cfg.worldbuilding_api_key))}
    ${agentSettings('plot', '플롯 에이전트', Boolean(findAgent(agents, 'plot')?.api_key_set || cfg.plot_api_key))}
    ${agentSettings('character', '등장인물 에이전트', Boolean(findAgent(agents, 'character')?.api_key_set || cfg.character_api_key))}

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
      <label>
        <input id="bypass_translate" type="checkbox" ${checkedAttr(bypass.bypassTranslate)}>
        RisuAI 내장 번역 요청 우회
      </label>
      <div class="example-url">request mode가 translate인 LLM 번역 호출에서는 분석 사이드카를 호출하지 않습니다.</div>
      <label>
        <input id="bypass_lb_process" type="checkbox" ${checkedAttr(bypass.bypassLbProcess)}>
        &lt;lb-process&gt; LLM 요청 우회
      </label>
      <div class="example-url">&lt;lb-process&gt; 태그가 포함된 헬퍼 호출에서는 분석 사이드카를 호출하지 않습니다.</div>
    </div>
  </section>

  <section id="tab-help" class="panel">
    <div class="card">
      <h2>운영 메모</h2>
      <ul class="help-list">
        <li>이 플러그인은 RisuAI 메인 모델 호출 직전에 beforeRequest 훅으로 끼어들어, Full 서버에 분석 3개를 요청한 뒤 결과를 system 프롬프트에 주입합니다.</li>
        <li>최종 RP 응답은 RisuAI가 현재 선택한 메인 모델이 그대로 생성합니다. 별도의 검수 에이전트는 없습니다.</li>
        <li>Full판의 Sidecar URL은 분석 파이프라인을 호스팅하는 FastAPI 서버 주소입니다. 예시는 http://localhost:6009 입니다.</li>
        <li>LLM Endpoint Base URL은 분석 에이전트가 호출할 OpenAI-compatible API의 /v1 주소입니다.</li>
        <li>API Key 입력칸은 저장된 값을 다시 표시하지 않습니다. 빈칸으로 두면 기존 값이 유지됩니다.</li>
        <li>LLM 인증 테스트는 생성 호출 없이 provider별 인증/모델 조회 경로만 확인합니다. 실제 분석은 토큰을 사용합니다.</li>
        <li>분석 실패 시에도 채팅은 막히지 않습니다. 원본 프롬프트가 그대로 메인 모델에 전달됩니다.</li>
        <li>디버그 모드를 켜면 최근 분석 탭에서 각 에이전트 출력을 펼쳐 볼 수 있습니다.</li>
        <li>내장 LLM 번역과 &lt;lb-process&gt; 헬퍼 호출은 기본적으로 분석 파이프라인을 우회합니다.</li>
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

    function providerSelect(id, label, value, allowDefault) {
      const options = providerOptions();
      const normalized = normalizeProviderValue(value || '');
      const known = options.some(option => option.value === normalized);
      const selected = allowDefault && !value ? '' : (known ? normalized : 'custom');
      const customValue = selected === 'custom' && value && !known ? value : '';
      const defaultOption = allowDefault ? '<option value="">기본값 사용</option>' : '';
      return `
        <div class="field provider-field" data-provider="${id}">
          <label for="${id}_select">${label}</label>
          <select id="${id}_select" data-provider-select="${id}">
            ${defaultOption}
            ${options.map(option => `<option value="${option.value}" ${selected === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
          </select>
          <input id="${id}_custom" class="custom-provider" type="text" value="${escHtml(customValue)}" placeholder="custom provider id">
        </div>`;
    }

    function providerOptions() {
      return [
        { value: 'openai', label: 'OpenAI' },
        { value: 'claude', label: 'Claude' },
        { value: 'vertex-ai', label: 'Vertex AI' },
        { value: 'google', label: 'Google' },
        { value: 'custom', label: 'Custom' },
      ];
    }

    function providerDefaults(provider) {
      const normalized = normalizeProviderValue(provider);
      const defaults = {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
        },
        claude: {
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-3-5-sonnet-latest',
        },
        'vertex-ai': {
          baseUrl: 'https://LOCATION-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/LOCATION/endpoints/openapi',
          model: 'google/gemini-1.5-pro',
        },
        google: {
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-1.5-pro',
        },
      };
      return defaults[normalized] || null;
    }

    function knownProviderBaseUrls() {
      return Object.values({
        openai: providerDefaults('openai'),
        claude: providerDefaults('claude'),
        vertex: providerDefaults('vertex-ai'),
        google: providerDefaults('google'),
      }).map(item => item.baseUrl);
    }

    function normalizeProviderValue(value) {
      return String(value || '').trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
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
          provider: cfg[`${name}_provider`] || cfg.default_provider || 'openai',
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
            <h2>최근 분석 기록 없음</h2>
            <p>RisuAI에서 채팅을 보내면 beforeRequest 훅이 자동으로 호출되며 결과가 이곳에 표시됩니다.</p>
          </div>`;
      }

      const debug = lastRun.debug;
      return `
        <div class="grid">
          <div class="card">
            <h2>마지막 분석</h2>
            <div class="kv">
              <div class="k">결과</div><div class="v"><span class="badge ${lastRun.success ? 'ok' : 'err'}">${lastRun.success ? '성공' : '실패'}</span></div>
              <div class="k">완료 시각</div><div class="v">${escHtml(formatDateTime(lastRun.completed_at))}</div>
              <div class="k">소요 시간</div><div class="v">${escHtml(formatDuration(lastRun.duration_ms))}</div>
              <div class="k">서버</div><div class="v">${escHtml(lastRun.server_url || '-')}</div>
              <div class="k">HTTP</div><div class="v">${escHtml(lastRun.status_code || '-')}</div>
              <div class="k">모드</div><div class="v">${escHtml(lastRun.mode || '-')}</div>
            </div>
            ${lastRun.error ? `<div class="error-text" style="margin-top:10px">${escHtml(lastRun.error)}</div>` : ''}
          </div>
          <div class="card">
            <h2>요청 규모</h2>
            <div class="kv">
              <div class="k">현재 입력</div><div class="v">${escHtml(lastRun.input_chars ?? '-')}자</div>
              <div class="k">시스템</div><div class="v">${escHtml(lastRun.system_chars ?? '-')}자</div>
              <div class="k">히스토리</div><div class="v">${escHtml(lastRun.history_messages ?? '-')}개 메시지</div>
              <div class="k">세계관</div><div class="v">${escHtml(lastRun.world_chars ?? '-')}자</div>
              <div class="k">플롯</div><div class="v">${escHtml(lastRun.plot_chars ?? '-')}자</div>
              <div class="k">캐릭터</div><div class="v">${escHtml(lastRun.char_chars ?? '-')}자</div>
            </div>
          </div>
        </div>
        ${debug ? `
          <div class="card">
            <h2>디버그 컨텍스트</h2>
            ${debugBlock('세계관', debug.context_world)}
            ${debugBlock('플롯', debug.context_plot)}
            ${debugBlock('등장인물', debug.context_char)}
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

      setupProviderControls();
      setupCredentialFiles();
      setupEndpointExamples();

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
          const nextBypass = collectBypassSettings();
          const nextConfig = collectConfig(initialConfig);
          await Risuai.setArgument('server_url', currentServerUrl);
          await saveBypassSettings(nextBypass);
          await savePluginSettings(currentServerUrl, nextBypass);
          const res = await Risuai.nativeFetch(`${currentServerUrl}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nextConfig),
          });
          if (res.ok) {
            const savedConfig = await res.json().catch(() => nextConfig);
            await saveSidecarConfigBackup(currentServerUrl, savedConfig || nextConfig);
            showMsg('저장 완료', true);
          } else {
            showMsg(`저장 실패: HTTP ${res.status}`, false);
          }
        } catch (err) {
          showMsg(`저장 오류: ${err.message}`, false);
        }
      });

      document.getElementById('close-btn')?.addEventListener('click', async () => {
        await Risuai.hideContainer();
      });
    }

    function collectConfig(initialConfig) {
      const secret = key => getCredentialValue(key) || initialConfig[key] || '';
      return {
        default_provider:       getProviderValue('default_provider', 'openai'),
        default_base_url:       getInputValue('default_base_url'),
        default_api_key:        secret('default_api_key'),
        default_model:          getInputValue('default_model'),
        default_temperature:    requiredFloat('default_temperature', 0.7),
        default_max_tokens:     optionalInt('default_max_tokens'),
        worldbuilding_provider: getProviderValue('worldbuilding_provider', ''),
        worldbuilding_base_url: getInputValue('worldbuilding_base_url'),
        worldbuilding_api_key:  secret('worldbuilding_api_key'),
        worldbuilding_model:    getInputValue('worldbuilding_model'),
        worldbuilding_temperature: optionalFloat('worldbuilding_temperature'),
        worldbuilding_max_tokens:  optionalInt('worldbuilding_max_tokens'),
        plot_provider:          getProviderValue('plot_provider', ''),
        plot_base_url:          getInputValue('plot_base_url'),
        plot_api_key:           secret('plot_api_key'),
        plot_model:             getInputValue('plot_model'),
        plot_temperature:       optionalFloat('plot_temperature'),
        plot_max_tokens:        optionalInt('plot_max_tokens'),
        character_provider:     getProviderValue('character_provider', ''),
        character_base_url:     getInputValue('character_base_url'),
        character_api_key:      secret('character_api_key'),
        character_model:        getInputValue('character_model'),
        character_temperature:  optionalFloat('character_temperature'),
        character_max_tokens:   optionalInt('character_max_tokens'),
        context_window:         parseInt(getInputValue('context_window')) || 10,
        request_timeout:        parseFloat(getInputValue('request_timeout')) || 60,
        debug_mode:             document.getElementById('debug_mode')?.checked || false,
      };
    }

    function getInputValue(id) {
      return document.getElementById(id)?.value?.trim() || '';
    }

    function getProviderValue(id, fallback) {
      const selected = document.getElementById(`${id}_select`)?.value || '';
      if (selected === 'custom') return getInputValue(`${id}_custom`) || 'custom';
      return selected || fallback;
    }

    function getCredentialValue(id) {
      const providerId = id.replace(/_api_key$/, '_provider');
      if (getProviderValue(providerId, '') === 'vertex-ai') {
        return document.getElementById(`${id}_json`)?.value?.trim() || getInputValue(id);
      }
      return getInputValue(id);
    }

    function getCheckboxValue(id) {
      return Boolean(document.getElementById(id)?.checked);
    }

    function collectBypassSettings() {
      return {
        bypassTranslate: getCheckboxValue('bypass_translate'),
        bypassLbProcess: getCheckboxValue('bypass_lb_process'),
      };
    }

    async function saveBypassSettings(settings) {
      await Risuai.setArgument('bypass_translate', settings.bypassTranslate ? '1' : '0');
      await Risuai.setArgument('bypass_lb_process', settings.bypassLbProcess ? '1' : '0');
    }

    async function loadPluginSettings() {
      try {
        const raw = await Risuai.pluginStorage.getItem(PLUGIN_SETTINGS_KEY);
        const settings = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!settings || settings.version !== STORAGE_VERSION) return {};
        return settings;
      } catch (_) {
        return {};
      }
    }

    async function savePluginSettings(serverUrl, bypass) {
      await Risuai.pluginStorage.setItem(PLUGIN_SETTINGS_KEY, {
        version: STORAGE_VERSION,
        serverUrl: normalizeUrl(serverUrl || 'http://localhost:6009'),
        bypassTranslate: Boolean(bypass.bypassTranslate),
        bypassLbProcess: Boolean(bypass.bypassLbProcess),
        savedAt: new Date().toISOString(),
      });
    }

    async function getSidecarConfigBackupInfo() {
      const backup = await getSidecarConfigBackup();
      return {
        exists: Boolean(backup),
        savedAt: backup?.savedAt || '',
      };
    }

    async function loadSidecarConfigBackup(serverUrl) {
      const backup = await getSidecarConfigBackup();
      if (!backup) return null;
      if (serverUrl && backup.serverUrl && normalizeUrl(serverUrl) !== normalizeUrl(backup.serverUrl)) {
        return null;
      }
      return backup.config || null;
    }

    async function saveSidecarConfigBackup(serverUrl, config) {
      if (!config || typeof config !== 'object' || !Object.keys(config).length) return;
      const existing = await getSidecarConfigBackup();
      if (existing?.config && hasConfigSecret(existing.config) && !hasConfigSecret(config)) {
        return;
      }
      await Risuai.pluginStorage.setItem(SIDECAR_CONFIG_BACKUP_KEY, {
        version: STORAGE_VERSION,
        serverUrl: normalizeUrl(serverUrl || 'http://localhost:6009'),
        savedAt: new Date().toISOString(),
        config,
      });
    }

    async function getSidecarConfigBackup() {
      try {
        const raw = await Risuai.pluginStorage.getItem(SIDECAR_CONFIG_BACKUP_KEY);
        const backup = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!backup || backup.version !== STORAGE_VERSION) return null;
        return backup;
      } catch (_) {
        return null;
      }
    }

    function hasConfigSecret(config) {
      return Boolean(
        config?.default_api_key ||
        config?.worldbuilding_api_key ||
        config?.plot_api_key ||
        config?.character_api_key
      );
    }

    function setupProviderControls() {
      document.querySelectorAll('[data-provider-select]').forEach(select => {
        const update = () => {
          const id = select.dataset.providerSelect;
          const wrapper = document.querySelector(`[data-provider="${id}"]`);
          wrapper?.classList.toggle('provider-custom-active', select.value === 'custom');
          const credentialId = id.replace(/_provider$/, '_api_key');
          const credential = document.querySelector(`[data-credential="${credentialId}"]`);
          credential?.classList.toggle('credential-vertex-active', select.value === 'vertex-ai');
          applyProviderDefaults(id, select.value);
        };
        select.addEventListener('change', update);
        update();
      });
    }

    function applyProviderDefaults(providerId, provider) {
      if (!provider || provider === 'custom') return;
      const defaults = providerDefaults(provider);
      if (!defaults) return;

      const prefix = providerId.replace(/_provider$/, '');
      const baseId = prefix === 'default' ? 'default_base_url' : `${prefix}_base_url`;
      const modelId = prefix === 'default' ? 'default_model' : `${prefix}_model`;
      const baseInput = document.getElementById(baseId);
      const modelInput = document.getElementById(modelId);

      if (baseInput && shouldReplaceEndpoint(baseInput.value)) {
        baseInput.value = defaults.baseUrl;
        updateEndpointExample(baseId);
      }
      if (modelInput && shouldReplaceModel(modelInput.value)) {
        modelInput.value = defaults.model;
      }
    }

    function shouldReplaceEndpoint(value) {
      if (!String(value || '').trim()) return true;
      const normalized = normalizeUrl(value || '');
      return knownProviderBaseUrls().map(normalizeUrl).includes(normalized);
    }

    function shouldReplaceModel(value) {
      const normalized = String(value || '').trim();
      if (!normalized) return true;
      return ['gpt-4o-mini', 'claude-3-5-sonnet-latest', 'google/gemini-1.5-pro', 'gemini-1.5-pro'].includes(normalized);
    }

    function setupEndpointExamples() {
      document.querySelectorAll('[data-example-for]').forEach(example => {
        const baseId = example.dataset.exampleFor;
        const input = document.getElementById(baseId);
        input?.addEventListener('input', () => updateEndpointExample(baseId));
        updateEndpointExample(baseId);
      });
    }

    function updateEndpointExample(baseId) {
      const example = document.querySelector(`[data-example-for="${baseId}"]`);
      const input = document.getElementById(baseId);
      if (!example || !input) return;
      example.textContent = `예시 URL: ${exampleChatUrl(input.value || 'https://api.openai.com/v1')}`;
    }

    function setupCredentialFiles() {
      document.querySelectorAll('input[type="file"][id$="_file"]').forEach(input => {
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          const text = await file.text();
          const targetId = input.id.replace(/_file$/, '_json');
          const target = document.getElementById(targetId);
          if (target) target.value = text;
          showMsg('Vertex AI JSON credential을 불러왔습니다.', true);
        });
      });
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

    function parseEnabled(value, fallback) {
      const normalized = String(value ?? '').trim().toLowerCase();
      if (!normalized) return fallback;
      return !['0', 'false', 'off', 'no', 'disabled'].includes(normalized);
    }

    function checkedAttr(value) {
      return value ? 'checked' : '';
    }

    function containsLbProcess(value) {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string') return /<\/?\s*lb-process\b/i.test(value);
      if (Array.isArray(value)) return value.some(containsLbProcess);
      if (typeof value === 'object') return Object.values(value).some(containsLbProcess);
      return /<\/?\s*lb-process\b/i.test(String(value));
    }

    function getBypassReason(messages, type, settings) {
      const requestType = String(type || '').trim().toLowerCase();
      if (settings.bypassTranslate && requestType === 'translate') {
        return 'RisuAI translation request';
      }
      if (settings.bypassLbProcess && Array.isArray(messages) && messages.some(msg => containsLbProcess(msg?.content))) {
        return '<lb-process> helper request';
      }
      return '';
    }

    function normalizeUrl(url) {
      return String(url || 'http://localhost:6009').replace(/\/$/, '');
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
        const res = await Risuai.nativeFetch(`${currentServerUrl}/health`, { method: 'GET' });
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
        const res = await Risuai.nativeFetch(`${currentServerUrl}/test/llm`, { method: 'GET' });
        if (!res.ok) {
          showMsg(`LLM 인증 테스트 호출 실패: HTTP ${res.status}`, false);
          setTestResults(`
            <div class="card">
              <h2>LLM 인증 테스트</h2>
              <div class="error-text">HTTP ${escHtml(res.status)}</div>
            </div>`);
          return false;
        }

        const data = await res.json();
        showMsg(data.success ? 'LLM 인증 테스트 성공' : 'LLM 인증 테스트 실패', data.success);
        setTestResults(renderLlmTestResults(data));
        return data.success;
      } catch (err) {
        showMsg(`LLM 인증 테스트 실패: ${err.message}`, false);
        setTestResults(`
          <div class="card">
            <h2>LLM 인증 테스트</h2>
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
          <h2>LLM 인증 테스트</h2>
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

    console.log('MultiAgent RP Full판 플러그인 v2.0.1 (beforeRequest 훅) 로드됨');

  } catch (err) {
    console.log(`MultiAgent Full판 init error: ${err.message}`);
  }
})();
