// 잠금 입력 장치: 색 누르기, 꽃 연주, 화살표(로봇 팔이 움직임), 숫자판, 다이얼, 슬라이더, 스위치, 고르기, 글자 타일, 시계, 전선, 말하기.
// 모두 { el, get(), ready(), reset() }를 돌려준다. 맞는지는 잠금 화면이 판단한다(logic.sameAnswer / voicePass).

import { h, clear } from '../ui.js';
import { icon } from '../icons.js';
import { COLORS, DIRS, FRUITS, PLANETS, SHAPES } from './puzzles.js';
import { flowerIcon, fruitIcon, gearIcon, planetIcon, shapeIcon } from './art.js';
import { sfx, playMelody } from './sfx.js';
import { s, svg } from './svg.js';
import { canListen, listenOnce } from './voice.js';

const hex = (c) => COLORS[c]?.hex ?? c;
const dot = (c, cls = 'gw-dot') => h('span', { class: cls, style: { background: hex(c) } });
const tool = (label, ico, onclick, cls = 'gw-tool') => h('button', { type: 'button', class: cls, onclick }, icon(ico, { size: 18 }), label ? h('span', null, label) : null);

/** 차례대로 누르는 장치의 공통 틀 (빈칸 + 버튼 + 지우기) */
function sequence(lock, { options, renderOption, renderSlot, onPress, extra, padCls = '' }) {
  const value = [];
  const slots = h('div', { class: 'gw-slots', 'aria-live': 'polite' });
  const draw = () => {
    clear(slots);
    for (let i = 0; i < lock.len; i++)
      slots.append(h('span', { class: `gw-slot${value[i] ? ' on' : ''}${i === value.length ? ' next' : ''}` }, value[i] ? renderSlot(value[i]) : String(i + 1)));
  };
  const api = {
    get: () => [...value],
    ready: () => value.length === lock.len,
    reset() {
      value.length = 0;
      draw();
      extra?.reset?.();
    },
  };
  const pad = h(
    'div',
    { class: `gw-pad ${padCls}` },
    options.map((o) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gw-opt',
          'data-value': o,
          onclick: () => {
            if (value.length >= lock.len) return;
            value.push(o);
            onPress ? onPress(o, value) : sfx.tap();
            draw();
          },
        },
        renderOption(o)
      )
    )
  );
  draw();
  api.el = h(
    'div',
    { class: 'gw gw-seq' },
    extra?.el,
    slots,
    pad,
    h(
      'div',
      { class: 'gw-row' },
      tool('하나 지우기', 'back', () => {
        value.pop();
        extra?.undo?.(value);
        draw();
      }),
      tool('모두 지우기', 'trash', () => api.reset())
    )
  );
  return api;
}

function colors(lock) {
  return sequence(lock, {
    options: lock.palette,
    renderOption: (c) => [dot(c, 'gw-swatch'), h('span', { class: 'gw-label', lang: 'en' }, COLORS[c].en)],
    renderSlot: (c) => dot(c),
  });
}

function melody(lock) {
  const api = sequence(lock, {
    options: lock.flowers,
    renderOption: (c) => [flowerIcon(c, 46), h('span', { class: 'gw-label', lang: 'en' }, COLORS[c].en)],
    renderSlot: (c) => dot(c),
    onPress: (c) => sfx.note(c),
    padCls: 'gw-flowers',
  });
  api.el.querySelector?.('.gw-row')?.prepend(tool('들어 보기', 'play', () => playMelody(api.get())));
  return api;
}

/** 로봇 팔 격자: 누른 화살표가 실제로 어느 쪽으로 움직이는지 보여 준다 (거울 모드면 반대로) */
function armGrid(lock) {
  const { cols, rows, start } = lock.grid;
  const cell = 34;
  const pos = [...start];
  const trail = [[...start]];
  const g = s('g');
  const draw = () => {
    while (g.firstChild) g.firstChild.remove();
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) g.append(s('rect', { x: x * cell + 2, y: y * cell + 2, width: cell - 4, height: cell - 4, rx: 6, fill: '#0f2d44', stroke: '#1c4a66' }));
    g.append(s('polyline', { points: trail.map(([x, y]) => `${x * cell + cell / 2},${y * cell + cell / 2}`).join(' '), fill: 'none', stroke: '#ffb020', 'stroke-width': 4, 'stroke-linecap': 'round' }));
    g.append(s('circle', { cx: pos[0] * cell + cell / 2, cy: pos[1] * cell + cell / 2, r: 11, fill: '#ffb020', stroke: '#ffffff', 'stroke-width': 3 }));
  };
  const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const move = (d) => {
    const real = lock.map?.[d] ?? d;
    const nx = pos[0] + STEP[real][0];
    const ny = pos[1] + STEP[real][1];
    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
      pos[0] = nx;
      pos[1] = ny;
      sfx.key();
    } else sfx.bad();
    trail.push([...pos]);
    draw();
  };
  draw();
  return {
    el: h('div', { class: 'gw-arm' }, svg(`0 0 ${cols * cell} ${rows * cell}`, { class: 'gw-armgrid', role: 'img', 'aria-label': 'robot arm map' }, g)),
    move,
    undo(value) {
      pos[0] = start[0];
      pos[1] = start[1];
      trail.length = 1;
      for (const d of value) move(d);
    },
    reset() {
      pos[0] = start[0];
      pos[1] = start[1];
      trail.length = 1;
      draw();
    },
  };
}

function arrows(lock) {
  const grid = armGrid(lock);
  return sequence(lock, {
    options: ['up', 'left', 'right', 'down'],
    renderOption: (d) => [h('span', { class: 'gw-arrow' }, DIRS[d].arrow), h('span', { class: 'gw-label', lang: 'en' }, DIRS[d].en)],
    renderSlot: (d) => DIRS[d].arrow,
    onPress: (d) => grid.move(d),
    extra: grid,
    padCls: 'gw-cross',
  });
}

function keypad(lock) {
  return sequence(lock, {
    options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    renderOption: (d) => d,
    renderSlot: (d) => d,
    onPress: () => sfx.key(),
    padCls: 'gw-keys',
  });
}

function dial(lock) {
  let v = lock.min ?? 0;
  const out = h('output', { class: 'gw-big' }, String(v));
  const set = (n) => {
    v = Math.min(lock.max ?? 99, Math.max(lock.min ?? 0, n));
    out.textContent = String(v);
    sfx.key();
  };
  return {
    el: h(
      'div',
      { class: 'gw gw-dial' },
      h('button', { type: 'button', class: 'gw-round', 'aria-label': '줄이기', onclick: () => set(v - 1) }, icon('minus', { size: 28 })),
      out,
      h('button', { type: 'button', class: 'gw-round', 'aria-label': '늘리기', onclick: () => set(v + 1) }, icon('plus', { size: 28 }))
    ),
    get: () => v,
    ready: () => true,
    reset: () => set(lock.min ?? 0),
  };
}

function sliders(lock) {
  const value = Array(lock.n).fill(null);
  const cols = [];
  const draw = () =>
    cols.forEach((col, i) => {
      for (const b of col.querySelectorAll('button')) {
        const lv = Number(b.dataset.value);
        b.classList.toggle('on', value[i] != null && lv <= value[i]);
        b.classList.toggle('top', lv === value[i]);
      }
    });
  for (let i = 0; i < lock.n; i++) {
    const btns = [];
    for (let lv = lock.max; lv >= lock.min; lv--)
      btns.push(
        h(
          'button',
          {
            type: 'button',
            'data-value': String(lv),
            dataset: { value: String(lv) },
            onclick: () => {
              value[i] = lv;
              sfx.key();
              draw();
            },
          },
          String(lv)
        )
      );
    const col = h('div', { class: 'gw-eq-col' }, btns, h('span', { class: 'gw-label', lang: 'en' }, `Camera ${i + 1}`));
    cols.push(col);
  }
  return {
    el: h('div', { class: 'gw gw-eq' }, cols),
    get: () => [...value],
    ready: () => value.every((x) => x != null),
    reset() {
      value.fill(null);
      draw();
    },
  };
}

function switches(lock) {
  const value = Array(lock.n).fill('up');
  const btns = value.map((_, i) =>
    h(
      'button',
      {
        type: 'button',
        class: 'gw-switch up',
        'aria-label': `switch ${i + 1}`,
        onclick: (e) => {
          value[i] = value[i] === 'up' ? 'down' : 'up';
          e.currentTarget.className = `gw-switch ${value[i]}`;
          e.currentTarget.querySelector('.gw-label').textContent = value[i];
          sfx.key();
        },
      },
      h('span', { class: 'gw-num' }, String(i + 1)),
      h('span', { class: 'gw-lever' }),
      h('span', { class: 'gw-label', lang: 'en' }, 'up')
    )
  );
  return {
    el: h('div', { class: 'gw gw-switches' }, btns),
    get: () => [...value],
    ready: () => true,
    reset() {
      value.fill('up');
      btns.forEach((b) => {
        b.className = 'gw-switch up';
        b.querySelector('.gw-label').textContent = 'up';
      });
    },
  };
}

const GEAR_CODE = { red: 'RE', blue: 'BL', green: 'GR' };
/** 고르기 항목의 그림·이름 */
function optionFace(kind, id, { pictures = true, words = true } = {}) {
  let pic = null;
  let word = '';
  if (kind === 'fruit') {
    pic = fruitIcon(id, 58);
    word = FRUITS[id].en;
  } else if (kind === 'planet') {
    pic = planetIcon(id, 58);
    word = PLANETS[id].en;
  } else if (kind === 'gear') {
    pic = gearIcon(id, { size: 58, gray: pictures === 'gray' });
    const [sz, col] = id.split('-');
    word = words === 'code' ? `${sz === 'big' ? 'L' : 'S'}-${GEAR_CODE[col]}` : `${sz} ${col}`;
  } else if (kind === 'shape') {
    pic = shapeIcon(id, 50);
    word = SHAPES[id].en;
  }
  return [pictures ? pic : null, words ? h('span', { class: 'gw-label', lang: 'en' }, word) : null];
}

function choice(lock, multi = false) {
  const kind = lock.widget === 'shape' ? 'shape' : lock.kind;
  const picked = [];
  const btns = lock.options.map((id) =>
    h(
      'button',
      {
        type: 'button',
        class: `gw-card${lock.pictures === false ? ' words' : ''}`,
        'aria-pressed': 'false',
        'data-value': id,
        onclick: () => {
          const i = picked.indexOf(id);
          if (i >= 0) picked.splice(i, 1);
          else {
            if (!multi) picked.length = 0;
            else if (picked.length >= lock.pick) picked.shift();
            picked.push(id);
          }
          sfx.tap();
          for (const b of btns) b.setAttribute('aria-pressed', String(picked.includes(b.getAttribute('data-value'))));
        },
      },
      optionFace(kind, id, { pictures: lock.pictures ?? true, words: lock.words ?? true })
    )
  );
  return {
    el: h('div', { class: `gw gw-cards gw-${kind}` }, btns),
    get: () => (multi ? [...picked] : picked[0] ?? null),
    ready: () => (multi ? picked.length === lock.pick : picked.length === 1),
    reset() {
      picked.length = 0;
      for (const b of btns) b.setAttribute('aria-pressed', 'false');
    },
  };
}

function word(lock) {
  let v = '';
  const out = h('output', { class: 'gw-word', lang: 'en' });
  const draw = () => {
    clear(out).append(v ? v : h('span', { class: 'gw-placeholder' }, '글자를 누르세요'));
  };
  const letters = lock.tiles || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const pad = h(
    'div',
    { class: `gw-pad gw-letters${lock.tiles ? ' few' : ''}` },
    letters.map((ch) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gw-opt',
          onclick: () => {
            if (v.length >= 14) return;
            v += ch;
            sfx.key();
            draw();
          },
        },
        ch
      )
    )
  );
  draw();
  return {
    el: h(
      'div',
      { class: 'gw gw-wordpad' },
      out,
      pad,
      h(
        'div',
        { class: 'gw-row' },
        tool('하나 지우기', 'back', () => {
          v = v.slice(0, -1);
          draw();
        }),
        tool('모두 지우기', 'trash', () => {
          v = '';
          draw();
        })
      )
    ),
    get: () => v,
    ready: () => v.length > 0,
    reset() {
      v = '';
      draw();
    },
  };
}

function clock(lock) {
  let hh = lock.h24 ? 0 : 12;
  let mm = 0;
  const out = h('output', { class: 'gw-big gw-time' });
  const draw = () => (out.textContent = `${hh}:${String(mm).padStart(2, '0')}`);
  const setH = (d) => {
    const lo = lock.h24 ? 0 : 1;
    const hi = lock.h24 ? 23 : 12;
    hh = hh + d > hi ? lo : hh + d < lo ? hi : hh + d;
    sfx.key();
    draw();
  };
  const minutes = [0, 15, 30, 45].map((m) =>
    h(
      'button',
      {
        type: 'button',
        class: 'gw-chip',
        'aria-pressed': String(m === mm),
        onclick: () => {
          mm = m;
          sfx.key();
          for (const b of minutes) b.setAttribute('aria-pressed', String(Number(b.textContent.slice(1)) === mm));
          draw();
        },
      },
      `:${String(m).padStart(2, '0')}`
    )
  );
  draw();
  return {
    el: h(
      'div',
      { class: 'gw gw-clock' },
      h(
        'div',
        { class: 'gw-dial' },
        h('button', { type: 'button', class: 'gw-round', 'aria-label': '한 시간 전', onclick: () => setH(-1) }, icon('minus', { size: 26 })),
        out,
        h('button', { type: 'button', class: 'gw-round', 'aria-label': '한 시간 뒤', onclick: () => setH(1) }, icon('plus', { size: 26 }))
      ),
      h('div', { class: 'gw-row center' }, minutes),
      h('p', { class: 'gw-note' }, lock.h24 ? '− + 로 시(0~23), 아래에서 분을 고르세요' : '− + 로 시(1~12), 아래에서 분을 고르세요')
    ),
    get: () => ({ h: hh, m: mm }),
    ready: () => true,
    reset() {
      hh = lock.h24 ? 0 : 12;
      mm = 0;
      draw();
    },
  };
}

function wires(lock) {
  const ys = [40, 100, 160];
  const value = {};
  let sel = null;
  const lines = s('g');
  const left = lock.left.map((c, i) =>
    s(
      'g',
      {
        class: 'gw-plug',
        onclick: () => {
          sel = c;
          sfx.tap();
          draw();
        },
      },
      s('rect', { x: 14, y: ys[i] - 20, width: 64, height: 40, rx: 10, fill: hex(c), stroke: '#ffffff', 'stroke-width': 3 }),
      s('text', { x: 46, y: ys[i] + 6, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: '#10131f', 'font-family': 'system-ui' }, COLORS[c].en)
    )
  );
  const right = lock.right.map((r, i) =>
    s(
      'g',
      {
        class: 'gw-plug',
        onclick: () => {
          if (!sel) return;
          for (const k of Object.keys(value)) if (value[k] === r.value) delete value[k];
          value[sel] = r.value;
          sel = null;
          sfx.key();
          draw();
        },
      },
      s('rect', { x: 236, y: ys[i] - 22, width: 74, height: 44, rx: 12, fill: '#e8f0ff', stroke: '#9fb0cc', 'stroke-width': 3 }),
      r.dots ? Array.from({ length: r.dots }, (_, k) => s('circle', { cx: 252 + k * 9, cy: ys[i] + 12, r: 3, fill: '#2a63b8' })) : null,
      s('text', { x: 273, y: ys[i] + (r.dots ? 2 : 7), 'text-anchor': 'middle', 'font-size': r.label.length > 3 ? 16 : 20, 'font-weight': 800, fill: '#2a63b8', 'font-family': 'system-ui' }, r.label)
    )
  );
  const draw = () => {
    while (lines.firstChild) lines.firstChild.remove();
    lock.left.forEach((c, i) => {
      const v = value[c];
      if (v == null) return;
      const j = lock.right.findIndex((r) => r.value === v);
      lines.append(s('path', { d: `M78 ${ys[i]}C160 ${ys[i]} 160 ${ys[j]} 236 ${ys[j]}`, fill: 'none', stroke: hex(c), 'stroke-width': 8, 'stroke-linecap': 'round' }));
    });
    left.forEach((gEl, i) => gEl.firstChild.setAttribute('stroke', sel === lock.left[i] ? '#ffd23f' : '#ffffff'));
    left.forEach((gEl, i) => gEl.firstChild.setAttribute('stroke-width', sel === lock.left[i] ? 6 : 3));
  };
  draw();
  return {
    el: h(
      'div',
      { class: 'gw gw-wires' },
      svg('0 0 320 200', { class: 'gw-wiresvg' }, s('rect', { x: 0, y: 0, width: 320, height: 200, rx: 16, fill: '#1d2440' }), lines, left, right),
      h('p', { class: 'gw-note' }, '왼쪽 전선을 누른 다음, 이을 번호를 누르세요')
    ),
    get: () => ({ ...value }),
    ready: () => Object.keys(value).length === lock.left.length,
    reset() {
      for (const k of Object.keys(value)) delete value[k];
      sel = null;
      draw();
    },
  };
}

/**
 * 말하기 입력 (음성 인식). 인식이 안 되는 기기나 두 번 실패하면 글로 쓸 수 있다
 * @param {{prompt?: Node|string, onHeard?: (text: string, mode: 'voice'|'typed') => void}} o
 */
export function voiceInput({ prompt, onHeard } = {}) {
  let text = '';
  let mode = 'voice';
  let fails = 0;
  let session = null;
  const shown = h('p', { class: 'gw-heard', lang: 'en' }, canListen ? '🎤를 누르고 영어로 말하세요' : '이 브라우저는 음성 인식이 안 돼요. 아래에 글로 쓰세요.');
  const typed = h('input', { type: 'text', class: 'gw-type', lang: 'en', placeholder: 'Type in English', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const typeRow = h(
    'div',
    { class: 'gw-row', hidden: canListen },
    typed,
    h(
      'button',
      {
        type: 'button',
        class: 'btn small primary',
        onclick: () => {
          text = typed.value.trim();
          mode = 'typed';
          if (text) onHeard?.(text, mode);
        },
      },
      '확인'
    )
  );
  const mic = h(
    'button',
    {
      type: 'button',
      class: 'gw-mic',
      hidden: !canListen,
      'aria-label': '말하기',
      onclick: async () => {
        if (session) {
          session.stop();
          return;
        }
        mic.classList.add('recording');
        shown.textContent = '듣는 중… (말을 마치면 잠시 기다려요)';
        session = listenOnce({ onInterim: (t) => (shown.textContent = t || '듣는 중…') });
        try {
          text = await session.promise;
        } catch (e) {
          text = '';
          shown.textContent = e.message;
        }
        session = null;
        mic.classList.remove('recording');
        if (!text) {
          fails++;
          if (!shown.textContent || shown.textContent.startsWith('듣는 중')) shown.textContent = '잘 안 들렸어요. 다시 눌러 말해 보세요.';
          if (fails >= 2) typeRow.hidden = false;
          return;
        }
        shown.textContent = `“${text}”`;
        mode = 'voice';
        onHeard?.(text, mode);
      },
    },
    icon('mic', { size: 34 })
  );
  return {
    el: h('div', { class: 'gw gw-voice' }, prompt ? h('div', { class: 'gw-say' }, prompt) : null, mic, shown, typeRow),
    get: () => ({ text, mode }),
    ready: () => Boolean(text),
    fail() {
      fails++;
      if (fails >= 2) typeRow.hidden = false;
    },
    reset() {
      text = '';
      typed.value = '';
    },
  };
}

export function createWidget(lock) {
  switch (lock.widget) {
    case 'colors':
      return colors(lock);
    case 'melody':
      return melody(lock);
    case 'arrows':
      return arrows(lock);
    case 'keypad':
      return keypad(lock);
    case 'dial':
      return dial(lock);
    case 'sliders':
      return sliders(lock);
    case 'switches':
      return switches(lock);
    case 'shape':
    case 'choice':
      return choice(lock);
    case 'multi':
      return choice(lock, true);
    case 'word':
      return word(lock);
    case 'clock':
      return clock(lock);
    case 'wires':
      return wires(lock);
    default:
      return null; // 'voice'는 잠금 화면이 voiceInput으로 만든다
  }
}
