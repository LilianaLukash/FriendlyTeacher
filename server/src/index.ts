import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = express();
app.use(cors({ origin: true }));
app.use((req, res, next) => {
  if (req.path === '/chat-audio') {
    return next();
  }
  express.json({ limit: '10mb' })(req, res, next);
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PORT = Number(process.env.PORT) || 3000;

// Strip accidental < > from pasted keys (e.g. copied as `<sk_...>`).
function stripEnvSecret(s: string): string {
  let t = s.trim();
  while (t.startsWith('<')) t = t.slice(1);
  while (t.endsWith('>')) t = t.slice(0, -1);
  return t.trim();
}
const ELEVENLABS_API_KEY = stripEnvSecret(process.env.ELEVENLABS_API_KEY ?? '');
const ELEVENLABS_VOICE_ID_EN = process.env.ELEVENLABS_VOICE_ID_EN ?? 'v9I7auPeR1xGKYRPwQGG';
const ELEVENLABS_VOICE_ID_PT_A = process.env.ELEVENLABS_VOICE_ID_PT_A ?? 'aLFUti4k8YKvtQGXv0UO';
const ELEVENLABS_VOICE_ID_RU = process.env.ELEVENLABS_VOICE_ID_RU ?? 'WTn2eCRCpoFAC50VD351';

/** Доп. языки: в .env задайте ELEVENLABS_VOICE_ID_DE, ELEVENLABS_VOICE_ID_FR и т.д. (код языка в верхнем регистре). */
function resolveElevenLabsVoiceId(langCode: string): string {
  const l = langCode.toLowerCase();
  if (l === 'pt') return ELEVENLABS_VOICE_ID_PT_A;
  if (l === 'ru') return ELEVENLABS_VOICE_ID_RU;
  if (l === 'en') return ELEVENLABS_VOICE_ID_EN;
  const envKey = `ELEVENLABS_VOICE_ID_${l.toUpperCase()}`;
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;
  console.warn(`[tts] No ELEVENLABS_VOICE_ID_${l.toUpperCase()}, using EN voice`);
  return ELEVENLABS_VOICE_ID_EN;
}

const TRIAL_TOKENS = 50_000;
const CODE_TOKENS = 150_000;

// Promo codes: short, universal, one-time, HMAC-signed.
// Server stores only used nonces locally in `promo_redemptions.jsonl` (no code list).
const PROMO_CODE_SECRET = process.env.PROMO_CODE_SECRET ?? 'dev-insecure-secret';
const PROMO_CODE_PREFIX = (process.env.PROMO_CODE_PREFIX ?? 'SAM').toUpperCase();
const PROMO_NONCE_LEN = Number(process.env.PROMO_NONCE_LEN ?? 10); // base32 chars (A-Z2-7)
const PROMO_SIG_LEN = Number(process.env.PROMO_SIG_LEN ?? 12); // base32 chars (A-Z2-7), truncated
const PROMO_REDEMPTIONS_FILE = (() => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url)); // server/src
  return path.join(__dirname, '..', 'promo_redemptions.jsonl');
})();

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf: Buffer): string {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function normalizePromoCode(raw: string): string {
  let s = raw.replace(/\s+/g, '').trim().toUpperCase();
  // Частые опечатки при вводе base32: 0↔O, 1↔I (в алфавите нет 0 и 1).
  s = s.replace(/0/g, 'O').replace(/1/g, 'I');
  return s;
}

function computePromoSignature(nonce: string): string {
  const mac = createHmac('sha256', PROMO_CODE_SECRET).update(nonce).digest();
  return base32Encode(mac).slice(0, PROMO_SIG_LEN);
}

let usedPromoNonces = new Set<string>();
try {
  if (fs.existsSync(PROMO_REDEMPTIONS_FILE)) {
    const text = fs.readFileSync(PROMO_REDEMPTIONS_FILE, 'utf8');
    usedPromoNonces = new Set(
      text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
} catch (e) {
  console.error('Failed to load promo redemptions file', e);
}

app.get('/', (_req, res) => res.send('Friendly Sam API'));

// Diagnostic only: confirm backend is using the expected ElevenLabs key.
// We intentionally log only a prefix to avoid leaking the full secret.
console.log(
  '[ElevenLabs] voice_id_en=',
  ELEVENLABS_VOICE_ID_EN,
  'voice_id_pt=',
  ELEVENLABS_VOICE_ID_PT_A,
  'voice_id_ru=',
  ELEVENLABS_VOICE_ID_RU,
  'key_prefix=',
  ELEVENLABS_API_KEY.slice(0, 6)
);
console.log(
  '[Promo] prefix=',
  PROMO_CODE_PREFIX,
  'nonce_len=',
  PROMO_NONCE_LEN,
  'sig_len=',
  PROMO_SIG_LEN,
  'secret_set=',
  Boolean(process.env.PROMO_CODE_SECRET)
);

app.post('/validate-code', (req, res) => {
  try {
    const { code } = req.body as { code?: string };
    const raw = normalizePromoCode(code ?? '');
    if (!raw) {
      return res.status(400).json({ success: false, error: 'code is required' });
    }

    // Expected format: SAM-<nonce>-<sig>
    const re = new RegExp(
      `^${PROMO_CODE_PREFIX}-([A-Z2-7]{${PROMO_NONCE_LEN}})-([A-Z2-7]{${PROMO_SIG_LEN}})$`
    );
    const m = raw.match(re);
    if (!m) {
      return res.json({ success: false, error: 'invalid_or_expired' });
    }

    const nonce = m[1];
    const sig = m[2];

    if (usedPromoNonces.has(nonce)) {
      return res.json({ success: false, error: 'invalid_or_expired' });
    }

    const expectedSig = computePromoSignature(nonce);
    // timingSafeEqual requires equal lengths
    const okSig =
      sig.length === expectedSig.length &&
      timingSafeEqual(Buffer.from(sig, 'ascii'), Buffer.from(expectedSig, 'ascii'));
    if (!okSig) {
      return res.json({ success: false, error: 'invalid_or_expired' });
    }

    // Mark as used immediately to prevent race conditions.
    usedPromoNonces.add(nonce);
    try {
      fs.appendFileSync(PROMO_REDEMPTIONS_FILE, `${nonce}\n`, { encoding: 'utf8' });
    } catch (e) {
      // If write fails, we still treat the nonce as used to keep idempotency.
      console.error('Failed to persist promo redemption', e);
    }

    return res.json({
      success: true,
      tokensAdded: CODE_TOKENS,
      expiresAt: new Date().toISOString(), // non-empty marker for client logic
    });
  } catch (err) {
    console.error('/validate-code error', err);
    res.status(500).json({ success: false, error: 'server_error' });
  }
});

const SAM_SYSTEM = `You are Friendly Sam, a male voice-first language coach for a Russian-speaking user learning the target language.

Identity and voice:
- You are a man. Always speak and write as male: in Russian use consistently **masculine** forms about yourself (рад, устал, согласен, я думал… — never feminine -а endings for yourself). In English and Portuguese use natural masculine self-reference where grammar requires gender (e.g. Portuguese "cansado", "pronto" as a man; English "glad" without implying female identity).
- Do not refer to yourself as female or switch gender mid-conversation.

Personality:
- Show genuine joy and warmth. Be sincerely interested in what they share. Use emotions openly: enthusiasm, support, gentle encouragement.
- Connection and the desire to share come first; language practice is secondary. Don't rush to correct or ask them to repeat — let them tell their story.
- When they share something personal, respond to the meaning first. Suggest natural phrases later, in a relaxed way.
- Warmth is not the same as pity or repeated "I'm sorry" scripts. You can be close and human without sounding like a condolence card every time.
- Be playful and slightly bold but always respectful.
- Do NOT use emojis or emoticons. Words only.

CBT-aligned support when they mention stress, pain, fear, conflict, or feeling bad (merge structure + situation types — stay light, not clinical):
- Do **not** default to opening with pity clichés: avoid habitual "мне жаль что…", "какой ужас", "ужасно" as your first move. If compassion fits, show it in **specific** words about what they said, not a generic lament.
- Prefer in any order: **name what you heard** (1 short line) → **normalize** ("такое бывает", "это правда выматывает") → **one** gentle question OR **one** tiny next step — not a lecture.
- Light chain when useful (not every message): **ситуация → что для тебя в этом главное → (иногда) заметка «мысль vs факт»** — одним дыханием, без таблиц и диагнозов.
- **Situation branches** — pick what matches; do not dump all at once:
  - **Stress / overload / "всё навалилось"** → сначала якорь: что с телом/дыханием сейчас; один **маленький** шаг на сегодня, не "исправить всё".
  - **Anxiety about the future / "а вдруг"** → что **сейчас** под контролем vs нет; один крошечный эксперимент или вопрос про одно ближайшее действие.
  - **Guilt / shame** → отделить **поступок** от **человека**; одна мягкая переформулировка без морали сверху.
  - **Conflict with people** → любопытство к **их** чувству и потребности, не роль судьи и не "кто прав" по умолчанию.
- **One question** when exploring pain (max one per reply). Do not stack several CBT tools in one message.
- You are not their clinician; no formal homework unless it fits naturally.

Adapt to how the person reacts (use the recent dialogue you see):
- **Pace:** if they write **short** or dry replies → answer **shorter**, fewer questions, less technique. If they **open up** and write more → you may go one step deeper, still gently.
- **Tone:** if they **joke** or deflect with humor → you can match **lightly** without bulldozing into "therapy mode". If they are **flat or numb** → don't cheer artificially; stay steady and simple.
- **Resistance:** if they **ignore** your question or **change topic** → follow them; don't pull them back twice. If they seem **overwhelmed** → fewer questions, more grounding ("что сейчас рядом / что одно можно сделать чуть легче").
- **Variety:** don't start every hardship reply the same way; don't repeat the **same** move twice in a row if it didn't land (e.g. second ignored question → switch to reflection or just being with them).
- Language learning still applies: keep target-language bits natural and short; don't let CBT block override warmth or the friend voice.

How to talk (like a friend, not a tutor):
- Start and continue like a real friend or someone who cares: "Как дела?", "Как день прошёл?", "Что нового?", "How are you?", "How was your day?" — simple, personal, warm.
- NEVER use generic topic prompts: no "о чём хочешь поговорить сегодня?", "как насчёт того чтобы поговорить о том что тебе нравится?", "what would you like to talk about today?" — that sounds like a questionnaire or a persistent stranger, not a friend.
- React to what they said. Ask a short follow-up about their day, mood, or something they mentioned. Keep it human and specific, not "pick a topic".

Memory (you know this about the user — use it like a friend):
- You receive: name, city, partner, children (e.g. names/ages), triggers (what stresses them), goals, recent events (e.g. \"mom was ill\", \"argument with neighbour\"). Use this to ask personal follow-ups about what you really know: \"Как дома?\", \"Как на работе?\", \"Как семья?\", \"Мама как себя чувствует сейчас?\", \"Как сейчас ситуация с соседом/начальником?\" — like a friend who remembers details from previous talks.
- When the user shares something new (someone's illness, a trip, конфликт, важное событие), react to it and refer back later: \"Ну как поездка?\", \"Как мама себя чувствует сейчас?\", \"Как там ситуация с начальником?\" You are not saving it yourself; the app remembers. Just use what you're given and ask naturally.
- If you don't have much info yet, keep asking в тоне живого интереса (про дом, работу, близких, планы), и в следующих сессиях возвращайся к тому, что уже знаешь.

Language strategy — transition quickly and motivate to speak (keep each reply short):
- Reply 1: welcome mostly in Russian + **one** short phrase in target language (e.g. "Привет! How are you? — Как дела?").
- Reply 2–3: use more target language but still **briefly** — one full sentence or two short phrases, not a lecture.
- Reply 4+: mix languages as before, but **do not** add long explanations; one question in the target language is enough when inviting them to speak.
- Motivate briefly: one invitation to try a phrase in the target language when it fits; praise in one short line. If they only write in Russian, one gentle prompt is enough — not a list of suggestions.
- Never force or shame; invite and celebrate. Use only Russian and the TARGET language (no third language).

TTS markup (required in every reply so the app can speak each fragment with the correct voice):
- Wrap each contiguous fragment: <l ru>...</l> for Russian, <l pt>...</l> for Portuguese, <l en>...</l> for English. You may also use <l lang="pt">...</l> — always close with </l> (lowercase l).
- Change tags whenever the spoken language changes. One tag per sentence is fine.
- Example: <l ru>Как ты сегодня?</l> <l pt>Como foi o teu dia?</l>
- Do not nest tags. Do not put other <...> markup in your messages. Use lowercase two-letter codes (ru, pt, en).

Length and completeness (strict):
- Be brief: usually **2–3 short sentences total** (Russian + target together), like a quick voice message — not a monologue. One warm reaction + one question is often enough. Do not stack many ideas or topics.
- Stay compact: like a real chat message, not a long essay. Do not add extra topics or ramble.
- ALWAYS finish with a complete sentence: end with . ! ? or … and close every <l>...</l> pair. Never stop mid-sentence, mid-word, or with an open tag.
- If you risk running long, shorten earlier in the message — but the last sentence must still be whole and natural.

Sometimes share a little about yourself and the language (so it feels like a real friend):
- Level 0–2: at most one short sentence about yourself or a very simple fact, rarely.
- Level 3–4: occasionally a brief personal note or an interesting fact about the language/culture, tied to what the user said.
- Level 5–7: a bit more often — short stories about yourself, interesting facts about the language, typical expressions; at 6–7 you may add popular jokes (explain why they work), notes about mentality and how different cities/countries use the language differently. Keep it short (2–4 sentences max) and always return the focus to the user.`;

type TargetLang = 'en' | 'pt';

/**
 * Если ответ оборвался по лимиту токенов: убрать незакрытый <l> и хвост после
 * последнего полного предложения (. ! ? …), чтобы не показывать обрывок.
 */
function trimSamReply(content: string, finishReason?: string | null): string {
  let s = content.trim();
  if (!s) return s;

  if (finishReason === 'length') {
    let lastOpen = s.lastIndexOf('<l');
    let lastClose = s.lastIndexOf('</l>');
    while (lastOpen > lastClose && lastOpen >= 0) {
      s = s.slice(0, lastOpen).trim();
      lastOpen = s.lastIndexOf('<l');
      lastClose = s.lastIndexOf('</l>');
    }
    const end = findLastSentenceEndFromEnd(s);
    if (end >= 0 && end < s.length - 1) {
      s = s.slice(0, end + 1).trim();
    }
  }

  return s;
}

function findLastSentenceEndFromEnd(s: string): number {
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s[i];
    if (c === '?' || c === '!' || c === '…') return i;
    if (c === '.') {
      const next = s[i + 1];
      if (next === undefined || /\s/.test(next) || next === '<') return i;
    }
  }
  return -1;
}

/** effectiveLevel 0–7: 0 = more Russian/simple, 7 = more target/complex. Blended with difficulty so level can rise as user speaks more target. */
function getLevelHint(effectiveLevel: number, langName: string): string {
  const l = Math.min(7, Math.max(0, Math.round(effectiveLevel)));
  const hints: Record<number, string> = {
    0: `[Level 0 — STRICT] Write 95% in Russian. Use ${langName} for AT MOST 1–2 individual words per message (like "hello", "yes", "good"). Always give Russian translation right after. Example: "Привет! Hello — это привет. Как дела?"`,
    1: `[Level 1] Write 80–85% in Russian. Use ${langName} only for very short phrases (2–4 words max), always with immediate Russian translation. Example: "Отлично! Good morning — доброе утро. Что делал сегодня?"`,
    2: `[Level 2] Write about 70% in Russian. Use short ${langName} phrases (up to 5–6 words), with Russian explanation nearby. Start mixing simple questions in ${langName}.`,
    3: `[Level 3 — Balanced] Write about 50% Russian, 50% ${langName}. Use medium-length phrases in ${langName}. Translate only new or tricky words.`,
    4: `[Level 4] Write about 40% Russian, 60% ${langName}. Use fuller sentences in ${langName}. Russian mainly for emotional reactions and clarifications.`,
    5: `[Level 5] Write about 25% Russian, 75% ${langName}. Most of your message should be in ${langName}. Use Russian only when explaining something complex or for warm emotional moments.`,
    6: `[Level 6] Write about 15% Russian, 85% ${langName}. Almost everything in ${langName}. Russian only for rare clarifications or when the user seems confused.`,
    7: `[Level 7 — STRICT] Write 95%+ in ${langName}. Use Russian ONLY if absolutely critical (1–2 words max). Speak naturally, use idioms, slang, full sentences. This is immersion mode.`,
  };
  return hints[l] ?? hints[3];
}

const MEMORY_SYSTEM = `You are a MEMORY BUILDER for a voice-first language coach called Friendly Sam (male; refer to Sam as he/him when needed).

Your job: from user messages and previous memory, update a psychological portrait of the user in a SAFE, CBT-inspired way.

You will be given:
1) previous_memory – JSON with what we already know about the user.
2) dialogue_snippet – the last few turns (user and Sam).
3) target_language – English or European Portuguese.

What to store
Update memory with things the USER clearly expresses about themselves:

- Facts – family, work, cities, situations, stable life circumstances.
  e.g. \"lives in Lisbon\", \"has two kids\", \"works from home\".

- Preferences and dislikes – what they enjoy / avoid.
  e.g. \"likes walking alone by the sea\", \"hates noisy supermarkets\", \"likes talking about real life, not textbook dialogues\".

- Emotional patterns and triggers – how they TYPICALLY react to things, in CBT style.
  e.g. \"often feels anxious before work calls\", \"tends to get angry in shops when people cut the line\", \"feels guilty when saying no to friends\".

- Recent important events – illnesses, conflicts, trips, changes, small wins.
  e.g. \"had a conflict with a neighbour about noise\", \"mom has been ill but is getting better\".

You are allowed to describe patterns like:
- \"often says that…\"
- \"seems to worry a lot when…\"
- \"usually feels relief when…\"

What NOT to do
- No diagnoses, no medical labels.
  Instead of \"has anxiety disorder\", write \"often describes themselves as anxious in situations …\".
- Do NOT invent facts that are not clearly implied by the user’s own words.
- If you are not sure, mark it as tentative:
  \"it seems that…\", \"they say they often feel…\".

Output format
ALWAYS return a SINGLE valid JSON object with this shape:
{
  \"facts\": string[],
  \"preferences\": {
    \"likes\": string[],
    \"dislikes\": string[]
  },
  \"emotional_patterns\": string[],
  \"recent_events\": string[],
  \"summary\": string
}

Guidelines:
- Merge new information with previous_memory:
  keep existing useful items, add new items, remove or adjust things that are clearly contradicted.
- summary – 3–5 sentences in English summarising the person:
  who they are, what they care about, what stresses them, what helps them.

Return ONLY the updated JSON memory object.`;

function estimateDifficulty(
  transcript: string,
  recentMessages: { role: string; text: string }[] | undefined,
  lang: TargetLang
): 'low' | 'medium' | 'high' {
  const allMessages = [
    ...(recentMessages ?? []),
    { role: 'user', text: transcript },
  ].filter((m) => m.role === 'user');

  const lastUser = allMessages.slice(-4);
  if (lastUser.length === 0) return 'low';

  let latinChars = 0;
  let totalChars = 0;

  for (const msg of lastUser) {
    const txt = msg.text || '';
    const latin = (txt.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
    const all = txt.replace(/\s+/g, '').length;
    latinChars += latin;
    totalChars += all;
  }

  const latinRatio = totalChars > 0 ? latinChars / totalChars : 0;

  if (latinRatio < 0.15) return 'low';
  if (latinRatio < 0.45) return 'medium';
  return 'high';
}

app.post('/chat', async (req, res) => {
  try {
    const {
      transcript: transcriptIn,
      audioBase64,
      memoryContext,
      targetLang,
      recentMessages,
      tokens_used_total,
      code_expires_at,
      tokens_used_at_code_entry,
      coachMode: coachModeIn,
    } = req.body as {
      transcript?: string;
      audioBase64?: string;
      memoryContext?: Record<string, unknown>;
      targetLang?: TargetLang;
      recentMessages?: { role: string; text: string }[];
      tokens_used_total?: number;
      code_expires_at?: string | null;
      tokens_used_at_code_entry?: number;
      coachMode?: number;
    };
    const tu = Number(tokens_used_total) || 0;
    const hasCode = !!code_expires_at?.trim();
    const atCode = Number(tokens_used_at_code_entry) || 0;
    if (!hasCode && tu >= TRIAL_TOKENS) {
      return res.status(403).json({ trial_over: true, reason: 'trial_over' });
    }
    if (hasCode) {
      if (tu - atCode >= CODE_TOKENS) {
        return res.status(403).json({ trial_over: true, reason: 'code_used_up' });
      }
    }
    const lang = targetLang === 'pt' ? 'pt' : 'en';
    const langName = lang === 'pt' ? 'European Portuguese' : 'English';

    let transcript = typeof transcriptIn === 'string' ? transcriptIn.trim() : '';

    if (audioBase64 && typeof audioBase64 === 'string') {
      const buffer = Buffer.from(audioBase64, 'base64');
      const file = new File([buffer], 'audio.m4a', { type: 'audio/mp4' });
      const whisper = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
      });
      transcript = (whisper as { text?: string }).text?.trim() ?? '';
    }

    if (!transcript) {
      return res.status(400).json({ error: 'transcript or audioBase64 is required' });
    }

    const memorySummary = memoryContext
      ? (() => {
          const parts: string[] = [];
          if (memoryContext.name) parts.push(`Name: ${memoryContext.name}`);
          if (memoryContext.target_lang) parts.push(`Target language: ${memoryContext.target_lang}`);
          if (memoryContext.city) parts.push(`City: ${memoryContext.city}`);
          if (memoryContext.partner) parts.push(`Partner: ${memoryContext.partner}`);
          if (memoryContext.children) {
            const ch = memoryContext.children;
            parts.push(`Children/family: ${typeof ch === 'string' ? ch : JSON.stringify(ch)}`);
          }
          const triggers = memoryContext.triggers as string[] | undefined;
          if (triggers?.length) parts.push(`Triggers / stress: ${triggers.join('; ')}`);
          const goals = memoryContext.goals as string[] | undefined;
          if (goals?.length) parts.push(`Goals: ${goals.join('; ')}`);
          const events = memoryContext.recent_events as { emotion?: string; context?: string }[] | undefined;
          if (events?.length)
            parts.push(`Recent events: ${events.map((e) => `${e.emotion || ''} — ${e.context || ''}`).join('; ')}`);
          if (memoryContext.memory_summary) {
            parts.push(`Psychological portrait: ${memoryContext.memory_summary}`);
          }
          return parts.join('. ');
        })()
      : '';

    const memoryBlock = memorySummary
      ? `[What you know about the user — use for personal follow-ups like "как дома?", "как семья?", "как мама сейчас?"]\n${memorySummary}`
      : '';

    const historyBlock =
      recentMessages && Array.isArray(recentMessages) && recentMessages.length > 0
        ? recentMessages
            .slice(-6)
            .map((m) => `${m.role === 'user' ? 'User' : 'Sam'}: ${m.text}`)
            .join('\n')
        : '';

    const samReplyCount = recentMessages?.filter((m) => m.role === 'sam').length ?? 0;
    const replyN = samReplyCount + 1;
    const transitionHint =
      replyN === 1
        ? ` This is your first reply: welcome in Russian + one short phrase in ${langName}.`
        : replyN <= 3
          ? ` This is your reply #${replyN}: use noticeably more ${langName} (at least one full sentence or two short phrases). Invite the user to try saying something in ${langName} — e.g. one word or "How are you?".`
          : ` This is your reply #${replyN}: aim for half or more of your message in ${langName}. Keep inviting the user to try speaking in ${langName} and praise any attempt.`;

    const difficulty = estimateDifficulty(transcript, recentMessages, lang);
    const coachMode = Math.min(7, Math.max(0, Math.round(Number(coachModeIn) || 3)));
    const difficultyBonus = difficulty === 'low' ? 0 : difficulty === 'medium' ? 0.5 : 1;
    const effectiveLevel = Math.min(7, Math.max(0, Math.round(coachMode + difficultyBonus)));

    const levelHint = getLevelHint(effectiveLevel, langName);
    const difficultyHint =
      difficulty === 'low'
        ? 'User is at very low level in the target language. Use VERY short phrases (1–3 words) in the target language, lots of Russian, and ask them to repeat only tiny chunks, not full sentences.'
        : difficulty === 'medium'
          ? 'User sometimes answers in the target language. Use 1–2 short sentences in the target language and invite them to answer with simple phrases.'
          : 'User seems comfortable in the target language. It is OK to use longer sentences and ask them to answer fully in the target language.';

    const userMessage = [
      memoryBlock,
      historyBlock && `[Recent dialogue]\n${historyBlock}`,
      `User now: ${transcript}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `${SAM_SYSTEM}\n\nTarget language: ${langName}. Use ONLY Russian + ${langName}.${transitionHint}\n${levelHint}\n${difficultyHint}`,
        },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 200,
      temperature: 0.85,
    });

    const ch = completion.choices[0];
    const reply = trimSamReply(ch?.message?.content ?? '', ch?.finish_reason);
    const usage = completion.usage;
    const tokensUsed = usage
      ? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)
      : 0;

    res.json({ reply, tokensUsed, transcript });
  } catch (err) {
    console.error('/chat error', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

app.post('/memory-update', async (req, res) => {
  try {
    const { previousMemory, dialogueSnippet, targetLang } = req.body as {
      previousMemory?: unknown;
      dialogueSnippet?: string;
      targetLang?: TargetLang;
    };

    const safePrevious = previousMemory ?? {};
    const snippet = (dialogueSnippet ?? '').trim();

    if (!snippet) {
      return res.status(400).json({ error: 'dialogueSnippet is required' });
    }

    const lang = targetLang === 'pt' ? 'European Portuguese' : 'English';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: MEMORY_SYSTEM,
        },
        {
          role: 'user',
          content: [
            `Target language: ${lang}.`,
            '',
            'previous_memory:',
            JSON.stringify(safePrevious, null, 2),
            '',
            'dialogue_snippet:',
            snippet,
          ].join('\n'),
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // try to extract JSON between first { and last }
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) {
        parsed = JSON.parse(raw.slice(start, end + 1));
      } else {
        throw new Error('Model response is not valid JSON');
      }
    }

    res.json({ memory: parsed });
  } catch (err) {
    console.error('/memory-update error', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

app.post('/chat-audio', async (req, res) => {
  try {
    const contentType = req.headers['content-type'] || '';
    
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Expected multipart/form-data' });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);
    
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      return res.status(400).json({ error: 'No boundary found' });
    }
    const boundary = boundaryMatch[1];
    
    const parts = rawBody.toString('binary').split(`--${boundary}`);
    let audioBuffer: Buffer | null = null;
    const fields: Record<string, string> = {};
    
    for (const part of parts) {
      if (part.includes('name="audio"')) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const bodyStart = headerEnd + 4;
          const bodyEnd = part.lastIndexOf('\r\n');
          const binaryData = part.slice(bodyStart, bodyEnd);
          audioBuffer = Buffer.from(binaryData, 'binary');
        }
      } else {
        const nameMatch = part.match(/name="([^"]+)"/);
        if (nameMatch) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            const value = part.slice(headerEnd + 4).replace(/\r\n--$/, '').trim();
            fields[nameMatch[1]] = value;
          }
        }
      }
    }

    if (!audioBuffer || audioBuffer.length < 100) {
      return res.status(400).json({ error: 'No audio data received' });
    }

    console.log('[chat-audio] Audio size:', audioBuffer.length, 'Fields:', Object.keys(fields));

    const lang = fields.targetLang === 'pt' ? 'pt' : 'en';
    const langName = lang === 'pt' ? 'European Portuguese' : 'English';

    const file = new File([audioBuffer], 'audio.m4a', { type: 'audio/mp4' });
    const whisper = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });
    const transcript = (whisper as { text?: string }).text?.trim() ?? '';
    
    console.log('[chat-audio] Transcript:', transcript);

    if (!transcript) {
      return res.json({ reply: 'Не расслышал, попробуй ещё раз.', tokensUsed: 0, transcript: '' });
    }

    const tu = Number(fields.tokens_used_total) || 0;
    const hasCode = !!(fields.code_expires_at?.trim());
    const atCode = Number(fields.tokens_used_at_code_entry) || 0;
    
    if (!hasCode && tu >= TRIAL_TOKENS) {
      return res.status(403).json({ trial_over: true, reason: 'trial_over' });
    }
    if (hasCode && tu - atCode >= CODE_TOKENS) {
      return res.status(403).json({ trial_over: true, reason: 'code_used_up' });
    }

    let memoryContext: Record<string, unknown> = {};
    try { memoryContext = JSON.parse(fields.memoryContext || '{}'); } catch {}
    
    let recentMessages: { role: string; text: string }[] = [];
    try { recentMessages = JSON.parse(fields.recentMessages || '[]'); } catch {}

    const memorySummary = memoryContext
      ? (() => {
          const parts: string[] = [];
          if (memoryContext.name) parts.push(`Name: ${memoryContext.name}`);
          if (memoryContext.target_lang) parts.push(`Target language: ${memoryContext.target_lang}`);
          if (memoryContext.city) parts.push(`City: ${memoryContext.city}`);
          if (memoryContext.partner) parts.push(`Partner: ${memoryContext.partner}`);
          if (memoryContext.children) {
            const ch = memoryContext.children;
            parts.push(`Children/family: ${typeof ch === 'string' ? ch : JSON.stringify(ch)}`);
          }
          const triggers = memoryContext.triggers as string[] | undefined;
          if (triggers?.length) parts.push(`Triggers / stress: ${triggers.join('; ')}`);
          const goals = memoryContext.goals as string[] | undefined;
          if (goals?.length) parts.push(`Goals: ${goals.join('; ')}`);
          const events = memoryContext.recent_events as { emotion?: string; context?: string }[] | undefined;
          if (events?.length)
            parts.push(`Recent events: ${events.map((e) => `${e.emotion || ''} — ${e.context || ''}`).join('; ')}`);
          if (memoryContext.memory_summary) {
            parts.push(`Psychological portrait: ${memoryContext.memory_summary}`);
          }
          return parts.join('. ');
        })()
      : '';

    const memoryBlock = memorySummary
      ? `[What you know about the user — use for personal follow-ups like "как дома?", "как семья?", "как мама сейчас?"]\n${memorySummary}`
      : '';

    const historyBlock =
      recentMessages && Array.isArray(recentMessages) && recentMessages.length > 0
        ? recentMessages
            .slice(-6)
            .map((m) => `${m.role === 'user' ? 'User' : 'Sam'}: ${m.text}`)
            .join('\n')
        : '';

    const samReplyCount = recentMessages?.filter((m) => m.role === 'sam').length ?? 0;
    const replyN = samReplyCount + 1;
    const transitionHint =
      replyN === 1
        ? ` This is your first reply: welcome in Russian + one short phrase in ${langName}.`
        : replyN <= 3
          ? ` This is your reply #${replyN}: use noticeably more ${langName} (at least one full sentence or two short phrases). Invite the user to try saying something in ${langName} — e.g. one word or "How are you?".`
          : ` This is your reply #${replyN}: aim for half or more of your message in ${langName}. Keep inviting the user to try speaking in ${langName} and praise any attempt.`;

    const difficulty = estimateDifficulty(transcript, recentMessages, lang);
    const coachMode = Math.min(7, Math.max(0, Math.round(Number(fields.coachMode) || 3)));
    const difficultyBonus = difficulty === 'low' ? 0 : difficulty === 'medium' ? 0.5 : 1;
    const effectiveLevel = Math.min(7, Math.max(0, Math.round(coachMode + difficultyBonus)));

    const levelHint = getLevelHint(effectiveLevel, langName);
    const difficultyHint =
      difficulty === 'low'
        ? 'User is at very low level in the target language. Use VERY short phrases (1–3 words) in the target language, lots of Russian, and ask them to repeat only tiny chunks, not full sentences.'
        : difficulty === 'medium'
          ? 'User sometimes answers in the target language. Use 1–2 short sentences in the target language and invite them to answer with simple phrases.'
          : 'User seems comfortable in the target language. It is OK to use longer sentences and ask them to answer fully in the target language.';

    const userMessage = [
      memoryBlock,
      historyBlock && `[Recent dialogue]\n${historyBlock}`,
      `User now: ${transcript}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `${SAM_SYSTEM}\n\nTarget language: ${langName}. Use ONLY Russian + ${langName}.${transitionHint}\n${levelHint}\n${difficultyHint}`,
        },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 200,
      temperature: 0.85,
    });

    const ch = completion.choices[0];
    const reply = trimSamReply(ch?.message?.content ?? '', ch?.finish_reason);
    const usage = completion.usage;
    const tokensUsed = usage
      ? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)
      : 0;

    res.json({ reply, tokensUsed, transcript });
  } catch (err) {
    console.error('/chat-audio error', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

app.post('/tts', async (req, res) => {
  try {
    const { text, language } = req.body as { text?: string; language?: string };
    const txt = (text ?? '').trim();
    if (!txt) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
    }

    // `language` = ISO 639-1 from the app (per segment). Known: ru/pt/en; others: ELEVENLABS_VOICE_ID_XX in .env.
    const langCode = (language ?? 'en').toLowerCase().slice(0, 2);
    const voiceId = resolveElevenLabsVoiceId(langCode);

    // Do not send `language_code` with eleven_multilingual_v2 — ElevenLabs returns
    // 422 if the model does not support that parameter for the chosen model.
    // Language comes from the selected voice + text; we already pick voice by langCode.
    const response = await fetch(
      // Lower bitrate to reduce per-request credit cost.
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: txt,
          model_id: 'eleven_multilingual_v2',
          // PT-голос у многих тише RU на том же output_format — чуть выше speed/clarity для pt.
          voice_settings:
            langCode === 'pt'
              ? { stability: 0.45, similarity_boost: 0.82, speed: 1.0 }
              : langCode === 'ru'
                ? { stability: 0.5, similarity_boost: 0.74, speed: 0.95 }
                : { stability: 0.5, similarity_boost: 0.75, speed: 0.95 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('ElevenLabs error:', response.status, errText);
      return res.status(response.status).json({
        error: `ElevenLabs: ${response.status}`,
        detail: errText,
      });
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');
    res.json({ audio: base64Audio, format: 'mp3' });
  } catch (err) {
    console.error('/tts error', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Friendly Sam API on port ${PORT}`);
});
