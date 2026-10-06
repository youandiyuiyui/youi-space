# You&i Space 開発メモ（引き継ぎ用）

地域の支え合い（支援者支援）のアプリ「You&i Space」のリポジトリです。運営は You&i（結）で、いまは同意を得た人だけが使う限定実証版です。

## ファイル
| ファイル | 中身 |
|---|---|
| `index.html` と `post-safety.js` / `auth-session.js` / `points-ledger.js` | アプリ本体と安全性の共通処理（ビルドなし）。main に入ると GitHub Pages に自動で公開される。JSも同時に公開する |
| `firestore.rules` | Firestore のセキュリティルールの記録。本番への反映は、Firebase コンソールに丸ごと貼り付けて「公開」する（CLI ではデプロイしていない） |
| `firestore.indexes.json` / `firebase.json` | 投稿・会話・支え合いの複合インデックスとローカルエミュレーター設定 |
| `tools/` | 管理者だけが使う既存データ移行。既定はdry-run。Firebase Adminの認証が必要 |
| `tests/` | ルールの単体テスト・エミュレーターでの通し確認・デモの通し操作 |
| `ogp-space.png` | OGP 画像 |

## 技術の前提
- Firebase compat SDK 10.12.0（CDN から読み込む）。プロジェクトは `you-i-space`。Auth（メールとパスワード）と Firestore を使う。
- 地図は Leaflet と国土地理院のタイル。
- Firebase を読み込めないとき、または「ゲストで試す」から入ったときは、ゲストのデモになる（`isGuestDemo()`）。デモは端末の中だけで動き、何も送信しない。
- 画面の文言とコード中のコメントは日本語。文言はやさしい言葉にして、専門用語を避ける。
- 版の表示は設定画面のいちばん下（`You&i Space v0.5.5 — 限定実証版`）。変更のたびに上げる。

## 反映の順番（大事）
アプリが新しい項目やコレクションを書く変更では、次の順にする。
1. 先に `firestore.rules` を Firebase コンソールで公開する
2. そのあとで PR をマージする（`index.html` が公開される）

新しいルールは、ひとつ前の版のアプリとも両立するように書く（利用者の端末に古い版が残る期間があるため）。PR の説明の冒頭に、この順番を書く。

v0.5.5のP1修正は例外。発起人の選択により実アカウントの匿名機能を一時停止し、旧版の広い一覧・匿名会話・旧方式の送金をルールで拒否する。作業時間を設け、`config/pointsLedger.ready` と `config/privacyMigration.ready` をfalseにしてからルール・インデックスを反映する。`tools/migrate-points.mjs` と `tools/migrate-privacy.mjs` のdry-runを確認してapplyし、移行を確認した後に送金を再開してPRをマージする。失敗時はfalseを維持し、旧ルールへ戻さない。人向けの手順は資料フォルダのWord文書にまとめる。

## データの持ち方（Firestore）
| コレクション | 中身 | 読める人 |
|---|---|---|
| `users/{uid}` | 本名（`name`）・ニックネーム・メール・自己紹介・ブロック・本人確認 | 本人だけ |
| `profiles/{uid}` | 公開プロフィール（`name`＝ニックネームか団体名・`bio`・`verified`・`listed`） | 本人。`listed` が true ならログイン者。会話の相手（相手が名前を伏せていないとき）。ブロックされた人は読めない。一覧は取れない |
| `posts` | 新規は名前つきのみ。旧匿名投稿は本人の確認と取り下げだけ | 名前つきはログイン者。旧匿名は本人のみ |
| `conversations/{v2_uidA_uidB}` と `messages` | 通常会話。旧通常会話は旧IDを継続。移行で安全と確認した会話だけ `privacySafe:true` | 安全な会話の参加者 |
| `thanks` | 感謝の記録。正のポイントは財布2件と感謝を一括保存 | 安全な記録の贈った人と受け取った人 |
| `wallets/{uid}` / `pointsGrants/{uid}` | 確定残高／再配布を防ぐ初回300ptの記録。削除不可 | 本人だけ |
| `deals` / `decisions` | 「終わりました」の記録／「今回は伝えない」の記録 | 安全な記録の当事者／決めた本人 |
| `privacyQuarantine` | 匿名または安全性不明の旧データの保管原本 | 運営のみ |
| `config/pointsLedger` / `config/privacyMigration` | ポイントと通常会話の移行・稼働設定（readyはbool） | ログイン者は読むだけ |
| `concerns` / `reports` | 「少し気になった」／通報 | 運営だけ（コンソール） |
| `config/disasterMode` | 災害モード | ログイン者は読むだけ |

## 壊してはいけない約束
- 本名は、ほかの利用者に見せない。表示名は `displayNameOf(u)`（個人はニックネーム、団体は団体名）。公開プロフィールの名前も、ルールでニックネームか団体名に限っている。
- 実アカウントの匿名投稿・匿名会話は一時停止。ゲストの架空デモだけは維持する。旧匿名会話がある2人でv2会話を新規作成し、相手を識別することも拒否する。
- 実残高は非公開の `wallets` に持ち、`YouiPoints.send` のtransactionとルールで感謝・送信者の引落・受信者の加算を同時に確定する。履歴画面は安全な `thanks` から作る。旧匿名の感謝も移行残高へ計上し、負債を0に丸めたり300ptを再配布したりしない。移行済walletが欠落した場合は推測して再作成せず中止する。
- ＆ポイントの引き換え（お店・Gallery・寄付）は、実アカウントでは実証期間中は準備中（`redeem` は「準備中」とだけ出す）。ゲストのデモでは、確認 → 引換券 → 記録まで体験できる。デモの残高と記録は端末の中の `window.__demoTx` から計算し、何も送信しない。
- 低い評価や、支え合った回数・点数は他人に見せない。結びの段階と「よく言われること」は、本人のマイページにだけ出す（ゲストのデモも同じ）。
- 本人確認済み（`users.verified`）は運営だけが付ける。本人の端末は、それを公開プロフィールに写すだけ。

## 運営の操作（Firebase コンソール）
- **本人確認済みにする**：`users/{uid}` に `verified: true`。本人が次にログインしたとき、公開プロフィールにも印が付く（すぐ出したいときは `profiles/{uid}` の `verified` も true にする）。
- **災害モード**：`config/disasterMode` に `{ active: true, scope: '対象の地域' }`。
- **通報・少し気になった**：`reports` と `concerns` を見る。

## テスト（`tests/`）
最初の一回だけ準備する。Node.js 22 以上と、エミュレーター用の Java 21 以上が要る。
```
cd tests
npm ci
npx playwright install chromium   # 自分のパソコンで初めて動かすとき
cd ../tools
npm ci
cd ../tests
```

| コマンド | 確かめること |
|---|---|
| `npm run test:unit` | 投稿ID・不正な型の表示、Auth切替、匿名移行の分類 |
| `npm run test:rules` | 既存ルールとP1追加ケース、ポイントと匿名の管理者移行を実エミュレーターで確認 |
| `npm run test:e2e` | 実際の `index.html` をエミュレーターにつないだ通し確認（全体の流れ・ニックネーム・公開プロフィール） |
| `npm run test:demo` | ゲストのデモを36画面通して、JSエラーが出ないか。＆ポイントの引き換え・記録などの確認（`steps.json` の `expect`）も通るか |
| `npm test` | 上の4つを順に（testsフォルダで実行） |

- 通し確認は、リポジトリの `firestore.rules` をエミュレーターに読み込んでから動く。
- 一部だけ動かす：`npx firebase emulators:exec --config ../firebase.json --only auth,firestore --project demo-youi "node e2e/run.mjs profiles"`（`full` / `nickname` / `profiles`）
- 画面を撮る：`SHOTS=shots npm run test:demo`（通し確認の `profiles` も `SHOTS` に対応）
- 別のルールで試す：`RULES=ファイルの場所 npm run test:rules`
- ニックネーム導入前のデータは `e2e/legacy-fixtures.mjs` で管理者エミュレーターに作り、最新アプリで確認する。旧版の危険な操作を許すために本番ルールを緩めない。
- 決まった場所の Chromium を使うときは `CHROMIUM_PATH` を指定する。Claude Code のクラウド環境には対応する Chromium が入っているので、ダウンロードは要らない。
- 変更を出す前に、関係するテストを通す。ルールを変えたら `tests/rules.test.mjs` にケースを足す。画面の流れを変えたら `tests/e2e/` か `tests/demo/steps.json` を直す。

## 分かっている制約
- 実匿名機能は停止中。再開には投稿・会話・感謝を通じた匿名IDと本人IDの分離をサーバー側で設計する必要がある。過去に取得されたUIDの対応関係はこの修正で取り消せない。
- 通常の感謝には贈った人のUIDと時刻が残る。画面で名前を出さないことと、匿名であることは別なので、匿名のお礼として扱わない。

## 作業の進め方
- ブランチを切って PR を出す。ルールの変更がある PR には「反映の順番」を書く。
- 運営への報告は日本語で、専門用語を避け、表や箇条書きで分かりやすく書く。
