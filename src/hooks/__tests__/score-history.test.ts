import { describe, expect, it } from 'vitest';
import { mergeScoreHistory, recordCompletedRound } from '@/hooks/score-history';
import type { ClientGameState } from '@/types';

const state: ClientGameState = {
  phase: 'WIN', roomId: 'room', roundNumber: 2, currentPlayerIndex: 1, dealerIndex: 0,
  turnCount: 10, wallCount: 5, myHand: [], lastDiscard: null, lastDrawnTileId: 1,
  isPaused: false, autoPlayPlayerIds: [], pendingResponsePlayerIds: [], passedPlayerIds: [],
  roundStartScores: { p0: 30, p1: -10, p2: -10, p3: -10 },
  players: [10, 10, -10, -10].map((score, i) => ({
    id: `p${i}`, score, meldCount: 0, melds: [], discardPool: [], isConnected: true, handCount: 13,
  })),
};

describe('client per-round score history', () => {
  it('includes immediate penalties, uses actual winner and works without previous client snapshots', () => {
    const [entry] = recordCompletedRound([], state);
    expect(entry.scores.map((p) => p.delta)).toEqual([-20, 20, 0, 0]);
    expect(entry.winnerId).toBe('p1');
  });
  it('deduplicates repeated terminal broadcasts and reconnect game:started snapshots', () => {
    const once = recordCompletedRound([], state);
    expect(recordCompletedRound(once, state)).toEqual(once);
    expect(recordCompletedRound(once, { ...state, roundNumber: 3 })).toHaveLength(2);
  });
  it('retains a penalty-only draw and ignores in-progress updates', () => {
    const draw = { ...state, phase: 'DRAW' as const, players: state.players.map((p, i) => ({
      ...p, score: state.roundStartScores![p.id] + (i === 0 ? -15 : 5),
    })) };
    const log = recordCompletedRound([], draw);
    expect(log[0].scores.map((p) => p.delta)).toEqual([-15, 5, 5, 5]);
    expect(log[0].winnerId).toBeUndefined();
    expect(recordCompletedRound(log, { ...draw, phase: 'TURN' })).toBe(log);
  });
  it('does not invent deltas when a baseline is unavailable', () => {
    expect(recordCompletedRound([], { ...state, roundStartScores: undefined })).toEqual([]);
  });
});


describe('server history synchronization', () => {
  it('fills missed rounds, corrects cached deltas, preserves other rooms and marks dissolution', () => {
    const cached = recordCompletedRound([], state);
    const authoritative = [{ round: 2, result: 'draw' as const,
      scores: state.players.map((p, i) => ({ playerId: p.id, seat: ['东', '南', '西', '北'][i], delta: 0, total: p.score })) },
      { round: 3, result: 'win' as const, winnerId: 'p1', scores: [] }];
    const otherRoom = { ...cached[0], roomId: 'other' };
    const merged = mergeScoreHistory([...cached, otherRoom], 'room', authoritative, true);
    expect(merged).toHaveLength(3);
    expect(merged[0].scores.map((p) => p.delta)).toEqual([0, 0, 0, 0]);
    expect(merged.filter((entry) => entry.roomId === 'room').every((entry) => entry.status === 'finished')).toBe(true);
    expect(merged[1]).toEqual(otherRoom);
    expect(mergeScoreHistory(merged, 'room', authoritative, true)).toEqual(merged);
  });
});
