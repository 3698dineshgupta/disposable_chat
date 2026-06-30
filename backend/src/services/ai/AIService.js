'use strict';

const NvidiaProvider = require('./NvidiaProvider');

/* ── Singleton provider ── */
let _provider = null;
function getProvider() {
  if (!_provider) {
    _provider = new NvidiaProvider(process.env.NVIDIA_API_KEY);
  }
  return _provider;
}

/* ── In-memory rate limiting: max 20 requests/min per user ── */
const _userCounts = new Map();
const RATE_LIMIT = parseInt(process.env.AI_RATE_LIMIT_PER_MIN || '20', 10);

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = _userCounts.get(userId) ?? { count: 0, windowStart: now };
  if (now - entry.windowStart > 60_000) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count++;
  _userCounts.set(userId, entry);
  return entry.count <= RATE_LIMIT;
}

/* ── System prompt builder ── */
function buildSystemPrompt(ownerName, styleProfile, conversationContext) {
  const style = styleProfile || {};
  const tone = style.tone || 'casual and friendly';
  const emojiStyle = style.emoji_frequency || 'occasional';
  const avgLen = style.avg_message_length || 20;
  const sampleMsgs = (style.sample_messages || []).slice(0, 8).map((m) => `"${m}"`).join(', ');
  const commonPhrases = (style.common_phrases || []).slice(0, 6).join(', ');
  const languageNotes = style.language_notes || '';

  return `You are ${ownerName}. You are responding to messages in a private chat as yourself — not as an assistant, not as an AI.

CRITICAL RULES:
- You ARE ${ownerName}. Never say you are an AI, chatbot, assistant, or language model.
- If asked "are you a bot/AI?", deflect naturally as a human would ("lol no", "why would i be", etc.)
- Reply ONLY with the reply text — no labels, no quotes, no explanations, no markdown.
- Never invent personal information you don't know.
- Keep replies concise unless the conversation warrants longer responses.
- Match ${ownerName}'s exact writing style described below.

${ownerName.toUpperCase()}'S WRITING STYLE:
- Tone: ${tone}
- Average message length: ~${avgLen} words
- Emoji usage: ${emojiStyle}
${commonPhrases ? `- Common phrases: ${commonPhrases}` : ''}
${sampleMsgs ? `- Example messages they've sent: ${sampleMsgs}` : ''}
${languageNotes ? `- Language notes: ${languageNotes}` : ''}

${conversationContext ? `CONVERSATION SUMMARY (earlier messages):\n${conversationContext}\n` : ''}
Reply naturally as ${ownerName}. Be concise. Sound like a real person texting.`.trim();
}

/* ── Main generate function ── */
async function generateReply({
  userId,
  ownerName,
  styleProfile,
  conversationSummary,
  recentMessages,    // [{role: 'user'|'assistant', content: string}]
  incomingMessage,   // string — the latest message to reply to
}) {
  if (!checkRateLimit(userId)) {
    throw Object.assign(new Error('Rate limit exceeded'), { code: 'RATE_LIMITED' });
  }

  const provider = getProvider();
  if (!(await provider.isAvailable())) {
    throw Object.assign(new Error('AI service temporarily unavailable'), { code: 'AI_UNAVAILABLE' });
  }

  const systemPrompt = buildSystemPrompt(ownerName, styleProfile, conversationSummary);

  // Build message thread (max last 40 messages)
  const history = (recentMessages || []).slice(-40);

  // Append the new message that needs a reply
  const messages = [
    ...history,
    { role: 'user', content: incomingMessage },
  ];

  // Estimate reply length: mirror average of owner's messages in context
  const ownerMsgs = history.filter((m) => m.role === 'assistant');
  const avgOwnerLen = ownerMsgs.length > 0
    ? Math.round(ownerMsgs.reduce((s, m) => s + m.content.split(/\s+/).length, 0) / ownerMsgs.length)
    : (styleProfile?.avg_message_length || 20);

  const maxTokens = Math.max(30, Math.min(350, avgOwnerLen * 6));

  return provider.generateReply({ systemPrompt, messages, maxTokens });
}

/* ── Build style profile from user messages ── */
function analyzeWritingStyle(messages) {
  if (!messages?.length) return {};

  const texts = messages.filter((t) => typeof t === 'string' && t.trim().length > 0);
  if (!texts.length) return {};

  const wordCounts = texts.map((t) => t.split(/\s+/).length);
  const avg_message_length = Math.round(wordCounts.reduce((s, c) => s + c, 0) / wordCounts.length);

  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  const emojiCount = texts.filter((t) => emojiRegex.test(t)).length;
  const emojiRatio = emojiCount / texts.length;
  const emoji_frequency = emojiRatio > 0.5 ? 'very frequent' : emojiRatio > 0.2 ? 'frequent' : emojiRatio > 0.05 ? 'occasional' : 'rare';

  const lowerCaseCount = texts.filter((t) => t === t.toLowerCase()).length;
  const capitalization = lowerCaseCount / texts.length > 0.7 ? 'mostly lowercase' : 'normal';

  // Detect slang / abbreviations
  const slangWords = ['haha', 'lol', 'lmao', 'bruh', 'bro', 'ngl', 'imo', 'tbh', 'fr', 'omg', 'rn', 'gonna', 'wanna', 'prolly', 'idk', 'btw', 'ik', 'thx', 'np', 'k', 'okk', 'ofc', 'wdym', 'smh', 'yep', 'nah', 'yaar', 'bhai', 'achi'];
  const allText = texts.join(' ').toLowerCase();
  const uses_slang = slangWords.some((w) => allText.includes(w));

  // Detect Hindi/Hinglish usage
  const hindiWords = ['yaar', 'bhai', 'theek', 'acha', 'kya', 'hai', 'nahi', 'haan', 'matlab', 'bas', 'arre'];
  const uses_hindi = hindiWords.some((w) => allText.includes(w));

  // Common phrases (2-3 word repeated sequences)
  const phrases = {};
  for (const text of texts) {
    const words = text.toLowerCase().split(/\s+/);
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (bigram.length > 4) phrases[bigram] = (phrases[bigram] || 0) + 1;
    }
  }
  const common_phrases = Object.entries(phrases)
    .filter(([, c]) => c >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([phrase]) => phrase);

  // Sample messages (diverse lengths for prompt)
  const sorted = [...texts].sort((a, b) => a.length - b.length);
  const sample_messages = [
    sorted[Math.floor(sorted.length * 0.2)],
    sorted[Math.floor(sorted.length * 0.5)],
    sorted[Math.floor(sorted.length * 0.8)],
  ].filter(Boolean).slice(0, 6);

  const tone_keywords = uses_slang ? 'casual and informal' : (uses_hindi ? 'casual, mix of English and Hindi' : 'conversational');

  return {
    tone: tone_keywords,
    avg_message_length,
    uses_emoji: emojiRatio > 0.05,
    emoji_frequency,
    capitalization,
    uses_slang,
    common_phrases,
    sample_messages,
    language_notes: uses_hindi ? 'Mixes English and Hindi (Hinglish)' : '',
    analyzed_count: texts.length,
  };
}

module.exports = { generateReply, analyzeWritingStyle, buildSystemPrompt };
