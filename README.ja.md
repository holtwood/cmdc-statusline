# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | **日本語** | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

[Command Code](https://commandcode.ai)（`cmd`、Windows では `cmdc`）のステータスライン — モデル、
グラデーション付きコンテキストバー、キャッシュヒット率、セッション費用、出力速度、サブエージェント
使用量、セッション名、git の状態を `cmd.ui.setStatus()` で入力欄の下に表示します。

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

**Command Code ≥ 1.10.0 が必要。** 古いホストではアップグレード通知を 1 件残して自分を無効化
します——`cmdc update` してセッションを開き直してください。

## インストール

```bash
cmd mods add cmdc-statusline -g   # -g = ユーザースコープ。外すと現在のプロジェクトのみ
cmd mods list
```

ほかの方法：

- **git から:** `cmd mods add holtwood/cmdc-statusline -g`
- **単一ファイル:** `index.ts` を `~/.commandcode/mods/statusline.ts` に置く
  （Windows では `%USERPROFILE%\.commandcode\mods\statusline.ts`）——ビルド不要
- **試すだけ:** `cmd --mod ./index.ts`（mod は 1 プロセスにつき 1 回だけ読み込まれます。
  変更後は `/reload` で反映）

Windows ではコマンドは `cmdc` です（`cmd` は Windows のシェル）。導入方法はどれか 1 つに——
パッケージと直接配置は別々の mod で同じ flag 名を宣言し、flag 名は mod をまたいでグローバルに
解決されます。

AI エージェントに任せる場合、次を貼ってください:

> Command Code の mod `cmdc-statusline` をユーザースコープでインストールして:
> `cmd mods add cmdc-statusline -g` を実行（Windows では `cmdc`。npm に無ければ
> `holtwood/cmdc-statusline` を使う）。`cmd mods list` に出ることを確認したら、セッションを
> 再起動するよう伝えて。

## セグメント

| セグメント | 意味 |
|---|---|
| `deepseek-v4.1-flash` | 現在のモデル（`raw-model=true` でベンダー接頭辞を保持） |
| `max` | 直前のリクエストの推論エフォート |
| `█░░░ 32k (3.2%)` | 直前のリクエストのコンテキスト：グラデーションバー（緑→赤）、トークン数、ウィンドウ占有率 |
| `cache 99%` | 直前のリクエストのプロンプトキャッシュヒット率 |
| `$0.013` | セッション費用 — 再開時の累計 + 新規リクエスト分 |
| `42 tok/s` | 直前のリクエストの出力速度（実時間計測、初トークン待ちを含む） |
| `sub 16k` | このセッションでサブエージェントが消費したトークン |
| `Simple Reply` | セッション名（`/reload` や再開後も保持） |
| `main ↑1` | git ブランチと ahead/behind |
| `+1 ~2 ?1` | ステージ済み · 変更 · 未追跡（クリーンなら `clean`） |
| `my-project` | 現在のディレクトリ名 |

## 設定

```
~/.commandcode/statusline.json          ユーザースコープ
<プロジェクト>/.commandcode/statusline.json  プロジェクトスコープ（ユーザーを上書き）
--mod-option <キー>=<値>                 実行ごとの上書き
```

```json
{"preset": "full", "bar-width": 12, "refresh": 10, "cache": true, "cost": true}
```

プリセット: `full`（既定、すべて）· `minimal`（model, effort, context, bar, percent, git）·
`usage`（context, bar, percent, cache, cost, sub）。プリセットと並べて書いたキーはそれを上書き
します。

| キー | 既定 | 説明 |
|---|---|---|
| `model`, `effort`, `context` | `true` | モデル / 推論エフォート / 直前のリクエストのコンテキスト |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | グラデーションバー、セル数、割合 |
| `cache`, `cost`, `speed`, `sub` | `true` | ヒット率 / セッション費用 / 出力速度 / サブエージェントのトークン |
| `name`, `git`, `cwd` | `true` | セッション名（24 文字で切り詰め）/ ブランチ + 変更数 / ディレクトリ名 |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model`, `ascii` | `false` | ベンダー接頭辞を保持 / 素の ASCII 描画 |
| `refresh` | `10` | git を再読み込みする間隔（秒）（`0` でポーリング停止） |

JSON を触らずに確認・変更できるコマンドが 2 つあります:

- `/statusline` — 描画行、元の値、全キーの「キー / 既定 / 有効 / 出どころ」表に加え、使えなかった
  項目（未知のキー、型違い、不明なプリセット）を 1 件ずつ警告します。（レポート文は中国語です。）
- `/statusline config` — ダイアログ式の編集（スコープ → キー → 値 → 確認）。1 キーだけ書き込み、
  `/reload` なしで即座に再描画します。

注意: `--mod-option` は値が組み込み既定と異なる場合にだけ明示的な上書きと見なされます——
`cwd=true` を明示しても `false` と書かれた設定ファイルには勝てません。

## 仕組み

- **起動/再開:** 最初のリクエスト前はモデルとエフォートを `~/.commandcode/config.json` から
  取得。再開セッションは transcript からコンテキスト・キャッシュ率・費用も復元します。出力速度と
  サブエージェントのトークンだけは実際のリクエストが必要です。
- **色:** `COLORTERM=truecolor|24bit` → 24-bit グラデーション、それ以外は 256 色近似。
  `ascii=true` または `TERM=dumb` → `#`/`-`。`NO_COLOR` はブロック文字を残して色だけ消します。
- **狭い端末:** 切り詰めずに優先度の低いセグメントから落とします（cwd → 速度 → effort →
  サブエージェント → キャッシュ → 名前 → 費用 → 変更数 → バー縮小 → ブランチ）。モデルは
  落としません。リサイズで再描画。
- **出どころ:** モデル/エフォート/コンテキスト/キャッシュはリクエストイベントから。費用 =
  再開時の transcript + 生成済み価格表によるリクエストごとの課金。サブエージェントのトークンは
  `subagent_stop` から。git は `git status --porcelain=v1 -b`（5 秒キャッシュ + `refresh` 間隔）。
- **モデル表:** コンテキストウィンドウと価格は CLI 同梱のモデルカタログから**生成**されます——
  `python3 scripts/gen-model-tables.py` で再生成、`--check` でドリフト検出（CI が実行）。
  表に無いモデルは穏やかに縮退します（バー無し / 費用無し）。

## 開発

```bash
npm test                                    # node test/statusline.test.mjs —— 依存なし・ビルド不要
python3 scripts/gen-model-tables.py --check
```

Node 22.18+/24 がインポート時に TypeScript の型を剥がすので、テストは `index.ts` を直接実行します。
`STATUSLINE_MOD=/path/to/statusline.ts` で別コピーを対象にできます。CI は Linux / macOS /
Windows をカバー。

## 既知の制限

- クレジット/クォータのセグメントはありません——意図的にローカルのみ（ネットワーク不使用、
  `auth.json` も触りません）。
- 新規リクエストの費用は同梱の価格表で計算します。CLI 側の価格変更には
  `gen-model-tables.py` の再実行が必要です。
- セッション名・費用・リクエスト復元は未文書化の `~/.commandcode/**` レイアウトを読みます——
  レイアウト変更があっても「セグメントが消える」だけで、落ちることはありません。
- `git status` を `refresh` 秒ごとにポーリングします——小さなリポジトリでは安いですが、巨大な
  リポジトリでは `refresh` を上げるか `0` にしてください。

## 類似プロジェクト

[grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline)（クレジット、利用ウィンドウ、消費ペース）·
[vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)（テンプレートレイアウト、狭い端末の優先度処理）·
[estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)（コンテキスト圧、キャッシュヒット率、transcript 由来の費用）。

## ライセンス

MIT
