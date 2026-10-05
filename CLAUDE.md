# You&i Space（Claude Code 用の入口）

約束・手順の正本は `AGENTS.md` です（Codex など、ほかのエージェントと共通）。ここには書き足さず、`AGENTS.md` を直してください。

@AGENTS.md

## Claude Code だけのメモ
- クラウド環境では `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` が設定されているので、`tests/setup.sh` は Chromium をダウンロードしない。テストは `PLAYWRIGHT_BROWSERS_PATH`（`/opt/pw-browsers`）に入っている Chromium を使う。これは、いまの Playwright（`tests/package.json` の 1.56.1）に合うもの。Playwright の版を変えると合わなくなるので、そのときは `npx playwright install chromium` で合う Chromium を取ってくる（インターネットが要る）。
