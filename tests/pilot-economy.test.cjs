'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../pilot-economy.js');
const act = (s, type, args = {}) => E.reduce(s, { type, ...args });
const current = s => s.activities.find(a => a.id === s.activeActivityId);
function create(s, scenario = 'talk', options = {}) { return act(s, 'CREATE_ACTIVITY', { scenario, ...options }); }
function reserve(s) { return act(s, 'RESERVE_ACTIVITY', { activityId: s.activeActivityId }); }
function confirmAll(s) {
  for (const actorId of current(s).requiredConfirmers) s = act(s, 'CONFIRM_COMPLETION', { activityId: s.activeActivityId, actorId });
  return s;
}
function finish(s) {
  s = confirmAll(s);
  s = act(s, 'VERIFY_ACTIVITY', { activityId: s.activeActivityId, actorId: 'organization' });
  return act(s, 'AWARD_ACTIVITY', { activityId: s.activeActivityId });
}
function completed(s = E.seed(), scenario = 'talk', options = {}) { return finish(reserve(create(s, scenario, options))); }
function reviewPair(s, providerId, receiverId, answers = { keptPromise: 'yes', clearRole: 'yes', workAgain: 'no' }) {
  const activityId = s.activeActivityId;
  s = act(s, 'SUBMIT_REVIEW', { activityId, fromActorId: providerId, toActorId: receiverId, answers });
  return act(s, 'SUBMIT_REVIEW', { activityId, fromActorId: receiverId, toActorId: providerId, answers });
}
const opportunity = (s, id) => E.getOpportunities(s).find(o => o.id === id);
function rejects(s, type, args, code) {
  const snapshot = JSON.stringify(s);
  assert.throws(() => act(s, type, args), e => e.code === code, code);
  assert.equal(JSON.stringify(s), snapshot, 'failed action leaves input untouched');
}

test('zero grant, free matching, immutable transitions, and browser UMD', () => {
  const s = E.seed();
  assert(Object.values(s.actors).every(a => a.balance === 0));
  assert.equal(E.getOpportunities(s)[0].available, true);
  const next = reserve(create(s, 'talk', { meRole: 'receiver' }));
  assert.equal(s.activities.length, 0);
  assert.deepEqual(current(next).receiverIds, ['me']);
  assert.equal(E.getEconomy(next).reserved, 20);
  assert.equal(E.getEconomy(next).issued, 0);
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require.resolve('../pilot-economy.js'), 'utf8'), ctx);
  assert.equal(ctx.YouiPilotEconomy.createState().actors.me.balance, 0);
});

test('talk and club award both roles once only after independent verification', () => {
  for (const scenario of ['talk', 'club']) for (const meRole of ['provider', 'receiver']) {
    let s = reserve(create(E.seed(), scenario, { meRole }));
    rejects(s, 'AWARD_ACTIVITY', { activityId: s.activeActivityId }, 'COMPLETION_NOT_VERIFIED');
    s = confirmAll(s);
    rejects(s, 'AWARD_ACTIVITY', { activityId: s.activeActivityId }, 'COMPLETION_NOT_VERIFIED');
    rejects(s, 'VERIFY_ACTIVITY', { activityId: s.activeActivityId, actorId: 'me' }, 'VERIFIER_REQUIRED');
    s = finish(s);
    for (const reward of current(s).rewards) assert.equal(s.actors[reward.actorId].balance, 10);
    if (scenario === 'talk') assert.equal(s.actors.me.experiences[0].role, meRole);
    if (scenario === 'club') {
      assert.deepEqual(current(s).receiverIds, ['organization']);
      assert.deepEqual(current(s).providerIds, [meRole === 'provider' ? 'me' : 'partner']);
      assert.equal(s.actors.me.balance, meRole === 'provider' ? 10 : 0);
    }
    assert.deepEqual(act(s, 'AWARD_ACTIVITY', { activityId: s.activeActivityId }), s);
    assert.equal(E.getEconomy(s).issued, 20); assert.equal(E.getEconomy(s).reserved, 0);
  }
});

test('cleanup includes five registered participants and one organizer award', () => {
  let s = reserve(create(E.seed(), 'cleanup'));
  assert.equal(current(s).rewardTotal, 60);
  s = act(s, 'VERIFY_ACTIVITY', { activityId: s.activeActivityId, actorId: 'organization' });
  for (const actorId of current(s).requiredConfirmers.slice(0, -1)) s = act(s, 'CONFIRM_COMPLETION', { activityId: s.activeActivityId, actorId });
  rejects(s, 'AWARD_ACTIVITY', { activityId: s.activeActivityId }, 'COMPLETION_NOT_VERIFIED');
  s = finish(s);
  for (const id of ['me', 'participant2', 'participant3', 'participant4', 'participant5', 'organization']) assert.equal(s.actors[id].balance, 10);
  assert.equal(s.actors.partner.balance, 0);
  assert.equal(E.getReviewTasks(s, s.activeActivityId).length, 10);
  assert.equal(E.getReviewTasks(s, s.activeActivityId, 'organization').length, 5);
  assert.equal(E.getEconomy(s).issued, 60);
});

test('budget reservation is atomic, held across activities, and cancellation releases once', () => {
  let s = reserve(create(E.seed({ config: { issueBudget: 30 } })));
  const first = s.activeActivityId;
  s = create(s, 'club');
  rejects(s, 'RESERVE_ACTIVITY', { activityId: s.activeActivityId }, 'ISSUE_BUDGET_EXHAUSTED');
  assert.equal(current(s).reservedPoints, 0);
  s = act(s, 'CANCEL_ACTIVITY', { activityId: first });
  const again = act(s, 'CANCEL_ACTIVITY', { activityId: first });
  assert.deepEqual(again, s);
  s = finish(reserve(s));
  assert.equal(E.getEconomy(s).remaining, 10);
  assert.equal(E.getEconomy(s).issued, 20);
  rejects(s, 'CANCEL_ACTIVITY', { activityId: s.activeActivityId }, 'ALREADY_COMPLETED');
});

test('self matching, duplicate occurrences, duplicate participants, and excess groups are refused', () => {
  const s = E.seed();
  rejects(s, 'CREATE_ACTIVITY', { scenario: 'talk', partnerId: 'me' }, 'SELF_ACTIVITY');
  rejects(s, 'CREATE_ACTIVITY', { scenario: 'cleanup', participantIds: ['me', 'me'] }, 'DUPLICATE_PARTICIPANT');
  rejects(s, 'CREATE_ACTIVITY', { scenario: 'cleanup', participantIds: ['me', 'partner', 'participant2', 'participant3', 'participant4', 'participant5'] }, 'GROUP_LIMIT');
  rejects(s, 'CREATE_ACTIVITY', { scenario: 'cleanup', participantIds: ['organization'] }, 'SELF_ACTIVITY');
  const next = create(s, 'talk', { occurrenceId: 'one-session' });
  rejects(next, 'CREATE_ACTIVITY', { scenario: 'club', occurrenceId: 'one-session' }, 'DUPLICATE_OCCURRENCE');
  const cancelled = act(next, 'CANCEL_ACTIVITY', { activityId: next.activeActivityId });
  assert.equal(create(cancelled, 'talk', { occurrenceId: 'one-session' }).activities.length, 2);
  rejects(reserve(next), 'CONFIRM_COMPLETION', { activityId: next.activeActivityId, actorId: 'participant2' }, 'NOT_PARTICIPANT');
});

test('partial or disputed activity holds points until operator review and reconfirmation', () => {
  for (const reason of ['partial', 'disputed']) {
    let s = confirmAll(reserve(create(E.seed())));
    s = act(s, 'HOLD_ACTIVITY', { activityId: s.activeActivityId, reason });
    assert.equal(E.getEconomy(s).reserved, 20); assert.equal(s.actors.me.balance, 0);
    rejects(s, 'AWARD_ACTIVITY', { activityId: s.activeActivityId }, 'COMPLETION_NOT_VERIFIED');
    rejects(s, 'RESOLVE_ACTIVITY', { activityId: s.activeActivityId, actorId: 'me', outcome: 'resume' }, 'REVIEW_REQUIRED');
    s = act(s, 'RESOLVE_ACTIVITY', { activityId: s.activeActivityId, actorId: 'organization', outcome: 'resume' });
    assert.deepEqual(current(s).confirmations, {}); assert.equal(current(s).verification, null);
    s = finish(s); assert.equal(s.actors.me.balance, 10);
  }
  let s = act(reserve(create(E.seed())), 'HOLD_ACTIVITY', { activityId: 'activity-1', reason: 'partial' });
  s = act(s, 'RESOLVE_ACTIVITY', { activityId: s.activeActivityId, actorId: 'organization', outcome: 'cancel' });
  assert.equal(E.getEconomy(s).reserved, 0); assert.equal(E.getEconomy(s).issued, 0);
});

test('reviews are optional, double blind by pair, and do not affect rewards', () => {
  let s = completed(); const id = s.activeActivityId; const balances = JSON.stringify(s.actors);
  s = act(s, 'SUBMIT_REVIEW', { activityId: id, fromActorId: 'me', toActorId: 'partner', answers: { keptPromise: 'yes' } });
  assert.equal(E.getReviewTasks(s, id, 'me')[0].status, 'pending');
  assert.equal(E.getReviews(s, id, 'partner').length, 0);
  assert.equal(E.getReviews(s, id, 'me').length, 1);
  s = act(s, 'SUBMIT_REVIEW', { activityId: id, fromActorId: 'partner', toActorId: 'me', answers: { workAgain: 'no' } });
  assert(E.getReviewTasks(s, id).every(t => t.status === 'published'));
  assert.equal(E.getReviews(s, id, 'partner').length, 2);
  assert.equal(JSON.stringify(s.actors), balances);
  assert.equal(s.reviews[0].answers.clearRole, null);
  rejects(s, 'SUBMIT_REVIEW', { activityId: id, fromActorId: 'me', toActorId: 'partner' }, 'ALREADY_REVIEWED');
});

test('reports reach operator immediately, remain private, and unanswered reviews release after seven days', () => {
  let s = completed(); const id = s.activeActivityId;
  s = act(s, 'SUBMIT_REVIEW', { activityId: id, fromActorId: 'me', toActorId: 'partner', report: '担当範囲を確認したい' });
  assert.equal(s.reports.length, 1); assert.equal(s.reports[0].status, 'open');
  assert.equal(E.getReviews(s, id, 'partner').length, 0);
  s = act(s, 'ADVANCE_TIME', { days: 6 }); assert.equal(E.getReviews(s, id, 'partner').length, 0);
  s = act(s, 'ADVANCE_TIME', { days: 1 }); assert.equal(E.getReviews(s, id, 'partner').length, 1);
  assert.equal(E.getReviews(s, id, 'partner')[0].report, undefined);
  assert.equal(s.actors.me.balance, 10); assert.equal(s.actors.partner.balance, 10);
  assert.equal(E.getReviewTasks(s, id, 'partner')[0].status, 'expired');
  rejects(s, 'SUBMIT_REVIEW', { activityId: id, fromActorId: 'partner', toActorId: 'me' }, 'REVIEW_EXPIRED');
});

test('group review publication is per reciprocal pair, not another participant submission', () => {
  let s = completed(E.seed(), 'cleanup'); const id = s.activeActivityId;
  s = act(s, 'SUBMIT_REVIEW', { activityId: id, fromActorId: 'me', toActorId: 'organization' });
  s = act(s, 'SUBMIT_REVIEW', { activityId: id, fromActorId: 'organization', toActorId: 'participant2' });
  assert.equal(E.getReviewTasks(s, id, 'me')[0].status, 'pending');
  s = act(s, 'SUBMIT_REVIEW', { activityId: id, fromActorId: 'organization', toActorId: 'me' });
  assert.equal(E.getReviewTasks(s, id, 'me')[0].status, 'published');
});

test('repeat pairing retains experience but does not alone unlock roles; points cannot unlock roles', () => {
  let s = reviewPair(completed(), 'me', 'partner');
  s = reviewPair(completed(s), 'me', 'partner');
  assert.equal(s.actors.me.experiences.length, 2);
  s = act(s, 'SET_ROLE_CHECK', { actorId: 'me', check: 'orientation', value: true, verifiedBy: 'organization' });
  s = act(s, 'SET_ROLE_CHECK', { actorId: 'me', check: 'childSafety', value: true, verifiedBy: 'organization' });
  assert.equal(opportunity(s, 'activity-profile').available, true);
  assert.equal(opportunity(s, 'repeat-support').available, false);
  assert.equal(opportunity(s, 'propose-project').available, false);
  assert.equal(E.getTrustSummary(s).trustedCounterparties, 1);
  s = reviewPair(completed(s, 'club'), 'me', 'organization');
  assert(E.getOpportunities(s).every(o => o.available));
  s = act(s, 'REDEEM', { productId: 'space-workshop' });
  assert.equal(s.actors.me.balance, 0);
  assert(E.getOpportunities(s).every(o => o.available));
  let inexperienced = E.seed();
  inexperienced = act(inexperienced, 'SET_ROLE_CHECK', { actorId: 'me', check: 'orientation', value: true, verifiedBy: 'organization' });
  assert.equal(opportunity(inexperienced, 'repeat-support').available, false);
});

test('activity-count diversity without published positive incoming evidence cannot unlock responsibilities', () => {
  let s = completed(completed(), 'talk', { partnerId: 'participant2' });
  s = act(s, 'SET_ROLE_CHECK', { actorId: 'me', check: 'orientation', value: true, verifiedBy: 'organization' });
  assert.equal(E.getTrustSummary(s).distinctCounterparties, 2);
  assert.equal(opportunity(s, 'propose-project').available, false);
  s = act(s, 'SUBMIT_REVIEW', { activityId: s.activeActivityId, fromActorId: 'participant2', toActorId: 'me', answers: { keptPromise: 'yes', clearRole: 'yes' } });
  assert.equal(E.getTrustSummary(s).trustedCounterparties, 0, 'pending incoming review is not role evidence');
  s = act(s, 'SUBMIT_REVIEW', { activityId: s.activeActivityId, fromActorId: 'me', toActorId: 'participant2' });
  assert.equal(E.getTrustSummary(s).trustedCounterparties, 1);
  const firstId = s.activities[0].id;
  s = act(s, 'SUBMIT_REVIEW', { activityId: firstId, fromActorId: 'partner', toActorId: 'me', answers: { keptPromise: 'yes', clearRole: 'yes', workAgain: 'no' } });
  s = act(s, 'SUBMIT_REVIEW', { activityId: firstId, fromActorId: 'me', toActorId: 'partner' });
  assert.equal(opportunity(s, 'propose-project').available, true, 'workAgain does not penalize or prevent role evidence');
  s = reviewPair(completed(s, 'talk', { partnerId: 'participant3' }), 'me', 'participant3', { keptPromise: 'no', clearRole: 'partly' });
  assert.equal(opportunity(s, 'propose-project').available, true, 'new no/partly answers do not automatically revoke existing evidence');
});

test('review deadline is fixed to completion, including late submission and exact deadline', () => {
  let s = completed(); const id = s.activeActivityId;
  const deadline = new Date(new Date(current(s).awardedAt).getTime() + 7 * 86400000).toISOString();
  s = act(s, 'ADVANCE_TIME', { days: 6 });
  s = act(s, 'SUBMIT_REVIEW', { activityId: id, fromActorId: 'partner', toActorId: 'me', answers: { keptPromise: 'yes', clearRole: 'yes' } });
  assert.equal(E.getReviewTasks(s, id, 'partner')[0].deadlineAt, deadline);
  assert.equal(E.getReviews(s, id, 'me').length, 0);
  s = act(s, 'ADVANCE_TIME', { days: 1 });
  assert.equal(E.getReviews(s, id, 'me').length, 1);
  assert.equal(E.getTrustSummary(s).trustedCounterparties, 1);
  rejects(s, 'SUBMIT_REVIEW', { activityId: id, fromActorId: 'me', toActorId: 'partner' }, 'REVIEW_EXPIRED');
  assert.equal(s.actors.me.balance, 10);
});

test('published cleanup reviews cannot be read by unrelated participants', () => {
  let s = completed(E.seed(), 'cleanup'); const id = s.activeActivityId;
  s = reviewPair(s, 'participant2', 'organization');
  assert.equal(E.getReviews(s, id, 'me').length, 0);
  assert.equal(E.getReviews(s, id, 'participant3').length, 0);
  assert.equal(E.getReviews(s, id, 'participant2').length, 2);
  assert.equal(E.getReviews(s, id, 'organization').length, 2);
});

test('host cleanup represents organization without issuing helper points to me', () => {
  const s = completed(E.seed(), 'cleanup', { meRole: 'receiver' });
  assert.deepEqual(current(s).providerIds, ['partner', 'participant2', 'participant3', 'participant4', 'participant5']);
  assert.equal(s.actors.me.balance, 0); assert.equal(s.actors.me.experiences.length, 0);
  assert.equal(s.actors.organization.balance, 10); assert.equal(s.actors.partner.balance, 10);
  rejects(E.seed(), 'CREATE_ACTIVITY', { scenario: 'cleanup', meRole: 'receiver', participantIds: ['me', 'partner'] }, 'ROLE_CONFLICT');
});

test('organization may redeem internal benefits but cannot redeem tangible benefits', () => {
  let s = completed(completed(E.seed(), 'cleanup'), 'cleanup');
  rejects(s, 'REDEEM', { actorId: 'organization', productId: 'local-drink' }, 'ORGANIZATION_TANGIBLE_FORBIDDEN');
  s = act(s, 'REDEEM', { actorId: 'organization', productId: 'space-room' });
  assert.equal(s.actors.organization.balance, 10);
});

test('request details preserve plain text, enforce limits, and config states demo thresholds', () => {
  const s = create(E.seed(), 'talk', { title: ' お話し相手 ', place: 'オンライン', time: '土曜30分', details: '<script>plain text only</script>' });
  assert.equal(current(s).title, 'お話し相手');
  assert.equal(current(s).details, '<script>plain text only</script>');
  rejects(E.seed(), 'CREATE_ACTIVITY', { scenario: 'talk', title: 'あ'.repeat(61) }, 'INVALID_ACTIVITY_TEXT');
  const configurable = E.seed({ config: { issueBudget: 60, providerPoints: 5, receiverPoints: 5, minVerifiedActivities: 3, minTrustedCounterparties: 3 } });
  assert.equal(E.getTrustSummary(configurable).minVerifiedActivities, 3);
  assert.equal(current(reserve(create(configurable))).rewardTotal, 10);
});

test('redemption burns points and cancellation restores exact stock and balance only once', () => {
  let s = completed(completed());
  rejects(E.seed(), 'REDEEM', { productId: 'space-room' }, 'INSUFFICIENT_POINTS');
  s = act(s, 'REDEEM', { productId: 'local-drink' });
  assert.equal(s.actors.me.balance, 0); assert.equal(E.getEconomy(s).burned, 20);
  assert.equal(s.catalog.find(p => p.id === 'local-drink').stock, 1);
  const redemptionId = s.redemptions[0].id;
  rejects(s, 'CANCEL_REDEMPTION', { redemptionId, actorId: 'partner' }, 'NOT_REDEMPTION_OWNER');
  s = act(s, 'CANCEL_REDEMPTION', { redemptionId, actorId: 'me' });
  assert.equal(s.actors.me.balance, 20); assert.equal(E.getEconomy(s).restored, 20);
  assert.equal(E.getEconomy(s).netBurned, 0);
  assert.equal(s.catalog.find(p => p.id === 'local-drink').stock, 2);
  assert.deepEqual(act(s, 'CANCEL_REDEMPTION', { redemptionId }), s);
  assert.equal(E.getEconomy(s).issued, 40, 'refund does not create new issued points');
});

test('stock and ledger conservation hold across different actors and repeated cancellation', () => {
  let s = completed(completed(E.seed(), 'cleanup'), 'cleanup');
  s = act(s, 'REDEEM', { actorId: 'me', productId: 'local-drink' });
  s = act(s, 'REDEEM', { actorId: 'participant2', productId: 'local-drink' });
  rejects(s, 'REDEEM', { actorId: 'participant3', productId: 'local-drink' }, 'OUT_OF_STOCK');
  s = act(s, 'CANCEL_REDEMPTION', { redemptionId: s.redemptions[0].id });
  s = act(s, 'REDEEM', { actorId: 'participant3', productId: 'local-drink' });
  const e = E.getEconomy(s);
  assert.equal(e.totalBalances, e.issued - e.burned + e.restored);
  assert.equal(e.remaining, 180, 'redemption does not replenish issuance budget');
  assert(E.assertState(JSON.parse(JSON.stringify(s))));
});

test('restored state rejects corrupted balances, reservations, and stock without mutation', () => {
  const original = completed();
  for (const corrupt of [s => { s.actors.me.balance = 999; }, s => { s.economy.reserved = 20; }, s => { s.catalog[0].stock = 99; }, s => { s.version = 99; }]) {
    const s = structuredClone(original); corrupt(s);
    assert.throws(() => E.assertState(s));
  }
});

test('missing review identity and unrelated review pairs cannot enter trust evidence', () => {
  const s = completed(), activityId = s.activeActivityId;
  rejects(s, 'SUBMIT_REVIEW', { activityId, toActorId: 'partner' }, 'UNKNOWN_ACTOR');
  rejects(s, 'SUBMIT_REVIEW', { activityId, fromActorId: 'participant2', toActorId: 'me' }, 'INVALID_REVIEW_PAIR');
  rejects(s, 'SUBMIT_REVIEW', { activityId, fromActorId: 'me', toActorId: 'me' }, 'INVALID_REVIEW_PAIR');
});

test('state restoration validates trust evidence against real completed activities and review pairs', () => {
  const original = reviewPair(completed(), 'me', 'partner');
  for (const corrupt of [
    s => { s.actors.me.experiences[0].counterpartyIds = ['participant2']; },
    s => { s.actors.me.experiences.push({ ...s.actors.me.experiences[0] }); },
    s => { s.reviews[0].fromActorId = 'participant2'; },
    s => { s.reviews[0].at = '2026-10-16T00:00:00Z'; },
    s => { s.reviews.push({ ...s.reviews[0], id: 'duplicate-review' }); },
    s => { s.activities[0].verification = null; },
    s => { s.activities[0].requiredConfirmers = ['me']; },
    s => { s.config.minTrustedCounterparties = 0; }
  ]) {
    const s = structuredClone(original); corrupt(s);
    assert.throws(() => E.assertState(s));
  }
  assert(E.assertState(JSON.parse(JSON.stringify(original))));
});
