import { createHash } from 'node:crypto';
import { copyFile, cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Redis from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { IsolatedRedis } from '@/server/__tests__/helpers/isolated-redis';
import { GameController } from '@/server/game-controller';
import { RoomManager } from '@/server/room-manager';
import { recoverActiveGames } from '@/server/recovery';
import { RedisStore } from '@/store/redis-store';
import { TileSuit, type GameState } from '@/types';

const instances: IsolatedRedis[] = [];
function instance(mode: 'rdb' | 'aof' = 'rdb') {
  const server = new IsolatedRedis(mode);
  instances.push(server);
  return server;
}
afterEach(async () => { await Promise.all(instances.splice(0).map((server) => server.cleanup())); });

async function persistence(redis: Redis) {
  return Object.fromEntries((await redis.info('persistence')).split('\r\n')
    .filter((line) => line.includes(':')).map((line) => line.split(':')));
}
async function waitForAof(redis: Redis) {
  await expect.poll(async () => {
    const info = await persistence(redis);
    return [info.aof_enabled, info.aof_rewrite_in_progress, info.aof_rewrite_scheduled, info.aof_last_bgrewrite_status, info.aof_last_write_status];
  }, { timeout: 8000, interval: 25 }).toEqual(['1', '0', '0', 'ok', 'ok']);
}
async function enableAof(redis: Redis) {
  await redis.config('SET', 'appendfsync', 'always');
  await redis.config('SET', 'appendonly', 'yes');
  await waitForAof(redis);
  await redis.config('REWRITE');
}
async function win(controller: GameController, store: RedisStore, state: GameState) {
  state.currentPlayerIndex = 0;
  state.players[0].hand = Array.from({ length: 14 }, (_, id) => ({ id, suit: TileSuit.WAN, value: Math.floor(id / 2) + 1 }));
  state.lastDrawnTileId = 13;
  await store.saveGameState(state.roomId, state);
  return controller.handlePlayerAction(state.roomId, 'p0', { type: 'hu' });
}
async function seed(redis: Redis) {
  const store = new RedisStore(redis);
  const rooms = new RoomManager();
  const controller = new GameController(rooms, store);
  const id = rooms.createRoom('p0');
  for (const player of ['p1', 'p2', 'p3']) rooms.joinRoom(id, player);
  const first = await win(controller, store, await controller.startGame(id));
  const { newState: second } = await controller.finalizeRound(id, first, 1);
  const state = second!;
  // Final first discard matches and exhausts the wall; pending gang must vanish.
  state.currentPlayerIndex = 3;
  state.wall = [];
  state.players.forEach((p) => { p.hand = []; });
  state.players[3].hand = Array.from({ length: 14 }, (_, id) => ({ id: 20 + id, suit: TileSuit.TIAO, value: id % 9 + 1 }));
  state.players[3].hand[0] = { id: 3, suit: TileSuit.WAN, value: 1 };
  state.actionLog = [0, 1, 2].map((i) => ({ timestamp: i, playerIndex: i, action: 'discard', tileId: i }));
  state.dealerFirstDiscard = { suit: TileSuit.WAN, value: 1 };
  state.dealerFirstMatchCount = 2;
  state.gangRecords = [{ type: 'an', gangPlayerIndex: 2 }];
  await store.saveGameState(id, state);
  await controller.handlePlayerAction(id, 'p3', { type: 'discard', tileId: 3 });
  return { store, controller, id };
}

/** Exact game/room/history contents plus absolute expiry, rather than resetting TTL on restore. */
async function audit(redis: Redis, id: string) {
  const store = new RedisStore(redis);
  const state = (await store.getGameState(id))!;
  const records = await store.getScoreLog(id);
  expect(records.map((r) => r.round)).toEqual(Array.from({ length: records.length }, (_, i) => i + 1));
  const totals = new Map<string, number>();
  for (const record of records) {
    expect(record.scores.reduce((sum, s) => sum + s.delta, 0)).toBe(0);
    for (const score of record.scores) {
      expect((totals.get(score.playerId) ?? 0) + score.delta).toBe(score.total);
      totals.set(score.playerId, score.total);
    }
  }
  expect(state.roundNumber).toBe(records.at(-1)!.round);
  for (const player of state.players) {
    expect(player.score).toBe(totals.get(player.id));
    expect(player.score - state.roundStartScores![player.id]).toBe(records.at(-1)!.scores.find((s) => s.playerId === player.id)!.delta);
  }
  return {
    state, records, room: await store.getRoom(id), active: (await store.getAllActiveRooms()).sort(),
    expiresAt: await redis.call('PEXPIRETIME', `score:${id}`), keyCount: await redis.dbsize(),
  };
}
async function checksums(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir(directory)).sort()) {
    result[name] = createHash('sha256').update(await readFile(join(directory, name))).digest('hex');
  }
  return result;
}

describe('isolated RDB to AOF migration and backup restore', () => {
  it('migrates existing scores online, persists configuration and retains new acknowledged rounds after SIGKILL', async () => {
    const source = instance();
    await source.start();
    let redis = source.client();
    const { store, controller, id } = await seed(redis);
    const before = await audit(redis, id);
    expect(before.records.map((r) => r.scores.map((s) => s.delta))).toEqual([[15, -5, -5, -5], [-15, 5, 5, 5]]);
    await redis.save();
    // RDB remains at round 2 while AOF receives a genuinely new round 3.
    await enableAof(redis);
    expect(await audit(redis, id)).toEqual(before);
    const { newState } = await controller.finalizeRound(id, before.state, 2);
    await win(controller, store, newState!);
    const after = await audit(redis, id);
    expect(after.state.roundNumber).toBe(3);
    expect(after.state.players.map((p) => p.score)).toEqual([15, -5, -5, -5]);
    await source.stop('SIGKILL');
    await source.start();
    redis = source.client();
    expect(await redis.config('GET', 'appendonly')).toEqual(['appendonly', 'yes']);
    expect(await redis.config('GET', 'appendfsync')).toEqual(['appendfsync', 'always']);
    expect(await audit(redis, id)).toEqual(after);
    const recoveredRooms = new RoomManager();
    const [recovered] = await recoverActiveGames(new RedisStore(redis), recoveredRooms);
    await new GameController(recoveredRooms, new RedisStore(redis)).recordRoundResult(id, recovered);
    expect(await new RedisStore(redis).getScoreLog(id)).toEqual(after.records);
    expect(recovered.players.every((p) => !p.isConnected)).toBe(true);
  });

  it('restores an RDB checkpoint into a clean instance and can migrate that rollback copy without replaying settlement', async () => {
    const source = instance();
    const restored = instance();
    await source.start();
    const redis = source.client();
    const { id, store, controller } = await seed(redis);
    const checkpoint = await audit(redis, id);
    await redis.save(); // tiny isolated fixture; production procedure uses BGSAVE
    await restored.prepare();
    const backupPath = join(restored.directory, 'dump.rdb');
    await copyFile(join(source.directory, 'dump.rdb'), backupPath);
    expect(createHash('sha256').update(await readFile(backupPath)).digest('hex')).toBe(
      createHash('sha256').update(await readFile(join(source.directory, 'dump.rdb'))).digest('hex'));
    await enableAof(redis);
    const { newState } = await controller.finalizeRound(id, checkpoint.state, 2);
    await win(controller, store, newState!);
    expect((await audit(redis, id)).records).toHaveLength(3);
    // Remove the source process so the restore cannot accidentally read its memory.
    await source.stop('SIGKILL');
    await restored.start();
    const restoredRedis = restored.client();
    expect(await audit(restoredRedis, id)).toEqual(checkpoint); // round 3 is outside this backup's recovery point
    await enableAof(restoredRedis);
    await restored.stop('SIGKILL');
    await restored.start();
    expect(await audit(restored.client(), id)).toEqual(checkpoint);
  });

  it('restores the full Redis 7 multipart AOF backup including post-rewrite scores and original expiry', async () => {
    const source = instance();
    const restored = instance('aof');
    await source.start();
    const redis = source.client();
    const { store, controller, id } = await seed(redis);
    await enableAof(redis);
    const { newState } = await controller.finalizeRound(id, (await store.getGameState(id))!, 2);
    await win(controller, store, newState!); // incremental AOF beyond its round-2 base
    const expected = await audit(redis, id);
    const prior = await redis.config('GET', 'auto-aof-rewrite-percentage') as string[];
    await redis.config('SET', 'auto-aof-rewrite-percentage', '0');
    try {
      await waitForAof(redis);
      // No application writers are running while copying this fixture.
      await restored.prepare();
      const from = join(source.directory, 'appendonlydir');
      const to = join(restored.directory, 'appendonlydir');
      const manifest = await checksums(from);
      expect(Object.keys(manifest).some((name) => name.endsWith('.manifest'))).toBe(true);
      expect(Object.keys(manifest).some((name) => name.includes('.base.'))).toBe(true);
      expect(Object.keys(manifest).some((name) => name.includes('.incr.'))).toBe(true);
      await cp(from, to, { recursive: true, errorOnExist: true, force: false });
      expect(await checksums(to)).toEqual(manifest);
    } finally {
      await redis.config('SET', 'auto-aof-rewrite-percentage', prior[1]);
    }
    expect(await redis.config('GET', 'auto-aof-rewrite-percentage')).toEqual(prior);
    await source.stop('SIGKILL');
    await restored.start(); // no dump.rdb exists in this fresh target
    expect(await audit(restored.client(), id)).toEqual(expected);
  });

  it('demonstrates why enabling AOF only in startup configuration is not an RDB migration', async () => {
    const source = instance();
    await source.start();
    const redis = source.client();
    const { id } = await seed(redis);
    await redis.save();
    expect((await audit(redis, id)).records).toHaveLength(2);
    await source.stop('SIGKILL');
    const config = join(source.directory, 'redis.conf');
    await writeFile(config, (await readFile(config, 'utf8')).replace('appendonly no', 'appendonly yes'));
    await source.start();
    const unsafe = new RedisStore(source.client());
    expect(await unsafe.getGameState(id)).toBeNull();
    expect(await unsafe.getScoreLog(id)).toEqual([]);
    // The RDB backup still exists; Redis started from the newly empty AOF instead.
    expect((await readFile(join(source.directory, 'dump.rdb'))).length).toBeGreaterThan(0);
  });
});
