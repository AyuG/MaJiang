/**
 * 花色枚举
 */
export enum TileSuit {
  WAN = 'wan',     // 万
  TIAO = 'tiao',   // 条
  TONG = 'tong',   // 筒
  FENG = 'feng',   // 风牌
  ZI = 'zi',       // 字牌
}

/**
 * 牌定义
 * - 数牌 value: 1-9
 * - 风牌 value: 1-4 (东南西北)
 * - 字牌 value: 1-3 (中白发)
 * - id: 0-135 唯一标识
 */
export interface Tile {
  suit: TileSuit;
  value: number;
  id: number;
}
