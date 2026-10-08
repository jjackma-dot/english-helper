import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTutorPrompt, buildAppLaunchUrl, SCENARIOS, LEVELS } from '../js/lib/prompts.js';

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
  const web = buildAppLaunchUrl('chatgpt', prompt);
  assert.equal(web, `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`);

  const intent = buildAppLaunchUrl('chatgpt', prompt, { android: true });
  assert.ok(intent.startsWith('intent://chatgpt.com/?q='));
  assert.match(intent, /#Intent;scheme=https;package=com\.openai\.chatgpt;S\.browser_fallback_url=/);
  assert.ok(intent.endsWith(';end'));
  // 프롬프트 안의 # 이 intent 구문을 깨뜨리지 않아야 한다
  assert.equal(intent.split('#').length, 2);

  const gemini = buildAppLaunchUrl('gemini', prompt, { android: true });
  assert.match(
    gemini,
    /^intent:\/\/gemini\.google\.com\/app#Intent;scheme=https;package=com\.google\.android\.apps\.bard;/
  );
  assert.equal(buildAppLaunchUrl('gemini', prompt), 'https://gemini.google.com/app');
});
