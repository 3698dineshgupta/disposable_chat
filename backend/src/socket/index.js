const { verifyAccessToken } = require('../utils/jwt');
const { supabase } = require('../config/database');
const handlePresence = require('./handlers/presence');
const handleMessaging = require('./handlers/messaging');
const handleCalling = require('./handlers/calling');

const onlineUsers = new Map();

function initSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No token'));
      const decoded = verifyAccessToken(token);
      socket.userId = decoded.userId;

      const { data: user, error } = await supabase
        .from('users')
        .select('id, username, display_name, avatar_url')
        .eq('id', decoded.userId)
        .single();

      if (error || !user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId } = socket;

    // Single-device: kick any existing socket sessions for this user
    if (onlineUsers.has(userId)) {
      for (const sid of [...onlineUsers.get(userId)]) {
        const existing = io.sockets.sockets.get(sid);
        if (existing) {
          existing.emit('session:replaced');
          existing.disconnect(true);
        }
      }
    }
    // Replace old set so the kicked socket's disconnect handler is a no-op
    onlineUsers.set(userId, new Set([socket.id]));

    await supabase.from('users').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', userId);
    socket.broadcast.emit('user:online', { userId });
    socket.join(`user:${userId}`);

    const { data: convParticipations } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', userId);

    for (const row of convParticipations || []) {
      socket.join(`conv:${row.conversation_id}`);
    }

    handlePresence(io, socket, onlineUsers);
    handleMessaging(io, socket, onlineUsers);
    handleCalling(io, socket);

    const { data: pending } = await supabase
      .from('pending_messages')
      .select('*, users!sender_id(display_name, avatar_url)')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: true });

    if (pending?.length) {
      socket.emit('messages:pending', {
        messages: pending.map((m) => ({
          ...m,
          sender_name: m.users?.display_name,
          sender_avatar: m.users?.avatar_url,
        })),
      });
    }

    socket.on('disconnect', async () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          await supabase.from('users').update({ is_online: false, last_seen: new Date().toISOString() }).eq('id', userId);
          socket.broadcast.emit('user:offline', { userId, lastSeen: new Date().toISOString() });
        }
      }
    });
  });

  return { onlineUsers };
}

module.exports = initSocket;
