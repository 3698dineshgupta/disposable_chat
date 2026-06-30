const express = require('express');
const { supabase } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/* ── ICE server credentials for WebRTC ── */
router.get('/ice-servers', authenticate, (req, res) => {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ];

  // Add TURN server(s) if configured via environment variables.
  // Set TURN_URLS (comma-separated), TURN_USERNAME, TURN_CREDENTIAL in backend .env
  if (process.env.TURN_URLS) {
    const urls = process.env.TURN_URLS.split(',').map(u => u.trim()).filter(Boolean);
    servers.push({
      urls,
      username:   process.env.TURN_USERNAME   || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }

  // Metered.ca free TURN (set METERED_API_KEY env var to enable)
  if (process.env.METERED_API_KEY) {
    servers.push(
      { urls: `turn:a.relay.metered.ca:80`,     username: process.env.METERED_USERNAME || '', credential: process.env.METERED_CREDENTIAL || '' },
      { urls: `turn:a.relay.metered.ca:80?transport=tcp`, username: process.env.METERED_USERNAME || '', credential: process.env.METERED_CREDENTIAL || '' },
      { urls: `turn:a.relay.metered.ca:443`,    username: process.env.METERED_USERNAME || '', credential: process.env.METERED_CREDENTIAL || '' },
      { urls: `turns:a.relay.metered.ca:443?transport=tcp`, username: process.env.METERED_USERNAME || '', credential: process.env.METERED_CREDENTIAL || '' },
    );
  }

  res.json({ iceServers: servers });
});

/* ── Get call history ── */
router.get('/', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('calls')
      .select(`
        *,
        caller:users!caller_id(id, display_name, avatar_url),
        callee:users!callee_id(id, display_name, avatar_url)
      `)
      .or(`caller_id.eq.${req.user.id},callee_id.eq.${req.user.id}`)
      .order('started_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const calls = (data || []).map((c) => ({
      ...c,
      caller_name:   c.caller?.display_name,
      caller_avatar: c.caller?.avatar_url,
      callee_name:   c.callee?.display_name,
      callee_avatar: c.callee?.avatar_url,
    }));

    res.json({ calls });
  } catch (err) {
    console.error('[calls GET]', err);
    res.status(500).json({ error: 'Failed to fetch call history' });
  }
});

/* ── Save call record ── */
router.post('/', authenticate, async (req, res) => {
  try {
    const { calleeId, type, status, conversationId, duration, answeredAt, endedAt } = req.body;
    const { data, error } = await supabase
      .from('calls')
      .insert({
        caller_id:      req.user.id,
        callee_id:      calleeId,
        type:           type || 'audio',
        status:         status || 'calling',
        conversation_id: conversationId || null,
        duration:       duration || 0,
        answered_at:    answeredAt || null,
        ended_at:       endedAt || null,
      })
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json({ call: data });
  } catch (err) {
    console.error('[calls POST]', err);
    res.status(500).json({ error: 'Failed to save call' });
  }
});

/* ── Update call status ── */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { status, duration, answeredAt, endedAt } = req.body;
    const updates = {};
    if (status)     updates.status      = status;
    if (duration)   updates.duration    = duration;
    if (answeredAt) updates.answered_at = answeredAt;
    if (endedAt)    updates.ended_at    = endedAt;

    const { data, error } = await supabase
      .from('calls')
      .update(updates)
      .eq('id', req.params.id)
      .or(`caller_id.eq.${req.user.id},callee_id.eq.${req.user.id}`)
      .select('*')
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Call not found' });
    res.json({ call: data });
  } catch (err) {
    console.error('[calls PUT]', err);
    res.status(500).json({ error: 'Failed to update call' });
  }
});

module.exports = router;
