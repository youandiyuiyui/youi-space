// P1: 匿名の旧データを直接取得・一覧・改ざんから保護する。
// Firestore Emulator が起動した状態で node privacy-p1.test.mjs を実行する。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, query, where, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-youi-privacy-p1',
  firestore: { rules: fs.readFileSync(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8'), host: '127.0.0.1', port: 8080 },
});
const A = 'privacyAlice', B = 'privacyBob', C = 'privacyCarol';
const cid = [A, B].sort().join('_'), safeCid = 'v2_' + [A, C].sort().join('_');
const blockedV2 = 'v2_' + cid;
const db = uid => env.authenticatedContext(uid).firestore();
const post = (uid, anon) => ({ type: 'need', title: '確認用', detail: '', categories: [], pref: '', area: '', when: '', anon, uid, authorName: anon ? '' : 'テスト', createdAt: serverTimestamp() });
const conversation = (participants, extra = {}) => ({ participants, names: Object.fromEntries(participants.map(u => [u, 'ニックネーム'])), lastMessage: '', lastSender: participants[0], updatedAt: serverTimestamp(), privacySafe: true, ...extra });
let count = 0;
async function check(name, fn) { await fn(); count++; console.log('PASS', name); }
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, 'config', 'privacyMigration'), { ready: true });
    await setDoc(doc(admin, 'users', B), { type: 'personal', name: '本名', nickname: 'ぼぶ', blocked: {} });
    await setDoc(doc(admin, 'profiles', B), { name: 'ぼぶ', type: 'personal', bio: '', verified: false, listed: false, updatedAt: Timestamp.now() });
    await setDoc(doc(admin, 'posts', 'oldAnon'), { ...post(B, true), createdAt: Timestamp.now() });
    await setDoc(doc(admin, 'posts', 'named'), { ...post(C, false), createdAt: Timestamp.now() });
    await setDoc(doc(admin, 'conversations', cid), conversation([A, B], { masked: [B], privacySafe: false, updatedAt: Timestamp.now() }));
    await setDoc(doc(admin, 'conversations', cid, 'messages', 'old'), { senderId: B, text: '以前の匿名会話', createdAt: Timestamp.now() });
    await setDoc(doc(admin, 'deals', 'oldDeal'), { participants: [A, B], byUid: A, byName: 'A', otherName: 'ご近所の方', privacySafe: false, createdAt: Timestamp.now() });
    await setDoc(doc(admin, 'thanks', 'oldThanks'), { fromUid: B, toUid: A, points: 30, privacySafe: false, createdAt: Timestamp.now() });
    await setDoc(doc(admin, 'thanks', 'namedThanks'), { fromUid: C, toUid: A, points: 30, privacySafe: true, createdAt: Timestamp.now() });
    await setDoc(doc(admin, 'deals', 'namedDeal'), { participants: [A, C], byUid: A, byName: 'ありす', otherName: 'かろる', privacySafe: true, createdAt: Timestamp.now() });
  });
  await check('他人は旧匿名投稿を直接取得できない', () => assertFails(getDoc(doc(db(A), 'posts', 'oldAnon'))));
  await check('本人は旧匿名投稿を確認できる', () => assertSucceeds(getDoc(doc(db(B), 'posts', 'oldAnon'))));
  await check('本人の投稿一覧は旧匿名投稿も取得できる', () => assertSucceeds(getDocs(query(collection(db(B), 'posts'), where('uid', '==', B)))));
  await check('一般の投稿一覧はanon=falseで取得できる', () => assertSucceeds(getDocs(query(collection(db(A), 'posts'), where('anon', '==', false)))));
  await check('匿名を含める一覧は拒否する', () => assertFails(getDocs(collection(db(A), 'posts'))));
  await check('他人のUIDで匿名投稿を検索しても拒否する', () => assertFails(getDocs(query(collection(db(A), 'posts'), where('uid', '==', B)))));
  await check('新しい匿名投稿を拒否する', () => assertFails(setDoc(doc(db(B), 'posts', 'newAnon'), post(B, true))));
  await check('旧匿名投稿を名前つきにすり替えられない', () => assertFails(updateDoc(doc(db(B), 'posts', 'oldAnon'), { anon: false, authorName: 'B' })));
  await check('旧匿名投稿は本人が取り下げられる', () => assertSucceeds(deleteDoc(doc(db(B), 'posts', 'oldAnon'))));
  await check('旧匿名会話を当事者でも取得できない', () => assertFails(getDoc(doc(db(A), 'conversations', cid))));
  await check('旧匿名会話のmessagesを直接取得できない', () => assertFails(getDocs(collection(db(A), 'conversations', cid, 'messages'))));
  await check('旧会話のprivacySafeを本人が偽造できない', () => assertFails(setDoc(doc(db(A), 'conversations', cid), conversation([A, B]), { merge: true })));
  await check('旧匿名会話のmessagesに送信できない', () => assertFails(setDoc(doc(db(A), 'conversations', cid, 'messages', 'new'), { senderId: A, text: '送信', createdAt: serverTimestamp() })));
  await check('旧匿名pairからv2の通常会話を作る迂回を拒否する', () => assertFails(setDoc(doc(db(A), 'conversations', blockedV2), conversation([A, B]))));
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'conversations', blockedV2), conversation([A, B], { updatedAt: Timestamp.now() })));
  await check('旧匿名pairのv2が真に誤設定されても直接取得を拒否する', () => assertFails(getDoc(doc(db(A), 'conversations', blockedV2))));
  await check('旧匿名pairのv2からメッセージを読む迂回を拒否する', () => assertFails(getDocs(collection(db(A), 'conversations', blockedV2, 'messages'))));
  await check('旧匿名pairのv2から相手のニックネームを引き出せない', () => assertFails(getDoc(doc(db(A), 'profiles', B))));
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'conversations', blockedV2), { privacySafe: false }));
  await check('新しい通常会話の不存在は本人が確認できる', () => assertSucceeds(getDoc(doc(db(A), 'conversations', safeCid))));
  await check('新しい通常会話の不存在を部外者は取得できない', () => assertFails(getDoc(doc(db(B), 'conversations', safeCid))));
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'config', 'privacyMigration'), { ready: false }));
  await check('移行中は新しい通常会話も作れない', () => assertFails(setDoc(doc(db(A), 'conversations', safeCid), conversation([A, C]))));
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'config', 'privacyMigration'), { ready: true }));
  await check('安全性が確認された通常会話を作れる', () => assertSucceeds(setDoc(doc(db(A), 'conversations', safeCid), conversation([A, C]))));
  await check('通常会話は取得できる', () => assertSucceeds(getDoc(doc(db(C), 'conversations', safeCid))));
  await check('通常会話の一覧はprivacySafe=trueで取得できる', () => assertSucceeds(getDocs(query(collection(db(A), 'conversations'), where('participants', 'array-contains', A), where('privacySafe', '==', true)))));
  await check('旧匿名を含む会話一覧は拒否する', () => assertFails(getDocs(query(collection(db(A), 'conversations'), where('participants', 'array-contains', A)))));
  await check('privacySafe=trueでもmasked追加は拒否する', () => assertFails(updateDoc(doc(db(A), 'conversations', safeCid), { masked: [A], updatedAt: serverTimestamp() })));
  await check('通常会話にはメッセージを送信できる', () => assertSucceeds(setDoc(doc(db(A), 'conversations', safeCid, 'messages', 'hello'), { senderId: A, text: 'こんにちは', createdAt: serverTimestamp() })));
  for (const names of [42, [], { [A]: 'A' }, { [A]: 42, [C]: 'C' }, { [A]: '', [C]: 'C' }, { [A]: 'A'.repeat(61), [C]: 'C' }, { [A]: 'A', [C]: 'C', [B]: 'B' }]) {
    await check('会話の不正namesを拒否する ' + JSON.stringify(names), () => assertFails(updateDoc(doc(db(A), 'conversations', safeCid), { names, updatedAt: serverTimestamp() })));
  }
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'config', 'privacyMigration'), { ready: false }));
  await check('移行中は通常会話の直接取得も停止する', () => assertFails(getDoc(doc(db(A), 'conversations', safeCid))));
  await check('移行中は通常会話の更新も停止する', () => assertFails(updateDoc(doc(db(A), 'conversations', safeCid), { lastMessage: '更新', updatedAt: serverTimestamp() })));
  await check('移行中は通常メッセージの取得も停止する', () => assertFails(getDocs(collection(db(A), 'conversations', safeCid, 'messages'))));
  await check('移行中は通常の感謝の取得も停止する', () => assertFails(getDoc(doc(db(A), 'thanks', 'namedThanks'))));
  await check('移行中は通常の支え合い記録の取得も停止する', () => assertFails(getDoc(doc(db(A), 'deals', 'namedDeal'))));
  await check('移行中は0ptの感謝も保存できない', () => assertFails(setDoc(doc(db(A), 'thanks', 'duringMigration'), {
    fromUid: A, toUid: C, fromName: 'ありす', toName: 'かろる', pairKey: [A, C].sort().join('_'),
    points: 0, tags: ['安心できた'], note: '', postId: '', dealId: '', disaster: false,
    privacySafe: true, createdAt: serverTimestamp(),
  })));
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'config', 'privacyMigration'), { ready: true }));
  await check('旧匿名の支え合い記録は当事者にも公開しない', () => assertFails(getDoc(doc(db(A), 'deals', 'oldDeal'))));
  await check('旧匿名の感謝は当事者にも公開しない', () => assertFails(getDoc(doc(db(A), 'thanks', 'oldThanks'))));
  await check('保管先はどの利用者にも読めない', () => assertFails(getDoc(doc(db(B), 'privacyQuarantine', 'anything'))));
  await env.withSecurityRulesDisabled(ctx => deleteDoc(doc(ctx.firestore(), 'conversations', cid)));
  await check('親だけ消えた旧匿名messagesも読めない', () => assertFails(getDocs(collection(db(A), 'conversations', cid, 'messages'))));
  await check('旧パスに安全な親を再作成できない', () => assertFails(setDoc(doc(db(A), 'conversations', cid), conversation([A, B]))));
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'conversations', cid), { privacySafe: false, privacyTombstone: true }));
  await check('旧親なし履歴のtombstoneがv2新規会話も止める', () => assertFails(setDoc(doc(db(A), 'conversations', blockedV2), conversation([A, B]))));
  const freshCid = 'v2_' + [A, 'privacyDave'].sort().join('_');
  await check('別の安全な相手との新規会話はv2パスに作れる', () => assertSucceeds(setDoc(doc(db(A), 'conversations', freshCid), conversation([A, 'privacyDave']))));
  await check('v2の新規会話に旧messagesは現れない', async () => {
    const snap = await assertSucceeds(getDocs(collection(db(A), 'conversations', freshCid, 'messages')));
    if (!snap.empty) throw new Error('旧メッセージが混ざりました');
  });
  await check('v2会話が作られても旧messagesは読めない', () => assertFails(getDocs(collection(db(A), 'conversations', cid, 'messages'))));
  const orphanCid = 'v2_' + [B, C].sort().join('_');
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'conversations', orphanCid), { privacySafe: false, privacyTombstone: true });
    await setDoc(doc(ctx.firestore(), 'conversations', orphanCid, 'messages', 'legacy'), { senderId: B, text: '親のない旧メッセージ', createdAt: Timestamp.now() });
  });
  await check('v2の親なし履歴も移行tombstoneで再作成を拒否する', () => assertFails(setDoc(doc(db(B), 'conversations', orphanCid), conversation([B, C]))));
  await check('v2の親なし履歴も移行後読めない', () => assertFails(getDocs(collection(db(C), 'conversations', orphanCid, 'messages'))));
  console.log(`${count} 件の P1 匿名保護検証が通りました`);
} finally {
  await env.cleanup();
}
