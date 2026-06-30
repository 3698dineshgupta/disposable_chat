'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { supabase } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { generateReply, analyzeWritingStyle } = require('../services/ai/AIService');

const router = express.Router();

/* Strict rate limit for AI generation — prevent abuse */
const aiGenerateLimiter = rateLimit({
  windowMs: 60_000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many AI requests — please slow down' },
  skip: (req) => !req.user, // auth middleware runs before this
});

/* ── POST /api/ai/generate ──────────────────────────────────────── */
router.post('/generate', authenticate, aiGenerateLimiter, async (req, res) => {
  try {
    const {
      conversationId,
      incomingMessage,
      recentMessages,        // [{role, content}] — plaintext context from client
      conversationSummary,   // optional compressed summary of older messages
    } = req.body;

    if (!conversationId || !incomingMessage)
      return res.status(400).json({ error: 'conversationId and incomingMessage are required' });

    if (typeof incomingMessage !== 'string' || incomingMessage.length > 4000)
      return res.status(400).json({ error: 'incomingMessage must be a string ≤ 4000 chars' });

    if (recentMessages && (!Array.isArray(recentMessages) || recentMessages.length > 60))
      return res.status(400).json({ error: 'recentMessages must be an array of ≤ 60 messages' });

    // Verify user is a participant in this conversation
    const { data: member } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', req.user.id)
      .single();

    if (!member)
      return res.status(403).json({ error: 'Not a participant in this conversation' });

    // Check AI is enabled for this conversation (table may not exist yet — treat as disabled)
    let aiEnabled = false;
    try {
      const { data: aiSetting } = await supabase
        .from('ai_conversation_settings')
        .select('auto_reply_enabled')
        .eq('user_id', req.user.id)
        .eq('conversation_id', conversationId)
        .single();
      aiEnabled = aiSetting?.auto_reply_enabled ?? false;
    } catch { /* table doesn't exist — treat as disabled */ }

    if (!aiEnabled)
      return res.status(403).json({ error: 'Auto reply is not enabled for this conversation' });

    // Load writing style profile
    const { data: styleRow } = await supabase
      .from('ai_writing_profiles')
      .select('profile_data')
      .eq('user_id', req.user.id)
      .single();

    const styleProfile = styleRow?.profile_data ?? null;

    // Sanitize recentMessages to prevent prompt injection
    const safeMessages = (recentMessages || []).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 1000),
    }));

    const reply = await generateReply({
      userId: req.user.id,
      ownerName: req.user.display_name || req.user.username,
      styleProfile,
      conversationSummary: typeof conversationSummary === 'string' ? conversationSummary.slice(0, 1500) : null,
      recentMessages: safeMessages,
      incomingMessage: String(incomingMessage).slice(0, 4000),
    });

    res.json({ reply });
  } catch (err) {
    if (err.code === 'RATE_LIMITED')
      return res.status(429).json({ error: 'AI rate limit exceeded. Try again in a minute.' });
    if (err.code === 'AI_UNAVAILABLE')
      return res.status(503).json({ error: 'AI service temporarily unavailable.' });
    console.error('[ai/generate]', err.message);
    res.status(500).json({ error: 'Failed to generate AI reply' });
  }
});

/* ── GET /api/ai/settings (ALL conversations, one request) ─────── */
router.get('/settings', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ai_conversation_settings')
      .select('conversation_id, auto_reply_enabled')
      .eq('user_id', req.user.id);

    if (error) throw error;

    const settings = {};
    for (const row of data || []) {
      settings[row.conversation_id] = row.auto_reply_enabled;
    }
    res.json({ settings });
  } catch (err) {
    // Table may not exist yet — return empty settings (graceful degradation)
    res.json({ settings: {} });
  }
});

/* ── GET /api/ai/settings/:convId ───────────────────────────────── */
router.get('/settings/:convId', authenticate, async (req, res) => {
  try {
    const { data } = await supabase
      .from('ai_conversation_settings')
      .select('auto_reply_enabled, created_at, updated_at')
      .eq('user_id', req.user.id)
      .eq('conversation_id', req.params.convId)
      .single();

    res.json({ auto_reply_enabled: data?.auto_reply_enabled ?? false });
  } catch {
    res.json({ auto_reply_enabled: false });
  }
});

/* ── PUT /api/ai/settings/:convId ───────────────────────────────── */
router.put('/settings/:convId', authenticate, async (req, res) => {
  try {
    const { auto_reply_enabled } = req.body;
    if (typeof auto_reply_enabled !== 'boolean')
      return res.status(400).json({ error: 'auto_reply_enabled must be boolean' });

    // Verify participation
    const { data: member } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', req.params.convId)
      .eq('user_id', req.user.id)
      .single();
    if (!member) return res.status(403).json({ error: 'Not a participant' });

    await supabase
      .from('ai_conversation_settings')
      .upsert({
        user_id: req.user.id,
        conversation_id: req.params.convId,
        auto_reply_enabled,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,conversation_id' });

    res.json({ success: true, auto_reply_enabled });
  } catch (err) {
    console.error('[ai/settings put]', err.message);
    res.status(503).json({ error: 'AI settings unavailable — database tables not yet created. Restart the server to trigger auto-migration.' });
  }
});

/* ── GET /api/ai/style ──────────────────────────────────────────── */
router.get('/style', authenticate, async (req, res) => {
  try {
    const { data } = await supabase
      .from('ai_writing_profiles')
      .select('profile_data, sample_message_count, last_updated')
      .eq('user_id', req.user.id)
      .single();

    res.json({
      profile: data?.profile_data ?? null,
      message_count: data?.sample_message_count ?? 0,
      last_updated: data?.last_updated ?? null,
    });
  } catch {
    res.json({ profile: null, message_count: 0, last_updated: null });
  }
});

/* ── POST /api/ai/style ─────────────────────────────────────────── */
router.post('/style', authenticate, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length < 5)
      return res.status(400).json({ error: 'Need at least 5 messages to analyze style' });

    const safeMessages = messages.slice(0, 200).map((m) => String(m || '').slice(0, 500));
    const profile = analyzeWritingStyle(safeMessages);

    try {
      await supabase
        .from('ai_writing_profiles')
        .upsert({
          user_id: req.user.id,
          profile_data: profile,
          sample_message_count: safeMessages.length,
          last_updated: new Date().toISOString(),
        }, { onConflict: 'user_id' });
    } catch { /* table not yet created — return profile without persisting */ }

    res.json({ success: true, profile });
  } catch (err) {
    console.error('[ai/style]', err.message);
    res.status(500).json({ error: 'Failed to update style profile' });
  }
});

module.exports = router;
