(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YouiAuthSession = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // 同じUIDへの再ログインも別の操作として扱い、古い非同期結果を捨てる。
  function create(currentUid, isGuest) {
    var generation = 0;
    function capture() { return {generation:generation, uid:currentUid()}; }
    function invalidate() { generation++; }
    function begin() { invalidate(); return capture(); }
    function isCurrent(token) {
      return !!token && !!token.uid && token.generation === generation
        && token.uid === currentUid() && !isGuest();
    }
    return {begin:begin, capture:capture, invalidate:invalidate, isCurrent:isCurrent};
  }
  return {create:create};
});
