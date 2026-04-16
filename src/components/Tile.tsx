'use client';

import type { Tile as TileType } from '@/types';
import { TileFace } from './TileFace';

interface TileProps {
  tile: TileType;
  isSelected?: boolean;
  isLastDrawn?: boolean;
  isFaceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

/**
 * Mahjong tile component with graphical face rendering.
 * - Front: SVG/styled patterns matching traditional tile art
 * - Back: solid green (face down)
 */
export function Tile({ tile, isSelected, isLastDrawn, isFaceDown, size = 'md', onClick }: TileProps) {
  const classes = [
    'tile',
    `tile-${size}`,
    isSelected ? 'tile-selected tile-bounce' : '',
    isLastDrawn && !isSelected ? 'tile-last-drawn tile-bounce' : '',
    isFaceDown ? 'tile-facedown' : '',
    onClick ? 'tile-clickable' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} onClick={onClick} data-tile-id={tile.id}>
      {isFaceDown ? (
        <div className="tile-back" />
      ) : (
        <TileFace tile={tile} />
      )}
    </div>
  );
}

export function TileBack({ count }: { count: number }) {
  return <span className="tile-back-row">{count}张</span>;
}
