// P1: 不正カテゴリによる一覧停止と、投稿IDにコードを埋め込む書き込みを拒否する。
// Firestore Emulator が起動した状態で node posts-schema-p1.test.mjs を実行する。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-youi-post-schema-p1',
  firestore: { rules: fs.readFileSync(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8'), host: '127.0.0.1', port: 8080 },
});
const uid = 'postOwnerP1';
const db = env.authenticatedContext(uid).firestore();
const post = (categories = ['買い物']) => ({
  type: 'tsuide', title: 'カテゴリ検証', detail: '', categories, pref: '大阪府', area: '高槻市',
  when: '', anon: false, uid, authorName: 'テスト', createdAt: serverTimestamp(),
});
let count = 0;
async function check(name, fn) { await fn(); count++; console.log('PASS', name); }
try {
  await env.clearFirestore();
  await check('現行カテゴリの投稿を受け付ける', () => assertSucceeds(setDoc(doc(db, 'posts', 'valid-categories'), post())));
  await check('旧カテゴリの投稿も受け付ける', () => assertSucceeds(setDoc(doc(db, 'posts', 'legacy-category'), post(['貸し借り・共同作業']))));
  await check('カテゴリなしを受け付ける', () => assertSucceeds(setDoc(doc(db, 'posts', 'no-category'), post([]))));
  for (const [id, value] of [
    ['number-category', [42]], ['null-category', [null]], ['object-category', [{ label: '買い物' }]],
    ['mixed-category', ['買い物', 42]], ['category-not-list', '買い物'], ['unknown-category', ['<script>']]
  ]) {
    await check(id + ' を拒否する', () => assertFails(setDoc(doc(db, 'posts', id), post(value))));
  }
  await check('カテゴリ21件を拒否する', () => assertFails(setDoc(doc(db, 'posts', 'too-many-categories'), post(Array(21).fill('買い物')))));
  const unsafeId = "legacy');globalThis.injected=true;('";
  await check('コードを含む新規投稿IDを拒否する', () => assertFails(setDoc(doc(db, 'posts', unsafeId), post())));
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'posts', unsafeId), {
    ...post(), createdAt: Timestamp.now()
  }));
  await check('既存の特殊IDは本人が整理できる', async () => {
    await assertSucceeds(getDoc(doc(db, 'posts', unsafeId)));
    await assertSucceeds(updateDoc(doc(db, 'posts', unsafeId), { title: '安全に表示して整理' }));
    await assertSucceeds(deleteDoc(doc(db, 'posts', unsafeId)));
  });
  console.log(`${count} 件の P1 投稿スキーマ検証が通りました`);
} finally {
  await env.cleanup();
}
