//@name risu_multiagent
//@display-name MultiAgent RP Pipeline
//@api 3.0
//@version 1.0.4
//@arg agent_provider string Analysis agent provider label. e.g. openai
//@arg agent_base_url string Analysis agent API base URL. e.g. https://api.openai.com/v1, https://api.anthropic.com/v1, or Vertex AI OpenAI-compatible endpoint
//@arg agent_api_key string Analysis agent API key
//@arg agent_model string Analysis agent model. e.g. gpt-4o-mini
//@arg agent_temperature string Analysis agent temperature (default: 0.7)
//@arg agent_max_tokens string Analysis agent max tokens (blank = provider default)
//@arg agent_extra_body_json string Extra JSON body merged into OpenAI-compatible chat/completions requests
//@arg context_window int Recent messages per agent (default: 10)
//@arg bypass_translate string Skip MultiAgent analysis for RisuAI built-in LLM translation requests (default: 1)
//@arg bypass_lb_process string Skip MultiAgent analysis for <lb-process> helper LLM requests (default: 1)

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
    const CONFIG_VAULT_KEY = 'risu_multiagent_lite_config_vault_v1';
    const CONFIG_VAULT_VERSION = 1;
    const LAST_RUN_KEY = 'risu_multiagent_lite_last_run_v1';
    const LAST_RUN_VERSION = 1;

    // ── 설정 로드 ─────────────────────────────────────────────────────────────

    async function getConfig() {
      const stored = await loadConfigVault('lite');
      const providerArg = await Risuai.getArgument('agent_provider');
      const baseUrlArg = await Risuai.getArgument('agent_base_url');
      const apiKeyArg = await Risuai.getArgument('agent_api_key');
      const modelArg = await Risuai.getArgument('agent_model');
      const temperatureArg = await Risuai.getArgument('agent_temperature');
      const maxTokensArg = await Risuai.getArgument('agent_max_tokens');
      const extraBodyArg = await Risuai.getArgument('agent_extra_body_json');
      const windowArg = await Risuai.getArgument('context_window');
      const bypassTranslateArg = await Risuai.getArgument('bypass_translate');
      const bypassLbProcessArg = await Risuai.getArgument('bypass_lb_process');
      const provider = providerArg || stored.provider || 'openai';
      const baseUrl = normalizeUrl(baseUrlArg || stored.baseUrl || 'https://api.openai.com/v1');
      const apiKey  = apiKeyArg || stored.apiKey || '';
      const model   = modelArg || stored.model || 'gpt-4o-mini';
      const temperature = parseFloat(temperatureArg || stored.temperature || '0.7');
      const maxTokens = parseOptionalInt(maxTokensArg ?? stored.maxTokens);
      const extraBodyJson = String(extraBodyArg || stored.extraBodyJson || '').trim();
      const window  = Math.max(1, parseInt(windowArg || stored.window || '10') || 10);
      const bypassTranslate = parseEnabled(bypassTranslateArg, stored.bypassTranslate ?? true);
      const bypassLbProcess = parseEnabled(bypassLbProcessArg, stored.bypassLbProcess ?? true);
      return {
        provider,
        baseUrl,
        apiKey,
        model,
        temperature: Number.isFinite(temperature) ? temperature : 0.7,
        maxTokens,
        extraBodyJson,
        window,
        bypassTranslate,
        bypassLbProcess,
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
      const payload = buildChatCompletionPayload(conf, messages);

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
      const payload = buildChatCompletionPayload(conf, messages);

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

    function buildChatCompletionPayload(conf, messages) {
      const payload = {
        model: conf.model,
        messages,
        temperature: conf.temperature,
      };
      if (conf.maxTokens !== null) payload.max_tokens = conf.maxTokens;

      const extraBody = parseExtraBodyJson(conf.extraBodyJson);
      if (!extraBody) return payload;
      return deepMergeJson(payload, extraBody);
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
            '- Continuity notes for established voice and motivations\n' +
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
        'Use these notes quietly as background context. Preserve established world details, narrative continuity, character voice, and motivations while allowing natural development.',
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
      const vaultInfo = await getConfigVaultInfo();
      const lastRun = await getLastRunDiagnostics();
      document.body.innerHTML = buildLiteUI(conf, vaultInfo, lastRun);
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

    function buildLiteUI(conf, vaultInfo, lastRun) {
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
input[type=checkbox]{width:auto;margin-right:7px}
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
        <div class="k">추가 JSON</div><div class="v">${conf.extraBodyJson ? '적용됨' : '없음'}</div>
        <div class="k">Context</div><div class="v">${escHtml(conf.window)}개 메시지</div>
        <div class="k">번역 우회</div><div class="v">${conf.bypassTranslate ? '켜짐' : '꺼짐'}</div>
        <div class="k">LB 우회</div><div class="v">${conf.bypassLbProcess ? '켜짐' : '꺼짐'}</div>
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

  ${lastRunCard(lastRun)}

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
    <div class="row2">
      <label>
        <input id="gateway_caching_auto" type="checkbox" ${checkedAttr(gatewayCachingAutoEnabled(conf.extraBodyJson))}>
        Vercel Gateway automatic caching
      </label>
      <label>
        <input id="gateway_zdr" type="checkbox" ${checkedAttr(gatewayZdrEnabled(conf.extraBodyJson))}>
        Vercel Gateway Zero Data Retention
      </label>
    </div>
    <div class="example-url">체크박스는 아래 JSON 블럭의 providerOptions.gateway 값을 갱신합니다. 필요하면 직접 수정할 수 있습니다.</div>
    <div class="field">
      <label for="agent_extra_body_json">추가 JSON body</label>
      <textarea id="agent_extra_body_json" spellcheck="false" placeholder='{"providerOptions":{"gateway":{"caching":"auto","zeroDataRetention":true}}}'>${escHtml(conf.extraBodyJson)}</textarea>
    </div>
    <div class="example-url">OpenAI-compatible/Vertex chat completions 요청에 병합합니다. Vercel AI Gateway의 caching, ZDR, provider routing 같은 providerOptions 용도입니다.</div>
    <label>
      <input id="bypass_translate" type="checkbox" ${checkedAttr(conf.bypassTranslate)}>
      RisuAI 내장 번역 요청 우회
    </label>
    <div class="example-url">request mode가 translate인 LLM 번역 호출에서는 보조 에이전트를 실행하지 않습니다.</div>
    <label>
      <input id="bypass_lb_process" type="checkbox" ${checkedAttr(conf.bypassLbProcess)}>
      &lt;lb-process&gt; LLM 요청 우회
    </label>
    <div class="example-url">&lt;lb-process&gt; 태그가 포함된 헬퍼 호출에서는 보조 에이전트를 실행하지 않습니다.</div>
  </div>

  <div class="card">
    <h2>RisuAI 저장소 설정 보관</h2>
    <div class="kv">
      <div class="k">Vault</div><div class="v">${vaultInfo.exists ? `있음 (${escHtml(formatDateTime(vaultInfo.savedAt))})` : '없음'}</div>
      <div class="k">보관 내용</div><div class="v">URL, provider, model, API key, Vertex JSON, 추가 JSON, 우회 설정</div>
    </div>
    <div style="height:10px"></div>
    <div class="header-actions">
      <button id="vault-save-btn">백업 갱신</button>
      <button id="vault-restore-btn">백업에서 복구</button>
    </div>
  </div>

  <div class="card">
    <h2>도움말</h2>
    <ul class="help-list">
      <li>Lite판은 별도 FastAPI 사이드카 없이 RisuAI 플러그인 안에서 보조 에이전트 3개를 호출합니다.</li>
      <li>Endpoint Base URL은 provider별 API base 주소입니다. OpenAI-compatible은 /v1, Anthropic은 https://api.anthropic.com/v1 형식을 사용합니다.</li>
      <li>API Key 입력칸은 저장된 값을 다시 표시하지 않습니다. 빈칸으로 저장하면 기존 값을 유지합니다.</li>
      <li>Vertex AI를 선택하면 API Key 대신 서비스 계정 JSON 파일을 불러오고, Lite판 내부에서 OAuth access token을 발급해 호출합니다.</li>
      <li>추가 JSON body는 OpenAI-compatible/Vertex chat completions 요청에만 병합됩니다. Anthropic 직접 호출에는 적용하지 않습니다.</li>
      <li>마지막 실행 상태는 본문 없이 성공/우회/실패, 출력 길이, 소요 시간 같은 작은 진단값만 저장합니다.</li>
      <li>LLM 인증 테스트는 생성 호출 없이 provider별 인증/모델 조회 경로만 확인합니다. 실제 분석은 토큰을 사용합니다.</li>
      <li>내장 LLM 번역과 &lt;lb-process&gt; 헬퍼 호출은 기본적으로 분석 파이프라인을 우회합니다.</li>
      <li>설정 백업은 RisuAI save/passphrase가 보호하는 pluginStorage에 저장되어, 플러그인 JS 업데이트 후에도 복구됩니다.</li>
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
      setupExtraBodyActions();
      document.getElementById('llm-test-btn')?.addEventListener('click', testLiteLlm);
      document.getElementById('all-test-btn')?.addEventListener('click', testLiteLlm);
      document.getElementById('save-btn')?.addEventListener('click', async () => {
        try {
          const next = collectLiteConfig(initialConf);
          await saveLiteConfig(next);
          await saveConfigVault('lite', next);
          showMsg('저장 완료', true);
        } catch (err) {
          showMsg(`저장 오류: ${err.message}`, false);
        }
      });
      document.getElementById('vault-save-btn')?.addEventListener('click', async () => {
        try {
          const next = collectLiteConfig(initialConf);
          await saveConfigVault('lite', next);
          showMsg('백업 저장 완료', true);
          await openLiteDashboard();
        } catch (err) {
          showMsg(`백업 저장 실패: ${err.message}`, false);
        }
      });
      document.getElementById('vault-restore-btn')?.addEventListener('click', async () => {
        try {
          const restored = await restoreConfigVault('lite');
          await saveLiteConfig(restored);
          showMsg('백업 복구 완료', true);
          await openLiteDashboard();
        } catch (err) {
          showMsg(`백업 복구 실패: ${err.message}`, false);
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
        extraBodyJson: normalizeExtraBodyJson(getInputValue('agent_extra_body_json')),
        window: Math.max(1, parseInt(getInputValue('context_window')) || 10),
        bypassTranslate: getCheckboxValue('bypass_translate'),
        bypassLbProcess: getCheckboxValue('bypass_lb_process'),
      };
    }

    async function saveLiteConfig(conf) {
      await Risuai.setArgument('agent_provider', conf.provider);
      await Risuai.setArgument('agent_base_url', conf.baseUrl);
      await Risuai.setArgument('agent_api_key', conf.apiKey);
      await Risuai.setArgument('agent_model', conf.model);
      await Risuai.setArgument('agent_temperature', String(conf.temperature));
      await Risuai.setArgument('agent_max_tokens', conf.maxTokens === null ? '' : String(conf.maxTokens));
      await Risuai.setArgument('agent_extra_body_json', conf.extraBodyJson || '');
      await Risuai.setArgument('context_window', String(conf.window));
      await Risuai.setArgument('bypass_translate', conf.bypassTranslate ? '1' : '0');
      await Risuai.setArgument('bypass_lb_process', conf.bypassLbProcess ? '1' : '0');
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

    function lastRunCard(lastRun) {
      if (!lastRun) {
        return `
          <div class="card">
            <h2>마지막 실행 상태</h2>
            <div class="kv">
              <div class="k">상태</div><div class="v"><span class="badge neutral">기록 없음</span></div>
              <div class="k">확인 방법</div><div class="v">채팅을 한 번 보내면 Lite beforeRequest 실행 결과가 여기에 표시됩니다.</div>
            </div>
            <div class="example-url" style="margin:10px 0 0">프롬프트와 응답 원문은 저장하지 않고 상태, 길이, 소요 시간만 저장합니다.</div>
          </div>`;
      }

      const status = lastRun.status || 'unknown';
      const statusClass = status === 'success' ? 'ok' : status === 'error' ? 'err' : 'neutral';
      return `
        <div class="card">
          <h2>마지막 실행 상태</h2>
          <div class="kv">
            <div class="k">상태</div><div class="v"><span class="badge ${statusClass}">${escHtml(lastRunStatusLabel(status))}</span></div>
            <div class="k">실행 시각</div><div class="v">${escHtml(formatDateTime(lastRun.finishedAt || lastRun.startedAt))}</div>
            <div class="k">요청 타입</div><div class="v">${escHtml(lastRun.requestType || '-')}</div>
            <div class="k">Provider</div><div class="v">${escHtml([lastRun.provider, lastRun.model].filter(Boolean).join(' / ') || '-')}</div>
            <div class="k">Endpoint</div><div class="v">${escHtml(lastRun.endpoint || '-')}</div>
            <div class="k">추가 JSON</div><div class="v">${lastRun.extraBody ? '적용됨' : '없음'}</div>
            <div class="k">소요 시간</div><div class="v">${escHtml(formatDuration(lastRun.durationMs))}</div>
            <div class="k">주입</div><div class="v">${lastRun.injected ? 'yes' : 'no'}</div>
            <div class="k">세계관</div><div class="v">${agentDiagnosticSummary(lastRun.agents?.worldbuilding)}</div>
            <div class="k">플롯</div><div class="v">${agentDiagnosticSummary(lastRun.agents?.plot)}</div>
            <div class="k">등장인물</div><div class="v">${agentDiagnosticSummary(lastRun.agents?.character)}</div>
            ${lastRun.reason ? `<div class="k">사유</div><div class="v">${escHtml(lastRun.reason)}</div>` : ''}
            ${lastRun.error ? `<div class="k">오류</div><div class="v error-text">${escHtml(lastRun.error)}</div>` : ''}
          </div>
          <div class="example-url" style="margin:10px 0 0">이 카드는 실제 채팅 요청에서 MultiAgent가 돌았는지 확인하는 용도입니다. 전체 리퀘스트 로그를 열 필요가 없도록 작은 진단값만 남깁니다.</div>
        </div>`;
    }

    function lastRunStatusLabel(status) {
      const labels = {
        success: '성공',
        bypassed: '우회',
        skipped: '건너뜀',
        error: '실패',
      };
      return labels[status] || '알 수 없음';
    }

    function agentDiagnosticSummary(agent) {
      if (!agent) return '-';
      if (!agent.ok) return `<span class="badge err">실패</span>${agent.error ? ` ${escHtml(agent.error)}` : ''}`;
      return `<span class="badge ok">성공</span> ${escHtml(formatDuration(agent.durationMs))}, ${escHtml(agent.chars || 0)} chars`;
    }

    function formatDuration(value) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return '-';
      if (parsed < 1000) return `${Math.round(parsed)}ms`;
      return `${(parsed / 1000).toFixed(1)}s`;
    }

    async function getConfigVaultInfo() {
      const vault = await getConfigVault('lite');
      return {
        exists: Boolean(vault),
        savedAt: vault?.savedAt || '',
      };
    }

    async function loadConfigVault(scope) {
      const vault = await getConfigVault(scope);
      return vault?.config || {};
    }

    async function restoreConfigVault(scope) {
      const config = await loadConfigVault(scope);
      if (!Object.keys(config).length) {
        throw new Error('저장된 설정 백업이 없습니다.');
      }
      return config;
    }

    async function saveConfigVault(scope, config) {
      await Risuai.pluginStorage.setItem(CONFIG_VAULT_KEY, {
        version: CONFIG_VAULT_VERSION,
        scope,
        savedAt: new Date().toISOString(),
        config: normalizeVaultConfig(config),
      });
    }

    async function getConfigVault(scope) {
      try {
        const raw = await Risuai.pluginStorage.getItem(CONFIG_VAULT_KEY);
        const vault = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!vault || vault.version !== CONFIG_VAULT_VERSION || vault.scope !== scope) {
          return null;
        }
        return vault;
      } catch (_) {
        return null;
      }
    }

    async function getLastRunDiagnostics() {
      try {
        const raw = await Risuai.pluginStorage.getItem(LAST_RUN_KEY);
        const lastRun = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!lastRun || lastRun.version !== LAST_RUN_VERSION) return null;
        return lastRun;
      } catch (_) {
        return null;
      }
    }

    async function saveLastRunDiagnostics(diagnostics) {
      try {
        await Risuai.pluginStorage.setItem(LAST_RUN_KEY, sanitizeLastRunDiagnostics(diagnostics));
      } catch (err) {
        console.log(`MultiAgent diagnostics save failed: ${err.message}`);
      }
    }

    function sanitizeLastRunDiagnostics(diagnostics) {
      const cleanAgents = {};
      for (const name of ['worldbuilding', 'plot', 'character']) {
        if (diagnostics.agents?.[name]) {
          const agent = diagnostics.agents[name];
          cleanAgents[name] = {
            ok: Boolean(agent.ok),
            durationMs: safeNumber(agent.durationMs),
            chars: Math.max(0, parseInt(agent.chars || 0) || 0),
            error: truncateText(agent.error || '', 220),
          };
        }
      }

      return {
        version: LAST_RUN_VERSION,
        status: truncateText(diagnostics.status || 'unknown', 24),
        startedAt: truncateText(diagnostics.startedAt || '', 64),
        finishedAt: truncateText(diagnostics.finishedAt || '', 64),
        durationMs: safeNumber(diagnostics.durationMs),
        requestType: truncateText(diagnostics.requestType || 'chat', 64),
        provider: truncateText(diagnostics.provider || '', 80),
        model: truncateText(diagnostics.model || '', 120),
        endpoint: truncateText(diagnostics.endpoint || '', 160),
        extraBody: Boolean(diagnostics.extraBody),
        injected: Boolean(diagnostics.injected),
        reason: truncateText(diagnostics.reason || '', 220),
        error: truncateText(diagnostics.error || '', 220),
        agents: cleanAgents,
      };
    }

    function normalizeVaultConfig(config) {
      return {
        provider: String(config.provider || 'openai'),
        baseUrl: normalizeUrl(config.baseUrl || 'https://api.openai.com/v1'),
        apiKey: String(config.apiKey || ''),
        model: String(config.model || 'gpt-4o-mini'),
        temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.7,
        maxTokens: config.maxTokens === null || config.maxTokens === undefined || config.maxTokens === ''
          ? null
          : parseOptionalInt(config.maxTokens),
        extraBodyJson: normalizeExtraBodyJson(config.extraBodyJson || ''),
        window: Math.max(1, parseInt(config.window || '10') || 10),
        bypassTranslate: Boolean(config.bypassTranslate),
        bypassLbProcess: Boolean(config.bypassLbProcess),
      };
    }

    function formatDateTime(value) {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString();
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
        return getVertexCredentialValue(id) || getInputValue(id);
      }
      return getInputValue(id);
    }

    function getCheckboxValue(id) {
      return Boolean(document.getElementById(id)?.checked);
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
            <div class="row2">
              <div class="field">
                <label for="${id}_project_id">Project ID</label>
                <input id="${id}_project_id" type="text" autocomplete="off" placeholder="my-gcp-project">
              </div>
              <div class="field">
                <label for="${id}_client_email">Client Email</label>
                <input id="${id}_client_email" type="text" autocomplete="off" placeholder="service-account@project.iam.gserviceaccount.com">
              </div>
            </div>
            <div class="field">
              <label for="${id}_private_key">Private Key</label>
              <textarea id="${id}_private_key" autocomplete="off" placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
            </div>
            <textarea id="${id}_json" class="credential-json" aria-label="Vertex AI service account JSON"></textarea>
            <div class="example-url">JSON 파일을 선택하면 필드가 자동으로 채워집니다. Project ID는 endpoint의 PROJECT_ID 자리에도 반영됩니다.</div>
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

    function setupExtraBodyActions() {
      const bodyId = 'agent_extra_body_json';
      const cachingId = 'gateway_caching_auto';
      const zdrId = 'gateway_zdr';
      document.getElementById(cachingId)?.addEventListener('change', () => updateGatewayBodyFromCheckboxes(bodyId, cachingId, zdrId));
      document.getElementById(zdrId)?.addEventListener('change', () => updateGatewayBodyFromCheckboxes(bodyId, cachingId, zdrId));
      document.getElementById(bodyId)?.addEventListener('input', () => syncGatewayCheckboxesFromBody(bodyId, cachingId, zdrId));
      syncGatewayCheckboxesFromBody(bodyId, cachingId, zdrId);
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
          const credentialId = input.id.replace(/_file$/, '');
          setVertexCredentialFields(credentialId, text);
          showMsg('Vertex AI credential 필드를 불러왔습니다.', true);
        });
      });
    }

    function getVertexCredentialValue(id) {
      const json = document.getElementById(`${id}_json`)?.value?.trim();
      const projectId = getInputValue(`${id}_project_id`);
      const clientEmail = getInputValue(`${id}_client_email`);
      const privateKey = document.getElementById(`${id}_private_key`)?.value?.trim() || '';
      if (projectId || clientEmail || privateKey) {
        applyVertexProjectToEndpoint(projectId);
        return JSON.stringify({
          type: 'service_account',
          project_id: projectId,
          private_key: normalizePrivateKey(privateKey),
          client_email: clientEmail,
          token_uri: 'https://oauth2.googleapis.com/token',
        });
      }
      return json;
    }

    function setVertexCredentialFields(id, text) {
      const parsed = JSON.parse(text);
      setElementValue(`${id}_project_id`, parsed.project_id || '');
      setElementValue(`${id}_client_email`, parsed.client_email || '');
      setElementValue(`${id}_private_key`, parsed.private_key || '');
      setElementValue(`${id}_json`, text);
      applyVertexProjectToEndpoint(parsed.project_id || '');
    }

    function setElementValue(id, value) {
      const el = document.getElementById(id);
      if (el) el.value = value;
    }

    function normalizePrivateKey(value) {
      return String(value || '').replace(/\\n/g, '\n');
    }

    function applyVertexProjectToEndpoint(projectId) {
      const clean = String(projectId || '').trim();
      if (!clean) return;
      const input = document.getElementById('agent_base_url');
      if (!input) return;
      if (input.value.includes('PROJECT_ID')) {
        input.value = input.value.replace(/PROJECT_ID/g, clean);
        updateEndpointExample('agent_base_url');
      }
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

    function normalizeExtraBodyJson(value) {
      const raw = String(value || '').trim();
      if (!raw) return '';
      return JSON.stringify(parseExtraBodyJson(raw), null, 2);
    }

    function parseExtraBodyJson(value) {
      const raw = String(value || '').trim();
      if (!raw) return null;

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`추가 JSON body 파싱 실패: ${err.message}`);
      }

      if (!isPlainObject(parsed)) {
        throw new Error('추가 JSON body는 JSON object여야 합니다.');
      }
      return parsed;
    }

    function parseExtraBodyJsonQuiet(value) {
      try {
        return parseExtraBodyJson(value);
      } catch (_) {
        return null;
      }
    }

    function gatewayCachingAutoEnabled(extraBodyJson) {
      const parsed = parseExtraBodyJsonQuiet(extraBodyJson);
      return parsed?.providerOptions?.gateway?.caching === 'auto';
    }

    function gatewayZdrEnabled(extraBodyJson) {
      const parsed = parseExtraBodyJsonQuiet(extraBodyJson);
      return parsed?.providerOptions?.gateway?.zeroDataRetention === true;
    }

    function syncGatewayCheckboxesFromBody(bodyId, cachingId, zdrId) {
      const parsed = parseExtraBodyJsonQuiet(getInputValue(bodyId));
      const caching = document.getElementById(cachingId);
      const zdr = document.getElementById(zdrId);
      if (!parsed) {
        if (!getInputValue(bodyId)) {
          if (caching) caching.checked = false;
          if (zdr) zdr.checked = false;
        }
        return;
      }
      if (caching) caching.checked = parsed?.providerOptions?.gateway?.caching === 'auto';
      if (zdr) zdr.checked = parsed?.providerOptions?.gateway?.zeroDataRetention === true;
    }

    function updateGatewayBodyFromCheckboxes(bodyId, cachingId, zdrId) {
      let body = {};
      try {
        body = parseExtraBodyJson(getInputValue(bodyId)) || {};
      } catch (err) {
        showMsg(`추가 JSON을 먼저 수정하세요: ${err.message}`, false);
        syncGatewayCheckboxesFromBody(bodyId, cachingId, zdrId);
        return;
      }

      const providerOptions = isPlainObject(body.providerOptions) ? { ...body.providerOptions } : {};
      const gateway = isPlainObject(providerOptions.gateway) ? { ...providerOptions.gateway } : {};

      if (document.getElementById(cachingId)?.checked) {
        gateway.caching = 'auto';
      } else {
        delete gateway.caching;
      }

      if (document.getElementById(zdrId)?.checked) {
        gateway.zeroDataRetention = true;
      } else {
        delete gateway.zeroDataRetention;
      }

      if (Object.keys(gateway).length) {
        providerOptions.gateway = gateway;
        body.providerOptions = providerOptions;
      } else {
        delete providerOptions.gateway;
        if (Object.keys(providerOptions).length) {
          body.providerOptions = providerOptions;
        } else {
          delete body.providerOptions;
        }
      }

      setElementValue(bodyId, Object.keys(body).length ? JSON.stringify(body, null, 2) : '');
    }

    function deepMergeJson(base, extra) {
      const result = { ...base };
      for (const [key, value] of Object.entries(extra)) {
        if (key === 'messages') continue;
        if (isPlainObject(value) && isPlainObject(result[key])) {
          result[key] = deepMergeJson(result[key], value);
        } else {
          result[key] = value;
        }
      }
      return result;
    }

    function isPlainObject(value) {
      return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function safeNumber(value) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function truncateText(value, limit) {
      const text = String(value || '');
      return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3))}...` : text;
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

    function getBypassReason(messages, type, conf) {
      const requestType = String(type || '').trim().toLowerCase();
      if (conf.bypassTranslate && requestType === 'translate') {
        return 'RisuAI translation request';
      }
      if (conf.bypassLbProcess && Array.isArray(messages) && messages.some(msg => containsLbProcess(msg?.content))) {
        return '<lb-process> helper request';
      }
      return '';
    }

    async function runAgentWithDiagnostics(run, name, action) {
      const started = Date.now();
      try {
        const output = await action();
        run.agents[name] = {
          ok: true,
          durationMs: Date.now() - started,
          chars: String(output || '').length,
        };
        return output;
      } catch (err) {
        run.agents[name] = {
          ok: false,
          durationMs: Date.now() - started,
          chars: 0,
          error: err.message,
        };
        throw err;
      }
    }

    function finishRunDiagnostics(run, startedAtMs, patch) {
      return {
        ...run,
        ...patch,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
      };
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
      const runStartedAtMs = Date.now();
      const run = {
        version: LAST_RUN_VERSION,
        startedAt: new Date(runStartedAtMs).toISOString(),
        requestType: String(type || 'chat'),
        agents: {},
        injected: false,
      };
      try {
        const conf = await getConfig();
        Object.assign(run, {
          provider: conf.provider,
          model: conf.model,
          endpoint: formatEndpoint(conf.baseUrl),
          extraBody: Boolean(conf.extraBodyJson),
        });

        const bypassReason = getBypassReason(messages, type, conf);
        if (bypassReason) {
          console.log(`MultiAgent: ${bypassReason} bypassed`);
          await saveLastRunDiagnostics(finishRunDiagnostics(run, runStartedAtMs, {
            status: 'bypassed',
            reason: bypassReason,
          }));
          return messages;
        }

        if (!conf.apiKey) {
          console.log('MultiAgent: agent_api_key not set — pipeline skipped');
          await saveLastRunDiagnostics(finishRunDiagnostics(run, runStartedAtMs, {
            status: 'skipped',
            reason: 'agent_api_key not set',
          }));
          return messages;
        }

        const systemContent = getSystemContent(messages);
        const history       = formatHistory(messages, conf.window);
        const userInput     = getUserInput(messages);

        // 1. 세계관 에이전트
        const contextWorld = await runAgentWithDiagnostics(
          run,
          'worldbuilding',
          () => callAgent(conf, buildWorldPrompt(systemContent, history, userInput))
        );

        // 2. 플롯 에이전트
        const contextPlot = await runAgentWithDiagnostics(
          run,
          'plot',
          () => callAgent(conf, buildPlotPrompt(contextWorld, history, userInput))
        );

        // 3. 캐릭터 에이전트
        const contextChar = await runAgentWithDiagnostics(
          run,
          'character',
          () => callAgent(conf, buildCharPrompt(systemContent, contextWorld, contextPlot, history, userInput))
        );

        const nextMessages = injectContext(messages, contextWorld, contextPlot, contextChar);
        run.injected = true;
        await saveLastRunDiagnostics(finishRunDiagnostics(run, runStartedAtMs, {
          status: 'success',
        }));
        return nextMessages;

      } catch (err) {
        // 에러 시 원본 메시지 그대로 통과 (파이프라인 실패가 채팅을 막지 않도록)
        console.log(`MultiAgent pipeline error: ${err.message}`);
        await saveLastRunDiagnostics(finishRunDiagnostics(run, runStartedAtMs, {
          status: 'error',
          error: err.message,
        }));
        return messages;
      }
    });

    console.log('MultiAgent RP Pipeline v1.0.4 loaded');

  } catch (err) {
    console.log(`MultiAgent init error: ${err.message}`);
  }
})();
