'use client';

import type { Tile as TileType } from '@/types';
import { formatTile } from '@/engine/tile-formatter';

interface TileProps {
  tile: TileType;
  isSelected?: boolean;
  isLastDrawn?: boolean;
  isFaceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

/**
 * Abstract Tile component.
 * Currently renders text; style reserves background-image interface
 * for future graphical tile assets.
 */
export function Tile({ tile, isSelected, isLastDrawn, isFaceDown, size = 'md', onClick }: TileProps) {
  const sizeClass = `tile-${size}`;
  const classes = [
    'tile',
    sizeClass,
    isSelected ? 'tile-selected tile-bounce' : '',
    isLastDrawn && !isSelected ? 'tile-last-drawn tile-bounce' : '',
    isFaceDown ? 'tile-facedown' : '',
    onClick ? 'tile-clickable' : '',
  ].filter(Boolean).join(' ');

  // Future: style={{ backgroundImage: `url(/tiles/${tile.suit}_${tile.value}.png)` }}
  return (
    <div className={classes} onClick={onClick} data-tile-id={tile.id}>
      {isFaceDown ? '🀫' : formatTile(tile)}
    </div>
  );
}

/** Render a row of face-down tiles (for opponents) */
export function TileBack({ count, size = 'sm' }: { count: number; size?: 'sm' | 'md' }) {
  return (
    <span className="tile-back-row">
      {count}张
    </span>
  );
}
