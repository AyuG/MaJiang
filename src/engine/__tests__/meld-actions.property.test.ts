import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TileSuit } from '@/types';
import type { Tile, Meld } from '@/types';
import {
  canPeng,
  canMingGang,
  canAnGang,
  canBuGang,
  executePeng,
  executeMingGang,
  executeAnGang,
  executeBuGang,
} from '@/engine/meld-actions';

// --- Helpers ---

/** Create a tile with given suit, value, and id */
function makeTile(suit: TileSuit, value: number, id: number): Tile {
  return { suit, value, id };
}

/** Arbitrary for a valid TileSuit */
const arbSuit = fc.constantFrom(
  TileSuit.WAN,
  TileSuit.TIAO,
  TileSuit.TONG,
  TileSuit.FENG,
  TileSuit.ZI,
);

/** Arbitrary for a valid value given a suit */
function arbValueForSuit(suit: TileSuit): fc.Arbitrary<number> {
  switch (suit) {
    case TileSuit.WAN:
    case TileSuit.TIAO:
    case TileSuit.TONG:
      return fc.integer({ min: 1, max: 9 });
    case TileSuit.FENG:
      return fc.integer({ min: 1, max: 4 });
    case TileSuit.ZI:
      return fc.integer({ min: 1, max: 3 });
  }
}

/** Arbitrary for a suit+value pair */
const arbSuitValue = arbSuit.chain((suit) =>
  arbValueForSuit(suit).map((value) => ({ suit, value })),
);

/** Count how many tiles in hand match a given suit+value */
function countMatching(hand: Tile[], suit: TileSuit, value: number): number {
  return hand.filter((t) => t.suit === suit && t.value === value).length;
}

/**
 * Generate a hand of `size` tiles with unique ids starting from `idStart`.
 * Tiles have random suit+value.
 */
function arbHand(size: number, idStart: number = 0): fc.Arbitrary<Tile[]> {
  return fc.array(arbSuitValue, { minLength: size, maxLength: size }).map(
    (pairs) => pairs.map((p, i) => makeTile(p.suit, p.value, idStart + i)),
  );
}

/**
 * Feature: chinese-mahjong-online, Property 7: 碰杠条件判断正确性
 *
 * For any 随机生成的手牌和弃牌:
 * - canPeng returns true iff hand has >= 2 tiles matching discarded suit+value
 * - canMingGang returns true iff hand has >= 3 tiles matching discarded suit+value
 * - canAnGang returns non-null iff hand has 4 tiles with same suit+value
 * - canBuGang returns non-null iff a peng meld exists matching a tile in hand
 *
 * **Validates: Requirements 6.1, 7.1, 7.2, 7.3**
 */
describe('Property 7: 碰杠条件判断正确性', () => {
  it('canPeng returns true iff hand contains >= 2 tiles matching discarded suit+value', () => {
    fc.assert(
      fc.property(
        arbHand(13),
        arbSuitValue,
        (hand, sv) => {
          const discarded = makeTile(sv.suit, sv.value, 999);
          const matchCount = countMatching(hand, sv.suit, sv.value);
          const result = canPeng(hand, discarded);
          expect(result).toBe(matchCount >= 2);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('canMingGang returns true iff hand contains >= 3 tiles matching discarded suit+value', () => {
    fc.assert(
      fc.property(
        arbHand(13),
        arbSuitValue,
        (hand, sv) => {
          const discarded = makeTile(sv.suit, sv.value, 999);
          const matchCount = countMatching(hand, sv.suit, sv.value);
          const result = canMingGang(hand, discarded);
          expect(result).toBe(matchCount >= 3);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('canAnGang returns non-null iff hand has 4 tiles with same suit+value', () => {
    fc.assert(
      fc.property(arbHand(13), (hand) => {
        const result = canAnGang(hand);

        // Check if any suit+value appears 4 times
        const hasFour = hand.some(
          (t) => countMatching(hand, t.suit, t.value) >= 4,
        );

        if (hasFour) {
          expect(result).not.toBeNull();
          // The returned tile should match one of the groups of 4
          const tile = result!;
          expect(countMatching(hand, tile.suit, tile.value)).toBeGreaterThanOrEqual(4);
        } else {
          expect(result).toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });

  it('canBuGang returns non-null iff a peng meld exists matching a tile in hand', () => {
    fc.assert(
      fc.property(
        arbHand(13),
        arbSuitValue,
        fc.boolean(),
        (hand, sv, hasPengMeld) => {
          const melds: Meld[] = [];
          if (hasPengMeld) {
            // Create a peng meld with the same suit+value
            melds.push({
              type: 'peng',
              tiles: [
                makeTile(sv.suit, sv.value, 500),
                makeTile(sv.suit, sv.value, 501),
                makeTile(sv.suit, sv.value, 502),
              ],
            });
          }

          const result = canBuGang(hand, melds);

          // Check if any tile in hand matches any peng meld
          const hasMatch = hand.some((t) =>
            melds.some(
              (m) =>
                m.type === 'peng' &&
                m.tiles[0].suit === t.suit &&
                m.tiles[0].value === t.value,
            ),
          );

          if (hasMatch) {
            expect(result).not.toBeNull();
            expect(result!.tile.suit).toBe(
              melds[result!.meldIndex].tiles[0].suit,
            );
            expect(result!.tile.value).toBe(
              melds[result!.meldIndex].tiles[0].value,
            );
          } else {
            expect(result).toBeNull();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});


/**
 * Feature: chinese-mahjong-online, Property 8: 碰牌执行不变量
 *
 * For any 满足碰牌条件的手牌和弃牌:
 * - After executePeng: hand size decreases by 2
 * - The meld contains 3 tiles with same suit+value
 * - Total tiles conserved: hand + meld tiles = original hand + discarded tile
 *
 * **Validates: Requirements 6.2**
 */
describe('Property 8: 碰牌执行不变量', () => {
  /**
   * Generate a hand that is guaranteed to contain at least 2 tiles
   * matching a specific suit+value (so canPeng is always true).
   */
  const arbPengScenario = arbSuitValue.chain((sv) =>
    fc
      .tuple(
        // 2 matching tiles (guaranteed pair)
        fc.constant([
          makeTile(sv.suit, sv.value, 900),
          makeTile(sv.suit, sv.value, 901),
        ]),
        // 11 other random tiles with unique ids starting from 100
        arbHand(11, 100),
      )
      .map(([pair, rest]) => ({
        hand: [...pair, ...rest],
        discarded: makeTile(sv.suit, sv.value, 999),
        suit: sv.suit,
        value: sv.value,
      })),
  );

  it('hand size decreases by 2 after executePeng', () => {
    fc.assert(
      fc.property(arbPengScenario, ({ hand, discarded }) => {
        const originalSize = hand.length;
        const result = executePeng([...hand], discarded);
        expect(result.hand).toHaveLength(originalSize - 2);
      }),
      { numRuns: 200 },
    );
  });

  it('meld contains 3 tiles with same suit+value', () => {
    fc.assert(
      fc.property(arbPengScenario, ({ hand, discarded, suit, value }) => {
        const result = executePeng([...hand], discarded);
        expect(result.meld.type).toBe('peng');
        expect(result.meld.tiles).toHaveLength(3);
        for (const t of result.meld.tiles) {
          expect(t.suit).toBe(suit);
          expect(t.value).toBe(value);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('total tiles conserved: hand + meld = original hand + discarded', () => {
    fc.assert(
      fc.property(arbPengScenario, ({ hand, discarded }) => {
        const originalIds = [...hand.map((t) => t.id), discarded.id].sort(
          (a, b) => a - b,
        );

        const result = executePeng([...hand], discarded);
        const resultIds = [
          ...result.hand.map((t) => t.id),
          ...result.meld.tiles.map((t) => t.id),
        ].sort((a, b) => a - b);

        expect(resultIds).toEqual(originalIds);
      }),
      { numRuns: 200 },
    );
  });
});
