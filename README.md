# MARP · MultiAgent RP Pipeline

MARP v0.9.0은 세계관 분석 후 플롯·등장인물 분석을 병렬 실행하고, 성공한 분석 메모를 RisuAI 메인 모델에 전달합니다. 메인 모델이 최종 RP 답변을 작성합니다. 추가 검수 LLM 호출은 없습니다.

| 구성 | 실행 위치 | 설치 파일 |
| --- | --- | --- |
| Lite | 브라우저 JavaScript, PDF는 작업별 Worker | [multiagent-lite-v0.9.0.js](https://github.com/Sallos725/MARP/releases/download/v0.9.0/multiagent-lite-v0.9.0.js) |
| Full | 얇은 브라우저 플러그인 + Go 1.27.1 서버 | [multiagent-full-v0.9.0.zip](https://github.com/Sallos725/MARP/releases/download/v0.9.0/multiagent-full-v0.9.0.zip) |

[정식 릴리즈](https://github.com/Sallos725/MARP/releases/tag/v0.9.0) · [변경 내역](RELEASE_NOTES.md) · [기기별 확인 절차](MOBILE_TESTING.md)

## 설치와 업데이트

### Lite

릴리즈 JS를 RisuAI 플러그인에서 가져오거나 기존 플러그인과 교체합니다. 식별자 `risu_multiagent`와 자동 업데이트 주소는 유지됩니다. MARP Lite 설정의 공통 공급자·URL·credential·모델을 저장하세요. 세계관·플롯·등장인물 탭에서 각 값을 따로 지정할 수 있으며 빈 값은 공통 설정을 상속합니다.

기존 v0.8.x 설정 저장소와 프리셋을 읽습니다. 내장 PDF는 기본 `off`입니다. 기존 설정을 초기화하거나 플러그인 저장소를 삭제할 필요가 없습니다.

### Full · Docker

ZIP을 풀고 새 설치에서만 `.env.example`을 `.env`로 복사합니다. 기존 설치의 `.env`, `data/config.json`, `data/presets.json`과 Docker 데이터 볼륨은 그대로 사용합니다.

~~~sh
cp .env.example .env   # 새 설치에서만
docker compose pull
docker compose up -d
~~~

특정 버전은 `MULTIAGENT_VERSION=v0.9.0 docker compose up -d`로 고정합니다. 직접 빌드는 `docker compose up -d --build`를 사용합니다.

`plugin/multiagent-full-v0.9.0.js`를 RisuAI에 가져온 뒤 MARP Full 설정에서 서버 URL을 지정합니다. 기본 포트는 `6009`입니다. 모바일에서는 전화기 자신의 localhost 대신 서버에 접근할 수 있는 주소를 사용하세요.

기존 식별자 `risu_multiagent_full`, 서비스 이름, 이미지 이름 `ghcr.io/sallos725/risu-multiagent-full`, 데이터 경로, 자동 업데이트 파일명은 유지됩니다. Full 브라우저와 서버를 함께 업데이트하는 것을 권장합니다. 새 브라우저는 구버전 서버의 `/status`도 읽으며, 구버전 브라우저는 Go 서버의 기존 API를 사용할 수 있습니다. 내장 PDF와 새 진단은 새 서버가 필요합니다.

### Full · 실행 파일 또는 소스

Full ZIP에는 Linux amd64·arm64 실행 파일이 포함됩니다. `sh ./run.sh`는 해당 Linux 실행 파일을 선택합니다. Go가 있는 다른 환경에서는 Go 1.27.1 도구 체인으로 빌드합니다.

실행 파일만 필요하면 릴리즈의 `marp-v0.9.0-linux-amd64` 또는 `marp-v0.9.0-linux-arm64`와 `SHA256SUMS`를 받으세요. `--version`, `--healthcheck`를 지원합니다. 실행 시 `.env`를 읽고 기본 데이터 파일은 `data/config.json`과 `data/presets.json`입니다.

기본 URL 예시: OpenAI/Custom은 해당 서비스의 OpenAI 호환 URL, Anthropic은 https://api.anthropic.com/v1, Google은 https://generativelanguage.googleapis.com/v1beta/openai, Vertex는 https://LOCATION-aiplatform.googleapis.com/v1/projects/PROJECT/locations/LOCATION/endpoints/openapi 를 사용합니다. 모델 이름과 credential은 각 공급자에 맞게 지정하세요.

## 설정과 동작

- 공통값과 에이전트별 값: 공급자, API URL, credential, 모델, 온도, 출력 제한, 추가 JSON, PDF 수준.
- 에이전트별 ON/OFF와 system/user 프롬프트 override. override를 비우면 개선된 기본값을 사용합니다.
- 기본 최근 대화 수 10, 에이전트 제한 60초, 전체 제한 120초. Full은 대기열 시간도 전체 제한에 포함하며 기본 동시 분석 수는 4입니다. `max_concurrent_analyses` 변경은 서버 재시작 후 적용됩니다.
- 기본 Lenient는 성공한 결과만 사용합니다. 모두 OFF, 전체 실패, 빈 결과에는 주입하지 않습니다. Strict는 일부 실패에도 분석 주입을 중단합니다.
- 최근 사용자 입력 뒤의 assistant 메시지도 이어쓰기·재생성 분석에 포함됩니다. system 자료를 별도로 전달합니다.
- 배열 content, 첨부 파일, 캐시 메타데이터와 다른 플러그인의 메시지를 유지합니다. MARP 메모만 소유 마커로 찾아 교체합니다. 분석은 텍스트 자료를 사용하며 첨부 파일 원문을 별도로 해독하지 않습니다.
- 설정 화면은 먼저 틀을 표시하고 프롬프트·프리셋·진단을 탭 진입 시 읽습니다. 숨겨진 탭의 편집 값도 저장됩니다.
- 유휴 폴링과 자동 저장이 없습니다. `/runtime-config`는 작업할 때만 읽고 최대 60초 캐시하며 저장 후 갱신합니다. 최근 분석 진단은 메모리에만 보관합니다.
- 기존 JSON 설정이 있으면 `.env` 초기값보다 우선합니다. GUI 또는 `PUT /config`로 저장하세요. 저장은 잠금과 임시 파일 교체를 사용합니다. 분석 시작 시 하나의 설정 스냅샷을 사용합니다.
- 프리셋 JSON은 Full/Lite 상호 import가 가능하며 기존 v1 형식을 읽습니다. export에는 credential을 포함하지 않습니다.

## PDF와 PDF Pod

MARP Lite에서 내장 PDF를 사용한다면 PDF Pod의 해당 자식 플러그인 PDF 수준은 off로 두세요. PDF Pod가 텍스트 복귀 요청까지 다시 압축하지 않도록 보조 요청의 압축 주체를 하나만 선택합니다. Full의 서버 LLM 요청은 PDF Pod를 통과하지 않습니다.

[PDF Pod 소스](https://pkg.panpka.xyz/pdf-pod.js) v0.17.10의 요청 감지·기존 PDF 보호·자식 훅 동작을 기준으로 호환성을 맞췄습니다. 향후 PDF Pod 업데이트에는 변경된 동작을 확인해야 합니다.

**PDF Pod 병용 설정: API 감지 `auto`, OpenAI → Gemini 변환 `none`.** 이미 PDF가 포함된 요청을 다시 변환하지 않는 설정입니다. PDF Pod의 메인 대화 압축과 MARP의 보조 분석 압축은 각각 적용 범위가 다릅니다. MARP는 PDF Pod 내부 설정을 변경하지 않습니다.

| 내장 수준 | 동작 |
| --- | --- |
| `off` | 기존 텍스트 요청. 기존 설치의 기본값 |
| `quality` | 변환할 자료 앞부분 약 80%는 PDF, 나머지는 텍스트. 활성화 시 권장 |
| `standard` | system 지침은 텍스트, 대화 자료는 PDF |
| `max` | system도 PDF에 포함하고 외부에는 분석 작업 지시를 남김 |

| 공급자 | PDF 요청 |
| --- | --- |
| OpenAI / Custom | Chat Completions `file` 블록 |
| Google AI Studio | native Gemini `inlineData` PDF |
| Vertex Gemini | 서비스 계정 OAuth 인증 + native Gemini PDF |
| Anthropic | Messages API base64 `document` 블록 |

Google OpenAI 호환 URL과 Vertex `/endpoints/openapi` URL은 내장 PDF 사용 시 native Gemini URL로 변환합니다. 주소를 안전하게 결정할 수 없는 프록시나 변환할 수 없는 추가 JSON은 원래 텍스트 요청을 사용합니다. 텍스트 요청은 기존 공급자 URL을 유지합니다.

280토큰 추정 이하의 짧은 자료는 PDF를 생략합니다. UTF-8 변환 자료 1MiB, 생성 PDF 8MiB를 넘거나 생성에 실패하면 같은 자료를 텍스트로 보냅니다. 명확한 PDF 미지원 400/415/422 응답에만 텍스트로 한 번 재시도하며 인증 오류·429·일반 서버 오류에는 이 재시도를 하지 않습니다. PDF 작업과 복귀 요청도 분석 시간 제한에 포함됩니다.

Lite의 Worker는 작업 후 종료하고 Object URL을 회수합니다. Worker가 차단된 환경에서는 짧은 작업 단위로 나눠 처리합니다. Full은 PDF·프롬프트·LLM 요청을 서버에서 처리합니다.

PDF에는 Unicode 추출용 문자 매핑을 포함해 한글·일본어·이모지·역할·순서·줄바꿈을 보존합니다. 글꼴 파일은 포함하지 않아 시각 렌더링은 뷰어의 대체 글꼴에 의존합니다. 텍스트 추출을 지원하지 않고 렌더링만 사용하는 경로의 품질은 확인되지 않았습니다. **실제 비용 절감과 분석 품질은 모델별로 다릅니다. 진단 탭의 텍스트/PDF 테스트를 직접 실행해 비교하세요.** 평소에는 비교용 LLM 호출이 추가되지 않습니다.

PDF Pod가 자식 훅 예외를 흡수하면 Strict가 메인 호출을 차단한다고 보장할 수 없습니다. UI는 분석 실패와 주입 중단을 구분합니다.

## API와 개발

기존 `/health`, `/config`, `/status`, `/analyze`, `/test/llm`, `/presets`, `/prompts/defaults`, `/openapi.json`, `/docs`, `/redoc` 경로와 기본 JSON 필드를 유지합니다.

- `/runtime-config`: `context_window`, `request_timeout`, `analysis_timeout`, `revision`.
- `/analyze`: 기존 필드에 `diagnostics` 추가. 공급자의 실제 `usage`와 `estimated_source_tokens` 추정치를 구분합니다.
- 수동 테스트의 `/analyze.pdf_mode`는 해당 요청에만 적용하며 저장된 설정은 바꾸지 않습니다.
- HTTP 연결과 Vertex 토큰을 재사용합니다. Docker 실행 이미지는 정적 Go 실행 파일과 CA 인증서로 구성됩니다.

~~~sh
npm ci
npm run build
npm test
npm run check:size
GOTOOLCHAIN=go1.27.1 go -C full test -race ./...
GOTOOLCHAIN=go1.27.1 go -C full vet ./...
npx playwright install --with-deps chromium webkit
npm run test:browser
python3 scripts/package.py v0.9.0
~~~

배포 JS 대신 `src/`를 수정하고 esbuild로 생성하세요. esbuild·Playwright는 개발용이며 플러그인에 포함되지 않습니다. `tests/legacy-python/`은 v0.8.4 계약·성능 기준 보존용으로 실행 이미지와 ZIP에는 포함되지 않습니다.

CI는 JS/Go/race, 번들 크기, Chromium/WebKit, PDF Unicode 추출, 패키지와 Docker 두 아키텍처를 검사합니다. 태그의 GitHub Release와 Docker 게시 작업도 필수 검증을 통과해야 실행됩니다. 작업 브랜치와 main의 중간 커밋은 Docker/Release를 게시하지 않습니다.

## 복구

PDF 문제가 생기면 공통·에이전트 PDF를 `off`로 저장합니다. 전체 복구는 [v0.8.4 릴리즈](https://github.com/Sallos725/MARP/releases/tag/v0.8.4)의 JS/ZIP을 다시 가져오고 Docker 이미지를 `v0.8.4`로 고정합니다. 기존 `.env`, `config.json`, `presets.json`, RisuAI 플러그인 저장소는 삭제하지 마세요. v0.9.0 추가 필드는 구버전에서 사용하지 않으며 기존 필드와 데이터 경로는 보존됩니다.

로컬 프로젝트 디렉터리 이름은 `MARP`로 변경합니다. Git 원격 URL, 플러그인 ID와 업데이트 경로는 디렉터리명에 의존하지 않습니다. 상위 Compose는 `./MARP/full`, 상위 ignore는 `/MARP/`를 사용합니다.
