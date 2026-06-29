'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ClientEvents, ServerEvents } from '@/types';

// ── Random nickname generator (inspired by mahjong-master's moniker) ──
const ADJ = ['快乐','勇敢','聪明','幸运','神秘','淡定','霸气','可爱','机智','沉稳','飘逸','无敌'];
const NOUN = ['麻将王','雀神','牌仙','高手','大侠','少侠','老司机','萌新','赌圣','风神','龙王','凤凰'];

function generateNickname(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a}${n}`;
}

/**
 * Get or create persistent player identity (ID + nickname).
 * ID is now server-generated, but we keep the last known ID in localStorage for reconnection.
 * Nickname is stored locally and sent to server on connect.
 */
function getPlayerIdentity(): { playerId: string | null; nickname: string } {
  if (typeof window === 'undefined') return { playerId: null, nickname: '' };

  const playerId = localStorage.getItem('mj_player_id');
  let nickname = localStorage.getItem('mj_nickname');

  if (!nickname) {
    nickname = generateNickname();
    localStorage.setItem('mj_nickname', nickname);
  }

  return { playerId, nickname };
}

/**
 * Save the server-generated player ID to localStorage.
 */
function savePlayerId(playerId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('mj_player_id', playerId);
}

let globalSocket: Socket<ServerEvents, ClientEvents> | null = null;

function getSocket(): Socket<ServerEvents, ClientEvents> {
  if (!globalSocket && typeof window !== 'undefined') {
    const identity = getPlayerIdentity();
    globalSocket = io(window.location.origin, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
      auth: {
        playerId: identity.playerId ?? undefined, // Send existing ID if we have one
        nickname: identity.nickname,
      },
    });
  }
  return globalSocket!;
}

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState<Socket<ServerEvents, ClientEvents> | null>(null);
  const [playerId, setPlayerId] = useState<string>('');
  const [nickname, setNickname] = useState<string>('');

  useEffect(() => {
    const identity = getPlayerIdentity();
    setPlayerId(identity.playerId ?? '');
    setNickname(identity.nickname);

    const s = getSocket();
    setSocket(s);
    setIsConnected(s.connected);

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    // Handle server-sent player identity
    const onIdentity = (data: { playerId: string; nickname: string }) => {
      setPlayerId(data.playerId);
      setNickname(data.nickname);
      savePlayerId(data.playerId);
      // Also save nickname in case server returned a different one
      localStorage.setItem('mj_nickname', data.nickname);
    };

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('player:identity', onIdentity);
    if (!s.connected) s.connect();

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('player:identity', onIdentity);
    };
  }, []);

  return {
    socket,
    isConnected,
    playerId,
    nickname,
  };
}
