# MARP 변경 내역

## MARP v0.9.7 — 2026-09-25

설정 화면 색감을 바꾸고, 분석이 어디까지 진행됐는지 채팅 화면에서 바로 볼 수 있는 진행 표시를 추가했습니다.

- **새 테마**: 설정 화면을 심해 네이비 + 골드로 바꿨습니다. 스위치형 토글과 알약형 탭을 씁니다.
- **채팅 화면 진행 표시**: 오른쪽 위에 분석 진행과 결과(주입 · 실패 · 결과 없음 · 캐시 재사용)를 띄웁니다. 공통 탭에서 켜며 기본값은 꺼짐입니다. NMOS 진행 표시와 겹치면 그 아래로 비켜 섭니다.

[다운로드·업데이트 안내](https://github.com/Sallos725/MARP/releases/tag/v0.9.7) · [진행 표시 사용법](README.md#채팅-화면-진행-표시)

## MARP v0.9.6 — 2026-09-24

메인 generation 실패 후 같은 요청을 재전송할 때 성공한 분석 결과를 재사용해 World/Plot/Character 보조 호출이 다시 과금되지 않도록 했습니다.

- **재시도 캐시**: 입력과 분석 설정이 같은 성공 결과를 현재 플러그인 세션 메모리에 최대 10분·최근 8건까지 보관합니다. 대화나 영구 저장소에는 쓰지 않습니다.
- **정확한 무효화**: 사용자 입력·최근 대화·system 자료·분석 언어·모델·프롬프트 등 분석 조건이 바뀌면 새로 분석합니다. 실패·부분 실패·빈 결과도 캐시하지 않습니다.
- **동시 요청 합류**: 같은 분석이 진행 중이면 별도 World/Plot/Character 호출을 시작하지 않고 기존 작업을 함께 기다립니다.
- **진단 표시**: 워터폴과 호출 기록에 `분석 캐시 재사용` 또는 `동일 분석 요청에 합류`를 표시합니다.
- Lite와 설정 revision을 제공하는 Full 서버에서 동작합니다. revision이 없는 구버전 Full 서버는 안전을 위해 재사용하지 않습니다.

[다운로드·업데이트 안내](https://github.com/Sallos725/MARP/releases/tag/v0.9.6) · [캐시 동작과 설정](guides/SETTINGS.md)

## MARP v0.9.5 — 2026-09-23

PDF Pod 안내 문구를 PDF Pod 0.17.10 실제 화면 표기에 맞추고, 화면 순서대로 따라 할 수 있는 안내 문서를 추가했습니다.

- **안내 문구 수정**: `API 형식 변환 끄기, PDF 압축 수준 끄기`처럼 PDF Pod 설정 화면에 보이는 이름 그대로 안내합니다. PDF Pod 목록에 보이는 MARP 이름(**MultiAgent RP Pipeline**)도 함께 표시합니다.
- **새 문서**: [PDF Pod 안에서 MARP Lite 쓰기](guides/PDF-POD.md). 불러오기부터 설정 변경과 확인까지 스크린샷으로 설명합니다. 스크린샷은 실제 PDF Pod 0.17.10 안에서 MARP Lite를 실행해 찍었습니다.
- 분석 동작과 Full 서버는 바뀌지 않았습니다.

[다운로드·업데이트 안내](https://github.com/Sallos725/MARP/releases/tag/v0.9.5) · [PDF Pod 화면 안내](guides/PDF-POD.md)

## MARP v0.9.4 — 2026-09-23

PDF Pod 안에서 MARP Lite를 쓸 때 분석이 조용히 실패하던 문제를 화면에서 바로 알 수 있게 했습니다.

- **PDF Pod 연동 카드**: 공통 탭에서 에이전트별로 PDF Pod 기본 설정에서도 동작하는지 표시하고, 필요하면 `API 형식 변환 끄기, PDF 압축 수준 끄기`를 안내합니다. PDF Pod 밖에서는 표시하지 않습니다.
- **조치 안내**: PDF Pod 안에서 분석이 실패하거나, 연결 테스트는 성공했지만 실제 분석이 실패할 설정이면 워터폴·호출 기록·연결 테스트에 같은 조치를 표시합니다.
- **저장 공간 안내**: PDF Pod는 자식 플러그인마다 저장 공간을 나누므로, 단독 설치 때 설정이 보이지 않으면 다시 입력하도록 안내합니다.
- Full 서버와 분석 동작은 바뀌지 않았습니다. Full 사용자는 업데이트하지 않아도 됩니다.

[다운로드·업데이트 안내](https://github.com/Sallos725/MARP/releases/tag/v0.9.4) · [PDF Pod 병용 안내](guides/PDF.md)

## MARP v0.9.2 — 2026-09-14

**MARP Lite / MARP Full** 메뉴 아이콘을 캐릭터 목록 쪽에서 채팅 입력창 왼쪽 햄버거 메뉴로 옮겼습니다. 플러그인 설정 진입은 유지합니다.

- 캐릭터 목록 쪽 메뉴의 MARP 항목을 제거했습니다. 채팅 입력창 메뉴에서 UI를 열고 플러그인 해제 시 항목을 정리합니다.
- v0.9.1 Full 서버 사용자는 브라우저 플러그인만 업데이트해도 새 메뉴를 사용할 수 있습니다. 서버 분석 동작은 그대로입니다.
- Lite·Full 실제 배포 번들의 메뉴 진입과 해제 처리를 Chromium·WebKit 자동 검사에 포함했습니다.

[다운로드·업데이트 안내](https://github.com/Sallos725/MARP/releases/tag/v0.9.2) · [UI 사용법](guides/DIAGNOSTICS.md)

## MARP v0.9.1 — 2026-09-14

Lite·Full의 워터폴 UI, 연결 테스트, 최근 호출 기록을 복원했습니다. 기존 설정과 프리셋을 유지합니다.

- **워터폴**: 단계별 시작 시각·소요 시간·성공/실패/OFF. 구버전 Full 서버는 기존 지연 시간으로 추정한 위치를 표시합니다.
- **연결 테스트**: 전체·개별 에이전트의 인증·모델 조회 API 검사와 Full 서버 상태 확인. LLM 응답 생성 없이 검사하며 Vertex는 OAuth 인증을 확인합니다.
- **호출 기록**: 현재 세션의 최근 50건, 필터·상세·JSON 내보내기·비우기. 결과 미리보기는 에이전트당 2,000자이며 재로드하면 초기화됩니다.
- **진단**: 텍스트/PDF 분석 테스트를 기록과 연결하고 늦은 결과가 다른 탭을 덮어쓰지 않도록 처리합니다. 시간 초과와 연결 오류 HTTP 코드도 기록합니다.
- **문서**: README는 다운로드·업데이트 중심으로 정리하고 진단·설정·PDF·개발 안내를 분리했습니다. Full ZIP에도 안내 문서를 포함합니다.

**업데이트:** Lite는 새 JS로 교체합니다. Full은 서버와 ZIP의 플러그인을 함께 업데이트하고 기존 `.env`, `data/`와 Docker 볼륨을 유지합니다. `MULTIAGENT_VERSION=v0.9.1`로 `docker compose pull`과 `docker compose up -d`를 실행합니다.

[다운로드와 자세한 릴리즈 노트](https://github.com/Sallos725/MARP/releases/tag/v0.9.1) · [진단 화면 사용법](guides/DIAGNOSTICS.md) · [설치 안내](README.md)

자동 검증 범위는 JS·Go/race/vet·Chromium/WebKit·패키지 설치입니다. 실제 휴대전화·유료 공급자 확인은 [별도 점검 항목](MOBILE_TESTING.md)으로 남아 있습니다. 아래 v0.9.0 성능 수치는 해당 버전의 과거 측정값입니다.

## MARP v0.9.0 — 2026-09-12

Full 서버를 Python에서 Go 1.27.1 + net/http로 전환하고 Lite/Full 브라우저 코드를 모듈화했습니다. 모바일의 시작 비용·메모리·대화 직렬화를 줄이면서 기존 3개 에이전트와 공급자를 유지합니다.

### 주요 변경

- 세계관 분석 후 플롯·등장인물 병렬 실행. 확정 사실·제약·추측을 구분하고 최종 RP 본문을 대신 작성하지 않는 기본 프롬프트.
- 자체 메모의 소유 마커 교체, 구조화 메시지·첨부·캐시 metadata 보존, 이어쓰기/재생성 최신 assistant와 Full system_context 누락 수정.
- Full은 서버 context_window에 맞춰 최근 이력만 전송. /runtime-config 최대 60초 활동 기반 캐시 및 구버전 /status 대체.
- 네이티브 DOM/CSS 설정 화면, 탭별 조회, DOM과 분리한 편집 상태. 유휴 네트워크·저장 타이머 제거.
- 두 에디션 모두 에이전트별 공급자·모델·credential·온도·출력 제한·추가 JSON·PDF override. 기존 설정·프리셋 import, credential을 제외한 export.
- Unicode 텍스트 PDF와 OpenAI/Custom file, Google/Vertex native PDF, Anthropic document 전송. Lite는 작업별 Worker와 분할 실행 대체 경로.
- PDF off/quality/standard/max. 기존 설치는 off, 활성화 권장값 quality. 280토큰 추정 이하 생략, 입력 1MiB/PDF 8MiB 제한, 실패 시 원래 자료로 텍스트 복귀. 명확한 PDF 미지원 응답에만 한 번 재시도.
- 기본 Lenient는 성공한 결과만 사용. 전체 OFF/전체 실패/빈 결과는 주입하지 않음. Strict는 분석 주입 중단을 표시하며 PDF Pod 환경의 메인 호출 차단을 보장하지 않음.
- 에이전트 60초/전체 120초, Full 대기열 포함, 기본 동시 분석 4. 연결·Vertex OAuth 토큰 재사용, 원자 저장과 분석별 설정 스냅샷.
- 실제 usage와 추정 진단 구분. 비교용 LLM 호출은 진단 테스트 버튼을 누를 때만 수행.
- 정적 Go 이미지, amd64/arm64 실행 파일·이미지, 기존 Lite JS/Full ZIP 이름과 SHA256SUMS. 필수 CI 뒤에만 정식 Release/Docker 게시.

### 측정 결과

Linux x86_64의 합성 자료·가짜 LLM·모의 RisuAI 호스트에서 측정했습니다. 기기·공급자별 실사용 성능을 뜻하지 않습니다.

| 항목 | v0.8.4 | v0.9.0 측정 |
| --- | --- | --- |
| Lite 배포 JS, 비압축 | 125,540B | 48,969B |
| Full 배포 JS, 비압축 | 120,131B | 32,462B |
| 서버 준비 시간 | 286.33ms | 14.86ms |
| 서버 유휴 RSS | 49.7MiB | 8.5MiB |
| Chromium CPU 4배, 설정 틀 p95 | 미측정 | Lite 5.2ms / Full 2.7ms |
| WebKit 설정 틀 p95 | 미측정 | Lite 2ms / Full 1ms |
| 20회 분석 + PDF 반복 후 GC 잔류 증가 | 미측정 | Lite 90,188B / Full 51,832B |
| Worker / Object URL / abort 리스너 누적 | 미측정 | 0 |
| Chromium PDF 메인 스레드 50ms 이상 작업 | 미측정 | 0 |
| MARP 유휴 네트워크·저장 작업 | 미측정 | 0 |

1,000개 합성 대화의 Full JSON은 최근 10개만 전송할 때 7,045,594B에서 84,409B로 감소했습니다(기준 측정 98.8%). 원시 측정 조건은 tests/fixtures/v0.9.0-performance.json, 재현 절차는 MOBILE_TESTING.md를 참고하세요. 설정 p95는 20회 열기 기준이며 네트워크 완료는 제외합니다. WebKit의 힙/Long Tasks 수치는 측정하지 않았습니다. PDF Pod 자체 비용은 위 수치에 포함하지 않았습니다.

### 업데이트와 데이터 보존

Lite는 multiagent-lite-v0.9.0.js로 교체합니다. Full은 multiagent-full-v0.9.0.zip과 plugin 폴더의 JS를 함께 업데이트하고 컨테이너를 재생성합니다. Linux 실행 파일은 ZIP의 run.sh 또는 별도 다운로드를 사용할 수 있습니다.

기존 .env, config.json, presets.json, Docker 볼륨과 RisuAI 플러그인 저장소를 삭제하지 마세요. 기존 JSON 설정이 .env 초기값보다 우선합니다. Python 코드는 tests/legacy-python으로 이동했고 실행 패키지에 포함하지 않습니다. Go 모듈 캐시는 개발/빌드에만 필요합니다.

구버전 플러그인+Go 서버의 기존 API 필드를 유지하고, 새 Full 플러그인은 구버전 서버의 /status로 대체합니다. 내장 PDF·신규 진단은 새 서버가 필요합니다. Full max_concurrent_analyses는 변경 후 재시작합니다.

PDF Pod v0.17.10 병용 권장 설정은 API 감지 auto, OpenAI→Gemini 변환 none입니다. MARP 내장 PDF는 보조 분석 요청, PDF Pod의 메인 대화 압축은 별도 범위입니다. 기존 PDF를 다시 변환하지 않도록 해당 설정을 유지하세요.

### 검증 범위와 제약

MARP Lite에서 내장 PDF를 사용한다면 PDF Pod의 해당 자식 플러그인 PDF 수준은 off로 두세요. PDF Pod가 텍스트 복귀 요청까지 다시 압축하지 않도록 보조 요청의 압축 주체를 하나만 선택합니다. Full의 서버 LLM 요청은 PDF Pod를 통과하지 않습니다.

JS 회귀 검사, Go 테스트/race/vet, Chromium·WebKit 자동 검사, 독립 pypdf Unicode 추출, Docker amd64/arm64 교차 빌드 및 ZIP 구조/CRC를 검사했습니다. 실제 모바일 Safari·Android Chrome, 실제 RisuAI+PDF Pod 전체 실행, 유료 공급자별 품질·토큰 청구와 ARM64 실제 기기 실행은 자동 검사와 구분한 미확인 항목입니다.

PDF에는 Unicode 추출 매핑이 있지만 글꼴 파일을 내장하지 않습니다. 시각 렌더링은 뷰어의 대체 글꼴에 의존하며 CJK가 네모로 보이는 뷰어가 있습니다. 렌더링만 사용하는 공급자 경로의 품질과 비용 절감은 보장하지 않습니다. 처음에는 off를 유지하고 진단 탭에서 해당 모델의 텍스트/PDF 결과를 비교하세요.

호스트의 nativeFetch가 취소를 전달하지 못하면 이미 전송한 공급자 요청 자체는 끝까지 실행될 수 있습니다. MARP는 시간 제한·해제 후 결과를 폐기하고 Worker·리스너·타이머를 정리합니다. PDF Pod는 자식 훅 예외를 흡수할 수 있어 Strict에서도 메인 요청이 진행될 수 있습니다.

### 디렉터리와 복구

로컬 경로를 /home/grantkim725/data/docker/risuaiNode/MARP로 변경합니다. 상위 Compose는 ./MARP/full, 상위 .gitignore는 /MARP/로 바꿉니다. 상위 저장소의 기존 미커밋 작업과 미푸시 커밋은 그대로 보존하고 경로 변경만 원격 기준의 별도 작업 공간에서 커밋합니다. 기존 origin/github URL, 플러그인 식별자·업데이트 파일명, Docker 데이터 경로는 변경하지 않습니다.

문제 발생 시 PDF를 off로 되돌립니다. 전체 복구는 v0.8.4 JS/ZIP과 Docker 이미지 v0.8.4를 사용하고 기존 데이터 파일을 유지합니다. v0.9.0 추가 필드는 구버전이 사용하지 않으며 기존 데이터 구조는 유지됩니다.

# v0.8.4 Release Notes

## Summary

v0.8.4 is a focused safety/cleanup release for both Lite and Full. It prevents model thinking/reasoning traces from being injected into the MultiAgent RP Analysis Context.

## Fixed

- Strips `<｜begin▁of▁thinking｜>...<｜end▁of▁thinking｜>` style blocks from auxiliary agent outputs.
- Strips `<think>...</think>`, `<thinking>...</thinking>`, and `<reasoning>...</reasoning>` style blocks.
- Adds cleanup in Lite immediately after provider response extraction and again before context injection.
- Adds cleanup in Full sidecar LLM output handling and again in the Full browser plugin before recording/injecting context.

## Why This Matters

Some reasoning models can return hidden-analysis text as visible message content through OpenAI-compatible endpoints. When that leaked into `[MultiAgent RP Analysis Context]`, downstream worldbuilding or main RP generation could treat the reasoning trace as story content and start an unintended continuation.

## Compatibility

- No configuration migration is required.
- Existing Lite and Full settings remain compatible.
- This release only removes thinking/reasoning wrapper blocks from auxiliary agent notes; normal bullet-point analysis notes are preserved.

## Verification

- `node --check lite/risu-multiagent.js`
- `node --check full/plugin/risu-multiagent-full.js`
- `python -m compileall full/app`
