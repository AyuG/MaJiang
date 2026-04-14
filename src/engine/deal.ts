import type { Tile } from '@/types';

/**
 * Deal tiles from a 136-tile wall.
 *
 * - 4 players each get 13 tiles, dealt from the front of the wall.
 * - Dealer (player index 0) gets 1 extra tile (14 total).
 * - Remaining wall = 136 - 53 = 83 tiles.
 *
 * Deal order: take sequentially from wall[0] onwards.
 */
export function deal(wall: Tile[]): { hands: Tile[][]; wall: Tile[] } {
  const remaining = [...wall];
  const hands: Tile[][] = [[], [], [], []];

  // Deal 13 tiles to each player (4 rounds of dealing isn't required,
  // just take 13 sequentially per player from the front)
  for (let player = 0; player < 4; player++) {
    for (let i = 0; i < 13; i++) {
      hands[player].push(remaining.shift()!);
    }
  }

  // Dealer (index 0) gets 1 extra tile
  hands[0].push(remaining.shift()!);

  return { hands, wall: remaining };
}
