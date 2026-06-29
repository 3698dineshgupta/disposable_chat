const { supabase } = require('../../config/database');

module.exports = function handleCalling(io, socket) {

  /* ── Initiate call ── */
  socket.on('call:initiate', async ({ calleeId, type, conversationId, offer }, callback) => {
    try {
      const { data: call, error } = await supabase
        .from('calls')
        .insert({
          caller_id:       socket.userId,
          callee_id:       calleeId,
          type:            type || 'audio',
          status:          'calling',
          conversation_id: conversationId || null,
        })
        .select('*')
        .single();

      if (error) throw error;

      io.to(`user:${calleeId}`).emit('call:incoming', {
        callId:     call.id,
        callerId:   socket.userId,
        callerInfo: socket.user,
        type,
        conversationId,
        offer,
      });

      callback?.({ success: true, callId: call.id });
    } catch (err) {
      console.error('[call:initiate]', err);
      callback?.({ error: 'Failed to initiate call' });
    }
  });

  /* ── Call answered ── */
  socket.on('call:answer', ({ callId, callerId, answer }) => {
    // Emit signal immediately — don't block on DB
    io.to(`user:${callerId}`).emit('call:answered', { callId, answer });
    // Fire-and-forget DB update
    supabase.from('calls').update({ status: 'answered', answered_at: new Date().toISOString() }).eq('id', callId)
      .then(() => {}).catch((e) => console.error('[call:answer DB]', e));
  });

  /* ── Call rejected ── */
  socket.on('call:reject', ({ callId, callerId }) => {
    io.to(`user:${callerId}`).emit('call:rejected', { callId });
    supabase.from('calls').update({ status: 'rejected', ended_at: new Date().toISOString() }).eq('id', callId)
      .then(() => {}).catch((e) => console.error('[call:reject DB]', e));
  });

  /* ── Call ended ── */
  socket.on('call:end', ({ callId, peerId, duration }) => {
    if (peerId) io.to(`user:${peerId}`).emit('call:ended', { callId });
    if (callId) {
      supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString(), duration: duration || 0 }).eq('id', callId)
        .then(() => {}).catch((e) => console.error('[call:end DB]', e));
    }
  });

  /* ── Call missed ── */
  socket.on('call:missed', ({ callId }) => {
    supabase.from('calls').update({ status: 'missed', ended_at: new Date().toISOString() }).eq('id', callId)
      .then(() => {}).catch((e) => console.error('[call:missed DB]', e));
  });

  /* ── ICE candidate relay (no DB needed) ── */
  socket.on('call:ice', ({ peerId, candidate }) => {
    io.to(`user:${peerId}`).emit('call:ice', { candidate, from: socket.userId });
  });

  /* ── SDP relay ── */
  socket.on('call:offer', ({ peerId, offer }) => {
    io.to(`user:${peerId}`).emit('call:offer', { offer, from: socket.userId });
  });

  socket.on('call:answer-sdp', ({ peerId, answer }) => {
    io.to(`user:${peerId}`).emit('call:answer-sdp', { answer, from: socket.userId });
  });
};
