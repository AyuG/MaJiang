'use client';

import type { ClientGameState } from '@/types';
import { PlayerArea } from './PlayerArea';
import { DiscardPool } from './DiscardPool';

const SEAT_LABELS = ['东', '南', '西', '北'];

interface GameBoardProps {
  gameState: ClientGameState;
  myPlayerId: string;
  roomId?: string;
  onTileClick: (tileId: number) => void;
  onVoteDissolve: () => void;
  /** Rendered above the self player's hand (for ActionBar) */
  children?: React.ReactNode;
}

export function GameBoard({ gameState, myPlayerId, roomId, onTileClick, onVoteDissolve, children }: GameBoardProps) {
  const myIndex = gameState.players.findIndex((p) => p.id === myPlayerId);
  const order = [0, 1, 2, 3].map((offset) => (myIndex + offset) % 4);
  const [selfIdx, rightIdx, topIdx, leftIdx] = order;

  const currentIdx = gameState.currentPlayerIndex;
  const myHand = gameState.myHand;
  const lastDrawnTileId = gameState.lastDrawnTileId ?? undefined;
  const autoPlayers = gameState.autoPlayPlayerIds || [];

  return (
    <div className="game-layout">
      {/* Top header bar */}
      <div className="game-header">
        {roomId && <span className="room-code">房间: {roomId}</span>}
        <span>牌墙: {gameState.wallCount}张</span>
        <span>庄家: {SEAT_LABELS[gameState.dealerIndex]}</span>
        <span>第{gameState.roundNumber ?? 1}局 回合:{gameState.turnCount}</span>
        <span className="current-turn-header">
          ▶ {currentIdx === myIndex ? '你' : SEAT_LABELS[currentIdx]}出牌
        </span>
        {autoPlayers.length > 0 && <span className="autopilot-indicator">托管: {autoPlayers.length}人</span>}
        <button className="dissolve-btn" onClick={onVoteDissolve}>投票解散</button>
      </div>

      {/* Game board */}
      <div className="game-board">
        <div className="board-top">
          <PlayerArea player={gameState.players[topIdx]} isSelf={false}
            seatLabel={SEAT_LABELS[topIdx]} isDealer={topIdx === gameState.dealerIndex}
            isCurrent={topIdx === currentIdx}
            isAutoPilot={autoPlayers.includes(gameState.players[topIdx].id)} />
          <div className="player-discard-area">
            <DiscardPool tiles={gameState.players[topIdx].discardPool} />
          </div>
        </div>

        <div className="board-left">
          <PlayerArea player={gameState.players[leftIdx]} isSelf={false}
            seatLabel={SEAT_LABELS[leftIdx]} isDealer={leftIdx === gameState.dealerIndex}
            isCurrent={leftIdx === currentIdx}
            isAutoPilot={autoPlayers.includes(gameState.players[leftIdx].id)} />
          <div className="player-discard-area">
            <DiscardPool tiles={gameState.players[leftIdx].discardPool} />
          </div>
        </div>

        <div className="board-center" />

        <div className="board-right">
          <PlayerArea player={gameState.players[rightIdx]} isSelf={false}
            seatLabel={SEAT_LABELS[rightIdx]} isDealer={rightIdx === gameState.dealerIndex}
            isCurrent={rightIdx === currentIdx}
            isAutoPilot={autoPlayers.includes(gameState.players[rightIdx].id)} />
          <div className="player-discard-area">
            <DiscardPool tiles={gameState.players[rightIdx].discardPool} />
          </div>
        </div>

        {/* Bottom (self): discard → action bar → hand */}
        <div className="board-bottom">
          <div className="player-discard-area">
            <DiscardPool tiles={gameState.players[selfIdx].discardPool} />
          </div>
          {children}
          <PlayerArea player={gameState.players[selfIdx]} isSelf={true} tiles={myHand}
            seatLabel={SEAT_LABELS[selfIdx]} isDealer={selfIdx === gameState.dealerIndex}
            isCurrent={selfIdx === currentIdx} lastDrawnTileId={lastDrawnTileId}
            onTileClick={onTileClick}
            isAutoPilot={autoPlayers.includes(gameState.players[selfIdx].id)} />
        </div>
      </div>
    </div>
  );
}
