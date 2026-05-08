'use client';

import { useState, useRef, useCallback } from 'react';

interface ScoreLogEntry {
  round: number;
  roomId?: string;
  result: 'win' | 'draw';
  winnerId?: string;
  scores: Array<{ playerId: string; seat: string; delta: number }>;
}

interface ScorePanelProps {
  myPlayerId: string;
  scoreLog: ScoreLogEntry[];
  /** Map of playerId → nickname for display */
  nicknames?: Record<string, string>;
}

export function ScorePanel({ myPlayerId, scoreLog, nicknames }: ScorePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState({ x: 8, y: 8 });
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
    offset.current = { x: e.clientX - pos.x, y: e.clientY + pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) {
      setPos({ x: e.clientX - offset.current.x, y: offset.current.y - e.clientY });
      return;
    }
    const dx = Math.abs(e.clientX - dragStart.current.x);
    const dy = Math.abs(e.clientY - dragStart.current.y);
    if (dx > 4 || dy > 4) dragging.current = true;
  }, []);

  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  const getSeatNick = (s: { playerId: string; seat: string }) => {
    const nick = nicknames?.[s.playerId];
    return nick ? `${s.seat}(${nick})` : s.seat;
  };

  if (scoreLog.length === 0) return null;

  return (
    <div className="sp-float" style={{ left: pos.x, bottom: pos.y }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <button className="sp-btn" onClick={() => setIsOpen(!isOpen)}>
        📊{isOpen ? '收起' : scoreLog.length}
      </button>
      {isOpen && (
        <div className="sp-body">
          {scoreLog.map((e, i) => (
            <div key={i} className="sp-row">
              {e.roomId && <span className="sp-room">[{e.roomId}]</span>}
              <span className="sp-rd">第{e.round}局</span>
              <span className="sp-res">{e.result === 'win' ? '胡' : '流'}</span>
              {e.scores.filter((s) => s.delta !== 0).map((s) => (
                <span key={s.playerId} className="sp-d" style={{ color: s.delta > 0 ? '#4ade80' : '#f87171' }}>
                  {getSeatNick(s)}:{s.delta > 0 ? '+' : ''}{s.delta}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
