// 기본 음성 모드: Gemini Live를 쓸 수 없을 때 브라우저 음성 인식 → Gemini 글 답변(스트리밍) → 기기 음성으로 읽기를 반복한다.
// 한쪽씩 말한다(튜터가 답하고 읽는 동안에는 듣지 않음). 답은 끝난 문장부터 바로 읽기 시작한다.
// 기기 음성과 음성 인식을 함께 쓸 수 없어 말로는 끊을 수 없고, "말 끊기" 버튼(interrupt)으로 끊는다.

import { generate, S } from './gemini.js';
import { createListener, speak, stopSpeaking, sttSupported, ttsSupported } from '../speech.js';
import { errorMessage, isIOS } from '../ui.js';
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
 * @returns {{stop: () => void, setPaused: (on: boolean) => void, interrupt: () => void}}
 *   interrupt: "말 끊기" 버튼. 튜터 차례(답 받기·읽기)가 아니면 아무 일도 하지 않는다
 */
export function startFallback({ system, on }) {
  const history = [];
  let stopped = false;
  let paused = false;
  let busy = false; // 튜터 차례(답 받기·읽기) 중. 이때 늦게 도착한 음성 인식 결과는 버린다
  let heard = '';
  let quietTimer = 0;
  let ctrl = null;
  let turnId = 0; // 끊기·일시정지·끝내기마다 바뀐다: 그 전 차례의 남은 문장은 읽지 않고 뒷정리도 하지 않는다

  const waitThenSubmit = (ms) => {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(submit, ms);
  };

  const listener = createListener({
    lang: 'en-US',
    onInterim: (t) => {
      if (busy || stopped || paused) return; // 멈춘 뒤에 늦게 온 인식 결과는 버린다
      if (t) waitThenSubmit(UNFINISHED_MS);
      on.interim(`${heard} ${t}`.trim());
    },
    onFinal: (t) => {
      if (busy || stopped || paused) return;
      heard = `${heard} ${t}`.trim();
      on.interim(heard);
      waitThenSubmit(QUIET_MS);
    },
    onError: (msg, code) => (code === 'no-speech' ? on.idle() : fail(msg)),
  });

  /**
   * 기기 음성으로 읽기 전에 듣기를 끊는다 (그 뒤에 오는 인식 결과는 어차피 버린다).
   * 아이폰은 abort()로 끊는다: stop()으로 멈춘 채 읽으면 다음 듣기가 아무 알림 없이 멈추기도 한다
   */
  const stopListening = () => (isIOS ? listener.abort() : listener.stop());

  function listen() {
    if (stopped || paused || busy) return;
    on.status('listening');
    listener.start();
  }

  function submit() {
    const text = heard;
    if (!text || busy || stopped || paused) return;
    heard = '';
    stopListening();
    on.interim('');
    on.userText(text);
    respond(text);
  }

  async function say(sentence, id) {
    if (id !== turnId) return;
    on.status('speaking');
    await speak(sentence);
  }

  /** 지금 차례를 버린다 (끊기·일시정지·끝내기): 받던 답을 멈추고 읽기를 멈춘다 */
  function dropTurn() {
    turnId++;
    busy = false;
    ctrl?.abort();
    stopSpeaking();
  }

  async function respond(text) {
    const id = ++turnId;
    busy = true;
    on.turnStart?.();
    on.status('thinking');
    history.push({ role: 'user', parts: [{ text }] });
    ctrl = new AbortController();
    let shown = '';
    let read = 0;
    let speaking = Promise.resolve();
    // 끊거나 멈춘 차례: 화면에 보인 만큼은 튜터 말로 남기고, 아무것도 안 보였으면 내 말도 뺀다 (대화는 사용자 차례로 시작)
    const keepShown = () => (shown ? history.push({ role: 'model', parts: [{ text: shown }] }) : history.pop());
    const show = (reply, final) => {
      if (id !== turnId) return;
      if (reply.length > shown.length && reply.startsWith(shown)) {
        on.tutorText(reply.slice(shown.length));
        shown = reply;
      }
      const next = takeSentences(reply, read, final);
      read = next.end;
      for (const s of next.sentences) speaking = speaking.then(() => say(s, id));
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
      if (id !== turnId) return keepShown(); // 답을 다 받은 순간 끊겼다
      const reply = String(r?.reply || '').trim();
      show(reply, true);
      history.push({ role: 'model', parts: [{ text: reply }] });
      if (r?.correction?.corrected) on.correction(r.correction);
      on.turnEnd();
      await speaking;
    } catch (e) {
      if (id === turnId && e.name !== 'AbortError') return fail(errorMessage(e));
      keepShown(); // 끊기·일시정지·끝내기로 취소한 차례
    }
    if (id !== turnId) return; // 끊거나 멈춘 쪽이 이미 다음 일(다시 듣기 등)을 맡았다
    busy = false;
    listen();
  }

  function stop() {
    stopped = true;
    clearTimeout(quietTimer);
    dropTurn();
    listener.stop();
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
      dropTurn();
      stopListening(); // 멈춘 동안 단어 뜻 창의 발음을 읽을 수 있다
    },
    interrupt() {
      if (stopped || paused || !busy) return;
      dropTurn();
      on.interrupted();
      listen(); // 바로 내 차례: 다시 듣는다
    },
  };
}
