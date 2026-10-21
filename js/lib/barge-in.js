// 말로 끊기 판단 (순수 함수, 단위 테스트 대상): 이어폰 없이 스피커로 대화해도 튜터 말을 목소리로 끊을 수 있게 한다.
// 튜터 목소리가 나오는 동안에는 마이크 소리를 붙잡아 두고, 그 소리가 "튜터 목소리의 메아리"보다 확실히 크고
// 잠깐 이어질 때만(= 내 목소리) 직전 소리와 함께 서버로 보낸다. 메아리가 얼마나 들어오는지(k)는
// 학습자가 조용히 있던 튜터 차례(첫인사 등)에서 배운다. 에코 제거(브라우저·휴대폰)가 켜져 있어야 메아리가 작다
// (안드로이드 "미디어 음량으로 듣기"는 에코 제거를 끄므로 스피커 소리가 크면 메아리가 커서 덜 민감하다).

import { peakLevel } from './live-protocol.js';

export const FLOOR_X = 3; // 주변 소음의 3배(약 10dB) 이상이어야 말소리로 본다
export const VOICE_MIN = 0.04; // 그리고 이 크기 이상 (마이크 최대 크기 0~1. 자동 음량이 켜진 보통 말소리는 0.1~0.5)
export const ECHO_MARGIN = 3; // 예상 메아리(k × 튜터 소리 크기)의 이 배수 이상이어야 내 목소리로 본다
export const SUSTAIN_MS = 200; // 큰 소리가 이만큼 이어져야 연다 (딸깍 소리·메아리가 잠깐 튀는 것은 무시)
export const HOLD_MS = 1300; // 마지막 큰 소리 뒤 이만큼은 계속 보낸다 (말 사이 쉼, 서버가 말 끝을 알아채는 0.9초 포함)
export const PREROLL_MS = 300; // 열릴 때 붙잡아 둔 직전 소리를 이만큼 함께 보낸다 (말 첫머리가 잘리지 않게)
export const FAR_MIN = 0.05; // 튜터 소리가 이보다 클 때만 메아리 비율을 잰다
export const LEARN_MIN_MS = 500; // 한 차례에서 이만큼 재야 메아리 비율을 배운다
export const K_QUANTILE = 0.9; // 메아리 비율은 차례마다 상위 10% 값으로 (메아리가 가끔 커져도 열리지 않게)
export const K_MEDIAN_X = 3; // 단, 그 차례 가운데값의 3배를 넘지 않게 (학습자 목소리가 조금 섞인 차례에 끌려 올라가지 않게)
export const K_RISE_MAX = 1.5; // 한 차례에 메아리 비율을 이 배수까지만 올린다
export const CONFIRM_MS = 3000; // 연 뒤 이만큼 안에 내 말 받아쓰기가 없으면 잘못 연 것으로 센다
export const MISS_RAISE = 1.5; // 잘못 열 때마다 ECHO_MARGIN을 이만큼 곱해 더 깐깐하게
export const MAX_MISSES = 3; // 한 대화에서 이만큼 잘못 열면 그 대화는 버튼으로만 끊는다
export const ECHO_SIMILAR = 0.7; // 받아쓰기가 튜터의 최근 말을 이 비율 이상 되풀이하면 메아리로 본다 (내 대답이 튜터 말을 조금 따라 해도 괜찮게)
export const ECHO_WORDS = 3; // 받아쓰기가 이만큼 모여야 판정한다 (한두 낱말로는 내 말인지 메아리인지 알 수 없다)
export const FLOOR_MS = 5000; // 주변 소음은 튜터가 조용한 최근 5초에서
export const FLOOR_Q = 0.1; // 하위 10% 크기로 잡는다 (말하는 중에도 낱말 사이 쉼으로 잡힘)
export const FLOOR_START = 0.005; // 아직 잰 적이 없을 때의 주변 소음
export const ECHO_BEFORE_S = 0.3; // 메아리 기준: 지금보다 0.3초 전부터
export const ECHO_AFTER_S = 0.06; // 0.06초 뒤까지 나오는 튜터 소리의 가장 큰 크기 (출력·입력 지연을 덮는다)

const HANGUL = /\p{Script=Hangul}/u;
// 줄임말은 풀어서 견준다 (튜터 받아쓰기는 "what's", 내 받아쓰기는 "what is"일 수 있다)
const CONTRACTIONS = [
  [/n't\b/g, ' not'],
  [/'re\b/g, ' are'],
  [/'m\b/g, ' am'],
  [/'ll\b/g, ' will'],
  [/'ve\b/g, ' have'],
  [/'d\b/g, ' would'],
  [/'s\b/g, ' is'],
];

/** 영어 받아쓰기 → 비교용 낱말 목록 (소문자, 문장 부호 제거, 줄임말 풀기) */
export function words(text) {
  let t = String(text || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'");
  for (const [re, full] of CONTRACTIONS) t = t.replace(re, full);
  return t.match(/[a-z0-9']+/g) || [];
}

/**
 * 학습자 받아쓰기가 튜터의 최근 말을 얼마나 되풀이하는지 (0~1): 이어진 두 낱말이 튜터 말에도 있는 비율.
 * (스피커 소리가 마이크로 들어가 튜터 말이 내 말로 받아써진 경우를 가린다. 낱말 하나뿐이면 그 낱말이 있는지로 본다)
 */
export function echoSimilarity(heard, said) {
  return similarity(words(heard), words(said));
}

function similarity(h, s) {
  if (!h.length || !s.length) return 0;
  if (h.length === 1) return s.includes(h[0]) ? 1 : 0;
  const pairs = new Set();
  for (let i = 1; i < s.length; i++) pairs.add(`${s[i - 1]} ${s[i]}`);
  let hit = 0;
  for (let i = 1; i < h.length; i++) if (pairs.has(`${h[i - 1]} ${h[i]}`)) hit++;
  return hit / (h.length - 1);
}

/** 수 목록의 q 분위수 (q: 0~1). 빈 목록이면 0 */
export function quantile(values, q) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/**
 * 튜터 목소리를 재생 시각(초, AudioContext 시간)별 크기로 기록한다. 마이크에 섞여 들어올 메아리 크기를 어림하는 데 쓴다.
 * @param {number} blockSec 기록 단위 (0.02 = 20ms)
 */
export function createFarTrack(blockSec = 0.02) {
  let blocks = []; // [{t: 시작 시각, peak: 0~1}]
  return {
    /** start 시각부터 재생하도록 예약한 16비트 PCM */
    add(start, samples, rate) {
      const step = Math.max(1, Math.round(rate * blockSec));
      for (let i = 0; i < samples.length; i += step) {
        blocks.push({ t: start + i / rate, peak: peakLevel(samples.subarray(i, i + step)) });
      }
    },
    /** from~to 사이에 걸친 소리의 가장 큰 크기 (0~1) */
    level(from, to) {
      let max = 0;
      for (const b of blocks) if (b.t <= to && b.t + blockSec > from) max = Math.max(max, b.peak);
      return max;
    },
    /** at 시각부터 예약했던 소리를 지운다 (재생을 멈춤). 이미 나온 소리의 메아리는 잠시 남으므로 그 앞은 둔다 */
    cut(at) {
      blocks = blocks.filter((b) => b.t < at);
    },
    /** before 시각 전에 끝난 기록을 버린다 */
    prune(before) {
      if (blocks.length && blocks[0].t + blockSec < before) blocks = blocks.filter((b) => b.t + blockSec >= before);
    },
    get size() {
      return blocks.length;
    },
  };
}

/**
 * 튜터가 말하는 동안 마이크 조각을 보낼지 정하는 문. 마이크 조각(40ms)마다 push를 부른다.
 * 튜터 소리가 안 들릴 때는 모두 그대로 보내고(주변 소음을 잰다), 들릴 때는 내 목소리로 보일 때만 연다.
 * @param {{frameMs?: number, enabled?: boolean}} o enabled: 설정의 "말로 끊기" (끄면 튜터가 말하는 동안 보내지 않음)
 */
export function createEchoGate({ frameMs = 40, enabled = true } = {}) {
  let k = null; // 메아리 비율: 학습자가 조용할 때 마이크 크기 ÷ 튜터 소리 크기. 배우기 전(null)에는 열지 않는다
  let margin = ECHO_MARGIN;
  let misses = 0;
  let buttonOnly = false; // 잘못 연 일이 잦아 이번 대화에서는 버튼으로만 끊는다
  let open = false;
  let run = 0; // 큰 소리가 이어진 시간(ms)
  let lastLoud = 0;
  let held = []; // 튜터가 말하는 동안 붙잡아 둔 직전 조각
  let episode = null; // 연 뒤 받아쓰기로 확인하는 중 {at, text}
  let audibleBefore = false;
  let ratios = []; // 이번 튜터 차례의 메아리 비율
  let spoiled = false; // 이번 차례에 학습자가 끼어듦 → 배우지 않는다
  let frozen = false; // 버튼으로 끊은 뒤 남은 소리(바로 말하기 시작한 내 목소리일 수 있음): 재지 않는다
  const floorLevels = [];
  let floor = FLOOR_START;
  let floorDirty = false;
  const heldMax = Math.max(1, Math.round(PREROLL_MS / frameMs));
  const floorMax = Math.round(FLOOR_MS / frameMs);
  const ratioMax = Math.round(60000 / frameMs);

  const active = () => enabled && !buttonOnly && k != null;

  function noiseFloor() {
    if (floorDirty) {
      floor = floorLevels.length ? quantile(floorLevels, FLOOR_Q) : FLOOR_START;
      floorDirty = false;
    }
    return floor;
  }

  function threshold(far) {
    return Math.max(FLOOR_X * noiseFloor(), VOICE_MIN, margin * (k ?? 0) * far);
  }

  /** 튜터 차례가 끝남: 학습자가 조용했던 차례면 메아리 비율을 고친다 (올릴 때는 빨리, 내릴 때는 천천히) */
  function learn() {
    if (!spoiled && ratios.length >= LEARN_MIN_MS / frameMs) {
      const t = Math.min(quantile(ratios, K_QUANTILE), K_MEDIAN_X * quantile(ratios, 0.5));
      k = k == null ? t : t > k ? Math.min((k + t) / 2, k * K_RISE_MAX) : k * 0.75 + t * 0.25;
    }
    ratios = [];
    spoiled = false;
  }

  /** 조각 하나를 잰다: 튜터가 조용하면 주변 소음, 말하면 메아리 비율. 튜터 차례가 끝나는 때 배운다 */
  function measure(level, far, audible) {
    if (audible !== audibleBefore) {
      audibleBefore = audible;
      if (audible || frozen) {
        ratios = [];
        spoiled = frozen = false;
      } else learn();
    }
    if (!audible) {
      floorLevels.push(level);
      if (floorLevels.length > floorMax) floorLevels.shift();
      floorDirty = true;
    } else if (far >= FAR_MIN && !open && !frozen && ratios.length < ratioMax) {
      ratios.push(level / far);
    }
  }

  function close() {
    open = false;
    run = 0;
    held = [];
  }

  /** 잘못 열었다: 더 깐깐하게 하고, 잦으면 이번 대화는 버튼으로만 끊는다. 'off'면 방금 버튼 전용으로 바뀜 */
  function miss() {
    episode = null;
    close();
    margin *= MISS_RAISE;
    misses++;
    if (misses >= MAX_MISSES && !buttonOnly) {
      buttonOnly = true;
      return 'off';
    }
    return 'miss';
  }

  return {
    get open() {
      return open;
    },
    get k() {
      return k;
    },
    get margin() {
      return margin;
    },
    get misses() {
      return misses;
    },
    get buttonOnly() {
      return buttonOnly;
    },
    get enabled() {
      return enabled;
    },
    /** 지금 튜터 말 중에 내 목소리로 열 수 있음 (켜져 있고, 버튼 전용이 아니고, 메아리 크기를 배움) */
    get active() {
      return active();
    },
    /** 설정을 켜면 이번 대화의 버튼 전용 상태도 풀린다 (깐깐해진 정도는 그대로) */
    set enabled(v) {
      if (v && !enabled) {
        buttonOnly = false;
        misses = 0;
      }
      enabled = v;
      if (!v) {
        episode = null;
        close();
      }
    },
    /** 보낼 수 없을 때(연결 중·첫인사 중)의 조각: 소음·메아리 크기만 잰다 */
    observe(level, { far = 0, audible }) {
      measure(level, audible ? far : 0, audible);
    },
    /**
     * 마이크 조각 하나. 지금 보낼 조각들을 돌려준다 (막 열렸으면 붙잡아 둔 직전 조각부터).
     * @param {{level: number, far?: number, audible: boolean, now: number}} o level: 이 조각의 크기,
     *   far: 지금 앞뒤로 나오는 튜터 소리의 크기, audible: 튜터 소리가 나오는 중(끝난 뒤 잠깐 포함), now: ms
     */
    push(pcm, { level, far = 0, audible, now }) {
      measure(level, audible ? far : 0, audible);
      const loud = level >= threshold(audible ? far : 0);
      if (open) {
        if (loud) lastLoud = now;
        else if (now - lastLoud > HOLD_MS) close();
      }
      if (!audible) {
        held = [];
        run = 0;
        return [pcm];
      }
      if (open) return [pcm];
      if (!active()) {
        held = [];
        run = 0;
        return [];
      }
      held.push(pcm);
      if (held.length > heldMax) held.shift();
      run = loud ? run + frameMs : 0;
      if (run < SUSTAIN_MS) return [];
      const out = held;
      close();
      open = true;
      lastLoud = now;
      spoiled = true;
      episode ??= { at: now, text: '' };
      return out;
    },
    /**
     * 연 뒤 CONFIRM_MS 안에 받아쓰기가 없었으면 잘못 연 것으로 센다: 'miss'|'off'|null.
     * 받아쓰기가 조금이라도 왔으면(짧은 대답 "Okay." 등) 서버가 말소리를 들은 것이므로 판정하지 않고 넘어간다
     */
    timeout(now) {
      if (!episode || now - episode.at < CONFIRM_MS) return null;
      const h = words(episode.text);
      // 두 낱말 넘게 왔는데 모두 튜터 말 그대로면 메아리 (한 낱말뿐인 "Okay." 같은 대답은 세지 않는다)
      if (h.length && !(h.length >= 2 && similarity(h, words(episode.said)) === 1)) {
        episode = null;
        return null;
      }
      return miss();
    },
    /**
     * 학습자 받아쓰기 조각. 연 뒤 확인하는 중이면 판정한다.
     * @returns {'real'|'wait'|'miss'|'off'|null} real: 내 목소리 / miss·off: 튜터 말의 메아리였음 / null: 확인할 것 없음
     */
    heard(text, said) {
      if (!episode) return null;
      episode.text += text;
      episode.said = said;
      // 튜터는 영어로만 말하므로 한글이 받아써졌으면 메아리일 수 없다 (한국어로 끼어든 질문)
      if (HANGUL.test(text)) {
        episode = null;
        return 'real';
      }
      let h = words(episode.text);
      if (h.length < ECHO_WORDS) return 'wait';
      // 첫 낱말은 직전 소리를 붙여 보내느라 중간부터 잘렸을 수 있어 넉넉할 때는 빼고 견준다
      if (h.length > ECHO_WORDS) h = h.slice(1);
      if (similarity(h, words(said)) < ECHO_SIMILAR) {
        episode = null;
        return 'real';
      }
      return miss();
    },
    /** 이번 튜터 차례에 학습자가 끼어듦: 이 차례로는 배우지 않는다 */
    spoil() {
      if (audibleBefore) spoiled = true;
    },
    /** 튜터 말을 버튼으로 끊음: 지금까지 잰 것으로 배우고, 끊긴 뒤 남은 소리(곧바로 말한 내 목소리일 수 있음)는 재지 않는다 */
    endTurn() {
      if (!audibleBefore || frozen) return;
      learn();
      frozen = true;
    },
    /** 새 연결·일시정지: 열린 문과 붙잡아 둔 소리, 확인 중인 일을 버린다 (배운 값은 둔다) */
    reset() {
      episode = null;
      close();
    },
    /**
     * 마이크가 바뀜 (에코 제거를 켜거나 끔): 메아리가 들어오는 크기가 크게 달라지므로 배운 메아리 비율을 버리고
     * 깐깐해진 정도·잘못 연 횟수·버튼 전용도 처음으로 돌린다. 다음에 학습자가 조용히 들은 튜터 차례에서 다시 배우며
     * (그때까지는 버튼으로만 끊는다), 바뀌기 전후가 섞인 지금 차례로는 배우지 않는다. 주변 소음은 계속 잰 값을 쓴다
     */
    forget() {
      k = null;
      margin = ECHO_MARGIN;
      misses = 0;
      buttonOnly = false;
      ratios = [];
      if (audibleBefore) spoiled = true;
      episode = null;
      close();
    },
  };
}
