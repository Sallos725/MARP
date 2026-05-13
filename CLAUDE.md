# risu-multiagent — Claude Code 핸드오프 문서

> 새 세션 시작 시 이 파일을 **가장 먼저** 읽으세요.

---

## 프로젝트 개요

RisuAI용 멀티 에이전트 RP 파이프라인.
유저 입력을 4개의 전문 에이전트가 순차 처리하여 설정 일관성과 서사 품질을 높입니다.

**에이전트 순서:**
1. 세계관 에이전트 — 세계 설정 일관성 체크 및 보강
2. 플롯 에이전트 — 서사 흐름 관리
3. 등장인물 에이전트 — 캐릭터 성격/말투 유지
4. 검수 에이전트 — 설정 오류 감지 (메인 역할), 최종 응답 생성

---

## 두 가지 구현체 (독립, 양자택일)

| | Lite판 | Full판 |
|---|---|---|
| 위치 | `lite/` | `full/` |
| 동작 방식 | RisuAI Lua 내장 | FastAPI + Docker |
| 모델 지정 | RisuAI 설정에 종속 | 엔드포인트/모델/키 자유 지정 |
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
├── lite/                       ← Lite판 (RisuAI 내장)
│   ├── build.ps1               ← 빌드 스크립트
│   ├── lua/
│   │   ├── 01_config.lua       ← 커스텀 엔드포인트 설정 (선택)
│   │   ├── 02_pipeline.lua     ← 에이전트 순차 파이프라인
│   │   ├── 03_agents.lua       ← 각 에이전트 호출 로직
│   │   └── 04_output.lua       ← 응답 후처리
│   ├── lorebook/
│   │   └── agent_system_prompts.json
│   ├── globalnote/
│   │   └── 01_system.txt
│   ├── regex/
│   │   └── 001_cleanup.json
│   └── risu/                   ← 빌드 출력 (직접 수정 금지)
│
└── full/                       ← Full판 (FastAPI + Docker)
    ├── docker-compose.yml
    ├── Dockerfile
    ├── .env.example
    ├── requirements.txt
    └── app/
        ├── main.py             ← FastAPI 엔트리포인트
        ├── config.py           ← 설정 로드 (env)
        ├── pipeline.py         ← 순차 파이프라인 오케스트레이터
        ├── models.py           ← Pydantic 요청/응답 모델
        └── agents/
            ├── __init__.py
            ├── base.py         ← BaseAgent 추상 클래스
            ├── worldbuilding.py
            ├── plot.py
            ├── character.py
            └── reviewer.py
```

---

## 개발 순서

1. **Full판 먼저** 개발 — Python으로 파이프라인 로직 확정
2. **Lite판** — Full판 로직을 Lua로 포팅

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

- **Lua** (RisuAI 내장 Lua 5.4)
- **RisuAI CBS** — 변수/조건 템플릿
- RisuAI API: `LLM()`, `axLLM()`, `simpleLLM():await()`
- 빌드: `build.ps1` (PowerShell)

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
유저 입력
  └→ [세계관 에이전트]
        └→ context_world: 세계관 일관성 메모
            └→ [플롯 에이전트]
                  └→ context_plot: 플롯 방향 메모
                      └→ [등장인물 에이전트]
                            └→ context_char: 캐릭터 보정 메모
                                └→ [검수 에이전트]
                                      └→ 설정 오류 감지
                                          └→ 최종 응답
```

각 에이전트의 출력은 다음 에이전트의 컨텍스트에 **누적**됩니다.
최종 응답은 검수 에이전트가 생성합니다.

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
- [ ] Full판 — BaseAgent, config, models 구현
- [ ] Full판 — 4개 에이전트 구현
- [ ] Full판 — pipeline.py 구현
- [ ] Full판 — FastAPI main.py 구현
- [ ] Full판 — Docker 설정
- [ ] Full판 — 테스트
- [ ] Lite판 — Lua 파이프라인 포팅
- [ ] Lite판 — 로어북/글로벌노트 작성
- [ ] Lite판 — 빌드 스크립트
