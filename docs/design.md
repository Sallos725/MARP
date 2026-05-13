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

---

## 5. 에이전트 설정 (Full판 .env)

```env
# 에이전트별 독립 설정 (미지정 시 DEFAULT 사용)
DEFAULT_BASE_URL=https://api.openai.com/v1
DEFAULT_API_KEY=sk-...
DEFAULT_MODEL=gpt-4o-mini

WORLDBUILDING_BASE_URL=
WORLDBUILDING_API_KEY=
WORLDBUILDING_MODEL=

PLOT_BASE_URL=
PLOT_API_KEY=
PLOT_MODEL=

CHARACTER_BASE_URL=
CHARACTER_API_KEY=
CHARACTER_MODEL=

REVIEWER_BASE_URL=
REVIEWER_API_KEY=
REVIEWER_MODEL=gpt-4o

CONTEXT_WINDOW=10
DEBUG_MODE=false
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

---

## 7. 미결 사항

- [ ] 에이전트 시스템 프롬프트 최종 확정 (`docs/agent-prompts.md` 작성)
- [ ] 슬라이딩 윈도우 기본값 튜닝 (10개 → 조정 필요할 수 있음)
- [ ] Lite판에서 커스텀 엔드포인트 지원 방식 결정
- [ ] 검수 에이전트 오류 감지 후 재시도 로직 필요 여부
