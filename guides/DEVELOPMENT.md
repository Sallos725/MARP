# 개발·빌드·배포

[처음으로](../README.md) · [기기별 점검](../MOBILE_TESTING.md)

## 소스와 산출물

- `src/`: Lite·Full 공통 설정·화면·진단, Lite 공급자와 분석 코드.
- `full/`: Go 1.27.1 서버와 Docker 구성.
- `lite/risu-multiagent.js`, `full/plugin/risu-multiagent-full.js`: esbuild 생성물. 직접 편집하지 않습니다.
- `tests/legacy-python/`: v0.8.4 계약·성능 기준 보존용. 실행 이미지·ZIP에 포함하지 않습니다.

## 검증

```sh
npm ci
npm run build
npm test
npm run check:size
GOTOOLCHAIN=go1.27.1 go -C full test -race ./...
GOTOOLCHAIN=go1.27.1 go -C full vet ./...
npx playwright install --with-deps chromium webkit
npm run test:browser
python3 scripts/package.py
python3 tests/install_package.py dist
```

Playwright 라이브러리를 호스트에 설치할 수 없는 경우 같은 버전의 공식 컨테이너로 실행할 수 있습니다.

```sh
docker run --rm --network none --shm-size=1g   --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work   mcr.microsoft.com/playwright:v1.58.2-noble node tests/browser.mjs
```

컨테이너 검사는 모의 호스트와 합성 자료만 사용합니다. 실제 RisuAI·유료 공급자·실제 휴대전화 검증은 [기기별 점검](../MOBILE_TESTING.md)에서 구분합니다.

## Full API

기존 `/health`, `/config`, `/status`, `/analyze`, `/test/llm`, `/presets`, `/prompts/defaults`, `/openapi.json`, `/docs`, `/redoc` 경로와 기본 JSON 필드를 유지합니다.

- `/runtime-config`: `context_window`, `request_timeout`, `analysis_timeout`, `revision`.
- `/analyze`: `context_world`, `context_plot`, `context_char`, `errors`, `latency_ms`, `diagnostics`.
- v0.9.1 단계 진단: `start_offset_ms`, `duration_ms`, `provider`, `model`. 구버전 서버 응답에서는 생략될 수 있습니다.
- 수동 `/analyze.pdf_mode`는 해당 요청에만 적용하고 저장 설정을 바꾸지 않습니다.
- `/test/llm`의 `results`는 기존 형식을 유지하며 OFF 목록은 별도 `skipped` 필드로 제공합니다. 연결 오류도 HTTP `status_code`를 보존합니다.

## 릴리즈

`package.json`의 버전과 JS 헤더·`src/core.js`·Go `Version`·`full/run.sh`·설치 검증의 버전을 맞춥니다. 빌드한 두 플러그인을 커밋합니다. 패키지 스크립트는 지정된 태그가 소스 버전과 일치하는지 검사하고 Linux amd64·arm64 실행 파일, Lite JS, Full ZIP, SHA256SUMS를 생성합니다. Full ZIP에는 이 문서 묶음도 포함합니다.

`.github/release-notes/vX.Y.Z.md`에 사용자용 릴리즈 노트를 작성합니다. 완성된 본문은 첫 줄의 `<!-- complete-release-notes -->`로 지정하며 다운로드 링크·업데이트 방법을 포함합니다.

태그를 게시하면 GitHub Release와 GHCR Docker 게시가 각각 CI 검증 후 실행됩니다. CI는 생성물 일치, JS/Go/race/vet, 브라우저, PDF Unicode 추출, 패키지 설치, Docker 두 아키텍처를 검사합니다. 일반 브랜치 커밋은 Release·Docker를 게시하지 않지만 `main`의 플러그인 파일은 자동 업데이트 주소로 사용되므로 릴리즈 검증 후 갱신합니다.
