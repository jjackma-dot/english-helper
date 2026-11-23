// 게임 속 AI 대화 (Gemini, 이 기기에 키가 있을 때만): 핍에게 자유롭게 묻기, 용의자 심문.
// 수준(Basic~IM3)에 맞는 영어로, 퍼즐 답(색·숫자·암호 등)은 절대 말하지 않는다. 키가 없으면 화면이 질문 카드로 대신한다.

import { generate, S } from '../services/gemini.js';
import { ROOMS, SUSPECTS, suspectOf } from './story.js';

const LEVEL_GUIDE = {
  basic:
    'The listener is a Korean child in grade 1-2 (pre-A1). Use 3-6 very easy words per sentence, present tense, and only very common words (colors, numbers, big/small, yes/no). Use at most 2 short sentences.',
  im1: 'The listener is a Korean child in grade 3-4 (A1). Use short, simple sentences of about 6-10 words. Use at most 2 sentences.',
  im2: 'The listener is a Korean child in grade 5-6 (A2). Use simple connected sentences; past tense is fine. Use at most 3 sentences.',
  im3: 'The listener is a Korean middle or high school student (B1-B2). Use natural, friendly English with some descriptive words. Use at most 3 sentences.',
};

const SAFE =
  'This is a cooperative English-learning game for children. Keep everything kind, calm and never scary or violent. If the player says something rude or unsafe, gently steer back to the game. Reply only in English (except the separate Korean translation field).';

const REPLY = S.obj({
  reply: S.str('Your answer in English'),
  ko: S.str('Natural Korean translation of reply'),
});

/** 대화 기록 → Gemini contents (최근 8턴) */
const toContents = (history, question) => [
  ...history.slice(-8).map((m) => ({ role: m.from === 'me' ? 'user' : 'model', parts: [{ text: m.text }] })),
  { role: 'user', parts: [{ text: question }] },
];

/**
 * 핍에게 묻기
 * @param {{room: number, level: string, question: string, history?: {from: string, text: string}[], finale?: boolean, signal?: AbortSignal}} o
 */
export async function askPip({ room, level, question, history = [], finale = false, signal }) {
  const where = finale
    ? 'You are in the Core Room. The four suspects (Bolt, Zeek, Dr. Mira, Momo) are here. One of them took the Star Core.'
    : `You are in the ${ROOMS[room].title.en}. ${ROOMS[room].facts}`;
  const system =
    `You are Pip, a small, cheerful helper robot on Station NOVA. You sometimes say "Beep-boop!". ${SAFE}\n` +
    `Story: Last night at 9:10 someone took the Star Core (the glowing crystal that powers the station) and the lights went out. A solar storm is coming, so the cadets must restore each room, collect your four memory chips and find the Star Core. Captain Luna is at the Moon base.\n${where}\n` +
    `${LEVEL_GUIDE[level] ?? LEVEL_GUIDE.im1}\n` +
    'Puzzle rule: NEVER give codes, colors, numbers, passwords, letters, answers or who the culprit is. If asked for an answer, encourage the player to ask a teammate in English or to ask your buddy for a hint. You may explain what an object is or what an English word means. If the question is not about the game, answer very briefly and bring the player back to the mission. End with a short, easy question back to the player about once every two replies.';
  const r = await generate({ system, contents: toContents(history, question), schema: REPLY, signal, maxOutputTokens: 300, firstChunkMs: 15000, timeoutMs: 25000 });
  return { reply: String(r?.reply ?? '').trim(), ko: String(r?.ko ?? '').trim() };
}

/**
 * 용의자 심문. 범인은 자기 방에 계속 있었다고 거짓말을 하고, 증거를 들이대면 당황하지만 지목 전에는 고백하지 않는다
 * @param {{suspect: string, culprit: string, level: string, question: string, history?: object[], signal?: AbortSignal}} o
 */
export async function askSuspect({ suspect, culprit, level, question, history = [], signal }) {
  const s = suspectOf(suspect);
  const others = SUSPECTS.filter((x) => x.id !== suspect)
    .map((x) => `${x.name} (${x.job.en}, ${x.size}, ${x.color}, ${x.kind === 'robot' ? 'a robot that uses oil' : 'a living creature that eats cookies'})`)
    .join('; ');
  const guilty = suspect === culprit;
  const truth = guilty
    ? `SECRET: You took the Star Core at 9:10 last night, but you are embarrassed and scared, so you LIE: you say you stayed in the ${s.place.en} all night. In truth you left the ${s.place.en} at 9:05, took the Star Core from the Core Room at 9:10 and came back at 9:20. Keep the lie consistent. If the cadet points out clear evidence (the door log showing your door opened at 9:05 and 9:20, or a clue that fits only you), get nervous and stammer a little, but do not confess unless they officially accuse you. Never say you are the culprit.`
    : `You did NOT take the Star Core. You tell the truth: you went to the ${s.place.en} at ${s.arrive} PM and stayed there all night. You did not see who took it. You may say that it got dark at 9:10.`;
  const system =
    `You are ${s.name}, ${s.job.en} on Station NOVA, in a children's mystery game. Personality: ${s.style}. Appearance: ${s.size}, ${s.color}, ${s.kind === 'robot' ? 'a robot that uses oil (you never eat cookies)' : 'a living creature that eats cookies (you never use oil)'}. ${SAFE}\n` +
    `The Space Cadets are asking you questions about the missing Star Core. Other people on the station: ${others}.\n${truth}\n` +
    `${LEVEL_GUIDE[level] ?? LEVEL_GUIDE.im1}\n` +
    'Never say who the culprit is. Never accuse anyone. Answer the question in character. Never be scary.';
  const r = await generate({ system, contents: toContents(history, question), schema: REPLY, signal, maxOutputTokens: 300, firstChunkMs: 15000, timeoutMs: 25000 });
  return { reply: String(r?.reply ?? '').trim(), ko: String(r?.ko ?? '').trim() };
}
