import { describe, it, expect } from 'vitest';
import { createTileSet } from '@/engine/tile-set';
import { applyMockWall } from '@/engine/mock-wall';
import { transition, getValidActions } from '@/engine/state-machine';
import { TileSuit } from '@/types';
import type { Tile, GameState } from '@/types';

/**
 * Integration test: full 摸-打-自摸 game flow using Mock_Wall.
 *
 * Tile arrangement:
 * - Player 0 (dealer, 14 tiles): 一万×3, 二万×3, 三万×3, 四万×2, 五万×2, 南风×1
 *   → Discards 南风, eventually draws 四万 to complete:
 *     (一万×3)(二万×3)(三万×3)(四万×3) + 五万 pair = WIN
 *
 * - Player 1 (13 tiles): 一条×3, 二条×3, 三条×3, 四条×2, 五条×2
 * - Player 2 (13 tiles): 一筒×3, 二筒×3, 三筒×3, 四筒×2, 五筒×2
 * - Player 3 (13 tiles): 六万×3, 七万×3, 八万×3, 东风×2, 西风×2
 *
 * Wall after deal: [fodder1, fodder2, fodder3, 四万(zi mo), ...]
 *
 * Flow:
 * 1. DEALING → deal → TURN (player 0 has 14 tiles)
 * 2. Player 0 discards 南风 → AWAITING
 * 3. Pass → Player 1 draws fodder1 → TURN
 * 4. Player 1 discards fodder1 → AWAITING
 * 5. Pass → Player 2 draws fodder2 → TURN
 * 6. Player 2 discards fodder2 → AWAITING
 * 7. Pass → Player 3 draws fodder3 → TURN
 * 8. Player 3 discards fodder3 → AWAITING
 * 9. Pass → Player 0 draws 四万 → TURN
 * 10. Player 0 declares hu (zi mo) → WIN
 */

/** Helper: find tiles from the full 136-tile set by suit and value */
function findTiles(allTiles: Tile[], suit: TileSuit, value: number, count: number): Tile[] {
  const matches = allTiles.filter((t) => t.suit === suit && t.value === value);
  if (matches.length < count) {
    throw new Error(`Not enough tiles for ${suit}:${value}, need ${count} but found ${matches.length}`);
  }
  return matches.slice(0, count);
}

function buildMockWall(): Tile[] {
  const allTiles = createTileSet();

  // Player 0 (dealer): 一万×3, 二万×3, 三万×3, 四万×2, 五万×2 = 13 tiles
  const p0Hand = [
    ...findTiles(allTiles, TileSuit.WAN, 1, 3),
    ...findTiles(allTiles, TileSuit.WAN, 2, 3),
    ...findTiles(allTiles, TileSuit.WAN, 3, 3),
    ...findTiles(allTiles, TileSuit.WAN, 4, 2),
    ...findTiles(allTiles, TileSuit.WAN, 5, 2),
  ];
  // The 14th tile for dealer: 南风 (will be discarded)
  const p0Extra = findTiles(allTiles, TileSuit.FENG, 2, 1); // 南风

  // Player 1: 一条×3, 二条×3, 三条×3, 四条×2, 五条×2 = 13 tiles
  const p1Hand = [
    ...findTiles(allTiles, TileSuit.TIAO, 1, 3),
    ...findTiles(allTiles, TileSuit.TIAO, 2, 3),
    ...findTiles(allTiles, TileSuit.TIAO, 3, 3),
    ...findTiles(allTiles, TileSuit.TIAO, 4, 2),
    ...findTiles(allTiles, TileSuit.TIAO, 5, 2),
  ];

  // Player 2: 一筒×3, 二筒×3, 三筒×3, 四筒×2, 五筒×2 = 13 tiles
  const p2Hand = [
    ...findTiles(allTiles, TileSuit.TONG, 1, 3),
    ...findTiles(allTiles, TileSuit.TONG, 2, 3),
    ...findTiles(allTiles, TileSuit.TONG, 3, 3),
    ...findTiles(allTiles, TileSuit.TONG, 4, 2),
    ...findTiles(allTiles, TileSuit.TONG, 5, 2),
  ];

  // Player 3: 六万×3, 七万×3, 八万×3, 东风×2, 西风×2 = 13 tiles
  const p3Hand = [
    ...findTiles(allTiles, TileSuit.WAN, 6, 3),
    ...findTiles(allTiles, TileSuit.WAN, 7, 3),
    ...findTiles(allTiles, TileSuit.WAN, 8, 3),
    ...findTiles(allTiles, TileSuit.FENG, 1, 2), // 东风×2
    ...findTiles(allTiles, TileSuit.FENG, 3, 2), // 西风×2
  ];

  // Collect all used tile IDs
  const usedIds = new Set([
    ...p0Hand.map((t) => t.id),
    ...p0Extra.map((t) => t.id),
    ...p1Hand.map((t) => t.id),
    ...p2Hand.map((t) => t.id),
    ...p3Hand.map((t) => t.id),
  ]);

  // Remaining tiles for the wall after deal
  const remaining = allTiles.filter((t) => !usedIds.has(t.id));

  // After deal, the wall is consumed front-to-back via draw/pass.
  // Flow: P0 discards → pass draws wall[0] for P1
  //       P1 discards → pass draws wall[1] for P2
  //       P2 discards → pass draws wall[2] for P3
  //       P3 discards → pass draws wall[3] for P0 ← winning tile!
  //
  // wall[0..2] = fodder tiles for P1, P2, P3
  // wall[3]    = 四万 (P0's zi mo winning tile)

  const siWan = allTiles.filter(
    (t) => t.suit === TileSuit.WAN && t.value === 4,
  );
  // Pick a 四万 that's not already used (p0 has copies 0,1 — so copy 2 or 3)
  const winTile = siWan.find((t) => !usedIds.has(t.id))!;

  // Pick 3 fodder tiles that no player can peng (unique tiles not in any hand).
  // Use: 北风(feng:4), 中(zi:1), 白(zi:2) — none of these appear in any player's hand.
  const fodder1 = allTiles.find(
    (t) => t.suit === TileSuit.FENG && t.value === 4 && !usedIds.has(t.id),
  )!; // 北风
  const fodder2 = allTiles.find(
    (t) => t.suit === TileSuit.ZI && t.value === 1 && !usedIds.has(t.id),
  )!; // 中
  const fodder3 = allTiles.find(
    (t) => t.suit === TileSuit.ZI && t.value === 2 && !usedIds.has(t.id),
  )!; // 白

  const otherRemaining = remaining.filter(
    (t) => t.id !== winTile.id && t.id !== fodder1.id && t.id !== fodder2.id && t.id !== fodder3.id,
  );

  // deal() layout: 13 for p0, 13 for p1, 13 for p2, 13 for p3, 1 extra for p0
  // Then remaining wall = [fodder1, fodder2, fodder3, winTile, ...otherRemaining]
  const mockWall: Tile[] = [
    ...p0Hand,          // 13 tiles for deal index 0 (player 0)
    ...p1Hand,          // 13 tiles for deal index 1 (player 1)
    ...p2Hand,          // 13 tiles for deal index 2 (player 2)
    ...p3Hand,          // 13 tiles for deal index 3 (player 3)
    ...p0Extra,         // 1 extra tile for dealer (player 0)
    fodder1,            // wall[0] after deal — P1 draws via pass
    fodder2,            // wall[1] after deal — P2 draws via pass
    fodder3,            // wall[2] after deal — P3 draws via pass
    winTile,            // wall[3] after deal — P0 draws via pass (zi mo!)
    ...otherRemaining,  // rest of wall
  ];

  return mockWall;
}

function createInitialState(wall: Tile[]): GameState {
  return {
    phase: 'DEALING',
    roomId: 'integration-test',
    players: [0, 1, 2, 3].map((i) => ({
      id: `player-${i}`,
      hand: [],
      melds: [],
      discardPool: [],
      score: 0,
      isConnected: true,
      isReady: true,
    })),
    wall,
    currentPlayerIndex: 0,
    dealerIndex: 0,
    seed: 42,
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
  };
}

describe('Integration: 摸-打-自摸 complete game flow', () => {
  const mockWall = buildMockWall();
  const appliedWall = applyMockWall([], { mode: 'full', tiles: mockWall });
  const initialState = createInitialState(appliedWall);

  // Step 1: DEALING → TURN
  let state: GameState;

  it('Step 1: deal — DEALING → TURN, dealer (player 0) has 14 tiles', () => {
    state = transition(initialState, { type: 'deal' });

    expect(state.phase).toBe('TURN');
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.players[0].hand).toHaveLength(14);
    expect(state.players[1].hand).toHaveLength(13);
    expect(state.players[2].hand).toHaveLength(13);
    expect(state.players[3].hand).toHaveLength(13);
    expect(state.wall).toHaveLength(83);
    expect(state.actionLog).toHaveLength(1);
  });

  it('Step 2: player 0 discards 南風 → AWAITING', () => {
    // Find the 南風 in player 0's hand
    const nanFeng = state.players[0].hand.find(
      (t) => t.suit === TileSuit.FENG && t.value === 2,
    );
    expect(nanFeng).toBeDefined();

    state = transition(state, { type: 'discard', tileId: nanFeng!.id });

    expect(state.phase).toBe('AWAITING');
    expect(state.players[0].hand).toHaveLength(13);
    expect(state.lastDiscard).not.toBeNull();
    expect(state.lastDiscard!.tile.suit).toBe(TileSuit.FENG);
    expect(state.lastDiscard!.tile.value).toBe(2);
    expect(state.lastDiscard!.playerIndex).toBe(0);
    expect(state.actionLog).toHaveLength(2);
  });

  it('Step 3: pass → player 1 draws fodder → TURN', () => {
    state = transition(state, { type: 'pass' });

    expect(state.phase).toBe('TURN');
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.players[1].hand).toHaveLength(14);
    expect(state.actionLog).toHaveLength(3);
  });

  it('Step 4: player 1 discards last drawn tile → AWAITING', () => {
    // Player 1 discards the last tile in hand (the one just drawn)
    const tileToDiscard = state.players[1].hand[state.players[1].hand.length - 1];

    state = transition(state, { type: 'discard', tileId: tileToDiscard.id });

    expect(state.phase).toBe('AWAITING');
    expect(state.players[1].hand).toHaveLength(13);
    expect(state.lastDiscard!.playerIndex).toBe(1);
    expect(state.actionLog).toHaveLength(4);
  });

  it('Step 5: pass → player 2 draws fodder → TURN', () => {
    state = transition(state, { type: 'pass' });

    expect(state.phase).toBe('TURN');
    expect(state.currentPlayerIndex).toBe(2);
    expect(state.players[2].hand).toHaveLength(14);
    expect(state.actionLog).toHaveLength(5);
  });

  it('Step 6: player 2 discards last drawn tile → AWAITING', () => {
    const tileToDiscard = state.players[2].hand[state.players[2].hand.length - 1];
    state = transition(state, { type: 'discard', tileId: tileToDiscard.id });

    expect(state.phase).toBe('AWAITING');
    expect(state.players[2].hand).toHaveLength(13);
    expect(state.actionLog).toHaveLength(6);
  });

  it('Step 7: pass → player 3 draws fodder → TURN', () => {
    state = transition(state, { type: 'pass' });

    expect(state.phase).toBe('TURN');
    expect(state.currentPlayerIndex).toBe(3);
    expect(state.players[3].hand).toHaveLength(14);
    expect(state.actionLog).toHaveLength(7);
  });

  it('Step 8: player 3 discards last drawn tile → AWAITING', () => {
    const tileToDiscard = state.players[3].hand[state.players[3].hand.length - 1];
    state = transition(state, { type: 'discard', tileId: tileToDiscard.id });

    expect(state.phase).toBe('AWAITING');
    expect(state.players[3].hand).toHaveLength(13);
    expect(state.actionLog).toHaveLength(8);
  });

  it('Step 9: pass → player 0 draws 四万 (winning tile) → TURN', () => {
    state = transition(state, { type: 'pass' });

    expect(state.phase).toBe('TURN');
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.players[0].hand).toHaveLength(14);

    // Verify player 0 now has 3x 四万 (2 original + 1 drawn)
    const siWanCount = state.players[0].hand.filter(
      (t) => t.suit === TileSuit.WAN && t.value === 4,
    ).length;
    expect(siWanCount).toBe(3);
  });

  it('Step 10: player 0 declares hu (zi mo) → WIN with correct scores', () => {
    // Verify hu is a valid action
    const validActions = getValidActions(state);
    const hasHu = validActions.some((a) => a.type === 'hu');
    expect(hasHu).toBe(true);

    state = transition(state, { type: 'hu' });

    expect(state.phase).toBe('WIN');

    // Score settlement: winScore=5, no gang records
    // Winner (player 0) gets +5 from each of 3 other players = +15
    // Each other player pays -5
    expect(state.players[0].score).toBe(15);
    expect(state.players[1].score).toBe(-5);
    expect(state.players[2].score).toBe(-5);
    expect(state.players[3].score).toBe(-5);

    // Zero-sum check
    const totalScore = state.players.reduce((sum, p) => sum + p.score, 0);
    expect(totalScore).toBe(0);
  });

  it('Action log records all operations in order', () => {
    // The log should have entries for: deal, discard, pass, discard, pass,
    // discard, pass, discard, pass, hu
    expect(state.actionLog.length).toBeGreaterThanOrEqual(10);

    // Verify timestamps are non-decreasing
    for (let i = 1; i < state.actionLog.length; i++) {
      expect(state.actionLog[i].timestamp).toBeGreaterThanOrEqual(
        state.actionLog[i - 1].timestamp,
      );
    }

    // Verify the last entry is hu by player 0
    const lastEntry = state.actionLog[state.actionLog.length - 1];
    expect(lastEntry.action).toBe('hu');
    expect(lastEntry.playerIndex).toBe(0);
  });
});
