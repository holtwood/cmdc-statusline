# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **日本語** | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

> この翻訳は AI が作成したものです。解釈が分かれる場合は [英語版](README.md) を優先します。修正の PR を歓迎します。

[Command Code](https://commandcode.ai)（`cmdc`）のステータスライン — モデル、グラデーション付きの
コンテキストバー、キャッシュヒット率、セッション費用、出力速度、サブエージェント使用量、セッション名、
git の状態を、入力欄の下の 1 行にまとめて表示します。

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

Command Code には Claude Code のような `statusLine` 外部コマンドフックがありません。入力欄の下に
常駐行を描画できるのは `cmd.ui.setStatus()`（mod API）だけであり、本 mod はそれを使っています。

## インストール

```bash
cmd mods add holtwood/cmdc-statusline -g     # ユーザースコープ（-g を外すとプロジェクトスコープ）
cmd mods list                                # 一覧に表示されれば OK
```

パッケージ管理を使わずファイルを直接置くこともできます。

```bash
mkdir -p ~/.commandcode/mods
curl -o ~/.commandcode/mods/statusline.ts \
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

> Windows ではコマンドは `cmdc` です（`cmd` は Windows のシェル）——`cmdc mods add …` と読み替えてください。

インストールせずに試す: `cmd --mod ./index.ts`。mod は 1 プロセスにつき 1 回だけ読み込まれます。
変更後は `/reload` か新しいセッションで反映してください。ビルド手順は不要です（Command Code が
読み込み時に TypeScript をコンパイルします）。

## セグメント

| セグメント | 意味 |
|---|---|
| `deepseek-v4.1-flash` | 現在のモデル（リクエストから取得。`raw-model=true` でベンダー接頭辞を保持） |
| `max` | 直前のリクエストの推論エフォート |
| `█░░░ 32k (3.2%)` | 直前のリクエストのコンテキスト：グラデーションバー（位置に応じて緑→黄→赤）、トークン数、ウィンドウ占有率 |
| `cache 99%` | 直前のリクエストのプロンプトキャッシュヒット率（キャッシュ読み ÷ 入力） |
| `$0.013` | セッション費用 — 再開時の履歴累計 + このプロセスでの増分 |
| `42 tok/s` | 直前のリクエストの出力速度（実時間計測なので初トークン待ちを含む） |
| `sub 16k` | このセッションでサブエージェント（`agent` ツール）が消費したトークン |
| `Simple Reply` | セッション名（`/reload` や再開後も保持） |
| `main ↑1` | git ブランチと ahead/behind |
| `+1 ~2 ?1` | ステージ済み · 変更 · 未追跡（クリーンなら `clean`） |
| `my-project` | 現在のディレクトリ名 |

## 設定

設定は JSON。コマンドラインで実行ごとに上書きできます。

```
~/.commandcode/statusline.json          ユーザースコープ
<project>/.commandcode/statusline.json  プロジェクトスコープ（ユーザーより優先）
--mod-option <name>=<value>             実行ごとの上書き
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

| キー | 既定 | 説明 |
|---|---|---|
| `model`, `effort`, `context` | `true` | モデル / 推論エフォート / 直前のコンテキスト |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | グラデーションバー、セル数、割合 |
| `cache` | `true` | キャッシュヒット率 |
| `cost` | `true` | セッション費用 |
| `speed` | `true` | 出力速度 |
| `sub` | `true` | サブエージェントのトークン |
| `name` | `true` | セッション名（24 文字で切り詰め） |
| `git` | `true` | ブランチ + 変更数 |
| `cwd` | `true` | ディレクトリ名 |
| `raw-model` | `false` | モデル id のベンダー接頭辞を保持 |
| `ascii` | `false` | 純 ASCII 描画を強制 |
| `refresh` | `10` | git を読み直す間隔（秒、0 でタイマー停止） |

**優先順位の注意:** Command Code は `--mod-option` の**値**を mod から見える argv から消して
しまいます。そのため、**組み込みの既定値と異なる**場合だけ明示的な上書きとみなします。
既定値を明示的に渡しても（例 `--mod-option cwd=true`）設定ファイルには勝ちません。

## 描画

- `COLORTERM=truecolor|24bit` → 24-bit のグラデーションバー。それ以外は 256 色で近似。
  `ascii=true` または `TERM=dumb` → `#`/`-`。`NO_COLOR` はブロック文字を保ち色だけ落とします。
- **狭い端末でも切り捨てません。** 優先度順にセグメントを落とし（`cwd` → 速度 → effort →
  サブエージェント → キャッシュ → セッション名 → 費用 → 変更数、続いてコンテキストが
  バー → トークン+% → トークン と縮小、最後にブランチ）、リサイズ時は即座に再描画します。
  モデルは決して落としません。

## 数値の出どころ

| 値 | 出典 | 信頼度 |
|---|---|---|
| モデル / effort / コンテキスト / キャッシュ | `model_request_start` / `model_request_end` イベント | 正確 |
| セッション費用 | 再開時に `<sessionId>.jsonl` の `costUsd` を合計 + 各リクエストを内蔵価格表で計算 | 再開分は製品自身の数値。増分は製品の計算方法を再現（記録済み `costUsd` と全件照合） |
| サブエージェントのトークン | `subagent_stop` イベント | トークンは正確。サブエージェント費用は費用セグメントに**含めません**（製品も保存しないため） |
| セッション名 | `session_titled` イベント + 起動時に `<sessionId>.meta.json` | ベストエフォート — ファイル配置は非公開仕様で、読み取りは `try` 内 |
| ブランチ / 変更数 | `cmd.exec` で `git status --porcelain=v1 -b` | 正確、5 秒キャッシュ |

コンテキスト窓と価格の表は CLI 同梱のモデルカタログから**生成**されます（手書きではありません）。

```bash
python3 scripts/gen-model-tables.py           # CLI 更新後に再生成
python3 scripts/gen-model-tables.py --check   # 表がずれていれば失敗（CI で実行）
```

表にないモデルでも安全に劣化します。ウィンドウが無ければバー/割合を出さず、価格が無ければ費用を出しません。

## 開発

```bash
node test/statusline.test.mjs     # 136 アサーション、依存ゼロ・ビルド不要
python3 scripts/gen-model-tables.py --check
```

テストは `index.ts` を直接読み込みます。Node 22.18+/24 が型を除去するためツールチェーンは不要です。
別のコピーをテストするには `STATUSLINE_MOD=/path/to/statusline.ts`。

## 既知の制限

- **クレジット/クォータのセグメントはありません。** 同種の mod は Command Code API から残量や
  5 時間/週次のウィンドウを取得しますが、本 mod は意図的にローカルのみ（ネットワークも
  `auth.json` も触りません）。
- 新規リクエストの費用は同梱の価格表から計算するため、価格改定時は
  `scripts/gen-model-tables.py` の再実行が必要です（再開時のシードと各リクエストの計算はいずれも
  製品自身の数値と照合済み）。
- セッション名と費用の復元は `~/.commandcode/projects/**`（非公開の配置）を読みます。すべて
  フォールバック付きなので、配置が変わっても「セグメントが消える」だけでクラッシュしません。

## 類似プロジェクト

別のテイストが欲しければ: [grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline)
（クレジット、利用ウィンドウ、消費ペース）、[vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)
（テンプレートレイアウト、狭い端末の優先度処理）、[estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)
（コンテキスト圧、キャッシュヒット率、transcript 由来の費用とサブエージェント換算）。

## ライセンス

MIT
