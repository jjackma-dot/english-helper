// 레벨테스트 화면 흐름을 가짜 브라우저·마이크·Speech SDK·Gemini·Openverse로 시험한다: 응시자·난이도 고르기, 7문항(듣기 → 준비 →
// 녹음 → 다음), 뒤에서 차례로 채점(Azure → Gemini), 성적표(총점·등급 띠·항목·문항별), 결과 목록, 최근 문제 제외, 사용량,
// 멈춤·이어서 하기, 그만두기, 채점 실패·다시 시도, 짧은 답은 보내지 않기, 키가 없을 때
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  installEnv,
  mount,
  button,
  segment,
  descendants,
  text,
  tick,
  until,
  mic,
  micChunk,
  spoken,
} from './platform-env.js';

/* ---------- 가짜 Speech SDK (level-service.test.js와 같은 모양) ---------- */

const azure = {
  recognizers: [],
  fail: null,
  scores: { AccuracyScore: 88, FluencyScore: 76, ProsodyScore: 64, CompletenessScore: 95 },
};
const SDK = {
  SpeechConfig: { fromSubscription: (key, region) => ({ key, region, speechRecognitionLanguage: '' }) },
  AudioConfig: { fromWavFileInput: (file) => ({ file }) },
  PronunciationAssessmentConfig: class {
    constructor(referenceText, gradingSystem, granularity, enableMiscue) {
      Object.assign(this, { referenceText, gradingSystem, granularity, enableMiscue, enableProsodyAssessment: false });
    }
    applyTo(rec) {
      rec.pa = this;
    }
  },
  PronunciationAssessmentGradingSystem: { HundredMark: 'HundredMark' },
  PronunciationAssessmentGranularity: { Word: 'Word' },
  SpeechRecognizer: class {
    constructor(speechConfig, audioConfig) {
      Object.assign(this, { speechConfig, audioConfig, pa: null, closed: false, at: azure.recognizers.length });
      azure.recognizers.push(this);
    }
    startContinuousRecognitionAsync(ok) {
      ok?.();
      setTimeout(() => {
        if (azure.fail) {
          this.canceled?.(this, { reason: 0, errorCode: azure.fail.code, errorDetails: azure.fail.details });
          return;
        }
        const n = this.at;
        const textOut = `answer ${n} recorded for ${Math.round(this.audioConfig.file.size / 32000)} seconds`;
        // 문장 읽기(읽을 글이 있음)는 그 글의 낱말을 모두 읽은 것으로, 마지막 낱말만 발음이 틀린 것으로
        const ref = this.pa.referenceText;
        const refWords = ref ? ref.split(/\s+/).map((w) => w.replace(/[^A-Za-z']/g, '')) : [];
        const words = ref
          ? refWords.map((w, i) => ({
              Word: w,
              PronunciationAssessment:
                i === refWords.length - 1
                  ? { AccuracyScore: 40, ErrorType: 'Mispronunciation' }
                  : { AccuracyScore: 90, ErrorType: 'None' },
            }))
          : [{ Word: 'recorded', PronunciationAssessment: { AccuracyScore: 40, ErrorType: 'Mispronunciation' } }];
        const json = {
          NBest: [
            {
              Display: ref || textOut,
              PronunciationAssessment: { ...azure.scores, ...(ref ? {} : { CompletenessScore: undefined }) },
              Words: words,
            },
          ],
        };
        this.recognized?.(this, {
          result: { reason: 3, text: textOut, properties: { getProperty: () => JSON.stringify(json) } },
        });
        this.canceled?.(this, { reason: 1 });
      }, 0);
    }
    stopContinuousRecognitionAsync(ok) {
      ok?.();
      setTimeout(() => this.sessionStopped?.(this, {}), 0);
    }
    close() {
      this.closed = true;
    }
  },
  ResultReason: { NoMatch: 0, RecognizedSpeech: 3 },
  CancellationReason: { Error: 0, EndOfStream: 1 },
  CancellationErrorCode: {
    NoError: 0,
    AuthenticationFailure: 1,
    TooManyRequests: 3,
    ConnectionFailure: 4,
    ServiceTimeout: 5,
    Forbidden: 8,
  },
  PropertyId: { SpeechServiceResponse_JsonResult: 23 },
};

const env = installEnv({
  userAgent: 'Mozilla/5.0 (Linux; Android 16)',
  settings: { geminiKey: 'k', azureKey: 'AZ', azureRegion: 'koreacentral' },
});
globalThis.SpeechSDK = SDK;
globalThis.FakeElementForImg = null;

/* ---------- 가짜 Gemini(채점·총평)와 Openverse ---------- */

const enc = new TextEncoder();
const sse = (t) =>
  new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(
          enc.encode(
            `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] })}\n\n`
          )
        );
        c.close();
      },
    })
  );
const gemini = { grades: [], summaries: 0, fail: false, pictures: 0 };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.openverse.org')) {
    gemini.pictures++;
    return new Response(
      JSON.stringify({
        results: [
          {
            thumbnail: 'https://img.example/t.jpg',
            url: 'https://img.example/f.jpg',
            title: 'Picnic',
            creator: 'Ann',
            license: 'by',
          },
        ],
      })
    );
  }
  const body = JSON.parse(init.body);
  if (gemini.fail) return new Response(JSON.stringify({ error: { code: 403, message: 'denied' } }), { status: 403 });
  const schema = body.generationConfig?.responseSchema;
  if (schema?.properties?.grammar) {
    gemini.grades.push(body.contents[0].parts[0].text);
    return sse(
      JSON.stringify({
        grammar: 60,
        vocabulary: 55,
        relevance: 70,
        feedbackKo: '좋아요. 시제를 조심하세요.',
        corrections: [{ original: 'recorded for', corrected: 'that was recorded for', noteKo: '관계절' }],
        better: 'A better answer.',
      })
    );
  }
  gemini.summaries++;
  return sse('- 총평입니다.');
};

/* ---------- 시계: 카운트다운(setInterval)과 Date만 가짜로 ---------- */

mock.timers.enable({ apis: ['setInterval', 'Date'], now: new Date(2026, 10, 13, 10, 0).getTime() });

/* ---------- 화면 ---------- */

const level = await import('../js/views/level.js');
const { getSettings, updateSettings, getLevelTests, getAzureUsage } = await import('../js/store.js');
const view = mount(level, env.body);
level.show();

const els = () => descendants(view);
const byClass = (c) => els().filter((e) => e.classList.contains(c));
const visible = (el) => {
  if (!el) return false;
  for (let n = el; n; n = n.parentNode) if (n.hidden) return false;
  return true;
};
const chip = (label) => els().find((e) => e.classList.contains('chip') && e.textContent.includes(label));
const status = () => byClass('level-status')[0]?.textContent ?? '';
const timeText = () => byClass('rec-time')[0]?.textContent ?? '';
const startBtn = () => button(view, '테스트 시작');
const doneBtn = () => button(view, '답변 완료');
const skipBtn = () => button(view, '바로 시작');
const stage = () => level.state().stage;
let readText = ''; // 1번 문항에서 읽은 글

/** 준비 시간을 건너뛰고 녹음이 켜질 때까지 */
async function toRecording() {
  await until(() => skipBtn() && visible(skipBtn()) && status() !== '질문을 듣는 중…', '카운트다운');
  skipBtn().click();
  // 표 보고 답하기: 표 읽기 → 질문 듣기 → 준비 시간
  await until(() => visible(doneBtn()) || (skipBtn() && visible(skipBtn()) && /준비/.test(status())), '녹음 또는 준비');
  if (!visible(doneBtn())) {
    skipBtn().click();
    await until(() => visible(doneBtn()), '녹음이 켜진다');
  }
}
/** sec초 말하고 답변 완료 */
async function answer(sec) {
  await toRecording();
  micChunk(48000 * sec, 0.3);
  doneBtn().click();
  await until(() => !visible(doneBtn()) || doneBtn().disabled === false, '다음으로');
}

test('처음 화면: 응시자 넷·난이도 둘, 응시자를 골라야 시작할 수 있고, 키가 없으면 안내만', () => {
  assert.deepEqual(
    byClass('taker').map((e) => e.textContent),
    ['🐗멧돼지', '🐒원숭이', '🐷꿀돼지', '🐽꿀꿀돼지']
  );
  assert.ok(segment(view, '일반') && segment(view, '쉬움'));
  assert.equal(startBtn().disabled, true, '응시자를 고르기 전');
  assert.match(text(view), /이번 달 Azure 음성 평가 사용량/);
  assert.match(text(view), /0분 \/ 무료 300분/);
  assert.doesNotMatch(text(view), /시험 결과/, '아직 결과가 없다');

  updateSettings({ azureKey: '' });
  assert.match(text(view), /Azure 음성 평가 키가 있어야 합니다/);
  chip('멧돼지').click();
  assert.equal(startBtn().disabled, true, '키가 없으면 시작할 수 없다');
  updateSettings({ azureKey: 'AZ' });
  assert.doesNotMatch(text(view), /Azure 음성 평가 키가 있어야/);
});

test('시작: 멧돼지·일반을 고르면 문장 읽기부터 7문항을 차례로 듣고 준비하고 녹음하며, 답을 마치는 대로 뒤에서 채점한다', async () => {
  chip('멧돼지').click();
  segment(view, '일반').click();
  startBtn().click();
  assert.deepEqual([getSettings().levelTaker, getSettings().levelLevel], ['boar', 'normal'], '고른 것을 기억한다');
  await until(() => stage() === 'test' && byClass('level-read').length, '1번 문장 읽기');
  assert.match(text(view), /1 \/ 7 · 문장 읽기/);
  readText = byClass('level-read')[0].textContent;
  assert.ok(readText.length > 40);
  assert.equal(spoken.length, 0, '읽을 글은 읽어 주지 않는다');
  await until(() => status() === '준비 시간', '준비 카운트다운');
  assert.equal(timeText(), '0:20');
  mock.timers.tick(1000);
  assert.equal(timeText(), '0:19');
  skipBtn().click();
  await until(() => visible(doneBtn()), '녹음');
  assert.match(status(), /녹음 중/);
  assert.equal(mic.audio.at(-1).echoCancellation, false, '안드로이드 녹음 마이크');
  micChunk(48000 * 10, 0.3); // 10초
  assert.equal(timeText(), '남은 시간 0:35');
  doneBtn().click();

  // 2번 사진 묘사: 앱에 넣어 둔 사진이 바로 뜬다 (외부 검색 없음)
  await until(() => text(view).includes('2 / 7 · 사진 묘사') && byClass('level-photo').length, '사진');
  assert.match(byClass('level-photo')[0].getAttribute('src'), /\/samples\/pictures\/p\d+\.jpg$/);
  assert.ok(byClass('level-photo')[0].getAttribute('alt').length > 10, '장면 설명이 대체 글');
  assert.equal(gemini.pictures, 0, '사진을 밖에서 찾지 않는다');
  await answer(6);

  // 3~5번 질문에 답하기: 상황 설명 뒤 질문을 읽어 준다
  await until(() => text(view).includes('3 / 7 · 질문에 답하기'), '3번');
  await until(() => spoken.length >= 2, '상황과 질문 1을 읽어 준다');
  assert.match(spoken[0].text, /^Imagine that/);
  assert.match(spoken[1].text, /\?$/);
  await answer(5);
  await until(() => text(view).includes('4 / 7'), '4번');
  await until(() => spoken.length >= 3, '질문 2만 읽어 준다');
  await answer(5);
  await until(() => text(view).includes('5 / 7'), '5번');
  // 시간이 다 되면 저절로 다음으로
  await toRecording();
  micChunk(48000 * 31, 0.3);
  await until(() => text(view).includes('6 / 7 · 표 보고 답하기'), '30초가 지나 6번으로');

  // 6번: 표를 30초 읽고(건너뛸 수 있다), 질문을 들은 뒤 3초 준비
  assert.ok(byClass('level-table').length, '표');
  await until(() => status() === '표를 읽으세요', '표 읽기');
  const said = spoken.length;
  await answer(8);
  assert.ok(spoken.length > said, '묻는 사람의 말을 읽어 준다');

  // 7번 의견 말하기
  await until(() => text(view).includes('7 / 7 · 의견 말하기'), '7번');
  await toRecording();
  assert.equal(timeText(), '남은 시간 1:00');
  assert.match(button(view, '답변 완료').textContent, /채점하기/);
  micChunk(48000 * 20, 0.3);
  doneBtn().click();

  await until(() => stage() === 'grading' || stage() === 'report', '채점');
  await until(() => stage() === 'report', '성적표');
  assert.equal(azure.recognizers.length, 7, '문항마다 Azure로');
  assert.equal(azure.recognizers[0].pa.referenceText, readText, '문장 읽기는 읽은 글을 함께');
  assert.equal(azure.recognizers[0].pa.enableMiscue, true);
  assert.equal(azure.recognizers[1].pa.referenceText, '');
  assert.ok(azure.recognizers.every((r) => r.pa.enableProsodyAssessment && r.speechConfig.key === 'AZ'));
  assert.equal(gemini.grades.length, 6, '문장 읽기 빼고 Gemini 채점');
  assert.match(gemini.grades[0], /Test part: 사진 묘사 \(picture\)/);
  assert.match(gemini.grades[0], /the learner spoke for about 6 seconds/);
});

test('성적표: 총점·토익스피킹 점수와 등급·OPIc 등급·등급 띠·항목 6개·총평·문항별 피드백, 결과는 저장되고 사용량이 는다', async () => {
  const [r] = getLevelTests();
  assert.ok(r, '저장');
  assert.deepEqual([r.taker, r.level, r.items.length, r.bankIds.length], ['boar', 'normal', 7, 5]);
  // 문장 읽기: 발음 88·유창 76·억양 64·과제 수행(완성도) 95. 나머지: 문법 60·어휘 55·과제 수행 70
  assert.deepEqual(r.items[0].scores, { pronunciation: 88, fluency: 76, prosody: 64, relevance: 95 });
  assert.deepEqual(r.items[1].scores, {
    pronunciation: 88,
    fluency: 76,
    prosody: 64,
    grammar: 60,
    vocabulary: 55,
    relevance: 70,
  });
  assert.equal(r.scores.pronunciation, 88);
  assert.equal(r.scores.grammar, 60);
  // 과제 수행: (95×45 + 70×195) / 240 = 74.7
  assert.equal(r.scores.relevance, 74.7);
  // 총점 0.15·88 + 0.15·76 + 0.1·64 + 0.2·60 + 0.2·55 + 0.2·74.7 = 68.9
  assert.equal(r.total, 68.9);
  assert.equal(r.items[0].transcript, readText, '문장 읽기는 읽은 글 그대로 인식됐다');
  assert.equal(r.items[1].transcript.startsWith('answer 1 recorded for 6 seconds'), true);
  assert.equal(r.items[0].seconds, 10);
  const lastWord = readText
    .split(/\s+/)
    .at(-1)
    .replace(/[^A-Za-z']/g, '');
  assert.deepEqual(
    r.items[0].words,
    [{ word: lastWord, accuracy: 40, error: 'Mispronunciation' }],
    '틀린 낱말만 남긴다'
  );
  assert.deepEqual(r.items[1].words, [{ word: 'recorded', accuracy: 40, error: 'Mispronunciation' }]);
  assert.equal(r.items[0].feedbackKo, '', '문장 읽기는 글 채점이 없다');
  assert.equal(r.items[1].feedbackKo, '좋아요. 시제를 조심하세요.');
  assert.ok(!('audio' in r.items[0]), '녹음은 남기지 않는다');

  const t = text(view);
  assert.match(t, /🐗 멧돼지 · 일반 · 2026\.11\.13 10:00/);
  assert.match(t, /총점69/);
  assert.match(t, /TOEIC Speaking 예상140점 · IHIntermediate High/);
  assert.match(t, /OPIc 예상IM3/);
  const bands = byClass('band');
  assert.equal(bands.length, 2);
  assert.equal(descendants(bands[0]).find((e) => e.classList.contains('on')).textContent, 'IH');
  assert.equal(descendants(bands[1]).find((e) => e.classList.contains('on')).textContent, 'IM3');
  assert.equal(byClass('level-dim').length, 6);
  assert.match(t, /발음88/);
  assert.match(t, /과제 수행75/);
  await until(() => text(view).includes('- 총평입니다.'), 'AI 총평');
  assert.equal(gemini.summaries, 1);
  assert.equal(getLevelTests()[0].summary, '- 총평입니다.', '총평도 저장');
  assert.equal(byClass('level-item').length, 7);
  assert.match(text(byClass('level-item')[0]), /1\. 문장 읽기[\s\S]*내 답변[\s\S]*발음을 다듬을 단어[\s\S]*\(발음\)/);
  assert.match(
    text(byClass('level-item')[1]),
    /recorded for → that was recorded for[\s\S]*한 단계 위 모범 답변[\s\S]*A better answer\./
  );
  assert.match(text(byClass('level-item')[1]), /2\. 사진 묘사[\s\S]*answer 1 recorded[\s\S]*recorded \(발음\)/);
  assert.equal(getAzureUsage().seconds, 10 + 6 + 5 + 5 + 31 + 8 + 20, '보낸 음성 시간 (5번은 시간이 다 돼 31초)');
  assert.equal(getAzureUsage().month, '2026-11');
});

test('결과 목록: 날짜·시간·응시자·난이도·총점·등급을 보여 주고 누르면 성적표, 다음 시험은 최근 문제를 피한다', async () => {
  button(view, '결과 목록').click();
  assert.equal(stage(), 'home');
  const row = byClass('level-row')[0];
  assert.match(text(row), /2026\.11\.13 10:00🐗멧돼지일반69점IH · OPIc IM3/);
  assert.match(text(view), /1분 \/ 무료 300분/, '85초 → 1분');
  row.click();
  assert.equal(stage(), 'report');
  assert.match(text(view), /총점69/);
  button(view, '한 번 더 응시하기').click();

  const first = getLevelTests()[0].bankIds;
  azure.recognizers.length = 0;
  chip('꿀돼지').click();
  segment(view, '쉬움').click();
  startBtn().click();
  await until(() => stage() === 'test', '시작');
  await until(() => status() === '준비 시간', '준비');
  assert.equal(timeText(), '0:25', '쉬움은 준비 25초');
  const quitBtn = els().find((e) => e.attributes['aria-label'] === '그만두기');
  globalThis.confirm = () => true;
  quitBtn.click();
  assert.equal(stage(), 'home');
  assert.equal(getLevelTests().length, 1, '그만두면 저장하지 않는다');
  assert.equal(azure.recognizers.length, 0);

  // 같은 응시자(멧돼지)의 다음 시험은 방금 푼 문제를 내지 않는다
  const { buildTest, recentBankIds } = await import('../js/lib/level.js');
  const recent = recentBankIds(getLevelTests(), 'boar');
  for (let i = 0; i < 10; i++) {
    const t = buildTest('normal', recent, Math.random);
    assert.ok(
      t.bankIds.every((id) => !first.includes(id)),
      '최근 문제 제외'
    );
  }
});

test('멈춤: 녹음 중에 다른 탭으로 가면 그 문항을 버리고 멈추며, 이어서 하기는 그 문항부터 다시', async () => {
  const recognized = azure.recognizers.length;
  chip('원숭이').click();
  segment(view, '일반').click();
  startBtn().click();
  await until(() => stage() === 'test', '시작');
  await answer(5); // 1번
  await until(() => text(view).includes('2 / 7'), '2번');
  await toRecording();
  micChunk(48000 * 3, 0.3);
  level.hide();
  assert.equal(stage(), 'paused');
  assert.match(text(view), /잠시 멈췄어요 \(2 \/ 7\)/);
  assert.equal(mic.tracks.at(-1).readyState, 'ended', '녹음을 버린다');
  level.show();
  button(view, '이어서 하기').click();
  await until(() => stage() === 'test' && text(view).includes('2 / 7'), '2번부터');
  // 앱이 가려져도 멈춘다
  await toRecording();
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(stage(), 'paused');
  document.hidden = false;
  globalThis.confirm = () => true;
  button(view, '그만두기').click();
  assert.equal(stage(), 'home');
  await until(
    () => azure.recognizers.length === recognized + 1 && azure.recognizers.at(-1).closed,
    '1번 답의 발음 평가는 뒤에서 끝난다'
  );
});

test('채점 실패: Azure 오류면 알리고 다시 시도할 수 있으며, 2초보다 짧은 답은 Azure로 보내지 않는다', async () => {
  azure.recognizers.length = 0;
  gemini.grades.length = 0;
  chip('꿀꿀돼지').click();
  segment(view, '쉬움').click();
  startBtn().click();
  await until(() => stage() === 'test', '시작');
  azure.fail = { code: 8, details: 'Quota exceeded' };
  await answer(4); // 1번: 실패
  await until(() => text(view).includes('2 / 7'), '2번');
  await until(() => azure.recognizers.length === 1 && azure.recognizers[0].closed, '1번 채점이 실패로 끝난다');
  azure.fail = null;
  await answer(1); // 2번: 너무 짧다
  for (let i = 3; i <= 7; i++) {
    await until(() => text(view).includes(`${i} / 7`), `${i}번`);
    await answer(3);
  }
  await until(
    () => stage() === 'grading' && text(view).includes('1번: 이번 달 Azure 무료 사용량(5시간)을 다 썼어요'),
    '실패 안내'
  );
  await until(() => button(view, '채점 다시 시도'), '다시 시도 버튼');
  assert.equal(azure.recognizers.length, 6, '2번(짧은 답)은 보내지 않았다');
  button(view, '채점 다시 시도').click();
  await until(() => stage() === 'report', '다시 채점해 성적표');
  const [r] = getLevelTests();
  assert.equal(r.taker, 'honey2');
  assert.equal(r.level, 'easy');
  assert.deepEqual(
    r.items[1].scores,
    { pronunciation: 0, fluency: 0, prosody: 0, grammar: 0, vocabulary: 0, relevance: 0 },
    '짧은 답은 0점'
  );
  assert.equal(r.items[1].transcript, '');
  assert.match(text(byClass('level-item')[1]), /말소리가 없었어요/);
  assert.equal(gemini.grades.length, 5, '짧은 답은 Gemini로도 보내지 않는다');
  assert.equal(getLevelTests().length, 2);
  button(view, '결과 목록').click();
  assert.equal(byClass('level-row').length, 2);
  assert.match(text(byClass('level-row')[0]), /🐽꿀꿀돼지쉬움/);
});

test.after(() => mock.timers.reset());
