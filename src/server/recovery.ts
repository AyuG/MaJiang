import type { GameState } from '@/types';
import type { RedisStore } from '@/store/redis-store';
import type { RoomManager } from '@/server/room-manager';

/**
 * Recover active games from Redis on server restart.
 * Reads all active room IDs, loads their GameState, and
 * rebuilds RoomManager in-memory state so GameController
 * can continue operating on recovered rooms.
 */
export async function recoverActiveGames(
  redisStore: RedisStore,
  roomManager: RoomManager,
): Promise<GameState[]> {
  const roomIds = await redisStore.getAllActiveRooms();
  const recovered: GameState[] = [];

  for (const roomId of roomIds) {
    const state = await redisStore.getGameState(roomId);
    if (!state) continue;

    recovered.push(state);

    // Rebuild room in RoomManager from the persisted GameState
    // Create room with the first player, then join the rest
    const players = state.players;
    if (players.length === 0) continue;

    // Only rebuild if the room doesn't already exist in memory
    if (roomManager.getRoom(roomId)) continue;

    roomManager.restoreRoom(roomId, {
      players: players.map((p, i) => ({
        id: p.id,
        isConnected: p.isConnected,
        isReady: p.isReady,
      })),
      dealerIndex: state.dealerIndex,
      status: state.phase === 'WIN' || state.phase === 'DRAW' ? 'finished' : 'playing',
    });
  }

  return recovered;
}
