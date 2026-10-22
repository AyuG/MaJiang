import { describe, expect, it } from 'vitest';
import { transition } from '@/engine/state-machine';
import { TileSuit, type GameState, type GameAction, type Tile } from '@/types';

const tile = (id: number, value = 1): Tile => ({ id, suit: TileSuit.WAN, value });

function firstDiscardState(dealerIndex = 0): GameState {
  return {
    phase: 'TURN', roomId: 'first-discards',
    players: [0, 1, 2, 3].map((i) => ({
      id: `p${i}`, hand: [tile(i)], melds: [], discardPool: [], score: 0,
      isConnected: true, isReady: true,
    })),
    wall: [tile(10, 2), tile(11, 3), tile(12, 4)],
    currentPlayerIndex: dealerIndex, dealerIndex, seed: 1, lastDiscard: null,
    turnCount: 1, roundNumber: 1, consecutiveGangCount: 0,
    gangRecords: [{ type: 'an', gangPlayerIndex: 2 }], isPaused: false,
    actionLog: [], lastDrawnTileId: dealerIndex, dealerFirstDiscard: null,
    dealerFirstMatchCount: 0, timeoutAutoPlayerIds: [], consecutiveAutoPlayCount: 0,
    roundStartScores: { p0: 0, p1: 0, p2: 0, p3: 0 },
  };
}

function discard(state: GameState, playerIndex: number, id: number): GameState {
  return transition({ ...state, currentPlayerIndex: playerIndex, phase: 'TURN' }, { type: 'discard', tileId: id });
}

describe('庄家首牌四家同出', () => {
  it.each([0, 1, 2, 3])('applies immediately for dealer %i and preserves it on the same-step draw', (dealer) => {
    const initial = firstDiscardState(dealer);
    let state = initial;
    for (let n = 0; n < 4; n++) {
      const i = (dealer + n) % 4;
      state = discard(state, i, i);
      if (n < 3) expect(state.players.map((p) => p.score)).toEqual([0, 0, 0, 0]);
    }
    expect(state.phase).toBe('DRAW');
    expect(state.players.map((p) => p.score)).toEqual([0, 1, 2, 3].map((i) => i === dealer ? -15 : 5));
    expect(state.gangRecords).toEqual([]);
    expect(initial.players.map((p) => p.score)).toEqual([0, 0, 0, 0]);
    expect(initial.gangRecords).toHaveLength(1);
    expect(state.dealerFirstDiscard).toBeNull();
  });

  it('does not count repeated later discards by the same player', () => {
    let state = firstDiscardState();
    // Deliberately model repeated claims / turns before the remaining players first discard.
    state.wall = Array.from({ length: 10 }, (_, i) => tile(20 + i, 9));
    state = discard(state, 0, 0);
    state = discard(state, 1, 1);
    for (const id of [50, 51]) {
      state.players[1].hand.push(tile(id));
      state = discard(state, 1, id);
    }
    expect(state.players.map((p) => p.score)).toEqual([0, 0, 0, 0]);
    expect(state.dealerFirstMatchCount).toBe(1);
  });

  it('does not mistake a claimed first discard for a new first discard', () => {
    let state = firstDiscardState();
    state.wall.push(tile(20, 9), tile(21, 8));
    state = discard(state, 0, 0);
    state = discard(state, 1, 1);
    state.players[1].discardPool = []; // a peng / gang removes the tile from the pool
    state.players[1].hand.push(tile(50));
    state = discard(state, 1, 50);
    expect(state.dealerFirstMatchCount).toBe(1);
    expect(state.players.map((p) => p.score)).toEqual([0, 0, 0, 0]);
  });

  it('cancels after a first-discard mismatch even when later discards match', () => {
    let state = firstDiscardState();
    state.players[1].hand = [tile(1, 2)];
    state = discard(state, 0, 0);
    state = discard(state, 1, 1);
    state = discard(state, 2, 2);
    state = discard(state, 3, 3);
    expect(state.dealerFirstDiscard).toBeNull();
    expect(state.players.map((p) => p.score)).toEqual([0, 0, 0, 0]);
  });

  it('applies at most once and ignores later mismatches after matching first discards', () => {
    let state = firstDiscardState();
    state.wall.push(tile(20, 8), tile(21, 9));
    state = discard(state, 0, 0);
    state = discard(state, 1, 1);
    state.players[1].hand.push(tile(50, 8));
    state = discard(state, 1, 50);
    state = discard(state, 2, 2);
    state = discard(state, 3, 3);
    expect(state.players.map((p) => p.score)).toEqual([-15, 5, 5, 5]);
    state.players[0].hand.push(tile(51));
    state = discard(state, 0, 51);
    expect(state.players.map((p) => p.score)).toEqual([-15, 5, 5, 5]);
    expect(state.dealerFirstDiscard).toBeNull();
  });
});


describe('all DRAW paths preserve applied penalties', () => {
  it.each(['discard', 'pass', 'ming_gang', 'an_gang', 'bu_gang'] as const)('%s clears pending gangs only', (type) => {
    const state = firstDiscardState();
    state.wall = [];
    state.dealerFirstDiscard = null;
    state.actionLog = [{ timestamp: 1, playerIndex: 0, action: 'discard', tileId: 99 }];
    state.players.forEach((p, i) => { p.score = i === 0 ? -15 : 5; p.hand = []; });
    state.players[0].hand = [tile(0)];
    let action: GameAction = { type: 'discard', tileId: 0 };
    if (type === 'pass' || type === 'ming_gang') {
      state.phase = 'AWAITING';
      state.lastDiscard = { tile: tile(0), playerIndex: 0 };
      state.players[0].hand = [];
      state.players[1].hand = [tile(1), tile(2), tile(3)];
      state.pendingResponses = [{ playerIndex: 1, actions: ['peng', 'ming_gang'] }];
      action = { type, playerId: 'p1' };
    } else if (type === 'an_gang') {
      state.players[0].hand = [tile(0), tile(1), tile(2), tile(3)];
      action = { type, tileId: 0 };
    } else if (type === 'bu_gang') {
      state.players[0].melds = [{ type: 'peng', tiles: [tile(1), tile(2), tile(3)], fromPlayer: 'p1' }];
      action = { type, tileId: 0 };
    }
    const next = transition(state, action);
    expect(next.phase).toBe('DRAW');
    expect(next.gangRecords).toEqual([]);
    expect(next.players.map((p) => p.score)).toEqual([-15, 5, 5, 5]);
  });
});
