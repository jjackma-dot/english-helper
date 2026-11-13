// 레벨테스트: 토익스피킹과 비슷한 다섯 유형(문장 읽기·사진 묘사·질문에 답하기·표 보고 답하기·의견 말하기)을 학교·일상 주제로
// 7문항, 약 10분 안에 본다. 응시자(가족)와 난이도(일반·쉬움)를 고르면 문제 은행에서 최근에 풀지 않은 문제를 섞어 낸다.
// 답은 문항마다 녹음해 Azure 음성 평가(발음·유창성·억양)와 Gemini(문법·어휘·과제 수행)로 채점하고, 총점을 토익스피킹 점수·등급과
// OPIc 등급으로 예상해 성적표로 보여 준다. 결과(녹음 빼고)는 이 기기에 남고, 목록에서 누르면 다시 본다.

import { h, btn, iconBtn, clear, toast, segmented, errorMessage, externalLink } from '../ui.js';
import { icon } from '../icons.js';
import {
  getSettings,
  updateSettings,
  geminiEnabled,
  azureEnabled,
  getLevelTests,
  saveLevelTest,
  getAzureUsage,
  addAzureUsage,
} from '../store.js';
import {
  DIMENSIONS,
  LEVELS,
  MIN_SECONDS,
  TAKERS,
  aggregate,
  buildTest,
  formatTestDate,
  monthKey,
  opicBands,
  opicLevel,
  partOf,
  promptText,
  readCoverage,
  recentBankIds,
  takerOf,
  toeicBands,
  toeicLevel,
  toeicScore,
  usageSummary,
} from '../lib/level.js';
import { assessSpeech } from '../services/azure-speech.js';
import { gradeAnswer, summarize } from '../services/level-test.js';
import { searchImages } from '../services/dictionary.js';
import { recordingSupported, startRecording } from '../services/recorder.js';
import { primeSpeech, speak, stopSpeaking } from '../speech.js';
import { keepAwake } from '../services/wake-lock.js';
import { tappableEnglish } from '../components/word-sheet.js';

const SOURCE = '레벨테스트';
const PICTURE_WAIT_MS = 4000; // 사진이 이만큼 안에 안 오면 글 설명으로 대신한다

let body;
let stage = 'home'; // home | test | paused | grading | report
let shown = false;
let run = 0; // 문항을 바꾸거나 멈출 때마다 늘어남: 늦게 끝난 질문 읽기·카운트다운·녹음이 화면을 바꾸지 않게
let test = null; // 진행 중인 시험 {taker, level, tasks, bankIds, at, idx, answers, queue}
let rec = null; // 진행 중인 녹음
let timer = 0;
let report = null; // 보고 있는 성적표

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function show_(...nodes) {
  clear(body).append(...nodes.filter(Boolean));
  window.scrollTo?.({ top: 0 });
}

function stopTimers() {
  clearInterval(timer);
  timer = 0;
}

/** 진행 중인 질문 읽기·카운트다운·녹음을 멈춘다 (녹음은 버린다) */
function stopCurrent() {
  stopTimers();
  stopSpeaking();
  rec?.cancel();
  rec = null;
}

/* ---------- 1. 처음 화면: 응시자·난이도, 사용량, 결과 목록 ---------- */

function renderHome(message) {
  stage = 'home';
  report = null;
  const s = getSettings();
  let taker = TAKERS.some((t) => t.id === s.levelTaker) ? s.levelTaker : '';
  let level = LEVELS[s.levelLevel] ? s.levelLevel : 'normal';
  const ready = geminiEnabled() && azureEnabled() && recordingSupported;

  const takerChips = h(
    'div',
    { class: 'chips level-takers' },
    TAKERS.map((t) =>
      h(
        'button',
        {
          type: 'button',
          class: `chip taker${taker === t.id ? ' on' : ''}`,
          'aria-pressed': String(taker === t.id),
          onclick: (e) => {
            taker = t.id;
            for (const b of takerChips.childNodes) {
              const on = b === e.currentTarget;
              b.classList.toggle('on', on);
              b.setAttribute('aria-pressed', String(on));
            }
            startBtn.disabled = !ready;
          },
        },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, t.emoji),
        t.name
      )
    )
  );
  const levelSeg = segmented(
    [
      { value: 'normal', label: '일반' },
      { value: 'easy', label: '쉬움' },
    ],
    level,
    (v) => (level = v),
    { label: '난이도' }
  );
  const startBtn = btn(
    '테스트 시작',
    () => {
      primeSpeech(); // 아이폰: 누른 순간 소리를 깨워 둔다 (질문을 읽어 준다)
      updateSettings({ levelTaker: taker, levelLevel: level });
      startTest(taker, level);
    },
    { cls: 'btn primary big', ico: 'mic', disabled: !taker || !ready }
  );

  show_(
    h(
      'div',
      { class: 'card stack' },
      h('div', { class: 'card-title' }, icon('award'), '영어 말하기 레벨테스트'),
      h(
        'p',
        { class: 'hint' },
        '토익스피킹과 같은 다섯 유형(문장 읽기 · 사진 묘사 · 질문에 답하기 · 표 보고 답하기 · 의견 말하기)을 학교·일상 주제로 7문항, 약 10분 동안 봅니다. ' +
          '문항마다 녹음한 답을 AI가 발음·유창성·억양·문법·어휘·과제 수행으로 채점하고, 토익스피킹·OPIc 예상 등급을 알려 줘요. 문제는 볼 때마다 달라요.'
      ),
      geminiEnabled()
        ? null
        : h(
            'p',
            { class: 'callout' },
            'Gemini API 키가 있어야 합니다(문법·어휘 채점). ',
            h('a', { href: '#/settings' }, '설정에서 키 넣기')
          ),
      azureEnabled()
        ? null
        : h(
            'p',
            { class: 'callout' },
            'Azure 음성 평가 키가 있어야 합니다(발음·유창성·억양). ',
            h('a', { href: '#/settings' }, '설정에서 키 넣기')
          ),
      recordingSupported ? null : h('p', { class: 'error-text' }, '이 브라우저는 녹음을 지원하지 않습니다.'),
      h('b', null, '응시자'),
      takerChips,
      h('b', null, '난이도'),
      levelSeg,
      h('p', { class: 'hint' }, '쉬움은 글이 짧고 질문이 단순하며 답변 시간이 조금 짧아요. 점수 기준은 같습니다.'),
      message ? h('p', { class: 'error-text' }, message) : null,
      startBtn,
      h(
        'p',
        { class: 'hint' },
        '조용한 곳에서 휴대폰을 입 가까이 두고 하세요. 녹음은 채점할 때만 Azure·Gemini로 보내고 저장하지 않습니다.'
      )
    ),
    resultsCard(),
    usageCard()
  );
}

function usageCard() {
  const u = usageSummary(getAzureUsage(), Date.now());
  return h(
    'div',
    { class: 'card stack level-usage' },
    h('div', { class: 'card-title' }, icon('clock'), '이번 달 Azure 음성 평가 사용량'),
    h('div', { class: 'level' }, h('div', { class: 'level-bar', style: { width: `${u.percent}%` } })),
    h(
      'p',
      null,
      `${u.usedMin}분 / 무료 ${u.freeMin}분 (이 기기 기준) · 앞으로 약 ${u.leftTests.normal}회(일반) · ${u.leftTests.easy}회(쉬움)`
    ),
    h(
      'p',
      { class: 'hint' },
      'Azure는 앱에서 실제 사용량을 조회하는 방법을 주지 않아서, 이 기기에서 보낸 시간만 셉니다. 가족이 다른 기기에서 같은 키를 쓰면 실제로는 더 썼을 수 있어요. 정확한 사용량은 Azure 포털의 Speech 리소스 → 모니터링 → 메트릭에서 보세요. 무료 사용량을 넘으면 요금 없이 그달은 채점이 멈춥니다.'
    ),
    externalLink('Azure 포털에서 사용량 보기', 'https://portal.azure.com/')
  );
}

function resultsCard() {
  const list = getLevelTests();
  if (!list.length) return null;
  return h(
    'div',
    { class: 'card stack' },
    h('div', { class: 'card-title' }, icon('list'), '시험 결과'),
    h(
      'ul',
      { class: 'history level-list' },
      list.map((r) => {
        const t = takerOf(r.taker);
        const ts = toeicScore(r.total);
        return h(
          'li',
          null,
          h(
            'button',
            { type: 'button', class: 'history-item level-row', onclick: () => renderReport(r) },
            h('span', { class: 'level-row-date' }, formatTestDate(r.at)),
            h(
              'span',
              { class: 'level-row-taker' },
              h('span', { class: 'emoji', 'aria-hidden': 'true' }, t.emoji),
              t.name
            ),
            h('span', { class: 'tag' }, LEVELS[r.level] ?? r.level),
            h('b', { class: 'level-row-score' }, `${Math.round(r.total)}점`),
            h('span', { class: 'level-row-grade' }, `${toeicLevel(ts)[1]} · OPIc ${opicLevel(r.total)}`)
          )
        );
      })
    )
  );
}

/* ---------- 2. 시험 ---------- */

function startTest(takerId, level) {
  run++;
  const recent = recentBankIds(getLevelTests(), takerId);
  const { tasks, bankIds } = buildTest(level, recent);
  test = {
    taker: takerId,
    level,
    tasks,
    bankIds,
    at: Date.now(),
    idx: 0,
    answers: tasks.map(() => ({ status: 'none' })),
    queue: Promise.resolve(),
    pictureReady: null,
  };
  test.pictureReady = loadPicture(test);
  keepAwake('level', true);
  showTask(0);
}

/** 사진 묘사용 사진을 미리 찾아 둔다 (못 찾으면 글 설명으로 대신한다) */
async function loadPicture(t) {
  const pic = t.tasks.find((x) => x.part === 'picture');
  try {
    const list = await searchImages(pic.query);
    const first = list.find((x) => x.full || x.thumb);
    if (first) Object.assign(pic, { image: first.full || first.thumb, credit: first.credit, link: first.link });
  } catch {
    /* 사진 없이 */
  }
}

function progressBar(i) {
  return h(
    'div',
    {
      class: 'level-progress',
      role: 'progressbar',
      'aria-valuenow': String(i + 1),
      'aria-valuemax': String(test.tasks.length),
    },
    test.tasks.map((_, k) => h('span', { class: k < i ? 'done' : k === i ? 'now' : '' }))
  );
}

/** 과제 내용 (읽을 글·사진·질문·표) */
async function promptView(task) {
  switch (task.part) {
    case 'read':
      return h('p', { class: 'level-read', lang: 'en' }, task.text);
    case 'picture': {
      // 사진이 아직 안 왔으면 잠깐 기다린다
      await Promise.race([test.pictureReady, new Promise((r) => setTimeout(r, PICTURE_WAIT_MS))]);
      if (!task.image)
        return h(
          'p',
          { class: 'level-read' },
          `(사진을 불러오지 못했어요) 이런 장면을 떠올리며 설명하세요: ${task.fallback}`
        );
      return h(
        'div',
        { class: 'stack tight' },
        h(
          'div',
          { class: 'photo-frame' },
          h('img', { class: 'photo-thumb level-photo', src: task.image, alt: task.fallback })
        ),
        task.credit ? h('p', { class: 'muted small' }, `사진: ${task.credit} (Openverse)`) : null
      );
    }
    case 'respond':
      return h(
        'div',
        { class: 'stack tight' },
        h('p', { class: 'hint', lang: 'en' }, task.intro),
        h('p', { class: 'level-read', lang: 'en' }, `Question ${task.n}. ${task.question}`)
      );
    case 'info':
      return h(
        'div',
        { class: 'stack tight' },
        h(
          'table',
          { class: 'level-table' },
          h('caption', null, task.title),
          h(
            'tbody',
            null,
            task.rows.map((r) =>
              h(
                'tr',
                null,
                r.map((c) => h('td', null, c))
              )
            )
          )
        ),
        h('p', { class: 'level-read small', lang: 'en' }, `${task.caller} ${task.question}`)
      );
    default:
      return h('p', { class: 'level-read', lang: 'en' }, task.question);
  }
}

async function showTask(i) {
  const my = ++run;
  stopCurrent();
  stage = 'test';
  test.idx = i;
  const task = test.tasks[i];
  const part = partOf(task.part);
  const n = test.tasks.length;

  const status = h('div', { class: 'level-status' }, '준비 중…');
  const time = h('div', { class: 'rec-time' });
  const bar = h('div', { class: 'level-bar' });
  const meter = h('div', { class: 'level', hidden: true }, bar);
  let onSkip = null; // 지금 "바로 시작"(또는 "다시 시도")을 누르면 할 일
  const skipBtn = btn('바로 시작', () => onSkip?.(), { cls: 'chip', ico: 'play' });
  skipBtn.hidden = true;
  const doneBtn = btn(i + 1 < n ? '답변 완료 · 다음' : '답변 완료 · 채점하기', () => stopAnswer(), {
    cls: 'btn primary big',
    ico: 'check',
  });
  doneBtn.hidden = true;
  const promptBox = h(
    'div',
    { class: 'stack level-prompt' },
    h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), '불러오는 중…')
  );
  show_(
    progressBar(i),
    h(
      'div',
      { class: 'card stack level-q' },
      h(
        'div',
        { class: 'row between' },
        h('b', null, `${i + 1} / ${n} · ${part.label}`),
        iconBtn('x', '그만두기', quit, 'icon-btn small')
      ),
      h('p', { class: 'hint' }, part.dirKo),
      promptBox
    ),
    h('div', { class: 'card stack center level-rec' }, status, time, meter, skipBtn, doneBtn)
  );
  clear(promptBox).append(await promptView(task));
  if (my !== run) return;

  const say = async (text) => {
    status.textContent = '질문을 듣는 중…';
    await speak(text, { lang: 'en-US' });
  };
  /** 카운트다운 (바로 시작으로 건너뛸 수 있다). 그사이 문항이 바뀌면 바로 끝난다 */
  const countdown = (label, seconds) =>
    new Promise((resolve) => {
      let left = seconds;
      const tick = () => {
        if (my !== run) return end();
        status.textContent = label;
        time.textContent = fmt(left);
        if (left <= 0) end();
        left -= 1;
      };
      const end = () => {
        stopTimers();
        skipBtn.hidden = true;
        onSkip = null;
        resolve();
      };
      skipBtn.hidden = false;
      onSkip = end;
      stopTimers();
      tick();
      timer = setInterval(tick, 1000);
    });

  if (task.part === 'respond' && task.n === 1) await say(task.intro);
  if (my !== run) return;
  if (task.part === 'info') {
    await countdown('표를 읽으세요', task.read);
    if (my !== run) return;
    await say(`${task.caller} ${task.question}`);
  }
  if (task.part === 'respond' || task.part === 'opinion') await say(task.question);
  if (my !== run) return;
  await countdown('준비 시간', task.prep);
  if (my !== run) return;

  // 녹음
  status.textContent = '마이크 켜는 중…';
  let r;
  try {
    r = await startRecording({
      maxSeconds: task.answer,
      onLevel: (peak, sec) => {
        bar.style.width = `${Math.min(100, peak * 140)}%`;
        time.textContent = `남은 시간 ${fmt(Math.max(0, task.answer - sec))}`;
      },
      onLimit: () => stopAnswer(),
    });
  } catch (e) {
    if (my !== run) return;
    status.textContent = errorMessage(e);
    time.textContent = '';
    skipBtn.hidden = false;
    skipBtn.replaceChildren(icon('back'), h('span', null, '다시 시도'));
    onSkip = () => showTask(i);
    return;
  }
  if (my !== run) return r.cancel();
  rec = r;
  meter.hidden = false;
  doneBtn.hidden = false;
  status.textContent = `녹음 중 · 말하세요 (${fmt(task.answer)} 안에)`;
  time.textContent = `남은 시간 ${fmt(task.answer)}`;

  /** 답변을 마치고 채점을 맡긴 뒤 다음 문항으로 (마지막이면 채점 화면) */
  async function stopAnswer() {
    if (my !== run || !rec) return;
    const cur = rec;
    rec = null;
    run++; // 늦게 오는 시간 다 됨 알림이 다시 부르지 않게
    stopTimers();
    status.textContent = '녹음을 저장하는 중…';
    doneBtn.disabled = true;
    const { blob, seconds } = await cur.stop();
    const a = test.answers[i];
    Object.assign(a, { audio: blob, seconds, status: 'pending', error: '' });
    enqueueGrade(i);
    if (i + 1 < n) showTask(i + 1);
    else renderGrading();
  }
}

/* ---------- 3. 채점 (답을 마칠 때마다 뒤에서 차례로: Azure는 한 번에 하나씩) ---------- */

function enqueueGrade(i) {
  const t = test;
  const a = t.answers[i];
  const task = t.tasks[i];
  a.status = 'pending';
  a.error = '';
  t.queue = t.queue.then(async () => {
    if (t.closed) return;
    try {
      a.status = 'azure';
      renderGradingIfShown(t);
      if (a.seconds < MIN_SECONDS) {
        a.azure = {
          transcript: '',
          scores: { pronunciation: 0, fluency: 0, prosody: 0, completeness: task.reference ? 0 : null },
          words: [],
          utterances: 0,
        };
      } else {
        const s = getSettings();
        a.azure = await assessSpeech({
          key: s.azureKey,
          region: s.azureRegion,
          audio: a.audio,
          referenceText: task.reference || '',
        });
        addAzureUsage(a.seconds, monthKey(Date.now()));
      }
      a.status = 'gemini';
      renderGradingIfShown(t);
      a.gemini =
        task.part === 'read' || !a.azure.transcript
          ? null
          : await gradeAnswer({ task, level: t.level, transcript: a.azure.transcript, seconds: a.seconds });
      a.status = 'done';
    } catch (e) {
      a.status = 'error';
      a.error = errorMessage(e);
    }
    renderGradingIfShown(t);
  });
}

function renderGradingIfShown(t) {
  if (test === t && stage === 'grading') renderGrading();
}

function renderGrading() {
  stage = 'grading';
  stopCurrent();
  const t = test;
  const n = t.answers.length;
  const done = t.answers.filter((a) => a.status === 'done').length;
  const failed = t.answers.map((a, i) => (a.status === 'error' ? i : -1)).filter((i) => i >= 0);
  if (done === n) return finishTest(t);
  const working = t.answers.findIndex((a) => a.status === 'azure' || a.status === 'gemini');
  show_(
    h(
      'div',
      { class: 'card stack center' },
      done + failed.length < n
        ? h(
            'p',
            { class: 'muted loading' },
            h('span', { class: 'spinner' }),
            `AI가 답을 듣고 채점하는 중… (${done}/${n}${working >= 0 ? `, ${working + 1}번 ${t.answers[working].status === 'azure' ? '발음 평가' : '문법·어휘 채점'}` : ''})`
          )
        : null,
      failed.length
        ? h(
            'div',
            { class: 'stack' },
            failed.map((i) => h('p', { class: 'error-text' }, `${i + 1}번: ${t.answers[i].error}`)),
            btn(
              '채점 다시 시도',
              () => {
                failed.forEach(enqueueGrade);
                renderGrading();
              },
              { cls: 'btn primary', ico: 'back' }
            ),
            btn('그만두기', quit, { cls: 'btn ghost', ico: 'x' })
          )
        : h('p', { class: 'hint' }, '보통 1~2분 걸려요. 다른 화면에 다녀와도 계속 채점합니다.')
    )
  );
}

function finishTest(t) {
  keepAwake('level', false);
  t.closed = true;
  const items = t.tasks.map((task, i) => {
    const a = t.answers[i];
    const az = a.azure;
    const g = a.gemini;
    const scores = { pronunciation: az.scores.pronunciation, fluency: az.scores.fluency, prosody: az.scores.prosody };
    // 문장 읽기의 과제 수행 = 빠짐없이 읽었는지 (Azure 완성도와 앱이 직접 센 읽힌 비율 중 낮은 쪽)
    if (task.part === 'read')
      scores.relevance = Math.min(az.scores.completeness ?? 100, readCoverage(task.reference, az.words));
    else {
      scores.grammar = g?.grammar ?? 0;
      scores.vocabulary = g?.vocabulary ?? 0;
      scores.relevance = g?.relevance ?? 0;
    }
    return {
      part: task.part,
      id: task.id,
      prompt: promptText(task),
      display:
        task.part === 'read'
          ? task.text
          : task.part === 'picture'
            ? task.fallback
            : task.part === 'info'
              ? `${task.caller} ${task.question}`
              : task.question,
      limit: task.answer,
      seconds: Math.round(a.seconds || 0),
      transcript: az.transcript,
      words: az.words.filter((w) => w.error !== 'None' || (w.accuracy != null && w.accuracy < 60)).slice(0, 12),
      scores,
      feedbackKo: g?.feedbackKo || '',
      corrections: g?.corrections || [],
      better: g?.better || '',
    };
  });
  const { scores, total } = aggregate(items);
  const result = { at: t.at, taker: t.taker, level: t.level, bankIds: t.bankIds, total, scores, items, summary: '' };
  saveLevelTest(result); // 녹음은 남기지 않는다
  test = null;
  renderReport(result);
  // 총평은 성적표를 먼저 보여 준 뒤 받는다 (못 받아도 성적표는 그대로)
  summarize(result).then(
    (text) => {
      result.summary = text;
      saveLevelTest(result);
      if (report === result) renderReport(result, { keepScroll: true });
    },
    () => {
      if (report === result) {
        result.summary = '(총평을 받지 못했어요)';
        renderReport(result, { keepScroll: true });
      }
    }
  );
}

/* ---------- 4. 성적표 ---------- */

/** 등급 띠: 낮은 등급부터 같은 너비의 칸으로 그리고(점수 폭이 좁은 등급도 읽히게), 내 점수 자리에 표시 */
function band(title, bands, value, code, note) {
  const idx = Math.max(
    0,
    bands.findIndex(([c]) => c === code)
  );
  const [, lo, hi] = bands[idx];
  const frac = hi - lo > 1 ? Math.min(1, Math.max(0, (value - lo) / (hi - lo))) : 0.5;
  const segs = bands.map(([c]) => h('span', { class: `seg${c === code ? ' on' : ''}` }, c));
  const marker = h('i', { class: 'marker', style: { left: `${((idx + frac) / bands.length) * 100}%` } });
  return h(
    'div',
    { class: 'card stack level-band' },
    h('div', { class: 'row between' }, h('b', null, title), h('b', { class: 'lv' }, note)),
    h('div', { class: 'band' }, segs, marker)
  );
}

function renderReport(r, { keepScroll = false } = {}) {
  stage = 'report';
  report = r;
  const taker = takerOf(r.taker);
  const ts = toeicScore(r.total);
  const tl = toeicLevel(ts);
  const op = opicLevel(r.total);
  const nodes = [
    h(
      'div',
      { class: 'card center level-score' },
      h(
        'div',
        { class: 'muted' },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, taker.emoji),
        ` ${taker.name} · ${LEVELS[r.level] ?? r.level} · ${formatTestDate(r.at)}`
      ),
      h('div', { class: 'muted' }, '총점'),
      h('div', { class: 'level-big' }, Math.round(r.total)),
      h(
        'div',
        { class: 'level-predict' },
        h(
          'div',
          null,
          h('span', { class: 'muted small' }, 'TOEIC Speaking 예상'),
          h('b', null, `${ts}점 · ${tl[1]}`),
          h('span', { class: 'muted small' }, tl[2])
        ),
        h('div', null, h('span', { class: 'muted small' }, 'OPIc 예상'), h('b', null, op))
      )
    ),
    band('TOEIC Speaking 예상 등급', toeicBands(), ts, tl[1], `${ts}점 ${tl[1]}`),
    band('OPIc 예상 등급', opicBands(), r.total, op, op),
    h(
      'p',
      { class: 'hint' },
      '레벨테스트 점수를 공인영어시험 등급표에 맞춰 환산한 예상치예요. 실제 시험 결과와 다를 수 있어요.'
    ),
    h(
      'div',
      { class: 'card stack level-dims' },
      h('div', { class: 'card-title' }, icon('target'), '항목별 점수'),
      ...DIMENSIONS.map((d) => {
        const v = r.scores?.[d.key];
        return h(
          'div',
          { class: 'level-dim', title: d.hint },
          h(
            'div',
            { class: 'row between' },
            h('b', null, d.label),
            h('b', { class: 'lv' }, v == null ? '-' : Math.round(v))
          ),
          h('div', { class: 'level' }, h('div', { class: 'level-bar', style: { width: `${v == null ? 0 : v}%` } })),
          h('p', { class: 'hint' }, d.hint)
        );
      }),
      h(
        'p',
        { class: 'hint' },
        '발음·유창성·억양은 Azure 음성 평가, 문법·어휘·과제 수행은 Gemini가 받아쓴 글을 보고 매긴 점수예요.'
      )
    ),
    h(
      'div',
      { class: 'card stack' },
      h('div', { class: 'card-title' }, icon('info'), 'AI 총평'),
      r.summary
        ? h('div', { class: 'level-summary' }, r.summary)
        : h('p', { class: 'muted loading' }, h('span', { class: 'spinner' }), '총평을 쓰는 중…')
    ),
    h('h3', { class: 'level-h' }, '문항별 피드백'),
    ...r.items.map((it, i) => itemCard(it, i)),
    h(
      'div',
      { class: 'row wrap' },
      btn('한 번 더 응시하기', () => renderHome(), { cls: 'btn primary', ico: 'mic' }),
      btn('결과 목록', () => renderHome(), { cls: 'btn ghost', ico: 'list' })
    ),
  ];
  if (keepScroll) clear(body).append(...nodes);
  else show_(...nodes);
}

function itemCard(it, i) {
  const part = partOf(it.part);
  const own = DIMENSIONS.filter((d) => it.scores?.[d.key] != null);
  const avg = own.length ? own.reduce((a, d) => a + it.scores[d.key], 0) / own.length : 0;
  return h(
    'details',
    { class: 'card level-item' },
    h(
      'summary',
      null,
      h('b', null, `${i + 1}. ${part?.label ?? it.part}`),
      h('span', { class: 'muted small' }, ` ${Math.round(avg)}점 · ${fmt(it.seconds || 0)}`)
    ),
    h('p', { class: 'hint', lang: 'en' }, it.display),
    h('b', { class: 'small' }, '내 답변 (받아쓰기)'),
    it.transcript
      ? tappableEnglish(it.transcript, { source: SOURCE, tag: 'p', cls: 'level-transcript' })
      : h('p', { class: 'muted' }, '(말소리가 없었어요)'),
    h('p', { class: 'muted small' }, own.map((d) => `${d.label} ${Math.round(it.scores[d.key])}`).join(' · ')),
    it.words?.length
      ? h(
          'div',
          { class: 'stack tight' },
          h('b', { class: 'small' }, '발음을 다듬을 단어'),
          h(
            'div',
            { class: 'chips' },
            it.words.map((w) =>
              h(
                'span',
                { class: 'chip small level-word', lang: 'en' },
                w.word,
                w.error && w.error !== 'None'
                  ? ` (${wordError(w.error)})`
                  : w.accuracy != null
                    ? ` ${Math.round(w.accuracy)}`
                    : ''
              )
            )
          )
        )
      : null,
    it.feedbackKo ? h('p', null, it.feedbackKo) : null,
    it.corrections?.length
      ? h(
          'ul',
          { class: 'level-fixes' },
          it.corrections.map((c) =>
            h(
              'li',
              null,
              h('s', null, c.original),
              ' → ',
              h('b', { lang: 'en' }, c.corrected),
              c.noteKo ? h('div', { class: 'hint' }, c.noteKo) : null
            )
          )
        )
      : null,
    it.better
      ? h(
          'div',
          { class: 'stack tight' },
          h(
            'div',
            { class: 'row between' },
            h('b', { class: 'small' }, '한 단계 위 모범 답변'),
            iconBtn('volume', '읽기', () => speak(it.better), 'icon-btn small')
          ),
          tappableEnglish(it.better, { source: SOURCE, tag: 'p', cls: 'level-better' })
        )
      : null
  );
}

function wordError(e) {
  return (
    {
      Mispronunciation: '발음',
      Omission: '빠뜨림',
      Insertion: '덧붙임',
      UnexpectedBreak: '끊김',
      MissingBreak: '쉼 없음',
      Monotone: '단조로움',
    }[e] ?? e
  );
}

/* ---------- 멈춤·그만두기 ---------- */

/** 다른 탭으로 가거나 앱을 벗어남: 질문 읽기·녹음을 멈춘다 (돌아오면 그 문항부터 다시). 채점은 뒤에서 이어진다 */
function pause() {
  stopCurrent();
  run++;
  stage = 'paused';
  const i = test.idx;
  show_(
    h(
      'div',
      { class: 'card stack center' },
      h('b', null, `테스트를 잠시 멈췄어요 (${i + 1} / ${test.tasks.length})`),
      h('p', { class: 'hint' }, '이 문항은 처음부터 다시 듣고 답해요. 앞 문항은 그대로 채점합니다.'),
      btn(
        '이어서 하기',
        () => {
          primeSpeech();
          showTask(i);
        },
        { cls: 'btn primary big', ico: 'play' }
      ),
      btn('그만두기', quit, { cls: 'btn ghost', ico: 'x' })
    )
  );
}

function quit() {
  if (
    (stage === 'test' || stage === 'paused') &&
    !window.confirm?.('테스트를 그만둘까요? 지금까지 답한 것은 버립니다.')
  )
    return;
  stopCurrent();
  run++;
  if (test) test.closed = true;
  test = null;
  keepAwake('level', false);
  renderHome();
}

/* ---------- 화면 ---------- */

export function init(root) {
  body = h('div', { class: 'stack level-view' });
  root.append(body);
  renderHome();
  window.addEventListener('settings-changed', () => {
    if (stage === 'home') renderHome();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stage === 'test') pause();
  });
}

export function show() {
  shown = true;
  if (stage === 'home') renderHome(); // 결과 목록·사용량을 새로 (다른 탭에서 키를 넣었을 수도)
}

export function hide() {
  shown = false;
  if (stage === 'test') pause();
}

/** 시험 중(녹음·채점)인지: 테스트에서 확인용 */
export function state() {
  return { stage, idx: test?.idx ?? -1, shown };
}
