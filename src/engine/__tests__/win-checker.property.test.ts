import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TileSuit } from '@/types';
import type { Tile, Meld } from '@/types';
import { canWin } from '@/engine/win-checker';

// --- Helpers ---

function makeTile(suit: TileSuit, value: number, id: number): Tile {
  return { suit, value, id };
}

const NUMBERED_SUITS = [TileSuit.WAN, TileSuit.TIAO, TileSuit.TONG] as const;

const arbNumberedSuit = fc.constantFrom(...NUMBERED_SUITS);

const arbAnySuit = fc.constantFrom(
  TileSuit.WAN,
  TileSuit.TIAO,
  TileSuit.TONG,
  TileSuit.FENG,
  TileSuit.ZI,
);

function maxValueForSuit(suit: TileSuit): number {
  switch (suit) {
    case TileSuit.WAN:
    case TileSuit.TIAO:
    case TileSuit.TONG:
      return 9;
    case TileSuit.FENG:
      return 4;
    case TileSuit.ZI:
      return 3;
  }
}

function arbValueForSuit(suit: TileSuit): fc.Arbitrary<number> {
  return fc.integer({ min: 1, max: maxValueForSuit(suit) });
}

const arbSuitValue = arbAnySuit.chain((suit) =>
  arbValueForSuit(suit).map((value) => ({ suit, value })),
);

let globalId = 0;
function nextId(): number {
  return globalId++;
}

function resetIds(): void {
  globalId = 0;
}

/**
 * Feature: chinese-mahjong-online, Property 10: 胡牌校验正确性
 *
 * - Seven pairs: generate 7 pairs of tiles (14 tiles), canWin should return true
 * - Standard pattern: generate valid N triplets/sequences + 1 pair, canWin should return true
 * - Invalid hands: generate random 14-tile hands that don't form valid patterns, canWin should return false
 *
 * **Validates: Requirements 8.1, 8.2, 8.5**
 */
describe('Property 10: 胡牌校验正确性', () => {

  /**
   * Generate 7 distinct suit+value pairs for seven-pairs pattern.
   * Each pair must be a valid tile (respecting max copies = 4).
   * We pick 7 distinct suit+value combos and duplicate each.
   */
  const arbSevenPairs: fc.Arbitrary<Tile[]> = fc
    .uniqueArray(arbSuitValue, {
      minLength: 7,
      maxLength: 7,
      comparator: (a, b) => a.suit === b.suit && a.value === b.value,
    })
    .map((pairs) => {
      resetIds();
      const tiles: Tile[] = [];
      for (const sv of pairs) {
        tiles.push(makeTile(sv.suit, sv.value, nextId()));
        tiles.push(makeTile(sv.suit, sv.value, nextId()));
      }
      return tiles;
    });

  it('seven pairs (七对子) should be recognized as winning hand', () => {
    fc.assert(
      fc.property(arbSevenPairs, (hand) => {
        expect(canWin(hand, [])).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Generate a valid standard winning hand: N sets of 3 + 1 pair.
   * For 14 tiles with no melds: 4 sets + 1 pair.
   * Sets can be triplets (3 identical) or sequences (3 consecutive same suit, numbered suits only).
   */
  const arbTriplet: fc.Arbitrary<Array<{ suit: TileSuit; value: number }>> =
    arbSuitValue.map((sv) => [sv, sv, sv]);

  const arbSequence: fc.Arbitrary<Array<{ suit: TileSuit; value: number }>> =
    arbNumberedSuit.chain((suit) =>
      fc.integer({ min: 1, max: 7 }).map((startVal) => [
        { suit, value: startVal },
        { suit, value: startVal + 1 },
        { suit, value: startVal + 2 },
      ]),
    );

  const arbSet = fc.oneof(arbTriplet, arbSequence);

  const arbStandardWin: fc.Arbitrary<Tile[]> = fc
    .tuple(arbSet, arbSet, arbSet, arbSet, arbSuitValue)
    .filter(([s1, s2, s3, s4, pair]) => {
      // Count tiles per suit+value to ensure no more than 4 copies
      const counts = new Map<string, number>();
      const allTiles = [...s1, ...s2, ...s3, ...s4, pair, pair];
      for (const t of allTiles) {
        const key = `${t.suit}:${t.value}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      for (const count of counts.values()) {
        if (count > 4) return false;
      }
      return true;
    })
    .map(([s1, s2, s3, s4, pair]) => {
      resetIds();
      const tiles: Tile[] = [];
      for (const sv of [...s1, ...s2, ...s3, ...s4, pair, pair]) {
        tiles.push(makeTile(sv.suit, sv.value, nextId()));
      }
      return tiles;
    });

  it('standard winning pattern (N sets + 1 pair) should be recognized', () => {
    fc.assert(
      fc.property(arbStandardWin, (hand) => {
        expect(canWin(hand, [])).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Standard win with melds: hand has fewer tiles, melds are separate.
   * Generate 1 meld (triplet) + 3 sets in hand + 1 pair = valid win.
   */
  const arbStandardWinWithMelds: fc.Arbitrary<{ hand: Tile[]; melds: Meld[] }> = fc
    .tuple(arbTriplet, arbSet, arbSet, arbSet, arbSuitValue)
    .filter(([meldSet, s1, s2, s3, pair]) => {
      const counts = new Map<string, number>();
      const allTiles = [...meldSet, ...s1, ...s2, ...s3, pair, pair];
      for (const t of allTiles) {
        const key = `${t.suit}:${t.value}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      for (const count of counts.values()) {
        if (count > 4) return false;
      }
      return true;
    })
    .map(([meldSet, s1, s2, s3, pair]) => {
      resetIds();
      const meldTiles = meldSet.map((sv) => makeTile(sv.suit, sv.value, nextId()));
      const handTiles: Tile[] = [];
      for (const sv of [...s1, ...s2, ...s3, pair, pair]) {
        handTiles.push(makeTile(sv.suit, sv.value, nextId()));
      }
      const melds: Meld[] = [{ type: 'peng', tiles: meldTiles }];
      return { hand: handTiles, melds };
    });

  it('standard win with melds should be recognized', () => {
    fc.assert(
      fc.property(arbStandardWinWithMelds, ({ hand, melds }) => {
        expect(canWin(hand, melds)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Invalid hands: generate 14 random tiles that are very unlikely to form
   * a valid pattern. We use a strategy of picking tiles from many different
   * suit+value combos to make winning nearly impossible.
   */
  const arbInvalidHand: fc.Arbitrary<Tile[]> = fc
    .uniqueArray(arbSuitValue, {
      minLength: 13,
      maxLength: 13,
      comparator: (a, b) => a.suit === b.suit && a.value === b.value,
    })
    .chain((uniqueSvs) => {
      // Pick one more random suit+value that differs from all 13
      return arbSuitValue
        .filter((sv) => !uniqueSvs.some((u) => u.suit === sv.suit && u.value === sv.value))
        .map((extra) => [...uniqueSvs, extra]);
    })
    .map((svs) => {
      resetIds();
      return svs.map((sv) => makeTile(sv.suit, sv.value, nextId()));
    });

  it('invalid hands (14 distinct tiles) should not be recognized as winning', () => {
    fc.assert(
      fc.property(arbInvalidHand, (hand) => {
        expect(canWin(hand, [])).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
