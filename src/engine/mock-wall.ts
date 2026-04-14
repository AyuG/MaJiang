import type { Tile } from '@/types';

/**
 * Configuration for injecting a preset wall sequence.
 *
 * - 'full': completely replace the shuffled wall with the preset tile sequence.
 * - 'tail': only override the tail (last N tiles) of the wall; the rest stays from seed shuffle.
 */
export interface MockWallConfig {
  mode: 'full' | 'tail';
  /** For 'full': the complete wall. For 'tail': tiles to place at the end. */
  tiles: Tile[];
}

/**
 * Apply a mock wall configuration to a shuffled wall.
 *
 * - When config is null, returns the wall unchanged (production mode).
 * - In production (NODE_ENV === 'production'), always returns wall unchanged regardless of config.
 * - For 'full' mode: returns config.tiles directly.
 * - For 'tail' mode: replaces the last N tiles of wall with config.tiles (N = config.tiles.length).
 */
export function applyMockWall(wall: Tile[], config: MockWallConfig | null): Tile[] {
  if (process.env.NODE_ENV === 'production') {
    return wall;
  }

  if (config === null) {
    return wall;
  }

  if (config.mode === 'full') {
    return config.tiles;
  }

  // tail mode: replace the last N tiles
  const n = config.tiles.length;
  const prefixLen = wall.length - n;
  const result = wall.slice(0, prefixLen);
  return result.concat(config.tiles);
}
