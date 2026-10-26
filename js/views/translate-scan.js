// 번역 탭 "스캔": 카메라로 비추다 "카메라"를 누르면 그 장면을 멈추고 바로 번역하고, "사진"으로 고른 사진(안드로이드는
// 다른 앱에서 공유받은 사진도)을 번역한다. 한국어는 영어로, 영어 등 다른 언어는 한국어로 (Gemini 필요).
// 결과는 맨 위에 전체 번역본 → 전체 원문 → 찍은(고른) 사진 순으로 문장을 나누지 않고 한 번에 보여 주고,
// 맨 아래 질문 칸에서 그 글에 대해 Gemini에게 물을 수 있다. 사진은 번역·질문할 때만 보내고 앱에 보관하지 않는다.
// 다른 탭·다른 번역 방식으로 가면 카메라를 끄고, 앱을 벗어나면 껐다가 돌아오면 다시 켠다.

import { h, btn, iconBtn, clear, copyWithToast, errorMessage, isAndroid } from '../ui.js';
import { icon } from '../icons.js';
import { geminiEnabled, pushTranslateHistory } from '../store.js';
import { scanHistoryItem, scanLang } from '../lib/photo.js';
import { QUESTION_MAX, askAboutScan, scanImage } from '../services/translate.js';
import { prepareImage, takeSharedPhoto } from '../services/photo-file.js';
import { cameraSupported, openCamera } from '../services/camera.js';
import { keepAwake } from '../services/wake-lock.js';
import { speak } from '../speech.js';
import { tappableEnglish } from '../components/word-sheet.js';

const SOURCE = '스캔 번역';
const LEFT = 'left'; // 다른 화면으로 가서 멈춘 요청 (abort 이유)
const STOPPED = 'stopped'; // "멈춤"으로 멈춘 요청
const SLOW_MS = 10000; // 이만큼 지나도 답이 오지 않으면 느린 인터넷 안내
const IDLE_OFF_MS = 180000; // 카메라를 켜 두고 이만큼 찍지 않으면 끈다 (배터리)
const IDLE_CHECK_MS = 5000;
const SPEECH_LANG = { ko: 'ko-KR', en: 'en-US' };
// 원문 언어 → [원문 이름, 번역 이름]
const SIDES = {
  en: ['영어', '한국어'],
  ko: ['한국어', '영어'],
  mixed: ['한국어·영어', '영어·한국어'],
  other: ['외국어', '한국어'],
};

function loadingLine(msg) {
  return h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), msg);
}

/**
 * @param {{onEdit: (text: string, lang: 'en'|'ko'|'other') => void, onSaved: () => void, tips: () => HTMLElement}} o
 *   onEdit: 읽은 원문을 고쳐서 다시 번역하게 텍스트 번역 칸에 넣기, onSaved: 번역 기록에 넣은 뒤,
 *   tips: 키 없이 쓰는 휴대폰 기능 안내
 */
export function buildScanPanel({ onEdit, onSaved, tips }) {
  let view = 'live'; // 'live': 카메라 화면 (꺼져 있을 수도 있음) | 'result': 번역 결과
  let cam = null; // 열린 카메라
  let opening = false; // 카메라를 여는 중 (권한 묻기 포함)
  let camJob = 0; // 카메라를 열거나 닫을 때마다 늘어남: 그사이 닫았으면 늦게 열린 카메라는 바로 닫는다
  let want = false; // 카메라 화면에서 카메라를 켜 둠 (앱을 벗어났다 돌아오면 다시 켠다)
  let camNote = ''; // 카메라가 꺼진 까닭 (권한 거부·끊김·오래 쓰지 않음·멈춤)
  let shown = false; // 이 칸이 화면에 보이는 중
  let activeAt = 0; // 카메라를 켜거나 누른 때 (오래 쓰지 않으면 끈다)
  let idleTimer = 0;
  let torchOn = false;
  let image = null; // 번역할 사진 (prepareImage 결과 모양). 다시 시도·질문은 이것을 그대로 쓴다
  let kind = 'camera'; // 'camera' 찍은 장면 | 'photo' 고른 사진
  let thumbUrl = '';
  let job = 0; // 사진을 고르거나 찍을 때마다 늘어남: 그사이 늦게 끝난 준비를 버린다
  let ctrl = null; // 진행 중인 번역 요청
  let result = null; // 번역 결과 (스트리밍 중이면 지금까지)
  let qa = []; // 질문과 답 [{q, a, done, error}]
  let qCtrl = null; // 진행 중인 질문

  /* ---------- 요소 ---------- */

  const video = h('video', { class: 'camera-video', playsinline: true, muted: true, autoplay: true });
  const camMsg = h('div', { class: 'camera-msg' });
  const statusEl = h('div', { class: 'camera-status', role: 'status' });
  const torchBtn = iconBtn('zap', '손전등', toggleTorch, 'icon-btn camera-torch');
  const frameBox = h(
    'div',
    { class: 'camera-frame', onclick: () => (cam ? shoot() : goLive()) },
    video,
    camMsg,
    statusEl,
    torchBtn
  );
  const pickInput = h('input', {
    type: 'file',
    accept: 'image/*',
    hidden: true,
    onchange: () => {
      const file = pickInput.files?.[0];
      pickInput.value = ''; // 같은 사진을 다시 골라도 알 수 있게
      if (file) usePhoto(file);
    },
  });
  const photoBtn = btn('사진', () => pickInput.click(), { cls: 'btn', ico: 'image' });
  const cameraBtn = btn('카메라', () => (view === 'live' && cam ? shoot() : goLive()), { cls: 'btn', ico: 'camera' });
  const stopBtn = btn('멈춤', stopAll, { cls: 'btn', ico: 'stop' });
  const controls = h('div', { class: 'scan-controls' }, photoBtn, cameraBtn, stopBtn);

  const trBody = h('div', { class: 'scan-body' });
  const trHead = h('div', { class: 'scan-head' });
  const origBody = h('div', { class: 'scan-body' });
  const origHead = h('div', { class: 'scan-head' });
  const shot = h('img', {
    class: 'photo-thumb',
    alt: '번역한 사진',
    onerror: () => {
      // 크롬이 못 여는 HEIF 사진 등 (Gemini에는 원본을 그대로 보낸다)
      shot.hidden = true;
      noPreview.hidden = false;
    },
  });
  const noPreview = h('p', { class: 'hint center', hidden: true }, '미리 볼 수 없는 형식이지만 번역은 됩니다.');
  const shotTitle = h('b', null);
  // 아주 긴 스크롤 캡처는 조각 수에 맞추느라 사진을 줄여 보낸다
  const smallNote = h(
    'p',
    { class: 'hint', hidden: true },
    '아주 긴 캡처라 사진을 줄여서 보내요. 글자가 작아 잘못 읽는 곳이 있을 수 있으니, 그러면 나눠서 캡처해 보세요.'
  );
  const trCard = h('section', { class: 'card scan-card scan-tr' }, trHead, trBody);
  const origCard = h('section', { class: 'card scan-card' }, origHead, origBody);
  const shotCard = h(
    'section',
    { class: 'card scan-card' },
    h('div', { class: 'scan-head' }, shotTitle),
    h('div', { class: 'photo-frame' }, shot, noPreview),
    smallNote
  );
  const resultBox = h('div', { class: 'stack scan-result' }, trCard, origCard, shotCard);

  const qaList = h('ol', { class: 'scan-qa-list' });
  const qInput = h('input', {
    type: 'text',
    class: 'grow',
    maxlength: QUESTION_MAX,
    enterkeyhint: 'send',
    placeholder: '예: 맵지 않은 메뉴는? 이 문장은 언제 써요?',
    'aria-label': '질문',
  });
  const askBtn = btn('질문', null, { cls: 'btn primary', ico: 'send', type: 'submit' });
  const qaBox = h(
    'section',
    { class: 'card scan-qa' },
    h('b', null, '이 글에 대해 Gemini에게 질문하기'),
    qaList,
    h(
      'form',
      {
        class: 'row scan-ask',
        onsubmit: (e) => {
          e.preventDefault();
          ask();
        },
      },
      qInput,
      askBtn
    ),
    h('p', { class: 'hint' }, '원문과 질문은 Google Gemini로 보냅니다. 사진은 앱에 보관하지 않습니다.')
  );

  const keyBox = h(
    'div',
    { class: 'callout stack' },
    h('span', null, '스캔 번역은 Gemini API 키가 있어야 합니다. ', h('a', { href: '#/settings' }, '설정에서 키 넣기')),
    h('span', { class: 'hint' }, '키 없이도 휴대폰 기능으로 사진 속 글자를 번역할 수 있어요.'),
    tips()
  );
  const moreTips = h(
    'details',
    { class: 'scan-tips' },
    h('summary', null, '휴대폰 기능으로도 번역할 수 있어요'),
    // 다른 앱에서 공유받기는 안드로이드에서만 된다 (아이폰 사파리는 공유 대상 앱으로 등록할 수 없음)
    isAndroid ? h('p', { class: 'hint' }, '갤러리에서 공유 → English Helper로 보내도 됩니다.') : null,
    tips()
  );

  /* ---------- 카메라 ---------- */

  /** 카메라 화면으로 가서 카메라를 켠다 (번역 중이던 것과 질문은 멈춘다) */
  function goLive() {
    if (!geminiEnabled()) return render();
    stopRequests();
    view = 'live';
    want = true;
    camNote = '';
    render();
    open();
  }

  async function open() {
    if (cam || opening || !cameraSupported) {
      if (!cameraSupported) camNote = '이 브라우저는 카메라를 쓸 수 없어요. "사진"으로 사진을 골라 주세요.';
      return render();
    }
    const my = ++camJob;
    opening = true;
    render();
    let c;
    try {
      c = await openCamera(video, {
        onEnded: () => camOff('카메라가 끊겼어요. "카메라"를 누르면 다시 켜져요.'),
        aspect: () => (frameBox.clientHeight ? frameBox.clientWidth / frameBox.clientHeight : 0),
      });
    } catch (e) {
      if (my !== camJob) return;
      opening = false;
      want = false;
      camNote = `${errorMessage(e)} "사진"으로 사진을 골라도 됩니다.`;
      return render();
    }
    if (my !== camJob) return c.stop(); // 그사이 껐다
    opening = false;
    if (!want || !shown || view !== 'live' || document.hidden) {
      c.stop();
      return render();
    }
    cam = c;
    torchOn = false;
    activeAt = Date.now();
    idleTimer = setInterval(() => {
      if (Date.now() - activeAt > IDLE_OFF_MS)
        camOff('한동안 쓰지 않아 카메라를 껐어요. "카메라"를 누르면 다시 켜져요.');
    }, IDLE_CHECK_MS);
    keepAwake('scan', true);
    render();
  }

  /** 카메라를 닫는다 (want는 그대로: 앱을 벗어날 때는 돌아오면 다시 켠다) */
  function closeCamera() {
    camJob++;
    opening = false;
    clearInterval(idleTimer);
    idleTimer = 0;
    cam?.stop();
    cam = null;
    keepAwake('scan', false);
  }

  /** 카메라를 끄고 화면에 까닭을 알린다 (다시 켜려면 "카메라") */
  function camOff(note) {
    want = false;
    camNote = note;
    closeCamera();
    render();
  }

  async function toggleTorch(e) {
    e?.stopPropagation(); // 카메라 화면을 누른 것(찍기)으로 치지 않는다
    if (!cam?.torch) return;
    activeAt = Date.now();
    if (await cam.setTorch(!torchOn)) torchOn = !torchOn;
    render();
  }

  /** "카메라": 지금 화면에 보이는 장면을 멈추고(카메라를 끄고) 바로 번역한다 */
  async function shoot() {
    if (!cam) return;
    const c = cam;
    activeAt = Date.now();
    const jpeg = await c.capture();
    if (cam !== c || !jpeg) return; // 그사이 껐거나 아직 그림이 없다
    want = false;
    closeCamera();
    use({ blob: jpeg, pieces: [jpeg], mimeType: 'image/jpeg', small: false }, 'camera');
  }

  /* ---------- 사진 ---------- */

  /** "사진"으로 고른 사진: 카메라를 끄고 보낼 크기로 준비해서 번역한다 */
  async function usePhoto(file) {
    const my = ++job;
    want = false;
    closeCamera();
    stopRequests();
    image = null;
    kind = 'photo';
    view = 'result';
    showThumb(null);
    result = null;
    qa = [];
    render();
    clear(trBody).append(loadingLine('사진을 준비하는 중…'));
    let p;
    try {
      p = await prepareImage(file);
    } catch (e) {
      if (my !== job) return;
      clear(trBody).append(h('p', { class: 'error-text' }, errorMessage(e)));
      return;
    }
    if (my !== job) return; // 그사이 다른 사진을 골랐거나 카메라로 돌아갔다
    use(p, 'photo', my);
  }

  /** 다른 앱에서 공유받은 사진을 꺼내 번역한다 */
  async function takeShared() {
    const my = ++job;
    want = false;
    closeCamera();
    stopRequests();
    view = 'result';
    image = null;
    result = null;
    qa = [];
    showThumb(null);
    render();
    clear(trBody).append(loadingLine('공유받은 사진을 여는 중…'));
    let file = null;
    try {
      file = await takeSharedPhoto();
    } catch {
      file = null;
    }
    if (my !== job) return;
    if (file) usePhoto(file);
    else clear(trBody).append(h('p', { class: 'error-text' }, '공유받은 사진을 찾지 못했습니다. 다시 공유해 주세요.'));
  }

  /** 찍은 장면·준비한 사진을 보여 주고 번역한다 */
  function use(img, k, my = ++job) {
    if (my !== job) return;
    stopRequests();
    image = img;
    kind = k;
    view = 'result';
    result = null;
    qa = [];
    showThumb(img);
    render();
    resultBox.scrollIntoView({ block: 'start', behavior: 'smooth' }); // 번역이 맨 위에 보이게
    if (shown) run();
    else stopped();
  }

  function showThumb(img) {
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = img ? URL.createObjectURL(img.blob) : '';
    if (thumbUrl) shot.setAttribute('src', thumbUrl);
    else shot.removeAttribute('src');
    shot.hidden = !thumbUrl;
    noPreview.hidden = true;
    smallNote.hidden = !img?.small;
  }

  /* ---------- 번역 ---------- */

  function stopRequests(reason) {
    const c = ctrl;
    ctrl = null;
    c?.abort(reason);
    const q = qCtrl;
    qCtrl = null;
    q?.abort();
  }

  function stopped(why = '다른 화면으로 가서 멈췄어요.') {
    clear(trBody).append(h('p', { class: 'hint' }, why), btn('다시 시도', run, { cls: 'chip', ico: 'back' }));
    clear(origBody);
    render();
  }

  async function run() {
    if (!image) return;
    if (!geminiEnabled()) {
      clear(trBody).append(
        h(
          'p',
          { class: 'error-text' },
          '스캔 번역은 Gemini API 키가 있어야 합니다. ',
          h('a', { href: '#/settings' }, '설정에서 키 넣기')
        ),
        btn('번역하기', run, { cls: 'chip', ico: 'globe' })
      );
      return;
    }
    stopRequests();
    const c = new AbortController();
    ctrl = c;
    const img = image;
    result = null;
    qa = [];
    renderQa();
    let frame = 0;
    let latest = {};
    let got = false;
    let wait = '글자를 읽고 번역하는 중…';
    const draw = (r, done) => {
      if (ctrl !== c && !done) return;
      result = { ...r, done };
      renderResult(wait);
      render();
    };
    // 사진이 크고 인터넷이 느리면 보내는 데만 한참 걸린다
    const slow = setTimeout(() => {
      if (got || ctrl !== c) return;
      wait = '사진을 보내는 중이에요. 인터넷이 느리면 조금 더 걸려요.';
      draw(latest, false);
    }, SLOW_MS);
    draw(latest, false);
    try {
      const r = await scanImage(img, {
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
      ctrl = null;
      draw(r, true);
      const item = scanHistoryItem(r);
      if (item) {
        pushTranslateHistory(item);
        onSaved();
      }
    } catch (e) {
      cancelAnimationFrame(frame);
      if (c.signal.reason === LEFT) return stopped();
      if (c.signal.reason === STOPPED) return stopped('번역을 멈췄어요.');
      if (ctrl !== c || e.name === 'AbortError') return; // 다른 사진으로 바뀌었거나 카메라로 돌아갔다
      ctrl = null;
      result = null;
      clear(trBody).append(
        h('p', { class: 'error-text' }, errorMessage(e)),
        btn('다시 시도', run, { cls: 'chip', ico: 'back' })
      );
      clear(origBody);
      render();
    } finally {
      clearTimeout(slow);
    }
  }

  /** 원문 언어로 정한 두 쪽: [원문 언어, 번역 언어] ('en'|'ko'|'other') */
  function sides(r) {
    const from = scanLang(r);
    return [from, from === 'ko' ? 'en' : 'ko'];
  }

  /** 글 한 덩어리: 영어는 단어를 누르면 뜻이 나오게 */
  function textView(text, lang) {
    return lang === 'en'
      ? tappableEnglish(text, { source: SOURCE, tag: 'div', cls: 'scan-text' })
      : h('div', { class: 'scan-text', lang: lang === 'ko' ? 'ko' : null }, text);
  }

  function actions(text, lang, extra) {
    return h(
      'div',
      { class: 'row wrap scan-actions' },
      SPEECH_LANG[lang]
        ? iconBtn('volume', '읽기', () => speak(text, { lang: SPEECH_LANG[lang] }), 'icon-btn small')
        : null,
      iconBtn('copy', '복사', () => copyWithToast(text), 'icon-btn small'),
      extra
    );
  }

  function renderResult(wait) {
    const r = result ?? {};
    const done = Boolean(r.done);
    const original = String(r.original ?? '').trim();
    const translation = String(r.translation ?? '').trim();
    const [from, to] = sides(r);
    const names = SIDES[r.sourceLang] ?? (r.sourceLang ? SIDES[from] : null);

    clear(trHead).append(
      h('b', null, '전체 번역본'),
      names ? h('span', { class: 'muted small' }, `${names[0]} → ${names[1]}`) : null,
      done && translation ? actions(translation, r.sourceLang === 'mixed' ? '' : to) : null
    );
    clear(trBody).append(
      ...[
        r.paraphrased
          ? h('p', { class: 'hint' }, '저작권 보호 때문에 원문을 그대로 옮기지 않고 요약해서 보여 드려요.')
          : null,
        translation ? textView(translation, r.sourceLang === 'mixed' ? 'mixed' : to) : null,
        !done ? loadingLine(original || translation ? '번역하는 중…' : wait) : null,
        done && !translation && !original
          ? h('p', { class: 'muted' }, '사진에서 읽을 수 있는 글자를 찾지 못했어요.')
          : null,
      ].filter(Boolean)
    );
    clear(origHead).append(
      h('b', null, '전체 원문'),
      done && original && !r.paraphrased
        ? actions(
            original,
            r.sourceLang === 'mixed' ? '' : from,
            btn('고쳐서 번역', () => onEdit(original, from), { cls: 'chip small', ico: 'edit' })
          )
        : null
    );
    clear(origBody).append(
      ...[
        original ? textView(original, r.paraphrased || r.sourceLang === 'mixed' ? 'mixed' : from) : null,
        !original && !done ? h('p', { class: 'muted small' }, '읽는 중…') : null,
        !original && done ? h('p', { class: 'muted small' }, '없음') : null,
      ].filter(Boolean)
    );
  }

  /* ---------- 질문 ---------- */

  async function ask() {
    const q = qInput.value.trim();
    if (!q || qCtrl || !result?.done) return qInput.focus();
    const turn = { q, a: '', done: false, error: '' };
    qa.push(turn);
    qInput.value = '';
    const c = new AbortController();
    qCtrl = c;
    renderQa();
    render();
    const history = qa.filter((t) => t.done && !t.error).map(({ q: tq, a }) => ({ q: tq, a }));
    try {
      turn.a = await askAboutScan({ ...result, image }, history, q, {
        signal: c.signal,
        onPartial: (text) => {
          if (qCtrl !== c) return;
          turn.a = String(text);
          renderQa();
        },
      });
    } catch (e) {
      if (qCtrl !== c) return; // 멈췄거나 다른 사진으로 바뀌었다
      turn.error = errorMessage(e);
    } finally {
      if (qCtrl === c) {
        qCtrl = null;
        turn.done = true;
        renderQa();
        render();
      }
    }
  }

  function renderQa() {
    clear(qaList).append(
      ...qa.map((t, i) =>
        h(
          'li',
          { class: 'scan-qa-item' },
          h('div', { class: 'scan-q' }, t.q),
          t.error
            ? h('p', { class: 'error-text' }, t.error)
            : t.a
              ? h('div', { class: 'scan-a' }, t.a)
              : i === qa.length - 1 && !t.done
                ? loadingLine('답을 쓰는 중…')
                : null
        )
      )
    );
    qaList.lastChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ---------- 멈춤 ---------- */

  /** "멈춤": 번역·질문을 멈추고 카메라를 끈다 */
  function stopAll() {
    const translating = Boolean(ctrl);
    if (translating) stopRequests(STOPPED);
    else stopRequests();
    if (view === 'live' && (cam || opening)) camOff('카메라를 껐어요. "카메라"를 누르면 다시 켜져요.');
    else closeCamera();
    render();
  }

  /* ---------- 화면 ---------- */

  function render() {
    const key = geminiEnabled();
    const live = view === 'live';
    keyBox.hidden = key;
    frameBox.hidden = !key || !live;
    controls.hidden = !key;
    resultBox.hidden = !key || live;
    qaBox.hidden = !key || live || !result?.done || !(result.original || result.translation);
    moreTips.hidden = !key || !live;
    video.hidden = !cam;
    camMsg.hidden = Boolean(cam) || opening;
    camMsg.textContent = camNote || '"카메라"를 누르면 카메라가 켜져요.';
    statusEl.textContent = opening ? '카메라를 켜는 중…' : cam ? '글자를 화면에 맞추고 "카메라"를 누르세요' : '';
    torchBtn.hidden = !cam?.torch;
    torchBtn.classList.toggle('on', torchOn);
    torchBtn.setAttribute('aria-pressed', String(torchOn));
    cameraBtn.classList.toggle('primary', live);
    stopBtn.disabled = !(cam || opening || ctrl || qCtrl);
    shotTitle.textContent = kind === 'camera' ? '찍은 사진' : '고른 사진';
    askBtn.disabled = Boolean(qCtrl);
  }

  window.addEventListener('settings-changed', () => {
    if (!geminiEnabled()) {
      want = false;
      closeCamera(); // 키를 지웠다
    }
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (cam || opening) closeCamera(); // 다른 앱을 쓰는 동안 카메라를 붙잡고 있지 않는다
      render();
    } else if (want && shown && view === 'live' && !cam) open();
  });
  render();

  const el = h('div', { class: 'stack' }, keyBox, resultBox, frameBox, controls, qaBox, moreTips, pickInput);

  return {
    el,
    takeShared,
    /**
     * 이 칸이 보임. camera: "스캔"을 눌러 들어옴 → 바로 카메라를 켠다.
     * 아니면(다른 탭에서 돌아옴) 카메라를 켜 두었으면 다시 켜고, 번역 결과를 보던 중이면 그대로 둔다
     */
    enter({ camera = false } = {}) {
      shown = true;
      if (camera) return goLive();
      if (view === 'live' && want) open();
      render();
    },
    /** 다른 탭·다른 번역 방식으로 감: 카메라를 끄고, 진행 중인 번역은 멈춘다 (돌아와서 다시 시도) */
    leave() {
      shown = false;
      closeCamera();
      if (ctrl) stopRequests(LEFT);
      else stopRequests();
      render();
    },
  };
}
