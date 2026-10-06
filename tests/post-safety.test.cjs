// 実際の投稿レンダーとクリック処理を使う。Firebase や公開アプリには接続しない。
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const safety=require('../post-safety.js');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function appFunction(name){
  const start=source.indexOf('function '+name+'(');
  assert.notEqual(start,-1,'app function exists: '+name);
  const line=source.slice(start,source.indexOf('\n',start));
  if(line.endsWith('}')) return line;
  const end=source.indexOf('\n}',start);
  assert.notEqual(end,-1,'app function closes: '+name);
  return source.slice(start,end+2);
}
class Element{
  constructor(attrs={},parent=null){ this.attrs=attrs; this.parentElement=parent; this.nodeType=1; this.style={}; this.innerHTML=''; this.textContent=''; this.classList={contains:()=>false}; }
  getAttribute(name){ return this.attrs[name]??null; }
  closest(){ return this.attrs['data-post-action']?this:(this.parentElement?this.parentElement.closest():null); }
}
const elements={};
const listeners={};
const doc={
  documentElement:{contains:()=>true},
  getElementById(id){ return elements[id]||(elements[id]=new Element()); },
  addEventListener(type,callback){ listeners[type]=callback; }
};
const called=[];
const ctx=vm.createContext({
  YouiPostSafety:safety,document:doc,window:{},globalThis:null,
  POST_TYPES:{share:{label:'おすそわけ',cls:'share',color:'lav'},tsuide:{label:'ついで',cls:'tsuide',color:'sky'},can:{label:'できること札',cls:'can',color:'green'},need:{label:'困っていること',cls:'need',color:'pink'}},
  fbReady:false,fbAuth:{currentUser:null},currentProfile:null,DEMO_ME:'mine',
  curRegion:'all',curCat:'all',curArea:'',mapInited:false,
  isGuestDemo:()=>true,isBlocked:()=>false,postLatLng:()=>null,timeAgo:()=> 'たった今',
  openSheet:(title,html)=>{ ctx.sheet={title,html}; },
  closeSheet:()=>{},navTo:()=>{},toast:()=>{},
  openPostAuthorProfile:id=>called.push(['profile',id]),
  messageFromPost:id=>called.push(['message',id]),
  reportPost:id=>called.push(['report',id]),
  demoProfilePost:id=>called.push(['demo-profile',id]),
  demoMessageFromPost:id=>called.push(['demo-message',id]),
  saveEditPost:id=>called.push(['save-edit',id]),
  doDeletePost:id=>called.push(['delete',id]),
  getStoredUser:()=>({uid:'mine'}),
  openDeals:()=>ctx.window.__deals||[],
  skipThanks:(id,to)=>called.push(['skip-thanks',id,to]),
  openThanks:(uid,name,postId,dealId)=>called.push(['thanks',uid,name,postId,dealId]),
  openConversation:(...args)=>called.push(['conversation',...args]),
  colorForUid:()=> 'lav',honorific:()=> ' さん',chatTime:()=> '今',ANON_NAME:'ご近所の方',
  prefOptions:()=>'<option value=""></option>',editType:'can',__attacked:0
});
ctx.globalThis=ctx;
const names=['normType','typeInfo','typeBadge','typeColor','postAuthor','escapeHtml','catTokens','isMyPost','myCardList','renderMyCards','renderNeedList','renderYuiLists','renderPostCard','renderLivePosts','openPostDetail','openMyPosts','renderMyPosts','editPost','confirmDeletePost','otherOf','openGateSheet','skipThanksForDeal','thankForDeal','renderConvList','openConvById'];
names.forEach(name=>vm.runInContext(appFunction(name),ctx));
const binder=source.match(/YouiPostSafety\.bind\(document,\{[\s\S]*?\n\}\);/);
assert.ok(binder,'app installs the delegated click handlers');
assert.ok(source.indexOf('<script src="post-safety.js"></script>')<source.indexOf(binder[0]),'helper loads before handlers');
vm.runInContext(binder[0],ctx);
function decoded(value){ return value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'); }
function actionElements(html){
  return [...html.matchAll(/<[^>]+data-post-action="[^>]+>/g)].map(match=>{
    const attrs={};
    for(const a of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]]=decoded(a[2]);
    assert.ok(!attrs.onclick,'generated action has no executable onclick');
    return new Element(attrs);
  });
}
function click(el){
  let prevented=false;
  // SVGやラベルのような子要素をクリックしても、同じ投稿IDが届く。
  listeners.click({target:new Element({},el),preventDefault(){prevented=true;}});
  assert.ok(prevented,'click is routed');
}
const badId="x');globalThis.__attacked++;openPostDetail('ordinary-id";
const bad={id:badId,type:'tsuide',uid:'other',authorName:'投稿者',title:'不正カテゴリの投稿',detail:'説明',pref:'大阪府',area:'高槻市',categories:[42,null,{},'買い物','話し相手']};
const good={id:'ordinary-id',type:'tsuide',uid:'other',authorName:'投稿者',title:'正常な投稿',categories:['通院付き添い']};
ctx.window.__rawPosts=[bad,good];
ctx.renderLivePosts();
assert.equal(elements['live-count'].textContent,'2');
assert.ok(elements['live-posts'].innerHTML.includes('正常な投稿'));
assert.ok(elements['live-posts'].innerHTML.includes('買い物'));
assert.ok(!elements['live-posts'].innerHTML.includes('[object Object]'));
const cards=actionElements(elements['live-posts'].innerHTML);
assert.equal(cards.length,2,'malformed categories do not stop later cards');
assert.equal(decodeURIComponent(cards[0].getAttribute('data-post-id')),badId);
click(cards[0]);
assert.equal(ctx.sheet.title,'ついで');
assert.ok(ctx.sheet.html.includes('不正カテゴリの投稿'),'original ID opens the intended post');
const actions=actionElements(ctx.sheet.html);
assert.equal(actions.length,2);
actions.forEach(click);
assert.deepEqual(called,[['demo-profile',badId],['demo-message',badId]]);
assert.equal(ctx.__attacked,0,'the ID never executes');
for(const categories of [[42],{},'not a list',null,undefined]){
  ctx.window.__rawPosts=[{...bad,categories},good];
  assert.doesNotThrow(()=>ctx.renderLivePosts());
  assert.equal(elements['live-count'].textContent,'2');
  assert.ok(elements['live-posts'].innerHTML.includes('正常な投稿'));
  assert.doesNotThrow(()=>ctx.openPostDetail(badId));
}
ctx.window.__posts={};
ctx.window.__posts[badId]={...bad,uid:'mine',type:'can'};
ctx.renderMyCards();
assert.deepEqual(actionElements(elements['my-cards'].innerHTML).map(e=>e.getAttribute('data-post-action')),['edit','confirm-delete']);
ctx.window.__needPosts=[{...bad,type:'need'}];
ctx.renderNeedList();
assert.equal(decodeURIComponent(actionElements(elements['need-list'].innerHTML)[0].getAttribute('data-post-id')),badId);
ctx.renderYuiLists();
assert.equal(decodeURIComponent(actionElements(elements['yui-can-list'].innerHTML)[0].getAttribute('data-post-id')),badId);
ctx.openPostDetail(badId);
assert.deepEqual(actionElements(ctx.sheet.html).map(e=>e.getAttribute('data-post-action')),['edit','confirm-delete']);
ctx.editPost(badId);
click(actionElements(ctx.sheet.html)[0]);
ctx.confirmDeletePost(badId);
click(actionElements(ctx.sheet.html)[0]);
assert.deepEqual(called.slice(-2),[['save-edit',badId],['delete',badId]]);
assert.equal(ctx.__attacked,0);
const badName="相手');globalThis.__attacked++;('名前";
ctx.window.__deals=[{id:badId,participants:['mine','other'],byUid:'other',byName:badName,title:'支え合い'}];
ctx.openGateSheet();
const dealActions=actionElements(ctx.sheet.html);
assert.deepEqual(dealActions.map(e=>e.getAttribute('data-post-action')),['skip-deal-thanks','thank-for-deal']);
dealActions.forEach(click);
assert.deepEqual(called.slice(-2),[['skip-thanks',badId,'other'],['thanks','other',badName,'',badId]]);
assert.equal(ctx.__attacked,0,'deal IDs and partner names stay data');
for(const name of ['renderNeedList','renderMyCards','renderYuiLists','renderPostCard','openPostDetail','openMyPosts','renderMyPosts','editPost','confirmDeletePost','renderConvList']){
  assert.ok(!/onclick=[^\n]*\+(?:p\.id|id)\+/.test(appFunction(name)),name+' never places IDs in executable strings');
}
assert.deepEqual(safety.categories(['貸し借り・共同作業','未登録の旧カテゴリ',42,'']),['貸し借り・共同作業','未登録の旧カテゴリ']);
for(const id of ['" autofocus onfocus="globalThis.__attacked++','<img src=x onerror="globalThis.__attacked++">','日本語\r\n\t&%\\'] ){
  const el=actionElements('<button'+safety.actionAttrs('demo-message',id)+'>試験</button>')[0];
  click(el);
  assert.equal(called.at(-1)[1],id,'special characters keep their exact ID');
  assert.equal(ctx.__attacked,0);
}
// openMyPostsの新しいラッパーも、実際のrenderMyPostsに接続して検証する。
ctx.window.__posts[badId]={...bad,uid:'mine',type:'need',anon:false};
ctx.openMyPosts();
assert.equal(ctx.sheet.title,'自分の投稿');
let managed=actionElements(ctx.sheet.html);
assert.deepEqual(managed.map(e=>e.getAttribute('data-post-action')),['edit','confirm-delete']);
assert.equal(decodeURIComponent(managed[0].getAttribute('data-post-id')),badId);
click(managed[0]);
assert.equal(ctx.sheet.title,'投稿を編集');
assert.equal(actionElements(ctx.sheet.html)[0].getAttribute('data-post-action'),'save-edit');

// 実アカウントの旧匿名投稿は、編集・メッセージの代わりに非公開確認と削除だけ。
ctx.isGuestDemo=()=>false;
ctx.fbReady=true;ctx.fbAuth.currentUser={uid:'mine'};
ctx.window.__posts[badId]={...bad,uid:'mine',type:'need',anon:true};
ctx.renderMyPosts([ctx.window.__posts[badId]]);
managed=actionElements(ctx.sheet.html);
assert.deepEqual(managed.map(e=>e.getAttribute('data-post-action')),['open','confirm-delete']);
click(managed[0]);
assert.ok(ctx.sheet.html.includes('公開せず保管'));
assert.deepEqual(actionElements(ctx.sheet.html).map(e=>e.getAttribute('data-post-action')),['confirm-delete']);
ctx.window.__posts[badId]={...bad,uid:'other',anon:false};
ctx.openPostDetail(badId);
const realActions=actionElements(ctx.sheet.html);
assert.deepEqual(realActions.map(e=>e.getAttribute('data-post-action')),['profile','message','report']);
realActions.forEach(click);
assert.deepEqual(called.slice(-3),[['profile',badId],['message',badId],['report',badId]]);

// 同じ相手の会話が複数あっても、押した行のIDがそのまま選ばれる。
const oldCid='older_'+badId,newCid='v2_'+badId;
ctx.window.__rawConvs=[
  {id:oldCid,participants:['mine','other'],names:{other:'以前の会話'},masked:[],lastMessage:'以前の本文'},
  {id:newCid,participants:['mine','other'],names:{other:'新しい会話'},masked:[],lastMessage:'新しい本文'}
];
ctx.renderConvList();
const conversations=actionElements(elements['conv-list'].innerHTML);
assert.equal(conversations.length,2);
conversations.forEach(click);
assert.equal(called.at(-2)[2],'以前の会話');
assert.equal(called.at(-2)[5],oldCid);
assert.equal(called.at(-1)[2],'新しい会話');
assert.equal(called.at(-1)[5],newCid);
assert.equal(ctx.__attacked,0);
for(const names of [{other:42},{other:{}},42,null,['名前']]){
  ctx.window.__rawConvs=[
    {id:oldCid,participants:['mine','other'],names,masked:[],lastMessage:'不正な表示名'},
    {id:newCid,participants:['mine','other'],names:{other:'正常な相手'},masked:[],lastMessage:'正常な会話'}
  ];
  assert.doesNotThrow(()=>ctx.renderConvList(),'malformed partner names do not stop the conversation list');
  assert.equal(actionElements(elements['conv-list'].innerHTML).length,2);
  assert.ok(elements['conv-list'].innerHTML.includes('利用者 さん'));
  assert.ok(elements['conv-list'].innerHTML.includes('正常な会話'));
  assert.ok(elements['conv-list'].innerHTML.includes('正常な相手 さん'));
}
console.log('OK post safety: injection IDs stay data; malformed categories preserve cards; own-post and conversation actions route correctly');
