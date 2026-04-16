'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientEvents, ClientGameState, ServerEvents, GameResult } from '@/types';
import { canWin } from '@/engine/win-checker';

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

export interface ScoreLogEntry {
  round: number;
  roomId?: string;
  result: 'win' | 'draw';
  winnerId?: string;
  scores: Array<{ playerId: string; seat: string; delta: number }>;
}

export interface GameStateHook {
  gameState: ClientGameState | null;
  roomId: string | null;
  availableActions: string[];
  gangOptions: GangInfo[];
  remainingSeconds: number;
  winResult: GameResult | null;
  isDraw: boolean;
  diceResult: DiceInfo | null;
  scoreLog: ScoreLogEntry[];
}

export function useGameState(socket: Socket<ServerEvents, ClientEvents> | null, persistentPlayerId?: string): GameStateHook {
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [winResult, setWinResult] = useState<GameResult | null>(null);
  const [isDraw, setIsDraw] = useState(false);
  const [diceResult, setDiceResult] = useState<DiceInfo | null>(null);
  const [scoreLog, setScoreLog] = useState<ScoreLogEntry[]>([]);
  const prevScoresRef = useRef<Map<string, number>>(new Map());
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
      setWinResult(null);
      setIsDraw(false);
      setDiceResult(null);
      // Snapshot scores for delta calculation
      const map = new Map<string, number>();
      for (const p of state.players) map.set(p.id, p.score);
      prevScoresRef.current = map;
      if (state.phase === 'TURN') startTimer(TURN_SECONDS);
      else if (state.phase === 'AWAITING') startTimer(AWAITING_SECONDS);
    };

    const onStateUpdate = (state: ClientGameState) => {
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

        // Record score log when a round ends
        if (state.phase === 'WIN' || state.phase === 'DRAW') {
          const prevScores = prevScoresRef.current;
          const SEATS = ['东', '南', '西', '北'];
          const deltas = state.players.map((p, i) => ({
            playerId: p.id,
            seat: SEATS[i] ?? '?',
            delta: p.score - (prevScores.get(p.id) ?? 0),
          }));
          const winner = state.phase === 'WIN'
            ? state.players.reduce((best, p) => p.score > best.score ? p : best, state.players[0])
            : null;
          setScoreLog((log) => [...log, {
            round: state.roundNumber ?? log.length + 1,
            roomId: state.roomId,
            result: state.phase === 'WIN' ? 'win' : 'draw',
            winnerId: winner?.id,
            scores: deltas,
          }]);
        }

        // Snapshot current scores for next round delta calculation
        if (state.phase === 'TURN' || state.phase === 'DEALING') {
          const map = new Map<string, number>();
          for (const p of state.players) map.set(p.id, p.score);
          prevScoresRef.current = map;
        }

        return state;
      });
    };

    const onPaused = (_playerId: string) => {
      setGameState((prev) => prev ? { ...prev, isPaused: true } : prev);
      if (timerRef.current) clearInterval(timerRef.current);
    };

    const onResumed = () => {
      setGameState((prev) => prev ? { ...prev, isPaused: false } : prev);
    };

    const onWin = (result: GameResult) => {
      setWinResult(result);
    };

    const onDraw = () => {
      setIsDraw(true);
    };

    const onDiceResult = (data: { rolls: number[]; dealerIndex: number }) => {
      setDiceResult(data);
    };

    const onDissolved = (scoreHistory?: any[]) => {
      setGameState(null);
      setRoomId(null);
      setWinResult(null);
      setIsDraw(false);
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
    socket.on('game:win', onWin);
    socket.on('game:draw', onDraw);
    socket.on('game:dice-result' as any, onDiceResult);
    socket.on('room:dissolved', onDissolved);
    socket.on('connect', onReconnect);

    return () => {
      socket.off('game:started', onStarted);
      socket.off('game:state-update', onStateUpdate);
      socket.off('game:paused', onPaused);
      socket.off('game:resumed', onResumed);
      socket.off('game:win', onWin);
      socket.off('game:draw', onDraw);
      socket.off('game:dice-result' as any, onDiceResult);
      socket.off('room:dissolved', onDissolved);
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
        if (canWin(myHand, myMelds)) {
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

    if (gameState.phase === 'AWAITING' && gameState.currentPlayerIndex !== myIndex) {
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

  return { gameState, roomId, availableActions, gangOptions, remainingSeconds: showTimer ? remainingSeconds : 0, winResult, isDraw, diceResult, scoreLog };
}
