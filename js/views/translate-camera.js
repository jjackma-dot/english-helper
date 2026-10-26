// 번역 탭 "카메라": 사진을 찍지 않고 카메라로 비추는 동안 글자를 읽어 번역한다 (영어 → 한국어, 한국어 → 영어. Gemini 필요).
// 휴대폰이 멈춰 새 글자를 비추면 그 장면을 Gemini로 보내고(lib/camera-scene.js), 받는 대로 카메라 아래에 보여 준다.
// 같은 글을 계속 비추거나 흔드는 동안·글자가 없는 곳은 보내지 않는다. 장면은 번역할 때만 보내고 앱에 보관하지 않는다.
// 다른 탭·다른 번역 방식으로 가면 카메라를 끄고, 앱을 벗어나면 껐다가 돌아오면 다시 켠다.

import { h, btn, clear, errorMessage } from '../ui.js';
import { icon } from '../icons.js';
import { geminiEnabled } from '../store.js';
import { blockSides, photoBlocks } from '../lib/photo.js';
import { SAMPLE_MS, createSceneWatch } from '../lib/camera-scene.js';
import { cameraSupported, openCamera } from '../services/camera.js';
import { translateFrame } from '../services/translate.js';
import { keepAwake } from '../services/wake-lock.js';
import { tappableEnglish } from '../components/word-sheet.js';

const SOURCE = '카메라 번역';
const IDLE_OFF_MS = 120000; // 이만큼 새로 보낸 장면도, 누른 것도 없으면 카메라를 끈다 (배터리)
const MAX_SENDS = 60; // 한 번 켜서 이만큼 보내면 멈추고 물어본다 (무료 한도 아끼기)

const STATUS = {
  starting: '카메라를 켜는 중…',
  moving: '휴대폰을 잠깐 멈춰 주세요',
  blank: '글자를 비춰 주세요',
  reading: '글자를 읽는 중…',
  same: '다른 글을 비추면 이어서 번역해요',
  soon: '곧 읽어요…',
  held: '번역을 멈췄어요 · 화면을 누르면 이어 가요',
};

/**
 * @param {{onDetail: (file: File) => void, tips: () => HTMLElement}} o
 *   onDetail: 마지막으로 보낸 장면을 사진 번역으로 자세히 (표현 설명·저장·기록), tips: 키 없이 쓰는 휴대폰 기능 안내
 */
export function buildCameraPanel({ onDetail, tips }) {
  let cam = null; // 열린 카메라
  let opening = false; // 카메라를 여는 중 (권한 묻기 포함)
  let job = 0; // 카메라를 열거나 닫을 때마다 늘어남: 그사이 닫았으면 늦게 열린 카메라는 바로 닫는다
  let want = false; // 사용자가 카메라를 켜 둠 (앱을 벗어났다 돌아오면 다시 켠다)
  let shown = false; // 이 칸이 화면에 보이는 중
  let held = false; // 번역을 멈춤 (결과를 읽는 중·많이 보냄·실패)
  let timer = 0;
  let ctrl = null; // 진행 중인 번역 요청
  let watch = createSceneWatch();
  let sends = 0;
  let activeAt = 0; // 마지막으로 보냈거나 누른 때
  let frame = null; // 마지막으로 보낸 장면 (JPEG)
  let shownResult = null; // 화면에 보여 주는 번역 (새 장면에서 글자를 못 찾으면 그대로 둔다)
  let torchOn = false;

  const video = h('video', { class: 'camera-video', playsinline: true, muted: true, autoplay: true });
  const statusEl = h('div', { class: 'camera-status', role: 'status' });
  const frameBox = h(
    'div',
    {
      class: 'camera-frame',
      title: '누르면 바로 다시 읽어요',
      // 화면을 누르면: 멈춰 있으면 이어 가고, 아니면 지금 장면을 바로 다시 읽는다
      onclick: () => (held ? resume() : readNow()),
    },
    video,
    statusEl
  );
  const holdBtn = btn('멈춤', () => (held ? resume() : hold()), { cls: 'btn', ico: 'pause' });
  const torchBtn = btn('손전등', toggleTorch, { cls: 'btn', ico: 'zap' });
  const offBtn = btn('끄기', () => turnOff(), { cls: 'btn danger', ico: 'x' });
  const camCard = h(
    'div',
    { class: 'card camera-card', hidden: true },
    frameBox,
    h('div', { class: 'camera-controls' }, holdBtn, torchBtn, offBtn),
    h('p', { class: 'hint' }, '같은 글을 다시 읽히려면 카메라 화면을 누르세요.')
  );
  const startBtn = h(
    'button',
    { type: 'button', class: 'talk-btn', onclick: start },
    icon('camera', { size: 28 }),
    h('span', null, '카메라 켜기')
  );
  const notice = h('div', { class: 'stack', hidden: true });
  const out = h('div', {
    class: 'stack camera-out',
    // 결과를 누르거나 스크롤하면 읽는 동안 바뀌지 않게 멈춘다
    onpointerdown: () => {
      if (cam && !held && shownResult) hold();
    },
  });
  const keyBox = h(
    'div',
    { class: 'callout stack' },
    h(
      'span',
      null,
      '카메라 번역은 Gemini API 키가 있어야 합니다. ',
      h('a', { href: '#/settings' }, '설정에서 키 넣기')
    ),
    h('span', { class: 'hint' }, '키 없이도 휴대폰 기능으로 비추는 글자를 번역할 수 있어요.'),
    tips()
  );

  /* ---------- 카메라 켜고 끄기 ---------- */

  function start() {
    if (!geminiEnabled() || !cameraSupported) return render();
    want = true;
    open();
  }

  async function open() {
    if (cam || opening) return;
    const my = ++job;
    opening = true;
    held = false;
    hideNotice();
    setStatus(STATUS.starting);
    render();
    let c;
    try {
      c = await openCamera(video, {
        onEnded: () => turnOff('카메라가 끊겼어요. 다시 켜 주세요.'),
        aspect: () => (frameBox.clientHeight ? frameBox.clientWidth / frameBox.clientHeight : 0),
      });
    } catch (e) {
      if (my !== job) return;
      opening = false;
      want = false;
      showNotice(errorMessage(e), true);
      return render();
    }
    if (my !== job) return c.stop(); // 그사이 껐다
    opening = false;
    if (!want || !shown || document.hidden) {
      c.stop();
      return render();
    }
    cam = c;
    torchOn = false;
    watch = createSceneWatch(); // 다시 켜면 지금 비추는 글을 다시 읽는다
    sends = 0;
    activeAt = Date.now();
    timer = setInterval(tick, SAMPLE_MS);
    keepAwake('camera', true);
    render();
    camCard.scrollIntoView({ block: 'start', behavior: 'smooth' }); // 작은 화면에서도 카메라와 그 아래 번역이 보이게
  }

  /** 카메라를 닫는다 (want는 그대로: 앱을 벗어날 때는 돌아오면 다시 켠다) */
  function close() {
    job++;
    opening = false;
    clearInterval(timer);
    timer = 0;
    stopRequest();
    cam?.stop();
    cam = null;
    keepAwake('camera', false);
    render();
  }

  /** 카메라를 끈다 (다시 켜려면 누른다). message가 있으면 왜 껐는지 알린다 */
  function turnOff(message) {
    want = false;
    close();
    if (message) showNotice(message);
  }

  /* ---------- 장면 재고 보내기 ---------- */

  function tick() {
    if (!cam) return;
    const now = Date.now();
    // 멈춰 둔 채(결과를 읽는 중 등) 오래 두어도 끈다
    if (now - activeAt > IDLE_OFF_MS) {
      turnOff('한동안 새로 읽을 글이 없어 카메라를 껐어요 (배터리 아끼기).');
      return;
    }
    if (held) return;
    const gray = cam.sample();
    if (!gray) return;
    const state = watch.push(gray, now);
    if (state === 'ready') send(gray, now);
    else if (watch.busy)
      setStatus(STATUS.reading); // 읽는 동안 움직여도 읽는 중이라고 알린다
    else setStatus(STATUS[state === 'wait' ? 'soon' : state]);
  }

  /** 화면을 눌렀을 때: 기다리지 않고 지금 장면을 읽는다 (읽는 중이면 그대로) */
  function readNow() {
    if (!cam || watch.busy) return;
    activeAt = Date.now();
    const gray = cam.sample();
    if (gray) send(gray, Date.now());
  }

  async function send(gray, now) {
    const w = watch; // 그사이 카메라를 다시 켜 새로 만든 지켜보기를 건드리지 않게
    w.sent(gray, now);
    sends++;
    activeAt = now;
    setStatus(STATUS.reading);
    const c = new AbortController();
    ctrl = c;
    let raf = 0;
    try {
      const jpeg = await cam.capture();
      if (ctrl !== c) return;
      if (!jpeg) throw new Error('카메라 화면을 읽지 못했습니다.');
      const r = await translateFrame(jpeg, {
        signal: c.signal,
        onPartial: (p) => {
          // 새 장면의 블록이 오기 시작하면 앞 결과를 바꾼다 (조각이 자주 와도 프레임마다 한 번만 그린다)
          if (!photoBlocks(p).length) return;
          raf ||= requestAnimationFrame(() => {
            raf = 0;
            if (ctrl === c) draw(p, false);
          });
        },
      });
      cancelAnimationFrame(raf);
      if (ctrl !== c) return;
      if (photoBlocks(r).length) {
        frame = jpeg; // "자세히"는 번역이 나온 장면으로
        draw(r, true);
      } else draw(shownResult ?? r, true, Boolean(shownResult));
      if (sends >= MAX_SENDS) {
        hold();
        showNotice('많이 번역해서 무료 한도를 아끼려고 잠시 멈췄어요.', false, '계속 번역');
      }
    } catch (e) {
      cancelAnimationFrame(raf);
      if (ctrl !== c || e.name === 'AbortError') return;
      w.forget(); // 다시 시도하면 같은 장면도 다시 보낸다
      hold();
      showNotice(errorMessage(e), true, '다시 시도');
    } finally {
      if (ctrl === c) ctrl = null;
      w.done();
    }
  }

  function stopRequest() {
    const c = ctrl;
    ctrl = null;
    c?.abort();
  }

  /** 번역을 멈춘다: 화면을 그 장면에 세워 두고 더 보내지 않는다 (진행 중인 번역은 마저 받는다) */
  function hold() {
    if (!cam || held) return;
    held = true;
    video.pause?.();
    setStatus(STATUS.held);
    render();
  }

  function resume() {
    if (!cam) return start();
    held = false;
    sends = 0;
    activeAt = Date.now();
    hideNotice();
    video.play?.()?.catch?.(() => {});
    render();
  }

  async function toggleTorch() {
    if (!cam?.torch) return;
    if (await cam.setTorch(!torchOn)) torchOn = !torchOn;
    render();
  }

  /* ---------- 화면 ---------- */

  function setStatus(text) {
    if (statusEl.textContent !== text) statusEl.textContent = text;
  }

  /** 알림 (action: 이어 가기 버튼 이름) */
  function showNotice(message, error = false, action = '') {
    clear(notice).append(
      h('p', { class: error ? 'error-text' : 'hint' }, message),
      action ? btn(action, resume, { cls: 'chip', ico: 'play' }) : null
    );
    notice.hidden = false;
  }

  function hideNotice() {
    clear(notice);
    notice.hidden = true;
  }

  /**
   * 번역 결과를 그린다. stale: 이번 장면에서는 글자를 못 찾아 앞 장면의 번역을 그대로 둠
   */
  function draw(r, done, stale = false) {
    const blocks = photoBlocks(r);
    if (done && !stale) shownResult = blocks.length ? r : null;
    clear(out).append(
      ...[
        stale ? h('p', { class: 'hint' }, '이번 장면에서는 글자를 찾지 못했어요. 앞 장면의 번역입니다.') : null,
        r.paraphrased
          ? h('p', { class: 'hint' }, '저작권 보호 때문에 원문을 그대로 옮기지 않고 줄여서 보여 드려요.')
          : null,
        blocks.length
          ? h(
              'ol',
              { class: `live-list${stale ? ' stale' : ''}` },
              blocks.map((b) => blockView(b, r.paraphrased))
            )
          : null,
        done && !blocks.length
          ? h('p', { class: 'muted' }, '글자를 찾지 못했어요. 글자에 조금 더 가까이 비춰 보세요.')
          : null,
        done && blocks.length
          ? h(
              'div',
              { class: 'row wrap' },
              btn('이 장면 자세히 보기', detail, { cls: 'btn small ghost', ico: 'image' })
            )
          : null,
      ].filter(Boolean)
    );
  }

  function blockView(b, paraphrased) {
    const text = String(b.text || '').trim();
    const tr = String(b.translation || '').trim();
    const side = blockSides(b);
    const english = (s, cls) => tappableEnglish(s, { source: SOURCE, tag: 'div', cls });
    return h(
      'li',
      { class: `live-item photo-block from-${side.from === 'ko' ? 'ko' : 'en'}` },
      side.from === 'en' && !paraphrased
        ? english(text, 'photo-src')
        : h('div', { class: 'photo-src', lang: side.from === 'other' ? null : side.from }, text),
      tr ? (side.from === 'ko' ? english(tr, 'photo-tr') : h('div', { class: 'photo-tr', lang: 'ko' }, tr)) : null
    );
  }

  function detail() {
    if (!frame) return;
    const file = new File([frame], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
    turnOff();
    onDetail(file);
  }

  function render() {
    const key = geminiEnabled();
    keyBox.hidden = key;
    startBtn.hidden = !key || !cameraSupported || Boolean(cam) || opening;
    camCard.hidden = !cam && !opening;
    holdBtn.replaceChildren(icon(held ? 'play' : 'pause'), h('span', null, held ? '계속' : '멈춤'));
    holdBtn.disabled = !cam;
    torchBtn.hidden = !cam?.torch;
    torchBtn.classList.toggle('on', torchOn);
    torchBtn.setAttribute('aria-pressed', String(torchOn));
  }

  window.addEventListener('settings-changed', () => {
    if (!geminiEnabled() && (cam || opening)) turnOff(); // 키를 지웠다
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (cam || opening) close(); // 다른 앱을 쓰는 동안 카메라를 붙잡고 있지 않는다
    } else if (want && shown && !cam) open();
  });
  render();

  const el = h(
    'div',
    { class: 'stack' },
    h(
      'p',
      { class: 'hint' },
      '사진을 찍지 않고 카메라로 비추기만 하면 글자를 읽어 번역합니다 (영어 → 한국어, 한국어 → 영어). ' +
        '글자를 비추고 휴대폰을 잠깐 멈추면 읽어요.'
    ),
    keyBox,
    cameraSupported ? null : h('p', { class: 'error-text' }, '이 브라우저는 카메라를 쓸 수 없습니다.'),
    startBtn,
    camCard,
    notice,
    out,
    h('p', { class: 'hint' }, '비추는 장면은 번역할 때만 Google Gemini로 보내고, 앱에는 보관하지 않습니다.')
  );

  return {
    el,
    /** 이 칸이 보임 (카메라는 누를 때 켠다) */
    enter() {
      shown = true;
      render();
    },
    /** 다른 탭·다른 번역 방식으로 감: 카메라를 끈다 */
    leave() {
      shown = false;
      want = false;
      close();
    },
  };
}
