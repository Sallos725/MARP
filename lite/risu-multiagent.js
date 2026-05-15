//@name risu_multiagent
//@display-name MultiAgent RP Pipeline
//@api 3.0
//@version 1.0.0
//@arg agent_provider string Analysis agent provider label. e.g. openai
//@arg agent_base_url string Analysis agent API base URL. e.g. https://api.openai.com/v1, https://api.anthropic.com/v1, or Vertex AI OpenAI-compatible endpoint
//@arg agent_api_key string Analysis agent API key
//@arg agent_model string Analysis agent model. e.g. gpt-4o-mini
//@arg agent_temperature string Analysis agent temperature (default: 0.7)
//@arg agent_max_tokens string Analysis agent max tokens (blank = provider default)
//@arg context_window int Recent messages per agent (default: 10)

/**
 * MultiAgent RP Pipeline — RisuAI Plugin (Browser, API v3.0)
 *
 * 파이프라인:
 *   beforeRequest 훅
 *     → [세계관 에이전트]  nativeFetch → context_world
 *     → [플롯 에이전트]    nativeFetch → context_plot
 *     → [캐릭터 에이전트]  nativeFetch → context_char
 *     → system 프롬프트에 3개 컨텍스트 주입
 *   메인 LLM (유저 설정 모델) — 검수 에이전트 역할, 최종 응답 생성
 */

(async () => {
  try {
    let vertexTokenCache = null;

    // ── 설정 로드 ─────────────────────────────────────────────────────────────

    async function getConfig() {
      const provider = (await Risuai.getArgument('agent_provider')) || 'openai';
      const baseUrl = normalizeUrl((await Risuai.getArgument('agent_base_url')) || 'https://api.openai.com/v1');
      const apiKey  = (await Risuai.getArgument('agent_api_key'))  || '';
      const model   = (await Risuai.getArgument('agent_model'))    || 'gpt-4o-mini';
      const temperature = parseFloat((await Risuai.getArgument('agent_temperature')) || '0.7');
      const maxTokens = parseOptionalInt(await Risuai.getArgument('agent_max_tokens'));
      const window  = Math.max(1, parseInt((await Risuai.getArgument('context_window')) || '10') || 10);
      return {
        provider,
        baseUrl,
        apiKey,
        model,
        temperature: Number.isFinite(temperature) ? temperature : 0.7,
        maxTokens,
        window,
      };
    }

    // ── LLM 호출 헬퍼 ─────────────────────────────────────────────────────────

    async function callAgent(conf, messages) {
      if (isAnthropicProvider(conf.provider)) {
        return callAnthropicAgent(conf, messages);
      }
      if (isVertexProvider(conf.provider)) {
        return callVertexAgent(conf, messages);
      }
      return callOpenAICompatibleAgent(conf, messages);
    }

    async function callOpenAICompatibleAgent(conf, messages) {
      const payload = {
        model: conf.model,
        messages,
        temperature: conf.temperature,
      };
      if (conf.maxTokens !== null) payload.max_tokens = conf.maxTokens;

      const res = await Risuai.nativeFetch(`${conf.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${conf.apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Agent API ${res.status}: ${errText.slice(0, 120)}`);
      }

      const data = await res.json();
      return data.choices[0].message.content;
    }

    async function callAnthropicAgent(conf, messages) {
      const { system, anthropicMessages } = toAnthropicMessages(messages);
      const payload = {
        model: conf.model,
        messages: anthropicMessages,
        temperature: conf.temperature,
        max_tokens: conf.maxTokens || 1024,
      };
      if (system) payload.system = system;

      const res = await Risuai.nativeFetch(`${conf.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': conf.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 120)}`);
      }

      const data = await res.json();
      return extractAnthropicText(data);
    }

    async function callVertexAgent(conf, messages) {
      const accessToken = await getVertexAccessToken(conf.apiKey);
      const payload = {
        model: conf.model,
        messages,
        temperature: conf.temperature,
      };
      if (conf.maxTokens !== null) payload.max_tokens = conf.maxTokens;

      const res = await Risuai.nativeFetch(`${conf.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Vertex AI API ${res.status}: ${errText.slice(0, 120)}`);
      }

      const data = await res.json();
      return data.choices[0].message.content;
    }

    function toAnthropicMessages(messages) {
      const systemParts = [];
      const anthropicMessages = [];
      for (const msg of messages) {
        if (msg.role === 'system') {
          if (msg.content) systemParts.push(String(msg.content));
        } else if (msg.role === 'user' || msg.role === 'assistant') {
          anthropicMessages.push({ role: msg.role, content: String(msg.content || '') });
        }
      }
      if (!anthropicMessages.length) throw new Error('Anthropic 호출에는 user 또는 assistant 메시지가 필요합니다.');
      return {
        system: systemParts.join('\n\n'),
        anthropicMessages,
      };
    }

    function extractAnthropicText(data) {
      const parts = (data.content || [])
        .filter(block => block && block.type === 'text')
        .map(block => block.text || '')
        .filter(Boolean);
      if (!parts.length) throw new Error('Anthropic 응답에서 text content를 찾을 수 없습니다.');
      return parts.join('\n').trim();
    }

    // ── 메시지 유틸 ───────────────────────────────────────────────────────────

    function getSystemContent(messages) {
      const sys = messages.find(m => m.role === 'system');
      return sys ? sys.content : '';
    }

    function getUserInput(messages) {
      const userMsgs = messages.filter(m => m.role === 'user');
      return userMsgs.length ? userMsgs[userMsgs.length - 1].content : '';
    }

    function formatHistory(messages, windowSize) {
      // 마지막 유저 메시지를 제외한 최근 N개
      const chatMsgs = messages.filter(m => m.role === 'user' || m.role === 'assistant');
      const recent = chatMsgs.slice(-(windowSize + 1), -1);
      if (!recent.length) return '(No chat history)';
      return recent.map(m => `[${m.role === 'user' ? 'User' : 'AI'}]: ${m.content}`).join('\n');
    }

    function findLastIndex(arr, predicate) {
      for (let i = arr.length - 1; i >= 0; i -= 1) {
        if (predicate(arr[i])) return i;
      }
      return -1;
    }

    // ── 에이전트 프롬프트 빌더 ────────────────────────────────────────────────

    function buildWorldPrompt(systemContent, history, userInput) {
      return [
        {
          role: 'system',
          content:
            'You are the worldbuilding consistency agent.\n' +
            'Based on the given setting and chat history, write concise bullet-point notes ' +
            'on worldbuilding concerns and useful reinforcement for the current scene.\n\n' +
            'Include:\n' +
            '- Current scene/background information\n' +
            '- Active world rules (for example: no magic, special conditions, taboos)\n' +
            '- Established details that must be preserved\n' +
            '- Additional worldbuilding reinforcement\n\n' +
            'Do not write the final RP response.',
        },
        {
          role: 'user',
          content:
            `[Setting]\n${systemContent}\n\n` +
            `[Recent Conversation]\n${history}\n\n` +
            `[Current User Input]\n${userInput}\n\n` +
            'Write the worldbuilding consistency notes.',
        },
      ];
    }

    function buildPlotPrompt(contextWorld, history, userInput) {
      return [
        {
          role: 'system',
          content:
            'You are the plot management agent.\n' +
            'Based on the worldbuilding notes and chat history, analyze the current ' +
            'narrative flow and present concise bullet-point notes on the plot direction for this scene.\n\n' +
            'Include:\n' +
            '- Current arc/story progress\n' +
            '- Purpose of this scene\n' +
            '- Recommended direction for the next development\n' +
            '- Foreshadowing or unrevealed information that must be preserved\n\n' +
            'Do not write the final RP response.',
        },
        {
          role: 'user',
          content:
            `[Worldbuilding Agent Notes]\n${contextWorld}\n\n` +
            `[Recent Conversation]\n${history}\n\n` +
            `[Current User Input]\n${userInput}\n\n` +
            'Write the plot direction notes.',
        },
      ];
    }

    function buildCharPrompt(systemContent, contextWorld, contextPlot, history, userInput) {
      return [
        {
          role: 'system',
          content:
            'You are the character consistency agent.\n' +
            'Based on the setting and previous agent notes, summarize the personalities and ' +
            'speech patterns of the characters involved in this scene as concise bullet-point notes.\n\n' +
            'Include:\n' +
            '- Key character personality and speech traits\n' +
            '- Current character emotional or psychological state\n' +
            '- OOC (Out of Character) cautions\n' +
            '- Characters likely to appear or be referenced\n\n' +
            'Do not write the final RP response.',
        },
        {
          role: 'user',
          content:
            `[Setting]\n${systemContent}\n\n` +
            `[Worldbuilding Agent Notes]\n${contextWorld}\n\n` +
            `[Plot Agent Notes]\n${contextPlot}\n\n` +
            `[Recent Conversation]\n${history}\n\n` +
            `[Current User Input]\n${userInput}\n\n` +
            'Write the character adjustment notes.',
        },
      ];
    }

    // ── 컨텍스트 주입 ─────────────────────────────────────────────────────────

    function injectContext(messages, contextWorld, contextPlot, contextChar) {
      const injection = [
        '',
        '---',
        '[MultiAgent RP Analysis Context]',
        '',
        '[Worldbuilding Agent]',
        contextWorld,
        '',
        '[Plot Agent]',
        contextPlot,
        '',
        '[Character Agent]',
        contextChar,
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

    async function openLiteDashboard() {
      const conf = await getConfig();
      document.body.innerHTML = buildLiteUI(conf);
      setupLiteHandlers(conf);
      await Risuai.showContainer('fullscreen');
    }

    const menuIcon = '🔱';

    Risuai.registerSetting('MultiAgent Lite판 상태', openLiteDashboard, menuIcon, 'html');
    await Risuai.registerButton({
      name: 'MultiAgent Lite',
      icon: menuIcon,
      iconType: 'html',
      location: 'hamburger',
    }, openLiteDashboard);

    function buildLiteUI(conf) {
      return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#101114;color:#eceff4;min-height:100vh;line-height:1.45}
.wrap{max-width:920px;margin:0 auto;padding:22px 16px 84px}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}
h1{font-size:1.34rem;font-weight:720;letter-spacing:0;margin-bottom:4px}
.subtitle{color:#98a2b3;font-size:.84rem}
.header-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.status-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}
.metric{background:#191b20;border:1px solid #292d35;border-radius:8px;padding:12px;min-height:72px}
.metric-label{font-size:.72rem;color:#8d96a5;margin-bottom:5px}
.metric-value{font-size:.92rem;font-weight:680;overflow-wrap:anywhere}
.metric-sub{font-size:.74rem;color:#a8b0bd;margin-top:2px;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.card{background:#191b20;border:1px solid #292d35;border-radius:8px;padding:14px;margin-bottom:12px}
.card h2{font-size:.91rem;margin-bottom:10px;color:#f2f4f7}
.card p{font-size:.82rem;color:#a8b0bd}
.kv{display:grid;grid-template-columns:110px minmax(0,1fr);gap:6px 8px;font-size:.8rem}
.k{color:#8792a2}.v{color:#dde3ec;overflow-wrap:anywhere}
.field{margin-bottom:10px}
label{display:block;font-size:.75rem;color:#9aa4b2;margin-bottom:4px}
input,select,textarea{width:100%;padding:9px 10px;border-radius:6px;border:1px solid #343944;background:#0f1115;color:#eef2f7;font-size:.86rem}
textarea{min-height:92px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:none;border-color:#5585d9}
.custom-provider,.vertex-credential{display:none;margin-top:8px}
.credential-json{display:none}
.provider-custom-active .custom-provider{display:block}
.credential-vertex-active .api-key-credential{display:none}
.credential-vertex-active .vertex-credential{display:block}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.example-url{font-size:.73rem;color:#8d96a5;background:#111318;border:1px solid #272c34;border-radius:6px;padding:7px 9px;margin:-3px 0 10px;overflow-wrap:anywhere}
.msg{font-size:.82rem;padding:10px 12px;border-radius:8px;margin-bottom:12px;display:none}
.msg.ok{display:block;background:#10291e;color:#7ee2a8;border:1px solid #1d6b45}
.msg.err{display:block;background:#341515;color:#ff9b9b;border:1px solid #793333}
.badge{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:.72rem;font-weight:680}
.badge.ok{background:#123323;color:#6ee7a8}.badge.err{background:#3a1717;color:#ff8a8a}.badge.neutral{background:#27313c;color:#a8c7e6}
.error-text{color:#ff9b9b;overflow-wrap:anywhere}
.help-list{display:grid;gap:9px;font-size:.84rem;color:#c7ced9}.help-list li{margin-left:18px}
.actions{position:fixed;left:0;right:0;bottom:0;background:rgba(16,17,20,.96);border-top:1px solid #2a2e36;padding:10px 16px}
.actions-inner{max-width:920px;margin:0 auto;display:flex;gap:8px;justify-content:flex-end}
button{padding:9px 14px;border-radius:7px;border:1px solid #343944;background:#20242b;color:#eef2f7;cursor:pointer;font-size:.86rem;font-weight:650}
button:hover{background:#2a3039}button.primary{background:#2f6fed;border-color:#2f6fed;color:#fff}button.primary:hover{background:#275fce}button.ghost{background:#15171b;color:#a8b0bd}
@media (max-width: 760px){.top{display:block}.header-actions{justify-content:flex-start;margin-top:12px}.status-strip,.grid,.row2{grid-template-columns:1fr}}
</style></head><body>
<div class="wrap">
  <div class="top">
    <div>
      <h1>MultiAgent RP Lite판</h1>
      <p class="subtitle">RisuAI 내부에서 보조 분석 에이전트를 실행합니다. 별도 사이드카 서버는 없습니다.</p>
    </div>
    <div class="header-actions">
      <button id="llm-test-btn">LLM 인증 테스트</button>
      <button id="all-test-btn" class="primary">전체 테스트</button>
    </div>
  </div>

  <div class="status-strip">
    <div class="metric">
      <div class="metric-label">사이드카</div>
      <div class="metric-value">없음</div>
      <div class="metric-sub">Lite판은 RisuAI 플러그인 내부 실행</div>
    </div>
    <div class="metric">
      <div class="metric-label">Provider</div>
      <div class="metric-value">${escHtml(conf.provider)}</div>
      <div class="metric-sub">${escHtml(conf.model)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Endpoint</div>
      <div class="metric-value">${escHtml(formatEndpoint(conf.baseUrl))}</div>
      <div class="metric-sub">${escHtml(exampleApiUrl(conf))}</div>
    </div>
    <div class="metric">
      <div class="metric-label">API Key</div>
      <div class="metric-value">${conf.apiKey ? '설정됨' : '없음'}</div>
      <div class="metric-sub">GUI에는 원문을 표시하지 않음</div>
    </div>
  </div>

  <div id="msg" class="msg"></div>
  <div id="test-results"></div>

  <div class="grid">
    <div class="card">
      <h2>현재 LLM 설정</h2>
      <div class="kv">
        <div class="k">Provider</div><div class="v">${escHtml(conf.provider)}</div>
        <div class="k">Endpoint</div><div class="v">${escHtml(conf.baseUrl)}</div>
        <div class="k">예시 URL</div><div class="v">${escHtml(exampleApiUrl(conf))}</div>
        <div class="k">API Key</div><div class="v">${conf.apiKey ? '설정됨' : '없음'}</div>
        <div class="k">Model</div><div class="v">${escHtml(conf.model)}</div>
        <div class="k">Temperature</div><div class="v">${escHtml(conf.temperature)}</div>
        <div class="k">Max Tokens</div><div class="v">${escHtml(conf.maxTokens ?? '제한 없음')}</div>
        <div class="k">Context</div><div class="v">${escHtml(conf.window)}개 메시지</div>
      </div>
    </div>

    <div class="card">
      <h2>동작 구조</h2>
      <div class="kv">
        <div class="k">세계관</div><div class="v">보조 LLM 호출</div>
        <div class="k">플롯</div><div class="v">보조 LLM 호출</div>
        <div class="k">등장인물</div><div class="v">보조 LLM 호출</div>
        <div class="k">검수</div><div class="v">RisuAI 현재 메인 모델</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>설정</h2>
    <div class="field">
      <label for="agent_provider_select">Provider</label>
      ${providerSelect('agent_provider', conf.provider)}
    </div>
    <div class="field">
      <label for="agent_base_url">Endpoint Base URL</label>
      <input id="agent_base_url" type="text" value="${escHtml(conf.baseUrl)}" placeholder="https://api.openai.com/v1">
    </div>
    <div class="example-url" data-example-for="agent_base_url">예시 URL: ${escHtml(exampleApiUrl(conf))}</div>
    ${credentialField('agent_api_key', conf.apiKey)}
    <div class="field">
      <label for="agent_model">Model</label>
      <input id="agent_model" type="text" value="${escHtml(conf.model)}" placeholder="gpt-4o-mini">
    </div>
    <div class="row2">
      <div class="field">
        <label for="agent_temperature">Temperature</label>
        <input id="agent_temperature" type="number" value="${escHtml(conf.temperature)}" placeholder="0.7">
      </div>
      <div class="field">
        <label for="agent_max_tokens">Max Tokens</label>
        <input id="agent_max_tokens" type="number" value="${escHtml(conf.maxTokens ?? '')}" placeholder="비우면 provider 기본값">
      </div>
    </div>
    <div class="field">
      <label for="context_window">Context Window</label>
      <input id="context_window" type="number" min="1" max="50" value="${escHtml(conf.window)}">
    </div>
  </div>

  <div class="card">
    <h2>도움말</h2>
    <ul class="help-list">
      <li>Lite판은 별도 FastAPI 사이드카 없이 RisuAI 플러그인 안에서 보조 에이전트 3개를 호출합니다.</li>
      <li>Endpoint Base URL은 provider별 API base 주소입니다. OpenAI-compatible은 /v1, Anthropic은 https://api.anthropic.com/v1 형식을 사용합니다.</li>
      <li>API Key 입력칸은 저장된 값을 다시 표시하지 않습니다. 빈칸으로 저장하면 기존 값을 유지합니다.</li>
      <li>Vertex AI를 선택하면 API Key 대신 서비스 계정 JSON 파일을 불러오고, Lite판 내부에서 OAuth access token을 발급해 호출합니다.</li>
      <li>LLM 인증 테스트는 생성 호출 없이 provider별 인증/모델 조회 경로만 확인합니다. 실제 분석은 토큰을 사용합니다.</li>
    </ul>
  </div>
</div>

<div class="actions">
  <div class="actions-inner">
    <button id="close-btn" class="ghost">닫기</button>
    <button id="save-btn" class="primary">저장</button>
  </div>
</div>
</body></html>`;
    }

    function setupLiteHandlers(initialConf) {
      setupProviderControls();
      setupCredentialFiles();
      setupEndpointExamples();
      document.getElementById('llm-test-btn')?.addEventListener('click', testLiteLlm);
      document.getElementById('all-test-btn')?.addEventListener('click', testLiteLlm);
      document.getElementById('save-btn')?.addEventListener('click', async () => {
        try {
          const next = collectLiteConfig(initialConf);
          await saveLiteConfig(next);
          showMsg('저장 완료', true);
        } catch (err) {
          showMsg(`저장 오류: ${err.message}`, false);
        }
      });
      document.getElementById('close-btn')?.addEventListener('click', async () => {
        await Risuai.hideContainer();
      });
    }

    function collectLiteConfig(initialConf) {
      return {
        provider: getProviderValue('agent_provider', 'openai'),
        baseUrl: normalizeUrl(getInputValue('agent_base_url') || 'https://api.openai.com/v1'),
        apiKey: getCredentialValue('agent_api_key') || initialConf.apiKey || '',
        model: getInputValue('agent_model') || 'gpt-4o-mini',
        temperature: requiredFloat('agent_temperature', 0.7),
        maxTokens: parseOptionalInt(getInputValue('agent_max_tokens')),
        window: Math.max(1, parseInt(getInputValue('context_window')) || 10),
      };
    }

    async function saveLiteConfig(conf) {
      await Risuai.setArgument('agent_provider', conf.provider);
      await Risuai.setArgument('agent_base_url', conf.baseUrl);
      await Risuai.setArgument('agent_api_key', conf.apiKey);
      await Risuai.setArgument('agent_model', conf.model);
      await Risuai.setArgument('agent_temperature', String(conf.temperature));
      await Risuai.setArgument('agent_max_tokens', conf.maxTokens === null ? '' : String(conf.maxTokens));
      await Risuai.setArgument('context_window', String(conf.window));
    }

    async function testLiteLlm() {
      const conf = {
        provider: getProviderValue('agent_provider', 'openai'),
        baseUrl: normalizeUrl(getInputValue('agent_base_url') || 'https://api.openai.com/v1'),
        apiKey: getCredentialValue('agent_api_key') || (await Risuai.getArgument('agent_api_key')) || '',
        model: getInputValue('agent_model') || 'gpt-4o-mini',
      };

      if (!conf.apiKey) {
        showMsg('Credential이 설정되지 않았습니다.', false);
        setTestResults(testResultHtml(conf, false, null, null, 'Credential이 설정되지 않았습니다.'));
        return;
      }

      const started = Date.now();
      try {
        const result = await testProviderEndpoint(conf);
        const latency = Date.now() - started;
        showMsg('LLM 인증 테스트 성공', true);
        setTestResults(testResultHtml(conf, true, result.status, latency, '', result.url));
      } catch (err) {
        showMsg(`LLM 인증 테스트 실패: ${err.message}`, false);
        setTestResults(testResultHtml(conf, false, null, Date.now() - started, err.message, testEndpointUrl(conf)));
      }
    }

    async function testProviderEndpoint(conf) {
      if (isAnthropicProvider(conf.provider)) {
        const url = `${conf.baseUrl}/models/${conf.model}`;
        const res = await Risuai.nativeFetch(url, {
          method: 'GET',
          headers: {
            'x-api-key': conf.apiKey,
            'anthropic-version': '2023-06-01',
          },
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
        }
        return { status: res.status, url };
      }

      if (isVertexProvider(conf.provider)) {
        await getVertexAccessToken(conf.apiKey);
        return { status: 200, url: 'https://oauth2.googleapis.com/token' };
      }

      const url = `${conf.baseUrl}/models`;
      const res = await Risuai.nativeFetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${conf.apiKey}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
      }
      return { status: res.status, url };
    }

    function testEndpointUrl(conf) {
      if (isAnthropicProvider(conf.provider)) return `${conf.baseUrl}/models/${conf.model}`;
      if (isVertexProvider(conf.provider)) return 'https://oauth2.googleapis.com/token';
      return `${conf.baseUrl}/models`;
    }

    function testResultHtml(conf, success, status, latency, error, urlOverride = null) {
      return `
        <div class="card">
          <h2>LLM 인증 테스트</h2>
          <div class="kv">
            <div class="k">결과</div><div class="v"><span class="badge ${success ? 'ok' : 'err'}">${success ? '성공' : '실패'}</span></div>
            <div class="k">Provider</div><div class="v">${escHtml(conf.provider)}</div>
            <div class="k">Model</div><div class="v">${escHtml(conf.model)}</div>
            <div class="k">URL</div><div class="v">${escHtml(urlOverride || testEndpointUrl(conf))}</div>
            <div class="k">HTTP</div><div class="v">${escHtml(status ?? '-')}</div>
            <div class="k">Latency</div><div class="v">${escHtml(latency ?? '-')}ms</div>
          </div>
          ${error ? `<div class="error-text" style="margin-top:10px">${escHtml(error)}</div>` : ''}
        </div>`;
    }

    function setTestResults(html) {
      const el = document.getElementById('test-results');
      if (el) el.innerHTML = html;
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

    function getInputValue(id) {
      return document.getElementById(id)?.value?.trim() || '';
    }

    function getProviderValue(id, fallback) {
      const selected = document.getElementById(`${id}_select`)?.value || '';
      if (selected === 'custom') return getInputValue(`${id}_custom`) || 'custom';
      return selected || fallback;
    }

    function getCredentialValue(id) {
      if (isVertexProvider(getProviderValue('agent_provider', 'openai'))) {
        return document.getElementById(`${id}_json`)?.value?.trim() || getInputValue(id);
      }
      return getInputValue(id);
    }

    function providerSelect(id, value) {
      const options = providerOptions();
      const normalized = normalizeProviderValue(value || '');
      const known = options.some(option => option.value === normalized);
      const selected = known ? normalized : 'custom';
      const customValue = selected === 'custom' && value && !known ? value : '';
      return `
        <div class="provider-field" data-provider="${id}">
          <select id="${id}_select" data-provider-select="${id}">
            ${options.map(option => `<option value="${option.value}" ${selected === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
          </select>
          <input id="${id}_custom" class="custom-provider" type="text" value="${escHtml(customValue)}" placeholder="custom provider id">
        </div>`;
    }

    function credentialField(id, value) {
      return `
        <div class="field credential-field" data-credential="${id}">
          <div class="api-key-credential">
            <label for="${id}">API Key</label>
            <input id="${id}" type="password" value="" placeholder="${value ? '설정됨 - 비워두면 유지' : '입력 필요'}" autocomplete="off">
          </div>
          <div class="vertex-credential">
            <label for="${id}_file">Vertex AI Service Account JSON</label>
            <input id="${id}_file" type="file" accept="application/json,.json">
            <textarea id="${id}_json" class="credential-json" aria-label="Vertex AI service account JSON"></textarea>
            <div class="example-url">JSON 파일을 선택하면 credential로 저장됩니다. 원문은 화면에 표시하지 않습니다.</div>
          </div>
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
          baseUrl: 'https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/endpoints/openapi',
          model: 'google/gemini-2.5-flash',
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

    function setupProviderControls() {
      document.querySelectorAll('[data-provider-select]').forEach(select => {
        const update = () => {
          const id = select.dataset.providerSelect;
          const wrapper = document.querySelector(`[data-provider="${id}"]`);
          wrapper?.classList.toggle('provider-custom-active', select.value === 'custom');
          const credential = document.querySelector('[data-credential="agent_api_key"]');
          credential?.classList.toggle('credential-vertex-active', select.value === 'vertex-ai');
          applyProviderDefaults(select.value);
          updateEndpointExample('agent_base_url');
        };
        select.addEventListener('change', update);
        update();
      });
    }

    function applyProviderDefaults(provider) {
      if (!provider || provider === 'custom') return;
      const defaults = providerDefaults(provider);
      if (!defaults) return;

      const baseInput = document.getElementById('agent_base_url');
      const modelInput = document.getElementById('agent_model');
      if (baseInput && shouldReplaceEndpoint(baseInput.value)) {
        baseInput.value = defaults.baseUrl;
        updateEndpointExample('agent_base_url');
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
      example.textContent = `예시 URL: ${exampleApiUrl({
        provider: getProviderValue('agent_provider', 'openai'),
        baseUrl: input.value || 'https://api.openai.com/v1',
      })}`;
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

    function validateVertexCredential(text) {
      try {
        const parsed = JSON.parse(text);
        const missing = ['type', 'project_id', 'client_email', 'private_key'].filter(key => !parsed[key]);
        if (missing.length) {
          return { ok: false, error: `필수 필드 누락: ${missing.join(', ')}` };
        }
        return { ok: true, error: '' };
      } catch (err) {
        return { ok: false, error: `JSON 파싱 실패: ${err.message}` };
      }
    }

    async function getVertexAccessToken(text) {
      const now = Math.floor(Date.now() / 1000);
      if (vertexTokenCache?.source === text && vertexTokenCache.expiresAt > now + 60) {
        return vertexTokenCache.token;
      }

      const validation = validateVertexCredential(text);
      if (!validation.ok) throw new Error(validation.error);

      const info = JSON.parse(text);
      const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
      const claim = base64UrlJson({
        iss: info.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
      });
      const unsigned = `${header}.${claim}`;
      const signature = await signRs256(unsigned, info.private_key);
      const assertion = `${unsigned}.${signature}`;
      const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      });

      const res = await Risuai.nativeFetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Vertex AI access token 발급 실패: HTTP ${res.status}: ${errText.slice(0, 180)}`);
      }

      const data = await res.json();
      if (!data.access_token) throw new Error('Vertex AI access token 응답이 비어 있습니다.');
      vertexTokenCache = {
        source: text,
        token: data.access_token,
        expiresAt: now + (data.expires_in || 3600),
      };
      return data.access_token;
    }

    async function signRs256(input, privateKeyPem) {
      const cryptoApi = globalThis.crypto?.subtle;
      if (!cryptoApi) throw new Error('이 환경에서는 WebCrypto 서명을 사용할 수 없어 Vertex AI Lite 호출을 실행할 수 없습니다.');

      const key = await cryptoApi.importKey(
        'pkcs8',
        pemToArrayBuffer(privateKeyPem),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const signature = await cryptoApi.sign(
        'RSASSA-PKCS1-v1_5',
        key,
        new TextEncoder().encode(input),
      );
      return base64UrlBytes(new Uint8Array(signature));
    }

    function pemToArrayBuffer(pem) {
      const b64 = String(pem || '')
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\s/g, '');
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }

    function base64UrlJson(value) {
      return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
    }

    function base64UrlBytes(bytes) {
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
    }

    function isAnthropicProvider(provider) {
      const normalized = normalizeProviderValue(provider);
      return normalized === 'anthropic' || normalized === 'claude';
    }

    function isVertexProvider(provider) {
      const normalized = normalizeProviderValue(provider);
      return normalized === 'vertex-ai' || normalized === 'vertex';
    }

    function normalizeProviderValue(value) {
      return String(value || '').trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
    }

    function normalizeUrl(url) {
      return String(url || 'https://api.openai.com/v1').replace(/\/$/, '');
    }

    function exampleApiUrl(conf) {
      if (isAnthropicProvider(conf.provider)) return `${normalizeUrl(conf.baseUrl)}/messages`;
      return `${normalizeUrl(conf.baseUrl)}/chat/completions`;
    }

    function formatEndpoint(baseUrl) {
      try {
        const url = new URL(baseUrl);
        return url.host || baseUrl;
      } catch (_) {
        return baseUrl || '-';
      }
    }

    function parseOptionalInt(value) {
      const raw = String(value || '').trim();
      if (!raw) return null;
      const parsed = parseInt(raw);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function requiredFloat(id, fallback) {
      const parsed = parseFloat(getInputValue(id));
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    // ── beforeRequest 훅 등록 ─────────────────────────────────────────────────

    Risuai.addRisuReplacer('beforeRequest', async (messages, type) => {
      try {
        const conf = await getConfig();

        if (!conf.apiKey) {
          console.log('MultiAgent: agent_api_key not set — pipeline skipped');
          return messages;
        }

        const systemContent = getSystemContent(messages);
        const history       = formatHistory(messages, conf.window);
        const userInput     = getUserInput(messages);

        // 1. 세계관 에이전트
        const contextWorld = await callAgent(
          conf,
          buildWorldPrompt(systemContent, history, userInput)
        );

        // 2. 플롯 에이전트
        const contextPlot = await callAgent(
          conf,
          buildPlotPrompt(contextWorld, history, userInput)
        );

        // 3. 캐릭터 에이전트
        const contextChar = await callAgent(
          conf,
          buildCharPrompt(systemContent, contextWorld, contextPlot, history, userInput)
        );

        return injectContext(messages, contextWorld, contextPlot, contextChar);

      } catch (err) {
        // 에러 시 원본 메시지 그대로 통과 (파이프라인 실패가 채팅을 막지 않도록)
        console.log(`MultiAgent pipeline error: ${err.message}`);
        return messages;
      }
    });

    console.log('MultiAgent RP Pipeline v1.0.0 loaded');

  } catch (err) {
    console.log(`MultiAgent init error: ${err.message}`);
  }
})();
