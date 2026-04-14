import type { Tile, Meld } from '@/types';

/** Check if two tiles have the same suit and value */
function sameSuitValue(a: Tile, b: Tile): boolean {
  return a.suit === b.suit && a.value === b.value;
}

// --- Condition checks (Task 5.1) ---

/** True iff hand contains >= 2 tiles matching discarded suit+value */
export function canPeng(hand: Tile[], discarded: Tile): boolean {
  return hand.filter((t) => sameSuitValue(t, discarded)).length >= 2;
}

/** True iff hand contains >= 3 tiles matching discarded suit+value */
export function canMingGang(hand: Tile[], discarded: Tile): boolean {
  return hand.filter((t) => sameSuitValue(t, discarded)).length >= 3;
}

/** Returns one of the 4 matching tiles if hand has 4 with same suit+value, null otherwise */
export function canAnGang(hand: Tile[]): Tile | null {
  for (const tile of hand) {
    if (hand.filter((t) => sameSuitValue(t, tile)).length >= 4) {
      return tile;
    }
  }
  return null;
}

/** Returns tile and meld index if hand has a tile matching a peng meld, null otherwise */
export function canBuGang(
  hand: Tile[],
  melds: Meld[],
): { tile: Tile; meldIndex: number } | null {
  for (let i = 0; i < melds.length; i++) {
    const meld = melds[i];
    if (meld.type !== 'peng') continue;
    const meldTile = meld.tiles[0];
    const match = hand.find((t) => sameSuitValue(t, meldTile));
    if (match) {
      return { tile: match, meldIndex: i };
    }
  }
  return null;
}

// --- Execution logic (Task 5.3) ---

/** Remove 2 matching tiles from hand, create peng meld with 3 tiles */
export function executePeng(
  hand: Tile[],
  discarded: Tile,
  fromPlayer?: string,
): { hand: Tile[]; meld: Meld } {
  const remaining = [...hand];
  const meldTiles: Tile[] = [];
  let removed = 0;

  for (let i = remaining.length - 1; i >= 0 && removed < 2; i--) {
    if (sameSuitValue(remaining[i], discarded)) {
      meldTiles.push(remaining.splice(i, 1)[0]);
      removed++;
    }
  }

  meldTiles.push(discarded);

  return {
    hand: remaining,
    meld: { type: 'peng', tiles: meldTiles, fromPlayer },
  };
}

/** Remove 3 matching tiles from hand, create ming_gang meld with 4 tiles */
export function executeMingGang(
  hand: Tile[],
  discarded: Tile,
  fromPlayer?: string,
): { hand: Tile[]; meld: Meld } {
  const remaining = [...hand];
  const meldTiles: Tile[] = [];
  let removed = 0;

  for (let i = remaining.length - 1; i >= 0 && removed < 3; i--) {
    if (sameSuitValue(remaining[i], discarded)) {
      meldTiles.push(remaining.splice(i, 1)[0]);
      removed++;
    }
  }

  meldTiles.push(discarded);

  return {
    hand: remaining,
    meld: { type: 'ming_gang', tiles: meldTiles, fromPlayer },
  };
}

/** Remove 4 matching tiles from hand, create an_gang meld */
export function executeAnGang(
  hand: Tile[],
  tile: Tile,
): { hand: Tile[]; meld: Meld } {
  const remaining = [...hand];
  const meldTiles: Tile[] = [];
  let removed = 0;

  for (let i = remaining.length - 1; i >= 0 && removed < 4; i--) {
    if (sameSuitValue(remaining[i], tile)) {
      meldTiles.push(remaining.splice(i, 1)[0]);
      removed++;
    }
  }

  return {
    hand: remaining,
    meld: { type: 'an_gang', tiles: meldTiles },
  };
}

/** Remove 1 tile from hand, upgrade peng meld to bu_gang */
export function executeBuGang(
  hand: Tile[],
  melds: Meld[],
  tile: Tile,
  meldIndex: number,
): { hand: Tile[]; melds: Meld[] } {
  const remaining = hand.filter((t) => t.id !== tile.id);
  const updatedMelds = melds.map((m, i) => {
    if (i === meldIndex) {
      return {
        ...m,
        type: 'bu_gang' as const,
        tiles: [...m.tiles, tile],
      };
    }
    return m;
  });

  return { hand: remaining, melds: updatedMelds };
}
