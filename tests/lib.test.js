import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLang,
  isLookupTerm,
  normalizeTerm,
  splitForTranslation,
  utf8Length,
  decodeEntities,
  stripHtml,
  tokenizeEnglish,
  lemmaCandidates,
} from '../js/lib/lang.js';
import { formatClock, parseClock } from '../js/lib/timefmt.js';
import { PlaybackClock } from '../js/lib/clock.js';
import { encodeWav, downsample, concatFloat32 } from '../js/lib/wav.js';

test('detectLang', () => {
  assert.equal(detectLang('사과'), 'ko');
  assert.equal(detectLang('apple 사과'), 'ko');
  assert.equal(detectLang('apple'), 'en');
  assert.equal(detectLang('123 !!'), null);
});

test('isLookupTerm / normalizeTerm', () => {
  assert.ok(isLookupTerm('give up'));
  assert.ok(isLookupTerm('포기하다'));
  assert.ok(!isLookupTerm('I gave up. It was hard.'));
  assert.ok(!isLookupTerm('one two three four five'));
  assert.equal(normalizeTerm('  "Hello,"  '), 'Hello');
  assert.equal(normalizeTerm('give   up!'), 'give up');
});

test('splitForTranslation: 바이트 한도 지키기 + 내용 보존', () => {
  assert.deepEqual(splitForTranslation('  '), []);
  assert.deepEqual(splitForTranslation('Short text.'), ['Short text.']);

  const ko = '오늘은 날씨가 정말 좋네요. '.repeat(40);
  const chunks = splitForTranslation(ko, 480);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(utf8Length(c) <= 480, `chunk ${utf8Length(c)} bytes`);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), ko.trim().replace(/\s+/g, ' '));

  // 문장부호 없는 긴 문장과 공백 없는 덩어리
  const longWord = 'a'.repeat(1200);
  const parts = splitForTranslation(longWord, 480);
  assert.ok(parts.every((p) => utf8Length(p) <= 480));
  assert.equal(parts.join(''), longWord);
});

test('decodeEntities / stripHtml', () => {
  assert.equal(decodeEntities('It&#39;s &quot;ok&quot; &amp; &#x27;fine&#x27;'), `It's "ok" & 'fine'`);
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
  assert.equal(stripHtml('<a href="x">run</a> <i>fast</i><br>next'), 'run fast\nnext');
});

test('lemmaCandidates: 변화형 → 원형 후보', () => {
  assert.deepEqual(lemmaCandidates('Stopped').slice(0, 2), ['stopped', 'stop']);
  assert.ok(lemmaCandidates('studies').includes('study'));
  assert.ok(lemmaCandidates('watches').includes('watch'));
  assert.ok(lemmaCandidates('liked').includes('like'));
  assert.ok(lemmaCandidates('wanted').includes('want'));
  assert.ok(lemmaCandidates('running').includes('run'));
  assert.ok(lemmaCandidates('making').includes('make'));
  assert.ok(lemmaCandidates("John's").includes('john'));
  assert.deepEqual(lemmaCandidates('class'), ['class']);
  assert.ok(lemmaCandidates('dogs').length <= 4);
});

test('tokenizeEnglish: 축약형·하이픈 단어 유지', () => {
  const t = tokenizeEnglish("I don't know, well-known guy!");
  assert.deepEqual(
    t.filter((x) => x.word).map((x) => x.text),
    ['I', "don't", 'know', 'well-known', 'guy']
  );
  assert.equal(t.map((x) => x.text).join(''), "I don't know, well-known guy!");
});

test('formatClock / parseClock', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(75.4), '1:15');
  assert.equal(formatClock(3723.46, { withTenths: true }), '1:02:03.5');
  assert.equal(formatClock(59.96, { withTenths: true }), '1:00.0');
  assert.equal(parseClock('1:02:03'), 3723);
  assert.equal(parseClock('12:34'), 754);
  assert.equal(parseClock('12:34.5'), 754.5);
  assert.equal(parseClock('90'), 90);
  assert.equal(parseClock('1h2m3s'), 3723);
  assert.equal(parseClock('12분 34초'), 754);
  assert.equal(parseClock('12:75'), null);
  assert.equal(parseClock('abc'), null);
  assert.equal(parseClock(''), null);
});

test('PlaybackClock: 재생/정지/이동/배속', () => {
  let now = 0;
  const c = new PlaybackClock({ now: () => now });
  assert.equal(c.time, 0);
  c.play();
  now = 2000;
  assert.equal(c.time, 2);
  c.shift(-10); // 0 아래로 내려가지 않는다
  assert.equal(c.time, 0);
  now = 5000;
  assert.equal(c.time, 3);
  c.pause();
  now = 9000;
  assert.equal(c.time, 3);
  c.set(100);
  c.setRate(0.5);
  c.play();
  now = 13000;
  assert.equal(c.time, 102);
  c.toggle();
  assert.equal(c.running, false);
});

test('encodeWav: 헤더와 샘플 변환', () => {
  const buf = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(40, true), 8);
  assert.equal(buf.byteLength, 44 + 8);
  assert.equal(v.getInt16(44, true), 0);
  assert.equal(v.getInt16(46, true), 32767);
  assert.equal(v.getInt16(48, true), -32768);
  assert.equal(v.getInt16(50, true), 32767, '범위를 넘는 값은 잘린다');
});

test('downsample / concatFloat32', () => {
  const joined = concatFloat32([new Float32Array([1, 2]), new Float32Array([3, 4, 5, 6])]);
  assert.deepEqual([...joined], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...downsample(joined, 48000, 16000)], [2, 5]);
  assert.equal(downsample(joined, 16000, 16000), joined);
});
