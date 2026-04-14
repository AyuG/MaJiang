import type { Tile } from '@/types';

/**
 * Draw a tile from the front of the wall (index 0).
 * Returns the drawn tile and the remaining wall.
 * Throws if the wall is empty.
 */
export function draw(wall: Tile[]): { tile: Tile; wall: Tile[] } {
  if (wall.length === 0) {
    throw new Error('Cannot draw from an empty wall');
  }
  const [tile, ...remaining] = wall;
  return { tile, wall: remaining };
}

/**
 * Discard a tile with the given id from the hand.
 * Returns the updated hand and the discarded tile.
 * Throws if the tileId is not found in the hand.
 */
export function discard(hand: Tile[], tileId: number): { hand: Tile[]; discarded: Tile } {
  const index = hand.findIndex((t) => t.id === tileId);
  if (index === -1) {
    throw new Error(`Tile with id ${tileId} not found in hand`);
  }
  const discarded = hand[index];
  const newHand = [...hand.slice(0, index), ...hand.slice(index + 1)];
  return { hand: newHand, discarded };
}

/**
 * Draw a supplement tile from the end of the wall.
 *
 * - position='last': take wall[wall.length - 1]
 * - position='second_last': take wall[wall.length - 2]
 *
 * BOUNDARY PROTECTION: If wall.length < 2 and position='second_last',
 * degrade to taking the last tile (wall[wall.length - 1]).
 * NEVER throws array index out of bounds.
 *
 * Throws if the wall is empty.
 */
export function drawSupplement(
  wall: Tile[],
  position: 'last' | 'second_last',
): { tile: Tile; wall: Tile[] } {
  if (wall.length === 0) {
    throw new Error('Cannot draw supplement from an empty wall');
  }

  let targetIndex: number;

  if (position === 'second_last' && wall.length >= 2) {
    targetIndex = wall.length - 2;
  } else {
    // 'last' position, or degraded 'second_last' when wall < 2
    targetIndex = wall.length - 1;
  }

  const tile = wall[targetIndex];
  const newWall = [...wall.slice(0, targetIndex), ...wall.slice(targetIndex + 1)];
  return { tile, wall: newWall };
}
