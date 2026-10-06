/* ＆ポイント：残高と感謝を一度の保存で確定する。Firebase compat SDK 用。 */
(function(root, factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.YouiPoints=factory();
})(typeof globalThis!=='undefined'?globalThis:this, function(){
  'use strict';
  var CHOICES=[0,30,50,100];
  function fail(code,message){ var e=new Error(message); e.code=code; return e; }
  function balanceOf(snapshot){
    var data=snapshot&&snapshot.exists?snapshot.data():null;
    return data&&data.version===1&&Number.isSafeInteger(data.balance)?data.balance:null;
  }
  // 300ptは初回登録だけ。ルールも新規usersの同時作成を必須にする。
  // 既存ユーザーの残高は管理者による移行で作り、ブラウザから初期化しない。
  function registerProfile(db,firebase,uid,profile){
    var stamp=firebase.firestore.FieldValue.serverTimestamp();
    var batch=db.batch();
    batch.set(db.collection('users').doc(uid),Object.assign({},profile,{createdAt:stamp}));
    batch.set(db.collection('wallets').doc(uid),{
      balance:300,version:1,lastTransfer:'',updatedAt:stamp
    });
    batch.set(db.collection('pointsGrants').doc(uid),{version:1,amount:300,createdAt:stamp});
    return batch.commit();
  }
  function send(db,firebase,uid,thank){
    var points=thank.points;
    if(!uid||typeof thank.toUid!=='string'||!thank.toUid||thank.toUid===uid)
      return Promise.reject(fail('points/invalid-recipient','相手が特定できません'));
    if(CHOICES.indexOf(points)<0)
      return Promise.reject(fail('points/invalid-amount','＆ポイントを選び直してください'));
    // 再試行しても同じ1件だけ。txの中でUI操作やID生成をしない。
    var receipt=db.collection('thanks').doc();
    var data=Object.assign({},thank,{
      fromUid:uid,ledgerVersion:1,privacySafe:true,createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    if(points===0) return receipt.set(data).then(function(){return receipt.id;});
    var sender=db.collection('wallets').doc(uid);
    var receiver=db.collection('wallets').doc(thank.toUid);
    var readiness=db.collection('config').doc('pointsLedger');
    return db.runTransaction(function(tx){
      return Promise.all([tx.get(sender),tx.get(readiness)]).then(function(snapshots){
        var balance=balanceOf(snapshots[0]);
        if(!snapshots[1].exists||snapshots[1].data().ready!==true)
          throw fail('points/not-ready','＆ポイントを確認中です。0ptでも贈れます');
        if(balance===null) throw fail('points/not-ready','＆ポイントを確認中です。0ptでも贈れます');
        if(balance<points) throw fail('points/insufficient','＆ポイントが足りません。0ptでも贈れます');
        var stamp=firebase.firestore.FieldValue.serverTimestamp();
        tx.update(sender,{balance:balance-points,lastTransfer:receipt.id,updatedAt:stamp});
        // 相手の残高は読まない。ルールが加算額と同時保存を検証する。
        tx.update(receiver,{
          balance:firebase.firestore.FieldValue.increment(points),
          lastTransfer:receipt.id,updatedAt:stamp
        });
        tx.set(receipt,data);
      });
    }).then(function(){return receipt.id;});
  }
  return {balanceOf:balanceOf,registerProfile:registerProfile,send:send};
});
