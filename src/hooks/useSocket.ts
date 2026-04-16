'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ClientEvents, ServerEvents } from '@/types';

/**
 * Generate or retrieve a persistent player ID.
 * Stored in localStorage so it survives page refreshes and reconnects.
 */
function getPlayerId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('mj_player_id');
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('mj_player_id', id);
  }
  return id;
}

let globalSocket: Socket<ServerEvents, ClientEvents> | null = null;

function getSocket(): Socket<ServerEvents, ClientEvents> {
  if (!globalSocket && typeof window !== 'undefined') {
    const playerId = getPlayerId();
    globalSocket = io(window.location.origin, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
      auth: { playerId },
    });
  }
  return globalSocket!;
}

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState<Socket<ServerEvents, ClientEvents> | null>(null);

  useEffect(() => {
    const s = getSocket();
    setSocket(s);
    setIsConnected(s.connected);

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, []);

  return { socket, isConnected };
}
