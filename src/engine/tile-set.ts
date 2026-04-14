import { TileSuit } from '@/types';
import type { Tile } from '@/types';

/**
 * Generate the standard 136-tile Mahjong tile set.
 *
 * - wan (1-9) × 4 = 36
 * - tiao (1-9) × 4 = 36
 * - tong (1-9) × 4 = 36
 * - feng (1-4) × 4 = 16
 * - zi (1-3) × 4 = 12
 * Total = 136, each tile has unique id 0-135.
 */
export function createTileSet(): Tile[] {
  const tiles: Tile[] = [];
  let id = 0;

  const suitDefs: { suit: TileSuit; maxValue: number }[] = [
    { suit: TileSuit.WAN, maxValue: 9 },
    { suit: TileSuit.TIAO, maxValue: 9 },
    { suit: TileSuit.TONG, maxValue: 9 },
    { suit: TileSuit.FENG, maxValue: 4 },
    { suit: TileSuit.ZI, maxValue: 3 },
  ];

  for (const { suit, maxValue } of suitDefs) {
    for (let value = 1; value <= maxValue; value++) {
      for (let copy = 0; copy < 4; copy++) {
        tiles.push({ suit, value, id: id++ });
      }
    }
  }

  return tiles;
}

/**
 * Mulberry32 seeded PRNG — returns a function that produces
 * pseudo-random 32-bit unsigned integers on each call.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

/**
 * Deterministic Fisher-Yates shuffle using a seeded PRNG.
 * Same seed always produces the same result.
 * Returns a new shuffled array (does not mutate the input).
 */
export function shuffle(tiles: Tile[], seed: number): Tile[] {
  const result = [...tiles];
  const rng = mulberry32(seed);

  for (let i = result.length - 1; i > 0; i--) {
    const j = rng() % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}
