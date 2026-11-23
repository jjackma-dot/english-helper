// 영어 게임 탭: 노바 정거장 SOS (1~4명, 휴대폰 1~4대가 함께하는 협동 영어 방탈출 + 범인 찾기).
// 처음 화면 → 팀 만들기(얼굴·수준) → 팀 코드(다른 폰은 코드로 참가) → 이 폰으로 할 사람 고르기 → 게임 화면(js/game/play.js).
// 폰끼리는 서로 연결하지 않는다: 같은 코드로 같은 게임을 만들고, 각자 화면의 단서를 영어로 말해서 주고받는다.

import { h, btn, clear, toast, segmented, shareText, copyText } from '../ui.js';
import { icon } from '../icons.js';
import { geminiEnabled, getGameLog, getGamePrefs, getGameSave, setGameSave, updateGamePrefs } from '../store.js';
import { primeSpeech } from '../speech.js';
import {
  AVATARS,
  LEVELS,
  LEVEL_INFO,
  MAX_PLAYERS,
  ROLES,
  assignRoles,
  avatarOf,
  clockText,
  decodeTeam,
  encodeTeam,
  formatCode,
  newSeed,
  normalizeCode,
} from '../game/logic.js';
import { suspectOf, TITLE } from '../game/story.js';
import { defs, heroArt } from '../game/art.js';
import { newSave, openGame } from '../game/play.js';

let body;
let ctl = null; // 열려 있는 게임 화면
let pendingJoin = '';

const show_ = (...nodes) => {
  clear(body).append(...nodes.filter(Boolean));
  window.scrollTo?.({ top: 0 });
};

const face = (p) =>
  h(
    'span',
    { class: 'gm-face-chip' },
    h('span', { class: 'gm-emoji' }, avatarOf(p.avatar).emoji),
    avatarOf(p.avatar).name,
    h('small', null, LEVEL_INFO[p.level].label)
  );

/* ---------- 처음 화면 ---------- */

function renderHome() {
  const save = getGameSave();
  let team = null;
  try {
    team = save ? decodeTeam(save.code) : null;
  } catch {
    team = null;
  }
  const progress = save
    ? save.stage === 'done'
      ? '미션 완료!'
      : save.stage === 'finale' || save.stage === 'finale-intro'
        ? '마지막 방: 범인 찾기'
        : `${Math.min(save.room, 3) + 1}번째 방 진행 중`
    : '';
  show_(
    h(
      'div',
      { class: 'card gm-hero' },
      heroArt(),
      h('h2', { class: 'gm-hero-title' }, TITLE.ko, h('small', { lang: 'en' }, TITLE.en)),
      h(
        'p',
        null,
        '불이 꺼진 우주정거장에서 사라진 ',
        h('b', null, '"별의 심장"'),
        '을 찾아요. 방 4개의 수수께끼를 영어로 힘을 합쳐 풀고, 마지막에는 용의자 4명 중 거짓말을 하는 한 명을 찾아내요.'
      ),
      h(
        'p',
        { class: 'hint' },
        '1~4명 · 휴대폰 1~4대 · Basic(초1·2)부터 IM3(중·고)까지 함께 · 약 40~60분 (언제든 저장)'
      )
    ),
    save && team
      ? h(
          'div',
          { class: 'card stack gm-continue' },
          h('div', { class: 'card-title' }, icon('play'), '이어하기'),
          h(
            'div',
            { class: 'gm-faces' },
            team.players.map((p, i) =>
              save.local.includes(i) ? face(p) : h('span', { class: 'gm-face-chip off' }, avatarOf(p.avatar).emoji)
            )
          ),
          h(
            'p',
            { class: 'hint' },
            `${progress} · 팀 코드 ${formatCode(save.code)} · 플레이 ${clockText(save.playMs)}`
          ),
          btn('이어하기', () => start(save), { cls: 'btn primary big', ico: 'play' })
        )
      : null,
    h(
      'div',
      { class: 'card stack' },
      btn('새 미션 만들기', () => renderSetup(), { cls: 'btn primary big', ico: 'plus' }),
      btn('팀 코드로 참가하기', () => renderJoin(), { cls: 'btn big', ico: 'zap' }),
      h(
        'p',
        { class: 'hint' },
        '여러 대로 할 때: 한 폰에서 미션을 만들고, 나머지 폰은 그 폰에 나온 팀 코드로 참가해요.'
      )
    ),
    howTo(),
    logCard()
  );
}

function howTo() {
  return h(
    'details',
    { class: 'card gm-how' },
    h('summary', null, '게임 방법 · 역할 · 수준'),
    h(
      'ul',
      { class: 'steps' },
      h(
        'li',
        null,
        h('b', null, '이야기: '),
        '방 4개(도킹 베이 → 우주 정원 → 로봇 작업실 → 관제실)를 차례로 되살려요. 방마다 기계 4개를 고치면 문 글자가 하나씩 나오고, 네 글자로 문을 열어요. 방을 나갈 때마다 도우미 로봇 핍의 기억 칩에서 증거가 나와요.'
      ),
      h(
        'li',
        null,
        h('b', null, '협동: '),
        '내 화면의 단서는 다른 사람의 잠금을 여는 데 필요해요. 단서를 가진 사람은 영어로 알려 주고, 잠금을 푸는 사람은 영어로 물어봐요. 화면에 말할 문장이 수준에 맞게 나와요.'
      ),
      h(
        'li',
        null,
        h('b', null, '휴대폰 여러 대: '),
        '폰끼리 인터넷으로 연결하지 않아요. 같은 팀 코드면 모든 폰에 같은 게임이 만들어지고, 각자 자기 임무만 열려요. 그래서 서로 말해야만 풀려요.'
      ),
      h(
        'li',
        null,
        h('b', null, '휴대폰 한 대: '),
        '모두 한 폰으로 해요. 임무마다 누구 차례인지 얼굴이 표시돼요. 혼자 해도 돼요.'
      ),
      h(
        'li',
        null,
        h('b', null, '수준: '),
        'Basic(초1·2)은 그림·색·숫자와 한국어 도움, IM1(초3·4)은 짧은 문장, IM2(초5·6)는 거꾸로·더하기처럼 한 번 더 생각하기, IM3(중·고)는 긴 글 추론·암호·영어로 설명하기. 같은 문제도 맡은 사람의 수준에 맞게 바뀌어요.'
      ),
      h(
        'li',
        null,
        h('b', null, '역할: '),
        `${ROLES.buddy.emoji} 핍의 짝꿍(가장 낮은 수준): 힌트 책을 갖고 있어 팀에 영어로 힌트를 읽어 줘요. ${ROLES.captain.emoji} 캡틴(가장 높은 수준): 어려운 기록을 읽고 마지막 추리를 이끌어요. ${ROLES.engineer.emoji} 엔지니어 · ${ROLES.navigator.emoji} 항해사.`
      ),
      h(
        'li',
        null,
        h('b', null, '마지막 추리: '),
        '용의자 4명에게 영어로 질문하고, 증거(그림자 크기·잎의 색·바닥의 흔적·출입 기록)와 비교해 거짓말쟁이를 찾아요. 누가 범인이든 무섭지 않은 이유가 있고, 사과하고 화해해요. 범인은 판마다 바뀌어요.'
      ),
      h(
        'li',
        null,
        h('b', null, 'AI 대화: '),
        geminiEnabled()
          ? '이 기기에 Gemini 키가 있어 핍·용의자에게 자유롭게 영어로 물을 수 있어요. '
          : '키가 없어도 질문 카드와 음성 인식으로 모든 내용을 할 수 있어요. ',
        'Gemini API는 만 18세 이상 이용 조건이라, 자유 대화는 보호자 폰에서 함께 하세요.'
      ),
      h(
        'li',
        null,
        h('b', null, '마이크: '),
        '말하기 연습과 말로 여는 잠금에 휴대폰의 음성 인식을 써요(키 불필요). 인식이 안 되면 글로 써도 돼요.'
      )
    )
  );
}

function logCard() {
  const list = getGameLog();
  if (!list.length) return null;
  return h(
    'div',
    { class: 'card stack' },
    h('div', { class: 'card-title' }, icon('award'), '끝낸 미션'),
    h(
      'ul',
      { class: 'history' },
      list
        .slice(0, 8)
        .map((x) =>
          h(
            'li',
            { class: 'gm-logrow' },
            h('span', null, new Date(x.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })),
            h('span', null, (x.players || []).map((p) => avatarOf(p.avatar).emoji).join('')),
            h('span', { class: 'gm-logstars' }, '★'.repeat(x.stars || 1)),
            h(
              'small',
              null,
              `범인 ${suspectOf(x.culprit)?.ko ?? '?'} · ${clockText(x.ms || 0)} · 영어 ${x.said || 0}번`
            )
          )
        )
    )
  );
}

/* ---------- 팀 만들기 ---------- */

function renderSetup() {
  const prefs = getGamePrefs();
  // 지난번 팀(얼굴·수준)을 기억해 둔다
  let team = (prefs.team || [])
    .filter((p) => AVATARS.some((a) => a.id === p.avatar) && LEVELS.includes(p.level))
    .slice(0, MAX_PLAYERS);
  const list = h('div', { class: 'stack gm-players' });
  const grid = h('div', { class: 'gm-avatars' });
  const startBtn = btn('팀 만들기', () => create(), { cls: 'btn primary big', ico: 'check' });

  const draw = () => {
    clear(grid);
    for (const a of AVATARS) {
      const on = team.some((p) => p.avatar === a.id);
      grid.append(
        h(
          'button',
          {
            type: 'button',
            class: `gm-avatar${on ? ' on' : ''}`,
            'aria-pressed': String(on),
            onclick: () => {
              if (on) team = team.filter((p) => p.avatar !== a.id);
              else if (team.length >= MAX_PLAYERS) return toast('최대 4명까지 함께할 수 있어요.');
              else team.push({ avatar: a.id, level: 'im1' });
              draw();
            },
          },
          h('span', { class: 'gm-emoji big' }, a.emoji),
          h('span', null, a.name)
        )
      );
    }
    clear(list);
    const roles = team.length ? assignRoles(team.map((p) => p.level)) : null;
    team.forEach((p, i) => {
      const a = avatarOf(p.avatar);
      list.append(
        h(
          'div',
          { class: 'gm-player' },
          h(
            'div',
            { class: 'row between' },
            h('b', null, h('span', { class: 'gm-emoji' }, a.emoji), ` ${a.name}`),
            h(
              'span',
              { class: 'hint' },
              `${ROLES[roles.roles[i]].emoji} ${ROLES[roles.roles[i]].name}${team.length > 1 && i === roles.buddy ? ' (힌트 담당)' : ''}`
            )
          ),
          segmented(
            LEVELS.map((lv) => ({ value: lv, label: LEVEL_INFO[lv].label })),
            p.level,
            (v) => {
              p.level = v;
              draw();
            },
            { label: `${a.name}의 수준` }
          ),
          h('span', { class: 'hint' }, LEVEL_INFO[p.level].grade)
        )
      );
    });
    if (!team.length) list.append(h('p', { class: 'hint' }, '위에서 함께할 사람의 얼굴을 눌러 주세요 (1~4명).'));
    startBtn.disabled = !team.length;
  };

  function create() {
    const old = getGameSave();
    if (
      old &&
      old.stage !== 'done' &&
      !window.confirm?.('이 폰에 하던 미션이 있어요. 새 미션을 만들면 지난 진행은 지워져요. 만들까요?')
    )
      return;
    updateGamePrefs({ team });
    const code = encodeTeam({ seed: newSeed(), players: team });
    renderCode(code, { fresh: true });
  }

  draw();
  show_(
    h(
      'div',
      { class: 'card stack' },
      h('div', { class: 'card-title' }, icon('plus'), '누가 함께하나요? (1~4명)'),
      grid,
      list,
      h(
        'p',
        { class: 'hint' },
        '수준에 따라 같은 문제도 영어와 생각할 거리가 달라져요. 가장 낮은 수준인 사람이 "핍의 짝꿍"이 되어 힌트를 맡아요.'
      ),
      startBtn,
      btn('처음으로', () => renderHome(), { cls: 'btn ghost', ico: 'back' })
    )
  );
}

/* ---------- 팀 코드 · 이 폰으로 할 사람 ---------- */

function shareCode(code) {
  const url = `${location.origin}${location.pathname}#/game?join=${code}`;
  const text = `${TITLE.ko} 팀 코드: ${formatCode(code)}\n${url}`;
  shareText(text, TITLE.en).then((ok) => {
    if (!ok)
      copyText(text).then((c) => toast(c ? '코드를 복사했어요. 카카오톡 등에 붙여 넣으세요.' : '공유하지 못했어요'));
  });
}

/** @param {{fresh?: boolean, joined?: boolean, local?: number[]}} o */
function renderCode(code, { fresh = false, joined = false, local } = {}) {
  const team = decodeTeam(code);
  const pick = new Set(local ?? (joined ? [] : team.players.map((_, i) => i)));
  const chips = h('div', { class: 'chips gm-localpick' });
  const startBtn = btn('미션 시작', () => go(), { cls: 'btn primary big', ico: 'play' });
  const draw = () => {
    clear(chips);
    team.players.forEach((p, i) => {
      const on = pick.has(i);
      chips.append(
        h(
          'button',
          {
            type: 'button',
            class: `chip${on ? ' on' : ''}`,
            'aria-pressed': String(on),
            onclick: () => {
              if (on) pick.delete(i);
              else pick.add(i);
              draw();
            },
          },
          avatarOf(p.avatar).emoji,
          ` ${avatarOf(p.avatar).name} · ${LEVEL_INFO[p.level].label}`
        )
      );
    });
    startBtn.disabled = pick.size === 0;
  };
  function go() {
    primeSpeech();
    const old = getGameSave();
    const save =
      old && old.code === code && !fresh ? { ...old, local: [...pick].sort() } : newSave(code, [...pick].sort());
    setGameSave(save);
    start(save);
  }
  draw();
  show_(
    h(
      'div',
      { class: 'card stack center gm-codecard' },
      h('div', { class: 'card-title' }, icon('zap'), joined ? '팀에 참가했어요' : '팀 코드'),
      h('div', { class: 'gm-code' }, formatCode(code)),
      joined
        ? null
        : h(
            'div',
            { class: 'row wrap center-row' },
            btn('공유', () => shareCode(code), { cls: 'btn small', ico: 'share' }),
            btn('복사', () => copyText(formatCode(code)).then((ok) => toast(ok ? '복사했어요' : '복사하지 못했어요')), {
              cls: 'btn small',
              ico: 'copy',
            })
          ),
      joined
        ? null
        : h(
            'p',
            { class: 'hint' },
            '다른 폰: English Helper → 게임 탭 → "팀 코드로 참가하기" → 이 코드 입력 (또는 공유한 링크 열기). 폰이 한 대면 그냥 시작하세요.'
          ),
      h('div', { class: 'gm-faces' }, team.players.map(face))
    ),
    h(
      'div',
      { class: 'card stack' },
      h('b', null, '이 폰으로 하는 사람을 모두 골라요'),
      chips,
      h(
        'p',
        { class: 'hint' },
        '다른 폰으로 하는 사람은 빼 주세요. 모든 사람이 어느 한 폰에는 꼭 있어야 해요. 게임 중에도 메뉴에서 바꿀 수 있어요.'
      ),
      startBtn,
      btn('처음으로', () => renderHome(), { cls: 'btn ghost', ico: 'back' })
    )
  );
}

/* ---------- 참가 ---------- */

function renderJoin(prefill = '') {
  const input = h('input', {
    type: 'text',
    class: 'gm-codeinput',
    value: formatCode(prefill),
    placeholder: 'ABCD-EFGH',
    maxlength: 12,
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    'aria-label': '팀 코드',
    oninput: (e) => {
      const v = normalizeCode(e.currentTarget.value);
      if (v.length === 8) e.currentTarget.value = formatCode(v);
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') check();
    },
  });
  const msg = h('p', { class: 'error-text', 'aria-live': 'polite' });
  function check() {
    try {
      const code = normalizeCode(input.value);
      decodeTeam(code);
      const old = getGameSave();
      renderCode(code, { joined: true, local: old?.code === code ? old.local : undefined });
    } catch (e) {
      msg.textContent = e.message;
    }
  }
  show_(
    h(
      'div',
      { class: 'card stack' },
      h('div', { class: 'card-title' }, icon('zap'), '팀 코드로 참가하기'),
      h('p', { class: 'hint' }, '미션을 만든 폰에 나온 8글자 코드를 넣어요.'),
      input,
      msg,
      btn('확인', check, { cls: 'btn primary big', ico: 'check' }),
      btn('처음으로', () => renderHome(), { cls: 'btn ghost', ico: 'back' })
    )
  );
  if (prefill) check();
}

/* ---------- 게임 열기 ---------- */

function start(save) {
  ctl?.close();
  ctl = openGame(body.parentElement || body, save, {
    onExit: () => {
      ctl = null;
      renderHome();
    },
    onNewMission: () => {
      const team = decodeTeam(save.code);
      const code = encodeTeam({ seed: newSeed(), players: team.players });
      renderCode(code, { fresh: true, local: save.local });
      toast('새 팀 코드예요. 다른 폰도 이 코드로 다시 참가해야 해요.', { ms: 4500 });
    },
  });
}

export function init(root) {
  body = h('div', { class: 'stack gm-view' });
  root.append(body, defs());
  renderHome();
}

export function show(params) {
  const join = normalizeCode(params?.get?.('join') || '');
  if (join && join !== pendingJoin) {
    pendingJoin = join;
    ctl?.close();
    renderJoin(join);
    return;
  }
  if (!ctl) renderHome();
}

export function hide() {
  ctl?.close(); // 진행은 저장돼 있다: 돌아오면 이어하기
}

/** 테스트용 */
export function state() {
  return { playing: Boolean(ctl), save: getGameSave() };
}
