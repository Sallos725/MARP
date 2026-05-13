# risu-multiagent — Claude Code 핸드오프 문서

> 새 세션 시작 시 이 파일을 **가장 먼저** 읽으세요.

---

## 프로젝트 개요

RisuAI용 멀티 에이전트 RP 분석 파이프라인.
3개의 분석 에이전트가 RisuAI 메인 모델 호출 직전(`beforeRequest` 훅)에 끼어들어
system 프롬프트에 분석 컨텍스트를 주입한다. 최종 RP 응답은 RisuAI가 선택한
메인 모델이 그대로 생성한다.

**분석 에이전트:**
1. 세계관 에이전트 — 세계 설정 일관성 메모
2. 플롯 에이전트 — 서사 흐름 메모
3. 등장인물 에이전트 — 캐릭터 성격/말투 메모

별도의 검수/응답 생성 에이전트는 두지 않는다. 분석은 저렴한 모델 3개로
분산하고, 응답 품질은 RisuAI 본체에서 골라둔 메인 모델에 위임하는 구조다.

---

## 두 가지 구현체 (독립, 양자택일)

| | Lite판 | Full판 |
|---|---|---|
| 위치 | `lite/` | `full/` |
| 동작 방식 | RisuAI 플러그인 (.js, 브라우저) | FastAPI 사이드카 + RisuAI 플러그인 |
| 분석 모델 지정 | 플러그인 arg | GUI/REST API로 에이전트별 완전 자유 지정 |
| 최종 응답 | RisuAI 메인 모델 | RisuAI 메인 모델 (동일) |
| 대상 | 배포/공유용 | 홈서버 자가 운용용 |
| 서버 필요 | 없음 | 있음 (Docker) |

---

## 디렉토리 구조

```
risu-multiagent/
├── CLAUDE.md                   ← 지금 이 파일
├── README.md
├── docs/
│   ├── design.md               ← 설계 문서
│   └── agent-prompts.md        ← 각 에이전트 프롬프트 설계
│
├── lite/                       ← Lite판 (RisuAI 플러그인, 브라우저)
│   └── risu-multiagent.js      ← 단일 플러그인 파일 (Plugin API v3.0)
│
└── full/                       ← Full판 (FastAPI + Docker)
    ├── docker-compose.yml
    ├── Dockerfile
    ├── .env.example
    ├── requirements.txt
    ├── plugin/
    │   └── risu-multiagent-full.js  ← 설정 GUI + beforeRequest 훅 플러그인
    └── app/
        ├── __init__.py
        ├── main.py             ← FastAPI 엔트리포인트 (`POST /analyze`)
        ├── config.py           ← 설정 로드 (env)
        ├── config_store.py     ← config.json 영속 저장소
        ├── pipeline.py         ← 분석 3개 순차 오케스트레이터
        ├── models.py           ← Pydantic 요청/응답 모델
        └── agents/
            ├── __init__.py
            ├── base.py         ← BaseAgent 추상 클래스
            ├── worldbuilding.py
            ├── plot.py
            └── character.py
```

---

## 개발 순서

1. **Full판 먼저** 개발 — Python으로 파이프라인 로직 확정
2. **Lite판** — Full판 로직을 RisuAI Plugin JS로 포팅

Full판이 검증된 뒤 Lite판을 만드세요. 반대로 하지 말 것.

---

## Full판 기술 스택

- **Python 3.11+**
- **FastAPI** — API 서버
- **httpx** — 비동기 LLM API 호출
- **Pydantic v2** — 설정/요청/응답 모델
- **Docker Compose** — 컨테이너 운용
- **python-dotenv** — 환경변수 관리

---

## Lite판 기술 스택

- **JavaScript** (RisuAI Plugin API v3.0, 브라우저 sandboxed iframe)
- **`Risuai.addRisuReplacer('beforeRequest', ...)`** — LLM 호출 전 메시지 가로채기
- **`Risuai.nativeFetch()`** — 분석 에이전트 API 호출
- **`Risuai.getArgument()`** — 플러그인 설정값 읽기
- 빌드 불필요 — 단일 `.js` 파일을 RisuAI Plugin Settings에서 Import

Full판도 동일하게 `addRisuReplacer('beforeRequest')` 훅 방식이며,
차이는 분석 LLM 호출이 브라우저 직접(Lite) vs FastAPI 사이드카 경유(Full)라는 점뿐이다.
이전 버전의 `Risuai.addProvider` 기반 Custom AI Provider 구조는 폐기됐다 — 그 경로는
RisuAI 메인 모델 흐름을 통째로 가로채 본체 기능(캐릭터 카드/로어북/정규식 등)을 우회했기 때문.

---

## 에이전트 컨텍스트 전략

각 에이전트는 다음을 입력으로 받습니다:

```
[공유 요약본]
- 세계관 핵심 설정 (로어북에서 주입)
- 등장인물 설정 요약

[슬라이딩 윈도우]
- 최근 N개 메시지 (기본 10개)

[이전 에이전트 출력]
- 앞선 에이전트들의 분석/수정 내용 누적
```

토큰 효율을 위해 전체 히스토리가 아닌 **요약본 + 최근 N개** 방식을 사용합니다.

---

## 파이프라인 흐름

```
RisuAI 채팅 전송
  └→ [beforeRequest 훅 발동]
        └→ POST /analyze  (Full판 사이드카)
              └→ [세계관 에이전트]   → context_world
                    └→ [플롯 에이전트]     → context_plot
                          └→ [등장인물 에이전트] → context_char
        └→ system 프롬프트 끝에 3개 컨텍스트 주입
  └→ RisuAI가 메인 모델로 최종 응답 생성
```

분석 출력은 다음 에이전트의 입력에 **누적**된다. 최종 RP 응답은 RisuAI가 현재
선택한 메인 모델이 생성한다 (별도 검수 에이전트 없음).

---

## 작업 규칙

1. **이 파일(CLAUDE.md)과 docs/design.md를 항상 먼저 읽을 것**
2. `full/` 와 `lite/` 는 완전히 독립된 구현체. 공유 코드 없음.
3. Full판 `risu/` 디렉토리는 빌드 출력 — 직접 수정 금지
4. `.env` 파일은 절대 커밋하지 말 것 (`.env.example`만 커밋)
5. 에이전트 프롬프트 수정 시 `docs/agent-prompts.md` 동기화할 것

---

## 현재 상태

- [x] 프로젝트 구조 scaffold
- [x] Full판 — BaseAgent, config, models 구현
- [x] Full판 — 분석 에이전트 3개 구현 (검수 에이전트는 v2에서 제거됨)
- [x] Full판 — pipeline.py (`run_analysis`) 구현
- [x] Full판 — FastAPI `POST /analyze` 엔드포인트 구현
- [x] Full판 — 플러그인을 `addRisuReplacer('beforeRequest')` 훅 방식으로 전환 (v2.0.0)
- [x] Full판 — Docker 설정
- [ ] Full판 — 테스트
- [x] Lite판 — risu-multiagent.js 구현 (Plugin API v3.0)
- [ ] Lite판 — 실기기 테스트
