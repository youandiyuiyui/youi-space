/* ＆ポイントと評価の仕組み（ゲストのデモ用）。端末の中だけで計算し、保存・通信・Firebase・実際の特典には触れない。
   index.html のゲストのデモが読み込む。実アカウントの＆ポイント（thanks から計算）とは別のもの */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YouiSpaceEconomy = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var VERSION = 1;
  var DAY = 86400000;
  var DEFAULT_CONFIG = {
    issueBudget: 300, providerPoints: 10, receiverPoints: 10,
    groupMax: 5, reviewDelayDays: 7, minVerifiedActivities: 2, minTrustedCounterparties: 2
  };
  var ACTOR_IDS = ['me', 'partner', 'organization', 'participant2', 'participant3', 'participant4', 'participant5', 'operator'];
  var CHECK_KEYS = ['identity', 'orientation', 'childSafety'];
  var HOLD_REASONS = ['partial', 'disputed', 'unconfirmed'];
  // 共通の信頼は「確認できた／判断できない／運営に相談したい」で答える。相性（workAgain）は信頼と分ける
  var ANSWERS = {
    keptPromise: ['yes', 'unknown', 'consult'], toldChanges: ['yes', 'none', 'unknown', 'consult'],
    respectedWishes: ['yes', 'unknown', 'consult'], workAgain: ['yes', 'no']
  };
  // tangible＝外部の特典、space＝Space内の特典。すべて見本
  var CATALOG = [
    { id: 'local-drink', title: '協力店の商品（見本）', kind: 'tangible', points: 20, stock: 2 },
    { id: 'partner-service', title: '提携先のサービス（見本）', kind: 'tangible', points: 30, stock: 1 },
    { id: 'local-event', title: '地域の催しへの参加（見本）', kind: 'tangible', points: 10, stock: 3 },
    { id: 'space-room', title: '交流の体験（テーマ別の交流会・見本）', kind: 'space', points: 10, stock: 3 },
    { id: 'activity-booklet', title: '活動記録の冊子（見本）', kind: 'space', points: 20, stock: 3 },
    { id: 'profile-look', title: 'プロフィールの見た目（見本）', kind: 'space', points: 10, stock: 5 },
    { id: 'space-workshop', title: '企画準備の補助（見本）', kind: 'space', points: 30, stock: 2 }
  ];
  function fail(code, message) { var e = new Error(message); e.code = code; throw e; }
  function check(ok, code, message) { if (!ok) fail(code, message); }
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function integer(x) { return Number.isSafeInteger(x) && x >= 0; }
  function iso(value) {
    var date = new Date(value);
    check(Number.isFinite(date.getTime()), 'INVALID_TIME', '日時が正しくありません。');
    return date.toISOString();
  }
  function actor(state, id) {
    check(Object.prototype.hasOwnProperty.call(state.actors, id), 'UNKNOWN_ACTOR', '参加者が見つかりません。');
    return state.actors[id];
  }
  function activity(state, id) {
    var found = state.activities.find(function (item) { return item.id === id; });
    check(found, 'UNKNOWN_ACTIVITY', '活動が見つかりません。'); return found;
  }
  function unique(ids) { return Array.from(new Set(ids)); }
  function nextId(state, prefix) { state.sequence += 1; return prefix + '-' + state.sequence; }
  function log(state, type, data) {
    state.transactions.push(Object.assign({ id: nextId(state, 'txn'), type: type, at: state.now }, data));
  }
  function freshChecks() { return { identity: false, orientation: false, childSafety: false }; }
  function catalogItem(entry) { return Object.assign({}, entry, { initialStock: entry.stock }); }
  function createState(options) {
    options = options || {};
    var config = Object.assign({}, DEFAULT_CONFIG, options.config || {});
    Object.keys(DEFAULT_CONFIG).forEach(function (key) {
      check(integer(config[key]), 'INVALID_CONFIG', '設定値は0以上の整数にしてください。');
    });
    check(config.groupMax >= 1 && config.groupMax <= 5 && config.reviewDelayDays > 0
      && config.minVerifiedActivities > 0 && config.minTrustedCounterparties > 0,
      'INVALID_CONFIG', '実証の参加人数は1〜5人、評価待機日数と実績条件は1以上です。');
    var actors = {};
    [['me', 'あなた', 'person'], ['partner', '協力する相手', 'person'],
      ['organization', '活動の主催者', 'organization'], ['participant2', '参加者B', 'person'],
      ['participant3', '参加者C', 'person'], ['participant4', '参加者D', 'person'],
      ['participant5', '参加者E', 'person'], ['operator', '運営（You&i Space）', 'operator']].forEach(function (entry) {
      actors[entry[0]] = { id: entry[0], name: entry[1], label: entry[1], type: entry[2], balance: 0,
        checks: freshChecks(), experiences: [] };
    });
    // デモの登場人物・団体を参加者として足す（[id, 名前, 'person' | 'organization']）
    (options.actors || []).forEach(function (entry) {
      check(Array.isArray(entry) && typeof entry[0] === 'string' && /^[a-z0-9-]{1,40}$/.test(entry[0])
        && !Object.prototype.hasOwnProperty.call(actors, entry[0]) && typeof entry[1] === 'string' && entry[1].length > 0 && entry[1].length <= 60
        && (entry[2] === 'person' || entry[2] === 'organization'), 'INVALID_ACTOR', '参加者の指定が正しくありません。');
      actors[entry[0]] = { id: entry[0], name: entry[1], label: entry[1], type: entry[2], balance: 0,
        checks: freshChecks(), experiences: [] };
    });
    var state = {
      version: VERSION, localOnly: true, now: iso(options.now || '2026-10-08T09:00:00+09:00'),
      sequence: 0, config: config, actors: actors, activities: [], activeActivityId: null,
      economy: { cap: config.issueBudget, issued: 0, reserved: 0, burned: 0, restored: 0 },
      catalog: CATALOG.map(catalogItem),
      redemptions: [], transactions: [], reviews: [], reports: []
    };
    assertState(state); return state;
  }
  function getEconomy(state) {
    var e = copy(state.economy);
    e.remaining = e.cap - e.issued - e.reserved;
    e.available = e.remaining;
    e.netBurned = e.burned - e.restored;
    e.totalBalances = Object.values(state.actors).reduce(function (sum, a) { return sum + a.balance; }, 0);
    return e;
  }
  function refreshReady(a) {
    if (a.status === 'hold') return;
    a.status = a.verification && a.requiredConfirmers.every(function (id) { return !!a.confirmations[id]; })
      ? 'ready' : 'reserved';
  }
  function allowReserved(a) {
    check(a.status === 'reserved' || a.status === 'ready', 'INVALID_STATUS', '発行枠を確保した進行中の活動が対象です。');
  }
  function requirePreCheck(a) {
    check(!!a.preCheck, 'PRECHECK_REQUIRED', '活動前の確認（本人・所属・当日の責任者）が済んでから確認できます。');
  }
  function release(state, a) {
    if (!a.reservedPoints) return;
    state.economy.reserved -= a.reservedPoints;
    log(state, 'release', { activityId: a.id, points: a.reservedPoints });
    a.reservedPoints = 0;
  }
  function getReviewTasks(state, activityId, actorId) {
    var a = activity(state, activityId);
    var tasks = [];
    a.requiredReviewPairs.forEach(function (pair) {
      [[pair.providerId, pair.receiverId], [pair.receiverId, pair.providerId]].forEach(function (ids) {
        if (actorId && actorId !== ids[0]) return;
        var own = state.reviews.find(function (r) { return r.activityId === a.id && r.fromActorId === ids[0] && r.toActorId === ids[1]; });
        var opposite = state.reviews.find(function (r) { return r.activityId === a.id && r.fromActorId === ids[1] && r.toActorId === ids[0]; });
        var unlockAt = a.awardedAt ? iso(new Date(a.awardedAt).getTime() + state.config.reviewDelayDays * DAY) : null;
        var expired = !!unlockAt && new Date(state.now).getTime() >= new Date(unlockAt).getTime();
        var published = !!own && (!!opposite || expired);
        tasks.push({ fromActorId: ids[0], toActorId: ids[1], submitted: !!own,
          oppositeSubmitted: !!opposite, status: own ? (published ? 'published' : 'pending') : (expired ? 'expired' : 'unsubmitted'),
          unlockAt: unlockAt, deadlineAt: unlockAt, ownReview: own && actorId === ids[0] ? copy(own) : null });
      });
    });
    return tasks;
  }
  function getReviews(state, activityId, viewerId) {
    viewerId = viewerId || 'me'; actor(state, viewerId);
    var tasks = getReviewTasks(state, activityId);
    return state.reviews.filter(function (review) {
      if (review.activityId !== activityId) return false;
      if (review.fromActorId !== viewerId && review.toActorId !== viewerId) return false;
      if (review.fromActorId === viewerId) return true;
      return tasks.some(function (task) { return task.fromActorId === review.fromActorId && task.toActorId === review.toActorId && task.status === 'published'; });
    }).map(function (review) {
      var safe = copy(review); delete safe.report; return safe;
    });
  }
  // 共通の信頼として数えるのは、約束・希望の尊重が確認でき、変更の連絡にも心配がない回答だけ
  function trustworthy(answers) {
    return answers.keptPromise === 'yes' && answers.respectedWishes === 'yes'
      && (answers.toldChanges === 'yes' || answers.toldChanges === 'none');
  }
  function incomingReviews(state, a) {
    return a.experiences.reduce(function (all, e) {
      return all.concat(getReviews(state, e.activityId, a.id).filter(function (r) { return r.toActorId === a.id; }));
    }, []);
  }
  function getTrustSummary(state, actorId) {
    var a = actor(state, actorId || 'me');
    var experiences = a.experiences;
    var distinct = unique(experiences.reduce(function (all, e) { return all.concat(e.counterpartyIds); }, []));
    var trusted = unique(incomingReviews(state, a).filter(function (r) { return trustworthy(r.answers); })
      .map(function (r) { return r.fromActorId; }));
    return { verifiedActivities: experiences.length, distinctCounterparties: distinct.length,
      trustedCounterparties: trusted.length, trustedCounterpartyIds: trusted,
      minVerifiedActivities: state.config.minVerifiedActivities, minTrustedCounterparties: state.config.minTrustedCounterparties };
  }
  /* 評価経済の記録を3つに分けて返す：共通の信頼／活動ごとの経験／資格・現在の確認事項 */
  function getRecords(state, actorId) {
    var a = actor(state, actorId || 'me');
    var incoming = incomingReviews(state, a);
    var count = function (key, values) { return incoming.filter(function (r) { return values.includes(r.answers[key]); }).length; };
    var experiences = {};
    a.experiences.forEach(function (e) {
      experiences[e.scenario] = experiences[e.scenario] || { provider: 0, receiver: 0 };
      experiences[e.scenario][e.role] += 1;
    });
    return {
      trust: { publishedReviews: incoming.length, keptPromise: count('keptPromise', ['yes']),
        toldChanges: count('toldChanges', ['yes', 'none']), respectedWishes: count('respectedWishes', ['yes']),
        trustedCounterparties: getTrustSummary(state, a.id).trustedCounterparties },
      experiences: experiences,
      checks: copy(a.checks)
    };
  }
  function getOpportunities(state, actorId) {
    var a = actor(state, actorId || 'me');
    var experiences = a.experiences;
    var summary = getTrustSummary(state, a.id);
    var diverse = summary.verifiedActivities >= state.config.minVerifiedActivities
      && summary.trustedCounterparties >= state.config.minTrustedCounterparties;
    var oriented = a.checks.orientation;
    // 経験のない分野の役割は紹介しない：同じ種類の活動を支える側で経験していることが条件
    var did = function (scenario) { return experiences.some(function (e) { return e.scenario === scenario && e.role === 'provider'; }); };
    var evidence = ['確認済みの活動' + state.config.minVerifiedActivities + '回',
      '異なる' + state.config.minTrustedCounterparties + '人の相手からの公開済みの確認', '活動説明の確認'];
    function role(id, title, scenario, extraOk, extraRequirements) {
      var ok = diverse && oriented && did(scenario) && extraOk;
      return { id: id, group: 'role', title: title, available: ok,
        reason: ok ? '関心・経験・時間に合う担当として、運営から紹介できます。実際の担当は受入側と確認して決めます。'
          : '同じ種類の活動の経験、異なる相手からの確認、活動説明の確認がそろうと紹介できます。',
        requirements: evidence.concat(extraRequirements) };
    }
    return [
      { id: 'basic-match', group: 'basic', title: '通常の依頼・応募', available: true, reason: '残高や評価の有無によらず、いつでも利用できます。', requirements: [] },
      { id: 'project-consult', group: 'project', title: '企画の相談', available: true,
        reason: '初参加でも、運営や受入先に企画を相談できます。', requirements: [] },
      { id: 'activity-profile', group: 'profile', title: '確認済みの活動プロフィール', available: experiences.length > 0,
        reason: experiences.length > 0 ? '実際に担当した活動や役割を、自分で選んで示せます。' : '実施を確認した活動があると作れます。', requirements: ['確認済みの活動1回'] },
      role('role-talk', '話し相手の継続担当', 'talk', true, ['話し相手の経験']),
      role('role-club', '部活補助の継続担当', 'club', a.checks.childSafety, ['部活補助の経験', '子どもとの関わり方の確認']),
      role('role-cleanup', '清掃活動の受付・道具係', 'cleanup', true, ['清掃活動の経験']),
      { id: 'project-role', group: 'project', title: '小さな企画を一緒に進める', available: diverse && oriented,
        reason: diverse && oriented ? '会話会・部活の準備改善・小さな清掃企画などを、運営や受入先と一緒に検討できます。採用は受入側が確認します。'
          : '確認済みの活動と、異なる相手からの確認、活動説明の確認がそろうと案内できます。',
        requirements: evidence.slice() },
      { id: 'future-training', group: 'future', title: '研修の機会・運営への参画', available: false,
        reason: '提供する体制と条件を整えた後に案内します（準備中）。', requirements: [] }
    ];
  }
  function reduce(input, action) {
    assertState(input);
    check(action && typeof action.type === 'string', 'INVALID_ACTION', '操作を指定してください。');
    var state = copy(input), a, target, item;
    if (action.at !== undefined) {
      var at = iso(action.at);
      check(new Date(at) >= new Date(state.now), 'TIME_REVERSED', '過去の日時には戻せません。'); state.now = at;
    }
    switch (action.type) {
    case 'CREATE_ACTIVITY': {
      check(['talk', 'club', 'cleanup'].includes(action.scenario), 'INVALID_SCENARIO', '活動の種類を選んでください。');
      var meRole = action.meRole || 'provider';
      check(meRole === 'provider' || meRole === 'receiver', 'INVALID_ROLE', '支援する側・受ける側を選んでください。');
      var providers, receivers;
      if (action.scenario === 'cleanup') {
        providers = action.participantIds || [meRole === 'provider' ? 'me' : 'partner', 'participant2', 'participant3', 'participant4', 'participant5'].slice(0, state.config.groupMax);
        receivers = [action.organizationId || 'organization'];
        check(Array.isArray(providers) && providers.length >= 1 && providers.length <= state.config.groupMax, 'GROUP_LIMIT', '参加者数が実証の上限を超えています。');
        check(meRole !== 'receiver' || !providers.includes('me'), 'ROLE_CONFLICT', '主催団体を操作する体験では、あなたを支援者に含めません。');
      } else if (action.scenario === 'club') {
        providers = [meRole === 'provider' ? 'me' : (action.partnerId || 'partner')];
        receivers = [action.organizationId || 'organization'];
      } else {
        var partnerId = action.partnerId || 'partner';
        providers = [meRole === 'provider' ? 'me' : partnerId];
        receivers = [meRole === 'receiver' ? 'me' : partnerId];
      }
      check(unique(providers).length === providers.length && unique(receivers).length === receivers.length,
        'DUPLICATE_PARTICIPANT', '同じ参加者を重複登録できません。');
      providers.concat(receivers).forEach(function (id) {
        check(actor(state, id).type !== 'operator', 'OPERATOR_NOT_PARTICIPANT', '運営は活動の参加者になりません。');
      });
      check(!providers.some(function (id) { return receivers.includes(id); }), 'SELF_ACTIVITY', '同じ人が同じ活動の支援者と受援者になることはできません。');
      if (action.scenario !== 'talk') check(actor(state, receivers[0]).type === 'organization', 'INVALID_ORGANIZATION', '部活補助・清掃活動には、登録済みの学校・主催団体が必要です。');
      var occurrenceId = action.occurrenceId || 'demo-occurrence-' + (state.sequence + 1);
      check(typeof occurrenceId === 'string' && occurrenceId.trim().length > 0 && occurrenceId.length <= 120, 'INVALID_OCCURRENCE', '開催回を指定してください。');
      check(!state.activities.some(function (existing) { return existing.occurrenceId === occurrenceId && existing.status !== 'cancelled'; }),
        'DUPLICATE_OCCURRENCE', '同じ開催回の活動が既にあります。');
      var rewards = providers.map(function (id) { return { actorId: id, points: state.config.providerPoints, role: 'provider' }; })
        .concat(receivers.map(function (id) { return { actorId: id, points: state.config.receiverPoints, role: 'receiver' }; }));
      a = { id: nextId(state, 'activity'), occurrenceId: occurrenceId, scenario: action.scenario, meRole: meRole,
        status: 'draft', createdAt: state.now, providerIds: providers.slice(), receiverIds: receivers.slice(),
        requiredConfirmers: providers.concat(receivers), confirmations: {}, verification: null, preCheck: null,
        rewards: rewards, rewardTotal: rewards.reduce(function (sum, r) { return sum + r.points; }, 0), reservedPoints: 0,
        requiredReviewPairs: providers.map(function (id) { return { providerId: id, receiverId: receivers[0] }; }),
        holdReason: null, awardedAt: null, cancelledAt: null };
      ['title', 'place', 'time', 'details'].forEach(function (key) {
        var limits = { title: 60, place: 80, time: 80, details: 500 };
        var value = action[key] === undefined ? '' : action[key];
        check(typeof value === 'string' && value.length <= limits[key], 'INVALID_ACTIVITY_TEXT', '依頼文が文字数の上限を超えているか、形式が正しくありません。');
        a[key] = value.trim();
      });
      state.activities.push(a); state.activeActivityId = a.id; break;
    }
    case 'RESERVE_ACTIVITY':
      a = activity(state, action.activityId);
      if (a.status === 'reserved' || a.status === 'ready') break;
      check(a.status === 'draft', 'INVALID_STATUS', '募集前の活動だけ発行枠を確保できます。');
      check(getEconomy(state).remaining >= a.rewardTotal, 'ISSUE_BUDGET_EXHAUSTED', '発行枠が不足しています。ポイント配布はまだ約束されていません。');
      a.reservedPoints = a.rewardTotal; state.economy.reserved += a.rewardTotal; a.status = 'reserved';
      log(state, 'reserve', { activityId: a.id, points: a.rewardTotal }); break;
    case 'CHECK_BEFORE_ACTIVITY':
      a = activity(state, action.activityId); allowReserved(a);
      check(action.actorId === 'operator', 'OPERATOR_REQUIRED', '活動前の確認は運営が記録します。');
      if (!a.preCheck) {
        a.preCheck = { actorId: 'operator', at: state.now };
        a.requiredConfirmers.forEach(function (id) { actor(state, id).checks.identity = true; });
      }
      break;
    case 'CONFIRM_COMPLETION':
      a = activity(state, action.activityId); allowReserved(a); requirePreCheck(a);
      check(a.requiredConfirmers.includes(action.actorId), 'NOT_PARTICIPANT', '登録された参加者の確認が必要です。');
      a.confirmations[action.actorId] = a.confirmations[action.actorId] || state.now; refreshReady(a); break;
    case 'VERIFY_ACTIVITY':
      a = activity(state, action.activityId); allowReserved(a);
      check(action.actorId === 'operator', 'VERIFIER_REQUIRED', '運営による実施の確認が必要です。');
      requirePreCheck(a);
      a.verification = a.verification || { actorId: action.actorId, at: state.now }; refreshReady(a); break;
    case 'AWARD_ACTIVITY':
      a = activity(state, action.activityId);
      if (a.status === 'completed') break;
      check(a.status === 'ready' && a.verification && a.requiredConfirmers.every(function (id) { return !!a.confirmations[id]; }),
        'COMPLETION_NOT_VERIFIED', '全員の完了確認と、運営による実施の確認が必要です。');
      check(a.reservedPoints === a.rewardTotal, 'RESERVATION_REQUIRED', '配布予定の発行枠を確認できません。');
      state.economy.reserved -= a.reservedPoints; state.economy.issued += a.reservedPoints; a.reservedPoints = 0;
      a.rewards.forEach(function (reward) {
        var user = actor(state, reward.actorId); user.balance += reward.points;
        user.experiences.push({ activityId: a.id, scenario: a.scenario, role: reward.role, at: state.now,
          counterpartyIds: (reward.role === 'provider' ? a.receiverIds : a.providerIds).slice() });
        log(state, 'award', { activityId: a.id, actorId: reward.actorId, points: reward.points, delta: reward.points });
      });
      a.status = 'completed'; a.awardedAt = state.now; break;
    case 'HOLD_ACTIVITY':
      a = activity(state, action.activityId); allowReserved(a);
      check(HOLD_REASONS.includes(action.reason), 'INVALID_REASON', '中断・認識の相違・片方の確認が取れない、から選んでください。');
      a.status = 'hold'; a.holdReason = action.reason; break;
    case 'RESOLVE_ACTIVITY':
      a = activity(state, action.activityId);
      check(a.status === 'hold' && action.actorId === 'operator', 'REVIEW_REQUIRED', '保留中の活動を運営が確認してください。');
      check(action.outcome === 'resume' || action.outcome === 'cancel', 'INVALID_OUTCOME', '再確認または取消を選んでください。');
      a.holdReason = null;
      if (action.outcome === 'cancel') { release(state, a); a.status = 'cancelled'; a.cancelledAt = state.now; }
      else { a.status = 'reserved'; a.confirmations = {}; a.verification = null; }
      break;
    case 'CANCEL_ACTIVITY':
      a = activity(state, action.activityId);
      if (a.status === 'cancelled') break;
      check(a.status !== 'completed', 'ALREADY_COMPLETED', '配布済みの活動は通常の取消ができません。');
      release(state, a); a.status = 'cancelled'; a.cancelledAt = state.now; break;
    case 'SUBMIT_REVIEW': {
      a = activity(state, action.activityId);
      check(a.status === 'completed', 'ACTIVITY_NOT_COMPLETED', '実施確認と配布が完了した活動を振り返れます。');
      actor(state, action.fromActorId); actor(state, action.toActorId);
      var task = getReviewTasks(state, a.id, action.fromActorId).find(function (t) { return t.toActorId === action.toActorId; });
      check(task, 'INVALID_REVIEW_PAIR', 'この活動で関わった相手を指定してください。');
      check(!task.submitted, 'ALREADY_REVIEWED', 'この相手への振り返りは提出済みです。');
      check(task.status !== 'expired', 'REVIEW_EXPIRED', '振り返りの受付期間は終了しました。未回答は低評価として扱いません。');
      var answers = {};
      Object.keys(ANSWERS).forEach(function (key) {
        var value = action.answers && action.answers[key] !== undefined ? action.answers[key] : null;
        check(value === null || ANSWERS[key].includes(value), 'INVALID_REVIEW', '振り返りの回答形式が正しくありません。'); answers[key] = value;
      });
      var report = action.report || '';
      check(typeof report === 'string' && report.length <= 2000, 'INVALID_REPORT', '報告は2000文字以内で入力してください。');
      state.reviews.push({ id: nextId(state, 'review'), activityId: a.id, fromActorId: action.fromActorId,
        toActorId: action.toActorId, answers: answers, at: state.now });
      // 「運営に相談したい」や相談の文章は、締切を待たずに運営へ届く。相手には見せない
      var consult = Object.keys(answers).some(function (key) { return answers[key] === 'consult'; });
      if (report.trim() || consult) state.reports.push({ id: nextId(state, 'report'), activityId: a.id, kind: consult ? 'consult' : 'review',
        fromActorId: action.fromActorId, toActorId: action.toActorId, text: report.trim(), at: state.now, status: 'open' });
      break;
    }
    case 'REPORT_CONCERN': {
      a = activity(state, action.activityId);
      check(a.requiredConfirmers.includes(action.fromActorId), 'NOT_PARTICIPANT', 'この活動の参加者が相談できます。');
      var text = action.text === undefined ? '' : action.text;
      check(typeof text === 'string' && text.trim().length > 0 && text.length <= 2000, 'INVALID_REPORT', '相談の内容を2000文字以内で入力してください。');
      state.reports.push({ id: nextId(state, 'report'), activityId: a.id, kind: 'safety', fromActorId: action.fromActorId,
        toActorId: null, text: text.trim(), at: state.now, status: 'open' });
      break;
    }
    case 'SET_ROLE_CHECK':
      target = actor(state, action.actorId);
      check(action.verifiedBy === 'operator', 'VERIFIER_REQUIRED', '確認事項は運営が記録します。');
      check(CHECK_KEYS.includes(action.check) && typeof action.value === 'boolean', 'INVALID_ROLE_CHECK', '確認する項目を指定してください。');
      target.checks[action.check] = action.value; break;
    case 'REDEEM': {
      target = actor(state, action.actorId || 'me');
      check(target.type !== 'operator', 'OPERATOR_NOT_PARTICIPANT', '運営はポイントを使いません。');
      item = state.catalog.find(function (p) { return p.id === action.productId; });
      check(item, 'UNKNOWN_PRODUCT', '交換先が見つかりません。');
      check(target.type !== 'organization' || item.kind !== 'tangible', 'ORGANIZATION_TANGIBLE_FORBIDDEN', '団体のポイントは、担当者個人の商品ではなく、Space内の特典に使えます。');
      check(item.stock > 0, 'OUT_OF_STOCK', 'この見本の交換枠は終了しました。');
      check(target.balance >= item.points, 'INSUFFICIENT_POINTS', '交換に必要なポイントが不足しています。通常の依頼は利用できます。');
      target.balance -= item.points; item.stock -= 1; state.economy.burned += item.points;
      var redemption = { id: nextId(state, 'redemption'), actorId: target.id, productId: item.id,
        title: item.title, points: item.points, status: 'redeemed', at: state.now, cancelledAt: null, cancelReason: null };
      state.redemptions.push(redemption);
      log(state, 'redeem', { redemptionId: redemption.id, actorId: target.id, productId: item.id, points: item.points, delta: -item.points }); break;
    }
    case 'CANCEL_REDEMPTION': {
      target = state.redemptions.find(function (r) { return r.id === action.redemptionId; });
      check(target, 'UNKNOWN_REDEMPTION', '交換履歴が見つかりません。');
      if (target.status === 'cancelled') break;
      var reason = action.reason || 'user';
      check(reason === 'user' || reason === 'unavailable', 'INVALID_REASON', '取消の理由が正しくありません。');
      if (reason === 'unavailable') check(action.actorId === 'operator', 'OPERATOR_REQUIRED', '提供できなかったときの取消は運営が記録します。');
      else if (action.actorId) check(action.actorId === target.actorId, 'NOT_REDEMPTION_OWNER', '交換した本人が取り消してください。');
      item = state.catalog.find(function (p) { return p.id === target.productId; });
      actor(state, target.actorId).balance += target.points; item.stock += 1; state.economy.restored += target.points;
      target.status = 'cancelled'; target.cancelledAt = state.now; target.cancelReason = reason;
      log(state, 'refund', { redemptionId: target.id, actorId: target.actorId, productId: item.id, points: target.points, delta: target.points, reason: reason }); break;
    }
    case 'ADVANCE_TIME':
      check(integer(action.days) && action.days > 0 && action.days <= 365, 'INVALID_DAYS', '1〜365日を指定してください。');
      state.now = iso(new Date(state.now).getTime() + action.days * DAY); break;
    default: fail('UNKNOWN_ACTION', '対応していない操作です。');
    }
    assertState(state); return state;
  }
  function assertState(state) {
    check(state && state.version === VERSION && state.localOnly === true, 'INVALID_STATE', 'このデモ用の保存データではありません。');
    check(state.actors && state.config && state.economy && Array.isArray(state.activities) && Array.isArray(state.transactions)
      && Array.isArray(state.catalog) && Array.isArray(state.redemptions) && Array.isArray(state.reviews) && Array.isArray(state.reports),
      'INVALID_STATE', '保存データの形式が正しくありません。');
    iso(state.now);
    check(integer(state.sequence), 'INVALID_STATE', '履歴番号が正しくありません。');
    var totals = {}, issued = 0, burned = 0, restored = 0, reserved = 0;
    Object.keys(DEFAULT_CONFIG).forEach(function (key) { check(integer(state.config[key]), 'INVALID_STATE', '設定値が正しくありません。'); });
    check(state.config.groupMax >= 1 && state.config.groupMax <= 5 && state.config.reviewDelayDays > 0
      && state.config.minVerifiedActivities > 0 && state.config.minTrustedCounterparties > 0,
      'INVALID_STATE', '実証条件の設定が正しくありません。');
    check(state.economy.cap === state.config.issueBudget, 'INVALID_STATE', '発行上限の記録が一致しません。');
    Object.keys(state.actors).forEach(function (id) {
      var a = state.actors[id];
      check(a && a.id === id && typeof a.name === 'string' && ['person', 'organization', 'operator'].includes(a.type) && integer(a.balance) && Array.isArray(a.experiences)
        && a.checks && CHECK_KEYS.every(function (key) { return typeof a.checks[key] === 'boolean'; }), 'INVALID_STATE', '参加者の記録が正しくありません。');
      totals[id] = 0;
    });
    ACTOR_IDS.forEach(function (id) { actor(state, id); });
    check(state.actors.operator.type === 'operator' && Object.keys(state.actors).every(function (id) { return id === 'operator' || state.actors[id].type !== 'operator'; }),
      'INVALID_STATE', '運営の記録が正しくありません。');
    check(state.actors.operator.balance === 0 && state.actors.operator.experiences.length === 0, 'INVALID_STATE', '運営はポイントや活動実績を持ちません。');
    var activityIds = [];
    state.activities.forEach(function (a) {
      check(a && typeof a.id === 'string' && !activityIds.includes(a.id) && ['draft', 'reserved', 'ready', 'completed', 'hold', 'cancelled'].includes(a.status)
        && ['talk', 'club', 'cleanup'].includes(a.scenario) && Array.isArray(a.rewards) && Array.isArray(a.providerIds)
        && Array.isArray(a.receiverIds) && Array.isArray(a.requiredConfirmers) && Array.isArray(a.requiredReviewPairs)
        && a.confirmations && integer(a.reservedPoints) && integer(a.rewardTotal), 'INVALID_STATE', '活動の記録が正しくありません。');
      activityIds.push(a.id);
      check(unique(a.providerIds.concat(a.receiverIds)).length === a.providerIds.length + a.receiverIds.length,
        'INVALID_STATE', '参加者が重複しています。');
      check(a.providerIds.concat(a.receiverIds).every(function (id) { return actor(state, id).type !== 'operator'; }), 'INVALID_STATE', '運営は活動の参加者になりません。');
      check(a.providerIds.length >= 1 && a.receiverIds.length === 1
        && a.providerIds.length <= (a.scenario === 'cleanup' ? state.config.groupMax : 1),
        'INVALID_STATE', '参加者数が活動の条件に合っていません。');
      check(JSON.stringify(a.requiredConfirmers) === JSON.stringify(a.providerIds.concat(a.receiverIds))
        && JSON.stringify(a.requiredReviewPairs) === JSON.stringify(a.providerIds.map(function (id) { return { providerId: id, receiverId: a.receiverIds[0] }; })),
        'INVALID_STATE', '完了確認または評価の相手が活動と一致しません。');
      check(a.rewards.length === a.requiredConfirmers.length && a.rewards.every(function (r, index) {
        return r.actorId === a.requiredConfirmers[index] && r.role === (index < a.providerIds.length ? 'provider' : 'receiver');
      }), 'INVALID_STATE', '配布対象が参加者と一致しません。');
      Object.keys(a.confirmations).forEach(function (id) {
        check(a.requiredConfirmers.includes(id), 'INVALID_STATE', '完了確認者が参加者に含まれていません。'); iso(a.confirmations[id]);
      });
      check(a.preCheck === null || (a.preCheck && a.preCheck.actorId === 'operator'), 'INVALID_STATE', '活動前の確認の記録が正しくありません。');
      if (a.preCheck) iso(a.preCheck.at);
      if (Object.keys(a.confirmations).length || a.verification || a.status === 'ready' || a.status === 'completed')
        check(!!a.preCheck, 'INVALID_STATE', '活動前の確認がないまま完了の確認が記録されています。');
      check(a.holdReason === null || a.holdReason === undefined || HOLD_REASONS.includes(a.holdReason), 'INVALID_STATE', '保留の理由が正しくありません。');
      if (a.verification) { check(a.verification.actorId === 'operator', 'INVALID_STATE', '運営による確認の記録が正しくありません。'); iso(a.verification.at); }
      if (a.status === 'ready' || a.status === 'completed') check(a.verification && a.requiredConfirmers.every(function (id) { return !!a.confirmations[id]; }),
        'INVALID_STATE', '必要な実施確認が不足しています。');
      if (a.status === 'completed') { check(!!a.awardedAt, 'INVALID_STATE', '活動完了日時がありません。'); iso(a.awardedAt); }
      check(a.rewards.reduce(function (sum, r) { actor(state, r.actorId); check(integer(r.points), 'INVALID_STATE', '配布数が正しくありません。'); return sum + r.points; }, 0) === a.rewardTotal,
        'INVALID_STATE', '配布予定の合計が一致しません。');
      var active = ['reserved', 'ready', 'hold'].includes(a.status);
      check(a.reservedPoints === (active ? a.rewardTotal : 0), 'INVALID_STATE', '活動の発行予約が一致しません。');
      reserved += a.reservedPoints;
    });
    Object.keys(state.actors).forEach(function (id) {
      var expected = state.activities.filter(function (a) { return a.status === 'completed' && a.requiredConfirmers.includes(id); });
      var experiences = state.actors[id].experiences;
      check(experiences.length === expected.length && unique(experiences.map(function (e) { return e.activityId; })).length === experiences.length,
        'INVALID_STATE', '活動実績の件数が一致しません。');
      experiences.forEach(function (e) {
        var a = expected.find(function (candidate) { return candidate.id === e.activityId; });
        var role = a && (a.providerIds.includes(id) ? 'provider' : 'receiver');
        check(a && e.scenario === a.scenario && e.role === role && e.at === a.awardedAt
          && JSON.stringify(e.counterpartyIds) === JSON.stringify(role === 'provider' ? a.receiverIds : a.providerIds),
          'INVALID_STATE', '活動実績の内容が一致しません。');
      });
    });
    var reviewPairs = [];
    state.reviews.forEach(function (review) {
      check(review && typeof review.id === 'string' && review.answers, 'INVALID_STATE', '振り返りの記録が正しくありません。');
      var a = activity(state, review.activityId), key = [review.activityId, review.fromActorId, review.toActorId].join('|');
      check(a.status === 'completed' && !reviewPairs.includes(key) && a.requiredReviewPairs.some(function (pair) {
        return pair.providerId === review.fromActorId && pair.receiverId === review.toActorId
          || pair.receiverId === review.fromActorId && pair.providerId === review.toActorId;
      }), 'INVALID_STATE', '振り返りの相手または提出回数が正しくありません。');
      reviewPairs.push(key);
      var submittedAt = new Date(iso(review.at)).getTime(), awardedAt = new Date(a.awardedAt).getTime();
      check(submittedAt >= awardedAt && submittedAt < awardedAt + state.config.reviewDelayDays * DAY,
        'INVALID_STATE', '振り返りの提出日時が受付期間外です。');
      check(Object.keys(review.answers).length === Object.keys(ANSWERS).length, 'INVALID_STATE', '振り返りの回答が正しくありません。');
      Object.keys(ANSWERS).forEach(function (key) {
        check(review.answers[key] === null || ANSWERS[key].includes(review.answers[key]), 'INVALID_STATE', '振り返りの回答が正しくありません。');
      });
    });
    state.reports.forEach(function (r) {
      check(r && typeof r.id === 'string' && ['review', 'consult', 'safety'].includes(r.kind) && typeof r.text === 'string',
        'INVALID_STATE', '運営への相談の記録が正しくありません。');
      check(activity(state, r.activityId).requiredConfirmers.includes(r.fromActorId), 'INVALID_STATE', '相談した人が活動の参加者ではありません。');
    });
    var txnIds = [];
    state.transactions.forEach(function (t) {
      check(t && !txnIds.includes(t.id) && integer(t.points) && ['reserve', 'release', 'award', 'redeem', 'refund'].includes(t.type), 'INVALID_STATE', '取引履歴が正しくありません。');
      txnIds.push(t.id);
      if (['award', 'redeem', 'refund'].includes(t.type)) {
        actor(state, t.actorId);
        var expected = t.type === 'redeem' ? -t.points : t.points;
        check(t.delta === expected, 'INVALID_STATE', '残高増減が一致しません。'); totals[t.actorId] += t.delta;
      }
      if (t.type === 'award') issued += t.points;
      if (t.type === 'redeem') burned += t.points;
      if (t.type === 'refund') restored += t.points;
    });
    Object.keys(totals).forEach(function (id) { check(totals[id] === state.actors[id].balance, 'INVALID_STATE', '残高と履歴が一致しません。'); });
    ['cap', 'issued', 'reserved', 'burned', 'restored'].forEach(function (key) { check(integer(state.economy[key]), 'INVALID_STATE', '台帳の数値が正しくありません。'); });
    check(issued === state.economy.issued && burned === state.economy.burned && restored === state.economy.restored && reserved === state.economy.reserved
      && restored <= burned && issued + reserved <= state.economy.cap, 'INVALID_STATE', '発行・消却・復元の台帳が一致しません。');
    check(getEconomy(state).totalBalances === issued - burned + restored, 'INVALID_STATE', 'ポイント総量が一致しません。');
    state.activities.forEach(function (a) {
      var awards = state.transactions.filter(function (t) { return t.type === 'award' && t.activityId === a.id; });
      check(awards.length === (a.status === 'completed' ? a.rewards.length : 0)
        && awards.every(function (t) { return a.rewards.some(function (r) { return r.actorId === t.actorId && r.points === t.points; }); })
        && unique(awards.map(function (t) { return t.actorId; })).length === awards.length,
        'INVALID_STATE', '完了記録と配布履歴が一致しません。');
    });
    var redemptionIds = [];
    state.redemptions.forEach(function (r) {
      check(r && typeof r.id === 'string' && !redemptionIds.includes(r.id) && ['redeemed', 'cancelled'].includes(r.status)
        && (r.status === 'cancelled' ? ['user', 'unavailable'].includes(r.cancelReason) : r.cancelReason === null),
        'INVALID_STATE', '交換記録が正しくありません。');
      redemptionIds.push(r.id);
      var user = actor(state, r.actorId), product = state.catalog.find(function (p) { return p.id === r.productId; });
      check(product && r.points === product.points && !(user.type === 'organization' && product.kind === 'tangible'),
        'INVALID_STATE', '交換内容または交換対象が正しくありません。');
      var redeemed = state.transactions.filter(function (t) { return t.type === 'redeem' && t.redemptionId === r.id; });
      var refunded = state.transactions.filter(function (t) { return t.type === 'refund' && t.redemptionId === r.id; });
      check(redeemed.length === 1 && refunded.length === (r.status === 'cancelled' ? 1 : 0)
        && redeemed.concat(refunded).every(function (t) { return t.actorId === r.actorId && t.productId === r.productId && t.points === r.points; }),
        'INVALID_STATE', '交換・返還の履歴が一致しません。');
    });
    state.catalog.forEach(function (p) {
      check(integer(p.stock) && integer(p.initialStock) && integer(p.points) && p.points > 0 && ['tangible', 'space'].includes(p.kind),
        'INVALID_STATE', '交換先の設定が正しくありません。');
      var used = state.redemptions.filter(function (r) { return r.productId === p.id && r.status === 'redeemed'; }).length;
      check(p.stock + used === p.initialStock, 'INVALID_STATE', '交換枠と履歴が一致しません。');
    });
    return true;
  }
  return { VERSION: VERSION, DEFAULT_CONFIG: copy(DEFAULT_CONFIG), createState: createState, seed: createState,
    reduce: reduce, reducer: reduce, assertState: assertState, getEconomy: getEconomy,
    getOpportunities: getOpportunities, getTrustSummary: getTrustSummary, getRecords: getRecords,
    getReviewTasks: getReviewTasks, getReviews: getReviews };
});
