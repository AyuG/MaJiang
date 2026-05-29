import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { RedisStore } from '@/store/redis-store';
import { RoomManager } from '@/server/room-manager';
import { GameController } from '@/server/game-controller';
import { createTileSet, shuffle } from '@/engine/tile-set';
import { applyMockWall } from '@/engine/mock-wall';
import { transition, getValidActions } from '@/engine/state-machine';
import { TileSuit } from '@/types';
import type { GameState, Tile, MockWallConfig } from '@/types';

/**
 * Helper: Find tiles by suit and value
 */
function findTiles(allTiles: Tile[], suit: TileSuit, value: number, count: number): Tile[] {
  const matches = allTiles.filter((t) => t.suit === suit && t.value === value);
  if (matches.length < count) {
    throw new Error(`Not enough tiles for ${suit}:${value}, need ${count} but found ${matches.length}`);
  }
  return matches.slice(0, count);
}

/**
 * Build a mock wall for testing peng/gang/hu scenarios
 * Player 0 (dealer): Can win with zi mo after one round
 * Player 1: Has a pair that can be peng'd if player 0 discards it
 */
function buildMockWallForPeng(): Tile[] {
  const allTiles = createTileSet();

  // Player 0 (dealer): 一万×3, 二万×3, 三万×3, 四万×2, 五万×2 = 13 tiles + 南风 for discard
  const p0Hand = [
    ...findTiles(allTiles, TileSuit.WAN, 1, 3),
    ...findTiles(allTiles, TileSuit.WAN, 2, 3),
    ...findTiles(allTiles, TileSuit.WAN, 3, 3),
    ...findTiles(allTiles, TileSuit.WAN, 4, 2),
    ...findTiles(allTiles, TileSuit.WAN, 5, 2),
  ];
  const p0Extra = findTiles(allTiles, TileSuit.FENG, 2, 1); // 南风 - will discard

  // Player 1: Has 二万×2 (can peng if P0 discards 二万)
  const p1Hand = [
    ...findTiles(allTiles, TileSuit.TIAO, 1, 3),
    ...findTiles(allTiles, TileSuit.TIAO, 2, 3),
    ...findTiles(allTiles, TileSuit.TIAO, 3, 3),
    ...findTiles(allTiles, TileSuit.WAN, 2, 2), // This pair can peng
    ...findTiles(allTiles, TileSuit.TIAO, 4, 2),
  ];

  // Player 2: Random hand
  const p2Hand = [
    ...findTiles(allTiles, TileSuit.TONG, 1, 3),
    ...findTiles(allTiles, TileSuit.TONG, 2, 3),
    ...findTiles(allTiles, TileSuit.TONG, 3, 3),
    ...findTiles(allTiles, TileSuit.TONG, 4, 2),
    ...findTiles(allTiles, TileSuit.TONG, 5, 2),
  ];

  // Player 3: Random hand
  const p3Hand = [
    ...findTiles(allTiles, TileSuit.WAN, 6, 3),
    ...findTiles(allTiles, TileSuit.WAN, 7, 3),
    ...findTiles(allTiles, TileSuit.WAN, 8, 3),
    ...findTiles(allTiles, TileSuit.FENG, 1, 2),
    ...findTiles(allTiles, TileSuit.FENG, 3, 2),
  ];

  const usedIds = new Set([
    ...p0Hand.map((t) => t.id),
    ...p0Extra.map((t) => t.id),
    ...p1Hand.map((t) => t.id),
    ...p2Hand.map((t) => t.id),
    ...p3Hand.map((t) => t.id),
  ]);

  const remaining = allTiles.filter((t) => !usedIds.has(t.id));

  // P0 discards 二万, P1 can peng!
  const erWan = allTiles.filter((t) => t.suit === TileSuit.WAN && t.value === 2);
  const discardTile = erWan.find((t) => !usedIds.has(t.id))!;

  // Win tile for P0 (四万)
  const siWan = allTiles.filter((t) => t.suit === TileSuit.WAN && t.value === 4);
  const winTile = siWan.find((t) => !usedIds.has(t.id) && t.id !== discardTile.id)!;

  const otherRemaining = remaining.filter(
    (t) => t.id !== winTile.id && t.id !== discardTile.id,
  );

  return [
    ...p0Hand,
    ...p1Hand,
    ...p2Hand,
    ...p3Hand,
    ...p0Extra,
    discardTile, // P1 draws this after P0 discards
    winTile,
    ...otherRemaining,
  ];
}

describe('GameController Integration Tests', () => {
  let redisStore: RedisStore;
  let roomManager: RoomManager;
  let gameController: GameController;

  beforeEach(() => {
    const redisMock = new RedisMock();
    redisStore = new RedisStore(redisMock as unknown as Parameters<typeof RedisStore>[0]);
    roomManager = new RoomManager();
    gameController = new GameController(roomManager, redisStore);
  });

  afterEach(async () => {
    // Cleanup
  });

  describe('startGame', () => {
    it('should throw error if room not found', async () => {
      await expect(gameController.startGame('nonexistent')).rejects.toThrow('not found');
    });

    it('should throw error if not exactly 4 players', async () => {
      const roomId = roomManager.createRoom('p1');
      await expect(gameController.startGame(roomId)).rejects.toThrow('Need exactly 4 players');
    });

    it('should create initial game state with correct structure', async () => {
      const roomId = roomManager.createRoom('p1');
      roomManager.joinRoom(roomId, 'p2');
      roomManager.joinRoom(roomId, 'p3');
      roomManager.joinRoom(roomId, 'p4');
      roomManager.rollDice(roomId);

      const state = await gameController.startGame(roomId);

      expect(state.phase).toBe('TURN');
      expect(state.roomId).toBe(roomId);
      expect(state.players).toHaveLength(4);
      expect(state.wall.length).toBeGreaterThan(0);

      // Dealer should have 14 tiles
      const dealer = state.players[state.dealerIndex];
      expect(dealer.hand.length).toBe(14);

      // Others should have 13 tiles
      state.players.forEach((p, i) => {
        if (i !== state.dealerIndex) {
          expect(p.hand.length).toBe(13);
        }
      });
    });

    it('should mark room as playing after game starts', async () => {
      const roomId = roomManager.createRoom('p1');
      roomManager.joinRoom(roomId, 'p2');
      roomManager.joinRoom(roomId, 'p3');
      roomManager.joinRoom(roomId, 'p4');
      roomManager.rollDice(roomId);

      await gameController.startGame(roomId);

      const room = roomManager.getRoom(roomId);
      expect(room?.status).toBe('playing');
    });

    it('should persist game state to Redis', async () => {
      const roomId = roomManager.createRoom('p1');
      roomManager.joinRoom(roomId, 'p2');
      roomManager.joinRoom(roomId, 'p3');
      roomManager.joinRoom(roomId, 'p4');
      roomManager.rollDice(roomId);

      await gameController.startGame(roomId);

      const savedState = await redisStore.getGameState(roomId);
      expect(savedState).not.toBeNull();
      expect(savedState?.roomId).toBe(roomId);
    });
  });

  describe('handlePlayerAction', () => {
    let roomId: string;
    let initialState: GameState;

    beforeEach(async () => {
      roomId = roomManager.createRoom('p1');
      roomManager.joinRoom(roomId, 'p2');
      roomManager.joinRoom(roomId, 'p3');
      roomManager.joinRoom(roomId, 'p4');
      roomManager.rollDice(roomId);

      initialState = await gameController.startGame(roomId);
    });

    it('should throw error for invalid room', async () => {
      await expect(
        gameController.handlePlayerAction('nonexistent', 'p1', { type: 'discard', tileId: 0 }),
      ).rejects.toThrow('No game state');
    });

    it('should throw error for invalid action', async () => {
      // Try to hu when can't
      await expect(
        gameController.handlePlayerAction(roomId, 'p1', { type: 'hu' }),
      ).rejects.toThrow('Invalid action');
    });

    it('should handle discard action and update state', async () => {
      const dealerIndex = initialState.dealerIndex;
      const dealer = initialState.players[dealerIndex];
      const tileToDiscard = dealer.hand[0];

      const newState = await gameController.handlePlayerAction(
        roomId,
        dealer.id,
        { type: 'discard', tileId: tileToDiscard.id },
      );

      expect(newState.lastDiscard).not.toBeNull();
      expect(newState.lastDiscard?.tile.id).toBe(tileToDiscard.id);
      expect(newState.lastDiscard?.playerIndex).toBe(dealerIndex);
    });

    it('should reset consecutiveAutoPlayCount on manual action', async () => {
      // Manually set some auto-play count
      const stateWithCount: GameState = {
        ...initialState,
        consecutiveAutoPlayCount: 5,
      };
      await redisStore.saveGameState(roomId, stateWithCount);

      const dealerIndex = stateWithCount.dealerIndex;
      const dealer = stateWithCount.players[dealerIndex];
      const tileToDiscard = dealer.hand[0];

      const newState = await gameController.handlePlayerAction(
        roomId,
        dealer.id,
        { type: 'discard', tileId: tileToDiscard.id },
      );

      expect(newState.consecutiveAutoPlayCount).toBe(0);
    });
  });

  describe('handleTimeout', () => {
    let roomId: string;
    let mockWall: Tile[];

    beforeEach(async () => {
      mockWall = buildMockWallForPeng();
      const appliedWall = applyMockWall([], { mode: 'full', tiles: mockWall });
      const mockConfig: MockWallConfig = { mode: 'full', tiles: appliedWall };
      gameController = new GameController(roomManager, redisStore, mockConfig);

      roomId = roomManager.createRoom('p1');
      roomManager.joinRoom(roomId, 'p2');
      roomManager.joinRoom(roomId, 'p3');
      roomManager.joinRoom(roomId, 'p4');
      roomManager.rollDice(roomId);
    });

    it('should auto-discard on TURN timeout', async () => {
      const state = await gameController.startGame(roomId);
      const dealerIndex = state.dealerIndex;
      const dealer = state.players[dealerIndex];

      const newState = await gameController.handleTimeout(roomId, dealer.id, 'TURN');

      // Should have auto-discarded
      expect(newState.lastDiscard).not.toBeNull();
      expect(newState.lastDiscard?.playerIndex).toBe(dealerIndex);
    });

    it('should auto-hu if possible on TURN timeout', async () => {
      // Create a state where player can hu
      const state = await gameController.startGame(roomId);

      // Play until someone can hu (simplified - in real game this takes longer)
      // For this test, we manually create a winnable state
      const allTiles = createTileSet();
      const winningHand = [
        ...findTiles(allTiles, TileSuit.WAN, 1, 3),
        ...findTiles(allTiles, TileSuit.WAN, 2, 3),
        ...findTiles(allTiles, TileSuit.WAN, 3, 3),
        ...findTiles(allTiles, TileSuit.WAN, 4, 3),
        ...findTiles(allTiles, TileSuit.WAN, 5, 2),
      ];

      const winState: GameState = {
        ...state,
        phase: 'TURN',
        currentPlayerIndex: 0,
        players: state.players.map((p, i) => ({
          ...p,
          hand: i === 0 ? winningHand : p.hand,
          melds: [],
        })),
      };
      await redisStore.saveGameState(roomId, winState);

      const newState = await gameController.handleTimeout(roomId, 'p1', 'TURN');

      expect(newState.phase).toBe('WIN');
    });

    it('should auto-pass on AWAITING timeout', async () => {
      const state = await gameController.startGame(roomId);

      // Manually set to AWAITING phase
      const awaitingState: GameState = {
        ...state,
        phase: 'AWAITING',
        lastDiscard: {
          tile: state.players[0].hand[0],
          playerIndex: 0,
        },
      };
      await redisStore.saveGameState(roomId, awaitingState);

      const newState = await gameController.handleTimeout(roomId, 'p1', 'AWAITING');

      // Should have passed and moved to next player or stayed in AWAITING
      expect(['TURN', 'AWAITING']).toContain(newState.phase);
    });

    it('should return current state if phase mismatch', async () => {
      const state = await gameController.startGame(roomId);

      // Try to handle TURN timeout but state is in AWAITING
      const awaitingState: GameState = {
        ...state,
        phase: 'AWAITING',
      };
      await redisStore.saveGameState(roomId, awaitingState);

      const result = await gameController.handleTimeout(roomId, 'p1', 'TURN');

      // Should return the AWAITING state unchanged
      expect(result.phase).toBe('AWAITING');
    });

    it('should increment consecutiveAutoPlayCount on timeout', async () => {
      const state = await gameController.startGame(roomId);
      const dealerIndex = state.dealerIndex;
      const dealer = state.players[dealerIndex];

      const newState = await gameController.handleTimeout(roomId, dealer.id, 'TURN');

      expect(newState.consecutiveAutoPlayCount).toBe(1);
    });
  });

  describe('handleDisconnect / handleReconnect', () => {
    let roomId: string;

    beforeEach(async () => {
      roomId = roomManager.createRoom('p1');
      roomManager.joinRoom(roomId, 'p2');
      roomManager.joinRoom(roomId, 'p3');
      roomManager.joinRoom(roomId, 'p4');
      roomManager.rollDice(roomId);
      await gameController.startGame(roomId);
    });

    it('should mark player as disconnected', async () => {
      const state = await gameController.handleDisconnect(roomId, 'p2');

      const player = state.players.find((p) => p.id === 'p2');
      expect(player?.isConnected).toBe(false);
    });

    it('should mark player as reconnected', async () => {
      await gameController.handleDisconnect(roomId, 'p2');
      const state = await gameController.handleReconnect(roomId, 'p2');

      const player = state.players.find((p) => p.id === 'p2');
      expect(player?.isConnected).toBe(true);
    });

    it('should mark player as disconnected (game continues with auto-play)', async () => {
      // Disconnect one player - game does NOT pause, continues with auto-play
      const state1 = await gameController.handleDisconnect(roomId, 'p2');
      const player = state1.players.find((p) => p.id === 'p2');
      expect(player?.isConnected).toBe(false);
      // isPaused is NOT set on disconnect - game continues with auto-play
      expect(state1.isPaused).toBe(false);
    });

    it('should resume game when all reconnected', async () => {
      await gameController.handleDisconnect(roomId, 'p2');
      const state = await gameController.handleReconnect(roomId, 'p2');

      expect(state.isPaused).toBe(false);
    });
  });

  describe('finalizeRound', () => {
    let roomId: string;

    beforeEach(async () => {
      roomId = roomManager.createRoom('p1');
      roomManager.joinRoom(roomId, 'p2');
      roomManager.joinRoom(roomId, 'p3');
      roomManager.joinRoom(roomId, 'p4');
      roomManager.rollDice(roomId);
    });

    it('should record win to score log', async () => {
      const state = await gameController.startGame(roomId);

      // The winner is determined by currentPlayerIndex in WIN phase
      // Set currentPlayerIndex to identify the winner
      const winState: GameState = {
        ...state,
        phase: 'WIN',
        currentPlayerIndex: 0, // Player 0 is the winner
        players: state.players.map((p, i) => ({
          ...p,
          score: i === 0 ? 15 : -5, // Winner gets +15
        })),
      };

      await gameController.finalizeRound(roomId, winState, 1);

      const scoreLog = await redisStore.getScoreLog(roomId);
      expect(scoreLog).toHaveLength(1);
      expect(scoreLog[0].result).toBe('win');
      // Winner is state.players[currentPlayerIndex] where currentPlayerIndex=0
      expect(scoreLog[0].winnerId).toBe(state.players[0].id);
    });

    it('should record draw to score log', async () => {
      const state = await gameController.startGame(roomId);

      // Create a DRAW state
      const drawState: GameState = {
        ...state,
        phase: 'DRAW',
        players: state.players.map((p) => ({
          ...p,
          score: 0,
        })),
      };

      await gameController.finalizeRound(roomId, drawState, 1);

      const scoreLog = await redisStore.getScoreLog(roomId);
      expect(scoreLog).toHaveLength(1);
      expect(scoreLog[0].result).toBe('draw');
      expect(scoreLog[0].winnerId).toBeUndefined();
    });

    it('should return canContinue=false if players disconnected', async () => {
      const state = await gameController.startGame(roomId);

      // Disconnect a player
      await gameController.handleDisconnect(roomId, 'p2');

      const winState: GameState = {
        ...state,
        phase: 'WIN',
        players: state.players.map((p, i) => ({
          ...p,
          score: i === 0 ? 15 : -5,
          isConnected: p.id === 'p2' ? false : p.isConnected,
        })),
      };

      const result = await gameController.finalizeRound(roomId, winState, 1);
      expect(result.canContinue).toBe(false);
    });

    it('should start new round with preserved scores', async () => {
      const state = await gameController.startGame(roomId);

      const winState: GameState = {
        ...state,
        phase: 'WIN',
        players: state.players.map((p, i) => ({
          ...p,
          score: i === 0 ? 15 : -5,
        })),
      };

      const result = await gameController.finalizeRound(roomId, winState, 1);

      expect(result.canContinue).toBe(true);
      expect(result.newState?.roundNumber).toBe(2);

      // Scores should be preserved
      expect(result.newState?.players[0].score).toBe(15);
      result.newState?.players.slice(1).forEach((p) => {
        expect(p.score).toBe(-5);
      });
    });
  });
});

describe('GameController with MockWall', () => {
  let redisStore: RedisStore;
  let roomManager: RoomManager;
  let gameController: GameController;

  beforeEach(() => {
    const redisMock = new RedisMock();
    redisStore = new RedisStore(redisMock as unknown as Parameters<typeof RedisStore>[0]);
    roomManager = new RoomManager();
  });

  it('should use mock wall when configured', async () => {
    // Use a full tile set - mock wall replaces the entire wall
    const allTiles = createTileSet();
    const mockConfig: MockWallConfig = { mode: 'full', tiles: allTiles };

    gameController = new GameController(roomManager, redisStore, mockConfig);

    const roomId = roomManager.createRoom('p1');
    roomManager.joinRoom(roomId, 'p2');
    roomManager.joinRoom(roomId, 'p3');
    roomManager.joinRoom(roomId, 'p4');
    roomManager.rollDice(roomId);

    const state = await gameController.startGame(roomId);

    // Wall after deal: 136 - 13*4 - 1 (dealer extra) = 83 tiles
    expect(state.wall.length).toBe(83);
  });

  it('should support tail mode mock wall', async () => {
    const allTiles = createTileSet();
    const replacement = allTiles.slice(0, 10);
    const mockConfig: MockWallConfig = { mode: 'tail', tiles: replacement, count: 10 };

    gameController = new GameController(roomManager, redisStore, mockConfig);

    const roomId = roomManager.createRoom('p1');
    roomManager.joinRoom(roomId, 'p2');
    roomManager.joinRoom(roomId, 'p3');
    roomManager.joinRoom(roomId, 'p4');
    roomManager.rollDice(roomId);

    const state = await gameController.startGame(roomId);

    // Game should start normally
    expect(state.phase).toBe('TURN');
  });
});
