# You&i Space 開発メモ（引き継ぎ用）

地域の支え合い（支援者支援）のアプリ「You&i Space」のリポジトリです。運営は You&i（結）で、いまは同意を得た人だけが使う限定実証版です。

## ファイル
| ファイル | 中身 |
|---|---|
| `index.html` | アプリ本体（HTML・CSS・JS の1ファイル。ビルドなし）。main に入ると GitHub Pages に自動で公開される |
| `firestore.rules` | Firestore のセキュリティルールの記録。本番への反映は、Firebase コンソールに丸ごと貼り付けて「公開」する（CLI ではデプロイしていない） |
| `tests/` | ルールの単体テスト・エミュレーターでの通し確認・デモの通し操作 |
| `ogp-space.png` | OGP 画像 |

## 技術の前提
- Firebase compat SDK 10.12.0（CDN から読み込む）。プロジェクトは `you-i-space`。Auth（メールとパスワード）と Firestore を使う。
- 地図は Leaflet と国土地理院のタイル。
- Firebase を読み込めないとき、または「ゲストで試す」から入ったときは、ゲストのデモになる（`isGuestDemo()`）。デモは端末の中だけで動き、何も送信しない。
- 画面の文言とコード中のコメントは日本語。文言はやさしい言葉にして、専門用語を避ける。
- 版の表示は設定画面のいちばん下（`You&i Space v0.5.3 — 限定実証版`）。変更のたびに上げる。

## 反映の順番（大事）
アプリが新しい項目やコレクションを書く変更では、次の順にする。
1. 先に `firestore.rules` を Firebase コンソールで公開する
2. そのあとで PR をマージする（`index.html` が公開される）

新しいルールは、ひとつ前の版のアプリとも両立するように書く（利用者の端末に古い版が残る期間があるため）。PR の説明の冒頭に、この順番を書く。

## データの持ち方（Firestore）
| コレクション | 中身 | 読める人 |
|---|---|---|
| `users/{uid}` | 本名（`name`）・ニックネーム・メール・自己紹介・ブロック・本人確認 | 本人だけ |
| `profiles/{uid}` | 公開プロフィール（`name`＝ニックネームか団体名・`bio`・`verified`・`listed`） | 本人。`listed` が true ならログイン者。会話の相手（相手が名前を伏せていないとき）。ブロックされた人は読めない。一覧は取れない |
| `posts` | ついで（`tsuide`）・困っていること（`need`）・できること札（`can`）。`anon` は名前を伏せる投稿で、`authorName` は空 | ログイン者 |
| `conversations/{uidA_uidB}` と `messages` | 会話。ID は2人の uid を並べ替えて `_` でつなぐ（`convIdFor`）。`masked` は名前を伏せている人 | 参加者 |
| `thanks` | ありがとうと＆ポイントの手渡し（送り主の名前は持たない） | 贈った人と受け取った人 |
| `deals` / `decisions` | 「終わりました」の記録／「今回は伝えない」の記録 | 当事者／決めた本人 |
| `concerns` / `reports` | 「少し気になった」／通報 | 運営だけ（コンソール） |
| `config/disasterMode` | 災害モード | ログイン者は読むだけ |

## 壊してはいけない約束
- 本名は、ほかの利用者に見せない。表示名は `displayNameOf(u)`（個人はニックネーム、団体は団体名）。公開プロフィールの名前も、ルールでニックネームか団体名に限っている。
- 名前を伏せた頼みごとでは、投稿の `authorName` を空にし、会話では「ご近所の方」（`ANON_NAME`）と出す。伏せる設定を外せるのは本人だけ（`revealMyName`）。伏せている相手のプロフィールは開けない。
- ＆ポイントの残高は `users` に持たない。`thanks` から計算する（登録時の 300pt ＋ 受け取った分 − 手渡した分）。
- 低い評価や、支え合った回数・点数は他人に見せない。結びの段階と「よく言われること」は、本人のマイページにだけ出す（ゲストのデモも同じ）。
- 本人確認済み（`users.verified`）は運営だけが付ける。本人の端末は、それを公開プロフィールに写すだけ。

## 運営の操作（Firebase コンソール）
- **本人確認済みにする**：`users/{uid}` に `verified: true`。本人が次にログインしたとき、公開プロフィールにも印が付く（すぐ出したいときは `profiles/{uid}` の `verified` も true にする）。
- **災害モード**：`config/disasterMode` に `{ active: true, scope: '対象の地域' }`。
- **通報・少し気になった**：`reports` と `concerns` を見る。

## テスト（`tests/`）
最初の一回だけ準備する。Node.js 20 以上と、エミュレーター用の Java 11 以上が要る。
```
cd tests
npm install
npx playwright install chromium   # 自分のパソコンで初めて動かすとき
```

| コマンド | 確かめること |
|---|---|
| `npm run test:rules` | ルールの単体テスト（116件）。使う操作は許可され、悪用は拒否されるか |
| `npm run test:e2e` | 実際の `index.html` をエミュレーターにつないだ通し確認（全体の流れ・ニックネーム・公開プロフィール） |
| `npm run test:demo` | ゲストのデモを28画面通して、JSエラーが出ないか |
| `npm test` | 上の3つを順に |

- 通し確認は、リポジトリの `firestore.rules` をエミュレーターに読み込んでから動く。
- 一部だけ動かす：`npx firebase emulators:exec --only auth,firestore --project demo-youi "node e2e/run.mjs profiles"`（`full` / `nickname` / `profiles`）
- 画面を撮る：`SHOTS=shots npm run test:demo`（通し確認の `profiles` も `SHOTS` に対応）
- 別のルールで試す：`RULES=ファイルの場所 npm run test:rules`
- ニックネーム導入前の旧アプリ（git の `13bd66e`）で登録した人の移行も確かめる。履歴が足りずに失敗するときは `git fetch --unshallow`。
- 決まった場所の Chromium を使うときは `CHROMIUM_PATH` を指定する。Claude Code のクラウド環境には対応する Chromium が入っているので、ダウンロードは要らない。
- 変更を出す前に、関係するテストを通す。ルールを変えたら `tests/rules.test.mjs` にケースを足す。画面の流れを変えたら `tests/e2e/` か `tests/demo/steps.json` を直す。

## 分かっている制約
- 名前を伏せた投稿にも投稿者の uid が残るので、同じ人の名前つき投稿と結び付けられてしまう。完全に防ぐには Cloud Functions（有料の Blaze プラン）が要る。
- 感謝を受け取った人には、贈った人の uid と時刻が見える（同じく Cloud Functions で解決できる）。

## 作業の進め方
- ブランチを切って PR を出す。ルールの変更がある PR には「反映の順番」を書く。
- 運営への報告は日本語で、専門用語を避け、表や箇条書きで分かりやすく書く。
