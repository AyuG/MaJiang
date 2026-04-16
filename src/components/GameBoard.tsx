'use client';

import { useState, useEffect } from 'react';
import type { ClientGameState, Tile as TileType, Meld } from '@/types';
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

  const statusIcon = (idx: number) => {
    const p = gameState.players[idx];
    const icons: string[] = [];
    if (!p.isConnected) icons.push('🔴');
    if (autoPlayers.includes(p.id)) icons.push('🤖');
    if (idx === currentIdx) icons.push('🕒');
    if (idx === gameState.dealerIndex) icons.push('庄');
    return icons.join('');
  };

  const renderRiver = (idx: number, cls: string) => {
    const tiles = gameState.players[idx].discardPool;
    if (tiles.length === 0) return <div className={`river ${cls}`} />;
    return (
      <div className={`river ${cls}`}>
        {tiles.map((t, i) => (
          <Tile key={t.id} tile={t} size="sm"
            isLastDrawn={i === tiles.length - 1 && gameState.lastDiscard?.playerIndex === idx} />
        ))}
      </div>
    );
  };

  const selfPlayer = gameState.players[selfIdx];

  const sortedHand = [...gameState.myHand].sort((a, b) => {
    const so: Record<string, number> = { wan: 0, tiao: 1, tong: 2, feng: 3, zi: 4 };
    const sd = (so[a.suit] ?? 9) - (so[b.suit] ?? 9);
    return sd !== 0 ? sd : a.value - b.value;
  });

  return (
    <div className="mj-table">
      {/* ── Header ── */}
      <header className="mj-header">
        {roomId && <span className="mj-room">{roomId}</span>}
        <span>墙:{gameState.wallCount}</span>
        <span>第{gameState.roundNumber ?? 1}局 R{gameState.turnCount}</span>
        <span className={selfIdx === currentIdx ? 'mj-myturn' : ''}>
          ▶{currentIdx === myIndex ? '你' : SEATS[currentIdx]}
        </span>
        <button className="mj-hdr-btn" onClick={onVoteDissolve}>解散</button>
      </header>

      {/* ── Table felt ── */}
      <div className="mj-felt">

        {/* ── Top (opponent across) ── */}
        <div className="mj-top">
          <div className="mj-pcard">
            <span className="mj-seat">{SEATS[topIdx]}</span>
            <span className="mj-pscore">{gameState.players[topIdx].score}</span>
            <span className="mj-phand">{gameState.players[topIdx].handCount}张</span>
            <span className="mj-picons">{statusIcon(topIdx)}</span>
          </div>
          {renderRiver(topIdx, 'river-top')}
        </div>

        {/* ── Left (upstream) ── */}
        <div className="mj-left">
          <div className="mj-pcard mj-pcard-v">
            <span className="mj-seat">{SEATS[leftIdx]}</span>
            <span className="mj-pscore">{gameState.players[leftIdx].score}</span>
            <span className="mj-phand">{gameState.players[leftIdx].handCount}张</span>
            <span className="mj-picons">{statusIcon(leftIdx)}</span>
          </div>
          {renderRiver(leftIdx, 'river-left')}
        </div>

        {/* ── Right (downstream) ── */}
        <div className="mj-right">
          {renderRiver(rightIdx, 'river-right')}
          <div className="mj-pcard mj-pcard-v">
            <span className="mj-seat">{SEATS[rightIdx]}</span>
            <span className="mj-pscore">{gameState.players[rightIdx].score}</span>
            <span className="mj-phand">{gameState.players[rightIdx].handCount}张</span>
            <span className="mj-picons">{statusIcon(rightIdx)}</span>
          </div>
        </div>

        {/* ── Center (table center — melds overflow here) ── */}
        <div className="mj-center">
          <MeldDisplay melds={gameState.players[topIdx].melds} />
          <MeldDisplay melds={gameState.players[leftIdx].melds} />
          <MeldDisplay melds={gameState.players[rightIdx].melds} />
        </div>

        {/* ── Bottom river (self discards) ── */}
        <div className="mj-self-river">
          {renderRiver(selfIdx, 'river-bottom')}
        </div>
      </div>

      {/* ── Bottom: action bar + self info + hand ── */}
      <div className="mj-bottom">
        {children}
        <div className="mj-self-info">
          <span className="mj-seat">{SEATS[selfIdx]}{selfIdx === gameState.dealerIndex ? '庄' : ''}</span>
          <span className="mj-pscore">分:{selfPlayer.score}</span>
          {autoPlayers.includes(selfPlayer.id) && <span>🤖</span>}
          <MeldDisplay melds={selfPlayer.melds} />
        </div>
        <div className="mj-hand">
          {sortedHand.map((tile) => (
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
  );
}
