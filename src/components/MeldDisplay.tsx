'use client';

import type { Meld, Tile as TileType } from '@/types';
import { Tile } from './Tile';

interface MeldDisplayProps {
  melds: Meld[];
  /** Index of the player who owns these melds (0-3), used to determine
   *  which tile in a peng/gang should be laid sideways (横放) to mark source */
  ownerIndex?: number;
  /** Index of each meld's source player, derived from fromPlayer field */
  playerIds?: string[];
}

/**
 * Renders meld groups using actual Tile components.
 * - Peng: 3 tiles, one sideways (横放) to mark source
 * - Ming gang: 4 tiles, one sideways
 * - Bu gang: 4 tiles, one sideways
 * - An gang: 4 face-down tiles (暗杠)
 */
export function MeldDisplay({ melds, ownerIndex, playerIds }: MeldDisplayProps) {
  if (melds.length === 0) return null;

  return (
    <div className="meld-row">
      {melds.map((meld, mi) => (
        <div key={mi} className="meld-group">
          {meld.type === 'an_gang' ? (
            // An gang: 4 face-down tiles
            <>
              <Tile tile={meld.tiles[0]} size="sm" isFaceDown />
              <Tile tile={meld.tiles[1]} size="sm" isFaceDown />
              <Tile tile={meld.tiles[2]} size="sm" isFaceDown />
              <Tile tile={meld.tiles[3]} size="sm" isFaceDown />
            </>
          ) : (
            // Peng / Ming gang / Bu gang: render tiles with one sideways
            meld.tiles.map((t, ti) => {
              // Determine which tile to lay sideways:
              // The tile that came from another player (the last one added in peng/ming_gang)
              const isSideways = getSidewaysIndex(meld, ti);
              return (
                <div key={t.id} className={isSideways ? 'meld-tile-side' : 'meld-tile'}>
                  <Tile tile={t} size="sm" />
                </div>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}

/** Determine if tile at index `ti` should be laid sideways in a meld */
function getSidewaysIndex(meld: Meld, ti: number): boolean {
  if (meld.type === 'an_gang') return false;
  // Convention: the last tile in peng (index 2) or ming_gang (index 3) is the claimed tile
  if (meld.type === 'peng' && ti === 2) return true;
  if (meld.type === 'ming_gang' && ti === 3) return true;
  if (meld.type === 'bu_gang' && ti === 3) return true; // the 4th tile added later
  return false;
}
