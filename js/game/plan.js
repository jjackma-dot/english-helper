// 팀(시드·플레이어·수준) → 이번 판 전체 (순수 함수, 단위 테스트 대상).
// 같은 팀 코드면 모든 폰이 똑같은 판을 만든다: 방마다 문 단어, 짝마다 정답 재료·단서/잠금 주인·수준별 글, 범인.

import { assignRoles, pairOwners, pick, rngFor } from './logic.js';
import { EXIT_WORDS, ROOM_PAIRS } from './puzzles.js';
import { ROOMS, culpritOf } from './story.js';

/**
 * @param {{seed: number, players: {avatar: string, level: string}[]}} team
 */
export function buildGame(team) {
  const { seed, players } = team;
  const n = players.length;
  const levels = players.map((p) => p.level);
  const { roles, buddy, captain } = assignRoles(levels);
  const rooms = ROOM_PAIRS.map((defs, r) => {
    const word = pick(rngFor(seed, `word${r}`), EXIT_WORDS[r]);
    const pairs = defs.map((def, p) => {
      const token = def.token(rngFor(seed, `r${r}p${p}`));
      const own = pairOwners(r, p, n);
      const clueLv = levels[own.clue];
      const lockLv = levels[own.lock];
      const clue = def.clueView(token, clueLv, (tag) => rngFor(seed, `r${r}p${p}:${tag}`));
      const lock = def.lockView(token, lockLv);
      return {
        id: def.id,
        p,
        def,
        token,
        clueOwner: own.clue,
        lockOwner: own.lock,
        clueLv,
        lockLv,
        clue,
        lock,
        ask: def.ask[lockLv],
        tell: def.tell(token, clueLv),
        hints: def.hints(token, clueLv, lockLv, lock.expected),
        letter: word[p],
      };
    });
    return { ...ROOMS[r], index: r, word, pairs };
  });
  return { seed, players, n, levels, roles, buddy, captain, culprit: culpritOf(seed), rooms };
}

/** 이 폰의 플레이어들(local)이 이 방에서 볼 수 있는 단서·풀 잠금 */
export function localJobs(game, r, local) {
  const pairs = game.rooms[r].pairs;
  return {
    clues: pairs.filter((x) => local.includes(x.clueOwner)),
    locks: pairs.filter((x) => local.includes(x.lockOwner)),
  };
}

/** 장면 물체 → 그 물체가 쓰이는 짝 (단서 또는 잠금) */
export function objectRole(game, r, obj) {
  for (const x of game.rooms[r].pairs) {
    if (x.def.clue.obj === obj) return { pair: x, side: 'clue', owner: x.clueOwner };
    if (x.def.lock.obj === obj) return { pair: x, side: 'lock', owner: x.lockOwner };
  }
  return null;
}

/** 이 폰이 알고 있는 문 글자 (풀어 낸 잠금의 글자만) */
export function knownLetters(game, r, solved) {
  return game.rooms[r].word.split('').map((ch, p) => (solved.includes(p) ? ch : ''));
}
