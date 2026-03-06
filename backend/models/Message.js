const mongoose = require('../utils/mongooseMock');

const messageSchema = new mongoose.Schema({
    roomId: { type: String, required: true },
    senderId: { type: String, required: true },
    payload: {
        ciphertext: { type: String, required: true },
        iv: { type: String, required: true },
        signature: { type: String },
        signingPublicKey: { type: String }
    },
    selfDestructEnabled: { type: Boolean, default: false },
    expiresAt: { type: Date },
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    timestamp: { type: Number, default: Date.now },
    status: { type: String, enum: ['sent', 'delivered', 'seen'], default: 'sent' }
});

// TTL index for self-destructing messages
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Message', messageSchema);
