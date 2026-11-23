// 게임 진행 화면 (전체 화면): 이야기 → 방 4개(임무·문 글자·핍의 기억 칩) → 코어 룸 추리 → 방어막 → 수료증.
// 이 폰의 플레이어(local)가 맡은 단서·잠금만 열린다. 다른 사람 것은 얼굴 배지로 보이고, 영어로 물어봐야 한다.

import { h, clear, toast, iconBtn, shareText, copyText } from '../ui.js';
import { icon } from '../icons.js';
import { addGameLog, geminiEnabled, getGamePrefs, setGameSave, updateGamePrefs } from '../store.js';
import { tappableEnglish } from '../components/word-sheet.js';
import { keepAwake } from '../services/wake-lock.js';
import { primeSpeech } from '../speech.js';
import {
  LEVEL_INFO,
  ROLES,
  SPEECH_PASS,
  STORM_MS,
  avatarOf,
  chipHolder,
  clockText,
  decodeTeam,
  formatCode,
  hasKeywords,
  levelRank,
  rngFor,
  sameAnswer,
  speechScore,
  voicePass,
} from './logic.js';
import { buildGame, knownLetters, objectRole } from './plan.js';
import {
  BLACKOUT,
  BLACKOUT_DONE,
  CONFESSION,
  ENDING,
  FINALE_INTRO,
  FINALE_PIP,
  FINAL_LINES,
  FLAVOR,
  PROLOGUE,
  QUESTIONS,
  RESOLUTION,
  ROOMS,
  SHIELD_LINE,
  SPEAKERS,
  SUSPECTS,
  TRAIT,
  answerFor,
  caseTimeline,
  chipGiven,
  denial,
  doorLog,
  evidenceOf,
  herringOf,
  rebuttal,
  relayTargets,
  relayText,
  suspectOf,
} from './story.js';
import { josa, sparkyBarks } from './puzzles.js';
import { ROOM_ART, closeup, defs, finale as finaleArt, portrait, suspectIcon } from './art.js';
import { createScene } from './scene.js';
import { createWidget, voiceInput } from './widgets.js';
import { playMelody, setSound, sfx } from './sfx.js';
import { canListen, hush, listenOnce, say } from './voice.js';
import { askPip, askSuspect } from './ai.js';
import { GAME_INFO, startMinigame } from './minigames.js';

const ROOM_COUNT = 4;
const CRYSTALS_TOTAL = 12;

/** 새 진행 상태 */
export function newSave(code, local) {
  return {
    v: 1,
    code,
    local,
    stage: 'prologue',
    room: 0,
    solved: {},
    clues: {},
    unlocked: {}, // 미니게임으로 연 단서
    pipRead: {}, // 혼자 할 때 핍이 읽어 준 로봇 글자
    relayDone: false,
    open: {},
    crystals: {},
    hints: {},
    tries: {},
    interviewed: {},
    accused: [],
    said: 0,
    playMs: 0,
    warned: 0,
    startedAt: Date.now(),
  };
}

/**
 * 게임 화면을 연다.
 * @param {HTMLElement} host
 * @param {object} save getGameSave() 결과
 * @param {{onExit: () => void, onNewMission?: () => void}} o
 */
export function openGame(host, save, { onExit, onNewMission }) {
  const game = buildGame(decodeTeam(save.code));
  const herring = herringOf(game.seed);
  for (const k of ['unlocked', 'pipRead', 'interviewed', 'tries', 'hints']) save[k] ??= {};
  save.accused ??= [];
  let prefs = getGamePrefs();
  setSound(prefs.sound);
  const P = (i) => game.players[i];
  const lvOf = (i) => P(i).level;
  const local = () => save.local.filter((i) => i < game.n);
  // 이 폰에서 이야기를 읽는 수준: 가장 낮은 플레이어 기준
  const devLv = () => local().reduce((lo, i) => (levelRank(lvOf(i)) < levelRank(lo) ? lvOf(i) : lo), 'im3');
  const tier = () => (levelRank(devLv()) <= 1 ? 'easy' : 'hard');
  let showKo = devLv() === 'basic';
  let asker = local()[0] ?? 0; // 핍·용의자에게 묻는 사람

  /* ---------- 뼈대 ---------- */

  const root = h('div', { class: 'gm-root', role: 'application', 'aria-label': 'Station NOVA SOS' });
  const top = h('div', { class: 'gm-top' });
  const stage = h('div', { class: 'gm-stage' });
  const bottom = h('div', { class: 'gm-bottom' });
  const overlay = h('div', { class: 'gm-overlay' });
  root.append(defs(), top, stage, bottom, overlay);
  host.append(root);
  document.body.classList.add('gm-lock');
  keepAwake('game', true);

  const scene = createScene({ onHot: (id) => hot(id), onCrystal: (id) => gotCrystal(id) });
  stage.append(scene.el);

  const persist = () => setGameSave(save);
  const roomSet = (key, r = save.room) => (save[key][r] ??= []);

  /* ---------- 공통 조각 ---------- */

  const who = (i, { level = true } = {}) =>
    h(
      'span',
      { class: 'gm-who' },
      h('span', { class: 'gm-emoji' }, avatarOf(P(i).avatar).emoji),
      avatarOf(P(i).avatar).name,
      level ? h('small', null, LEVEL_INFO[lvOf(i)].label) : null
    );
  const speakBtn = (text, speaker = 'narrator', lv) =>
    iconBtn(
      'volume',
      '읽어 주기',
      () => say(text, speaker, { slow: lv === 'basic' || lv === 'im1' }),
      'icon-btn gm-ib'
    );

  /** 영어 글 (IM2·IM3은 단어를 누르면 뜻) + 한국어 (Basic은 늘, IM1·IM2는 버튼으로, IM3은 없음) */
  function bilingual(t, lv, { speaker = 'narrator', cls = '', big = false } = {}) {
    const en =
      levelRank(lv) >= 2
        ? tappableEnglish(t.en, { source: '영어 게임', tag: 'p', cls: `gm-en ${cls}` })
        : h('p', { class: `gm-en ${cls}`, lang: 'en' }, t.en);
    if (big) en.classList?.add('big');
    // 한국어는 그 글의 수준을 따른다: Basic은 늘 보이고, IM1·IM2는 버튼으로 (같은 폰에 Basic이 있어도 IM2 문제는 그대로 도전)
    const ko = t.ko ? h('p', { class: 'gm-ko', hidden: lv !== 'basic' }, t.ko) : null;
    const koBtn =
      t.ko && lv !== 'basic'
        ? h(
            'button',
            {
              type: 'button',
              class: 'gm-chip small',
              onclick: () => {
                ko.hidden = !ko.hidden;
              },
            },
            '한국어'
          )
        : null;
    return h('div', { class: 'gm-bi' }, h('div', { class: 'gm-bi-row' }, en, speakBtn(t.en, speaker, lv)), ko, koBtn);
  }

  /** 소리 내어 말해 보기 (인식되면 칭찬, 말한 문장 수를 센다) */
  function practice(target, lv, { label = '말해 보기' } = {}) {
    if (!canListen) return null;
    const out = h('span', { class: 'gm-practice-out', 'aria-live': 'polite' });
    const b = h(
      'button',
      {
        type: 'button',
        class: 'gm-chip',
        onclick: async () => {
          b.disabled = true;
          b.classList.add('recording');
          out.textContent = '듣는 중…';
          try {
            const heard = await listenOnce({ onInterim: (t) => (out.textContent = t) }).promise;
            const score = speechScore(heard, target);
            if (score >= (SPEECH_PASS[lv] ?? 0.6)) {
              out.textContent = `⭐ Great! “${heard}”`;
              sfx.ok();
              save.said++;
              persist();
            } else out.textContent = heard ? `“${heard}” — 한 번 더!` : '잘 안 들렸어요. 한 번 더!';
          } catch (e) {
            out.textContent = e.message;
          }
          b.disabled = false;
          b.classList.remove('recording');
        },
      },
      icon('mic', { size: 16 }),
      label
    );
    return h('div', { class: 'gm-practice' }, b, out);
  }

  /** 말할 문장 상자 (팀원에게 묻기/알려 주기) */
  function phraseBox(label, t, lv, { speaker = 'narrator' } = {}) {
    if (!t) return null;
    const box = h(
      'div',
      { class: `gm-phrase${t.goal ? ' goal' : ''}` },
      h('div', { class: 'gm-phrase-label' }, icon('chat', { size: 16 }), label)
    );
    if (t.goal)
      box.append(
        h('p', { class: 'gm-en', lang: 'en' }, t.en),
        h('p', { class: 'gm-ko' }, '스스로 영어 문장을 만들어 말해 보세요.')
      );
    else {
      box.append(bilingual(t, lv, { speaker }));
      if (!t.frame) box.append(practice(t.en, lv));
      else box.append(h('p', { class: 'gm-ko' }, '빈칸(___)을 채워 말해 보세요.'));
    }
    return box;
  }

  /* ---------- 패널 · 대사 창 ---------- */

  let current = null;
  function closePanel() {
    if (!current) return;
    const c = current;
    current = null;
    c.el.remove();
    hush();
    c.onClose?.();
  }
  function panel(title, body, { sub, cls = '', onClose } = {}) {
    closePanel();
    const el = h(
      'section',
      {
        class: `gm-panel ${cls}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': typeof title === 'string' ? title : '',
      },
      h(
        'header',
        { class: 'gm-panel-head' },
        h('div', { class: 'gm-panel-title' }, title, sub ? h('small', null, sub) : null),
        iconBtn('x', '닫기', () => closePanel(), 'icon-btn gm-x')
      ),
      h('div', { class: 'gm-panel-body' }, body)
    );
    overlay.append(el);
    current = { el, onClose };
    el.querySelector?.('.gm-panel-body')?.scrollTo?.(0, 0);
    return el;
  }

  /** 이야기 대사 (여러 줄). 다 읽으면 끝난다 */
  function talk(lines, { moods = {} } = {}) {
    closePanel();
    return new Promise((resolve) => {
      let i = 0;
      const box = h('div', { class: 'gm-talk', role: 'dialog', 'aria-live': 'polite' });
      overlay.append(box);
      const next = () => {
        hush();
        i++;
        if (i >= lines.length) {
          box.remove();
          resolve();
        } else show();
      };
      function show() {
        const line = lines[i];
        const t = line[tier()];
        const sp = SPEAKERS[line.who] ?? SPEAKERS.narrator;
        const ko = h('p', { class: 'gm-talk-ko', hidden: !showKo && devLv() !== 'basic' }, t.ko);
        clear(box).append(
          portrait(line.who, moods[line.who]),
          h(
            'div',
            { class: 'gm-talk-main' },
            sp.name ? h('b', { class: 'gm-talk-name' }, sp.name, sp.ko ? h('small', null, ` · ${sp.ko}`) : null) : null,
            h('p', { class: 'gm-talk-en', lang: 'en' }, t.en),
            ko,
            h(
              'div',
              { class: 'gm-talk-actions' },
              speakBtn(t.en, line.who, devLv()),
              devLv() === 'basic'
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      class: 'gm-chip small',
                      onclick: () => {
                        showKo = ko.hidden;
                        ko.hidden = !ko.hidden;
                      },
                    },
                    '한국어'
                  ),
              h('span', { class: 'gm-talk-count' }, `${i + 1}/${lines.length}`),
              h(
                'button',
                { type: 'button', class: 'btn primary gm-next', onclick: next },
                i < lines.length - 1 ? '다음' : '좋아요!',
                icon('play', { size: 16 })
              )
            )
          )
        );
        if (prefs.autoRead) say(t.en, line.who, { slow: tier() === 'easy' });
      }
      show();
    });
  }

  /** 핍이 잠깐 하는 말 (말풍선) */
  function pipSays(t, ms = 4200) {
    const bubble = h(
      'div',
      { class: 'gm-pipsays' },
      portrait('pip', 'talk'),
      h(
        'div',
        null,
        h('p', { lang: 'en' }, t.en),
        t.ko && (showKo || devLv() === 'basic') ? h('small', null, t.ko) : null
      )
    );
    overlay.querySelector?.('.gm-pipsays')?.remove();
    overlay.append(bubble);
    say(t.en, 'pip', { slow: tier() === 'easy' });
    setTimeout(() => bubble.remove(), ms);
  }

  /* ---------- 머리·아래 막대 ---------- */

  const timeChip = h('span', { class: 'gm-time', title: '태양 폭풍까지' });
  const gemChip = h('span', { class: 'gm-gems', title: '별 조각' });
  const titleEl = h('div', { class: 'gm-title' });
  top.append(
    iconBtn('list', '메뉴', () => openMenu(), 'icon-btn gm-ib light'),
    titleEl,
    timeChip,
    gemChip
  );

  const crystalsFound = () => Object.values(save.crystals).reduce((a, x) => a + x.length, 0);
  function updateHud() {
    const r = save.stage === 'outro' ? save.room + 1 : save.room;
    if (save.stage.startsWith('finale') || save.stage === 'done' || r >= ROOM_COUNT)
      titleEl.replaceChildren(h('b', null, 'Core Room'), h('small', null, '코어 룸 · 범인 찾기'));
    else titleEl.replaceChildren(h('b', null, `${r + 1} · ${ROOMS[r].title.en}`), h('small', null, ROOMS[r].title.ko));
    const left = STORM_MS - save.playMs;
    timeChip.hidden = !prefs.timer;
    timeChip.replaceChildren(icon('clock', { size: 15 }), left > 0 ? clockText(left) : '폭풍!');
    timeChip.classList.toggle('late', left < 5 * 60000);
    gemChip.replaceChildren(icon('star', { size: 15 }), `${crystalsFound()}/${CRYSTALS_TOTAL}`);
    drawBottom();
  }

  function drawBottom() {
    clear(bottom);
    const hintBtn = h(
      'button',
      { type: 'button', class: 'gm-tab', onclick: () => openHints() },
      h('span', { class: 'gm-tab-ico' }, '💡'),
      '힌트'
    );
    const pipBtn = h(
      'button',
      { type: 'button', class: 'gm-tab', onclick: () => openPip() },
      h('span', { class: 'gm-tab-ico' }, '🤖'),
      '핍에게'
    );
    if (save.stage === 'finale') {
      bottom.append(
        h(
          'button',
          { type: 'button', class: 'gm-tab', onclick: () => openEvidence() },
          h('span', { class: 'gm-tab-ico' }, '🗂'),
          '증거'
        ),
        h(
          'button',
          { type: 'button', class: 'gm-tab', onclick: () => openSuspects() },
          h('span', { class: 'gm-tab-ico' }, '🕵️'),
          '용의자'
        ),
        pipBtn,
        h(
          'button',
          { type: 'button', class: 'gm-tab accent', onclick: () => openAccuse() },
          h('span', { class: 'gm-tab-ico' }, '👉'),
          '범인 지목'
        )
      );
      return;
    }
    if (save.stage !== 'play') return;
    const r = save.room;
    const mine = game.rooms[r].pairs.filter((x) => local().includes(x.lockOwner));
    const done = mine.filter((x) => roomSet('solved').includes(x.p)).length;
    const letters = knownLetters(game, r, roomSet('solved'));
    bottom.append(
      h(
        'button',
        { type: 'button', class: 'gm-tab', onclick: () => openMissions() },
        h('span', { class: 'gm-tab-ico' }, '📋'),
        `임무 ${done}/${mine.length}`
      ),
      pipBtn,
      hintBtn,
      h(
        'button',
        { type: 'button', class: 'gm-tab gm-letters-tab', onclick: () => openExit() },
        h(
          'span',
          { class: 'gm-mini-slots' },
          letters.map((ch) => h('span', { class: ch ? 'on' : '' }, ch || '·'))
        ),
        '문 열기'
      )
    );
  }

  /* ---------- 시간 (화면을 보고 있을 때만 흐른다) ---------- */

  let paused = false;
  const clock = setInterval(() => {
    if (
      paused ||
      document.hidden ||
      !['play', 'finale'].includes(save.stage) ||
      current?.el?.classList?.contains('gm-cert')
    )
      return;
    save.playMs += 1000;
    if (prefs.timer) {
      const left = STORM_MS - save.playMs;
      if (left <= 10 * 60000 && save.warned < 1) {
        save.warned = 1;
        sfx.alarm();
        toast('⚠️ 태양 폭풍까지 10분! 서둘러요!', { ms: 4000 });
      }
      if (left <= 0 && save.warned < 2) {
        save.warned = 2;
        sfx.alarm();
        toast('🌩 폭풍이 왔어요! 비상 방어막으로 버티는 중 — 끝까지 해내요!', { ms: 5000 });
      }
    }
    if (save.playMs % 10000 === 0) persist();
    updateHud();
  }, 1000);

  /* ---------- 방 ---------- */

  function litState() {
    const r = save.room;
    const mine = game.rooms[r].pairs.filter((x) => local().includes(x.lockOwner));
    const solved = roomSet('solved');
    const all = mine.length > 0 && mine.every((x) => solved.includes(x.p));
    return {
      dark: r === 0 && !save.open[0] && !all,
      radius: 110 + 45 * solved.length + (solved.includes(1) ? 60 : 0) + (devLv() === 'basic' ? 40 : 0),
    };
  }

  /** 화면 읽기 프로그램용 물체 이름 */
  function labelled(data, r) {
    const names = { door: '문 (비밀 단어)', shuttle: '셔틀', momobed: '모모의 침대', pedestal: '별의 심장 받침대' };
    for (const s of SUSPECTS) names[s.id] = `${s.ko} (${s.name})`;
    for (const x of game.rooms[r]?.pairs ?? []) {
      names[x.def.clue.obj] = x.def.clue.ko;
      names[x.def.lock.obj] = x.def.lock.ko;
    }
    for (const hs of data.hot) hs.label = names[hs.id] || hs.id;
    return data;
  }

  function renderRoom() {
    const r = save.room;
    const solved = roomSet('solved');
    const lit = litState();
    scene.render(
      labelled(
        ROOM_ART[r]({
          lit: lit.dark ? 0 : 1,
          solved,
          letters: knownLetters(game, r, solved),
          open: Boolean(save.open[r]),
        }),
        r
      ),
      { found: roomSet('crystals') }
    );
    scene.setDark(lit.dark, lit.radius);
    updateMarks();
    updateHud();
  }

  function updateMarks() {
    if (save.stage === 'finale') return;
    const r = save.room;
    const map = {};
    const solved = roomSet('solved');
    const glow = prefs.glow && levelRank(devLv()) <= 2;
    for (const x of game.rooms[r].pairs) {
      for (const side of ['clue', 'lock']) {
        const obj = x.def[side].obj;
        const owner = side === 'clue' ? x.clueOwner : x.lockOwner;
        if (local().includes(owner)) {
          const done = side === 'lock' ? solved.includes(x.p) : roomSet('clues').includes(x.p);
          map[obj] = done
            ? { kind: 'done' }
            : { kind: 'mine', glow, badge: local().length > 1 ? avatarOf(P(owner).avatar).emoji : '⭐' };
        } else map[obj] = { kind: 'team', badge: avatarOf(P(owner).avatar).emoji };
      }
    }
    if (knownLetters(game, r, solved).every(Boolean) && !save.open[r])
      map.door = { kind: 'mine', glow: true, badge: '🚪' };
    scene.marks(map);
  }

  function hot(id) {
    sfx.tap();
    if (save.stage === 'finale') {
      if (SUSPECTS.some((s) => s.id === id)) return openInterview(id);
      if (id === 'pedestal') return openEvidence();
      return;
    }
    if (save.stage !== 'play') return;
    if (id === 'door') return openExit();
    if (FLAVOR[id]) return pipSays(FLAVOR[id][tier()]);
    const role = objectRole(game, save.room, id);
    if (!role) return;
    if (!local().includes(role.owner)) return teammateNote(role);
    if (role.side === 'clue') openClue(role.pair);
    else openLock(role.pair);
  }

  function gotCrystal(id) {
    const list = roomSet('crystals');
    if (list.includes(id)) return;
    list.push(id);
    persist();
    sfx.collect();
    toast(`✨ 별 조각을 찾았어요! (${crystalsFound()}/${CRYSTALS_TOTAL})`);
    updateHud();
  }

  function teammateNote({ pair, side, owner }) {
    const lv = devLv();
    const name = avatarOf(P(owner).avatar);
    const objName = pair.def[side];
    const t =
      side === 'clue'
        ? { en: `${objName.en}: What do you see?`, ko: `${objName.ko}: 무엇이 보여?` }
        : {
            en: `I can help you with the ${objName.en.toLowerCase()}!`,
            ko: `${josa(objName.ko, '을', '를')} 도와줄게!`,
          };
    panel(
      `${objName.icon} ${objName.en}`,
      [
        h('p', { class: 'gm-lead' }, name.emoji, ` ${name.name}의 임무예요. 이 폰에서는 열 수 없어요.`),
        phraseBox(`${name.emoji} ${name.name}에게 영어로 말해 보세요`, t, lv, { speaker: 'narrator' }),
        h(
          'p',
          { class: 'gm-ko' },
          '단서를 가진 사람이 영어로 알려 주고, 잠금을 푸는 사람이 영어로 물어보며 함께 풀어요.'
        ),
      ],
      { sub: objName.ko }
    );
  }

  /* ---------- 단서 ---------- */

  /** 한 폰에 여럿이면: 그 사람만 보게 가림막을 먼저 띄운다 */
  function curtain(owner, then, what = '비밀 단서') {
    if (local().length < 2) return then();
    const a = avatarOf(P(owner).avatar);
    panel(
      `${a.emoji} ${a.name} 차례`,
      [
        h(
          'div',
          { class: 'gm-curtain' },
          h('span', { class: 'gm-emoji huge' }, a.emoji),
          h('p', { class: 'gm-lead' }, `${a.name}만 보세요! 다른 사람은 눈을 가려요 🙈`),
          h('p', { class: 'gm-ko' }, `${what}예요. 본 다음 영어로 알려 주세요.`)
        ),
        h('button', { type: 'button', class: 'btn primary big', onclick: then }, `${a.name}예요, 보여 주세요`),
      ],
      { sub: what, cls: 'gm-curtainpanel' }
    );
  }

  /** 혼자 할 때 짝수 번째 단서는 로봇 글자로 적혀 있어 핍에게 영어로 부탁해야 읽을 수 있다 (AI 파트너) */
  const soloPip = (pair) => game.n === 1 && pair.p % 2 === 1;
  const HOLD_LABEL = { armscreen: '꾹 눌러 화면 켜기', tablet: '꾹 눌러 조명 충전', sparky: '꾹 눌러 스파키 쓰다듬기' };

  /** 미니게임 밑에 깔릴 단서 그림 (그림이 없으면 쪽지) */
  function revealContent(pair) {
    const art = closeup(pair.clue.art);
    if (art) return h('div', { class: `gm-art gm-art-${pair.clue.art.type}` }, art);
    return h('div', { class: 'gm-paper', lang: 'en' }, pair.clue.text.en);
  }

  function openClue(pair, { trusted = false, fresh = false, pipReads = false } = {}) {
    if (!trusted && local().length > 1) return curtain(pair.clueOwner, () => openClue(pair, { trusted: true }));
    if (!roomSet('unlocked').includes(pair.p)) return openClueGame(pair);
    if (soloPip(pair) && !roomSet('pipRead').includes(pair.p)) return openRobotText(pair);
    const r = save.room;
    const v = pair.clue;
    const lv = pair.clueLv;
    const speaker = pipReads ? 'pip' : v.art?.type === 'captain' || v.art?.type === 'radio' ? 'luna' : 'narrator';
    if (!roomSet('clues').includes(pair.p)) {
      roomSet('clues').push(pair.p);
      persist();
      updateMarks();
    }
    const body = [h('div', { class: 'gm-owner' }, who(pair.clueOwner), h('span', { class: 'gm-tag' }, '📢 단서'))];
    const art = closeup(v.art);
    if (art) body.push(h('div', { class: `gm-art gm-art-${v.art.type}${fresh ? ' fresh' : ''}` }, art));
    // 들어야 하는 단서: 'after'는 한 번 들은 뒤 글이 보이고, 'hidden'은 글 보기 버튼을 눌러야 보인다 (듣기 연습)
    const textBox = bilingual(v.text, lv, { speaker });
    const reveal = h(
      'button',
      { type: 'button', class: 'gm-chip', onclick: () => ((textBox.hidden = false), (reveal.hidden = true)) },
      icon('eye', { size: 16 }),
      '글 보기'
    );
    if (v.listen === 'after' || v.listen === 'hidden') {
      textBox.hidden = true;
      reveal.hidden = v.listen === 'after';
    } else reveal.hidden = true;
    const playLabel = v.art?.type === 'captain' ? '영상 재생' : '메시지 듣기';
    let playBtn = null;
    if (v.listen) {
      playBtn = h(
        'button',
        {
          type: 'button',
          class: 'btn primary gm-play',
          onclick: async () => {
            sfx.radio();
            art?.classList?.add('playing');
            await say(v.text.en, speaker, { slow: lv === 'basic' || lv === 'im1' });
            art?.classList?.remove('playing');
            if (v.listen === 'after') reveal.hidden = false;
          },
        },
        icon('play', { size: 18 }),
        playLabel
      );
      body.push(playBtn);
    }
    if (v.tones)
      body.push(
        h(
          'button',
          { type: 'button', class: 'btn gm-play', onclick: () => playMelody(v.tones) },
          icon('volume', { size: 18 }),
          '노래 듣기'
        )
      );
    if (v.art?.type === 'sparky') body.push(sparkyPlayer(pair));
    if (v.say)
      body.push(
        h(
          'button',
          { type: 'button', class: 'btn gm-play', onclick: () => say(v.say, 'narrator', { slow: true }) },
          icon('volume', { size: 18 }),
          '소리 듣기'
        )
      );
    body.push(textBox, reveal);
    const self = pair.clueOwner === pair.lockOwner;
    const to = avatarOf(P(pair.lockOwner).avatar);
    body.push(
      phraseBox(
        self ? '찾은 것을 소리 내어 말해 보세요' : `${to.emoji} ${to.name}에게 영어로 알려 주세요`,
        pair.tell,
        lv
      ),
      h(
        'p',
        { class: 'gm-hintline' },
        `이 단서는 ${pair.def.lock.icon} ${pair.def.lock.ko}${self ? '를 열 때 써요.' : `를 여는 ${to.name}에게 필요해요.`}`
      )
    );
    panel(`${pair.def.clue.icon} ${pair.def.clue.en}`, body, { sub: `${pair.def.clue.ko} · ${ROOMS[r].title.ko}` });
    // 주파수를 맞추자마자 무전이 들려온다 / 핍이 로봇 글자를 읽어 준다
    if (fresh && playBtn) setTimeout(() => playBtn.isConnected !== false && playBtn.click(), 350);
    else if (pipReads) say(v.text.en, 'pip', { slow: levelRank(lv) <= 1 });
  }

  /** 단서를 처음 열 때: 손으로 하는 미니게임 (먼지 닦기·주파수 맞추기·손전등·조각 돌리기·꾹 누르기) */
  function openClueGame(pair) {
    const kind = pair.def.clue.game || 'hold';
    const info = GAME_INFO[kind];
    const stageEl = h('div', { class: `mg-stage mg-${kind}` });
    panel(
      `${pair.def.clue.icon} ${pair.def.clue.en}`,
      [
        h('div', { class: 'gm-owner' }, who(pair.clueOwner), h('span', { class: 'gm-tag' }, '🔎 단서 찾기')),
        h('p', { class: 'mg-howto' }, `${info.ico} ${info.ko}`, h('small', { lang: 'en' }, ` ${info.en}`)),
        stageEl,
      ],
      { sub: `${pair.def.clue.ko} · ${ROOMS[save.room].title.ko}`, cls: 'gm-gamepanel' }
    );
    const room = save.room;
    requestAnimationFrame(() =>
      startMinigame(kind, stageEl, {
        content: revealContent(pair),
        level: pair.clueLv,
        rng: rngFor(game.seed, `mg${room}:${pair.p}`),
        label: HOLD_LABEL[pair.def.clue.obj] || '꾹 누르기',
        onDone: () => {
          if (save.room !== room) return;
          if (!roomSet('unlocked').includes(pair.p)) roomSet('unlocked').push(pair.p);
          persist();
          updateMarks();
          setTimeout(() => openClue(pair, { trusted: true, fresh: true }), 450);
        },
      })
    );
  }

  const GLYPHS = '◐◑◒◓▲▼◆◇○●□■△▽☆★♢♤♧♡◈◎⬟⬢⬡✦';
  const robotGlyphs = (text) =>
    text
      .slice(0, 90)
      .split('')
      .map((ch) => (/[a-z]/i.test(ch) ? GLYPHS[(ch.toLowerCase().charCodeAt(0) - 97) % GLYPHS.length] : ch))
      .join('');

  function openRobotText(pair) {
    const lv = pair.clueLv;
    const q =
      levelRank(lv) <= 1
        ? { en: 'Pip, can you read this?', ko: '핍, 이거 읽어 줄래?' }
        : { en: 'Pip, what does this say? Can you read it for me?', ko: '핍, 이게 무슨 뜻이야? 나 대신 읽어 줄래?' };
    panel(
      `${pair.def.clue.icon} ${pair.def.clue.en}`,
      [
        h('div', { class: 'gm-owner' }, who(pair.clueOwner), h('span', { class: 'gm-tag' }, '🤖 로봇 글자')),
        h('p', { class: 'gm-lead' }, '로봇 글자로 적혀 있어요! 핍은 로봇 글자를 읽을 수 있어요.'),
        h('p', { class: 'gm-robotext', 'aria-hidden': 'true' }, robotGlyphs(pair.clue.text.en)),
        phraseBox('핍에게 영어로 부탁해요', q, lv, { speaker: 'pip' }),
        h(
          'button',
          {
            type: 'button',
            class: 'btn primary big',
            onclick: () => {
              if (!roomSet('pipRead').includes(pair.p)) roomSet('pipRead').push(pair.p);
              persist();
              sfx.radio();
              openClue(pair, { trusted: true, pipReads: true });
            },
          },
          '🤖 핍에게 부탁하기'
        ),
      ],
      { sub: '혼자 할 때는 핍이 팀원이에요' }
    );
  }

  /** 스파키를 누르면 짖는다 (소리 + 말풍선이 하나씩) */
  function sparkyPlayer(pair) {
    const barks = sparkyBarks(pair.token.n, pair.clueLv);
    const row = h('div', { class: 'gm-barks', 'aria-live': 'polite' });
    let playing = false;
    return h(
      'div',
      { class: 'gm-sparky' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn primary gm-play',
          onclick: async () => {
            if (playing) return;
            playing = true;
            clear(row);
            for (let i = 0; i < barks.length; i++) {
              const b = barks[i];
              row.append(
                h(
                  'span',
                  { class: `gm-bark ${b === 'AWOOO' ? 'long' : b === 'yip' ? 'yip' : ''}` },
                  pair.clueLv === 'basic' ? `${i + 1}. ${b}` : b
                )
              );
              await say(b === 'AWOOO' ? 'Awoooooo!' : b === 'yip' ? 'yip!' : 'Woof!', b === 'yip' ? 'momo' : 'bolt');
              await new Promise((res) => setTimeout(res, 250));
            }
            playing = false;
          },
        },
        '🐕 스파키 누르기'
      ),
      row
    );
  }

  /* ---------- 잠금 ---------- */

  function openLock(pair) {
    const r = save.room;
    const lock = pair.lock;
    const lv = pair.lockLv;
    const solved = roomSet('solved').includes(pair.p);
    const self = pair.clueOwner === pair.lockOwner;
    const from = avatarOf(P(pair.clueOwner).avatar);
    const body = [h('div', { class: 'gm-owner' }, who(pair.lockOwner), h('span', { class: 'gm-tag lock' }, '🔒 잠금'))];
    body.push(bilingual(lock.text, lv));
    if (self)
      body.push(
        h(
          'p',
          { class: 'gm-hintline' },
          `단서: ${pair.def.clue.icon} ${pair.def.clue.ko}(${pair.def.clue.en})를 먼저 보세요.`
        )
      );
    else body.push(phraseBox(`${from.emoji} ${from.name}에게 영어로 물어보세요`, pair.ask, lv));
    if (solved) {
      body.push(solvedCard(pair));
      panel(`${pair.def.lock.icon} ${pair.def.lock.en}`, body, { sub: pair.def.lock.ko });
      return;
    }
    const msg = h('p', { class: 'gm-msg', 'aria-live': 'assertive' });
    const area = h('div', { class: 'gm-lockarea' });
    body.push(area, msg);
    const el = panel(`${pair.def.lock.icon} ${pair.def.lock.en}`, body, { sub: pair.def.lock.ko, cls: 'gm-lockpanel' });

    const tries = () => ((save.tries[`${r}:${pair.p}`] ??= 0), save.tries[`${r}:${pair.p}`]);
    const fail = (text = 'Not quite! Try again.') => {
      save.tries[`${r}:${pair.p}`] = tries() + 1;
      // 틀리면 태양 폭풍이 조금 다가온다 (실패로 끝나지는 않는다)
      if (prefs.timer && save.stage === 'play') {
        save.playMs += 20000;
        updateHud();
        toast('⚡ 앗! 태양 폭풍이 20초 더 가까워졌어요.', { ms: 2200 });
      }
      persist();
      sfx.bad();
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      msg.className = 'gm-msg bad';
      msg.textContent = tries() >= 3 ? `${text} 💡 막히면 핍의 짝꿍에게 힌트를 부탁해요.` : text;
    };
    const win = () => solve(pair);

    if (lock.widget === 'voice') {
      const v = voiceInput({
        prompt: h('p', { class: 'gm-ko' }, '🎤를 누르고 말하세요. 다 말하면 잠시 기다리면 돼요.'),
        onHeard: (text, mode) => {
          const ok =
            mode === 'typed' ? hasKeywords(text, [lock.expected]) : voicePass(text, { ...lock.voice, level: lv });
          if (ok) {
            if (mode === 'voice') save.said++;
            win();
          } else {
            v.fail();
            fail(
              hasKeywords(text, [lock.expected])
                ? `I heard “${text}”. Say a longer sentence!`
                : `I heard “${text}”. Use the magic word!`
            );
          }
        },
      });
      area.append(v.el);
      return;
    }
    // 게이지(누르고 떼기)·레이저 미로는 손을 떼거나 별에 닿으면 바로 확인한다
    const autoCheck = () => {
      if (!w.ready()) return;
      if (!sameAnswer(lock.widget, w.get(), lock.expected)) {
        fail(lock.widget === 'gauge' ? `You let go at ${w.get()}. Try again!` : undefined);
        w.reset();
        return;
      }
      win();
    };
    const w = createWidget(lock, { level: lv, onDone: () => setTimeout(autoCheck, 120) });
    area.append(w.el);
    const check = h(
      'button',
      {
        type: 'button',
        class: 'btn primary big gm-check',
        onclick: () => {
          if (!w.ready()) {
            msg.className = 'gm-msg';
            msg.textContent = '아직 다 입력하지 않았어요.';
            return;
          }
          if (!sameAnswer(lock.widget, w.get(), lock.expected)) return fail();
          if (lock.voice) return voiceStep();
          win();
        },
      },
      icon('check', { size: 20 }),
      '확인'
    );
    if (!['gauge', 'maze'].includes(lock.widget)) area.append(check);

    /** 모양을 맞힌 뒤 핍에게 말하기 (IM1~IM3 충전기) */
    function voiceStep() {
      sfx.beep();
      const vv = lock.voice;
      clear(area);
      const prompt = vv.question
        ? h(
            'div',
            null,
            h('p', { class: 'gm-ko' }, '핍이 졸린 목소리로 물어요:'),
            bilingual({ en: vv.question }, lv, { speaker: 'pip' })
          )
        : h(
            'div',
            null,
            h('p', { class: 'gm-ko' }, '이제 핍에게 말하세요:'),
            bilingual({ en: vv.say }, lv, { speaker: 'pip' })
          );
      if (vv.question) say(vv.question, 'pip');
      const v = voiceInput({
        prompt,
        onHeard: (text, mode) => {
          const ok =
            mode === 'typed'
              ? hasKeywords(text, vv.keywords || []) || speechScore(text, vv.target || vv.say || '') >= 0.6
              : voicePass(text, { ...vv, level: lv });
          if (ok) {
            if (mode === 'voice') save.said++;
            win();
          } else {
            v.fail();
            fail(`I heard “${text}”. Try again!`);
          }
        },
      });
      area.append(v.el);
    }
  }

  function solvedCard(pair) {
    return h(
      'div',
      { class: 'gm-solved' },
      h('div', { class: 'gm-letter-big' }, pair.letter),
      h(
        'div',
        null,
        h('b', null, `문 글자 ${pair.p + 1}번: ${pair.letter}`),
        h('p', { class: 'gm-ko' }, '문 옆 글자판에 들어갔어요. 다른 팀원에게도 영어로 알려 주세요!'),
        h('p', { class: 'gm-en', lang: 'en' }, `“Letter number ${pair.p + 1} is ${pair.letter}.”`)
      )
    );
  }

  function solve(pair) {
    const solved = roomSet('solved');
    if (!solved.includes(pair.p)) solved.push(pair.p);
    persist();
    sfx.ok();
    const lv = pair.lockLv;
    panel(
      `${pair.def.lock.icon} ${pair.def.lock.en}`,
      [
        h('div', { class: 'gm-burst', 'aria-hidden': 'true' }, '✨'),
        bilingual(pair.def.done, lv, { big: true }),
        solvedCard(pair),
      ],
      { sub: pair.def.lock.ko, cls: 'gm-win' }
    );
    say(pair.def.done.en, 'narrator');
    renderRoom();
    const mine = game.rooms[save.room].pairs.filter((x) => local().includes(x.lockOwner));
    if (mine.every((x) => solved.includes(x.p)))
      setTimeout(() => toast('🎉 이 폰의 임무를 모두 끝냈어요! 이제 문 글자를 모아요.', { ms: 4000 }), 1200);
  }

  /* ---------- 문 (글자 네 개) ---------- */

  function openExit() {
    const r = save.room;
    const room = game.rooms[r];
    const known = knownLetters(game, r, roomSet('solved'));
    const typed = known.map((ch) => ch);
    const lv = devLv();
    const slots = h('div', { class: 'gm-wordslots' });
    const msg = h('p', { class: 'gm-msg', 'aria-live': 'assertive' });
    const draw = () => {
      clear(slots);
      room.pairs.forEach((x, i) => {
        const mineL = Boolean(known[i]);
        const owner = avatarOf(P(x.lockOwner).avatar);
        slots.append(
          h(
            'button',
            {
              type: 'button',
              class: `gm-wslot${mineL ? ' known' : typed[i] ? ' typed' : ''}`,
              onclick: () => {
                if (mineL) return;
                typed[i] = '';
                draw();
              },
            },
            h('b', null, typed[i] || '?'),
            h('small', null, mineL ? '✓' : owner.emoji)
          )
        );
      });
    };
    draw();
    const missing = room.pairs.filter((_, i) => !known[i]);
    const keys = h(
      'div',
      { class: 'gw-pad gw-letters' },
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((ch) =>
        h(
          'button',
          {
            type: 'button',
            class: 'gw-opt',
            onclick: () => {
              const i = typed.findIndex((x) => !x);
              if (i < 0) return;
              typed[i] = ch;
              sfx.key();
              draw();
            },
          },
          ch
        )
      )
    );
    const body = [
      bilingual(
        missing.length
          ? {
              en: 'Collect all four letters from your team, then open the door!',
              ko: '팀원들에게 글자를 물어 네 글자를 모두 모은 뒤 문을 열어요!',
            }
          : { en: 'You have all four letters. Open the door!', ko: '네 글자를 모두 알아요. 문을 열어요!' },
        lv
      ),
      slots,
      missing.length
        ? h(
            'div',
            { class: 'gm-asklist' },
            missing.map((x) => {
              const o = avatarOf(P(x.lockOwner).avatar);
              const t = { en: `What is letter number ${x.p + 1}?`, ko: `${x.p + 1}번 글자가 뭐야?` };
              return phraseBox(`${o.emoji} ${o.name}에게 묻기 (${x.p + 1}번 글자)`, t, lv);
            })
          )
        : null,
      missing.length ? keys : null,
      msg,
      h(
        'button',
        {
          type: 'button',
          class: 'btn primary big gm-check',
          onclick: () => {
            const word = typed.join('');
            if (word.length < 4) {
              msg.className = 'gm-msg';
              msg.textContent = '네 글자를 모두 채워요. (잘못 넣은 칸은 눌러서 지워요)';
              return;
            }
            if (word !== room.word) {
              sfx.bad();
              msg.className = 'gm-msg bad';
              msg.textContent = `“${word}” is not the right word. 틀린 칸을 눌러 지우고 다시 물어보세요.`;
              return;
            }
            closePanel();
            openDoor();
          },
        },
        icon('check', { size: 20 }),
        '문 열기'
      ),
    ];
    panel('🚪 Door code', body, { sub: '문 비밀 단어 (글자 네 개)' });
  }

  async function openDoor() {
    const r = save.room;
    save.open[r] = true;
    persist();
    sfx.door();
    renderRoom();
    await new Promise((res) => setTimeout(res, 700));
    await scene.walk('door');
    save.stage = 'outro';
    persist();
    roomOutro();
  }

  async function roomOutro() {
    const r = save.room;
    clear(bottom);
    const ev = evidenceOf(r, game.culprit, herring);
    const holder = chipHolder(r, game.levels);
    const mine = local().includes(holder) || game.n === 1;
    if (r < ROOM_COUNT - 1) {
      scene.render(ROOM_ART[r + 1]({ lit: 1, solved: [], letters: ['', '', '', ''] }), { found: [] });
      scene.setDark(false);
      scene.enter();
    } else {
      showFinaleScene();
      scene.enter();
    }
    await talk(
      mine ? ev.lines : chipGiven(r, `${avatarOf(P(holder).avatar).emoji} ${avatarOf(P(holder).avatar).name}`)
    );
    await evidenceCard(r);
    save.room = r + 1;
    save.stage = r + 1 < ROOM_COUNT ? 'intro' : 'finale-intro';
    persist();
    begin();
  }

  function evidenceCard(r) {
    return new Promise((resolve) => {
      const holder = chipHolder(r, game.levels);
      const mine = local().includes(holder) || game.n === 1;
      const ev = evidenceOf(r, game.culprit, herring);
      panel(
        `🧩 Memory chip ${r + 1}`,
        [
          mine
            ? h('div', { class: 'gm-evcard' }, evidenceIcon(r), bilingual(ev.card, devLv(), { big: true }))
            : chipView(r),
          mine && game.n > 1
            ? h('p', { class: 'gm-lead' }, '이 칩은 이 폰에만 보여요. 다른 사람이 물어보면 영어로 알려 주세요!')
            : null,
          r === 3 && mine ? doorLogView() : null,
          h(
            'p',
            { class: 'gm-ko' },
            '증거는 마지막 코어 룸에서 범인을 찾을 때 써요. 언제든 메뉴 → 증거에서 다시 볼 수 있어요.'
          ),
          h('button', { type: 'button', class: 'btn primary big', onclick: () => closePanel() }, '다음 방으로'),
        ],
        { sub: '핍의 기억 칩 · 증거', onClose: resolve, cls: 'gm-evpanel' }
      );
    });
  }

  function evidenceIcon(r) {
    const c = suspectOf(game.culprit);
    if (r === 0) return h('div', { class: `gm-evico shadow ${c.size}` }, h('span'));
    if (r === 1)
      return h(
        'div',
        { class: 'gm-evico leaf' },
        h('span', { style: { background: c.color === 'orange' ? '#fb923c' : '#a855f7' } })
      );
    if (r === 2) return h('div', { class: 'gm-evico floor' }, c.kind === 'robot' ? '🛢️' : '🍪');
    return h('div', { class: 'gm-evico log' }, '📜');
  }

  function doorLogView() {
    const rows = doorLog(game.culprit, herring);
    const easy = tier() === 'easy';
    return h(
      'table',
      { class: 'gm-log' },
      h('caption', null, easy ? 'Door log · 출입 기록' : 'Door log (last night)'),
      h(
        'tbody',
        null,
        rows.map((row) =>
          h(
            'tr',
            { class: ['9:00', '9:04', '9:05', '9:20'].includes(row.time) ? 'hl' : '' },
            h('td', null, row.time),
            h('td', { lang: 'en' }, row.door.en, easy ? h('small', null, ` ${row.door.ko}`) : null),
            h('td', { lang: 'en' }, row.what.en, easy ? h('small', null, ` ${row.what.ko}`) : null)
          )
        )
      )
    );
  }

  /* ---------- 핍에게 묻기 ---------- */

  /** 이 폰에 여러 명이면 누가 묻는지 고른다 (묻는 사람의 수준에 맞춰 질문·답이 바뀐다) */
  function askerChips(onPick) {
    if (local().length < 2) return null;
    const wrap = h('div', { class: 'gm-askers' }, h('span', { class: 'gm-ko' }, '누가 물어요?'));
    const chips = local().map((i) =>
      h(
        'button',
        {
          type: 'button',
          class: `gm-chip${i === asker ? ' on' : ''}`,
          onclick: () => {
            asker = i;
            chips.forEach((c, k) => c.classList.toggle('on', local()[k] === i));
            onPick();
          },
        },
        avatarOf(P(i).avatar).emoji,
        ` ${avatarOf(P(i).avatar).name} · ${LEVEL_INFO[lvOf(i)].label}`
      )
    );
    wrap.append(...chips);
    return wrap;
  }

  function chat({ title, sub, speaker, cards, onAsk, aiAsk, headNode }) {
    const log = h('div', { class: 'gm-chat', 'aria-live': 'polite' });
    const history = [];
    const bubble = (from, t, lv) => {
      const b = h(
        'div',
        { class: `gm-bubble ${from}` },
        from === 'them' ? portrait(speaker, 'talk') : null,
        h(
          'div',
          null,
          h('p', { lang: 'en' }, t.en),
          t.ko && from === 'them' && (lv === 'basic' || showKo)
            ? h('small', null, t.ko)
            : t.ko && from === 'them'
              ? h('details', null, h('summary', null, '한국어'), h('small', null, t.ko))
              : null
        )
      );
      log.append(b);
      log.scrollTop = log.scrollHeight;
      return b;
    };
    const cardBox = h('div', { class: 'gm-cards' });
    const drawCards = () => {
      clear(cardBox);
      const lv = lvOf(asker);
      const hard = levelRank(lv) >= 2;
      for (const c of cards) {
        const q = hard ? c.qh : c.q;
        cardBox.append(
          h(
            'button',
            {
              type: 'button',
              class: 'gm-qcard',
              onclick: () => askCard(c),
            },
            h('span', { lang: 'en' }, q.en),
            lv === 'basic' || showKo ? h('small', null, q.ko) : null
          )
        );
      }
    };
    // 카드 묻기를 함수로 (🎤로 말한 문장이 카드와 비슷하면 그 카드로 묻는다)
    const askCard = async (c, spoken) => {
      const lv = lvOf(asker);
      const hard = levelRank(lv) >= 2;
      const q = hard ? c.qh : c.q;
      bubble('me', spoken ? { en: spoken } : q, lv);
      history.push({ from: 'me', text: q.en });
      const a = await onAsk(c, hard);
      bubble('them', a, lv);
      history.push({ from: 'them', text: a.en });
      say(a.en, speaker, { slow: !hard });
    };
    let aiBox = null;
    if (aiAsk && geminiEnabled()) {
      const input = h('input', {
        type: 'text',
        class: 'gw-type',
        lang: 'en',
        placeholder: 'Ask in English…',
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
      });
      const send = async (text) => {
        const q = text.trim();
        if (!q) return;
        input.value = '';
        const lv = lvOf(asker);
        bubble('me', { en: q }, lv);
        const wait = bubble('them', { en: '…' }, lv);
        try {
          const a = await aiAsk(q, lv, history);
          wait.remove();
          history.push({ from: 'me', text: q }, { from: 'them', text: a.reply });
          bubble('them', { en: a.reply, ko: a.ko }, lv);
          say(a.reply, speaker, { slow: levelRank(lv) <= 1 });
        } catch (e) {
          wait.remove();
          toast(`AI가 답하지 못했어요: ${e.message} 질문 카드를 써 주세요.`, { ms: 4500 });
        }
      };
      const mic = canListen
        ? h(
            'button',
            {
              type: 'button',
              class: 'gw-mic small',
              'aria-label': '말로 묻기',
              onclick: async () => {
                mic.classList.add('recording');
                try {
                  const heard = await listenOnce({ onInterim: (t) => (input.value = t) }).promise;
                  if (heard) {
                    save.said++;
                    await send(heard);
                  }
                } catch (e) {
                  toast(e.message);
                }
                mic.classList.remove('recording');
              },
            },
            icon('mic', { size: 22 })
          )
        : null;
      aiBox = h(
        'div',
        { class: 'gm-aibox' },
        h('p', { class: 'gm-ko' }, '🤖 AI로 자유롭게 물어볼 수 있어요 (이 기기의 Gemini 키 사용).'),
        h(
          'div',
          { class: 'gm-row' },
          mic,
          input,
          h(
            'button',
            { type: 'button', class: 'btn small primary', onclick: () => send(input.value) },
            icon('send', { size: 16 })
          )
        )
      );
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') send(input.value);
      });
    }
    if (!aiBox && canListen) {
      const heardEl = h('span', { class: 'gm-practice-out' });
      const mic = h(
        'button',
        {
          type: 'button',
          class: 'gm-chip',
          onclick: async () => {
            mic.classList.add('recording');
            heardEl.textContent = '듣는 중…';
            try {
              const heard = await listenOnce({ onInterim: (t) => (heardEl.textContent = t) }).promise;
              const best = cards
                .map((c) => ({ c, score: Math.max(speechScore(heard, c.q.en), speechScore(heard, c.qh.en)) }))
                .sort((a, b) => b.score - a.score)[0];
              if (heard && best.score >= 0.45) {
                heardEl.textContent = '';
                save.said++;
                persist();
                await askCard(best.c, heard);
              } else heardEl.textContent = heard ? `“${heard}” — 카드 중 하나처럼 물어봐요!` : '잘 안 들렸어요.';
            } catch (e) {
              heardEl.textContent = e.message;
            }
            mic.classList.remove('recording');
          },
        },
        icon('mic', { size: 16 }),
        '말로 묻기'
      );
      aiBox = h('div', { class: 'gm-practice' }, mic, heardEl);
    }
    drawCards();
    panel(
      title,
      [
        headNode,
        askerChips(drawCards),
        log,
        h('p', { class: 'gm-ko' }, '질문 카드를 누르면 바로 물어봐요.'),
        cardBox,
        aiBox,
      ],
      { sub, cls: 'gm-chatpanel' }
    );
  }

  function openPip() {
    const finale = save.stage === 'finale';
    const cards = finale ? FINALE_PIP : ROOMS[save.room].pip;
    chat({
      title: '🤖 Pip',
      sub: '핍에게 영어로 묻기',
      speaker: 'pip',
      cards,
      headNode:
        local().includes(game.buddy) || game.n === 1
          ? h('button', { type: 'button', class: 'gm-chip', onclick: () => openHints() }, '💡 힌트 보기 (짝꿍)')
          : null,
      onAsk: async (c, hard) => (hard ? c.ah : c.a),
      aiAsk: (q, lv, history) =>
        askPip({ room: Math.min(save.room, ROOM_COUNT - 1), level: lv, question: q, history, finale }),
    });
  }

  /* ---------- 힌트 (핍의 짝꿍) ---------- */

  function openHints(force = false) {
    const buddy = avatarOf(P(game.buddy).avatar);
    if (save.stage === 'finale') {
      panel(
        '💡 Hint',
        [
          bilingual(
            {
              en: 'Compare the evidence with each suspect. Two clues are enough to find one suspect!',
              ko: '증거를 용의자마다 비교해 봐요. 단서 두 개면 한 명으로 좁혀져요!',
            },
            devLv()
          ),
        ],
        { sub: '추리 힌트' }
      );
      return;
    }
    if (!force && !local().includes(game.buddy)) {
      panel(
        '💡 Pip’s hint book',
        [
          h('p', { class: 'gm-lead' }, `힌트 책은 핍의 짝꿍 ${buddy.emoji} ${buddy.name}의 폰에 있어요.`),
          phraseBox(
            `${buddy.emoji} ${buddy.name}에게 영어로 부탁하세요`,
            { en: 'Can you give us a hint, please?', ko: '힌트 좀 줄래?' },
            devLv()
          ),
          h(
            'button',
            { type: 'button', class: 'btn ghost', onclick: () => openHints(true) },
            `${buddy.name}가 이 폰에 없어요 → 여기서 볼게요`
          ),
        ],
        { sub: '힌트' }
      );
      return;
    }
    const r = save.room;
    const list = game.rooms[r].pairs.map((x) =>
      h(
        'button',
        { type: 'button', class: 'gm-hintrow', onclick: () => hintDetail(x) },
        h('span', { class: 'gm-hint-ico' }, `${x.def.clue.icon}→${x.def.lock.icon}`),
        h(
          'span',
          null,
          h('b', { lang: 'en' }, x.def.lock.en),
          h('small', null, ` ${x.def.lock.ko} · ${avatarOf(P(x.lockOwner).avatar).emoji}`)
        ),
        roomSet('solved').includes(x.p) ? h('span', { class: 'gm-ok' }, '✓') : null
      )
    );
    panel(
      '💡 Pip’s hint book',
      [
        h(
          'p',
          { class: 'gm-lead' },
          '🤖 핍의 짝꿍만 볼 수 있는 힌트예요. 어느 잠금이 어려운지 팀원에게 영어로 물어보세요: "Which one is hard?"'
        ),
        list,
      ],
      { sub: '힌트 책' }
    );
  }

  function hintDetail(x) {
    const r = save.room;
    const key = `${x.p}`;
    const used = ((save.hints[r] ??= {})[key] ??= 0);
    let shown = Math.max(1, used);
    const lv = devLv();
    const box = h('div', { class: 'gm-hints' });
    const draw = () => {
      clear(box);
      x.hints
        .slice(0, shown)
        .forEach((t, i) =>
          box.append(
            h(
              'div',
              { class: 'gm-hint' },
              h('span', { class: 'gm-hint-n' }, `Hint ${i + 1}`),
              bilingual(t, lv, { speaker: 'pip' })
            )
          )
        );
      if (shown < x.hints.length)
        box.append(
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              onclick: () => {
                shown++;
                draw();
              },
            },
            shown === x.hints.length - 1 ? '거의 정답 힌트 보기' : '다음 힌트'
          )
        );
      save.hints[r][key] = Math.max(save.hints[r][key], shown);
      persist();
    };
    draw();
    panel(
      `💡 ${x.def.lock.en}`,
      [
        h(
          'p',
          { class: 'gm-lead' },
          `팀원에게 영어로 읽어 주세요! (${avatarOf(P(x.lockOwner).avatar).emoji} ${avatarOf(P(x.lockOwner).avatar).name}의 잠금)`
        ),
        box,
        h('button', { type: 'button', class: 'btn ghost', onclick: () => openHints(true) }, '힌트 목록'),
      ],
      { sub: x.def.lock.ko }
    );
  }

  /* ---------- 임무 목록 ---------- */

  function openMissions() {
    const r = save.room;
    const pairs = game.rooms[r].pairs;
    const go = (obj, fn) => {
      closePanel();
      scene.focus(obj);
      setTimeout(fn, 480);
    };
    const blocks = local().map((i) => {
      const role = ROLES[game.roles[i]];
      const locks = pairs.filter((x) => x.lockOwner === i);
      const clues = pairs.filter((x) => x.clueOwner === i);
      return h(
        'div',
        { class: 'gm-mission' },
        h('div', { class: 'gm-owner' }, who(i), h('span', { class: 'gm-tag' }, `${role.emoji} ${role.name}`)),
        clues.map((x) => {
          const to = avatarOf(P(x.lockOwner).avatar);
          return h(
            'button',
            { type: 'button', class: 'gm-job', onclick: () => go(x.def.clue.obj, () => openClue(x)) },
            h('span', { class: 'gm-job-ico' }, x.def.clue.icon),
            h(
              'span',
              null,
              h('b', null, `📢 ${x.def.clue.ko}`),
              h(
                'small',
                null,
                x.clueOwner === x.lockOwner ? ' 단서를 보고 직접 써요' : ` 보고 ${to.emoji} ${to.name}에게 알려 주기`
              )
            ),
            roomSet('clues').includes(x.p) ? h('span', { class: 'gm-ok' }, '👀') : null
          );
        }),
        locks.map((x) => {
          const from = avatarOf(P(x.clueOwner).avatar);
          return h(
            'button',
            { type: 'button', class: 'gm-job', onclick: () => go(x.def.lock.obj, () => openLock(x)) },
            h('span', { class: 'gm-job-ico' }, x.def.lock.icon),
            h(
              'span',
              null,
              h('b', null, `🔒 ${x.def.lock.ko}`),
              h(
                'small',
                null,
                x.clueOwner === x.lockOwner ? ` 단서: ${x.def.clue.ko}` : ` ${from.emoji} ${from.name}에게 물어서 열기`
              )
            ),
            roomSet('solved').includes(x.p) ? h('span', { class: 'gm-ok' }, `✓ ${x.letter}`) : null
          );
        })
      );
    });
    panel(
      '📋 Missions',
      [
        h('p', { class: 'gm-lead' }, '누르면 그 물건으로 가요. 다 풀면 문 글자를 모아 문을 열어요.'),
        blocks,
        roleLegend(),
      ],
      { sub: `${ROOMS[r].title.ko} · 이 폰의 임무` }
    );
  }

  function roleLegend() {
    return h(
      'details',
      { class: 'gm-legend' },
      h('summary', null, '우리 팀 역할'),
      h(
        'ul',
        null,
        game.players.map((p, i) => {
          const role = ROLES[game.roles[i]];
          return h(
            'li',
            null,
            avatarOf(p.avatar).emoji,
            ` ${avatarOf(p.avatar).name} (${LEVEL_INFO[p.level].label}) — ${role.emoji} ${role.name}: ${i === game.buddy ? ROLES.buddy.desc : role.desc}`
          );
        })
      )
    );
  }

  /* ---------- 메뉴 ---------- */

  function openMenu() {
    const toggleRow = (label, key, after) =>
      h(
        'label',
        { class: 'gm-toggle' },
        h('input', {
          type: 'checkbox',
          role: 'switch',
          checked: prefs[key],
          onchange: (e) => {
            prefs = updateGamePrefs({ [key]: e.currentTarget.checked });
            after?.();
          },
        }),
        h('span', null, label)
      );
    panel(
      '☰ Menu',
      [
        h(
          'button',
          { type: 'button', class: 'btn primary', onclick: () => closePanel() },
          icon('play', { size: 18 }),
          '계속하기'
        ),
        save.room > 0 || save.stage === 'finale'
          ? h('button', { type: 'button', class: 'btn', onclick: () => openEvidence() }, '🗂 모은 증거 보기')
          : null,
        h(
          'div',
          { class: 'gm-toggles' },
          toggleRow('효과음', 'sound', () => setSound(prefs.sound)),
          toggleRow('대사 자동으로 읽기', 'autoRead'),
          toggleRow('내 임무 반짝이기', 'glow', () => updateMarks()),
          toggleRow('태양 폭풍 타이머', 'timer', () => updateHud())
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => {
              const el = document.documentElement;
              if (document.fullscreenElement) document.exitFullscreen?.();
              else el.requestFullscreen?.().catch(() => toast('이 브라우저는 전체 화면을 지원하지 않아요.'));
            },
          },
          '⛶ 전체 화면'
        ),
        h('button', { type: 'button', class: 'btn', onclick: () => openTeam() }, '👥 팀 코드 · 이 폰의 사람'),
        roleLegend(),
        h(
          'button',
          { type: 'button', class: 'btn ghost', onclick: () => close() },
          icon('x', { size: 18 }),
          '게임 나가기 (저장돼요)'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn danger',
            onclick: () => {
              if (!window.confirm?.('이 폰의 진행을 지우고 처음부터 할까요? (팀 코드는 그대로)')) return;
              const fresh = newSave(save.code, save.local);
              Object.keys(save).forEach((k) => delete save[k]);
              Object.assign(save, fresh);
              persist();
              closePanel();
              begin();
            },
          },
          '처음부터 다시'
        ),
      ],
      { sub: `팀 코드 ${formatCode(save.code)}` }
    );
  }

  function openTeam() {
    const chips = game.players.map((p, i) =>
      h(
        'button',
        {
          type: 'button',
          class: `gm-chip${save.local.includes(i) ? ' on' : ''}`,
          'aria-pressed': String(save.local.includes(i)),
          onclick: (e) => {
            const on = !save.local.includes(i);
            if (!on && save.local.length === 1) return toast('이 폰에 한 명은 있어야 해요.');
            save.local = on ? [...save.local, i].sort() : save.local.filter((x) => x !== i);
            e.currentTarget.classList.toggle('on', on);
            e.currentTarget.setAttribute('aria-pressed', String(on));
            asker = local()[0];
            persist();
            if (save.stage === 'play') renderRoom();
          },
        },
        avatarOf(p.avatar).emoji,
        ` ${avatarOf(p.avatar).name} · ${LEVEL_INFO[p.level].label}`
      )
    );
    panel(
      '👥 Team',
      [
        h('div', { class: 'gm-code' }, formatCode(save.code)),
        h('p', { class: 'gm-ko' }, '다른 폰: 게임 탭 → "팀 코드로 참가" → 이 코드를 넣어요.'),
        h(
          'div',
          { class: 'gm-row' },
          h(
            'button',
            { type: 'button', class: 'btn small', onclick: () => shareCode(save.code) },
            icon('share', { size: 16 }),
            '공유'
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn small',
              onclick: () =>
                copyText(formatCode(save.code)).then((ok) => toast(ok ? '복사했어요' : '복사하지 못했어요')),
            },
            icon('copy', { size: 16 }),
            '복사'
          )
        ),
        h('b', null, '이 폰으로 하는 사람'),
        h('div', { class: 'gm-chips' }, chips),
        h('p', { class: 'gm-ko' }, '모든 사람이 어느 한 폰에는 꼭 있어야 임무가 빠지지 않아요.'),
      ],
      { sub: '팀 코드' }
    );
  }

  /* ---------- 마지막: 코어 룸 ---------- */

  const moods = {};
  function showFinaleScene() {
    scene.render(labelled(finaleArt({ restored: save.stage === 'done' || save.restored, moods }), ROOM_COUNT), {
      found: [],
    });
    scene.setDark(false);
    scene.marks({});
  }

  /** 증거 칩 하나: 이 폰에 칩을 받은 사람이 있으면 내용, 없으면 누구에게 물어볼지 */
  function chipView(r) {
    const holder = chipHolder(r, game.levels);
    if (local().includes(holder) || game.n === 1) {
      const ev = evidenceOf(r, game.culprit, herring);
      return h('div', { class: 'gm-evcard' }, evidenceIcon(r), bilingual(ev.card, devLv()));
    }
    const a = avatarOf(P(holder).avatar);
    return h(
      'div',
      { class: 'gm-evcard locked' },
      h('div', { class: 'gm-evico' }, '🔒'),
      h(
        'div',
        { class: 'gm-bi' },
        h('b', null, `기억 칩 ${r + 1}번은 ${a.emoji} ${a.name}에게 있어요`),
        phraseBox(
          `${a.name}에게 영어로 물어보세요`,
          { en: 'What did your memory chip show?', ko: '네 기억 칩에 뭐가 보였어?' },
          devLv()
        )
      )
    );
  }

  function openEvidence() {
    const have = Math.min(save.room, ROOM_COUNT);
    const cards = [];
    for (let r = 0; r < have; r++) cards.push(chipView(r));
    const logHere = have >= 4 && (local().includes(chipHolder(3, game.levels)) || game.n === 1);
    panel(
      '🗂 Evidence',
      [
        cards.length
          ? cards
          : h('p', { class: 'gm-lead' }, '아직 증거가 없어요. 방을 탈출할 때마다 핍의 기억 칩에서 하나씩 나와요.'),
        logHere ? doorLogView() : null,
        have >= 4 ? suspectTable() : null,
      ],
      { sub: '핍의 기억 칩 · 칩마다 받은 사람이 달라요' }
    );
  }

  function suspectTable() {
    const easy = tier() === 'easy';
    return h(
      'div',
      { class: 'gm-suspects' },
      SUSPECTS.map((s) =>
        h(
          'div',
          { class: 'gm-suspect' },
          suspectIcon(s.id),
          h('b', null, s.name),
          h('small', { lang: 'en' }, `${s.size}, ${s.color}, ${s.kind === 'robot' ? 'robot' : 'not a robot'}`),
          easy
            ? h(
                'small',
                null,
                `${s.size === 'big' ? '큼' : '작음'} · ${TRAIT[s.color].ko} · ${s.kind === 'robot' ? '로봇' : '로봇 아님'}`
              )
            : null
        )
      )
    );
  }

  /** 용의자 네 명 (화면을 밀지 않아도 바로 물어볼 수 있게) */
  function openSuspects() {
    panel(
      '🕵️ Suspects',
      [
        h(
          'p',
          { class: 'gm-lead' },
          '누구에게 물어볼까요? 거짓말을 하는 사람이 있어요. 하지만 거짓말쟁이가 꼭 범인은 아니에요!'
        ),
        h(
          'div',
          { class: 'gm-pickgrid' },
          SUSPECTS.map((s) =>
            h(
              'button',
              { type: 'button', class: 'gm-pick', onclick: () => openInterview(s.id) },
              suspectIcon(s.id),
              h('b', null, s.name),
              h('small', null, `${s.ko} · ${(save.interviewed[s.id] || []).length}/${QUESTIONS.length} 질문`)
            )
          )
        ),
      ],
      { sub: '용의자에게 묻기' }
    );
  }

  function openInterview(id) {
    const s = suspectOf(id);
    const asked = (save.interviewed[id] ??= []);
    chat({
      title: `${s.name}`,
      sub: `${s.ko} · ${s.job.ko}`,
      speaker: id,
      cards: QUESTIONS.map((q) => ({ ...q, a: null })),
      headNode: h(
        'div',
        { class: 'gm-sushead' },
        portrait(id),
        h(
          'p',
          { class: 'gm-ko' },
          '질문을 골라 영어로 물어보세요. 출입 기록을 들이대면(Your door opened…) 숨긴 이야기가 나올 수도 있어요!'
        )
      ),
      onAsk: async (c, hard) => {
        if (!asked.includes(c.id)) asked.push(c.id);
        persist();
        return answerFor(id, c.id, hard, { culprit: game.culprit, herring });
      },
      aiAsk: (q, lv, history) => askSuspect({ suspect: id, culprit: game.culprit, level: lv, question: q, history }),
    });
  }

  /** 비밀 투표: 한 사람씩 몰래 고르고, 다 같이 "3, 2, 1!" 하고 화면을 동시에 보여 준다 */
  function openAccuse() {
    const voters = local();
    const votes = {};
    let i = 0;
    const pickFor = (v) => {
      const a = avatarOf(P(v).avatar);
      panel(
        '🗳 Secret vote',
        [
          h('p', { class: 'gm-lead' }, `${a.emoji} ${a.name}, 누가 별의 심장을 가져갔을까요? 몰래 골라요!`),
          h(
            'div',
            { class: 'gm-pickgrid' },
            SUSPECTS.map((s) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'gm-pick',
                  onclick: () => {
                    votes[v] = s.id;
                    sfx.tap();
                    i++;
                    next();
                  },
                },
                suspectIcon(s.id),
                h('b', null, s.name),
                h('small', null, s.ko)
              )
            )
          ),
          h('button', { type: 'button', class: 'btn ghost', onclick: () => openEvidence() }, '🗂 증거 다시 보기'),
        ],
        { sub: '비밀 투표' }
      );
    };
    const next = () => {
      if (i < voters.length) return curtain(voters[i], () => pickFor(voters[i]), '비밀 투표');
      reveal();
    };
    const reveal = () => {
      // 혼자 하는 게임은 숨길 사람이 없으니 카운트다운 없이 바로 보여 준다
      const solo = game.n === 1;
      const board = h('div', { class: 'gm-votes', hidden: !solo });
      const chosen = [...new Set(Object.values(votes))];
      const rows = [
        ...voters.map((v) =>
          h(
            'div',
            { class: 'gm-vote' },
            h('span', { class: 'gm-emoji big' }, avatarOf(P(v).avatar).emoji),
            h('span', null, '→'),
            suspectIcon(votes[v]),
            h('b', null, suspectOf(votes[v]).name)
          )
        ),
        voters.length < game.n
          ? h('p', { class: 'gm-ko' }, '다른 폰의 투표와도 맞춰 보세요. 모두 같은 사람을 골랐나요?')
          : null,
        chosen.length > 1 ? h('p', { class: 'gm-lead' }, '의견이 갈렸어요! 이유를 영어로 말해 보고 정해요.') : null,
        ...chosen.map((id) =>
          h(
            'button',
            { type: 'button', class: 'btn primary big', onclick: () => accuse(id) },
            `👉 ${suspectOf(id).name} 지목하기`
          )
        ),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => closePanel() }, '조금 더 조사할래요'),
      ];
      board.append(...rows.filter(Boolean));
      const count = solo
        ? null
        : h(
            'button',
            {
              type: 'button',
              class: 'btn primary big gm-countdown',
              onclick: async () => {
                count.disabled = true;
                for (const n of ['3', '2', '1']) {
                  count.textContent = n;
                  sfx.beep();
                  await new Promise((res) => setTimeout(res, 650));
                }
                sfx.win();
                count.remove();
                board.hidden = false;
              },
            },
            '3 · 2 · 1 공개!'
          );
      panel(
        '🗳 Secret vote',
        [
          h(
            'p',
            { class: 'gm-lead' },
            solo
              ? '이 사람이 범인일까요? 지목하면 그 사람이 대답해요. 틀려도 다시 조사할 수 있어요!'
              : '모두 골랐으면 다 같이 "3, 2, 1!"을 외치고 화면을 동시에 보여 주세요!'
          ),
          count,
          board,
        ],
        {
          sub: solo ? '범인 지목' : '비밀 투표 공개',
        }
      );
    };
    next();
  }

  async function accuse(id) {
    const s = suspectOf(id);
    if (id !== game.culprit) {
      save.accused.push(id);
      persist();
      sfx.bad();
      moods[id] = 'calm';
      const d = denial(id, game.culprit);
      await talk([
        { who: id, easy: d, hard: d },
        {
          who: 'pip',
          easy: {
            en: "Hmm, it's not " + s.name + '. Look at the clues again!',
            ko: `음, ${s.ko}가 아니야. 단서를 다시 봐!`,
          },
          hard: {
            en: `Hmm, ${s.name} is right. Let's compare the evidence again!`,
            ko: `음, ${s.ko} 말이 맞아. 증거를 다시 비교해 보자!`,
          },
        },
      ]);
      return;
    }
    moods[id] = 'nervous';
    showFinaleScene();
    scene.focus(id);
    await rebuttalStep(id);
  }

  /** 범인의 마지막 반박: 다른 사람(붉은 청어)에게 뒤집어씌우려 한다 → 반박할 증거를 골라 영어로 말한다 */
  async function rebuttalStep(id) {
    const rb = rebuttal(id, herring);
    await talk([rb.line], { moods: { [id]: 'nervous' } });
    return new Promise((resolve) => {
      const lv = devLv();
      const out = h('div', { class: 'gm-proof' });
      const order = [...rb.options].sort((a, b) => rngFor(game.seed, a.id)() - rngFor(game.seed, b.id)());
      const opts = order.map((o) =>
        h(
          'button',
          {
            type: 'button',
            class: 'gm-qcard',
            onclick: () => {
              if (!o.ok) {
                sfx.bad();
                clear(out).append(
                  bilingual({ en: 'Ha! That proves nothing!', ko: '하! 그건 아무것도 증명하지 못해!' }, lv, {
                    speaker: id,
                  })
                );
                say('Ha! That proves nothing!', id);
                return;
              }
              sfx.ok();
              clear(out).append(phraseBox('이렇게 말해요', o.text, lv), go);
              go.hidden = false;
            },
          },
          h('span', { lang: 'en' }, o.text.en),
          lv === 'basic' ? h('small', null, o.text.ko) : null
        )
      );
      const go = h(
        'button',
        {
          type: 'button',
          class: 'btn primary big',
          hidden: true,
          onclick: async () => {
            closePanel();
            moods[id] = 'sad';
            showFinaleScene();
            scene.focus(id);
            await talk(CONFESSION[id], { moods });
            await talk([{ who: 'narrator', easy: RESOLUTION[id], hard: RESOLUTION[id] }, ...ENDING]);
            await shieldStep();
            resolve();
          },
        },
        '증거를 들이대요!'
      );
      panel(
        `🤔 ${suspectOf(id).name}: “Not me!”`,
        [
          h('div', { class: 'gm-sushead' }, portrait(id, 'nervous'), bilingual(rb.line[tier()], lv, { speaker: id })),
          h('p', { class: 'gm-lead' }, '어떤 증거로 반박할까요? (맞는 증거는 두 가지예요)'),
          h('div', { class: 'gm-cards' }, opts),
          out,
        ],
        { sub: '마지막 반박' }
      );
    });
  }

  /** 정전 복구: 내 스위치판의 설명은 다른 사람 폰에 있다. 서로 영어로 알려 줘야 불이 켜진다 */
  function blackoutRelay() {
    return new Promise((resolve) => {
      const targets = relayTargets(game.seed, game.n);
      const state = targets.map(() => [false, false, false]);
      const reader = (o) => (o + game.n - 1) % game.n; // 내 판의 설명을 가진 사람
      const easy = levelRank(devLv()) <= 1;
      let left = easy ? 90 : 60;
      scene.setDark(true, 70);
      sfx.alarm();
      const clockEl = h('b', { class: 'gm-relay-time' });
      const panels = local().map((o) => {
        const a = avatarOf(P(o).avatar);
        const ok = h('span', { class: 'gm-relay-ok' }, '');
        const sw = [0, 1, 2].map((k) =>
          h(
            'button',
            {
              type: 'button',
              class: 'gw-switch down relay',
              'data-owner': String(o),
              'data-k': String(k),
              onclick: (e) => {
                state[o][k] = !state[o][k];
                e.currentTarget.className = `gw-switch ${state[o][k] ? 'up' : 'down'} relay`;
                e.currentTarget.querySelector('.gw-label').textContent = state[o][k] ? 'ON' : 'OFF';
                sfx.click();
                check();
              },
            },
            h('span', { class: 'gw-num' }, String(k + 1)),
            h('span', { class: 'gw-lever' }),
            h('span', { class: 'gw-label', lang: 'en' }, 'OFF')
          )
        );
        const box = h(
          'div',
          { class: 'gm-relay-panel' },
          h('b', null, `${a.emoji} ${a.name}의 차단기`, ok),
          h('div', { class: 'gw-switches' }, sw)
        );
        box.ok = ok;
        box.owner = o;
        return box;
      });
      const cards =
        game.n === 1
          ? [
              h(
                'div',
                { class: 'gm-relay-card' },
                h('b', null, '🤖 핍의 무전'),
                bilingual(relayText(targets[0], devLv()), devLv(), { speaker: 'pip' })
              ),
            ]
          : game.players
              .map((_, o) => o)
              .filter((o) => local().includes(reader(o)))
              .map((o) => {
                const rd = reader(o);
                const to = avatarOf(P(o).avatar);
                // 어려운 설명을 받은 사람은 풀어서, 듣는 사람 수준에 맞게 짧고 쉽게 말해 준다
                const simpler = levelRank(lvOf(o)) <= 1 && levelRank(lvOf(o)) < levelRank(lvOf(rd));
                return h(
                  'div',
                  { class: 'gm-relay-card' },
                  h('b', null, `📢 ${to.emoji} ${to.name}에게 영어로 알려 주세요`),
                  bilingual(relayText(targets[o], lvOf(rd)), lvOf(rd)),
                  simpler
                    ? h('small', { class: 'gm-ko' }, `💡 ${to.name}에게는 “Switch one, ON!”처럼 짧고 쉽게 말해 주세요.`)
                    : null
                );
              });
      const power = h(
        'button',
        { type: 'button', class: 'btn primary big', disabled: true, onclick: () => finish() },
        '⚡ 전원 켜기!'
      );
      const check = () => {
        let all = true;
        for (const box of panels) {
          const good = state[box.owner].every((b, k) => b === targets[box.owner][k]);
          box.ok.textContent = good ? ' ✓' : '';
          box.classList.toggle('good', good);
          all &&= good;
        }
        power.disabled = !all;
      };
      let timer = 0;
      const tick = () => {
        left--;
        clockEl.textContent = `⏱ ${left}초`;
        if (left <= 10) clockEl.classList.add('late');
        if (left <= 0) {
          left = 30;
          sfx.alarm();
          toast('🔋 비상 배터리! 30초가 더 생겼어요.', { ms: 2500 });
        }
      };
      const finish = () => {
        clearInterval(timer);
        sfx.win();
        scene.setDark(false);
        closePanel();
        resolve();
      };
      clockEl.textContent = `⏱ ${left}초`;
      timer = setInterval(tick, 1000);
      panel(
        '⚡ Blackout!',
        [
          h(
            'p',
            { class: 'gm-lead' },
            game.n === 1
              ? '핍이 무전으로 알려 주는 대로 스위치를 맞춰요!'
              : '내 스위치를 어떻게 할지는 다른 사람 폰에 있어요. 서로 영어로 알려 줘요!',
            ' ',
            clockEl
          ),
          cards,
          panels,
          power,
        ],
        { sub: '긴급 정전 · 다 같이 복구', cls: 'gm-relay', onClose: () => clearInterval(timer) }
      );
      if (game.n === 1) setTimeout(() => (sfx.radio(), say(relayText(targets[0], devLv()).en, 'pip')), 400);
    });
  }

  function shieldStep() {
    return new Promise((resolve) => {
      const lv = devLv();
      const t = SHIELD_LINE[tier()];
      const done = async (spoken) => {
        if (spoken) save.said++;
        save.restored = true;
        persist();
        closePanel();
        sfx.win();
        showFinaleScene();
        root.classList.add('gm-shield');
        await talk(FINAL_LINES);
        root.classList.remove('gm-shield');
        finish();
        resolve();
      };
      const v = voiceInput({
        prompt: h(
          'div',
          null,
          bilingual(t, lv, { speaker: 'pip' }),
          h('p', { class: 'gm-en big', lang: 'en' }, '“Shields up!”')
        ),
        onHeard: (text, mode) => {
          if (hasKeywords(text, [['shield', 'shields'], 'up']) || mode === 'typed') done(mode === 'voice');
          else v.fail();
        },
      });
      panel(
        '🛡 Shields up!',
        [v.el, h('button', { type: 'button', class: 'btn ghost', onclick: () => done(false) }, '다 같이 외쳤어요!')],
        { sub: '모두 함께 외치기' }
      );
      say(t.en, 'pip');
    });
  }

  function finish() {
    if (save.stage !== 'done') {
      save.stage = 'done';
      save.finishedAt = Date.now();
      persist();
      addGameLog({
        at: save.finishedAt,
        code: save.code,
        players: game.players,
        culprit: game.culprit,
        stars: stars().length,
        crystals: crystalsFound(),
        ms: save.playMs,
        said: save.said,
      });
    }
    showCertificate();
  }

  function stars() {
    const out = ['미션 성공'];
    if (prefs.timer ? save.playMs <= STORM_MS : save.accused.length === 0)
      out.push(prefs.timer ? '폭풍 전에 해냄' : '한 번에 범인 찾기');
    if (crystalsFound() >= 9) out.push('별 조각 9개 이상');
    return out;
  }

  function showCertificate() {
    showFinaleScene();
    clear(bottom);
    const c = suspectOf(game.culprit);
    const st = stars();
    panel(
      '🏅 Mission complete!',
      [
        h(
          'div',
          { class: 'gm-stars', 'aria-label': `별 ${st.length}개` },
          [0, 1, 2].map((i) => h('span', { class: i < st.length ? 'on' : '' }, '★'))
        ),
        h('p', { class: 'gm-en big', lang: 'en' }, 'Station NOVA is safe. Great teamwork, Space Cadets!'),
        h('p', { class: 'gm-ko' }, '노바 정거장을 구했어요! 멋진 팀워크였어요, 우주 사관생도 여러분!'),
        h(
          'ul',
          { class: 'gm-certlist' },
          st.map((x) => h('li', null, `★ ${x}`)),
          h('li', null, `🧭 범인: ${c.ko} (${c.name}) — ${RESOLUTION[c.id].ko}`),
          h(
            'li',
            null,
            `🤫 ${suspectOf(herring).ko}의 비밀: ${answerFor(herring, 'door', false, { culprit: game.culprit, herring }).ko}`
          ),
          h(
            'li',
            null,
            `💎 별 조각 ${crystalsFound()}/${CRYSTALS_TOTAL} · ⏱ ${clockText(save.playMs)} · 🎙 무전 ${save.said}번`
          )
        ),
        h(
          'details',
          { class: 'gm-timeline', open: true },
          h('summary', null, '📜 사건의 전말 (실제로 일어난 일)'),
          h(
            'ol',
            null,
            caseTimeline(game.culprit, herring).map((row) =>
              h(
                'li',
                { class: row.herring ? 'herring' : '' },
                h('b', null, row.time),
                h('span', { lang: 'en' }, row.text.en),
                h('small', null, row.text.ko)
              )
            )
          )
        ),
        h(
          'div',
          { class: 'gm-team' },
          game.players.map((p, i) =>
            h(
              'div',
              { class: 'gm-member' },
              h('span', { class: 'gm-emoji big' }, avatarOf(p.avatar).emoji),
              h('b', null, avatarOf(p.avatar).name),
              h(
                'small',
                null,
                `${ROLES[game.roles[i]].emoji} ${ROLES[game.roles[i]].en} · ${LEVEL_INFO[p.level].label}`
              )
            )
          )
        ),
        h(
          'button',
          { type: 'button', class: 'btn primary big', onclick: () => (close(), onNewMission?.()) },
          '🚀 같은 팀으로 새 미션'
        ),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, '게임 홈으로'),
      ],
      { sub: '노바 정거장 SOS · 수료증', cls: 'gm-cert' }
    );
  }

  /* ---------- 진행 ---------- */

  async function begin() {
    closePanel();
    overlay.querySelectorAll?.('.gm-talk').forEach((x) => x.remove());
    if (save.stage === 'prologue') {
      save.room = 0;
      scene.render(ROOM_ART[0]({ lit: 0, solved: [], letters: ['', '', '', ''] }), { found: [] });
      scene.setDark(true, 160);
      clear(bottom);
      updateHud();
      await talk(PROLOGUE, { moods: { pip: 'worried' } });
      save.stage = 'intro';
      persist();
    }
    if (save.stage === 'intro') {
      renderRoom();
      clear(bottom);
      scene.enter();
      const buddy = avatarOf(P(game.buddy).avatar);
      const extra =
        save.room === 0 && game.n > 1
          ? [
              {
                who: 'pip',
                easy: {
                  en: `My buddy is ${buddy.name}. Ask my buddy for hints!`,
                  ko: `내 짝꿍은 ${buddy.emoji} ${buddy.name}야. 힌트는 짝꿍에게 부탁해!`,
                },
                hard: {
                  en: `If you get stuck, ask my buddy for a hint. My buddy has my hint book!`,
                  ko: `막히면 내 짝꿍 ${buddy.emoji} ${buddy.name}에게 힌트를 부탁해. 짝꿍이 내 힌트 책을 갖고 있어!`,
                },
              },
            ]
          : [];
      await talk([...ROOMS[save.room].intro, ...extra]);
      save.stage = 'play';
      persist();
      if (save.room === 0)
        setTimeout(
          () =>
            toast(
              levelRank(devLv()) <= 1
                ? '⭐ 반짝이는 물건이 내 임무예요. 눌러 보세요!'
                : '화면을 옆으로 밀어 방을 둘러보세요. 내 임무는 📋 임무에 있어요.',
              { ms: 4500 }
            ),
          600
        );
    }
    if (save.stage === 'play') {
      renderRoom();
      if (levelRank(devLv()) <= 1) {
        const pairs = game.rooms[save.room].pairs;
        const clue = pairs.find((x) => local().includes(x.clueOwner) && !roomSet('clues').includes(x.p));
        const lock = pairs.find((x) => local().includes(x.lockOwner) && !roomSet('solved').includes(x.p));
        const obj = clue?.def.clue.obj ?? lock?.def.lock.obj;
        if (obj) setTimeout(() => scene.focus(obj), 500);
      }
      return;
    }
    if (save.stage === 'outro') return roomOutro();
    if (save.stage === 'finale-intro') {
      showFinaleScene();
      scene.focus('pedestal', { animate: false });
      clear(bottom);
      updateHud();
      await talk(FINALE_INTRO, { moods: { pip: 'worried' } });
      if (!save.relayDone) {
        await talk(BLACKOUT, { moods: { pip: 'worried' } });
        await blackoutRelay();
        save.relayDone = true;
        persist();
        await talk(BLACKOUT_DONE);
      }
      save.stage = 'finale';
      persist();
    }
    if (save.stage === 'finale') {
      showFinaleScene();
      scene.focus('pedestal', { animate: false });
      updateHud();
      return;
    }
    if (save.stage === 'done') {
      updateHud();
      showCertificate();
    }
  }

  function shareCode(code) {
    const url = `${location.origin}${location.pathname}#/game?join=${code}`;
    const text = `노바 정거장 SOS 팀 코드: ${formatCode(code)}\n${url}`;
    shareText(text, 'Station NOVA SOS').then((ok) => {
      if (!ok) copyText(text).then((c) => toast(c ? '코드를 복사했어요' : '공유하지 못했어요'));
    });
  }

  const onVisible = () => {
    if (!document.hidden) scene.layout();
  };
  document.addEventListener('visibilitychange', onVisible);

  // 안드로이드 뒤로 가기: 열린 창이 있으면 그 창만 닫고, 없으면 게임을 나간다 (진행은 저장돼 있다)
  const onBack = () => {
    if (current) {
      closePanel();
      history.pushState?.({ gm: true }, '');
    } else close({ fromBack: true });
  };
  history.pushState?.({ gm: true }, '');
  window.addEventListener('popstate', onBack);

  function close({ fromBack = false } = {}) {
    persist();
    hush();
    clearInterval(clock);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('popstate', onBack);
    if (!fromBack && history.state?.gm) history.back();
    keepAwake('game', false);
    document.body.classList.remove('gm-lock');
    if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
    scene.destroy();
    root.remove();
    onExit?.();
  }

  primeSpeech();
  begin();

  return {
    close,
    pause() {
      paused = true;
      hush();
      persist();
    },
    resume() {
      paused = false;
      scene.layout();
    },
    get save() {
      return save;
    },
  };
}
