'use client';

import type { Tile as TileType } from '@/types';

interface TileProps {
  tile: TileType;
  isSelected?: boolean;
  isLastDrawn?: boolean;
  isFaceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

/** Map tile suit+value to image filename */
function tileImagePath(tile: TileType): string {
  return `/tiles/${tile.suit}_${tile.value}.png`;
}

/**
 * Mahjong tile — renders using riichi-mahjong-tiles PNG assets.
 * Tile art: CC0 public domain (FluffyStuff/riichi-mahjong-tiles).
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

  const imgSrc = isFaceDown ? '/tiles/back.png' : tileImagePath(tile);

  return (
    <div className={classes} onClick={onClick} data-tile-id={tile.id}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imgSrc} alt="" className="tile-img" draggable={false} />
    </div>
  );
}

export function TileBack({ count }: { count: number }) {
  return <span className="tile-back-label">{count}张</span>;
}
