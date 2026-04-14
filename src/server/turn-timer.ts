import type { GamePhase } from '@/types';

interface TimerEntry {
  timeout: ReturnType<typeof setTimeout>;
  roomId: string;
  playerId: string;
  phase: GamePhase;
  durationMs: number;
  startedAt: number;
  remainingMs: number;
  suspended: boolean;
}

/**
 * TurnTimer — manages per-room turn and awaiting timers with
 * suspend/resume support for disconnect handling.
 */
export class TurnTimer {
  private timers = new Map<string, TimerEntry>();

  constructor(
    private onTimeout: (roomId: string, playerId: string, phase: GamePhase) => void,
  ) {}

  /** Start a TURN phase timer (default 30s). */
  startTurnTimer(roomId: string, playerId: string, durationMs = 30_000): void {
    this.clearRoom(roomId);
    this.startTimer(roomId, playerId, 'TURN', durationMs);
  }

  /** Start an AWAITING phase timer (default 15s). */
  startAwaitingTimer(roomId: string, playerId: string, durationMs = 15_000): void {
    this.clearRoom(roomId);
    this.startTimer(roomId, playerId, 'AWAITING', durationMs);
  }

  /** Suspend (pause) all timers for a room — used on disconnect. */
  suspend(roomId: string): void {
    const entry = this.timers.get(roomId);
    if (!entry || entry.suspended) return;

    clearTimeout(entry.timeout);
    const elapsed = Date.now() - entry.startedAt;
    entry.remainingMs = Math.max(0, entry.durationMs - elapsed);
    entry.suspended = true;
  }

  /** Resume timers for a room from remaining time — used on reconnect. */
  resume(roomId: string): void {
    const entry = this.timers.get(roomId);
    if (!entry || !entry.suspended) return;

    entry.suspended = false;
    entry.startedAt = Date.now();
    entry.durationMs = entry.remainingMs;

    entry.timeout = setTimeout(() => {
      this.timers.delete(roomId);
      this.onTimeout(entry.roomId, entry.playerId, entry.phase);
    }, entry.remainingMs);
  }

  /** Clear all timers for a room. */
  clear(roomId: string): void {
    this.clearRoom(roomId);
  }

  /** Get remaining time for a room (for testing). */
  getRemaining(roomId: string): number | null {
    const entry = this.timers.get(roomId);
    if (!entry) return null;
    if (entry.suspended) return entry.remainingMs;
    const elapsed = Date.now() - entry.startedAt;
    return Math.max(0, entry.durationMs - elapsed);
  }

  private startTimer(roomId: string, playerId: string, phase: GamePhase, durationMs: number): void {
    const timeout = setTimeout(() => {
      this.timers.delete(roomId);
      this.onTimeout(roomId, playerId, phase);
    }, durationMs);

    this.timers.set(roomId, {
      timeout,
      roomId,
      playerId,
      phase,
      durationMs,
      startedAt: Date.now(),
      remainingMs: durationMs,
      suspended: false,
    });
  }

  private clearRoom(roomId: string): void {
    const entry = this.timers.get(roomId);
    if (entry) {
      clearTimeout(entry.timeout);
      this.timers.delete(roomId);
    }
  }
}
