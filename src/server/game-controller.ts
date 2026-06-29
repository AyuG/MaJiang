import type { GameState, GameAction, GamePhase } from '@/types';
import type { MockWallConfig } from '@/engine/mock-wall';
import type { RoomManager } from '@/server/room-manager';
import type { RedisStore } from '@/store/redis-store';
import { createTileSet, shuffle } from '@/engine/tile-set';
import { applyMockWall } from '@/engine/mock-wall';
import { transition, getValidActionsForPlayer } from '@/engine/state-machine';
import { logger } from '@/server/logger';

/**
 * GameController — orchestrates game lifecycle, delegates to the
 * engine's pure state-machine, and persists every transition to Redis.
 */
export class GameController {
  constructor(
    private roomManager: RoomManager,
    private redisStore: RedisStore,
    private mockWallConfig?: MockWallConfig | null,
  ) {}

  /**
   * Start a new game for the given room.
   * Creates initial GameState, deals tiles, saves to Redis.
   */
  async startGame(roomId: string): Promise<GameState> {
    const room = this.roomManager.getRoom(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    if (room.players.length !== 4) throw new Error('Need exactly 4 players to start');

    // Mark room as playing
    room.status = 'playing';

    const seed = Date.now();
    const tiles = createTileSet();
    let wall = shuffle(tiles, seed);
    wall = applyMockWall(wall, this.mockWallConfig ?? null);

    const initialState: GameState = {
      phase: 'DEALING',
      roomId,
      players: room.players.map((p) => ({
        id: p.id,
        hand: [],
        melds: [],
        discardPool: [],
        score: 0,
        isConnected: true,
        isReady: true,
      })),
      wall,
      currentPlayerIndex: room.dealerIndex,
      dealerIndex: room.dealerIndex,
      seed,
      lastDiscard: null,
      turnCount: 0,
      roundNumber: 1,
      consecutiveGangCount: 0,
      gangRecords: [],
      isPaused: false,
      actionLog: [],
      lastDrawnTileId: null,
      dealerFirstDiscard: null,
      dealerFirstMatchCount: 0,
      timeoutAutoPlayerIds: [],
      consecutiveAutoPlayCount: 0,
      pendingResponses: [],
      passedPlayerIds: [],
    };

    // Deal
    const dealtState = transition(initialState, { type: 'deal' });
    await this.redisStore.saveGameState(roomId, dealtState);
    return dealtState;
  }

  /**
   * Handle a player action (discard, peng, gang, hu, pass, draw).
   * Validates the action, transitions state, persists to Redis.
   */
  async handlePlayerAction(
    roomId: string,
    playerId: string,
    action: GameAction,
  ): Promise<GameState> {
    const state = await this.redisStore.getGameState(roomId);
    if (!state) throw new Error(`No game state for room ${roomId}`);

    // Validate the action is legal
    const validActions = getValidActionsForPlayer(state, playerId);
    const isValid = validActions.some((a) => {
      if (a.type !== action.type) return false;
      if ('tileId' in a && 'tileId' in action) return a.tileId === action.tileId;
      return true;
    });

    if (!isValid) {
      throw new Error(`Invalid action: ${action.type}`);
    }

    const actorAction = attachActorToAction(action, playerId);
    let newState = transition(state, actorAction);

    // Reset consecutive auto-play count on any manual action
    if (newState.consecutiveAutoPlayCount !== 0) {
      newState = { ...newState, consecutiveAutoPlayCount: 0 };
    }

    // Cancel timeout auto-play for this player on manual action
    if (newState.timeoutAutoPlayerIds?.includes(playerId)) {
      newState = {
        ...newState,
        timeoutAutoPlayerIds: newState.timeoutAutoPlayerIds.filter((id) => id !== playerId),
      };
    }

    await this.redisStore.saveGameState(roomId, newState);
    return newState;
  }

  /**
   * Handle timeout for a player (smart auto-play).
   * TURN timeout → check hu first, then auto draw + smart discard.
   * AWAITING timeout → auto pass.
   * @param roomId - Room ID
   * @param playerId - Player ID (used for logging/debugging, actual player determined by current turn)
   * @param phase - Current game phase
   */
  async handleTimeout(
    roomId: string,
    playerId: string,
    phase: GamePhase,
  ): Promise<GameState> {
    const state = await this.redisStore.getGameState(roomId);
    if (!state) throw new Error(`No game state for room ${roomId}`);

    // If state phase no longer matches, this timeout is stale — return current state
    if (state.phase !== phase) {
      return state;
    }

    let newState = state;

    if (phase === 'TURN') {
      const pi = state.currentPlayerIndex;
      const player = state.players[pi];

      // Log for debugging: verify the timeout player matches current player
      if (playerId && player.id !== playerId) {
        logger.warn('handleTimeout', `Timeout player ${playerId} does not match current player ${player.id}`);
      }

      // Increment consecutive auto-play count
      const newAutoPlayCount = (state.consecutiveAutoPlayCount ?? 0) + 1;
      newState = { ...newState, consecutiveAutoPlayCount: newAutoPlayCount };

      // Mark player as timeout auto-play (only if connected — disconnected players are already tracked)
      if (player.isConnected) {
        const timeoutIds = new Set(state.timeoutAutoPlayerIds ?? []);
        timeoutIds.add(player.id);
        newState = { ...newState, timeoutAutoPlayerIds: [...timeoutIds] };
      }

      const expectedHand = 14 - player.melds.length * 3;

      if (player.hand.length < expectedHand && state.wall.length > 0) {
        newState = transition(newState, { type: 'draw' });
      }

      // Check if can hu — auto-hu takes priority over discard
      const currentPlayer = newState.players[newState.currentPlayerIndex];
      const validActions = getValidActionsForPlayer(newState, currentPlayer.id);
      const canHu = validActions.some((a) => a.type === 'hu');
      if (canHu) {
        newState = transition(newState, { type: 'hu' });
      } else if (currentPlayer.hand.length > 0) {
        // Smart discard: pick the most isolated tile
        const tileToDiscard = pickSmartDiscard(currentPlayer.hand);
        newState = transition(newState, { type: 'discard', tileId: tileToDiscard.id });
      }

      // After auto-play completes, remove from timeout list (one-shot)
      // Next turn they get a fresh 30s timer
      if (player.isConnected) {
        newState = {
          ...newState,
          timeoutAutoPlayerIds: (newState.timeoutAutoPlayerIds ?? []).filter((id) => id !== player.id),
        };
      }
    } else if (phase === 'AWAITING') {
      const pendingIds = state.players
        .filter((p) => getValidActionsForPlayer(state, p.id).some((a) => a.type === 'pass'))
        .map((p) => p.id);
      const passIds = pendingIds.includes(playerId) ? [playerId] : pendingIds;

      for (const passId of passIds) {
        if (newState.phase !== 'AWAITING') break;
        newState = transition(newState, { type: 'pass', playerId: passId });
      }
    }

    await this.redisStore.saveGameState(roomId, newState);
    return newState;
  }

  /**
   * Handle player disconnect — mark as disconnected.
   * Game continues with smart auto-play for disconnected players.
   */
  async handleDisconnect(roomId: string, playerId: string): Promise<GameState> {
    const state = await this.redisStore.getGameState(roomId);
    if (!state) throw new Error(`No game state for room ${roomId}`);

    const newState: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === playerId ? { ...p, isConnected: false } : { ...p },
      ),
    };

    await this.redisStore.saveGameState(roomId, newState);
    return newState;
  }

  /**
   * Handle player reconnect — set isConnected=true,
   * set isPaused=false if all players are connected.
   */
  async handleReconnect(roomId: string, playerId: string): Promise<GameState> {
    const state = await this.redisStore.getGameState(roomId);
    if (!state) throw new Error(`No game state for room ${roomId}`);

    const players = state.players.map((p) =>
      p.id === playerId ? { ...p, isConnected: true } : { ...p },
    );

    const allConnected = players.every((p) => p.isConnected);

    const newState: GameState = {
      ...state,
      players,
      isPaused: !allConnected,
    };

    await this.redisStore.saveGameState(roomId, newState);
    return newState;
  }

  /**
   * Log the score for a completed round and check if a new round can start.
   * Returns { canContinue, state } where canContinue=false means
   * disconnected players exist → should return to lobby.
   */
  async finalizeRound(
    roomId: string,
    state: GameState,
    roundNumber: number,
  ): Promise<{ canContinue: boolean; newState?: GameState }> {
    // Determine winner
    const isWin = state.phase === 'WIN';
    let winnerId: string | undefined;
    let winnerIndex: number | null = null;

    if (isWin) {
      // The winner is the current player who declared hu
      winnerIndex = state.currentPlayerIndex;
      winnerId = state.players[winnerIndex]?.id;
    }

    // Log score to Redis
    await this.redisStore.appendScoreLog(roomId, {
      round: roundNumber,
      timestamp: Date.now(),
      result: isWin ? 'win' : 'draw',
      winnerId,
      scores: state.players.map((p) => ({
        playerId: p.id,
        delta: p.score,
        total: p.score, // cumulative will be tracked across rounds by the log
      })),
    });

    // Check if all players are connected
    const allConnected = state.players.every((p) => p.isConnected);
    if (!allConnected) {
      return { canContinue: false };
    }

    // Update dealer for next round
    this.roomManager.setNextDealer(roomId, winnerIndex);

    // Start new round — preserve cumulative scores
    const room = this.roomManager.getRoom(roomId);
    if (!room || room.players.length !== 4) {
      return { canContinue: false };
    }

    const prevScores = new Map<string, number>();
    for (const p of state.players) {
      prevScores.set(p.id, p.score);
    }

    const newState = await this.startGameWithScores(roomId, prevScores, roundNumber + 1);
    return { canContinue: true, newState };
  }

  /**
   * Start a new game round, carrying over cumulative scores from previous rounds.
   */
  private async startGameWithScores(
    roomId: string,
    prevScores: Map<string, number>,
    roundNumber: number = 1,
  ): Promise<GameState> {
    const room = this.roomManager.getRoom(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    if (room.players.length !== 4) throw new Error('Need exactly 4 players');

    room.status = 'playing';

    const seed = Date.now();
    const tiles = createTileSet();
    let wall = shuffle(tiles, seed);
    wall = applyMockWall(wall, this.mockWallConfig ?? null);

    const initialState: GameState = {
      phase: 'DEALING',
      roomId,
      players: room.players.map((p) => ({
        id: p.id,
        hand: [],
        melds: [],
        discardPool: [],
        score: prevScores.get(p.id) ?? 0,
        isConnected: true,
        isReady: true,
      })),
      wall,
      currentPlayerIndex: room.dealerIndex,
      dealerIndex: room.dealerIndex,
      seed,
      lastDiscard: null,
      turnCount: 0,
      roundNumber,
      consecutiveGangCount: 0,
      gangRecords: [],
      isPaused: false,
      actionLog: [],
      lastDrawnTileId: null,
      dealerFirstDiscard: null,
      dealerFirstMatchCount: 0,
      timeoutAutoPlayerIds: [],
      consecutiveAutoPlayCount: 0,
      pendingResponses: [],
      passedPlayerIds: [],
    };

    const dealtState = transition(initialState, { type: 'deal' });
    await this.redisStore.saveGameState(roomId, dealtState);
    return dealtState;
  }
}

function attachActorToAction(action: GameAction, playerId: string): GameAction {
  if (action.type === 'peng' || action.type === 'ming_gang' || action.type === 'pass') {
    return { ...action, playerId };
  }
  return action;
}

/**
 * Smart discard: pick the most "isolated" tile — one that has the fewest
 * neighbors (same suit ±1 value) or duplicates. Feng/zi tiles with no
 * pairs are preferred for discard.
 */
function pickSmartDiscard(hand: import('@/types').Tile[]): import('@/types').Tile {
  let bestTile = hand[hand.length - 1]; // fallback: last drawn
  let bestScore = Infinity;

  for (const tile of hand) {
    let score = 0;
    for (const other of hand) {
      if (other.id === tile.id) continue;
      if (other.suit === tile.suit && other.value === tile.value) {
        score += 10; // duplicate = very useful
      } else if (other.suit === tile.suit && Math.abs(other.value - tile.value) === 1) {
        score += 5; // adjacent = useful for sequences
      } else if (other.suit === tile.suit && Math.abs(other.value - tile.value) === 2) {
        score += 2; // gap of 2 = somewhat useful
      }
    }
    if (score < bestScore) {
      bestScore = score;
      bestTile = tile;
    }
  }

  return bestTile;
}
