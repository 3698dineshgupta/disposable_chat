// In-memory room management
// rooms = Map<roomId, { users: Map<socketId, { publicKey, signingPublicKey, isTyping }> }>

class RoomManager {
    constructor() {
        this.rooms = new Map();
    }

    createRoomIfRequired(roomId) {
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, {
                users: new Map()
            });
        }
    }

    joinRoom(roomId, socketId, publicKey, signingPublicKey) {
        this.createRoomIfRequired(roomId);
        const room = this.rooms.get(roomId);

        // Enforce 2 participants max
        if (room.users.size >= 2 && !room.users.has(socketId)) {
            throw new Error('Room is full (max 2 participants)');
        }

        room.users.set(socketId, { publicKey, signingPublicKey, isTyping: false });
    }

    leaveRoom(socketId) {
        let emptyRoomIds = [];
        for (const [roomId, room] of this.rooms.entries()) {
            if (room.users.has(socketId)) {
                room.users.delete(socketId);

                // Return roomId to notify others
                if (room.users.size === 0) {
                    emptyRoomIds.push(roomId);
                }
            }
        }

        // Clean up empty rooms
        emptyRoomIds.forEach(id => this.rooms.delete(id));
    }

    getRoomUsers(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return [];
        return Array.from(room.users.entries()).map(([sid, data]) => ({
            socketId: sid,
            ...data
        }));
    }
}

module.exports = new RoomManager();
