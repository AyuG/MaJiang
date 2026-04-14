'use client';

import type { Tile } from '@/types';
import { TileSuit } from '@/types';
import { formatTile } from '@/engine/tile-formatter';

const SUIT_ORDER: Record<string, number> = {
  [TileSuit.WAN]: 0,
  [TileSuit.TIAO]: 1,
  [TileSuit.TONG]: 2,
  [TileSuit.FENG]: 3,
  [TileSuit.ZI]: 4,
};

function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => {
    const suitDiff = (SUIT_ORDER[a.suit] ?? 9) - (SUIT_ORDER[b.suit] ?? 9);
    if (suitDiff !== 0) return suitDiff;
    return a.value - b.value;
  });
}

interface HandDisplayProps {
  tiles: Tile[];
  isSelf: boolean;
  lastDrawnTileId?: number;
  onTileClick?: (tileId: number) => void;
}

export function HandDisplay({ tiles, isSelf, lastDrawnTileId, onTileClick }: HandDisplayProps) {
  if (!isSelf) {
    return <span className="hand-hidden">手牌: {tiles.length}张</span>;
  }

  const sorted = sortTiles(tiles);

  return (
    <div className="hand-display">
      {sorted.map((tile) => {
        const isLastDrawn = tile.id === lastDrawnTileId;
        return (
          <button
            key={tile.id}
            className={`tile-btn${isLastDrawn ? ' tile-last-drawn tile-bounce' : ''}`}
            onClick={() => onTileClick?.(tile.id)}
            title={`ID:${tile.id}`}
          >
            [{formatTile(tile)}]
          </button>
        );
      })}
    </div>
  );
}
