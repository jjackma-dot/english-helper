// 발음 듣기(음성 합성)와 음성 인식(Web Speech API)

import { getSettings } from './store.js';
import { browserHint, inAppBrowser, isIOS, toast } from './ui.js';

/* ---------- 음성 합성 (TTS) ---------- */

const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let voices = [];
let primed = false;
const SPEAK_WAIT_MS = 2000; // 읽기가 이만큼 시작하지 않고 읽을 것도 없으면 버려진 것으로 본다
// 애플(맥 Safari)의 장난감·옛 합성 목소리 (발음 연습에 맞지 않는다). 'Eddy (영어(미국))'처럼 이름 뒤에 언어가 붙기도 한다
const NOVELTY_VOICE =
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Fred|Junior|Kathy|Ralph)( \(|$)/;

function loadVoices() {
  voices = synth ? synth.getVoices() : [];
}
if (synth) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
}

export const ttsSupported = Boolean(synth);

/** lang으로 시작하는 음성 목록 (예: 'en' → en-US, en-GB …) */
export function getVoices(langPrefix = 'en') {
  if (!voices.length) loadVoices();
  return voices.filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(langPrefix.toLowerCase()));
}

function pickVoice(lang) {
  const list = getVoices(lang.slice(0, 2));
  if (!list.length) return null;
  const { voiceURI } = getSettings();
  if (lang.startsWith('en') && voiceURI) {
    const chosen = list.find((v) => v.voiceURI === voiceURI);
    if (chosen) return chosen;
  }
  // 아이폰은 목소리를 정하지 않고 언어(u.lang)만 넘긴다: 그러면 기기 설정(손쉬운 사용 → 읽기 및 말하기)의
  // 그 언어 기본 목소리로 읽는다. 목록의 default는 아이폰에서 모든 목소리가 true라 쓸 수 없다
  if (isIOS) return null;
  const norm = (v) => v.lang.replace('_', '-').toLowerCase();
  const usable = list.filter((v) => !NOVELTY_VOICE.test(v.name || ''));
  const pool = usable.length ? usable : list;
  return (
    pool.find((v) => norm(v) === lang.toLowerCase() && v.localService) ||
    pool.find((v) => norm(v) === lang.toLowerCase()) ||
    pool[0]
  );
}

/**
 * 아이폰은 사용자가 누른 처리 밖의 읽기를 아무 알림 없이 버린다 (누른 처리 안에서 한 번 읽으면 풀림).
 * 버튼 처리의 맨 앞에서 불러 소리 없이 한 번 읽어 둔다. 아이폰이 아니거나 이미 했으면 아무것도 하지 않는다
 */
export function primeSpeech() {
  if (!isIOS || !synth || primed) return;
  if (navigator.userActivation && !navigator.userActivation.isActive) return; // 누른 처리 밖이면 깨워지지 않는다
  primed = true;
  if (synth.speaking || synth.pending) return; // 읽는 중이면 이미 풀려 있다 (끊지 않는다)
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u); // 제한은 speak() 안에서 풀린다
    // 바로 지워 읽는 중으로 남지 않게 한다: 빈 읽기가 끝 알림을 안 보내면 speaking이 계속 true라
    // OTT 듣기가 소리를 버리고, 곧이어 시작하는 음성 인식도 읽기 소리 때문에 멈출 수 있다
    synth.cancel();
  } catch {
    /* 무시 */
  }
}

/**
 * 텍스트 읽기. 끝나면 resolve.
 * @param {string} text
 * @param {{lang?: string, rate?: number}} [opts] lang 기본 'en-US'
 */
export function speak(text, { lang = 'en-US', rate } = {}) {
  if (!synth) {
    toast('이 기기는 음성 읽기를 지원하지 않습니다.');
    return Promise.resolve();
  }
  const s = String(text || '').trim();
  if (!s) return Promise.resolve();
  synth.cancel();
  const u = new SpeechSynthesisUtterance(s);
  u.lang = lang;
  u.rate = rate ?? (lang.startsWith('en') ? getSettings().ttsRate : 1);
  const v = pickVoice(lang);
  if (v) u.voice = v;
  return new Promise((resolve) => {
    let started = false;
    let timer = 0;
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    // 버려진 읽기(아이폰)는 아무 알림이 없다: 시작하지 않았고 읽는 중·기다리는 읽기도 없으면 끝난 것으로 본다.
    // 엔진이 늦게 켜지는 동안(안드로이드)은 이 읽기가 대기열에 있어 speaking이 true라 기다린다
    const check = () => {
      if (started) return;
      if (!synth.speaking && !synth.pending) done();
      else timer = setTimeout(check, 1000);
    };
    u.onstart = () => {
      started = true;
      clearTimeout(timer);
    };
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
    if (isIOS) timer = setTimeout(check, SPEAK_WAIT_MS);
  });
}

export function stopSpeaking() {
  synth?.cancel();
}

/** 사전 음성 파일 재생. 실패하면 TTS로 대신 읽는다 */
export async function playAudio(url, fallbackText) {
  if (fallbackText) primeSpeech(); // 아이폰: 재생이 실패한 뒤(누른 처리 밖)에도 대신 읽을 수 있게
  try {
    const audio = new Audio(url);
    await audio.play();
  } catch {
    if (fallbackText) speak(fallbackText);
  }
}

/* ---------- 음성 인식 (STT) ---------- */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = Boolean(SR);

const STT_ERRORS = {
  'not-allowed': isIOS
    ? '마이크나 음성 인식이 허용되지 않았습니다. Safari의 ⋯(또는 aA) 메뉴 → 웹 사이트 설정 → 마이크, 또는 설정 → 앱 → Safari → 마이크에서 허용하고, 설정 → 개인정보 보호 및 보안 → 음성 인식도 확인하세요.'
    : '마이크 권한이 거부되었습니다. 주소창의 자물쇠(또는 앱 정보) → 권한에서 마이크를 허용하세요.',
  'service-not-allowed': inAppBrowser
    ? `이 브라우저에서는 음성 인식을 쓸 수 없습니다. ${browserHint()}`
    : isIOS
      ? '음성 인식을 쓸 수 없습니다. 홈 화면 앱에서는 막힐 수 있으니 Safari에서 같은 주소를 여세요. Safari에서도 안 되면 Siri(설정 → Siri) 또는 받아쓰기(설정 → 일반 → 키보드)가 켜져 있는지, 스크린 타임으로 막혀 있지 않은지 확인하세요.'
      : '이 기기에서 음성 인식을 사용할 수 없습니다.',
  'audio-capture': '마이크를 찾을 수 없습니다.',
  network: '음성 인식 서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.',
  'language-not-supported': '이 언어의 음성 인식을 지원하지 않습니다.',
};
const RESTART_MS = 120; // 한 문장을 듣고 다시 듣기까지
const IOS_RETRY_MS = 1000; // 아이폰: 말소리 없이(또는 실패로) 끝난 뒤 다시 듣기까지 (마이크를 계속 껐다 켜지 않게)
const STALL_MS = 10000; // 아이폰: 시작한 인식기가 이만큼 아무 알림이 없으면 멈춘 것으로 본다

/**
 * 음성 인식기. stop()을 부를 때까지 발화가 끝날 때마다 자동으로 다시 듣는다.
 * (안드로이드 크롬은 continuous 모드에서 결과가 중복되는 문제가 있어 한 문장씩 끊어 듣는다)
 * @param {{lang: string, onInterim?: (t: string) => void, onFinal: (t: string) => void,
 *          onState?: (listening: boolean) => void, onError?: (msg: string, code: string) => void, repeat?: boolean}} o
 *   onError의 code: 'no-speech'(오래 조용해서 멈춤) 또는 인식기 오류 이름
 * @returns {{start: () => void, stop: () => void, abort: () => void, readonly active: boolean}}
 *   stop: 멈추되 마지막 결과는 받는다. abort: 바로 멈추고 남은 결과는 버린다 (기기 음성으로 읽기 직전에)
 */
export function createListener(o) {
  let rec = null;
  let active = false;
  let restartTimer = 0;
  let failures = 0;
  let silent = 0;

  /** 말소리 없이 끝난 차례. 조용한 상태로 계속 다시 듣는 것을 막는다 (약 30초) */
  function quietRound() {
    if (++silent >= 4 && active) {
      active = false;
      o.onError?.('한동안 말소리가 없어 듣기를 멈췄습니다.', 'no-speech');
    }
  }

  function restart(ms) {
    restartTimer = setTimeout(() => {
      if (active) safeStart();
    }, ms);
  }

  function startOnce() {
    const r = new SR();
    rec = r;
    r.lang = o.lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    const alive = () => clearTimeout(r.stallTimer); // 알림이 왔으면 멈춘 인식기가 아니다
    r.onspeechstart = alive;
    // 이전 인식기가 늦게 보내는 이벤트는 무시한다. stop() 뒤에 오는 마지막 결과(onresult)는 받고, abort() 뒤에는 버린다
    r.onresult = (e) => {
      alive();
      if (r !== rec || r.discarded) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const t = res[0].transcript.trim();
          if (t) o.onFinal(t);
          failures = 0;
          silent = 0;
          r.heard = true;
        } else interim += res[0].transcript;
      }
      o.onInterim?.(interim);
    };
    r.onerror = (e) => {
      alive();
      if (r !== rec || r.stoppedByUser) return;
      if (e.error === 'aborted') {
        // 아이폰은 말소리가 없거나 서버에 닿지 못해도 'aborted'(그 뒤 end)로만 알린다:
        // 말소리 없는 차례로 세고, 조금 쉬었다 다시 듣는다
        if (isIOS && !r.heard) {
          r.retryMs = IOS_RETRY_MS;
          quietRound();
        }
        return;
      }
      if (e.error === 'no-speech') return quietRound();
      failures++;
      if (STT_ERRORS[e.error] || failures >= 3) {
        active = false;
        o.onError?.(STT_ERRORS[e.error] || `음성 인식 오류: ${e.error}`, e.error);
      }
    };
    r.onend = () => {
      alive();
      if (r !== rec || r.stoppedByUser) return;
      o.onInterim?.('');
      if (active && o.repeat !== false) restart(r.retryMs || RESTART_MS);
      else {
        active = false;
        o.onState?.(false);
      }
    };
    r.start();
    if (isIOS) r.stallTimer = setTimeout(() => stalled(r), STALL_MS);
  }

  /**
   * 아이폰: 소리(읽기·발음 듣기)를 낸 뒤 시작한 인식기가 아무 알림 없이 멈춰 있기도 하다 (WebKit 버그 321436).
   * 그 인식기는 버리고 말소리 없는 차례로 센 뒤 새 인식기로 다시 듣는다
   */
  function stalled(r) {
    if (r !== rec || r.stoppedByUser) return;
    r.onspeechstart = r.onresult = r.onerror = r.onend = null;
    rec = null;
    try {
      r.abort();
    } catch {
      /* 이미 멈춤 */
    }
    o.onInterim?.('');
    quietRound();
    if (active) restart(RESTART_MS);
    else o.onState?.(false);
  }

  function safeStart() {
    try {
      startOnce();
    } catch (err) {
      active = false;
      o.onState?.(false);
      o.onError?.(`음성 인식을 시작할 수 없습니다: ${err.message}`);
    }
  }

  /** 듣기를 멈춘다. discard: 남은 결과를 버리고 바로 끊는다 (abort) */
  function halt(discard) {
    const wasActive = active;
    active = false;
    clearTimeout(restartTimer);
    const r = rec;
    if (r) {
      r.stoppedByUser = true;
      r.discarded = discard;
      clearTimeout(r.stallTimer);
    }
    try {
      if (discard) r?.abort();
      else r?.stop();
    } catch {
      /* 이미 멈춤 */
    }
    o.onInterim?.('');
    if (wasActive) o.onState?.(false);
  }

  return {
    start() {
      if (!SR) {
        o.onError?.(`이 브라우저는 음성 인식을 지원하지 않습니다. ${browserHint()}`);
        return;
      }
      if (active) return;
      active = true;
      failures = 0;
      silent = 0;
      o.onState?.(true);
      safeStart();
    },
    stop: () => halt(false),
    abort: () => halt(true),
    get active() {
      return active;
    },
  };
}

/** 한 번만 듣고 결과 문장을 돌려준다 (검색창 마이크 버튼용) */
export function listenOnce(lang) {
  return new Promise((resolve, reject) => {
    let result = '';
    const l = createListener({
      lang,
      repeat: false,
      onFinal: (t) => (result = t),
      onState: (on) => {
        if (!on) resolve(result);
      },
      onError: (msg) => reject(new Error(msg)),
    });
    l.start();
  });
}
