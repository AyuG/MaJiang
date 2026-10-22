import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { RedisStore } from '@/store/redis-store';
import { GameController } from '@/server/game-controller';
import { RoomManager } from '@/server/room-manager';
import { recoverActiveGames } from '@/server/recovery';
import { TileSuit, type GameState } from '@/types';
import { IsolatedRedis } from '@/server/__tests__/helpers/isolated-redis';

const sandbox = new IsolatedRedis();
let redis: Redis;
let store: RedisStore;
let rooms: RoomManager;
let controller: GameController;
let roomId: string;

beforeAll(async () => { await sandbox.start(); });
afterAll(async () => { await sandbox.cleanup(); });
beforeEach(async () => {
  vi.restoreAllMocks();
  redis = sandbox.client();
  await redis.flushdb(); // only this suite's newly spawned Unix-socket process
  store = new RedisStore(redis);
  rooms = new RoomManager();
  controller = new GameController(rooms, store);
  roomId = rooms.createRoom('p0');
  for (const id of ['p1', 'p2', 'p3']) rooms.joinRoom(roomId, id);
});

async function winningState(): Promise<GameState> {
  const state = await controller.startGame(roomId);
  state.players[0].hand = Array.from({ length: 14 }, (_, id) => ({ id, suit: TileSuit.WAN, value: Math.floor(id / 2) + 1 }));
  state.currentPlayerIndex = 0;
  state.lastDrawnTileId = 13;
  await store.saveGameState(roomId, state);
  return state;
}

describe('real Redis score durability', () => {
  it('does not leave a terminal snapshot without its score log when the commit command fails', async () => {
    const before = await winningState();
    const fault = vi.spyOn(redis, 'eval').mockRejectedValueOnce(new Error('injected transport failure before commit'));
    await expect(controller.handlePlayerAction(roomId, 'p0', { type: 'hu' })).rejects.toThrow('injected transport failure');
    fault.mockRestore();
    expect(await store.getGameState(roomId)).toEqual(before);
    expect(await store.getScoreLog(roomId)).toEqual([]);
    await controller.handlePlayerAction(roomId, 'p0', { type: 'hu' });
    expect((await store.getGameState(roomId))?.phase).toBe('WIN');
    expect(await store.getScoreLog(roomId)).toHaveLength(1);
  });

  it('cannot roll a hu back when a simultaneous disconnect writes an older snapshot', async () => {
    await winningState();
    const original = store.getGameState.bind(store);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const read = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(store, 'getGameState').mockImplementationOnce(async (id) => {
      const state = await original(id);
      entered();
      await gate;
      return state;
    });
    const disconnected = controller.handleDisconnect(roomId, 'p1');
    await read;
    const won = controller.handlePlayerAction(roomId, 'p0', { type: 'hu' });
    // A serialized implementation queues hu; the old implementation completes it
    // while disconnect is holding a stale read, then overwrites it when released.
    await Promise.race([won, new Promise((resolve) => setTimeout(resolve, 50))]);
    release();
    await Promise.all([disconnected, won]);
    const saved = (await store.getGameState(roomId))!;
    expect(saved.phase).toBe('WIN');
    expect(saved.players[1].isConnected).toBe(false);
    expect(saved.players.map((p) => p.score)).toEqual([15, -5, -5, -5]);
    expect(await store.getScoreLog(roomId)).toHaveLength(1);
  });

  it('deduplicates score writes from independent Redis connections and rejects conflicts', async () => {
    const state = await winningState();
    state.phase = 'DRAW';
    state.players.forEach((p, i) => { p.score = i === 0 ? -15 : 5; });
    const other = new GameController(rooms, new RedisStore(sandbox.client()));
    await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? other : controller).recordRoundResult(roomId, state)));
    expect(await store.getScoreLog(roomId)).toHaveLength(1);
    expect(await redis.ttl(`score:${roomId}`)).toBeGreaterThan(604790);
    const conflict = { ...state, players: state.players.map((p) => ({ ...p, score: 0 })) };
    await expect(other.recordRoundResult(roomId, conflict)).rejects.toThrow('Conflicting');
    expect((await store.getScoreLog(roomId))[0].scores.map((s) => s.delta)).toEqual([-15, 5, 5, 5]);
  });

  it('retains completed scores through SIGKILL and AOF recovery of the isolated Redis process', async () => {
    await winningState();
    await controller.handlePlayerAction(roomId, 'p0', { type: 'hu' });
    const before = await store.getScoreLog(roomId);
    await sandbox.stop('SIGKILL');
    await sandbox.start();
    store = new RedisStore(sandbox.client());
    const restoredRooms = new RoomManager();
    const [snapshot] = await recoverActiveGames(store, restoredRooms);
    const restored = new GameController(restoredRooms, store);
    await restored.recordRoundResult(roomId, snapshot);
    expect(await store.getScoreLog(roomId)).toEqual(before);
    expect(snapshot.players.map((p) => p.score)).toEqual([15, -5, -5, -5]);
  });

  it('ignores a stale timeout for a previous player even when the phase still matches', async () => {
    const state = await winningState();
    const result = await controller.handleTimeout(roomId, 'p3', 'TURN');
    expect(result).toEqual(state);
    expect(await store.getScoreLog(roomId)).toEqual([]);
  });
});


describe('application interruption and retry boundaries', () => {
  it.each(['before', 'after'] as const)('survives SIGKILL %s the atomic commit', async (boundary) => {
    const initial = await winningState();
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('tests/redis/crash-worker.ts'), sandbox.socket, roomId, boundary], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let errors = '';
    child.stderr!.on('data', (chunk) => { errors += chunk.toString(); });
    try {
      await new Promise<void>((resolveReady, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Worker did not reach ${boundary}: ${errors}`)), 8000);
        child.once('message', (message) => {
          clearTimeout(timeout);
          if (message === boundary) resolveReady();
          else reject(new Error(`Unexpected boundary: ${String(message)}`));
        });
        child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Worker exited ${code}: ${errors}`)); });
        child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
    }
    const recoveredRooms = new RoomManager();
    const [saved] = await recoverActiveGames(store, recoveredRooms);
    const recovered = new GameController(recoveredRooms, store);
    if (boundary === 'before') {
      expect(saved.phase).toBe('TURN');
      expect(saved.players.map((p) => p.score)).toEqual(initial.players.map((p) => p.score));
      expect(await store.getScoreLog(roomId)).toEqual([]);
      await recovered.handlePlayerAction(roomId, 'p0', { type: 'hu' });
    } else {
      expect(saved.phase).toBe('WIN');
      expect(await store.getScoreLog(roomId)).toHaveLength(1);
      await recovered.recordRoundResult(roomId, saved);
    }
    const records = await store.getScoreLog(roomId);
    expect(records).toHaveLength(1);
    expect(records[0].scores.map((entry) => entry.delta)).toEqual([15, -5, -5, -5]);
  });

  it('handles a committed write whose acknowledgement is lost without duplicating settlement', async () => {
    await winningState();
    const evaluate = redis.eval.bind(redis);
    vi.spyOn(redis, 'eval').mockImplementationOnce(async (...args: Parameters<Redis['eval']>) => {
      await evaluate(...args);
      throw new Error('injected lost acknowledgement');
    });
    await expect(controller.handlePlayerAction(roomId, 'p0', { type: 'hu' })).rejects.toThrow('lost acknowledgement');
    vi.restoreAllMocks();
    const saved = (await store.getGameState(roomId))!;
    expect(saved.phase).toBe('WIN');
    await controller.handleReconnect(roomId, 'p0');
    await controller.recordRoundResult(roomId, saved);
    expect(await store.getScoreLog(roomId)).toHaveLength(1);
    expect((await store.getGameState(roomId))?.players.map((p) => p.score)).toEqual([15, -5, -5, -5]);
  });

  it('rejects old-round and old-turn timeouts even for the same dealer', async () => {
    const state = await winningState();
    for (const expected of [{ roundNumber: 0, turnCount: state.turnCount }, { roundNumber: 1, turnCount: 0 }]) {
      expect(await controller.handleTimeout(roomId, 'p0', 'TURN', expected)).toEqual(state);
    }
    expect(await store.getScoreLog(roomId)).toEqual([]);
  });

  it('does not assume persisted connection flags are live sockets after a process restart', async () => {
    await winningState();
    await controller.handlePlayerAction(roomId, 'p0', { type: 'hu' });
    const recoveredRooms = new RoomManager();
    await recoverActiveGames(store, recoveredRooms);
    const recovered = new GameController(recoveredRooms, store);
    const onlyOneBack = await recovered.handleReconnect(roomId, 'p0');
    expect(onlyOneBack.players.map((p) => p.isConnected)).toEqual([true, false, false, false]);
    expect((await recovered.finalizeRound(roomId, onlyOneBack, 1)).canContinue).toBe(false);
    expect(await store.getScoreLog(roomId)).toHaveLength(1);
  });

  it('fills a legacy terminal snapshot gap before dissolving and disabling recovery', async () => {
    const terminal = await winningState();
    terminal.phase = 'DRAW';
    terminal.players.forEach((p, i) => { p.score = i === 0 ? -15 : 5; });
    await store.saveGameState(roomId, terminal); // legacy split-write crash window
    await controller.closeRoom(roomId);
    expect((await store.getScoreLog(roomId))[0].scores.map((s) => s.delta)).toEqual([-15, 5, 5, 5]);
    expect(await store.getAllActiveRooms()).not.toContain(roomId);
    expect(rooms.getRoom(roomId)).toBeNull();
  });
});


describe('penalty boundaries and failure isolation', () => {
  it('preserves a last-discard penalty draw during a simultaneous disconnect with a nonzero baseline', async () => {
    const state = await controller.startGame(roomId);
    const baseline = [15, -5, -5, -5];
    state.players.forEach((p, i) => { p.score = baseline[i]; p.hand = []; });
    state.roundStartScores = Object.fromEntries(state.players.map((p) => [p.id, p.score]));
    state.currentPlayerIndex = 3;
    state.wall = [];
    state.players[3].hand = Array.from({ length: 14 }, (_, id) => ({ id: 20 + id, suit: TileSuit.TIAO, value: id % 9 + 1 }));
    state.players[3].hand[0] = { id: 3, suit: TileSuit.WAN, value: 1 };
    state.actionLog = [0, 1, 2].map((i) => ({ timestamp: i, playerIndex: i, action: 'discard', tileId: i }));
    state.dealerFirstDiscard = { suit: TileSuit.WAN, value: 1 };
    state.dealerFirstMatchCount = 2;
    state.gangRecords = [{ type: 'an', gangPlayerIndex: 2 }];
    await store.saveGameState(roomId, state);
    await Promise.all([
      controller.handlePlayerAction(roomId, 'p3', { type: 'discard', tileId: 3 }),
      controller.handleDisconnect(roomId, 'p1'),
    ]);
    const saved = (await store.getGameState(roomId))!;
    expect(saved.phase).toBe('DRAW');
    expect(saved.gangRecords).toEqual([]);
    expect(saved.players[1].isConnected).toBe(false);
    const [record] = await store.getScoreLog(roomId);
    expect(record.scores.map((s) => s.delta)).toEqual([-15, 5, 5, 5]);
    expect(record.scores.map((s) => s.total)).toEqual([0, 0, 0, 0]);
  });

  it('commits first-round state and its recovery registration together and permits a failed-start retry', async () => {
    vi.spyOn(redis, 'eval').mockRejectedValueOnce(new Error('injected start failure'));
    await expect(controller.startGame(roomId)).rejects.toThrow('injected start failure');
    expect(await store.getGameState(roomId)).toBeNull();
    expect(await store.getAllActiveRooms()).not.toContain(roomId);
    expect(rooms.getRoom(roomId)?.status).toBe('waiting');
    vi.restoreAllMocks();
    await controller.startGame(roomId);
    expect((await store.getGameState(roomId))?.roundNumber).toBe(1);
    expect(await store.getAllActiveRooms()).toContain(roomId);
  });

  it('keeps terminal recovery available if backfilling its log fails during dissolution', async () => {
    const state = await winningState();
    state.phase = 'DRAW';
    await store.saveGameState(roomId, state);
    vi.spyOn(redis, 'eval').mockRejectedValueOnce(new Error('injected close failure'));
    await expect(controller.closeRoom(roomId)).rejects.toThrow('injected close failure');
    expect(await store.getAllActiveRooms()).toContain(roomId);
    expect(rooms.getRoom(roomId)).not.toBeNull();
    vi.restoreAllMocks();
    await controller.closeRoom(roomId);
    expect(await store.getScoreLog(roomId)).toHaveLength(1);
  });

  it('demonstrates that default RDB without a completed snapshot loses acknowledged scores on SIGKILL', async () => {
    const defaultRedis = new IsolatedRedis('rdb');
    try {
      await defaultRedis.start();
      const connection = defaultRedis.client();
      const rdbStore = new RedisStore(connection);
      const rdbRooms = new RoomManager();
      const id = rdbRooms.createRoom('p0');
      for (const player of ['p1', 'p2', 'p3']) rdbRooms.joinRoom(id, player);
      const rdbController = new GameController(rdbRooms, rdbStore);
      const state = await rdbController.startGame(id);
      state.phase = 'DRAW';
      state.players.forEach((p, i) => { p.score = i === 0 ? -15 : 5; });
      await rdbController.recordRoundResult(id, state);
      expect(await rdbStore.getScoreLog(id)).toHaveLength(1);
      expect(await connection.config('GET', 'appendonly')).toEqual(['appendonly', 'no']);
      await defaultRedis.stop('SIGKILL');
      await defaultRedis.start();
      const recoveredStore = new RedisStore(defaultRedis.client());
      expect(await recoveredStore.getScoreLog(id)).toEqual([]);
      expect(await recoveredStore.getGameState(id)).toBeNull();
    } finally {
      await defaultRedis.cleanup();
    }
  });
});
