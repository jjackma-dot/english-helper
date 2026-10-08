import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeSubtitleBuffer,
  detectFormat,
  parseTimestamp,
  parseSubtitles,
  parseTtmlTime,
  pairTracks,
  activeCues,
  cuesInRange,
  reviewWindow,
  lastStartedIndex,
  cleanCueText,
} from '../js/lib/subtitles.js';

test('parseTimestamp: SRT/VTT 시간 형식', () => {
  assert.equal(parseTimestamp('00:01:02,345'), 62.345);
  assert.equal(parseTimestamp('01:00:00.5'), 3600.5);
  assert.equal(parseTimestamp('02:03.040'), 123.04);
  assert.equal(parseTimestamp('1:02:03'), 3723);
  assert.ok(Number.isNaN(parseTimestamp('abc')));
});

test('SRT 파싱: 태그 제거, 여러 줄, CRLF, 빈 줄 누락 복구', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:03,500',
    '<i>Hello there.</i>',
    'How are you?',
    '',
    '2',
    '00:00:04,000 --> 00:00:05,000 X1:100',
    "{\\an8}I'm fine &amp; you?",
    '3',
    '00:00:06,000 --> 00:00:07,000',
    'Great.',
  ].join('\r\n');
  const { format, tracks } = parseSubtitles(srt, 'movie.srt');
  assert.equal(format, 'srt');
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].lang, 'en');
  const cues = tracks[0].cues;
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[0], { start: 1, end: 3.5, text: 'Hello there.\nHow are you?' });
  assert.equal(cues[1].text, "I'm fine & you?");
  assert.equal(cues[2].text, 'Great.');
});

test('WebVTT 파싱: 헤더, 큐 ID, NOTE, 음성 태그, 분:초 형식', () => {
  const vtt = `WEBVTT - sample

NOTE 이 부분은 무시된다

intro
00:01.000 --> 00:02.500 align:start
<v Anna>Hi, <b>Ben</b>!</v>

00:00:03.000 --> 00:00:04.000
<c.yellow>Where are you going?</c>
`;
  const { format, tracks } = parseSubtitles(vtt, 'a.vtt');
  assert.equal(format, 'vtt');
  assert.deepEqual(
    tracks[0].cues.map((c) => [c.start, c.end, c.text]),
    [
      [1, 2.5, 'Hi, Ben!'],
      [3, 4, 'Where are you going?'],
    ]
  );
});

test('SMI 파싱: 영어/한국어 클래스를 트랙으로 분리, &nbsp; 로 끝 시간 결정', () => {
  const smi = `<SAMI><HEAD><STYLE><!--
.ENCC {Name:English; lang:en-US;}
.KRCC {Name:Korean; lang:ko-KR;}
--></STYLE></HEAD><BODY>
<SYNC Start=1000><P Class=ENCC>Good morning.<br>Did you sleep well?
<SYNC Start=1000><P Class=KRCC>좋은 아침.<br>잘 잤어?
<SYNC Start=3000><P Class=ENCC>&nbsp;
<SYNC Start=3000><P Class=KRCC>&nbsp;
<SYNC Start=4000><P Class=ENCC>Yes, thanks.
<SYNC Start=4000><P Class=KRCC>응, 고마워.
<SYNC Start=6000><P Class=ENCC>&nbsp;
</BODY></SAMI>`;
  const { format, tracks } = parseSubtitles(smi, 'x.smi');
  assert.equal(format, 'smi');
  const en = tracks.find((t) => t.lang === 'en');
  const ko = tracks.find((t) => t.lang === 'ko');
  assert.ok(en && ko);
  assert.deepEqual(en.cues, [
    { start: 1, end: 3, text: 'Good morning.\nDid you sleep well?' },
    { start: 4, end: 6, text: 'Yes, thanks.' },
  ]);
  assert.equal(ko.cues[0].text, '좋은 아침.\n잘 잤어?');
  assert.equal(ko.cues[1].start, 4);
  // 마지막 한국어 대사는 지우는 SYNC가 없으므로 4초 기본 길이
  assert.equal(ko.cues[1].end, 8);
});

test('SMI: 한 SYNC 안에 여러 언어 P 태그, 클래스 이름이 없으면 내용으로 언어 추정', () => {
  const smi = `<SAMI><BODY>
<SYNC Start="500"><P Class=AAA>Hello.</P><P Class=BBB>안녕하세요.</P></SYNC>
<SYNC Start="2500"><P Class=AAA>&nbsp;</P><P Class=BBB>&nbsp;</P></SYNC>
</BODY></SAMI>`;
  const { tracks } = parseSubtitles(smi, 'y.smi');
  assert.equal(tracks.length, 2);
  assert.equal(tracks.find((t) => t.id === 'AAA').lang, 'en');
  assert.equal(tracks.find((t) => t.id === 'BBB').lang, 'ko');
  assert.deepEqual(tracks[0].cues[0], { start: 0.5, end: 2.5, text: 'Hello.' });
});

test('TTML 시간 표현식 (틱, 프레임, 단위)', () => {
  assert.equal(parseTtmlTime('10000000t', { tickRate: 10000000 }), 1);
  assert.equal(parseTtmlTime('00:00:01.250'), 1.25);
  assert.equal(parseTtmlTime('00:00:01:15', { frameRate: 30 }), 1.5);
  assert.equal(parseTtmlTime('1500ms'), 1.5);
  assert.equal(parseTtmlTime('2s'), 2);
  assert.ok(Number.isNaN(parseTtmlTime('')));
});

test('TTML/DFXP 파싱 (넷플릭스 스타일 틱 단위, dur 속성, br 줄바꿈)', () => {
  const ttml = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000" xml:lang="en">
<body><div>
<p begin="20000000t" end="45000000t" region="bottom"><span style="s1">I can't believe it.</span><br/>Really?</p>
<p xml:id="p2" begin="50000000t" dur="10000000t">It&apos;s true.</p>
</div></body></tt>`;
  const { format, tracks } = parseSubtitles(ttml, 'ep1.dfxp');
  assert.equal(format, 'ttml');
  assert.equal(tracks[0].lang, 'en');
  assert.deepEqual(tracks[0].cues, [
    { start: 2, end: 4.5, text: "I can't believe it.\nReally?" },
    { start: 5, end: 6, text: "It's true." },
  ]);
});

test('detectFormat: 확장자가 없어도 내용으로 판별', () => {
  assert.equal(detectFormat('WEBVTT\n\n00:01.000 --> 00:02.000\nhi'), 'vtt');
  assert.equal(detectFormat('1\n00:00:01,000 --> 00:00:02,000\nhi'), 'srt');
  assert.equal(detectFormat('<SAMI><BODY><SYNC Start=0>'), 'smi');
  assert.equal(detectFormat('<tt xmlns="http://www.w3.org/ns/ttml">'), 'ttml');
  assert.equal(detectFormat('just text'), null);
  assert.throws(() => parseSubtitles('just text', 'a.txt'), /지원하지 않는/);
  assert.throws(() => parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\n\n', 'a.srt'), /대사를 찾지/);
});

test('decodeSubtitleBuffer: UTF-8 BOM, UTF-16LE, EUC-KR(CP949)', () => {
  const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('안녕 hello', 'utf8')]);
  assert.equal(decodeSubtitleBuffer(utf8.buffer), '안녕 hello');

  const u16 = Buffer.from('﻿자막', 'utf16le');
  assert.equal(decodeSubtitleBuffer(new Uint8Array(u16)), '자막');

  // "안녕" 의 EUC-KR 바이트: BE C8 B3 E7
  const euckr = new Uint8Array([0x3c, 0x50, 0x3e, 0xbe, 0xc8, 0xb3, 0xe7]);
  assert.equal(decodeSubtitleBuffer(euckr.buffer), '<P>안녕');
});

test('pairTracks: 시간이 겹치는 한국어 대사를 붙인다', () => {
  const en = [
    { start: 1, end: 3, text: 'A' },
    { start: 4, end: 6, text: 'B' },
    { start: 10, end: 11, text: 'C' },
  ];
  const ko = [
    { start: 1.1, end: 3.2, text: '가' },
    { start: 2.9, end: 3.4, text: '살짝 겹침' }, // A와 0.1초만 겹침 → 제외
    { start: 4, end: 6, text: '나' },
  ];
  const paired = pairTracks(en, ko);
  assert.equal(paired[0].ko, '가');
  assert.equal(paired[1].ko, '나');
  assert.equal(paired[2].ko, undefined);
  assert.equal(en[0].ko, undefined, '원본 배열을 바꾸지 않는다');
});

test('activeCues / lastStartedIndex / cuesInRange / reviewWindow', () => {
  const cues = [
    { start: 1, end: 3, text: 'one' },
    { start: 2.5, end: 4, text: 'two' },
    { start: 10, end: 12, text: 'three' },
    { start: 20, end: 22, text: 'four' },
  ];
  assert.equal(lastStartedIndex(cues, 0.5), -1);
  assert.equal(lastStartedIndex(cues, 2.6), 1);
  assert.deepEqual(
    activeCues(cues, 2.7).map((c) => c.text),
    ['one', 'two']
  );
  assert.deepEqual(
    activeCues(cues, 5).map((c) => c.text),
    []
  );
  assert.deepEqual(
    cuesInRange(cues, 3.5, 11).map((c) => c.text),
    ['two', 'three']
  );

  const w = reviewWindow(cues, 12.5, 10);
  assert.equal(w.fallback, false);
  assert.deepEqual(
    w.cues.map((c) => c.text),
    ['one', 'two', 'three']
  );

  // 최근 5초가 조용하면 직전 대사 2개
  const quiet = reviewWindow(cues, 19, 5);
  assert.equal(quiet.fallback, true);
  assert.deepEqual(
    quiet.cues.map((c) => c.text),
    ['two', 'three']
  );
  assert.deepEqual(reviewWindow(cues, 0.5, 10).cues, []);
});

test('cleanCueText: 엔티티·태그·공백 정리', () => {
  assert.equal(cleanCueText('<font color="red">Hi&nbsp;there</font><br>  ok  '), 'Hi there\nok');
  assert.equal(cleanCueText('&nbsp;'), '');
});
