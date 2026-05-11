import type { GameState, PlayerState } from './game';

/** Socket handshake auth data */
export interface SocketAuth {
  playerId?: string;
  nickname?: string;
}

/** 客户端可见的游戏状态（隐藏其他玩家手牌） */
export interface ClientGameState {
  phase: GameState['phase'];
  roomId: string;
  currentPlayerIndex: number;
  dealerIndex: number;
  turnCount: number;
  roundNumber: number;
  wallCount: number;
  myHand: GameState['players'][number]['hand'];
  players: Array<{
    id: string;
    meldCount: number;
    melds: PlayerState['melds'];
    discardPool: PlayerState['discardPool'];
    score: number;
    isConnected: boolean;
    handCount: number;
  }>;
  lastDiscard: GameState['lastDiscard'];
  lastDrawnTileId: number | null;
  isPaused: boolean;
  autoPlayPlayerIds: string[];
}

/** 客户端 → 服务端事件 */
export interface ClientEvents {
  'room:create': () => void;
  'room:join': (roomId: string) => void;
  'room:ready': () => void;
  'room:unready': () => void;
  'room:kick': (targetId: string) => void;
  'room:dissolve': () => void;
  'room:start': () => void;
  'room:change-nickname': (name: string) => void;
  'game:discard': (tileId: number) => void;
  'game:peng': () => void;
  'game:gang': (type: 'ming' | 'an' | 'bu', tileId?: number) => void;
  'game:hu': () => void;
  'game:pass': () => void;
  'room:vote-dissolve': () => void;
  'room:vote-dissolve-reply': (agree: boolean) => void;
  'room:new-game': () => void;
}

/** 房间状态同步数据 */
export interface RoomSyncData {
  roomId: string;
  ownerId: string;
  players: Array<{ id: string; seat: string; isReady: boolean; isConnected: boolean; nickname?: string }>;
}

/** 掷骰子结果 */
export interface DiceResultData {
  rolls: number[];
  dealerIndex: number;
}

/** 服务端 → 客户端事件 */
export interface ServerEvents {
  'room:created': (roomId: string) => void;
  'room:joined': (data: { id: string; seat: number }) => void;
  'room:player-ready': (playerId: string) => void;
  'room:player-unready': (playerId: string) => void;
  'room:sync': (data: RoomSyncData) => void;
  'room:kicked': (targetId: string) => void;
  'room:error': (message: string) => void;
  'game:dice-result': (data: DiceResultData) => void;
  'game:started': (initialState: ClientGameState) => void;
  'game:state-update': (state: ClientGameState) => void;
  'game:paused': (disconnectedPlayer: string) => void;
  'game:resumed': () => void;
  'room:vote-dissolve-request': (initiator: string) => void;
  'room:vote-dissolve-rejected': () => void;
  'room:dissolved': (data?: { roomId: string; scoreHistory?: Array<{ round: number; result: string; scores: Array<{ seat: string; delta: number }> }> }) => void;
  'room:new-game-created': (roomId: string) => void;
}
