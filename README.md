# Paseo Session triage

[Paseo](https://paseo.sh)의 세션을 🔴 오류, ❓ 응답 필요, 📤 보내기 대기, 🟠 확인 필요, 👀 결과 확인 중, ⏳ 작업 중, ✅ 완료로 묶어 보여주는 로컬 플러그인입니다. [claude-session-triage](https://github.com/chaenmasahiro0425/claude-session-triage)의 작업 순서 표시 아이디어에서 출발했으며 구현은 Paseo용으로 새로 작성했습니다.

Paseo 카탈로그에는 이미 [Agent Monitor](https://paseo.sh/plugins/omercnet/agent-monitor)가 있습니다. 이 플러그인은 에이전트의 상태와 권한 요청을 중심으로 Attention, Running, Idle, Closed를 보여주고 아카이브 기능을 제공합니다. Session triage는 최근 응답을 읽어 **보내기 대기**와 **결과 확인 중**을 따로 추정하며, 아카이브 기능은 없습니다.

## 이모지 뜻

| 표시 | 의미 |
| --- | --- |
| 🔴 오류 | Paseo가 에이전트 오류 상태 또는 마지막 오류를 보고했습니다. 오류 내용을 확인하세요. |
| ❓ 응답 필요 | 대기 중인 권한 요청이 있거나 사람의 판단·확인을 명시적으로 요청했습니다. 직접 답해주세요. |
| 📤 보내기 대기 | 보내거나 게시할 초안이 준비된 것으로 보입니다. 검토 후 직접 전송하세요. |
| 🟠 확인 필요 | 미완료이거나 최근 상태가 불명확합니다. 세션을 확인하세요. |
| 👀 결과 확인 중 | CI·빌드·테스트·배포·리뷰 같은 외부 결과를 기다리는 것으로 보입니다. |
| ⏳ 작업 중 | 에이전트가 현재 턴을 실행 중이거나 초기화 중입니다. |
| ✅ 완료 | 최근 응답에 완료 표현이 있습니다. 실제 결과는 직접 확인하세요. |

권한 요청은 Paseo에 실제로 대기 중인 요청을 기준으로 합니다. 대화 속 판단·확인 요청은 문구를 바탕으로 추정합니다. ✅도 빌드·테스트·제출 결과를 검증했다는 뜻은 아닙니다.

## 로컬 설치

Paseo 0.11.4 이상에서 플러그인이 활성화되어 있어야 합니다. 이 저장소의 절대 경로로 설치합니다.

```sh
npm install --ignore-scripts
npm run typecheck
npm test
paseo plugin add /absolute/path/to/paseo-session-triage
paseo plugin ls session-triage
```

macOS 앱에 CLI가 `PATH`로 등록되지 않은 경우 `/Applications/Paseo.app/Contents/Resources/bin/paseo`를 사용합니다. 설치 후 사이드바의 **세션 확인**에서 목록을 엽니다. **Settings → Plugins → Session triage → Session triage 설정**에서 하위 에이전트 포함 여부와 최대 세션 수를 정합니다.

로컬 소스를 수정한 뒤에는 다음 명령으로 로드된 플러그인을 갱신합니다.

```sh
paseo plugin reload session-triage
paseo plugin logs session-triage
```

## 동작과 제한

- 기본값은 최근 최상위 세션 20개입니다. 화면이나 사이드바가 열려 있는 동안 1분마다 상태를 요청하고, 변경 이벤트가 있거나 마지막 확인에서 15분이 지나면 세션을 다시 읽습니다.
- 진행 중인 턴, 권한 요청, 오류는 Paseo 상태를 우선합니다. 그 밖의 세션은 최근 타임라인 항목 24개 이내에서 마지막 사용자 요청 이후의 응답을 읽습니다. 변경이 없는 세션은 이 읽기를 반복하지 않습니다.
- 메시지의 초안·전송, CI·빌드 대기, 사람의 승인·결정, 완료 표현을 규칙으로 분류합니다. 명시적인 사람의 응답 요청은 ❓, 애매하거나 최근 대화를 읽지 못하면 🟠로 표시합니다. 🔴는 Paseo가 보고한 에이전트 오류에 사용합니다. 판정은 검증 결과가 아닙니다.
- 이름 자동 갱신은 기본적으로 꺼져 있습니다. 켜면 세션 이름에는 이모지와 작업 폴더를, Paseo 고정 목록에 표시되는 워크스페이스 이름에는 이모지를 붙입니다. 세션 이름은 `PASEO_CLI_PATH` 환경 변수 또는 설치된 Paseo CLI로 갱신하고, 워크스페이스 이름은 Paseo API로 갱신합니다. 기존 제목의 본문은 남기지만, 기능을 다시 끈다고 이전 이름을 자동 복원하지는 않습니다. 각 이름은 한 번에 최대 10개씩 갱신합니다.
- 메시지 전송, 승인, 중단, 삭제, 아카이브 기능은 없습니다. 대화 내용은 별도 모델이나 외부 API로 전송하지 않고, 플러그인 메모리에만 짧게 보관합니다. 설정은 Paseo의 호스트 설정 저장소에 남습니다.

## 공개 카탈로그 등록

Paseo 공식 [플러그인 게시 안내](https://paseo.sh/docs/plugins/publishing)에 따라 공개 GitHub 저장소 또는 npm 패키지로 배포한 뒤 [카탈로그 제출 양식](https://github.com/getpaseo/plugins/issues/new?template=submit-plugin.yml)에 소스 URL을 넣습니다. 화면이 있는 플러그인은 개인 정보가 없는 실제 UI 이미지가 필요합니다. 카탈로그 심사를 통과하면 `owner/slug` 형식으로 설치할 수 있습니다. 현재는 로컬 디렉터리로만 설치되어 있으며 공개 저장소 생성이나 카탈로그 제출은 하지 않았습니다.
