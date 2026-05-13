# 설계 문서 — risu-multiagent

---

## 1. 문제 정의

RisuAI의 단일 LLM 응답은 다음 문제를 가집니다:
- 세계관 설정과 모순된 응답 생성
- 서사 흐름 무시 (플롯 점프, 복선 누락)
- 캐릭터 성격/말투 불일치
- 위 오류를 사전에 잡는 검수 레이어 없음

**해결:** 4개의 전문 에이전트가 순차적으로 응답을 보강/검수.

---

## 2. 에이전트 역할 정의

### 2-1. 세계관 에이전트 (Worldbuilding Agent)

**역할:** 세계 설정 일관성 체크
**입력:** 유저 입력 + 세계관 설정 요약 + 최근 N개 메시지
**출력:** `context_world` — 세계관 관련 주의사항 및 보강 정보
**예시 출력:**
```
- 현재 씬: 왕도 아델리아 왕궁 내부
- 주의: 이 시기 왕은 부재 중 (3턴 전 확립된 설정)
- 활성 설정: 마법 금지 구역 효과 적용 중
```

### 2-2. 플롯 에이전트 (Plot Agent)

**역할:** 서사 흐름 관리
**입력:** 유저 입력 + context_world + 최근 N개 메시지
**출력:** `context_plot` — 플롯 방향 가이드
**예시 출력:**
```
- 현재 아크: 왕위 계승 분쟁 (진행도 40%)
- 이번 씬 목적: 정보 수집
- 권장 전개: 긴장감 유지, 직접 충돌 회피
- 복선 유지: NPC 에밀의 정체 아직 미공개
```

### 2-3. 등장인물 에이전트 (Character Agent)

**역할:** 캐릭터 성격/말투 일관성 유지
**입력:** 유저 입력 + context_world + context_plot + 인물 설정 요약
**출력:** `context_char` — 캐릭터 보정 가이드
**예시 출력:**
```
- 세린 (주요 NPC): 냉소적 말투, 경어 미사용
- 주의: 세린은 현재 플레이어를 신뢰하지 않음 (관계도 -2)
- 등장 예정: 경비대장 마르코 (권위적, 짧은 문장)
```

### 2-4. 검수 에이전트 (Reviewer Agent)

**역할:** 설정 오류 감지 (메인), 최종 응답 생성
**입력:** 유저 입력 + context_world + context_plot + context_char + 최근 N개 메시지
**출력:** 최종 RP 응답 텍스트
**검수 항목:**
- 세계관 설정 위반 여부
- 플롯 흐름 역행 여부
- 캐릭터 OOC(Out of Character) 여부
- 위반 발견 시: 수정하여 응답 생성

---

## 3. 컨텍스트 전략

### 슬라이딩 윈도우

```python
# 기본값: 최근 10개 메시지
CONTEXT_WINDOW = 10
```

전체 히스토리 대신 최근 N개만 전달. 토큰 절약이 목적.

### 컨텍스트 누적 구조

```python
pipeline_context = {
    "user_input": str,           # 유저 원본 입력
    "chat_history": list[dict],  # 최근 N개 메시지
    "world_summary": str,        # 세계관 요약 (로어북)
    "char_summary": str,         # 인물 설정 요약 (로어북)
    "context_world": str,        # 세계관 에이전트 출력
    "context_plot": str,         # 플롯 에이전트 출력
    "context_char": str,         # 등장인물 에이전트 출력
}
```

---

## 4. API 설계 (Full판)

### POST /generate

**요청:**
```json
{
  "user_input": "유저의 RP 입력",
  "chat_history": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ],
  "world_summary": "세계관 핵심 설정 텍스트",
  "char_summary": "등장인물 설정 텍스트",
  "context_window": 10
}
```

**응답:**
```json
{
  "response": "최종 RP 응답 텍스트",
  "debug": {
    "context_world": "...",
    "context_plot": "...",
    "context_char": "...",
    "reviewer_notes": "..."
  }
}
```

### GET /health

서버 상태 확인용.

### GET /status

Full판 플러그인 GUI가 사용하는 공개 상태 API.
API Key 원문은 반환하지 않고, 설정 여부만 boolean으로 반환한다.

**응답 예시:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "ready": true,
  "config": {
    "default_provider": "openai",
    "default_base_url": "https://api.openai.com/v1",
    "default_model": "gpt-4o-mini",
    "default_api_key_set": true,
    "default_temperature": 0.7,
    "default_max_tokens": null,
    "context_window": 10,
    "debug_mode": false,
    "request_timeout": 60.0
  },
  "agents": [
    {
      "name": "worldbuilding",
      "label": "세계관 에이전트",
      "provider": "openai",
      "base_url": "https://api.openai.com/v1",
      "model": "gpt-4o-mini",
      "temperature": 0.7,
      "max_tokens": null,
      "provider_source": "default",
      "base_url_source": "default",
      "api_key_source": "default",
      "model_source": "default",
      "temperature_source": "default",
      "max_tokens_source": "default",
      "api_key_set": true,
      "ready": true
    }
  ]
}
```

### GET /test/llm

Full판 서버가 저장된 LLM 설정으로 각 에이전트의 OpenAI-compatible `/models`
엔드포인트를 호출해 연결 상태를 확인한다.
API Key 원문은 반환하지 않는다.
단, provider가 Vertex AI이면 네트워크 호출 대신 서비스 계정 JSON credential의
필수 필드 유효성을 확인한다.

쿼리 파라미터:
- `agent`: 선택. `worldbuilding`, `plot`, `character`, `reviewer` 중 하나.
  생략 시 전체 에이전트를 테스트한다.

**응답 예시:**
```json
{
  "success": true,
  "results": [
    {
      "name": "worldbuilding",
      "label": "세계관 에이전트",
      "provider": "openai",
      "base_url": "https://api.openai.com/v1",
      "example_url": "https://api.openai.com/v1/models",
      "model": "gpt-4o-mini",
      "success": true,
      "status_code": 200,
      "latency_ms": 320,
      "error": ""
    }
  ]
}
```

---

## 4-1. Full판 플러그인 GUI

RisuAI Plugin API v3의 `registerSetting` + `showContainer('fullscreen')` 방식으로
Full판 운영 대시보드를 표시한다.
동일한 화면은 `registerButton`으로 등록한 hamburger 메뉴의 **MultiAgent Full**
버튼에서도 바로 열 수 있다.

### 화면 구성

1. **개요**
   - Full판 사이드카 URL 및 연결 상태
   - 전체 실행 가능 여부
   - Provider
   - LLM endpoint base URL 및 예시 URL
   - 기본 API Key 설정 여부

2. **파이프라인**
   - 세계관 → 플롯 → 등장인물 → 검수 에이전트 카드
   - 에이전트별 provider, endpoint, 예시 URL, API Key 설정 여부
   - 에이전트별 모델, temperature, max tokens
   - 기본값 상속/개별 설정 여부

3. **최근 실행**
   - 마지막 요청 성공/실패
   - 완료 시각, 소요 시간, HTTP 상태
   - 입력/시스템/히스토리/응답 길이
   - 디버그 모드 응답이 있을 때 현재 플러그인 세션 안에서만 상세 컨텍스트 표시

4. **설정**
   - Full판 사이드카 URL
   - DEFAULT provider/base URL/credential/model/temperature/max tokens
   - 에이전트별 provider/base URL/credential/model/temperature/max tokens override
   - context window, timeout, debug mode

Provider 드롭다운 기본 항목:
- OpenAI
- Claude
- Vertex AI
- Google
- Custom

Provider를 변경하면 endpoint base URL과 model이 함께 갱신된다.
단, 사용자가 이미 커스텀 endpoint/model을 입력한 경우에는 값을 덮어쓰지 않는다.

기본 endpoint:
- OpenAI: `https://api.openai.com/v1`
- Claude: `https://api.anthropic.com/v1`
- Vertex AI: `https://LOCATION-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/LOCATION/endpoints/openapi`
- Google: `https://generativelanguage.googleapis.com/v1beta/openai`

5. **도움말**
   - Full 서버와 Custom AI Provider 호출 구조
   - API Key 표시 정책
   - Docker 서버 점검 안내

### 연결 테스트 버튼

- **사이드카 테스트**: GUI에 설정된 Sidecar URL의 `/health`를 호출한다.
- **LLM 테스트**: Sidecar의 `/test/llm`을 호출해 전체 에이전트 LLM 설정을 점검한다.
- **전체 테스트**: Sidecar 테스트가 성공하면 LLM 테스트를 이어서 실행한다.

### 정보 저장 정책

- API Key 입력칸에는 저장된 값을 다시 표시하지 않는다.
- 저장 시 API Key 칸을 비워두면 기존 값을 유지한다.
- Vertex AI 선택 시 API Key 대신 서비스 계정 JSON 파일을 불러온다.
- Vertex AI 연결 테스트는 저장된 JSON을 파싱하고 `type`, `project_id`,
  `client_email`, `private_key` 필수 필드 존재 여부를 확인한다.
- 최근 실행 기록은 원문 입력/응답을 저장하지 않고 길이, 성공 여부, 소요 시간 등 메타데이터만 저장한다.
- 디버그 컨텍스트 원문은 `pluginStorage`에 저장하지 않고 현재 플러그인 세션 메모리에서만 표시한다.

---

## 5. 에이전트 설정 (Full판 .env)

```env
# 에이전트별 독립 설정 (미지정 시 DEFAULT 사용)
DEFAULT_PROVIDER=openai
DEFAULT_BASE_URL=https://api.openai.com/v1
DEFAULT_API_KEY=sk-...
DEFAULT_MODEL=gpt-4o-mini
DEFAULT_TEMPERATURE=0.7
DEFAULT_MAX_TOKENS=

WORLDBUILDING_PROVIDER=
WORLDBUILDING_BASE_URL=
WORLDBUILDING_API_KEY=
WORLDBUILDING_MODEL=
WORLDBUILDING_TEMPERATURE=
WORLDBUILDING_MAX_TOKENS=

PLOT_PROVIDER=
PLOT_BASE_URL=
PLOT_API_KEY=
PLOT_MODEL=
PLOT_TEMPERATURE=
PLOT_MAX_TOKENS=

CHARACTER_PROVIDER=
CHARACTER_BASE_URL=
CHARACTER_API_KEY=
CHARACTER_MODEL=
CHARACTER_TEMPERATURE=
CHARACTER_MAX_TOKENS=

REVIEWER_PROVIDER=
REVIEWER_BASE_URL=
REVIEWER_API_KEY=
REVIEWER_MODEL=gpt-4o
REVIEWER_TEMPERATURE=
REVIEWER_MAX_TOKENS=

CONTEXT_WINDOW=10
DEBUG_MODE=false
REQUEST_TIMEOUT=60.0
```

---

## 6. Lite판 설계

### Lua 파이프라인

```lua
-- 02_pipeline.lua 핵심 흐름
function onStart(triggerId)
    local userInput = getUserLastMessage(triggerId)
    local history = buildHistory(triggerId)

    -- 순차 실행
    local ctxWorld = runWorldAgent(triggerId, userInput, history)
    local ctxPlot  = runPlotAgent(triggerId, userInput, history, ctxWorld)
    local ctxChar  = runCharAgent(triggerId, userInput, history, ctxWorld, ctxPlot)
    local final    = runReviewer(triggerId, userInput, history, ctxWorld, ctxPlot, ctxChar)

    -- 프롬프트 주입
    injectFinalPrompt(triggerId, final)
end
```

### Lua LLM 호출 전략

- **세계관/플롯/등장인물:** `simpleLLM():await()` — 경량, 빠름
- **검수 에이전트:** `LLM()` 또는 `axLLM()` — 메인/대체 모델

### Lite판 플러그인 GUI

RisuAI Plugin API v3의 `registerSetting` + `showContainer('fullscreen')` 방식으로
`MultiAgent Lite판 상태` 설정 화면을 제공한다.
동일한 화면은 `registerButton`으로 등록한 hamburger 메뉴의 **MultiAgent Lite**
버튼에서도 바로 열 수 있다.

Lite판은 별도 FastAPI 사이드카가 없으므로 Full판의 Sidecar URL은 표시하지 않고,
대신 “사이드카 없음” 상태와 LLM endpoint 설정을 보여준다.

GUI에서 확인/수정하는 항목:
- Provider 드롭다운: OpenAI, Claude, Vertex AI, Google, Custom
- LLM endpoint base URL
- 예시 URL: `{base_url}/chat/completions`
- Credential 설정 여부
- Model
- Temperature
- Max Tokens
- Context Window
- Lite판 동작 구조: 세계관/플롯/등장인물은 보조 LLM, 검수는 RisuAI 메인 모델

Provider를 변경하면 endpoint base URL과 model이 함께 갱신된다.
단, 사용자가 이미 커스텀 endpoint/model을 입력한 경우에는 값을 덮어쓰지 않는다.

연결 테스트:
- **LLM 테스트**: `{base_url}/models`를 호출해 API Key와 endpoint 연결 상태를 확인한다.
- Vertex AI 선택 시 API Key 대신 서비스 계정 JSON 파일을 불러오고,
  테스트는 JSON 파싱 및 필수 필드 존재 여부를 확인한다.
- **전체 테스트**: Lite판에서 가능한 전체 범위인 LLM 테스트와 동일하게 동작한다.

정보 저장 정책:
- API Key 입력칸에는 저장된 값을 다시 표시하지 않는다.
- 저장 시 API Key 칸을 비워두면 기존 값을 유지한다.
- Vertex AI JSON 원문은 화면에 표시하지 않고 credential 값으로 저장한다.
- Lite판에는 사이드카 테스트가 없다.

### Lite판 에이전트 호출 구조

Lite판은 RisuAI의 `beforeRequest` 훅에서 보조 에이전트 3개를 순차 호출한다:

1. 세계관 에이전트: `nativeFetch`로 보조 LLM 호출
2. 플롯 에이전트: `nativeFetch`로 보조 LLM 호출
3. 등장인물 에이전트: `nativeFetch`로 보조 LLM 호출
4. 검수 에이전트: 별도 `nativeFetch`가 아니라 RisuAI의 현재 메인 LLM 호출이 담당

따라서 실제 RP 생성 흐름은 4단계지만, Lite 플러그인 코드 안에서 직접 호출하는
보조 LLM은 3번이다. GUI의 LLM 테스트는 공통 endpoint/credential 설정 검증용이므로
에이전트별 호출을 반복하지 않고 1회만 수행한다.

---

## 7. 미결 사항

- [ ] 에이전트 시스템 프롬프트 최종 확정 (`docs/agent-prompts.md` 작성)
- [ ] 슬라이딩 윈도우 기본값 튜닝 (10개 → 조정 필요할 수 있음)
- [ ] Lite판에서 커스텀 엔드포인트 지원 방식 결정
- [ ] 검수 에이전트 오류 감지 후 재시도 로직 필요 여부
