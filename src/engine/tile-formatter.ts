import { TileSuit } from '@/types';
import type { Tile } from '@/types';

const CHINESE_NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

const FENG_NAMES: Record<number, string> = {
  1: '东风',
  2: '南风',
  3: '西风',
  4: '北风',
};

const ZI_NAMES: Record<number, string> = {
  1: '红中',
  2: '白板',
  3: '发财',
};

/**
 * Convert a Tile to a readable Chinese string.
 *
 * - wan: "一万" .. "九万"
 * - tiao: "一条" .. "九条"
 * - tong: "一筒" .. "九筒"
 * - feng: "东风", "南风", "西风", "北风"
 * - zi: "红中", "白板", "发财"
 */
export function formatTile(tile: Tile): string {
  switch (tile.suit) {
    case TileSuit.WAN:
      return `${CHINESE_NUMBERS[tile.value - 1]}万`;
    case TileSuit.TIAO:
      return `${CHINESE_NUMBERS[tile.value - 1]}条`;
    case TileSuit.TONG:
      return `${CHINESE_NUMBERS[tile.value - 1]}筒`;
    case TileSuit.FENG:
      return FENG_NAMES[tile.value];
    case TileSuit.ZI:
      return ZI_NAMES[tile.value];
  }
}
