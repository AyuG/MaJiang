import { createServer } from 'http';
import next from 'next';
import { Server } from 'socket.io';
import { parse } from 'url';
import Redis from 'ioredis';
import { RedisStore } from '@/store/redis-store';
import { RoomManager } from '@/server/room-manager';
import { GameController } from '@/server/game-controller';
import { setupSocketHandlers } from '@/server/socket-handler';
import { recoverActiveGames } from '@/server/recovery';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
const port = parseInt(process.env.PORT || '3000', 10);

app.prepare().then(async () => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, { cors: { origin: '*' } });

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redis = new Redis(redisUrl);
  const redisStore = new RedisStore(redis);
  const roomManager = new RoomManager();
  const gameController = new GameController(roomManager, redisStore);

  // setupSocketHandlers creates and manages the TurnTimer internally
  // so the timeout callback has access to broadcastGameState and handleAutoPlay
  setupSocketHandlers(io, gameController, roomManager);

  // Recover active games on startup
  await recoverActiveGames(redisStore, roomManager);

  const hostname = process.env.HOSTNAME || '0.0.0.0';

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
