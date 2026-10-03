# cline-mobile

スマホから PC の Cline を操作するための構成（Cline Hub ダッシュボード + LAN ランチャー）をまとめたリポジトリです。
Cline 本体のフォークで、変更はダッシュボード（`apps/cline-hub`）だけ、**Cline desktop 本体は無変更**で使います。

> **本家 Cline の README が読みたい方はこちら** → [cline/cline / README.md](https://github.com/cline/cline/blob/main/README.md)
> このリポジトリ直下の `README.md` はプロダクト版に差し替えています（本家 README は上書きせずリンクだけ）。
> 本家リポジトリ: https://github.com/cline/cline ／ ドキュメント: https://docs.cline.bot

---

## 1 クリックで導入

前提: PC に **Cline desktop がインストール済みでサインイン済み**であること（https://cline.bot/desktop）。

```cmd
git clone https://github.com/nameko393-lab/cline-mobile.git cline-mobile
cd cline-mobile
install.cmd
```

`install.cmd` をダブルクリックすると:

| 手順 | 内容 | 確認 |
|---|---|---|
| 1 | git 検出（更新用） | 無いとき y/N |
| 2 | Node 22+ 検出 | 無いとき y/N（winget） |
| 3 | bun 1.4.2 検出 | 無いとき y/N（`npm install -g bun@1.4.2`） |
| 4 | ビルド（`bun install` → `build:sdk` → `build:webview`）+ 注入 UI 層の再適用 | 自動 |
| 5 | `apps\cline-hub\lan\config.json` 作成（既存は保持） | 自動 |
| 6 | Cline hub の応答確認（応答なしなら y/N で Cline desktop を起動して待機） | 自動 + y/N |
| 7 | ファイアウォール開放 / PATH 登録 / 起動 | すべて y/N |

- **インストールは必ず y/N 確認の後**に実行します（winget・npm・ファイアウォール・PATH）
- 起動前に内容だけ確認する: `install.cmd check`
- 非対話で流す: `set CLINE_INSTALL_DEFAULTS=1`（全質問を既定値 n で回答）+ `set CLINE_HUB_NO_PAUSE=1`
- Cline desktop / PC hub には一切触れません

導入後、コンソールに出る招待 URL をスマホで開くと操作できます（PC 自身は `http://localhost:8788/`）。

```cmd
start.cmd                       :: 起動（リポジトリ直下。ハブ確認 → スマホ 8787 + PC 8788、QR と招待 URL）
stop.cmd                        :: 停止（リポジトリ直下。ダッシュボードのみ、desktop は無傷）
start.cmd nobrowser             :: PC ブラウザを開けずに起動
powershell -ExecutionPolicy Bypass -File apps\cline-hub\lan\install-cli.ps1
                                :: 任意: cline-hub start / stop / status / doctor
```

`start.cmd` は起動前に **upstream（`product/main`）の新しいコミットを確認**します。一覧を表示して `y/N` で伺い、`y` のときだけ `git pull --ff-only` + 再ビルド + 注入 UI 層の再適用 + ダッシュボード再起動を実行します（`n`・オフライン・ローカル変更ありなら無変更で続行）。

`start.cmd` は起動前に **Cline hub が応答しているかを確認**します（`bun lan-hub.mjs hub`）。応答しない場合は **Cline desktop を自動で起動**し、hub が立ち上がるまで最大 90 秒待ってから続行します。立ち上がらない場合だけエラー終了し、インストール先（https://cline.bot/desktop）と確認コマンドを表示します。desktop を停止・再起動・設定変更することは一切ありません。

---

## 仕組み

```
Cline desktop (cline-app.exe)
   └─ hub デーモン code-sidecar.exe  →  ws://127.0.0.1:25463/hub
        （~/.cline/data/locks/hub/production.json に pid / url を記録）
                ▲ 同じ hub にクライアントとして接続
                │
cline-mobile ダッシュボード（スマホ 8787 / PC 8788）──スマホ（roomSecret 付き招待 URL）
```

- エージェントループ・ツール実行・LLM 呼び出しは **PC 側の Cline hub デーモン**で起きます
- ダッシュボードは `session.create` / `run.start` / `approval.respond` を発行する**仲介のみ**（セッションを実行しません）
- ランチャー（`apps/cline-hub/lan`）は cline のコードを import しない純粋なプロセス監視で、**パッチも一切ありません**

## 前提

| 項目 | 値 |
|---|---|
| OS | Windows（ファイアウォール設定は PowerShell） |
| Node | 22 以上 |
| bun | 1.4.2（`npm install -g bun@1.4.2`） |
| Cline desktop | インストール済み・サインイン済み・**起動していること** |
| スマホ | PC と同一 LAN の Wi-Fi |

## 手動で導入する

```cmd
node -v
npm install -g bun@1.4.2

git clone https://github.com/nameko393-lab/cline-mobile.git cline-mobile
cd cline-mobile
bun install
bun run build:sdk
bun run -F @cline/cline-hub build:webview

cd apps\cline-hub\lan
copy config.example.json config.json
bun lan-hub.mjs doctor              :: 全行 OK と hub record が出ることを確認
bun lan-hub.mjs firewall --apply    :: UAC 昇格・TCP/8787 を LAN サブネット限定で許可
cd ..\..\..
start.cmd                           :: リポジトリ直下（hub 確認 → 自動起動 → ダッシュボード起動）
```


## `config.json`（PC 固有・コミットしない）

`config.example.json` をコピーして作ります（`install.cmd` が自動）。空欄は自動検出・既定値です。

| キー | 既定 | 内容 |
|---|---|---|
| `repo` | 空 | cline チェックアウトのパス。空だと `apps/cline-hub/src/server.ts` を目印に自動検出 |
| `port` / `localPort` | 8787 / 8788 | スマホ用 / PC 用ポート |
| `host` | `0.0.0.0` | LAN バインド |
| `workspaceRoot` | `~/cline-workspace` | スマホから新規セッションを作る既定フォルダ |
| `publicHost` | 空 | 招待 URL に使う LAN IPv4（空で自動選択） |
| `lanSkip` | `[]` | 対象外 NIC（例 `["172.27.176."]` = Hyper-V） |
| `roomSecret` | 空 | 空だと初回起動時に自動生成して保存。**秘密なのでコミットしない** |

## Cline desktop と共存させるための必須事項

1. **desktop を起動してサインイン済み**にする（hub デーモンが `25463` で起動し lock が書かれる）。`doctor` の `hub record` 行に出なければ desktop を起動
2. **`CLINE_BUILD_ENV=development` を設定しない**（設定すると dev hub `ws://127.0.0.1:25466/hub` に入り、desktop の本番 hub のセッションが見えない）
3. hub record の capabilities に `session.create` / `session.run` / `stream.replay` が必要（desktop 側の SDK core が入れている）
4. **desktop で作ったセッションにスマホから送ると `session not found`** になり得る → 自動で hub に読み込み直して送り直す（`src/webview/src/lib/session-recovery.ts`）。ただし**リストアはチェックポイントまで作業フォルダのファイルも巻き戻す**ので、スマホから送る前に PC 側でコミットしておく
5. `stop.cmd` はダッシュボードだけを停止し、**desktop / PC hub には触れない**。desktop を終了すると hub record が消え、ターンは受け付けなくなる（desktop 再起動）
6. desktop 側は無変更なので、スマホ用の挙動は**ダッシュボードのみに効く**

## 質問（ask_followup_question）にスマホ／PC ブラウザから答える

エージェントが `ask_followup_question` で質問を出したとき、ダッシュボードはチャット下に
「質問カード」（選択肢ボタン＋自由入力の送信欄）を出します。PC・スマホの両方で回答できます。

| セッション | 質問の届き方 | 回答の届き方 |
|---|---|---|
| ダッシュボード（web）で作ったセッション | ダッシュボードが `askQuestion` エグゼキュータを提供しているので質問が飛んでくる | そのまま回答（エージェントがその場で再開） |
| desktop / CLI が作ったセッション | hub がブロードキャストする `capability.requested` を見て表示 | hub に `capability.respond` を送る。hub が所有者以外からの回答を拒否した場合は、止まっているターンを `run.abort` して**回答を次のプロンプトとして同じセッションに送る** |

- 実装: `src/server/questions.ts`（サーバー）、`src/webview/src/Chat.tsx`（質問カード）、`src/server/sessions.ts`（`sendAnswerAsPrompt`）
- 応答が無いままターンを止めないための既定応答: ブラウザ未接続・10 分のタイムアウト・セッション終了・中止・hub 切断
- desktop 側は無変更で動きます（desktop 自身の質問画面もそのまま使えます）
- 注意: 所有外のセッションへの回答はターンを中止してプロンプトで送り直すため、desktop 側で同じ質問に同時に答えると回答が 2 回届きます（どちらか一方だけから回答してください）

## スマホ用の挙動（本家ダッシュボードとの違い）

| 項目 | PC | スマホ | 実装 |
|---|---|---|---|
| Enter | **送信**（本家と同じ） | **改行**（送信は右下ボタン） | `src/webview/src/lib/composer-keyboard.ts` + `Composer.tsx`（`enterIsNewline: touchLayout`） |
| Shift+Enter | 改行 | 改行 | 本家 |
| IME 変換中の Enter | 変換確定（送信しない） | 変換確定 | 本家 |
| 送信ボタン | 本体のアイコン（フッター右） | **右下固定**（送信中は「停止」で中止） | `Composer.tsx` + `index.css`（`.cline-phone-send`） |
| 画面レイアウト | 通常 | 行折り返し・下部余白 40px・安全領域対応 | `index.css`（`@media (pointer: coarse)`）+ `viewport-fit=cover` |
| 判定 | - | `matchMedia("(pointer: coarse)")` | `src/webview/src/lib/use-touch-layout.ts` |
| 新規セッション / 削除確認 / 名前確定（スマホのみ） | 新規セッション・削除確認 | + 名前確定ボタン | 注入 UI 層 `lan/dashboard-ui.js`（composer には触らない） |

検証: `bun run -F @cline/cline-hub test`（vitest） / `bun run -F @cline/cline-hub test:lan`（注入 UI 層）

## 検証チェックリスト

```cmd
install.cmd check                      :: リポジトリ直下。環境レポート（何も変更しない）
cd apps\cline-hub\lan
bun lan-hub.mjs doctor                 :: 全行 OK（webview dist / sdk dist / hub record / firewall）
bun lan-hub.mjs hub                    :: hub 稼働確認（--launch で desktop を起動して待機）
bun lan-hub.mjs status
bun run -F @cline/cline-hub test:lan
bun run -F @cline/cline-hub test
start /a http://localhost:8788/health
```

`doctor` が全行 OK なら稼働します（例: `hub record : ws://127.0.0.1:25463/hub pid=...`、`hub health : healthy`、`invite URL : http://<PC IP>:8787/?roomSecret=...`）。

## 運用

| 目的 | コマンド |
|---|---|
| 起動 / 停止 | `start.cmd` / `stop.cmd`（**リポジトリ直下**、`cline-hub start` / `stop`） |
| 更新確認 / 適用 | `start.cmd` の [1/5]（一覧 + y/N → `git pull --ff-only` + 再ビルド + 再起動） |
| hub だけ確認 / 起動 | `bun lan-hub.mjs hub` / `bun lan-hub.mjs hub --launch`（`start.cmd` が毎回実行） |
| 反映（ダッシュボードはソース起動） | `bun lan-hub.mjs restart`（PC 用は `restart --local`） |
| 状態 / 招待 URL / 診断 / ログ | `status` / `url`（`--qr`）/ `doctor` / `logs 60` |
| ログファイル | `apps\cline-hub\lan\logs\dashboard.log`（スマホ用）・`dashboard-local.log`（PC 用） |

## 更新

`start.cmd` の **[1/5] Update check** が、upstream（`product/main`）の新しいコミットを
`git fetch`（読み取りのみ）で数え、一覧を表示して **y/N で確認**します。`y` を答えたときだけ
`git pull --ff-only` → `bun install` → `build:sdk` → `build:webview` → 注入 UI 層の再適用 →
ダッシュボード再起動 を実行します。`n`・オフライン・ローカル変更あり・fast-forward 不可の場合は
**何も変更せず**、現在のまま起動を続けます（`CLINE_INSTALL_DEFAULTS=1` は常に `n`）。

手動で更新する場合:

```cmd
git pull product main
bun install
bun run build:sdk
bun run -F @cline/cline-hub build:webview
cd apps\cline-hub\lan
bun lan-hub.mjs ui          :: build:webview が index.html を作り直すので注入 UI 層を再適用
cline-hub restart
```

`build:webview` を忘れると「送信ボタンが無い / Enter で送信される」になります（`doctor` の `webview dist` 参照）。逆に `build:webview` を実行すると `dist/webview/index.html` が作り直されて注入が落ちるため、`bun lan-hub.mjs ui`（または `start`）で再適用します。注入 UI 層は `dist/webview/assets/` にコピーされ、`index.html` の `?v=` でキャッシュ無効化されるので、スマホは再読み込みで反映されます。

## トラブル時

| 症状 | 対処 |
|---|---|
| `bun が見つかりません` | `npm install -g bun@1.4.2` |
| `Cline が見つかりません` | `config.json` の `repo` または `CLINE_REPO` |
| `webview が未ビルド` / `sdk dist` 警告 | `bun run -F @cline/cline-hub build:webview` / `bun run build:sdk` |
| `hub record` なし / `hub health` 失敗 | `start.cmd` が Cline desktop を自動起動して最大 90 秒待機。出ない場合は desktop を手動起動してサインイン → `bun lan-hub.mjs hub` |
| セッション一覧が空 | dev hub に接続していないか確認（`CLINE_BUILD_ENV` を設定しない） |
| `origin not allowed` | 招待 URL（`?roomSecret=`）で開く |
| スマホが到達できない | `bun lan-hub.mjs firewall --apply` / AP のクライアント分離 / `publicHost` |
| `session not found` | 自動で hub に読み込み直して送り直す。PC 側で編集したファイルは先にコミット |
| 送信ボタンが無い / Enter で送信される（スマホ） | `bun run -F @cline/cline-hub build:webview` → `bun lan-hub.mjs ui` → `restart` → スマホ再読み込み |
| 新規セッションボタン / 削除確認が出ない | `doctor` の `UI layer` を確認して `start`（または `bun lan-hub.mjs ui`）し直す |
| `update skipped`（更新が飛ぶ） | ローカル変更あり。`git status` でコミット / 破棄してから `start.cmd`（`y`） |

詳細は [apps/cline-hub/lan/README.md](apps/cline-hub/lan/README.md)（ランチャー詳細・制約・セキュリティ）と [apps/cline-hub/README.md](apps/cline-hub/README.md)（ダッシュボード本体）を参照。

---

## ライセンスと本家

- このリポジトリの追加部分（LAN ランチャー / 注入 UI 層 / ダッシュボードのスマホ向け調整）: **Apache License 2.0**（[LICENSE](LICENSE)）
- 土台の Cline 本体とダッシュボード: [cline/cline](https://github.com/cline/cline) の **Apache License 2.0** のまま
- 本家 README: https://github.com/cline/cline/blob/main/README.md ／ 本家 docs: https://docs.cline.bot
- 実行には PC 側で起動している Cline desktop / Cline Hub が必要です（このリポジトリ単独ではエージェントが動きません）
