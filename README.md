# risu-multiagent

[RisuAI](https://github.com/kwaroran/RisuAI)용 멀티 에이전트 RP 분석 파이프라인.
3개의 보조 LLM이 메인 모델 호출 **직전**에 끼어들어 세계관·플롯·등장인물
컨텍스트를 system 프롬프트에 주입한다. 최종 RP 응답은 RisuAI가 현재 선택한
메인 모델이 그대로 생성한다 (캐릭터 카드, 로어북, 정규식 등 본체 기능을
전혀 우회하지 않음).

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

- Docker, Docker Compose
- 분석 LLM API 키 (공급자별)

### 사이드카 기동

```bash
cd full
cp .env.example .env
# .env 편집 — 최소 DEFAULT_PROVIDER, DEFAULT_BASE_URL,
# DEFAULT_API_KEY, DEFAULT_MODEL 채우면 동작
docker compose up -d
```

기본 포트는 `8000`. `curl http://localhost:8000/health`로 확인.

### 플러그인 등록

1. `full/plugin/risu-multiagent-full.js`를 RisuAI에 Import.
2. **MultiAgent Full** 버튼으로 설정 화면을 연다.
3. **Sidecar URL**에 `http://localhost:8000` 입력 후 **사이드카 테스트**.
4. 필요하면 에이전트별 공급자·모델·키를 개별 지정한다 (생략 시 DEFAULT 사용).
5. **전체 테스트**가 통과하면 설정 완료.

Full판도 기본 LLM 설정에 추가 JSON body 블럭이 있다. Vercel AI Gateway를 쓸 때는
Lite판과 같은 방식으로 **automatic caching**과 **Zero Data Retention** 체크박스를
켜면 `providerOptions.gateway`가 JSON 블럭에 반영되고, 사이드카의
OpenAI-compatible/Vertex `chat/completions` 호출에 병합된다. Anthropic 직접 호출에는
적용하지 않는다.

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
DEBUG_MODE=false
```

전체 항목은 `full/.env.example` 참조.

### Vertex AI 사용 시

API key 입력 대신 서비스 계정 JSON 파일을 GUI에서 업로드한다.
`type`, `project_id`, `client_email`, `private_key` 필드가 있는 정상 JSON이어야 한다.

---

## REST API (Full판)

플러그인이 사용하는 API는 외부에서도 직접 호출 가능하다.

| Endpoint | 용도 |
|---|---|
| `GET /health` | 헬스 체크 |
| `GET /status` | 설정 요약, 에이전트별 상태 (API key 원문은 미노출) |
| `GET /config` / `PUT /config` | 설정 조회/저장 |
| `POST /analyze` | 분석 3개 실행 후 컨텍스트 반환 |
| `GET /test/llm?agent=...` | 저장된 키로 공급자별 연결 점검 |

`POST /analyze` 요청 예시:

```json
{
  "user_input": "유저 RP 입력",
  "chat_history": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ],
  "world_summary": "세계관 핵심 설정",
  "char_summary":  "등장인물 설정",
  "context_window": 10
}
```

응답:

```json
{
  "context_world": "...",
  "context_plot":  "...",
  "context_char":  "..."
}
```

---

## 컨텍스트 전략

- **슬라이딩 윈도우**: 기본 최근 10개 메시지. 전체 히스토리는 보내지 않는다.
- **요약본**: 세계관·인물 요약은 RisuAI 로어북에서 추출해 같이 보낸다.
- **누적**: 세계관 출력 → 플롯 입력에, 세계관+플롯 출력 → 등장인물 입력에 누적.
- **주입 위치**: 메인 모델 호출의 system 프롬프트 **끝**.

분석 결과는 메인 모델 요청 직전에 합쳐지므로 캐릭터 카드, 로어북,
정규식 등 RisuAI 본체 처리는 전부 그대로 적용된다.

---

## 한계와 주의

- **분석 한 번에 LLM 3회 호출.** 토큰 비용·레이턴시가 증가한다. 저렴한
  분석 모델을 쓰는 게 전제.
- **분석이 실패하면 현재는 메인 요청도 막힌다** (fail-open 미구현, 추후 추가 예정).
- **API key는 평문 저장.** Lite는 RisuAI `pluginStorage`, Full은 사이드카의
  `config.json`. 공유 PC에서 사용 시 주의.
- **Full판 사이드카는 기본적으로 인증 없이 동작.** 외부에 노출하려면 리버스
  프록시에서 인증을 걸 것.
- 분석 출력 언어는 모델 판단에 맡겨져 있어 메인 응답 언어와 다를 수 있다
  (튜닝 진행 중).

---

## 라이선스

미정 (RisuAI 본체 라이선스와의 호환 검토 필요).

## 관련 링크

- RisuAI 본체: <https://github.com/kwaroran/RisuAI>
- RisuAI Plugin API v3 문서: RisuAI 위키 참조
