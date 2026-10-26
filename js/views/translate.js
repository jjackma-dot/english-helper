// 3) 번역: 텍스트 번역, 스캔(카메라로 찍거나 고른 사진의 글자 번역 + 그 글에 대해 묻기, Gemini),
// 실시간 음성 통역(문장 단위), 녹음 후 받아쓰기·번역(Gemini).
// 번역 방향은 고르지 않는다: 한국어는 영어로, 영어는 한국어로 저절로 맞춘다

import {
  h,
  btn,
  clear,
  toast,
  copyWithToast,
  errorMessage,
  segmented,
  toggle,
  field,
  isIOS,
  isStandalone,
  browserHint,
} from '../ui.js';
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
import { textDirection } from '../lib/photo.js';
import { translate, transcribeAndTranslate } from '../services/translate.js';
import { startRecording, recordingSupported } from '../services/recorder.js';
import { speak, stopSpeaking, primeSpeech, createListener, listenOnce, sttSupported } from '../speech.js';
import { tappableEnglish } from '../components/word-sheet.js';
import { buildScanPanel } from './translate-scan.js';

const LABEL = { ko: '한국어', en: 'English' };
const SPEECH_LANG = { ko: 'ko-KR', en: 'en-US' };

let dir = { from: 'ko', to: 'en' }; // 텍스트 번역의 마지막 방향 (입력한 글의 언어로 저절로 맞춘다)
let mode = 'text';
let panels;
let modeSeg;
let panelBox;

/** @param {{camera?: boolean}} [o] camera: 스캔이면 바로 카메라를 켠다 (공유받은 사진을 번역할 때는 켜지 않는다) */
function showMode(m, { camera = true } = {}) {
  mode = m;
  modeSeg.setValue(m);
  panels.live.stop();
  panels.record.stop();
  if (m === 'scan') panels.scan.enter({ camera });
  else panels.scan.leave();
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

/**
 * 번역을 자동으로 읽을 때: 누른 순간(기다리기 전)에 불러야 한다.
 * 아이폰은 누르지 않고 처음 읽으면 소리가 나지 않아 미리 깨워 둔다 (다른 기기에서는 아무것도 안 함)
 */
function primeAutoSpeak() {
  if (getSettings().autoSpeakTranslation) primeSpeech();
}

/* ---------- 텍스트 번역 ---------- */

function buildTextPanel() {
  const src = h('textarea', { rows: 5, class: 'src-text', 'aria-label': '번역할 글' });
  const out = h('div', { class: 'stack' });
  const historyBox = h('div');
  let ctrl;

  src.placeholder = '번역할 글을 입력하세요 (한국어 → English, English → 한국어)';

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
                    primeAutoSpeak();
                    // 스캔 번역 기록은 from이 'other'(일본어 등)일 수 있다: 한국어가 아니면 영 → 한으로 다시 번역
                    const d = textDirection(it.from);
                    setDir(d.from, d.to);
                    src.value = it.source;
                    run();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  },
                },
                h('span', { class: 'clip' }, it.photo ? h('span', { class: 'tag' }, '스캔') : null, it.source),
                h('span', { class: 'clip muted' }, it.result)
              )
            )
          )
        ),
        btn('기록 지우기', () => (clearTranslateHistory(), renderHistory()), { cls: 'btn small ghost', ico: 'trash' })
      )
    );
  }

  /** 말로 입력: 어느 말로 할지 고른다 (음성 인식은 언어를 알아야 한다). 들은 말의 언어로 방향을 맞춰 번역한다 */
  const micBtn = (label, lang) => {
    const b = btn(
      label,
      async () => {
        primeAutoSpeak(); // 들은 말을 번역해 읽을 수 있다
        b.classList.add('recording');
        try {
          const said = await listenOnce(SPEECH_LANG[lang]);
          if (said) {
            src.value = (src.value.trim() ? `${src.value.trim()} ` : '') + said;
            run();
          } else toast('말소리를 듣지 못했습니다.');
        } catch (e) {
          toast(errorMessage(e));
        } finally {
          b.classList.remove('recording');
        }
      },
      { cls: 'btn', ico: 'mic' }
    );
    return b;
  };

  /**
   * 스캔한 사진에서 읽은 글을 고쳐서 다시 번역할 수 있게 넣는다 (고칠 시간을 주려고 바로 번역하지는 않는다).
   * 방향은 사진 글의 언어(lang)로 정한다: 한국어면 한 → 영, 그 밖(영어·일본어 등)은 영 → 한
   */
  function setText(text, lang) {
    ctrl?.abort();
    src.value = text;
    const d = textDirection(lang ?? detectLang(text) ?? dir.from);
    setDir(d.from, d.to);
    clear(out).append(h('p', { class: 'hint' }, '잘못 읽은 글자를 고친 뒤 번역하기를 누르세요.'));
    src.focus();
  }

  // 누른 순간 소리를 깨운 뒤 번역 (번역 버튼·Ctrl+Enter)
  const runByTap = () => {
    primeAutoSpeak();
    run();
  };
  src.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runByTap();
  });
  renderHistory();

  const el = h(
    'div',
    { class: 'stack' },
    src,
    h(
      'div',
      { class: 'row wrap' },
      btn('번역하기', runByTap, { cls: 'btn primary', ico: 'globe' }),
      sttSupported ? micBtn('한국어로 말하기', 'ko') : null,
      sttSupported ? micBtn('Speak English', 'en') : null,
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
  return { el, setText, renderHistory };
}

/* ---------- 실시간 통역 ---------- */

/** 음성 인식이 없을 때 안내 (기기에 맞는 브라우저 이름) */
function noSttText() {
  const lead = '이 브라우저는 음성 인식을 지원하지 않습니다. ';
  if (isIOS && isStandalone()) {
    return `${lead}아이폰 홈 화면 앱에서는 음성 인식이 막혀 있을 수 있어요. Safari에서 같은 주소를 여세요(Gemini 키가 있으면 녹음 모드도 쓸 수 있어요).`;
  }
  return lead + browserHint();
}

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
    primeAutoSpeak(); // 누른 처리 안에서, 듣기 전에
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
      // 문장은 이미 받았다. 아이폰은 stop() 뒤 읽기 소리가 나면 다음 듣기가 멈춰 버릴 수 있어 abort()로 끊는다
      if (isIOS && listener.abort) listener.abort();
      else listener.stop();
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
    sttSupported ? h('div', { class: 'talk-row' }, koBtn, enBtn) : h('p', { class: 'error-text' }, noSttText()),
    toggle(
      '번역 결과를 소리로 읽기',
      getSettings().autoSpeakTranslation,
      (v) => {
        updateSettings({ autoSpeakTranslation: v });
        if (v) primeSpeech(); // 아이폰: 통역 중에 켜도 다음 번역부터 소리가 나게 누른 순간에 깨운다
      },
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

/**
 * 녹음 파일 저장 버튼. 아이폰은 내려받기 링크가 잘 안 되므로 공유 시트로 보낸다 ("파일에 저장"을 고르면 됨).
 * 그 밖의 기기는 내려받기 링크
 */
function saveChip(blob, url, name) {
  const file = isIOS ? new File([blob], name, { type: 'audio/wav' }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    return btn(
      '파일 저장',
      async () => {
        try {
          await navigator.share({ files: [file] });
        } catch (e) {
          if (e?.name !== 'AbortError') toast('파일을 저장하지 못했습니다.');
        }
      },
      { cls: 'chip', ico: 'download' }
    );
  }
  return h('a', { class: 'chip', href: url, download: name }, icon('download'), '파일 저장');
}

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
          saveChip(blob, lastUrl, `recording-${stamp}.wav`)
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

/* ---------- 스캔 (카메라·사진) ---------- */

/** 키 없이도 쓸 수 있는 휴대폰 기능 안내 (아이폰과 그 밖의 기기: 갤럭시 기준) */
function phoneTips() {
  if (isIOS) {
    return h(
      'ul',
      { class: 'hint photo-tips' },
      h('li', null, h('b', null, '아이폰 카메라'), ': 글자를 비추면 나오는 텍스트 인식 버튼 → 번역'),
      h('li', null, h('b', null, '사진 앱'), ': 사진을 열고 텍스트 인식 버튼 → 글자를 길게 눌러 번역'),
      h(
        'li',
        null,
        h('b', null, '아이폰 16·17'),
        ': 카메라 컨트롤을 길게 눌러 시각 지능 → 번역 (Apple Intelligence 켜야 함)'
      ),
      h('li', null, h('b', null, '번역 앱'), ' → 카메라'),
      h('li', null, '기종·버전에 따라 이름이 다를 수 있어요.')
    );
  }
  return h(
    'ul',
    { class: 'hint photo-tips' },
    h('li', null, h('b', null, '갤럭시 카메라'), ': 글자를 비추면 나오는 T(텍스트) 버튼 → 번역'),
    h('li', null, h('b', null, '서클 투 서치'), ': 홈 버튼이나 화면 아래 막대를 길게 누르기 → 번역'),
    h('li', null, '휴대폰·버전에 따라 이름이 다를 수 있어요.')
  );
}

/* ---------- 화면 ---------- */

function setDir(from, to) {
  dir = { from, to };
}

export function init(root) {
  panels = { text: buildTextPanel(), live: buildLivePanel(), record: buildRecordPanel() };
  panels.scan = buildScanPanel({
    onEdit: (text, lang) => {
      showMode('text');
      panels.text.setText(text, lang);
    },
    onSaved: () => panels.text.renderHistory(),
    tips: phoneTips,
  });
  panelBox = h('div');
  modeSeg = segmented(
    [
      { value: 'text', label: '텍스트' },
      { value: 'scan', label: '스캔' },
      { value: 'live', label: '실시간 통역' },
      { value: 'record', label: '녹음' },
    ],
    mode,
    showMode,
    { label: '번역 방식' }
  );
  modeSeg.classList.add('modes'); // 좁은 화면에서도 한 줄에 들어가게 글자 길이만큼 나눈다
  root.append(modeSeg, panelBox);
  showMode(mode);
}

export function show(params) {
  if (params.get('photo') === 'shared') {
    // 다른 앱에서 공유한 사진 (sw.js가 받아 둠). 새로 고침해도 다시 꺼내지 않게 주소에서 지운다
    history.replaceState(null, '', `${location.pathname}#/translate`);
    showMode('scan', { camera: false });
    panels.scan.takeShared();
    return;
  }
  if (mode === 'scan') panels.scan.enter(); // 다른 탭에서 돌아옴: 카메라를 켜 두었으면 다시 켠다
  const text = params.get('text');
  if (text) {
    if (mode !== 'text') showMode('text');
    const ta = panels.text.el.querySelector('textarea');
    ta.value = text;
    panels.text.el.querySelector('.btn.primary').click();
  }
}

/** 다른 탭으로 가면 마이크·카메라를 끄고 스캔 번역 요청을 멈춘다 */
export function hide() {
  panels?.live.stop();
  panels?.record.stop();
  panels?.scan.leave();
}
