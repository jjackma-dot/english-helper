// 영어 게임 탭 흐름을 가짜 브라우저(안드로이드)로 시험한다: 처음 화면, 팀 만들기 → 팀 코드, 코드로 참가(틀린 코드),
// 게임 열기 → 이야기 → 내 임무(단서 미니게임·로봇 글자·잠금) 풀기 → 문 글자 → 다음 방, 다른 사람의 임무, 힌트 책(짝꿍),
// 한 폰을 같이 쓰면 가림막·비밀 투표, 마지막 방: 정전 복구 → 용의자 질문 → 잘못 지목 → 맞게 지목 → 마지막 반박
// → 고백 → 방어막 → 수료증(사건의 전말)·기록
import test from 'node:test';
import assert from 'node:assert/strict';
import { installEnv, mount, button, descendants, text } from './platform-env.js';

const env = installEnv({ userAgent: 'Mozilla/5.0 (Linux; Android 16) Chrome/140 Mobile', settings: {} });
// 움직임 줄이기: 문을 지나가는 장면을 짧게
const baseMatch = globalThis.matchMedia;
globalThis.matchMedia = (q) =>
  /reduced-motion/.test(q) ? { matches: true, addEventListener() {}, removeEventListener() {} } : baseMatch(q);
globalThis.performance ??= { now: () => Date.now() };

const view = await import('../js/views/game.js');
const { encodeTeam, decodeTeam } = await import('../js/game/logic.js');
const { buildGame } = await import('../js/game/plan.js');
const { newSave } = await import('../js/game/play.js');
const { culpritOf, suspectOf, herringOf, rebuttal, relayTargets, SECRET } = await import('../js/game/story.js');

const root = mount(view, env.body);
// 게임 화면이 열려 있으면 닫는다 (시계·타이머가 남지 않게)
test.afterEach(() => view.hide());

/** 실제 시간으로 기다린다 (문 여는 장면처럼 수백 ms 걸리는 것) */
async function until(check, what, ms = 4000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error(`기다렸지만 되지 않음: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const all = () => descendants(env.body);
const byClass = (cls) => all().filter((e) => e.classList.contains(cls));
const hotspot = (id) => all().find((e) => e.attributes['data-hot'] === id);
const panelEl = () => byClass('gm-panel')[0];
const save = () => JSON.parse(localStorage.getItem('eh.game.v1'));
const setSave = (s) => localStorage.setItem('eh.game.v1', JSON.stringify(s));

/** 이야기를 넘기면서 조건이 될 때까지 (이야기가 여러 번 이어질 때) */
async function talkUntil(check, what, ms = 6000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error(`기다렸지만 되지 않음: ${what}`);
    await talkThrough();
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function talkThrough() {
  for (let i = 0; i < 20; i++) {
    const next = byClass('gm-next')[0];
    if (!next) return;
    next.click();
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** 잠금 입력 장치에 정답을 넣는다 (방 1의 네 가지: 색·금고 다이얼·모양·스위치) */
function enter(lock) {
  const p = panelEl();
  const opt = (v, cls) =>
    descendants(p)
      .find((e) => e.attributes['data-value'] === String(v) && (!cls || e.classList.contains(cls)))
      .click();
  if (lock.widget === 'colors' || lock.widget === 'keypad') for (const v of lock.expected) opt(v);
  else if (lock.widget === 'safe') for (const v of lock.expected) opt(v, 'gw-safe-num');
  else if (lock.widget === 'shape') opt(lock.expected);
  else if (lock.widget === 'switches') {
    const sw = descendants(p).filter((e) => e.classList.contains('gw-switch'));
    lock.expected.forEach((v, i) => v === 'down' && sw[i].click());
  } else throw new Error(`이 시험은 ${lock.widget}을 넣지 못함`);
  button(p, '확인').click();
}

/**
 * 단서 열기: 처음엔 손 미니게임이 먼저 나온다. 라디오는 다이얼을 신호에 맞추고, 꾹 누르기는 누르고 있고,
 * 먼지 닦기·손전등·조각 돌리기는 가짜 화면에 크기가 없어 바로 끝난다. 혼자면 홀수 번째 단서는 로봇 글자라 핍에게 부탁한다.
 */
async function openClueFully(x) {
  hotspot(x.def.clue.obj).click();
  assert.match(text(panelEl()), /단서 찾기/, '처음엔 미니게임');
  const game = x.def.clue.game;
  if (game === 'tune') {
    await until(() => all().find((e) => e.attributes['data-target']), '주파수 다이얼');
    const dial = all().find((e) => e.attributes['data-target']);
    dial.value = dial.attributes['data-target'];
    dial.dispatchEvent(new Event('input'));
  } else if (game === 'hold') {
    await until(() => byClass('mg-holdbtn').length, '꾹 누르기 버튼');
    byClass('mg-holdbtn')[0].dispatchEvent(new Event('pointerdown'));
  }
  await until(() => /📢 단서|🤖 로봇 글자/.test(text(panelEl())), `${x.id} 단서가 드러남`);
  if (/🤖 로봇 글자/.test(text(panelEl()))) button(panelEl(), '핍에게 부탁하기').click();
  assert.match(text(panelEl()), /📢 단서/);
}

test('처음 화면: 이어하기 없이 새 미션·참가 버튼과 게임 방법', () => {
  assert.ok(button(root, '새 미션 만들기'));
  assert.ok(button(root, '팀 코드로 참가하기'));
  assert.match(text(root), /노바 정거장 SOS/);
  assert.match(text(root), /Basic\(초1·2\)부터 IM3\(중·고\)/);
  assert.ok(!button(root, '이어하기'));
});

test('팀 만들기: 얼굴 두 명·수준 → 팀 코드, 지난 팀 기억', async () => {
  button(root, '새 미션 만들기').click();
  const avatar = (name) => all().find((e) => e.classList.contains('gm-avatar') && e.textContent.includes(name));
  avatar('멧돼지').click();
  avatar('원숭이').click();
  const players = byClass('gm-player');
  assert.equal(players.length, 2);
  descendants(players[1])
    .find((e) => e.tagName === 'BUTTON' && e.textContent === 'IM3')
    .click();
  assert.match(text(root), /핍의 짝꿍/);
  assert.match(text(root), /캡틴/);
  button(root, '팀 만들기').click();
  const code = byClass('gm-code')[0].textContent;
  assert.match(code, /^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  const team = decodeTeam(code);
  assert.deepEqual(
    team.players.map((p) => [p.avatar, p.level]),
    [
      ['boar', 'im1'],
      ['monkey', 'im3'],
    ]
  );
  const prefs = JSON.parse(localStorage.getItem('eh.gamePrefs.v1'));
  assert.equal(prefs.team.length, 2, '지난 팀을 기억');
  button(root, '처음으로').click();
});

test('코드로 참가: 틀린 코드는 알려 주고, 맞는 코드는 이 폰의 사람을 고르게 한다', () => {
  button(root, '팀 코드로 참가하기').click();
  const input = all().find((e) => e.classList.contains('gm-codeinput'));
  input.value = 'ABCD-EFGH';
  button(root, '확인').click();
  assert.match(text(root), /팀 코드가 맞지 않아요/);
  const code = encodeTeam({
    seed: 9,
    players: [
      { avatar: 'honey', level: 'basic' },
      { avatar: 'fox', level: 'im2' },
    ],
  });
  input.value = code.toLowerCase();
  button(root, '확인').click();
  assert.match(text(root), /팀에 참가했어요/);
  const start = button(root, '미션 시작');
  assert.ok(start.disabled, '참가하는 폰은 사람을 골라야 시작');
  descendants(root)
    .find((e) => e.tagName === 'BUTTON' && e.textContent.includes('여우'))
    .click();
  assert.ok(!button(root, '미션 시작').disabled);
  button(root, '처음으로').click();
});

test('게임: 이야기 → 방 1의 내 임무를 모두 풀고 문 글자로 문을 열면 증거 → 다음 방', async () => {
  const code = encodeTeam({ seed: 21, players: [{ avatar: 'boar', level: 'basic' }] });
  setSave(newSave(code, [0]));
  view.show(new URLSearchParams());
  button(root, '이어하기').click();
  assert.ok(byClass('gm-root').length === 1, '전체 화면 게임');
  assert.ok(env.body.classList.contains('gm-lock'));
  await until(() => byClass('gm-talk').length, '이야기 창');
  assert.match(text(byClass('gm-talk')[0]), /Welcome to Station NOVA/);
  await talkThrough();
  await until(() => save().stage === 'play', '방 1 시작');
  const game = buildGame(decodeTeam(code));
  // 혼자라 모든 단서·잠금이 이 폰에 있다
  for (const x of game.rooms[0].pairs) {
    await openClueFully(x);
    assert.equal(save().pipRead[0]?.includes(x.p) ?? false, x.p % 2 === 1, '혼자면 홀수 번째 단서는 핍이 읽어 준다');
    hotspot(x.def.lock.obj).click();
    assert.match(text(panelEl()), /잠금/);
    enter(x.lock);
    await until(() => save().solved[0]?.includes(x.p), `${x.id} 풀림`);
    assert.match(text(panelEl()), new RegExp(`문 글자 ${x.p + 1}번: ${x.letter}`));
  }
  assert.deepEqual(save().clues[0].sort(), [0, 1, 2, 3]);
  // 문: 네 글자를 모두 알아서 바로 열린다
  hotspot('door').click();
  assert.match(text(panelEl()), /네 글자를 모두 알아요/);
  button(panelEl(), '문 열기').click();
  await until(() => byClass('gm-talk').length && save().stage === 'outro', '기억 칩 이야기');
  assert.match(text(byClass('gm-talk')[0]), /memory chip/);
  await talkThrough();
  await until(() => panelEl() && /Memory chip 1/.test(text(panelEl())), '증거 카드');
  const c = suspectOf(culpritOf(21));
  assert.match(text(panelEl()), new RegExp(`The shadow was ${c.size.toUpperCase()}`));
  button(panelEl(), '다음 방으로').click();
  await until(() => save().room === 1 && byClass('gm-talk').length, '방 2 이야기');
  assert.match(text(byClass('gm-talk')[0]), /Space Garden/);
  await talkThrough();
  await until(() => save().stage === 'play', '방 2 시작');
  assert.match(text(root), /2 · Space Garden/);
  view.hide();
  assert.equal(byClass('gm-root').length, 0, '탭을 떠나면 닫고 저장');
  assert.equal(save().room, 1);
});

test('두 명: 다른 사람의 임무는 열리지 않고 영어로 물어보게 한다, 힌트 책은 짝꿍 폰에만', async () => {
  const code = encodeTeam({
    seed: 5,
    players: [
      { avatar: 'boar', level: 'basic' },
      { avatar: 'monkey', level: 'im3' },
    ],
  });
  const s = newSave(code, [1]); // 이 폰: 원숭이(IM3, 캡틴)만
  s.stage = 'play';
  setSave(s);
  view.show(new URLSearchParams());
  button(root, '이어하기').click();
  await until(() => hotspot('door'), '방 그림');
  const game = buildGame(decodeTeam(code));
  const theirs = game.rooms[0].pairs.find((x) => x.lockOwner === 0);
  hotspot(theirs.def.lock.obj).click();
  assert.match(text(panelEl()), /멧돼지의 임무예요/);
  const mine = game.rooms[0].pairs.find((x) => x.lockOwner === 1);
  hotspot(mine.def.lock.obj).click();
  assert.match(text(panelEl()), /멧돼지에게 영어로 물어보세요/, '단서는 멧돼지에게 있다');
  assert.equal(mine.lockLv, 'im3');
  // 힌트: 짝꿍(멧돼지)이 이 폰에 없다
  button(root, '힌트').click();
  assert.match(text(panelEl()), /핍의 짝꿍 🐗 멧돼지의 폰/);
  assert.match(text(panelEl()), /Can you give us a hint, please\?/);
  button(panelEl(), '여기서 볼게요').click();
  descendants(panelEl())
    .find((e) => e.classList.contains('gm-hintrow'))
    .click();
  assert.match(text(panelEl()), /Hint 1/);
  button(panelEl(), '다음 힌트').click();
  assert.match(text(panelEl()), /Hint 2/);
  assert.ok(save().hints[0]);
  view.hide();
});

test('한 폰을 같이 쓰면: 단서는 가림막 뒤에서 주인만 보고, 범인은 한 사람씩 몰래 고른 뒤 3·2·1로 공개', async () => {
  const seed = 12;
  const code = encodeTeam({
    seed,
    players: [
      { avatar: 'boar', level: 'basic' },
      { avatar: 'monkey', level: 'im3' },
    ],
  });
  const s = newSave(code, [0, 1]);
  s.stage = 'play';
  setSave(s);
  view.show(new URLSearchParams());
  button(root, '이어하기').click();
  await until(() => hotspot('door'), '방 그림');
  const game = buildGame(decodeTeam(code));
  const x = game.rooms[0].pairs.find((q) => q.clueOwner === 1);
  hotspot(x.def.clue.obj).click();
  assert.match(text(panelEl()), /원숭이만 보세요/, '가림막');
  assert.doesNotMatch(text(panelEl()), /단서 찾기/);
  button(panelEl(), '원숭이예요, 보여 주세요').click();
  assert.match(text(panelEl()), /단서 찾기/);
  view.hide();

  // 마지막 방 (정전은 이미 복구): 비밀 투표
  const f = newSave(code, [0, 1]);
  f.room = 4;
  f.stage = 'finale';
  f.relayDone = true;
  setSave(f);
  view.show(new URLSearchParams());
  button(root, '이어하기').click();
  await until(() => button(root, '범인 지목'), '마지막 방');
  const pick = (id) =>
    descendants(panelEl()).find((e) => e.classList.contains('gm-pick') && e.textContent.includes(suspectOf(id).name));
  button(root, '범인 지목').click();
  assert.match(text(panelEl()), /멧돼지만 보세요/);
  button(panelEl(), '멧돼지예요, 보여 주세요').click();
  pick('bolt').click();
  assert.match(text(panelEl()), /원숭이만 보세요/, '다음 사람 차례');
  button(panelEl(), '원숭이예요, 보여 주세요').click();
  pick('zeek').click();
  const board = byClass('gm-votes')[0];
  assert.ok(board.hidden, '공개 전에는 아무도 모른다');
  button(panelEl(), '3 · 2 · 1 공개!').click();
  await until(() => !board.hidden, '공개');
  assert.match(text(board), /의견이 갈렸어요/);
  assert.ok(button(board, '👉 Bolt 지목하기') && button(board, '👉 Zeek 지목하기'));
  assert.doesNotMatch(text(board), /다른 폰의 투표/, '모두 이 폰에 있으면 다른 폰 이야기는 없다');
  button(board, '조금 더 조사할래요').click();
  assert.equal(panelEl(), undefined);
  assert.deepEqual(save().accused, [], '지목하지 않았다');
});

test('마지막 방: 정전 복구 → 용의자 질문 → 잘못 지목하면 반박, 맞게 지목하면 마지막 반박 → 고백 → 방어막 → 수료증과 기록', async () => {
  const seed = 33;
  const code = encodeTeam({ seed, players: [{ avatar: 'panda', level: 'im2' }] });
  const s = newSave(code, [0]);
  s.room = 4;
  s.stage = 'finale-intro';
  setSave(s);
  view.show(new URLSearchParams());
  button(root, '이어하기').click();
  // 정전: 혼자면 핍이 무전으로 알려 준 대로 차단기를 맞춘다
  await talkUntil(() => panelEl() && /Blackout/.test(text(panelEl())), '정전');
  assert.match(text(panelEl()), /핍의 무전/);
  const power = button(panelEl(), '전원 켜기');
  assert.ok(power.disabled);
  const want = relayTargets(seed, 1)[0];
  byClass('relay').forEach((sw, k) => want[k] && sw.click());
  assert.ok(!power.disabled, '차단기를 맞추면 전원을 켤 수 있다');
  power.click();
  await talkUntil(() => save().stage === 'finale' && button(root, '범인 지목'), '마지막 방');
  assert.equal(save().relayDone, true);

  const culprit = culpritOf(seed);
  const herring = herringOf(seed);
  const wrong = ['bolt', 'zeek', 'mira', 'momo'].find((x) => x !== culprit && x !== herring);
  const pick = (id) =>
    descendants(panelEl()).find((e) => e.classList.contains('gm-pick') && e.textContent.includes(suspectOf(id).name));
  const ask = async (id, qi) => {
    button(root, '용의자').click();
    pick(id).click();
    descendants(panelEl())
      .filter((e) => e.classList.contains('gm-qcard'))
      [qi].click();
    await until(() => byClass('gm-bubble').length >= 2, '대답');
    return text(panelEl());
  };
  // 질문 카드를 누르면 바로 묻는다
  assert.match(await ask(culprit, 2), /stayed|sleeping|Nope|all night/i, '범인도 계속 있었다고 거짓말');
  // 출입 기록(door)을 물으면: 붉은 청어는 엉뚱한 비밀을, 범인은 얼버무린다
  assert.ok((await ask(herring, 4)).includes(SECRET[herring].en), '붉은 청어의 비밀');
  assert.match(await ask(culprit, 4), /by itself/);

  const vote = (id) => {
    button(root, '범인 지목').click();
    pick(id).click();
    assert.ok(!button(panelEl(), '3 · 2 · 1'), '혼자면 카운트다운 없이 바로');
    button(panelEl(), `👉 ${suspectOf(id).name} 지목하기`).click();
  };
  // 잘못 지목 → 그 용의자가 반박
  vote(wrong);
  await until(() => byClass('gm-talk').length, '반박');
  assert.match(text(byClass('gm-talk')[0]), /It wasn't me|Look at me|I'm a robot|I don't use oil/);
  await talkThrough();
  assert.deepEqual(save().accused, [wrong]);
  // 맞게 지목 → 범인이 붉은 청어에게 뒤집어씌운다 → 맞는 증거로 반박
  vote(culprit);
  await talkUntil(() => panelEl() && /Not me!/.test(text(panelEl())), '마지막 반박');
  assert.match(text(panelEl()), new RegExp(`${suspectOf(herring).name}'s door opened`));
  const rb = rebuttal(culprit, herring);
  const card = (o) =>
    descendants(panelEl()).find((e) => e.classList.contains('gm-qcard') && e.textContent.includes(o.text.en));
  card(rb.options.find((o) => !o.ok)).click();
  assert.match(text(panelEl()), /That proves nothing/, '틀린 증거는 통하지 않는다');
  assert.ok(!button(panelEl(), '증거를 들이대요!'));
  card(rb.options.find((o) => o.ok)).click();
  button(panelEl(), '증거를 들이대요!').click();
  await until(() => byClass('gm-talk').length, '고백');
  await talkUntil(() => panelEl() && /Shields up/.test(text(panelEl())), '방어막');
  button(panelEl(), '다 같이 외쳤어요!').click();
  await talkUntil(() => panelEl() && /Mission complete/.test(text(panelEl())), '수료증');
  const cert = text(panelEl());
  assert.match(cert, new RegExp(`범인: ${suspectOf(culprit).ko}`));
  assert.match(cert, new RegExp(`${suspectOf(herring).ko}의 비밀`));
  assert.match(cert, /사건의 전말/);
  assert.equal(save().stage, 'done');
  const log = JSON.parse(localStorage.getItem('eh.gameLog.v1'));
  assert.equal(log[0].culprit, culprit);
  assert.ok(log[0].stars >= 1);
  button(panelEl(), '게임 홈으로').click();
  assert.equal(byClass('gm-root').length, 0);
  assert.match(text(root), /끝낸 미션/);
});
