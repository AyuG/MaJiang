import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import { GameController } from '@/server/game-controller';
import { RoomManager } from '@/server/room-manager';
import { RedisStore } from '@/store/redis-store';
import { recoverActiveGames } from '@/server/recovery';
import { toClientState } from '@/server/socket-handler';
import { transition } from '@/engine/state-machine';
import { TileSuit, type GameState } from '@/types';

let redis: InstanceType<typeof RedisMock>;
let store: RedisStore;
let rooms: RoomManager;
let controller: GameController;
let roomId: string;

beforeEach(async () => {
  redis = new RedisMock();
  await redis.flushall();
  store = new RedisStore(redis as unknown as ConstructorParameters<typeof RedisStore>[0]);
  rooms = new RoomManager();
  controller = new GameController(rooms, store);
  roomId = rooms.createRoom('p0');
  for (const id of ['p1', 'p2', 'p3']) rooms.joinRoom(roomId, id);
});
afterEach(() => redis.disconnect());

function ended(state: GameState, deltas: number[], phase: 'WIN' | 'DRAW' = 'WIN'): GameState {
  return { ...state, phase, players: state.players.map((p, i) => ({ ...p, score: p.score + deltas[i] })) };
}

async function finish(state: GameState) {
  await store.saveGameState(roomId, state);
  return controller.finalizeRound(roomId, state, state.roundNumber);
}

function expectScores(record: Awaited<ReturnType<RedisStore['getScoreLog']>>[number], delta: number[], total: number[]) {
  expect(record.scores.map((s) => s.delta)).toEqual(delta);
  expect(record.scores.map((s) => s.total)).toEqual(total);
  expect(record.scores.reduce((sum, s) => sum + s.delta, 0)).toBe(0);
}

describe('persisted round score history', () => {
  it('starts at zero, preserves totals across wins, penalty-only draws and zero-change draws', async () => {
    const first = await controller.startGame(roomId);
    expect(first.roundStartScores).toEqual({ p0: 0, p1: 0, p2: 0, p3: 0 });
    const second = (await finish(ended(first, [15, -5, -5, -5]))).newState!;
    expect(second.roundStartScores).toEqual({ p0: 15, p1: -5, p2: -5, p3: -5 });
    const third = (await finish(ended(second, [-15, 5, 5, 5], 'DRAW'))).newState!;
    const fourth = (await finish(ended(third, [-5, 15, -5, -5]))).newState!;
    await finish(ended(fourth, [0, 0, 0, 0], 'DRAW'));
    const logs = await store.getScoreLog(roomId);
    expect(logs.map((r) => r.round)).toEqual([1, 2, 3, 4]);
    expectScores(logs[0], [15, -5, -5, -5], [15, -5, -5, -5]);
    expectScores(logs[1], [-15, 5, 5, 5], [0, 0, 0, 0]);
    expectScores(logs[2], [-5, 15, -5, -5], [-5, 15, -5, -5]);
    expectScores(logs[3], [0, 0, 0, 0], [-5, 15, -5, -5]);
  });

  it('records a real hu with multiple players ming/an/bu gang scores plus existing penalty', async () => {
    const first = await controller.startGame(roomId);
    const second = (await finish(ended(first, [15, -5, -5, -5]))).newState!;
    const ready = ended(second, [-15, 5, 5, 5]);
    ready.phase = 'TURN';
    ready.currentPlayerIndex = 1;
    ready.players[1].hand = Array.from({ length: 14 }, (_, id) => ({ id, suit: TileSuit.WAN, value: Math.floor(id / 2) + 1 }));
    ready.lastDrawnTileId = 13;
    ready.gangRecords = [
      { type: 'an', gangPlayerIndex: 0 },
      { type: 'ming', gangPlayerIndex: 2, targetPlayerIndex: 3 },
      { type: 'bu', gangPlayerIndex: 3, targetPlayerIndex: 1 },
    ];
    await store.saveGameState(roomId, ready);
    const won = await controller.handlePlayerAction(roomId, 'p1', { type: 'hu' });
    expect(won.phase).toBe('WIN');
    expect(won.gangRecords).toEqual([]);
    const logs = await store.getScoreLog(roomId); // logged immediately, before finalizeRound
    expect(logs).toHaveLength(2);
    expectScores(logs[1], [-5, 10, 0, -5], [10, 5, -5, -10]);
    expect(logs[1].winnerId).toBe('p1'); // p0 still has the highest cumulative score
  });

  it('persists same-step first-discard penalty plus DRAW and clears only pending gangs', async () => {
    let state = await controller.startGame(roomId);
    state.players = state.players.map((p, i) => ({ ...p, hand: [{ id: i, suit: TileSuit.WAN, value: 1 }] }));
    state.wall = [2, 3, 4].map((value, i) => ({ id: 10 + i, suit: TileSuit.TIAO, value }));
    state.gangRecords = [{ type: 'an', gangPlayerIndex: 2 }];
    for (let i = 0; i < 4; i++) state = transition(state, { type: 'discard', tileId: i });
    expect(state.phase).toBe('DRAW');
    await finish(state);
    expectScores((await store.getScoreLog(roomId))[0], [-15, 5, 5, 5], [-15, 5, 5, 5]);
    expect(state.gangRecords).toEqual([]);
  });

  it('survives controller/server recovery and reconnect with the original baseline and round number', async () => {
    const first = await controller.startGame(roomId);
    const second = (await finish(ended(first, [15, -5, -5, -5]))).newState!;
    const penalized = ended(second, [-15, 5, 5, 5], 'DRAW');
    await store.saveGameState(roomId, penalized);
    const recoveredRooms = new RoomManager();
    await recoverActiveGames(store, recoveredRooms);
    expect(recoveredRooms.getRoom(roomId)?.status).toBe('playing');
    controller = new GameController(recoveredRooms, store);
    await controller.handleDisconnect(roomId, 'p2');
    const reconnected = await controller.handleReconnect(roomId, 'p2');
    expect(toClientState(reconnected, 'p2').roundStartScores).toEqual(second.roundStartScores);
    const result = await controller.finalizeRound(roomId, penalized, 2);
    expect(result.newState?.roundNumber).toBe(3);
    expectScores((await store.getScoreLog(roomId))[1], [-15, 5, 5, 5], [0, 0, 0, 0]);
  });

  it('uses latest disconnect flags and records the completed round even when it cannot continue', async () => {
    const state = ended(await controller.startGame(roomId), [15, -5, -5, -5]);
    await store.saveGameState(roomId, state);
    await controller.handleDisconnect(roomId, 'p2');
    expect((await controller.finalizeRound(roomId, state, 1)).canContinue).toBe(false);
    expect(await store.getScoreLog(roomId)).toHaveLength(1);
  });

  it('deduplicates concurrent/repeated finalization without redealing the next round', async () => {
    const state = ended(await controller.startGame(roomId), [15, -5, -5, -5]);
    await store.saveGameState(roomId, state);
    const [a, b] = await Promise.all([
      controller.finalizeRound(roomId, state, 1), controller.finalizeRound(roomId, state, 1),
    ]);
    const c = await controller.finalizeRound(roomId, state, 1);
    expect(a.newState).toEqual(b.newState);
    expect(c.newState).toEqual(a.newState);
    expect(await store.getScoreLog(roomId)).toHaveLength(1);
    expect((await store.getGameState(roomId))?.roundNumber).toBe(2);
  });

  it('atomically rejects conflicting retries without overwriting history', async () => {
    const state = ended(await controller.startGame(roomId), [15, -5, -5, -5]);
    await Promise.all(Array.from({ length: 4 }, () => controller.recordRoundResult(roomId, state)));
    await expect(controller.recordRoundResult(roomId, ended(state, [-15, 5, 5, 5]))).rejects.toThrow('Conflicting');
    expect(await store.getScoreLog(roomId)).toHaveLength(1);
  });

  it('rejects unfinished / wrong-room / wrong-round results', async () => {
    const state = await controller.startGame(roomId);
    await expect(controller.recordRoundResult(roomId, state)).rejects.toThrow('completed round');
    await expect(controller.recordRoundResult('other', ended(state, [15, -5, -5, -5]))).rejects.toThrow('completed round');
    await expect(controller.finalizeRound(roomId, ended(state, [15, -5, -5, -5]), 2)).rejects.toThrow('mismatch');
    expect(await store.getScoreLog(roomId)).toHaveLength(0);
  });

  it('restores legacy baselines from preceding totals, never preceding deltas', async () => {
    const first = await controller.startGame(roomId);
    const second = (await finish(ended(first, [15, -5, -5, -5]))).newState!;
    const third = (await finish(ended(second, [15, -5, -5, -5]))).newState!;
    delete third.roundStartScores;
    await finish(ended(third, [0, 0, 0, 0], 'DRAW'));
    expectScores((await store.getScoreLog(roomId))[2], [0, 0, 0, 0], [30, -10, -10, -10]);
  });

  it('allows legacy first-round zero baseline but refuses unknown later baselines', async () => {
    const state = await controller.startGame(roomId);
    delete state.roundStartScores;
    await controller.recordRoundResult(roomId, ended(state, [-15, 5, 5, 5], 'DRAW'));
    await expect(controller.recordRoundResult(roomId, { ...ended(state, [0, 0, 0, 0], 'DRAW'), roundNumber: 3 })).rejects.toThrow('Missing round-start');
  });

  it('rejects same-room restart and starts a new room at zero without mixing histories', async () => {
    const state = await controller.startGame(roomId);
    await finish(ended(state, [15, -5, -5, -5]));
    await expect(controller.startGame(roomId)).rejects.toThrow('already exists');
    const nextRoom = rooms.createRoomWithPlayers(rooms.getRoom(roomId)!.players);
    const fresh = await controller.startGame(nextRoom);
    expect(fresh.roundNumber).toBe(1);
    expect(fresh.players.map((p) => p.score)).toEqual([0, 0, 0, 0]);
    expect(await store.getScoreLog(nextRoom)).toEqual([]);
    expect(await store.getScoreLog(roomId)).toHaveLength(1);
  });
});
