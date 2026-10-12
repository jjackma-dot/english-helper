// AI 사전 결과를 화면용으로 정리하는 순수 함수 (js/lib/dict-entry.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { entryView, imageQuery } from '../js/lib/dict-entry.js';
import { parsePartialJson } from '../js/lib/partial-json.js';

const FULL = {
  pronunciation: '/rʌn/',
  entries: [
    {
      english: 'run',
      partOfSpeech: '동사',
      korean: '달리다',
      nuance: '가장 흔한 뜻입니다.',
      examples: [{ en: 'I run every morning.', ko: '나는 매일 아침 달린다.' }],
    },
    {
      english: 'run',
      partOfSpeech: '동사',
      korean: '운영하다',
      nuance: '회사·가게에 씁니다.',
      examples: [{ en: 'She runs a cafe.', ko: '그녀는 카페를 운영한다.' }],
    },
  ],
  synonyms: ['sprint', 'manage'],
  tip: 'run a business처럼 씁니다.',
};
const json = JSON.stringify(FULL);
const partialAt = (marker) => parsePartialJson(json.slice(0, json.indexOf(marker)));

test('entryView: 스트리밍 중에는 끝난 뜻과 자라는 중인 마지막 뜻을 구분한다', () => {
  const v = entryView(partialAt('그녀는'));
  assert.equal(v.pronunciation, '/rʌn/');
  assert.equal(v.senses.length, 2);
  assert.equal(v.senses[0].complete, true);
  assert.equal(v.senses[0].korean, '달리다');
  assert.equal(v.senses[1].complete, false);
  assert.deepEqual(v.senses[1].examples, [{ en: 'She runs a cafe.', ko: '' }]);
  assert.deepEqual(v.synonyms, []);
});

test('entryView: 발음은 다 받은 뒤에만, 비슷한 말은 잘렸을 수 있는 마지막 것을 빼고', () => {
  assert.equal(entryView(parsePartialJson('{"pronunciation":"/rʌ')).pronunciation, '');
  assert.equal(entryView(parsePartialJson('{"pronunciation":"/rʌn/","entries":[{"engl')).pronunciation, '/rʌn/');
  assert.deepEqual(entryView(partialAt('anage')).synonyms, ['sprint']);
  assert.deepEqual(entryView(partialAt('run a business')).synonyms, ['sprint', 'manage']);
  assert.equal(entryView(partialAt('run a business')).senses[1].complete, true);
});

test('entryView: 다 받으면 모든 뜻이 끝난 것이고, 빈 값·이상한 값은 걸러 낸다', () => {
  const v = entryView(FULL, { done: true });
  assert.ok(v.senses.every((s) => s.complete));
  assert.equal(v.tip, 'run a business처럼 씁니다.');
  const odd = entryView(
    { entries: [null, { partOfSpeech: '명사' }, { korean: ' 사과 ', examples: [{ ko: '예문 없음' }, 'x'] }] },
    { done: true }
  );
  assert.equal(odd.senses.length, 1);
  assert.equal(odd.senses[0].korean, '사과');
  assert.deepEqual(odd.senses[0].examples, []);
  assert.deepEqual(entryView(undefined), { pronunciation: '', senses: [], synonyms: [], tip: '' });
});

test('entryView: 막 시작한 빈 뜻은 아직 보이지 않는다', () => {
  const v = entryView(parsePartialJson('{"pronunciation":"","entries":[{"english":"apple"},{"eng'));
  assert.equal(v.senses.length, 1);
  assert.equal(v.senses[0].complete, true);
});

test('imageQuery: 영어는 그대로, 한국어는 AI 영어 단어 → 무료 후보 → 한국어 순서', () => {
  assert.equal(imageQuery('apple', 'en', { aiWords: ['x'] }), 'apple');
  assert.equal(imageQuery('사과', 'ko', { aiWords: ['apple', 'apology'], candidates: ['Apple'] }), 'apple');
  assert.equal(imageQuery('사과', 'ko', { aiWords: [], candidates: [' apple ', 'apples'] }), 'apple');
  assert.equal(imageQuery('사과', 'ko', { aiWords: [''], candidates: ['사과하다', 'sorry'] }), 'sorry');
  assert.equal(imageQuery('사과', 'ko', { candidates: ['사과'] }), '사과');
  assert.equal(imageQuery('사과', 'ko'), '사과');
});
