// js/lib/barge-in.js: 스피커로 대화해도 내 목소리로만 튜터 말을 끊는 문(메아리 걸러내기)을 시험한다
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIRM_MS,
  ECHO_MARGIN,
  HOLD_MS,
  MAX_MISSES,
  MISS_RAISE,
  PREROLL_MS,
  SUSTAIN_MS,
  createEchoGate,
  createFarTrack,
  echoSimilarity,
  quantile,
  words,
} from '../js/lib/barge-in.js';

const FRAME = 40;
let clock = 0;
const frame = () => new Int16Array(4);

/** 튜터가 말하는 차례 하나를 흉내 낸다: 학습자는 조용하고 메아리만 level로 들어온다 */
function silentTutorTurn(gate, { far = 0.5, echo = 0.02, frames = 30 } = {}) {
  for (let i = 0; i < frames; i++) gate.push(frame(), { level: echo, far, audible: true, now: (clock += FRAME) });
  gate.push(frame(), { level: 0.005, far: 0, audible: false, now: (clock += FRAME) }); // 차례가 끝남 → 배운다
}

/** 튜터가 말하는 동안 조각 n개를 넣고, 각 조각에서 보낼 조각 수를 돌려준다 */
function talkOver(gate, n, { level, far = 0.5 }) {
  const sent = [];
  for (let i = 0; i < n; i++) sent.push(gate.push(frame(), { level, far, audible: true, now: (clock += FRAME) }));
  return sent;
}

/** 열린 문이 닫힐 때까지 조용한 조각을 넣는다 */
function quietUntilClosed(gate) {
  talkOver(gate, Math.ceil(HOLD_MS / FRAME) + 2, { level: 0.01 });
  assert.equal(gate.open, false);
}

test('튜터가 조용할 때는 모든 조각을 그대로 보낸다', () => {
  const gate = createEchoGate();
  const pcm = frame();
  assert.deepEqual(gate.push(pcm, { level: 0.001, audible: false, now: (clock += FRAME) }), [pcm]);
  assert.deepEqual(gate.push(pcm, { level: 0.4, audible: false, now: (clock += FRAME) }), [pcm]);
});

test('메아리 크기(k)를 배우기 전에는 큰 소리라도 튜터 말 중에는 보내지 않는다 (버튼으로만)', () => {
  const gate = createEchoGate();
  assert.equal(gate.k, null);
  const sent = talkOver(gate, 20, { level: 0.5 });
  assert.ok(sent.every((s) => s.length === 0));
  assert.equal(gate.open, false);
});

test('학습자가 조용했던 튜터 차례에서 메아리 비율을 배우고, 메아리만으로는 열리지 않는다', () => {
  const gate = createEchoGate();
  silentTutorTurn(gate, { far: 0.5, echo: 0.02 });
  assert.ok(Math.abs(gate.k - 0.04) < 1e-9, `k=${gate.k}`);
  // 메아리가 조금 커져도(1.5배) 기준(3배)에는 못 미친다
  const sent = talkOver(gate, 30, { level: 0.03 });
  assert.ok(sent.every((s) => s.length === 0));
  assert.equal(gate.open, false);
});

test('메아리보다 확실히 큰 내 목소리가 이어지면 열고, 붙잡아 둔 직전 소리부터 보낸다', () => {
  const gate = createEchoGate();
  silentTutorTurn(gate);
  talkOver(gate, 3, { level: 0.02 }); // 메아리만 들어오던 직전 조각
  const need = SUSTAIN_MS / FRAME;
  const sent = talkOver(gate, need, { level: 0.3 });
  assert.ok(sent.slice(0, -1).every((s) => s.length === 0), '이어지기 전에는 열지 않는다');
  assert.equal(gate.open, true);
  assert.equal(sent.at(-1).length, Math.min(Math.round(PREROLL_MS / FRAME), need + 3));
  // 열린 뒤에는 조각마다 바로 보낸다
  assert.equal(talkOver(gate, 1, { level: 0.3 })[0].length, 1);
});

test('잠깐 튄 소리는 열지 않는다', () => {
  const gate = createEchoGate();
  silentTutorTurn(gate);
  const sent = [
    ...talkOver(gate, SUSTAIN_MS / FRAME - 1, { level: 0.3 }),
    ...talkOver(gate, 1, { level: 0.02 }),
    ...talkOver(gate, SUSTAIN_MS / FRAME - 1, { level: 0.3 }),
  ];
  assert.ok(sent.every((s) => s.length === 0));
});

test('말을 멈춰도 잠시(HOLD) 더 보내다가 닫는다', () => {
  const gate = createEchoGate();
  silentTutorTurn(gate);
  talkOver(gate, SUSTAIN_MS / FRAME, { level: 0.3 });
  assert.equal(gate.open, true);
  const quiet = talkOver(gate, Math.ceil(HOLD_MS / FRAME) + 2, { level: 0.01 });
  assert.equal(quiet[0].length, 1, '말 사이 쉼은 계속 보낸다');
  assert.equal(gate.open, false);
  assert.equal(quiet.at(-1).length, 0);
});

test('이어폰처럼 메아리가 거의 없으면 보통 목소리로 열린다', () => {
  const gate = createEchoGate();
  silentTutorTurn(gate, { echo: 0.001 });
  assert.ok(gate.k < 0.01);
  talkOver(gate, SUSTAIN_MS / FRAME, { level: 0.08 });
  assert.equal(gate.open, true);
});

test('"말로 끊기"를 끄면 튜터 말 중에는 보내지 않고, 켜면 다시 된다', () => {
  const gate = createEchoGate({ enabled: false });
  silentTutorTurn(gate);
  assert.ok(talkOver(gate, 10, { level: 0.5 }).every((s) => s.length === 0));
  gate.enabled = true;
  talkOver(gate, SUSTAIN_MS / FRAME, { level: 0.5 });
  assert.equal(gate.open, true);
  gate.enabled = false;
  assert.equal(gate.open, false);
});

test('열었는데 내 말 받아쓰기가 없으면 잘못 연 것: 더 깐깐해지고, 세 번이면 버튼 전용', () => {
  const gate = createEchoGate();
  silentTutorTurn(gate);
  const verdicts = [];
  for (let i = 0; i < MAX_MISSES; i++) {
    // 깐깐해져도 열릴 만큼 아주 큰 소리
    talkOver(gate, SUSTAIN_MS / FRAME, { level: 0.95, far: 0.05 });
    assert.equal(gate.open, true, `${i + 1}번째`);
    assert.equal(gate.timeout(clock + CONFIRM_MS - 1), null, '기다리는 동안은 판정하지 않는다');
    verdicts.push(gate.timeout(clock + CONFIRM_MS));
    assert.equal(gate.open, false);
  }
  assert.deepEqual(verdicts, ['miss', 'miss', 'off']);
  assert.ok(Math.abs(gate.margin - ECHO_MARGIN * MISS_RAISE ** MAX_MISSES) < 1e-9);
  assert.equal(gate.buttonOnly, true);
  assert.ok(talkOver(gate, 10, { level: 0.95, far: 0.05 }).every((s) => s.length === 0));
  // 튜터가 조용할 때는 여전히 모두 보낸다
  assert.equal(gate.push(frame(), { level: 0.3, audible: false, now: (clock += FRAME) }).length, 1);
});

test('연 뒤 받아쓰기가 튜터 말을 되풀이하면 메아리, 다른 말이면 내 목소리', () => {
  const said = 'So what do you think about the new job offer you got';
  const gate = createEchoGate();
  silentTutorTurn(gate);
  talkOver(gate, SUSTAIN_MS / FRAME, { level: 0.3 });
  assert.equal(gate.heard(' what', said), 'wait', '한 낱말로는 판정을 미룬다');
  assert.equal(gate.heard(' do you think', said), 'miss');
  assert.equal(gate.misses, 1);
  assert.equal(gate.heard(' anything', said), null, '확인할 일이 없으면 null');

  talkOver(gate, SUSTAIN_MS / FRAME, { level: 0.95 });
  assert.equal(gate.heard('I am not sure yet', said), 'real');
  assert.equal(gate.timeout(clock + CONFIRM_MS * 2), null, '확인된 뒤에는 시간이 지나도 잘못 연 것이 아니다');
  assert.equal(gate.misses, 1);
});

test('한국어로 끼어들거나 짧게 대답해도 잘못 연 것으로 세지 않는다', () => {
  const said = 'Okay, do you like coffee or tea? Let me know what you think.';
  const gate = createEchoGate();
  silentTutorTurn(gate);
  talkOver(gate, SUSTAIN_MS / FRAME, { level: 0.3 });
  assert.equal(gate.heard(' 그게 무슨 뜻이에요?', said), 'real', '튜터는 영어로만 말하므로 한글은 내 말');

  quietUntilClosed(gate);
  talkOver(gate, SUSTAIN_MS / FRAME, { level: 0.95 });
  assert.equal(gate.heard(' Okay.', said), 'wait');
  assert.equal(gate.timeout(clock + CONFIRM_MS), null, '받아쓰기가 왔으면 서버가 말소리를 들은 것');
  assert.equal(gate.misses, 0);

  quietUntilClosed(gate);
  talkOver(gate, SUSTAIN_MS / FRAME, { level: 0.95 });
  assert.equal(gate.heard('I like coffee', said), 'real', '튜터 말을 조금 따라 한 대답');
  assert.equal(gate.misses, 0);
});

test('한 차례에 목소리가 섞여도 메아리 비율은 조금만 오른다', () => {
  const gate = createEchoGate({ enabled: false }); // 문이 열리지 않게 해서 큰 소리로도 배우게 한다
  silentTutorTurn(gate, { echo: 0.02 }); // k = 0.04
  // 다음 차례 내내 큰 소리(0.5 ÷ 0.5 = 1)가 들어와도 한 번에 1.5배까지만
  silentTutorTurn(gate, { echo: 0.5 });
  assert.ok(Math.abs(gate.k - 0.06) < 1e-9, `k=${gate.k}`);
  // 첫 차례에 목소리가 조금(5분의 1) 섞여도 가운데값(메아리)의 3배까지만
  const gate2 = createEchoGate();
  for (let i = 0; i < 30; i++) {
    const level = i < 6 ? 0.3 : 0.02;
    gate2.push(frame(), { level, far: 0.5, audible: true, now: (clock += FRAME) });
  }
  gate2.push(frame(), { level: 0.005, audible: false, now: (clock += FRAME) });
  assert.ok(Math.abs(gate2.k - 0.12) < 1e-9, `k=${gate2.k}`);
});

test('버튼으로 끊으면 그때까지 잰 메아리로 배우고, 끊은 뒤 곧바로 한 내 말은 재지 않는다', () => {
  const gate = createEchoGate();
  talkOver(gate, 15, { level: 0.02 }); // 0.6초 메아리
  gate.endTurn();
  assert.ok(Math.abs(gate.k - 0.04) < 1e-9, `k=${gate.k}`);
  talkOver(gate, 8, { level: 0.3 }); // 끊은 뒤 남은 메아리 동안 바로 말함
  gate.push(frame(), { level: 0.3, audible: false, now: (clock += FRAME) });
  assert.ok(Math.abs(gate.k - 0.04) < 1e-9, `k=${gate.k}`);
});

test('받아쓰기가 한두 낱말이면 판정을 미루고, 맨 앞의 잘린 낱말은 빼고 견준다', () => {
  const said = "What's your favorite season and why do you like it?";
  const gate = createEchoGate();
  silentTutorTurn(gate);
  talkOver(gate, SUSTAIN_MS / FRAME, { level: 0.3 });
  assert.equal(gate.heard(' What', said), 'wait');
  assert.equal(gate.heard(' is', said), 'wait');
  assert.equal(gate.heard(' your favorite', said), 'miss', '줄임말을 풀어 튜터 말과 같다');

  quietUntilClosed(gate);
  talkOver(gate, SUSTAIN_MS / FRAME, { level: 0.3 });
  assert.equal(gate.heard(' vorite season and why', said), 'miss', '직전 소리에서 잘린 첫 낱말은 빼고 본다');

  quietUntilClosed(gate);
  talkOver(gate, SUSTAIN_MS / FRAME, { level: 0.95 });
  assert.equal(gate.heard(' your favorite', said), 'wait');
  assert.equal(gate.timeout(clock + CONFIRM_MS), 'off', '두 낱말 모두 튜터 말 그대로면 메아리 (세 번째)');
});

test('학습자가 끼어든 차례(spoil)로는 메아리 크기를 배우지 않는다', () => {
  const gate = createEchoGate();
  silentTutorTurn(gate, { echo: 0.02 });
  const k = gate.k;
  talkOver(gate, 30, { level: 0.2 }); // 끼어들어 말한 큰 소리
  gate.spoil();
  gate.push(frame(), { level: 0.005, audible: false, now: (clock += FRAME) });
  assert.equal(gate.k, k);
});

test('첫인사처럼 보낼 수 없을 때도 observe로 메아리 크기를 잰다', () => {
  const gate = createEchoGate();
  for (let i = 0; i < 30; i++) gate.observe(0.05, { far: 0.5, audible: true });
  gate.observe(0.005, { audible: false });
  assert.ok(Math.abs(gate.k - 0.1) < 1e-9);
});

test('words·echoSimilarity·quantile', () => {
  assert.deepEqual(words("I'm FINE, thanks!"), ['i', 'am', 'fine', 'thanks'], '줄임말은 풀어서');
  assert.equal(echoSimilarity("what is your favorite season", "What's your favorite season?"), 1);
  assert.deepEqual(words(''), []);
  assert.equal(echoSimilarity('do you think', 'what do you think'), 1);
  assert.equal(echoSimilarity('I went home', 'what do you think'), 0);
  assert.equal(echoSimilarity('think', 'what do you think'), 1);
  assert.equal(echoSimilarity('', 'what'), 0);
  assert.equal(quantile([], 0.5), 0);
  assert.equal(quantile([5, 1, 3, 2, 4], 0.9), 5);
  assert.equal(quantile([5, 1, 3, 2, 4], 0), 1);
});

test('createFarTrack: 예약한 튜터 소리의 크기를 시각별로 기억하고, 멈춘 뒤의 예약은 지운다', () => {
  const far = createFarTrack(0.02);
  const rate = 1000; // 20샘플 = 0.02초
  const loud = new Int16Array(40).fill(16384); // 0.5
  const soft = new Int16Array(40).fill(3277); // 약 0.1
  far.add(1, loud, rate); // 1.00~1.04초
  far.add(1.04, soft, rate); // 1.04~1.08초
  assert.ok(Math.abs(far.level(0.9, 1.01) - 0.5) < 1e-3);
  assert.ok(Math.abs(far.level(1.05, 1.07) - 0.1) < 1e-3);
  assert.equal(far.level(2, 3), 0);
  far.cut(1.04);
  assert.equal(far.level(1.05, 1.07), 0);
  far.prune(1.5);
  assert.equal(far.size, 0);
});
