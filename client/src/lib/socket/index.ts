'use client';

import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:10000';

let _socket: Socket | null = null;

export function getSocket(): Socket | null {
  return _socket;
}

export function connectSocket(accessToken: string): Socket {
  if (_socket?.connected) return _socket;

  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }

  _socket = io(SOCKET_URL, {
    auth: { token: accessToken },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  _socket.on('connect', () => {
    console.log('🔌 Socket connected:', _socket?.id);
  });

  _socket.on('disconnect', (reason) => {
    console.log('🔌 Socket disconnected:', reason);
  });

  _socket.on('connect_error', (err) => {
    console.error('🔌 Socket connection error:', err.message);
  });

  return _socket;
}

export function disconnectSocket(): void {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

export function updateSocketToken(token: string): void {
  if (_socket) {
    _socket.auth = { token };
    if (!_socket.connected) _socket.connect();
  }
}

export function joinConversationRoom(conversationId: string): void {
  if (_socket?.connected) {
    _socket.emit('conversation:join', { conversationId });
  }
}

export function emitWithAck<T = unknown>(event: string, data: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!_socket?.connected) {
      reject(new Error('Socket not connected'));
      return;
    }
    _socket.emit(event, data, (response: T & { error?: string }) => {
      if (response?.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}
