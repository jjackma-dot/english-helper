// AI 회화 대화 내용에서 영어 단어를 길게 눌러 뜻 보기:
// 누른 자리의 단어 고르기(englishWordAt)와, 길게 누르기·짧게 누르기·스크롤을 가짜 DOM과 가짜 시계로 시험한다
import test from 'node:test';
import assert from 'node:assert/strict';
import { englishWordAt } from '../js/lib/lang.js';

const word = (text, offset) => englishWordAt(text, offset)?.word ?? '';

test('englishWordAt: 단어 안·앞뒤 경계를 누르면 그 단어', () => {
  const s = 'Hi there, friend.';
  assert.equal(word(s, 4), 'there');
  assert.equal(word(s, 3), 'there', '단어 바로 앞');
  assert.equal(word(s, 8), 'there', '단어 바로 뒤 (쉼표 앞)');
  assert.equal(word(s, 0), 'Hi', '글 맨 앞');
  assert.equal(word(s, 2), 'Hi', '띄어쓰기 바로 앞은 앞 단어');
  assert.equal(word(s, 16), 'friend', '마침표 바로 앞');
  assert.deepEqual(englishWordAt(s, 12), { word: 'friend', start: 10, end: 16 });
});

test("englishWordAt: 단어 안의 '·-는 한 단어", () => {
  assert.equal(word("I don't know.", 4), "don't");
  assert.equal(word('I don’t know.', 6), 'don’t', '둥근 따옴표');
  assert.equal(word('a well-known actor', 7), 'well-known');
  assert.equal(word("my mother-in-law's car", 5), 'mother-in-law', "하이픈 뒤 's는 빠진다 (단어 탭과 같은 규칙)");
  assert.equal(word("students' books", 3), 'students', '끝의 따옴표는 빼고');
  assert.equal(word('well- known', 5), '', '끝에 붙은 하이픈 뒤는 단어가 아니다');
  assert.equal(word('send me your résumé', 15), 'résumé', '악센트 글자도 한 단어');
  assert.equal(word('a café nearby', 3), 'café');
  assert.equal(word('3×4', 1), '', '곱하기 기호는 글자가 아니다');
});

test('englishWordAt: 한글·문장부호·숫자·빈 글은 단어가 아니다', () => {
  assert.equal(word('Hi, there', 3), '', '쉼표와 띄어쓰기 사이');
  assert.equal(word('...', 1), '');
  assert.equal(word('안녕하세요 hello', 2), '', '한글');
  assert.equal(word('hello 안녕', 7), '');
  assert.equal(word('It costs 2026 won', 11), '', '숫자');
  assert.equal(word('at 3pm', 4), '', '숫자에 붙은 글자');
  assert.equal(word('mp3 file', 1), '');
  assert.equal(word('', 0), '');
  assert.equal(word(null, 0), '');
  assert.equal(word('hi', 5), '', '글 밖');
});

/* ---------- 아주 작은 가짜 DOM: 한 줄짜리 글, 한 글자 = 가로 10px, 세로 0~20px ---------- */

class FakeText {
  nodeType = 3;
  constructor(data, parent) {
    this.data = data;
    this.parentElement = parent;
  }
}
class FakeEl extends EventTarget {
  scrollTop = 0;
  constructor(cls, parent = null) {
    super();
    this.cls = cls;
    this.parent = parent;
    this.text = null;
  }
  setText(s) {
    this.text = new FakeText(s, this);
  }
  get textContent() {
    return this.text?.data ?? '';
  }
  closest(selector) {
    const wanted = selector.split(',').map((s) => s.trim().slice(1));
    for (let e = this; e; e = e.parent) if (wanted.includes(e.cls)) return e;
    return null;
  }
  contains(el) {
    for (let e = el; e; e = e.parent) if (e === this) return true;
    return false;
  }
}

let under = null; // 지금 손가락 밑에 있는 글 (FakeText)
globalThis.window = globalThis;
globalThis.Node = class {};
Node.TEXT_NODE = 3;
globalThis.document = Object.assign(new EventTarget(), {
  // 브라우저처럼 가장 가까운 글자 자리를 준다 (글 옆 빈 곳을 눌러도 글 끝)
  caretPositionFromPoint: (x) =>
    under && { offsetNode: under, offset: Math.max(0, Math.min(under.data.length, Math.round(x / 10))) },
  createRange: () => {
    const r = { start: 0, end: 0 };
    return {
      setStart: (_n, i) => (r.start = i),
      setEnd: (_n, i) => (r.end = i),
      getClientRects: () => [{ left: r.start * 10, right: r.end * 10, top: 0, bottom: 20 }],
    };
  },
});
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const buzz = [];
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'Mozilla/5.0 (Linux; Android 14)', vibrate: (ms) => buzz.push(ms) },
});

const { holdForWord } = await import('../js/components/voice-tutor.js');

function setup() {
  const log = new FakeEl('voice-log');
  const tutor = new FakeEl('bubble', log);
  tutor.setText('Hi there, friend. 좋아요');
  const me = new FakeEl('bubble', log);
  me.setText('I like it');
  const card = new FakeEl('fix-card', log);
  const why = new FakeEl('hint', card);
  why.setText('this is Korean help');
  const outside = new FakeEl('bubble');
  outside.setText('outside words');
  const words = [];
  const holds = [];
  holdForWord(log, {
    selector: '.bubble, .fix-orig, .fix-new',
    onWord: (w, context) => words.push([w, context]),
    onHold: (on, still) => {
      holds.push(on ? [on] : [on, still]);
      if (still) under = null; // 화면처럼 그동안 온 새 말로 내려가 글이 손가락 밑에서 움직인다
    },
  });
  buzz.length = 0;
  return { log, tutor, me, why, outside, words, holds };
}

const ev = (type, init = {}) => Object.assign(new Event(type, { cancelable: true }), init);
const down = (box, x, y = 10) => box.dispatchEvent(ev('pointerdown', { isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: y }));
const move = (box, x, y = 10) => box.dispatchEvent(ev('pointermove', { pointerId: 1, clientX: x, clientY: y }));

test('길게 누르면 그 단어와 말풍선 글 전체로 뜻을 연다 (한 번만)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { log, tutor, words, holds } = setup();
  under = tutor.text;
  down(log, 45); // "there"의 'e'
  t.mock.timers.tick(449);
  assert.equal(words.length, 0, '아직 짧다');
  t.mock.timers.tick(1);
  assert.deepEqual(words, [['there', 'Hi there, friend. 좋아요']]);
  assert.deepEqual(buzz, [10], '짧게 진동');
  assert.deepEqual(holds, [[true], [false, true]], '누르는 동안만 새 말을 따라 내려가지 않는다');

  const menu = ev('contextmenu', { clientX: 45, clientY: 10 });
  log.dispatchEvent(menu);
  assert.ok(menu.defaultPrevented, '휴대폰 길게 누르기 메뉴는 막는다');
  log.dispatchEvent(ev('pointerup'));
  const lift = ev('touchend');
  log.dispatchEvent(lift);
  assert.ok(lift.defaultPrevented, '손을 뗄 때 따라오는 탭이 시트를 닫지 않게');
  t.mock.timers.tick(2000);
  assert.equal(words.length, 1, '뒤늦은 contextmenu·타이머로 두 번 열지 않는다');
});

test('짧게 누르기·움직이기·스크롤은 길게 누르기가 아니다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { log, tutor, me, words, holds } = setup();
  under = tutor.text;

  down(log, 45);
  t.mock.timers.tick(200);
  log.dispatchEvent(ev('pointerup'));
  const tap = ev('touchend');
  log.dispatchEvent(tap);
  t.mock.timers.tick(1000);
  assert.equal(words.length, 0, '짧게 누름');
  assert.ok(!tap.defaultPrevented, '보통 탭은 막지 않는다 (교정 카드의 저장 버튼 등)');
  assert.deepEqual(holds.at(-1), [false, true]);

  under = tutor.text;
  down(log, 45);
  move(log, 48, 14); // 손가락 떨림
  move(log, 45, 30); // 위로 끌어 스크롤
  t.mock.timers.tick(1000);
  assert.equal(words.length, 0, '움직임');
  assert.deepEqual(holds.at(-1), [false, false], '스크롤하다 끝나면 맨 아래로 끌어내리지 않는다');

  under = tutor.text;
  down(log, 45);
  log.dispatchEvent(ev('pointercancel')); // 브라우저가 스크롤을 시작함
  t.mock.timers.tick(1000);
  assert.equal(words.length, 0, 'pointercancel');
  assert.deepEqual(holds.at(-1), [false, false]);

  under = tutor.text;
  down(log, 45);
  log.dispatchEvent(ev('scroll')); // 누르기 직전 새 말을 따라 내려간 스크롤 알림이 늦게 옴 (위치는 그대로)
  log.scrollTop = 40;
  log.dispatchEvent(ev('scroll'));
  t.mock.timers.tick(1000);
  assert.equal(words.length, 0, '글이 손가락 밑에서 움직임');
  assert.deepEqual(holds.at(-1), [false, false]);

  // 누르는 동안 위쪽에 글이 끼어 손가락 밑 단어가 다른 글로 바뀜 (스크롤 위치는 그대로)
  log.scrollTop = 0;
  under = tutor.text;
  down(log, 45);
  under = me.text;
  t.mock.timers.tick(450);
  assert.equal(words.length, 0, '손가락 밑 단어가 바뀌면 열지 않는다');

  under = tutor.text;
  down(log, 45);
  log.dispatchEvent(ev('scroll'));
  t.mock.timers.tick(450);
  assert.deepEqual(words, [['there', 'Hi there, friend. 좋아요']], '위치가 그대로인 스크롤 알림은 무시');
});

test('한글·문장부호·빈 곳·다른 글을 길게 누르면 아무것도 열지 않는다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { log, tutor, me, why, outside, words } = setup();
  const hold = (text, x, y = 10) => {
    under = text;
    down(log, x, y);
    t.mock.timers.tick(450);
  };
  hold(tutor.text, 200); // "좋아요"
  hold(tutor.text, 85); // 쉼표와 띄어쓰기 사이
  hold(me.text, 400); // 말풍선 오른쪽 빈 곳: 가장 가까운 글자 자리는 "it" 끝이지만 손가락 밑에 단어가 없다
  hold(tutor.text, 45, 40); // 줄 아래 빈 곳
  hold(why.text, 20); // 교정 카드의 한국어 설명 칸 (영어여도 단어 찾는 글이 아님)
  hold(outside.text, 20); // 이 대화 칸 밖의 글
  hold(null, 20); // 말풍선 사이 빈 곳
  assert.deepEqual(words, []);
  assert.deepEqual(buzz, [], '진동도 없다');

  hold(me.text, 94); // "it" 끝에서 손가락이 조금 빗나감
  hold(tutor.text, 45, 28); // 줄 바로 아래
  assert.deepEqual(words, [
    ['it', 'I like it'],
    ['there', 'Hi there, friend. 좋아요'],
  ]);
});

test('오른쪽 버튼·두 번째 손가락은 길게 누르기가 아니고, 길게 누르기 메뉴가 먼저 오면 바로 연다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { log, tutor, words } = setup();
  under = tutor.text;
  log.dispatchEvent(ev('pointerdown', { isPrimary: true, button: 2, pointerId: 1, clientX: 45, clientY: 10 }));
  const menu = ev('contextmenu', { clientX: 45, clientY: 10 });
  log.dispatchEvent(menu);
  t.mock.timers.tick(1000);
  assert.ok(menu.defaultPrevented);
  assert.equal(words.length, 0, '오른쪽 버튼');

  down(log, 45);
  log.dispatchEvent(ev('pointerdown', { isPrimary: false, button: 0, pointerId: 2, clientX: 90, clientY: 10 }));
  t.mock.timers.tick(1000);
  assert.equal(words.length, 0, '두 손가락 (확대)');

  down(log, 5);
  t.mock.timers.tick(300);
  log.dispatchEvent(ev('contextmenu', { clientX: 5, clientY: 10 })); // 휴대폰 길게 누르기 시간이 더 짧을 때
  assert.deepEqual(words, [['Hi', 'Hi there, friend. 좋아요']]);
  t.mock.timers.tick(1000);
  assert.equal(words.length, 1, '타이머가 또 열지 않는다');
});
