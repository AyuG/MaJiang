import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TileSuit } from '@/types';
import type { Tile } from '@/types';
import { formatTile } from '@/engine/tile-formatter';

/**
 * Arbitrary for a valid Tile (correct suit/value ranges, arbitrary id).
 */
const arbValidTile: fc.Arbitrary<Tile> = fc.oneof(
  fc.record({
    suit: fc.constant(TileSuit.WAN as TileSuit),
    value: fc.integer({ min: 1, max: 9 }),
    id: fc.integer({ min: 0, max: 135 }),
  }),
  fc.record({
    suit: fc.constant(TileSuit.TIAO as TileSuit),
    value: fc.integer({ min: 1, max: 9 }),
    id: fc.integer({ min: 0, max: 135 }),
  }),
  fc.record({
    suit: fc.constant(TileSuit.TONG as TileSuit),
    value: fc.integer({ min: 1, max: 9 }),
    id: fc.integer({ min: 0, max: 135 }),
  }),
  fc.record({
    suit: fc.constant(TileSuit.FENG as TileSuit),
    value: fc.integer({ min: 1, max: 4 }),
    id: fc.integer({ min: 0, max: 135 }),
  }),
  fc.record({
    suit: fc.constant(TileSuit.ZI as TileSuit),
    value: fc.integer({ min: 1, max: 3 }),
    id: fc.integer({ min: 0, max: 135 }),
  }),
);

/**
 * Arbitrary for a pair of tiles with different suit+value combinations.
 */
const arbTwoDifferentTiles: fc.Arbitrary<[Tile, Tile]> = fc
  .tuple(arbValidTile, arbValidTile)
  .filter(([a, b]) => a.suit !== b.suit || a.value !== b.value);

/**
 * Feature: chinese-mahjong-online, Property 18: 牌面格式化
 *
 * For any 有效的 Tile 对象，格式化函数应返回包含该牌花色名称和数值的可读字符串
 * （如"一万"、"东风"、"红中"），且不同的牌应产生不同的格式化结果。
 *
 * **Validates: Requirements 15.2**
 */
describe('Property 18: 牌面格式化', () => {
  it('for any valid Tile, formatTile returns a non-empty string', () => {
    fc.assert(
      fc.property(arbValidTile, (tile) => {
        const result = formatTile(tile);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('different suit+value combinations produce different strings', () => {
    fc.assert(
      fc.property(arbTwoDifferentTiles, ([a, b]) => {
        const resultA = formatTile(a);
        const resultB = formatTile(b);
        expect(resultA).not.toBe(resultB);
      }),
      { numRuns: 100 },
    );
  });

  it('all 34 unique tile types produce unique formatted strings', () => {
    // Enumerate all 34 unique tile types
    const allTypes: Tile[] = [];
    let id = 0;

    // wan 1-9
    for (let v = 1; v <= 9; v++) allTypes.push({ suit: TileSuit.WAN, value: v, id: id++ });
    // tiao 1-9
    for (let v = 1; v <= 9; v++) allTypes.push({ suit: TileSuit.TIAO, value: v, id: id++ });
    // tong 1-9
    for (let v = 1; v <= 9; v++) allTypes.push({ suit: TileSuit.TONG, value: v, id: id++ });
    // feng 1-4
    for (let v = 1; v <= 4; v++) allTypes.push({ suit: TileSuit.FENG, value: v, id: id++ });
    // zi 1-3
    for (let v = 1; v <= 3; v++) allTypes.push({ suit: TileSuit.ZI, value: v, id: id++ });

    expect(allTypes).toHaveLength(34);

    const formatted = allTypes.map((t) => formatTile(t));
    const uniqueStrings = new Set(formatted);

    expect(uniqueStrings.size).toBe(34);

    // Every string should be non-empty
    for (const s of formatted) {
      expect(s.length).toBeGreaterThan(0);
    }
  });
});
