// 3) 번역: 텍스트 번역, 실시간 음성 통역(문장 단위), 녹음 후 받아쓰기·번역(Gemini)

import { h, btn, iconBtn, clear, toast, copyWithToast, errorMessage, segmented, toggle, field } from '../ui.js';
import { icon } from '../icons.js';
import {
  getSettings,
  updateSettings,
  geminiEnabled,
  addWord,
  getTranslateHistory,
  pushTranslateHistory,
  clearTranslateHistory,
} from '../store.js';
import { detectLang } from '../lib/lang.js';
import { formatClock } from '../lib/timefmt.js';
import { translate, transcribeAndTranslate } from '../services/translate.js';
import { startRecording, recordingSupported } from '../services/recorder.js';
import { speak, stopSpeaking, createListener, listenOnce, sttSupported } from '../speech.js';
import { tappableEnglish } from '../components/word-sheet.js';

const LABEL = { ko: '한국어', en: 'English' };
const SPEECH_LANG = { ko: 'ko-KR', en: 'en-US' };

let dir = { from: 'ko', to: 'en' };
let mode = 'text';
let panels;
let dirLabel;
let modeSeg;
let panelBox;

function showMode(m) {
  mode = m;
  modeSeg.setValue(m);
  panels.live.stop();
  panels.record.stop();
  panelBox.replaceChildren(panels[m].el);
}

/* ---------- 공통 ---------- */

function textBlock(text, lang) {
  return lang === 'en'
    ? tappableEnglish(text, { source: '번역', tag: 'div', cls: 'out-text' })
    : h('div', { class: 'out-text', lang }, text);
}

function resultActions(text, lang, source) {
  return h(
    'div',
    { class: 'row wrap' },
    btn('읽기', () => speak(text, { lang: SPEECH_LANG[lang] }), { cls: 'chip', ico: 'volume' }),
    btn('복사', () => copyWithToast(text), { cls: 'chip', ico: 'copy' }),
    btn(
      '저장',
      () => {
        const en = lang === 'en' ? text : source;
        const ko = lang === 'en' ? source : text;
        addWord({ text: en, meaning: ko, type: 'sentence', source: '번역' });
        toast('단어장에 문장을 저장했습니다');
      },
      { cls: 'chip', ico: 'star' }
    )
  );
}

function engineBadge(r) {
  return h('span', { class: 'badge' }, r.engine === 'gemini' ? 'Gemini' : 'MyMemory');
}

/* ---------- 텍스트 번역 ---------- */

function buildTextPanel() {
  const src = h('textarea', { rows: 5, class: 'src-text', 'aria-label': '번역할 글' });
  const out = h('div', { class: 'stack' });
  const historyBox = h('div');
  let ctrl;

  const setPlaceholder = () => {
    src.placeholder = dir.from === 'ko' ? '번역할 한국어를 입력하세요' : 'Type English to translate';
  };
  setPlaceholder();

  async function run() {
    const text = src.value.trim();
    if (!text) return;
    // 입력한 글의 언어가 방향과 반대면 자동으로 바꾼다
    const lang = detectLang(text);
    if (lang && lang !== dir.from) setDir(lang, lang === 'ko' ? 'en' : 'ko');
    ctrl?.abort();
    ctrl = new AbortController();
    const { from, to } = dir;
    clear(out).append(h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), '번역 중…'));
    try {
      const r = await translate(text, from, to, { signal: ctrl.signal });
      clear(out).append(
        h(
          'div',
          { class: 'card result' },
          h(
            'div',
            { class: 'row between' },
            h('span', { class: 'muted small' }, `${LABEL[from]} → ${LABEL[to]}`),
            engineBadge(r)
          ),
          textBlock(r.text, to),
          to === 'ko' ? null : h('p', { class: 'hint' }, '영어 단어를 누르면 뜻을 볼 수 있습니다.'),
          r.notice ? h('p', { class: 'hint' }, r.notice) : null,
          resultActions(r.text, to, text)
        )
      );
      if (getSettings().autoSpeakTranslation) speak(r.text, { lang: SPEECH_LANG[to] });
      pushTranslateHistory({ source: text, result: r.text, from, to });
      renderHistory();
    } catch (e) {
      if (e.name !== 'AbortError') clear(out).append(h('p', { class: 'error-text' }, errorMessage(e)));
    }
  }

  function renderHistory() {
    clear(historyBox);
    const list = getTranslateHistory();
    if (!list.length) return;
    historyBox.append(
      h(
        'details',
        { class: 'card' },
        h('summary', null, icon('clock'), ` 최근 번역 ${list.length}개`),
        h(
          'ul',
          { class: 'history' },
          list.slice(0, 30).map((it) =>
            h(
              'li',
              null,
              h(
                'button',
                {
                  type: 'button',
                  class: 'history-item',
                  onclick: () => {
                    setDir(it.from, it.to);
                    src.value = it.source;
                    run();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  },
                },
                h('span', { class: 'clip' }, it.source),
                h('span', { class: 'clip muted' }, it.result)
              )
            )
          )
        ),
        btn('기록 지우기', () => (clearTranslateHistory(), renderHistory()), { cls: 'btn small ghost', ico: 'trash' })
      )
    );
  }

  const micBtn = sttSupported
    ? btn(
        '말로 입력',
        async () => {
          micBtn.classList.add('recording');
          try {
            const said = await listenOnce(SPEECH_LANG[dir.from]);
            if (said) {
              src.value = (src.value.trim() ? `${src.value.trim()} ` : '') + said;
              run();
            } else toast('말소리를 듣지 못했습니다.');
          } catch (e) {
            toast(errorMessage(e));
          } finally {
            micBtn.classList.remove('recording');
          }
        },
        { cls: 'btn', ico: 'mic' }
      )
    : null;

  src.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run();
  });
  renderHistory();

  const el = h(
    'div',
    { class: 'stack' },
    src,
    h(
      'div',
      { class: 'row wrap' },
      btn('번역하기', run, { cls: 'btn primary', ico: 'globe' }),
      micBtn,
      btn(
        '지우기',
        () => {
          src.value = '';
          clear(out);
          src.focus();
        },
        { cls: 'btn ghost', ico: 'x' }
      )
    ),
    out,
    historyBox
  );
  return { el, onDirChange: setPlaceholder };
}

/* ---------- 실시간 통역 ---------- */

function buildLivePanel() {
  const interim = h('div', { class: 'interim', 'aria-live': 'polite' });
  const list = h('ol', { class: 'live-list' });
  const live = { lang: null, listener: null, pausedForTts: false };
  const items = [];

  const koBtn = h(
    'button',
    { type: 'button', class: 'talk-btn', onclick: () => toggleLive('ko') },
    icon('mic', { size: 28 }),
    h('span', null, '한국어로 말하기')
  );
  const enBtn = h(
    'button',
    { type: 'button', class: 'talk-btn', onclick: () => toggleLive('en') },
    icon('mic', { size: 28 }),
    h('span', null, 'Speak English')
  );

  function updateUi() {
    koBtn.classList.toggle('recording', live.lang === 'ko');
    enBtn.classList.toggle('recording', live.lang === 'en');
    koBtn.querySelector('span').textContent = live.lang === 'ko' ? '듣는 중… (누르면 멈춤)' : '한국어로 말하기';
    enBtn.querySelector('span').textContent = live.lang === 'en' ? 'Listening… (tap to stop)' : 'Speak English';
    if (!live.lang) interim.textContent = '';
  }

  function stopLive() {
    const l = live.listener;
    live.lang = null;
    live.listener = null;
    live.pausedForTts = false;
    l?.stop();
    updateUi();
  }

  function toggleLive(lang) {
    if (live.lang === lang) return stopLive();
    stopLive();
    stopSpeaking();
    live.lang = lang;
    const listener = createListener({
      lang: SPEECH_LANG[lang],
      onInterim: (t) => {
        if (live.listener === listener) interim.textContent = t ? `${lang === 'ko' ? '듣는 중' : 'Hearing'}: ${t}` : '';
      },
      onFinal: (t) => handleFinal(t, lang, listener),
      onState: (on) => {
        if (!on && live.listener === listener && !live.pausedForTts) {
          live.lang = null;
          live.listener = null;
          updateUi();
        }
      },
      onError: (msg) => {
        toast(msg, { ms: 4000 });
        if (live.listener === listener) stopLive();
      },
    });
    live.listener = listener;
    listener.start();
    updateUi();
  }

  async function handleFinal(text, lang, listener) {
    const to = lang === 'ko' ? 'en' : 'ko';
    const autoSpeak = getSettings().autoSpeakTranslation;
    // 번역을 소리로 읽을 때는 그 소리가 다시 인식되지 않도록 잠시 듣기를 멈춘다
    if (autoSpeak && live.listener === listener) {
      live.pausedForTts = true;
      listener.stop();
    }
    const trans = h('div', { class: 'muted loading' }, h('span', { class: 'spinner' }), '번역 중…');
    const li = h(
      'li',
      { class: `live-item from-${lang}` },
      h(
        'div',
        { class: 'row between' },
        h('span', { class: 'badge' }, lang === 'ko' ? '한 → 영' : 'EN → 한'),
        h(
          'span',
          { class: 'muted small' },
          new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
        )
      ),
      h('div', { class: 'src', lang }, text),
      trans
    );
    list.append(li);
    li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const item = { lang, text, result: '' };
    items.push(item);
    try {
      const r = await translate(text, lang, to);
      item.result = r.text;
      trans.replaceWith(h('div', { class: 'stack' }, textBlock(r.text, to), resultActions(r.text, to, text)));
      if (autoSpeak) await speak(r.text, { lang: SPEECH_LANG[to] });
    } catch (e) {
      trans.replaceWith(h('p', { class: 'error-text' }, errorMessage(e)));
    }
    if (autoSpeak && live.pausedForTts && live.listener === listener) {
      live.pausedForTts = false;
      listener.start();
    }
  }

  const el = h(
    'div',
    { class: 'stack' },
    h(
      'p',
      { class: 'hint' },
      '말을 하면 문장이 끝날 때마다 바로 번역합니다. 마주 보고 대화할 때는 말하는 사람이 자기 언어 버튼을 누르세요.'
    ),
    sttSupported
      ? h('div', { class: 'talk-row' }, koBtn, enBtn)
      : h('p', { class: 'error-text' }, '이 브라우저는 음성 인식을 지원하지 않습니다. 안드로이드 크롬에서 사용하세요.'),
    toggle(
      '번역 결과를 소리로 읽기',
      getSettings().autoSpeakTranslation,
      (v) => updateSettings({ autoSpeakTranslation: v }),
      '읽는 동안에는 잠시 듣기를 멈춥니다'
    ),
    interim,
    list,
    h(
      'div',
      { class: 'row wrap' },
      btn(
        '전체 복사',
        () => {
          if (!items.length) return toast('아직 기록이 없습니다.');
          copyWithToast(items.map((i) => `${i.text}\n→ ${i.result}`).join('\n\n'));
        },
        { cls: 'btn small ghost', ico: 'copy' }
      ),
      btn(
        '기록 지우기',
        () => {
          items.length = 0;
          clear(list);
        },
        { cls: 'btn small ghost', ico: 'trash' }
      )
    )
  );
  return { el, stop: stopLive };
}

/* ---------- 녹음 후 번역 ---------- */

function buildRecordPanel() {
  let rec = null;
  let tick = 0;
  let startedAt = 0;
  let lastUrl = '';
  let srcLang = 'auto';
  const timer = h('span', { class: 'rec-time' }, '0:00');
  const level = h('div', { class: 'level' }, h('div', { class: 'level-bar' }));
  const out = h('div', { class: 'stack' });
  const recBtn = h(
    'button',
    { type: 'button', class: 'talk-btn rec', onclick: () => (rec ? stop() : start()) },
    icon('mic', { size: 28 }),
    h('span', null, '녹음 시작')
  );

  async function start() {
    clear(out);
    try {
      rec = await startRecording({
        maxSeconds: 300,
        onLevel: (peak) => (level.firstChild.style.width = `${Math.min(100, Math.round(peak * 140))}%`),
        onLimit: () => {
          toast('최대 5분까지 녹음할 수 있어 녹음을 마쳤습니다.');
          stop();
        },
      });
    } catch (e) {
      rec = null;
      toast(errorMessage(e), { ms: 4000 });
      return;
    }
    startedAt = Date.now();
    tick = setInterval(() => (timer.textContent = formatClock((Date.now() - startedAt) / 1000)), 250);
    recBtn.classList.add('recording');
    recBtn.querySelector('span').textContent = '녹음 중… 누르면 정지';
  }

  async function stop() {
    if (!rec) return;
    const r = rec;
    rec = null;
    clearInterval(tick);
    recBtn.classList.remove('recording');
    recBtn.querySelector('span').textContent = '녹음 시작';
    level.firstChild.style.width = '0%';
    const { blob, seconds } = await r.stop();
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    const resultBox = h('div', { class: 'stack' });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    out.append(
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'row between' },
          h('b', null, `녹음 ${formatClock(seconds)}`),
          h('a', { class: 'chip', href: lastUrl, download: `recording-${stamp}.wav` }, icon('download'), '파일 저장')
        ),
        h('audio', { controls: true, src: lastUrl, preload: 'auto' }),
        geminiEnabled()
          ? btn('받아쓰기 + 번역 (Gemini)', () => runTranscribe(blob, resultBox), { cls: 'btn primary', ico: 'zap' })
          : h(
              'p',
              { class: 'hint' },
              '받아쓰기·번역은 Gemini API 키가 있어야 합니다. ',
              h('a', { href: '#/settings' }, '설정에서 키 넣기'),
              ' · 키 없이 쓰려면 "실시간 통역"을 이용하세요.'
            ),
        resultBox
      )
    );
    if (geminiEnabled()) runTranscribe(blob, resultBox);
  }

  async function runTranscribe(blob, box) {
    clear(box).append(
      h(
        'p',
        { class: 'muted loading' },
        h('span', { class: 'spinner' }),
        'Gemini가 받아쓰고 번역하는 중… (녹음이 길면 시간이 걸립니다)'
      )
    );
    try {
      const r = await transcribeAndTranslate(blob, srcLang);
      clear(box);
      if (!r.segments.length) {
        box.append(h('p', { class: 'muted' }, '말소리를 찾지 못했습니다.'));
        return;
      }
      box.append(
        h(
          'ol',
          { class: 'live-list' },
          r.segments.map((s) => {
            const sl = detectLang(s.source) || 'en';
            const tl = sl === 'ko' ? 'en' : 'ko';
            return h(
              'li',
              { class: `live-item from-${sl}` },
              h('div', { class: 'src', lang: sl }, s.source),
              textBlock(s.translation, tl),
              resultActions(s.translation, tl, s.source)
            );
          })
        ),
        btn('전체 복사', () => copyWithToast(r.segments.map((s) => `${s.source}\n→ ${s.translation}`).join('\n\n')), {
          cls: 'btn small ghost',
          ico: 'copy',
        })
      );
    } catch (e) {
      clear(box).append(h('p', { class: 'error-text' }, errorMessage(e)));
    }
  }

  const el = h(
    'div',
    { class: 'stack' },
    h(
      'p',
      { class: 'hint' },
      '강의·대화처럼 긴 말을 녹음한 뒤 한 번에 받아쓰고 번역합니다 (최대 5분). 녹음 파일은 이 화면에서 들어 보거나 저장할 수 있고, 앱에 따로 보관되지는 않습니다.'
    ),
    field(
      '녹음 언어',
      segmented(
        [
          { value: 'auto', label: '자동' },
          { value: 'ko', label: '한국어' },
          { value: 'en', label: '영어' },
        ],
        srcLang,
        (v) => (srcLang = v),
        { label: '녹음 언어' }
      )
    ),
    recordingSupported
      ? h('div', { class: 'rec-row' }, recBtn, h('div', { class: 'stack grow' }, timer, level))
      : h('p', { class: 'error-text' }, '이 브라우저는 녹음을 지원하지 않습니다.'),
    out
  );
  return {
    el,
    stop: () => {
      if (rec) {
        rec.cancel();
        rec = null;
        clearInterval(tick);
        recBtn.classList.remove('recording');
        recBtn.querySelector('span').textContent = '녹음 시작';
      }
    },
  };
}

/* ---------- 화면 ---------- */

function setDir(from, to) {
  dir = { from, to };
  dirLabel.replaceChildren(h('span', null, LABEL[from]), icon('send', { size: 16 }), h('span', null, LABEL[to]));
  panels.text.onDirChange();
}

export function init(root) {
  dirLabel = h('div', { class: 'dir-label' });
  panels = { text: buildTextPanel(), live: buildLivePanel(), record: buildRecordPanel() };
  panelBox = h('div');
  modeSeg = segmented(
    [
      { value: 'text', label: '텍스트' },
      { value: 'live', label: '실시간 통역' },
      { value: 'record', label: '녹음 번역' },
    ],
    mode,
    showMode,
    { label: '번역 방식' }
  );
  root.append(
    h(
      'div',
      { class: 'dir-bar card' },
      dirLabel,
      iconBtn('swap', '번역 방향 바꾸기', () => setDir(dir.to, dir.from))
    ),
    modeSeg,
    panelBox
  );
  setDir('ko', 'en');
  showMode('text');
}

export function show(params) {
  const text = params.get('text');
  if (text) {
    if (mode !== 'text') showMode('text');
    const ta = panels.text.el.querySelector('textarea');
    ta.value = text;
    panels.text.el.querySelector('.btn.primary').click();
  }
}

/** 다른 탭으로 가면 마이크를 끈다 */
export function hide() {
  panels?.live.stop();
  panels?.record.stop();
}
