//@name risu_multiagent
//@display-name MultiAgent RP Pipeline
//@api 3.0
//@version 1.0.0
//@arg agent_base_url string Analysis agent API base URL (OpenAI-compatible). e.g. https://api.openai.com/v1
//@arg agent_api_key string Analysis agent API key
//@arg agent_model string Analysis agent model. e.g. gpt-4o-mini
//@arg context_window int Recent messages per agent (default: 10)
//@link https://github.com/your-repo/risu-multiagent Documentation

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

    // ── 설정 로드 ─────────────────────────────────────────────────────────────

    async function getConfig() {
      const baseUrl = (await Risuai.getArgument('agent_base_url')) || 'https://api.openai.com/v1';
      const apiKey  = (await Risuai.getArgument('agent_api_key'))  || '';
      const model   = (await Risuai.getArgument('agent_model'))    || 'gpt-4o-mini';
      const window  = Math.max(1, parseInt((await Risuai.getArgument('context_window')) || '10') || 10);
      return { baseUrl, apiKey, model, window };
    }

    // ── LLM 호출 헬퍼 ─────────────────────────────────────────────────────────

    async function callAgent(baseUrl, apiKey, model, messages) {
      const res = await Risuai.nativeFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature: 0.7 }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Agent API ${res.status}: ${errText.slice(0, 120)}`);
      }

      const data = await res.json();
      return data.choices[0].message.content;
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
      if (!recent.length) return '(대화 히스토리 없음)';
      return recent.map(m => `[${m.role === 'user' ? '유저' : 'AI'}]: ${m.content}`).join('\n');
    }

    // ── 에이전트 프롬프트 빌더 ────────────────────────────────────────────────

    function buildWorldPrompt(systemContent, history, userInput) {
      return [
        {
          role: 'system',
          content:
            '당신은 세계관 일관성 에이전트입니다.\n' +
            '주어진 설정과 대화 히스토리를 바탕으로 현재 씬의 세계관 주의사항과 보강 정보를 ' +
            '간결한 불릿 포인트 메모로 작성하세요.\n\n' +
            '포함할 항목:\n' +
            '- 현재 씬/배경 정보\n' +
            '- 활성화된 세계관 규칙 (마법 금지, 특수 조건 등)\n' +
            '- 주의해야 할 기확립 설정\n' +
            '- 세계관 보강 정보\n\n' +
            '최종 RP 응답은 작성하지 마세요.',
        },
        {
          role: 'user',
          content:
            `[설정]\n${systemContent}\n\n` +
            `[최근 대화]\n${history}\n\n` +
            `[현재 유저 입력]\n${userInput}\n\n` +
            '세계관 일관성 메모를 작성하세요.',
        },
      ];
    }

    function buildPlotPrompt(contextWorld, history, userInput) {
      return [
        {
          role: 'system',
          content:
            '당신은 플롯 관리 에이전트입니다.\n' +
            '세계관 메모와 대화 히스토리를 바탕으로 현재 서사 흐름을 분석하고 ' +
            '이번 씬의 플롯 방향을 간결한 불릿 포인트 메모로 제시하세요.\n\n' +
            '포함할 항목:\n' +
            '- 현재 아크/스토리 진행 상황\n' +
            '- 이번 씬 목적\n' +
            '- 권장 전개 방향\n' +
            '- 유지해야 할 복선/미공개 정보\n\n' +
            '최종 RP 응답은 작성하지 마세요.',
        },
        {
          role: 'user',
          content:
            `[세계관 에이전트 메모]\n${contextWorld}\n\n` +
            `[최근 대화]\n${history}\n\n` +
            `[현재 유저 입력]\n${userInput}\n\n` +
            '플롯 방향 메모를 작성하세요.',
        },
      ];
    }

    function buildCharPrompt(systemContent, contextWorld, contextPlot, history, userInput) {
      return [
        {
          role: 'system',
          content:
            '당신은 등장인물 에이전트입니다.\n' +
            '설정과 이전 에이전트 메모를 바탕으로 이번 씬 캐릭터들의 성격과 말투를 ' +
            '간결한 불릿 포인트 메모로 정리하세요.\n\n' +
            '포함할 항목:\n' +
            '- 주요 캐릭터 성격/말투 특성\n' +
            '- 현재 캐릭터 심리 상태\n' +
            '- OOC(Out of Character) 주의사항\n' +
            '- 등장 예정 캐릭터 안내\n\n' +
            '최종 RP 응답은 작성하지 마세요.',
        },
        {
          role: 'user',
          content:
            `[설정]\n${systemContent}\n\n` +
            `[세계관 에이전트 메모]\n${contextWorld}\n\n` +
            `[플롯 에이전트 메모]\n${contextPlot}\n\n` +
            `[최근 대화]\n${history}\n\n` +
            `[현재 유저 입력]\n${userInput}\n\n` +
            '캐릭터 보정 메모를 작성하세요.',
        },
      ];
    }

    // ── 컨텍스트 주입 ─────────────────────────────────────────────────────────

    function injectContext(messages, contextWorld, contextPlot, contextChar) {
      const injection = [
        '',
        '---',
        '[MultiAgent RP 분석 컨텍스트]',
        '',
        '[세계관 에이전트]',
        contextWorld,
        '',
        '[플롯 에이전트]',
        contextPlot,
        '',
        '[캐릭터 에이전트]',
        contextChar,
        '',
        '[검수 지침]',
        '위 분석을 참고하여 세계관 위반·플롯 역행·OOC 오류를 감지하고 수정한 뒤 최종 RP 응답을 작성하세요.',
        '---',
      ].join('\n');

      return messages.map(m =>
        m.role === 'system' ? { ...m, content: m.content + injection } : m
      );
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
          conf.baseUrl, conf.apiKey, conf.model,
          buildWorldPrompt(systemContent, history, userInput)
        );

        // 2. 플롯 에이전트
        const contextPlot = await callAgent(
          conf.baseUrl, conf.apiKey, conf.model,
          buildPlotPrompt(contextWorld, history, userInput)
        );

        // 3. 캐릭터 에이전트
        const contextChar = await callAgent(
          conf.baseUrl, conf.apiKey, conf.model,
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
