// 管理者専用。既定は確認だけで、--apply が無ければ何も保存しない。
// 新ルール反映後、config/pointsLedger.ready=false の間に実行する。
import { pathToFileURL } from 'node:url';

export function computeOpeningBalances(userIds, receipts) {
  const balances=new Map(userIds.map(uid=>[uid,300]));
  let legacyCount=0;
  for(const receipt of receipts){
    const t=receipt.data;
    if(!t||typeof t.fromUid!=='string'||!t.fromUid||typeof t.toUid!=='string'||!t.toUid
      ||t.fromUid===t.toUid||![0,30,50,100].includes(t.points))
      throw new Error(`感謝 ${receipt.id} の形式を確認してください。移行を中止しました。`);
    if(t.ledgerVersion!==undefined&&![0,1].includes(t.ledgerVersion))
      throw new Error(`感謝 ${receipt.id} の台帳版が未対応です。移行を中止しました。`);
    if(t.ledgerVersion===1) continue; // 新台帳の手渡しをもう一度計上しない。
    legacyCount++;
    if(balances.has(t.fromUid)) balances.set(t.fromUid,balances.get(t.fromUid)-t.points);
    if(balances.has(t.toUid)) balances.set(t.toUid,balances.get(t.toUid)+t.points);
  }
  for(const [uid,balance] of balances){
    if(!Number.isSafeInteger(balance)||Math.abs(balance)>1e12)
      throw new Error(`${uid} の残高が移行範囲を超えています。`);
  }
  return {balances,legacyCount};
}

export async function migrate(db,fieldValue,{apply=false,auth}={}) {
  if(!auth||typeof auth.listUsers!=='function')
    throw new Error('既存Firebase Authの全UID一覧が必要です。usersだけを移行して初回配布を再発行することはできません。');
  const settings=db.doc('config/pointsLedger');
  const state=await settings.get();
  if(!state.exists||state.data().ready!==false)
    throw new Error('先に config/pointsLedger を {ready:false} にしてください。送金稼働中の移行はできません。');
  const authIds=[];
  let page;
  do {
    page=await auth.listUsers(1000,page&&page.pageToken);
    for(const user of page.users) authIds.push(user.uid);
  } while(page.pageToken);
  const [users,thanks,wallets,grants]=await Promise.all([
    db.collection('users').get(),db.collection('thanks').get(),db.collection('wallets').get(),db.collection('pointsGrants').get()
  ]);
  const allIds=Array.from(new Set(authIds.concat(users.docs.map(d=>d.id))));
  const {balances,legacyCount}=computeOpeningBalances(allIds,
    thanks.docs.map(d=>({id:d.id,data:d.data()})));
  const existing=new Map(wallets.docs.map(d=>[d.id,d.data()]));
  for(const grant of grants.docs){
    if(grant.data().version!==1||grant.data().amount!==300)
      throw new Error(`${grant.id} の初回配布記録を確認してください。上書きはしません。`);
  }
  const existingGrants=new Set(grants.docs.map(d=>d.id));
  const v1Participants=new Set();
  for(const receipt of thanks.docs){
    const t=receipt.data();
    if(t.ledgerVersion===1&&t.points>0){
      v1Participants.add(t.fromUid);v1Participants.add(t.toUid);
    }
  }
  // 新台帳開始後のwallet欠落は部分復元等の不整合。旧台帳から復元すると
  // 新しい引落を消してしまうため、残高を推測せず、保存前に全件中止する。
  for(const uid of new Set([...existingGrants,...v1Participants])){
    if(!existing.has(uid))
      throw new Error(`${uid} のwalletが初回配布記録または新台帳に対して欠落しています。再配布せず移行を中止します。`);
  }
  let skipped=0,created=0,grantsCreated=0;
  const planned=[],debt=[],grantOnly=[];
  for(const [uid,balance] of balances){
    const current=existing.get(uid);
    if(current){
      if(current.version!==1||!Number.isSafeInteger(current.balance)||Math.abs(current.balance)>1e12)
        throw new Error(`${uid} の既存walletを確認してください。上書きはしません。`);
      skipped++;
      if(current.balance<0) debt.push({uid,balance:current.balance});
      if(!existingGrants.has(uid)) grantOnly.push({uid,balance:current.balance});
      continue;
    }
    planned.push({uid,balance});
    if(balance<0) debt.push({uid,balance});
  }
  if(apply){
    for(const item of planned.concat(grantOnly)){
      const made=await db.runTransaction(async tx=>{
        const wallet=db.doc(`wallets/${item.uid}`);
        const grant=db.doc(`pointsGrants/${item.uid}`);
        const [config,old,oldGrant]=await Promise.all([tx.get(settings),tx.get(wallet),tx.get(grant)]);
        if(!config.exists||config.data().ready!==false)
          throw new Error('移行中に送金設定が変わりました。中止します。');
        if(!old.exists&&(oldGrant.exists||v1Participants.has(item.uid)))
          throw new Error(`${item.uid} のwalletが新台帳に対して欠落しています。再配布せず移行を中止します。`);
        if(!old.exists) tx.create(wallet,{balance:item.balance,version:1,lastTransfer:'',updatedAt:fieldValue.serverTimestamp()});
        if(!oldGrant.exists) tx.create(grant,{version:1,amount:300,createdAt:fieldValue.serverTimestamp(),source:'legacy-migration'});
        return {wallet:!old.exists,grant:!oldGrant.exists};
      });
      if(made.wallet) created++;
      if(made.grant) grantsCreated++;
    }
  }
  // 負残高は負のまま記録する。0への丸め・300ptの再配布はしない。
  // ready=trueの切替も自動で行わない。管理者が件数と負残高を確認する。
  return {mode:apply?'apply':'dry-run',authUsers:authIds.length,legacyCount,planned:planned.length,
    created,grantsCreated,grantOnly:grantOnly.length,skipped,debt,balances:planned};
}

async function main(){
  const args=process.argv.slice(2);
  const projectAt=args.indexOf('--project');
  const project=projectAt>=0?args[projectAt+1]:'';
  const apply=args.includes('--apply');
  if(!project||project.startsWith('--')) throw new Error('--project に対象のFirebaseプロジェクトを明示してください。');
  if(apply&&!process.env.FIRESTORE_EMULATOR_HOST&&!args.includes('--allow-production'))
    throw new Error('本番への保存は --apply --allow-production の両方が必要です。まず確認だけ実行してください。');
  const {initializeApp,applicationDefault,deleteApp}=await import('firebase-admin/app');
  const {getFirestore,FieldValue}=await import('firebase-admin/firestore');
  const {getAuth}=await import('firebase-admin/auth');
  const app=initializeApp(process.env.FIRESTORE_EMULATOR_HOST?{projectId:project}:{projectId:project,credential:applicationDefault()});
  const db=getFirestore(app);
  try{console.log(JSON.stringify(await migrate(db,FieldValue,{apply,auth:getAuth(app)}),null,2));}
  finally{await db.terminate();await deleteApp(app);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
