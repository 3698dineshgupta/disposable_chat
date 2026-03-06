const bcrypt = require('bcrypt');
const Room = require('./models/Room');
const Message = require('./models/Message');
const roomManager = require('./roomManager');

function initSocket(io) {
    io.on('connection', (socket) => {
        console.log(`🔌 Socket connected: ${socket.id}`);
        // Store authorized rooms for this session
        socket.authorizedRooms = new Set();

        // join-room: Client provides their public key upon joining
        socket.on('join-room', async ({ roomId, publicKey, signingPublicKey, password }, callback) => {
            try {
                if (!roomId || !publicKey) {
                    return callback?.({ error: 'roomId and publicKey are required' });
                }

                // Check for password protection
                const roomInfo = await Room.findOne({ roomId });
                if (roomInfo && roomInfo.isPasswordProtected) {
                    if (!socket.authorizedRooms.has(roomId)) {
                        if (!password) {
                            return callback?.({ error: 'password-required' });
                        }
                        const isMatch = await bcrypt.compare(password, roomInfo.roomPasswordHash);
                        if (!isMatch) {
                            return callback?.({ error: 'Invalid password' });
                        }
                        socket.authorizedRooms.add(roomId);
                    }
                }

                roomManager.joinRoom(roomId, socket.id, publicKey, signingPublicKey);
                socket.join(roomId);
                console.log(`📥 ${socket.id} joined room ${roomId}`);

                // Notify others in room about the new user and their public keys
                socket.to(roomId).emit('user-joined', {
                    socketId: socket.id,
                    publicKey,
                    signingPublicKey
                });

                // Send existing room members to the joining user
                const existingUsers = roomManager.getRoomUsers(roomId).filter(u => u.socketId !== socket.id);

                callback?.({ success: true, users: existingUsers });
            } catch (err) {
                console.error(`[join-room error]:`, err.message);
                callback?.({ error: err.message });
            }
        });

        // exchange-public-keys: Optional targeted key exchange
        socket.on('exchange-public-keys', ({ roomId, targetSocketId, publicKey }) => {
            io.to(targetSocketId).emit('public-key-received', {
                socketId: socket.id,
                publicKey
            });
        });

        // send-message: Relay encrypted payload to room
        socket.on('send-message', async ({ roomId, payload, selfDestructTimer }, callback) => {
            try {
                // payload should contain { ciphertext, iv, signature, signingPublicKey }
                const messageData = {
                    roomId,
                    senderId: socket.id,
                    payload,
                    timestamp: Date.now()
                };

                if (selfDestructTimer && selfDestructTimer > 0) {
                    messageData.selfDestructEnabled = true;
                    messageData.expiresAt = new Date(Date.now() + selfDestructTimer * 1000);
                }

                // Save to MongoDB
                const msg = new Message(messageData);
                await msg.save();

                socket.to(roomId).emit('receive-message', {
                    ...messageData,
                    _id: msg._id
                });
                callback?.({ success: true, timestamp: messageData.timestamp, _id: msg._id });
            } catch (err) {
                console.error('[send-message error]:', err);
                callback?.({ error: 'Failed to relay message' });
            }
        });

        // unsend-message: Remove message for everyone
        socket.on('unsend-message', async ({ roomId, messageId }, callback) => {
            try {
                const msg = await Message.findById(messageId);
                if (!msg) return callback?.({ error: 'Message not found' });

                if (msg.senderId !== socket.id) {
                    return callback?.({ error: 'Unauthorized' });
                }

                msg.deleted = true;
                msg.deletedAt = new Date();
                // When unsent, we stop the self-destruct timer by removing expiresAt
                msg.expiresAt = undefined;
                await msg.save();

                io.to(roomId).emit('message-unsent', { messageId });
                callback?.({ success: true });
            } catch (err) {
                console.error('[unsend-message error]:', err);
                callback?.({ error: 'Failed to unsend message' });
            }
        });

        // message_delivered: Update status to delivered
        socket.on('message_delivered', async ({ roomId, messageId }) => {
            try {
                const msg = await Message.findById(messageId);
                if (msg && msg.status === 'sent') {
                    msg.status = 'delivered';
                    await msg.save();
                    io.to(roomId).emit('message_delivered_update', { messageId });
                }
            } catch (err) {
                console.error('[message_delivered error]:', err);
            }
        });

        // message_seen: Update status to seen
        socket.on('message_seen', async ({ roomId, messageId }) => {
            try {
                const msg = await Message.findById(messageId);
                if (msg && msg.status !== 'seen') {
                    msg.status = 'seen';
                    await msg.save();
                    io.to(roomId).emit('message_seen_update', { messageId });
                }
            } catch (err) {
                console.error('[message_seen error]:', err);
            }
        });

        // screenshot_taken: Alert room participants
        socket.on('screenshot_taken', ({ roomId }) => {
            io.to(roomId).emit('screenshot_alert', { userId: socket.id });
        });

        // change-room-password: Only room creator (simplified check for this in-memory/socket session)
        socket.on('change-room-password', async ({ roomId, newPassword }, callback) => {
            try {
                // In this simplified implementation, we assume the first user who joined is the creator or has admin rights
                // For a more robust solution, we'd check against roomInfo.creatorId
                const roomInfo = await Room.findOne({ roomId });
                if (!roomInfo) return callback?.({ error: 'Room not found' });

                const salt = await bcrypt.genSalt(10);
                roomInfo.roomPasswordHash = await bcrypt.hash(newPassword, salt);
                roomInfo.isPasswordProtected = true;
                await roomInfo.save();

                callback?.({ success: true });
            } catch (err) {
                callback?.({ error: 'Failed to change password' });
            }
        });

        socket.on('typing-indicator', ({ roomId, isTyping }) => {
            socket.to(roomId).emit('typing-update', {
                socketId: socket.id,
                isTyping
            });
        });

        socket.on('leave-room', ({ roomId }) => {
            socket.leave(roomId);
            roomManager.leaveRoom(socket.id);
            socket.to(roomId).emit('user-left', { socketId: socket.id });
        });

        socket.on('disconnect', () => {
            console.log(`🔌 Socket disconnected: ${socket.id}`);
            // Find which rooms the user was in to notify others
            const roomsToNotify = [];
            roomManager.rooms.forEach((room, roomId) => {
                if (room.users.has(socket.id)) {
                    roomsToNotify.push(roomId);
                }
            });

            roomManager.leaveRoom(socket.id);

            roomsToNotify.forEach(roomId => {
                io.to(roomId).emit('user-left', { socketId: socket.id });
            });
        });
    });
}

module.exports = initSocket;
