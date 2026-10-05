# You&i Space（Claude Code 用の入口）

約束・手順の正本は `AGENTS.md` です（Codex など、ほかのエージェントと共通）。ここには書き足さず、`AGENTS.md` を直してください。

@AGENTS.md

## Claude Code だけのメモ
- クラウド環境には対応する Chromium が入っている（`PLAYWRIGHT_BROWSERS_PATH` が設定済み）ので、`tests/setup.sh` は Chromium をダウンロードしない。
