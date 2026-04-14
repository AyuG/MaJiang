import type { GangRecord, ScoreChange, RuleConfig } from '@/types';

/**
 * Record a gang score entry (delayed settlement).
 * Returns a GangRecord to be accumulated during the game.
 */
export function recordGangScore(
  type: 'ming' | 'an' | 'bu',
  gangPlayerIndex: number,
  targetPlayerIndex?: number,
): GangRecord {
  const record: GangRecord = { type, gangPlayerIndex };
  if (targetPlayerIndex !== undefined) {
    record.targetPlayerIndex = targetPlayerIndex;
  }
  return record;
}

/**
 * Settle all gang records + win score when a player wins.
 *
 * Gang scoring:
 * - ming/bu: target pays gangScore to gang player
 * - an: other 3 players each pay gangScore to gang player
 *
 * Win scoring:
 * - other 3 players each pay winScore to winner
 *
 * All changes sum to zero (zero-sum).
 */
export function settleWin(
  gangRecords: GangRecord[],
  winnerIndex: number,
  playerCount: number,
  config: RuleConfig,
): ScoreChange[] {
  // Accumulate deltas per player
  const deltas = new Array(playerCount).fill(0);

  // Settle gang records
  for (const record of gangRecords) {
    if (record.type === 'an') {
      // An gang: other 3 pay gangScore each
      for (let i = 0; i < playerCount; i++) {
        if (i !== record.gangPlayerIndex) {
          deltas[i] -= config.gangScore;
          deltas[record.gangPlayerIndex] += config.gangScore;
        }
      }
    } else {
      // Ming/bu gang: target pays gangScore
      if (record.targetPlayerIndex !== undefined) {
        deltas[record.targetPlayerIndex] -= config.gangScore;
        deltas[record.gangPlayerIndex] += config.gangScore;
      }
    }
  }

  // Settle win score: other 3 each pay winScore to winner
  for (let i = 0; i < playerCount; i++) {
    if (i !== winnerIndex) {
      deltas[i] -= config.winScore;
      deltas[winnerIndex] += config.winScore;
    }
  }

  // Convert to ScoreChange array
  const changes: ScoreChange[] = [];
  for (let i = 0; i < playerCount; i++) {
    if (deltas[i] !== 0) {
      changes.push({ playerIndex: i, delta: deltas[i] });
    }
  }

  return changes;
}

/**
 * Settle a draw (流局): clear all gang records, no score changes.
 * Mutates the gangRecords array to empty (atomic clear).
 * Returns empty ScoreChange[].
 */
export function settleDraw(gangRecords: GangRecord[]): ScoreChange[] {
  gangRecords.length = 0;
  return [];
}
