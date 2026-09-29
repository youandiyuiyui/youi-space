// ゲストのデモを、最初から最後まで操作する（npm run test:demo）。Firebase にはつながない。
// JS エラーが出たら失敗。SHOTS=保存先フォルダ を付けると、各画面を撮影する。
// 手順は steps.json：{ eval: 実行するJS, wait: 待つミリ秒, shot: 画面名, full: 縦長で撮る画面, shotFull: その名前 }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../../index.html');
const LEAFLET = path.resolve(HERE, '../node_modules/leaflet/dist');
const steps = JSON.parse(fs.readFileSync(path.join(HERE, 'steps.json'), 'utf8'));
const SHOTS = process.env.SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 420, height: 880 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.route('**/*', route => {
  const u = route.request().url();
  if (u.startsWith('file://')) return route.continue();
  if (u.includes('leaflet') && u.endsWith('.js')) return route.fulfill({ path: path.join(LEAFLET, 'leaflet.js'), contentType: 'application/javascript' });
  if (u.includes('leaflet') && u.endsWith('.css')) return route.fulfill({ path: path.join(LEAFLET, 'leaflet.css'), contentType: 'text/css' });
  if (u.endsWith('.png')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  if (u.includes('fonts.g')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  // Firebase などの外部スクリプトは読み込まない（ゲストのデモとして動く）
  return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
});
await page.goto('file://' + APP);
await page.waitForTimeout(600);
for (const s of steps) {
  try { if (s.eval) await page.evaluate(s.eval); }
  catch (e) { errors.push('step error: ' + s.eval + ' :: ' + e.message); }
  await page.waitForTimeout(s.wait || 350);
  if (SHOTS && s.shot) await page.screenshot({ path: path.join(SHOTS, s.shot + '.png') });
  if (SHOTS && s.full) {
    const h = await page.evaluate(sel => { const e = document.querySelector(sel); return e ? e.scrollHeight : 0; }, s.full);
    await page.setViewportSize({ width: 420, height: Math.min(Math.max(h + 140, 880), 6000) });
    await page.evaluate(() => { document.querySelector('.phone').style.maxHeight = 'none'; });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, s.shotFull + '.png') });
    await page.setViewportSize({ width: 420, height: 880 });
    await page.evaluate(() => { document.querySelector('.phone').style.maxHeight = ''; });
  }
}
await browser.close();
console.log(errors.length ? 'NG   デモの途中でエラー:\n' + errors.join('\n') : 'OK   デモの ' + steps.length + ' 画面を通して、JSエラーなし');
process.exit(errors.length ? 1 : 0);
