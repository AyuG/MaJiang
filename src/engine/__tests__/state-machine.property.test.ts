import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createTileSet, shuffle } from '@/engine/tile-set';
import { deal } from '@/engine/deal';
import { applyMockWall } from '@/engine/mock-wall';
import { transition, getValidActions } from '@/engine/state-machine';
import { canPeng, canMingGang } from '@/engine/meld-actions';
import type { GameState, GameAction, PlayerState, Tile } from '@/types';

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
  };
}

/** Helper: create a DEALING state with a specific dealer */
function createDealingStateWithDealer(seed: number, dealerIndex: number): GameState {
  const state = createDealingState(seed);
  state.dealerIndex = dealerIndex;
  return state;
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

  it('TURN + discard → AWAITING', () => {
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

        expect(afterDiscard.phase).toBe('AWAITING');
        expect(afterDiscard.lastDiscard).not.toBeNull();
        expect(afterDiscard.lastDiscard!.tile.id).toBe(tileToDiscard.id);
        expect(afterDiscard.lastDiscard!.playerIndex).toBe(dealer);
      }),
      { numRuns: 100 },
    );
  });

  it('AWAITING + all pass → next player TURN', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        // Deal → discard → AWAITING
        const dealing = createDealingState(seed);
        const turnState = transition(dealing, { type: 'deal' });
        const dealer = turnState.currentPlayerIndex;
        const tileToDiscard = turnState.players[dealer].hand[0];
        const awaitingState = transition(turnState, {
          type: 'discard',
          tileId: tileToDiscard.id,
        });
        expect(awaitingState.phase).toBe('AWAITING');

        // All other players pass
        const afterPass = transition(awaitingState, { type: 'pass' });

        expect(afterPass.phase).toBe('TURN');
        // Next player should be (dealer + 1) % 4
        expect(afterPass.currentPlayerIndex).toBe((dealer + 1) % 4);
      }),
      { numRuns: 100 },
    );
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
          // Goes to AWAITING first, then pass → DRAW
          expect(result.phase).toBe('AWAITING');
          const afterPass = transition(result, { type: 'pass' });
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

        // discard
        const dealer = turnState.currentPlayerIndex;
        const tile = turnState.players[dealer].hand[0];
        const logBeforeDiscard = turnState.actionLog.length;
        const awaitingState = transition(turnState, {
          type: 'discard',
          tileId: tile.id,
        });
        expect(awaitingState.actionLog.length).toBe(logBeforeDiscard + 1);

        // pass
        const logBeforePass = awaitingState.actionLog.length;
        const nextTurn = transition(awaitingState, { type: 'pass' });
        expect(nextTurn.actionLog.length).toBe(logBeforePass + 1);
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
        const nextTurn = transition(awaitingState, { type: 'pass' });

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
        const awaitingState = transition(turnState, {
          type: 'discard',
          tileId: tile.id,
        });
        const discardLog = awaitingState.actionLog[awaitingState.actionLog.length - 1];
        expect(discardLog.action).toBe('discard');
        expect(discardLog.playerIndex).toBe(dealer);
        expect(discardLog.tileId).toBe(tile.id);

        // pass action log
        const nextTurn = transition(awaitingState, { type: 'pass' });
        const passLog = nextTurn.actionLog[nextTurn.actionLog.length - 1];
        expect(passLog.action).toBe('pass');
      }),
      { numRuns: 100 },
    );
  });
});
