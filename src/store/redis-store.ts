import type Redis from 'ioredis';
import type { GameState, ActionLogEntry, RoomInfo } from '@/types';

const ACTIVE_ROOMS_KEY = 'rooms:active';
const LOG_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function roomKey(roomId: string): string {
  return `room:${roomId}`;
}

function gameKey(roomId: string): string {
  return `game:${roomId}`;
}

function logKey(roomId: string, timestamp: number): string {
  return `log:${roomId}:${timestamp}`;
}

export class RedisStore {
  private client: Redis;

  constructor(client?: Redis) {
    if (client) {
      this.client = client;
    } else {
      // Lazy-import ioredis at runtime; allows ioredis-mock to be injected in tests
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const IORedis = require('ioredis') as typeof import('ioredis').default;
      this.client = new IORedis();
    }
  }

  // ── GameState ──────────────────────────────────────────

  async saveGameState(roomId: string, state: GameState): Promise<void> {
    await this.client.set(gameKey(roomId), JSON.stringify(state));
  }

  async getGameState(roomId: string): Promise<GameState | null> {
    const raw = await this.client.get(gameKey(roomId));
    if (!raw) return null;
    return JSON.parse(raw) as GameState;
  }

  async deleteGameState(roomId: string): Promise<void> {
    await this.client.del(gameKey(roomId));
  }

  // ── ActionLog ──────────────────────────────────────────

  async saveActionLog(
    roomId: string,
    seed: number,
    log: ActionLogEntry[],
  ): Promise<void> {
    const timestamp = Date.now();
    const payload = JSON.stringify({ seed, log });
    await this.client.set(logKey(roomId, timestamp), payload, 'EX', LOG_TTL_SECONDS);
  }

  async getActionLog(
    roomId: string,
  ): Promise<{ seed: number; log: ActionLogEntry[] } | null> {
    // Scan for the latest log entry matching this room
    const pattern = `log:${roomId}:*`;
    const keys: string[] = [];

    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    if (keys.length === 0) return null;

    // Pick the key with the largest timestamp
    keys.sort();
    const latestKey = keys[keys.length - 1];
    const raw = await this.client.get(latestKey);
    if (!raw) return null;
    return JSON.parse(raw) as { seed: number; log: ActionLogEntry[] };
  }

  // ── Room ───────────────────────────────────────────────

  async saveRoom(roomId: string, room: RoomInfo): Promise<void> {
    const key = roomKey(roomId);
    await this.client.hset(key, {
      roomId: room.roomId,
      players: JSON.stringify(room.players),
      status: room.status,
      createdAt: String(room.createdAt),
    });
    await this.client.sadd(ACTIVE_ROOMS_KEY, roomId);
  }

  async getRoom(roomId: string): Promise<RoomInfo | null> {
    const data = await this.client.hgetall(roomKey(roomId));
    if (!data || !data.roomId) return null;
    return {
      roomId: data.roomId,
      players: JSON.parse(data.players),
      status: data.status as RoomInfo['status'],
      createdAt: Number(data.createdAt),
    };
  }

  async getAllActiveRooms(): Promise<string[]> {
    return this.client.smembers(ACTIVE_ROOMS_KEY);
  }

  // ── Score Log (per room) ───────────────────────────────

  /**
   * Append a score record for a completed round in a room.
   * Stored as a Redis list keyed by room, each entry is a JSON object.
   */
  async appendScoreLog(
    roomId: string,
    record: {
      round: number;
      timestamp: number;
      result: 'win' | 'draw';
      winnerId?: string;
      scores: Array<{ playerId: string; delta: number; total: number }>;
    },
  ): Promise<void> {
    const key = `score:${roomId}`;
    await this.client.rpush(key, JSON.stringify(record));
    await this.client.expire(key, LOG_TTL_SECONDS);
  }

  /**
   * Get all score records for a room.
   */
  async getScoreLog(
    roomId: string,
  ): Promise<Array<{
    round: number;
    timestamp: number;
    result: 'win' | 'draw';
    winnerId?: string;
    scores: Array<{ playerId: string; delta: number; total: number }>;
  }>> {
    const key = `score:${roomId}`;
    const raw = await this.client.lrange(key, 0, -1);
    return raw.map((r) => JSON.parse(r));
  }
}
