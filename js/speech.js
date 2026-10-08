// 발음 듣기(음성 합성)와 음성 인식(Web Speech API)

import { getSettings } from './store.js';
import { toast } from './ui.js';

/* ---------- 음성 합성 (TTS) ---------- */

const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let voices = [];

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
  const norm = (v) => v.lang.replace('_', '-').toLowerCase();
  return (
    list.find((v) => norm(v) === lang.toLowerCase() && v.localService) ||
    list.find((v) => norm(v) === lang.toLowerCase()) ||
    list[0]
  );
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
    u.onend = resolve;
    u.onerror = resolve;
    synth.speak(u);
  });
}

export function stopSpeaking() {
  synth?.cancel();
}

/** 사전 음성 파일 재생. 실패하면 TTS로 대신 읽는다 */
export async function playAudio(url, fallbackText) {
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
  'not-allowed': '마이크 권한이 거부되었습니다. 주소창의 자물쇠(또는 앱 정보) → 권한에서 마이크를 허용하세요.',
  'service-not-allowed': '이 기기에서 음성 인식을 사용할 수 없습니다.',
  'audio-capture': '마이크를 찾을 수 없습니다.',
  network: '음성 인식 서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.',
  'language-not-supported': '이 언어의 음성 인식을 지원하지 않습니다.',
};

/**
 * 음성 인식기. stop()을 부를 때까지 발화가 끝날 때마다 자동으로 다시 듣는다.
 * (안드로이드 크롬은 continuous 모드에서 결과가 중복되는 문제가 있어 한 문장씩 끊어 듣는다)
 * @param {{lang: string, onInterim?: (t: string) => void, onFinal: (t: string) => void,
 *          onState?: (listening: boolean) => void, onError?: (msg: string) => void, repeat?: boolean}} o
 */
export function createListener(o) {
  let rec = null;
  let active = false;
  let restartTimer = 0;
  let failures = 0;
  let silent = 0;

  function startOnce() {
    const r = new SR();
    rec = r;
    r.lang = o.lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    // 이전 인식기가 늦게 보내는 이벤트는 무시한다. stop() 뒤에 오는 마지막 결과(onresult)는 받는다
    r.onresult = (e) => {
      if (r !== rec) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const t = res[0].transcript.trim();
          if (t) o.onFinal(t);
          failures = 0;
          silent = 0;
        } else interim += res[0].transcript;
      }
      o.onInterim?.(interim);
    };
    r.onerror = (e) => {
      if (r !== rec || r.stoppedByUser || e.error === 'aborted') return;
      if (e.error === 'no-speech') {
        // 조용한 상태로 계속 다시 듣는 것을 막는다 (약 30초)
        if (++silent >= 4 && active) {
          active = false;
          o.onError?.('한동안 말소리가 없어 듣기를 멈췄습니다.');
        }
        return;
      }
      failures++;
      if (STT_ERRORS[e.error] || failures >= 3) {
        active = false;
        o.onError?.(STT_ERRORS[e.error] || `음성 인식 오류: ${e.error}`);
      }
    };
    r.onend = () => {
      if (r !== rec || r.stoppedByUser) return;
      o.onInterim?.('');
      if (active && o.repeat !== false) {
        restartTimer = setTimeout(() => {
          if (active) safeStart();
        }, 120);
      } else {
        active = false;
        o.onState?.(false);
      }
    };
    r.start();
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

  return {
    start() {
      if (!SR) {
        o.onError?.('이 브라우저는 음성 인식을 지원하지 않습니다. 안드로이드 크롬을 사용하세요.');
        return;
      }
      if (active) return;
      active = true;
      failures = 0;
      silent = 0;
      o.onState?.(true);
      safeStart();
    },
    stop() {
      const wasActive = active;
      active = false;
      clearTimeout(restartTimer);
      if (rec) rec.stoppedByUser = true;
      try {
        rec?.stop();
      } catch {
        /* 이미 멈춤 */
      }
      o.onInterim?.('');
      if (wasActive) o.onState?.(false);
    },
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
