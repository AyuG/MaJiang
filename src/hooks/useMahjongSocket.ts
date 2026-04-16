'use client';

import { useCallback } from 'react';
import { useSocket } from './useSocket';
import { useGameState } from './useGameState';

export function useMahjongSocket() {
  const { socket, isConnected, playerId, nickname } = useSocket();
  const { gameState, roomId, availableActions, gangOptions, remainingSeconds, winResult, isDraw, diceResult, scoreLog } =
    useGameState(socket, playerId);

  const createRoom = useCallback(() => {
    socket?.emit('room:create');
  }, [socket]);

  const joinRoom = useCallback(
    (id: string) => {
      socket?.emit('room:join', id);
    },
    [socket],
  );

  const setReady = useCallback(() => {
    socket?.emit('room:ready');
  }, [socket]);

  const setUnready = useCallback(() => {
    socket?.emit('room:unready');
  }, [socket]);

  const kickPlayer = useCallback(
    (targetId: string) => {
      socket?.emit('room:kick', targetId);
    },
    [socket],
  );

  const dissolveRoom = useCallback(() => {
    socket?.emit('room:dissolve');
  }, [socket]);

  const startGame = useCallback(() => {
    socket?.emit('room:start');
  }, [socket]);

  const discard = useCallback(
    (tileId: number) => {
      socket?.emit('game:discard', tileId);
    },
    [socket],
  );

  const peng = useCallback(() => {
    socket?.emit('game:peng');
  }, [socket]);

  const gang = useCallback(
    (type: 'ming' | 'an' | 'bu', tileId?: number) => {
      socket?.emit('game:gang', type, tileId);
    },
    [socket],
  );

  const hu = useCallback(() => {
    socket?.emit('game:hu');
  }, [socket]);

  const pass = useCallback(() => {
    socket?.emit('game:pass');
  }, [socket]);

  const voteDissolve = useCallback(() => {
    socket?.emit('room:vote-dissolve');
  }, [socket]);

  const voteDissolveReply = useCallback(
    (agree: boolean) => {
      socket?.emit('room:vote-dissolve-reply', agree);
    },
    [socket],
  );

  const leaveRoom = useCallback(() => {
    // Disconnect triggers server-side cleanup (remove from room)
    // Then reconnect to get a fresh socket
    if (socket) {
      socket.disconnect();
      setTimeout(() => socket.connect(), 100);
    }
  }, [socket]);

  return {
    socket,
    isConnected,
    playerId,
    nickname,
    gameState,
    roomId,
    availableActions,
    gangOptions,
    remainingSeconds,
    winResult,
    isDraw,
    diceResult,
    scoreLog,
    createRoom,
    joinRoom,
    setReady,
    setUnready,
    kickPlayer,
    dissolveRoom,
    startGame,
    discard,
    peng,
    gang,
    hu,
    pass,
    voteDissolve,
    voteDissolveReply,
    leaveRoom,
  };
}
