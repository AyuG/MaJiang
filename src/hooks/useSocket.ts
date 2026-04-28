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
 * Stored in localStorage, survives refresh/reconnect.
 */
function getPlayerIdentity(): { playerId: string; nickname: string } {
  if (typeof window === 'undefined') return { playerId: '', nickname: '' };

  let playerId = localStorage.getItem('mj_player_id');
  let nickname = localStorage.getItem('mj_nickname');

  if (!playerId) {
    playerId = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('mj_player_id', playerId);
  }
  if (!nickname) {
    nickname = generateNickname();
    localStorage.setItem('mj_nickname', nickname);
  }

  return { playerId, nickname };
}

let globalSocket: Socket<ServerEvents, ClientEvents> | null = null;

function getIdentity(): { playerId: string; nickname: string } {
  if (typeof window === 'undefined') return { playerId: '', nickname: '' };
  return getPlayerIdentity();
}

function getSocket(): Socket<ServerEvents, ClientEvents> {
  if (!globalSocket && typeof window !== 'undefined') {
    const identity = getIdentity();
    globalSocket = io(window.location.origin, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
      auth: {
        playerId: identity.playerId,
        nickname: identity.nickname,
      },
    });
  }
  return globalSocket!;
}

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState<Socket<ServerEvents, ClientEvents> | null>(null);
  const identity = typeof window !== 'undefined' ? getIdentity() : { playerId: '', nickname: '' };

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

  return {
    socket,
    isConnected,
    playerId: identity.playerId,
    nickname: identity.nickname,
  };
}
