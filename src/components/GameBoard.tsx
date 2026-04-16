'use client';

import { useState, useEffect } from 'react';
import type { ClientGameState } from '@/types';
import type { Tile as TileType } from '@/types';
import { Tile } from './Tile';
import { MeldDisplay } from './MeldDisplay';
import { audioService } from '@/services/audioService';

const SEATS = ['东', '南', '西', '北'];

interface GameBoardProps {
  gameState: ClientGameState;
  myPlayerId: string;
  roomId?: string;
  onTileClick: (tileId: number) => void;
  onVoteDissolve: () => void;
  children?: React.ReactNode;
}

export function GameBoard({ gameState, myPlayerId, roomId, onTileClick, onVoteDissolve, children }: GameBoardProps) {
  const myIndex = gameState.players.findIndex((p) => p.id === myPlayerId);
  const order = [0, 1, 2, 3].map((off) => (myIndex + off) % 4);
  const [selfIdx, rightIdx, topIdx, leftIdx] = order;
  const currentIdx = gameState.currentPlayerIndex;
  const autoPlayers = gameState.autoPlayPlayerIds || [];
  const lastDrawnTileId = gameState.lastDrawnTileId ?? undefined;

  // Two-click discard
  const [selectedTileId, setSelectedTileId] = useState<number | null>(null);
  useEffect(() => { setSelectedTileId(null); }, [gameState.turnCount, gameState.phase, gameState.currentPlayerIndex]);

  const handleTileClick = (tileId: number) => {
    if (selectedTileId === tileId) {
      audioService.play('discard');
      onTileClick(tileId);
      setSelectedTileId(null);
    } else {
      audioService.play('select');
      setSelectedTileId(tileId);
    }
  };

  const renderPlayerCard = (idx: number, position: 'top' | 'left' | 'right') => {
    const p = gameState.players[idx];
    const isCurrent = idx === currentIdx;
    const isAuto = autoPlayers.includes(p.id);
    const isDealer = idx === gameState.dealerIndex;
    return (
      <div className={`player-card player-${position}${isCurrent ? ' player-active' : ''}`}>
        <div className="pc-info">
          <span className="pc-seat">{SEATS[idx]}{isDealer ? '庄' : ''}</span>
          <span className="pc-score">{p.score}</span>
          {!p.isConnected && <span className="pc-icon">🔴</span>}
          {isAuto && <span className="pc-icon">🤖</span>}
          {isCurrent && <span className="pc-icon blink">🕒</span>}
        </div>
        <div className="pc-hand">{p.handCount}张</div>
        <MeldDisplay melds={p.melds} />
      </div>
    );
  };

  const renderRiver = (idx: number) => {
    const tiles = gameState.players[idx].discardPool;
    if (tiles.length === 0) return null;
    return (
      <div className="river">
        {tiles.map((t, i) => (
          <Tile key={t.id} tile={t} size="sm"
            isLastDrawn={i === tiles.length - 1 && gameState.lastDiscard?.playerIndex === idx} />
        ))}
      </div>
    );
  };

  const selfPlayer = gameState.players[selfIdx];
  const isMyCurrent = selfIdx === currentIdx;

  return (
    <div className="table-layout">
      {/* Header */}
      <div className="table-header">
        {roomId && <span className="th-room">{roomId}</span>}
        <span>墙:{gameState.wallCount}</span>
        <span>第{gameState.roundNumber ?? 1}局 R{gameState.turnCount}</span>
        <span className={isMyCurrent ? 'th-myturn' : ''}>
          ▶{currentIdx === myIndex ? '你' : SEATS[currentIdx]}
        </span>
        <button className="th-btn" onClick={onVoteDissolve}>解散</button>
      </div>

      {/* Table body */}
      <div className="table-body">
        {/* Top opponent */}
        <div className="zone-top">
          {renderPlayerCard(topIdx, 'top')}
          {renderRiver(topIdx)}
        </div>

        {/* Middle row: left | center rivers | right */}
        <div className="zone-middle">
          <div className="zone-left">
            {renderPlayerCard(leftIdx, 'left')}
            {renderRiver(leftIdx)}
          </div>

          <div className="zone-center">
            {/* Center: self river + right river overflow */}
          </div>

          <div className="zone-right">
            {renderPlayerCard(rightIdx, 'right')}
            {renderRiver(rightIdx)}
          </div>
        </div>

        {/* Bottom: self area */}
        <div className="zone-bottom">
          {renderRiver(selfIdx)}
          {/* Action bar slot */}
          {children}
          {/* Self info bar */}
          <div className="self-info">
            <span className="pc-seat">{SEATS[selfIdx]}{selfIdx === gameState.dealerIndex ? '庄' : ''}</span>
            <span className="pc-score">分:{selfPlayer.score}</span>
            {autoPlayers.includes(selfPlayer.id) && <span className="pc-icon">🤖</span>}
            <MeldDisplay melds={selfPlayer.melds} />
          </div>
          {/* Hand */}
          <div className="self-hand">
            {[...gameState.myHand].sort((a, b) => {
              const so: Record<string, number> = { wan: 0, tiao: 1, tong: 2, feng: 3, zi: 4 };
              const sd = (so[a.suit] ?? 9) - (so[b.suit] ?? 9);
              return sd !== 0 ? sd : a.value - b.value;
            }).map((tile) => (
              <Tile
                key={tile.id}
                tile={tile}
                size="lg"
                isSelected={tile.id === selectedTileId}
                isLastDrawn={tile.id === lastDrawnTileId}
                onClick={() => handleTileClick(tile.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
