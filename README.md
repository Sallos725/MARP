# MARP · MultiAgent RP Pipeline

MARP는 세계관을 분석한 뒤 플롯·등장인물 분석을 병렬로 실행하고, 분석 메모를 RisuAI 메인 모델에 전달합니다. 최종 RP 답변은 메인 모델이 작성합니다.

**v0.9.1에서는 워터폴 UI, 연결 테스트, 최근 호출 기록을 Lite·Full 모두에서 사용할 수 있습니다.**

[릴리즈 노트](https://github.com/Sallos725/MARP/releases/tag/v0.9.1) · [진단 화면 사용법](guides/DIAGNOSTICS.md) · [전체 변경 내역](RELEASE_NOTES.md)

## 다운로드

| 사용 방식 | 받을 파일 | 실행 위치 |
| --- | --- | --- |
| Lite | [multiagent-lite-v0.9.1.js](https://github.com/Sallos725/MARP/releases/download/v0.9.1/multiagent-lite-v0.9.1.js) | RisuAI 브라우저 플러그인 |
| Full | [multiagent-full-v0.9.1.zip](https://github.com/Sallos725/MARP/releases/download/v0.9.1/multiagent-full-v0.9.1.zip) | 브라우저 플러그인 + 별도 서버 |

Full ZIP에는 플러그인, Docker 구성, Linux amd64·arm64 실행 파일과 사용 문서가 들어 있습니다. 실행 파일만 필요하면 [릴리즈 첨부 파일](https://github.com/Sallos725/MARP/releases/tag/v0.9.1)에서 해당 아키텍처와 `SHA256SUMS`를 받습니다.

## 설치·업데이트

### Lite

1. 위 JS를 받아 RisuAI 플러그인에서 가져오거나 기존 MARP Lite를 교체합니다.
2. MARP **공통** 탭에서 공급자·API URL·credential·모델을 설정하고 저장합니다. 기존 사용자는 저장된 설정을 그대로 사용합니다.
3. **연결 테스트**와 **진단** 탭에서 동작을 확인합니다.

### Full · Docker

새 설치는 ZIP을 풀고 `.env.example`을 `.env`로 복사합니다. 기존 설치는 서버·플러그인을 함께 업데이트하되 **`.env`, `data/`와 Docker 데이터 볼륨을 유지**합니다.

설치 폴더에서 실행합니다.

```sh
MULTIAGENT_VERSION=v0.9.1 docker compose pull
MULTIAGENT_VERSION=v0.9.1 docker compose up -d
```

ZIP의 `plugin/multiagent-full-v0.9.1.js`를 RisuAI에 가져오고 MARP **공통** 탭에서 서버 URL을 지정합니다. 기본 포트는 `6009`입니다. 휴대전화에서는 휴대전화의 localhost가 아닌 서버에 접근할 수 있는 주소를 입력합니다.

직접 소스에서 빌드하려면 `docker compose up -d --build`를 사용합니다. 사용자 지정 `MULTIAGENT_IMAGE`를 쓰고 있다면 해당 이미지의 버전도 함께 확인합니다.

### Full · 실행 파일

Linux에서는 ZIP을 푼 뒤 `sh ./run.sh`를 실행하면 아키텍처에 맞는 포함 실행 파일을 사용합니다. 새 설치에서만 `.env.example`을 `.env`로 복사합니다. 다른 환경의 소스 빌드는 Go 1.27.1이 필요합니다.

플러그인 ID와 자동 업데이트 주소, Docker 이미지 이름·서비스 이름·데이터 경로는 유지됩니다. v0.8.x 프리셋도 가져올 수 있습니다. Full 구버전 서버는 기존 응답으로 동작하며, 정확한 단계 시작 시각을 보려면 서버도 v0.9.1로 업데이트합니다.

## 새 진단 화면

| 탭 | 확인할 수 있는 내용 |
| --- | --- |
| 워터폴 | 최근 분석의 단계별 소요 시간, 병렬 실행, 성공·실패·OFF |
| 연결 테스트 | 전체·개별 에이전트의 인증·모델 조회 API 연결, Full 서버 상태 |
| 호출 기록 | 최근 50건, 종류·실패 필터, 상세 결과, JSON 내보내기·비우기 |
| 진단 | 합성 자료로 실행하는 텍스트·PDF 분석 테스트 |

연결 검사는 LLM 응답을 생성하지 않습니다. **진단의 분석 테스트는 실제 LLM을 호출**하며 결과를 대화에 주입하지 않습니다. Lite는 현재 편집값, Full은 입력한 서버 URL에 저장된 공급자 설정으로 테스트합니다.

기록은 현재 플러그인 세션의 메모리에 보관하고 재로드하면 초기화됩니다. 결과 미리보기는 에이전트당 앞 2,000자이며 JSON 내보내기에 포함됩니다. 자동 폴링과 자동 저장은 없습니다. [상세 사용법과 상태 표시](guides/DIAGNOSTICS.md)를 참고하세요.

## 설정·PDF 안내

공통 설정은 에이전트별로 덮어쓸 수 있고 빈 값은 공통값을 상속합니다. 기본 Lenient는 성공한 결과를 사용하고 Strict는 일부 실패에도 분석 주입을 중단합니다. 내장 PDF는 기본 `off`입니다.

PDF Pod 병용 설정은 **API 감지 `auto` · OpenAI → Gemini 변환 `none`**입니다. Lite 내장 PDF를 켜면 PDF Pod의 MARP 자식 PDF 수준을 `off`로 둡니다. Full의 서버 요청은 PDF Pod를 통과하지 않습니다.

- [공급자·설정·실패 처리](guides/SETTINGS.md)
- [내장 PDF 수준·텍스트 복귀·PDF Pod 병용](guides/PDF.md)
- [워터폴·테스트·호출 기록](guides/DIAGNOSTICS.md)
- [개발·API·패키지 빌드](guides/DEVELOPMENT.md)
- [자동 검증 범위·실제 기기 점검](MOBILE_TESTING.md)

## 이전 버전으로 되돌리기

UI 업데이트 후 문제가 생기면 [v0.9.0](https://github.com/Sallos725/MARP/releases/tag/v0.9.0)의 플러그인으로 교체하고 Full Docker는 `MULTIAGENT_VERSION=v0.9.0`으로 위 명령을 실행합니다. 설정 파일과 데이터 볼륨은 유지합니다. v0.9.0 이전 구성으로 복귀하는 방법은 [전체 변경 내역](RELEASE_NOTES.md)에 있습니다.
