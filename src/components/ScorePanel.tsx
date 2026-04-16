'use client';

import { useState } from 'react';

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
}

export function ScorePanel({ myPlayerId, scoreLog }: ScorePanelProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (scoreLog.length === 0) return null;

  return (
    <div className="score-panel">
      <button className="score-toggle" onClick={() => setIsOpen(!isOpen)}>
        📊 {isOpen ? '收起' : `积分(${scoreLog.length})`}
      </button>
      {isOpen && (
        <div className="score-panel-body">
          {scoreLog.map((entry, idx) => (
            <div key={idx} className="score-log-entry">
              {entry.roomId && <span className="score-log-room">[{entry.roomId}]</span>}
              <span className="score-log-round">第{entry.round}局</span>
              <span className="score-log-result">{entry.result === 'win' ? '胡' : '流'}</span>
              {entry.scores.filter((s) => s.delta !== 0).map((s) => (
                <span key={s.playerId} className="score-log-delta" style={{
                  color: s.delta > 0 ? '#4caf50' : '#ff6b6b',
                }}>
                  {s.seat}{s.playerId === myPlayerId ? '(你)' : ''}:{s.delta > 0 ? '+' : ''}{s.delta}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
