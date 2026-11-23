// 영어 방탈출 게임의 규칙·문제·이야기 확인: 팀 코드, 역할, 임무 배정(서로 말해야 풀리는지), 답 맞추기,
// 말한 문장 맞추기, 모든 수준 조합에서 문제 글·정답이 제대로 만들어지는지, 용의자 증거가 범인 한 명을 가리키는지
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVATARS,
  LEVELS,
  assignRoles,
  decodeTeam,
  encodeTeam,
  formatCode,
  hasKeywords,
  jobsOf,
  normalizeSpeech,
  pairOwners,
  rngFor,
  sameAnswer,
  speechScore,
  voicePass,
} from '../js/game/logic.js';
import { buildGame, knownLetters, localJobs, objectRole } from '../js/game/plan.js';
import { ARM_GRID, ARM_STEP, DIRS, FLOWERS, GEAR_IDS, ROOM_PAIRS, josa, ro, uniqueWiring } from '../js/game/puzzles.js';
import {
  CONFESSION,
  QUESTIONS,
  RESOLUTION,
  SUSPECTS,
  answerOf,
  culpritOf,
  denial,
  doorLog,
  evidenceOf,
} from '../js/game/story.js';

const team = (levels, seed = 7) => ({ seed, players: levels.map((level, i) => ({ avatar: AVATARS[i].id, level })) });

/** 수준 조합 전부 (n명) */
function* levelCombos(n) {
  if (n === 0) return yield [];
  for (const rest of levelCombos(n - 1)) for (const lv of LEVELS) yield [...rest, lv];
}

/* ---------- 팀 코드 ---------- */

test('팀 코드는 8글자이고 풀면 같은 팀이 나온다', () => {
  const r = rngFor(1, 'codes');
  for (let i = 0; i < 300; i++) {
    const n = 1 + Math.floor(r() * 4);
    const avatars = [...AVATARS].sort(() => r() - 0.5).slice(0, n);
    const t = {
      seed: Math.floor(r() * 4096),
      players: avatars.map((a) => ({ avatar: a.id, level: LEVELS[Math.floor(r() * 4)] })),
    };
    const code = encodeTeam(t);
    assert.match(code, /^[2-9A-HJ-NP-Z]{8}$/);
    assert.deepEqual(decodeTeam(code), t);
    assert.deepEqual(decodeTeam(formatCode(code).toLowerCase()), t, '하이픈·소문자도 받는다');
  }
});

test('한 글자라도 틀린 코드는 받지 않는다', () => {
  const code = encodeTeam(team(['basic', 'im3']));
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let i = 0; i < 8; i++) {
    for (const ch of alphabet) {
      if (ch === code[i]) continue;
      const bad = code.slice(0, i) + ch + code.slice(i + 1);
      assert.throws(() => decodeTeam(bad), /팀 코드가 맞지 않아요/, bad);
    }
  }
  assert.throws(() => decodeTeam('ABC'), /팀 코드/);
  assert.throws(() => decodeTeam(''), /팀 코드/);
  assert.equal(formatCode(code), `${code.slice(0, 4)}-${code.slice(4)}`);
});

test('같은 얼굴을 두 번 고르거나 5명이면 코드를 만들지 않는다', () => {
  assert.throws(() =>
    encodeTeam({
      seed: 1,
      players: [
        { avatar: 'boar', level: 'basic' },
        { avatar: 'boar', level: 'im1' },
      ],
    })
  );
  assert.throws(() =>
    encodeTeam({ seed: 1, players: AVATARS.slice(0, 5).map((a) => ({ avatar: a.id, level: 'im1' })) })
  );
  assert.throws(() => encodeTeam({ seed: 1, players: [] }));
});

/* ---------- 역할 ---------- */

test('가장 낮은 수준이 핍의 짝꿍(힌트), 가장 높은 수준이 캡틴', () => {
  assert.deepEqual(assignRoles(['im2']), { roles: ['captain'], buddy: 0, captain: 0 });
  const r2 = assignRoles(['im3', 'basic']);
  assert.deepEqual(r2.roles, ['captain', 'buddy']);
  const r4 = assignRoles(['im1', 'im3', 'basic', 'im2']);
  assert.equal(r4.roles[2], 'buddy');
  assert.equal(r4.roles[1], 'captain');
  assert.deepEqual([...r4.roles].sort(), ['buddy', 'captain', 'engineer', 'navigator']);
  const same = assignRoles(['im1', 'im1', 'im1']);
  assert.equal(same.buddy, 0);
  assert.notEqual(same.captain, same.buddy);
});

/* ---------- 임무 배정 ---------- */

test('2명 이상이면 잠금을 풀려면 거의 늘 다른 사람의 단서가 필요하다', () => {
  for (let n = 1; n <= 4; n++) {
    for (let room = 0; room < 4; room++) {
      let self = 0;
      for (let p = 0; p < 4; p++) {
        const o = pairOwners(room, p, n);
        if (o.lock === o.clue) self++;
      }
      // 1명: 모두 혼자, 2·4명: 모두 서로, 3명: 두 임무를 맡은 사람에게 하나만 혼자 풀린다
      assert.equal(self, { 1: 4, 2: 0, 3: 1, 4: 0 }[n], `n=${n} room=${room}`);
      // 모든 사람이 이 방에서 잠금을 하나 이상 푼다
      for (let i = 0; i < n; i++) assert.ok(jobsOf(room, i, n).locks.length >= 1);
    }
  }
});

test('방마다 맡는 임무가 돌아간다 (같은 사람이 늘 같은 짝을 맡지 않는다)', () => {
  const owners = [0, 1, 2, 3].map((room) => pairOwners(room, 0, 4).lock);
  assert.deepEqual(owners, [0, 1, 2, 3]);
});

/* ---------- 답 맞추기 · 말하기 ---------- */

test('잠금 입력 비교', () => {
  assert.ok(sameAnswer('colors', ['red', 'blue'], ['red', 'blue']));
  assert.ok(!sameAnswer('colors', ['blue', 'red'], ['red', 'blue']));
  assert.ok(sameAnswer('keypad', '7 2 5', '725'));
  assert.ok(sameAnswer('shape', 'heart', 'heart'));
  assert.ok(!sameAnswer('shape', 'star', 'heart'));
  assert.ok(sameAnswer('dial', 6, 6));
  assert.ok(sameAnswer('dial', '12', 12));
  assert.ok(!sameAnswer('dial', 5, 6));
  assert.ok(sameAnswer('choice', 'mars', 'mars'));
  assert.ok(sameAnswer('word', 'Grape', ['grapes', 'grape']));
  assert.ok(!sameAnswer('word', '', ['grapes']));
  assert.ok(sameAnswer('multi', ['b', 'a'], ['a', 'b']));
  assert.ok(sameAnswer('clock', { h: '9', m: 30 }, { h: 9, m: 30 }));
  assert.ok(sameAnswer('wires', { red: 2, blue: 3, yellow: 1 }, { red: 2, blue: 3, yellow: 1 }));
  assert.ok(!sameAnswer('wires', { red: 2, blue: 1, yellow: 3 }, { red: 2, blue: 3, yellow: 1 }));
});

test('음성 인식 결과를 너그럽게 맞춘다 (숫자·줄임말·띄어 쓴 합성어·한 글자 틀림)', () => {
  assert.equal(normalizeSpeech("It's 7, 2 and 5!"), 'it is seven two and five');
  assert.equal(speechScore("pip you're fully charged let's go", "Pip, you're fully charged. Let's go!"), 1);
  assert.ok(speechScore('pip fully charged', "Pip, you're fully charged. Let's go!") < 0.7);
  assert.ok(hasKeywords('wake up big bud sun shine', ['sunshine']));
  assert.ok(hasKeywords('could you please open your leaves rainbow', ['rainbow', ['please', 'could']]));
  assert.ok(!hasKeywords('open your leaves', ['rainbow']));
  assert.ok(hasKeywords('charge up pit', [['charge', 'charged'], 'pip']) === false, '세 글자 낱말은 정확해야 한다');
  assert.ok(
    hasKeywords('charge up pipp', [['charge', 'charged'], 'pip']),
    '네 글자로 길게 인식돼도 한 글자 차이는 봐준다'
  );
  assert.ok(hasKeywords('charge up pip', [['charge', 'charged'], 'pip']));
  assert.ok(voicePass('this is station nova the password is rocket over', { keywords: ['rocket'], minWords: 5 }));
  assert.ok(!voicePass('rocket', { keywords: ['rocket'], minWords: 5 }));
  assert.ok(voicePass('the opposite of empty is full', { keywords: [['full']], minWords: 3 }));
});

/* ---------- 모든 수준 조합에서 문제가 제대로 만들어지는지 ---------- */

const BAD_TEXT = /undefined|NaN|null|\[object/;
function checkText(t, where, needKo) {
  assert.ok(t && typeof t.en === 'string' && t.en.trim(), `${where}: 영어 글 없음`);
  assert.doesNotMatch(t.en, BAD_TEXT, `${where}: ${t.en}`);
  if (needKo) {
    assert.ok(typeof t.ko === 'string' && t.ko.trim(), `${where}: 한국어 없음`);
    assert.doesNotMatch(t.ko, BAD_TEXT, `${where}: ${t.ko}`);
  }
}

function checkWidget(lock, where) {
  const e = lock.expected;
  switch (lock.widget) {
    case 'colors':
      assert.equal(e.length, lock.len, where);
      assert.ok(
        e.every((x) => lock.palette.includes(x)),
        where
      );
      break;
    case 'melody':
      assert.equal(e.length, lock.len, where);
      assert.ok(
        e.every((x) => FLOWERS.includes(x)),
        where
      );
      break;
    case 'arrows':
      assert.equal(e.length, lock.len, where);
      assert.ok(
        e.every((x) => DIRS[x]),
        where
      );
      break;
    case 'keypad':
      assert.match(e, new RegExp(`^\\d{${lock.len}}$`), where);
      break;
    case 'dial':
      assert.ok(Number.isInteger(e) && e >= lock.min && e <= lock.max, `${where}: ${e}`);
      break;
    case 'sliders':
      assert.equal(e.length, lock.n, where);
      assert.ok(
        e.every((v) => v >= lock.min && v <= lock.max),
        `${where}: ${e}`
      );
      break;
    case 'switches':
      assert.equal(e.length, lock.n, where);
      assert.ok(
        e.every((v) => v === 'up' || v === 'down'),
        where
      );
      break;
    case 'shape':
    case 'choice':
      assert.ok(lock.options.includes(e), where);
      break;
    case 'multi':
      assert.equal(e.length, lock.pick, where);
      assert.ok(
        e.every((x) => lock.options.includes(x)),
        where
      );
      break;
    case 'word': {
      const alts = Array.isArray(e) ? e : [e];
      assert.ok(
        alts.every((w) => /^[a-z]+$/i.test(w)),
        where
      );
      if (lock.tiles)
        assert.ok(
          [...alts[0].toUpperCase()].every((ch) => lock.tiles.includes(ch)),
          `${where}: 타일에 글자가 없음`
        );
      break;
    }
    case 'clock':
      assert.ok(e.m % 15 === 0 && e.m < 60, where);
      assert.ok(lock.h24 ? e.h >= 0 && e.h <= 23 : e.h >= 1 && e.h <= 12, `${where}: ${e.h}`);
      break;
    case 'wires':
      assert.ok(
        Object.values(e).every((v) => lock.right.some((x) => x.value === v)),
        where
      );
      assert.equal(new Set(Object.values(e)).size, 3, where);
      break;
    case 'voice':
      assert.ok(
        lock.voice.keywords.some((k) => (Array.isArray(k) ? k : [k]).includes(e)),
        `${where}: 말할 단어`
      );
      break;
    default:
      assert.fail(`${where}: 알 수 없는 잠금 ${lock.widget}`);
  }
}

test('1~4명, 모든 수준 조합, 여러 시드에서 단서·잠금·힌트·말하기 문장이 빠짐없이 만들어진다', () => {
  let games = 0;
  for (let n = 1; n <= 4; n++) {
    for (const levels of levelCombos(n)) {
      for (const seed of [0, 1, 99, 2024, 4095]) {
        const g = buildGame(team(levels, seed));
        games++;
        assert.equal(g.rooms.length, 4);
        for (const room of g.rooms) {
          assert.match(room.word, /^[A-Z]{4}$/);
          for (const x of room.pairs) {
            const where = `n=${n} ${levels} seed=${seed} ${room.id}/${x.id}`;
            const koClue = x.clueLv !== 'im3';
            const koLock = x.lockLv !== 'im3';
            checkText(x.clue.text, `${where} 단서`, koClue);
            checkText(x.lock.text, `${where} 잠금`, koLock);
            checkText(x.ask, `${where} 묻기`, koLock);
            checkText(x.tell, `${where} 말하기`, koClue);
            assert.equal(x.hints.length, 3, where);
            x.hints.forEach((h, i) => checkText(h, `${where} 힌트${i + 1}`, true));
            checkText(x.def.done, `${where} 완료`, true);
            checkWidget(x.lock, where);
            if (x.lock.widget !== 'voice') {
              const e = x.lock.expected;
              assert.ok(
                sameAnswer(x.lock.widget, Array.isArray(e) && x.lock.widget === 'word' ? e[0] : e, e),
                `${where}: 정답이 통과하지 않음`
              );
            }
            if (x.lock.voice?.say) assert.doesNotMatch(x.lock.voice.say, BAD_TEXT);
            assert.equal(x.letter, room.word[x.p]);
          }
        }
      }
    }
  }
  assert.ok(games > 1500);
});

test('같은 팀 코드면 어느 폰에서나 같은 판이 나온다', () => {
  const t = team(['basic', 'im2', 'im3'], 1234);
  const a = buildGame(decodeTeam(encodeTeam(t)));
  const b = buildGame(t);
  const strip = (g) =>
    JSON.stringify(g.rooms.map((r) => [r.word, r.pairs.map((x) => [x.token, x.lock.expected, x.clue.text])]));
  assert.equal(strip(a), strip(b));
  assert.equal(a.culprit, b.culprit);
  assert.notEqual(strip(buildGame(team(['basic', 'im2', 'im3'], 1235))), strip(a), '시드가 다르면 문제가 달라진다');
});

test('수준이 높을수록 잠금이 한 번 더 생각하게 만든다 (정답 변형)', () => {
  const lv = (level) => buildGame(team([level], 42)).rooms;
  const basic = lv('basic');
  const im2 = lv('im2');
  const im3 = lv('im3');
  const tokenOf = (rooms, r, p) => rooms[r].pairs[p].token;
  // 퓨즈: im2는 거꾸로, im3는 녹은 퓨즈를 예비 퓨즈로
  const f = tokenOf(im2, 0, 0);
  assert.deepEqual(im2[0].pairs[0].lock.expected, [...f.colors].reverse());
  const f3 = tokenOf(im3, 0, 0);
  assert.ok(im3[0].pairs[0].lock.expected.includes(f3.spare));
  assert.deepEqual(basic[0].pairs[0].lock.expected, tokenOf(basic, 0, 0).colors);
  // 사물함: im3는 영어 이름의 글자 수
  const d = tokenOf(im3, 0, 1).digits;
  const len = { 1: 3, 2: 3, 3: 5, 4: 4, 5: 4, 6: 3, 7: 5, 8: 5, 9: 4 };
  assert.equal(im3[0].pairs[1].lock.expected, d.map((x) => len[x]).join(''));
  // 펌프: im2는 +2, im3는 ×2 / 엘리베이터: im2는 +1, im3는 -1
  assert.equal(im2[1].pairs[1].lock.expected, tokenOf(im2, 1, 1).n + 2);
  assert.equal(im3[1].pairs[1].lock.expected, tokenOf(im3, 1, 1).n * 2);
  assert.equal(im2[2].pairs[3].lock.expected, tokenOf(im2, 2, 3).n + 1);
  assert.equal(im3[2].pairs[3].lock.expected, tokenOf(im3, 2, 3).n - 1);
});

test('스위치 im3 문장 6개는 각각 정답 하나만 남긴다', () => {
  // 문장이 말하는 조건을 직접 코드로 적어 6가지 배치 중 하나만 맞는지 본다
  const combos = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ];
  const adj = ([p, q]) => q - p === 1;
  const rules = [
    (c) => adj(c) && c.includes(0),
    (c) => !adj(c) && !c.includes(3),
    (c) => c[0] === 0 && c[1] === 3,
    (c) => c[0] === 1 && c[1] === 2,
    (c) => !adj(c) && !c.includes(0),
    (c) => adj(c) && c.includes(3),
  ];
  rules.forEach((rule, i) => assert.deepEqual(combos.filter(rule), [combos[i]], `문장 ${i + 1}`));
});

test('전선 im3 문장은 바로 알려 주지 않으면서 배선 하나만 남긴다', () => {
  for (let seed = 0; seed < 400; seed++) {
    const t = ROOM_PAIRS[2][1].token(rngFor(seed, 'w'));
    assert.ok(Array.isArray(t.im3) && t.im3.length >= 2, `seed ${seed}`);
    for (const s of t.im3) assert.doesNotMatch(s, /goes to number \d\./, '직접 알려 주는 문장');
  }
  assert.ok(uniqueWiring([(m) => m.red === 1, (m) => m.blue === 2]));
  assert.ok(!uniqueWiring([(m) => m.red === 1]));
});

test('로봇 팔 경로는 격자 밖으로 나가지 않는다', () => {
  for (let seed = 0; seed < 300; seed++) {
    const { moves } = ROOM_PAIRS[2][0].token(rngFor(seed, 'arm'));
    let [x, y] = ARM_GRID.start;
    for (const m of moves) {
      x += ARM_STEP[m][0];
      y += ARM_STEP[m][1];
      assert.ok(x >= 0 && x < ARM_GRID.cols && y >= 0 && y < ARM_GRID.rows, `seed ${seed}: ${moves}`);
    }
  }
});

test('톱니바퀴 id·한국어 조사', () => {
  assert.equal(GEAR_IDS.length, 6);
  assert.equal(josa('빨강', '이에요', '예요'), '빨강이에요');
  assert.equal(josa('보라', '이에요', '예요'), '보라예요');
  assert.equal(josa(3, '이에요', '예요'), '3이에요');
  assert.equal(josa(2, '은', '는'), '2는');
  assert.equal(ro('위'), '위로');
  assert.equal(ro('왼쪽'), '왼쪽으로');
  assert.equal(ro('바깥'), '바깥으로');
});

/* ---------- 이 폰이 할 일 ---------- */

test('이 폰의 플레이어가 볼 단서·풀 잠금, 물체 → 짝, 아는 문 글자', () => {
  const g = buildGame(team(['basic', 'im1', 'im2', 'im3'], 5));
  const jobs = localJobs(g, 0, [1]);
  assert.equal(jobs.locks.length, 1);
  assert.equal(jobs.clues.length, 1);
  assert.notEqual(jobs.locks[0].p, jobs.clues[0].p, '자기 단서로 자기 잠금을 풀지 않는다');
  const all = localJobs(g, 0, [0, 1, 2, 3]);
  assert.equal(all.locks.length, 4);
  assert.equal(objectRole(g, 0, 'radio').side, 'clue');
  assert.equal(objectRole(g, 0, 'fusebox').side, 'lock');
  assert.equal(objectRole(g, 0, 'nothing'), null);
  assert.deepEqual(knownLetters(g, 0, [0, 2]), [g.rooms[0].word[0], '', g.rooms[0].word[2], '']);
});

/* ---------- 용의자 · 증거 ---------- */

test('겉모습 특징 두 가지만 알아도 용의자가 한 명으로 좁혀진다', () => {
  const keys = ['size', 'color', 'kind'];
  for (const s of SUSPECTS) {
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++) {
        const match = SUSPECTS.filter((x) => x[keys[i]] === s[keys[i]] && x[keys[j]] === s[keys[j]]);
        assert.deepEqual(
          match.map((x) => x.id),
          [s.id],
          `${keys[i]}+${keys[j]}`
        );
      }
    // 하나만으로는 둘이 남는다 (추리가 필요하다)
    for (const k of keys) assert.equal(SUSPECTS.filter((x) => x[k] === s[k]).length, 2);
  }
});

test('범인은 시드로 정해지고 판마다 바뀐다', () => {
  const seen = new Set();
  for (let seed = 0; seed < 200; seed++) seen.add(culpritOf(seed));
  assert.deepEqual([...seen].sort(), ['bolt', 'mira', 'momo', 'zeek']);
  assert.equal(culpritOf(77), culpritOf(77));
});

test('증거·출입 기록·대답·고백·반박이 모든 범인에 대해 있다', () => {
  for (const s of SUSPECTS) {
    for (let room = 0; room < 4; room++) {
      const ev = evidenceOf(room, s.id);
      checkText(ev.card, `증거 ${room}`, true);
      for (const l of ev.lines) {
        checkText(l.easy, '증거 대사', true);
        checkText(l.hard, '증거 대사', true);
      }
    }
    const log = doorLog(s.id);
    const opened = log.filter((r) => r.time === '9:05' || r.time === '9:20');
    assert.ok(
      opened.every((r) => r.door.en === s.place.en),
      '범인 방 문만 9:05·9:20에 열렸다'
    );
    for (const q of QUESTIONS)
      for (const hard of [false, true]) checkText(answerOf(s.id, q.id, hard), `${s.id}/${q.id}`, true);
    assert.equal(CONFESSION[s.id].length, 2);
    checkText(RESOLUTION[s.id], 'resolution', true);
    for (const other of SUSPECTS) if (other.id !== s.id) checkText(denial(other.id, s.id), `반박 ${other.id}`, true);
  }
});
