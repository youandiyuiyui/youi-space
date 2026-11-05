import assert from 'node:assert/strict';
import { planPrivacyMigration, pairId } from '../tools/privacy-plan.mjs';
const item = (id, data) => ({ id, data });
const safe = pairId('alice', 'carol'), unsafe = pairId('alice', 'bob');
const plan = planPrivacyMigration({
  posts: [item('named', { anon: false }), item('oldAnon', { anon: true, uid: 'bob' })],
  conversations: [
    item(safe, { participants: ['alice', 'carol'], names: { alice: 'ありす', carol: 'かろる' } }),
    item(unsafe, { participants: ['alice', 'bob'], names: { alice: 'ありす', bob: 'ご近所の方' }, masked: ['bob'] }),
    item('bob_carol', { participants: ['bob', 'carol'], names: { bob: 'ぼぶ', carol: 'かろる' }, privacySafe: false }),
    item('invalidPair', { participants: ['eve', 'dave'], names: { eve: 'いぶ', dave: 'だぶ' } }),
    item('v2_bob_dave', { participants: ['bob', 'dave'], names: { bob: 'ぼぶ', dave: 'だぶ' }, privacySafe: true }),
    item('v2_alice_bob', { participants: ['alice', 'bob'], names: { alice: 'ありす', bob: 'ぼぶ' }, privacySafe: true }),
  ],
  deals: [
    item('namedDeal', { participants: ['alice', 'carol'], byName: 'ありす', otherName: 'かろる' }),
    item('anonDeal', { participants: ['alice', 'bob'], byName: 'ありす', otherName: 'ご近所の方' }),
    item('unprovenDeal', { participants: ['bob', 'eve'], byName: 'ぼぶ', otherName: 'いぶ' }),
  ],
  thanks: [
    item('namedThanks', { fromUid: 'alice', toUid: 'carol' }),
    item('anonThanks', { fromUid: 'alice', toUid: 'bob' }),
    item('anonymousPostThanks', { fromUid: 'alice', toUid: 'carol', postId: 'oldAnon' }),
    item('v2Thanks', { fromUid: 'bob', toUid: 'dave' }),
    item('legacyPairThanks', { fromUid: 'alice', toUid: 'bob' }),
    item('confirmedV2Thanks', { fromUid: 'alice', toUid: 'bob', privacySafe: true }),
  ],
});
const find = id => plan.find(p => p.id === id);
assert.equal(find(safe).safe, true);
assert.equal(find(unsafe).safe, false);
assert.equal(find('bob_carol').safe, false, '隔離済みの会話を再公開しない');
assert.equal(find('invalidPair').safe, false, '会話IDと当事者が一致しなければ隔離');
assert.equal(find('v2_bob_dave').safe, true, '新規v2会話も安全な名前つきなら維持する');
assert.equal(find('v2_alice_bob').safe, false, '旧匿名pairから作られたv2も公開しない');
assert.equal(find('namedDeal').safe, true);
assert.equal(find('anonDeal').safe, false);
assert.equal(find('unprovenDeal').safe, false);
assert.equal(find('namedThanks').safe, true);
assert.equal(find('anonThanks').safe, false);
assert.equal(find('anonymousPostThanks').safe, false);
assert.equal(find('v2Thanks').safe, true, 'v2会話のポイント履歴も維持する');
assert.equal(find('legacyPairThanks').safe, false, '同じ二人がv2会話を始めても旧匿名履歴を再公開しない');
assert.equal(find('confirmedV2Thanks').safe, false, '旧匿名pairはv2のflagが真でも公開へ昇格しない');
assert.equal(find('oldAnon').mark, false, '旧匿名投稿は原本を変えず本人限定にする');
assert.equal(find('named'), undefined, '名前つき投稿は移行で変えない');
for (const names of [42, [], { alice: 'ありす' }, { alice: 42, eve: 'いぶ' }, { alice: '', eve: 'いぶ' }, { alice: 'A'.repeat(61), eve: 'いぶ' }, { alice: 'ありす', eve: 'いぶ', bob: 'ぼぶ' }]) {
  const invalid = planPrivacyMigration({ conversations: [item('alice_eve', { participants: ['alice', 'eve'], names })] });
  assert.equal(invalid[0].safe, false, '不正なnamesを持つ旧会話は移行でも公開しない');
}
console.log('PASS privacy migration: 安全な会話だけ公開、匿名と判定不明の履歴は隔離、原本保持');
