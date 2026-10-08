// 4) OTT 영어학습 도우미: 같은 작품의 자막 파일을 재생 시간에 맞춰 따라가다가,
//    "되감기"를 누르면 최근 N초 동안의 영어 대사를 해석·발음과 함께 보여준다.
//    (넷플릭스·웨이브 앱은 다른 앱이 화면·재생을 제어할 수 없어서 자막 파일로 동기화한다)

import { h, btn, iconBtn, clear, toast, errorMessage, toggle, openSheet, field } from '../ui.js';
import { icon } from '../icons.js';
import {
  getSettings,
  updateSettings,
  geminiEnabled,
  addWord,
  saveSubtitle,
  getSubtitle,
  listSubtitles,
  updateSubtitle,
  deleteSubtitle,
} from '../store.js';
import { PlaybackClock } from '../lib/clock.js';
import { formatClock, parseClock } from '../lib/timefmt.js';
import {
  SUBTITLE_ACCEPT,
  decodeSubtitleBuffer,
  parseSubtitles,
  pairTracks,
  pickTrack,
  activeCues,
  lastStartedIndex,
  reviewWindow,
} from '../lib/subtitles.js';
import { translate } from '../services/translate.js';
import { aiExplainLine } from '../services/dictionary.js';
import { speak, stopSpeaking } from '../speech.js';
import { tappableEnglish } from '../components/word-sheet.js';

const REWIND_CHOICES = [5, 10, 15, 20, 30];
const RATES = [0.5, 0.75, 1, 1.25, 1.5];

const clock = new PlaybackClock();
let root;
let libraryEl;
let playerEl;
let current = null; // { id, title, cues, hasKo }
let ui = {};
let tickTimer = 0;
let lastSaved = 0;
let lastCueKey = '';
let wakeLock = null;
let visible = false;

/* ================= 보관함(불러오기) 화면 ================= */

function fileButton(label, onFile, { ico = 'upload' } = {}) {
  const input = h('input', {
    type: 'file',
    accept: SUBTITLE_ACCEPT,
    class: 'visually-hidden',
    onchange: () => {
      const f = input.files?.[0];
      if (f) onFile(f);
    },
  });
  const nameEl = h('span', { class: 'file-name muted small' }, '선택 안 함');
  const b = btn(label, () => input.click(), { cls: 'btn', ico });
  return {
    el: h('div', { class: 'file-pick' }, b, nameEl, input),
    setName: (n) => (nameEl.textContent = n || '선택 안 함'),
    reset: () => {
      input.value = '';
      nameEl.textContent = '선택 안 함';
    },
  };
}

async function readSubtitleFile(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name}: 자막 파일이 너무 큽니다 (5MB 이하).`);
  const text = decodeSubtitleBuffer(await file.arrayBuffer());
  return parseSubtitles(text, file.name);
}

/** 영어 자막(+선택: 한글 자막)을 읽어 보관함에 저장하고 연다 */
async function importSubtitles({ enFile, koFile, enText, koText, title, files }) {
  const enParsed = enFile ? await readSubtitleFile(enFile) : parseSubtitles(enText, files?.[0] || '');
  const en = pickTrack(enParsed.tracks, 'en') || enParsed.tracks.find((t) => t.lang !== 'ko');
  if (!en)
    throw new Error('영어 대사를 찾지 못했습니다. 영어 자막 파일을 선택하세요 (한글 자막은 아래 칸에 넣습니다).');
  let ko = pickTrack(
    enParsed.tracks.filter((t) => t !== en),
    'ko'
  );
  if (koFile || koText) {
    const koParsed = koFile ? await readSubtitleFile(koFile) : parseSubtitles(koText, files?.[1] || '');
    ko = pickTrack(koParsed.tracks, 'ko') || koParsed.tracks[0];
  }
  const cues = pairTracks(en.cues, ko?.cues);
  const rec = await saveSubtitle({
    title: title || '제목 없음',
    cues,
    hasKo: Boolean(ko),
    files: files || [enFile?.name, koFile?.name].filter(Boolean),
  });
  return rec;
}

function buildLibrary() {
  let enFile = null;
  let koFile = null;
  const titleInput = h('input', { type: 'text', placeholder: '예: Friends S01E01' });
  const enPick = fileButton('영어 자막 선택', (f) => {
    enFile = f;
    enPick.setName(f.name);
    if (!titleInput.value)
      titleInput.value = f.name
        .replace(/\.[^.]+$/, '')
        .replace(/[._]+/g, ' ')
        .trim();
  });
  const koPick = fileButton('한글 자막 선택 (선택)', (f) => {
    koFile = f;
    koPick.setName(f.name);
  });
  const listBox = h('div', { class: 'stack' });

  const loadBtn = btn(
    '불러와서 시작',
    async () => {
      if (!enFile) return toast('먼저 영어 자막 파일을 선택하세요.');
      loadBtn.disabled = true;
      try {
        const rec = await importSubtitles({ enFile, koFile, title: titleInput.value.trim() });
        enFile = koFile = null;
        enPick.reset();
        koPick.reset();
        titleInput.value = '';
        openPlayer(rec);
      } catch (e) {
        toast(errorMessage(e), { ms: 5000 });
      } finally {
        loadBtn.disabled = false;
      }
    },
    { cls: 'btn primary', ico: 'play' }
  );

  const sampleBtn = btn(
    '샘플 자막으로 체험하기',
    async () => {
      try {
        const [en, ko] = await Promise.all(
          ['samples/sample-en.srt', 'samples/sample-ko.srt'].map((u) => fetch(u).then((r) => r.text()))
        );
        const rec = await importSubtitles({
          enText: en,
          koText: ko,
          title: '샘플: 카페에서 생긴 일',
          files: ['sample-en.srt', 'sample-ko.srt'],
        });
        openPlayer(rec);
      } catch (e) {
        toast(errorMessage(e));
      }
    },
    { cls: 'btn ghost', ico: 'film' }
  );

  async function renderList() {
    clear(listBox);
    let items = [];
    try {
      items = await listSubtitles();
    } catch (e) {
      listBox.append(h('p', { class: 'error-text' }, errorMessage(e)));
      return;
    }
    if (!items.length) {
      listBox.append(h('p', { class: 'muted' }, '저장된 자막이 없습니다.'));
      return;
    }
    for (const it of items) {
      listBox.append(
        h(
          'div',
          { class: 'lib-item' },
          h(
            'button',
            {
              type: 'button',
              class: 'lib-open',
              onclick: async () => {
                const rec = await getSubtitle(it.id);
                if (rec) openPlayer(rec);
              },
            },
            h('b', null, it.title),
            h(
              'span',
              { class: 'muted small' },
              `대사 ${it.cueCount}개${it.hasKo ? ' · 한글 자막 포함' : ''} · 마지막 위치 ${formatClock(it.position || 0)}`
            )
          ),
          iconBtn('trash', '삭제', async () => {
            if (!confirm(`'${it.title}' 자막을 삭제할까요?`)) return;
            await deleteSubtitle(it.id);
            renderList();
          })
        )
      );
    }
  }

  const el = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'intro' },
      h(
        'p',
        null,
        '넷플릭스·웨이브 앱은 다른 앱이 화면이나 재생을 제어할 수 없습니다. 대신 ',
        h('b', null, '같은 작품의 영어 자막 파일'),
        '을 불러와 재생 시간에 맞춰 따라가다가, 놓친 대사를 ',
        h('b', null, '되감기 버튼'),
        '으로 바로 확인합니다.'
      )
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', { class: 'card-title' }, icon('upload'), '자막 불러오기'),
      h(
        'p',
        { class: 'hint' },
        'SRT · VTT · SMI · TTML(DFXP) 지원. 영어·한글이 함께 든 SMI 파일은 영어 칸에만 넣으면 됩니다.'
      ),
      enPick.el,
      koPick.el,
      field('제목', titleInput),
      h('div', { class: 'stack actions' }, loadBtn, sampleBtn)
    ),
    h('section', { class: 'card' }, h('h3', { class: 'card-title' }, icon('list'), '내 자막 보관함'), listBox),
    h(
      'details',
      { class: 'card tips' },
      h('summary', null, icon('info'), ' 사용 방법'),
      h(
        'ol',
        null,
        h(
          'li',
          null,
          '보고 있는 작품·회차의 영어 자막 파일을 준비해 불러옵니다. 한글 자막도 넣으면 해석이 함께 나옵니다.'
        ),
        h(
          'li',
          null,
          h('b', null, '화면 배치: '),
          'TV로 보면서 휴대폰으로 쓰거나, 안드로이드 ',
          h('b', null, '분할 화면'),
          '(최근 앱 → 앱 아이콘 → 분할 화면으로 열기) 또는 넷플릭스 ',
          h('b', null, 'PIP(작은 창)'),
          '로 함께 띄웁니다. 기기·앱에 따라 지원되지 않을 수 있습니다.'
        ),
        h(
          'li',
          null,
          h('b', null, '시간 맞추기: '),
          '넷플릭스 재생과 동시에 ▶를 누르거나, 재생 바의 시간을 "시간 입력"에 넣습니다. 첫 대사가 나올 때 전체 대사 목록에서 그 대사를 눌러 "이 대사로 시간 맞추기"를 하면 가장 정확합니다.'
        ),
        h(
          'li',
          null,
          h('b', null, '되감기: '),
          '대사를 놓치면 넷플릭스의 ⟲10 버튼과 함께 이 앱의 "10초 되감기"를 누르세요. 최근 10초 대사가 해석·발음과 함께 나타나고, 앱 시계도 10초 돌아가 다시 맞춰집니다.'
        ),
        h(
          'li',
          null,
          h('b', null, '듣기 연습: '),
          '"영어 대사 숨기기"를 켜면 평소엔 대사를 가리고, 되감기를 눌렀을 때만 보여 줍니다.'
        ),
        h(
          'li',
          null,
          '자막 파일은 직접 구한 개인 학습용 파일을 사용하세요. 자막의 저작권은 제작사에 있으므로 공유·배포하지 마세요.'
        )
      )
    )
  );
  return { el, renderList };
}

/* ================= 재생(동기화) 화면 ================= */

function secondsUntil(cue, t) {
  return cue ? Math.max(0, Math.ceil(cue.start - t)) : -1;
}

function cueKey(cues) {
  return cues.map((c) => `${c.start}`).join('|');
}

function buildPlayer() {
  const s = getSettings();
  ui.title = h('h2', { class: 'ott-title' });
  ui.time = h('button', { type: 'button', class: 'clock', title: '눌러서 시간 입력', onclick: editTime });
  ui.status = h('span', { class: 'badge' });
  ui.playBtn = h('button', { type: 'button', class: 'play-btn', 'aria-label': '재생/일시정지', onclick: togglePlay });
  ui.current = h('div', { class: 'current-line', 'aria-live': 'off' });
  ui.review = h('div', { class: 'review' });
  ui.listBox = h('ol', { class: 'cue-list' });
  ui.listSearch = h('input', { type: 'search', placeholder: '대사 검색', oninput: renderCueList });
  ui.rewindLabel = h('span');
  ui.rewindBtn = h(
    'button',
    { type: 'button', class: 'rewind-btn', onclick: rewind },
    icon('back', { size: 26 }),
    ui.rewindLabel
  );
  ui.rewindChips = h(
    'div',
    { class: 'segmented small', role: 'group', 'aria-label': '되감기 초' },
    REWIND_CHOICES.map((sec) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(sec === s.rewindSeconds),
          dataset: { sec },
          onclick: () => setRewind(sec),
        },
        `${sec}초`
      )
    )
  );
  const rateSelect = h(
    'select',
    {
      class: 'rate-select',
      'aria-label': '재생 속도',
      onchange: () => {
        clock.setRate(+rateSelect.value);
        updateSettings({ ottRate: +rateSelect.value });
      },
    },
    RATES.map((r) => h('option', { value: r, selected: r === s.ottRate }, `${r}배속`))
  );
  clock.setRate(s.ottRate);

  const nudge = (d, label) => btn(label, () => shift(d), { cls: 'nudge' });

  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'row between' }, btn('보관함', closePlayer, { cls: 'btn small ghost', ico: 'list' }), ui.title),
    h(
      'section',
      { class: 'card clock-card' },
      h('div', { class: 'row between' }, ui.time, ui.status),
      h(
        'div',
        { class: 'transport' },
        nudge(-5, '−5초'),
        nudge(-1, '−1초'),
        ui.playBtn,
        nudge(1, '+1초'),
        nudge(5, '+5초')
      ),
      h('div', { class: 'row between' }, btn('시간 입력', editTime, { cls: 'chip', ico: 'clock' }), rateSelect)
    ),
    ui.current,
    h(
      'div',
      { class: 'stack rewind-box' },
      ui.rewindChips,
      h('p', { class: 'hint center' }, '넷플릭스·웨이브의 ⟲10 버튼과 함께 누르세요.')
    ),
    ui.review,
    h(
      'details',
      { class: 'card' },
      h('summary', null, icon('settings'), ' 표시 설정'),
      toggle(
        '한글 해석 보이기',
        s.ottShowKorean,
        (v) => {
          updateSettings({ ottShowKorean: v });
          lastCueKey = '';
          render();
        },
        '끄면 해석을 가리고, 눌렀을 때만 보여 줍니다'
      ),
      toggle(
        '영어 대사 숨기기 (듣기 연습)',
        s.ottHideEnglish,
        (v) => {
          updateSettings({ ottHideEnglish: v });
          lastCueKey = '';
          render();
        },
        '되감기를 눌렀을 때만 대사를 보여 줍니다'
      ),
      toggle(
        '되감기할 때 앱 시계도 되돌리기',
        s.ottRewindClock !== false,
        (v) => updateSettings({ ottRewindClock: v }),
        '넷플릭스에서 되감지 않고 대사만 볼 때는 끄세요'
      )
    ),
    h(
      'details',
      {
        class: 'card',
        ontoggle: (e) => {
          if (e.target.open) renderCueList();
        },
      },
      h('summary', null, icon('list'), ' 전체 대사 · 시간 맞추기'),
      h('p', { class: 'hint' }, '대사를 누르면 해석·발음·저장과 "이 대사로 시간 맞추기"를 할 수 있습니다.'),
      ui.listSearch,
      ui.listBox
    ),
    // 되감기 버튼은 맨 아래에 두고 화면 아래쪽에 붙여(sticky), 어디까지 스크롤해도·분할 화면에서도 바로 누를 수 있게 한다
    ui.rewindBtn
  );
}

function setRewind(sec) {
  updateSettings({ rewindSeconds: sec });
  for (const b of ui.rewindChips.children) b.setAttribute('aria-pressed', String(+b.dataset.sec === sec));
  ui.rewindLabel.textContent = `${sec}초 되감기 · 대사 보기`;
}

function openPlayer(rec) {
  current = { id: rec.id, title: rec.title, cues: rec.cues, hasKo: rec.hasKo };
  clock.pause();
  clock.set(rec.position || 0);
  lastCueKey = '';
  ui.title.textContent = rec.title;
  setRewind(getSettings().rewindSeconds);
  clear(ui.review);
  ui.listSearch.value = '';
  clear(ui.listBox);
  libraryEl.hidden = true;
  playerEl.hidden = false;
  updateSubtitle(rec.id, { openedAt: Date.now() }).catch(() => {});
  startTicking();
  render();
  window.scrollTo({ top: 0 });
}

function closePlayer() {
  savePosition(true);
  clock.pause();
  releaseWakeLock();
  stopTicking();
  current = null;
  playerEl.hidden = true;
  libraryEl.hidden = false;
  library.renderList();
}

function togglePlay() {
  clock.toggle();
  if (clock.running) requestWakeLock();
  else {
    releaseWakeLock();
    savePosition(true);
  }
  render();
}

function shift(d) {
  clock.shift(d);
  lastCueKey = '';
  render();
}

function syncTo(cue) {
  clock.set(cue.start);
  lastCueKey = '';
  render();
  toast(`${formatClock(cue.start)} 로 맞췄습니다${clock.running ? '' : ' — ▶를 눌러 재생하세요'}`);
}

function editTime() {
  const wasRunning = clock.running;
  const input = h('input', {
    type: 'text',
    inputmode: 'decimal',
    value: formatClock(clock.time),
    'aria-label': '재생 시간',
  });
  let close;
  const apply = () => {
    const t = parseClock(input.value);
    if (t == null) {
      toast('시간 형식을 확인하세요. 예: 12:34 또는 1:02:03');
      return;
    }
    clock.set(t);
    lastCueKey = '';
    render();
    close();
  };
  close = openSheet({
    title: '재생 시간 입력',
    content: h(
      'form',
      {
        class: 'stack',
        onsubmit: (e) => {
          e.preventDefault();
          apply();
        },
      },
      h(
        'p',
        { class: 'hint' },
        '넷플릭스 재생 바에 보이는 시간을 입력하세요. 넷플릭스는 남은 시간을 보여 주기도 하니 주의하세요.'
      ),
      input,
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'submit', class: 'btn primary' }, '맞추기'),
        wasRunning ? h('span', { class: 'hint' }, '시계는 계속 흘러갑니다') : null
      )
    ),
  });
  input.select();
}

/* ---------- 매 순간 화면 갱신 ---------- */

function startTicking() {
  stopTicking();
  tickTimer = setInterval(render, 200);
}

function stopTicking() {
  clearInterval(tickTimer);
  tickTimer = 0;
}

function render() {
  if (!current || !visible) return;
  const t = clock.time;
  const s = getSettings();
  ui.time.textContent = formatClock(t, { withTenths: true });
  ui.status.textContent = clock.running ? `재생 중${clock.rate !== 1 ? ` · ${clock.rate}배` : ''}` : '일시정지';
  ui.status.classList.toggle('live', clock.running);
  if (ui.playBtn.dataset.running !== String(clock.running)) {
    ui.playBtn.dataset.running = String(clock.running);
    ui.playBtn.replaceChildren(icon(clock.running ? 'pause' : 'play', { size: 30 }));
  }

  const act = activeCues(current.cues, t);
  // 대사 사이에는 "다음 대사까지 N초" 표시가 바뀔 때마다 다시 그린다
  const gapKey = act.length ? '' : `gap${secondsUntil(current.cues[lastStartedIndex(current.cues, t) + 1], t)}`;
  const key = cueKey(act) + gapKey + (s.ottHideEnglish ? 'H' : '') + (s.ottShowKorean ? 'K' : '');
  if (key !== lastCueKey) {
    lastCueKey = key;
    renderCurrent(act, t, s);
    highlightList(t);
  }
  if (clock.running && Date.now() - lastSaved > 5000) savePosition();
}

function renderCurrent(act, t, s) {
  clear(ui.current);
  if (s.ottHideEnglish) {
    ui.current.append(
      h(
        'div',
        { class: 'hidden-line' },
        icon('eyeOff'),
        act.length ? ' 대사 진행 중 — 못 알아들었으면 되감기!' : ' 듣기 연습 중'
      )
    );
    return;
  }
  if (act.length) {
    for (const c of act) {
      ui.current.append(
        h(
          'div',
          { class: 'now' },
          tappableEnglish(c.text, { source: current.title, tag: 'div', cls: 'en-line big' }),
          c.ko ? koLine(c.ko, s.ottShowKorean) : null
        )
      );
    }
    return;
  }
  const idx = lastStartedIndex(current.cues, t);
  const next = current.cues[idx + 1];
  ui.current.append(
    h(
      'div',
      { class: 'between-lines muted' },
      idx >= 0 ? h('div', { class: 'prev', lang: 'en' }, current.cues[idx].text) : null,
      h(
        'div',
        { class: 'small' },
        !next
          ? '마지막 대사가 지났습니다'
          : idx < 0
            ? `첫 대사까지 ${secondsUntil(next, t)}초 — 넷플릭스 재생과 함께 ▶를 누르세요`
            : `다음 대사까지 ${secondsUntil(next, t)}초`
      )
    )
  );
}

function koLine(text, shown) {
  const el = h(
    'div',
    { class: `ko-line${shown ? '' : ' spoiler'}`, lang: 'ko', title: shown ? undefined : '눌러서 해석 보기' },
    text
  );
  if (!shown) el.addEventListener('click', () => el.classList.toggle('revealed'));
  return el;
}

/* ---------- 되감기 · 대사 복습 ---------- */

function rewind() {
  if (!current) return;
  const s = getSettings();
  const secs = s.rewindSeconds;
  const t = clock.time;
  const { cues, fallback } = reviewWindow(current.cues, t, secs);
  if (s.ottRewindClock !== false) clock.shift(-secs);
  lastCueKey = '';
  render();
  showReview(cues, Math.max(0, t - secs), t, fallback);
}

function lineView(cue, { withSync = false, context = '' } = {}) {
  const s = getSettings();
  const extra = h('div', { class: 'stack' });
  const flat = cue.text.replace(/\n/g, ' ');
  const transBtn = cue.ko
    ? null
    : btn(
        '해석',
        async () => {
          transBtn.disabled = true;
          try {
            const r = await translate(flat, 'en', 'ko');
            cue.ko = r.text;
            transBtn.replaceWith(koLine(r.text, true));
          } catch (e) {
            toast(errorMessage(e));
            transBtn.disabled = false;
          }
        },
        { cls: 'chip small', ico: 'globe' }
      );
  const aiBtn = geminiEnabled()
    ? btn(
        'AI 해설',
        async () => {
          aiBtn.disabled = true;
          clear(extra).append(h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), '해설을 만드는 중…'));
          try {
            const r = await aiExplainLine(flat, { context });
            clear(extra).append(
              h(
                'div',
                { class: 'callout ai' },
                h('p', null, h('b', null, '해석 '), r.translation || ''),
                Array.isArray(r.expressions) && r.expressions.length
                  ? h(
                      'ul',
                      null,
                      r.expressions.map((x) =>
                        h(
                          'li',
                          null,
                          h('b', { lang: 'en' }, x.phrase),
                          ` — ${x.meaning}`,
                          x.note ? h('div', { class: 'muted small' }, x.note) : null
                        )
                      )
                    )
                  : null,
                r.note ? h('p', { class: 'muted small' }, r.note) : null
              )
            );
            aiBtn.remove();
          } catch (e) {
            clear(extra).append(h('p', { class: 'error-text' }, errorMessage(e)));
            aiBtn.disabled = false;
          }
        },
        { cls: 'chip small', ico: 'zap' }
      )
    : null;
  return h(
    'div',
    { class: 'line' },
    h('div', { class: 'line-time muted small' }, formatClock(cue.start)),
    tappableEnglish(cue.text, { source: current.title, tag: 'div', cls: 'en-line' }),
    cue.ko ? koLine(cue.ko, s.ottShowKorean) : null,
    h(
      'div',
      { class: 'row wrap line-actions' },
      btn('읽기', () => speak(flat), { cls: 'chip small', ico: 'volume' }),
      btn('천천히', () => speak(flat, { rate: 0.65 }), { cls: 'chip small' }),
      transBtn,
      aiBtn,
      btn(
        '저장',
        () => {
          addWord({
            text: flat,
            meaning: cue.ko || '',
            type: 'sentence',
            source: current.title,
            context: formatClock(cue.start),
          });
          toast('대사를 단어장에 저장했습니다');
        },
        { cls: 'chip small', ico: 'star' }
      ),
      withSync
        ? btn('이 대사로 시간 맞추기', () => (syncTo(cue), document.querySelector('dialog.sheet')?.close()), {
            cls: 'chip small',
            ico: 'target',
          })
        : null
    ),
    extra
  );
}

function showReview(cues, from, to, fallback) {
  clear(ui.review);
  const head = h(
    'div',
    { class: 'row between' },
    h(
      'h3',
      { class: 'card-title' },
      icon('rewind'),
      fallback ? '직전 대사' : `최근 ${getSettings().rewindSeconds}초 대사`
    ),
    iconBtn('x', '닫기', () => (stopSpeaking(), clear(ui.review)))
  );
  if (!cues.length) {
    ui.review.append(
      h(
        'section',
        { class: 'card review-card' },
        head,
        h('p', { class: 'muted' }, '이 구간에는 대사가 없습니다. 시간이 맞는지 확인하세요.')
      )
    );
    return;
  }
  const playAll = async () => {
    for (const c of cues) {
      await speak(c.text.replace(/\n/g, ' '));
    }
  };
  ui.review.append(
    h(
      'section',
      { class: 'card review-card' },
      head,
      h(
        'p',
        { class: 'muted small' },
        `${formatClock(from)} ~ ${formatClock(to)}${fallback ? ' 구간이 조용해서 바로 앞 대사를 보여 드립니다' : ''}`
      ),
      cues.map((c, i) =>
        lineView(c, {
          context: cues
            .slice(Math.max(0, i - 2), i)
            .map((x) => x.text)
            .join('\n'),
        })
      ),
      btn('전부 읽기', playAll, { cls: 'btn small ghost', ico: 'volume' })
    )
  );
  ui.review.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/* ---------- 전체 대사 목록 ---------- */

function renderCueList() {
  if (!current) return;
  clear(ui.listBox);
  const q = ui.listSearch.value.trim().toLowerCase();
  const frag = document.createDocumentFragment();
  current.cues.forEach((c, i) => {
    if (q && !c.text.toLowerCase().includes(q) && !(c.ko || '').includes(q)) return;
    frag.append(
      h(
        'li',
        { dataset: { i } },
        h(
          'button',
          {
            type: 'button',
            class: 'cue-row',
            onclick: () =>
              openSheet({
                title: formatClock(c.start),
                content: lineView(c, {
                  withSync: true,
                  context: current.cues
                    .slice(Math.max(0, i - 2), i)
                    .map((x) => x.text)
                    .join('\n'),
                }),
              }),
          },
          h('span', { class: 'muted small mono' }, formatClock(c.start)),
          h('span', { class: 'cue-text', lang: 'en' }, c.text)
        )
      )
    );
  });
  ui.listBox.append(frag);
  highlightList(clock.time, true);
}

let highlighted = -1;
function highlightList(t, force = false) {
  if (!ui.listBox.childElementCount) return;
  const idx = lastStartedIndex(current.cues, t);
  if (idx === highlighted && !force) return;
  ui.listBox.querySelector('li.on')?.classList.remove('on');
  highlighted = idx;
  ui.listBox.querySelector(`li[data-i="${idx}"]`)?.classList.add('on');
}

/* ---------- 위치 저장 · 화면 꺼짐 방지 ---------- */

function savePosition(force = false) {
  if (!current) return;
  if (!force && Date.now() - lastSaved < 5000) return;
  lastSaved = Date.now();
  updateSubtitle(current.id, { position: clock.time }).catch(() => {});
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    wakeLock = null; // 배터리 절약 모드 등에서는 거부될 수 있다
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

/* ================= 화면 진입점 ================= */

let library;

export function init(el) {
  root = el;
  library = buildLibrary();
  libraryEl = library.el;
  playerEl = buildPlayer();
  playerEl.hidden = true;
  root.append(libraryEl, playerEl);
  library.renderList();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && clock.running && current) requestWakeLock();
    if (document.visibilityState === 'hidden') savePosition(true);
  });
  document.addEventListener('keydown', (e) => {
    if (!visible || !current || e.target.closest('input, textarea, select, dialog')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      rewind();
    }
  });
}

export function show() {
  visible = true;
  if (current) {
    lastCueKey = '';
    render();
  }
}

export function hide() {
  // 다른 탭(사전 등)을 보는 동안에도 시계는 계속 흐른다. 화면 갱신만 쉰다.
  visible = false;
  savePosition(true);
}
