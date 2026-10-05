#!/usr/bin/env bash
# テストの準備（最初の一回だけ）。インターネットにつながる状態で動かす：bash tests/setup.sh
# Codex のクラウド環境では、環境の「セットアップスクリプト」にこの1行を入れる。
# 準備が済めば、テスト（npm test）はインターネットなしで動く。
set -euo pipefail
cd "$(dirname "$0")"

# Node.js 20 以上
if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)'; then
  echo "Node.js 20 以上が要ります（いま：$(node --version)）"; exit 1
fi
# Java 11 以上（Firestore エミュレーター用）。クラウド環境（管理者権限の Linux）なら入れる
if ! command -v java >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" = 0 ]; then
  apt-get update -qq && apt-get install -y -qq openjdk-17-jre-headless
fi
if ! command -v java >/dev/null 2>&1; then
  echo "Java 11 以上が要ります（Firestore エミュレーター用）"; exit 1
fi

npm ci --no-audit --no-fund
# Firestore エミュレーターを先に取ってくる（テストの途中でダウンロードしないように）
npx firebase setup:emulators:firestore
# Chromium（用意済みの環境では取ってこない）
if [ -z "${CHROMIUM_PATH:-}" ] && [ -z "${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}" ]; then
  npx playwright install --with-deps chromium || npx playwright install chromium
fi
echo "準備ができました。cd tests && npm test で全部のテストを動かせます。"
