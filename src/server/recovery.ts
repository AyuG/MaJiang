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

    // Rebuild room in RoomManager from the persisted GameState
    // Create room with the first player, then join the rest
    const players = state.players;
    if (players.length === 0) continue;

    // Only rebuild if the room doesn't already exist in memory.
    if (roomManager.getRoom(roomId)) {
      recovered.push(state);
      continue;
    }

    // A process restart invalidates every socket, regardless of saved flags.
    // Preserve the score/baseline but require actual reconnects before continuing.
    const offlineState: GameState = { ...state,
      players: state.players.map((p) => ({ ...p, isConnected: false })),
    };
    await redisStore.saveGameState(roomId, offlineState);
    recovered.push(offlineState);
    roomManager.restoreRoom(roomId, {
      players: offlineState.players.map((p) => ({
        id: p.id,
        isConnected: p.isConnected,
        isReady: p.isReady,
      })),
      dealerIndex: state.dealerIndex,
      status: 'playing', // terminal snapshots must also allow reconnect / finalization
    });
  }

  return recovered;
}
