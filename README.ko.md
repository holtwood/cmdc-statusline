# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | **한국어** | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

> 이 번역은 AI가 작성했습니다. 해석이 갈리는 경우 [영문판](README.md)을 기준으로 하며, 수정 PR을 환영합니다.

[Command Code](https://commandcode.ai)(`cmdc`)용 상태 표시줄 — 모델, 그라데이션 컨텍스트 바,
캐시 적중률, 세션 비용, 출력 속도, 서브에이전트 사용량, 세션 이름, git 상태를 입력창 아래 한 줄에
모두 표시합니다.

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ dev-home
```

Command Code에는 Claude Code식 `statusLine` 외부 명령 훅이 없습니다. 입력창 아래에 상시 줄을
그릴 수 있는 방법은 `cmd.ui.setStatus()`(mod API)뿐이며, 이 mod가 그것을 사용합니다.

## 설치

```bash
cmd mods add holtwood/cmdc-statusline -g     # 사용자 범위 (-g를 빼면 프로젝트 범위)
cmd mods list                                # 목록에 나오면 정상
```

패키지 관리 없이 파일만 넣어도 됩니다.

```bash
mkdir -p ~/.commandcode/mods
curl -o ~/.commandcode/mods/statusline.ts \
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

설치 없이 시험: `cmd --mod ./index.ts`. mod는 프로세스당 한 번만 로드되므로 변경 후에는
`/reload` 또는 새 세션이 필요합니다. 빌드 단계는 없습니다(Command Code가 로드 시 TypeScript를 컴파일).

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
| `dev-home` | 현재 디렉터리 이름 |

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
| `raw-model` | `false` | 모델 id의 벤더 접두사 유지 |
| `ascii` | `false` | 순수 ASCII 렌더링 강제 |
| `refresh` | `10` | git 재읽기 간격(초, 0이면 타이머 끔) |

**우선순위 주의:** Command Code는 `--mod-option`의 **값**을 mod가 볼 수 있는 argv에서 지웁니다.
따라서 값이 **내장 기본값과 다를 때만** 명시적 덮어쓰기로 판단합니다. 기본값을 명시적으로 넘겨도
(예: `--mod-option cwd=true`) 설정 파일을 이기지 못합니다.

## 렌더링

- `COLORTERM=truecolor|24bit` → 24-bit 그라데이션 바, 아니면 256색 근사.
  `ascii=true` 또는 `TERM=dumb` → `#`/`-`. `NO_COLOR`는 블록 문자를 유지하고 색만 제거합니다.
- **좁은 터미널에서도 잘리지 않습니다.** 우선순위대로 세그먼트를 버리고(`cwd` → 속도 → effort →
  서브에이전트 → 캐시 → 세션 이름 → 비용 → 변경 수, 이어서 컨텍스트가 바 → 토큰+% → 토큰으로
  축소, 마지막으로 브랜치), 리사이즈 시 즉시 다시 그립니다. 모델은 절대 버리지 않습니다.

## 숫자의 출처

| 값 | 출처 | 신뢰도 |
|---|---|---|
| 모델 / effort / 컨텍스트 / 캐시 | `model_request_start` / `model_request_end` 이벤트 | 정확 |
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
node test/statusline.test.mjs     # 127개 단언, 의존성 없음, 빌드 없음
python3 scripts/gen-model-tables.py --check
```

테스트는 `index.ts`를 직접 불러옵니다. Node 22.18+/24가 타입을 제거하므로 툴체인이 필요 없습니다.
다른 사본을 시험하려면 `STATUSLINE_MOD=/path/to/statusline.ts`.

## 알려진 제한

- **크레딧/쿼터 세그먼트는 없습니다.** 비슷한 mod들은 Command Code API에서 잔여 크레딧과
  5시간/주간 윈도우를 읽지만, 이 mod는 의도적으로 로컬 전용입니다(네트워크도 `auth.json`도 건드리지 않음).
- 새 요청의 비용은 동봉된 가격표로 계산하므로 가격이 바뀌면
  `scripts/gen-model-tables.py`를 다시 실행해야 합니다(재개 시드와 요청별 계산 모두 제품 자체 수치와 대조 완료).
- 세션 이름과 비용 복원은 `~/.commandcode/projects/**`(비공개 배치)를 읽습니다. 모두 폴백이 있어
  배치가 바뀌어도 "세그먼트가 사라질" 뿐 충돌하지 않습니다.

## 유사 프로젝트

다른 취향이라면: [grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline)
(크레딧, 사용량 윈도우, 소비 페이스), [vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)
(템플릿 레이아웃, 좁은 터미널 우선순위 처리), [estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)
(컨텍스트 압박, 캐시 적중률, transcript 기반 비용과 서브에이전트 환산).

## 라이선스

MIT
