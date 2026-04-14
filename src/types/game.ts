import type { Tile } from './tile';

/** 游戏阶段 */
export type GamePhase = 'DEALING' | 'TURN' | 'AWAITING' | 'WIN' | 'DRAW';

/** 副子（碰/杠组合） */
export interface Meld {
  type: 'peng' | 'ming_gang' | 'an_gang' | 'bu_gang';
  tiles: Tile[];
  fromPlayer?: string; // 碰/明杠来源玩家
}

/** 杠分记录（延迟结算） */
export interface GangRecord {
  type: 'ming' | 'an' | 'bu';
  gangPlayerIndex: number;      // 执行杠操作的玩家
  targetPlayerIndex?: number;   // 明杠/补杠的被杠玩家
}

/** 玩家状态 */
export interface PlayerState {
  id: string;
  hand: Tile[];
  melds: Meld[];
  discardPool: Tile[];
  score: number;
  isConnected: boolean;
  isReady: boolean;
}

/** 操作日志条目 */
export interface ActionLogEntry {
  timestamp: number;
  playerIndex: number;
  action: 'draw' | 'discard' | 'peng' | 'ming_gang' | 'an_gang' | 'bu_gang' | 'hu' | 'pass';
  tileId?: number;
  detail?: string;
}

/** 游戏状态 */
export interface GameState {
  phase: GamePhase;
  roomId: string;
  players: PlayerState[];
  wall: Tile[];
  currentPlayerIndex: number;
  dealerIndex: number;
  seed: number;
  lastDiscard: { tile: Tile; playerIndex: number } | null;
  turnCount: number;
  roundNumber: number;            // 当前局数（第几局）
  consecutiveGangCount: number; // 当前回合连续杠次数，下一位玩家回合开始或当前玩家出牌完成时重置为 0
  gangRecords: GangRecord[];   // 累计杠分记录，仅在胡牌时结算，流局时原子清零
  isPaused: boolean;
  actionLog: ActionLogEntry[];
  lastDrawnTileId: number | null;  // ID of the tile most recently drawn by current player
  /** 庄家首牌四家同出追踪 */
  dealerFirstDiscard: { suit: string; value: number } | null;
  dealerFirstMatchCount: number;
  /** 超时托管的玩家 ID 列表（手动操作后取消） */
  timeoutAutoPlayerIds: string[];
}

/** 游戏操作类型 */
export type GameAction =
  | { type: 'deal' }
  | { type: 'draw' }
  | { type: 'discard'; tileId: number }
  | { type: 'peng' }
  | { type: 'ming_gang' }
  | { type: 'an_gang'; tileId: number }
  | { type: 'bu_gang'; tileId: number }
  | { type: 'hu' }
  | { type: 'pass' };

/** 分数变动 */
export interface ScoreChange {
  playerIndex: number;
  delta: number;
}

/** 房间信息 */
export interface RoomInfo {
  roomId: string;
  players: string[];       // 玩家 ID 列表（按加入顺序）
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
}
