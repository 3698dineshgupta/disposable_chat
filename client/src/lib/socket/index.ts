'use client';

import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10000';

let _socket: Socket | null = null;

export function getSocket(): Socket | null {
  return _socket;
}

export function connectSocket(accessToken: string): Socket {
  // If already connected, update auth token for future reconnects and return it
  if (_socket?.connected) {
    _socket.auth = { token: accessToken };
    return _socket;
  }

  // If socket exists but is disconnected, tear it down first
  if (_socket) {
    _socket.removeAllListeners();
    _socket.disconnect();
    _socket = null;
  }

  _socket = io(SOCKET_URL, {
    auth: { token: accessToken },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,    // keep trying until we give up explicitly
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    randomizationFactor: 0.5,
    timeout: 20000,
    autoConnect: true,
  });

  _socket.on('connect', () => {
    console.log(`[SOCKET] connected id=${_socket?.id}`);
  });

  _socket.on('disconnect', (reason) => {
    console.log(`[SOCKET] disconnected reason=${reason}`);
  });

  _socket.on('connect_error', (err) => {
    console.warn(`[SOCKET] connect_error: ${err.message}`);
  });

  // Before each reconnect attempt, refresh auth to the latest token.
  // This handles the case where the access token was refreshed while
  // the socket was disconnected (network drop + token rotation).
  _socket.io.on('reconnect_attempt', () => {
    // Dynamically import to avoid circular deps at module load time
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getAccessToken } = require('@/lib/api');
      const token = getAccessToken();
      if (token && _socket) _socket.auth = { token };
    } catch { /* safe to ignore */ }
  });

  return _socket;
}

export function disconnectSocket(): void {
  if (_socket) {
    _socket.removeAllListeners();
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
      if ((response as { error?: string })?.error) reject(new Error((response as { error?: string }).error));
      else resolve(response);
    });
  });
}
