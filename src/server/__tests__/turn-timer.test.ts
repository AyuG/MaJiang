import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnTimer } from '@/server/turn-timer';

afterEach(() => { vi.useRealTimers(); });

describe('timeout round/turn identity', () => {
  it('captures the scheduled identity instead of a mutable or subsequent round', () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const timer = new TurnTimer(expired);
    const expected = { roundNumber: 7, turnCount: 12 };
    timer.startTurnTimer('room', 'p0', 100, expected);
    expected.roundNumber = 8;
    vi.advanceTimersByTime(100);
    expect(expired).toHaveBeenCalledWith('room', 'p0', 'TURN', { roundNumber: 7, turnCount: 12 });
  });

  it('preserves identity through suspend/resume and cancels the previous turn when rearmed', () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const timer = new TurnTimer(expired);
    timer.startTurnTimer('room', 'p0', 100, { roundNumber: 7, turnCount: 12 });
    timer.startAwaitingTimer('room', 'p1', 200, { roundNumber: 7, turnCount: 13 });
    vi.advanceTimersByTime(50);
    timer.suspend('room');
    vi.advanceTimersByTime(1000);
    expect(expired).not.toHaveBeenCalled();
    timer.resume('room');
    vi.advanceTimersByTime(150);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledWith('room', 'p1', 'AWAITING', { roundNumber: 7, turnCount: 13 });
  });
});
