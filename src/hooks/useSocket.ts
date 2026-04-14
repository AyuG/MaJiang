'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ClientEvents, ServerEvents } from '@/types';

// Singleton socket instance — shared across all components/hooks
// Prevents React strict mode double-mount from creating multiple connections
let globalSocket: Socket<ServerEvents, ClientEvents> | null = null;

function getSocket(): Socket<ServerEvents, ClientEvents> {
  if (!globalSocket && typeof window !== 'undefined') {
    globalSocket = io(window.location.origin, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
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

    // Sync initial state
    setIsConnected(s.connected);

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      // Do NOT disconnect — singleton stays alive
    };
  }, []);

  return { socket, isConnected };
}
