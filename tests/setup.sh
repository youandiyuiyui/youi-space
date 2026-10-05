#!/usr/bin/env bash
# テストの準備（最初の一回と、tests/package.json・package-lock.json を変えたとき）。
# インターネットにつながる状態で動かす：bash tests/setup.sh
# Codex のクラウド環境では、環境の「Install script」（古い画面では「セットアップスクリプト」）にこの1行を入れる。
# 準備が済めば、テスト（npm test）はインターネットなしで動く。
set -euo pipefail
cd "$(dirname "$0")"

# Node.js 20 以上
if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)'; then
  echo "Node.js 20 以上が要ります（いま：$(node --version)）"; exit 1
fi

# Java 21 以上（Firestore エミュレーター用。firebase-tools 15 は 21 より古い Java では起動しない）
java_major() { command -v java >/dev/null 2>&1 && java -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' | head -n 1; }
JV="$(java_major || true)"
# クラウド環境（管理者権限の Linux）なら入れる
if [ "${JV:-0}" -lt 21 ] && command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" = 0 ]; then
  { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-21-jre-headless; } || true
  JV="$(java_major || true)"
fi
if [ "${JV:-0}" -lt 21 ]; then
  echo "Java 21 以上が要ります（Firestore エミュレーター用。いま：${JV:-見つからない}）"; exit 1
fi

npm ci --no-audit --no-fund
# Firestore エミュレーターを先に取ってくる（テストの途中でダウンロードしないように）
npx firebase setup:emulators:firestore

# Chromium（用意済みの環境では取ってこない。PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD は Playwright と同じく、0・false なら「取ってくる」）
skip="${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}"
if [ -z "${CHROMIUM_PATH:-}" ] && { [ -z "$skip" ] || [ "$skip" = 0 ] || [ "$skip" = false ]; }; then
  npx playwright install --with-deps chromium || npx playwright install chromium
fi

# 通し確認（ニックネーム・公開プロフィール）は、ニックネーム導入前の旧アプリ（tests/e2e/common.mjs の OLD_APP_COMMIT）を
# git の履歴から取り出す。履歴のない取り出し方（Codex のクラウドなど）でも使えるように、無ければここで取ってくる
OLD_APP=13bd66e491af8fb639dfcfd42197394037dc372c
if ! git -C .. cat-file -e "$OLD_APP^{commit}" 2>/dev/null; then
  git -C .. fetch -q --depth=1 https://github.com/youandiyuiyui/youi-space.git "$OLD_APP" \
    || echo "注意：旧アプリ（13bd66e）を取ってこられませんでした。通し確認のうち2件が NG になります（AGENTS.md の「テスト」）"
fi

echo "準備ができました。cd tests && npm test で全部のテストを動かせます。"
