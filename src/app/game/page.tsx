'use client';

import { useState, useCallback } from 'react';
import { useMahjongSocket } from '@/hooks/useMahjongSocket';
import { clearFinishedScores } from '@/hooks/useGameState';
import type { ScoreLogEntry } from '@/hooks/useGameState';
import { GameBoard } from '@/components/GameBoard';
import { ActionBar } from '@/components/ActionBar';
import { PauseOverlay } from '@/components/PauseOverlay';
import { ScorePanel } from '@/components/ScorePanel';

function loadNicknames(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('mj_nicknames');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export default function GamePage() {
  const {
    playerId,
    gameState,
    availableActions,
    gangOptions,
    remainingSeconds,
    scoreLog,
    discard,
    peng,
    gang,
    hu,
    pass,
    voteDissolve,
    newGame,
  } = useMahjongSocket();

  const [showScores, setShowScores] = useState(false);
  const [displayScoreLog, setDisplayScoreLog] = useState<ScoreLogEntry[] | null>(null);
  const myPlayerId = playerId;
  const nicknames = loadNicknames();

  const handleClearScores = useCallback(() => {
    const remaining = clearFinishedScores();
    setDisplayScoreLog(remaining);
  }, []);

  if (!gameState) {
    return (
      <main className="lobby">
        <h2>游戏大厅</h2>
        <p style={{ color: '#888', marginTop: '1rem' }}>
          暂无进行中的游戏。未来此页面将显示可加入的房间列表。
        </p>
      </main>
    );
  }

  return (
    <main>
      <GameBoard
        gameState={gameState}
        myPlayerId={myPlayerId}
        roomId={gameState.roomId}
        onTileClick={discard}
        onVoteDissolve={voteDissolve}
        onShowScores={() => setShowScores(true)}
        onNewGame={newGame}
      >
        <ActionBar
          availableActions={availableActions}
          gangOptions={gangOptions}
          remainingSeconds={remainingSeconds}
          onPeng={peng}
          onGang={gang}
          onHu={hu}
          onPass={pass}
        />
      </GameBoard>
      {gameState.isPaused && <PauseOverlay gameState={gameState} />}
      {showScores && (
        <ScorePanel
          scoreLog={displayScoreLog ?? scoreLog}
          nicknames={nicknames}
          modal
          onClose={() => { setShowScores(false); setDisplayScoreLog(null); }}
          onClear={handleClearScores}
        />
      )}
    </main>
  );
}
