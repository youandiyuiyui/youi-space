// Firestore セキュリティルールの単体テスト（npm run test:rules）。
// 各ケースは、index.html が実際に行う操作（許可されるべき）か、悪用のパターン（拒否されるべき）。
// 別のルールファイルを試すとき：RULES=path/to/rules npm run test:rules
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, orderBy, limit, getDocs,
  serverTimestamp, deleteField, writeBatch, Timestamp,
} from 'firebase/firestore';

const RULES = process.env.RULES || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'firestore.rules');
const env = await initializeTestEnvironment({
  projectId: 'demo-youi-rules',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});

const A = 'uidAlice00000000000000000001', B = 'uidBob0000000000000000000002', C = 'uidCarol000000000000000000003';
const pair = [A, B].sort().join('_'), cid = 'v2_' + pair;
const results = [];
async function t(name, expect, fn) {
  await env.clearFirestore();
  await seed();
  let ok, err = '';
  try { await (expect === 'allow' ? assertSucceeds(fn()) : assertFails(fn())); ok = true; }
  catch (e) { ok = false; err = (e && e.message || '').split('\n')[0].slice(0, 140); }
  results.push({ name, expect, ok, err });
}
async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', A), { type: 'personal', name: 'Alice', email: 'a@example.com', createdAt: Timestamp.fromDate(new Date('2026-09-01T00:00:00Z')), bio: '', points: 300 });
    await setDoc(doc(db, 'users', B), { type: 'personal', name: 'Bob', email: 'b@example.com', createdAt: Timestamp.fromDate(new Date('2026-09-01T00:00:00Z')), bio: '', verified: true });
    await setDoc(doc(db, 'posts', 'pA'), { type: 'tsuide', title: 'ついでに買い物', detail: '', categories: ['買い物'], pref: '大阪府', area: '高槻市', when: '', anon: false, uid: A, authorName: 'Alice', createdAt: Timestamp.now() });
    await setDoc(doc(db, 'posts', 'pB'), { type: 'need', title: '通院の付き添い', detail: '', categories: [], pref: '', area: '', when: '', anon: true, uid: B, authorName: 'Bob', createdAt: Timestamp.now() });
    await setDoc(doc(db, 'thanks', 'tBA'), { fromUid: B, fromName: 'Bob', toUid: A, toName: 'Alice', postId: '', dealId: '', pairKey: pair, privacySafe: true, disaster: false, tags: ['ていねいだった'], note: '', points: 50, createdAt: Timestamp.now() });
    await setDoc(doc(db, 'deals', 'd1'), { participants: [A, B].sort(), byUid: A, byName: 'Alice', otherName: 'Bob', title: '', disaster: false, privacySafe: true, createdAt: Timestamp.now() });
    await setDoc(doc(db, 'decisions', 'x1'), { dealId: 'd1', fromUid: B, toUid: A, createdAt: Timestamp.now() });
    await setDoc(doc(db, 'config', 'disasterMode'), { active: false });
    await setDoc(doc(db, 'config', 'pointsLedger'), { ready: true });
    await setDoc(doc(db, 'config', 'privacyMigration'), { ready: true });
    await setDoc(doc(db, 'wallets', A), { balance: 300, version: 1, lastTransfer: '', updatedAt: Timestamp.now() });
    await setDoc(doc(db, 'wallets', B), { balance: 300, version: 1, lastTransfer: '', updatedAt: Timestamp.now() });
    await setDoc(doc(db, 'conversations', cid), { participants: [A, B], names: { [A]: 'Alice', [B]: 'Bob' }, lastMessage: 'x', lastSender: A, privacySafe: true, masked: [], updatedAt: Timestamp.now() });
  });
}
const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const userDoc = (extra) => Object.assign({ type: 'personal', name: 'Carol', email: 'c@example.com', createdAt: serverTimestamp(), bio: '' }, extra || {});
const postDoc = (uid, extra) => Object.assign({ type: 'tsuide', title: '土曜に車を出せます', detail: '通院など', categories: ['移動・送迎'], pref: '大阪府', area: '高槻市', when: '土曜の午前', anon: false, uid, authorName: 'Alice', createdAt: serverTimestamp() }, extra || {});
const thanksDoc = (from, to, extra) => Object.assign({ fromUid: from, fromName: 'x', toUid: to, toName: 'y', postId: '', dealId: 'd1', pairKey: [from, to].sort().join('_'), privacySafe: true, disaster: false, tags: ['安心できた'], note: 'ありがとう', points: 50, createdAt: serverTimestamp() }, extra || {});
const convDoc = (me, other, extra) => Object.assign({ participants: [me, other], names: { [me]: 'me', [other]: 'other' }, lastMessage: 'こんにちは', lastSender: me, privacySafe: true, masked: [], updatedAt: serverTimestamp() }, extra || {});

// 新規登録はユーザーと財布を同じ一括保存で作る。
function register(extra) {
  const db = as(C), b = writeBatch(db);
  b.set(doc(db, 'users', C), userDoc(extra));
  b.set(doc(db, 'wallets', C), { balance: 300, version: 1, lastTransfer: '', updatedAt: serverTimestamp() });
  b.set(doc(db, 'pointsGrants', C), { amount: 300, version: 1, createdAt: serverTimestamp() });
  return b.commit();
}
function transferThanks(extra) {
  const db = as(A), b = writeBatch(db), ref = doc(collection(db, 'thanks'));
  const d = thanksDoc(A, B, Object.assign({ ledgerVersion: 1 }, extra || {}));
  b.set(ref, d);
  b.update(doc(db, 'wallets', A), { balance: 300 - d.points, lastTransfer: ref.id, updatedAt: serverTimestamp() });
  b.update(doc(db, 'wallets', B), { balance: 300 + d.points, lastTransfer: ref.id, updatedAt: serverTimestamp() });
  return b.commit();
}
const removeSeedConv = () => env.withSecurityRulesDisabled(c => deleteDoc(doc(c.firestore(), 'conversations', cid)));

// ===== users =====
await t('users: 新規登録（個人）', 'allow', () => register());
await t('users: 新規登録（団体）', 'allow', () => register({ type: 'org', orgName: 'NPO法人○○', bio: '公式アカウント' }));
await t('users: 自分のプロフィールを読む', 'allow', () => getDoc(doc(as(A), 'users', A)));
await t('users: プロフィール編集（名前・自己紹介）', 'allow', () => updateDoc(doc(as(A), 'users', A), { name: 'Alice2', bio: '高槻市' }));
await t('users: 本人確認を申請', 'allow', () => updateDoc(doc(as(A), 'users', A), { verifyRequested: true, verifyRequestedAt: serverTimestamp() }));
await t('users: お礼の確認を24時間おやすみ', 'allow', () => updateDoc(doc(as(A), 'users', A), { gateOverrideUntil: Date.now() + 24 * 3600 * 1000 }));
await t('users: ブロックする', 'allow', () => updateDoc(doc(as(A), 'users', A), { ['blocked.' + B]: 'Bob' }));
await t('users: ブロックを解除', 'allow', async () => { await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'users', A), { blocked: { [B]: 'Bob' } })); return updateDoc(doc(as(A), 'users', A), { ['blocked.' + B]: deleteField() }); });
await t('users: 旧pointsを直接減らす操作は拒否', 'deny', () => updateDoc(doc(as(A), 'users', A), { points: 250 }));
await t('users: 未設定の旧pointsを書き込む操作は拒否', 'deny', () => updateDoc(doc(as(B), 'users', B), { points: 250 }));
await t('users: 退会（投稿とプロフィールを一括削除）', 'allow', async () => { const db = as(A); const b = writeBatch(db); (await getDocs(query(collection(db, 'posts'), where('uid', '==', A)))).forEach(d => b.delete(d.ref)); b.delete(doc(db, 'users', A)); return b.commit(); });
await t('users: 他人のプロフィールを読む（メール等）', 'deny', () => getDoc(doc(as(A), 'users', B)));
await t('users: 未ログインで読む', 'deny', () => getDoc(doc(anon(), 'users', A)));
await t('users: 他人のドキュメントを作る', 'deny', () => setDoc(doc(as(A), 'users', C), userDoc()));
await t('users: 登録時に本人確認済みを名乗る', 'deny', () => setDoc(doc(as(C), 'users', C), Object.assign(userDoc(), { verified: true })));
await t('users: 自分で本人確認済みにする', 'deny', () => updateDoc(doc(as(A), 'users', A), { verified: true }));
await t('users: ＆ポイントを増やす', 'deny', () => updateDoc(doc(as(A), 'users', A), { points: 99999 }));
await t('users: 個人から団体に種別を変える', 'deny', () => updateDoc(doc(as(A), 'users', A), { type: 'org' }));
await t('users: おやすみを10日に延ばす', 'deny', () => updateDoc(doc(as(A), 'users', A), { gateOverrideUntil: Date.now() + 10 * 24 * 3600 * 1000 }));
await t('users: 他人のプロフィールを書き換える', 'deny', () => updateDoc(doc(as(A), 'users', B), { name: 'x' }));
await t('users: 他人を削除', 'deny', () => deleteDoc(doc(as(A), 'users', B)));

// ===== posts =====
await t('posts: 掲示板を読む（新しい順50件）', 'allow', () => getDocs(query(collection(as(A), 'posts'), where('anon', '==', false), orderBy('createdAt', 'desc'), limit(50))));
await t('posts: 匿名条件なしで全件を読む旧一覧は拒否', 'deny', () => getDocs(query(collection(as(A), 'posts'), orderBy('createdAt', 'desc'), limit(50))));
await t('posts: 以前の匿名投稿は本人が読む', 'allow', () => getDoc(doc(as(B), 'posts', 'pB')));
await t('posts: 以前の匿名投稿を他人が読む', 'deny', () => getDoc(doc(as(A), 'posts', 'pB')));
await t('posts: 「ついで」を投稿', 'allow', () => addDoc(collection(as(A), 'posts'), postDoc(A)));
await t('posts: 匿名機能停止中は名前を伏せた新規投稿を拒否', 'deny', () => addDoc(collection(as(A), 'posts'), postDoc(A, { type: 'need', when: '', anon: true, pref: '', area: '' })));
await t('posts: できること札を登録', 'allow', () => addDoc(collection(as(A), 'posts'), postDoc(A, { type: 'can', categories: [], when: '' })));
await t('posts: 自分の投稿を編集', 'allow', () => updateDoc(doc(as(A), 'posts', 'pA'), { type: 'need', title: '編集後', detail: 'x', pref: '大阪府', area: '茨木市' }));
await t('posts: 自分の投稿を削除', 'allow', () => deleteDoc(doc(as(A), 'posts', 'pA')));
await t('posts: 未ログインで読む', 'deny', () => getDocs(query(collection(anon(), 'posts'), limit(50))));
await t('posts: 他人になりすまして投稿', 'deny', () => addDoc(collection(as(A), 'posts'), postDoc(B)));
await t('posts: タイトル61文字', 'deny', () => addDoc(collection(as(A), 'posts'), postDoc(A, { title: 'あ'.repeat(61) })));
await t('posts: 投稿日時を偽る', 'deny', () => addDoc(collection(as(A), 'posts'), postDoc(A, { createdAt: Timestamp.fromDate(new Date('2030-01-01')) })));
await t('posts: 他人の投稿を編集', 'deny', () => updateDoc(doc(as(A), 'posts', 'pB'), { title: 'x' }));
await t('posts: 自分の投稿の持ち主を変える', 'deny', () => updateDoc(doc(as(A), 'posts', 'pA'), { uid: B }));
await t('posts: 他人の投稿を削除', 'deny', () => deleteDoc(doc(as(A), 'posts', 'pB')));

// ===== conversations / messages =====
await t('messages: 会話を作る前の一覧は拒否', 'deny', async () => { await removeSeedConv(); return getDocs(query(collection(as(A), 'conversations', cid, 'messages'), orderBy('createdAt', 'asc'), limit(300))); });
await t('conversations: 安全な名前つき会話を新規作成（merge）', 'allow', async () => { await removeSeedConv(); return setDoc(doc(as(A), 'conversations', cid), convDoc(A, B), { merge: true }); });
await t('messages: 最初のメッセージを送る', 'allow', async () => { const db = as(A); await setDoc(doc(db, 'conversations', cid), convDoc(A, B), { merge: true }); return addDoc(collection(db, 'conversations', cid, 'messages'), { senderId: A, text: 'はじめまして', createdAt: serverTimestamp() }); });
await t('conversations: 相手が返信して会話を更新（並び順が逆）', 'allow', async () => { await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'conversations', cid), { participants: [A, B], names: {}, lastMessage: 'x', lastSender: A, privacySafe: true, masked: [], updatedAt: Timestamp.now() })); return setDoc(doc(as(B), 'conversations', cid), convDoc(B, A), { merge: true }); });
await t('conversations: 自分の会話一覧を読む', 'allow', async () => { await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'conversations', cid), { participants: [A, B], names: {}, lastMessage: 'x', lastSender: A, privacySafe: true, masked: [], updatedAt: Timestamp.now() })); return getDocs(query(collection(as(A), 'conversations'), where('privacySafe', '==', true), where('participants', 'array-contains', A))); });
await t('messages: 相手のメッセージを読む', 'allow', async () => { await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'conversations', cid), { participants: [A, B], names: {}, lastMessage: 'x', lastSender: A, privacySafe: true, masked: [], updatedAt: Timestamp.now() }); await addDoc(collection(c.firestore(), 'conversations', cid, 'messages'), { senderId: A, text: 'x', createdAt: Timestamp.now() }); }); return getDocs(query(collection(as(B), 'conversations', cid, 'messages'), orderBy('createdAt', 'asc'), limit(300))); });
await t('messages: 部外者が会話を読む', 'deny', () => getDocs(query(collection(as(C), 'conversations', cid, 'messages'), limit(300))));
await t('messages: 部外者が送る', 'deny', () => addDoc(collection(as(C), 'conversations', cid, 'messages'), { senderId: C, text: 'x', createdAt: serverTimestamp() }));
await t('messages: 送信者を偽る', 'deny', () => addDoc(collection(as(A), 'conversations', cid, 'messages'), { senderId: B, text: 'x', createdAt: serverTimestamp() }));
await t('conversations: 部外者が会話一覧を読む', 'deny', async () => { await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'conversations', cid), { participants: [A, B], names: {}, lastMessage: 'x', lastSender: A, privacySafe: true, masked: [], updatedAt: Timestamp.now() })); return getDoc(doc(as(C), 'conversations', cid)); });
await t('conversations: 他人どうしの会話を作る', 'deny', () => setDoc(doc(as(C), 'conversations', cid), convDoc(C, B), { merge: true }));
await t('conversations: 会話IDと参加者が食い違う', 'deny', () => setDoc(doc(as(A), 'conversations', cid), convDoc(A, C), { merge: true }));

// ===== thanks =====
await t('thanks: 財布2件とありがとうを一括保存（50pt）', 'allow', () => transferThanks());
await t('thanks: ＆ポイントを渡さずに贈る', 'allow', () => addDoc(collection(as(A), 'thanks'), thanksDoc(A, B, { points: 0 })));
await t('thanks: 受け取った感謝を読む', 'allow', () => getDocs(query(collection(as(A), 'thanks'), where('privacySafe', '==', true), where('toUid', '==', A))));
await t('thanks: 贈った感謝を読む', 'allow', () => getDocs(query(collection(as(B), 'thanks'), where('privacySafe', '==', true), where('fromUid', '==', B))));
await t('thanks: 他人あての感謝をのぞく', 'deny', () => getDocs(query(collection(as(C), 'thanks'), where('toUid', '==', A))));
await t('thanks: 自分に贈る', 'deny', () => addDoc(collection(as(A), 'thanks'), thanksDoc(A, A)));
await t('thanks: 他人になりすまして贈る', 'deny', () => addDoc(collection(as(C), 'thanks'), thanksDoc(B, A)));
await t('thanks: 選択肢にない＆ポイント（9999）', 'deny', () => addDoc(collection(as(A), 'thanks'), thanksDoc(A, B, { points: 9999 })));
await t('thanks: 贈った感謝を書き換える', 'deny', () => updateDoc(doc(as(B), 'thanks', 'tBA'), { points: 100 }));
await t('thanks: 受け取った感謝を消す', 'deny', () => deleteDoc(doc(as(A), 'thanks', 'tBA')));

// ===== deals / decisions =====
await t('deals: 「終わりました」を記録', 'allow', () => addDoc(collection(as(A), 'deals'), { participants: [A, B].sort(), byUid: A, byName: 'Alice', otherName: 'Bob', title: '', disaster: false, privacySafe: true, createdAt: serverTimestamp() }));
await t('deals: 自分の支え合いの記録を読む', 'allow', () => getDocs(query(collection(as(B), 'deals'), where('privacySafe', '==', true), where('participants', 'array-contains', B))));
await t('deals: 他人どうしの記録を作る', 'deny', () => addDoc(collection(as(C), 'deals'), { participants: [A, B].sort(), byUid: C, byName: 'x', otherName: 'y', title: '', disaster: false, privacySafe: true, createdAt: serverTimestamp() }));
await t('deals: 部外者が記録を読む', 'deny', () => getDoc(doc(as(C), 'deals', 'd1')));
await t('decisions: 「今回は伝えない」を記録', 'allow', () => addDoc(collection(as(A), 'decisions'), { dealId: 'd1', fromUid: A, toUid: B, createdAt: serverTimestamp() }));
await t('decisions: 自分の決定を読む', 'allow', () => getDocs(query(collection(as(B), 'decisions'), where('fromUid', '==', B))));
await t('decisions: 相手が「伝えない」を選んだかのぞく', 'deny', () => getDocs(query(collection(as(A), 'decisions'), where('fromUid', '==', B))));

// ===== concerns / reports / config =====
await t('concerns: 「少し気になった」を運営に送る', 'allow', () => addDoc(collection(as(A), 'concerns'), { fromUid: A, aboutUid: B, dealId: '', note: '少し気になりました', createdAt: serverTimestamp() }));
await t('concerns: 読む（運営以外）', 'deny', () => getDocs(query(collection(as(A), 'concerns'), where('fromUid', '==', A))));
await t('reports: 通報する', 'allow', () => addDoc(collection(as(A), 'reports'), { targetType: 'post', targetId: 'pB', targetUid: B, reason: '金銭の要求・営業や勧誘', detail: '', reporterUid: A, createdAt: serverTimestamp() }));
await t('reports: 通報者を偽る', 'deny', () => addDoc(collection(as(A), 'reports'), { targetType: 'user', targetId: '', targetUid: B, reason: 'その他', detail: '', reporterUid: C, createdAt: serverTimestamp() }));
await t('reports: 読む（運営以外）', 'deny', () => getDocs(collection(as(A), 'reports')));
await t('config: 災害モードを読む', 'allow', () => getDoc(doc(as(A), 'config', 'disasterMode')));
await t('config: 災害モードを書き換える', 'deny', () => setDoc(doc(as(A), 'config', 'disasterMode'), { active: true }));
await t('その他: ルールにないコレクション', 'deny', () => setDoc(doc(as(A), 'misc', 'x'), { a: 1 }));

// ===== 旧匿名データの隔離と、名前つき会話・送り主名なしの感謝 =====
const seedConv = (extra) => env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'conversations', cid), Object.assign({ participants: [A, B], names: { [A]: 'Alice', [B]: 'ご近所の方' }, lastMessage: 'x', lastSender: A, privacySafe: true, masked: [], updatedAt: Timestamp.now() }, extra || {})));
await t('旧匿名 posts: 名前が空でも新規匿名投稿は拒否', 'deny', () => addDoc(collection(as(B), 'posts'), postDoc(B, { type: 'need', when: '', anon: true, authorName: '' })));
await t('旧匿名 conversations: masked会話の新規作成は拒否', 'deny', async () => { await removeSeedConv(); return setDoc(doc(as(A), 'conversations', cid), convDoc(A, B, { names: { [A]: 'Alice', [B]: 'ご近所の方' }, masked: [B] }), { merge: true }); });
await t('旧匿名 conversations: 隔離中の会話を本人が読む操作も拒否', 'deny', async () => { await seedConv({ masked: [B], privacySafe: false }); return getDoc(doc(as(B), 'conversations', cid)); });
await t('旧匿名 conversations: 以前の匿名会話への返信を拒否', 'deny', async () => { await seedConv({ masked: [B], privacySafe: false }); return setDoc(doc(as(B), 'conversations', cid), convDoc(B, A, { names: { [B]: 'ご近所の方', [A]: 'Alice' }, masked: [B] }), { merge: true }); });
await t('旧匿名 conversations: 本人でも旧会話のprivacySafe昇格を拒否', 'deny', async () => { await seedConv({ masked: [B], privacySafe: false }); return setDoc(doc(as(B), 'conversations', cid), convDoc(B, A, { names: { [B]: 'Bob', [A]: 'Alice' }, masked: [] }), { merge: true }); });
await t('v051 conversations: 相手が勝手に伏せる設定を外す', 'deny', async () => { await seedConv({ masked: [B], privacySafe: false }); return setDoc(doc(as(A), 'conversations', cid), convDoc(A, B, { masked: [] }), { merge: true }); });
await t('v051 conversations: 参加者でない人を masked に入れる', 'deny', () => setDoc(doc(as(A), 'conversations', cid), convDoc(A, B, { masked: [C] }), { merge: true }));
await t('v051 conversations: 伏せる設定のない会話は従来どおり', 'allow', async () => { await seedConv(); return setDoc(doc(as(B), 'conversations', cid), convDoc(B, A), { merge: true }); });
await t('thanks: 送り主の名前なしで0pt感謝を贈る', 'allow', () => addDoc(collection(as(A), 'thanks'), (() => { const d = thanksDoc(A, B, { points: 0 }); delete d.fromName; return d; })()));
await t('thanks: 安全性の印なしの旧形式では0ptでも拒否', 'deny', () => addDoc(collection(as(A), 'thanks'), (() => { const d = thanksDoc(A, B, { points: 0 }); delete d.privacySafe; return d; })()));
await t('thanks: 未分類の旧感謝は当事者も読めない', 'deny', async () => { await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'thanks', 'tBA'), { privacySafe: false })); return getDoc(doc(as(A), 'thanks', 'tBA')); });
await t('deals: 未分類の旧記録は当事者も読めない', 'deny', async () => { await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'deals', 'd1'), { privacySafe: false })); return getDoc(doc(as(A), 'deals', 'd1')); });

// ===== v0.5.2：ニックネーム（表示名）と本名（非公開） =====
await t('v052 users: ニックネーム付きで新規登録', 'allow', () => register({ nickname: 'かーちゃん' }));
await t('v052 users: ニックネームが21文字', 'deny', () => setDoc(doc(as(C), 'users', C), userDoc({ nickname: 'あ'.repeat(21) })));
await t('v052 users: ニックネームを設定・変更', 'allow', () => updateDoc(doc(as(A), 'users', A), { nickname: 'ありす' }));
await t('v052 users: ニックネームを空にする', 'deny', () => updateDoc(doc(as(A), 'users', A), { nickname: '' }));
await t('v052 users: 他人の本名・ニックネームを読む', 'deny', () => getDoc(doc(as(B), 'users', A)));
await t('v052 posts: 自分の投稿の表示名をそろえる', 'allow', () => updateDoc(doc(as(A), 'posts', 'pA'), { authorName: 'ありす' }));
await t('旧匿名 posts: 隔離中の匿名投稿は本人も編集できない', 'deny', async () => { await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'posts', 'pB'), { authorName: 'Bob' })); return updateDoc(doc(as(B), 'posts', 'pB'), { authorName: '' }); });
await t('v052 posts: 伏せた投稿に名前を入れる', 'deny', () => updateDoc(doc(as(B), 'posts', 'pB'), { authorName: 'Bobby' }));
await t('v052 posts: 他人の投稿の表示名を変える', 'deny', () => updateDoc(doc(as(A), 'posts', 'pB'), { authorName: '' }));
await t('v052 posts: 表示名と一緒に持ち主を変える', 'deny', () => updateDoc(doc(as(A), 'posts', 'pA'), { authorName: 'ありす', uid: B }));

// ===== v0.5.3：公開プロフィール（profiles） =====
const admin = (fn) => env.withSecurityRulesDisabled(c => fn(c.firestore()));
const nick = (uid, nickname, extra) => admin(db => updateDoc(doc(db, 'users', uid), Object.assign({ nickname }, extra || {})));
const profDoc = (name, extra) => Object.assign({ name, type: 'personal', bio: '高槻市に住んでいます', verified: false, listed: false, updatedAt: serverTimestamp() }, extra || {});
const seedProf = (uid, name, extra) => admin(db => setDoc(doc(db, 'profiles', uid), Object.assign({ name, type: 'personal', bio: '', verified: false, listed: false, updatedAt: Timestamp.now() }, extra || {})));
const conv = (extra) => admin(db => setDoc(doc(db, 'conversations', cid), Object.assign({ participants: [A, B], names: { [A]: 'ありす', [B]: 'ぼぶ' }, lastMessage: 'x', lastSender: A, privacySafe: true, masked: [], updatedAt: Timestamp.now() }, extra || {})));
await t('v053 profiles: 本人が公開プロフィールを作る（名前＝ニックネーム）', 'allow', async () => { await nick(A, 'ありす'); return setDoc(doc(as(A), 'profiles', A), profDoc('ありす')); });
await t('v053 profiles: ニックネーム変更と同時にそろえる（一括）', 'allow', async () => { await nick(A, 'ありす'); await seedProf(A, 'ありす'); const db = as(A); const b = writeBatch(db); b.update(doc(db, 'users', A), { nickname: 'ありす2' }); b.set(doc(db, 'profiles', A), profDoc('ありす2')); return b.commit(); });
await t('v053 profiles: ニックネーム変更のあとでそろえる', 'allow', async () => { await nick(A, 'ありす2'); await seedProf(A, 'ありす'); return setDoc(doc(as(A), 'profiles', A), profDoc('ありす2', { listed: true })); });
await t('v053 profiles: 運営が本人確認済みにした人が印を付ける', 'allow', async () => { await nick(B, 'ぼぶ'); return setDoc(doc(as(B), 'profiles', B), profDoc('ぼぶ', { verified: true })); });
await t('v053 profiles: 団体は団体名で公開', 'allow', async () => { await admin(db => setDoc(doc(db, 'users', C), userDoc({ type: 'org', orgName: 'NPO法人○○', bio: '公式アカウント' }))); return setDoc(doc(as(C), 'profiles', C), profDoc('NPO法人○○', { type: 'org', bio: '公式アカウント', listed: true })); });
await t('v053 profiles: 本人が読む（まだ無いときも）', 'allow', () => getDoc(doc(as(A), 'profiles', A)));
await t('v053 profiles: 名前を出して投稿した人（listed）を、ログイン者が読む', 'allow', async () => { await seedProf(A, 'ありす', { listed: true }); return getDoc(doc(as(C), 'profiles', A)); });
await t('v053 profiles: 会話の相手が読む（listed でなくても）', 'allow', async () => { await seedProf(B, 'ぼぶ'); await conv(); return getDoc(doc(as(A), 'profiles', B)); });
await t('v053 profiles: 名前つき会話では相手を読める', 'allow', async () => { await seedProf(B, 'ぼぶ'); await conv({ masked: [] }); return getDoc(doc(as(A), 'profiles', B)); });
await t('旧匿名 profiles: 隔離中の会話から相手を読む操作は拒否', 'deny', async () => { await seedProf(A, 'ありす'); await conv({ masked: [B], privacySafe: false }); return getDoc(doc(as(B), 'profiles', A)); });
await t('v053 profiles: 退会で削除（投稿・users・profiles を一括）', 'allow', async () => { await seedProf(A, 'ありす'); const db = as(A); const b = writeBatch(db); (await getDocs(query(collection(db, 'posts'), where('uid', '==', A)))).forEach(d => b.delete(d.ref)); b.delete(doc(db, 'profiles', A)); b.delete(doc(db, 'users', A)); return b.commit(); });
await t('v053 profiles: 相手のプロフィール用に投稿を読む（uid で絞る）', 'allow', () => getDocs(query(collection(as(C), 'posts'), where('uid', '==', A), where('anon', '==', false), limit(50))));
await t('v053 profiles: 未ログインで読む', 'deny', async () => { await seedProf(A, 'ありす', { listed: true }); return getDoc(doc(anon(), 'profiles', A)); });
await t('v053 profiles: 会話もなく listed でもない人を読む', 'deny', async () => { await seedProf(B, 'ぼぶ'); return getDoc(doc(as(C), 'profiles', B)); });
await t('v053 profiles: ほかの2人の会話を使って読む', 'deny', async () => { await seedProf(B, 'ぼぶ'); await conv(); return getDoc(doc(as(C), 'profiles', B)); });
await t('v053 profiles: 名前を伏せている相手のプロフィールを読む', 'deny', async () => { await seedProf(B, 'ぼぶ'); await conv({ masked: [B], privacySafe: false }); return getDoc(doc(as(A), 'profiles', B)); });
await t('v053 profiles: ブロックされている人が読む', 'deny', async () => { await seedProf(B, 'ぼぶ', { listed: true }); await admin(db => updateDoc(doc(db, 'users', B), { blocked: { [A]: 'ありす' } })); return getDoc(doc(as(A), 'profiles', B)); });
await t('v053 profiles: 一覧で取得する', 'deny', async () => { await seedProf(A, 'ありす', { listed: true }); return getDocs(query(collection(as(C), 'profiles'), where('listed', '==', true))); });
await t('v053 profiles: 本名を名前にする', 'deny', async () => { await nick(A, 'ありす'); return setDoc(doc(as(A), 'profiles', A), profDoc('Alice')); });
await t('v053 profiles: ニックネーム未設定のまま作る（本名しかない）', 'deny', () => setDoc(doc(as(A), 'profiles', A), profDoc('Alice')));
await t('v053 profiles: 自分で本人確認済みの印を付ける', 'deny', async () => { await nick(A, 'ありす'); return setDoc(doc(as(A), 'profiles', A), profDoc('ありす', { verified: true })); });
await t('v053 profiles: 個人が団体を名乗る', 'deny', async () => { await nick(A, 'ありす'); return setDoc(doc(as(A), 'profiles', A), profDoc('ありす', { type: 'org' })); });
await t('v053 profiles: 他人のプロフィールを書く', 'deny', async () => { await nick(B, 'ぼぶ'); return setDoc(doc(as(A), 'profiles', B), profDoc('ぼぶ')); });
await t('v053 profiles: 他人のプロフィールを消す', 'deny', async () => { await seedProf(B, 'ぼぶ', { listed: true }); return deleteDoc(doc(as(A), 'profiles', B)); });
await t('v053 profiles: メールアドレスを載せる', 'deny', async () => { await nick(A, 'ありす'); return setDoc(doc(as(A), 'profiles', A), profDoc('ありす', { email: 'a@example.com' })); });
await t('v053 profiles: 自己紹介201文字', 'deny', async () => { await nick(A, 'ありす'); return setDoc(doc(as(A), 'profiles', A), profDoc('ありす', { bio: 'あ'.repeat(201) })); });
await t('v053 profiles: 更新日時を偽る', 'deny', async () => { await nick(A, 'ありす'); return setDoc(doc(as(A), 'profiles', A), profDoc('ありす', { updatedAt: Timestamp.fromDate(new Date('2030-01-01')) })); });

await env.cleanup();
const bad = results.filter(r => !r.ok);
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + (r.expect === 'allow' ? '[許可] ' : '[拒否] ') + r.name + (r.ok ? '' : '  → ' + r.err));
console.log(`\n${path.basename(RULES)}: ${results.length - bad.length}/${results.length} 件が期待どおり`);
process.exit(bad.length ? 1 : 0);
