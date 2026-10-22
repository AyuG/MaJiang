import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import RedisMock from 'ioredis-mock';
import { RoomManager } from '@/server/room-manager';
import { GameController } from '@/server/game-controller';
import { RedisStore } from '@/store/redis-store';
import { setupSocketHandlers } from '@/server/socket-handler';
import type { ClientEvents, ServerEvents, ClientGameState, ScoreHistoryEntry } from '@/types';

let http: ReturnType<typeof createServer>;
let server: Server<ClientEvents, ServerEvents>;
let client: Socket<ServerEvents, ClientEvents>;
let redis: InstanceType<typeof RedisMock>;
let store: RedisStore;
let rooms: RoomManager;
let controller: GameController;
let roomId: string;
let url: string;

function next<T>(event: string): Promise<T> {
  return new Promise((resolve) => client.once(event as 'game:started', resolve as (state: ClientGameState) => void));
}

beforeEach(async () => {
  redis = new RedisMock();
  await redis.flushall();
  store = new RedisStore(redis as unknown as ConstructorParameters<typeof RedisStore>[0]);
  rooms = new RoomManager();
  controller = new GameController(rooms, store);
  roomId = rooms.createRoom('srv_0');
  for (const id of ['srv_1', 'srv_2', 'srv_3']) rooms.joinRoom(roomId, id);
  await controller.startGame(roomId);
  http = createServer();
  server = new Server(http);
  setupSocketHandlers(server, controller, rooms);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  if (client?.connected) {
    const dissolved = next('room:dissolved');
    client.emit('room:dissolve');
    await dissolved;
    expect(await store.getAllActiveRooms()).not.toContain(roomId);
    client.disconnect();
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  redis.disconnect();
});

async function connect(id: string) {
  client = io(url, { auth: { playerId: id }, transports: ['websocket'], forceNew: true });
  await new Promise<void>((resolve) => client.once('connect', resolve));
}

describe('score recovery over real Socket.IO', () => {
  it('restores round 7, sends missed history and schedules only one next round on repeated reconnect snapshots', async () => {
    const state = (await store.getGameState(roomId))!;
    state.phase = 'DRAW';
    state.roundNumber = 7;
    state.players.forEach((p, i) => { p.score = i === 0 ? -15 : 5; });
    await store.saveGameState(roomId, state);
    const finalization = vi.spyOn(controller, 'finalizeRound');
    await connect('srv_0');
    const history = next<{ scoreHistory: ScoreHistoryEntry[] }>('game:score-history');
    let started = next<ClientGameState>('game:started');
    client.emit('room:join', roomId);
    expect((await started).roundNumber).toBe(7);
    expect((await history).scoreHistory[0].scores.map((s) => s.delta)).toEqual([-15, 5, 5, 5]);
    started = next<ClientGameState>('game:started');
    client.emit('room:join', roomId);
    await started;
    const nextRound = await next<ClientGameState>('game:started');
    expect(nextRound.roundNumber).toBe(8);
    expect(finalization).toHaveBeenCalledTimes(1);
    expect(await store.getScoreLog(roomId)).toHaveLength(1);
    client.emit('room:start'); // cannot reset an active room's score or round number
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await store.getGameState(roomId))?.roundNumber).toBe(8);
  }, 10000);

  it('transfers a substitute baseline and peng source so later bu-gang still charges the right player', async () => {
    const state = (await store.getGameState(roomId))!;
    state.players[0].isConnected = false;
    state.players[0].score = 15;
    state.roundStartScores!['srv_0'] = 15;
    state.players[1].melds = [{ type: 'peng', tiles: state.players[1].hand.slice(0, 3), fromPlayer: 'srv_0' }];
    await store.saveGameState(roomId, state);
    rooms.setPlayerDisconnected(roomId, 'srv_0');
    await connect('srv_new');
    const started = next<ClientGameState>('game:started');
    client.emit('room:join', roomId);
    const snapshot = await started;
    expect(snapshot.players[0].id).toBe('srv_new');
    expect(snapshot.roundStartScores?.srv_new).toBe(15);
    expect(snapshot.roundStartScores?.srv_0).toBeUndefined();
    expect(snapshot.players[1].melds[0].fromPlayer).toBe('srv_new');
  });
});
