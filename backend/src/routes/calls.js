const express = require('express');
const https = require('https');
const { supabase } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/* ── Metered.ca credentials cache (TTL = 5 min — short so env-var changes take effect quickly) ── */
let _meteredCache = null;
let _meteredCacheAt = 0;
const METERED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/* ── Public TURN fallback ────────────────────────────────────────────────────
 * Used when private TURN (Metered.ca app or TURN_URLS env var) is not set.
 * Multiple providers are listed so if one is unreachable from a given network
 * (blocked ports, firewall, geographic routing), another will succeed.
 * These are all free/demo servers — configure METERED_DOMAIN + METERED_API_KEY
 * on Render for a private relay with guaranteed uptime.
 * ─────────────────────────────────────────────────────────────────────────── */
const PUBLIC_TURN_FALLBACK = [
  // Provider 1: Metered.ca public relay (ports 80, 443, TCP, TLS)
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443',
    ],
    username:   'openrelayproject',
    credential: 'openrelayproject',
  },
  // Provider 2: FreeTURN — independent server, different network path
  {
    urls: [
      'turn:freeturn.net:3478',
      'turns:freeturn.net:5349',
    ],
    username:   'free',
    credential: 'free',
  },
  // Provider 3: numb.viagenie.ca — long-running public TURN
  {
    urls: 'turn:numb.viagenie.ca',
    username:   'webrtc@live.com',
    credential: 'muazkh',
  },
];

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function fetchMeteredServers() {
  const domain = process.env.METERED_DOMAIN;
  const apiKey = process.env.METERED_API_KEY;
  if (!domain || !apiKey) return [];

  // Return cached result if still fresh
  if (_meteredCache && Date.now() - _meteredCacheAt < METERED_CACHE_TTL) {
    return _meteredCache;
  }

  // Metered.ca REST API uses "Secret Key" from the Developers tab.
  // Try secretKey first (correct Metered REST API param), fall back to apiKey.
  const urlsToTry = [
    `https://${domain}/api/v1/turn/credentials?secretKey=${apiKey}`,
    `https://${domain}/api/v1/turn/credentials?apiKey=${apiKey}`,
  ];

  for (const url of urlsToTry) {
    try {
      console.log(`[ICE] fetching Metered.ca credentials: ${url}`);
      const { status, body } = await httpsGet(url);
      console.log(`[ICE] Metered.ca HTTP ${status}, body[0..300]: ${body.substring(0, 300)}`);
      const servers = JSON.parse(body);
      if (Array.isArray(servers) && servers.length > 0) {
        _meteredCache   = servers;
        _meteredCacheAt = Date.now();
        const turnCount = servers.filter(s => {
          const u = Array.isArray(s.urls) ? s.urls.join(',') : (s.urls ?? s.url ?? '');
          return u.includes('turn:') || u.includes('turns:');
        }).length;
        console.log(`[ICE] Metered.ca: ${servers.length} total servers, ${turnCount} TURN`);
        return servers;
      }
      console.warn(`[ICE] Metered.ca ${url} returned empty — trying next format`);
    } catch (e) {
      console.warn(`[ICE] Metered.ca fetch/parse error for ${url}:`, e.message);
    }
  }

  console.warn('[ICE] Metered.ca: all credential URLs failed or returned empty.');
  return _meteredCache || [];
}

/* ── ICE server credentials for WebRTC ── */
router.get('/ice-servers', authenticate, async (req, res) => {
  try {
    // Always include multiple Google STUN servers as base
    const servers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
    ];

    // Metered.ca TURN — fetches short-lived credentials from their API
    const meteredServers = await fetchMeteredServers();
    servers.push(...meteredServers);

    // Manual TURN override (takes priority if both are set)
    if (process.env.TURN_URLS) {
      const urls = process.env.TURN_URLS.split(',').map(u => u.trim()).filter(Boolean);
      servers.push({
        urls,
        username:   process.env.TURN_USERNAME   || '',
        credential: process.env.TURN_CREDENTIAL || '',
      });
    }

    // If still no TURN relay, add public fallback so calls work across networks
    const hasTurn = servers.some(s => {
      const u = Array.isArray(s.urls) ? s.urls : [s.urls ?? ''];
      return u.some(x => typeof x === 'string' && (x.startsWith('turn:') || x.startsWith('turns:')));
    });
    if (!hasTurn) {
      servers.push(...PUBLIC_TURN_FALLBACK);
      console.log('[ICE] No private TURN configured — using public openrelay.metered.ca fallback');
    }

    const totalTurn = servers.filter(s => {
      const u = Array.isArray(s.urls) ? s.urls : [s.urls ?? ''];
      return u.some(x => typeof x === 'string' && (x.startsWith('turn:') || x.startsWith('turns:')));
    }).length;
    console.log(`[ICE] returning ${servers.length} total ICE servers, ${totalTurn} with TURN`);

    res.json({ iceServers: servers });
  } catch (err) {
    console.error('[ICE] ice-servers error:', err.message);
    // Fallback: return STUN-only so calls still work on same-network
    res.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
  }
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
