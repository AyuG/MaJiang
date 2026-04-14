import { TileSuit } from '@/types';
import type { Tile, Meld } from '@/types';

/**
 * Check if a hand (remaining tiles after melds) can form a winning pattern.
 *
 * Two winning patterns:
 * 1. Standard: N sets of 3 (sequences or triplets) + 1 pair
 * 2. Seven pairs (七对子): exactly 7 pairs (14 tiles, no melds)
 */
export function canWin(hand: Tile[], melds: Meld[]): boolean {
  if (checkSevenPairs(hand, melds)) return true;
  if (checkStandard(hand)) return true;
  return false;
}

/**
 * Seven pairs: exactly 14 tiles in hand, no melds, and all tiles form 7 pairs.
 */
function checkSevenPairs(hand: Tile[], melds: Meld[]): boolean {
  if (melds.length > 0) return false;
  if (hand.length !== 14) return false;

  const counts = tileCountMap(hand);
  let pairCount = 0;
  for (const count of counts.values()) {
    if (count !== 2) return false;
    pairCount++;
  }
  return pairCount === 7;
}

/**
 * Standard win check:
 * Hand should have 3*N + 2 tiles.
 * Try each possible pair, then check if remaining tiles form sets of 3.
 */
function checkStandard(hand: Tile[]): boolean {
  if (hand.length < 2) return false;
  if ((hand.length - 2) % 3 !== 0) return false;

  const counts = tileCountMap(hand);

  // Try each possible pair
  for (const [key, count] of counts.entries()) {
    if (count < 2) continue;

    // Remove pair
    const remaining = new Map(counts);
    remaining.set(key, count - 2);
    if (remaining.get(key) === 0) remaining.delete(key);

    if (canFormSets(remaining)) return true;
  }

  return false;
}

/**
 * Check if remaining tile counts can be decomposed into sets of 3
 * (triplets or sequences).
 *
 * We always process the smallest key first (sorted) to ensure
 * deterministic and correct decomposition.
 */
function canFormSets(counts: Map<string, number>): boolean {
  // Find the smallest non-zero key (sorted lexicographically)
  let firstKey: string | null = null;
  const sortedKeys = [...counts.keys()].sort();
  for (const key of sortedKeys) {
    if ((counts.get(key) || 0) > 0) {
      firstKey = key;
      break;
    }
  }

  // All tiles consumed — success
  if (firstKey === null) return true;

  const [suit, valueStr] = firstKey.split(':');
  const value = parseInt(valueStr, 10);
  const currentCount = counts.get(firstKey)!;

  // Try triplet first
  if (currentCount >= 3) {
    const next = new Map(counts);
    next.set(firstKey, currentCount - 3);
    if (next.get(firstKey) === 0) next.delete(firstKey);
    if (canFormSets(next)) return true;
  }

  // Try sequence (only for numbered suits)
  if (suit === TileSuit.WAN || suit === TileSuit.TIAO || suit === TileSuit.TONG) {
    if (value <= 7) {
      const key2 = `${suit}:${value + 1}`;
      const key3 = `${suit}:${value + 2}`;
      const count2 = counts.get(key2) || 0;
      const count3 = counts.get(key3) || 0;

      if (count2 >= 1 && count3 >= 1) {
        const next = new Map(counts);
        next.set(firstKey, currentCount - 1);
        if (next.get(firstKey) === 0) next.delete(firstKey);
        next.set(key2, count2 - 1);
        if (next.get(key2) === 0) next.delete(key2);
        next.set(key3, count3 - 1);
        if (next.get(key3) === 0) next.delete(key3);
        if (canFormSets(next)) return true;
      }
    }
  }

  return false;
}

/** Build a count map keyed by "suit:value" */
function tileCountMap(tiles: Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tiles) {
    const key = `${t.suit}:${t.value}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}
