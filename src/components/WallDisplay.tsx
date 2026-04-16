'use client';

interface WallDisplayProps {
  wallCount: number;
  totalTiles?: number; // default 136
}

/**
 * Central wall display — shows remaining wall as a visual stack.
 * Simulates the 4-sided wall (17 stacks × 2 layers per side = 136 tiles).
 */
export function WallDisplay({ wallCount, totalTiles = 136 }: WallDisplayProps) {
  const pct = Math.round((wallCount / totalTiles) * 100);
  // Show as stacks remaining (each stack = 2 tiles, 17 stacks per side)
  const stacks = Math.ceil(wallCount / 2);

  return (
    <div className="wall-display">
      <div className="wall-bar">
        <div className="wall-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="wall-text">{wallCount}张 ({stacks}墩)</div>
    </div>
  );
}
