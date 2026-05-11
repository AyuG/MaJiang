'use client';

import { useState, useCallback } from 'react';
import type { ScoreLogEntry } from '@/hooks/useGameState';

interface ScorePanelProps {
  scoreLog: ScoreLogEntry[];
  nicknames?: Record<string, string>;
  /** If true, renders as a modal overlay. Otherwise renders as floating button. */
  modal?: boolean;
  onClose?: () => void;
  onClear?: () => void;
}

const SEATS = ['东', '南', '西', '北'];

export function ScorePanel({ scoreLog, nicknames, modal, onClose, onClear }: ScorePanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (scoreLog.length === 0 && !modal) return null;

  const content = (
    <div className="sp-body" style={modal ? { maxWidth: '90vw', maxHeight: '80vh', fontSize: '.85rem' } : {}}>
      {scoreLog.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '1rem' }}>暂无积分记录</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', color: '#d4d4d4' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #374151' }}>
              <th style={th}>房间号</th>
              <th style={th}>局数</th>
              <th style={th}>东-积分</th>
              <th style={th}>南-积分</th>
              <th style={th}>西-积分</th>
              <th style={th}>北-积分</th>
              <th style={th}>状态</th>
            </tr>
          </thead>
          <tbody>
            {scoreLog.map((entry, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={{ ...td, color: '#63b3ed' }}>{entry.roomId}</td>
                <td style={td}>第{entry.round}局</td>
                {SEATS.map((seat) => {
                  const s = entry.scores.find((sc) => sc.seat === seat);
                  return (
                    <td key={seat} style={{ ...td, textAlign: 'center' }}>
                      {s ? (
                        <span style={{ color: s.delta > 0 ? '#4ade80' : s.delta < 0 ? '#f87171' : '#9ca3af' }}>
                          {nicknames?.[s.playerId] || s.playerId.slice(0, 6)}：{s.delta > 0 ? '+' : ''}{s.delta}分
                        </span>
                      ) : (
                        <span style={{ color: '#4a5568' }}>—</span>
                      )}
                    </td>
                  );
                })}
                <td style={td}>
                  <span style={{
                    color: entry.status === 'finished' ? '#34d399' : '#e8b339',
                    background: entry.status === 'finished' ? 'rgba(52,211,153,.12)' : 'rgba(232,179,57,.12)',
                    padding: '1px 6px',
                    borderRadius: '3px',
                    fontSize: '.78rem',
                  }}>
                    {entry.status === 'finished' ? '已结束' : '进行中'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  // Modal mode: centered overlay
  if (modal) {
    return (
      <div className="score-modal-overlay" onClick={onClose}>
        <div className="score-modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="score-modal-header">
            <span className="score-modal-title">积分记录</span>
            <div style={{ display: 'flex', gap: '.4rem' }}>
              {onClear && (
                <button className="hd-btn" onClick={onClear} style={{ background: '#4a2a2a', borderColor: '#6e3a3a', color: '#feb2b2' }}>清理旧数据</button>
              )}
              <button className="hd-btn" onClick={onClose}>关闭</button>
            </div>
          </div>
          {content}
        </div>
      </div>
    );
  }

  // Floating mode (original behavior)
  return (
    <div className="sp-float" style={{ left: 8, bottom: 8 }}>
      <button className="sp-btn" onClick={() => setIsOpen(!isOpen)}>
        📊{isOpen ? '收起' : scoreLog.length}
      </button>
      {isOpen && content}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '4px 8px',
  textAlign: 'center',
  color: '#9ca3af',
  fontSize: '.78rem',
  fontWeight: 'normal',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: '.78rem',
  whiteSpace: 'nowrap',
  textAlign: 'center',
};
