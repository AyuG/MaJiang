import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createTileSet, shuffle } from '@/engine/tile-set';
import { applyMockWall } from '@/engine/mock-wall';
import { transition, getValidActions } from '@/engine/state-machine';
import { canPeng, canMingGang } from '@/engine/meld-actions';
import { TileSuit } from '@/types';
import type { GameState, Tile } from '@/types';

/** Helper: create a fresh DEALING-phase GameState from a seed */
function createDealingState(seed: number): GameState {
  return {
    phase: 'DEALING',
    roomId: 'test-room',
    players: [0, 1, 2, 3].map((i) => ({
      id: `player-${i}`,
      hand: [],
      melds: [],
      discardPool: [],
      score: 0,
      isConnected: true,
      isReady: true,
    })),
    wall: shuffle(createTileSet(), seed),
    currentPlayerIndex: 0,
    dealerIndex: 0,
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
  };
}

/** Helper: create a DEALING state with a specific dealer */
function createDealingStateWithDealer(seed: number, dealerIndex: number): GameState {
  const state = createDealingState(seed);
  state.dealerIndex = dealerIndex;
  return state;
}

function passAllPending(state: GameState): GameState {
  let next = state;
  for (const response of state.pendingResponses ?? []) {
    if (next.phase !== 'AWAITING') break;
    const playerId = state.players[response.playerIndex].id;
    next = transition(next, { type: 'pass', playerId });
  }
  return next;
}

/**
 * Feature: chinese-mahjong-online, Property 4: 状态机转换正确性
 *
 * For any 有效的 GameState，状态机转换应满足以下规则：
 * DEALING 完成后进入 TURN 且当前玩家为庄家；
 * TURN 阶段出牌后进入 AWAITING；
 * AWAITING 阶段所有人选择"过"后进入下一位玩家的 TURN；
 * 满足自摸条件时进入 WIN；
 * 牌墙为空且无人胡牌时进入 DRAW。
 *
 * **Validates: Requirements 4.3, 4.4, 4.5, 4.6, 4.7**
 */
describe('Property 4: 状态机转换正确性', () => {
  it('DEALING → TURN: after deal, phase is TURN and currentPlayer is dealer', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 0, max: 3 }),
        (seed, dealerIndex) => {
          const state = createDealingStateWithDealer(seed, dealerIndex);
          const next = transition(state, { type: 'deal' });

          expect(next.phase).toBe('TURN');
          expect(next.currentPlayerIndex).toBe(dealerIndex);
          // Dealer should have 14 tiles, others 13
          expect(next.players[dealerIndex].hand).toHaveLength(14);
          for (let i = 0; i < 4; i++) {
            if (i !== dealerIndex) {
              expect(next.players[i].hand).toHaveLength(13);
            }
          }
          // Wall should have 83 tiles
          expect(next.wall).toHaveLength(83);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('TURN + discard → AWAITING (if others can act) or TURN (auto-draw if no one can act)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        // Deal first
        const dealing = createDealingState(seed);
        const turnState = transition(dealing, { type: 'deal' });
        expect(turnState.phase).toBe('TURN');

        // Dealer has 14 tiles, pick one to discard
        const dealer = turnState.currentPlayerIndex;
        const tileToDiscard = turnState.players[dealer].hand[0];

        const afterDiscard = transition(turnState, {
          type: 'discard',
          tileId: tileToDiscard.id,
        });

        // Check if any other player can act on the discarded tile
        const canAnyoneAct = turnState.players.some((p, i) => {
          if (i === dealer) return false;
          const hand = p.hand;
          const tile = tileToDiscard;
          // Check for peng (3 matching tiles)
          const matchingCount = hand.filter(
            (t) => t.suit === tile.suit && t.value === tile.value,
          ).length;
          return matchingCount >= 2; // 2 in hand + 1 discarded = 3 for peng
        });

        if (canAnyoneAct) {
          // Someone can act → AWAITING
          expect(afterDiscard.phase).toBe('AWAITING');
        } else {
          // No one can act → auto-draw for next player → TURN
          expect(afterDiscard.phase).toBe('TURN');
          expect(afterDiscard.currentPlayerIndex).toBe((dealer + 1) % 4);
        }
        expect(afterDiscard.lastDiscard).not.toBeNull();
        expect(afterDiscard.lastDiscard!.tile.id).toBe(tileToDiscard.id);
        expect(afterDiscard.lastDiscard!.playerIndex).toBe(dealer);
      }),
      { numRuns: 100 },
    );
  });

  it('AWAITING + all pass → next player TURN (or TURN + auto-draw if no one can act)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        // Deal → discard → AWAITING (or TURN with auto-draw)
        const dealing = createDealingState(seed);
        const turnState = transition(dealing, { type: 'deal' });
        const dealer = turnState.currentPlayerIndex;
        const tileToDiscard = turnState.players[dealer].hand[0];
        const afterDiscard = transition(turnState, {
          type: 'discard',
          tileId: tileToDiscard.id,
        });

        // If no one could act, afterDiscard is already TURN with auto-draw
        if (afterDiscard.phase === 'TURN') {
          expect(afterDiscard.currentPlayerIndex).toBe((dealer + 1) % 4);
          return;
        }

        // Otherwise, we're in AWAITING
        expect(afterDiscard.phase).toBe('AWAITING');

        // All pending responders pass
        const afterPass = passAllPending(afterDiscard);

        expect(afterPass.phase).toBe('TURN');
        // Next player should be (dealer + 1) % 4
        expect(afterPass.currentPlayerIndex).toBe((dealer + 1) % 4);
      }),
      { numRuns: 100 },
    );
  });

  it('AWAITING keeps waiting until every pending responder passes', () => {
    const discardTile: Tile = { suit: TileSuit.WAN, value: 1, id: 1 };
    const state: GameState = {
      ...createDealingState(1),
      phase: 'TURN',
      wall: [{ suit: TileSuit.TIAO, value: 9, id: 99 }],
      players: [
        {
          ...createDealingState(1).players[0],
          id: 'p0',
          hand: [discardTile],
        },
        {
          ...createDealingState(1).players[1],
          id: 'p1',
          hand: [
            { suit: TileSuit.WAN, value: 1, id: 2 },
            { suit: TileSuit.WAN, value: 1, id: 3 },
          ],
        },
        {
          ...createDealingState(1).players[2],
          id: 'p2',
          hand: [
            { suit: TileSuit.WAN, value: 1, id: 4 },
            { suit: TileSuit.WAN, value: 1, id: 5 },
          ],
        },
        { ...createDealingState(1).players[3], id: 'p3', hand: [] },
      ],
    };

    const awaiting = transition(state, { type: 'discard', tileId: discardTile.id });
    expect(awaiting.phase).toBe('AWAITING');
    expect(awaiting.pendingResponses?.map((r) => r.playerIndex)).toEqual([1, 2]);

    const afterP1Pass = transition(awaiting, { type: 'pass', playerId: 'p1' });
    expect(afterP1Pass.phase).toBe('AWAITING');
    expect(afterP1Pass.passedPlayerIds).toContain('p1');

    const afterP2Pass = transition(afterP1Pass, { type: 'pass', playerId: 'p2' });
    expect(afterP2Pass.phase).toBe('TURN');
    expect(afterP2Pass.currentPlayerIndex).toBe(1);
  });

  it('a later pending responder can still peng after an earlier responder passes', () => {
    const discardTile: Tile = { suit: TileSuit.WAN, value: 1, id: 11 };
    const base = createDealingState(2);
    const state: GameState = {
      ...base,
      phase: 'TURN',
      players: [
        { ...base.players[0], id: 'p0', hand: [discardTile] },
        {
          ...base.players[1],
          id: 'p1',
          hand: [
            { suit: TileSuit.WAN, value: 1, id: 12 },
            { suit: TileSuit.WAN, value: 1, id: 13 },
          ],
        },
        {
          ...base.players[2],
          id: 'p2',
          hand: [
            { suit: TileSuit.WAN, value: 1, id: 14 },
            { suit: TileSuit.WAN, value: 1, id: 15 },
          ],
        },
        { ...base.players[3], id: 'p3', hand: [] },
      ],
    };

    const awaiting = transition(state, { type: 'discard', tileId: discardTile.id });
    const afterP1Pass = transition(awaiting, { type: 'pass', playerId: 'p1' });
    const afterP2Peng = transition(afterP1Pass, { type: 'peng', playerId: 'p2' });

    expect(afterP2Peng.phase).toBe('TURN');
    expect(afterP2Peng.currentPlayerIndex).toBe(2);
    expect(afterP2Peng.players[2].melds[0]?.type).toBe('peng');
  });

  it('TURN + hu (zi mo) → WIN when hand is winning', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }), (baseSeed) => {
        // Use Mock_Wall to set up a winning hand for dealer
        // Build a wall where dealer gets a winning hand (7 pairs)
        const tiles = createTileSet();
        // Sort tiles by suit+value to group identical tiles
        const sorted = [...tiles].sort((a, b) => {
          if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
          return a.value - b.value;
        });

        // Build a 7-pair hand for dealer (first 14 tiles = 7 pairs)
        // Take pairs: tiles come in groups of 4, take 2 from each of 7 groups
        const dealerHand: Tile[] = [];
        let groupIdx = 0;
        for (let pair = 0; pair < 7; pair++) {
          dealerHand.push(sorted[groupIdx * 4]);
          dealerHand.push(sorted[groupIdx * 4 + 1]);
          groupIdx++;
        }

        // Build hands for other 3 players (13 tiles each)
        const usedIds = new Set(dealerHand.map((t) => t.id));
        const remaining = sorted.filter((t) => !usedIds.has(t.id));
        const otherHands: Tile[][] = [[], [], []];
        let ri = 0;
        for (let p = 0; p < 3; p++) {
          for (let i = 0; i < 13; i++) {
            otherHands[p].push(remaining[ri++]);
          }
        }

        // Construct full wall: dealer 13 tiles, then p1 13, p2 13, p3 13, then dealer extra
        // deal() takes 13 per player sequentially, then 1 extra for dealer (index 0)
        const mockWall: Tile[] = [
          ...dealerHand.slice(0, 13),
          ...otherHands[0],
          ...otherHands[1],
          ...otherHands[2],
          dealerHand[13],
          ...remaining.slice(ri),
        ];

        const wall = applyMockWall(shuffle(createTileSet(), baseSeed), {
          mode: 'full',
          tiles: mockWall,
        });

        const state: GameState = {
          phase: 'DEALING',
          roomId: 'test-room',
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
          seed: baseSeed,
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
        };

        const turnState = transition(state, { type: 'deal' });
        expect(turnState.phase).toBe('TURN');

        // Dealer should be able to hu
        const validActions = getValidActions(turnState);
        const hasHu = validActions.some((a) => a.type === 'hu');
        expect(hasHu).toBe(true);

        const winState = transition(turnState, { type: 'hu' });
        expect(winState.phase).toBe('WIN');
      }),
      { numRuns: 100 },
    );
  });

  it('TURN with empty wall after action → DRAW', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10000 }), (baseSeed) => {
        // Deal normally first
        const dealing = createDealingState(baseSeed);
        const turnState = transition(dealing, { type: 'deal' });

        // Manually create a TURN state with empty wall
        const emptyWallState: GameState = {
          ...turnState,
          wall: [], // empty wall
          phase: 'TURN',
        };

        const pi = emptyWallState.currentPlayerIndex;
        const hand = emptyWallState.players[pi].hand;

        // Find a tile to discard that no other player can peng/gang
        // This ensures we go directly to DRAW instead of AWAITING
        let tileToDiscard = hand[0];
        for (const tile of hand) {
          let canAct = false;
          for (let j = 0; j < 4; j++) {
            if (j === pi) continue;
            if (canPeng(emptyWallState.players[j].hand, tile) ||
                canMingGang(emptyWallState.players[j].hand, tile)) {
              canAct = true;
              break;
            }
          }
          if (!canAct) {
            tileToDiscard = tile;
            break;
          }
        }

        const result = transition(emptyWallState, {
          type: 'discard',
          tileId: tileToDiscard.id,
        });

        // If no one can act on the discard with empty wall → DRAW
        // If someone can act → AWAITING (which is also valid, they pass → DRAW)
        let canAnyoneAct = false;
        for (let j = 0; j < 4; j++) {
          if (j === pi) continue;
          if (canPeng(emptyWallState.players[j].hand, tileToDiscard) ||
              canMingGang(emptyWallState.players[j].hand, tileToDiscard)) {
            canAnyoneAct = true;
            break;
          }
        }

        if (canAnyoneAct) {
          // Goes to AWAITING first, then all pending responders pass → DRAW
          expect(result.phase).toBe('AWAITING');
          const afterPass = passAllPending(result);
          expect(afterPass.phase).toBe('DRAW');
        } else {
          expect(result.phase).toBe('DRAW');
        }
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: chinese-mahjong-online, Property 19: 操作日志完整性
 *
 * For any 游戏操作序列，每个操作执行后日志条目数应增加 1，
 * 日志中的时间戳应严格递增，且每条日志应包含正确的 playerIndex、action 类型和相关参数。
 *
 * **Validates: Requirements 2.2**
 */
describe('Property 19: 操作日志完整性', () => {
  it('after each transition, actionLog length increases by 1', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const dealing = createDealingState(seed);
        const logBefore = dealing.actionLog.length;

        // deal
        const turnState = transition(dealing, { type: 'deal' });
        expect(turnState.actionLog.length).toBe(logBefore + 1);

        // discard - may go to AWAITING or TURN (auto-draw)
        const dealer = turnState.currentPlayerIndex;
        const tile = turnState.players[dealer].hand[0];
        const logBeforeDiscard = turnState.actionLog.length;
        const afterDiscard = transition(turnState, {
          type: 'discard',
          tileId: tile.id,
        });
        expect(afterDiscard.actionLog.length).toBe(logBeforeDiscard + 1);

        // If we went to AWAITING, pass will add a log entry
        // If we went to TURN (auto-draw), no pass needed
        if (afterDiscard.phase === 'AWAITING') {
          const logBeforePass = afterDiscard.actionLog.length;
          const nextTurn = passAllPending(afterDiscard);
          expect(nextTurn.actionLog.length).toBeGreaterThan(logBeforePass);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('timestamps are monotonically increasing', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const dealing = createDealingState(seed);
        const turnState = transition(dealing, { type: 'deal' });

        const dealer = turnState.currentPlayerIndex;
        const tile = turnState.players[dealer].hand[0];
        const awaitingState = transition(turnState, {
          type: 'discard',
          tileId: tile.id,
        });
        const nextTurn = awaitingState.phase === 'AWAITING'
          ? passAllPending(awaitingState)
          : awaitingState;

        const log = nextTurn.actionLog;
        for (let i = 1; i < log.length; i++) {
          expect(log[i].timestamp).toBeGreaterThanOrEqual(log[i - 1].timestamp);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('each entry has correct playerIndex and action type', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const dealing = createDealingState(seed);
        const turnState = transition(dealing, { type: 'deal' });

        // deal action log
        const dealLog = turnState.actionLog[turnState.actionLog.length - 1];
        expect(dealLog.action).toBe('deal');
        expect(dealLog.playerIndex).toBe(dealing.dealerIndex);

        // discard action log
        const dealer = turnState.currentPlayerIndex;
        const tile = turnState.players[dealer].hand[0];
        const afterDiscard = transition(turnState, {
          type: 'discard',
          tileId: tile.id,
        });
        const discardLog = afterDiscard.actionLog[afterDiscard.actionLog.length - 1];
        expect(discardLog.action).toBe('discard');
        expect(discardLog.playerIndex).toBe(dealer);
        expect(discardLog.tileId).toBe(tile.id);

        // If we went to AWAITING, pass will add a log entry
        if (afterDiscard.phase === 'AWAITING') {
          const nextTurn = passAllPending(afterDiscard);
          const passLog = nextTurn.actionLog[nextTurn.actionLog.length - 1];
          expect(passLog.action).toBe('pass');
        }
      }),
      { numRuns: 100 },
    );
  });
});
