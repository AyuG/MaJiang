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
import { logger } from '@/server/logger';

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
  
  // Create Redis client with retry strategy
  const redis = new Redis(redisUrl, {
    retryStrategy: (times: number) => {
      if (times > 10) {
        logger.error('Redis', 'Redis connection failed after 10 retries', new Error('Max retries exceeded'));
        return null; // Stop retrying
      }
      const delay = Math.min(times * 100, 3000);
      logger.warn('Redis', `Redis reconnecting in ${delay}ms (attempt ${times})`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 10000,
  });

  redis.on('connect', () => {
    logger.info('Redis', 'Redis connecting...');
  });

  redis.on('ready', () => {
    logger.info('Redis', 'Redis ready');
  });

  redis.on('error', (err) => {
    logger.error('Redis', 'Redis error', err);
  });

  redis.on('close', () => {
    logger.warn('Redis', 'Redis connection closed');
  });

  redis.on('reconnecting', () => {
    logger.info('Redis', 'Redis reconnecting...');
  });

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
