import Redis from 'ioredis';
import { GameController } from '@/server/game-controller';
import { RoomManager } from '@/server/room-manager';
import { RedisStore } from '@/store/redis-store';
import { recoverActiveGames } from '@/server/recovery';

async function main() {
  const [socket, roomId, boundary] = process.argv.slice(2);
  const redis = new Redis(socket, { retryStrategy: () => null, maxRetriesPerRequest: 0 });
  const store = new RedisStore(redis);
  const rooms = new RoomManager();
  await recoverActiveGames(store, rooms);
  const controller = new GameController(rooms, store);
  const evaluate = redis.eval.bind(redis);
  const pause = async () => {
    process.send?.(boundary);
    await new Promise<void>(() => { /* parent SIGKILLs only this worker */ });
  };
  redis.eval = (async (...args: Parameters<Redis['eval']>) => {
    if (boundary === 'before') await pause();
    const result = await evaluate(...args);
    if (boundary === 'after') await pause();
    return result;
  }) as Redis['eval'];
  await controller.handlePlayerAction(roomId, 'p0', { type: 'hu' });
  await redis.quit();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
