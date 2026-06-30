const { supabase } = require('../../config/database');

const log = (tag, msg, data) => {
  const ts = new Date().toISOString();
  if (data !== undefined) {
    console.log(`[${ts}] [CALL][${tag}] ${msg}`, typeof data === 'object' ? JSON.stringify(data) : data);
  } else {
    console.log(`[${ts}] [CALL][${tag}] ${msg}`);
  }
};

module.exports = function handleCalling(io, socket) {

  /* ── Initiate call ── */
  socket.on('call:initiate', async ({ calleeId, type, conversationId, offer }, callback) => {
    try {
      log(socket.userId, `initiating ${type} call → ${calleeId}`, { conversationId, hasOffer: !!offer });

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

      log(socket.userId, `call record created`, { callId: call.id });

      const payload = {
        callId:     call.id,
        callerId:   socket.userId,
        callerInfo: socket.user,
        type,
        conversationId,
        offer,          // SDP offer included immediately for trickle ICE
      };

      const emitted = io.to(`user:${calleeId}`).emit('call:incoming', payload);
      log(socket.userId, `call:incoming emitted to user:${calleeId}`);

      callback?.({ success: true, callId: call.id });
    } catch (err) {
      log(socket.userId, `call:initiate error: ${err.message}`);
      callback?.({ error: 'Failed to initiate call' });
    }
  });

  /* ── ICE candidate relay (trickle ICE) ── */
  socket.on('call:ice', ({ peerId, candidate }) => {
    if (!peerId || !candidate) return;
    io.to(`user:${peerId}`).emit('call:ice', { candidate, from: socket.userId });
  });

  /* ── Call answered ── */
  socket.on('call:answer', ({ callId, callerId, answer }) => {
    log(socket.userId, `answering call ${callId} → caller ${callerId}`, { hasAnswer: !!answer });
    io.to(`user:${callerId}`).emit('call:answered', { callId, answer });
    supabase.from('calls').update({ status: 'answered', answered_at: new Date().toISOString() }).eq('id', callId)
      .then(() => {}).catch((e) => log('DB', `call:answer update error: ${e.message}`));
  });

  /* ── Call rejected ── */
  socket.on('call:reject', ({ callId, callerId }) => {
    log(socket.userId, `rejecting call ${callId} → ${callerId}`);
    io.to(`user:${callerId}`).emit('call:rejected', { callId });
    supabase.from('calls').update({ status: 'rejected', ended_at: new Date().toISOString() }).eq('id', callId)
      .then(() => {}).catch((e) => log('DB', `call:reject update error: ${e.message}`));
  });

  /* ── Call ended ── */
  socket.on('call:end', ({ callId, peerId, duration }) => {
    log(socket.userId, `ending call ${callId}, peer=${peerId}, duration=${duration}s`);
    if (peerId) io.to(`user:${peerId}`).emit('call:ended', { callId });
    if (callId) {
      supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString(), duration: duration || 0 }).eq('id', callId)
        .then(() => {}).catch((e) => log('DB', `call:end update error: ${e.message}`));
    }
  });

  /* ── Call missed ── */
  socket.on('call:missed', ({ callId }) => {
    log(socket.userId, `call missed ${callId}`);
    supabase.from('calls').update({ status: 'missed', ended_at: new Date().toISOString() }).eq('id', callId)
      .then(() => {}).catch((e) => log('DB', `call:missed update error: ${e.message}`));
  });

  /* ── SDP relay (for ICE restarts only — initial offer is in call:initiate) ── */
  socket.on('call:offer', ({ peerId, offer }) => {
    log(socket.userId, `relaying restart offer → ${peerId}`);
    io.to(`user:${peerId}`).emit('call:offer', { offer, from: socket.userId });
  });

  socket.on('call:answer-sdp', ({ peerId, answer }) => {
    log(socket.userId, `relaying restart answer → ${peerId}`);
    io.to(`user:${peerId}`).emit('call:answer-sdp', { answer, from: socket.userId });
  });
};
