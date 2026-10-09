// 通し確認（E2E）の共通部品。
// 実際の index.html を Auth・Firestore エミュレーターにつないで、Chromium で操作する。
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TESTS = path.resolve(HERE, '..');
export const REPO = path.resolve(TESTS, '..');
const NM = path.join(TESTS, 'node_modules');
const PROJECT = 'you-i-space';   // index.html の firebaseConfig.projectId
const URL = 'http://localhost:5555/index.html';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* アプリを読み込み、Firebase の接続先をエミュレーターに差し替える */
export function loadApp(html) {
  const out = html.replace('fbReady=true;', "fbReady=true; fbAuth.useEmulator('http://127.0.0.1:9099',{disableWarnings:true}); fbDb.useEmulator('127.0.0.1',8080);");
  if (out === html) throw new Error('index.html にエミュレーター接続を差し込めませんでした（fbReady=true; が見つからない）');
  return out;
}
export const currentApp = () => loadApp(fs.readFileSync(path.join(REPO, 'index.html'), 'utf8'));
/* ニックネーム導入前のアプリ（v0.5.0）。移行の確認に使う。取り出せなければ null */
export const OLD_APP_COMMIT = '13bd66e';
export function oldApp() {
  try { return loadApp(execSync('git show ' + OLD_APP_COMMIT + ':index.html', { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 })); }
  catch (e) { return null; }
}

/* 結果の記録。NG の数を数える */
export const results = { ok: 0, ng: 0 };
export function step(who, name, ok, info) {
  if (ok) results.ok++; else results.ng++;
  console.log((ok ? 'OK   ' : 'NG   ') + '[' + who + '] ' + name + (info ? '  — ' + info : ''));
}

/* 運営（コンソール相当）：ルールを通らない読み書き */
const REST = 'http://127.0.0.1:8080/v1/projects/' + PROJECT + '/databases/(default)/documents/';
const OWNER = { Authorization: 'Bearer owner' };
export const adminGet = (p) => fetch(REST + p, { headers: OWNER }).then(r => r.status === 200 ? r.json() : null);
export const adminSetBool = (p, k, v) => fetch(REST + p + '?updateMask.fieldPaths=' + k, {
  method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, OWNER),
  body: JSON.stringify({ fields: { [k]: { booleanValue: v } } }),
});
export const field = (doc, k) => doc && doc.fields && doc.fields[k] && (doc.fields[k].stringValue ?? doc.fields[k].booleanValue);

/* リポジトリの firestore.rules を、エミュレーターに読み込む（いつも最新のルールで確かめる） */
export async function loadRules() {
  const content = fs.readFileSync(path.join(REPO, 'firestore.rules'), 'utf8');
  const r = await fetch('http://127.0.0.1:8080/emulator/v1/projects/' + PROJECT + ':securityRules', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (!r.ok) throw new Error('firestore.rules をエミュレーターに読み込めませんでした: ' + r.status + ' ' + (await r.text()).slice(0, 500));
}

/* シナリオごとに、エミュレーターのアカウントとデータを空にする */
export async function resetEmulators() {
  // アカウントは、エミュレーターを起動したプロジェクト名（--project）の側に入る
  for (const p of new Set([PROJECT, process.env.GCLOUD_PROJECT || 'demo-youi'])) {
    await fetch('http://127.0.0.1:9099/emulator/v1/projects/' + p + '/accounts', { method: 'DELETE' });
  }
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
}

export async function launch() {
  return chromium.launch({
    // 決まった場所の Chromium を使うとき：CHROMIUM_PATH=/path/to/chrome
    executablePath: process.env.CHROMIUM_PATH || undefined,
    // Chrome のローカルネットワーク制限で、エミュレーター（127.0.0.1）への接続が止められないようにする
    args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessPermissionPrompt'],
  });
}

/* 1人分の利用者（ブラウザの別コンテキスト）。page.__html を差し替えて reload すると、別の版のアプリになる */
export async function newUser(browser, who, html) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 880 } });
  const page = await ctx.newPage();
  page.who = who; page.__html = html; page.__errors = [];
  page.on('pageerror', e => page.__errors.push('pageerror: ' + e.message));
  page.on('console', m => { const t = m.text(); if (/permission|PERMISSION_DENIED|insufficient/i.test(t)) page.__errors.push(t.slice(0, 200)); });
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('http://127.0.0.1:')) return r.continue();
    if (u === URL) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: page.__html });
    // ゲストのデモの＆ポイントと評価の仕組み（実アカウントは使わないが、アプリと一緒に配信される）
    if (u === 'http://localhost:5555/space-economy.js') return r.fulfill({ path: path.join(REPO, 'space-economy.js'), contentType: 'application/javascript' });
    const m = u.match(/firebasejs\/[\d.]+\/(firebase-[a-z]+-compat\.js)$/);
    if (m) return r.fulfill({ path: path.join(NM, 'firebase', m[1]), contentType: 'application/javascript' });
    if (u.includes('leaflet') && u.endsWith('.js')) return r.fulfill({ path: path.join(NM, 'leaflet/dist/leaflet.js'), contentType: 'application/javascript' });
    if (u.includes('leaflet') && u.endsWith('.css')) return r.fulfill({ path: path.join(NM, 'leaflet/dist/leaflet.css'), contentType: 'text/css' });
    return r.fulfill({ status: 200, body: '' });
  });
  await page.goto(URL); await sleep(500); await hookToasts(page);
  return page;
}
/* 画面に出たトーストを window.__toasts に記録する */
export const hookToasts = (page) => page.evaluate(() => { const o = window.toast; window.__toasts = []; window.toast = function (t) { window.__toasts.push(t); return o(t); }; });
export const clearToasts = (page) => page.evaluate(() => { window.__toasts = []; });
export const lastToasts = (page, n = 3) => page.evaluate(n => window.__toasts.slice(-n).join(' / '), n);

export async function waitFor(page, fn, arg, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await page.evaluate(fn, arg)) return true; } catch (e) {} await sleep(150); }
  return false;
}
export const onMain = (page) => waitFor(page, () => document.querySelector('.screen.active').id === 'screen-main' && currentProfile && currentProfile.uid, null, 10000);

/* 新規登録 → ログイン。nick を渡さなければニックネーム欄は空（古い版のアプリには欄が無い） */
export async function signupAndLogin(page, name, email, pass, nick) {
  await page.evaluate(({ name, email, pass, nick }) => {
    goScreen('signup');
    const nk = document.getElementById('su-nick'); if (nk) nk.value = nick || '';
    document.getElementById('su-name').value = name; document.getElementById('su-email').value = email;
    document.getElementById('su-pass').value = pass; document.getElementById('su-pass2').value = pass;
    document.getElementById('su-agree').checked = true; completeSignup();
  }, { name, email, pass, nick });
  const back = await waitFor(page, () => document.querySelector('.screen.active').id === 'screen-login', null, 10000);
  step(page.who, '新規登録（→ログイン画面に戻る）', back, await lastToasts(page));
  await sleep(900);
  await page.evaluate(({ email, pass }) => { document.getElementById('login-email').value = email; document.getElementById('login-pass').value = pass; login(); }, { email, pass });
  step(page.who, 'ログイン', await onMain(page));
  // ニックネームの設定シートが自動で開くのを止める（シナリオ側で開くときは明示的に開く）
  await page.evaluate(() => { try { sessionStorage.setItem('youi_nick_prompted', '1'); } catch (e) {} if (typeof closeSheet === 'function') closeSheet(); });
  return page.evaluate(() => currentProfile.uid);
}

/* 投稿する（アプリの二重送信ガード3秒を避けて待つ） */
export async function post(page, type, title, anon) {
  await sleep(3300);
  await page.evaluate(({ type, title, anon }) => {
    openPostWith(type);
    document.getElementById('post-title').value = title;
    document.getElementById('post-pref').value = '大阪府';
    const a = document.getElementById('post-anon'); if (a) a.checked = !!anon;
    submitPost();
  }, { type, title, anon });
  await waitFor(page, () => window.__toasts.indexOf('投稿しました') >= 0);
  await clearToasts(page);
}

/* 最後に、権限エラー・JSエラーが出ていないか */
export function checkErrors(pages) {
  for (const p of pages) step(p.who, '権限エラー・JSエラーがない', p.__errors.length === 0, p.__errors.slice(0, 3).join(' | '));
}
