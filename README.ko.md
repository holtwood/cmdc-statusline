# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | **한국어** | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

[Command Code](https://commandcode.ai)(`cmd`, Windows에서는 `cmdc`)용 상태 표시줄 — 모델,
그라데이션 컨텍스트 바, 캐시 적중률, 세션 비용, 출력 속도, 서브에이전트 사용량, 세션 이름,
git 상태를 `cmd.ui.setStatus()`로 입력창 아래에 표시합니다.

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

**Command Code ≥ 1.10.0 필요.** 오래된 호스트에서는 업그레이드 알림 하나만 남기고 스스로
비활성화합니다 — `cmdc update` 후 세션을 다시 여세요.

## 설치

```bash
cmd mods add cmdc-statusline -g   # -g = 사용자 범위. 빼면 현재 프로젝트에만 설치
cmd mods list
```

다른 방법:

- **git에서:** `cmd mods add holtwood/cmdc-statusline -g`
- **단일 파일:** `index.ts`를 `~/.commandcode/mods/statusline.ts`에 복사
  (Windows에서는 `%USERPROFILE%\.commandcode\mods\statusline.ts`) — 빌드 불필요
- **설치 없이 시험:** `cmd --mod ./index.ts` (mod는 프로세스당 한 번만 로드됩니다.
  변경 후에는 `/reload`로 반영)

Windows에서는 바이너리가 `cmdc`입니다(`cmd`는 Windows 셸). 설치 방법은 하나만 고르세요 —
패키지와 직접 배치 파일은 같은 flag 이름을 선언하는 두 개의 mod이며, flag 이름은 mod 전역으로
해석됩니다.

AI 에이전트에게 맡기려면 다음을 붙여 넣으세요:

> Command Code mod `cmdc-statusline`을 사용자 범위로 설치해 줘: `cmd mods add cmdc-statusline -g`
> 실행(Windows에서는 `cmdc`. npm에 없으면 `holtwood/cmdc-statusline` 사용). `cmd mods list`에
> 뜨는지 확인한 다음 세션을 재시작하라고 알려 줘.

## 세그먼트

| 세그먼트 | 의미 |
|---|---|
| `deepseek-v4.1-flash` | 현재 모델(`raw-model=true`면 벤더 접두사 유지) |
| `max` | 마지막 요청의 추론 강도 |
| `█░░░ 32k (3.2%)` | 마지막 요청의 컨텍스트: 그라데이션 바(초록→빨강), 토큰 수, 윈도우 비율 |
| `cache 99%` | 마지막 요청의 프롬프트 캐시 적중률 |
| `$0.013` | 세션 비용 — 재개 시 누적분 + 새 요청분 |
| `42 tok/s` | 마지막 요청의 출력 속도(실시간 측정, 첫 토큰 대기 포함) |
| `sub 16k` | 이 세션에서 서브에이전트가 쓴 토큰 |
| `Simple Reply` | 세션 이름(`/reload`와 재개 후에도 유지) |
| `main ↑1` | git 브랜치와 ahead/behind |
| `+1 ~2 ?1` | 스테이지 · 수정 · 추적 안 됨(깨끗하면 `clean`) |
| `my-project` | 현재 디렉터리 이름 |

## 설정

```
~/.commandcode/statusline.json          사용자 범위
<프로젝트>/.commandcode/statusline.json  프로젝트 범위(사용자보다 우선)
--mod-option <키>=<값>                   실행 단위 재정의
```

```json
{"preset": "full", "bar-width": 12, "refresh": 10, "cache": true, "cost": true}
```

프리셋: `full`(기본, 전부) · `minimal`(model, effort, context, bar, percent, git) ·
`usage`(context, bar, percent, cache, cost, sub). 프리셋 옆에 쓴 키는 프리셋을 덮어씁니다.

| 키 | 기본값 | 설명 |
|---|---|---|
| `model`, `effort`, `context` | `true` | 모델 / 추론 강도 / 마지막 요청의 컨텍스트 |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | 그라데이션 바, 칸 수, 백분율 |
| `cache`, `cost`, `speed`, `sub` | `true` | 적중률 / 세션 비용 / 출력 속도 / 서브에이전트 토큰 |
| `name`, `git`, `cwd` | `true` | 세션 이름(24자에서 자름) / 브랜치 + 변경 수 / 디렉터리 이름 |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model`, `ascii` | `false` | 벤더 접두사 유지 / 순수 ASCII 렌더링 |
| `refresh` | `10` | git 다시 읽기 간격(초)(`0`이면 폴링 끔) |

JSON을 만지지 않고 확인·변경하는 명령 두 개:

- `/statusline` — 렌더링된 줄, 원시 값, 모든 키의 `키 / 기본값 / 적용 / 출처` 표와 함께 쓸 수 없는
  항목(알 수 없는 키, 잘못된 타입, 잘못된 프리셋)을 하나씩 경고합니다. (리포트 문구는 중국어입니다.)
- `/statusline config` — 대화 상자 편집기(범위 → 키 → 값 → 확인). 키 하나만 쓰고 `/reload` 없이
  즉시 다시 그립니다.

주의: `--mod-option`은 값이 내장 기본값과 다를 때만 명시적 재정의로 인정됩니다 — `cwd=true`를
명시해도 `false`라고 쓴 설정 파일에는 지지 않습니다.

## 동작 원리

- **시작/재개:** 첫 요청 전에는 모델과 effort를 `~/.commandcode/config.json`에서 가져옵니다.
  재개된 세션은 transcript에서 컨텍스트·캐시 적중률·비용도 복원합니다. 출력 속도와 서브에이전트
  토큰만 실제 요청이 필요합니다.
- **색상:** `COLORTERM=truecolor|24bit` → 24비트 그라데이션, 아니면 256색 근사.
  `ascii=true` 또는 `TERM=dumb` → `#`/`-`. `NO_COLOR`는 블록 문자를 유지하고 색만 뺍니다.
- **좁은 터미널:** 자르지 않고 우선순위가 낮은 세그먼트부터 버립니다(cwd → 속도 → effort →
  서브에이전트 → 캐시 → 이름 → 비용 → 변경 수 → 바 축소 → 브랜치). 모델은 절대 버리지 않습니다.
  리사이즈 시 다시 그립니다.
- **출처:** 모델/effort/컨텍스트/캐시는 요청 이벤트에서, 비용 = 재개 시 transcript + 생성된 가격표로
  요청마다 계산, 서브에이전트 토큰은 `subagent_stop`에서, git은 `git status --porcelain=v1 -b`
  (5초 캐시 + `refresh` 간격)로 가져옵니다.
- **모델 표:** 컨텍스트 윈도우와 가격은 CLI에 포함된 모델 카탈로그에서 **생성**됩니다 —
  `python3 scripts/gen-model-tables.py`로 재생성, `--check`로 드리프트 감지(CI가 실행).
  표에 없는 모델은 우아하게 축소됩니다(바 없음 / 비용 없음).

## 개발

```bash
npm test                                    # node test/statusline.test.mjs — 의존성 없음, 빌드 불필요
python3 scripts/gen-model-tables.py --check
```

Node 22.18+/24가 임포트 시 TypeScript 타입을 지우므로 테스트는 `index.ts`를 그대로 실행합니다.
`STATUSLINE_MOD=/path/to/statusline.ts`로 다른 복사본을 대상으로 할 수 있습니다. CI는 Linux,
macOS, Windows를 커버합니다.

## 알려진 제한

- 크레딧/쿼터 세그먼트 없음 — 의도적으로 로컬 전용입니다(네트워크 없음, `auth.json` 미사용).
- 새 요청 비용은 포함된 가격표로 계산합니다. CLI 가격 변경 시 `gen-model-tables.py` 재실행 필요.
- 세션 이름·비용·요청 복원은 문서화되지 않은 `~/.commandcode/**` 레이아웃을 읽습니다 —
  레이아웃이 바뀌면 세그먼트가 빠질 뿐, 크래시는 없습니다.
- `git status`를 `refresh`초마다 폴링합니다 — 작은 리포지토리에서는 공짜지만 거대한 리포지토리에서는
  `refresh`를 올리거나 `0`으로 설정하세요.

## 유사 프로젝트

[grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline)(크레딧, 사용량 윈도우, 소비 페이스) ·
[vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)(템플릿 레이아웃, 좁은 터미널 우선순위) ·
[estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)(컨텍스트 압박, 캐시 적중률, transcript 기반 비용).

## 라이선스

MIT
