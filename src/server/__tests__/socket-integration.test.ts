import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import RedisMock from 'ioredis-mock';

import type { ClientEvents, ServerEvents, ClientGameState } from '@/types';
import { RedisStore } from '@/store/redis-store';
import { RoomManager } from '@/server/room-manager';
import { GameController } from '@/server/game-controller';
import { setupSocketHandlers } from '@/server/socket-handler';
import { createTileSet, shuffle } from '@/engine/tile-set';
import type { MockWallConfig } from '@/engine/mock-wall';

function waitForEvent<T>(socket: ClientSocket<ServerEvents, ClientEvents>, event: string): Promise<T> {
  return new Promise((resolve) => {
    // Using internal once method for test utility
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket as any).once(event, (data: T) => resolve(data));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Socket.io integration', () => {
  let httpServer: HttpServer;
  let ioServer: Server<ClientEvents, ServerEvents>;
  let port: number;
  let clients: ClientSocket<ServerEvents, ClientEvents>[];
  let redisStore: RedisStore;
  let roomManager: RoomManager;
  let gameController: GameController;

  beforeAll(async () => {
    // Set up Redis mock
    const redisMock = new RedisMock();
    // ioredis-mock has compatible runtime API but different type signature
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    redisStore = new RedisStore(redisMock as any);

    // Set up room manager
    roomManager = new RoomManager();

    // Create a deterministic mock wall for testing
    const seed = 42;
    const tiles = createTileSet();
    const wall = shuffle(tiles, seed);
    const mockWallConfig: MockWallConfig = { mode: 'full', tiles: wall };

    gameController = new GameController(roomManager, redisStore, mockWallConfig);

    // Create HTTP + Socket.io server
    httpServer = createServer();
    ioServer = new Server<ClientEvents, ServerEvents>(httpServer, {
      cors: { origin: '*' },
    });

    setupSocketHandlers(ioServer, gameController, roomManager);

    // Listen on random port
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;

    clients = [];
  });

  afterAll(async () => {
    // Close all clients
    for (const c of clients) {
      if (c.connected) c.disconnect();
    }
    // Close server
    ioServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function createClient(): ClientSocket<ServerEvents, ClientEvents> {
    const client = ioc(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
    }) as ClientSocket<ServerEvents, ClientEvents>;
    clients.push(client);
    return client;
  }

  async function waitConnected(client: ClientSocket<ServerEvents, ClientEvents>): Promise<void> {
    if (client.connected) return;
    await new Promise<void>((resolve) => {
      client.on('connect', () => resolve());
    });
  }

  it('should run a full room creation, join, ready, start, and discard flow', async () => {
    // 1. Create 4 clients
    const c1 = createClient();
    const c2 = createClient();
    const c3 = createClient();
    const c4 = createClient();

    await Promise.all([
      waitConnected(c1),
      waitConnected(c2),
      waitConnected(c3),
      waitConnected(c4),
    ]);

    // 2. Player 1 creates a room
    const roomCreatedPromise = waitForEvent<string>(c1, 'room:created');
    c1.emit('room:create');
    const roomId = await roomCreatedPromise;
    expect(roomId).toBeTruthy();

    // 3. Players 2-4 join the room
    const joinPromises = [
      waitForEvent(c1, 'room:joined'),
      waitForEvent(c2, 'room:joined'),
    ];
    c2.emit('room:join', roomId);
    await Promise.all(joinPromises);

    const joinPromises2 = [
      waitForEvent(c1, 'room:joined'),
      waitForEvent(c3, 'room:joined'),
    ];
    c3.emit('room:join', roomId);
    await Promise.all(joinPromises2);

    const joinPromises3 = [
      waitForEvent(c1, 'room:joined'),
      waitForEvent(c4, 'room:joined'),
    ];
    c4.emit('room:join', roomId);
    await Promise.all(joinPromises3);

    // 4. All 4 players send room:ready
    // Set up game:started listeners before sending ready
    const startedPromises = [
      waitForEvent<ClientGameState>(c1, 'game:started'),
      waitForEvent<ClientGameState>(c2, 'game:started'),
      waitForEvent<ClientGameState>(c3, 'game:started'),
      waitForEvent<ClientGameState>(c4, 'game:started'),
    ];

    c1.emit('room:ready');
    c2.emit('room:ready');
    c3.emit('room:ready');
    // Small delay to ensure order
    await delay(50);
    c4.emit('room:ready');

    // Wait for all ready to be processed
    await delay(100);

    // Owner (c1) starts the game
    c1.emit('room:start');

    // 5. Verify game:started is received by all
    const [s1, s2, s3, s4] = await Promise.all(startedPromises);

    expect(s1.phase).toBe('TURN');
    expect(s2.phase).toBe('TURN');
    expect(s3.phase).toBe('TURN');
    expect(s4.phase).toBe('TURN');
    expect(s1.roomId).toBe(roomId);

    // Each player should see their own hand
    expect(s1.myHand.length).toBeGreaterThan(0);

    // 6. Dealer discards a tile
    // The dealer is currentPlayerIndex — find which client is the dealer
    const dealerIndex = s1.dealerIndex;
    const allClients = [c1, c2, c3, c4];

    // The dealer's client is the one whose myHand has 14 tiles (dealer gets extra)
    const states = [s1, s2, s3, s4];
    let dealerClient: ClientSocket<ServerEvents, ClientEvents> | null = null;
    let dealerState: ClientGameState | null = null;

    for (let i = 0; i < 4; i++) {
      if (states[i].myHand.length === 14) {
        dealerClient = allClients[i];
        dealerState = states[i];
        break;
      }
    }

    expect(dealerClient).not.toBeNull();
    expect(dealerState).not.toBeNull();

    // Set up state-update listeners
    const updatePromises = allClients.map((c) =>
      waitForEvent<ClientGameState>(c, 'game:state-update'),
    );

    // Dealer discards the first tile in hand
    const tileToDiscard = dealerState!.myHand[0];
    dealerClient!.emit('game:discard', tileToDiscard.id);

    // 7. Verify game:state-update is received by all
    const updates = await Promise.all(updatePromises);
    for (const u of updates) {
      expect(u.roomId).toBe(roomId);
      // Phase should be AWAITING (other players may act) or TURN (next player)
      expect(['TURN', 'AWAITING']).toContain(u.phase);
    }
  }, 15000);

  it('should generate server-side player ID on first connection', async () => {
    const client = createClient();

    // Set up listener before waiting for connection
    const identityPromise = waitForEvent<{ playerId: string; nickname: string }>(client, 'player:identity');
    await waitConnected(client);

    const identity = await identityPromise;

    // Server-generated IDs should start with 'srv_'
    expect(identity.playerId).toMatch(/^srv_/);
    expect(identity.nickname).toBeTruthy();

    client.disconnect();
  }, 15000);

  it('should preserve player ID across reconnections', async () => {
    const client1 = createClient();
    const identityPromise1 = waitForEvent<{ playerId: string; nickname: string }>(client1, 'player:identity');
    await waitConnected(client1);

    const identity1 = await identityPromise1;
    const playerId = identity1.playerId;

    // Disconnect and reconnect with the same ID
    client1.disconnect();
    await delay(100);

    const client2 = ioc(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      auth: { playerId, nickname: 'TestPlayer' },
    }) as ClientSocket<ServerEvents, ClientEvents>;
    clients.push(client2);

    const identityPromise2 = waitForEvent<{ playerId: string; nickname: string }>(client2, 'player:identity');
    await waitConnected(client2);

    const identity2 = await identityPromise2;

    // Should have received the same player ID back
    expect(identity2.playerId).toBe(playerId);
    expect(identity2.nickname).toBe('TestPlayer');

    client2.disconnect();
  }, 15000);

  it('should broadcast room list to connected clients', async () => {
    const client = createClient();
    const roomListPromise1 = waitForEvent<Array<{ roomId: string; playerCount: number; status: string }>>(client, 'room:list');
    await waitConnected(client);

    // Wait for initial room list
    const roomList1 = await roomListPromise1;
    expect(Array.isArray(roomList1)).toBe(true);

    // Create a room
    const roomCreatedPromise = waitForEvent<string>(client, 'room:created');
    const roomListPromise2 = waitForEvent<Array<{ roomId: string; playerCount: number; status: string }>>(client, 'room:list');
    client.emit('room:create');
    const roomId = await roomCreatedPromise;

    // Should receive updated room list
    const roomList2 = await roomListPromise2;
    expect(roomList2.length).toBeGreaterThan(0);

    // Find our room in the list
    const ourRoom = roomList2.find((r) => r.roomId === roomId);
    expect(ourRoom).toBeDefined();
    expect(ourRoom!.playerCount).toBeGreaterThanOrEqual(1);
    expect(ourRoom!.status).toBe('waiting');

    client.disconnect();
  }, 15000);

});
