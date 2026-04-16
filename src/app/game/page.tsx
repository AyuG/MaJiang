'use client';

import { useMahjongSocket } from '@/hooks/useMahjongSocket';
import { GameBoard } from '@/components/GameBoard';
import { ActionBar } from '@/components/ActionBar';
import { PauseOverlay } from '@/components/PauseOverlay';

/**
 * 游戏大厅页面 — 未来将扩展为显示房间列表、快速匹配等功能。
 * 当前作为独立游戏视图，通过 Socket 接收游戏状态。
 */
export default function GamePage() {
  const {
    playerId,
    gameState,
    availableActions,
    gangOptions,
    remainingSeconds,
    discard,
    peng,
    gang,
    hu,
    pass,
    voteDissolve,
  } = useMahjongSocket();

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
        onTileClick={discard}
        onVoteDissolve={voteDissolve}
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
    </main>
  );
}
