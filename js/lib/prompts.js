// AI 영어회화 튜터 프롬프트 생성기와 ChatGPT·Gemini 앱 실행 주소

export const LEVELS = {
  beginner: {
    label: '초급',
    hint: 'A1–A2',
    en: 'Beginner (CEFR A1–A2). Use very simple, common words and short sentences. Speak slowly and clearly.',
  },
  intermediate: {
    label: '중급',
    hint: 'B1–B2',
    en: 'Intermediate (CEFR B1–B2). Use natural everyday English and sometimes introduce a useful idiom or phrasal verb.',
  },
  advanced: {
    label: '고급',
    hint: 'C1–C2',
    en: 'Advanced (CEFR C1–C2). Talk like a native speaker, with idioms, natural fillers and nuanced expressions.',
  },
};

export const CORRECTIONS = {
  each: { label: '매번 바로 교정' },
  end: { label: '대화 끝나고 모아서 정리' },
  none: { label: '교정 없이 대화만' },
};

/** roleplay: true면 상황극(역할 유지), topic: 'required' | 'optional' */
export const SCENARIOS = [
  {
    id: 'free',
    group: '일상',
    label: '자유 대화 (일상·취미)',
    en: 'Free conversation about my daily life, work, hobbies and interests. You are a friendly conversation partner who is curious about me.',
  },
  {
    id: 'smalltalk',
    group: '일상',
    label: '외국인 친구와 스몰토크',
    roleplay: true,
    en: 'Role-play: you are my friend from abroad. We catch up over coffee and chat about recent news in our lives, weekend plans and food.',
  },
  {
    id: 'cafe',
    group: '여행·생활',
    label: '카페에서 주문하기',
    roleplay: true,
    en: "Role-play: we're at a café. You are the barista and I am a customer ordering drinks and snacks. Ask about size, options and payment.",
  },
  {
    id: 'restaurant',
    group: '여행·생활',
    label: '식당 예약·주문',
    roleplay: true,
    en: 'Role-play: at a restaurant. You are the staff member. I first make a reservation, then order a meal, ask about the menu, and finally ask for the bill.',
  },
  {
    id: 'airport',
    group: '여행·생활',
    label: '공항 체크인·입국심사',
    roleplay: true,
    en: 'Role-play: at the airport. First you are the airline check-in agent, then the immigration officer asking about the purpose and details of my trip.',
  },
  {
    id: 'hotel',
    group: '여행·생활',
    label: '호텔 체크인·요청하기',
    roleplay: true,
    en: 'Role-play: at a hotel. You are the front desk clerk. I check in, ask about facilities, and make a request or complaint about my room.',
  },
  {
    id: 'directions',
    group: '여행·생활',
    label: '길 묻기·대중교통',
    roleplay: true,
    en: 'Role-play: I am a tourist and you are a local. I ask for directions and how to use public transportation to get somewhere.',
  },
  {
    id: 'shopping',
    group: '여행·생활',
    label: '쇼핑·교환·환불',
    roleplay: true,
    en: 'Role-play: in a clothing store. You are the shop assistant. I look for items, ask about sizes and prices, and later ask for an exchange or a refund.',
  },
  {
    id: 'doctor',
    group: '여행·생활',
    label: '병원·약국',
    roleplay: true,
    en: 'Role-play: you are a doctor (later a pharmacist). I explain my symptoms and ask about treatment and how to take the medicine.',
  },
  {
    id: 'phone',
    group: '여행·생활',
    label: '전화 통화 (예약·문의)',
    roleplay: true,
    en: 'Role-play: a phone call. You are a customer service agent. I call to make an appointment or to solve a problem. Use typical phone expressions.',
  },
  {
    id: 'meeting',
    group: '업무',
    label: '회의·업무 대화',
    roleplay: true,
    en: 'Role-play: a work meeting. You are my colleague. We discuss project progress, schedules, problems and next steps. Help me use professional expressions.',
  },
  {
    id: 'interview',
    group: '업무',
    label: '영어 면접',
    roleplay: true,
    en: 'Role-play: a job interview in English. You are the interviewer. Ask common interview questions one at a time, including follow-up questions about my answers.',
  },
  {
    id: 'debate',
    group: '학습',
    label: '주제 토론',
    topic: 'required',
    en: 'Discussion on the topic below. Share your opinion, ask for my reasons and examples, and politely challenge my ideas so I have to explain more.',
  },
  {
    id: 'review',
    group: '학습',
    label: '내 단어장 복습',
    words: true,
    en: 'Vocabulary practice with the words and expressions listed below. In each turn, create a question or a short situation that makes me use one of them in my answer. Tell me whether I used it naturally.',
  },
  {
    id: 'custom',
    group: '학습',
    label: '직접 상황 입력',
    topic: 'required',
    roleplay: true,
    en: 'Role-play in the situation described below. Take the most natural role for yourself.',
  },
];

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}

export const DEFAULT_TUTOR_OPTIONS = {
  app: 'chatgpt',
  scenario: 'free',
  level: 'intermediate',
  correction: 'each',
  koreanHelp: true,
  voice: false,
  topic: '',
};

/**
 * 튜터 요청 프롬프트를 만든다.
 * @param {object} o DEFAULT_TUTOR_OPTIONS 형태 + words: [{text, meaning}]
 */
export function buildTutorPrompt(o = {}) {
  const opt = { ...DEFAULT_TUTOR_OPTIONS, ...o };
  const sc = getScenario(opt.scenario);
  const level = LEVELS[opt.level] || LEVELS.intermediate;
  const topic = String(opt.topic || '').trim();
  const lines = [];

  lines.push(
    "You are my friendly English conversation tutor. I'm a native Korean speaker and I want to practice speaking English with you."
  );
  lines.push('');
  lines.push('[My level]');
  lines.push(level.en);
  lines.push('');
  lines.push("[Today's practice]");
  lines.push(sc.en);
  if (topic)
    lines.push(
      `${sc.roleplay && sc.id === 'custom' ? 'Situation' : sc.topic ? 'Topic' : 'Extra request from me'}: ${topic}`
    );
  if (sc.words) {
    const words = (opt.words || []).filter((w) => w && w.text).slice(0, 30);
    if (words.length) {
      lines.push('Words and expressions to practice:');
      for (const w of words) lines.push(`- ${w.text}${w.meaning ? ` (${oneLine(w.meaning)})` : ''}`);
    } else {
      lines.push(
        'I have no saved words yet, so choose 8 useful everyday expressions for my level and practice them with me.'
      );
    }
  }
  lines.push('');
  lines.push('[How to talk with me]');
  lines.push('- Speak only in English, adjusted to my level.');
  lines.push(
    opt.voice
      ? '- Keep each of your turns to one or two short sentences, then let me speak.'
      : '- Keep each of your turns short (1–3 sentences) and end with a question or prompt so that I keep talking.'
  );
  if (sc.roleplay) lines.push('- Stay in character during the role-play, and react naturally to what I say.');
  lines.push(
    "- If I don't know how to say something, I may say it in Korean. Then teach me a natural way to say it in English and let me try again."
  );
  if (opt.correction === 'each') {
    lines.push(
      opt.voice
        ? '- When I make a clear mistake, briefly say "A more natural way is: ..." with the corrected sentence, then continue the conversation. Ignore tiny slips.'
        : '- After each of my messages, if there are mistakes or unnatural expressions, first show the corrected sentence in one line starting with "✏️", then continue the conversation. If my sentence was fine, just continue.'
    );
  } else if (opt.correction === 'end') {
    lines.push(
      "- Don't interrupt the conversation with corrections. Keep track of my mistakes and review them all at the end."
    );
  } else {
    lines.push("- Don't correct my mistakes unless I ask. Focus on keeping the conversation natural and fun.");
  }
  if (opt.koreanHelp) {
    lines.push('- Explain corrections and the final review in Korean, but keep the conversation itself in English.');
  }
  if (opt.voice) {
    lines.push(
      "- We are talking by voice. Don't use markdown, emojis, lists or special symbols. Speak naturally and a little slowly."
    );
  }
  const review =
    opt.correction === 'none'
      ? '5 useful expressions from our conversation and one tip for next time'
      : 'my main mistakes with corrections, 5 useful expressions from our conversation, and one tip for next time';
  lines.push(
    `- When I say "end session", stop the conversation and give me a short review: ${review}${opt.koreanHelp ? ' (explanations in Korean)' : ''}.`
  );
  lines.push('');
  lines.push(
    sc.roleplay
      ? "Let's start now. Briefly set the scene in one sentence, then say your first line in character."
      : "Let's start now. Greet me and ask your first question."
  );
  return lines.join('\n');
}

function oneLine(s) {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** 대화 중간에 붙여넣어 쓰는 요청 문장 */
export const FOLLOW_UPS = [
  { label: '더 쉽게 말해 주세요', text: 'Please speak more simply and use easier words.' },
  {
    label: '방금 내 문장 고쳐 주세요',
    text: 'Please correct my last sentence and show me a more natural way to say it. Explain briefly in Korean.',
  },
  {
    label: '지금까지 틀린 것 정리',
    text: 'Please list the mistakes I have made so far with corrections, and explain them in Korean.',
  },
  {
    label: '이 상황 유용한 표현 5개',
    text: 'Give me 5 useful expressions for this situation, with Korean meanings and an example sentence for each.',
  },
  { label: '역할 바꾸기', text: "Let's switch roles." },
  { label: '세션 끝내고 리뷰', text: 'end session' },
];

export const AI_APPS = {
  chatgpt: {
    label: 'ChatGPT',
    androidPackage: 'com.openai.chatgpt',
    webUrl: (prompt) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
  },
  gemini: {
    label: 'Gemini',
    androidPackage: 'com.google.android.apps.bard',
    webUrl: () => 'https://gemini.google.com/app',
  },
};

/**
 * 앱 실행 주소. 안드로이드에서는 intent: 주소로 설치된 앱을 지정해 열고,
 * 앱이 그 주소를 처리하지 못하거나 설치되어 있지 않으면 웹 주소로 이동한다.
 */
export function buildAppLaunchUrl(appId, prompt, { android = false } = {}) {
  const app = AI_APPS[appId] || AI_APPS.chatgpt;
  const web = app.webUrl(prompt);
  if (!android) return web;
  const withoutScheme = web.replace(/^https:\/\//, '');
  return `intent://${withoutScheme}#Intent;scheme=https;package=${app.androidPackage};S.browser_fallback_url=${encodeURIComponent(web)};end`;
}
