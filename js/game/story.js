// 이야기 (순수 데이터): 노바 정거장 SOS — 사라진 별의 심장(Star Core)
// 불이 꺼진 우주정거장에서 방 4개를 차례로 되살리며 도우미 로봇 핍의 기억 칩(증거)을 모으고,
// 마지막 코어 룸에서 용의자 4명 중 거짓말을 하는 한 명을 찾는다(마피아식 추리, 아무도 탈락하지 않는다).
// 범인은 팀 코드의 시드로 정해지므로 판마다 다르다. 누가 범인이든 무섭거나 나쁜 이유가 아니다(실수 → 사과 → 화해).
// 대사는 쉬운 영어(easy: Basic·IM1)와 보통 영어(hard: IM2·IM3) 두 가지에 한국어가 붙는다.

import { pick, rngFor } from './logic.js';

const T = (en, ko) => ({ en, ko });
/** 대사 한 줄: who는 말하는 인물 */
const L = (who, easyEn, easyKo, hardEn = easyEn, hardKo = easyKo) => ({
  who,
  easy: T(easyEn, easyKo),
  hard: T(hardEn, hardKo),
});

export const SPEAKERS = {
  pip: { name: 'Pip', ko: '핍' },
  nova: { name: 'NOVA', ko: '정거장 컴퓨터' },
  narrator: { name: '', ko: '' },
  luna: { name: 'Captain Luna', ko: '루나 선장' },
  bolt: { name: 'Bolt', ko: '볼트' },
  zeek: { name: 'Zeek', ko: '지크' },
  mira: { name: 'Dr. Mira', ko: '미라 박사' },
  momo: { name: 'Momo', ko: '모모' },
};

export const TITLE = { en: 'Station NOVA SOS', ko: '노바 정거장 SOS', sub: '사라진 별의 심장' };

export const PROLOGUE = [
  L(
    'narrator',
    'Welcome to Station NOVA, Space Cadets!',
    '노바 우주정거장에 온 걸 환영해요, 우주 사관생도 여러분!',
    'Welcome aboard Station NOVA, Space Cadets! Your shuttle has just docked for Space Cadet Day.',
    '노바 우주정거장에 온 걸 환영해요, 우주 사관생도 여러분! 사관생도의 날을 맞아 방금 셔틀이 도착했어요.'
  ),
  L(
    'narrator',
    'BOOM! The lights go out!',
    '쾅! 불이 모두 꺼졌어요!',
    'Suddenly — BOOM! The lights go out, and red lights start to blink.',
    '그때 갑자기 쾅! 불이 모두 꺼지고 빨간 경고등이 깜빡여요.'
  ),
  L(
    'nova',
    'WARNING! The Star Core is gone!',
    '경고! 별의 심장이 사라졌습니다!',
    'WARNING. The Star Core is missing. Shield power: zero percent.',
    '경고. 별의 심장(스타 코어)이 사라졌습니다. 방어막 전원 0퍼센트.'
  ),
  L(
    'pip',
    "Beep-boop! I'm Pip, a helper robot. I lost my memory chips!",
    '삐빅! 나는 도우미 로봇 핍이야. 기억 칩을 잃어버렸어!',
    "Beep-boop! Hi, I'm Pip, the station's helper robot. When the lights went out, my four memory chips fell out!",
    '삐빅! 안녕, 나는 정거장 도우미 로봇 핍이야. 불이 꺼질 때 내 기억 칩 네 개가 빠져 버렸어!'
  ),
  L(
    'pip',
    'A big storm is coming! We need the Star Core!',
    '큰 폭풍이 와! 별의 심장이 필요해!',
    "A solar storm is coming. Without the Star Core, our shield can't turn on. We have to find it before the storm hits!",
    '곧 태양 폭풍이 와. 별의 심장이 없으면 방어막을 켤 수 없어. 폭풍이 오기 전에 꼭 찾아야 해!'
  ),
  L(
    'pip',
    'Talk in English. Work together!',
    '영어로 이야기하며 힘을 합쳐!',
    "Each of you has a special job. Talk to each other in English — that's how real space crews work!",
    '너희는 각자 맡은 임무가 있어. 진짜 우주 대원들처럼 영어로 서로 이야기하며 힘을 합쳐 봐!'
  ),
];

/* ---------- 용의자 ---------- */

// 겉모습 특징 3가지(크기·색·종류) 중 아무 두 가지만 알아도 한 명으로 좁혀진다 (테스트가 확인)
export const SUSPECTS = [
  {
    id: 'bolt',
    name: 'Bolt',
    ko: '볼트',
    size: 'big',
    color: 'orange',
    kind: 'robot',
    job: T('the repair robot', '수리 로봇'),
    place: T('Robot Workshop', '로봇 작업실'),
    arrive: '8:00',
    style: 'grumpy but kind, says "Hmph!", loves fixing things',
  },
  {
    id: 'zeek',
    name: 'Zeek',
    ko: '지크',
    size: 'small',
    color: 'purple',
    kind: 'robot',
    job: T('the delivery drone', '배달 드론'),
    place: T('Mail Room', '우편실'),
    arrive: '8:45',
    style: 'fast, jumpy and chatty, says "Zip-zip!"',
  },
  {
    id: 'mira',
    name: 'Dr. Mira',
    ko: '미라 박사',
    size: 'big',
    color: 'purple',
    kind: 'creature',
    job: T('the alien scientist', '외계인 과학자'),
    place: T('Science Lab', '과학 실험실'),
    arrive: '8:30',
    style: 'calm, polite and curious, a tall alien with three eyes',
  },
  {
    id: 'momo',
    name: 'Momo',
    ko: '모모',
    size: 'small',
    color: 'orange',
    kind: 'creature',
    job: T("the station's pet space hamster", '정거장 애완 우주 햄스터'),
    place: T('Space Garden', '우주 정원'),
    arrive: '8:50',
    style: 'shy and sweet, talks about itself as "Momo", says "Squeak!"',
  },
];
export const suspectOf = (id) => SUSPECTS.find((s) => s.id === id);

/** 이번 판의 범인 (시드로 정한다: 모든 폰에서 같다) */
export const culpritOf = (seed) => pick(rngFor(seed, 'culprit'), SUSPECTS).id;

export const TRAIT = {
  big: T('big', '컸다'),
  small: T('small', '작았다'),
  orange: T('orange', '주황색'),
  purple: T('purple', '보라색'),
  robot: T('oil drops', '기름 방울'),
  creature: T('cookie crumbs', '쿠키 부스러기'),
};

/* ---------- 방 ---------- */

export const ROOMS = [
  {
    id: 'dock',
    title: T('Docking Bay', '도킹 베이'),
    dark: true,
    intro: [
      L(
        'pip',
        "This is the Docking Bay. It's dark!",
        '여기는 도킹 베이야. 깜깜해!',
        "We're in the Docking Bay. It's so dark! The door to the station is locked.",
        '여기는 도킹 베이야. 너무 어두워! 정거장으로 가는 문도 잠겨 있어.'
      ),
      L(
        'pip',
        'Find four letters. Open the door!',
        '글자 네 개를 찾아서 문을 열자!',
        'Fix the machines to get four letters. The four letters will open the big door.',
        '기계를 고치면 글자가 하나씩 나와. 글자 네 개를 모으면 큰 문이 열려.'
      ),
    ],
    pip: [
      {
        q: T('Who are you?', '너는 누구야?'),
        qh: T('What kind of robot are you, Pip?', '핍, 너는 어떤 로봇이야?'),
        a: T('I am Pip! I am a helper robot.', '나는 핍이야! 도우미 로봇이지.'),
        ah: T(
          "I'm Pip, the station's helper robot. I carry tools, fix little things and make new friends!",
          '나는 정거장 도우미 로봇 핍이야. 도구를 나르고, 작은 것을 고치고, 새 친구를 사귀어!'
        ),
      },
      {
        q: T('What happened?', '무슨 일이야?'),
        qh: T('What happened to the station?', '정거장에 무슨 일이 있었어?'),
        a: T('The lights went out. The Star Core is gone!', '불이 꺼졌어. 별의 심장이 없어졌어!'),
        ah: T(
          'At ten past nine, someone took the Star Core from the Core Room, and all the lights went out.',
          '9시 10분에 누군가 코어 룸에서 별의 심장을 가져갔고, 그래서 불이 다 꺼졌어.'
        ),
      },
      {
        q: T('What is the Star Core?', '별의 심장이 뭐야?'),
        qh: T('Why is the Star Core so important?', '별의 심장이 왜 그렇게 중요해?'),
        a: T('It is a big, shiny crystal. It gives us power.', '크고 반짝이는 수정이야. 우리에게 전기를 줘.'),
        ah: T(
          "It's a glowing crystal that powers the whole station. Without it, our shield can't stop the solar storm.",
          '정거장 전체에 전기를 주는 빛나는 수정이야. 그게 없으면 방어막이 태양 폭풍을 막지 못해.'
        ),
      },
      {
        q: T('How do we open the door?', '문은 어떻게 열어?'),
        qh: T('How can we get out of the Docking Bay?', '도킹 베이에서 어떻게 나가?'),
        a: T('Find four letters. Ask your friends!', '글자 네 개를 찾아. 친구들에게 물어봐!'),
        ah: T(
          'Each machine you fix gives you one letter. Put all four letters together to open the big door.',
          '기계를 하나 고칠 때마다 글자가 하나 나와. 네 글자를 모두 모으면 큰 문이 열려.'
        ),
      },
    ],
    facts:
      'The Docking Bay is where the cadets\' shuttle landed. It is dark, with red emergency lights. There is a shuttle, a radio, cargo boxes, a fuse box, a big window with stars and Earth, Pip\'s charger, a safety poster, light switches, lockers and a big locked door to the station. Captain Luna is at the Moon base and talks on the radio.',
  },
  {
    id: 'garden',
    title: T('Space Garden', '우주 정원'),
    intro: [
      L(
        'pip',
        'This is the Space Garden. Big Bud is scared!',
        '여기는 우주 정원이야. 빅 버드가 무서워해!',
        'This is the Space Garden. Oh no — Big Bud closed its leaves when the lights went out. Big Bud is scared of the dark!',
        '여기는 우주 정원이야. 이런, 불이 꺼지자 빅 버드가 잎을 꼭 닫아 버렸어. 빅 버드는 어둠을 무서워하거든!'
      ),
      L(
        'pip',
        'Help Big Bud. Find four letters!',
        '빅 버드를 도와주고 글자 네 개를 찾자!',
        "Big Bud is blocking the door. Let's give it food, water and a song — and find the four letters!",
        '빅 버드가 문을 막고 있어. 먹이랑 물을 주고 노래도 불러 주면서 글자 네 개를 찾자!'
      ),
    ],
    pip: [
      {
        q: T('Who is Big Bud?', '빅 버드는 누구야?'),
        qh: T('Tell me about Big Bud.', '빅 버드에 대해 알려 줘.'),
        a: T('Big Bud is a big, friendly plant.', '빅 버드는 크고 다정한 식물이야.'),
        ah: T(
          "Big Bud is a giant space plant. It's very friendly, but it's scared of the dark, so it closed its leaves.",
          '빅 버드는 거대한 우주 식물이야. 아주 다정하지만 어둠을 무서워해서 잎을 닫았어.'
        ),
      },
      {
        q: T('What does Big Bud like?', '빅 버드는 뭘 좋아해?'),
        qh: T('How can we wake Big Bud up?', '빅 버드를 어떻게 깨워?'),
        a: T('Big Bud likes fruit, water and songs!', '빅 버드는 과일, 물, 노래를 좋아해!'),
        ah: T(
          'Big Bud loves tasty fruit, cool water, happy songs and its own magic word.',
          '빅 버드는 맛있는 과일, 시원한 물, 신나는 노래, 그리고 자기만의 마법 단어를 좋아해.'
        ),
      },
      {
        q: T('Who lives here?', '여기 누가 살아?'),
        qh: T('Does anyone live in the garden?', '정원에 사는 누가 있어?'),
        a: T('Momo sleeps here. Momo is a space hamster.', '모모가 여기서 자. 모모는 우주 햄스터야.'),
        ah: T(
          "Momo, the station's fluffy space hamster, sleeps in a flowerpot here.",
          '정거장의 복슬복슬한 우주 햄스터 모모가 여기 화분에서 자.'
        ),
      },
      {
        q: T('Are the fish real?', '물고기는 진짜야?'),
        qh: T('Where do the glow fish come from?', '빛나는 물고기는 어디서 왔어?'),
        a: T('Yes! They are space fish. They glow!', '응! 우주 물고기야. 빛이 나!'),
        ah: T(
          "They're glow fish from the Science Lab. Dr. Mira brought them here so they can enjoy the plants.",
          '과학 실험실에서 온 빛나는 물고기야. 미라 박사가 식물을 즐기라고 여기 데려왔어.'
        ),
      },
    ],
    facts:
      'The Space Garden is a glass dome full of glowing space plants. Big Bud, a giant friendly plant, closed its leaves in the dark and is blocking the exit door. There is a fruit tree, a fountain with glow fish, a water pump, bell flowers that play music, a music sheet, a grow-light screen, a gardener\'s notebook and Momo\'s flowerpot bed.',
  },
  {
    id: 'workshop',
    title: T('Robot Workshop', '로봇 작업실'),
    intro: [
      L(
        'pip',
        'This is the Robot Workshop. The elevator is broken!',
        '여기는 로봇 작업실이야. 엘리베이터가 고장 났어!',
        'This is the Robot Workshop. The elevator to the Control Room is broken. We need to fix it!',
        '여기는 로봇 작업실이야. 관제실로 가는 엘리베이터가 고장 났어. 고쳐야 해!'
      ),
      L(
        'pip',
        'Fix the machines. Find four letters!',
        '기계를 고치고 글자 네 개를 찾자!',
        "Let's get a gear, fix the power and find the right floor. Four letters will start the elevator.",
        '톱니바퀴를 구하고, 전원을 고치고, 알맞은 층을 찾자. 글자 네 개가 엘리베이터를 움직일 거야.'
      ),
    ],
    pip: [
      {
        q: T('Whose workshop is this?', '여기는 누구 작업실이야?'),
        qh: T('Who works in this workshop?', '이 작업실에서는 누가 일해?'),
        a: T("This is Bolt's workshop. Bolt fixes things.", '볼트의 작업실이야. 볼트는 물건을 고쳐.'),
        ah: T(
          "This is Bolt's workshop. Bolt is a big repair robot who can fix almost anything.",
          '볼트의 작업실이야. 볼트는 거의 뭐든 고치는 커다란 수리 로봇이야.'
        ),
      },
      {
        q: T('Who is Sparky?', '스파키는 누구야?'),
        qh: T('What does Sparky do?', '스파키는 뭘 해?'),
        a: T('Sparky is a robot dog. He barks!', '스파키는 로봇 강아지야. 멍멍 짖어!'),
        ah: T(
          "Sparky is Bolt's robot dog. He's still being repaired, but he loves to bark numbers.",
          '스파키는 볼트의 로봇 강아지야. 아직 수리 중이지만 숫자를 짖는 걸 좋아해.'
        ),
      },
      {
        q: T('Where does the elevator go?', '엘리베이터는 어디로 가?'),
        qh: T('Where will the elevator take us?', '엘리베이터를 타면 어디로 가?'),
        a: T('It goes up to the Control Room.', '관제실로 올라가.'),
        ah: T(
          'It goes up to the Control Room, where we can turn on the security system.',
          '관제실로 올라가. 거기서 보안 시스템을 켤 수 있어.'
        ),
      },
      {
        q: T('Who is Zeek?', '지크는 누구야?'),
        qh: T('Tell me about Zeek.', '지크에 대해 알려 줘.'),
        a: T('Zeek is a small drone. Zeek brings letters.', '지크는 작은 드론이야. 편지를 날라.'),
        ah: T(
          'Zeek is a little delivery drone. Zeek flies around the station with letters and packages.',
          '지크는 작은 배달 드론이야. 편지와 소포를 들고 정거장을 날아다녀.'
        ),
      },
    ],
    facts:
      'The Robot Workshop belongs to Bolt, the repair robot. There are workbenches, a big robot arm, shelves of gears, a wiring blueprint, a power box, Bolt\'s note, Sparky the robot dog and a broken elevator that goes up to the Control Room.',
  },
  {
    id: 'control',
    title: T('Control Room', '관제실'),
    intro: [
      L(
        'pip',
        'This is the Control Room. Look! The storm is coming!',
        '여기는 관제실이야. 봐! 폭풍이 오고 있어!',
        'This is the Control Room. Look out the window — the solar storm is getting closer!',
        '여기는 관제실이야. 창밖을 봐. 태양 폭풍이 점점 다가오고 있어!'
      ),
      L(
        'pip',
        'Turn on the cameras. Open the Core Room!',
        '카메라를 켜고 코어 룸을 열자!',
        "If we turn the security system back on, we can open the Core Room and read last night's door log.",
        '보안 시스템을 다시 켜면 코어 룸 문을 열고 어젯밤 출입 기록도 볼 수 있어.'
      ),
    ],
    pip: [
      {
        q: T('What is that light outside?', '밖에 저 빛은 뭐야?'),
        qh: T("What's that orange glow outside the window?", '창밖의 주황빛은 뭐야?'),
        a: T('It is the solar storm. It is coming!', '태양 폭풍이야. 다가오고 있어!'),
        ah: T("That's the solar storm. It's getting closer, so we have to hurry!", '태양 폭풍이야. 점점 가까워지니까 서둘러야 해!'),
      },
      {
        q: T('What is the door log?', '출입 기록이 뭐야?'),
        qh: T('How will the door log help us?', '출입 기록이 어떻게 도움이 돼?'),
        a: T('It shows when doors open.', '문이 언제 열렸는지 보여 줘.'),
        ah: T(
          'It records every time a door opens. It can show us who moved around last night.',
          '문이 열릴 때마다 기록해. 어젯밤 누가 돌아다녔는지 알 수 있어.'
        ),
      },
      {
        q: T('Who is Dr. Mira?', '미라 박사는 누구야?'),
        qh: T('What does Dr. Mira study?', '미라 박사는 뭘 연구해?'),
        a: T('Dr. Mira is a scientist. She studies stars.', '미라 박사는 과학자야. 별을 연구해.'),
        ah: T(
          "Dr. Mira is the station's alien scientist. She studies stars and glowing creatures.",
          '미라 박사는 정거장의 외계인 과학자야. 별과 빛나는 생물을 연구해.'
        ),
      },
      {
        q: T('Where is the captain?', '선장님은 어디 있어?'),
        qh: T("Why isn't Captain Luna here?", '루나 선장은 왜 여기 없어?'),
        a: T('She is at the Moon base.', '달 기지에 있어.'),
        ah: T(
          "Captain Luna went to the Moon base this morning. She'll be back tomorrow, so it's up to us!",
          '루나 선장은 오늘 아침 달 기지에 갔어. 내일 돌아오니까 우리가 해내야 해!'
        ),
      },
    ],
    facts:
      'The Control Room has a huge window with Earth and the orange solar storm, a star map table, a security scanner, a screen with a message from Earth, a radio to Earth, a power chart, a camera switchboard, the captain\'s chair with a video log, and the locked Core Room door with a door clock.',
  },
];

/** 방을 마치면 핍이 기억 칩에서 떠올린 증거 */
export function evidenceOf(room, culprit) {
  const s = suspectOf(culprit);
  if (room === 0)
    return {
      key: 'size',
      value: s.size,
      card: T(`The shadow was ${s.size.toUpperCase()}.`, `그림자가 ${TRAIT[s.size].ko}.`),
      lines: [
        L(
          'pip',
          'Yay! I found memory chip number one!',
          '야호! 기억 칩 1번을 찾았어!',
          'The door is open! And look — I found memory chip number one!',
          '문이 열렸어! 그리고 봐, 기억 칩 1번을 찾았어!'
        ),
        L(
          'pip',
          `I saw a shadow. It was ${s.size.toUpperCase()}!`,
          `그림자를 봤어. ${s.size === 'big' ? '아주 컸어' : '아주 작았어'}!`,
          `My camera saw someone in the dark hallway right after the lights went out. The shadow was very ${s.size.toUpperCase()}.`,
          `불이 꺼진 직후, 내 카메라가 어두운 복도에서 누군가를 봤어. 그림자가 ${s.size === 'big' ? '아주 컸어' : '아주 작았어'}.`
        ),
      ],
    };
  if (room === 1)
    return {
      key: 'color',
      value: s.color,
      card: T(`There was ${s.color.toUpperCase()} fur or paint on a leaf.`, `잎에 ${TRAIT[s.color].ko} 자국이 있었다.`),
      lines: [
        L('pip', 'I found memory chip number two!', '기억 칩 2번을 찾았어!', 'Big Bud is happy, and I found memory chip number two!', '빅 버드도 기뻐하고, 기억 칩 2번도 찾았어!'),
        L(
          'pip',
          `Look at this leaf. It is ${s.color.toUpperCase()}!`,
          `이 잎을 봐. ${TRAIT[s.color].ko} 자국이 있어!`,
          `Look at this leaf. There's a little ${s.color.toUpperCase()} smudge on it. Someone ${s.color} touched it on the way to the Core Room!`,
          `이 잎을 봐. ${TRAIT[s.color].ko} 자국이 조금 묻어 있어. ${TRAIT[s.color].ko}인 누군가가 코어 룸에 가다가 스쳤나 봐!`
        ),
      ],
    };
  if (room === 2) {
    const robot = s.kind === 'robot';
    return {
      key: 'kind',
      value: s.kind,
      card: robot
        ? T('There were OIL drops on the floor. Only robots use oil!', '바닥에 기름 방울이 있었다. 기름은 로봇만 쓴다!')
        : T("There were COOKIE crumbs on the floor. Robots don't eat cookies!", '바닥에 쿠키 부스러기가 있었다. 로봇은 쿠키를 먹지 않는다!'),
      lines: [
        L('pip', 'Memory chip number three!', '기억 칩 3번이야!', 'The elevator works, and here is memory chip number three!', '엘리베이터가 움직이고, 여기 기억 칩 3번도 있어!'),
        robot
          ? L(
              'pip',
              'Look! Oil drops. Only robots use oil!',
              '봐! 기름 방울이야. 기름은 로봇만 써!',
              'Look at the floor by the elevator: little drops of black OIL. Only robots use oil, so it was a robot!',
              '엘리베이터 옆 바닥을 봐. 까만 기름 방울이 떨어져 있어. 기름은 로봇만 쓰니까 범인은 로봇이야!'
            )
          : L(
              'pip',
              "Look! Cookie crumbs. Robots don't eat cookies!",
              '봐! 쿠키 부스러기야. 로봇은 쿠키를 안 먹어!',
              "Look at the floor by the elevator: COOKIE crumbs! Robots don't eat cookies, so it wasn't a robot!",
              '엘리베이터 옆 바닥을 봐. 쿠키 부스러기야! 로봇은 쿠키를 안 먹으니까 범인은 로봇이 아니야!'
            ),
      ],
    };
  }
  return {
    key: 'log',
    value: s.id,
    card: T(
      `Door log: the ${s.place.en} door opened at 9:05 and 9:20.`,
      `출입 기록: ${s.place.ko} 문이 9:05와 9:20에 열렸다.`
    ),
    lines: [
      L('pip', 'The last memory chip!', '마지막 기억 칩이야!', 'The security system is on, and here is my last memory chip!', '보안 시스템이 켜졌고, 마지막 기억 칩도 찾았어!'),
      L(
        'pip',
        'Look at the door log. One door opened at 9:05!',
        '출입 기록을 봐. 9시 5분에 문 하나가 열렸어!',
        'Now we can read the door log from last night. Look carefully: one room door opened at 9:05 and again at 9:20!',
        '이제 어젯밤 출입 기록을 볼 수 있어. 잘 봐. 어떤 방 문이 9시 5분에 열리고 9시 20분에 또 열렸어!'
      ),
    ],
  };
}

/** 출입 기록 (모두 같은 시간에 자기 방에 들어갔고, 범인 방만 9:05에 열리고 9:20에 다시 열렸다) */
export function doorLog(culprit) {
  const c = suspectOf(culprit);
  const rows = [...SUSPECTS]
    .sort((a, b) => a.arrive.localeCompare(b.arrive))
    .map((s) => ({
      time: s.arrive,
      door: s.place,
      what: T(`${s.name} went in.`, `${s.ko}가 들어갔다.`),
    }));
  rows.push(
    { time: '9:05', door: c.place, what: T('Opened from the inside. Someone went out.', '안에서 열림. 누군가 나갔다.') },
    { time: '9:10', door: T('Core Room', '코어 룸'), what: T('Opened. Camera: too dark to see.', '열림. 카메라: 너무 어두워 안 보임.') },
    { time: '9:10', door: T('Whole station', '정거장 전체'), what: T('BLACKOUT', '정전') },
    { time: '9:20', door: c.place, what: T('Opened from the outside. Someone went in.', '밖에서 열림. 누군가 들어갔다.') }
  );
  return rows;
}

/* ---------- 마지막: 코어 룸 ---------- */

export const FINALE_INTRO = [
  L(
    'pip',
    'The Core Room is open, but the Star Core is not here!',
    '코어 룸이 열렸는데, 별의 심장이 없어!',
    "The Core Room is open, but the Star Core isn't here. I called everyone who was on the station last night.",
    '코어 룸이 열렸는데 별의 심장이 없어. 어젯밤 정거장에 있던 모두를 불렀어.'
  ),
  L(
    'pip',
    'Ask questions. Who took it?',
    '질문해 봐. 누가 가져갔을까?',
    'One of them took the Star Core, and one of them is not telling the truth. Ask them questions and check the evidence!',
    '이 중 한 명이 별의 심장을 가져갔고, 거짓말을 하고 있어. 질문하고 증거를 확인해 봐!'
  ),
];

/** 용의자에게 할 수 있는 질문 (쉬운·보통 영어) */
export const QUESTIONS = [
  { id: 'who', q: T('Who are you?', '누구예요?'), qh: T('What do you do on the station?', '정거장에서 무슨 일을 해요?') },
  { id: 'where', q: T('Where were you last night?', '어젯밤에 어디 있었어요?'), qh: T('Where were you at ten past nine last night?', '어젯밤 9시 10분에 어디 있었어요?') },
  { id: 'left', q: T('Did you go out?', '밖에 나갔어요?'), qh: T('Did you leave that room at any time last night?', '어젯밤 그 방을 나간 적이 있어요?') },
  { id: 'saw', q: T('Did you see anything?', '뭔가 봤어요?'), qh: T('Did you see or hear anything strange?', '이상한 걸 보거나 들었어요?') },
  { id: 'food', q: T('Do you eat cookies?', '쿠키를 먹어요?'), qh: T('Do you need food or oil to keep going?', '움직이려면 음식이 필요해요, 기름이 필요해요?') },
  { id: 'took', q: T('Did you take the Star Core?', '별의 심장을 가져갔어요?'), qh: T('Be honest: did you take the Star Core?', '솔직히 말해요. 별의 심장을 가져갔어요?') },
];

// 답: 범인도 같은 말을 한다 (거짓말). 들키는 곳은 출입 기록(9:05·9:20)과 겉모습 증거뿐
const ANSWERS = {
  bolt: {
    who: [T('I am Bolt. I fix things.', '나는 볼트야. 물건을 고쳐.'), T("Hmph! I'm Bolt, the repair robot. If something breaks, I fix it.", '흥! 나는 수리 로봇 볼트야. 뭐가 고장 나면 내가 고치지.')],
    where: [T('I was in my workshop.', '내 작업실에 있었어.'), T('I was in the Robot Workshop. I went there at eight o\'clock to fix a toaster.', '로봇 작업실에 있었어. 8시에 토스터를 고치러 갔지.')],
    left: [T('No. I stayed there.', '아니. 거기 계속 있었어.'), T('No. I stayed in the workshop all night. That toaster was really broken!', '아니. 밤새 작업실에 있었어. 그 토스터 정말 망가졌거든!')],
    saw: [T('It got very dark.', '아주 깜깜해졌어.'), T('Hmph. All my lights went out at once, and my tools fell on the floor.', '흥. 불이 한꺼번에 꺼지고 공구가 바닥에 쏟아졌어.')],
    food: [T('No! I drink oil.', '아니! 나는 기름을 마셔.'), T('Food? No way. I run on oil and batteries.', '음식? 말도 안 돼. 나는 기름이랑 배터리로 움직여.')],
    took: [T('No! Not me!', '아니! 나 아니야!'), T("Hmph! No. I fix things — I don't take them.", '흥! 아니. 나는 고치는 로봇이지, 가져가는 로봇이 아니야.')],
  },
  zeek: {
    who: [T("I'm Zeek! I bring letters. Zip-zip!", '나는 지크! 편지를 날라. 쓩쓩!'), T("Zip-zip! I'm Zeek, the delivery drone. I carry letters and packages all over the station.", '쓩쓩! 나는 배달 드론 지크야. 정거장 곳곳에 편지랑 소포를 날라.')],
    where: [T('I was in the Mail Room.', '우편실에 있었어.'), T('I was in the Mail Room. I flew there at a quarter to nine to sort the letters.', '우편실에 있었어. 8시 45분에 편지를 정리하러 날아갔지.')],
    left: [T('No! I stayed there. Zip!', '아니! 거기 있었어. 쓩!'), T('Nope! I was sorting letters all night. So many letters!', '아니! 밤새 편지를 정리했어. 편지가 정말 많았다고!')],
    saw: [T('It was dark. I was scared!', '깜깜했어. 무서웠어!'), T('When the lights went out, I bumped into a wall. Ouch! I couldn\'t see anything.', '불이 꺼졌을 때 벽에 쾅 부딪혔어. 아야! 아무것도 안 보였어.')],
    food: [T('No! I drink oil.', '아니! 나는 기름을 마셔.'), T('Food? Zip-zip, no! A little oil keeps my propellers spinning.', '음식? 쓩쓩, 아니! 기름 조금이면 프로펠러가 잘 돌아가.')],
    took: [T('No, no, no! Not me!', '아니, 아니, 아니! 나 아니야!'), T("No way! I only deliver things. I don't take them!", '말도 안 돼! 나는 배달만 해. 가져가지 않아!')],
  },
  mira: {
    who: [T('I am Dr. Mira. I study stars.', '나는 미라 박사야. 별을 연구해.'), T("I'm Dr. Mira, the station scientist. I study stars and glowing creatures.", '나는 정거장 과학자 미라 박사예요. 별과 빛나는 생물을 연구해요.')],
    where: [T('I was in my lab.', '실험실에 있었어.'), T('I was in the Science Lab. I went there at half past eight to watch the stars.', '과학 실험실에 있었어요. 8시 30분에 별을 보러 갔지요.')],
    left: [T('No. I stayed in my lab.', '아니. 실험실에 있었어.'), T('No, I stayed in my lab the whole time. The stars were beautiful last night.', '아니요, 내내 실험실에 있었어요. 어젯밤 별이 정말 아름다웠거든요.')],
    saw: [T('I saw the lights go out.', '불이 꺼지는 걸 봤어.'), T('At ten past nine, all the lights went out at once. I wrote down the time: 9:10.', '9시 10분에 불이 한꺼번에 꺼졌어요. 시간을 적어 두었죠: 9시 10분.')],
    food: [T('Yes! I like cookies.', '응! 쿠키 좋아해.'), T("Yes, I eat food. Cookies are my favorite snack when I'm working late.", '네, 음식을 먹어요. 늦게까지 일할 때 쿠키가 제일 좋은 간식이에요.')],
    took: [T('No, I did not.', '아니, 안 가져갔어.'), T('No, I did not. I would never take something so important.', '아니요. 그렇게 중요한 걸 가져갈 리 없어요.')],
  },
  momo: {
    who: [T("I'm Momo! Squeak!", '나는 모모! 찍찍!'), T("Squeak! Momo is the station's pet. Momo lives in the Space Garden.", '찍찍! 모모는 정거장 애완동물이야. 우주 정원에 살아.')],
    where: [T('I was in the garden.', '정원에 있었어.'), T('Momo was in the Space Garden. Momo went to bed in a flowerpot at ten to nine.', '모모는 우주 정원에 있었어. 8시 50분에 화분 침대에서 잤어.')],
    left: [T('No. Momo was sleeping.', '아니. 모모는 자고 있었어.'), T('No. Momo was sleeping in the flowerpot all night. Zzz.', '아니. 모모는 밤새 화분에서 자고 있었어. 쿨쿨.')],
    saw: [T('It got cold.', '추워졌어.'), T('Momo was asleep, but the dark woke Momo up. It got very cold, too.', '모모는 자고 있었는데 깜깜해서 깼어. 아주 추워지기도 했어.')],
    food: [T('Yes! Cookies! Yum!', '응! 쿠키! 냠냠!'), T('Yes! Momo loves cookies. Momo eats every crumb.', '응! 모모는 쿠키가 좋아. 부스러기까지 다 먹어.')],
    took: [T('No! Momo is a good hamster!', '아니! 모모는 착한 햄스터야!'), T('No! Momo is a good hamster. Momo is very, very good.', '아니! 모모는 착한 햄스터야. 아주아주 착해.')],
  },
};
/** @returns {{en: string, ko: string}} */
export const answerOf = (suspect, qid, hard) => ANSWERS[suspect][qid][hard ? 1 : 0];

/** 범인이 고백하는 말 (왜 가져갔는지: 모두 나쁜 뜻이 아니다) */
export const CONFESSION = {
  bolt: [
    L('bolt', 'Hmph... OK. It was me. I am sorry.', '흥… 알았어. 나였어. 미안해.', 'Hmph... All right. It was me. The Star Core was making a funny buzzing sound, so I took it to my workshop to fix it.', '흥… 그래, 나였어. 별의 심장에서 이상한 윙윙 소리가 나서 고쳐 주려고 작업실로 가져갔어.'),
    L('bolt', 'Then the lights went out. I got lost!', '그런데 불이 꺼졌어. 길을 잃었어!', 'Then the lights went out, I dropped my oil can, and I got lost in the dark. I was too embarrassed to tell anyone.', '그런데 불이 꺼지고 기름통을 떨어뜨리고 어둠 속에서 길을 잃었어. 너무 창피해서 말을 못 했어.'),
  ],
  zeek: [
    L('zeek', 'Zip... It was me. I am so sorry!', '쓩… 나였어. 정말 미안해!', "Zip... it was me. I saw a shiny box with a label that said 'DELIVER', and I thought it was a package!", '쓩… 나였어. "배달"이라고 적힌 반짝이는 상자를 보고 소포인 줄 알았어!'),
    L('zeek', 'I took it to the wrong place!', '엉뚱한 곳으로 가져갔어!', "I'm a delivery drone, so I tried to deliver it... but the lights went out and I took it to the wrong place. I was scared you'd be angry.", '나는 배달 드론이라 배달하려고 했는데… 불이 꺼져서 엉뚱한 곳에 가져갔어. 다들 화낼까 봐 무서웠어.'),
  ],
  mira: [
    L('mira', 'It was me. I am very sorry.', '나였어요. 정말 미안해요.', 'It was me. I only wanted to study how the Star Core glows, just for one minute.', '나였어요. 별의 심장이 어떻게 빛나는지 딱 1분만 연구하고 싶었어요.'),
    L('mira', 'I wanted to put it back!', '다시 갖다 놓으려고 했어요!', 'I promise I was going to put it back. But the lights went out, and I was afraid everyone would be angry with me.', '꼭 다시 갖다 놓으려고 했어요. 그런데 불이 꺼졌고, 모두 나한테 화낼까 봐 겁이 났어요.'),
  ],
  momo: [
    L('momo', 'Squeak... It was Momo. Sorry!', '찍… 모모였어. 미안해!', 'Squeak... it was Momo. The Star Core was so warm and shiny. Momo just wanted to sleep next to it.', '찍… 모모였어. 별의 심장이 너무 따뜻하고 반짝여서, 그 옆에서 자고 싶었어.'),
    L('momo', 'Momo was cold. Momo is sorry!', '모모는 추웠어. 미안해!', "Then everything went dark and cold, and Momo got scared. Momo hid it in a cookie box. Momo is very sorry!", '그런데 모든 게 깜깜하고 추워져서 모모는 무서웠어. 쿠키 상자에 숨겼어. 정말 미안해!'),
  ],
};

/** 화해 (모두 함께 해결) */
export const RESOLUTION = {
  bolt: T('Bolt will fix the buzzing sound — with the captain watching. Bolt even makes everyone new flashlights!', '볼트는 이제 선장님과 함께 윙윙 소리를 고치기로 했어요. 모두에게 새 손전등도 만들어 주었답니다!'),
  zeek: T('Zeek learns to read the labels very carefully. Now Zeek delivers everyone a "thank you" letter!', '지크는 이제 꼬리표를 아주 꼼꼼히 읽어요. 모두에게 "고마워" 편지를 배달했답니다!'),
  mira: T('Dr. Mira will study the Star Core with the captain next week. She invites everyone to watch the stars!', '미라 박사는 다음 주에 선장님과 함께 별의 심장을 연구하기로 했어요. 모두를 별 구경에 초대했답니다!'),
  momo: T('Bolt builds Momo a warm little lamp shaped like a star. Now Momo sleeps happily every night!', '볼트가 모모에게 별 모양의 따뜻한 작은 전등을 만들어 주었어요. 이제 모모는 매일 밤 행복하게 자요!'),
};

/** 잘못 지목했을 때 그 용의자의 반박 (증거와 안 맞는 첫 특징) */
export function denial(accused, culprit) {
  const a = suspectOf(accused);
  const c = suspectOf(culprit);
  if (a.size !== c.size)
    return T(
      `It wasn't me! The shadow was ${c.size}, but I'm ${a.size}!`,
      `나 아니야! 그림자는 ${c.size === 'big' ? '컸는데' : '작았는데'}, 나는 ${a.size === 'big' ? '커' : '작아'}!`
    );
  if (a.color !== c.color)
    return T(`Look at me! I'm ${a.color}, not ${c.color}!`, `나를 봐! 나는 ${TRAIT[a.color].ko}이야, ${TRAIT[c.color].ko}이 아니야!`);
  return a.kind === 'robot'
    ? T("I'm a robot. I don't eat cookies!", '나는 로봇이야. 쿠키를 안 먹어!')
    : T("I don't use oil. I'm not a robot!", '나는 기름을 안 써. 로봇이 아니라고!');
}

export const ENDING = [
  L('pip', 'We have the Star Core! Put it back!', '별의 심장을 찾았어! 제자리에 놓자!', 'We have the Star Core! Quick — put it back before the storm hits!', '별의 심장을 찾았어! 어서, 폭풍이 오기 전에 제자리에 놓자!'),
];
export const SHIELD_LINE = L(
  'pip',
  'Everyone, say: "Shields up!"',
  '다 같이 외쳐: "Shields up!"',
  'Everyone together, shout: "Shields up!"',
  '모두 함께 외쳐: "Shields up!"'
);
export const FINAL_LINES = [
  L('nova', 'Shield power: one hundred percent!', '방어막 전원 100퍼센트!', 'Shield power: one hundred percent. The station is safe.', '방어막 전원 100퍼센트. 정거장은 안전합니다.'),
  L(
    'pip',
    'You did it! Thank you, Space Cadets!',
    '해냈어! 고마워, 우주 사관생도들!',
    'The storm is passing over us like a giant rainbow. You did it, Space Cadets — you saved Station NOVA!',
    '폭풍이 커다란 무지개처럼 우리 위를 지나가. 해냈어, 우주 사관생도들. 너희가 노바 정거장을 구했어!'
  ),
];

/** 코어 룸에서 핍에게 묻는 질문 카드 */
export const FINALE_PIP = [
  {
    q: T('Who are they?', '저 사람들은 누구야?'),
    qh: T('Who was on the station last night?', '어젯밤 정거장에 누가 있었어?'),
    a: T('Bolt, Zeek, Dr. Mira and Momo.', '볼트, 지크, 미라 박사, 모모야.'),
    ah: T(
      'Bolt the repair robot, Zeek the delivery drone, Dr. Mira the scientist and Momo the space hamster.',
      '수리 로봇 볼트, 배달 드론 지크, 과학자 미라 박사, 우주 햄스터 모모야.'
    ),
  },
  {
    q: T('What are the clues?', '단서가 뭐야?'),
    qh: T('Which clues did we find?', '우리가 어떤 단서를 찾았어?'),
    a: T('Look at the evidence board!', '증거 판을 봐!'),
    ah: T(
      'We found a shadow, a smudge on a leaf, something on the floor and the door log. Check the evidence board!',
      '그림자, 잎에 묻은 자국, 바닥에 떨어진 것, 출입 기록을 찾았어. 증거 판을 확인해 봐!'
    ),
  },
  {
    q: T('How do we find the culprit?', '범인은 어떻게 찾아?'),
    qh: T('How can we find out who did it?', '누가 그랬는지 어떻게 알아내?'),
    a: T('Ask questions. Then choose!', '질문하고, 골라!'),
    ah: T(
      "Ask everyone where they were and compare the answers with the evidence. When you're sure, press 'Accuse'!",
      "모두에게 어디 있었는지 묻고 증거와 비교해 봐. 확실하면 '범인 지목'을 눌러!"
    ),
  },
];

/** 퍼즐이 아닌 물체를 누르면 핍이 하는 말 */
export const FLAVOR = {
  shuttle: L(
    'pip',
    'That is your shuttle!',
    '너희 셔틀이야!',
    "That's your shuttle, CADET-1. It brought you here safely!",
    '너희 셔틀 CADET-1이야. 여기까지 안전하게 데려다줬지!'
  ),
  momobed: L(
    'pip',
    "This is Momo's bed. Momo is not here!",
    '모모의 침대야. 모모가 없어!',
    "This is Momo's flowerpot bed. Where is Momo? The blanket is cold.",
    '모모의 화분 침대야. 모모는 어디 갔지? 이불이 차가워.'
  ),
};
