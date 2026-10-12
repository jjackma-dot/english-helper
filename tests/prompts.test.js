import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTutorPrompt,
  buildAppLaunchUrl,
  buildGeminiLiveUrl,
  buildSpokenOpener,
  buildVoiceTutorSystem,
  GEMINI_LIVE_URL,
  SCENARIOS,
  LEVELS,
} from '../js/lib/prompts.js';

test('기본 프롬프트: 수준·교정·한국어 설명·세션 종료 안내 포함', () => {
  const p = buildTutorPrompt({});
  assert.match(p, /English conversation tutor/);
  assert.match(p, /Intermediate \(CEFR B1–B2\)/);
  assert.match(p, /starting with "✏️"/);
  assert.match(p, /in Korean/);
  assert.match(p, /"end session"/);
  assert.match(p, /Greet me and ask your first question/);
});

test('상황극: 역할 유지 + 첫 대사로 시작', () => {
  const p = buildTutorPrompt({ scenario: 'cafe', level: 'beginner' });
  assert.match(p, /barista/);
  assert.match(p, /Stay in character/);
  assert.match(p, /first line in character/);
  assert.match(p, /Beginner/);
});

test('음성 모드: 마크다운·이모지 금지, 교정도 말로', () => {
  const p = buildTutorPrompt({ voice: true, correction: 'each' });
  assert.match(p, /talking by voice/);
  assert.match(p, /A more natural way is/);
  assert.doesNotMatch(p, /✏️/);
});

test('교정 없음 / 한국어 설명 끔', () => {
  const p = buildTutorPrompt({ correction: 'none', koreanHelp: false });
  assert.match(p, /Don't correct my mistakes unless I ask/);
  assert.doesNotMatch(p, /in Korean, but keep/);
  assert.doesNotMatch(p, /my main mistakes/);
});

test('주제·단어장 반영', () => {
  const debate = buildTutorPrompt({ scenario: 'debate', topic: 'Remote work' });
  assert.match(debate, /Topic: Remote work/);

  const review = buildTutorPrompt({
    scenario: 'review',
    words: [{ text: 'give up', meaning: '포기하다\n그만두다' }, { text: 'reluctant' }],
  });
  assert.match(review, /- give up \(포기하다 그만두다\)/);
  assert.match(review, /- reluctant$/m);

  const empty = buildTutorPrompt({ scenario: 'review', words: [] });
  assert.match(empty, /no saved words yet/);
});

test('모든 상황·수준 조합에서 프롬프트가 만들어진다', () => {
  for (const s of SCENARIOS) {
    for (const level of Object.keys(LEVELS)) {
      const p = buildTutorPrompt({ scenario: s.id, level, topic: 'x' });
      assert.ok(p.length > 200, `${s.id}/${level}`);
    }
  }
});

test('앱 실행 주소: 데스크톱은 웹 주소, 안드로이드는 intent + 대체 주소', () => {
  const prompt = 'Hi #1 & "you"';
  const q = encodeURIComponent(prompt);
  assert.equal(buildAppLaunchUrl('chatgpt', prompt), `https://chatgpt.com/?q=${q}&autosend=true`);

  const intent = buildAppLaunchUrl('chatgpt', prompt, { android: true });
  assert.ok(intent.startsWith(`intent://chatgpt.com/?q=${q}&autosend=true#Intent;`));
  assert.match(intent, /#Intent;scheme=https;package=com\.openai\.chatgpt;S\.browser_fallback_url=/);
  // 앱이 없어 웹으로 열 때는 바로 보내지 않는다
  const fallback = decodeURIComponent(intent.match(/S\.browser_fallback_url=([^;]+);/)[1]);
  assert.equal(fallback, `https://chatgpt.com/?q=${q}`);
  assert.ok(intent.endsWith(';end'));
  // 프롬프트 안의 # 이 intent 구문을 깨뜨리지 않아야 한다
  assert.equal(intent.split('#').length, 2);

  // Gemini 화면은 Google 앱 패키지가 연다
  const gemini = buildAppLaunchUrl('gemini', prompt, { android: true });
  assert.ok(
    gemini.startsWith(
      `intent://gemini.google.com/app?q=${q}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;`
    )
  );
  assert.equal(buildAppLaunchUrl('gemini', prompt), `https://gemini.google.com/app?q=${q}`);
});

test('Gemini Live 열기 주소', () => {
  assert.equal(buildGeminiLiveUrl(), GEMINI_LIVE_URL);
  assert.match(GEMINI_LIVE_URL, /target=live/);
  const intent = buildGeminiLiveUrl({ android: true });
  assert.ok(intent.startsWith('intent://gemini.google.com/app?android-min-version=301356232&'));
  assert.match(intent, /target=live#Intent;scheme=https;package=com\.google\.android\.googlequicksearchbox;/);
  assert.equal(decodeURIComponent(intent.match(/S\.browser_fallback_url=([^;]+);/)[1]), GEMINI_LIVE_URL);
});

test('음성 튜터 지시문: Live는 show_correction 도구, 영어로만 말하기', () => {
  const live = buildVoiceTutorSystem({ scenario: 'cafe', correction: 'each', koreanHelp: true });
  assert.match(live, /barista/);
  assert.match(live, /talking by voice/); // 음성용 요청문을 바탕으로
  assert.match(live, /Voice session rules/);
  assert.match(live, /Always answer when I speak/);
  assert.match(live, /1–3 sentences/);
  assert.match(live, /call show_correction with my original sentence/);
  assert.match(live, /Write Korean only in explanation_ko/);
  assert.doesNotMatch(live, /"corrections"/);

  const quiet = buildVoiceTutorSystem({ correction: 'none', koreanHelp: false });
  assert.match(quiet, /Don't call show_correction unless I ask/);
  assert.match(quiet, /Never use Korean/);
  assert.doesNotMatch(quiet, /explanation_ko in Korean/);

  const end = buildVoiceTutorSystem({ correction: 'end' });
  assert.match(end, /When I say "end session", call show_correction for each of my main mistakes/);
});

test('음성 튜터 지시문: 기본 음성 모드는 JSON 답 + 음성 인식 안내', () => {
  const basic = buildVoiceTutorSystem({ correction: 'each' }, { live: false });
  assert.match(basic, /fill in "correction" with my original sentence/);
  assert.match(basic, /"reply" is exactly what you say aloud/);
  assert.match(basic, /Set "correction" to null/);
  assert.match(basic, /speech recognition/);
  assert.doesNotMatch(basic, /show_correction/);

  // 답 하나에 교정은 하나: 끝나고 정리할 때는 가장 중요한 것만 카드로
  const end = buildVoiceTutorSystem({ correction: 'end' }, { live: false });
  assert.match(end, /spoken review of my main mistakes and fill in "correction" with the most important one/);
});

test('음성 모드 첫 문장: 수준·상황·주제·교정 방식', () => {
  const p = buildSpokenOpener({ scenario: 'debate', topic: 'Remote work.', level: 'advanced', correction: 'end' });
  assert.match(p, /^Hi! Please be my English conversation tutor\. I'm an advanced learner\./);
  assert.match(p, /The topic is: Remote work\. /);
  assert.match(p, /review my mistakes at the end/);

  const review = buildSpokenOpener({
    scenario: 'review',
    level: 'beginner',
    correction: 'none',
    words: [{ text: 'give up' }, { text: 'reluctant' }],
  });
  assert.match(review, /I'm a beginner learner\. Help me practice these expressions: give up, reluctant\./);
  assert.match(review, /no corrections/);

  // 선택 입력(추가 요청)은 말로 하기 어려우니 넣지 않는다
  assert.doesNotMatch(buildSpokenOpener({ scenario: 'cafe', topic: '여행 표현 위주' }), /여행/);
  for (const s of SCENARIOS) assert.ok(buildSpokenOpener({ scenario: s.id }).length > 60, s.id);
});
