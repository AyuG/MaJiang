import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Tile } from '@/types';
import { createTileSet, shuffle } from '@/engine/tile-set';
import { draw, discard, drawSupplement } from '@/engine/draw-discard';

/**
 * Feature: chinese-mahjong-online, Property 5: 摸牌不变量
 *
 * For any 非空牌墙，执行 draw 操作应返回牌墙首端的牌，
 * 且操作后牌墙长度减少 1，剩余牌墙为原牌墙去掉首张牌后的子序列。
 *
 * **Validates: Requirements 5.1**
 */
describe('Property 5: 摸牌不变量', () => {
  it('should draw the first tile from wall, reduce wall length by 1, and preserve remaining order', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const tiles = createTileSet();
        const wall = shuffle([...tiles], seed);
        const originalWall = [...wall];

        const result = draw([...wall]);

        // Draw returns the first tile
        expect(result.tile.id).toBe(originalWall[0].id);
        expect(result.tile.suit).toBe(originalWall[0].suit);
        expect(result.tile.value).toBe(originalWall[0].value);

        // Wall length decreases by 1
        expect(result.wall).toHaveLength(originalWall.length - 1);

        // Remaining wall is the original wall minus the first tile
        for (let i = 0; i < result.wall.length; i++) {
          expect(result.wall[i].id).toBe(originalWall[i + 1].id);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should throw error when wall is empty', () => {
    expect(() => draw([])).toThrow();
  });
});


/**
 * Feature: chinese-mahjong-online, Property 6: 出牌不变量
 *
 * For any 有效手牌和手牌中存在的牌 ID，执行 discard 操作后，
 * 手牌数量减少 1，被打出的牌应具有正确的 id，且手牌中不再包含该牌。
 *
 * **Validates: Requirements 5.3**
 */
describe('Property 6: 出牌不变量', () => {
  it('should remove the specified tile from hand, reduce hand size by 1, and return correct discarded tile', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 0, max: 3 }),
        (seed, playerIdx) => {
          const tiles = createTileSet();
          const wall = shuffle([...tiles], seed);

          // Build a hand of 13 tiles (simulate a player's hand)
          const hand = wall.slice(playerIdx * 13, (playerIdx + 1) * 13);
          const originalHandLength = hand.length;

          // Pick a random tile from the hand to discard
          const tileIndex = Math.abs(seed) % hand.length;
          const tileToDiscard = hand[tileIndex];

          const result = discard([...hand], tileToDiscard.id);

          // Hand size decreases by 1
          expect(result.hand).toHaveLength(originalHandLength - 1);

          // Discarded tile has the correct id
          expect(result.discarded.id).toBe(tileToDiscard.id);

          // Hand no longer contains that tile id
          const remainingIds = result.hand.map((t) => t.id);
          expect(remainingIds).not.toContain(tileToDiscard.id);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should throw error when tileId is not found in hand', () => {
    const tiles = createTileSet();
    const hand = tiles.slice(0, 13);
    // Use an id that doesn't exist in the hand
    expect(() => discard(hand, 9999)).toThrow();
  });
});

/**
 * Feature: chinese-mahjong-online, Property 9: 补牌位置正确性与越界保护
 *
 * For any 非空牌墙，补牌规则应满足：
 * - position='second_last' 取 wall[wall.length-2]（牌墙>=2时）
 * - position='last' 取 wall[wall.length-1]
 * - 补牌后牌墙长度减少 1
 * - 当牌墙仅剩 1 张时 position='second_last' 必须降级取最后一张牌，
 *   严禁抛出越界异常或返回 undefined
 *
 * **Validates: Requirements 7.4, 7.5, 7.6**
 */
describe('Property 9: 补牌位置正确性与越界保护', () => {
  it('should take correct tile based on position when wall has >= 2 tiles', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 2, max: 20 }),
        (seed, wallSize) => {
          const tiles = createTileSet();
          const shuffled = shuffle([...tiles], seed);
          const wall = shuffled.slice(0, wallSize);
          const originalWall = [...wall];

          // position='last' returns the last tile
          const lastResult = drawSupplement([...wall], 'last');
          expect(lastResult.tile.id).toBe(originalWall[originalWall.length - 1].id);
          expect(lastResult.wall).toHaveLength(originalWall.length - 1);

          // position='second_last' returns the second-to-last tile
          const secondLastResult = drawSupplement([...wall], 'second_last');
          expect(secondLastResult.tile.id).toBe(originalWall[originalWall.length - 2].id);
          expect(secondLastResult.wall).toHaveLength(originalWall.length - 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('wall length decreases by 1 after each supplement draw', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 1, max: 20 }),
        fc.constantFrom('last' as const, 'second_last' as const),
        (seed, wallSize, position) => {
          const tiles = createTileSet();
          const shuffled = shuffle([...tiles], seed);
          const wall = shuffled.slice(0, wallSize);

          const result = drawSupplement([...wall], position);
          expect(result.wall).toHaveLength(wall.length - 1);
          // The returned tile must be defined
          expect(result.tile).toBeDefined();
          expect(result.tile.id).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('EDGE CASE: when wall has only 1 tile and position=second_last, must return that single tile', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const tiles = createTileSet();
        const shuffled = shuffle([...tiles], seed);
        // Wall with exactly 1 tile
        const wall = [shuffled[0]];
        const onlyTile = wall[0];

        // position='second_last' should degrade to taking the last (only) tile
        const result = drawSupplement([...wall], 'second_last');

        // Must return the single tile, NOT undefined, NOT throw
        expect(result.tile).toBeDefined();
        expect(result.tile.id).toBe(onlyTile.id);
        expect(result.tile.suit).toBe(onlyTile.suit);
        expect(result.tile.value).toBe(onlyTile.value);

        // Wall should be empty after taking the only tile
        expect(result.wall).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it('should throw error when wall is empty', () => {
    expect(() => drawSupplement([], 'last')).toThrow();
    expect(() => drawSupplement([], 'second_last')).toThrow();
  });
});
