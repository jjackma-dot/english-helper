// 게임의 목소리: 인물마다 다른 높낮이로 읽기, 영어 한 번 듣기(말하는 동안 글자가 보인다)

import { createListener, speak, stopSpeaking, sttSupported } from '../speech.js';

/** 인물별 목소리 (높낮이·빠르기) */
const VOICES = {
  pip: { pitch: 1.45, rate: 0.95 },
  nova: { pitch: 0.75, rate: 0.9 },
  narrator: { pitch: 1, rate: 0.92 },
  luna: { pitch: 1.1, rate: 0.95 },
  bolt: { pitch: 0.55, rate: 0.85 },
  zeek: { pitch: 1.7, rate: 1.1 },
  mira: { pitch: 1.15, rate: 0.92 },
  momo: { pitch: 1.9, rate: 1 },
};

/** 쉬운 수준(Basic·IM1)은 조금 천천히 */
export function say(text, who = 'narrator', { slow = false } = {}) {
  const v = VOICES[who] ?? VOICES.narrator;
  return speak(text, { lang: 'en-US', pitch: v.pitch, rate: v.rate * (slow ? 0.85 : 1) });
}

export const hush = stopSpeaking;
export const canListen = sttSupported;

/**
 * 영어를 한 번 듣는다. 말이 끝나면(또는 timeoutMs가 지나면) 들은 글을 돌려준다.
 * @param {{onInterim?: (t: string) => void, timeoutMs?: number}} [o]
 * @returns {{promise: Promise<string>, stop: () => void}}
 */
export function listenOnce({ onInterim, timeoutMs = 10000 } = {}) {
  let heard = '';
  let timer = 0;
  let settle;
  const promise = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  stopSpeaking();
  const l = createListener({
    lang: 'en-US',
    repeat: false,
    onInterim: (t) => onInterim?.(`${heard} ${t}`.trim()),
    onFinal: (t) => {
      heard = `${heard} ${t}`.trim();
      onInterim?.(heard);
    },
    onState: (on) => {
      if (!on) {
        clearTimeout(timer);
        settle.resolve(heard);
      }
    },
    onError: (msg, code) => {
      clearTimeout(timer);
      if (code === 'no-speech') settle.resolve(heard);
      else settle.reject(new Error(msg));
    },
  });
  l.start();
  timer = setTimeout(() => l.stop(), timeoutMs);
  return {
    promise,
    stop: () => {
      clearTimeout(timer);
      l.stop();
    },
  };
}
