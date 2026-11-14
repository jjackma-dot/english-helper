// js/lib/level.js: 레벨테스트 문항 구성(매번 다르게, 최근 문제 제외), Azure 결과 읽기·합치기, 점수 모으기, 토익스피킹·OPIc 환산, 사용량
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIMENSIONS,
  FREE_SECONDS_PER_MONTH,
  LEVELS,
  PARTS,
  TAKERS,
  TOEIC_LEVELS,
  aggregate,
  azureErrorMessage,
  buildTest,
  formatTestDate,
  mergeAzureParts,
  monthKey,
  opicBands,
  opicLevel,
  parseAzureResult,
  pictureUrl,
  promptText,
  readCoverage,
  recentBankIds,
  speakingSeconds,
  takerOf,
  toeicBands,
  toeicLevel,
  toeicScore,
  usageSummary,
} from '../js/lib/level.js';
import { INFO, OPINIONS, PICTURES, QSETS, READ } from '../js/lib/level-bank.js';

/** 같은 seed면 같은 수열 */
function rand(seed) {
  let x = seed >>> 0 || 1;
  return () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

test('응시자 넷, 난이도 둘, 유형 다섯이고 문제 은행은 유형·난이도마다 여덟 개 넘게 있다 (id가 겹치지 않는다)', () => {
  assert.deepEqual(
    TAKERS.map((t) => t.name),
    ['멧돼지', '원숭이', '꿀돼지', '꿀꿀돼지']
  );
  assert.deepEqual(Object.values(LEVELS), ['일반', '쉬움']);
  assert.deepEqual(
    PARTS.map((p) => p.part),
    ['read', 'picture', 'respond', 'info', 'opinion']
  );
  const ids = [];
  for (const lv of ['normal', 'easy']) {
    for (const bank of [READ[lv], QSETS[lv], INFO[lv], OPINIONS[lv]]) {
      assert.ok(bank.length >= 8, `${lv}: ${bank.length}`);
      ids.push(...bank.map((x) => x[0]));
    }
  }
  ids.push(...PICTURES.map((x) => x[0]));
  assert.ok(PICTURES.length >= 8);
  for (const [id, file, desc] of PICTURES) {
    assert.equal(file, `samples/pictures/${id}.jpg`, '사진은 앱에 넣어 둔 파일');
    assert.ok(desc.length > 10, '장면 설명');
  }
  assert.equal(new Set(ids).size, ids.length, '문제 id가 겹친다');
  for (const [, , qs] of [...QSETS.normal, ...QSETS.easy]) assert.equal(qs.length, 3, '질문에 답하기는 질문 셋');
  assert.equal(takerOf('boar').emoji, '🐗');
  assert.equal(takerOf('nobody').name, 'nobody');
});

test('buildTest: 유형 순서대로 7문항(질문에 답하기 셋)을 만들고, 난이도마다 시간이 다르며, 같은 난수면 같은 시험', () => {
  const t = buildTest('normal', new Set(), rand(1));
  assert.deepEqual(
    t.tasks.map((x) => x.part),
    ['read', 'picture', 'respond', 'respond', 'respond', 'info', 'opinion']
  );
  assert.deepEqual(
    t.tasks.map((x) => x.answer),
    [45, 45, 15, 15, 30, 30, 60]
  );
  assert.deepEqual(
    t.tasks.map((x) => x.prep),
    [20, 30, 3, 3, 3, 3, 30]
  );
  assert.equal(t.tasks[5].read, 30, '표 읽는 시간');
  assert.equal(t.bankIds.length, 5);
  assert.equal(t.tasks[0].reference, t.tasks[0].text, '문장 읽기는 읽을 글을 Azure에 준다');
  assert.ok(t.tasks[1].file.startsWith('samples/pictures/') && t.tasks[1].fallback);
  assert.match(pictureUrl(t.tasks[1].file), /\/samples\/pictures\/p\d+\.jpg$/);
  assert.deepEqual(
    t.tasks.slice(2, 5).map((x) => x.n),
    [1, 2, 3]
  );
  assert.ok(t.tasks[2].intro && t.tasks[2].question && t.tasks[5].rows.length >= 2 && t.tasks[6].question);
  assert.deepEqual(buildTest('normal', new Set(), rand(1)).bankIds, t.bankIds);
  assert.notDeepEqual(buildTest('normal', new Set(), rand(2)).bankIds, t.bankIds, '난수가 다르면 다른 문제');

  const e = buildTest('easy', new Set(), rand(1));
  assert.deepEqual(
    e.tasks.map((x) => x.answer),
    [30, 30, 15, 15, 30, 30, 45]
  );
  assert.ok(e.tasks[0].text.length < t.tasks[0].text.length, '쉬움은 읽을 글이 짧다');
  assert.ok(
    e.bankIds.every((id) => /^(re|qe|ie|oe|p)\d+$/.test(id)),
    '쉬움 문제 은행에서'
  );
  assert.equal(buildTest('weird').level, 'normal', '모르는 난이도는 일반');
  assert.equal(speakingSeconds('normal'), 240);
  assert.equal(speakingSeconds('easy'), 195);
});

test('buildTest: 최근에 푼 문제는 피하고, 모두 풀었으면 그중에서 낸다', () => {
  const recent = new Set(READ.normal.slice(0, -1).map((x) => x[0]));
  for (let i = 0; i < 20; i++) {
    const t = buildTest('normal', recent, rand(10 + i));
    assert.equal(t.tasks[0].id, READ.normal.at(-1)[0], '남은 문제 하나만 낸다');
  }
  const all = new Set(READ.normal.map((x) => x[0]));
  const t = buildTest('normal', all, rand(3));
  assert.ok(all.has(t.tasks[0].id), '다 풀었으면 아무거나');
});

test('recentBankIds: 그 응시자의 최근 3번 시험 문제만', () => {
  const results = [
    { taker: 'boar', bankIds: ['r1', 'p1', 'q1', 'i1', 'o1'] },
    { taker: 'monkey', bankIds: ['r2', 'p2', 'q2', 'i2', 'o2'] },
    { taker: 'boar', bankIds: ['r3', 'p3', 'q3', 'i3', 'o3'] },
    { taker: 'boar', bankIds: ['r4', 'p4', 'q4', 'i4', 'o4'] },
    { taker: 'boar', bankIds: ['r5', 'p5', 'q5', 'i5', 'o5'] },
  ];
  const ids = recentBankIds(results, 'boar');
  assert.ok(ids.has('r1') && ids.has('o4') && !ids.has('r5') && !ids.has('r2'));
  assert.equal(recentBankIds([], 'boar').size, 0);
});

test('promptText: 채점에 넘길 지시문', () => {
  const t = buildTest('normal', new Set(), rand(1)).tasks;
  assert.match(promptText(t[0]), /^Read the text aloud: "/);
  assert.match(promptText(t[1]), /Describe the picture[\s\S]*The picture shows/);
  assert.match(promptText(t[2]), /Question 1: /);
  assert.match(promptText(t[5]), /^Information: [\s\S]*Caller: "/);
  assert.equal(promptText(t[6]), t[6].question);
});

test('parseAzureResult·mergeAzureParts: 토막의 점수를 단어 수로 가중 평균하고 글을 잇는다', () => {
  const json = (text, pa, words) =>
    JSON.stringify({ NBest: [{ Display: text, PronunciationAssessment: pa, Words: words }] });
  const a = parseAzureResult(
    json('I like coffee.', { AccuracyScore: 90, FluencyScore: 80, ProsodyScore: 70, CompletenessScore: 100 }, [
      { Word: 'I', PronunciationAssessment: { AccuracyScore: 100, ErrorType: 'None' } },
      { Word: 'like', PronunciationAssessment: { AccuracyScore: 85, ErrorType: 'None' } },
      { Word: 'coffee', PronunciationAssessment: { AccuracyScore: 55, ErrorType: 'Mispronunciation' } },
    ])
  );
  assert.deepEqual(a, {
    text: 'I like coffee.',
    accuracy: 90,
    fluency: 80,
    prosody: 70,
    completeness: 100,
    words: [
      { word: 'I', accuracy: 100, error: 'None' },
      { word: 'like', accuracy: 85, error: 'None' },
      { word: 'coffee', accuracy: 55, error: 'Mispronunciation' },
    ],
  });
  const b = parseAzureResult(
    json('Yes.', { AccuracyScore: 60, FluencyScore: 50, ProsodyScore: 40 }, [{ Word: 'Yes' }])
  );
  assert.equal(b.completeness, null, '자유 답변에는 완성도가 없다');
  assert.deepEqual(b.words, [{ word: 'Yes', accuracy: null, error: 'None' }]);
  assert.equal(parseAzureResult('not json'), null);
  assert.equal(parseAzureResult('{}'), null);
  assert.equal(parseAzureResult(JSON.stringify({ NBest: [{}] }), 'fallback').text, 'fallback');

  const m = mergeAzureParts([a, b]);
  assert.equal(m.transcript, 'I like coffee. Yes.');
  assert.equal(m.scores.pronunciation, 82.5, '(90×3 + 60×1) / 4');
  assert.equal(m.scores.fluency, 72.5);
  assert.equal(m.scores.prosody, 62.5);
  assert.equal(m.scores.completeness, 100, '없는 토막은 빼고');
  assert.equal(m.words.length, 4);
  assert.equal(m.utterances, 2);
  assert.deepEqual(mergeAzureParts([]), {
    transcript: '',
    scores: { pronunciation: 0, fluency: 0, prosody: 0, completeness: null },
    words: [],
    utterances: 0,
  });
});

test('readCoverage: 읽을 글의 낱말 가운데 순서대로 읽힌 비율 (대소문자·문장부호 무시, 빠뜨린 구절은 뺀다)', () => {
  const ref = 'Welcome to the Riverside Public Library. If you need help finding a book, our staff will assist you.';
  const words = (s) => s.split(' ').map((word) => ({ word }));
  assert.equal(
    readCoverage(
      ref,
      words('welcome to the riverside public library if you need help finding a book our staff will assist you')
    ),
    100
  );
  assert.equal(
    readCoverage(ref, words('Welcome to the Riverside Public Library If you need help our staff will assist you')),
    83,
    '3/18 빠짐'
  );
  assert.equal(readCoverage(ref, 'Welcome to the library.'), 22, '받아쓴 글로도');
  assert.equal(readCoverage(ref, []), 0);
  assert.equal(readCoverage('', words('anything')), 100);
  assert.equal(readCoverage("Don't touch, please!", words("don't touch please")), 100, "줄임표(')는 낱말의 일부");
  assert.equal(readCoverage(ref, words('our staff will assist you')), 28, '일부만 읽음 (5/18)');
  assert.equal(readCoverage(ref, words('you assist will staff our')), 11, '순서가 다르면 가장 긴 공통 순서만 (2/18)');
});

test('azureErrorMessage: 한도·키·과다 요청·연결을 구분한다', () => {
  const codes = { AuthenticationFailure: 1, TooManyRequests: 3, ConnectionFailure: 4, ServiceTimeout: 5, Forbidden: 8 };
  assert.match(azureErrorMessage({ code: 8, details: 'Quota exceeded' }, codes), /무료 사용량\(5시간\)을 다 썼어요/);
  assert.match(
    azureErrorMessage({ code: 1, details: 'WebSocket upgrade failed: Unauthorized (401)' }, codes),
    /키나 지역이 맞지 않아요/
  );
  assert.match(azureErrorMessage({ details: 'Forbidden 403' }, codes), /키나 지역/);
  assert.match(azureErrorMessage({ code: 3, details: '' }, codes), /요청이 너무 많아요/);
  assert.match(azureErrorMessage({ code: 4, details: '' }, codes), /연결하지 못했어요/);
  assert.match(
    azureErrorMessage({ code: 6, details: 'Internal server error' }, codes),
    /Azure 음성 평가 오류: Internal server error/
  );
  assert.match(azureErrorMessage({}, codes), /알 수 없는 오류/);
});

test('aggregate: 항목마다 답변 시간으로 가중 평균, 없는 항목은 빼고, 총점은 항목 가중치로', () => {
  const r = aggregate([
    { scores: { pronunciation: 90, fluency: 80, prosody: 70, relevance: 100 }, limit: 45 }, // 문장 읽기: 문법·어휘 없음
    { scores: { pronunciation: 80, fluency: 70, prosody: 60, grammar: 60, vocabulary: 50, relevance: 70 }, limit: 15 },
  ]);
  assert.equal(r.scores.pronunciation, 87.5, '(90×45 + 80×15) / 60');
  assert.equal(r.scores.grammar, 60);
  assert.equal(r.scores.vocabulary, 50);
  assert.equal(r.scores.relevance, 92.5);
  // 0.15·87.5 + 0.15·77.5 + 0.1·67.5 + 0.2·60 + 0.2·50 + 0.2·92.5 = 72.0
  assert.equal(r.total, 72);
  assert.deepEqual(aggregate([]).scores, Object.fromEntries(DIMENSIONS.map((d) => [d.key, null])));
  assert.equal(aggregate([]).total, 0);
  assert.equal(aggregate([{ scores: { grammar: 150, vocabulary: -5 } }]).scores.grammar, 100, '0~100으로 자른다');
  assert.equal(aggregate([{ scores: { grammar: 'x' } }]).scores.grammar, null, '숫자가 아니면 뺀다');
});

test('토익스피킹 예상 점수·등급(11단계)과 OPIc 등급, 등급 띠', () => {
  assert.deepEqual(
    [0, 15, 25, 35, 45, 52, 57, 62, 67, 72, 82, 92, 100].map(
      (v) => `${v}:${toeicScore(v)}${toeicLevel(toeicScore(v))[1]}/${opicLevel(v)}`
    ),
    [
      '0:0NL/NL',
      '15:30NL/NL',
      '25:50NM/NM',
      '35:70NH/NH',
      '45:90IL/IL',
      '52:100IL/IL',
      '57:110IM1/IM1',
      '62:120IM2/IM2',
      '67:130IM3/IM3',
      '72:140IH/IH',
      '82:160AL/AL',
      '92:180AM/AL',
      '100:200AH/AL',
    ]
  );
  assert.equal(toeicLevel(140)[2], 'Intermediate High');
  assert.equal(TOEIC_LEVELS.length, 11);
  const tb = toeicBands();
  assert.deepEqual(tb[0], ['NL', 0, 40]);
  assert.deepEqual(tb.at(-1), ['AH', 200, 201]);
  assert.deepEqual(
    tb.map((b) => b[0]),
    ['NL', 'NM', 'NH', 'IL', 'IM1', 'IM2', 'IM3', 'IH', 'AL', 'AM', 'AH']
  );
  const ob = opicBands();
  assert.deepEqual(ob[0], ['NL', 0, 20]);
  assert.deepEqual(ob.at(-1), ['AL', 80, 100]);
});

test('usageSummary: 이번 달 보낸 시간, 남은 예상 횟수, 달이 바뀌면 처음부터', () => {
  const now = new Date(2026, 10, 13, 10, 0).getTime();
  assert.equal(monthKey(now), '2026-11');
  const u = usageSummary({ month: '2026-11', seconds: 3600 }, now);
  assert.equal(u.usedMin, 60);
  assert.equal(u.freeMin, 300);
  assert.equal(u.percent, 20);
  assert.equal(u.leftSec, FREE_SECONDS_PER_MONTH - 3600);
  assert.deepEqual(u.leftTests, { normal: Math.floor(14400 / 240), easy: Math.floor(14400 / 195) });
  assert.equal(usageSummary({ month: '2026-10', seconds: 9999 }, now).usedSec, 0, '지난달 것은 세지 않는다');
  assert.equal(usageSummary(null, now).leftTests.normal, 75);
  assert.equal(usageSummary({ month: '2026-11', seconds: 99999 }, now).percent, 100);
  assert.equal(formatTestDate(new Date(2026, 10, 7, 23, 39).getTime()), '2026.11.07 23:39');
});
