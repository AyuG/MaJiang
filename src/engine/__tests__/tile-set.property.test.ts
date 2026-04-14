import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TileSuit } from '@/types';
import type { Tile } from '@/types';
import { createTileSet, shuffle } from '@/engine/tile-set';

/**
 * Feature: chinese-mahjong-online, Property 1: 牌集不变量
 *
 * For any 调用 createTileSet() 生成的牌集，总数应恰好为 136 张，
 * 其中条/筒/万各 36 张（1-9 各 4 张），风牌 16 张（东南西北各 4 张），
 * 字牌 12 张（中白发各 4 张），且每张牌的 id 在 0-135 范围内唯一。
 *
 * **Validates: Requirements 3.1**
 */
describe('Property 1: 牌集不变量', () => {
  it('should generate exactly 136 tiles with correct distribution and unique ids', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const tiles = createTileSet();

        // Total count = 136
        expect(tiles).toHaveLength(136);

        // All ids unique and in range 0-135
        const ids = tiles.map((t) => t.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(136);
        for (const id of ids) {
          expect(id).toBeGreaterThanOrEqual(0);
          expect(id).toBeLessThanOrEqual(135);
        }

        // wan: 36 tiles (1-9, 4 each)
        const wan = tiles.filter((t) => t.suit === TileSuit.WAN);
        expect(wan).toHaveLength(36);
        for (let v = 1; v <= 9; v++) {
          expect(wan.filter((t) => t.value === v)).toHaveLength(4);
        }

        // tiao: 36 tiles (1-9, 4 each)
        const tiao = tiles.filter((t) => t.suit === TileSuit.TIAO);
        expect(tiao).toHaveLength(36);
        for (let v = 1; v <= 9; v++) {
          expect(tiao.filter((t) => t.value === v)).toHaveLength(4);
        }

        // tong: 36 tiles (1-9, 4 each)
        const tong = tiles.filter((t) => t.suit === TileSuit.TONG);
        expect(tong).toHaveLength(36);
        for (let v = 1; v <= 9; v++) {
          expect(tong.filter((t) => t.value === v)).toHaveLength(4);
        }

        // feng: 16 tiles (1-4, 4 each)
        const feng = tiles.filter((t) => t.suit === TileSuit.FENG);
        expect(feng).toHaveLength(16);
        for (let v = 1; v <= 4; v++) {
          expect(feng.filter((t) => t.value === v)).toHaveLength(4);
        }

        // zi: 12 tiles (1-3, 4 each)
        const zi = tiles.filter((t) => t.suit === TileSuit.ZI);
        expect(zi).toHaveLength(12);
        for (let v = 1; v <= 3; v++) {
          expect(zi.filter((t) => t.value === v)).toHaveLength(4);
        }
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: chinese-mahjong-online, Property 2: 确定性洗牌
 *
 * For any 有效的 seed 值和牌集，使用相同 seed 对相同牌集执行两次洗牌，
 * 应产生完全相同的牌序结果。
 *
 * **Validates: Requirements 3.2, 3.3**
 */
describe('Property 2: 确定性洗牌', () => {
  it('should produce identical results when shuffling with the same seed', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const tiles = createTileSet();

        const result1 = shuffle([...tiles], seed);
        const result2 = shuffle([...tiles], seed);

        expect(result1).toHaveLength(136);
        expect(result2).toHaveLength(136);

        // Same seed must produce identical ordering
        for (let i = 0; i < result1.length; i++) {
          expect(result1[i].id).toBe(result2[i].id);
          expect(result1[i].suit).toBe(result2[i].suit);
          expect(result1[i].value).toBe(result2[i].value);
        }
      }),
      { numRuns: 100 }
    );
  });
});
