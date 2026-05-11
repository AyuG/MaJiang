'use client';

import { useState } from 'react';
import { useMahjongSocket } from '@/hooks/useMahjongSocket';
import { GameBoard } from '@/components/GameBoard';
import { ActionBar } from '@/components/ActionBar';
import { PauseOverlay } from '@/components/PauseOverlay';
import { ScorePanel } from '@/components/ScorePanel';

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
  const myPlayerId = playerId;

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
          scoreLog={scoreLog}
          modal
          onClose={() => setShowScores(false)}
        />
      )}
    </main>
  );
}
