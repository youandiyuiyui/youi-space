// 旧版データの移行確認用。旧アプリは新ルールで匿名データにアクセスできないため、
// エミュレーターに旧スキーマのデータを管理者として用意し、現行アプリで検証する。
import { hookToasts, onMain, waitFor } from './common.mjs';

const ROOT='http://127.0.0.1:8080/v1/projects/you-i-space/databases/(default)/documents/';
function value(v){
  if(v instanceof Date) return {timestampValue:v.toISOString()};
  if(typeof v==='string') return {stringValue:v};
  if(typeof v==='boolean') return {booleanValue:v};
  if(typeof v==='number') return {integerValue:String(v)};
  if(Array.isArray(v)) return {arrayValue:{values:v.map(value)}};
  return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,value(x)]))}};
}
export async function adminFixture(path,data){
  const response=await fetch(ROOT+path,{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,value(v)]))})});
  if(!response.ok) throw new Error('旧データを準備できませんでした: '+response.status+' '+await response.text());
}
export async function legacyUser(page,name,email,password){
  const uid=await page.evaluate(async({email,password})=>{
    try{sessionStorage.setItem('youi_nick_prompted','1');}catch(e){}
    goScreen('signup');
    const cred=await fbAuth.createUserWithEmailAndPassword(email,password);
    return cred.user.uid;
  },{email,password});
  await adminFixture('users/'+uid,{type:'individual',name,email,createdAt:'2025-09-01T00:00:00Z',bio:''});
  await page.evaluate(()=>fbAuth.signOut());
  await page.reload();
  await hookToasts(page);
  await page.evaluate(({email,password})=>{document.getElementById('login-email').value=email;document.getElementById('login-pass').value=password;login();},{email,password});
  if(!await onMain(page)) throw new Error('旧データの利用者がログインできませんでした');
  await page.evaluate(()=>closeSheet());
  return uid;
}
export async function legacyPosts(uid,name){
  const common={uid,authorName:name,detail:'',categories:[],pref:'大阪府',area:'高槻市',when:'',createdAt:new Date()};
  const publicId='legacy-public-'+uid,anonId='legacy-anon-'+uid;
  await adminFixture('posts/'+publicId,{...common,type:'tsuide',title:'土曜に車を出せます',anon:false});
  await adminFixture('posts/'+anonId,{...common,type:'need',title:'通院の付き添いをお願いしたい',anon:true});
  return {publicId,anonId};
}
export async function anonRejected(page,title='匿名機能の停止を確認'){
  await page.evaluate(title=>{
    window.__toasts=[];openPostWith('need');
    document.getElementById('post-title').value=title;
    document.getElementById('post-anon').checked=true;
    submitPost();
  },title);
  return waitFor(page,()=>window.__toasts.some(t=>/(一時停止|整備中)/.test(t)));
}
