/* 投稿・支え合いのIDは実行するコードに入れず、データとして渡す。過去の不正なカテゴリも無視して描画する。 */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.YouiPostSafety=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var bindings=new WeakMap();
  function escapeAttribute(value){
    return String(value).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function actionAttrs(action,postId){
    return ' data-post-action="'+escapeAttribute(action)+'" data-post-id="'+
      escapeAttribute(encodeURIComponent(String(postId)))+'"';
  }
  function categories(value){
    if(!Array.isArray(value)) return [];
    return value.filter(function(c){ return typeof c==='string'&&c.length>0; }).slice(0,20);
  }
  function bind(doc,handlers){
    var binding=bindings.get(doc);
    if(binding){ binding.handlers=handlers; return; }
    binding={handlers:handlers};
    bindings.set(doc,binding);
    // シートは背面へのクリックをstopPropagationするので、その手前で操作を受け取る。
    doc.addEventListener('click',function(event){
      var target=event.target;
      if(target&&target.nodeType!==1) target=target.parentElement;
      var el=target&&target.closest?target.closest('[data-post-action][data-post-id]'):null;
      if(!el||!doc.documentElement.contains(el)) return;
      var action=el.getAttribute('data-post-action');
      if(!Object.prototype.hasOwnProperty.call(binding.handlers,action)) return;
      var handler=binding.handlers[action];
      if(typeof handler!=='function') return;
      var id;
      try{ id=decodeURIComponent(el.getAttribute('data-post-id')); }catch(e){ return; }
      event.preventDefault();
      handler(id,el,event);
    },true);
  }
  return {actionAttrs:actionAttrs,categories:categories,bind:bind};
});
