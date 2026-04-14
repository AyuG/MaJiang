import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createTileSet, shuffle } from '@/engine/tile-set';
import { deal } from '@/engine/deal';

/**
 * Feature: chinese-mahjong-online, Property 3: 发牌不变量
 *
 * For any 有效的 136 张牌墙，发牌完成后每位非庄家玩家应持有 13 张手牌，
 * 庄家应持有 14 张手牌，牌墙剩余牌数应为 136 - 13×4 - 1 = 83 张，
 * 且所有手牌与牌墙中的牌合集应等于原始牌墙。
 *
 * **Validates: Requirements 4.2**
 */
describe('Property 3: 发牌不变量', () => {
  it('should deal correct number of tiles to each player and preserve all tiles', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const tiles = createTileSet();
        const wall = shuffle([...tiles], seed);
        const originalIds = wall.map((t) => t.id).sort((a, b) => a - b);

        const result = deal([...wall]);

        // Dealer (index 0) gets 14 tiles
        expect(result.hands[0]).toHaveLength(14);

        // Non-dealer players get 13 tiles each
        expect(result.hands[1]).toHaveLength(13);
        expect(result.hands[2]).toHaveLength(13);
        expect(result.hands[3]).toHaveLength(13);

        // Remaining wall = 83 tiles
        expect(result.wall).toHaveLength(83);

        // All tiles conserved: hands + wall = original wall
        const allIds: number[] = [];
        for (const hand of result.hands) {
          for (const tile of hand) {
            allIds.push(tile.id);
          }
        }
        for (const tile of result.wall) {
          allIds.push(tile.id);
        }
        allIds.sort((a, b) => a - b);

        expect(allIds).toEqual(originalIds);
      }),
      { numRuns: 100 }
    );
  });
});
