const express = require('express');
const { supabase } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/* ── List my conversations ── */
router.get('/', authenticate, async (req, res) => {
  try {
    const { data: participations, error } = await supabase
      .from('conversation_participants')
      .select(`
        is_pinned, is_archived, is_muted, last_read_at,
        conversations!conversation_id(id, type, name, avatar_url, description, created_by, updated_at)
      `)
      .eq('user_id', req.user.id)
      .eq('is_archived', false)
      .order('conversations(updated_at)', { ascending: false });

    if (error) throw error;

    const convIds = (participations || []).map((p) => p.conversations?.id).filter(Boolean);
    const directConvIds = (participations || [])
      .filter((p) => p.conversations?.type === 'direct')
      .map((p) => p.conversations?.id);

    let otherUsers = {};
    if (directConvIds.length > 0) {
      const { data: others } = await supabase
        .from('conversation_participants')
        .select('conversation_id, users!user_id(id, username, display_name, avatar_url, is_online, last_seen, about, public_key, signing_public_key)')
        .in('conversation_id', directConvIds)
        .neq('user_id', req.user.id);

      (others || []).forEach((o) => {
        otherUsers[o.conversation_id] = o.users;
      });
    }

    const conversations = (participations || []).map((p) => {
      const conv = p.conversations;
      const other = otherUsers[conv?.id];
      return {
        ...conv,
        is_pinned: p.is_pinned,
        is_archived: p.is_archived,
        is_muted: p.is_muted,
        last_read_at: p.last_read_at,
        other_user_id: other?.id,
        other_username: other?.username,
        other_display_name: other?.display_name,
        other_avatar_url: other?.avatar_url,
        other_is_online: other?.is_online,
        other_last_seen: other?.last_seen,
        other_about: other?.about,
        other_public_key: other?.public_key,
        other_signing_public_key: other?.signing_public_key,
      };
    });

    res.json({ conversations });
  } catch (err) {
    console.error('[conversations list]', err);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

/* ── Get or create direct conversation ── */
router.post('/direct', authenticate, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (userId === req.user.id) return res.status(400).json({ error: 'Cannot chat with yourself' });

    const { data: target } = await supabase
      .from('users')
      .select('id, username, display_name, avatar_url, is_online, last_seen, about, public_key, signing_public_key')
      .eq('id', userId)
      .single();
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { data: myConvs } = await supabase
      .from('conversation_participants')
      .select('conversation_id, conversations!conversation_id(id, type)')
      .eq('user_id', req.user.id);

    const myDirectIds = (myConvs || []).filter((p) => p.conversations?.type === 'direct').map((p) => p.conversation_id);

    if (myDirectIds.length > 0) {
      const { data: match } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userId)
        .in('conversation_id', myDirectIds)
        .limit(1)
        .single();

      if (match) {
        const { data: conv } = await supabase.from('conversations').select('*').eq('id', match.conversation_id).single();
        return res.json({ conversation: conv, otherUser: target });
      }
    }

    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .insert({ type: 'direct', created_by: req.user.id })
      .select('*')
      .single();
    if (convErr) throw convErr;

    await supabase.from('conversation_participants').insert([
      { conversation_id: conv.id, user_id: req.user.id },
      { conversation_id: conv.id, user_id: userId },
    ]);

    res.status(201).json({ conversation: conv, otherUser: target });
  } catch (err) {
    console.error('[direct conversation]', err);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

/* ── Create group conversation ── */
router.post('/group', authenticate, async (req, res) => {
  try {
    const { name, description, memberIds } = req.body;
    if (!name || !Array.isArray(memberIds)) return res.status(400).json({ error: 'name and memberIds required' });

    const { data: conv, error } = await supabase
      .from('conversations')
      .insert({ type: 'group', name: name.trim(), description: description || null, created_by: req.user.id })
      .select('*')
      .single();
    if (error) throw error;

    const uniqueMembers = [...new Set([req.user.id, ...memberIds])];
    await supabase.from('conversation_participants').insert(
      uniqueMembers.map((uid) => ({ conversation_id: conv.id, user_id: uid, role: uid === req.user.id ? 'admin' : 'member' }))
    );

    res.status(201).json({ conversation: conv });
  } catch (err) {
    console.error('[create group]', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

/* ── Get conversation details ── */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { data: member } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!member) return res.status(403).json({ error: 'Access denied' });

    const { data: conv } = await supabase.from('conversations').select('*').eq('id', req.params.id).single();
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const { data: participants } = await supabase
      .from('conversation_participants')
      .select('role, joined_at, users!user_id(id, username, display_name, avatar_url, is_online, last_seen, about, public_key, signing_public_key)')
      .eq('conversation_id', req.params.id);

    const parts = (participants || []).map((p) => ({ ...p.users, role: p.role, joined_at: p.joined_at }));

    // For direct chats, also expose other_* fields directly on the conversation
    let otherFields = {};
    if (conv.type === 'direct') {
      const other = parts.find((p) => p.id !== req.user.id);
      if (other) {
        otherFields = {
          other_user_id: other.id,
          other_username: other.username,
          other_display_name: other.display_name,
          other_avatar_url: other.avatar_url,
          other_is_online: other.is_online,
          other_last_seen: other.last_seen,
          other_about: other.about,
          other_public_key: other.public_key,
          other_signing_public_key: other.signing_public_key,
        };
      }
    }

    res.json({ conversation: { ...conv, ...otherFields }, participants: parts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

/* ── Get pending messages ── */
router.get('/:id/pending', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pending_messages')
      .select('*')
      .eq('conversation_id', req.params.id)
      .eq('recipient_id', req.user.id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ messages: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pending messages' });
  }
});

/* ── Delete pending messages (delivered) ── */
router.delete('/:id/pending', authenticate, async (req, res) => {
  try {
    const { messageIds } = req.body;
    if (!messageIds?.length) return res.json({ deleted: 0 });

    const { count, error } = await supabase
      .from('pending_messages')
      .delete({ count: 'exact' })
      .in('id', messageIds)
      .eq('recipient_id', req.user.id);

    if (error) throw error;
    res.json({ deleted: count || 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete pending messages' });
  }
});

/* ── Update settings ── */
router.put('/:id/settings', authenticate, async (req, res) => {
  try {
    const { is_pinned, is_archived, is_muted, muted_until } = req.body;
    const updates = {};
    if (is_pinned !== undefined) updates.is_pinned = is_pinned;
    if (is_archived !== undefined) updates.is_archived = is_archived;
    if (is_muted !== undefined) updates.is_muted = is_muted;
    if (muted_until !== undefined) updates.muted_until = muted_until;

    if (!Object.keys(updates).length) return res.json({ success: true });

    await supabase.from('conversation_participants')
      .update(updates)
      .eq('conversation_id', req.params.id)
      .eq('user_id', req.user.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/* ── Add group members ── */
router.post('/:id/members', authenticate, async (req, res) => {
  try {
    const { data: admin } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', req.params.id)
      .eq('user_id', req.user.id)
      .eq('role', 'admin')
      .single();
    if (!admin) return res.status(403).json({ error: 'Admin only' });

    const { userIds } = req.body;
    await supabase.from('conversation_participants').upsert(
      userIds.map((uid) => ({ conversation_id: req.params.id, user_id: uid, role: 'member' })),
      { onConflict: 'conversation_id,user_id', ignoreDuplicates: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add members' });
  }
});

/* ── Leave group ── */
router.delete('/:id/leave', authenticate, async (req, res) => {
  try {
    await supabase.from('conversation_participants').delete().eq('conversation_id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to leave conversation' });
  }
});

module.exports = router;
