// AI 영어회화 튜터 프롬프트 생성기(앱 안 음성 튜터·다른 앱용)와 ChatGPT·Gemini 앱 실행 주소

export const LEVELS = {
  beginner: {
    label: '초급',
    hint: 'A1–A2',
    say: 'a beginner',
    en: 'Beginner (CEFR A1–A2). Use very simple, common words and short sentences. Speak slowly and clearly.',
  },
  intermediate: {
    label: '중급',
    hint: 'B1–B2',
    say: 'an intermediate',
    en: 'Intermediate (CEFR B1–B2). Use natural everyday English and sometimes introduce a useful idiom or phrasal verb.',
  },
  advanced: {
    label: '고급',
    hint: 'C1–C2',
    say: 'an advanced',
    en: 'Advanced (CEFR C1–C2). Talk like a native speaker, with idioms, natural fillers and nuanced expressions.',
  },
};

export const CORRECTIONS = {
  each: { label: '매번 바로 교정', say: 'Please correct my mistakes briefly as we talk.' },
  end: { label: '대화 끝나고 모아서 정리', say: 'Please review my mistakes at the end.' },
  none: { label: '교정 없이 대화만', say: "Let's just talk, with no corrections." },
};

/** roleplay: true면 상황극(역할 유지), topic: 'required' | 'optional', say: 음성 모드에서 처음에 말할 상황 설명 */
export const SCENARIOS = [
  {
    id: 'free',
    group: '일상',
    label: '자유 대화 (일상·취미)',
    en: 'Free conversation about my daily life, work, hobbies and interests. You are a friendly conversation partner who is curious about me.',
    say: "Let's just chat about my daily life and interests.",
  },
  {
    id: 'smalltalk',
    group: '일상',
    label: '외국인 친구와 스몰토크',
    roleplay: true,
    en: 'Role-play: you are my friend from abroad. We catch up over coffee and chat about recent news in our lives, weekend plans and food.',
    say: "Let's role-play: you're my friend from abroad, and we're catching up over coffee.",
  },
  {
    id: 'cafe',
    group: '여행·생활',
    label: '카페에서 주문하기',
    roleplay: true,
    en: "Role-play: we're at a café. You are the barista and I am a customer ordering drinks and snacks. Ask about size, options and payment.",
    say: "Let's role-play at a café: you're the barista and I'm ordering.",
  },
  {
    id: 'restaurant',
    group: '여행·생활',
    label: '식당 예약·주문',
    roleplay: true,
    en: 'Role-play: at a restaurant. You are the staff member. I first make a reservation, then order a meal, ask about the menu, and finally ask for the bill.',
    say: "Let's role-play at a restaurant: you're the staff, and I'll book a table and order.",
  },
  {
    id: 'airport',
    group: '여행·생활',
    label: '공항 체크인·입국심사',
    roleplay: true,
    en: 'Role-play: at the airport. First you are the airline check-in agent, then the immigration officer asking about the purpose and details of my trip.',
    say: "Let's role-play at the airport: you're the check-in agent, then the immigration officer.",
  },
  {
    id: 'hotel',
    group: '여행·생활',
    label: '호텔 체크인·요청하기',
    roleplay: true,
    en: 'Role-play: at a hotel. You are the front desk clerk. I check in, ask about facilities, and make a request or complaint about my room.',
    say: "Let's role-play at a hotel: you're the front desk clerk and I'm checking in.",
  },
  {
    id: 'directions',
    group: '여행·생활',
    label: '길 묻기·대중교통',
    roleplay: true,
    en: 'Role-play: I am a tourist and you are a local. I ask for directions and how to use public transportation to get somewhere.',
    say: "Let's role-play: I'm a tourist asking you, a local, for directions.",
  },
  {
    id: 'shopping',
    group: '여행·생활',
    label: '쇼핑·교환·환불',
    roleplay: true,
    en: 'Role-play: in a clothing store. You are the shop assistant. I look for items, ask about sizes and prices, and later ask for an exchange or a refund.',
    say: "Let's role-play in a clothing store: you're the shop assistant.",
  },
  {
    id: 'doctor',
    group: '여행·생활',
    label: '병원·약국',
    roleplay: true,
    en: 'Role-play: you are a doctor (later a pharmacist). I explain my symptoms and ask about treatment and how to take the medicine.',
    say: "Let's role-play: you're a doctor, and I'll explain my symptoms.",
  },
  {
    id: 'phone',
    group: '여행·생활',
    label: '전화 통화 (예약·문의)',
    roleplay: true,
    en: 'Role-play: a phone call. You are a customer service agent. I call to make an appointment or to solve a problem. Use typical phone expressions.',
    say: "Let's role-play a phone call: you're a customer service agent.",
  },
  {
    id: 'meeting',
    group: '업무',
    label: '회의·업무 대화',
    roleplay: true,
    en: 'Role-play: a work meeting. You are my colleague. We discuss project progress, schedules, problems and next steps. Help me use professional expressions.',
    say: "Let's role-play a work meeting: you're my colleague.",
  },
  {
    id: 'interview',
    group: '업무',
    label: '영어 면접',
    roleplay: true,
    en: 'Role-play: a job interview in English. You are the interviewer. Ask common interview questions one at a time, including follow-up questions about my answers.',
    say: "Let's role-play a job interview: you're the interviewer.",
  },
  {
    id: 'debate',
    group: '학습',
    label: '주제 토론',
    topic: 'required',
    en: 'Discussion on the topic below. Share your opinion, ask for my reasons and examples, and politely challenge my ideas so I have to explain more.',
    say: "Let's discuss a topic and share our opinions.",
  },
  {
    id: 'review',
    group: '학습',
    label: '내 단어장 복습',
    words: true,
    en: 'Vocabulary practice with the words and expressions listed below. In each turn, create a question or a short situation that makes me use one of them in my answer. Tell me whether I used it naturally.',
    say: "Let's practice useful everyday expressions for my level.",
  },
  {
    id: 'custom',
    group: '학습',
    label: '직접 상황 입력',
    topic: 'required',
    roleplay: true,
    en: 'Role-play in the situation described below. Take the most natural role for yourself.',
    say: "Let's role-play a situation.",
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

/**
 * 앱 안 음성 튜터의 시스템 지시문: 음성용 튜터 요청문 + 실시간 음성 대화 규칙.
 * @param {object} o 튜터 옵션 + words
 * @param {{live?: boolean}} [mode] live: Gemini Live(교정은 show_correction 도구) / 아니면 기본 음성 모드(JSON 답)
 */
export function buildVoiceTutorSystem(o = {}, { live = true } = {}) {
  const opt = { ...DEFAULT_TUTOR_OPTIONS, ...o, voice: true };
  const fix = live ? 'call show_correction' : 'add an item to "corrections"';
  const ko = opt.koreanHelp ? ' (with a short explanation_ko in Korean)' : '';
  const lines = [buildTutorPrompt(opt), '', '[Voice session rules - these override the rules above]'];
  lines.push(
    '- This is a real-time voice conversation in a learning app. Always answer when I speak; never stay silent.'
  );
  lines.push('- Speak short, natural spoken English: 1–3 sentences per turn, then let me talk.');
  lines.push(
    opt.koreanHelp
      ? '- Speak only English. Write Korean only in explanation_ko of a correction.'
      : '- Speak only English. Never use Korean.'
  );
  if (opt.correction === 'each') {
    lines.push(
      `- When my last sentence had a clear mistake or sounded unnatural, ${fix} with my original sentence and the corrected sentence${ko}, then continue the conversation. Ignore tiny slips${live ? '' : ' and speech-recognition errors'}.`
    );
  } else if (opt.correction === 'end') {
    lines.push(
      `- Don't correct me during the conversation. When I say "end session", ${fix} for each of my main mistakes${ko}, then give a short spoken review.`
    );
  } else {
    lines.push(`- Don't ${fix} unless I ask you to correct me.`);
  }
  if (!live) {
    lines.push(
      '- "reply" is exactly what you say aloud: no markdown, emojis or lists. Leave "corrections" empty when there is nothing to correct.'
    );
    lines.push('- My messages come from speech recognition, so ignore missing punctuation and capitalization.');
  }
  return lines.join('\n');
}

/** 요청문을 넘길 수 없는 음성 모드(Gemini Live, 전원 버튼으로 연 ChatGPT 음성)에서 처음에 소리 내어 말할 문장 */
export function buildSpokenOpener(o = {}) {
  const opt = { ...DEFAULT_TUTOR_OPTIONS, ...o };
  const sc = getScenario(opt.scenario);
  const level = LEVELS[opt.level] || LEVELS.intermediate;
  const topic = String(opt.topic || '')
    .trim()
    .replace(/[.!?]+$/, '');
  const words = sc.words ? (opt.words || []).filter((w) => w && w.text).slice(0, 5) : [];
  return [
    `Hi! Please be my English conversation tutor. I'm ${level.say} learner.`,
    words.length ? `Help me practice these expressions: ${words.map((w) => w.text).join(', ')}.` : sc.say,
    sc.topic === 'required' && topic ? `${sc.id === 'custom' ? 'The situation is' : 'The topic is'}: ${topic}.` : '',
    (CORRECTIONS[opt.correction] || CORRECTIONS.each).say,
    'Keep your answers short, and please start.',
  ]
    .filter(Boolean)
    .join(' ');
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
    // autosend=true면 요청문이 바로 보내진다. 앱이 없어 웹으로 열 때는 입력창에 넣기만 한다
    url: (prompt) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}&autosend=true`,
    fallbackUrl: (prompt) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
  },
  gemini: {
    label: 'Gemini',
    // Gemini 화면은 Google 앱이 연다 (bard 패키지는 /app 주소를 처리하지 않는다)
    androidPackage: 'com.google.android.googlequicksearchbox',
    url: (prompt) => `https://gemini.google.com/app?q=${encodeURIComponent(prompt)}`,
  },
};

/** Gemini 앱의 Live(음성 대화) 화면을 바로 여는 주소. Live는 요청문을 받지 못한다 */
export const GEMINI_LIVE_URL =
  'https://gemini.google.com/app?android-min-version=301356232&ios-min-version=322.0&is_sa=1&target=live';

/**
 * 안드로이드 intent: 주소. 설치된 앱을 지정해 열고,
 * 앱이 그 주소를 처리하지 못하거나 설치되어 있지 않으면 fallback 웹 주소로 이동한다.
 */
function intentUrl(url, androidPackage, fallback = url) {
  return `intent://${url.replace(/^https:\/\//, '')}#Intent;scheme=https;package=${androidPackage};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}

/** 앱 실행 주소 (데스크톱은 웹 주소) */
export function buildAppLaunchUrl(appId, prompt, { android = false } = {}) {
  const app = AI_APPS[appId] || AI_APPS.chatgpt;
  const url = app.url(prompt);
  return android ? intentUrl(url, app.androidPackage, app.fallbackUrl?.(prompt) ?? url) : url;
}

export function buildGeminiLiveUrl({ android = false } = {}) {
  return android ? intentUrl(GEMINI_LIVE_URL, AI_APPS.gemini.androidPackage) : GEMINI_LIVE_URL;
}
