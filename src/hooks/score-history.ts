import type { ClientGameState, ScoreHistoryEntry } from '@/types';

export interface ScoreLogEntry {
  round: number;
  roomId: string;
  result: 'win' | 'draw';
  winnerId?: string;
  scores: Array<{ playerId: string; seat: string; delta: number }>;
  status: 'playing' | 'finished';
}

/** Use the server's persisted baseline, including after reconnect / page reload. */
export function recordCompletedRound(log: ScoreLogEntry[], state: ClientGameState): ScoreLogEntry[] {
  if (state.phase !== 'WIN' && state.phase !== 'DRAW') return log;
  const baseline = state.roundStartScores;
  if (!baseline || state.players.some((p) => !Number.isFinite(baseline[p.id]))) return log;
  const seats = ['东', '南', '西', '北'];
  const existing = log.findIndex((entry) => entry.roomId === state.roomId && entry.round === state.roundNumber);
  const entry: ScoreLogEntry = {
    roomId: state.roomId,
    round: state.roundNumber,
    result: state.phase === 'WIN' ? 'win' : 'draw',
    winnerId: state.phase === 'WIN' ? state.players[state.currentPlayerIndex].id : undefined,
    scores: state.players.map((p, i) => ({ playerId: p.id, seat: seats[i], delta: p.score - baseline[p.id] })),
    status: existing < 0 ? 'playing' : log[existing].status,
  };
  return existing < 0 ? [...log, entry] : log.map((old, i) => i === existing ? entry : old);
}

/** Merge authoritative server history, including rounds missed while disconnected. */
export function mergeScoreHistory(
  log: ScoreLogEntry[], roomId: string, history: ScoreHistoryEntry[], finished = false,
): ScoreLogEntry[] {
  let result = [...log];
  for (const record of history) {
    const index = result.findIndex((entry) => entry.roomId === roomId && entry.round === record.round);
    const entry: ScoreLogEntry = { ...record, roomId,
      status: finished ? 'finished' : index < 0 ? 'playing' : result[index].status };
    if (index < 0) result.push(entry);
    else result[index] = entry;
  }
  if (finished) result = result.map((entry) => entry.roomId === roomId ? { ...entry, status: 'finished' } : entry);
  return result;
}
