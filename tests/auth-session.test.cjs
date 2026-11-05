const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {create}=require('../auth-session.js');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
async function harness(){
  let callback, stored=null, ui=null, pending={}, subscriptions=[], timers=[], signOuts=[];
  const auth={currentUser:null,onAuthStateChanged:fn=>{callback=fn;},signOut:()=>{signOuts.push(auth.currentUser?.uid);return Promise.resolve();}};
  const guest={active:false};
  const session=create(()=>auth.currentUser?.uid,()=>guest.active);
  const ctx={fbReady:true,fbAuth:auth,authSession:session,signupInProgress:false,
    fbDb:{collection:()=>({doc:uid=>({get:()=>new Promise((resolve,reject)=>{(pending[uid]??=[]).push({resolve,reject});})})})},
    window:{},isGuestMode:()=>guest.active,
    clearRealAccountState:()=>{stored=null;ui=null;},
    setStoredUser:p=>{stored=p;},getStoredUser:()=>stored,applyUserToUI:()=>{ui=stored;},syncMyProfile:()=>{},
    subscribePosts:()=>subscriptions.push('posts'),subscribeConversations:()=>subscriptions.push('chat'),
    subscribeThanks:()=>subscriptions.push('thanks'),subscribeDeals:()=>subscriptions.push('deals'),subscribeDisaster:()=>{},
    subscribeWallet:()=>{},document:{querySelector:()=>({id:'screen-login'})},goScreen:()=>{},navTo:()=>{},
    setTimeout:fn=>timers.push(fn),toast:()=>{},console:{warn:()=>{}}};
  vm.createContext(ctx);
  const start=source.indexOf('if(fbReady){\n  fbAuth.onAuthStateChanged');
  const end=source.indexOf('/* ゲストモードで再読込',start);
  assert(start>=0&&end>start,'auth callback exists');
  vm.runInContext(source.slice(start,end),ctx);
  const login=uid=>{auth.currentUser=uid?{uid,email:uid+'@example.test',emailVerified:true}:null;callback(auth.currentUser);};
  const resolve=(uid,index=0)=>pending[uid][index].resolve({exists:true,data:()=>({type:'personal',name:uid,nickname:uid})});
  return {ctx,auth,guest,session,login,resolve,pending,subscriptions,timers,signOuts,
    notify:user=>callback(user),get stored(){return stored;},get ui(){return ui;}};
}
function loadActual(ctx,name,endMarker){
  const start=source.indexOf('function '+name+'(){');
  const end=source.indexOf(endMarker,start);
  assert(start>=0&&end>start,`${name} actual function exists`);
  vm.runInContext(source.slice(start,end),ctx);
}
async function signupCleanupTest(){
  const h=await harness(),messages=[],screens=[];
  let deleteCalls=0,profileWrites=0,verificationCalls=0;
  const input={
    'su-name':{value:'登録本人'},'su-nick':{value:'新しい利用者'},'su-email':{value:'new@example.test'},
    'su-pass':{value:'password123'},'su-pass2':{value:'password123'},'su-agree':{checked:true}
  };
  const user={uid:'NEW_SIGNUP',email:'new@example.test',emailVerified:false,
    delete:()=>{deleteCalls++;return Promise.reject(new Error('Auth cleanup rejected'));},
    sendEmailVerification:()=>{verificationCalls++;return Promise.resolve();}};
  h.auth.createUserWithEmailAndPassword=()=>{
    h.auth.currentUser=user;h.notify(user);return Promise.resolve({user});
  };
  h.auth.signOut=()=>{
    h.signOuts.push(h.auth.currentUser?.uid);h.auth.currentUser=null;h.notify(null);return Promise.resolve();
  };
  Object.assign(h.ctx,{
    accountType:'personal',firebase:{},sessionStorage:{removeItem:()=>{}},
    document:{getElementById:id=>input[id]||null,querySelector:()=>({id:'screen-signup'})},
    tooLong:()=>false,busy:()=>false,authErrMsg:e=>e.message,toast:m=>messages.push(m),
    goScreen:name=>screens.push(name),
    YouiPoints:{registerProfile:()=>{
      profileWrites++;return Promise.reject(new Error('Firestore profile save rejected'));
    }}
  });
  loadActual(h.ctx,'completeSignup','function backFromVerify');
  h.ctx.completeSignup();
  // callbackはAuth作成直後に動く。Firestore保存前のプロフィールUIは開かない。
  assert.equal(h.ctx.signupInProgress,true);assert.equal(h.pending.NEW_SIGNUP,undefined);
  assert.equal(h.ui,null);assert.equal(h.subscriptions.length,0);
  for(let i=0;i<40;i++)await Promise.resolve();
  assert.equal(profileWrites,1,`profile save attempted: ${messages.join(' | ')}`);
  assert.equal(deleteCalls,1,`Auth cleanup attempted: ${messages.join(' | ')}`);
  assert.equal(verificationCalls,0);
  assert.deepEqual(h.signOuts,['NEW_SIGNUP']);assert.equal(h.auth.currentUser,null);
  assert.equal(h.stored,null);assert.equal(h.ui,null);assert.equal(h.subscriptions.length,0);
  assert.equal(h.ctx.signupInProgress,false);assert.equal(screens.at(-1),'login');
  assert(messages.some(m=>m.includes('ログインを解除')),'cleanup failure is explained after logout');
}
async function emailChangeTest({modern=false,switchAccount=true}={}){
  const h=await harness(),messages=[];
  let finish,closed=0,requested;
  h.login('A');h.resolve('A');await tick();
  const pendingEmail=v=>{requested=v;return new Promise(resolve=>{finish=resolve;});};
  if(modern)h.auth.currentUser.verifyBeforeUpdateEmail=pendingEmail;
  else h.auth.currentUser.updateEmail=pendingEmail;
  Object.assign(h.ctx,{
    document:{getElementById:()=>({value:'a-new@example.test'}),querySelector:()=>({id:'screen-settings'})},
    closeSheet:()=>{closed++;},toast:m=>messages.push(m),authErrMsg:e=>e.message
  });
  loadActual(h.ctx,'saveEmailChange','/* パスワード変更 */');
  h.ctx.saveEmailChange();assert.equal(requested,'a-new@example.test');
  if(switchAccount){h.login('B');h.resolve('B');await tick();}
  finish();await tick();
  if(switchAccount){
    assert.equal(h.stored.uid,'B');assert.equal(h.stored.email,'B@example.test');
    assert.equal(h.ui.email,'B@example.test');assert.equal(closed,0);assert.equal(messages.length,0);
  }else{
    assert.equal(h.stored.uid,'A');assert.equal(h.stored.email,'a-new@example.test');
    assert.equal(closed,1);assert.equal(messages.length,1);
  }
}
(async()=>{
  let h=await harness();h.login('A');h.login(null);h.login('B');h.resolve('B');await tick();h.resolve('A');await tick();
  assert.equal(h.stored.uid,'B');assert.equal(h.ui.uid,'B');assert.equal(h.subscriptions.length,4);
  h=await harness();h.login('A');h.login(null);h.resolve('A');await tick();
  assert.equal(h.stored,null);assert.equal(h.subscriptions.length,0);
  h=await harness();h.login('A');h.login(null);h.login('A');h.resolve('A',1);await tick();
  const current=h.stored;h.resolve('A',0);await tick();assert.equal(h.stored,current);assert.equal(h.subscriptions.length,4);
  h=await harness();h.login('A');h.login(null);h.pending.A[0].reject(new Error('late failure'));await tick();
  assert.equal(h.subscriptions.length,0);
  h=await harness();h.login('A');h.guest.active=true;h.session.invalidate();h.ctx.window.__guest=true;
  h.resolve('A');await tick();assert.equal(h.stored,null);assert.equal(h.subscriptions.length,0);
  h=await harness();h.ctx.signupInProgress=true;h.login('NEW');await tick();
  assert.equal(h.pending.NEW,undefined);assert.equal(h.stored,null);assert.equal(h.subscriptions.length,0);
  h=await harness();h.login('MISSING');h.pending.MISSING[0].resolve({exists:false});await tick();
  assert.equal(h.stored,null);assert.equal(h.subscriptions.length,0);
  await signupCleanupTest();
  await emailChangeTest();
  await emailChangeTest({modern:true});
  await emailChangeTest({switchAccount:false});
  // 保存関数そのものも、別アカウントの結果の混入を拒否する。
  const data={};const ctx={currentProfile:null,fbAuth:{currentUser:{uid:'B'}},window:{},isGuestMode:()=>false,
    localStorage:{getItem:key=>data[key]??null,setItem:(key,value)=>{data[key]=value;}}};
  vm.createContext(ctx);
  const st=source.indexOf('function getStoredUser(){'),en=source.indexOf('function applyUserToUI(){',st);
  vm.runInContext(source.slice(st,en),ctx);
  assert.equal(ctx.setStoredUser({uid:'A',name:'A'}),false);
  assert.equal(ctx.setStoredUser({uid:'B',name:'B'}),true);
  ctx.fbAuth.currentUser={uid:'C'};assert.equal(ctx.getStoredUser(),null);
  console.log('OK auth/session: logout, B login, same UID relogin, late rejection, guest transition, stored-profile isolation, failed-signup cleanup, stale email-change isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});
