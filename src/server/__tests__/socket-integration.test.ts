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
});
