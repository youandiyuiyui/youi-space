// 公開プロフィール：申し込みやメッセージのときに、お互いのプロフィールを見る（v0.5.3）
// SHOTS=保存先フォルダ を付けると、要所の画面を撮影する
import { step, sleep, newUser, waitFor, signupAndLogin, post, hookToasts, onMain, currentApp,
  adminGet, adminSetBool, field, checkErrors } from './common.mjs';
import { legacyUser, anonRejected } from './legacy-fixtures.mjs';

const shot = async (page, name) => { if (process.env.SHOTS) { await sleep(500); await page.screenshot({ path: process.env.SHOTS + '/' + name + '.png' }); } };
async function setBio(page, bio) {
  await page.evaluate(bio => { openProfileEdit(); document.getElementById('pe-bio').value = bio; saveProfileEdit(); }, bio);
  await sleep(1200);
}
/* 相手のプロフィール画面に、いま何が出ているか */
const uprof = (page) => page.evaluate(() => {
  const vis = id => { const e = document.getElementById(id); return !!e && e.style.display !== 'none' && getComputedStyle(e).display !== 'none'; };
  return {
    active: document.querySelector('.screen.active').id === 'screen-uprof',
    name: document.getElementById('up-name').textContent,
    intro: vis('up-intro-sec') ? document.getElementById('up-intro').textContent : '',
    can: vis('up-can-sec') ? [...document.querySelectorAll('#up-can .uprof-skill')].map(e => e.textContent) : [],
    need: vis('up-need-sec') ? [...document.querySelectorAll('#up-need .uprof-skill')].map(e => e.textContent) : [],
    verified: vis('up-verified'), badge: !!document.querySelector('#up-avatar .v'),
    note: document.getElementById('up-note').innerText, btn: document.getElementById('up-msg-btn').textContent,
    text: document.getElementById('screen-uprof').innerText,
  };
});
const loaded = (page) => waitFor(page, () => document.getElementById('up-note').textContent !== '読み込み中…');
const canRead = (page, uid) => page.evaluate(uid => fbDb.collection('profiles').doc(uid).get().then(d => d.exists ? '読めた' : '無い', e => '拒否'), uid);
const screenIs = (page, id) => waitFor(page, id => document.querySelector('.screen.active').id === id, id);

export async function run(browser) {
  await adminSetBool('config/pointsLedger', 'ready', true);
  await adminSetBool('config/privacyMigration', 'ready', true);
  const NEW = currentApp();

  // 1) 3人が登録。公開プロフィールには本名・メールを書かない
  const A = await newUser(browser, 'Alice', NEW);
  const aUid = await signupAndLogin(A, '安藤 有子', 'alice@example.com', 'password-a1', 'ありす');
  await setBio(A, '高槻市で子育て中です。平日の夕方なら動けます。');
  const aDoc = await adminGet('profiles/' + aUid);
  step('Alice', '公開プロフィールができる（名前はニックネーム、本名・メールは無し）',
    field(aDoc, 'name') === 'ありす' && !JSON.stringify(aDoc).includes('安藤') && !JSON.stringify(aDoc).includes('alice@'), JSON.stringify(aDoc && aDoc.fields));
  step('Alice', 'まだ投稿がないので listed=false', field(aDoc, 'listed') === false);
  await post(A, 'tsuide', '土曜に車を出せます', false);
  await sleep(800);
  step('Alice', '名前を出して投稿したら listed=true', field(await adminGet('profiles/' + aUid), 'listed') === true);
  const B = await newUser(browser, 'Bob', NEW);
  const bUid = await signupAndLogin(B, '坂東 文夫', 'bob@example.com', 'password-b1', 'ぼぶ');
  await setBio(B, 'スマホの操作なら教えられます。');
  const C = await newUser(browser, 'Carol', NEW);
  const cUid = await signupAndLogin(C, '川口 千代', 'carol@example.com', 'password-c1', 'ちよ');

  // 2) 申し込む前：投稿の詳細から相手のプロフィールを見る
  await waitFor(B, uid => (window.__rawPosts || []).some(p => p.uid === uid), aUid);
  const aPost = await B.evaluate(uid => (window.__rawPosts || []).find(p => p.uid === uid).id, aUid);
  step('Bob', '投稿の詳細に「プロフィール」ボタン', await B.evaluate(id => { openPostDetail(id); return /プロフィール/.test(document.getElementById('sheet-content').innerText); }, aPost));
  await shot(B, '1_post_detail');
  await B.evaluate(id => openPostAuthorProfile(id), aPost);
  await loaded(B);
  let v = await uprof(B);
  step('Bob', 'Alice のプロフィールが開く（ニックネーム）', v.active && v.name === 'ありす さん', v.name);
  await shot(B, '2_profile_from_post');
  step('Bob', '自己紹介が見える', v.intro.includes('子育て中'), v.intro);
  step('Bob', 'できること（名前を出した投稿）が並ぶ', v.can.includes('土曜に車を出せます'), JSON.stringify(v.can));
  step('Bob', '本名・よく言われること・本人確認済み（未確認）は出ない', !v.text.includes('安藤') && !/よく言われること/.test(v.text) && !v.verified, v.note);

  // 3) プロフィールから申し込む → Alice 側で、申し込んできた Bob のプロフィールを見る
  await B.evaluate(() => document.getElementById('up-msg-btn').click());
  await screenIs(B, 'screen-chat');
  await B.evaluate(() => { document.getElementById('chat-field').value = '車のこと、お願いできますか'; sendChat(); });
  step('Carol', 'Bob のプロフィール（投稿なし・会話なし）は読めない', (await canRead(C, bUid)) === '拒否');
  step('Carol', 'Alice のプロフィール（名前を出して投稿）は読める', (await canRead(C, aUid)) === '読めた');
  C.__errors = [];
  await waitFor(A, uid => (window.__rawConvs || []).some(c => (c.participants || []).includes(uid)), bUid);
  await A.evaluate(uid => openConvById(uid), bUid);
  await sleep(600);
  const sub = await A.evaluate(() => document.getElementById('chat-presence').textContent);
  step('Alice', '会話の見出しに「プロフィールを見る」', /プロフィールを見る/.test(sub), sub);
  await shot(A, '3_chat_header');
  await A.evaluate(() => openChatPartner());
  await loaded(A);
  v = await uprof(A);
  step('Alice', '申し込んできた Bob のプロフィールが見られる', v.active && v.name === 'ぼぶ さん' && v.intro.includes('スマホ'), v.name + ' / ' + v.intro);
  await shot(A, '4_profile_from_chat');
  step('Alice', 'Bob は投稿がないので、できること欄は出ない', v.can.length === 0 && v.need.length === 0);
  step('Alice', 'ボタンは「メッセージに戻る」', v.btn === 'メッセージに戻る', v.btn);
  await A.evaluate(() => document.getElementById('up-msg-btn').click());
  step('Alice', '戻るとチャットに戻る', await screenIs(A, 'screen-chat'));

  // 4) 実アカウントの匿名投稿は一時停止。名前つき投稿へ自動変換しない。
  step('Carol', '実アカウントの匿名投稿を一時停止と案内', await anonRejected(C, '買い物を手伝ってほしい'));
  await sleep(600);
  const unpublished = await B.evaluate(uid => !(window.__rawPosts || []).some(p => p.uid === uid), cUid);
  step('Bob', '拒否した匿名投稿が名前つきで公開されない', unpublished);
  step('Bob', '会話のないCarolの未掲載プロフィールは読めない', (await canRead(B, cUid)) === '拒否');
  B.__errors = [];

  // 5) 本人確認済みの印：運営が users に付ける → 本人のログインで公開プロフィールにも付く
  await adminSetBool('users/' + bUid, 'verified', true);
  await B.reload(); await sleep(800); await hookToasts(B);
  await onMain(B);
  await sleep(1200);
  step('Bob', '公開プロフィールに本人確認済みの印', field(await adminGet('profiles/' + bUid), 'verified') === true);
  await A.evaluate(() => navTo('msg'));
  await A.evaluate(uid => openConvById(uid), bUid);
  step('Alice', '会話の見出しに本人確認済みの印', await waitFor(A, () => !!document.querySelector('#chat-avatar .v'), null, 5000));
  await A.evaluate(() => openChatPartner());
  await loaded(A);
  v = await uprof(A);
  step('Alice', 'プロフィールに「本人確認済」', v.verified && v.badge);
  await shot(A, '6_verified_profile');

  // 6) 自分の見え方の確認と、編集したときの即時反映
  await A.evaluate(() => { navTo('profile'); previewMyProfile(); });
  await loaded(A);
  v = await uprof(A);
  step('Alice', '見え方の確認（自分のプロフィール）', v.active && v.name === 'ありす さん' && v.btn === 'プロフィールを編集する', v.note);
  await A.evaluate(() => { openProfileEdit(); document.getElementById('pe-bio').value = '週末は子どもと公園にいます。'; saveProfileEdit(); });
  step('Alice', '編集すると見え方もすぐ変わる', await waitFor(A, () => document.getElementById('up-intro').textContent.includes('公園'), null, 6000));
  await shot(A, '7_preview_self');

  // 7) ブロックした相手からは読めない
  await A.evaluate(uid => { blockCtx = { uid, name: 'ちよ' }; doBlock(); }, cUid);
  await sleep(1200);
  step('Carol', 'ブロックされたら Alice のプロフィールは読めない', (await canRead(C, aUid)) === '拒否');
  C.__errors = [];

  // 8) ニックネーム導入前の利用者：ニックネームを決めるまで公開プロフィールを作らない → 9) 退会で消える
  const pages = [A, B, C];
  const D = await newUser(browser, 'Dave(旧データ→新)', NEW);
  pages.push(D);
  const dUid = await legacyUser(D, '大山 大介', 'dave@example.com', 'password-d1');
  await sleep(1200);
  step('Dave(旧→新)', 'ニックネーム未設定のあいだは公開プロフィールなし', (await adminGet('profiles/' + dUid)) === null);
  await D.evaluate(() => { openNicknameSetup(); document.getElementById('nk-nick').value = 'だいちゃん'; saveNickname(); });
  await sleep(1500);
  const dDoc = await adminGet('profiles/' + dUid);
  step('Dave(旧→新)', 'ニックネームを決めたら公開プロフィールができる', field(dDoc, 'name') === 'だいちゃん' && !JSON.stringify(dDoc).includes('大山'), JSON.stringify(dDoc && dDoc.fields));
  await D.evaluate(() => { openDeleteAccount(); document.getElementById('da-pass').value = 'password-d1'; deleteAccount(); });
  await screenIs(D, 'screen-login');
  step('Dave(旧→新)', '退会で公開プロフィールも削除', (await adminGet('profiles/' + dUid)) === null && (await adminGet('users/' + dUid)) === null);

  // 10) ゲストのデモも、実アプリと同じ項目
  const G = await newUser(browser, 'Guest', NEW);
  pages.push(G);
  await G.evaluate(() => startDemo(false));
  await sleep(600);
  await G.evaluate(() => openDemoProfile('ともこ'));
  v = await uprof(G);
  step('Guest', 'デモも実アプリと同じ項目（よく言われることは出ない）', v.active && v.name === 'ともこ さん' && !/よく言われること/.test(v.text), v.name);
  step('Guest', 'デモ：自己紹介に紹介文がまとまる', v.intro.includes('母（85）の介護') && v.intro.includes('頼ることを練習'), v.intro);
  step('Guest', 'デモ：できること（札と投稿）が並ぶ', v.can.includes('編み物を教えられます'), JSON.stringify(v.can));
  step('Guest', 'デモ：本人確認済みの人には印', v.verified && v.badge);
  await shot(G, '8_demo_profile');
  await G.evaluate(() => openDemoProfile('かずこ'));
  v = await uprof(G);
  step('Guest', 'デモ：本人確認前の人には印が出ない', v.active && !v.verified && !v.badge, v.name);
  await G.evaluate(() => document.getElementById('up-msg-btn').click());
  await sleep(400);
  const gHead = await G.evaluate(() => ({ s: document.querySelector('.screen.active').id, sub: document.getElementById('chat-presence').textContent, badge: !!document.querySelector('#chat-avatar .v') }));
  step('Guest', 'デモの会話の見出しも「プロフィールを見る」', gHead.s === 'screen-chat' && gHead.sub === 'プロフィールを見る ›' && !gHead.badge, JSON.stringify(gHead));
  await G.evaluate(() => openChatPartner());
  v = await uprof(G);
  step('Guest', 'デモ：会話から開くと「メッセージに戻る」', v.active && v.name === 'かずこ さん' && v.btn === 'メッセージに戻る', v.btn);
  await G.evaluate(() => document.getElementById('up-msg-btn').click());
  step('Guest', 'デモ：戻ると会話に戻る', await screenIs(G, 'screen-chat'));

  // ゲストは端末内の架空データだけなので、匿名の体験を維持する。
  await G.evaluate(() => {
    openPostWith('need');document.getElementById('post-title').value='ゲストの匿名投稿';
    document.getElementById('post-anon').checked=true;submitPost();
  });
  await sleep(1000);
  const guestAnon = await G.evaluate(() => { const p=(window.__rawPosts || []).find(p => p.title === 'ゲストの匿名投稿'); return p?{id:p.id,anon:p.anon,shown:postAuthor(p)}:null; });
  step('Guest', 'ゲストの匿名投稿は「ご近所の方」として体験できる', !!guestAnon && guestAnon.anon === true && guestAnon.shown === 'ご近所の方');
  if(guestAnon){
    const guestDetail=await G.evaluate(id=>{openPostDetail(id);return document.getElementById('sheet-content').innerText;},guestAnon.id);
    step('Guest', 'ゲスト匿名投稿にも相手のプロフィールボタンを出さない', !/プロフィール\n/.test(guestDetail));
  }

  checkErrors(pages);
}
