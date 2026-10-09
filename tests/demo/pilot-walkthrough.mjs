// 新制度の端末内デモを、実際の画面から確認する。外部通信・実Firebase接続はしない。
// 実行: CHROMIUM_PATH=/path/to/chromium node demo/pilot-walkthrough.mjs
// PILOT_APP_ROOTで別の公開用ツリー、SHOTSで画面保存先を指定できる。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.PILOT_APP_ROOT ? path.resolve(process.env.PILOT_APP_ROOT) : path.resolve(HERE, '../..');
const KEY = 'youi_pilot_20261008_v1';
const SHOTS = process.env.SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const files = new Map([
  ['/index.html', 'text/html'], ['/demo.html', 'text/html'], ['/pilot-demo.js', 'application/javascript'],
  ['/pilot-economy.js', 'application/javascript'], ['/pilot-demo.css', 'text/css']
]);
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!files.has(pathname)) { response.writeHead(404); response.end(); return; }
  try {
    response.setHeader('Content-Type', files.get(pathname));
    response.end(fs.readFileSync(path.join(ROOT, pathname.slice(1))));
  } catch (_) { response.writeHead(404); response.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [], external = [], checks = [];
let browser;
const selector = (action, more = '') => `[data-action="${action}"]${more}`;
const click = (page, action, more = '') => page.locator(selector(action, more)).first().click();
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
const current = s => s.activities.find(a => a.id === s.activeActivityId);
async function newPage(context, width = 390, entry = 'index.html') {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: width < 720 ? 844 : 1000 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(origin + '/' + entry);
  return page;
}
async function context() {
  const result = await browser.newContext();
  await result.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    external.push(url); return route.abort();
  });
  return result;
}
async function snapshot(page, name, width = 390) {
  await page.setViewportSize({ width, height: width < 720 ? 844 : 1000 });
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert(dimensions.scroll <= dimensions.viewport, `${name}: 横にはみ出していない`);
  if (SHOTS) {
    await page.locator('#toast').evaluate(element => element.classList.remove('visible'));
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  }
}
async function register(page) {
  await page.locator('[name="name"]').fill('はる <script>');
  await page.locator('[name="understood"]').check();
  await page.locator('[data-form="register"] button[type="submit"]').click();
  assert.equal((await saved(page)).state.actors.me.balance, 0);
  assert.match(await page.locator('#app').innerText(), /はる <script>/);
  assert.equal(await page.locator('#app script').count(), 0);
}
async function create(page, scenario, role = 'provider') {
  await click(page, 'nav', '[data-view="explore"]');
  await click(page, 'create', `[data-scenario="${scenario}"][data-role="${role}"]`);
  await page.locator('[data-form="activity"] button[type="submit"]').click();
  assert.equal(current((await saved(page)).state).status, 'draft');
  await click(page, 'reserve');
  const a = current((await saved(page)).state);
  assert.equal(a.status, 'reserved');
  assert.equal(a.reservedPoints, scenario === 'cleanup' ? 60 : 20);
  return a;
}
async function complete(page) {
  assert.equal(await page.locator(selector('award')).isDisabled(), true);
  while (await page.locator(selector('confirm') + ':not(:disabled)').count()) {
    await page.locator(selector('confirm') + ':not(:disabled)').first().click();
  }
  assert.equal(await page.locator(selector('award')).isDisabled(), true, '参加者の確認だけでは配布不可');
  await click(page, 'verify');
  assert.equal(await page.locator(selector('award')).isEnabled(), true);
  const count = (await saved(page)).state.reviews.length;
  await click(page, 'award');
  const s = (await saved(page)).state;
  assert.equal(current(s).status, 'completed');
  assert.equal(s.reviews.length, count, '相互評価の入力前にポイント配布');
  assert.equal(await page.locator(selector('award')).count(), 0, '配布を繰り返すボタンは残さない');
}
async function review(page, from, to) {
  await click(page, 'review', `[data-from="${from}"][data-to="${to}"]`);
  await page.locator('[name="keptPromise"]').selectOption('yes');
  await page.locator('[name="clearRole"]').selectOption('yes');
  await page.locator('[name="workAgain"]').selectOption('no');
  await page.locator('[data-form="review"] button[type="submit"]').click();
}
async function pair(page, first, second) {
  await review(page, first, second);
  const hidden = await page.evaluate(({ key, viewer }) => {
    const s = JSON.parse(localStorage.getItem(key)).state;
    return YouiPilotEconomy.getReviews(s, s.activeActivityId, viewer).length;
  }, { key: KEY, viewer: second });
  assert.equal(hidden, 0, '片方提出だけでは相手に内容を見せない');
  await review(page, second, first);
}

try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const primary = await context();
  const page = await newPage(primary);
  assert.equal(await page.locator('script[src*="firebase"]').count(), 0);
  assert.equal(await page.locator('a[href="legacy.html"]').count(), 1);
  await snapshot(page, '00-onboard-small', 320);
  await snapshot(page, '01-onboard-mobile');
  await snapshot(page, '02-onboard-desktop', 1440);
  await register(page);
  await page.evaluate(() => localStorage.setItem('youi_user', 'old-app-marker'));
  await snapshot(page, '03-explore-mobile');
  await snapshot(page, '04-explore-desktop', 1440);
  checks.push('登録0pt・入力は文字として表示');

  await click(page, 'explore-role', '[data-role="receiver"]');
  assert.equal(await page.locator(selector('create', '[data-role="provider"]')).count(), 0);
  assert.equal(await page.locator(selector('create', '[data-role="receiver"]')).count(), 3);
  await page.locator('#duration-filter').selectOption('30分');
  assert.equal(await page.locator('.activity-card').count(), 1);
  await click(page, 'category', '[data-category="cleanup"]');
  assert.equal(await page.locator('.activity-card').count(), 0);
  assert.match(await page.locator('#app').innerText(), /条件に合う活動がありません/);
  await click(page, 'clear-filters');
  assert.equal(await page.locator('.activity-card').count(), 3);
  await click(page, 'explore-role', '[data-role="both"]');
  await click(page, 'create', '[data-scenario="talk"][data-role="provider"]');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'create');
  await snapshot(page, '04a-explore-small', 320);
  checks.push('関わり方・時間・種類で絞り込み、0件から解除、キーボードで画面に戻れる');

  await create(page, 'talk', 'receiver');
  const activeId = current((await saved(page)).state).id;
  await click(page, 'nav', '[data-view="explore"]');
  assert.match(await page.locator('.resume-card').innerText(), /完了を確認/);
  await page.locator('.resume-card').click();
  assert.equal(current((await saved(page)).state).id, activeId);
  await snapshot(page, '04b-activity-detail-mobile');
  await complete(page);
  assert.equal((await saved(page)).state.actors.me.balance, 10);
  await pair(page, 'partner', 'me');
  checks.push('残高0で話し相手を依頼し、双方完了・担当者確認後に双方10pt');

  await create(page, 'club');
  await complete(page);
  await click(page, 'nav', '[data-view="profile"]');
  assert.equal(await page.locator(selector('opportunity', '[data-id="propose-project"]')).count(), 0);
  await click(page, 'nav', '[data-view="activities"]');
  const clubId = current((await saved(page)).state).id;
  await click(page, 'open', `[data-id="${clubId}"]`);
  await pair(page, 'me', 'organization');
  await click(page, 'nav', '[data-view="profile"]');
  assert.equal(await page.locator(selector('opportunity', '[data-id="propose-project"]')).count(), 0, '説明確認前には役割を解放しない');
  await click(page, 'role-check', '[data-check="orientation"]');
  await click(page, 'role-check', '[data-check="childSafety"]');
  assert.equal(await page.locator(selector('opportunity', '[data-id="club-support"]')).count(), 1);
  await click(page, 'certificate', '[data-id="activity-profile"]');
  assert.match(await page.locator('#dialog').innerText(), /活動記録/);
  assert.equal(await page.locator('#proposal-text').count(), 0);
  await click(page, 'close');
  await click(page, 'opportunity', '[data-id="propose-project"]');
  await page.locator('#proposal-text').fill('園芸をテーマにした会話会を開きたい。');
  await click(page, 'opportunity-save');
  assert.match(await page.locator('#app').innerText(), /園芸をテーマにした会話会を開きたい。/);
  await snapshot(page, '05-opportunities-mobile');
  await snapshot(page, '06-opportunities-desktop', 1440);
  checks.push('異なる相手の公開済み評価と役割確認で機会が増え、企画希望を保存');

  await create(page, 'cleanup');
  await complete(page);
  await review(page, 'organization', 'me');
  assert.match(await page.locator('#app').innerText(), /宛てに確認できる評価：0件/);
  await click(page, 'advance');
  assert.match(await page.locator('#app').innerText(), /宛てに確認できる評価：1件/);
  assert.equal(await page.locator(selector('review') + ':not(:disabled)').count(), 0, '締切後は未提出の回答を閉じる');
  await snapshot(page, '07-review-deadline-mobile');
  let s = (await saved(page)).state;
  assert.equal(s.actors.me.balance, 30);
  assert.equal(s.actors.organization.balance, 20);
  assert.equal(s.economy.issued, 100);
  checks.push('清掃5人＋主催1回の計60pt・未回答は配布を妨げず期限後に評価を反映');

  await click(page, 'nav', '[data-view="wallet"]');
  await snapshot(page, '08-wallet-mobile');
  for (const productId of ['local-drink', 'space-workshop']) {
    const before = (await saved(page)).state;
    const product = before.catalog.find(item => item.id === productId);
    await click(page, 'redeem', `[data-id="${productId}"]`);
    await click(page, 'redeem-confirm');
    const redeemed = (await saved(page)).state;
    assert.equal(redeemed.actors.me.balance, before.actors.me.balance - product.points);
    assert.equal(redeemed.economy.burned, before.economy.burned + product.points);
    assert.equal(redeemed.catalog.find(item => item.id === productId).stock, product.stock - 1);
    await snapshot(page, '09-receipt-' + productId);
    await click(page, 'refund');
    const refunded = (await saved(page)).state;
    assert.equal(refunded.actors.me.balance, before.actors.me.balance);
    assert.equal(refunded.catalog.find(item => item.id === productId).stock, product.stock);
    assert.equal(await page.locator(selector('refund')).isDisabled(), true);
    await click(page, 'close');
  }
  await click(page, 'wallet-actor', '[data-actor="organization"]');
  assert.equal(await page.locator(selector('redeem', '[data-id="local-drink"]')).isDisabled(), true);
  await click(page, 'nav', '[data-view="profile"]');
  assert.equal(await page.locator(selector('opportunity', '[data-id="propose-project"]')).count(), 1);
  await page.reload();
  await click(page, 'nav', '[data-view="profile"]');
  assert.match(await page.locator('#app').innerText(), /園芸をテーマにした会話会を開きたい。/);
  assert.equal((await saved(page)).state.actors.me.balance, 30);
  checks.push('商品とSpace体験を交換・消却し、取消で残高/枠返還、再読込保持');

  const mirrored = await newPage(primary, 390, 'demo.html');
  assert.equal((await saved(mirrored)).state.actors.me.balance, 30, '旧デモURLと新ホームは同じ記録を使う');
  await click(page, 'reset');
  await click(page, 'reset-confirm');
  await mirrored.locator('[data-form="register"]').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('youi_user')), 'old-app-marker');
  checks.push('別タブがリセットへ追随し、旧アプリの保存データは維持');
  await primary.close();

  const organizer = await context();
  const host = await newPage(organizer);
  await register(host);
  for (const scenario of ['club', 'cleanup']) {
    const a = await create(host, scenario, 'receiver');
    assert.deepEqual(a.receiverIds, ['organization']);
    assert(!a.providerIds.includes('me'));
    await complete(host);
    const state = (await saved(host)).state;
    assert.equal(state.actors.me.balance, 0, '担当者個人に主催と支援の重複配布をしない');
    assert.match(await host.locator('#app').innerText(), /活動の主催者の残高/);
    await snapshot(host, '10-host-' + scenario);
  }
  assert.equal((await saved(host)).state.actors.organization.balance, 20);
  await create(host, 'talk', 'receiver');
  await click(host, 'hold');
  await click(host, 'hold-confirm', '[data-reason="disputed"]');
  assert.equal(current((await saved(host)).state).status, 'hold');
  await click(host, 'resolve', '[data-outcome="resume"]');
  assert.deepEqual(current((await saved(host)).state).confirmations, {});
  await click(host, 'cancel');
  await click(host, 'cancel-confirm');
  assert.equal((await saved(host)).state.economy.reserved, 0);
  checks.push('学校/清掃主催は団体へ各10pt・中断確認と取消で発行枠を解放');
  await organizer.close();

  const starter = await context();
  const first = await newPage(starter);
  await first.locator('[name="role"][value="receiver"]').check();
  await register(first);
  assert.equal(await first.locator(selector('create', '[data-role="provider"]')).count(), 0);
  await first.locator('.wallet-mini').click();
  assert.match(await first.locator('#app').innerText(), /次の楽しみを/);
  await starter.close();
  checks.push('最初に選んだ立場をホームに反映し、残高カードからポイントへ移動');

  assert.deepEqual(errors, [], '画面のJavaScript/consoleエラーなし');
  assert.deepEqual(external, [], '外部通信の要求なし');
  console.log('OK   新ホーム: ' + checks.length + '項目・320px/390px/1440pxで確認、JSエラー0・外部通信0\n' + checks.map(text => '- ' + text).join('\n'));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
