import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import RedisMock from 'ioredis-mock';

import type { ClientEvents, ServerEvents, ClientGameState } from '@/types';
import { RedisStore } from '@/store/redis-store';
import { RoomManager } from '@/server/room-manager';
import { GameController } from '@/server/game-controller';
import { setupSocketHandlers } from '@/server/socket-handler';
import { createTileSet } from '@/engine/tile-set';
import type { MockWallConfig } from '@/types';

function waitForEvent<T>(
  socket: ClientSocket<ServerEvents, ClientEvents>,
  event: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, 10000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket as any).once(event, (data: T) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Integration tests for full game flow through Socket.IO
 * Each test creates its own server instance for isolation
 */
describe('Full Game Flow Integration Tests', () => {
  // These tests focus on critical paths that aren't covered by other tests
  // Room management, vote dissolve, etc. are already tested in room-manager.property.test.ts
  // Socket connection/reconnection is tested in socket-integration.test.ts

  describe('Complete Room Lifecycle', () => {
    let httpServer: HttpServer;
    let ioServer: Server<ClientEvents, ServerEvents>;
    let port: number;
    let clients: ClientSocket<ServerEvents, ClientEvents>[];

    beforeAll(async () => {
      httpServer = createServer();
      ioServer = new Server<ClientEvents, ServerEvents>(httpServer, {
        cors: { origin: '*' },
      });

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => resolve());
      });
      const addr = httpServer.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;

      clients = [];
    });

    afterAll(async () => {
      for (const c of clients) {
        if (c.connected) c.disconnect();
      }
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

    async function waitConnected(
      client: ClientSocket<ServerEvents, ClientEvents>,
    ): Promise<void> {
      if (client.connected) return;
      await new Promise<void>((resolve) => {
        client.on('connect', () => resolve());
      });
    }

    it('should handle room creation, join, ready, and start', async () => {
      // Create fresh Redis and RoomManager for this test
      const redisMock = new RedisMock();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const redisStore = new RedisStore(redisMock as any);
      const roomManager = new RoomManager();

      const tiles = createTileSet();
      const mockConfig: MockWallConfig = { mode: 'full', tiles };
      const gameController = new GameController(roomManager, redisStore, mockConfig);
      setupSocketHandlers(ioServer, gameController, roomManager);

      const c1 = createClient();
      const c2 = createClient();
      const c3 = createClient();
      const c4 = createClient();

      await Promise.all([waitConnected(c1), waitConnected(c2), waitConnected(c3), waitConnected(c4)]);

      // Create room
      const roomCreated = waitForEvent<string>(c1, 'room:created');
      c1.emit('room:create');
      const roomId = await roomCreated;
      expect(roomId).toBeTruthy();

      // Join room
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

      // Ready up
      c1.emit('room:ready');
      c2.emit('room:ready');
      c3.emit('room:ready');
      c4.emit('room:ready');

      await delay(100);

      // Start game
      const startedPromises = [
        waitForEvent<ClientGameState>(c1, 'game:started'),
        waitForEvent<ClientGameState>(c2, 'game:started'),
        waitForEvent<ClientGameState>(c3, 'game:started'),
        waitForEvent<ClientGameState>(c4, 'game:started'),
      ];

      c1.emit('room:start');

      const states = await Promise.all(startedPromises);

      // Verify game started
      states.forEach((s) => {
        expect(s.phase).toBe('TURN');
        expect(s.roomId).toBe(roomId);
      });

      // Find dealer (has 14 tiles)
      let dealerClient: ClientSocket<ServerEvents, ClientEvents> | null = null;
      let dealerState: ClientGameState | null = null;

      for (let i = 0; i < 4; i++) {
        if (states[i].myHand.length === 14) {
          dealerClient = [c1, c2, c3, c4][i];
          dealerState = states[i];
          break;
        }
      }

      expect(dealerClient).not.toBeNull();
      expect(dealerState).not.toBeNull();
    }, 20000);
  });

  // Player reconnection is tested in socket-integration.test.ts
  // Room operations (kick, role, vote-dissolve) are tested in room-manager.property.test.ts
});
