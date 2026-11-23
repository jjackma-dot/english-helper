// 방마다 "단서 → 잠금" 짝 4개 (순수 데이터·함수, 단위 테스트 대상).
// 짝마다 token(시드 난수)으로 이번 판의 정답 재료를 만들고, 단서와 잠금은 그것을 맡은 사람의 수준(basic·im1·im2·im3)에 맞춰
// 다르게 보여 준다. 단서를 가진 사람은 영어로 말해 주고(tell), 잠금을 푸는 사람은 영어로 묻는다(ask).
// 수준이 높을수록 영어가 길어지고, 정답을 얻으려면 한 번 더 생각해야 한다(거꾸로·바꿔 넣기·계산·추론).
// 한국어(ko)는 basic·im1·im2에만 있다 (im3는 영어만).

import { pick, randInt, shuffle } from './logic.js';

/* ---------- 공통 재료 ---------- */

export const COLORS = {
  red: { en: 'red', ko: '빨강', adj: '빨간', hex: '#ef4444' },
  blue: { en: 'blue', ko: '파랑', adj: '파란', hex: '#3b82f6' },
  yellow: { en: 'yellow', ko: '노랑', adj: '노란', hex: '#facc15' },
  green: { en: 'green', ko: '초록', adj: '초록', hex: '#22c55e' },
  orange: { en: 'orange', ko: '주황', adj: '주황', hex: '#fb923c' },
  purple: { en: 'purple', ko: '보라', adj: '보라', hex: '#a855f7' },
  pink: { en: 'pink', ko: '분홍', adj: '분홍', hex: '#f472b6' },
};
export const SHAPES = {
  circle: { en: 'circle', ko: '동그라미' },
  triangle: { en: 'triangle', ko: '세모' },
  square: { en: 'square', ko: '네모' },
  heart: { en: 'heart', ko: '하트' },
  star: { en: 'star', ko: '별' },
};
export const FRUITS = {
  apple: { en: 'apple', plural: 'apples', a: 'an apple', ko: '사과' },
  banana: { en: 'banana', plural: 'bananas', a: 'a banana', ko: '바나나' },
  grapes: { en: 'grapes', plural: 'grapes', a: 'some grapes', ko: '포도', alts: ['grape'] },
  orange: { en: 'orange', plural: 'oranges', a: 'an orange', ko: '오렌지' },
  strawberry: { en: 'strawberry', plural: 'strawberries', a: 'a strawberry', ko: '딸기' },
  watermelon: { en: 'watermelon', plural: 'watermelons', a: 'a watermelon', ko: '수박' },
};
export const FLOWERS = ['pink', 'orange', 'yellow', 'blue', 'purple']; // 왼쪽부터 도·레·미·솔·라
export const PLANETS = {
  earth: { en: 'Earth', ko: '지구', order: 3 },
  mars: { en: 'Mars', ko: '화성', order: 4 },
  jupiter: { en: 'Jupiter', ko: '목성', order: 5 },
  saturn: { en: 'Saturn', ko: '토성', order: 6 },
};
export const PLANET_ORDER = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
export const DIRS = {
  up: { en: 'up', ko: '위', arrow: '⬆' },
  down: { en: 'down', ko: '아래', arrow: '⬇' },
  left: { en: 'left', ko: '왼쪽', arrow: '⬅' },
  right: { en: 'right', ko: '오른쪽', arrow: '➡' },
};
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const ORD = ['first', 'second', 'third', 'fourth'];

export const numWord = (n) => NUM[n] ?? String(n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const T = (en, ko = null, extra = {}) => ({ en, ko, ...extra });
const goal = (en) => T(en, null, { goal: true });
const frame = (en, ko) => T(en, ko, { frame: true });
const c = (k) => COLORS[k].en;
const ck = (k) => COLORS[k].ko;
const adj = (k) => COLORS[k].adj;
const spell = (w) => w.toUpperCase().split('').join(', ');

/** 받침이 있으면 a, 없으면 b (숫자는 읽는 소리로) */
export function josa(word, a, b) {
  const s = String(word);
  const ch = s.charCodeAt(s.length - 1);
  if (ch >= 0xac00 && ch <= 0xd7a3) return s + ((ch - 0xac00) % 28 ? a : b);
  if (/[0-9]$/.test(s)) return s + ('013678'.includes(s.at(-1)) ? a : b);
  return s + b;
}

/** 방향 조사: 위로·아래로·왼쪽으로 (받침이 없거나 ㄹ이면 '로') */
export function ro(word) {
  const s = String(word);
  const ch = s.charCodeAt(s.length - 1);
  const jong = ch >= 0xac00 && ch <= 0xd7a3 ? (ch - 0xac00) % 28 : 0;
  return s + (jong === 0 || jong === 8 ? '로' : '으로');
}

/* ---------- 1. 도킹 베이 ---------- */

const SPARE = ['orange', 'purple'];
const fuse = {
  id: 'fuse',
  clue: { obj: 'radio', en: 'Shuttle radio', ko: '셔틀 무전기', icon: '📻' },
  lock: { obj: 'fusebox', en: 'Fuse box', ko: '퓨즈 상자', icon: '🔌' },
  token: (r) => ({
    colors: shuffle(r, ['red', 'blue', 'yellow', 'green']).slice(0, 3),
    melted: randInt(r, 0, 2),
    spare: pick(r, SPARE),
  }),
  clueView({ colors: [a, b, d] }, lv) {
    if (lv === 'basic')
      return {
        art: { type: 'dots', colors: [a, b, d] },
        text: T(`${cap(c(a))}, ${c(b)}, ${c(d)}!`, `${ck(a)}, ${ck(b)}, ${ck(d)}!`),
      };
    if (lv === 'im1')
      return {
        art: { type: 'radio' },
        listen: true,
        text: T(
          `Hello, cadets! This is Captain Luna. Put the fuses in this order: ${c(a)}, ${c(b)}, ${c(d)}.`,
          `안녕, 사관생도들! 루나 선장이야. 퓨즈를 이 순서로 넣어: ${ck(a)}, ${ck(b)}, ${ck(d)}.`
        ),
      };
    if (lv === 'im2')
      return {
        art: { type: 'radio' },
        listen: 'after',
        text: T(
          `Cadets, this is Captain Luna. The fuse order is very important. First, the ${c(b)} fuse... no, wait! Sorry. First the ${c(a)} one, then the ${c(b)} one. The ${c(d)} fuse goes last.`,
          `사관생도들, 루나 선장이야. 퓨즈 순서가 아주 중요해. 먼저 ${ck(b)}… 아니, 잠깐! 미안. 먼저 ${ck(a)}, 그다음 ${ck(b)}. ${ck(d)} 퓨즈는 마지막이야.`
        ),
      };
    return {
      art: { type: 'radio' },
      listen: 'hidden',
      text: T(
        `Captain Luna here. Listen carefully, because the emergency fuses must go in a strict order. The ${c(d)} fuse must never go in before the ${c(b)} one, and the ${c(a)} fuse has to go in before both of them. If you get the order wrong, the system will reset itself.`
      ),
    };
  },
  lockView({ colors, melted, spare }, lv) {
    const palette = ['red', 'blue', 'yellow', 'green'];
    if (lv === 'basic')
      return {
        widget: 'colors',
        palette,
        len: 3,
        expected: colors,
        text: T('Put in the fuses. Tap the colors your friend says.', '퓨즈를 넣어요. 친구가 말하는 색을 차례대로 누르세요.'),
      };
    if (lv === 'im1')
      return {
        widget: 'colors',
        palette,
        len: 3,
        expected: colors,
        text: T(
          'Put the three fuses in the right order. Ask your teammate for the order.',
          '퓨즈 세 개를 바른 순서로 넣어요. 팀원에게 순서를 물어보세요.'
        ),
      };
    if (lv === 'im2')
      return {
        widget: 'colors',
        palette,
        len: 3,
        expected: [...colors].reverse(),
        text: T(
          'Warning! This fuse box is upside down. Put the fuses in the opposite order — the last color goes first.',
          '주의! 이 퓨즈 상자는 거꾸로 달려 있어요. 반대 순서로 넣으세요. 마지막 색이 맨 처음이에요.'
        ),
      };
    const m = colors[melted];
    return {
      widget: 'colors',
      palette: [...palette, spare],
      len: 3,
      expected: colors.map((x) => (x === m ? spare : x)),
      text: T(
        `A note from the engineer: "The ${c(m)} fuse melted during the blackout. Use the spare ${c(spare)} fuse in its place, and keep the order the captain gives you."`
      ),
    };
  },
  ask: {
    basic: T('What colors?', '무슨 색이야?'),
    im1: T('What is the order of the colors?', '색깔 순서가 뭐야?'),
    im2: T('Can you tell me the order of the fuses?', '퓨즈 순서를 알려 줄래?'),
    im3: goal('Find out the fuse order from the radio message.'),
  },
  tell({ colors: [a, b, d] }, lv) {
    if (lv === 'basic') return T(`${cap(c(a))}, ${c(b)}, ${c(d)}!`, `${ck(a)}, ${ck(b)}, ${ck(d)}!`);
    if (lv === 'im1') return T(`The order is ${c(a)}, ${c(b)}, ${c(d)}.`, `순서는 ${ck(a)}, ${ck(b)}, ${ck(d)}야.`);
    if (lv === 'im2') return frame('First ___, then ___, and last ___.', '먼저 ___, 그다음 ___, 마지막은 ___.');
    return goal('Tell your teammate the fuse order.');
  },
  hints({ colors, melted, spare }, clueLv, lockLv, expected) {
    const h1 =
      clueLv === 'im2'
        ? T('Listen to the end. The captain fixes a mistake.', '끝까지 들어요. 선장이 실수를 고쳐 말해요.')
        : clueLv === 'im3'
          ? T('Read the message slowly. Which fuse goes before all the others?', '천천히 읽어요. 어떤 퓨즈가 가장 먼저일까요?')
          : T('Listen to the radio next to the shuttle.', '셔틀 옆 무전기를 들어 봐요.');
    const h2 =
      lockLv === 'im2'
        ? T('The box is upside down. Start with the last color.', '상자가 거꾸로예요. 마지막 색부터 눌러요.')
        : lockLv === 'im3'
          ? T(`Use ${c(spare)} instead of ${c(colors[melted])}.`, `${ck(colors[melted])} 대신 ${josa(ck(spare), '을', '를')} 써요.`)
          : T('Tap the colors in the same order.', '같은 순서로 색을 눌러요.');
    return [h1, h2, T(`The first fuse is ${c(expected[0])}.`, `첫 번째 퓨즈는 ${josa(ck(expected[0]), '이에요', '예요')}.`)];
  },
  done: T('The emergency power is on!', '비상 전원이 켜졌어요!'),
};

const NAME_LEN = (d) => NUM[d].length;
const crates = {
  id: 'crates',
  clue: { obj: 'crates', en: 'Cargo boxes', ko: '화물 상자', icon: '📦' },
  lock: { obj: 'locker', en: 'Locker', ko: '사물함', icon: '🔐' },
  token: (r) => {
    const digits = shuffle(r, [1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 3);
    return { digits, small: [randInt(r, 1, 9), randInt(r, 1, 9)], k: randInt(r, 2, 5), extra: randInt(r, 1, 3) };
  },
  clueView({ digits: [a, b, d], small, k, extra }, lv) {
    if (lv === 'basic')
      return {
        art: { type: 'crates', big: [a, b, d], small: [] },
        text: T(`${cap(numWord(a))}, ${numWord(b)}, ${numWord(d)}!`, `${a}, ${b}, ${d}!`),
      };
    if (lv === 'im1')
      return {
        art: { type: 'crates', big: [a, b, d], small },
        text: T(
          'The locker code is on the BIG boxes. Read the numbers from left to right.',
          '사물함 비밀번호는 큰 상자에 있어요. 왼쪽부터 오른쪽으로 읽어요.'
        ),
      };
    if (lv === 'im2')
      return {
        art: { type: 'paper' },
        text: T(
          `Cargo list: Box A has ${a} space suits. Box B has ${b} helmets. Box C has ${d} pairs of moon boots. The locker code is the number of suits, then helmets, then boots.`,
          `화물 목록: A 상자에는 우주복 ${a}벌, B 상자에는 헬멧 ${b}개, C 상자에는 달 부츠 ${d}켤레가 있어요. 사물함 비밀번호는 우주복, 헬멧, 부츠 수 순서예요.`
        ),
      };
    return {
      art: { type: 'paper' },
      text: T(
        `Cargo report: We loaded ${a + k} space suits, but ${k} of them were sent back to Earth. There are twice as many gloves as helmets, and we have ${2 * b} gloves on board. Finally, there are ${d + extra} pairs of moon boots, but ${extra === 1 ? 'one pair is' : `${extra} pairs are`} too small for anyone, so ${extra === 1 ? 'it does' : 'they do'} not count. The locker code is the number of suits, then helmets, then boots.`
      ),
    };
  },
  lockView({ digits }, lv) {
    const code = digits.join('');
    if (lv === 'basic')
      return {
        widget: 'keypad',
        len: 3,
        expected: code,
        text: T('Open the locker! Type the numbers your friend says.', '사물함을 열어요! 친구가 말하는 숫자를 누르세요.'),
      };
    if (lv === 'im1')
      return {
        widget: 'keypad',
        len: 3,
        expected: code,
        text: T('Type the 3-number code to open the locker.', '숫자 세 개로 된 비밀번호를 눌러 사물함을 여세요.'),
      };
    if (lv === 'im2')
      return {
        widget: 'keypad',
        len: 3,
        expected: [...digits].sort((x, y) => x - y).join(''),
        text: T(
          'The locker screen says: "Type the numbers from the smallest to the biggest."',
          '사물함 화면: "가장 작은 숫자부터 가장 큰 숫자 순서로 누르세요."'
        ),
      };
    return {
      widget: 'keypad',
      len: 3,
      expected: digits.map(NAME_LEN).join(''),
      text: T(
        'Someone who loves words reprogrammed this keypad: "Replace each number with the number of letters in its English name. For example, one becomes 3, because o-n-e has three letters."'
      ),
    };
  },
  ask: {
    basic: T('What numbers?', '숫자가 뭐야?'),
    im1: T('What is the code?', '비밀번호가 뭐야?'),
    im2: T('What are the three numbers?', '숫자 세 개가 뭐야?'),
    im3: goal('Find out the three numbers from the cargo.'),
  },
  tell({ digits: [a, b, d] }, lv) {
    if (lv === 'basic') return T(`${cap(numWord(a))}, ${numWord(b)}, ${numWord(d)}!`, `${a}, ${b}, ${d}!`);
    if (lv === 'im1') return T(`The code is ${numWord(a)}, ${numWord(b)}, ${numWord(d)}.`, `비밀번호는 ${a}, ${b}, ${d}야.`);
    if (lv === 'im2') return frame('The numbers are ___, ___ and ___.', '숫자는 ___, ___, ___야.');
    return goal('Tell your teammate the three numbers.');
  },
  hints(t, clueLv, lockLv, expected) {
    const h1 = {
      basic: T('Look at the boxes next to the shuttle.', '셔틀 옆 상자들을 보세요.'),
      im1: T('Look at the boxes. Only the big boxes count!', '상자를 보세요. 큰 상자만 세요!'),
      im2: T('Read the cargo list on the boxes.', '상자 위 화물 목록을 읽어요.'),
      im3: T('Do the math: loaded minus sent back.', '실은 것에서 돌려보낸 것을 빼요.'),
    }[clueLv];
    const h2 = {
      basic: T('Type the numbers in the same order.', '같은 순서로 누르세요.'),
      im1: T('Type the numbers in the same order.', '같은 순서로 누르세요.'),
      im2: T('Put the numbers from small to big.', '작은 수부터 큰 수로 놓아요.'),
      im3: T('Count the letters: o-n-e has 3 letters.', '글자 수를 세요: o-n-e는 3글자예요.'),
    }[lockLv];
    return [h1, h2, T(`The first number is ${expected[0]}.`, `첫 번째 숫자는 ${josa(expected[0], '이에요', '예요')}.`)];
  },
  done: T('The locker opens! There is a flashlight inside.', '사물함이 열렸어요! 안에 손전등이 있어요.'),
};

const SIGN_SHAPES = ['circle', 'triangle', 'square', 'heart'];
const SHAPE_RIDDLE = {
  circle: T('The station sign has no corners. It is round, like a ball.', '정거장 표시는 모서리가 없어요. 공처럼 둥글어요.'),
  triangle: T('The station sign has three sides and three corners.', '정거장 표시는 변이 세 개, 모서리가 세 개예요.'),
  square: T(
    'The station sign has four sides, and all of them are the same length.',
    '정거장 표시는 변이 네 개이고, 모두 길이가 같아요.'
  ),
  heart: T(
    "The station sign is the shape you often see on Valentine's Day cards.",
    '정거장 표시는 밸런타인데이 카드에서 자주 보는 모양이에요.'
  ),
};
const REJECT_A = {
  circle: 'it looked too much like a warning light',
  triangle: 'it looked like a "danger" sign',
  square: 'it looked as boring as a cardboard box',
  heart: 'it looked like a candy wrapper',
};
const REJECT_B = {
  circle: 'a circle would be hard to see on a round station',
  triangle: 'triangles mean "danger" on most spaceships',
  square: 'every door on the station is already square',
  heart: 'a heart would look silly on a rescue rocket',
};
const charger = {
  id: 'charger',
  clue: { obj: 'window', en: 'Big window', ko: '큰 창문', icon: '🌌' },
  lock: { obj: 'charger', en: "Pip's charger", ko: '핍의 충전기', icon: '🔋' },
  token: (r) => {
    const shape = pick(r, SIGN_SHAPES);
    const others = shuffle(
      r,
      SIGN_SHAPES.filter((s) => s !== shape)
    ).slice(0, 2);
    return { shape, ideas: shuffle(r, [shape, ...others]), rejected: others };
  },
  clueView({ shape, ideas, rejected: [x, y] }, lv) {
    const s = SHAPES[shape];
    if (lv === 'basic')
      return { art: { type: 'stars', shape, lines: true }, text: T(`A ${s.en}!`, `${josa(s.ko, '이에요', '예요')}!`) };
    if (lv === 'im1')
      return {
        art: { type: 'stars', shape, lines: false },
        text: T('Find the brightest stars. What shape do they make?', '가장 밝은 별들을 찾아요. 어떤 모양이 되나요?'),
      };
    if (lv === 'im2') return { art: { type: 'paper' }, text: SHAPE_RIDDLE[shape] };
    const [i1, i2, i3] = ideas;
    return {
      art: { type: 'paper' },
      text: T(
        `When the first crew designed the station sign, they had three ideas: a ${i1}, a ${i2} and a ${i3}. Captain Rao rejected the ${x} because ${REJECT_A[x]}. The engineers loved the ${y}, but they changed their minds when Dr. Kim pointed out that ${REJECT_B[y]}. So they chose the only idea that was left.`
      ),
    };
  },
  lockView({ shape }, lv) {
    const base = { widget: 'shape', options: ['circle', 'triangle', 'square', 'heart', 'star'], expected: shape };
    if (lv === 'basic')
      return { ...base, text: T('Charge Pip! Press the shape your friend says.', '핍을 충전해요! 친구가 말하는 모양을 누르세요.') };
    if (lv === 'im1')
      return {
        ...base,
        voice: { say: 'Charge up, Pip!', keywords: [['charge', 'charged', 'charging', 'charger'], 'pip'] },
        text: T(
          'Press the station sign on Pip\'s charger. Then say: "Charge up, Pip!"',
          '핍의 충전기에서 정거장 표시 모양을 누른 뒤 "Charge up, Pip!"이라고 말하세요.'
        ),
      };
    if (lv === 'im2')
      return {
        ...base,
        voice: { say: "Pip, you're fully charged. Let's go!", target: "Pip you're fully charged let's go" },
        text: T(
          'Press the station sign on the charger. Then say: "Pip, you\'re fully charged. Let\'s go!"',
          '충전기에서 정거장 표시 모양을 누르고 "Pip, you\'re fully charged. Let\'s go!"라고 말하세요.'
        ),
      };
    return {
      ...base,
      voice: {
        question: 'Mmm... I\'m so tired. What is the opposite of "empty"?',
        keywords: [['full', 'fully']],
        minWords: 3,
      },
      text: T('Press the station sign. Sleepy Pip will ask you a question — answer it in a full sentence.'),
    };
  },
  ask: {
    basic: T('What shape?', '무슨 모양이야?'),
    im1: T('What shape is the station sign?', '정거장 표시는 무슨 모양이야?'),
    im2: T('What does the station sign look like?', '정거장 표시는 어떻게 생겼어?'),
    im3: goal('Find out the shape of the station sign.'),
  },
  tell({ shape }, lv) {
    const s = SHAPES[shape];
    if (lv === 'basic') return T(`A ${s.en}!`, `${josa(s.ko, '이야', '야')}!`);
    if (lv === 'im1') return T(`It's a ${s.en}.`, `${josa(s.ko, '이야', '야')}.`);
    if (lv === 'im2') return frame('The sign is a ___.', '표시는 ___야.');
    return goal('Tell your teammate the shape of the station sign.');
  },
  hints({ shape }, clueLv, lockLv) {
    const h1 =
      clueLv === 'basic' || clueLv === 'im1'
        ? T('Look out the big window at the stars.', '큰 창문 밖의 별을 보세요.')
        : clueLv === 'im2'
          ? T('Read the note next to the window. Count the sides.', '창문 옆 쪽지를 읽고 변의 수를 세어 봐요.')
          : T('Three ideas. Two were rejected. Which one is left?', '아이디어 셋 중 둘은 탈락. 남은 하나는?');
    const h2 =
      lockLv === 'basic'
        ? T('Press the same shape.', '같은 모양을 눌러요.')
        : lockLv === 'im3'
          ? T('Press the shape, then answer Pip in a full sentence.', '모양을 누르고 핍의 질문에 문장으로 답해요.')
          : T('Press the shape. Then speak to Pip.', '모양을 누르고 핍에게 말해요.');
    return [h1, h2, T(`The shape is a ${shape}.`, `모양은 ${josa(SHAPES[shape].ko, '이에요', '예요')}.`)];
  },
  done: T('Pip is fully charged! "Beep-boop! I feel great!"', '핍이 다 충전됐어요! "삐빅! 기분 최고야!"'),
};

const SWITCH_PAIRS = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];
const SWITCH_LOGIC = [
  'Two switches must be down. They are next to each other, and one of them is the first switch.',
  'Two switches must be down. They are not next to each other, and the last switch is up.',
  'Two switches must be down: the two at the very ends of the panel.',
  'Two switches must be down, and both of them are in the middle of the panel.',
  'Two switches must be down. They are not next to each other, and the first switch is up.',
  'Two switches must be down. They are next to each other, and one of them is the last switch.',
];
const ud = (s) => (s === 'up' ? 'up' : 'down');
const udKo = (s) => (s === 'up' ? '위' : '아래');
const switches = {
  id: 'switches',
  clue: { obj: 'poster', en: 'Safety poster', ko: '안전 포스터', icon: '📋' },
  lock: { obj: 'switches', en: 'Light switches', ko: '전등 스위치', icon: '💡' },
  token: (r) => {
    const combo = randInt(r, 0, 5);
    const [p, q] = SWITCH_PAIRS[combo];
    return { combo, pattern: [0, 1, 2, 3].map((i) => (i === p || i === q ? 'down' : 'up')) };
  },
  clueView({ combo, pattern }, lv) {
    if (lv === 'basic')
      return {
        art: { type: 'switches', pattern, arrows: true },
        text: T(`${cap(pattern.map(ud).join(', '))}!`, `${pattern.map(udKo).join(', ')}!`),
      };
    if (lv === 'im1')
      return {
        art: { type: 'switches', pattern: null },
        text: T(
          pattern.map((s, i) => `Switch ${i + 1}: ${s}.`).join(' '),
          pattern.map((s, i) => `스위치 ${i + 1}: ${udKo(s)}.`).join(' ')
        ),
      };
    if (lv === 'im2') {
      const rel = (x, y) => (x === y ? 'the same as' : 'the opposite of');
      const relKo = (x, y) => (x === y ? '같아요' : '반대예요');
      const [a, b, d, e] = pattern;
      return {
        art: { type: 'paper' },
        text: T(
          `Light switches: The first switch is ${a}. The second switch is ${rel(a, b)} the first one. The third switch is ${d}, and the last switch is ${rel(d, e)} the third one.`,
          `전등 스위치: 첫 번째 스위치는 ${udKo(a)}. 두 번째는 첫 번째와 ${relKo(a, b)}. 세 번째는 ${udKo(d)}, 마지막은 세 번째와 ${relKo(d, e)}.`
        ),
      };
    }
    return { art: { type: 'paper' }, text: T(SWITCH_LOGIC[combo]) };
  },
  lockView({ pattern }, lv) {
    const base = { widget: 'switches', n: 4 };
    if (lv === 'basic')
      return {
        ...base,
        expected: pattern,
        text: T(
          'Turn on the lights! Make each switch up or down, like your friend says.',
          '불을 켜요! 친구 말대로 스위치를 위나 아래로 하세요.'
        ),
      };
    if (lv === 'im1')
      return {
        ...base,
        expected: pattern,
        text: T(
          'Set the four light switches. Ask your teammate: up or down?',
          '스위치 네 개를 맞춰요. 팀원에게 위인지 아래인지 물어보세요.'
        ),
      };
    if (lv === 'im2')
      return {
        ...base,
        expected: pattern.map((s) => (s === 'up' ? 'down' : 'up')),
        text: T(
          'This panel was put in upside down! When the poster says UP, push the switch DOWN. When it says DOWN, push it UP.',
          '이 판은 거꾸로 달렸어요! 포스터가 위라고 하면 아래로, 아래라고 하면 위로 하세요.'
        ),
      };
    return {
      ...base,
      expected: [...pattern].reverse(),
      text: T(
        'This panel is a mirror copy of the poster: switch 1 here matches switch 4 on the poster, switch 2 matches switch 3, and so on.'
      ),
    };
  },
  ask: {
    basic: T('Up or down?', '위야, 아래야?'),
    im1: T('Is switch one up or down?', '스위치 1은 위야, 아래야?'),
    im2: T('Which switches are down?', '어느 스위치가 아래야?'),
    im3: goal('Find out which switches are down.'),
  },
  tell({ pattern }, lv) {
    if (lv === 'basic') return T(`${cap(pattern.map(ud).join(', '))}!`, `${pattern.map(udKo).join(', ')}!`);
    if (lv === 'im1')
      return T(
        `${pattern.map((s, i) => `switch ${numWord(i + 1)} is ${s}`).join(', ')}.`.replace(/^s/, 'S'),
        pattern.map((s, i) => `스위치 ${josa(i + 1, '은', '는')} ${udKo(s)}`).join(', ') + '.'
      );
    if (lv === 'im2') return frame('Switch ___ and switch ___ are down.', '스위치 ___와 ___가 아래야.');
    return goal('Tell your teammate which switches are down.');
  },
  hints({ pattern }, clueLv, lockLv, expected) {
    const h1 = {
      basic: T('Look at the safety poster on the wall.', '벽의 안전 포스터를 보세요.'),
      im1: T('Look at the safety poster on the wall.', '벽의 안전 포스터를 보세요.'),
      im2: T('Same or opposite? Read each sentence.', '같은지 반대인지 한 문장씩 읽어요.'),
      im3: T('Two switches are down. Check every sentence.', '두 개가 아래예요. 문장을 모두 확인해요.'),
    }[clueLv];
    const h2 = {
      basic: T('Copy the poster.', '포스터와 똑같이 해요.'),
      im1: T('Copy the poster.', '포스터와 똑같이 해요.'),
      im2: T('Do the opposite: up becomes down.', '반대로 해요: 위는 아래로.'),
      im3: T('Read the poster from right to left.', '포스터를 오른쪽부터 읽어요.'),
    }[lockLv];
    return [h1, h2, T(`Switch 1 is ${expected[0]}.`, `스위치 1은 ${udKo(expected[0])}예요.`)];
  },
  done: T('The emergency lights are on! The room is brighter.', '비상등이 켜졌어요! 방이 밝아졌어요.'),
};

/* ---------- 2. 우주 정원 ---------- */

const FRUIT_IM1 = {
  apple: T('round, red fruit', '둥글고 빨간 과일'),
  banana: T('long, yellow fruit', '길고 노란 과일'),
  grapes: T('small, purple fruit that grows in a bunch', '송이로 달리는 작은 보라색 과일'),
  orange: T('round, orange fruit', '둥근 주황색 과일'),
  strawberry: T('small, red fruit with seeds on the outside', '겉에 씨가 있는 작고 빨간 과일'),
  watermelon: T('very big, green fruit', '아주 크고 초록색인 과일'),
};
const FRUIT_IM2 = {
  apple: T(
    "Big Bud's favorite fruit is red, but it isn't small. It's round and crunchy.",
    '빅 버드가 좋아하는 과일은 빨갛지만 작지 않아요. 둥글고 아삭해요.'
  ),
  banana: T(
    "Big Bud's favorite fruit isn't red, and it isn't round. Monkeys love it.",
    '빨갛지도 둥글지도 않아요. 원숭이가 아주 좋아해요.'
  ),
  grapes: T(
    "Big Bud's favorite fruit is purple. It isn't one big fruit — it's lots of small ones together.",
    '보라색이에요. 큰 과일 하나가 아니라 작은 열매 여러 개가 모여 있어요.'
  ),
  orange: T(
    "Big Bud's favorite fruit is round. Its name is also the name of a color.",
    '둥글어요. 이름이 색깔 이름과 같아요.'
  ),
  strawberry: T(
    "Big Bud's favorite fruit is small and red. Its seeds are on the outside, not on the inside.",
    '작고 빨개요. 씨가 안이 아니라 겉에 있어요.'
  ),
  watermelon: T(
    "Big Bud's favorite fruit is green on the outside but red on the inside. It's the biggest fruit on the tree.",
    '겉은 초록, 속은 빨개요. 나무에서 가장 큰 과일이에요.'
  ),
};
const FRUIT_IM3 = {
  apple: 'grows in orchards, crunches when you bite it, and is said to keep the doctor away',
  banana: 'is curved, grows in bunches, and turns from green to yellow as it ripens',
  grapes: 'grows on vines and can be dried to make raisins',
  orange: 'shares its name with its color and is full of vitamin C',
  strawberry: 'is the only fruit here that wears its seeds on the outside',
  watermelon: 'is mostly water and is so heavy that you usually need two hands to carry it',
};
const fruit = {
  id: 'fruit',
  clue: { obj: 'notebook', en: "Gardener's notebook", ko: '정원사 공책', icon: '📒' },
  lock: { obj: 'tree', en: 'Fruit tree', ko: '과일나무', icon: '🌳' },
  token: (r) => {
    const all = Object.keys(FRUITS);
    const f = pick(r, all);
    return { fruit: f, tried: shuffle(r, all.filter((x) => x !== f)).slice(0, 3) };
  },
  clueView({ fruit: f, tried: [x, y, z] }, lv) {
    const F = FRUITS[f];
    if (lv === 'basic') return { art: { type: 'fruit', fruit: f }, text: T(`${cap(F.en)}!`, `${F.ko}!`) };
    if (lv === 'im1')
      return {
        art: { type: 'paper' },
        text: T(`Big Bud loves a ${FRUIT_IM1[f].en}.`, `빅 버드는 ${FRUIT_IM1[f].ko}을 아주 좋아해요.`),
      };
    if (lv === 'im2') return { art: { type: 'paper' }, text: FRUIT_IM2[f] };
    return {
      art: { type: 'paper' },
      text: T(
        `Day 1: I gave Big Bud ${FRUITS[x].a}, and it closed its leaves. Day 2: It didn't even touch the ${FRUITS[y].en} or the ${FRUITS[z].en}. Day 3: It finally opened up when I gave it the fruit that ${FRUIT_IM3[f]}.`
      ),
    };
  },
  lockView({ fruit: f }, lv) {
    const options = Object.keys(FRUITS);
    if (lv === 'basic')
      return {
        widget: 'choice',
        kind: 'fruit',
        options,
        pictures: true,
        words: true,
        expected: f,
        text: T('Feed Big Bud! Pick the fruit your friend says.', '빅 버드에게 먹이를 줘요! 친구가 말하는 과일을 고르세요.'),
      };
    if (lv === 'im1')
      return {
        widget: 'choice',
        kind: 'fruit',
        options,
        pictures: true,
        words: true,
        expected: f,
        text: T("Pick Big Bud's favorite fruit from the tree.", '나무에서 빅 버드가 가장 좋아하는 과일을 고르세요.'),
      };
    if (lv === 'im2')
      return {
        widget: 'choice',
        kind: 'fruit',
        options,
        pictures: false,
        words: true,
        expected: f,
        text: T(
          "The pictures fell off the fruit labels! Pick Big Bud's favorite fruit by its name.",
          '과일 그림이 떨어졌어요! 이름을 보고 빅 버드가 좋아하는 과일을 고르세요.'
        ),
      };
    return {
      widget: 'word',
      expected: [FRUITS[f].en, ...(FRUITS[f].alts || [])],
      text: T('The feeding machine needs the name of the fruit. Type it — spelling counts!'),
    };
  },
  ask: {
    basic: T('What fruit?', '무슨 과일이야?'),
    im1: T('What fruit does Big Bud like?', '빅 버드는 무슨 과일을 좋아해?'),
    im2: T("What is Big Bud's favorite fruit?", '빅 버드가 가장 좋아하는 과일이 뭐야?'),
    im3: goal("Find out Big Bud's favorite fruit."),
  },
  tell({ fruit: f }, lv) {
    const F = FRUITS[f];
    if (lv === 'basic') return T(`${cap(F.en)}!`, `${F.ko}!`);
    if (lv === 'im1') return T(`Big Bud likes ${F.plural}.`, `빅 버드는 ${josa(F.ko, '을', '를')} 좋아해.`);
    if (lv === 'im2') return frame("Big Bud's favorite fruit is ___.", '빅 버드가 가장 좋아하는 과일은 ___야.');
    return goal("Tell your teammate Big Bud's favorite fruit.");
  },
  hints({ fruit: f }, clueLv, lockLv) {
    const h1 = {
      basic: T('Look at the notebook on the table.', '탁자 위 공책을 보세요.'),
      im1: T('Read the notebook on the table.', '탁자 위 공책을 읽어요.'),
      im2: T('Which fruit fits every sentence?', '모든 문장에 맞는 과일은 뭘까요?'),
      im3: T('Read Day 3 carefully.', '셋째 날을 꼼꼼히 읽어요.'),
    }[clueLv];
    const h2 = {
      basic: T('Pick the same fruit.', '같은 과일을 골라요.'),
      im1: T('Pick the same fruit.', '같은 과일을 골라요.'),
      im2: T('Read the names and find the same fruit.', '이름을 읽고 같은 과일을 찾아요.'),
      im3: T('Type the name of the fruit. Check the spelling.', '과일 이름을 써요. 철자를 확인해요.'),
    }[lockLv];
    return [h1, h2, T(`It starts with "${FRUITS[f].en[0].toUpperCase()}".`, `"${FRUITS[f].en[0].toUpperCase()}"로 시작해요.`)];
  },
  done: T('Big Bud eats the fruit. "Mmm!" One leaf opens.', '빅 버드가 과일을 먹어요. "냠!" 잎 하나가 열렸어요.'),
};

/** 분수 그림 속 물고기 (단서 수준마다 다르게). 세어야 할 물고기 수는 n */
function fishTank(r, n, lv) {
  const fish = [];
  const add = (color, dir = r() < 0.5 ? 'left' : 'right', striped = false) => fish.push({ color, dir, striped });
  if (lv === 'basic') for (let i = 0; i < n; i++) add('orange');
  else if (lv === 'im1') {
    for (let i = 0; i < n; i++) add('blue');
    for (let i = randInt(r, 2, 3); i > 0; i--) add(pick(r, ['orange', 'green']));
  } else if (lv === 'im2') {
    for (let i = 0; i < n; i++) add(pick(r, ['blue', 'green']), 'left');
    for (let i = randInt(r, 1, 2); i > 0; i--) add('orange', 'left');
    for (let i = randInt(r, 1, 2); i > 0; i--) add(pick(r, ['blue', 'green', 'orange']), 'right');
  } else {
    for (let i = 0; i < n; i++) add(pick(r, ['blue', 'green', 'orange']));
    for (let i = randInt(r, 1, 3); i > 0; i--) add(pick(r, ['blue', 'green', 'orange']), undefined, true);
  }
  return { fish: shuffle(r, fish), statue: lv === 'im3' };
}
const fountain = {
  id: 'fountain',
  clue: { obj: 'fountain', en: 'Glow fish fountain', ko: '빛나는 물고기 분수', icon: '⛲' },
  lock: { obj: 'pump', en: 'Water pump', ko: '물 펌프', icon: '🚰' },
  token: (r) => ({ n: randInt(r, 2, 6), seed: randInt(r, 1, 99999) }),
  clueView({ n, seed }, lv, rngOf) {
    const tank = fishTank(rngOf(`fish${seed}`), n, lv);
    const art = { type: 'fish', ...tank };
    if (lv === 'basic') return { art, text: T('How many fish? Count them!', '물고기가 몇 마리예요? 세어 보세요!') };
    if (lv === 'im1') return { art, text: T('Count only the blue fish.', '파란 물고기만 세어요.') };
    if (lv === 'im2')
      return {
        art,
        text: T(
          'Count the fish that are not orange and are swimming to the left.',
          '주황색이 아니면서 왼쪽으로 헤엄치는 물고기를 세어요.'
        ),
      };
    return {
      art,
      text: T(
        "Count all the fish in the fountain, then take away the ones with stripes. Don't count the stone fish — it's only a statue!"
      ),
    };
  },
  lockView({ n }, lv) {
    const base = { widget: 'dial', min: 0, max: 20 };
    if (lv === 'basic')
      return {
        ...base,
        expected: n,
        text: T('Water Big Bud! Set the number your friend says.', '빅 버드에게 물을 줘요! 친구가 말하는 숫자로 맞추세요.'),
      };
    if (lv === 'im1')
      return { ...base, expected: n, text: T('Set the water pump to the number of fish.', '물 펌프를 물고기 수에 맞추세요.') };
    if (lv === 'im2')
      return {
        ...base,
        expected: n + 2,
        text: T(
          'Big Bud is very thirsty. Set the pump to two more than the number of fish.',
          '빅 버드가 아주 목말라요. 물고기 수보다 2 많게 맞추세요.'
        ),
      };
    return {
      ...base,
      expected: 2 * n,
      text: T('The pump counts in half liters, and Big Bud needs one liter for every fish.'),
    };
  },
  ask: {
    basic: T('How many?', '몇 마리야?'),
    im1: T('How many fish are there?', '물고기가 몇 마리야?'),
    im2: T('How many fish did you count?', '물고기를 몇 마리 셌어?'),
    im3: goal('Find out how many fish to count.'),
  },
  tell({ n }, lv) {
    if (lv === 'basic') return T(`${cap(numWord(n))}!`, `${n}마리!`);
    if (lv === 'im1') return T(`There are ${numWord(n)} fish.`, `물고기가 ${n}마리야.`);
    if (lv === 'im2') return frame('I counted ___ fish.', '물고기를 ___마리 셌어.');
    return goal('Tell your teammate how many fish you counted.');
  },
  hints({ n }, clueLv, lockLv) {
    const h1 = {
      basic: T('Count the fish in the fountain.', '분수의 물고기를 세요.'),
      im1: T('Count only the blue fish.', '파란 물고기만 세요.'),
      im2: T('Not orange, and going left.', '주황이 아니고, 왼쪽으로 가는 물고기.'),
      im3: T('All the fish minus the striped ones. The statue is not a fish.', '전체에서 줄무늬를 빼요. 돌 물고기는 세지 않아요.'),
    }[clueLv];
    const h2 = {
      basic: T('Use the same number.', '같은 숫자로 맞춰요.'),
      im1: T('Use the same number.', '같은 숫자로 맞춰요.'),
      im2: T('Add two.', '2를 더해요.'),
      im3: T('Two half liters make one liter, so double it.', '반 리터 두 개가 1리터예요. 두 배로 해요.'),
    }[lockLv];
    return [h1, h2, T(`There are ${n} fish to count.`, `세어야 할 물고기는 ${n}마리예요.`)];
  },
  done: T('Splash! Big Bud drinks the water. Another leaf opens!', '첨벙! 빅 버드가 물을 마셔요. 잎이 또 열렸어요!'),
};

const FLOWER_THING = {
  pink: 'a flamingo',
  orange: 'a pumpkin',
  yellow: 'a lemon',
  blue: 'the deep ocean',
  purple: 'a bunch of lavender',
};
const song = {
  id: 'song',
  clue: { obj: 'sheet', en: 'Music sheet', ko: '악보', icon: '🎼' },
  lock: { obj: 'bells', en: 'Bell flowers', ko: '종소리 꽃', icon: '🌷' },
  token: (r) => {
    let m;
    do m = [0, 1, 2, 3].map(() => pick(r, FLOWERS));
    while (new Set(m).size < 3);
    return { melody: m };
  },
  clueView({ melody: m }, lv) {
    if (lv === 'basic')
      return {
        art: { type: 'notes', melody: m },
        tones: m,
        text: T(`${cap(m.map(c).join(', '))}!`, `${m.map(ck).join(', ')}!`),
      };
    if (lv === 'im1')
      return {
        art: { type: 'notes', melody: null },
        tones: m,
        text: T(`Big Bud's song: ${m.map(c).join(', ')}.`, `빅 버드의 노래: ${m.map(ck).join(', ')}.`),
      };
    if (lv === 'im2')
      return {
        art: { type: 'paper' },
        text: T(
          `Big Bud's favorite song starts with the ${c(m[0])} flower. The second note is ${m[1] === m[0] ? 'the same as the first one' : `the ${c(m[1])} flower`}. Then comes the ${c(m[2])} flower, and the song ends with the ${c(m[3])} one.`,
          `빅 버드가 좋아하는 노래는 ${ck(m[0])} 꽃으로 시작해요. 두 번째 음은 ${m[1] === m[0] ? '첫 음과 같아요' : `${ck(m[1])} 꽃이에요`}. 그다음은 ${ck(m[2])} 꽃, 마지막은 ${ck(m[3])} 꽃이에요.`
        ),
      };
    return {
      art: { type: 'paper' },
      text: T(
        `♪ First, the color of ${FLOWER_THING[m[0]]}. ${m[1] === m[0] ? 'Then, that same color again.' : `Then, the color of ${FLOWER_THING[m[1]]}.`} Next comes the color of ${FLOWER_THING[m[2]]}, and last, the color of ${FLOWER_THING[m[3]]}. ♪ (Each color is one flower note.)`
      ),
    };
  },
  lockView({ melody: m }, lv) {
    const base = { widget: 'melody', flowers: FLOWERS };
    if (lv === 'basic')
      return {
        ...base,
        len: 4,
        expected: m,
        text: T('Sing to Big Bud! Tap the flowers your friend says.', '빅 버드에게 노래해요! 친구가 말하는 꽃을 차례로 누르세요.'),
      };
    if (lv === 'im1')
      return {
        ...base,
        len: 4,
        expected: m,
        text: T(
          "Play Big Bud's song on the flowers. Ask your teammate for the notes.",
          '꽃으로 빅 버드의 노래를 연주해요. 팀원에게 음을 물어보세요.'
        ),
      };
    if (lv === 'im2')
      return {
        ...base,
        len: 5,
        expected: [...m, m[3]],
        text: T(
          'Big Bud loves an echo! Play the song, then play the last note one more time.',
          '빅 버드는 메아리를 좋아해요! 노래를 연주하고 마지막 음을 한 번 더 누르세요.'
        ),
      };
    return {
      ...base,
      len: 4,
      expected: [...m].reverse(),
      text: T('Big Bud is dreaming upside down tonight, so play the song backwards, from the last note to the first.'),
    };
  },
  ask: {
    basic: T('What colors?', '무슨 색이야?'),
    im1: T('What is the first note?', '첫 음이 뭐야?'),
    im2: T('What are the notes of the song?', '노래 음이 뭐야?'),
    im3: goal("Find out the notes of Big Bud's song."),
  },
  tell({ melody: m }, lv) {
    if (lv === 'basic') return T(`${cap(m.map(c).join(', '))}!`, `${m.map(ck).join(', ')}!`);
    if (lv === 'im1') return T(`The song is ${m.map(c).join(', ')}.`, `노래는 ${m.map(ck).join(', ')}야.`);
    if (lv === 'im2') return frame('First ___, then ___, ___, and last ___.', '처음 ___, 그다음 ___, ___, 마지막 ___.');
    return goal("Tell your teammate the notes of Big Bud's song.");
  },
  hints(t, clueLv, lockLv, expected) {
    const h1 =
      clueLv === 'im3'
        ? T("Think of each thing's color. A lemon is yellow.", '물건마다 색을 떠올려요. 레몬은 노랑이에요.')
        : T('Look at the music sheet on the bench.', '벤치 위 악보를 보세요.');
    const h2 = {
      basic: T('Tap the flowers in the same order.', '같은 순서로 꽃을 눌러요.'),
      im1: T('Tap the flowers in the same order.', '같은 순서로 꽃을 눌러요.'),
      im2: T('Play the last flower again at the end.', '마지막 꽃을 한 번 더 눌러요.'),
      im3: T('Start from the last note.', '마지막 음부터 시작해요.'),
    }[lockLv];
    return [h1, h2, T(`The first note is ${c(expected[0])}.`, `첫 음은 ${josa(ck(expected[0]), '이에요', '예요')}.`)];
  },
  done: T('Big Bud sways to the music. A big leaf opens!', '빅 버드가 음악에 맞춰 흔들려요. 큰 잎이 열렸어요!'),
};

const MAGIC = {
  sunshine: { ko: '햇살', riddle: 'the star in our sky + what a polished shoe does' },
  rainbow: { ko: '무지개', riddle: 'the water that falls from clouds + the knot you tie your shoelaces into' },
  moonlight: { ko: '달빛', riddle: "Earth's only natural satellite + the opposite of dark" },
  stardust: { ko: '별가루', riddle: 'a twinkling thing in the night sky + the tiny gray bits that collect on old shelves' },
  sunflower: { ko: '해바라기', riddle: 'the star in our sky + the colorful part of a plant' },
};
/** 글자 두 개를 비운 단어 (첫 글자는 남긴다) */
function blanked(r, w) {
  const idx = shuffle(
    r,
    [...w].map((_, i) => i).filter((i) => i > 0)
  ).slice(0, 2);
  return [...w].map((ch, i) => (idx.includes(i) ? '_' : ch)).join('');
}
function scrambled(r, w) {
  let s;
  do s = shuffle(r, [...w]).join('');
  while (s === w);
  return s;
}
const bigbud = {
  id: 'bigbud',
  clue: { obj: 'tablet', en: 'Grow-light screen', ko: '식물 조명 화면', icon: '🖥️' },
  lock: { obj: 'bud', en: 'Big Bud', ko: '빅 버드', icon: '🌱' },
  token: (r) => {
    const word = pick(r, Object.keys(MAGIC));
    return { word, blank: blanked(r, word), mixed: scrambled(r, word) };
  },
  clueView({ word, blank, mixed }, lv) {
    const W = word.toUpperCase();
    if (lv === 'basic')
      return {
        art: { type: 'word', word: W, picture: word },
        say: `${cap(word)}! ${spell(word)}.`,
        text: T(W, MAGIC[word].ko),
      };
    if (lv === 'im1')
      return {
        art: { type: 'word', word: blank.toUpperCase(), picture: word },
        text: T(
          "Big Bud's magic word has two missing letters. Look at the picture and find the word!",
          '빅 버드의 마법 단어에 글자 두 개가 빠졌어요. 그림을 보고 단어를 찾아요!'
        ),
      };
    if (lv === 'im2')
      return {
        art: { type: 'word', word: mixed.toUpperCase() },
        text: T('The magic word got mixed up! Unscramble the letters.', '마법 단어의 글자가 섞였어요! 바르게 맞춰 보세요.'),
      };
    return { art: { type: 'paper' }, text: T(`The magic word is a compound word: ${MAGIC[word].riddle}.`) };
  },
  lockView({ word }, lv) {
    const base = { widget: 'voice', expected: word };
    if (lv === 'basic')
      return {
        ...base,
        voice: { keywords: [word] },
        text: T('Wake up Big Bud! Say the magic word.', '빅 버드를 깨워요! 마법 단어를 말하세요.'),
      };
    if (lv === 'im1')
      return {
        ...base,
        voice: { keywords: [word], minWords: 3 },
        text: T('Say: "Wake up, Big Bud! ___!" Use the magic word.', '"Wake up, Big Bud! ___!"라고 말해요. 빈칸에 마법 단어를 넣어요.'),
      };
    if (lv === 'im2')
      return {
        ...base,
        voice: { keywords: [word], minWords: 6 },
        text: T(
          'Say a full sentence to Big Bud with the magic word, like: "Good morning, Big Bud. We brought you some ___!"',
          '마법 단어를 넣은 완전한 문장으로 말해요. 예: "Good morning, Big Bud. We brought you some ___!"'
        ),
      };
    return {
      ...base,
      voice: { keywords: [word, ['please', 'could', 'would', 'can']], minWords: 7 },
      text: T('Big Bud only opens for a polite request. Ask Big Bud to open its leaves, and use the magic word in your sentence.'),
    };
  },
  ask: {
    basic: T('What is the magic word?', '마법 단어가 뭐야?'),
    im1: T('What is the magic word?', '마법 단어가 뭐야?'),
    im2: T('Can you tell me the magic word and spell it?', '마법 단어랑 철자를 알려 줄래?'),
    im3: goal("Find out Big Bud's magic word."),
  },
  tell({ word }, lv) {
    if (lv === 'basic') return T(`${cap(word)}! ${spell(word)}.`, `${MAGIC[word].ko}! ${spell(word)}.`);
    if (lv === 'im1') return T(`The magic word is ${word}.`, `마법 단어는 ${word}(${MAGIC[word].ko})야.`);
    if (lv === 'im2') return frame('The magic word is ___. It is spelled ___.', '마법 단어는 ___야. 철자는 ___야.');
    return goal('Tell your teammate the magic word.');
  },
  hints({ word }, clueLv, lockLv) {
    const h1 = {
      basic: T('Look at the screen on the wall.', '벽의 화면을 보세요.'),
      im1: T('Look at the picture to find the missing letters.', '그림을 보고 빠진 글자를 찾아요.'),
      im2: T("Unscramble it. It's something Big Bud loves.", '섞인 글자를 맞춰요. 빅 버드가 좋아하는 거예요.'),
      im3: T('Put two small words together.', '작은 단어 두 개를 붙여요.'),
    }[clueLv];
    const h2 = {
      basic: T('Say the word loudly and clearly.', '크고 또박또박 말해요.'),
      im1: T('Say the word loudly and clearly.', '크고 또박또박 말해요.'),
      im2: T('Say a sentence with six words or more.', '여섯 단어 이상의 문장으로 말해요.'),
      im3: T('Be polite: use "please" or "could you".', '"please"나 "could you"로 공손하게.'),
    }[lockLv];
    return [h1, h2, T(`The word starts with "${word[0].toUpperCase()}".`, `"${word[0].toUpperCase()}"로 시작해요.`)];
  },
  done: T('Big Bud yawns and opens all its leaves. "Thank you, friends!"', '빅 버드가 하품하며 잎을 활짝 열었어요. "고마워, 친구들!"'),
};

/* ---------- 3. 로봇 작업실 ---------- */

const GRID = { cols: 5, rows: 4, start: [2, 3] };
const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
const MIRROR = { up: 'up', down: 'down', left: 'right', right: 'left' };
const LANDMARK = {
  up: 'toward the ceiling',
  down: 'toward the floor',
  left: 'toward the door',
  right: 'toward the window',
};
export { GRID as ARM_GRID, STEP as ARM_STEP };
/** 연속된 같은 방향을 묶는다: [[dir, n], …] */
const groups = (moves) =>
  moves.reduce((g, m) => {
    const last = g.at(-1);
    if (last && last[0] === m) last[1]++;
    else g.push([m, 1]);
    return g;
  }, []);
const arm = {
  id: 'arm',
  clue: { obj: 'armscreen', en: 'Arm program screen', ko: '로봇 팔 화면', icon: '🖥️' },
  lock: { obj: 'arm', en: 'Robot arm', ko: '로봇 팔', icon: '🦾' },
  token: (r) => {
    for (;;) {
      let [x, y] = GRID.start;
      const moves = [];
      while (moves.length < 4) {
        const ok = Object.keys(STEP).filter((d) => {
          const [dx, dy] = STEP[d];
          const nx = x + dx;
          const ny = y + dy;
          return nx >= 0 && nx < GRID.cols && ny >= 0 && ny < GRID.rows && d !== OPP[moves.at(-1)];
        });
        const d = pick(r, ok);
        moves.push(d);
        x += STEP[d][0];
        y += STEP[d][1];
      }
      if (new Set(moves).size >= 2) return { moves };
    }
  },
  clueView({ moves }, lv) {
    const en = moves.map((d) => DIRS[d].en);
    const ko = moves.map((d) => DIRS[d].ko);
    if (lv === 'basic') return { art: { type: 'arrows', moves }, text: T(`${cap(en.join(', '))}!`, `${ko.join(', ')}!`) };
    if (lv === 'im1')
      return { art: { type: 'screen' }, text: T(`Move the arm: ${en.join(', ')}.`, `팔을 움직여요: ${ko.join(', ')}.`) };
    const g = groups(moves);
    if (lv === 'im2') {
      const starts = ['First', 'Then', 'Next', 'Finally'];
      const startsKo = ['먼저', '그다음', '이어서', '마지막으로'];
      const lastIdx = g.length - 1;
      return {
        art: { type: 'screen' },
        text: T(
          g
            .map(
              ([d, n], i) =>
                `${i === lastIdx && i > 0 ? 'Finally' : starts[i]}, move the arm ${d} ${numWord(n)} square${n > 1 ? 's' : ''}.`
            )
            .join(' '),
          g.map(([d, n], i) => `${i === lastIdx && i > 0 ? '마지막으로' : startsKo[i]} ${ro(DIRS[d].ko)} ${n}칸.`).join(' ')
        ),
      };
    }
    const times = ['', '', 'twice ', 'three times '];
    const lastIdx = g.length - 1;
    const parts = g.map(([d, n], i) => {
      const verb =
        i === lastIdx && i > 0 && n === 1 && d === OPP[moves[0]]
          ? 'make the opposite of your very first move'
          : `move ${times[n]}${LANDMARK[d]}`;
      if (i === 0) return `Start by ${verb.replace(/^move/, 'moving').replace(/^make/, 'making')}.`;
      return `${i === lastIdx ? 'To finish' : i === 1 ? 'Next' : 'After that'}, ${verb}.`;
    });
    return {
      art: { type: 'screen' },
      text: T(`Arm map: the door is on the left and the big window is on the right. ${parts.join(' ')}`),
    };
  },
  lockView({ moves }, lv) {
    const base = { widget: 'arrows', len: 4, grid: GRID };
    if (lv === 'basic')
      return {
        ...base,
        map: null,
        expected: moves,
        text: T('Move the robot arm! Press the arrows your friend says.', '로봇 팔을 움직여요! 친구가 말하는 화살표를 누르세요.'),
      };
    if (lv === 'im1')
      return {
        ...base,
        map: null,
        expected: moves,
        text: T(
          'Move the arm to the gear. Ask your teammate which way to go.',
          '팔을 톱니바퀴까지 움직여요. 팀원에게 어느 쪽인지 물어보세요.'
        ),
      };
    if (lv === 'im2')
      return {
        ...base,
        map: MIRROR,
        expected: moves.map((d) => MIRROR[d]),
        text: T(
          'The controller is in MIRROR MODE: left and right are switched. Up and down are the same.',
          '조종기가 거울 모드예요. 왼쪽과 오른쪽이 바뀌었어요. 위아래는 그대로예요.'
        ),
      };
    return {
      ...base,
      map: OPP,
      expected: moves.map((d) => OPP[d]),
      text: T(
        'The camera is upside down, so every control is flipped: up is down, down is up, left is right, and right is left.'
      ),
    };
  },
  ask: {
    basic: T('Which way?', '어느 쪽이야?'),
    im1: T('Which way do I move the arm?', '팔을 어느 쪽으로 움직여?'),
    im2: T('What are the moves?', '어떻게 움직여?'),
    im3: goal('Find out how the arm should move.'),
  },
  tell({ moves }, lv) {
    const en = moves.map((d) => DIRS[d].en);
    if (lv === 'basic') return T(`${cap(en.join(', '))}!`, `${moves.map((d) => DIRS[d].ko).join(', ')}!`);
    if (lv === 'im1') return T(`Move ${en.join(', ')}.`, `${ro(moves.map((d) => DIRS[d].ko).join(', '))} 움직여.`);
    if (lv === 'im2') return frame('First ___, then ___, ___, and last ___.', '처음 ___, 그다음 ___, ___, 마지막 ___.');
    return goal('Tell your teammate how the arm should move.');
  },
  hints(t, clueLv, lockLv, expected) {
    const h1 =
      clueLv === 'im3'
        ? T('The door is on the left. The window is on the right.', '문은 왼쪽, 창문은 오른쪽이에요.')
        : T('Look at the screen next to the robot arm.', '로봇 팔 옆 화면을 보세요.');
    const h2 = {
      basic: T('Press the same arrows in order.', '같은 화살표를 차례로 눌러요.'),
      im1: T('Press the same arrows in order.', '같은 화살표를 차례로 눌러요.'),
      im2: T('Left and right are switched.', '왼쪽과 오른쪽을 바꿔 눌러요.'),
      im3: T('Press the opposite arrow every time.', '매번 반대 화살표를 눌러요.'),
    }[lockLv];
    return [h1, h2, T(`The first press is ${expected[0]}.`, `첫 번째로 누를 것은 ${josa(DIRS[expected[0]].ko, '이에요', '예요')}.`)];
  },
  done: T('The arm grabs a shiny gear!', '로봇 팔이 반짝이는 톱니바퀴를 집었어요!'),
};

const WIRE_COLORS = ['red', 'blue', 'yellow'];
const PERMS = [
  [1, 2, 3],
  [1, 3, 2],
  [2, 1, 3],
  [2, 3, 1],
  [3, 1, 2],
  [3, 2, 1],
];
const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };
/** 전선 문장 후보 (모두 정답 배선에서 참). test: 어떤 배선에서 참인지 */
function wireFacts(map) {
  const facts = [];
  const nums = (m) => WIRE_COLORS.map((col) => m[col]);
  for (const x of WIRE_COLORS) {
    for (const k of [1, 2, 3])
      if (map[x] !== k) facts.push({ en: `The ${x} wire is not connected to number ${k}.`, test: (m) => m[x] !== k });
    facts.push({
      en: `The ${x} wire goes to ${map[x] % 2 ? 'an odd' : 'an even'} number.`,
      test: (m) => m[x] % 2 === map[x] % 2,
    });
    for (const y of WIRE_COLORS) {
      if (x === y) continue;
      if (map[x] > map[y]) facts.push({ en: `The ${x} wire goes to a bigger number than the ${y} wire.`, test: (m) => m[x] > m[y] });
      if (map[x] === map[y] + 1)
        facts.push({ en: `The ${x} wire's number is exactly one more than the ${y} wire's.`, test: (m) => m[x] === m[y] + 1 });
    }
  }
  return { facts, nums };
}
const asMap = (perm) => Object.fromEntries(WIRE_COLORS.map((col, i) => [col, perm[i]]));
/** 이 문장들로 정답 배선 하나만 남는지 */
export const uniqueWiring = (tests) => PERMS.map(asMap).filter((m) => tests.every((t) => t(m))).length === 1;
const wires = {
  id: 'wires',
  clue: { obj: 'blueprint', en: 'Wiring blueprint', ko: '배선 설계도', icon: '🗺️' },
  lock: { obj: 'powerbox', en: 'Power box', ko: '전원 상자', icon: '⚡' },
  token: (r) => {
    const map = asMap(pick(r, PERMS));
    // im3: 바로 알려 주는 문장 없이 2~3문장으로 하나만 남게 (시드에 따라 다른 조합)
    const { facts } = wireFacts(map);
    let im3 = null;
    for (let tries = 0; tries < 200 && !im3; tries++) {
      const set = shuffle(r, facts).slice(0, tries < 100 ? 2 : 3);
      if (uniqueWiring(set.map((f) => f.test))) im3 = set.map((f) => f.en);
    }
    const order = shuffle(r, WIRE_COLORS);
    return { map, im3, order, labelOrder: shuffle(r, [1, 2, 3]) };
  },
  clueView({ map, im3, order }, lv) {
    if (lv === 'basic')
      return {
        art: { type: 'wiring', map },
        text: T(
          WIRE_COLORS.map((x) => `${cap(x)} to ${numWord(map[x])}`).join(', ') + '!',
          WIRE_COLORS.map((x) => `${ck(x)}은 ${map[x]}`).join(', ') + '!'
        ),
      };
    if (lv === 'im1')
      return {
        art: { type: 'wiring', map: null },
        text: T(
          WIRE_COLORS.map((x) => `${cap(x)} goes to ${map[x]}.`).join(' '),
          WIRE_COLORS.map((x) => `${ck(x)}은 ${map[x]}번으로.`).join(' ')
        ),
      };
    if (lv === 'im2') {
      const [a, b, d] = order;
      return {
        art: { type: 'paper' },
        text: T(
          `The ${a} wire goes to number ${map[a]}. The ${b} wire does not go to number ${map[d]}.`,
          `${ck(a)} 전선은 ${map[a]}번으로 가요. ${ck(b)} 전선은 ${map[d]}번으로 가지 않아요.`
        ),
      };
    }
    return { art: { type: 'paper' }, text: T(`Wiring notes: ${im3.join(' ')}`) };
  },
  lockView({ map, labelOrder }, lv) {
    const base = { widget: 'wires', left: WIRE_COLORS, expected: map };
    if (lv === 'basic')
      return {
        ...base,
        right: [1, 2, 3].map((v) => ({ value: v, label: String(v), dots: v })),
        text: T('Connect the wires! Your friend knows where they go.', '전선을 이어요! 어디로 가는지 친구가 알아요.'),
      };
    if (lv === 'im1')
      return {
        ...base,
        right: [1, 2, 3].map((v) => ({ value: v, label: String(v) })),
        text: T('Connect each wire to the right number. Ask your teammate.', '전선을 알맞은 번호에 이어요. 팀원에게 물어보세요.'),
      };
    if (lv === 'im2')
      return {
        ...base,
        right: labelOrder.map((v) => ({ value: v, label: NUM[v] })),
        text: T(
          'Connect the wires. On this box, the numbers are written as words.',
          '전선을 이어요. 이 상자에는 숫자가 영어 단어로 적혀 있어요.'
        ),
      };
    return {
      ...base,
      right: labelOrder.map((v) => ({ value: v, label: ROMAN[v] })),
      text: T(
        'This antique power box came from the very first station, so its numbers are written in Roman numerals. Connect the wires.'
      ),
    };
  },
  ask: {
    basic: T('Where does red go?', '빨강은 어디로 가?'),
    im1: T('Where does the red wire go?', '빨간 전선은 어디로 가?'),
    im2: T('Which number is the red wire connected to?', '빨간 전선은 몇 번에 연결돼?'),
    im3: goal('Find out where each wire goes.'),
  },
  tell({ map }, lv) {
    if (lv === 'basic')
      return T(WIRE_COLORS.map((x) => `${cap(x)}, ${numWord(map[x])}!`).join(' '), WIRE_COLORS.map((x) => `${ck(x)} ${map[x]}!`).join(' '));
    if (lv === 'im1')
      return T(
        `Red goes to ${numWord(map.red)}, blue goes to ${numWord(map.blue)}, and yellow goes to ${numWord(map.yellow)}.`,
        `빨강은 ${map.red}, 파랑은 ${map.blue}, 노랑은 ${map.yellow}로 가.`
      );
    if (lv === 'im2') return frame('The ___ wire goes to ___.', '___ 전선은 ___번으로 가.');
    return goal('Tell your teammate where each wire goes.');
  },
  hints({ map }, clueLv, lockLv) {
    const h1 = {
      basic: T('Look at the blueprint on the wall.', '벽의 설계도를 보세요.'),
      im1: T('Look at the blueprint on the wall.', '벽의 설계도를 보세요.'),
      im2: T('One wire is easy. Start with that one.', '쉬운 전선 하나부터 이어요.'),
      im3: T('Try each way and cross out the wrong ones.', '경우를 하나씩 따져 보고 틀린 것을 지워요.'),
    }[clueLv];
    const h2 = {
      basic: T('Match the numbers.', '같은 숫자에 이어요.'),
      im1: T('Match the numbers.', '같은 숫자에 이어요.'),
      im2: T('Read the number words: one, two, three.', '숫자 단어를 읽어요: one, two, three.'),
      im3: T('I is 1, II is 2, III is 3.', 'I은 1, II는 2, III은 3이에요.'),
    }[lockLv];
    return [h1, h2, T(`The red wire goes to ${map.red}.`, `빨간 전선은 ${map.red}번으로 가요.`)];
  },
  done: T('Bzzzt! The power box hums to life.', '지지직! 전원 상자가 윙윙 살아났어요.'),
};

const GEAR_COLORS = ['red', 'blue', 'green'];
const SIZE = { big: { en: 'big', ko: '큰', code: 'L' }, small: { en: 'small', ko: '작은', code: 'S' } };
export const GEAR_IDS = ['big', 'small'].flatMap((s) => GEAR_COLORS.map((col) => `${s}-${col}`));
const gears = {
  id: 'gears',
  clue: { obj: 'note', en: "Bolt's note", ko: '볼트의 쪽지', icon: '📝' },
  lock: { obj: 'gears', en: 'Gear rack', ko: '톱니바퀴 선반', icon: '⚙️' },
  token: (r) => {
    const size = pick(r, ['big', 'small']);
    const color = pick(r, GEAR_COLORS);
    return { size, color, others: shuffle(r, GEAR_COLORS.filter((x) => x !== color)) };
  },
  clueView({ size, color, others: [x, y] }, lv) {
    const other = size === 'big' ? 'small' : 'big';
    if (lv === 'basic')
      return {
        art: { type: 'gear', size, color },
        text: T(`${cap(size)}, ${color}!`, `${SIZE[size].ko} ${adj(color)} 톱니바퀴!`),
      };
    if (lv === 'im1')
      return {
        art: { type: 'paper' },
        text: T(`We need the ${size} ${color} gear.`, `${SIZE[size].ko} ${adj(color)} 톱니바퀴가 필요해요.`),
      };
    if (lv === 'im2')
      return {
        art: { type: 'paper' },
        text: T(
          `Don't use the ${other} gears. Don't use the ${x} one or the ${y} one.`,
          `${SIZE[other].ko} 톱니바퀴는 쓰지 마세요. ${adj(x)} 것과 ${adj(y)} 것도 쓰지 마세요.`
        ),
      };
    return {
      art: { type: 'paper' },
      text: T(
        `"I tried the ${other} gears first, but they just slipped. Then I tried the ${size} ${x} one, but it was too hot to touch. The ${size} ${y} one has a crack in it. I'm leaving you the only one I haven't tried. — Bolt"`
      ),
    };
  },
  lockView({ size, color }, lv) {
    const id = `${size}-${color}`;
    const other = `${size === 'big' ? 'small' : 'big'}-${color}`;
    const base = { kind: 'gear', options: GEAR_IDS };
    if (lv === 'basic')
      return {
        ...base,
        widget: 'choice',
        pictures: true,
        words: true,
        expected: id,
        text: T('Fix the motor! Pick the gear your friend says.', '모터를 고쳐요! 친구가 말하는 톱니바퀴를 고르세요.'),
      };
    if (lv === 'im1')
      return {
        ...base,
        widget: 'choice',
        pictures: true,
        words: false,
        expected: id,
        text: T('Pick the right gear for the elevator motor.', '엘리베이터 모터에 맞는 톱니바퀴를 고르세요.'),
      };
    if (lv === 'im2')
      return {
        ...base,
        widget: 'multi',
        pick: 2,
        pictures: true,
        words: false,
        expected: [id, other],
        text: T(
          'This motor needs TWO gears of the same color: the gear your teammate tells you, and the other size of that color.',
          '이 모터에는 같은 색 톱니바퀴 두 개가 필요해요. 팀원이 말한 것과, 같은 색의 다른 크기 것이에요.'
        ),
      };
    return {
      ...base,
      widget: 'choice',
      pictures: 'gray',
      words: 'code',
      expected: id,
      text: T(
        "The gears are covered in dust, so you can't see their colors. Read the labels instead: L means large, S means small, and each color is shortened to its first two letters."
      ),
    };
  },
  ask: {
    basic: T('Which gear?', '어떤 톱니바퀴야?'),
    im1: T('Which gear do we need?', '어떤 톱니바퀴가 필요해?'),
    im2: T('What size and color is the gear?', '톱니바퀴 크기와 색이 뭐야?'),
    im3: goal('Find out which gear the motor needs.'),
  },
  tell({ size, color }, lv) {
    if (lv === 'basic') return T(`${cap(size)} and ${color}!`, `${SIZE[size].ko} ${adj(color)} 거!`);
    if (lv === 'im1') return T(`We need the ${size} ${color} gear.`, `${SIZE[size].ko} ${adj(color)} 톱니바퀴가 필요해.`);
    if (lv === 'im2') return frame('We need the ___ ___ gear.', '___ ___ 톱니바퀴가 필요해.');
    return goal('Tell your teammate which gear the motor needs.');
  },
  hints({ size }, clueLv, lockLv) {
    const h1 =
      clueLv === 'basic' || clueLv === 'im1'
        ? T("Read Bolt's note on the workbench.", '작업대 위 볼트의 쪽지를 읽어요.')
        : T("Cross out the gears you can't use.", '쓸 수 없는 톱니바퀴를 지워 봐요.');
    const h2 = {
      basic: T('Pick the same gear.', '같은 톱니바퀴를 골라요.'),
      im1: T('Look at the size and the color.', '크기와 색을 봐요.'),
      im2: T('Pick two gears with the same color.', '같은 색 두 개를 골라요.'),
      im3: T('L = large (big), S = small, BL = blue.', 'L은 큰(large), S는 작은(small), BL은 파랑(blue).'),
    }[lockLv];
    return [h1, h2, T(`It's a ${size} gear.`, `${SIZE[size].ko} 톱니바퀴예요.`)];
  },
  done: T('Click! The gear fits the motor perfectly.', '딸깍! 톱니바퀴가 모터에 꼭 맞아요.'),
};

/** 스파키가 짖는 소리 (수준마다 다르게) */
export function sparkyBarks(n, lv) {
  if (lv === 'im2') return [...Array(n).fill('WOOF'), 'yip'];
  if (lv === 'im3') return [...Array(Math.floor(n / 5)).fill('AWOOO'), ...Array(n % 5).fill('WOOF')];
  return Array(n).fill('WOOF');
}
const sparky = {
  id: 'sparky',
  clue: { obj: 'sparky', en: 'Sparky the robot dog', ko: '로봇 강아지 스파키', icon: '🐕' },
  lock: { obj: 'liftpanel', en: 'Elevator buttons', ko: '엘리베이터 버튼', icon: '🛗' },
  token: (r) => ({ n: randInt(r, 3, 9) }),
  clueView({ n }, lv) {
    const art = { type: 'sparky', barks: sparkyBarks(n, lv), numbered: lv === 'basic' };
    if (lv === 'basic') return { art, text: T('Tap Sparky! Count the barks.', '스파키를 눌러요! 멍멍 소리를 세어요.') };
    if (lv === 'im1')
      return {
        art,
        text: T(
          'Sparky knows the floor number. Tap him and count his barks.',
          '스파키는 층 번호를 알아요. 눌러서 짖는 소리를 세어요.'
        ),
      };
    if (lv === 'im2')
      return {
        art,
        text: T(
          "Sparky barks the floor number. He always adds a little 'yip' at the end — don't count the yip!",
          "스파키는 층 번호만큼 짖고, 끝에 꼭 작게 '잎' 소리를 내요. '잎'은 세지 마세요!"
        ),
      };
    return {
      art,
      text: T(
        `Sparky's manual: "Sparky barks numbers in code. A short WOOF means one, and a long AWOOO means five. Add them up to get the number."`
      ),
    };
  },
  lockView({ n }, lv) {
    const base = { widget: 'dial', min: 0, max: 12 };
    if (lv === 'basic')
      return { ...base, expected: n, text: T('Type the number your friend says.', '친구가 말하는 숫자로 맞추세요.') };
    if (lv === 'im1')
      return { ...base, expected: n, text: T('Choose the floor number for the Control Room.', '관제실 층 번호를 고르세요.') };
    if (lv === 'im2')
      return {
        ...base,
        expected: n + 1,
        text: T(
          'The Control Room is one floor above the floor Sparky barks. Choose that floor.',
          '관제실은 스파키가 짖은 층보다 한 층 위예요. 그 층을 고르세요.'
        ),
      };
    return {
      ...base,
      expected: n - 1,
      text: T(
        'This elevator starts counting at zero — the ground floor is floor 0 — but Sparky starts counting at one. Choose the number the elevator uses.'
      ),
    };
  },
  ask: {
    basic: T('How many barks?', '몇 번 짖었어?'),
    im1: T('How many times did Sparky bark?', '스파키가 몇 번 짖었어?'),
    im2: T('What floor did Sparky say?', '스파키가 몇 층이래?'),
    im3: goal("Find out Sparky's floor number."),
  },
  tell({ n }, lv) {
    if (lv === 'basic') return T(`${cap(numWord(n))}!`, `${n}번!`);
    if (lv === 'im1') return T(`Sparky barked ${numWord(n)} times.`, `스파키가 ${n}번 짖었어.`);
    if (lv === 'im2') return frame('Sparky said floor ___.', '스파키가 ___층이래.');
    return goal("Tell your teammate Sparky's number.");
  },
  hints({ n }, clueLv, lockLv) {
    const h1 = {
      basic: T('Tap Sparky, the robot dog, and listen.', '로봇 강아지 스파키를 눌러 들어요.'),
      im1: T('Tap Sparky, the robot dog, and listen.', '로봇 강아지 스파키를 눌러 들어요.'),
      im2: T("Don't count the little yip.", "작은 '잎'은 세지 않아요."),
      im3: T('AWOOO is five. WOOF is one.', 'AWOOO는 5, WOOF는 1이에요.'),
    }[clueLv];
    const h2 = {
      basic: T('Use the same number.', '같은 숫자로 해요.'),
      im1: T('Use the same number.', '같은 숫자로 해요.'),
      im2: T('Add one.', '1을 더해요.'),
      im3: T('Take away one.', '1을 빼요.'),
    }[lockLv];
    return [h1, h2, T(`Sparky's number is ${n}.`, `스파키의 숫자는 ${josa(n, '이에요', '예요')}.`)];
  },
  done: T('Ding! The elevator lights up.', '딩! 엘리베이터에 불이 들어왔어요.'),
};

/* ---------- 4. 관제실 ---------- */

const PLANET_DESC = {
  earth: T('our blue home planet', '우리가 사는 파란 행성'),
  mars: T('the red planet', '빨간 행성'),
  jupiter: T('the biggest planet', '가장 큰 행성'),
  saturn: T('the planet with big rings', '큰 고리가 있는 행성'),
};
const PLANET_NOT = {
  earth: T("It isn't our home planet.", '우리가 사는 행성이 아니에요.'),
  mars: T("It isn't the red planet.", '빨간 행성이 아니에요.'),
  jupiter: T("It isn't the biggest planet.", '가장 큰 행성이 아니에요.'),
  saturn: T("It doesn't have big rings.", '큰 고리가 없어요.'),
};
const scanner = {
  id: 'scanner',
  clue: { obj: 'starmap', en: 'Star map', ko: '별 지도', icon: '🪐' },
  lock: { obj: 'scanner', en: 'Security scanner', ko: '보안 스캐너', icon: '📡' },
  token: (r) => {
    const planet = pick(r, Object.keys(PLANETS));
    const pos = PLANETS[planet].order;
    const refs = [];
    for (let k = -3; k <= 3; k++) if (k && pos - k >= 1 && pos - k <= 8) refs.push(k);
    const k = pick(r, refs);
    return { planet, k, ref: PLANET_ORDER[pos - k - 1], nots: shuffle(r, Object.keys(PLANETS).filter((p) => p !== planet)) };
  },
  clueView({ planet, k, ref, nots }, lv) {
    const P = PLANETS[planet];
    if (lv === 'basic') return { art: { type: 'planet', planet }, text: T(`${P.en}!`, `${P.ko}!`) };
    if (lv === 'im1')
      return {
        art: { type: 'planets' },
        text: T(`Scan ${PLANET_DESC[planet].en}.`, `${PLANET_DESC[planet].ko}을 살펴요.`),
      };
    if (lv === 'im2')
      return {
        art: { type: 'planets' },
        text: T(
          `Our test planet: ${nots.map((p) => PLANET_NOT[p].en).join(' ')} Which planet is it?`,
          `시험 행성: ${nots.map((p) => PLANET_NOT[p].ko).join(' ')} 어느 행성일까요?`
        ),
      };
    const n = Math.abs(k);
    return {
      art: { type: 'order' },
      text: T(
        `Navigation log: Calibrate the scanner on the planet that is ${numWord(n)} place${n > 1 ? 's' : ''} ${k > 0 ? 'farther from' : 'closer to'} the Sun than ${ref}.`
      ),
    };
  },
  lockView({ planet }, lv) {
    const base = { widget: 'choice', kind: 'planet', options: Object.keys(PLANETS), expected: planet };
    if (lv === 'basic')
      return {
        ...base,
        pictures: true,
        words: true,
        text: T('Pick the planet your friend says.', '친구가 말하는 행성을 고르세요.'),
      };
    if (lv === 'im1')
      return {
        ...base,
        pictures: true,
        words: true,
        text: T('Point the security scanner at the right planet.', '보안 스캐너를 알맞은 행성에 맞추세요.'),
      };
    if (lv === 'im2')
      return {
        ...base,
        pictures: false,
        words: true,
        text: T('Choose the planet by its name to calibrate the scanner.', '이름을 보고 행성을 골라 스캐너를 맞추세요.'),
      };
    return {
      widget: 'word',
      expected: PLANETS[planet].en,
      text: T('Type the name of the planet into the scanner. Spelling counts!'),
    };
  },
  ask: {
    basic: T('Which planet?', '어느 행성이야?'),
    im1: T('Which planet do we scan?', '어느 행성을 살펴?'),
    im2: T('Which planet is the test planet?', '시험 행성은 어느 거야?'),
    im3: goal('Find out which planet to scan.'),
  },
  tell({ planet }, lv) {
    const P = PLANETS[planet];
    if (lv === 'basic') return T(`${P.en}!`, `${P.ko}!`);
    if (lv === 'im1') return T(`It's ${P.en}.`, `${josa(P.ko, '이야', '야')}.`);
    if (lv === 'im2') return frame('The planet is ___.', '행성은 ___야.');
    return goal('Tell your teammate which planet to scan.');
  },
  hints({ planet }, clueLv, lockLv) {
    const h1 = {
      basic: T('Look at the star map on the round table.', '둥근 탁자 위 별 지도를 보세요.'),
      im1: T('Look at the star map on the round table.', '둥근 탁자 위 별 지도를 보세요.'),
      im2: T('Cross out the planets one by one.', '행성을 하나씩 지워 봐요.'),
      im3: T('Use the chart of planets in order from the Sun.', '태양에서부터 순서대로 놓인 행성 표를 써요.'),
    }[clueLv];
    const h2 = {
      basic: T('Pick the same planet.', '같은 행성을 골라요.'),
      im1: T('Pick the same planet.', '같은 행성을 골라요.'),
      im2: T('Read the names of the planets.', '행성 이름을 읽어요.'),
      im3: T('Spell the name of the planet.', '행성 이름의 철자를 써요.'),
    }[lockLv];
    const w = PLANETS[planet].en;
    return [h1, h2, T(`It starts with "${w[0]}".`, `"${w[0]}"로 시작해요.`)];
  },
  done: T('The scanner beeps: "Calibration complete!"', '스캐너가 삐 하고 울려요: "조정 완료!"'),
};

const SPACE_WORDS = {
  rocket: '로켓',
  planet: '행성',
  comet: '혜성',
  orbit: '궤도',
  meteor: '유성',
  galaxy: '은하',
};
const caesar = (w) =>
  [...w.toUpperCase()].map((ch) => String.fromCharCode(((ch.charCodeAt(0) - 65 + 1) % 26) + 65)).join('');
const password = {
  id: 'password',
  clue: { obj: 'comms', en: "Earth's message", ko: '지구의 메시지', icon: '🌍' },
  lock: { obj: 'mic', en: 'Radio to Earth', ko: '지구 무전', icon: '🎙️' },
  token: (r) => {
    const word = pick(r, Object.keys(SPACE_WORDS));
    return { word, blank: blanked(r, word), extra: shuffle(r, [...'ABDFHJLMNSUWXYZ'].filter((x) => !word.toUpperCase().includes(x))).slice(0, 2) };
  },
  clueView({ word, blank }, lv) {
    const W = word.toUpperCase();
    if (lv === 'basic')
      return { art: { type: 'word', word: W, picture: word }, say: `${cap(word)}! ${spell(word)}.`, text: T(W, SPACE_WORDS[word]) };
    if (lv === 'im1')
      return {
        art: { type: 'word', word: blank.toUpperCase(), picture: word },
        text: T(
          'Earth sent a password, but two letters are missing. Look at the picture!',
          '지구가 암호를 보냈는데 글자 두 개가 빠졌어요. 그림을 보세요!'
        ),
      };
    if (lv === 'im2')
      return {
        art: { type: 'word', word: [...W].reverse().join('') },
        text: T("Earth's message came in backwards! Read it from right to left.", '지구의 메시지가 거꾸로 왔어요! 오른쪽부터 읽어요.'),
      };
    return {
      art: { type: 'word', word: caesar(word) },
      text: T(
        'The password is in code: every letter was moved one step forward in the alphabet (A became B, B became C, and so on). Move each letter one step back to read it.'
      ),
    };
  },
  lockView({ word, extra }, lv) {
    if (lv === 'basic')
      return {
        widget: 'word',
        tiles: [...new Set([...word.toUpperCase(), ...extra])].sort(),
        expected: word,
        text: T('Type the password. Your friend can spell it for you.', '암호를 입력해요. 친구가 철자를 불러 줄 거예요.'),
      };
    if (lv === 'im1')
      return { widget: 'word', expected: word, text: T('Type the secret password from Earth.', '지구에서 온 비밀 암호를 입력하세요.') };
    if (lv === 'im2')
      return {
        widget: 'voice',
        expected: word,
        voice: { keywords: [word], minWords: 5 },
        text: T(
          'Say the password to Earth Control in a sentence: "This is Station Nova. The password is ___. Over."',
          '문장으로 지구 관제소에 암호를 말해요: "This is Station Nova. The password is ___. Over."'
        ),
      };
    return {
      widget: 'voice',
      expected: word,
      voice: { keywords: [word], minWords: 8 },
      text: T('Radio Earth Control. Say who you are, why you are calling, and the password. End with "Over."'),
    };
  },
  ask: {
    basic: T('What is the password?', '암호가 뭐야?'),
    im1: T('How do you spell the password?', '암호 철자가 뭐야?'),
    im2: T('Can you tell me the password and spell it?', '암호랑 철자를 알려 줄래?'),
    im3: goal('Find out the password from Earth.'),
  },
  tell({ word }, lv) {
    if (lv === 'basic') return T(`${cap(word)}! ${spell(word)}.`, `${SPACE_WORDS[word]}! ${spell(word)}.`);
    if (lv === 'im1') return T(`The password is ${word}. ${spell(word)}.`, `암호는 ${word}(${SPACE_WORDS[word]})야. ${spell(word)}.`);
    if (lv === 'im2') return frame('The password is ___. It is spelled ___.', '암호는 ___야. 철자는 ___야.');
    return goal('Tell your teammate the password.');
  },
  hints({ word }, clueLv, lockLv) {
    const h1 = {
      basic: T("Look at the big screen with Earth's message.", '지구 메시지가 뜬 큰 화면을 보세요.'),
      im1: T('Look at the picture to find the missing letters.', '그림을 보고 빠진 글자를 찾아요.'),
      im2: T('Read the letters backwards.', '글자를 거꾸로 읽어요.'),
      im3: T('B becomes A, C becomes B: go one letter back.', 'B는 A로, C는 B로: 한 글자씩 앞으로 돌려요.'),
    }[clueLv];
    const h2 = {
      basic: T('Tap the letters one by one.', '글자를 하나씩 눌러요.'),
      im1: T('Type the letters one by one.', '글자를 하나씩 입력해요.'),
      im2: T('Say the password inside the sentence.', '문장 속에 암호를 넣어 말해요.'),
      im3: T('Say three things: who you are, why you are calling, and the password.', '누구인지, 왜 연락하는지, 암호 세 가지를 말해요.'),
    }[lockLv];
    return [h1, h2, T(`The password starts with "${word[0].toUpperCase()}".`, `암호는 "${word[0].toUpperCase()}"로 시작해요.`)];
  },
  done: T('Earth Control: "Password correct. Good luck, Station Nova!"', '지구 관제소: "암호 확인. 행운을 빈다, 노바 정거장!"'),
};

const POWER_PHRASE = {
  2: 'as many power units as a bicycle has wheels',
  3: 'as many power units as there are letters in the word "sun"',
  4: 'as many power units as a car has wheels',
  5: 'as many power units as you have fingers on one hand',
};
const power = {
  id: 'power',
  clue: { obj: 'chart', en: 'Power chart', ko: '전력 표', icon: '📊' },
  lock: { obj: 'switchboard', en: 'Camera switchboard', ko: '카메라 전력판', icon: '🎚️' },
  token: (r) => ({ levels: shuffle(r, [2, 3, 4, 5]).slice(0, 3), order: shuffle(r, [0, 1, 2]) }),
  clueView({ levels, order }, lv) {
    const [a, b, d] = levels;
    if (lv === 'basic')
      return {
        art: { type: 'bars', levels, numbers: true },
        text: T(`${cap(numWord(a))}, ${numWord(b)}, ${numWord(d)}!`, `${a}, ${b}, ${d}!`),
      };
    if (lv === 'im1')
      return {
        art: { type: 'bars', levels, numbers: false },
        text: T(
          levels.map((v, i) => `Camera ${i + 1}: ${numWord(v)}.`).join(' '),
          levels.map((v, i) => `카메라 ${i + 1}: ${v}.`).join(' ')
        ),
      };
    if (lv === 'im2') {
      const idx = [0, 1, 2].sort((x, y) => levels[x] - levels[y]);
      const [lo, mid, hi] = idx;
      return {
        art: { type: 'paper' },
        text: T(
          `Camera ${lo + 1} needs the least power: only ${numWord(levels[lo])}. Camera ${hi + 1} needs the most: ${numWord(levels[hi])}. Camera ${mid + 1} is in between, at ${numWord(levels[mid])}.`,
          `카메라 ${josa(lo + 1, '은', '는')} 전력이 가장 적게 필요해요: ${levels[lo]}. 카메라 ${josa(hi + 1, '은', '는')} 가장 많이: ${levels[hi]}. 카메라 ${josa(mid + 1, '은', '는')} 그 사이인 ${josa(levels[mid], '이에요', '예요')}.`
        ),
      };
    }
    return {
      art: { type: 'paper' },
      text: T(order.map((i) => `Camera ${i + 1} needs ${POWER_PHRASE[levels[i]]}.`).join(' ')),
    };
  },
  lockView({ levels }, lv) {
    const base = { widget: 'sliders', n: 3, min: 1, max: 5 };
    if (lv === 'basic')
      return {
        ...base,
        expected: levels,
        text: T(
          'Turn on the cameras! Move the sliders to the numbers your friend says.',
          '카메라를 켜요! 친구가 말하는 숫자로 슬라이더를 옮기세요.'
        ),
      };
    if (lv === 'im1')
      return { ...base, expected: levels, text: T('Set the power for the three cameras.', '카메라 세 대의 전력을 맞추세요.') };
    if (lv === 'im2')
      return {
        ...base,
        expected: levels.map((v) => 6 - v),
        text: T(
          'Careful! On this old board, the numbers are backwards: 1 means 5, 2 means 4, 3 stays 3, 4 means 2, and 5 means 1.',
          '조심! 이 낡은 판은 숫자가 거꾸로예요. 1은 5, 2는 4, 3은 그대로, 4는 2, 5는 1이에요.'
        ),
      };
    return {
      ...base,
      expected: levels.map((v) => v - 1),
      text: T(
        'The solar storm is already adding one unit of power to every camera. Set each slider one unit lower than the chart says.'
      ),
    };
  },
  ask: {
    basic: T('What numbers?', '숫자가 뭐야?'),
    im1: T('What number is camera one?', '카메라 1은 몇이야?'),
    im2: T('How much power does each camera need?', '카메라마다 전력이 얼마나 필요해?'),
    im3: goal('Find out how much power each camera needs.'),
  },
  tell({ levels: [a, b, d] }, lv) {
    if (lv === 'basic') return T(`${cap(numWord(a))}, ${numWord(b)}, ${numWord(d)}!`, `${a}, ${b}, ${d}!`);
    if (lv === 'im1')
      return T(
        `Camera one is ${numWord(a)}, camera two is ${numWord(b)}, and camera three is ${numWord(d)}.`,
        `카메라 1은 ${a}, 카메라 2는 ${b}, 카메라 3은 ${josa(d, '이야', '야')}.`
      );
    if (lv === 'im2') return frame('Camera ___ needs ___.', '카메라 ___에는 ___만큼 필요해.');
    return goal('Tell your teammate how much power each camera needs.');
  },
  hints(t, clueLv, lockLv, expected) {
    const h1 = {
      basic: T('Look at the power chart on the wall.', '벽의 전력 표를 보세요.'),
      im1: T('Look at the power chart on the wall.', '벽의 전력 표를 보세요.'),
      im2: T('"Least" is the smallest. "Most" is the biggest.', '"least"는 가장 작은 것, "most"는 가장 큰 것.'),
      im3: T('Think: how many wheels? How many fingers?', '바퀴가 몇 개? 손가락이 몇 개?'),
    }[clueLv];
    const h2 = {
      basic: T('Use the same numbers.', '같은 숫자로 맞춰요.'),
      im1: T('Use the same numbers.', '같은 숫자로 맞춰요.'),
      im2: T('1 and 5 swap. 2 and 4 swap. 3 stays.', '1↔5, 2↔4 바꾸고 3은 그대로.'),
      im3: T('Take one away from each number.', '숫자마다 1씩 빼요.'),
    }[lockLv];
    return [h1, h2, T(`Camera 1 needs ${expected[0]}.`, `카메라 1은 ${josa(expected[0], '이에요', '예요')}.`)];
  },
  done: T('The security cameras turn on, one by one!', '보안 카메라가 하나씩 켜졌어요!'),
};

const hourWord = (h) => numWord(((h - 1) % 12) + 1);
/** 9:30 → "nine thirty" */
export function timeWords(h, m) {
  const mm = { 0: "o'clock", 15: 'fifteen', 30: 'thirty', 45: 'forty-five' }[m];
  return `${hourWord(h)} ${mm}`;
}
/** 9:30 → "half past nine", 9:45 → "a quarter to ten" */
function quarterWords(h, m) {
  if (m === 0) return `${hourWord(h)} o'clock`;
  if (m === 15) return `a quarter past ${hourWord(h)}`;
  if (m === 30) return `half past ${hourWord(h)}`;
  return `a quarter to ${hourWord(h + 1)}`;
}
const DURATION = { 15: 'a quarter of an hour', 30: 'half an hour', 45: 'three quarters of an hour', 90: 'an hour and a half' };
const addMin = ({ h, m }, d) => {
  const t = h * 60 + m + d;
  return { h: Math.floor(t / 60), m: t % 60 };
};
const hm = ({ h, m }) => `${h}:${String(m).padStart(2, '0')}`;
const doorclock = {
  id: 'doorclock',
  clue: { obj: 'captainlog', en: "Captain's video log", ko: '선장의 영상 기록', icon: '📹' },
  lock: { obj: 'doorclock', en: 'Door clock', ko: '문 시계', icon: '🕘' },
  token: (r) => ({ h: randInt(r, 8, 10), m: pick(r, [0, 15, 30, 45]), d2: pick(r, [15, 30, 45]), d3: pick(r, [30, 45, 90]) }),
  clueView({ h, m, d2, d3 }, lv) {
    const t = { h, m };
    if (lv === 'basic')
      return { art: { type: 'clock', h, m }, text: T(`${cap(timeWords(h, m))}!`, `${h}시${m ? ` ${m}분` : ''}!`) };
    if (lv === 'im1')
      return {
        art: { type: 'captain' },
        listen: true,
        text: T(
          `This is Captain Luna. In an emergency, the Core Room door opens at ${timeWords(h, m)}.`,
          `루나 선장이다. 비상시에는 코어 룸 문이 ${h}시${m ? ` ${m}분` : ''}에 열린다.`
        ),
      };
    if (lv === 'im2') {
      const s = addMin(t, -d2);
      return {
        art: { type: 'captain' },
        listen: 'after',
        text: T(
          `Captain's log: I set the safety timer at ${hm(s)}. The Core Room door unlocks ${d2} minutes later.`,
          `선장 기록: 안전 타이머를 ${hm(s)}에 맞췄다. 코어 룸 문은 ${d2}분 뒤에 열린다.`
        ),
      };
    }
    const s = addMin(t, -d3);
    return {
      art: { type: 'captain' },
      listen: 'hidden',
      text: T(
        `Captain's log: I set the safety timer at ${quarterWords(s.h, s.m)} this evening. The Core Room door unlocks ${DURATION[d3]} later.`
      ),
    };
  },
  lockView({ h, m }, lv) {
    if (lv === 'basic')
      return {
        widget: 'clock',
        h24: false,
        expected: { h, m },
        text: T('Set the clock to the time your friend says.', '친구가 말하는 시각으로 시계를 맞추세요.'),
      };
    if (lv === 'im1')
      return {
        widget: 'clock',
        h24: false,
        expected: { h, m },
        text: T('Set the door clock to the time from the captain.', '선장이 말한 시각으로 문 시계를 맞추세요.'),
      };
    if (lv === 'im2')
      return {
        widget: 'clock',
        h24: true,
        expected: { h: h + 12, m },
        text: T(
          'This door uses 24-hour time, and the captain means the evening (PM). For example, 8:00 PM is 20:00. Set the clock.',
          '이 문은 24시간제이고, 선장이 말한 건 저녁(오후) 시간이에요. 예: 오후 8시는 20:00. 시계를 맞추세요.'
        ),
      };
    return {
      widget: 'clock',
      h24: false,
      expected: addMin({ h, m }, -15),
      text: T('For safety, this lock must be set a quarter of an hour before the time the door unlocks.'),
    };
  },
  ask: {
    basic: T('What time?', '몇 시야?'),
    im1: T('What time does the door open?', '문이 몇 시에 열려?'),
    im2: T('When does the Core Room door unlock?', '코어 룸 문은 언제 열려?'),
    im3: goal('Find out when the Core Room door unlocks.'),
  },
  tell({ h, m }, lv) {
    if (lv === 'basic') return T(`${cap(timeWords(h, m))}!`, `${h}시${m ? ` ${m}분` : ''}!`);
    if (lv === 'im1') return T(`The door opens at ${timeWords(h, m)}.`, `문은 ${h}시${m ? ` ${m}분` : ''}에 열려.`);
    if (lv === 'im2') return frame('The door unlocks at ___.', '문은 ___에 열려.');
    return goal('Tell your teammate when the door unlocks.');
  },
  hints({ h }, clueLv, lockLv, expected) {
    const h1 = {
      basic: T("Watch the captain's video on the chair.", '의자 위 선장의 영상을 보세요.'),
      im1: T("Watch the captain's video on the chair.", '의자 위 선장의 영상을 보세요.'),
      im2: T('Add the minutes to the time.', '시각에 분을 더해요.'),
      im3: T('Half past nine is 9:30. A quarter to ten is 9:45.', 'half past nine은 9:30, a quarter to ten은 9:45예요.'),
    }[clueLv];
    const h2 = {
      basic: T('Set the same time.', '같은 시각으로 맞춰요.'),
      im1: T('Set the same time.', '같은 시각으로 맞춰요.'),
      im2: T('PM: add 12 to the hour.', '오후니까 시에 12를 더해요.'),
      im3: T('Go back fifteen minutes.', '15분 전으로 맞춰요.'),
    }[lockLv];
    return [h1, h2, T(`The hour is ${expected.h}.`, `시는 ${expected.h}시예요.`)];
  },
  done: T('Click! The Core Room door unlocks...', '딸깍! 코어 룸 문이 열렸어요...'),
};

/* ---------- 방 목록 ---------- */

export const ROOM_PAIRS = [
  [fuse, crates, charger, switches],
  [fruit, fountain, song, bigbud],
  [arm, wires, gears, sparky],
  [scanner, password, power, doorclock],
];

/** 방마다 문 비밀 단어 후보 (4글자: 스테이션마다 한 글자) */
export const EXIT_WORDS = [
  ['NOVA', 'MOON', 'STAR', 'GLOW', 'BEAM', 'ZOOM', 'OPEN', 'SPIN'],
  ['LEAF', 'SEED', 'TREE', 'GROW', 'ROSE', 'PLUM', 'MINT', 'LILY'],
  ['GEAR', 'WIRE', 'BEEP', 'TOOL', 'PUSH', 'LIFT', 'BUZZ'],
  ['CORE', 'CODE', 'LOCK', 'SAFE', 'KEYS', 'DOOR'],
];
