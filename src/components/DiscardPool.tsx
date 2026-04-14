'use client';

import type { Tile } from '@/types';
import { formatTile } from '@/engine/tile-formatter';

interface DiscardPoolProps {
  tiles: Tile[];
}

export function DiscardPool({ tiles }: DiscardPoolProps) {
  if (tiles.length === 0) {
    return <div className="discard-pool">弃牌: (无)</div>;
  }

  return (
    <div className="discard-pool">
      弃牌:{' '}
      {tiles.map((tile, i) => {
        const isLast = i === tiles.length - 1;
        return (
          <span key={tile.id} className={isLast ? 'discard-latest' : ''}>
            [{formatTile(tile)}]
          </span>
        );
      })}
    </div>
  );
}
