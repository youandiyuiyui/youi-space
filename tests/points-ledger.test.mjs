// 実際のFirestoreルールと送金helperをローカルエミュレーターで検証する。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,setDoc,updateDoc,deleteDoc,writeBatch,
  runTransaction,serverTimestamp,increment,Timestamp} from 'firebase/firestore';
import {computeOpeningBalances} from '../tools/migrate-points.mjs';
const require=createRequire(import.meta.url);
const points=require('../points-ledger.js');
const source=path.dirname(fileURLToPath(import.meta.url));
const env=await initializeTestEnvironment({projectId:'demo-youi-points',
  firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync(path.join(source,'..','firestore.rules'),'utf8')}});
const A='pointsAlice',B='pointsBob',C='pointsCarol';
const dbFor=uid=>env.authenticatedContext(uid).firestore();
const fieldValue={firestore:{FieldValue:{serverTimestamp,increment}}};
const thank=(toUid,amount=50)=>({toUid,toName:'ご近所の方',postId:'',dealId:'',
  pairKey:[A,toUid].sort().join('_'),disaster:false,tags:['安心できた'],note:'ありがとう',points:amount,
  privacySafe:true});
// Firebase compatの表面だけを包む。保存・再試行・ルール検証は実SDK/エミュレーター。
function compat(db){
  const wrap=ref=>({id:ref.id,real:ref,set:data=>setDoc(ref,data)});
  const wrapSnapshot=snap=>({exists:snap.exists(),data:()=>snap.data()});
  const writes=batch=>({set:(ref,data)=>batch.set(ref.real,data),update:(ref,data)=>batch.update(ref.real,data),commit:()=>batch.commit()});
  return {
    collection:name=>({doc:id=>wrap(id?doc(db,name,id):doc(collection(db,name)))}),
    batch:()=>writes(writeBatch(db)),
    runTransaction:callback=>runTransaction(db,tx=>callback({
      get:ref=>tx.get(ref.real).then(wrapSnapshot),
      set:(ref,data)=>tx.set(ref.real,data),update:(ref,data)=>tx.update(ref.real,data)
    }))
  };
}
async function seed(balance=100){
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore(),batch=writeBatch(db);
    for(const uid of [A,B,C]){
      batch.set(doc(db,'users',uid),{type:'personal',name:uid,nickname:uid,bio:'',createdAt:Timestamp.now()});
      batch.set(doc(db,'wallets',uid),{balance:uid===A?balance:300,version:1,lastTransfer:'',updatedAt:Timestamp.now()});
    }
    batch.set(doc(db,'config','pointsLedger'),{ready:true});
    batch.set(doc(db,'config','privacyMigration'),{ready:true});
    for(const other of [B,C]) batch.set(doc(db,'conversations',[A,other].sort().join('_')),
      {participants:[A,other],names:{[A]:'Alice',[other]:'ご近所'},lastMessage:'x',lastSender:A,
       privacySafe:true,masked:[],updatedAt:Timestamp.now()});
    await batch.commit();
  });
}
async function rawBalance(uid){
  let balance;await env.withSecurityRulesDisabled(async c=>{balance=(await getDoc(doc(c.firestore(),'wallets',uid))).data().balance;});
  return balance;
}
async function rawThanks(){
  let snapshot;await env.withSecurityRulesDisabled(async c=>{snapshot=await getDocs(collection(c.firestore(),'thanks'));});
  return snapshot;
}
let count=0;
async function test(name,body){
  await seed();await body();count++;console.log(`PASS ${name}`);
}
function rawTransfer(db,id,{amount=50,to=B,debit=amount,credit=amount,extraReceipt=false,includeReceipt=true}={}){
  const batch=writeBatch(db);
  batch.update(doc(db,'wallets',A),{balance:100-debit,lastTransfer:id,updatedAt:serverTimestamp()});
  batch.update(doc(db,'wallets',to),{balance:300+credit,lastTransfer:id,updatedAt:serverTimestamp()});
  const data={...thank(to,amount),fromUid:A,ledgerVersion:1,createdAt:serverTimestamp()};
  if(includeReceipt) batch.set(doc(db,'thanks',id),data);
  if(extraReceipt) batch.set(doc(db,'thanks',`${id}Other`),data);
  return batch.commit();
}
try {
  await test('helperの50pt送金は両walletと感謝を一体で保存',async()=>{
    const id=await points.send(compat(dbFor(A)),fieldValue,A,thank(B));
    assert.equal(await rawBalance(A),50);assert.equal(await rawBalance(B),350);
    const receipt=await getDoc(doc(dbFor(A),'thanks',id));assert.equal(receipt.data().ledgerVersion,1);
  });
  await test('同じ100ptを2タブから同時送金しても一方だけ成功',async()=>{
    const sent=await Promise.allSettled([
      points.send(compat(dbFor(A)),fieldValue,A,thank(B,100)),
      points.send(compat(dbFor(A)),fieldValue,A,thank(C,100))]);
    assert.equal(sent.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(await rawBalance(A),0);
    assert.equal((await rawBalance(A))+(await rawBalance(B))+(await rawBalance(C)),700);
    assert.equal((await rawThanks()).size,1);
  });
  await test('旧アプリのpositive thanks単独保存は拒否',()=>assertFails(setDoc(doc(dbFor(A),'thanks','old'),{
    ...thank(B),fromUid:A,createdAt:serverTimestamp()})));
  await test('walletだけを減らす迂回は拒否',()=>assertFails(updateDoc(doc(dbFor(A),'wallets',A),{
    balance:50,lastTransfer:'noThanks',updatedAt:serverTimestamp()})));
  await test('walletだけを増やす迂回は拒否',()=>assertFails(updateDoc(doc(dbFor(A),'wallets',A),{
    balance:150,lastTransfer:'noThanks',updatedAt:serverTimestamp()})));
  await test('感謝を保存せずwallet2件だけ変更する迂回は拒否',()=>assertFails(rawTransfer(dbFor(A),'noReceipt',{includeReceipt:false})));
  await test('送信者の引落不足を拒否',()=>assertFails(rawTransfer(dbFor(A),'wrongDebit',{debit:30})));
  await test('受信者への過剰加算を拒否',()=>assertFails(rawTransfer(dbFor(A),'wrongCredit',{credit:100})));
  await test('ひとつの引落に感謝2件を付ける迂回を拒否',()=>assertFails(rawTransfer(dbFor(A),'shared',{extraReceipt:true})));
  await test('残高を超える保存をSDK以外から組んでも拒否',async()=>{
    await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'wallets',A),{balance:30}));
    const db=dbFor(A),batch=writeBatch(db);
    batch.update(doc(db,'wallets',A),{balance:-20,lastTransfer:'over',updatedAt:serverTimestamp()});
    batch.update(doc(db,'wallets',B),{balance:350,lastTransfer:'over',updatedAt:serverTimestamp()});
    batch.set(doc(db,'thanks','over'),{...thank(B),fromUid:A,ledgerVersion:1,createdAt:serverTimestamp()});
    await assertFails(batch.commit());assert.equal(await rawBalance(A),30);assert.equal((await rawThanks()).size,0);
  });
  await test('相手の残高は読めない',()=>assertFails(getDoc(doc(dbFor(A),'wallets',B))));
  await test('v2会話の相手への送金も同じ残高制約で使える',async()=>{
    await env.withSecurityRulesDisabled(async c=>{
      const db=c.firestore(),pair=[A,B].sort().join('_');
      await deleteDoc(doc(db,'conversations',pair));
      await setDoc(doc(db,'conversations','v2_'+pair),{participants:[A,B],privacySafe:true,masked:[]});
    });
    await points.send(compat(dbFor(A)),fieldValue,A,thank(B,50));assert.equal(await rawBalance(A),50);
  });
  await test('旧匿名pairに安全なv2フラグを偽装しても0pt・50ptとも拒否',async()=>{
    await env.withSecurityRulesDisabled(async c=>{
      const db=c.firestore(),pair=[A,B].sort().join('_');
      await setDoc(doc(db,'conversations',pair),{participants:[A,B],privacySafe:false,masked:[B]});
      await setDoc(doc(db,'conversations','v2_'+pair),{participants:[A,B],privacySafe:true,masked:[]});
    });
    await assertFails(points.send(compat(dbFor(A)),fieldValue,A,thank(B,0)));
    await assertFails(points.send(compat(dbFor(A)),fieldValue,A,thank(B,50)));
    assert.equal(await rawBalance(A),100);assert.equal(await rawBalance(B),300);
    assert.equal((await rawThanks()).size,0);
  });
  await test('匿名履歴の移行完了前は通常会話でも感謝・送金を拒否',async()=>{
    await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'config','privacyMigration'),{ready:false}));
    await assertFails(points.send(compat(dbFor(A)),fieldValue,A,thank(B,0)));
    await assertFails(points.send(compat(dbFor(A)),fieldValue,A,thank(B,50)));
    assert.equal(await rawBalance(A),100);assert.equal((await rawThanks()).size,0);
  });
  await test('送金済みの感謝IDの再使用で二重引落をしない',async()=>{
    const db=dbFor(A),id=await points.send(compat(db),fieldValue,A,thank(B,50));
    await assertFails(rawTransfer(db,id));assert.equal(await rawBalance(A),50);assert.equal((await rawThanks()).size,1);
  });
  await test('wallet削除は禁止',()=>assertFails(deleteDoc(doc(dbFor(A),'wallets',A))));
  await test('旧users.pointsの変更は禁止',()=>assertFails(updateDoc(doc(dbFor(A),'users',A),{points:0})));
  await test('0pt感謝はwallet未移行でも使える',async()=>{
    await env.withSecurityRulesDisabled(async c=>{
      await deleteDoc(doc(c.firestore(),'wallets',A));await deleteDoc(doc(c.firestore(),'wallets',B));
      await setDoc(doc(c.firestore(),'config','pointsLedger'),{ready:false});
    });
    await points.send(compat(dbFor(A)),fieldValue,A,thank(B,0));assert.equal((await rawThanks()).size,1);
  });
  await test('正の送金は移行完了設定前にはできない',async()=>{
    await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'config','pointsLedger'),{ready:false}));
    await assert.rejects(points.send(compat(dbFor(A)),fieldValue,A,thank(B)),{code:'points/not-ready'});
    await assertFails(rawTransfer(dbFor(A),'notReady'));
  });
  await test('旧匿名会話の相手には0ptでも新しいUIDリンクを作れない',async()=>{
    await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'conversations',[A,B].sort().join('_')),
      {participants:[A,B],masked:[B],privacySafe:false}));
    await assertFails(points.send(compat(dbFor(A)),fieldValue,A,thank(B,0)));
    await assertFails(points.send(compat(dbFor(A)),fieldValue,A,thank(B,50)));
    assert.equal((await rawThanks()).size,0);
  });
  await test('未移行ユーザーに300ptを勝手に再配布できない',async()=>{
    await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),'wallets',A)));
    await assertFails(setDoc(doc(dbFor(A),'wallets',A),{balance:300,version:1,lastTransfer:'',updatedAt:serverTimestamp()}));
  });
  await test('初回登録はusersとwallet300を同時作成する',async()=>{
    const uid='newPointsUser';
    await points.registerProfile(compat(dbFor(uid)),fieldValue,uid,{type:'personal',name:'本人',nickname:'ご近所',bio:''});
    assert.equal(await rawBalance(uid),300);
    await assertFails(deleteDoc(doc(dbFor(uid),'pointsGrants',uid)));
  });
  await test('移行凍結中は新規300pt配布も止まる',async()=>{
    await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'config','pointsLedger'),{ready:false}));
    const uid='duringMigration';
    await assertFails(points.registerProfile(compat(dbFor(uid)),fieldValue,uid,{type:'personal',name:'本人',nickname:'ご近所',bio:''}));
  });
  await test('usersだけ消して再登録してもwallet300を再発行できない',async()=>{
    await deleteDoc(doc(dbFor(A),'users',A));
    await assertFails(points.registerProfile(compat(dbFor(A)),fieldValue,A,{type:'personal',name:'本人',nickname:'ご近所',bio:''}));
    assert.equal(await rawBalance(A),100);
  });
  await test('負残高の旧ユーザーへ届いた分は負債を先に埋める',async()=>{
    await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'wallets',B),{balance:-70}));
    await points.send(compat(dbFor(A)),fieldValue,A,thank(B,50));assert.equal(await rawBalance(B),-20);
  });
  const converted=computeOpeningBalances([A,B],[
    {id:'old1',data:{fromUid:A,toUid:B,points:100}},
    {id:'old2',data:{fromUid:A,toUid:B,points:100}},
    {id:'old3',data:{fromUid:A,toUid:B,points:100}},
    {id:'old4',data:{fromUid:A,toUid:B,points:100}},
    {id:'new',data:{fromUid:B,toUid:A,points:100,ledgerVersion:1}}]);
  assert.equal(converted.balances.get(A),-100);assert.equal(converted.balances.get(B),700);
  assert.equal(converted.legacyCount,4);
  assert.throws(()=>computeOpeningBalances([A],[{id:'bad',data:{fromUid:A,toUid:B,points:-100}}]));
  count++;console.log('PASS 移行は旧負残高を保持して新台帳を二重計上しない');
  console.log(`Points P1: ${count} checks passed.`);
} finally {await env.cleanup();}
