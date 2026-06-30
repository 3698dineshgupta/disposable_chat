const { verifyAccessToken } = require('../utils/jwt');
const { supabase } = require('../config/database');
const handlePresence = require('./handlers/presence');
const handleMessaging = require('./handlers/messaging');
const handleCalling = require('./handlers/calling');

const onlineUsers = new Map();

const log = (tag, msg, data) => {
  const ts = new Date().toISOString();
  if (data !== undefined) {
    console.log(`[${ts}] [SOCKET][${tag}] ${msg}`, typeof data === 'object' ? JSON.stringify(data) : data);
  } else {
    console.log(`[${ts}] [SOCKET][${tag}] ${msg}`);
  }
};

function initSocket(io) {
  /* ── Auth middleware ── */
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        log('AUTH', 'rejected — no token', { socketId: socket.id });
        return next(new Error('No token'));
      }

      let decoded;
      try {
        decoded = verifyAccessToken(token);
      } catch (e) {
        log('AUTH', `rejected — invalid token: ${e.message}`, { socketId: socket.id });
        return next(new Error('Authentication failed'));
      }

      const { data: user, error } = await supabase
        .from('users')
        .select('id, username, display_name, avatar_url')
        .eq('id', decoded.userId)
        .single();

      if (error || !user) {
        log('AUTH', `rejected — user not found: ${decoded.userId}`, { socketId: socket.id });
        return next(new Error('User not found'));
      }

      socket.userId = decoded.userId;
      socket.user = user;
      log('AUTH', `authenticated ${user.username} (${decoded.userId})`, { socketId: socket.id });
      next();
    } catch (err) {
      log('AUTH', `middleware error: ${err.message}`, { socketId: socket.id });
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId } = socket;
    log(userId, `connected`, { socketId: socket.id, username: socket.user?.username });

    /* ── Track online sockets per user (supports multiple tabs/devices) ── */
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    const wasOffline = onlineUsers.get(userId).size === 1;
    if (wasOffline) {
      await supabase.from('users').update({ is_online: true, last_seen: new Date().toISOString() }).eq('id', userId);
      socket.broadcast.emit('user:online', { userId });
      log(userId, 'user came online');
    }

    /* ── Join personal room ── */
    socket.join(`user:${userId}`);

    /* ── Auto-join all conversation rooms ── */
    const { data: convParticipations, error: convErr } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', userId);

    if (convErr) {
      log(userId, `error fetching conversations: ${convErr.message}`);
    } else {
      const convIds = (convParticipations || []).map(r => r.conversation_id);
      for (const cid of convIds) {
        socket.join(`conv:${cid}`);
      }
      log(userId, `joined ${convIds.length} conversation rooms`);
    }

    /* ── Register domain handlers ── */
    handlePresence(io, socket, onlineUsers);
    handleMessaging(io, socket, onlineUsers);
    handleCalling(io, socket);

    /* ── Deliver pending messages ── */
    try {
      const { data: pending } = await supabase
        .from('pending_messages')
        .select('*, users!sender_id(display_name, avatar_url)')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: true });

      if (pending?.length) {
        log(userId, `delivering ${pending.length} pending messages`);
        socket.emit('messages:pending', {
          messages: pending.map((m) => ({
            ...m,
            sender_name:   m.users?.display_name,
            sender_avatar: m.users?.avatar_url,
          })),
        });
      }
    } catch (err) {
      log(userId, `pending messages error: ${err.message}`);
    }

    /* ── Disconnect cleanup ── */
    socket.on('disconnect', async (reason) => {
      log(userId, `disconnected (${reason})`, { socketId: socket.id });
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          const lastSeen = new Date().toISOString();
          await supabase.from('users').update({ is_online: false, last_seen: lastSeen }).eq('id', userId);
          socket.broadcast.emit('user:offline', { userId, lastSeen });
          log(userId, 'user went offline');
        } else {
          log(userId, `still has ${sockets.size} other socket(s) — staying online`);
        }
      }
    });
  });

  return { onlineUsers };
}

module.exports = initSocket;
