// 레벨테스트 Gemini 요청: 받아쓴 답을 글로 채점(문법·어휘·과제 수행)하고, 시험이 끝나면 한국어 총평을 쓴다.
// 발음·유창성·억양은 Azure 음성 평가(services/azure-speech.js)가 맡는다. 녹음은 Gemini로 보내지 않는다.

import { generate, S } from './gemini.js';
import { LEVELS, partOf, promptText } from '../lib/level.js';

const NUM = (description) => ({ type: 'NUMBER', description });

const GRADE_SYSTEM =
  'You are an experienced rater for English speaking tests such as TOEIC Speaking and OPIc. You rate ONE spoken ' +
  'answer from a Korean learner using its speech-recognition transcript. The transcript has no reliable punctuation ' +
  'or capitalization and may contain recognition errors on rare words, so never penalize punctuation, capitalization ' +
  'or a single odd word. Write all feedback in natural, friendly Korean.';

// 0~100 기준 (토익스피킹·OPIc 등급 설명에 맞춤). 성적표의 등급 환산이 이 기준을 따른다
const RUBRIC =
  'Score each criterion from 0 to 100: 0–19 = no usable English (silence, Korean only or isolated words); ' +
  '20–39 = memorized words and fragments, meaning hard to follow (Novice); 40–54 = simple short sentences with ' +
  'frequent errors that sometimes block meaning (Intermediate Low); 55–69 = connected simple sentences, errors are ' +
  'noticeable but meaning is clear (Intermediate Mid); 70–79 = paragraph-length, organized answers with a range of ' +
  'structures and only minor errors (Intermediate High); 80–89 = detailed, well-organized, flexible language with ' +
  'rare errors (Advanced Low/Mid); 90–100 = near-native. ' +
  'grammar = correctness and range of sentence structures and verb forms; vocabulary = appropriate, varied and ' +
  'precise word choice for the task; relevance = task completion: answers the exact question, with reasons, details ' +
  'or examples appropriate to the time allowed, in a logical order. A very short answer for a 45–60 second task ' +
  'cannot score above 55 in relevance. Off-topic or empty answers score below 20 in relevance.';

/**
 * 답 하나를 글로 채점한다 (Gemini).
 * @param {{task: object, level: string, transcript: string, seconds: number}} a
 * @param {{signal?: AbortSignal}} [o]
 * @returns {Promise<{grammar: number, vocabulary: number, relevance: number, feedbackKo: string,
 *   corrections: {original: string, corrected: string, noteKo: string}[], better: string}>}
 */
export async function gradeAnswer({ task, level, transcript, seconds }, { signal } = {}) {
  const part = partOf(task.part);
  const text = String(transcript ?? '').trim();
  const r = await generate({
    system: GRADE_SYSTEM,
    prompt:
      `Test part: ${part?.label ?? task.part} (${task.part}). Difficulty: ${LEVELS[level] ?? level}. ` +
      `Time allowed: ${task.answer} seconds; the learner spoke for about ${Math.round(seconds)} seconds.\n` +
      `Task given to the learner: ${promptText(task)}\n\n` +
      `Transcript of the answer:\n"""\n${text || '(nothing was recognized)'}\n"""\n\n` +
      `${RUBRIC}\n\nIn feedbackKo, write 2–3 short Korean sentences: one thing done well and the first thing to fix. ` +
      'In corrections, list up to 3 of the most useful fixes (original words from the transcript → natural correction, ' +
      'with a short Korean note); none if the answer is empty. In better, write a natural model answer in English of ' +
      'about the same length as the time allows (roughly 2 sentences per 15 seconds), one level above the learner, ' +
      'keeping their ideas when there are any.',
    schema: S.obj({
      grammar: NUM('0–100'),
      vocabulary: NUM('0–100'),
      relevance: NUM('0–100'),
      feedbackKo: S.str('2–3 short Korean sentences'),
      corrections: S.arr(
        S.obj({
          original: S.str('Words from the transcript'),
          corrected: S.str('Natural correction'),
          noteKo: S.str('Short Korean note'),
        }),
        '0–3 items'
      ),
      better: S.str('Model answer in English'),
    }),
    signal,
    firstChunkMs: 20000,
    timeoutMs: 45000,
  });
  const score = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('채점 결과를 읽지 못했습니다. 다시 시도해 주세요.');
    return Math.round(Math.min(100, Math.max(0, n)));
  };
  return {
    grammar: score(r?.grammar),
    vocabulary: score(r?.vocabulary),
    relevance: score(r?.relevance),
    feedbackKo: String(r?.feedbackKo ?? '').trim(),
    corrections: (Array.isArray(r?.corrections) ? r.corrections : [])
      .filter((c) => c?.original && c?.corrected)
      .slice(0, 3)
      .map((c) => ({ original: String(c.original), corrected: String(c.corrected), noteKo: String(c.noteKo ?? '') })),
    better: String(r?.better ?? '').trim(),
  };
}

/**
 * 총평 (Gemini, 글만): 항목 점수와 과제별 피드백을 모아 강점·약점과 이번 주 연습 방법을 한국어로
 * @param {{total: number, scores: object, items: {part: string, prompt: string, transcript: string, scores: object,
 *   feedbackKo: string}[]}} result
 * @returns {Promise<string>}
 */
export async function summarize(result, { signal } = {}) {
  const items = result.items
    .map(
      (it, i) =>
        `Task ${i + 1} (${it.part}): ${it.prompt}\nAnswer: ${it.transcript || '(no answer)'}\n` +
        `Scores: ${JSON.stringify(it.scores)}${it.feedbackKo ? `\nFeedback: ${it.feedbackKo}` : ''}`
    )
    .join('\n\n');
  const text = await generate({
    system:
      'You are a friendly English speaking coach for a Korean learner. Write in natural Korean, plain text without ' +
      'markdown symbols.',
    prompt:
      `Overall ${result.total}/100 (pronunciation, fluency, prosody from Azure speech assessment; grammar, vocabulary, ` +
      `relevance from a rater): ${JSON.stringify(result.scores)}.\n\n${items}\n\n` +
      'Write a short overall review in Korean: 1 sentence on the current level, 2 strengths, 2 things to improve ' +
      'first (quote the English words involved), and 2 concrete ways to practice this week. Use short lines starting ' +
      'with "- ".',
    signal,
    maxOutputTokens: 900,
  });
  return String(text).trim();
}
