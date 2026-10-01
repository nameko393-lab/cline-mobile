# Cline Hub LAN dashboard（スマホから PC の Cline を操作）

> **EN**: A standalone Windows launcher for Cline's official Hub dashboard
> (`apps/cline-hub`). It binds the dashboard to the LAN, generates the phone
> invite URL + QR, opens the Windows firewall port, and supervises the process.
> It contains **no Cline code** and applies **no patches** — the dashboard is a
> pure mediator: it issues `session.create` / `run.start` hub commands and the
> agent loop runs in your local Cline Hub daemon. Requires a stock Cline
> checkout + a running Cline desktop / Cline Hub. Apache-2.0.

`apps/cline-hub` の公式ダッシュボードを `0.0.0.0` にバインドし、同一 LAN のスマホから
PC 側の Cline（desktop / Cline Hub）が登録しているセッションを操作するための起動スクリプトです。

このリポジトリは**ランチャーのみ**です（cline のコードは含みません）。対象の cline
チェックアウトは `config.json` の `repo` か `CLINE_REPO` 環境変数で指定し、省略すると
`apps/cline-hub/src/server.ts` を目印に自動検出します（このランチャーを cline の
`apps/cline-hub/lan` に置いた場合も自動検出されます）。PC 固有の値は `config.json` に
隔離してあり、コミットしません。

## 場所（このリポジトリ内）

このランチャーは本リポジトリの `apps/cline-hub/lan` に同梱されています（旧 `cline-hub-lan`
単独リポジトリは履歴ごとここに移動し、アーカイブ予定です）。

```powershell
cd <repo>\apps\cline-hub\lan
bun install              # ルートで bun install を実行済みなら qrcode も入ります
.\start.cmd              # ダブルクリックでも可（LAN 8787 + PC 8788）
.\stop.cmd
bun lan-hub.mjs doctor
bun run -F @cline/cline-hub test:lan   # ランチャー単体のテスト
```

`repo` 指定は省略できます。この位置から親方向へ `apps/cline-hub/src/server.ts` を目印に
自動検出します。


## 構成（2 部分）

| 部分 | 場所 | cline 本体との結合 |
|---|---|---|
| **A. ダッシュボード本体** | cline リポジトリの `apps/cline-hub` | cline 同梱。`@cline/core` / `@cline/llms` / `@cline/shared` への `workspace:*` 依存で `bun install` + `bun run build:sdk` が必要。**このランチャーは無変更で使う**（パッチ当て不要） |
| **B. このランチャー** | 本リポジトリの `apps/cline-hub/lan` | **結合なし**。Node 内蔵モジュールだけで動き、cline のコードは import しません。`bun <repo>/apps/cline-hub/src/server.ts` を環境変数付きで起動するだけのプロセス監視です |

`doctor` は cline チェックアウトが**素の状態**であることを表示します（`apps/cline-hub` に
ローカル変更があれば件数とファイル名を報告します）。

## 動作モデル（すべて仲介）

ダッシュボードはセッションを実行しません。ハブへのコマンド発行とイベント描画だけです。

```
ブラウザ ──WS(roomSecret)──> ダッシュボード(仲介) ──WS(hub)──> Cline Hub デーモン(実行)
                                                                    ▲
                                        Cline desktop / Cline CLI も同じ hub に接続
```

コード上の根拠（cline 標準の挙動で、無変更で成り立ちます）:
- `sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts`
  - `startSession()` → `client.command("session.create", …)`
  - `runTurn()` → `client.command("run.start", …)`
  - ツール承認の応答 → `client.command("approval.respond", …)`
- hub record の capabilities に `session.create` / `session.run` / `stream.replay`
  （`~/.cline/data/locks/hub/production.json`）

エージェントループ・ツール実行・LLM 呼び出しは **hub デーモン側**（PC で動いている Cline 本体）で
起きます。ダッシュボードは `cline-hub-chat` / `cline-hub-server` として接続するクライアントで、
このランチャーが足すのは「バインドアドレス・ポート・roomSecret・workspaceRoot の環境変数」と
プロセス監視だけです。

## 必要環境

| 項目 | 値 |
|---|---|
| OS | Windows（ファイアウォール設定は PowerShell） |
| bun | 1.4.2（`npm install -g bun@1.4.2`） |
| Node | 22 以上（bun 起動用） |
| Cline | 素の状態の cline チェックアウト（無変更）+ PC 側で Cline desktop / Cline Hub が起動していること |

## 新規 PC でのセットアップ

```cmd
git clone https://github.com/cline/cline.git
cd cline
npm install -g bun@1.4.2
bun install
bun run build:sdk
cd apps\cline-hub
bun run build:webview
cd <このランチャー>
bun lan-hub.mjs doctor        :: "cline checkout : 無変更（素の状態）" を確認
```

cline は**素の状態**のまま使います。このランチャーは cline のコードを一切変更しません
（パッチも同梱していません）。cline 側の挙動を変えたい場合は、それは cline 本体の変更として
別枠で扱ってください。

`doctor` はリポジトリの場所をこのスクリプトからの相対で自動検出します
（`apps/cline-hub/src/server.ts` を目印に親ディレクトリを辿るため、チェックアウトの場所や
ユーザー名は関係ありません）。

## 起動・停止

**推奨: `cline-hub` を PATH に入れる**（どのフォルダ・どのシェルからでも使える）

```cmd
powershell -ExecutionPolicy Bypass -File install-cli.ps1
:: 端末を再起動すると:
cline-hub start      :: LAN 8787 + PC 用 8788 を起動し、招待URLとQRを表示
cline-hub stop       :: ダッシュボードだけ停止（Cline desktop / PC hub には触れない）
cline-hub status  /  url  /  doctor  /  logs 60  /  firewall --apply
:: 取り消し: powershell -ExecutionPolicy Bypass -File install-cli.ps1 -Remove
```

**スクリプトを直接使う場合**

| 実行方法 | 記述 |
|---|---|
| エクスプローラーで二重クリック | `start.cmd` / `stop.cmd` |
| cmd.exe | `cd /d <このフォルダ>` → `.\start.cmd` |
| PowerShell | `cd <このフォルダ>` → `.\start.cmd` |

`.\` が必要な理由: PowerShell はカレントディレクトリを探索しません。さらに
`NoDefaultCurrentDirectoryInExePath=1` が設定されている環境（Windows Terminal、VS Code、
自動化作業のシェル）では cmd.exe もカレントを探索しないため、`start.cmd` という素の名前は
`not recognized` になります（`.\start.cmd` かフルパスなら動きます）。両スクリプトは先頭で
`cd /d "%~dp0"` して自分のフォルダに移動するので、フルパス呼び出しはどの場所からでも安全です。

`bun` は PATH → `%USERPROFILE%\AppData\Roaming\npm\...` → `%USERPROFILE%\.bun\bin` の順に探します。

## コマンド

```cmd
bun lan-hub.mjs start              :: スマホ用（0.0.0.0:8787、roomSecret 必須）
bun lan-hub.mjs local              :: PC ブラウザ用（127.0.0.1:8788、roomSecret 不要）
bun lan-hub.mjs stop [--local]
bun lan-hub.mjs restart [--local]
bun lan-hub.mjs status
bun lan-hub.mjs url                :: 招待 URL（1 行目）+ QR
bun lan-hub.mjs doctor
bun lan-hub.mjs firewall --apply   :: 管理者 UAC プロンプトあり（TCP/8787 を LAN 限定で許可）
bun lan-hub.mjs logs [行数]
```

## config.json（コミットしない）

`config.example.json` を `config.json` にコピーして編集します。すべて省略可能で、
省略した値は自動決定されます。

| キー | 既定 | 説明 |
|---|---|---|
| `repo` | 自動検出 | Cline チェックアウトのパス。このフォルダがリポジトリ内にあれば自動 |
| `port` | `8787` | スマホ用ダッシュボードのポート |
| `localPort` | `8788` | PC 用（localhost）ダッシュボードのポート |
| `host` | `0.0.0.0` | LAN バインド |
| `workspaceRoot` | `~/cline-workspace` | 新規セッションの作業フォルダ（起動時に作成） |
| `publicHost` | 自動検出 | 招待 URL に使う LAN の IPv4。`CLINE_LAN_IP` でも上書き可 |
| `lanSkip` | `[]` | 自動検出で除外する接頭辞（例 `["172.27.176."]` = Hyper-V 等） |
| `roomSecret` | 自動生成 | 初回起動時に生成されて `config.json` に保存される |

`roomSecret` は秘密です。`config.json` は gitignore 済みなので共有・コミットしないでください。

## スマホでの接続

1. PC で `start.cmd` を実行し、表示される招待 URL をコピー
   （`http://<PC の LAN IP>:8787/?roomSecret=...`）
2. 同一 Wi-Fi のスマホで開く。**`?roomSecret=...` が必須**
   （無いと `origin not allowed` になる）
3. セッション一覧から選び、Composer でプロンプトを送る

## スマホ用の操作性は cline ソース側（注入ではない）

Enter の扱い・送信ボタン・画面サイズはダッシュボード本体のソースに入っています。

| 項目 | 挙動 | 実装 |
|---|---|---|
| Enter | PC は**送信**（本家と同じ）／スマホは**改行**（送信は右下のボタン） | `src/webview/src/lib/composer-keyboard.ts` + `Composer.tsx`（`enterIsNewline: touchLayout`） |
| Shift+Enter | 従来どおり改行（ブラウザに委譲） | 同上 |
| 日本語入力 | IME 変換確定の Enter をそのまま尊重 | 同上 |
| 送信（PC） | 本体の送信ボタン（フッター右のアイコン） | `src/webview/src/components/Composer.tsx` |
| 送信（スマホ） | 画面の**右下に固定**した送信ボタン。送信中は **停止** になり、押すと中止。タッチ画面ではフッターの送信ボタンは隠れる | 同上 + `src/webview/src/index.css`（`.cline-phone-send`） |
| 画面 | 横スクロール禁止・セーフエリア余白・タップ目標 40px・入力 16px（iOS のフォーカス時ズーム防止） | `src/webview/src/index.css`（`@media (pointer: coarse)`）+ `index.html` の `viewport-fit=cover` |
| 判定 | `matchMedia("(pointer: coarse)")` | `src/webview/src/lib/use-touch-layout.ts` |
| `session not found` | hub に読み込み直して会話を継ぐ（下記） | `src/webview/src/lib/session-recovery.ts` |

検証: `bun run -F @cline/cline-hub test`（`composer-keyboard.test.ts` と
`session-recovery.test.ts` を含む vitest）

## 注入する UI 層（1 つ）

`start` は `dashboard-ui.js` をダッシュボードの**ビルド成果物**
（`apps/cline-hub/dist/webview/assets/`、gitignore 対象）へコピーし、`index.html` に
`<script>` を 1 行追加します。`stop` で解除（タグとアセットを削除）。cline のソースに
は触れないので、cline は素のままです。

| ファイル | 有効になる環境 |
|---|---|
| `dashboard-ui.js` | PC / スマホ共通（入力欄・送信ボタンには一切触れない）。**確定ボタンはスマホのみ**（PC は Enter で確定できるので出さない） |

### ダッシュボード用の追加（`dashboard-ui.js`）

ダッシュボード本体に無い 3 つを足します（ダッシュボード自身のルーティングと
ボタン発火だけを駆動する外側の層です）。

| 項目 | 挙動 |
|---|---|
| Sessions タブ | 見出しの右に**新規セッション**ボタン。押すとダッシュボード自身の画面遷移でセッション無し状態のチャットを開く（`?roomSecret=` 等のクエリは維持し、`?id=` だけ外す） |
| セッション名（**スマホのみ**） | 入力欄の右に**確定**ボタン。押すとダッシュボード自身の Enter 確定（リネーム）が走る。スマホのキーボードは Enter が出しにくいための補完。PC ではボタンを出さない（Enter で確定できるため） |
| 削除ボタン | 会話画面のゴミ箱を押すと**確認ダイアログ**（セッション名を表示）。「削除」で本体の削除が走る。キャンセル・背景クリック・Esc で閉じると何も起きない |
| 入力欄（composer） | **触れない**。Enter も送信ボタンもソース側だけの扱い（PC は本体の送信ボタン、スマホは右下の固定ボタン） |

- 色はダッシュボード自身の CSS 変数（`--background` 等）を使う。これらは `oklch()`
  値なので**そのまま色の値として**参照する（`hsl(var(--background))` は不正な指定に
  なり背景が透明になる）
- **確定ボタンは入力欄を focus しない**：本体の `onFocus` は下書きを保存済み名へ
  リセットするため、focus すると入力中の内容が消えて確定が空振りになる。Enter
  キーダウンだけをリプレイし、入力欄がフォーカス中のときだけ blur する
- Sessions タブの行末メニューの Delete はダッシュボード本体の確認ダイアログが既にあり、そのままです
- **Enter と送信は 1 層だけ**：入力欄の Enter も送信ボタンもソース側（`composer-keyboard.ts` と `Composer.tsx`）だけが扱う。`dashboard-ui.js` は入力欄・送信ボタンに一切触れない（Enter 1 回で改行が 2 個入る重複処理を防ぐ）
- 検証: `bun run -F @cline/cline-hub test:lan`（ヘッドレス DOM で新規セッション遷移 / 確定ボタン / 削除確認 / キャンセル / 注入層が入力欄に触れないこと / ソース側との排他を再現）
- `bun run build:webview` を実行すると注入は消えるので、次回 `start` で再導入されます
- 注入した JS はブラウザがキャッシュします。`start` ごとにタグの `?v=`（注入ファイルの
  更新時刻＋サイズ）が変わるので、**通常のリロードだけで新しい版が読めます**

## セッション名のリネームは cline 本体側の 1 箇所の修正が要る

ダッシュボードはリネームを `updateSessionMetadata`（`metadata: { title }`）として
サーバーに送ります。ハブの永続化層は **`title` を専用フィールドとして受け取ったときだけ
リネームとして扱い**、`metadata.title` は保存済みの名前の方で上書きされます
（`sdk/packages/core/src/session/services/persistence-service.ts` の `updateSession`。
`hub-runtime-host.ts` にも「folding it into `metadata.title` would silently drop
renames」と明記されています）。

なので `apps/cline-hub/src/server.ts` の `updateSessionMetadata` ハンドラは `title` を
`metadata` から分解して、専用フィールドで渡します:

```ts
const { title, ...restMetadata } = frame.metadata ?? {};
await ctx.cline.update(frame.sessionId, {
	metadata: { ...metadata, ...restMetadata },
	...(typeof title === "string" ? { title } : {}),
});
```

これが無いと **確定ボタンも PC の Enter も、リネームが黙って元の名前に戻ります**。
書き込みはサーバー側だけを通るので、注入した UI 層では直せません。

ダッシュボードは `bun run src/server.ts` でソースから起動しているため、修正は
`restart`（PC 用ブラウザ側は `restart --local`）だけで反映されます。`doctor` の
`session rename` 行がこの修正が入っているか点検します。

- 検証: `bun rename-check.mjs 8788`（PC 用） / `bun rename-check.mjs 8787`（スマホ用）。
  ダッシュボード本来のブラウザプロトコルでセッション名を書き換え、push されるセッション
  一覧に新しい名前が乗ることを確認します。確認後は `--title="<元の名前>"` で戻してください

## 実測で確定した制約

1. **本番ビルドで動かす**: `CLINE_BUILD_ENV=development` を設定すると dev hub
   （`ws://127.0.0.1:25466/hub`）に参加し、desktop の本番 hub（`ws://127.0.0.1:25463/hub`）
   のセッションが見えません。
2. **`PUBLIC_URL` と Host/Origin が一致している必要がある**: `HOST=0.0.0.0` のとき
   ダッシュボードは `PUBLIC_URL` の Host と一致する Origin だけ許可します。
3. **`ROOM_SECRET` 必須**: ローカル以外へのバインドでは必須。
4. **スマホの IP を PC 側で監視しない**: 許可 Origin は招待 URL の Host のみ。
5. **Windows ファイアウォール**: `firewall --apply` で `cline-hub-lan-8787`
   （TCP/8787、Private プロファイル、RemoteAddress=LocalSubnet）を追加。
6. **AP のクライアント分離**: スマホが PC に到達できない環境では PC 側ブラウザ
   （`http://localhost:8788/`）で動作確認し、ルーター側を調整する。

## `session not found` は会話ごと hub に読み込み直す（自動）

セッション一覧はディスク上の全セッション（desktop / CLI / 完了済み）を含みますが、ターンを
受け付けるのは hub がメモリに持つセッションだけです。ダッシュボードはセッションを選ぶと履歴を
表示するだけで hub に読み込ませないため、デスクトップで作ったセッションなどに送ると `session not found:<id>` になります。

対処（ダッシュボード本体の WS 仲介。`src/webview/src/lib/session-recovery.ts`）:
1. そのエラーを受け取ると、ダッシュボード本来の `restore` を発火して**そのセッションを hub に読み込み直し、会話を継いだまま入力したプロンプトを送り直します**（履歴とチェックポイントが復元され、プロバイダ／モデル／モードも引き継がれます）
2. チェックポイントが無い／リストアが応答しないセッションは、**同じフォルダの新セッション**に送り直します（hub がフォルダを知らないセッションは作り直さない。その場合は新規セッションとして送ってください）

ブラウザ側の WebSocket を眺める仲介は不要になり、復旧はダッシュボード本体のコードで動きます。
PC ブラウザからも同じように効きます。

- **注意**: リストアはチェックポイントの時点まで**作業フォルダのファイルも巻き戻します**
  （ダッシュボード本来の restore と同じ挙動）。チェックポイント以降に PC 側で手編集した
  ファイルがある場合は、スマホから送る前に PC 側でコミットしておいてください

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `bun が見つかりません` | `npm install -g bun@1.4.2` |
| `Cline が見つかりません` | `config.json` の `repo`、または `CLINE_REPO` を設定 |
| `webview が未ビルド` | `cd apps\cline-hub && bun run build:webview` |
| `sdk dist` 警告 | `bun run build:sdk` |
| `hub record` なし | PC 側で Cline desktop / Cline Hub を起動 |
| `LAN candidates` が空 / 変な IP | `publicHost` を設定、または `lanSkip` で除外 |
| スマホが到達できない | `firewall --apply`、AP のクライアント分離、PC の IP 変化 |
| `origin not allowed` | 招待 URL（`?roomSecret=`）で開く |
| `session not found` | 自動でそのセッションを hub に読み込み直して送り直す（上のセクション）。トーストが出ないまま失敗するだけなら、セッション一覧が届くのを待って再送 |
| 送信ボタンが無い / Enter で送信される | ソース版がビルドされていない。`cd apps\cline-hub && bun run build:webview` してリロード（`doctor` の `webview dist` を確認） |
| 送信ボタンが右にはみ出して押せない | ビルドが古い（`flex-wrap` / セーフエリアの規則がない）。`bun run build:webview` し直してリロードする |
| 新規セッションボタン / 削除確認が出ない | `dashboard-ui.js` 未導入。`doctor` で `UI layer` を確認し `start` し直す |
| 確認ダイアログが半透明・読みにくい | 注入が古い版。`start` し直して `assets/cline-lan-dashboard-ui.js` を更新（`oklch()` の変数を `hsl()` で包むと透明になる） |

ログ: `logs/dashboard.log`（LAN）、`logs/dashboard-local.log`（PC 用）
状態: `bun lan-hub.mjs status` / `doctor`

## セキュリティ

- `0.0.0.0` バインド + `roomSecret` 必須
- 許可 Origin は招待 URL の Host のみ
- ファイアウォールは LAN サブネット限定インバウンド（`LocalSubnet`）
- `roomSecret` は秘密。`config.json` はコミットしない
- `stop.cmd` はダッシュボードだけを停止し、desktop / PC hub には触れない
---

## 配布の形態（ライセンス）

このリポジトリに **cline のコードは 1 つも含まれていません**。ダッシュボード本体
（`apps/cline-hub`）は利用者の cline チェックアウトから起動します。

- ランチャー: Apache License 2.0（`LICENSE`）
- 起動対象の Cline / ダッシュボード: [cline/cline](https://github.com/cline/cline) の Apache License 2.0
- 実行には Cline 本体（PC 側で起動している Cline desktop / Cline Hub）が必要です
- 動作確認済み: cline `main` 無変更（`bun run test` 112 passed）+ インストール版 Cline Desktop の hub デーモン
