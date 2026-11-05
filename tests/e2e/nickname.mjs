// ニックネーム：導入前（v0.5.0）に登録した人の移行と、新規登録者の表示名
import { step, sleep, newUser, waitFor, signupAndLogin, post, hookToasts, onMain, currentApp, checkErrors, adminSetBool, adminGet, field } from './common.mjs';
import { legacyUser, legacyPosts } from './legacy-fixtures.mjs';

const namesOf = (page, uid) => page.evaluate(uid => (window.__rawPosts || []).filter(p => p.uid === uid)
  .map(p => (p.anon ? '[伏せ]' : '') + p.title + '=' + JSON.stringify(p.authorName || '')).join(' | '), uid);

export async function run(browser) {
  await adminSetBool('config/pointsLedger', 'ready', true);
  await adminSetBool('config/privacyMigration', 'ready', true);
  const NEW = currentApp();

  // 旧版のスキーマをエミュレーターに用意する。旧クライアントへ閲覧権限を戻さない。
  const C = await newUser(browser, 'Carol(旧データ→新)', NEW);
  const cUid = await legacyUser(C, '川口 千代', 'carol@example.com', 'password-c1');
  const legacy = await legacyPosts(cUid, '川口 千代');

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
  const publicName = await C.evaluate(() => myDisplayName());
  step('Carol(旧→新)', 'ニックネーム未設定の公開表示名は本名を返さない', publicName === '利用者', publicName);
  const privateName = await C.evaluate(() => displayNameOf(getStoredUser()));
  step('Carol(旧→新)', '本人用の表示名は従来どおり保持する', privateName === '川口 千代', privateName);
  const beforeCards = await C.evaluate(() => fbDb.collection('posts').where('uid', '==', currentProfile.uid).get().then(s => s.size));
  const cardGuard = await C.evaluate(() => {
    closeSheet(); openAddCard(); document.getElementById('ac-title').value = '設定前に公開しない札'; saveCard();
    return document.getElementById('sheet-title').textContent === 'ニックネームを決める'
      && document.getElementById('sheet-modal').classList.contains('show');
  });
  await sleep(250);
  const afterCards = await C.evaluate(() => fbDb.collection('posts').where('uid', '==', currentProfile.uid).get().then(s => s.size));
  step('Carol(旧→新)', '設定前のできること札は保存せず設定を案内する', cardGuard && afterCards === beforeCards);
  const blockedConversationId = 'v2_' + [cUid, dUid].sort().join('_');
  const conversationBefore = await adminGet('conversations/' + blockedConversationId);
  const conversationGuard = await C.evaluate(uid => {
    closeSheet(); openConversation(uid, 'だいちゃん', 'lav');
    return document.getElementById('sheet-title').textContent === 'ニックネームを決める'
      && document.getElementById('sheet-modal').classList.contains('show');
  }, dUid);
  await sleep(250);
  step('Carol(旧→新)', '設定前の新規会話は保存せず設定を案内する', conversationGuard && !conversationBefore && !(await adminGet('conversations/' + blockedConversationId)));
  await C.evaluate(() => { document.getElementById('nk-nick').value = 'ちよ'; saveNickname(); });
  const synced = await waitFor(D, uid => { const mine = (window.__rawPosts || []).filter(p => p.uid === uid); return mine.length === 1 && mine[0].anon === false && mine[0].authorName === 'ちよ'; }, cUid, 10000);
  step('Dave(新)', '設定後：公開投稿名がそろい、旧匿名投稿は表示されない', synced, await namesOf(D, cUid));
  const ownAnon = await C.evaluate(id => fbDb.collection('posts').doc(id).get().then(d => d.exists && d.data().anon === true), legacy.anonId);
  step('Carol(旧→新)', '以前の匿名投稿は本人が読める', ownAnon);
  const hiddenAnon = await D.evaluate(id => fbDb.collection('posts').doc(id).get().then(() => false, e => e.code === 'permission-denied'), legacy.anonId);
  step('Dave(新)', '以前の匿名投稿は他人から読めない', hiddenAnon);
  D.__errors = [];
  step('Carol(旧→新)', '隔離中の匿名データを表示名同期で変更しない', field(await adminGet('posts/' + legacy.anonId), 'authorName') === '川口 千代');
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
