# risu-multiagent

[RisuAI](https://github.com/kwaroran/RisuAI)용 멀티 에이전트 RP 분석 파이프라인.
3개의 보조 LLM이 메인 모델 호출 **직전**에 끼어들어 세계관·플롯·등장인물
컨텍스트를 system 프롬프트에 주입한다. 최종 RP 응답은 RisuAI가 현재 선택한
메인 모델이 그대로 생성한다 (캐릭터 카드, 로어북, 정규식 등 본체 기능을
전혀 우회하지 않음).

> 이 문서는 `codex/multiagent-mdash-quality` 브랜치 기준의 MDASH/deep-ensemble
> 실험판 설명이다. 안정판 3-agent 파이프라인은 `main` 브랜치의 README를 참고한다.

---

## 무엇을 해결하나

단일 LLM 응답에서 자주 보이는 문제:

- 세계관 설정과 모순된 응답
- 서사 흐름 무시 (플롯 점프, 복선 누락)
- 캐릭터 성격·말투 불일치

이 셋을 잡기 위해 분석 전용 에이전트 3개가 매 턴 직전에 메모를 만들고,
그 메모를 메인 모델에 컨텍스트로 붙여 보낸다. 분석은 저렴한 모델 3개로
분산하고, 응답 품질은 RisuAI 본체에서 고른 메인 모델에 맡기는 구조다.

```
[유저 입력]
   ↓ RisuAI beforeRequest 훅
[세계관] → [플롯] → [등장인물]   (보조 LLM 3회)
   ↓ system 프롬프트 끝에 분석 컨텍스트 주입
[RisuAI 메인 모델이 최종 RP 응답 생성]
```

---

## 두 가지 구현체

| | **Lite판** | **Full판** |
|---|---|---|
| 위치 | `lite/risu-multiagent.js` | `full/` |
| 형태 | RisuAI 플러그인 단일 파일 | FastAPI 사이드카 (Docker) + 플러그인 |
| 분석 LLM 호출 | 브라우저에서 직접 | 사이드카가 대행 |
| 에이전트별 모델 분리 | 가능 (플러그인 GUI) | 가능 (GUI + REST API) |
| 최종 응답 | RisuAI 메인 모델 | RisuAI 메인 모델 |
| 추천 대상 | 배포·공유, 가볍게 쓰고 싶은 사람 | 자가 운용, 에이전트별 세밀 튜닝 |

두 판은 독립적이다. **둘 다 깔지 말 것** — 한쪽만 골라 쓰면 된다.

이 브랜치의 MDASH/deep-ensemble 실험은 **Full판 전용**이다. Lite판은 기본 3-agent
흐름만 대상으로 보고, 9-agent deep-ensemble은 브라우저 메모리와 장시간 요청 부담이
커서 실험 범위에서 제외한다.

---

## 지원 LLM 공급자

플러그인 GUI에서 드롭다운으로 선택:

- OpenAI 호환 (`/v1/chat/completions`)
- Anthropic Claude
- Vertex AI (서비스 계정 JSON)
- Google AI Studio (Gemini)
- Custom (OpenAI 호환 endpoint 직접 입력)

에이전트마다 다른 공급자·모델·키를 쓸 수 있다.
예: 세계관은 Gemini Flash, 플롯은 GPT-4o-mini, 등장인물은 Claude Haiku.

---

## Lite판 설치

1. `lite/risu-multiagent.js` 파일을 받는다.
2. RisuAI → **Settings → Plugins → Import Plugin**에서 파일 선택.
3. 플러그인 메뉴의 **MultiAgent Lite** 버튼으로 설정 화면을 연다.
4. Provider, base URL, API key, 모델을 입력하고 **LLM 테스트** 버튼으로
   연결을 확인한다.
5. 채팅을 시작하면 매 턴 자동으로 분석이 돈다.

빌드·서버 불필요. API 키는 RisuAI의 `pluginStorage`에 평문으로 저장된다.

Lite판 상태 화면에는 **마지막 실행 상태** 카드가 있다. 실제 채팅 요청에서
`beforeRequest` 파이프라인이 성공했는지, 우회되었는지, 실패했는지와 각
에이전트 출력 길이·소요 시간을 본문 없이 저장해 보여준다. 전체 provider
요청 로그를 열기 전에 이 카드부터 확인하면 된다.

Lite/Full 모두 기본적으로 **메인 모델 요청에서만** MultiAgent 분석을 실행한다.
RisuAI의 `beforeRequest` request mode가 `model`이 아닌 `submodel`, `memory`,
`emotion`, `otherAx`, `translate` 호출은 보조 에이전트를 돌리지 않고 원본 요청을
그대로 통과시킨다. 설정 화면의 "메인 모델 요청에서만 MultiAgent 실행" 체크박스로
테스트 중 일시적으로 끌 수 있다.

HypaMemory/HypaV3 요약 호출은 RisuAI에서 request mode `memory`로 들어오므로,
`bypass_hypamemory`가 기본값 `1`인 동안은 `main_model_only`를 꺼도 MultiAgent 분석을
돌리지 않는다. 즉 HypaMemory가 요약/정리용 LLM 호출을 할 때는 보조 에이전트 3회가
붙지 않는다.

OpenAI-compatible endpoint에는 추가 JSON body를 병합할 수 있다. 설정 화면에서
Vercel AI Gateway용 **automatic caching**과 **Zero Data Retention** 체크박스를
켜면 아래처럼 수정 가능한 JSON 블럭이 자동으로 갱신된다.

```json
{
  "providerOptions": {
    "gateway": {
      "caching": "auto",
      "zeroDataRetention": true
    }
  }
}
```

이 추가 body는 Lite판의 OpenAI-compatible/Vertex `chat/completions` 호출에만
적용된다. Anthropic 직접 호출에는 적용하지 않는다. JSON 블럭은 직접 수정할 수
있으므로 provider routing, fallback 같은 Vercel gateway 옵션도 함께 넣을 수 있다.

---

## Full판 설치

### 사전 준비

- Docker, Docker Compose 또는 Python 3.11+
- 분석 LLM API 키 (공급자별)

### 사이드카 기동 (Docker)

```bash
cd full
cp .env.example .env
# .env 편집 — 최소 DEFAULT_PROVIDER, DEFAULT_BASE_URL,
# DEFAULT_API_KEY, DEFAULT_MODEL 채우면 동작
docker compose up -d
```

기본 포트는 `6009`. `curl http://localhost:6009/health`로 확인.

### 사이드카 기동 (스크립트)

Docker 없이 실행하려면 `full/run.sh`를 쓸 수 있다. 첫 실행 때 `.env`가 없으면
`.env.example`을 복사하고, `.venv`를 만든 뒤 필요한 Python 패키지를 설치한다.

```bash
cd full
./run.sh
```

포트와 호스트는 환경변수로 바꿀 수 있다.

```bash
HOST=127.0.0.1 PORT=6009 ./run.sh
```

### 플러그인 등록

1. `full/plugin/risu-multiagent-full.js`를 RisuAI에 Import.
2. **MultiAgent Full** 버튼으로 설정 화면을 연다.
3. **Sidecar URL**에 `http://localhost:6009` 입력 후 **사이드카 테스트**.
4. 필요하면 에이전트별 공급자·모델·키를 개별 지정한다 (생략 시 DEFAULT 사용).
5. **전체 테스트**가 통과하면 설정 완료.

Full판도 기본 LLM 설정과 각 에이전트 설정에 추가 JSON body 블럭이 있다.
Vercel AI Gateway를 쓸 때는 **automatic caching**과 **Zero Data Retention**
체크박스를 켜면 `providerOptions.gateway`가 JSON 블럭에 반영된다. 에이전트별
JSON body가 비어 있으면 기본 LLM 설정의 JSON body를 상속하고, 값이 있으면 해당
에이전트 호출에만 적용된다. 사이드카의 OpenAI-compatible/Vertex
`chat/completions` 호출에 병합되며 Anthropic 직접 호출에는 적용하지 않는다.

### 주요 환경변수 (`full/.env`)

```env
DEFAULT_PROVIDER=openai
DEFAULT_BASE_URL=https://api.openai.com/v1
DEFAULT_API_KEY=sk-...
DEFAULT_MODEL=gpt-4o-mini

# 에이전트별 override (비워두면 DEFAULT 사용)
WORLDBUILDING_PROVIDER=
WORLDBUILDING_MODEL=
# ... PLOT_*, CHARACTER_* 동일

CONTEXT_WINDOW=10           # 슬라이딩 윈도우 메시지 개수
REQUEST_TIMEOUT=60.0
ANALYSIS_LANGUAGE=auto       # auto, ko, en, ja
DEBUG_MODE=false
```

전체 항목은 `full/.env.example` 참조.

### Full판 실험 모드: ensemble-director / deep-ensemble

Full판은 실험적으로 `PIPELINE_MODE=ensemble-director`를 지원한다. 이 모드는
세계관·플롯·등장인물 에이전트를 동시에 실행한 뒤, 디렉터 에이전트가 세 분석을
서로 대조하고 최종 지침으로 압축한다. 피크 동시 LLM 호출은 3개라서 클라우드 모델
3개 병렬 실행이 가능한 환경에 맞춰져 있다.

더 공격적인 `PIPELINE_MODE=deep-ensemble`도 지원한다. 이 모드는 3개 병렬 호출을
3라운드 직렬로 실행해 총 9개 에이전트 관점을 만든다.

```text
Round 1: lore_scout / scene_scout / voice_scout
Round 2: continuity_critic / intent_critic / style_critic
Round 3: beat_director / constraint_director / final_director
```

각 라운드는 서로 다른 역할과 입력 컨텍스트를 사용한다. 같은 컨텍스트를 단순히
3번 반복 호출하지 않고, 앞 라운드의 결과를 다음 라운드가 반박하거나 압축한다.

GUI의 **파이프라인 모드**에서 `ensemble-director`로 바꿀 수 있고, 디렉터 에이전트는
기본 LLM 설정을 상속하거나 별도 provider/model/key를 지정할 수 있다. `deep-ensemble`
에이전트 9개도 GUI에서 개별 설정할 수 있다. 각 에이전트의 system prompt와 user prompt
template도 GUI에서 편집할 수 있다. 비워두면 내장 기본 프롬프트를 사용한다.

user prompt template에서 쓸 수 있는 토큰:

```text
{{user_input}}
{{chat_history}}
{{system_context}}
{{world_summary}}
{{char_summary}}
{{context_world}}
{{context_plot}}
{{context_char}}
{{context_director}}
{{context_deep}}
{{round1_context}}
{{round2_context}}
{{context_lore_scout}}
```

#### deep-ensemble 실행과 주입 전략

`deep-ensemble`은 분석 호출은 9개를 모두 실행하지만, 메인 RP 모델에 9개 원문을 전부
밀어 넣지는 않는다. 플러그인은 디버그용으로 전체 agent output을 보존하고, 실제 system
prompt 주입은 기본 약 6000자 예산 안에서 grade-aware directive로 압축한다.

주입 우선순위는 `HARD → SOFT → FYI`다. `HARD`는 연속성·캐논·캐릭터 보존처럼 반드시
지켜야 하는 항목이고, 예산이 부족하면 `SOFT/FYI`부터 잘린다. 서버가 `context_directives`를
제공하지 못하는 legacy/fallback 상황에서는 다음 raw deep output 우선순위를 사용한다.

1. `final_director`: 전체 9-agent 결과를 병합한 최종 지침
2. `constraint_director`: 반드시 지킬 것 / 피할 것
3. `beat_director`: 바로 다음 장면 비트
4. `scene_scout`, `voice_scout`, `lore_scout`: 짧은 보조 메모

이렇게 하면 deep 분석의 관점은 유지하면서 메인 모델의 출력 토큰을 과도하게 잡아먹는
문제를 줄일 수 있다. GUI에서 `최대 컨텍스트 토큰`, `출력 예약 토큰`, `주입 문자 상한`을
설정하면 플러그인이 현재 system/history/user 입력을 먼저 추정하고, 출력 예약분을 뺀
남은 예산 안에서만 directive를 주입한다. 전체 원문은 최근 분석 탭의 디버그 패널에서 확인한다.

#### 디버그와 장시간 요청

Full 플러그인 `2.3.0` 기준으로 최근 분석 탭은 다음 정보를 보여준다.

- 현재 실행 모드와 `deep-ensemble` 9/9 출력 확인
- 라운드별 agent 출력 길이와 LLM 소요 시간
- 병렬 라운드 기준 임계 지연과 누적 LLM 시간
- 추정 입력 토큰, 출력 예약 토큰, 실제 주입 문자 수
- 실패한 에이전트 목록과 partial/fail-open 상태
- `/analyze` 입력 payload
- 각 agent의 input messages, output, provider/model 설정

`debug_mode`가 켜져 있으면 브라우저 콘솔에도 `/analyze` 시작, 30초 단위 pending,
완료/실패 로그가 찍힌다. 꺼져 있으면 콘솔 진행 로그는 조용히 동작한다.

플러그인은 사이드카의 `request_timeout` 설정을 기반으로 RisuAI `nativeFetch`의
`requestTimeoutMs`도 함께 늘린다. Ollama Cloud처럼 첫 토큰까지 오래 걸리는 환경에서는
GUI에서 타임아웃을 600초 이상으로 올려 실험할 수 있다.

### Vertex AI 사용 시

API key 입력 대신 서비스 계정 JSON 파일을 GUI에서 업로드한다.
`type`, `project_id`, `client_email`, `private_key` 필드가 있는 정상 JSON이어야 한다.
JSON 파일을 넣으면 `project_id`를 사용해 Vertex AI OpenAI-compatible endpoint가
자동으로 채워지고, 모델은 `google/` prefix가 필요한 것을 알아보기 쉽도록
`google/gemini-3-flash-preview`로 맞춰진다.

Vertex AI 기본 endpoint 예시:

```text
https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/endpoints/openapi
```

실제 Chat Completions 호출 예시:

```text
https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/endpoints/openapi/chat/completions
```

---

## REST API (Full판)

플러그인이 사용하는 API는 외부에서도 직접 호출 가능하다.

| Endpoint | 용도 |
|---|---|
| `GET /health` | 헬스 체크 |
| `GET /status` | 설정 요약, 에이전트별 상태 (API key 원문은 미노출) |
| `GET /config` / `PUT /config` | 설정 조회/저장 |
| `POST /analyze` | 현재 파이프라인 모드에 맞춰 분석 실행 후 컨텍스트 반환 |
| `GET /test/llm?agent=...` | 저장된 키로 공급자별 연결 점검 |

`POST /analyze` 요청 예시:

```json
{
  "user_input": "유저 RP 입력",
  "chat_history": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ],
  "system_context": "RisuAI가 조립한 전체 system 컨텍스트",
  "world_summary": "선택: 세계관 전용 설정",
  "char_summary":  "선택: 등장인물 전용 설정",
  "context_window": 10,
  "analysis_language": "auto"
}
```

Full판 플러그인은 RisuAI의 모든 system 메시지를 모아 `system_context`로 보낸다.
`world_summary`와 `char_summary`는 양자택일이 아니라 각각 독립적인 전용 입력이다.
둘 중 어느 필드든 비어 있으면 해당 에이전트만 `system_context`를 fallback으로
사용한다. 따라서 별도 분리 요약이 없어도 세계관/캐릭터 에이전트 모두 캐릭터 카드,
시나리오, 로어북, author note 등 RisuAI가 최종 system prompt에 합친 자료를 참고할 수 있다.

응답:

```json
{
  "context_world": "...",
  "context_plot":  "...",
  "context_char":  "...",
  "context_director": "...",
  "context_deep": {
    "final_director": "..."
  },
  "context_directives": {
    "hard": [{"text": "...", "sources": ["constraint_director"]}],
    "soft": [],
    "fyi": []
  },
  "pipeline_mode": "deep-ensemble",
  "agent_timings_ms": {
    "final_director": 12345
  },
  "errors": {}
}
```

---

## 컨텍스트 전략

- **슬라이딩 윈도우**: 기본 최근 10개 메시지. 전체 히스토리는 보내지 않는다.
- **System 컨텍스트**: Lite/Full 모두 RisuAI가 조립한 모든 system 메시지를 모아
  세계관·인물 에이전트의 설정 자료로 보낸다.
- **누적**: 세계관 출력 → 플롯 입력에, 세계관+플롯 출력 → 등장인물 입력에 누적.
- **주입 위치**: 기본은 메인 모델 호출의 마지막 system 프롬프트 끝. GUI에서
  `before-last-user`로 바꿔 A/B 테스트할 수 있다.
- **출력 예약**: 최대 컨텍스트 토큰을 지정하면 출력 예약 토큰을 먼저 남기고 남는
  입력 예산 안에서만 MultiAgent directive를 주입한다.

분석 결과는 메인 모델 요청 직전에 합쳐지므로 캐릭터 카드, 로어북,
정규식 등 RisuAI 본체 처리는 전부 그대로 적용된다.

---

## 한계와 주의

- `classic`은 분석 한 번에 LLM 3회, `ensemble-director`는 4회, `deep-ensemble`은
  9회 호출한다. 피크 동시 호출은 3개지만 총 비용과 레이턴시는 크게 증가한다.
- **분석이 실패하면 기본은 fail-open.** Full판은 에이전트별 부분 실패를 `errors`에
  담고, 남은 에이전트 결과만 계속 주입한다. Strict mode를 켜면 분석 서버나 에이전트
  하나라도 실패할 때 채팅 요청을 막는다.
- **API key는 평문 저장.** Lite는 RisuAI `pluginStorage`, Full은 사이드카의
  `config.json`. 공유 PC에서 사용 시 주의.
- **Full판 사이드카는 기본적으로 인증 없이 동작.** 외부에 노출하려면 리버스
  프록시에서 인증을 걸 것.
- 분석 출력 언어는 기본 `auto`지만 GUI/API에서 `ko`, `en`, `ja`로 고정할 수 있다.
- 이 브랜치는 실험 브랜치다. `v0.0.x` 태그는 로컬 실험 스냅샷 성격이며, 안정 배포
  기준은 `main` 브랜치의 릴리스를 따른다.

---

## 라이선스

미정 (RisuAI 본체 라이선스와의 호환 검토 필요).

## 관련 링크

- RisuAI 본체: <https://github.com/kwaroran/RisuAI>
- RisuAI Plugin API v3 문서: RisuAI 위키 참조

## 브랜치 안내

- `main`: Lite판과 Full판의 기본 3-agent 파이프라인. 일반 사용과 배포 기준.
- `codex/multiagent-mdash-quality`: Full판 전용 MDASH/deep-ensemble 실험 브랜치.
  `ensemble-director`, 9-agent `deep-ensemble`, 에이전트별 프롬프트 편집, 디버그 I/O,
  장시간 timeout, partial fail-open, strict mode, 컨텍스트 예산 기반 directive 주입을 시험한다.
