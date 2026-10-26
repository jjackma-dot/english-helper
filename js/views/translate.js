// 3) 번역: 카메라로 비추는 글자 실시간 번역(Gemini), 사진 속 글자 번역(Gemini), 텍스트 번역,
// 실시간 음성 통역(문장 단위), 녹음 후 받아쓰기·번역(Gemini)

import {
  h,
  btn,
  iconBtn,
  clear,
  toast,
  copyWithToast,
  errorMessage,
  segmented,
  toggle,
  field,
  isAndroid,
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
import {
  blockSides,
  photoBlocks,
  photoCopyText,
  photoHistoryItem,
  photoLang,
  photoSourceText,
  textDirection,
} from '../lib/photo.js';
import { translate, transcribeAndTranslate, translateImage } from '../services/translate.js';
import { prepareImage, takeSharedPhoto } from '../services/photo-file.js';
import { startRecording, recordingSupported } from '../services/recorder.js';
import { speak, stopSpeaking, primeSpeech, createListener, listenOnce, sttSupported } from '../speech.js';
import { tappableEnglish } from '../components/word-sheet.js';
import { buildCameraPanel } from './translate-camera.js';

const LABEL = { ko: '한국어', en: 'English' };
const SPEECH_LANG = { ko: 'ko-KR', en: 'en-US' };

let dir = { from: 'ko', to: 'en' };
let mode = 'camera';
let panels;
let dirLabel;
let modeSeg;
let panelBox;

function showMode(m) {
  mode = m;
  modeSeg.setValue(m);
  panels.live.stop();
  panels.record.stop();
  if (m === 'camera') panels.camera.enter();
  else panels.camera.leave();
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
                    primeAutoSpeak();
                    // 사진 번역 기록은 from이 'other'(일본어 등)일 수 있다: 한국어가 아니면 영 → 한으로 다시 번역
                    const d = textDirection(it.from);
                    setDir(d.from, d.to);
                    src.value = it.source;
                    run();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  },
                },
                h('span', { class: 'clip' }, it.photo ? h('span', { class: 'tag' }, '사진') : null, it.source),
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
          primeAutoSpeak(); // 들은 말을 번역해 읽을 수 있다
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

  /**
   * 사진에서 읽은 글을 고쳐서 다시 번역할 수 있게 넣는다 (고칠 시간을 주려고 바로 번역하지는 않는다).
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
  return { el, onDirChange: setPlaceholder, setText, renderHistory };
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

/* ---------- 사진 번역 ---------- */
// 카메라로 찍거나 갤러리에서 고른(또는 다른 앱에서 공유받은) 사진의 글자를 Gemini가 읽어 블록마다 번역한다.
// 사진은 번역할 때만 Gemini로 보내고 앱에 보관하지 않는다.

const PHOTO_SOURCE = '사진 번역';
const LEFT = 'left'; // 다른 화면으로 가서 멈춘 요청 (abort 이유)
const SLOW_MS = 10000; // 이만큼 지나도 답이 오지 않으면 느린 인터넷 안내

const list = (v) => (Array.isArray(v) ? v : []);

function loadingLine(msg) {
  return h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), msg);
}

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

/**
 * @param {{onEdit: (text: string, lang: 'en'|'ko'|'other') => void, onSaved: () => void}} o
 *   onEdit: 읽은 글자를 텍스트 번역 칸에 넣기 (lang: 사진 글의 언어, 번역 방향을 정한다),
 *   onSaved: 번역 기록에 넣은 뒤 (기록 목록 새로 그리기)
 */
function buildPhotoPanel({ onEdit, onSaved }) {
  let img = null; // 보낼 사진 (prepareImage 결과). 다시 시도는 이것을 그대로 다시 보낸다
  let thumbUrl = '';
  let ctrl = null; // 진행 중인 번역 요청
  let job = 0; // 사진을 고르거나 닫을 때마다 늘려서, 그사이 늦게 끝난 준비를 버린다
  let shown = true; // 번역 탭이 보이는 중인지 (다른 탭에 가 있으면 새로 보내지 않는다)
  const out = h('div', { class: 'stack' });

  const fileInput = (capture) => {
    const input = h('input', {
      type: 'file',
      accept: 'image/*',
      capture,
      hidden: true,
      onchange: () => {
        const file = input.files?.[0];
        input.value = ''; // 같은 사진을 다시 골라도 알 수 있게
        if (file) usePhoto(file);
      },
    });
    return input;
  };
  const camInput = fileInput('environment'); // 휴대폰 카메라 앱이 열린다
  const pickInput = fileInput(null); // 갤러리·파일
  const openCamera = () => camInput.click();
  const openGallery = () => pickInput.click();

  const picks = h(
    'div',
    { class: 'talk-row' },
    h(
      'button',
      { type: 'button', class: 'talk-btn', onclick: openCamera },
      icon('camera', { size: 28 }),
      h('span', null, '카메라로 찍기')
    ),
    h(
      'button',
      { type: 'button', class: 'talk-btn', onclick: openGallery },
      icon('image', { size: 28 }),
      h('span', null, '사진 고르기')
    )
  );
  const noPreview = h('p', { class: 'hint center', hidden: true }, '미리 볼 수 없는 형식이지만 번역은 됩니다.');
  // 아주 긴 스크롤 캡처는 조각 수에 맞추느라 사진을 줄여 보낸다
  const smallNote = h(
    'p',
    { class: 'hint', hidden: true },
    '아주 긴 캡처라 사진을 줄여서 보내요. 글자가 작아 잘못 읽는 곳이 있을 수 있으니, 그러면 나눠서 캡처해 보세요.'
  );
  const thumb = h('img', {
    class: 'photo-thumb',
    alt: '번역할 사진',
    onerror: () => {
      // 크롬이 못 여는 HEIF 사진 등 (Gemini에는 원본을 그대로 보낸다)
      thumb.hidden = true;
      noPreview.hidden = false;
    },
  });
  const photoCard = h(
    'div',
    { class: 'card photo-card', hidden: true },
    h(
      'div',
      { class: 'photo-frame' },
      thumb,
      noPreview,
      iconBtn('x', '사진 닫기', closePhoto, 'icon-btn small photo-close')
    ),
    smallNote,
    h(
      'div',
      { class: 'row wrap' },
      btn('다시 찍기', openCamera, { cls: 'chip', ico: 'camera' }),
      btn('다른 사진', openGallery, { cls: 'chip', ico: 'image' })
    )
  );
  const keyBox = h(
    'div',
    { class: 'callout stack' },
    h('span', null, '사진 번역은 Gemini API 키가 있어야 합니다. ', h('a', { href: '#/settings' }, '설정에서 키 넣기')),
    h('span', { class: 'hint' }, '키 없이도 휴대폰 기능으로 사진 속 글자를 번역할 수 있어요.'),
    phoneTips()
  );
  const tips = h('details', null, h('summary', null, '휴대폰 기능으로도 번역할 수 있어요'), phoneTips());

  function renderKey() {
    const on = geminiEnabled();
    keyBox.hidden = on;
    tips.hidden = !on;
  }

  function showPhoto(p) {
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = p ? URL.createObjectURL(p.blob) : '';
    if (thumbUrl) thumb.setAttribute('src', thumbUrl);
    else thumb.removeAttribute('src');
    thumb.hidden = false;
    noPreview.hidden = true;
    smallNote.hidden = !p?.small;
    photoCard.hidden = !p;
    picks.hidden = Boolean(p);
  }

  /** 진행 중인 요청을 멈춘다. 먼저 비워서 멈춘 요청이 화면을 다시 그리지 않게 한다 */
  function stopRequest() {
    const c = ctrl;
    ctrl = null;
    c?.abort();
  }

  function closePhoto() {
    job++;
    stopRequest();
    img = null;
    showPhoto(null);
    clear(out);
  }

  async function usePhoto(file) {
    const my = ++job;
    stopRequest();
    img = null;
    clear(out).append(loadingLine('사진을 준비하는 중…'));
    let p;
    try {
      p = await prepareImage(file);
    } catch (e) {
      if (my !== job) return;
      showPhoto(null);
      clear(out).append(h('p', { class: 'error-text' }, errorMessage(e)));
      return;
    }
    if (my !== job) return; // 그사이 다른 사진을 골랐거나 닫았다
    img = p;
    showPhoto(p);
    if (shown) run();
    else stopped();
  }

  /** 다른 앱에서 공유받은 사진을 꺼내 번역한다 */
  async function takeShared() {
    const my = ++job;
    stopRequest();
    clear(out).append(loadingLine('공유받은 사진을 여는 중…'));
    let file = null;
    try {
      file = await takeSharedPhoto();
    } catch {
      file = null;
    }
    if (my !== job) return;
    if (file) usePhoto(file);
    else clear(out).append(h('p', { class: 'error-text' }, '공유받은 사진을 찾지 못했습니다. 다시 공유해 주세요.'));
  }

  function stopped() {
    clear(out).append(
      h('p', { class: 'hint' }, '다른 화면으로 가서 멈췄어요.'),
      btn('다시 시도', run, { cls: 'chip', ico: 'back' })
    );
  }

  async function run() {
    if (!img) return;
    if (!geminiEnabled()) {
      clear(out).append(
        h(
          'p',
          { class: 'error-text' },
          '사진 번역은 Gemini API 키가 있어야 합니다. ',
          h('a', { href: '#/settings' }, '설정에서 키 넣기')
        ),
        btn('번역하기', run, { cls: 'chip', ico: 'globe' })
      );
      return;
    }
    stopRequest();
    const c = new AbortController();
    ctrl = c;
    const image = img;
    let frame = 0;
    let latest = {};
    let got = false;
    let wait = '사진 속 글자를 읽고 번역하는 중…';
    const draw = (r, done) => ctrl === c && clear(out).append(...photoResult(r, done, wait));
    // 사진이 크고 인터넷이 느리면 보내는 데만 한참 걸린다
    const slow = setTimeout(() => {
      if (got) return;
      wait = '사진을 보내는 중이에요. 인터넷이 느리면 조금 더 걸려요.';
      draw(latest, false);
    }, SLOW_MS);
    draw(latest, false);
    try {
      const r = await translateImage(image, {
        signal: c.signal,
        onPartial: (p) => {
          got = true;
          latest = p;
          // 조각이 자주 와도 화면은 프레임마다 한 번만 다시 그린다
          frame ||= requestAnimationFrame(() => {
            frame = 0;
            draw(latest, false);
          });
        },
      });
      cancelAnimationFrame(frame);
      if (ctrl !== c) return;
      draw(r, true);
      const item = photoHistoryItem(r);
      if (item) {
        pushTranslateHistory(item);
        onSaved();
      }
    } catch (e) {
      cancelAnimationFrame(frame);
      if (ctrl !== c) return; // 닫았거나 다른 사진으로 바뀌었다
      if (c.signal.reason === LEFT) stopped();
      else if (e.name !== 'AbortError') {
        clear(out).append(
          h('p', { class: 'error-text' }, errorMessage(e)),
          btn('다시 시도', run, { cls: 'chip', ico: 'back' })
        );
      }
    } finally {
      clearTimeout(slow);
      if (ctrl === c) ctrl = null;
    }
  }

  function photoResult(r, done, wait) {
    const blocks = photoBlocks(r);
    const phrases = list(r.phrases).filter((p) => p?.phrase);
    return [
      r.paraphrased
        ? h('p', { class: 'hint' }, '저작권 보호 때문에 원문을 그대로 옮기지 않고 줄여서 보여 드려요.')
        : null,
      r.noteKo ? h('p', { class: 'photo-note' }, r.noteKo) : null,
      blocks.length
        ? h(
            'ol',
            { class: 'live-list' },
            blocks.map((b, i) => blockView(b, done || i < blocks.length - 1, r.paraphrased))
          )
        : null,
      done && !blocks.length && !r.noteKo
        ? h('p', { class: 'muted' }, '사진에서 읽을 수 있는 글자를 찾지 못했어요.')
        : null,
      phrases.length ? phraseList(phrases, done) : null,
      done ? null : loadingLine(blocks.length ? '이어서 받는 중…' : wait),
      done && blocks.some((b) => englishParts(b, r.paraphrased).some(Boolean))
        ? h('p', { class: 'hint' }, '영어 단어를 누르면 뜻을 볼 수 있습니다.')
        : null,
      done && blocks.length
        ? h(
            'div',
            { class: 'row wrap' },
            btn('전체 복사', () => copyWithToast(photoCopyText(r)), { cls: 'btn small ghost', ico: 'copy' }),
            // 요약만 받았으면 고칠 원문이 없다
            r.paraphrased
              ? null
              : btn('글자 고쳐서 다시 번역', () => onEdit(photoSourceText(r), photoLang(r)), {
                  cls: 'btn small ghost',
                  ico: 'edit',
                })
          )
        : null,
    ].filter(Boolean);
  }

  /**
   * 블록에서 영어 단어를 누를 수 있게 보여 줄 곳: [원문, 번역]. 원문이 영어면 원문, 한국어면 번역(영어).
   * 저작권 때문에 요약만 받았으면(paraphrased) 원문 자리는 짧은 이름표라 그냥 글자로 보여 준다
   */
  function englishParts(b, paraphrased) {
    const { from } = blockSides(b);
    return [from === 'en' && !paraphrased, from === 'ko' && Boolean(String(b.translation || '').trim())];
  }

  /**
   * 블록 하나: 원문(영어는 단어를 누를 수 있게)과 번역. 다 받은 블록에만 버튼을 단다.
   * 읽기·단어장 저장은 영어 쪽이 있을 때만 (일본어 등 다른 언어는 한국어 번역만 있다), 요약만 받았으면 복사만
   */
  function blockView(b, complete, paraphrased) {
    const text = String(b.text || '').trim();
    const tr = String(b.translation || '').trim();
    const side = blockSides(b);
    const [tapSrc, tapTr] = englishParts(b, paraphrased);
    const english = (s, cls) => tappableEnglish(s, { source: PHOTO_SOURCE, tag: 'div', cls });
    const en = paraphrased ? '' : side.en;
    return h(
      'li',
      { class: `live-item photo-block from-${side.from === 'ko' ? 'ko' : 'en'}` },
      tapSrc
        ? english(text, 'photo-src')
        : h('div', { class: 'photo-src', lang: side.from === 'other' ? null : side.from }, text),
      tr ? (tapTr ? english(tr, 'photo-tr') : h('div', { class: 'photo-tr', lang: 'ko' }, tr)) : null,
      complete
        ? h(
            'div',
            { class: 'row wrap line-actions' },
            en ? btn('읽기', () => speak(en), { cls: 'chip small', ico: 'volume' }) : null,
            btn('복사', () => copyWithToast([text, tr].filter(Boolean).join('\n')), { cls: 'chip small', ico: 'copy' }),
            en
              ? btn(
                  '단어장 저장',
                  () => {
                    addWord({ text: side.en, meaning: side.ko, type: 'sentence', source: PHOTO_SOURCE });
                    toast('단어장에 저장했습니다');
                  },
                  { cls: 'chip small', ico: 'star' }
                )
              : null
          )
        : null
    );
  }

  function phraseList(phrases, done) {
    return h(
      'div',
      { class: 'stack tight' },
      h('b', { class: 'small' }, '알아 두면 좋은 표현'),
      h(
        'ul',
        { class: 'photo-phrases' },
        phrases.map((p, i) => {
          const complete = done || i < phrases.length - 1;
          return h(
            'li',
            null,
            h(
              'div',
              { class: 'grow' },
              h('b', { lang: 'en' }, p.phrase),
              p.meaningKo ? ` — ${p.meaningKo}` : null,
              p.noteKo ? h('div', { class: 'muted small' }, p.noteKo) : null
            ),
            complete ? iconBtn('volume', '읽기', () => speak(p.phrase), 'icon-btn small') : null,
            complete
              ? btn(
                  '저장',
                  () => {
                    addWord({ text: p.phrase, meaning: p.meaningKo, source: PHOTO_SOURCE });
                    toast(`'${p.phrase}' 저장했습니다`);
                  },
                  { cls: 'chip small', ico: 'star' }
                )
              : null
          );
        })
      )
    );
  }

  window.addEventListener('settings-changed', renderKey);
  renderKey();

  const el = h(
    'div',
    { class: 'stack' },
    h(
      'p',
      { class: 'hint' },
      '메뉴판·안내문·책·화면 캡처처럼 사진 속 글자를 읽어 번역합니다 (영어 → 한국어, 한국어 → 영어). ',
      // 다른 앱에서 공유받기는 안드로이드에서만 된다 (아이폰 사파리는 공유 대상 앱으로 등록할 수 없음)
      isAndroid ? '갤러리에서 공유 → English Helper로 보내도 됩니다.' : null
    ),
    keyBox,
    picks,
    photoCard,
    out,
    h('p', { class: 'hint' }, '사진은 번역할 때만 Google Gemini로 보내고, 앱에는 보관하지 않습니다.'),
    tips,
    camInput,
    pickInput
  );
  return {
    el,
    takeShared,
    usePhoto,
    /** 다른 탭으로 갈 때: 진행 중인 번역을 멈춘다 (돌아와서 다시 시도) */
    leave: () => {
      shown = false;
      ctrl?.abort(LEFT);
    },
    back: () => {
      shown = true;
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
  panels.photo = buildPhotoPanel({
    onEdit: (text, lang) => {
      showMode('text');
      panels.text.setText(text, lang);
    },
    onSaved: () => panels.text.renderHistory(),
  });
  panels.camera = buildCameraPanel({
    // 카메라로 번역한 장면을 사진 번역으로 자세히 (표현 설명·단어장·기록)
    onDetail: (file) => {
      showMode('photo');
      panels.photo.usePhoto(file);
    },
    tips: phoneTips,
  });
  panelBox = h('div');
  modeSeg = segmented(
    [
      { value: 'camera', label: '카메라' },
      { value: 'photo', label: '사진' },
      { value: 'text', label: '텍스트' },
      { value: 'live', label: '실시간 통역' },
      { value: 'record', label: '녹음' },
    ],
    mode,
    showMode,
    { label: '번역 방식' }
  );
  modeSeg.classList.add('modes'); // 5개가 좁은 화면에서도 한 줄에 들어가게 글자 길이만큼 나눈다
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
  showMode(mode);
}

export function show(params) {
  panels.photo.back();
  if (mode === 'camera') panels.camera.enter();
  if (params.get('photo') === 'shared') {
    // 다른 앱에서 공유한 사진 (sw.js가 받아 둠). 새로 고침해도 다시 꺼내지 않게 주소에서 지운다
    history.replaceState(null, '', `${location.pathname}#/translate`);
    showMode('photo');
    panels.photo.takeShared();
    return;
  }
  const text = params.get('text');
  if (text) {
    if (mode !== 'text') showMode('text');
    const ta = panels.text.el.querySelector('textarea');
    ta.value = text;
    panels.text.el.querySelector('.btn.primary').click();
  }
}

/** 다른 탭으로 가면 마이크·카메라를 끄고 사진 번역 요청을 멈춘다 */
export function hide() {
  panels?.live.stop();
  panels?.record.stop();
  panels?.camera.leave();
  panels?.photo.leave();
}
