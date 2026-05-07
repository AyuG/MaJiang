'use client';

import type { Meld } from '@/types';
import { Tile } from './Tile';

interface MeldDisplayProps {
  melds: Meld[];
  /** Seat index of the meld owner (0-3) */
  ownerSeatIndex?: number;
  /** All player IDs in seat order, used to resolve fromPlayer → direction */
  allPlayerIds?: string[];
  /** Position of the meld owner relative to self: 'self', 'right', 'top', 'left' */
  position?: 'self' | 'right' | 'top' | 'left';
}

/**
 * Renders meld groups using Tile components.
 *
 * Source marking (背面标记):
 * - 碰/明杠: the tile from the source player is shown face-down.
 *   Position depends on relative direction:
 *   上家 → left tile face-down
 *   下家 → right tile face-down
 *   对家 → middle tile face-down
 * - 明杠: 中间两张都显示背面（对家来源时只有中间一张背面）
 * - 补杠: 第4张牌正面显示叠在碰牌上方
 * - 暗杠: 所有牌正面显示
 */
export function MeldDisplay({ melds, ownerSeatIndex, allPlayerIds, position = 'self' }: MeldDisplayProps) {
  if (melds.length === 0) return null;

  return (
    <div className={`meld-row meld-row-${position}`}>
      {melds.map((meld, mi) => (
        <MeldGroup key={mi} meld={meld} ownerSeatIndex={ownerSeatIndex} allPlayerIds={allPlayerIds} position={position} />
      ))}
    </div>
  );
}

function MeldGroup({ meld, ownerSeatIndex, allPlayerIds, position }: {
  meld: Meld; ownerSeatIndex?: number; allPlayerIds?: string[]; position?: 'self' | 'right' | 'top' | 'left';
}) {
  // 暗杠: all face-up (own tiles)
  if (meld.type === 'an_gang') {
    return (
      <div className="meld-group meld-an-gang">
        {meld.tiles.map((t) => <Tile key={t.id} tile={t} size="sm" />)}
      </div>
    );
  }

  // Determine source direction relative to meld owner
  const sourceDir = getSourceDirection(meld, ownerSeatIndex, allPlayerIds);

  if (meld.type === 'bu_gang') {
    // 补杠: first 3 tiles like peng (one face-down by direction), 4th face-up stacked
    const base = meld.tiles.slice(0, 3);
    const extra = meld.tiles[3]; // the 4th tile added later
    const faceDownIndex = getFaceDownIndex(sourceDir, 'peng');
    return (
      <div className="meld-group meld-bu-gang">
        {base.map((t, i) => (
          <Tile key={t.id} tile={t} size="sm" isFaceDown={i === faceDownIndex} />
        ))}
        {extra && (
          <div className="meld-extra">
            <Tile tile={extra} size="sm" />
          </div>
        )}
      </div>
    );
  }

  // 碰 / 明杠
  const faceDownIndices = getFaceDownIndices(sourceDir, meld.type);
  
  return (
    <div className={`meld-group meld-${meld.type}`}>
      {meld.tiles.map((t, i) => (
        <Tile key={t.id} tile={t} size="sm" isFaceDown={faceDownIndices.includes(i)} />
      ))}
    </div>
  );
}

/**
 * Get the index of the face-down tile for peng (0, 1, or 2)
 */
function getFaceDownIndex(dir: 'left' | 'mid' | 'right' | 'none', type: 'peng' | 'ming_gang'): number {
  if (type === 'peng') {
    // 碰: 3张牌，索引 0, 1, 2
    if (dir === 'left') return 0;   // 上家 → 最左
    if (dir === 'right') return 2;  // 下家 → 最右
    if (dir === 'mid') return 1;    // 对家 → 中间
  }
  return -1; // no face-down
}

/**
 * Get the indices of face-down tiles for ming_gang
 */
function getFaceDownIndices(dir: 'left' | 'mid' | 'right' | 'none', type: 'peng' | 'ming_gang'): number[] {
  if (type === 'peng') {
    const idx = getFaceDownIndex(dir, type);
    return idx >= 0 ? [idx] : [];
  }
  
  if (type === 'ming_gang') {
    // 明杠: 4张牌，索引 0, 1, 2, 3
    if (dir === 'left') return [0];           // 上家 → 最左
    if (dir === 'right') return [3];          // 下家 → 最右
    if (dir === 'mid') return [1, 2];         // 对家 → 中间两张
  }
  
  return [];
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
  // In Chinese Mahjong, seats go: 东(0) → 南(1) → 西(2) → 北(3) → 东...
  // 上家 = the player who acts before you (counterclockwise)
  // 下家 = the player who acts after you (clockwise)
  
  const diff = (sourceIdx - ownerSeatIndex + 4) % 4;
  // diff=1 → 下家
  // diff=2 → 对家
  // diff=3 → 上家
  
  if (diff === 3) return 'left';   // 上家
  if (diff === 2) return 'mid';    // 对家
  if (diff === 1) return 'right';  // 下家
  return 'none'; // self (shouldn't happen for peng/ming_gang)
}
