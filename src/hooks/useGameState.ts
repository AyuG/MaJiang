'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientEvents, ClientGameState, ServerEvents } from '@/types';
import { canWin } from '@/engine/win-checker';
import { mergeScoreHistory, recordCompletedRound, type ScoreLogEntry } from '@/hooks/score-history';
export type { ScoreLogEntry } from '@/hooks/score-history';

const TURN_SECONDS = 30;
const AWAITING_SECONDS = 15;

export interface GangInfo {
  type: 'ming' | 'an' | 'bu';
  tileId?: number;
}

export interface DiceInfo {
  rolls: number[];
  dealerIndex: number;
}

const STORAGE_KEY = 'mj_score_history';

function loadScoreHistory(): ScoreLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveScoreHistory(log: ScoreLogEntry[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(log)); } catch { /* quota exceeded, ignore */ }
}

export function clearFinishedScores(): ScoreLogEntry[] {
  saveScoreHistory([]);
  return [];
}

export interface GameStateHook {
  gameState: ClientGameState | null;
  roomId: string | null;
  availableActions: string[];
  gangOptions: GangInfo[];
  remainingSeconds: number;
  diceResult: DiceInfo | null;
  scoreLog: ScoreLogEntry[];
}

export function useGameState(socket: Socket<ServerEvents, ClientEvents> | null, persistentPlayerId?: string): GameStateHook {
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [diceResult, setDiceResult] = useState<DiceInfo | null>(null);
  const [scoreLog, setScoreLog] = useState<ScoreLogEntry[]>(() => loadScoreHistory());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = useCallback((seconds: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setRemainingSeconds(seconds);
    timerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onStarted = (state: ClientGameState) => {
      setGameState(state);
      setRoomId(state.roomId);
      setDiceResult(null);
      setScoreLog((log) => {
        const updated = recordCompletedRound(log, state);
        saveScoreHistory(updated);
        return updated;
      });
      if (state.phase === 'TURN') startTimer(TURN_SECONDS);
      else if (state.phase === 'AWAITING') startTimer(AWAITING_SECONDS);
    };

    const onStateUpdate = (state: ClientGameState) => {
      setScoreLog((log) => {
        const updated = recordCompletedRound(log, state);
        saveScoreHistory(updated);
        return updated;
      });
      setGameState((prev) => {
        // Only reset timer when phase or current player actually changes
        const phaseChanged = !prev || prev.phase !== state.phase;
        const playerChanged = !prev || prev.currentPlayerIndex !== state.currentPlayerIndex;
        const turnChanged = !prev || prev.turnCount !== state.turnCount;

        if (phaseChanged || playerChanged || turnChanged) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setRemainingSeconds(0);
        }

        return state;
      });
    };

    const onPaused = () => {
      setGameState((prev) => prev ? { ...prev, isPaused: true } : prev);
      if (timerRef.current) clearInterval(timerRef.current);
    };

    const onResumed = () => {
      setGameState((prev) => prev ? { ...prev, isPaused: false } : prev);
    };

    const onDiceResult = (data: { rolls: number[]; dealerIndex: number }) => {
      setDiceResult(data);
    };

    const onScoreHistory: ServerEvents['game:score-history'] = (data) => {
      setScoreLog((log) => {
        const updated = mergeScoreHistory(log, data.roomId, data.scoreHistory);
        saveScoreHistory(updated);
        return updated;
      });
    };

    const onDissolved: ServerEvents['room:dissolved'] = (data) => {
      const dissolvedRoomId = data?.roomId ?? roomId;
      // Mark all entries for this room as finished
      setScoreLog((prev) => {
        const updated = dissolvedRoomId
          ? mergeScoreHistory(prev, dissolvedRoomId, data?.scoreHistory ?? [], true) : prev;
        saveScoreHistory(updated);
        return updated;
      });
      setGameState(null);
      setRoomId(null);
      setDiceResult(null);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setRemainingSeconds(0);
    };

    // Auto-rejoin room on socket reconnect (mobile background recovery)
    const onReconnect = () => {
      if (roomId) {
        socket.emit('room:join', roomId);
      }
    };

    socket.on('game:started', onStarted);
    socket.on('game:state-update', onStateUpdate);
    socket.on('game:paused', onPaused);
    socket.on('game:resumed', onResumed);
    socket.on('game:dice-result', onDiceResult);
    socket.on('room:dissolved', onDissolved);
    socket.on('game:score-history', onScoreHistory);
    socket.on('connect', onReconnect);

    return () => {
      socket.off('game:started', onStarted);
      socket.off('game:state-update', onStateUpdate);
      socket.off('game:paused', onPaused);
      socket.off('game:resumed', onResumed);
      socket.off('game:dice-result', onDiceResult);
      socket.off('room:dissolved', onDissolved);
      socket.off('game:score-history', onScoreHistory);
      socket.off('connect', onReconnect);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [socket, startTimer, roomId]);

  const availableActions: string[] = [];
  const gangOptions: GangInfo[] = [];
  let showTimer = false;
  let timerDuration = 0;

  if (gameState && socket) {
    const myId = persistentPlayerId || socket.id;
    const myIndex = gameState.players.findIndex((p) => p.id === myId);

    if (gameState.phase === 'TURN' && gameState.currentPlayerIndex === myIndex) {
      showTimer = true;
      timerDuration = TURN_SECONDS;
      const myHand = gameState.myHand;
      const myMelds = gameState.players[myIndex].melds;

      // Only show discard/hu/gang if player has drawn (correct hand size)
      const expectedHandForDiscard = 14 - myMelds.length * 3;
      const hasDrawn = myHand.length === expectedHandForDiscard;

      if (hasDrawn) {
        availableActions.push('discard');

        // Check hu: client-side win check using the engine
        // Only allow hu if player has actually drawn (self-draw), not after peng
        // 碰牌后 lastDrawnTileId 为 null，不能胡
        if (gameState.lastDrawnTileId !== null && canWin(myHand, myMelds)) {
          availableActions.push('hu');
        }

        // Check an_gang: need 4 identical tiles in hand
        const tileCounts = new Map<string, { count: number; tileId: number }>();
        for (const t of myHand) {
          const key = `${t.suit}:${t.value}`;
          const existing = tileCounts.get(key);
          if (existing) {
            existing.count++;
          } else {
            tileCounts.set(key, { count: 1, tileId: t.id });
          }
        }
        for (const [, info] of tileCounts) {
          if (info.count >= 4) {
            availableActions.push('an_gang');
            gangOptions.push({ type: 'an', tileId: info.tileId });
            break;
          }
        }

        // Check bu_gang: need a tile in hand matching an existing peng meld
        for (const meld of myMelds) {
          if (meld.type === 'peng' && meld.tiles.length > 0) {
            const meldTile = meld.tiles[0];
            const matchTile = myHand.find(
              (t) => t.suit === meldTile.suit && t.value === meldTile.value,
            );
            if (matchTile) {
              availableActions.push('bu_gang');
              gangOptions.push({ type: 'bu', tileId: matchTile.id });
              break;
            }
          }
        }
      }
    }

    if (
      gameState.phase === 'AWAITING' &&
      gameState.currentPlayerIndex !== myIndex &&
      typeof myId === 'string' &&
      gameState.pendingResponsePlayerIds.includes(myId) &&
      !gameState.passedPlayerIds.includes(myId)
    ) {
      const lastDiscard = gameState.lastDiscard;
      if (lastDiscard && myIndex >= 0) {
        const myHand = gameState.myHand;
        const discardedSuit = lastDiscard.tile.suit;
        const discardedValue = lastDiscard.tile.value;
        const matchCount = myHand.filter(
          (t) => t.suit === discardedSuit && t.value === discardedValue,
        ).length;

        if (matchCount >= 3) {
          availableActions.push('ming_gang');
          gangOptions.push({ type: 'ming' });
        }
        if (matchCount >= 2) {
          availableActions.push('peng');
          availableActions.push('pass');
          showTimer = true;
          timerDuration = AWAITING_SECONDS;
        }
      }
    }
  }

  // Start timer only when we have actions and timer isn't already running
  useEffect(() => {
    if (showTimer && timerDuration > 0 && remainingSeconds === 0) {
      startTimer(timerDuration);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.phase, gameState?.currentPlayerIndex, gameState?.turnCount]);

  return { gameState, roomId, availableActions, gangOptions, remainingSeconds: showTimer ? remainingSeconds : 0, diceResult, scoreLog };
}
