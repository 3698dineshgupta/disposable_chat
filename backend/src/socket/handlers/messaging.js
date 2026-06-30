const { supabase } = require('../../config/database');
const { notifyNewMessage } = require('../../services/push/PushService');

/*
 * In-memory tracker: localId -> { storagePath, uploadedAt }
 * Ephemeral media files are deleted from Supabase Storage once the recipient
 * marks the message as seen, or after a 48-hour TTL.
 */
const mediaTracker = {};

// Purge files older than 48 hours every hour
setInterval(async () => {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const stale = [];
  for (const [localId, info] of Object.entries(mediaTracker)) {
    if (info.uploadedAt < cutoff) {
      stale.push(info.storagePath);
      delete mediaTracker[localId];
    }
  }
  if (stale.length > 0) {
    supabase.storage.from('media').remove(stale).catch((e) =>
      console.error('[media-cleanup]', e)
    );
  }
}, 60 * 60 * 1000);

/* ── Per-socket rate limiter: max 30 message:send events per 10 seconds ── */
function makeRateLimiter(maxEvents, windowMs) {
  const counts = {};
  return function check(socketId) {
    const now = Date.now();
    const entry = counts[socketId] ?? { count: 0, windowStart: now };
    if (now - entry.windowStart > windowMs) {
      entry.count = 0;
      entry.windowStart = now;
    }
    entry.count++;
    counts[socketId] = entry;
    return entry.count <= maxEvents;
  };
}

const msgRateOk = makeRateLimiter(30, 10_000);
const MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KB encrypted payload limit

module.exports = function handleMessaging(io, socket, onlineUsers) {
  socket.on('message:send', async (data, callback) => {
    try {
      // Rate limit
      if (!msgRateOk(socket.id)) return callback?.({ error: 'Too many messages — slow down' });

      const { conversationId, recipientId, encryptedPayload, messageType, localId, storagePath } = data;
      if (!conversationId || !encryptedPayload) return callback?.({ error: 'conversationId and encryptedPayload required' });

      // Payload size guard — prevents OOM via oversized encrypted blobs
      const payloadSize = Buffer.byteLength(JSON.stringify(encryptedPayload), 'utf8');
      if (payloadSize > MAX_PAYLOAD_BYTES) return callback?.({ error: 'Payload too large' });

      const { data: member } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .eq('user_id', socket.userId)
        .single();
      if (!member) return callback?.({ error: 'Not a participant' });

      // Non-blocking timestamp bump — don't await (a failure here must never
      // abort the send path; it is cosmetic and will self-heal on the next query).
      supabase.from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .then(() => {})
        .catch((e) => console.warn('[message:send] conversations.update error:', e?.message));

      // Track ephemeral media so we can delete it after delivery
      if (storagePath && localId) {
        mediaTracker[localId] = { storagePath, uploadedAt: Date.now() };
      }

      const messageEvent = {
        conversationId, senderId: socket.userId, encryptedPayload,
        messageType: messageType || 'text', localId, timestamp: new Date().toISOString(),
      };

      // Broadcast to all sockets that have joined the conversation room.
      socket.to(`conv:${conversationId}`).emit('message:receive', messageEvent);

      // Always persist to pending_messages so the message survives if the
      // real-time socket emit misses (recipient not in conv room, network blip,
      // tab in background, etc.). The client cleans up via message:seen which
      // deletes rows by local_id. For online recipients we ALSO emit directly
      // to their personal user room — the client deduplicates by localId.
      const pendingBase = { conversation_id: conversationId, sender_id: socket.userId, encrypted_payload: encryptedPayload, message_type: messageType || 'text', local_id: localId };

      if (recipientId) {
        // Save to pending regardless of online status — cleaned up by message:seen
        supabase.from('pending_messages').insert({ ...pendingBase, recipient_id: recipientId }).catch(() => {});

        const isOnline = onlineUsers.has(recipientId);
        if (isOnline) {
          // Direct delivery to personal room in case recipient hasn't joined conv room
          io.to(`user:${recipientId}`).emit('message:receive', messageEvent);
        } else {
          notifyNewMessage({
            recipientId,
            senderName: socket.user?.display_name || 'Someone',
            conversationId,
            isGroup: false,
          }).catch(() => {});
        }
      } else {
        const { data: members } = await supabase
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', conversationId)
          .neq('user_id', socket.userId);

        for (const m of members || []) {
          supabase.from('pending_messages').insert({ ...pendingBase, recipient_id: m.user_id }).catch(() => {});
          if (onlineUsers.has(m.user_id)) {
            io.to(`user:${m.user_id}`).emit('message:receive', messageEvent);
          } else {
            notifyNewMessage({
              recipientId: m.user_id,
              senderName: socket.user?.display_name || 'Someone',
              conversationId,
              isGroup: true,
              groupName: 'Group chat',
            }).catch(() => {});
          }
        }
      }

      callback?.({ success: true, timestamp: messageEvent.timestamp });
    } catch (err) {
      console.error('[message:send] unhandled error:', err?.message ?? err);
      callback?.({ error: err?.message || 'Failed to send message' });
    }
  });

  socket.on('message:delivered', async ({ conversationId, localId, senderId }) => {
    try {
      await supabase.from('pending_messages').delete().eq('local_id', localId).eq('recipient_id', socket.userId);
      io.to(`user:${senderId}`).emit('message:delivered', { localId, conversationId, deliveredAt: new Date().toISOString() });
    } catch (err) { console.error('[message:delivered]', err); }
  });

  socket.on('message:seen', async ({ conversationId, localIds, senderId }) => {
    try {
      if (localIds?.length) {
        await supabase.from('pending_messages').delete().in('local_id', localIds).eq('recipient_id', socket.userId);

        // Delete ephemeral media files now that the recipient has seen them
        const pathsToDelete = [];
        for (const localId of localIds) {
          if (mediaTracker[localId]) {
            pathsToDelete.push(mediaTracker[localId].storagePath);
            delete mediaTracker[localId];
          }
        }
        if (pathsToDelete.length > 0) {
          supabase.storage.from('media').remove(pathsToDelete).catch((e) =>
            console.error('[media-delete-on-seen]', e)
          );
        }
      }

      await supabase.from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', socket.userId);

      io.to(`user:${senderId}`).emit('message:seen', { localIds, conversationId, seenBy: socket.userId, seenAt: new Date().toISOString() });
    } catch (err) { console.error('[message:seen]', err); }
  });

  socket.on('messages:acknowledge', async ({ messageIds }, callback) => {
    try {
      await supabase.from('pending_messages').delete().in('id', messageIds).eq('recipient_id', socket.userId);
      callback?.({ success: true });
    } catch { callback?.({ error: 'Failed to acknowledge' }); }
  });

  socket.on('conversation:join', async ({ conversationId }) => {
    // Verify the user is actually a participant before allowing room join (prevents IDOR eavesdropping)
    const { data: member } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', socket.userId)
      .single();
    if (member) socket.join(`conv:${conversationId}`);
  });

  socket.on('message:react', ({ conversationId, localId, emoji }) => {
    socket.to(`conv:${conversationId}`).emit('message:react', { localId, conversationId, userId: socket.userId, emoji });
  });
};
