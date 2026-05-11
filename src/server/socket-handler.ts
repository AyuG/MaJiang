import type { Server, Socket } from 'socket.io';
import type { ClientEvents, ServerEvents, ClientGameState, RoomSyncData, SocketAuth } from '@/types';
import type { GameState } from '@/types';
import type { GameController } from '@/server/game-controller';
import type { RoomManager } from '@/server/room-manager';
import { TurnTimer } from '@/server/turn-timer';
import { canPeng as checkCanPeng, canMingGang as checkCanMingGang } from '@/engine/meld-actions';
import { logger } from '@/server/logger';

interface SocketMapping {
  roomId: string;
  playerId: string;
}

export function toClientState(state: GameState, playerId: string): ClientGameState {
  const myIndex = state.players.findIndex((p) => p.id === playerId);
  const myHand = myIndex >= 0 ? state.players[myIndex].hand : [];

  // Determine which players are in auto-pilot (disconnected + timeout)
  const autoPlayPlayerIds = [
    ...state.players.filter((p) => !p.isConnected).map((p) => p.id),
    ...(state.timeoutAutoPlayerIds ?? []),
  ];
  // Deduplicate
  const uniqueAutoPlay = [...new Set(autoPlayPlayerIds)];

  return {
    phase: state.phase,
    roomId: state.roomId,
    currentPlayerIndex: state.currentPlayerIndex,
    dealerIndex: state.dealerIndex,
    turnCount: state.turnCount,
    roundNumber: state.roundNumber ?? 1,
    wallCount: state.wall.length,
    myHand,
    players: state.players.map((p) => ({
      id: p.id,
      meldCount: p.melds.length,
      melds: p.melds,
      discardPool: p.discardPool,
      score: p.score,
      isConnected: p.isConnected,
      handCount: p.hand.length,
    })),
    lastDiscard: state.lastDiscard,
    lastDrawnTileId: state.lastDrawnTileId ?? null,
    isPaused: state.isPaused,
    autoPlayPlayerIds: uniqueAutoPlay,
  };
}

export function setupSocketHandlers(
  io: Server<ClientEvents, ServerEvents>,
  gameController: GameController,
  roomManager: RoomManager,
): void {
  const socketMap = new Map<string, SocketMapping>();
  const roundCounters = new Map<string, number>();

  // Create TurnTimer with callback that uses broadcastGameState
  const turnTimer = new TurnTimer(async (roomId, playerId, phase) => {
    try {
      const state = await gameController.handleTimeout(roomId, playerId, phase);
      await broadcastGameState(io, socketMap, roomId, state, turnTimer, handleRoundEnd, handleAutoPlay);
    } catch (err) {
      logger.error('TurnTimer', 'Timeout handling failed', err);
    }
  });

  /** Auto-play for disconnected/timeout players — called from broadcastGameState */
  async function handleAutoPlay(roomId: string, playerId: string, phase: GameState['phase']) {
    try {
      const autoState = await gameController.handleTimeout(roomId, playerId, phase);
      await broadcastGameState(io, socketMap, roomId, autoState, turnTimer, handleRoundEnd, handleAutoPlay);
    } catch (err) {
      logger.error('handleAutoPlay', 'Auto-play failed', err);
    }
  }

  /** Helper: dissolve room and emit score history */
  async function dissolveWithScores(roomId: string) {
    turnTimer.clear(roomId);
    roundCounters.delete(roomId);

    let scoreHistory: unknown[] = [];
    try {
      const log = await gameController['redisStore'].getScoreLog(roomId);
      const SEATS = ['东', '南', '西', '北'];
      scoreHistory = log.map((entry) => ({
        round: entry.round,
        result: entry.result,
        scores: entry.scores.map((s, i) => ({ seat: SEATS[i] ?? '?', delta: s.delta })),
      }));
    } catch (err) {
      logger.warn('dissolveWithScores', 'Failed to fetch score log', err);
    }

    const history = scoreHistory.length > 0 ? scoreHistory as Array<{ round: number; result: string; scores: Array<{ seat: string; delta: number }> }> : undefined;
    io.to(roomId).emit('room:dissolved', history);
    for (const [sid, m] of socketMap.entries()) {
      if (m.roomId === roomId) {
        const s = io.sockets.sockets.get(sid);
        if (s) s.leave(roomId);
        socketMap.delete(sid);
      }
    }
  }

  /** After broadcasting a WIN/DRAW state, schedule auto-new-round */
  async function handleRoundEnd(roomId: string, state: GameState) {
    const round = (roundCounters.get(roomId) ?? 0) + 1;
    roundCounters.set(roomId, round);

    // Wait 5 seconds to let players see the result
    setTimeout(async () => {
      try {
        const { canContinue, newState } = await gameController.finalizeRound(roomId, state, round);

        if (canContinue && newState) {
          // Broadcast new round start
          const sockets = await io.in(roomId).fetchSockets();
          for (const s of sockets) {
            const m = socketMap.get(s.id);
            if (m) {
              s.emit('game:started', toClientState(newState, m.playerId));
            }
          }
          // Start turn timer for the new dealer
          if (turnTimer && newState.phase === 'TURN') {
            const currentPlayer = newState.players[newState.currentPlayerIndex];
            if (currentPlayer) {
              turnTimer.startTurnTimer(roomId, currentPlayer.id);
            }
          }
        } else {
          // Disconnected players → dissolve back to lobby
          await dissolveWithScores(roomId);
        }
      } catch (err) {
        logger.error('handleRoundEnd', 'Failed to start new round', err);
        io.to(roomId).emit('room:dissolved');
      }
    }, 5000);
  }

  /** Broadcast room sync to all sockets in a room */
  function broadcastRoomSync(roomId: string) {
    const room = roomManager.getRoom(roomId);
    if (room) {
      const syncData: RoomSyncData = {
        roomId: room.roomId,
        ownerId: room.ownerId,
        players: room.players.map((p) => ({
          id: p.id,
          seat: p.seat,
          isReady: p.isReady,
          isConnected: p.isConnected,
          nickname: nicknameMap.get(p.id),
        })),
      };
      io.to(roomId).emit('room:sync', syncData);
    }
  }

  // Nickname storage: playerId → nickname
  const nicknameMap = new Map<string, string>();

  /** Force-remove a player from any room they're currently in */
  function cleanupPlayerFromOldRoom(playerId: string, currentSocketId: string) {
    for (const [sid, m] of socketMap.entries()) {
      if (m.playerId === playerId && sid !== currentSocketId) {
        const room = roomManager.getRoom(m.roomId);
        if (room && room.status === 'waiting') {
          roomManager.leaveRoom(m.roomId, playerId);
          broadcastRoomSync(m.roomId);
        }
        const s = io.sockets.sockets.get(sid);
        if (s) s.leave(m.roomId);
        socketMap.delete(sid);
      }
    }
  }

  io.on('connection', (socket: Socket<ClientEvents, ServerEvents>) => {

    const auth = socket.handshake.auth as SocketAuth;
    const persistentId = auth?.playerId || socket.id;
    const persistentNickname = auth?.nickname || persistentId.slice(0, 8);

    // Always update nickname from client (supports nickname change on reconnect)
    if (persistentNickname) {
      nicknameMap.set(persistentId, persistentNickname);
    }

    // ── Force cleanup: if this player has a stale socket mapping, remove it ──
    for (const [oldSid, m] of socketMap.entries()) {
      if (m.playerId === persistentId && oldSid !== socket.id) {
        socketMap.delete(oldSid);
      }
    }

    // ── Nickname change ──
    socket.on('room:change-nickname', (name: string) => {
      if (typeof name === 'string' && /^[a-zA-Z0-9\u4e00-\u9fa5]{1,8}$/.test(name)) {
        nicknameMap.set(persistentId, name);
        // Broadcast updated sync if in a room
        const mapping = socketMap.get(socket.id);
        if (mapping) broadcastRoomSync(mapping.roomId);
      }
    });

    // ── Room: create ─────────────────────────────────
    socket.on('room:create', () => {
      const playerId = persistentId;

      // Force leave any existing room first
      cleanupPlayerFromOldRoom(playerId, socket.id);

      const roomId = roomManager.createRoom(playerId);
      roomManager.setReady(roomId, playerId);
      socketMap.set(socket.id, { roomId, playerId });
      socket.join(roomId);
      socket.emit('room:created', roomId);
      broadcastRoomSync(roomId);
    });

    // ── Room: join ───────────────────────────────────
    socket.on('room:join', async (roomId: string) => {
      const playerId = persistentId;

      // Force leave any existing room first
      cleanupPlayerFromOldRoom(playerId, socket.id);

      const room = roomManager.getRoom(roomId);

      if (!room) {
        socket.emit('room:error', '房间不存在');
        return;
      }

      // Check if this player is already a member (reconnecting with same persistent ID)
      if (room.status === 'playing') {
        // First: check if this exact playerId exists in the room (true reconnect)
        const ownSeat = room.players.find((p) => p.id === playerId);
        if (ownSeat) {
          // True reconnect — same persistent ID
          ownSeat.isConnected = true;
          socketMap.set(socket.id, { roomId, playerId });
          socket.join(roomId);

          try {
            const state = await gameController.handleReconnect(roomId, playerId);
            const patchedState: GameState = {
              ...state,
              players: state.players.map((p) =>
                p.id === playerId ? { ...p, isConnected: true } : p,
              ),
              timeoutAutoPlayerIds: (state.timeoutAutoPlayerIds ?? []).filter((id) => id !== playerId),
            };
            await gameController['redisStore'].saveGameState(roomId, patchedState);
            socket.emit('game:started', toClientState(patchedState, playerId));
            await broadcastGameState(io, socketMap, roomId, patchedState, turnTimer, handleRoundEnd, handleAutoPlay);
          } catch (err) {
            logger.error('room:join', 'Reconnect failed', err);
          }
          return;
        }

        // Second: check for any disconnected seat to substitute into
        const disconnectedPlayer = room.players.find((p) => !p.isConnected);
        if (!disconnectedPlayer) {
          socket.emit('room:error', '房间已满，游戏进行中');
          return;
        }

        const oldPlayerId = disconnectedPlayer.id;
        disconnectedPlayer.id = playerId;
        disconnectedPlayer.isConnected = true;

        socketMap.set(socket.id, { roomId, playerId });
        socket.join(roomId);

        // Update game state: replace old player ID with new one
        try {
          const state = await gameController.handleReconnect(roomId, oldPlayerId);
          // Patch the player ID in the game state
          const patchedState: GameState = {
            ...state,
            players: state.players.map((p) =>
              p.id === oldPlayerId ? { ...p, id: playerId, isConnected: true } : p,
            ),
            timeoutAutoPlayerIds: (state.timeoutAutoPlayerIds ?? []).filter((id) => id !== oldPlayerId),
          };
          // Fix lastDiscard playerIndex reference if needed (index-based, no ID change needed)
          await gameController['redisStore'].saveGameState(roomId, patchedState);

          // Send current game state to the reconnected player
          socket.emit('game:started', toClientState(patchedState, playerId));
          // Broadcast updated state to all
          await broadcastGameState(io, socketMap, roomId, patchedState, turnTimer, handleRoundEnd, handleAutoPlay);
        } catch (err) {
          logger.error('room:join', 'Substitute reconnect failed', err);
        }
        return;
      }

      // Normal join (waiting room)
      try {
        // If room is full but has a disconnected player in waiting, substitute them
        if (room.players.length >= 4) {
          const disconnectedPlayer = room.players.find((p) => !p.isConnected);
          if (disconnectedPlayer) {
            disconnectedPlayer.id = playerId;
            disconnectedPlayer.isConnected = true;
            disconnectedPlayer.isReady = true;
            socketMap.set(socket.id, { roomId, playerId });
            socket.join(roomId);
            broadcastRoomSync(roomId);
            return;
          }
        }
        roomManager.joinRoom(roomId, playerId);
        roomManager.setReady(roomId, playerId); // auto-ready on join
        socketMap.set(socket.id, { roomId, playerId });
        socket.join(roomId);
        io.to(roomId).emit('room:joined', { id: playerId, seat: room.players.length - 1 });
        broadcastRoomSync(roomId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '加入房间失败';
        socket.emit('room:error', message);
      }
    });

    // ── Room: ready ──────────────────────────────────
    socket.on('room:ready', async () => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      const { roomId, playerId } = mapping;
      try {
        roomManager.setReady(roomId, playerId);
        io.to(roomId).emit('room:player-ready', playerId);
        broadcastRoomSync(roomId);
      } catch (err) {
        logger.warn('room:ready', 'Failed to set ready', err);
      }
    });

    // ── Room: unready ────────────────────────────────
    socket.on('room:unready', () => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      const { roomId, playerId } = mapping;
      try {
        roomManager.setUnready(roomId, playerId);
        io.to(roomId).emit('room:player-unready', playerId);
        broadcastRoomSync(roomId);
      } catch (err) {
        logger.warn('room:unready', 'Failed to set unready', err);
      }
    });

    // ── Room: start (owner only, all 4 must be ready) ─
    socket.on('room:start', async () => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      const { roomId, playerId } = mapping;
      try {
        const room = roomManager.getRoom(roomId);
        if (!room) return;
        if (room.ownerId !== playerId) return; // only owner
        if (room.players.length !== 4) return;
        if (!room.players.every((p) => p.isReady)) return;

        // Roll dice to determine dealer
        const diceResult = roomManager.rollDice(roomId);
        io.to(roomId).emit('game:dice-result', {
          rolls: diceResult.rolls,
          dealerIndex: diceResult.dealerIndex,
        });

        // Wait 3 seconds for dice animation, then start game
        setTimeout(async () => {
          try {
            const state = await gameController.startGame(roomId);
            const sockets = await io.in(roomId).fetchSockets();
            for (const s of sockets) {
              const m = socketMap.get(s.id);
              if (m) {
                s.emit('game:started', toClientState(state, m.playerId));
              }
            }

            if (turnTimer && state.phase === 'TURN') {
              const currentPlayer = state.players[state.currentPlayerIndex];
              if (currentPlayer) {
                turnTimer.startTurnTimer(roomId, currentPlayer.id);
              }
            }
          } catch (err) {
            logger.error('room:start', 'Failed to start game after dice', err);
          }
        }, 3000);
      } catch (err) {
        logger.warn('room:start', 'Failed to start game', err);
      }
    });

    // ── Room: kick (owner only) ──────────────────────
    socket.on('room:kick', (targetId: string) => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      const { roomId, playerId } = mapping;
      try {
        roomManager.kickPlayer(roomId, playerId, targetId);
        io.to(roomId).emit('room:kicked', targetId);
        // Remove kicked player's socket mapping and leave room
        for (const [sid, m] of socketMap.entries()) {
          if (m.roomId === roomId && m.playerId === targetId) {
            const kickedSocket = io.sockets.sockets.get(sid);
            if (kickedSocket) {
              kickedSocket.leave(roomId);
            }
            socketMap.delete(sid);
            break;
          }
        }
        broadcastRoomSync(roomId);
      } catch (err) {
        logger.warn('room:kick', 'Kick failed (not owner or target not found)', err);
      }
    });

    // ── Room: dissolve (owner only) ──────────────────
    socket.on('room:dissolve', () => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      const { roomId, playerId } = mapping;
      try {
        roomManager.dissolveRoom(roomId, playerId);
        io.to(roomId).emit('room:dissolved');
        // Clean up all socket mappings for this room
        for (const [sid, m] of socketMap.entries()) {
          if (m.roomId === roomId) {
            const s = io.sockets.sockets.get(sid);
            if (s) s.leave(roomId);
            socketMap.delete(sid);
          }
        }
      } catch (err) {
        logger.warn('room:dissolve', 'Dissolve failed (not owner)', err);
      }
    });

    // ── New game: copy players to new room, keep seats ─
    socket.on('room:new-game', async () => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      const oldRoomId = mapping.roomId;
      const room = roomManager.getRoom(oldRoomId);
      if (!room) return;
      if (room.players.length < 2) return;

      // Build player list preserving seats
      const playersToCopy = room.players.map((p) => ({ id: p.id, seat: p.seat }));

      // Create new room with same players
      const newRoomId = roomManager.createRoomWithPlayers(playersToCopy);

      // Set all players ready in new room
      for (const p of playersToCopy) {
        try { roomManager.setReady(newRoomId, p.id); } catch { /* ignore */ }
      }

      // Dissolve old room
      await dissolveWithScores(oldRoomId);

      // Move all sockets to new room
      const newRoomSockets: Array<{ sid: string; pid: string }> = [];
      for (const [sid, m] of socketMap.entries()) {
        if (m.roomId === oldRoomId) {
          // Don't move yet — oldRoomId still active, need to update mapping
          newRoomSockets.push({ sid, pid: m.playerId });
        }
      }

      // Update socket mappings and join new room
      for (const { sid, pid } of newRoomSockets) {
        socketMap.set(sid, { roomId: newRoomId, playerId: pid });
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.leave(oldRoomId);
          s.join(newRoomId);
        }
      }

      // Broadcast sync to all in new room
      broadcastRoomSync(newRoomId);

      // Notify initiator (room:new-game-created) and broadcast sync
      io.to(newRoomId).emit('room:new-game-created', newRoomId);
    });

    // ── Game actions ─────────────────────────────────
    socket.on('game:discard', async (tileId: number) => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      try {
        const state = await gameController.handlePlayerAction(mapping.roomId, mapping.playerId, { type: 'discard', tileId });
        await broadcastGameState(io, socketMap, mapping.roomId, state, turnTimer, handleRoundEnd, handleAutoPlay);
      } catch (err) {
        logger.warn('game:discard', 'Invalid discard action', err);
      }
    });

    socket.on('game:peng', async () => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      try {
        const state = await gameController.handlePlayerAction(mapping.roomId, mapping.playerId, { type: 'peng' });
        await broadcastGameState(io, socketMap, mapping.roomId, state, turnTimer, handleRoundEnd, handleAutoPlay);
      } catch (err) {
        logger.warn('game:peng', 'Invalid peng action', err);
      }
    });

    socket.on('game:gang', async (type: 'ming' | 'an' | 'bu', tileId?: number) => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      try {
        const action = type === 'ming'
          ? { type: 'ming_gang' as const }
          : type === 'an'
            ? { type: 'an_gang' as const, tileId: tileId! }
            : { type: 'bu_gang' as const, tileId: tileId! };
        const state = await gameController.handlePlayerAction(mapping.roomId, mapping.playerId, action);
        await broadcastGameState(io, socketMap, mapping.roomId, state, turnTimer, handleRoundEnd, handleAutoPlay);
      } catch (err) {
        logger.warn('game:gang', 'Invalid gang action', err);
      }
    });

    socket.on('game:hu', async () => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      try {
        const state = await gameController.handlePlayerAction(mapping.roomId, mapping.playerId, { type: 'hu' });
        await broadcastGameState(io, socketMap, mapping.roomId, state, turnTimer, handleRoundEnd, handleAutoPlay);
      } catch (err) {
        logger.warn('game:hu', 'Invalid hu action', err);
      }
    });

    socket.on('game:pass', async () => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      try {
        const state = await gameController.handlePlayerAction(mapping.roomId, mapping.playerId, { type: 'pass' });
        await broadcastGameState(io, socketMap, mapping.roomId, state, turnTimer, handleRoundEnd, handleAutoPlay);
      } catch (err) {
        logger.warn('game:pass', 'Invalid pass action', err);
      }
    });

    // ── Vote dissolve ────────────────────────────────

    socket.on('room:vote-dissolve', async () => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      try {
        roomManager.initiateVoteDissolve(mapping.roomId, mapping.playerId);

        const room = roomManager.getRoom(mapping.roomId);
        if (room) {
          const voteResult = roomManager.checkVoteResolved(mapping.roomId);
          if (voteResult && voteResult.dissolved) {
            await dissolveWithScores(mapping.roomId);
            return;
          }
        }

        io.to(mapping.roomId).emit('room:vote-dissolve-request', mapping.playerId);
      } catch (err) {
        logger.warn('room:vote-dissolve', 'Vote dissolve failed', err);
      }
    });

    socket.on('room:vote-dissolve-reply', async (agree: boolean) => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      try {
        const result = roomManager.voteDissolve(mapping.roomId, mapping.playerId, agree);
        if (result.dissolved) {
          await dissolveWithScores(mapping.roomId);
        } else if (!agree) {
          // Someone rejected — notify all to close vote dialog
          io.to(mapping.roomId).emit('room:vote-dissolve-rejected');
        }
      } catch (err) {
        logger.warn('room:vote-dissolve-reply', 'Vote reply failed', err);
      }
    });

    // ── Disconnect ───────────────────────────────────
    socket.on('disconnect', async () => {
      const mapping = socketMap.get(socket.id);
      if (!mapping) return;
      const { roomId, playerId } = mapping;
      socketMap.delete(socket.id);

      const room = roomManager.getRoom(roomId);
      if (!room) return;

      if (room.status === 'waiting') {
        // In lobby: mark disconnected, broadcast, then remove after 10s
        roomManager.setPlayerDisconnected(roomId, playerId);
        broadcastRoomSync(roomId);
        setTimeout(() => {
          const r = roomManager.getRoom(roomId);
          if (!r) return;
          const p = r.players.find((pl) => pl.id === playerId);
          if (p && !p.isConnected) {
            roomManager.removeDisconnectedPlayer(roomId, playerId);
            broadcastRoomSync(roomId);
          }
        }, 10_000);
      } else if (room.status === 'playing') {
        // In game: mark disconnected in both RoomManager and GameState
        roomManager.setPlayerDisconnected(roomId, playerId);
        try {
          const state = await gameController.handleDisconnect(roomId, playerId);
          // If it's the disconnected player's turn, auto-play immediately
          if (state.phase === 'TURN' && state.players[state.currentPlayerIndex]?.id === playerId) {
            const autoState = await gameController.handleTimeout(roomId, playerId, 'TURN');
            await broadcastGameState(io, socketMap, roomId, autoState, turnTimer, handleRoundEnd, handleAutoPlay);
          } else if (state.phase === 'AWAITING') {
            // Auto-pass for disconnected player
            const autoState = await gameController.handleTimeout(roomId, playerId, 'AWAITING');
            await broadcastGameState(io, socketMap, roomId, autoState, turnTimer, handleRoundEnd, handleAutoPlay);
          } else {
            // Not their turn — just broadcast the disconnect status
            await broadcastGameState(io, socketMap, roomId, state, turnTimer, handleRoundEnd, handleAutoPlay);
          }
        } catch (err) {
          logger.error('disconnect', 'Failed to handle disconnect during game', err);
        }
      }
    });
  });
}

async function broadcastGameState(
  io: Server<ClientEvents, ServerEvents>,
  socketMap: Map<string, SocketMapping>,
  roomId: string,
  state: GameState,
  turnTimer?: TurnTimer,
  onRoundEnd?: (roomId: string, state: GameState) => void,
  onAutoPlay?: (roomId: string, playerId: string, phase: GameState['phase']) => Promise<void>,
): Promise<void> {
  const sockets = await io.in(roomId).fetchSockets();
  for (const s of sockets) {
    const m = socketMap.get(s.id);
    if (m) {
      s.emit('game:state-update', toClientState(state, m.playerId));
    }
  }

  // Manage turn timer based on new phase
  if (state.phase === 'TURN') {
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (currentPlayer) {
      if (!currentPlayer.isConnected) {
        // Disconnected player: auto-play immediately, no timer
        if (turnTimer) turnTimer.clear(roomId);
        if (onAutoPlay) {
          // Small delay to avoid synchronous recursion
          setTimeout(() => onAutoPlay(roomId, currentPlayer.id, 'TURN'), 100);
        }
      } else if ((state.timeoutAutoPlayerIds ?? []).includes(currentPlayer.id)) {
        // Timeout-auto player: also auto-play immediately
        if (turnTimer) turnTimer.clear(roomId);
        if (onAutoPlay) {
          setTimeout(() => onAutoPlay(roomId, currentPlayer.id, 'TURN'), 100);
        }
      } else {
        // Normal player: start timer
        if (turnTimer) turnTimer.startTurnTimer(roomId, currentPlayer.id);
      }
    }
  } else if (state.phase === 'AWAITING') {
    // Check if any responding player is disconnected → auto-pass immediately
    const discardPlayerIdx = state.lastDiscard?.playerIndex ?? -1;
    let hasDisconnectedResponder = false;
    if (state.lastDiscard) {
      for (let i = 0; i < 4; i++) {
        if (i === discardPlayerIdx) continue;
        const p = state.players[i];
        if (!p.isConnected) {
          if (checkCanPeng(p.hand, state.lastDiscard.tile) || checkCanMingGang(p.hand, state.lastDiscard.tile)) {
            hasDisconnectedResponder = true;
            break;
          }
        }
      }
    }

    if (hasDisconnectedResponder && onAutoPlay) {
      // Disconnected player can respond → auto-pass immediately
      if (turnTimer) turnTimer.clear(roomId);
      setTimeout(() => onAutoPlay(roomId, '', 'AWAITING'), 100);
    } else if (turnTimer) {
      const playerId = state.lastDiscard?.playerIndex !== undefined
        ? state.players[state.lastDiscard.playerIndex]?.id ?? ''
        : '';
      turnTimer.startAwaitingTimer(roomId, playerId);
    }
  } else if (state.phase === 'WIN' || state.phase === 'DRAW') {
    if (turnTimer) turnTimer.clear(roomId);
    if (onRoundEnd) onRoundEnd(roomId, state);
  }
}
