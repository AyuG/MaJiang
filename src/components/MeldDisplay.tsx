'use client';

import type { Meld } from '@/types';
import { Tile } from './Tile';

interface MeldDisplayProps {
  melds: Meld[];
  /** Seat index of the meld owner (0-3) */
  ownerSeatIndex?: number;
  /** All player IDs in seat order, used to resolve fromPlayer → direction */
  allPlayerIds?: string[];
}

/**
 * Renders meld groups using Tile components.
 *
 * Source marking (背面标记):
 * - 碰/明杠: the tile from the source player is shown face-down.
 *   Position depends on relative direction:
 *   上家(left) → left tile face-down
 *   下家(right) → right tile face-down
 *   对家(across) → middle tile face-down
 * - 补杠: 4th tile shown face-up in the middle (on top of the peng)
 * - 暗杠: all 4 tiles face-up (player's own tiles, no source)
 */
export function MeldDisplay({ melds, ownerSeatIndex, allPlayerIds }: MeldDisplayProps) {
  if (melds.length === 0) return null;

  return (
    <div className="meld-row">
      {melds.map((meld, mi) => (
        <MeldGroup key={mi} meld={meld} ownerSeatIndex={ownerSeatIndex} allPlayerIds={allPlayerIds} />
      ))}
    </div>
  );
}

function MeldGroup({ meld, ownerSeatIndex, allPlayerIds }: {
  meld: Meld; ownerSeatIndex?: number; allPlayerIds?: string[];
}) {
  // 暗杠: all face-up (own tiles)
  if (meld.type === 'an_gang') {
    return (
      <div className="meld-group">
        {meld.tiles.map((t) => <Tile key={t.id} tile={t} size="sm" />)}
      </div>
    );
  }

  // Determine source direction
  const dir = getSourceDirection(meld, ownerSeatIndex, allPlayerIds);

  if (meld.type === 'bu_gang') {
    // 补杠: first 3 tiles like peng (one face-down by direction), 4th face-up in middle
    const base = meld.tiles.slice(0, 3);
    const extra = meld.tiles[3]; // the 4th tile added later
    return (
      <div className="meld-group">
        {base.map((t, i) => {
          const pos = i === 0 ? 'left' : i === 1 ? 'mid' : 'right';
          return <Tile key={t.id} tile={t} size="sm" isFaceDown={pos === dir} />;
        })}
        {extra && (
          <div className="meld-extra">
            <Tile tile={extra} size="sm" />
          </div>
        )}
      </div>
    );
  }

  // 碰 / 明杠: one tile face-down based on source direction
  return (
    <div className="meld-group">
      {meld.tiles.map((t, i) => {
        let pos: 'left' | 'mid' | 'right';
        if (meld.type === 'peng') {
          pos = i === 0 ? 'left' : i === 1 ? 'mid' : 'right';
        } else {
          // ming_gang: 4 tiles — left, mid-left, mid-right, right
          pos = i === 0 ? 'left' : i === 3 ? 'right' : 'mid';
        }
        return <Tile key={t.id} tile={t} size="sm" isFaceDown={pos === dir} />;
      })}
    </div>
  );
}

/** Determine which position should be face-down based on source player direction */
function getSourceDirection(
  meld: Meld,
  ownerSeatIndex?: number,
  allPlayerIds?: string[],
): 'left' | 'mid' | 'right' | 'none' {
  if (!meld.fromPlayer || ownerSeatIndex === undefined || !allPlayerIds) return 'left'; // fallback

  const sourceIdx = allPlayerIds.indexOf(meld.fromPlayer);
  if (sourceIdx === -1) return 'left';

  // Relative position: how many seats clockwise from owner to source
  const diff = (sourceIdx - ownerSeatIndex + 4) % 4;
  // diff=1 → next player (下家, right)
  // diff=2 → across (对家, middle)
  // diff=3 → previous player (上家, left)
  if (diff === 3) return 'left';   // 上家
  if (diff === 2) return 'mid';    // 对家
  if (diff === 1) return 'right';  // 下家
  return 'none'; // self (shouldn't happen for peng/ming_gang)
}
