// 全体の流れ：登録 → 匿名の一時停止を確認 → 名前つき頼みごと → 会話 → お礼 → 退会
import { step, sleep, newUser, waitFor, signupAndLogin, clearToasts, lastToasts, currentApp, checkErrors, adminSetBool } from './common.mjs';
import { anonRejected } from './legacy-fixtures.mjs';

export async function run(browser) {
  await adminSetBool('config/pointsLedger', 'ready', true);
  await adminSetBool('config/privacyMigration', 'ready', true);
  const app = currentApp();
  const A = await newUser(browser, 'Alice', app), B = await newUser(browser, 'Bob', app);
  const aUid = await signupAndLogin(A, '青木 花子', 'alice@example.com', 'password-a1', 'はなこ');
  const bUid = await signupAndLogin(B, '馬場 一郎', 'bob@example.com', 'password-b1', 'いちろう');
  const aShown = await A.evaluate(() => currentProfile.nickname || currentProfile.name);
  step('Alice', '登録時の確定残高300ptを表示する', await waitFor(A, () => walletBalance === 300 && myPoints() === 300));
  step('Bob', '登録時の確定残高300ptを表示する', await waitFor(B, () => walletBalance === 300 && myPoints() === 300));

  // 実アカウントの匿名投稿は保存されず、一時停止の案内が出る。
  step('Alice', '実アカウントの匿名投稿は一時停止', await anonRejected(A), await lastToasts(A));
  await sleep(3300);
  // Alice：名前つき「困っていること」／できること札
  await clearToasts(A);
  await A.evaluate(() => {
    openPostWith('need');
    document.getElementById('post-title').value = '通院のあいだ、母の話し相手を';
    document.getElementById('post-pref').value = '大阪府';
    document.getElementById('post-area').value = '高槻市 ○○町';
    document.getElementById('post-anon').checked = false;
    submitPost();
  });
  step('Alice', '名前つきで困りごとを投稿', await waitFor(A, () => window.__toasts.indexOf('投稿しました') >= 0), await lastToasts(A));
  await A.evaluate(() => { openAddCard(); document.getElementById('ac-title').value = '車を出せます'; saveCard(); });
  step('Alice', 'できること札を登録', await waitFor(A, () => window.__toasts.indexOf('できること札を登録しました') >= 0), await lastToasts(A));

  // Bob：投稿を見る → はじめての相手にメッセージ
  step('Bob', '困りごとが一覧に届く', await waitFor(B, () => (window.__needPosts || []).length > 0));
  const post = await B.evaluate(() => { const p = window.__needPosts[0]; return { id: p.id, authorName: p.authorName || '' }; });
  step('Bob', '名前つき投稿は表示名を使う', post.authorName === aShown, JSON.stringify(post.authorName));
  await B.evaluate(id => { openPostDetail(id); messageFromPost(id); }, post.id);
  await sleep(1200);
  const firstOpen = await B.evaluate(() => ({ head: document.getElementById('chat-name').textContent, body: document.getElementById('chat-thread').innerText.slice(0, 60) }));
  step('Bob', 'はじめての相手との会話を開ける', !/読み込めません/.test(firstOpen.body), firstOpen.body.replace(/\n/g, ' '));
  step('Bob', 'チャット見出しは相手の表示名', firstOpen.head === aShown + ' さん', firstOpen.head);
  await B.evaluate(() => { document.getElementById('chat-field').value = 'はじめまして、お手伝いできます'; sendChat(); });
  step('Bob', '最初のメッセージを送る', await waitFor(B, () => /はじめまして、お手伝い/.test(document.getElementById('chat-thread').innerText)));

  // Alice：会話一覧 → 返信
  step('Alice', '会話一覧に届く', await waitFor(A, () => (window.__rawConvs || []).length > 0));
  await A.evaluate(uid => { navTo('msg'); openConvById(uid); }, bUid);
  await sleep(800);
  step('Alice', '会話を開き直しても最初のメッセージと一覧の本文が残る', await waitFor(A, () =>
    /はじめまして、お手伝い/.test(document.getElementById('chat-thread').innerText)
    && (window.__rawConvs || []).some(c => c.lastMessage === 'はじめまして、お手伝いできます')));
  await A.evaluate(() => { document.getElementById('chat-field').value = 'ありがとうございます。土曜はいかがですか'; sendChat(); });
  step('Alice', '返信する', await waitFor(A, () => /土曜はいかが/.test(document.getElementById('chat-thread').innerText)));
  await sleep(800);
  const bSeesName = await B.evaluate(uid => { const c = (window.__rawConvs || [])[0]; return c && c.names ? c.names[uid] : null; }, aUid);
  step('Bob', '返信後も会話データは相手の表示名', bSeesName === aShown, JSON.stringify(bSeesName));

  // Alice：終わりました → お礼（50pt）
  await clearToasts(A);
  await A.evaluate(() => closeDeal());
  step('Alice', '「終わりました」を記録', await waitFor(A, () => window.__toasts.some(t => /記録しました/.test(t))), await lastToasts(A));
  step('Alice', 'お礼を決めるシートが出る', await waitFor(A, () => /お礼を決める/.test(document.getElementById('sheet-title').textContent), null, 4000));
  await waitFor(B, uid => (window.__deals || []).some(d => d.byUid === uid), aUid);
  const dealName = await B.evaluate(uid => ((window.__deals || []).find(d => d.byUid === uid) || {}).byName, aUid);
  step('Bob', '支え合いの記録も相手の表示名', dealName === aShown, JSON.stringify(dealName));
  const aPtsBefore = await A.evaluate(() => myPoints());
  await A.evaluate(uid => { closeSheet(); openThanks(uid, 'いちろう', '', ''); document.querySelector('#sheet-content .thanks-tag').click(); sendThanks(); }, bUid);
  step('Alice', 'ありがとう（50pt）を贈る', await waitFor(A, () => window.__toasts.some(t => /お互いさま/.test(t))), await lastToasts(A));
  await sleep(1200);
  const aPtsAfter = await A.evaluate(() => myPoints());
  step('Alice', '手渡した分だけ残高が減る', aPtsAfter === aPtsBefore - 50, aPtsBefore + ' → ' + aPtsAfter);
  await waitFor(B, () => (window.__thanksIn || []).length > 0);
  const bPts = await B.evaluate(() => ({ pts: myPoints(), fromName: ((window.__thanksIn || [])[0] || {}).fromName || '' }));
  step('Bob', '受け取った50ptが残高に入る', bPts.pts === 350, '残高 ' + bPts.pts);
  step('Bob', '感謝のデータに送り主の名前が残らない', bPts.fromName === '', JSON.stringify(bPts.fromName));

  // ＆ポイントの記録：受け取ったお礼は誰からかを出さない／手渡した相手は出る／実アプリの引き換えは準備中
  const history = (page) => page.evaluate(() => { openPointsHistory(); const rows = [...document.querySelectorAll('#tx-list .tx-row')]; return { kinds: rows.map(r => r.dataset.kind), text: document.getElementById('tx-list').innerText }; });
  const bHist = await history(B);
  step('Bob', '＆ポイントの記録に、受け取った50ptと登録のお祝い', JSON.stringify(bHist.kinds) === '["recv","start"]' && /＋50 pt/.test(bHist.text) && /＋300 pt/.test(bHist.text), JSON.stringify(bHist.kinds));
  step('Bob', '受け取ったお礼に、送り主の名前が出ない', !/はなこ|青木/.test(bHist.text));
  const aHist = await history(A);
  step('Alice', '＆ポイントの記録に、手渡した50pt（相手の名前つき）', aHist.kinds[0] === 'give' && /いちろう さんへ/.test(aHist.text) && /−50 pt/.test(aHist.text), JSON.stringify(aHist.kinds));
  await A.evaluate(() => { closeSheet(); window.__toasts = []; redeem('（例）まちかどカフェ クーポン', '500', 'shop'); });
  step('Alice', '実アプリの引き換えは準備中（引き換えの画面は出さない）', await A.evaluate(() => window.__toasts.some(t => /準備中/.test(t)) && !document.getElementById('sheet-modal').classList.contains('show')));
  await B.evaluate(() => closeSheet());

  // Bob：「終わりました」→「今回は伝えない」／少し気になった／通報／ブロック・解除
  await clearToasts(B);
  await B.evaluate(() => closeDeal());
  await waitFor(B, () => document.getElementById('sheet-modal').classList.contains('show')
    && /お礼を決める/.test(document.getElementById('sheet-title').textContent)
    && !!document.querySelector('#sheet-content [data-post-action="skip-deal-thanks"]'), null, 4000);
  await B.evaluate(() => { const b = [...document.querySelectorAll('#sheet-content button')].find(x => /今回は伝えない/.test(x.textContent)); b && b.click(); });
  step('Bob', '「今回は伝えない」を記録', await waitFor(B, () => window.__toasts.some(t => /相手には伝わりません/.test(t))), await lastToasts(B));
  await clearToasts(B);
  await B.evaluate(() => { openConcern(); document.getElementById('cn-note').value = 'テスト'; sendConcern(); });
  step('Bob', '「少し気になった」を送る', await waitFor(B, () => window.__toasts.some(t => /運営に伝えました/.test(t))), await lastToasts(B));
  await B.evaluate(({ id, uid }) => { openReport('post', id, uid, 'この投稿'); submitReport(); }, { id: post.id, uid: aUid });
  step('Bob', '通報する', await waitFor(B, () => window.__toasts.some(t => /通報を受け付けました/.test(t))), await lastToasts(B));
  await B.evaluate(uid => { confirmBlock(uid, '相手'); doBlock(); }, aUid);
  step('Bob', 'ブロックする', await waitFor(B, () => window.__toasts.some(t => /ブロックしました/.test(t))), await lastToasts(B));
  await B.evaluate(uid => unblockUser(uid), aUid);
  step('Bob', 'ブロックを解除', await waitFor(B, () => window.__toasts.some(t => /ブロックを解除しました/.test(t))), await lastToasts(B));

  // Alice：本人確認の申請／プロフィール編集／おやすみ／投稿の編集
  await clearToasts(A);
  await A.evaluate(() => requestVerify());
  step('Alice', '本人確認を申請', await waitFor(A, () => window.__toasts.some(t => /申請を受け付けました/.test(t))), await lastToasts(A));
  await A.evaluate(() => { openProfileEdit(); document.getElementById('pe-bio').value = '高槻市在住'; saveProfileEdit(); });
  await A.evaluate(() => selfOverrideGate());
  await sleep(1200);
  const myPost = await A.evaluate(() => Object.values(window.__posts || {}).find(p => p.uid === currentProfile.uid && p.type === 'need').id);
  await A.evaluate(() => openMyPosts());
  await waitFor(A, id => !![...document.querySelectorAll('#sheet-content [data-post-action="edit"]')].find(b => b.dataset.postId === encodeURIComponent(id)), myPost);
  await A.evaluate(id => [...document.querySelectorAll('#sheet-content [data-post-action="edit"]')].find(b => b.dataset.postId === encodeURIComponent(id)).click(), myPost);
  step('Alice', '管理シートの編集ボタンが動く', await waitFor(A, () => !!document.getElementById('ep-title')));
  await A.evaluate(() => { document.getElementById('ep-title').value = '通院のあいだ、母の話し相手を（土曜）'; document.querySelector('#sheet-content [data-post-action="save-edit"]').click(); });
  step('Alice', '自分の投稿を編集', await waitFor(A, () => window.__toasts.some(t => /投稿を更新しました/.test(t))), await lastToasts(A));

  // 名前つき会話では安全なデータの印と、空の匿名設定が維持される。
  const namedConv = await B.evaluate(uid => (window.__rawConvs || []).find(c => (c.participants || []).includes(uid)), aUid);
  step('Bob', '名前つき会話だけを購読し、匿名設定は空', !!namedConv && namedConv.privacySafe === true && !(namedConv.masked || []).length);
  const bHead = await B.evaluate(uid => { renderConvList(); return (window.__convs[uid] || {}).name; }, aUid);
  step('Bob', '会話一覧は相手の表示名', bHead === aShown, bHead);

  // Alice：退会
  await clearToasts(A);
  await A.evaluate(() => { openDeleteAccount(); document.getElementById('da-pass').value = 'password-a1'; deleteAccount(); });
  step('Alice', '退会（アカウント削除）', await waitFor(A, () => window.__toasts.some(t => /退会が完了/.test(t)), null, 10000), await lastToasts(A));

  checkErrors([A, B]);
}
