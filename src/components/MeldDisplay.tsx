'use client';

import type { Meld } from '@/types';
import { formatTile } from '@/engine/tile-formatter';

interface MeldDisplayProps {
  melds: Meld[];
}

const MELD_LABELS: Record<Meld['type'], string> = {
  peng: '碰',
  ming_gang: '明杠',
  an_gang: '暗杠',
  bu_gang: '补杠',
};

export function MeldDisplay({ melds }: MeldDisplayProps) {
  if (melds.length === 0) return null;

  return (
    <div className="meld-display">
      {melds.map((meld, i) => {
        if (meld.type === 'an_gang') {
          return (
            <span key={i} className="meld-item">
              [暗杠: ****]
            </span>
          );
        }
        const label = MELD_LABELS[meld.type];
        const tileName = meld.tiles.length > 0 ? formatTile(meld.tiles[0]) : '?';
        const count = meld.tiles.length;
        return (
          <span key={i} className="meld-item">
            [{label}: {tileName}×{count}]
          </span>
        );
      })}
    </div>
  );
}
