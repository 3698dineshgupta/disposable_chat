const express = require('express');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const { supabase } = require('../config/database');
const { signAccessToken, signRefreshToken, verifyRefreshToken, deleteRefreshToken } = require('../utils/jwt');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const SAFE_USER_COLS = 'id, email, username, display_name, avatar_url, about, is_online, last_seen, public_key, signing_public_key, created_at';

/* ── Register ── */
router.post('/register', async (req, res) => {
  try {
    const { email, username, display_name, password } = req.body;
    if (!email || !username || !display_name || !password)
      return res.status(400).json({ error: 'All fields are required' });
    if (typeof email !== 'string' || email.length > 254)
      return res.status(400).json({ error: 'Invalid email' });
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,30}$/.test(username))
      return res.status(400).json({ error: 'Username must be 3–30 characters (letters, numbers, _)' });
    if (typeof display_name !== 'string' || display_name.trim().length > 100)
      return res.status(400).json({ error: 'Display name must be ≤ 100 characters' });
    if (password.length < 8 || password.length > 128)
      return res.status(400).json({ error: 'Password must be 8–128 characters' });

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .or(`email.eq.${email.toLowerCase()},username.eq.${username.toLowerCase()}`)
      .limit(1);

    if (existing && existing.length > 0)
      return res.status(409).json({ error: 'Email or username already taken' });

    const hash = await bcrypt.hash(password, 12);
    const { data: user, error } = await supabase
      .from('users')
      .insert({ email: email.toLowerCase(), username: username.toLowerCase(), display_name: display_name.trim(), password_hash: hash })
      .select(SAFE_USER_COLS)
      .single();

    if (error) throw new Error(error.message);

    const accessToken = signAccessToken(user.id);
    const refreshToken = await signRefreshToken(user.id);

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({ user, accessToken });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/* ── Login ── */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const { data: user, error } = await supabase
      .from('users')
      .select('*, ' + SAFE_USER_COLS)
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.password_hash) return res.status(401).json({ error: 'Please sign in with Google' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await supabase.from('users').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', user.id);

    const accessToken = signAccessToken(user.id);
    const refreshToken = await signRefreshToken(user.id);

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser, accessToken });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/* ── Google OAuth ── */
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    const { data: existing } = await supabase
      .from('users')
      .select(SAFE_USER_COLS)
      .or(`google_id.eq.${googleId},email.eq.${email.toLowerCase()}`)
      .single();

    let user = existing;
    if (!user) {
      const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '') + '_' + Date.now().toString().slice(-4);
      const { data: newUser, error } = await supabase
        .from('users')
        .insert({ email: email.toLowerCase(), username, display_name: name, avatar_url: picture, google_id: googleId })
        .select(SAFE_USER_COLS)
        .single();
      if (error) throw new Error(error.message);
      user = newUser;
    } else if (!existing.google_id) {
      await supabase.from('users').update({ google_id: googleId, avatar_url: picture || existing.avatar_url }).eq('id', existing.id);
    }

    const accessToken = signAccessToken(user.id);
    const refreshToken = await signRefreshToken(user.id);

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({ user, accessToken });
  } catch (err) {
    console.error('[google auth]', err);
    res.status(500).json({ error: 'Google authentication failed' });
  }
});

/* ── Refresh token ── */
router.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies?.refresh_token;
    if (!token) return res.status(401).json({ error: 'No refresh token' });

    const tokenRow = await verifyRefreshToken(token);
    await deleteRefreshToken(token);

    const { data: user } = await supabase.from('users').select(SAFE_USER_COLS).eq('id', tokenRow.user_id).single();
    if (!user) return res.status(401).json({ error: 'User not found' });

    const accessToken = signAccessToken(user.id);
    const newRefreshToken = await signRefreshToken(user.id);

    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({ user, accessToken });
  } catch (err) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

/* ── Logout ── */
router.post('/logout', async (req, res) => {
  const token = req.cookies?.refresh_token;
  if (token) {
    await deleteRefreshToken(token).catch(() => {});
    const decoded = require('../utils/jwt').verifyAccessToken;
    try {
      const auth = req.headers.authorization?.slice(7);
      if (auth) {
        const { userId } = require('jsonwebtoken').decode(auth) || {};
        if (userId) await supabase.from('users').update({ is_online: false, last_seen: new Date().toISOString() }).eq('id', userId);
      }
    } catch {}
  }
  res.clearCookie('refresh_token');
  res.json({ success: true });
});

/* ── Update E2E keys ── */
router.put('/keys', authenticate, async (req, res) => {
  try {
    const { publicKey, signingPublicKey } = req.body;
    await supabase.from('users').update({ public_key: publicKey, signing_public_key: signingPublicKey }).eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update keys' });
  }
});

/* ── Get current user ── */
router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

module.exports = router;
