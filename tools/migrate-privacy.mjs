#!/usr/bin/env node
// 実行例（初期値は読取りと集計だけ）：
//   node tools/migrate-privacy.mjs --project you-i-space
//   node tools/migrate-privacy.mjs --project you-i-space --apply
// firebase-admin を運営用 Node 環境に導入し、Application Default Credentials を使用する。
// 公式手順: https://firebase.google.com/docs/admin/setup
// 先に新しいrulesで旧匿名読出しを止め、pointsLedger.ready:false の状態で行う。
// 元データは消さない。匿名／安全性不明の履歴は privacySafe:false にし、運営限定の保管先へ写す。
// 初回移行の完了まで config/privacyMigration.ready は false。親なしmessagesに安全な親を再作成させない。
import { createHash } from 'node:crypto';
import { planPrivacyMigration } from './privacy-plan.mjs';

const args = process.argv.slice(2);
const projectIndex = args.indexOf('--project');
const projectId = projectIndex >= 0 ? args[projectIndex + 1] : '';
const apply = args.includes('--apply');
if (!projectId || projectId.startsWith('--') || args.some(x => !['--project', '--apply', projectId].includes(x))) {
  console.error('使い方: node tools/migrate-privacy.mjs --project <FirebaseプロジェクトID> [--apply]');
  process.exit(1);
}
const { initializeApp, applicationDefault, deleteApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const app = initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore(app);
try {
  const ledger = await db.doc('config/pointsLedger').get();
  if (apply && ledger.exists && ledger.data().ready === true) {
    throw new Error('先に config/pointsLedger.ready を false にしてください。移行中のポイント送信を止めるためです。');
  }
  if (apply) await db.doc('config/privacyMigration').set({ ready: false, updatedAt: FieldValue.serverTimestamp() });
  const loaded = {};
  for (const collection of ['posts', 'conversations', 'deals', 'thanks']) {
    const snap = await db.collection(collection).get();
    loaded[collection] = snap.docs.map(d => ({ id: d.id, data: d.data(), updateTime: d.updateTime }));
  }
  const plan = planPrivacyMigration(loaded);
  const knownConversationIds = new Set(loaded.conversations.map(c => c.id));
  const orphanParents = new Map();
  const messages = await db.collectionGroup('messages').get();
  for (const message of messages.docs) {
    const parent = message.ref.parent.parent;
    if (parent?.parent.id === 'conversations' && !knownConversationIds.has(parent.id)) {
      orphanParents.set(parent.id, (orphanParents.get(parent.id) || 0) + 1);
    }
  }
  const summary = {};
  for (const item of plan) {
    summary[item.collection] ||= { safe: 0, quarantined: 0, needsFlag: 0 };
    summary[item.collection][item.safe ? 'safe' : 'quarantined']++;
    if (item.mark && item.data.privacySafe !== item.safe) summary[item.collection].needsFlag++;
  }
  console.log(JSON.stringify({ projectId, mode: apply ? 'apply' : 'dry-run', summary, orphanConversationParents: orphanParents.size }, null, 2));
  if (!apply) {
    console.log('読取りと集計だけ行いました。氏名・UID・本文は出力していません。');
  } else {
    for (const item of plan) {
      // 再実行しても最初の保管内容を変えない。元データと保管先を同じtransactionで更新する。
      const original = db.collection(item.collection).doc(item.id);
      const hash = createHash('sha256').update(item.collection + '/' + item.id).digest('hex');
      const archived = db.collection('privacyQuarantine').doc(hash);
      await db.runTransaction(async transaction => {
        const [current, backup] = await Promise.all([transaction.get(original), transaction.get(archived)]);
        if (!current.exists) return;
        // 読取り後に会話等が変更されたときは、推測して公開せずdry-runからやり直す。
        if (!current.updateTime.isEqual(item.updateTime)) throw new Error('移行中にデータが変わりました。読取りからやり直してください。');
        const now = current.data();
        // 計画作成時との比較はFirestoreの型を保持したまま行う（下のdeepEqual）。
        if (!sameData(now, item.data)) throw new Error('移行中にデータが変わりました。読取りからやり直してください。');
        if (!item.safe && !backup.exists) {
          transaction.create(archived, {
            sourceCollection: item.collection, sourceId: item.id, reason: item.reason,
            data: now, quarantinedAt: FieldValue.serverTimestamp(),
          });
        }
        if (item.mark && now.privacySafe !== item.safe) transaction.update(original, { privacySafe: item.safe });
      });
    }
    for (const [id, messageCount] of orphanParents) {
      const parent = db.collection('conversations').doc(id);
      const hash = createHash('sha256').update('conversations/' + id).digest('hex');
      const archived = db.collection('privacyQuarantine').doc(hash);
      await db.runTransaction(async transaction => {
        const [current, backup] = await Promise.all([transaction.get(parent), transaction.get(archived)]);
        if (current.exists) throw new Error('親なし会話に親が作られました。新しいルールと移行の状態を確認してください。');
        const data = { privacySafe: false, privacyTombstone: true, orphanMessageCount: messageCount };
        transaction.create(parent, data);
        if (!backup.exists) transaction.create(archived, {
          sourceCollection: 'conversations', sourceId: id, reason: 'orphan-messages', data,
          quarantinedAt: FieldValue.serverTimestamp(),
        });
      });
    }
    await db.doc('config/privacyMigration').set({ ready: true, updatedAt: FieldValue.serverTimestamp() });
    console.log('移行が完了しました。元データと会話内のmessagesは削除していません。通常の新規会話を再開できます。');
  }
} finally {
  await db.terminate();
  await deleteApp(app);
}

function sameData(a, b) {
  if (a === b) return true;
  if (a && typeof a.isEqual === 'function') return a.isEqual(b);
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameData(a[k], b[k]));
}
