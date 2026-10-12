// 기본 음성 모드: Gemini Live를 쓸 수 없을 때 브라우저 음성 인식 → Gemini 글 답변(스트리밍) → 기기 음성으로 읽기를 반복한다.
// 한쪽씩 말한다(튜터가 답하고 읽는 동안에는 듣지 않음). 답은 끝난 문장부터 바로 읽기 시작한다.

import { generate, S } from './gemini.js';
import { createListener, speak, stopSpeaking, sttSupported, ttsSupported } from '../speech.js';
import { errorMessage } from '../ui.js';
import { FAST_MODEL } from '../lib/gemini-policy.js';
import { START_TEXT, recentTurns, takeSentences } from '../lib/live-protocol.js';

export const fallbackSupported = sttSupported && ttsSupported;

const QUIET_MS = 1200; // 마지막 말 뒤로 이만큼 조용하면 튜터 차례
const UNFINISHED_MS = 4000; // 듣는 중인 말이 끝내 확정되지 않을 때 그때까지 들은 말로 넘긴다

// 답(reply)부터 받아야 바로 읽기 시작할 수 있다 (S.obj는 적은 순서대로 나오게 한다)
const REPLY_SCHEMA = S.obj({
  reply: S.str('What the tutor says aloud: 1-3 short spoken English sentences.'),
  correction: {
    ...S.obj({ original: S.str(), corrected: S.str(), explanation_ko: S.str() }, ['original', 'corrected']),
    nullable: true,
    description: 'Correction of my last sentence, or null when there is nothing to correct.',
  },
});

/**
 * @param {{system: string, on: object}} o on: startLive와 같은 사건 + interim(t): 듣는 중인 말,
 *   idle(): 한동안 말이 없어 듣기를 멈춤
 * @returns {{stop: () => void, setPaused: (on: boolean) => void}}
 */
export function startFallback({ system, on }) {
  const history = [];
  let stopped = false;
  let paused = false;
  let busy = false; // 튜터 차례(답 받기·읽기) 중. 이때 늦게 도착한 음성 인식 결과는 버린다
  let heard = '';
  let quietTimer = 0;
  let ctrl = null;

  const waitThenSubmit = (ms) => {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(submit, ms);
  };

  const listener = createListener({
    lang: 'en-US',
    onInterim: (t) => {
      if (busy || stopped) return;
      if (t) waitThenSubmit(UNFINISHED_MS);
      on.interim(`${heard} ${t}`.trim());
    },
    onFinal: (t) => {
      if (busy || stopped) return;
      heard = `${heard} ${t}`.trim();
      on.interim(heard);
      waitThenSubmit(QUIET_MS);
    },
    onError: (msg, code) => (code === 'no-speech' ? on.idle() : fail(msg)),
  });

  function listen() {
    if (stopped || paused || busy) return;
    on.status('listening');
    listener.start();
  }

  function submit() {
    const text = heard;
    if (!text || busy || stopped || paused) return;
    heard = '';
    listener.stop();
    on.interim('');
    on.userText(text);
    respond(text);
  }

  async function say(sentence) {
    if (stopped || paused) return;
    on.status('speaking');
    await speak(sentence);
  }

  async function respond(text) {
    busy = true;
    on.status('thinking');
    history.push({ role: 'user', parts: [{ text }] });
    ctrl = new AbortController();
    let shown = '';
    let read = 0;
    let speaking = Promise.resolve();
    const show = (reply, final) => {
      if (reply.length > shown.length && reply.startsWith(shown)) {
        on.tutorText(reply.slice(shown.length));
        shown = reply;
      }
      const next = takeSentences(reply, read, final);
      read = next.end;
      for (const s of next.sentences) speaking = speaking.then(() => say(s));
    };
    try {
      const r = await generate({
        contents: recentTurns(history),
        system,
        schema: REPLY_SCHEMA,
        model: FAST_MODEL,
        maxOutputTokens: 800,
        signal: ctrl.signal,
        onPartial: (p) => typeof p?.reply === 'string' && show(p.reply, false),
      });
      if (stopped) return;
      const reply = String(r?.reply || '').trim();
      show(reply, true);
      history.push({ role: 'model', parts: [{ text: reply }] });
      if (r?.correction?.corrected) on.correction(r.correction);
      on.turnEnd();
      await speaking;
    } catch (e) {
      if (e.name !== 'AbortError') return fail(errorMessage(e));
      history.pop(); // 일시정지·끝내기로 취소한 차례는 대화에서 뺀다
    }
    busy = false;
    listen();
  }

  function stop() {
    stopped = true;
    clearTimeout(quietTimer);
    ctrl?.abort();
    listener.stop();
    stopSpeaking();
  }

  function fail(message) {
    if (stopped) return;
    stop();
    on.fail({ kind: 'basic', message });
  }

  respond(START_TEXT); // 튜터가 먼저 말을 건다

  return {
    stop,
    setPaused(v) {
      paused = v;
      if (!v) return listen();
      clearTimeout(quietTimer);
      heard = '';
      on.interim('');
      ctrl?.abort();
      listener.stop();
      stopSpeaking();
    },
  };
}
