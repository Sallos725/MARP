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

    // ── Custom AI Provider 등록 ───────────────────────────────────────────────

    await Risuai.addProvider('MultiAgent-Full', async (args, abortSignal) => {
      const serverUrl = await getServerUrl();
      const messages  = args.prompt_chat || [];

      // OpenAI messages → /generate 요청 형식 변환
      const systemMsg    = messages.find(m => m.role === 'system');
      const nonSystem    = messages.filter(m => m.role !== 'system');
      const userMsgs     = nonSystem.filter(m => m.role === 'user');
      const userInput    = userMsgs.length ? userMsgs[userMsgs.length - 1].content : '';
      // 마지막 유저 메시지를 제외한 나머지를 히스토리로
      const chatHistory  = nonSystem.slice(0, -1).map(m => ({ role: m.role, content: m.content }));

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
          return { success: false, content: `서버 오류 ${res.status}: ${errText.slice(0, 200)}` };
        }

        const data = await res.json();
        return { success: true, content: data.response };

      } catch (err) {
        if (err.name === 'AbortError') return { success: false, content: '요청이 취소되었습니다.' };
        return { success: false, content: `연결 실패: ${err.message}` };
      }
    });

    // ── 설정 GUI ──────────────────────────────────────────────────────────────

    Risuai.registerSetting('MultiAgent Full판 설정', async () => {
      const serverUrl = await getServerUrl();

      // 현재 설정 로드
      let config = {};
      let connected = false;
      try {
        const res = await Risuai.nativeFetch(`${serverUrl}/config`);
        if (res.ok) { config = await res.json(); connected = true; }
      } catch (_) {}

      document.body.innerHTML = buildUI(config, serverUrl, connected);
      setupHandlers(serverUrl);
      await Risuai.showContainer('fullscreen');
    }, '⚙', 'html');

    // ── UI 빌더 ───────────────────────────────────────────────────────────────

    function buildUI(cfg, serverUrl, connected) {
      const v = (key, fallback = '') => {
        const val = cfg[key];
        return (val !== undefined && val !== null) ? String(val) : fallback;
      };

      const field = (id, label, type = 'text', placeholder = '') => `
        <div class="field">
          <label for="${id}">${label}</label>
          <input id="${id}" type="${type}" value="${escHtml(v(id))}" placeholder="${escHtml(placeholder)}">
        </div>`;

      const agentSection = (name, label) => `
        <details>
          <summary>${label} <span class="hint">(비워두면 기본값 사용)</span></summary>
          <div class="details-body">
            ${field(`${name}_base_url`, 'Base URL', 'text', '기본값 사용')}
            ${field(`${name}_api_key`,  'API Key',  'password', '기본값 사용')}
            ${field(`${name}_model`,    'Model',    'text',     '기본값 사용')}
          </div>
        </details>`;

      return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#12121e;color:#dde;min-height:100vh}
.wrap{max-width:680px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.3rem;margin-bottom:2px}
.subtitle{color:#667;font-size:.8rem;margin-bottom:18px}
.status{display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:8px;background:#1c1c30;margin-bottom:18px;font-size:.82rem}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot.ok{background:#4ade80}.dot.err{background:#f87171}
.card{background:#1a1a2e;border-radius:10px;padding:16px;margin-bottom:12px}
.card h2{font-size:.88rem;font-weight:700;color:#8899bb;margin-bottom:12px;text-transform:uppercase;letter-spacing:.04em}
details{background:#1a1a2e;border-radius:10px;margin-bottom:8px}
summary{cursor:pointer;padding:14px 16px;font-size:.88rem;font-weight:600;color:#8899bb;list-style:none;display:flex;align-items:center;gap:6px}
summary::before{content:'▶';font-size:.65rem;transition:transform .15s}
details[open]>summary::before{transform:rotate(90deg)}
.details-body{padding:0 16px 14px}
.field{margin-bottom:10px}
label{display:block;font-size:.75rem;color:#667;margin-bottom:3px}
input{width:100%;padding:8px 10px;border-radius:6px;border:1px solid #2a3050;background:#0e0e1c;color:#dde;font-size:.85rem}
input:focus{outline:none;border-color:#4a6fa5}
.hint{font-size:.72rem;color:#445;font-weight:400}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sep{height:1px;background:#1e1e32;margin:10px 0}
.actions{display:flex;gap:10px;margin-top:20px;position:sticky;bottom:0;background:#12121e;padding:12px 0}
button{padding:10px 18px;border-radius:8px;border:none;cursor:pointer;font-size:.88rem;font-weight:600;transition:opacity .15s}
button:hover{opacity:.85}
#save-btn{background:#4a6fa5;color:#fff;flex:1}
#test-btn{background:#1e2a3e;color:#8ab}
#close-btn{background:#1e1e2e;color:#778}
#msg{font-size:.8rem;padding:8px 12px;border-radius:6px;display:none;margin-bottom:8px}
#msg.ok{background:#0d2a1a;color:#4ade80;display:block}
#msg.err{background:#2a0d0d;color:#f87171;display:block}
</style></head><body>
<div class="wrap">
  <h1>MultiAgent RP — Full판 설정</h1>
  <p class="subtitle">변경사항은 즉시 서버에 저장됩니다.</p>

  <div class="status">
    <span class="dot ${connected ? 'ok' : 'err'}"></span>
    <span id="status-text">${connected ? `연결됨 — ${escHtml(serverUrl)}` : `연결 실패 — ${escHtml(serverUrl)}`}</span>
  </div>

  <div id="msg"></div>

  <!-- 기본 설정 -->
  <div class="card">
    <h2>기본 설정 (DEFAULT)</h2>
    <p class="hint" style="margin-bottom:12px">에이전트별 설정이 비어있을 때 사용됩니다.</p>
    ${field('default_base_url', 'Base URL', 'text', 'https://api.openai.com/v1')}
    ${field('default_api_key',  'API Key',  'password', 'sk-...')}
    ${field('default_model',    'Model',    'text', 'gpt-4o-mini')}
  </div>

  <!-- 에이전트별 설정 -->
  ${agentSection('worldbuilding', '세계관 에이전트')}
  ${agentSection('plot',          '플롯 에이전트')}
  ${agentSection('character',     '등장인물 에이전트')}
  ${agentSection('reviewer',      '검수 에이전트')}

  <!-- 파이프라인 설정 -->
  <div class="card">
    <h2>파이프라인 설정</h2>
    <div class="row2">
      <div class="field">
        <label for="context_window">컨텍스트 윈도우 (메시지 수)</label>
        <input id="context_window" type="number" min="1" max="50" value="${escHtml(v('context_window', '10'))}">
      </div>
      <div class="field">
        <label for="request_timeout">타임아웃 (초)</label>
        <input id="request_timeout" type="number" min="10" max="300" value="${escHtml(v('request_timeout', '60'))}">
      </div>
    </div>
    <div class="field" style="margin-top:4px">
      <label>
        <input id="debug_mode" type="checkbox" style="width:auto;margin-right:6px" ${cfg.debug_mode ? 'checked' : ''}>
        디버그 모드 (응답에 에이전트 컨텍스트 포함)
      </label>
    </div>
  </div>

  <div class="actions">
    <button id="test-btn">연결 테스트</button>
    <button id="save-btn">저장</button>
    <button id="close-btn">닫기</button>
  </div>
</div>
<script>
  const serverUrl = ${JSON.stringify(serverUrl)};

  function showMsg(text, isOk) {
    const el = document.getElementById('msg');
    el.textContent = text;
    el.className = isOk ? 'ok' : 'err';
    setTimeout(() => el.className = '', 4000);
  }

  function collectConfig() {
    const get = id => document.getElementById(id)?.value?.trim() || '';
    return {
      default_base_url:       get('default_base_url'),
      default_api_key:        get('default_api_key'),
      default_model:          get('default_model'),
      worldbuilding_base_url: get('worldbuilding_base_url'),
      worldbuilding_api_key:  get('worldbuilding_api_key'),
      worldbuilding_model:    get('worldbuilding_model'),
      plot_base_url:          get('plot_base_url'),
      plot_api_key:           get('plot_api_key'),
      plot_model:             get('plot_model'),
      character_base_url:     get('character_base_url'),
      character_api_key:      get('character_api_key'),
      character_model:        get('character_model'),
      reviewer_base_url:      get('reviewer_base_url'),
      reviewer_api_key:       get('reviewer_api_key'),
      reviewer_model:         get('reviewer_model'),
      context_window:         parseInt(get('context_window')) || 10,
      request_timeout:        parseFloat(get('request_timeout')) || 60,
      debug_mode:             document.getElementById('debug_mode')?.checked || false,
    };
  }

  document.getElementById('test-btn').addEventListener('click', async () => {
    try {
      const res = await fetch(serverUrl + '/health');
      if (res.ok) showMsg('✓ 서버 연결 성공', true);
      else showMsg('✗ 서버 응답 오류: ' + res.status, false);
    } catch (e) {
      showMsg('✗ 연결 실패: ' + e.message, false);
    }
  });

  document.getElementById('save-btn').addEventListener('click', async () => {
    try {
      const res = await fetch(serverUrl + '/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectConfig()),
      });
      if (res.ok) showMsg('✓ 저장 완료', true);
      else showMsg('✗ 저장 실패: ' + res.status, false);
    } catch (e) {
      showMsg('✗ 오류: ' + e.message, false);
    }
  });

  document.getElementById('close-btn').addEventListener('click', () => {
    window.parent?.postMessage({ type: 'hideContainer' }, '*');
  });
</script>
</body></html>`;
    }

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function setupHandlers(_serverUrl) {
      // 핸들러는 buildUI 내부 <script> 태그로 처리 (iframe 표준 DOM 사용)
    }

    console.log('MultiAgent RP Full판 플러그인 v1.0.0 로드됨');

  } catch (err) {
    console.log(`MultiAgent Full판 init error: ${err.message}`);
  }
})();
