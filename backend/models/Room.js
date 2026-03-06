const mongoose = require('../utils/mongooseMock');

const roomSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true },
    isPasswordProtected: { type: Boolean, default: false },
    roomPasswordHash: { type: String },
    createdAt: { type: Date, default: Date.now, expires: 86400 } // Auto-delete after 24 hours
});

module.exports = mongoose.model('Room', roomSchema);
