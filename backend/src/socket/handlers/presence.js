const { supabase } = require('../../config/database');

module.exports = function handlePresence(io, socket, onlineUsers) {
  /* ── Typing indicators ── */
  socket.on('typing:start', ({ conversationId }) => {
    socket.to(`conv:${conversationId}`).emit('typing:start', { userId: socket.userId, conversationId });
  });

  socket.on('typing:stop', ({ conversationId }) => {
    socket.to(`conv:${conversationId}`).emit('typing:stop', { userId: socket.userId, conversationId });
  });

  /* ── Last seen update ── */
  socket.on('presence:update', async () => {
    await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', socket.userId);
  });

  /* ── Check if specific users are online ── */
  socket.on('presence:check', ({ userIds }, callback) => {
    const result = {};
    for (const uid of userIds) result[uid] = onlineUsers.has(uid);
    callback?.(result);
  });
};
