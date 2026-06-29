const express = require('express');
const { supabase } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

/* ── Get statuses from contacts + self ── */
router.get('/', authenticate, async (req, res) => {
  try {
    // Get contact IDs first
    const { data: contacts } = await supabase
      .from('contacts')
      .select('contact_id')
      .eq('user_id', req.user.id)
      .eq('is_blocked', false);

    const contactIds = (contacts || []).map((c) => c.contact_id);
    const allowedUserIds = [req.user.id, ...contactIds];

    const now = new Date().toISOString();
    const { data: statuses, error } = await supabase
      .from('statuses')
      .select(`
        *,
        users!user_id(id, username, display_name, avatar_url)
      `)
      .in('user_id', allowedUserIds)
      .gt('expires_at', now)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get view counts and viewed status
    const statusIds = (statuses || []).map((s) => s.id);
    let viewData = [];
    if (statusIds.length > 0) {
      const { data: views } = await supabase
        .from('status_views')
        .select('status_id, viewer_id')
        .in('status_id', statusIds);
      viewData = views || [];
    }

    const enriched = (statuses || []).map((s) => {
      const views = viewData.filter((v) => v.status_id === s.id);
      return {
        ...s,
        user_id:      s.users?.id,
        username:     s.users?.username,
        display_name: s.users?.display_name,
        avatar_url:   s.users?.avatar_url,
        view_count:   views.length,
        viewed:       views.some((v) => v.viewer_id === req.user.id),
      };
    });

    res.json({ statuses: enriched });
  } catch (err) {
    console.error('[status GET]', err);
    res.status(500).json({ error: 'Failed to fetch statuses' });
  }
});

/* ── Post a text status ── */
router.post('/', authenticate, async (req, res) => {
  try {
    const { type, content, background_color, font_style } = req.body;
    if (!type) return res.status(400).json({ error: 'type required' });

    const { data, error } = await supabase
      .from('statuses')
      .insert({
        user_id:          req.user.id,
        type,
        content:          content || null,
        background_color: background_color || '#128C7E',
        font_style:       font_style || 'normal',
      })
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json({ status: data });
  } catch (err) {
    console.error('[status POST]', err);
    res.status(500).json({ error: 'Failed to create status' });
  }
});

/* ── Post a media status ── */
router.post('/media', authenticate, upload.single('media'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const type = req.file.mimetype.startsWith('video') ? 'video' : 'image';
    let mediaUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    // Try to upload to Supabase Storage
    const ext = req.file.mimetype.split('/')[1];
    const filename = `statuses/${req.user.id}/${uuidv4()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from('media')
      .upload(filename, req.file.buffer, { contentType: req.file.mimetype });
    if (!uploadErr) {
      const { data } = supabase.storage.from('media').getPublicUrl(filename);
      mediaUrl = data.publicUrl;
    }

    const { data, error } = await supabase
      .from('statuses')
      .insert({ user_id: req.user.id, type, media_url: mediaUrl })
      .select('*')
      .single();

    if (error) throw error;
    res.status(201).json({ status: data });
  } catch (err) {
    console.error('[status media POST]', err);
    res.status(500).json({ error: 'Failed to create media status' });
  }
});

/* ── View a status ── */
router.post('/:id/view', authenticate, async (req, res) => {
  try {
    await supabase
      .from('status_views')
      .upsert({ status_id: req.params.id, viewer_id: req.user.id }, { onConflict: 'status_id,viewer_id', ignoreDuplicates: true });
    res.json({ success: true });
  } catch (err) {
    console.error('[status view]', err);
    res.status(500).json({ error: 'Failed to record view' });
  }
});

/* ── Delete status ── */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await supabase
      .from('statuses')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[status DELETE]', err);
    res.status(500).json({ error: 'Failed to delete status' });
  }
});

module.exports = router;
