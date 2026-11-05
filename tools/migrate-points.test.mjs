// 管理者移行の確認。Firestore Emulatorだけで実行する（本番接続を拒否）。
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {migrate} from './migrate-points.mjs';
const host=process.env.FIRESTORE_EMULATOR_HOST;
if(!host||!/^127\.0\.0\.1:\d+$|^localhost:\d+$/.test(host))
  throw new Error('ローカルFirestore Emulatorの指定が必要です。本番には接続しません。');
const project='demo-youi-migrate-points';
const app=initializeApp({projectId:project},project);
const db=getFirestore(app);
const auth={async listUsers(_limit,token){
  return token?{users:[{uid:'C'},{uid:'D'}]}:{users:[{uid:'A'},{uid:'B'}],pageToken:'next'};
}};
let checks=0;
const pass=name=>{checks++;console.log(`PASS ${name}`);};
try {
  const reset=await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
  assert.ok(reset.ok);
  await db.doc('config/pointsLedger').set({ready:false});
  await db.doc('users/A').set({name:'本人'});
  await db.doc('wallets/C').set({balance:123,version:1,lastTransfer:'existing',updatedAt:FieldValue.serverTimestamp()});
  await db.doc('pointsGrants/C').set({version:1,amount:300,createdAt:FieldValue.serverTimestamp()});
  await db.doc('wallets/D').set({balance:777,version:1,lastTransfer:'existing',updatedAt:FieldValue.serverTimestamp()});
  await db.doc('pointsGrants/D').set({version:1,amount:300,createdAt:FieldValue.serverTimestamp()});
  for(let i=0;i<4;i++) await db.doc(`thanks/old${i}`).set({fromUid:'A',toUid:'B',points:100,privacySafe:false});
  await db.doc('thanks/new').set({fromUid:'C',toUid:'D',points:100,ledgerVersion:1,privacySafe:true});
  const preview=await migrate(db,FieldValue,{auth});
  assert.equal(preview.created,0);assert.equal((await db.collection('wallets').get()).size,2);
  pass('既定dry-runはwalletを書かない');
  assert.equal(preview.authUsers,4);assert.equal(preview.balances.find(x=>x.uid==='B').balance,700);
  pass('usersが消えた既存Auth UIDも300＋旧台帳で一度だけ移行対象にする');
  assert.equal(preview.balances.find(x=>x.uid==='A').balance,-100);
  pass('匿名隔離済み感謝も計上し、旧負債を0に丸めない');
  assert.equal(preview.legacyCount,4);
  pass('新ledgerVersion1を旧残高へ二重計上しない');
  const applied=await migrate(db,FieldValue,{auth,apply:true});
  assert.equal(applied.created,2);assert.equal(applied.grantsCreated,2);
  assert.equal((await db.doc('wallets/A').get()).data().balance,-100);
  assert.equal((await db.doc('wallets/B').get()).data().balance,700);
  assert.equal((await db.doc('wallets/C').get()).data().balance,123);
  pass('移行時の作成は不足分だけで、既存walletを書き換えない');
  const again=await migrate(db,FieldValue,{auth,apply:true});
  assert.equal(again.created,0);assert.equal(again.grantsCreated,0);
  assert.equal((await db.doc('wallets/B').get()).data().balance,700);
  pass('同じ移行を再実行しても300ptを配り直さない');
  assert.equal((await db.doc('config/pointsLedger').get()).data().ready,false);
  pass('移行が終わっても自動で送金を再開しない');
  await db.doc('config/pointsLedger').set({ready:true});
  await assert.rejects(migrate(db,FieldValue,{auth,apply:true}),/送金稼働中/);
  pass('稼働中の移行は拒否');
  await assert.rejects(migrate(db,FieldValue),/全UID一覧/);
  pass('Auth全UIDのインベントリなしでは移行できない');
  await db.doc('config/pointsLedger').set({ready:false});
  await db.doc('wallets/A').delete();
  await assert.rejects(migrate(db,FieldValue,{auth}),/wallet.*欠落/);
  await assert.rejects(migrate(db,FieldValue,{auth,apply:true}),/wallet.*欠落/);
  assert.equal((await db.doc('wallets/A').get()).exists,false);
  assert.equal((await db.doc('wallets/B').get()).data().balance,700);
  pass('既存初回配布記録があるwalletの欠落はdry-runとapply両方で中止');
  await db.doc('wallets/A').set({balance:-100,version:1,lastTransfer:'',updatedAt:FieldValue.serverTimestamp()});
  await db.doc('wallets/D').delete();await db.doc('pointsGrants/D').delete();
  await assert.rejects(migrate(db,FieldValue,{auth,apply:true}),/wallet.*欠落/);
  assert.equal((await db.doc('wallets/D').get()).exists,false);
  pass('配布記録も欠落した新台帳の当事者は旧残高から再作成しない');
  await db.doc('wallets/D').set({balance:777,version:1,lastTransfer:'existing',updatedAt:FieldValue.serverTimestamp()});
  await db.doc('pointsGrants/D').set({version:1,amount:300,createdAt:FieldValue.serverTimestamp()});
  await db.doc('wallets/A').delete();await db.doc('pointsGrants/A').delete();
  // 読取り後に管理者が配布履歴だけを復元した場合も、各保存前の検証で止める。
  let intervened=false;
  const changedDb={doc:p=>db.doc(p),collection:p=>db.collection(p),runTransaction:async callback=>{
    if(!intervened){
      intervened=true;
      await db.doc('pointsGrants/A').set({version:1,amount:300,createdAt:FieldValue.serverTimestamp()});
    }
    return db.runTransaction(callback);
  }};
  await assert.rejects(migrate(changedDb,FieldValue,{auth,apply:true}),/wallet.*欠落/);
  assert.equal((await db.doc('wallets/A').get()).exists,false);
  pass('preflight後に配布記録が出現してもtransactionが再配布を拒否');
  console.log(`Points migration: ${checks} checks passed.`);
} finally {await db.terminate();await deleteApp(app);}
