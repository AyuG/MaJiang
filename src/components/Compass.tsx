'use client';

const DIRS = ['东', '南', '西', '北'] as const;

interface CompassProps {
  seatOrder: number[];
  currentSeatIndex: number;
  wallCount: number;
}

export function Compass({ seatOrder, currentSeatIndex, wallCount }: CompassProps) {
  const [botI, rightI, topI, leftI] = seatOrder;

  return (
    <div className="compass">
      <div className={`cp-dir cp-top${topI === currentSeatIndex ? ' cp-active' : ''}`}>{DIRS[topI]}</div>
      <div className="cp-mid">
        <div className={`cp-dir cp-left${leftI === currentSeatIndex ? ' cp-active' : ''}`}>{DIRS[leftI]}</div>
        <div className="cp-center">
          <div className="cp-wall">{wallCount}</div>
        </div>
        <div className={`cp-dir cp-right${rightI === currentSeatIndex ? ' cp-active' : ''}`}>{DIRS[rightI]}</div>
      </div>
      <div className={`cp-dir cp-bot${botI === currentSeatIndex ? ' cp-active' : ''}`}>{DIRS[botI]}</div>
    </div>
  );
}
