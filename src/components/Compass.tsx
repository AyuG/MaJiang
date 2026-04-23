'use client';

const DIRS = ['东', '南', '西', '北'] as const;

interface CompassProps {
  /** Seat indices in display order: [bottom, right, top, left] relative to local player */
  seatOrder: number[];
  /** Which seat index is currently active (their turn) */
  currentSeatIndex: number;
  /** Remaining tiles in wall */
  wallCount: number;
  /** Round number */
  roundNumber: number;
}

/**
 * Central compass block — shows 东南西北 from local player's perspective.
 * Active direction blinks. Center shows wall count.
 */
export function Compass({ seatOrder, currentSeatIndex, wallCount, roundNumber }: CompassProps) {
  const [botI, rightI, topI, leftI] = seatOrder;

  return (
    <div className="compass">
      {/* Top direction */}
      <div className={`cp-dir cp-top${topI === currentSeatIndex ? ' cp-active' : ''}`}>
        {DIRS[topI]}
      </div>
      {/* Middle row: left | center | right */}
      <div className="cp-mid">
        <div className={`cp-dir cp-left${leftI === currentSeatIndex ? ' cp-active' : ''}`}>
          {DIRS[leftI]}
        </div>
        <div className="cp-center">
          <div className="cp-wall">{wallCount}</div>
          <div className="cp-round">第{roundNumber}局</div>
        </div>
        <div className={`cp-dir cp-right${rightI === currentSeatIndex ? ' cp-active' : ''}`}>
          {DIRS[rightI]}
        </div>
      </div>
      {/* Bottom direction */}
      <div className={`cp-dir cp-bot${botI === currentSeatIndex ? ' cp-active' : ''}`}>
        {DIRS[botI]}
      </div>
    </div>
  );
}
