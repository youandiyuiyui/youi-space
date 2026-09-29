// 通し確認をまとめて実行する（エミュレーターの中で動かす：npm run test:e2e）
// 一部だけ動かすとき：node e2e/run.mjs profiles
import { launch, loadRules, resetEmulators, results } from './common.mjs';
import * as full from './full.mjs';
import * as nickname from './nickname.mjs';
import * as profiles from './profiles.mjs';

const SCENARIOS = { full, nickname, profiles };
const TITLES = { full: '全体の流れ', nickname: 'ニックネーム', profiles: '公開プロフィール' };
const pick = process.argv.slice(2);
const names = pick.length ? pick : Object.keys(SCENARIOS);

await loadRules();
const browser = await launch();
for (const name of names) {
  if (!SCENARIOS[name]) { console.log('知らないシナリオです: ' + name + '（' + Object.keys(SCENARIOS).join(' / ') + '）'); process.exitCode = 1; continue; }
  console.log('\n===== ' + TITLES[name] + '（' + name + '）');
  await resetEmulators();
  try { await SCENARIOS[name].run(browser); }
  catch (e) { results.ng++; console.log('NG   シナリオが途中で止まりました: ' + (e && e.stack || e)); }
  for (const ctx of browser.contexts()) await ctx.close();
}
await browser.close();
console.log('\n' + (results.ng ? `NG ${results.ng} 件 / OK ${results.ok} 件` : `すべて OK（${results.ok} 件）`));
process.exit(results.ng ? 1 : 0);
