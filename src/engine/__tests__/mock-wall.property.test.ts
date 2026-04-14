import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { TileSuit } from '@/types';
import type { Tile } from '@/types';
import { applyMockWall } from '@/engine/mock-wall';
import type { MockWallConfig } from '@/engine/mock-wall';

/**
 * Helper: generate an arbitrary Tile with given id.
 */
function makeTile(suit: TileSuit, value: number, id: number): Tile {
  return { suit, value, id };
}

/**
 * Arbitrary for a single Tile (valid suits and value ranges).
 */
const arbTile: fc.Arbitrary<Tile> = fc
  .oneof(
    fc.record({ suit: fc.constant(TileSuit.WAN), value: fc.integer({ min: 1, max: 9 }) }),
    fc.record({ suit: fc.constant(TileSuit.TIAO), value: fc.integer({ min: 1, max: 9 }) }),
    fc.record({ suit: fc.constant(TileSuit.TONG), value: fc.integer({ min: 1, max: 9 }) }),
    fc.record({ suit: fc.constant(TileSuit.FENG), value: fc.integer({ min: 1, max: 4 }) }),
    fc.record({ suit: fc.constant(TileSuit.ZI), value: fc.integer({ min: 1, max: 3 }) }),
  )
  .chain((sv) => fc.integer({ min: 0, max: 135 }).map((id) => ({ ...sv, id })));

/**
 * Arbitrary for a wall (non-empty array of tiles with unique ids).
 */
const arbWall: fc.Arbitrary<Tile[]> = fc
  .uniqueArray(fc.integer({ min: 0, max: 135 }), { minLength: 1, maxLength: 136 })
  .map((ids) =>
    ids.map((id) => makeTile(TileSuit.WAN, ((id % 9) + 1), id)),
  );

/**
 * Feature: chinese-mahjong-online, Property 21: Mock_Wall 牌序一致
 *
 * For any 预设的牌墙序列（支持全量注入或仅注入尾部牌序），当 Mock_Wall 启用时，
 * 发牌和摸牌的顺序应严格按照预设序列进行，与正常洗牌流程产生的结果无关。
 * 仅注入尾部牌序时，未被覆盖的部分仍按 Seed 洗牌结果排列。
 *
 * **Validates: Requirements 17.2**
 */
describe('Property 21: Mock_Wall 牌序一致', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('full injection: applyMockWall returns exactly the preset tiles', () => {
    fc.assert(
      fc.property(arbWall, arbWall, (originalWall, presetTiles) => {
        vi.stubEnv('NODE_ENV', 'test');

        const config: MockWallConfig = { mode: 'full', tiles: presetTiles };
        const result = applyMockWall(originalWall, config);

        // Result must be exactly the preset tiles
        expect(result).toHaveLength(presetTiles.length);
        for (let i = 0; i < result.length; i++) {
          expect(result[i].id).toBe(presetTiles[i].id);
          expect(result[i].suit).toBe(presetTiles[i].suit);
          expect(result[i].value).toBe(presetTiles[i].value);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('tail injection: last N tiles match preset, rest unchanged from original wall', () => {
    fc.assert(
      fc.property(
        arbWall.filter((w) => w.length >= 2),
        (originalWall) => {
          vi.stubEnv('NODE_ENV', 'test');

          // Pick a tail length between 1 and wall length - 1
          const tailLen = Math.max(1, Math.floor(originalWall.length / 2));
          const tailTiles = originalWall.slice(0, tailLen).map((t, i) =>
            makeTile(TileSuit.ZI, ((i % 3) + 1), 200 + i),
          );

          const config: MockWallConfig = { mode: 'tail', tiles: tailTiles };
          const result = applyMockWall(originalWall, config);

          // Total length stays the same
          expect(result).toHaveLength(originalWall.length);

          // The prefix (non-tail) portion must be unchanged
          const prefixLen = originalWall.length - tailLen;
          for (let i = 0; i < prefixLen; i++) {
            expect(result[i].id).toBe(originalWall[i].id);
          }

          // The last N tiles must match the preset tail tiles
          for (let i = 0; i < tailLen; i++) {
            expect(result[prefixLen + i].id).toBe(tailTiles[i].id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('null config: wall unchanged', () => {
    fc.assert(
      fc.property(arbWall, (originalWall) => {
        vi.stubEnv('NODE_ENV', 'test');

        const result = applyMockWall(originalWall, null);

        expect(result).toHaveLength(originalWall.length);
        for (let i = 0; i < result.length; i++) {
          expect(result[i].id).toBe(originalWall[i].id);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('production mode: always returns wall unchanged regardless of config', () => {
    fc.assert(
      fc.property(arbWall, arbWall, (originalWall, presetTiles) => {
        vi.stubEnv('NODE_ENV', 'production');

        const fullConfig: MockWallConfig = { mode: 'full', tiles: presetTiles };
        const resultFull = applyMockWall(originalWall, fullConfig);

        expect(resultFull).toHaveLength(originalWall.length);
        for (let i = 0; i < resultFull.length; i++) {
          expect(resultFull[i].id).toBe(originalWall[i].id);
        }

        const tailConfig: MockWallConfig = { mode: 'tail', tiles: presetTiles.slice(0, 1) };
        const resultTail = applyMockWall(originalWall, tailConfig);

        expect(resultTail).toHaveLength(originalWall.length);
        for (let i = 0; i < resultTail.length; i++) {
          expect(resultTail[i].id).toBe(originalWall[i].id);
        }
      }),
      { numRuns: 100 },
    );
  });
});
