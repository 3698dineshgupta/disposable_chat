const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const bcrypt = require('bcrypt');
const Room = require('../models/Room');
const roomManager = require('../roomManager');

// Generate a random room ID and optionally protect with password
router.post('/generate', async (req, res) => {
    try {
        const { password } = req.body;
        const roomId = crypto.randomBytes(16).toString('hex');
        const origin = process.env.CLIENT_URL || 'http://localhost:5173';

        const roomData = { roomId };

        if (password) {
            const salt = await bcrypt.genSalt(10);
            roomData.roomPasswordHash = await bcrypt.hash(password, salt);
            roomData.isPasswordProtected = true;
        }

        const room = new Room(roomData);
        await room.save();

        res.json({
            roomId,
            inviteLink: `${origin}/chat/${roomId}`,
            isPasswordProtected: roomData.isPasswordProtected
        });
    } catch (err) {
        console.error('Room generation error:', err);
        res.status(500).json({ error: 'Failed to generate room' });
    }
});

module.exports = router;
