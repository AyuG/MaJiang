import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { RedisStore } from './redis-store';
import type { GameState, ActionLogEntry, RoomInfo } from '@/types';

function makeGameState(overrides?: Partial<GameState>): GameState {
  return {
    phase: 'TURN',
    roomId: 'room-1',
    players: [],
    wall: [],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    seed: 42,
    lastDiscard: null,
    turnCount: 1,
    roundNumber: 1,
    consecutiveGangCount: 0,
    gangRecords: [],
    isPaused: false,
    actionLog: [],
    lastDrawnTileId: null,
    dealerFirstDiscard: null,
    dealerFirstMatchCount: 0,
    timeoutAutoPlayerIds: [],
    ...overrides,
  };
}

describe('RedisStore', () => {
  let store: RedisStore;

  beforeEach(async () => {
    const client = new RedisMock();
    await client.flushall();
    // ioredis-mock has compatible runtime API but different type signature
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new RedisStore(client as any);
  });

  // ── GameState ────────────────────────────────────────

  it('saves and retrieves GameState', async () => {
    const state = makeGameState();
    await store.saveGameState('room-1', state);
    const result = await store.getGameState('room-1');
    expect(result).toEqual(state);
  });

  it('returns null for missing GameState', async () => {
    expect(await store.getGameState('nonexistent')).toBeNull();
  });

  it('deletes GameState', async () => {
    await store.saveGameState('room-1', makeGameState());
    await store.deleteGameState('room-1');
    expect(await store.getGameState('room-1')).toBeNull();
  });

  // ── ActionLog ────────────────────────────────────────

  it('saves and retrieves ActionLog', async () => {
    const log: ActionLogEntry[] = [
      { timestamp: 1000, playerIndex: 0, action: 'draw', tileId: 5 },
      { timestamp: 1001, playerIndex: 0, action: 'discard', tileId: 5 },
    ];
    await store.saveActionLog('room-1', 42, log);
    const result = await store.getActionLog('room-1');
    expect(result).toEqual({ seed: 42, log });
  });

  it('returns null for missing ActionLog', async () => {
    expect(await store.getActionLog('nonexistent')).toBeNull();
  });

  // ── Room ─────────────────────────────────────────────

  it('saves and retrieves Room', async () => {
    const room: RoomInfo = {
      roomId: 'room-1',
      players: ['p1', 'p2'],
      status: 'waiting',
      createdAt: Date.now(),
    };
    await store.saveRoom('room-1', room);
    const result = await store.getRoom('room-1');
    expect(result).toEqual(room);
  });

  it('returns null for missing Room', async () => {
    expect(await store.getRoom('nonexistent')).toBeNull();
  });

  it('tracks active rooms', async () => {
    const room1: RoomInfo = { roomId: 'r1', players: [], status: 'waiting', createdAt: 1 };
    const room2: RoomInfo = { roomId: 'r2', players: [], status: 'playing', createdAt: 2 };
    await store.saveRoom('r1', room1);
    await store.saveRoom('r2', room2);
    const active = await store.getAllActiveRooms();
    expect(active.sort()).toEqual(['r1', 'r2']);
  });
});
