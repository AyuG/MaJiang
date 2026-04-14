'use client';

import type { ClientGameState } from '@/types';

interface PauseOverlayProps {
  gameState: ClientGameState;
}

export function PauseOverlay({ gameState }: PauseOverlayProps) {
  const disconnected = gameState.players.filter((p) => !p.isConnected);

  return (
    <div className="pause-overlay">
      <div className="pause-content">
        <h2>游戏暂停</h2>
        <p>等待玩家重连...</p>
        {disconnected.map((p) => (
          <div key={p.id} className="disconnected-player">
            🔴 {p.id} 已断线
          </div>
        ))}
      </div>
    </div>
  );
}
