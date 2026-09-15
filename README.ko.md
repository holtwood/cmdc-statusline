# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | **한국어** | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

> 이 번역은 AI가 작성했습니다. 해석이 갈리는 경우 [영문판](README.md)을 기준으로 하며, 수정 PR을 환영합니다.

[Command Code](https://commandcode.ai)(`cmd`, Windows에서는 `cmdc`)용 상태 표시줄 — 모델,
그라데이션 컨텍스트 바, 캐시 적중률, 세션 비용, 출력 속도, 서브에이전트 사용량, 세션 이름, git 상태를
입력창 아래 한 줄에 모두 표시합니다.

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

Command Code에는 Claude Code식 `statusLine` 외부 명령 훅이 없습니다. 입력창 아래에 상시 줄을
그릴 수 있는 방법은 `cmd.ui.setStatus()`(mod API)뿐이며, 이 mod가 그것을 사용합니다.

## 요구 사항

**Command Code ≥ 1.10.0**(Windows에서는 `cmdc`)이 필요합니다. **구버전은 지원하지 않습니다**:
구버전 호스트를 감지하면 이 mod는 아무것도 하지 않습니다 — 아무것도 등록하지 않고, 푸터도 그리지
않으며, 피드에 업그레이드 안내 한 줄만 남기고 스스로 비활성화됩니다. `cmdc update`를 실행하고
세션을 다시 여세요. 이 하한은 추측이 아닙니다: 1.10.0 이전의 mod API에는 `cmd.ui.capabilities`가
없어서(공개된 1.x 패키지를 전부 대조), 호스트가 푸터를 그리는지조차 판단할 수 없고 완화가 아니라
예외가 납니다. `/statusline` 리포트에는 감지한 호스트 버전이 표시되므로 무엇 위에서 도는지 확인할 수
있습니다.

## 설치

```bash
cmd mods add cmdc-statusline -g              # npm에서 (-g = 사용자 범위, 빼면 현재 프로젝트에만)
cmd mods list                                # 목록에 나오면 정상
```

같은 패키지를 git에서도 설치할 수 있습니다: `cmd mods add holtwood/cmdc-statusline -g`
(레지스트리에 의존하고 싶지 않을 때).

패키지 관리 없이 파일만 넣어도 됩니다 — `index.ts`를 `~/.commandcode/mods/statusline.ts`
(Windows에서는 `%USERPROFILE%\.commandcode\mods\statusline.ts`)에 두고 새 세션을 열면 됩니다:

```bash
mkdir -p ~/.commandcode/mods && curl -o ~/.commandcode/mods/statusline.ts \
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.commandcode\mods" | Out-Null
Invoke-WebRequest -OutFile "$env:USERPROFILE\.commandcode\mods\statusline.ts" `
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

설치 방식은 하나만 선택하세요: 패키지와 직접 배치는 서로 다른 mod이며 같은 flag 이름을 선언합니다.
flag 이름은 mod 전체에서 전역으로 해석됩니다.

> Windows에서는 명령이 `cmdc`입니다(`cmd`는 Windows 셸) — `cmdc mods add …`, `cmdc mods list`, `cmdc --mod .\index.ts`로 바꿔 쓰세요.

설치 없이 시험: `cmd --mod ./index.ts`. mod는 프로세스당 한 번만 로드되므로 변경 후에는
`/reload` 또는 새 세션이 필요합니다. 빌드 단계는 없습니다(Command Code가 로드 시 TypeScript를 컴파일).

### AI 에이전트에게 맡기기

직접 명령을 치고 싶지 않다면 아래를 에이전트(Claude Code, Codex, Command Code 등)에 붙여넣으세요:

> Command Code mod `cmdc-statusline`을 사용자 범위로 설치해 주세요:
> `cmd mods add cmdc-statusline -g`를 실행하고(Windows에서는 `cmd` 대신 `cmdc`; npm에서 찾지 못하면
> `holtwood/cmdc-statusline` 사용), 그다음 `cmd mods list`에서 `cmdc-statusline`이 사용자 범위로
> 표시되고 로드 경고가 없는지 확인해 주세요. 마지막으로 상태 표시줄이 그려지도록 세션 재시작을
> 안내해 주세요.

root 권한은 필요 없고, 기록되는 것은 `~/.commandcode/mods/`와 `~/.commandcode/settings.json`의
`mods.sources`뿐입니다.

## 세그먼트

| 세그먼트 | 의미 |
|---|---|
| `deepseek-v4.1-flash` | 현재 모델(요청에서 그대로; `raw-model=true`면 벤더 접두사 유지) |
| `max` | 마지막 요청의 추론 강도 |
| `█░░░ 32k (3.2%)` | 마지막 요청의 컨텍스트: 그라데이션 바(칸 위치에 따라 초록→노랑→빨강), 토큰 수, 윈도우 비율 |
| `cache 99%` | 마지막 요청의 프롬프트 캐시 적중률(캐시 읽기 ÷ 입력) |
| `$0.013` | 세션 비용 — 재개 시 과거 합계 + 이 프로세스의 증가분 |
| `42 tok/s` | 마지막 요청의 출력 속도(실시간 측정이라 첫 토큰 대기가 포함됨) |
| `sub 16k` | 이 세션에서 서브에이전트(`agent` 도구)가 쓴 토큰 |
| `Simple Reply` | 세션 이름(`/reload`와 재개 후에도 유지) |
| `main ↑1` | git 브랜치와 ahead/behind |
| `+1 ~2 ?1` | 스테이지 · 수정 · 추적 안 됨(깨끗하면 `clean`) |
| `my-project` | 현재 디렉터리 이름 |

## 설정

설정은 JSON이며, 명령줄로 실행마다 덮어쓸 수 있습니다.

```
~/.commandcode/statusline.json          사용자 범위
<project>/.commandcode/statusline.json  프로젝트 범위(사용자보다 우선)
--mod-option <name>=<value>             실행별 덮어쓰기
```

```json
{
	"bar-width": 12,
	"cache": true,
	"cost": true,
	"speed": true,
	"sub": true,
	"cwd": true,
	"refresh": 10
}
```

`preset`은 미리 정해진 세그먼트 묶음이라, 십여 개의 키를 나열하지 않아도 됩니다:

| `preset` | 켜지는 세그먼트 |
|---|---|
| `full`(기본) | 전부 |
| `minimal` | `model` `effort` `context` `bar` `percent` `git` |
| `usage` | `context` `bar` `percent` `cache` `cost` `sub` |

프리셋이 정하는 것은 "어떤 세그먼트를 켤지"뿐입니다. 옆에 쓴 키가 그것을 덮어쓰고
(`{"preset": "minimal", "cost": true}`라면 비용도 나옵니다), 렌더링 스위치(`ascii`, `raw-model`)는
별개입니다. 모르는 프리셋 이름은 리포트에서 지적되고 `full`로 처리됩니다.

| 키 | 기본값 | 설명 |
|---|---|---|
| `model`, `effort`, `context` | `true` | 모델 / 추론 강도 / 마지막 요청의 컨텍스트 |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | 그라데이션 바, 칸 수, 백분율 |
| `cache` | `true` | 캐시 적중률 |
| `cost` | `true` | 세션 비용 |
| `speed` | `true` | 출력 속도 |
| `sub` | `true` | 서브에이전트 토큰 |
| `name` | `true` | 세션 이름(24자에서 자름) |
| `git` | `true` | 브랜치 + 변경 수 |
| `cwd` | `true` | 디렉터리 이름 |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model` | `false` | 모델 id의 벤더 접두사 유지 |
| `ascii` | `false` | 순수 ASCII 렌더링 강제 |
| `refresh` | `10` | git 재읽기 간격(초, 0이면 타이머 끔) |

### 실제로 적용된 값을 본다

`/statusline`은 렌더링된 한 줄과 그 뒤의 원시 값에 더해, 모든 키의 "키 / 기본값 / 적용값 / 출처" 표,
읽어들인 설정 파일, 그리고 쓸 수 없었던 것들 — 모르는 키(대개 오타), 모양이 맞지 않는 값, 모르는
프리셋 — 을 한 줄씩 출력합니다. 거부된 값은 기본값으로 되돌아가고 그 사실이 명시되므로, 변경이 왜
먹히지 않는지 추측할 필요가 없습니다.

### JSON을 직접 고치지 않고 바꾸기

`/statusline config`는 Command Code의 대화상자(`cmd.ui.select` / `input` / `confirm`)로 같은 일을
합니다: 범위(사용자 / 프로젝트) → 키 → 값 → 확인. 다시 쓰는 것은 그 키 하나뿐이며, 파일의 나머지
(이 mod가 모르는 키 포함)는 그대로 둡니다. 그런 다음 설정을 다시 읽고 푸터를 **즉시 다시 그립니다**.
`/reload`가 필요 없습니다. 대화상자가 없는 실행(headless)은 리포트만 출력하고 아무것도 쓰지 않으며,
확인을 거부한 경우도 마찬가지입니다. 쓴 값이 더 높은 우선순위(프로젝트 파일이나 `--mod-option`)에
가려 푸터가 바뀌지 않으면 그 사실을 분명히 알려 줍니다 — "썼습니다"라는 안내만 남고 화면은 그대로인
상황을 만들지 않습니다.

(`/statusline` 자체의 출력 메시지는 중국어입니다.)

**우선순위 주의:** Command Code는 `--mod-option`의 **값**을 mod가 볼 수 있는 argv에서 지웁니다.
따라서 값이 **내장 기본값과 다를 때만** 명시적 덮어쓰기로 판단합니다. 기본값을 명시적으로 넘겨도
(예: `--mod-option cwd=true`) 설정 파일을 이기지 못합니다.

## 렌더링

- **시작할 때.** 대부분의 세그먼트는 **직전 모델 요청**을 나타내므로 아직 요청을 보내지 않은
  세션에는 존재하지 않습니다. 그래서 첫 `model_request_end`를 기다리지 않고 그 시점에 알 수 있는
  것부터 그립니다: 모델과 추론 강도는 `~/.commandcode/config.json`에서, 그리고 세션 이름·git 상태·
  디렉터리 이름입니다. **이어서 연** 세션은 직전 요청의 모델·effort·컨텍스트·캐시 적중률·비용까지
  transcript에서 복원하므로, 닫을 때의 완전한 한 줄 그대로 열립니다. 요청이 꼭 필요한 것은 출력
  속도와 서브에이전트 토큰뿐입니다(제품이 둘 다 저장하지 않습니다).
- `COLORTERM=truecolor|24bit` → 24-bit 그라데이션 바, 아니면 256색 근사.
  `ascii=true` 또는 `TERM=dumb` → `#`/`-`. `NO_COLOR`는 블록 문자를 유지하고 색만 제거합니다.
- **좁은 터미널에서도 잘리지 않습니다.** 우선순위대로 세그먼트를 버리고(`cwd` → 속도 → effort →
  서브에이전트 → 캐시 → 세션 이름 → 비용 → 변경 수, 이어서 컨텍스트가 바 → 토큰+% → 토큰으로
  축소, 마지막으로 브랜치), 리사이즈 시 즉시 다시 그립니다. 모델은 절대 버리지 않습니다.

## 숫자의 출처

| 값 | 출처 | 신뢰도 |
|---|---|---|
| 모델 / effort / 컨텍스트 / 캐시 | `model_request_start` / `model_request_end` 이벤트(첫 요청 전 model/effort는 `~/.commandcode/config.json`에서, 이어서 열 때는 transcript에서) | 요청 후 정확. 시드 값은 제품 자체의 값 |
| 세션 비용 | 재개 시 `<sessionId>.jsonl`의 `costUsd` 합계 + 요청별 내장 가격표 계산 | 재개분은 제품 자체 수치, 증가분은 제품 계산 방식을 재현(기록된 `costUsd`와 전수 대조) |
| 서브에이전트 토큰 | `subagent_stop` 이벤트 | 토큰은 정확, 서브에이전트 비용은 비용 세그먼트에 **포함하지 않음**(제품도 저장하지 않음) |
| 세션 이름 | `session_titled` 이벤트 + 시작 시 `<sessionId>.meta.json` | 최선 노력 — 파일 배치는 비공개 규격이며 읽기는 `try` 안에서 |
| 브랜치 / 변경 수 | `cmd.exec`로 `git status --porcelain=v1 -b` | 정확, 5초 캐시 |

컨텍스트 윈도우와 가격 표는 CLI에 포함된 모델 카탈로그에서 **생성**됩니다(손으로 쓰지 않음).

```bash
python3 scripts/gen-model-tables.py           # CLI 업그레이드 후 재생성
python3 scripts/gen-model-tables.py --check   # 표가 어긋나면 실패(CI에서 실행)
```

표에 없는 모델도 우아하게 저하됩니다: 윈도우가 없으면 바/비율을, 가격이 없으면 비용을 표시하지 않습니다.

## 개발

```bash
node test/statusline.test.mjs     # 전체 스위트: 의존성 없음, 빌드 없음
python3 scripts/gen-model-tables.py --check
```

테스트는 `index.ts`를 직접 불러옵니다. Node 22.18+/24가 타입을 제거하므로 툴체인이 필요 없습니다.
다른 사본을 시험하려면 `STATUSLINE_MOD=/path/to/statusline.ts`. CI는 Linux, macOS, Windows에서 같은
스위트를 실행합니다.

## 알려진 제한

- **크레딧/쿼터 세그먼트는 없습니다.** 비슷한 mod들은 Command Code API에서 잔여 크레딧과
  5시간/주간 윈도우를 읽지만, 이 mod는 의도적으로 로컬 전용입니다(네트워크도 `auth.json`도 건드리지 않음).
- 새 요청의 비용은 동봉된 가격표로 계산하므로 가격이 바뀌면
  `scripts/gen-model-tables.py`를 다시 실행해야 합니다(재개 시드와 요청별 계산 모두 제품 자체 수치와 대조 완료).
- 세션 이름과 비용 복원은 `~/.commandcode/projects/**`, 시작할 때의 모델/effort 시드는
  `~/.commandcode/config.json`(모두 비공개 배치)을 읽습니다. 모두 폴백이 있어
  배치가 바뀌어도 "세그먼트가 사라질" 뿐 충돌하지 않습니다.
- **거대한 저장소에서의 폴링.** 상태 표시줄은 `refresh`초마다(기본 10초) `git status`를 다시 읽습니다.
  작은 저장소에서는 무시할 비용이지만 거대한 저장소에서는 아닙니다 — `refresh`를 올리거나 `0`으로
  두고 이벤트 기반 갱신에 맡기세요.

## 유사 프로젝트

다른 취향이라면: [grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline)
(크레딧, 사용량 윈도우, 소비 페이스), [vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)
(템플릿 레이아웃, 좁은 터미널 우선순위 처리), [estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)
(컨텍스트 압박, 캐시 적중률, transcript 기반 비용과 서브에이전트 환산).

## 라이선스

MIT
