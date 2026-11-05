// 匿名の経路を残さないよう、明確に通常会話と分かる旧データだけを公開対象に戻す。
// このモジュールはデータベースに接続せず、移行の判断だけを行う。
export const ANONYMOUS_NAME = 'ご近所の方';
export function pairId(a, b) { return [a, b].sort().join('_'); }
function validPair(p) {
  return Array.isArray(p) && p.length === 2 && p[0] !== p[1]
    && p.every(x => typeof x === 'string' && x.length > 0 && !x.includes('_'));
}
function named(v) { return typeof v === 'string' && v.trim().length > 0 && v.length <= 60 && v !== ANONYMOUS_NAME; }
function visibleConversation({ id, data: d }) {
  return validPair(d.participants) && [pairId(...d.participants), 'v2_' + pairId(...d.participants)].includes(id)
    && d.privacySafe !== false
    && (!('masked' in d) || (Array.isArray(d.masked) && d.masked.length === 0))
    && d.names && !Array.isArray(d.names) && typeof d.names === 'object'
    && Object.keys(d.names).length === 2
    && d.participants.every(uid => named(d.names[uid]));
}

export function planPrivacyMigration({ posts = [], conversations = [], deals = [], thanks = [] }) {
  // 旧unsafe/tombstoneの同じ二人でv2を作っても、本人の同意なく公開へ昇格させない。
  const blockedLegacyPairs = new Set(conversations.filter(c => {
    const parts = c.id.split('_');
    return validPair(parts) && pairId(...parts) === c.id && !visibleConversation(c);
  }).map(c => c.id));
  const safeConversations = conversations.filter(c => visibleConversation(c)
    && !(c.id.startsWith('v2_') && blockedLegacyPairs.has(pairId(...c.data.participants))));
  const safeIds = new Set(safeConversations.map(c => c.id));
  const safePairs = new Set(safeConversations.map(c => pairId(...c.data.participants)));
  const unsafePairs = new Set(conversations.filter(c => !safeIds.has(c.id) && validPair(c.data.participants))
    .map(c => pairId(...c.data.participants)));
  const anonymousPosts = new Set(posts.filter(p => p.data.anon !== false).map(p => p.id));
  const result = [];
  for (const p of posts) {
    if (anonymousPosts.has(p.id)) result.push({ collection: 'posts', ...p, safe: false, reason: 'legacy-anonymous-post', mark: false });
  }
  for (const c of conversations) {
    result.push({ collection: 'conversations', ...c, safe: safeIds.has(c.id), reason: safeIds.has(c.id) ? '' : 'anonymous-or-unproven-conversation', mark: true });
  }
  for (const d of deals) {
    const p = d.data.participants;
    const pair = validPair(p) ? pairId(...p) : '';
    const safe = validPair(p) && safePairs.has(pair) && d.data.privacySafe !== false && !blockedLegacyPairs.has(pair)
      && (d.data.privacySafe === true || !unsafePairs.has(pair))
      && named(d.data.byName) && named(d.data.otherName);
    result.push({ collection: 'deals', ...d, safe, reason: safe ? '' : 'anonymous-or-unproven-deal', mark: true });
  }
  for (const t of thanks) {
    const d = t.data;
    const valid = typeof d.fromUid === 'string' && typeof d.toUid === 'string' && d.fromUid !== d.toUid;
    const pair = valid ? pairId(d.fromUid, d.toUid) : '';
    const safe = valid && safePairs.has(pair) && d.privacySafe !== false && !blockedLegacyPairs.has(pair)
      && (d.privacySafe === true || !unsafePairs.has(pair))
      && !anonymousPosts.has(d.postId)
      && d.fromName !== ANONYMOUS_NAME && d.toName !== ANONYMOUS_NAME;
    result.push({ collection: 'thanks', ...t, safe, reason: safe ? '' : 'anonymous-or-unproven-thanks', mark: true });
  }
  return result;
}
