// ニックネーム：導入前（v0.5.0）に登録した人の移行と、新規登録者の表示名
import { step, sleep, newUser, waitFor, signupAndLogin, post, hookToasts, onMain, currentApp, oldApp, checkErrors, OLD_APP_COMMIT } from './common.mjs';

const namesOf = (page, uid) => page.evaluate(uid => (window.__rawPosts || []).filter(p => p.uid === uid)
  .map(p => (p.anon ? '[伏せ]' : '') + p.title + '=' + JSON.stringify(p.authorName || '')).join(' | '), uid);

export async function run(browser) {
  const OLD = oldApp(), NEW = currentApp();
  if (!OLD) { step('準備', '旧アプリ（' + OLD_APP_COMMIT + '）を git から取り出す', false, 'git の履歴が足りません（git fetch --unshallow）'); return; }

  // 1) 旧アプリで登録した人：ニックネームなし、伏せた投稿にも名前が残っている
  const C = await newUser(browser, 'Carol(旧→新)', OLD);
  const cUid = await signupAndLogin(C, '川口 千代', 'carol@example.com', 'password-c1');
  await post(C, 'tsuide', '土曜に車を出せます', false);
  await post(C, 'need', '通院の付き添いをお願いしたい', true);

  // 2) 新しいアプリで登録する人：ニックネームと本名を分けて持つ
  const D = await newUser(browser, 'Dave(新)', NEW);
  const dUid = await signupAndLogin(D, '大山 大介', 'dave@example.com', 'password-d1', 'だいちゃん');
  const dHero = await D.evaluate(() => document.querySelector('#screen-main .main-hero-name').textContent);
  step('Dave(新)', 'ホームの表示はニックネーム', dHero === 'だいちゃん さん', dHero);
  const dDoc = await D.evaluate(() => fbDb.collection('users').doc(currentProfile.uid).get().then(d => ({ name: d.data().name, nickname: d.data().nickname })));
  step('Dave(新)', '本名とニックネームを別々に保存', dDoc.name === '大山 大介' && dDoc.nickname === 'だいちゃん', JSON.stringify(dDoc));
  await post(D, 'tsuide', '平日の夜、スマホの相談にのれます', false);
  const peek = await D.evaluate(uid => fbDb.collection('users').doc(uid).get().then(() => '読めた', e => '拒否: ' + e.code), cUid);
  step('Dave(新)', '他人の本名（users）は読めない', /拒否/.test(peek), peek);
  D.__errors = [];

  // 3) 旧アプリの利用者が新しいアプリを開く → 案内 → ニックネームを設定
  await C.evaluate(() => { try { sessionStorage.removeItem('youi_nick_prompted'); } catch (e) {} });
  C.__html = NEW; await C.reload(); await sleep(800); await hookToasts(C);
  await onMain(C);
  const banner = await C.evaluate(() => { const b = document.getElementById('nick-banner'); return b && b.style.display !== 'none' ? b.innerText.split('\n')[0] : ''; });
  step('Carol(旧→新)', 'ホームにニックネームの案内帯が出る', !!banner, banner);
  const sheet = await waitFor(C, () => /ニックネームを決める/.test(document.getElementById('sheet-title').textContent) && document.getElementById('sheet-modal').classList.contains('show'), null, 5000);
  step('Carol(旧→新)', 'ログイン後に設定シートが自動で開く', sheet);
  await C.evaluate(() => { document.getElementById('nk-nick').value = 'ちよ'; saveNickname(); });
  const synced = await waitFor(D, uid => { const mine = (window.__rawPosts || []).filter(p => p.uid === uid); return mine.length === 2 && mine.every(p => (p.authorName || '') === (p.anon ? '' : 'ちよ')); }, cUid, 10000);
  step('Dave(新)', '設定後：旧利用者の投稿名がそろい、伏せた投稿の名前は消える', synced, await namesOf(D, cUid));
  step('Carol(旧→新)', '設定後は案内帯が消える', await C.evaluate(() => document.getElementById('nick-banner').style.display === 'none'));

  // 4) 会話でもニックネームが使われる
  const cPost = await D.evaluate(uid => (window.__rawPosts || []).find(p => p.uid === uid && !p.anon).id, cUid);
  await D.evaluate(id => { openPostDetail(id); messageFromPost(id); }, cPost);
  await sleep(900);
  const head = await D.evaluate(() => document.getElementById('chat-name').textContent);
  step('Dave(新)', 'チャット見出しは相手のニックネーム', head === 'ちよ さん', head);
  await D.evaluate(() => { document.getElementById('chat-field').value = 'はじめまして'; sendChat(); });
  const convName = await waitFor(C, uid => { const c = (window.__rawConvs || [])[0]; return c && c.names && c.names[uid] === 'だいちゃん'; }, dUid);
  step('Carol(旧→新)', '会話データの相手の名前はニックネーム', convName);

  // 5) プロフィール編集でニックネームを変える → 自分の投稿もそろう。本名は変わらない
  await D.evaluate(() => { openProfileEdit(); document.getElementById('pe-nick').value = 'だいすけ'; saveProfileEdit(); });
  const renamed = await waitFor(C, uid => (window.__rawPosts || []).filter(p => p.uid === uid).every(p => p.authorName === 'だいすけ'), dUid, 10000);
  step('Carol(旧→新)', 'ニックネーム変更が相手の投稿表示に反映', renamed, await namesOf(C, dUid));
  const dDoc2 = await D.evaluate(() => fbDb.collection('users').doc(currentProfile.uid).get().then(d => ({ name: d.data().name, nickname: d.data().nickname })));
  step('Dave(新)', '本名は変わらない', dDoc2.name === '大山 大介' && dDoc2.nickname === 'だいすけ', JSON.stringify(dDoc2));

  checkErrors([C, D]);
}
