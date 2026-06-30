const express = require('express');
const { supabase } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { upload, safeExtension } = require('../middleware/upload');

const router = express.Router();
const SAFE_COLS = 'id, username, display_name, avatar_url, about, is_online, last_seen, public_key, signing_public_key';

/* ── Search users ── */
router.get('/search', authenticate, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ users: [] });
    // Sanitize: only allow alphanumeric, spaces, @, ., _ — prevents PostgREST filter injection
    const safe = String(q).replace(/[^a-zA-Z0-9 @._-]/g, '').slice(0, 50);
    if (safe.length < 2) return res.json({ users: [] });

    const { data, error } = await supabase
      .from('users')
      .select(SAFE_COLS)
      .or(`username.ilike.%${safe}%,display_name.ilike.%${safe}%,email.ilike.%${safe}%`)
      .neq('id', req.user.id)
      .limit(20);

    if (error) throw error;
    res.json({ users: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

/* ── Get user by ID ── */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select(SAFE_COLS)
      .eq('id', req.params.id)
      .single();

    if (error || !user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/* ── Update profile ── */
router.put('/me/profile', authenticate, async (req, res) => {
  try {
    const { display_name, about, username } = req.body;
    const updates = {};

    if (display_name) {
      if (typeof display_name !== 'string' || display_name.trim().length > 100)
        return res.status(400).json({ error: 'display_name must be ≤ 100 characters' });
      updates.display_name = display_name.trim().slice(0, 100);
    }
    if (about !== undefined) updates.about = String(about).slice(0, 500);
    if (username) {
      const { data: taken } = await supabase.from('users').select('id').eq('username', username.toLowerCase()).neq('id', req.user.id).single();
      if (taken) return res.status(409).json({ error: 'Username taken' });
      updates.username = username.toLowerCase();
    }

    if (!Object.keys(updates).length) return res.json({ user: req.user });

    const { data: user, error } = await supabase
      .from('users')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', req.user.id)
      .select(SAFE_COLS + ', email')
      .single();

    if (error) throw error;
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

/* ── Upload avatar ── */
router.post('/me/avatar', authenticate, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    // Only allow image types for avatars
    if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Only image files allowed for avatar' });

    let avatarUrl;
    const ext = safeExtension(req.file.mimetype); // derive from MIME, never from filename
    const filename = `avatars/${req.user.id}.${ext}`;

    const { error: upErr } = await supabase.storage.from('media').upload(filename, req.file.buffer, {
      contentType: req.file.mimetype, upsert: true,
    });

    if (!upErr) {
      const { data: pub } = supabase.storage.from('media').getPublicUrl(filename);
      avatarUrl = pub.publicUrl;
    } else {
      avatarUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }

    await supabase.from('users').update({ avatar_url: avatarUrl }).eq('id', req.user.id);
    res.json({ avatarUrl });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

/* ── Ensure the media bucket exists and is public ── */
async function ensureMediaBucket() {
  const opts = { public: true, fileSizeLimit: 52428800 };
  const { error } = await supabase.storage.createBucket('media', opts);
  if (!error) return;
  const msg = (error.message ?? '').toLowerCase();
  if (msg.includes('already exists') || msg.includes('duplicate')) {
    await supabase.storage.updateBucket('media', opts);
  } else {
    throw new Error(error.message);
  }
}

/* ── Upload media file (ephemeral — deleted after message:seen) ── */
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { randomUUID } = require('crypto');
    const ext = safeExtension(req.file.mimetype); // never trust client filename
    const storagePath = `temp/${randomUUID()}.${ext}`;

    let { error: upErr } = await supabase.storage
      .from('media')
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });

    // Bucket missing → create it and retry once
    if (upErr) {
      const msg = (upErr.message ?? '').toLowerCase();
      if (msg.includes('not found') || msg.includes('bucket') || msg.includes('does not exist')) {
        console.warn('[upload] media bucket missing — creating and retrying:', upErr.message);
        try {
          await ensureMediaBucket();
          const retry = await supabase.storage
            .from('media')
            .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype });
          upErr = retry.error;
        } catch (bucketErr) {
          console.error('[upload] bucket creation failed:', bucketErr?.message);
        }
      }
    }

    if (upErr) {
      console.error('[upload] Supabase Storage error:', upErr.message, '| path:', storagePath);
      return res.status(500).json({ error: `Storage upload failed: ${upErr.message}` });
    }

    // Prefer a signed URL (works even when bucket is private).
    // 10-year expiry is effectively permanent for a chat attachment.
    const TEN_YEARS = 60 * 60 * 24 * 365 * 10;
    const { data: signed, error: signErr } = await supabase.storage
      .from('media')
      .createSignedUrl(storagePath, TEN_YEARS);

    const url = signed?.signedUrl
      ?? supabase.storage.from('media').getPublicUrl(storagePath).data.publicUrl;

    if (signErr) console.warn('[upload] signed URL warn (falling back to public URL):', signErr.message);

    res.json({ url, storagePath, name: req.file.originalname, size: req.file.size, type: req.file.mimetype });
  } catch (err) {
    console.error('[upload] unexpected error:', err?.message ?? err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

/* ── Get contacts ── */
router.get('/me/contacts', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contacts')
      .select(`is_blocked, is_favorite, display_name, users!contact_id(${SAFE_COLS})`)
      .eq('user_id', req.user.id)
      .eq('is_blocked', false);

    if (error) throw error;
    const contacts = (data || []).map((c) => ({ ...c.users, is_favorite: c.is_favorite, contact_display_name: c.display_name }));
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

/* ── Add contact ── */
router.post('/me/contacts/:contactId', authenticate, async (req, res) => {
  try {
    const { contactId } = req.params;
    if (contactId === req.user.id) return res.status(400).json({ error: 'Cannot add yourself' });

    const { data: target } = await supabase.from('users').select('id').eq('id', contactId).single();
    if (!target) return res.status(404).json({ error: 'User not found' });

    await supabase.from('contacts').upsert({ user_id: req.user.id, contact_id: contactId, is_blocked: false }, { onConflict: 'user_id,contact_id' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

/* ── Block / Unblock ── */
router.put('/me/contacts/:contactId/block', authenticate, async (req, res) => {
  try {
    const { block } = req.body;
    await supabase.from('contacts').upsert(
      { user_id: req.user.id, contact_id: req.params.contactId, is_blocked: block !== false },
      { onConflict: 'user_id,contact_id' }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update block status' });
  }
});

/* ── Update push subscription ── */
router.post('/me/push', authenticate, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });

    // Store in new push_subscriptions table (supports multiple devices)
    await supabase.from('push_subscriptions').upsert({
      user_id: req.user.id,
      subscription,
      user_agent: req.headers['user-agent']?.slice(0, 200) ?? null,
    }, { onConflict: 'user_id,subscription->>"endpoint"' }).catch(() => {
      // Fallback: upsert may fail if unique constraint not yet applied
    });

    // Also keep legacy push_subscription column in users for backwards compat
    await supabase.from('users').update({ push_subscription: subscription }).eq('id', req.user.id).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

module.exports = router;
