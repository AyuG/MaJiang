'use client';

import { useState, useEffect } from 'react';
import type { ClientGameState } from '@/types';
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
  children?: React.ReactNode; // ActionBar
}

export function GameBoard({ gameState, myPlayerId, roomId, onTileClick, onVoteDissolve, children }: GameBoardProps) {
  const myIndex = gameState.players.findIndex((p) => p.id === myPlayerId);
  const order = [0, 1, 2, 3].map((off) => (myIndex + off) % 4);
  const [selfIdx, rightIdx, topIdx, leftIdx] = order;
  const cur = gameState.currentPlayerIndex;
  const auto = gameState.autoPlayPlayerIds || [];
  const lastDrawn = gameState.lastDrawnTileId ?? undefined;

  const [selTile, setSelTile] = useState<number | null>(null);
  useEffect(() => { setSelTile(null); }, [gameState.turnCount, gameState.phase, cur]);

  const handleTile = (id: number) => {
    if (selTile === id) { audioService.play('discard'); onTileClick(id); setSelTile(null); }
    else { audioService.play('select'); setSelTile(id); }
  };

  const icons = (idx: number) => {
    const p = gameState.players[idx];
    const ic: string[] = [];
    if (!p.isConnected) ic.push('🔴');
    if (auto.includes(p.id)) ic.push('🤖');
    if (idx === cur) ic.push('🕒');
    if (idx === gameState.dealerIndex) ic.push('庄');
    return ic.join('');
  };

  /** Compact player info card */
  const PCard = ({ idx, vertical }: { idx: number; vertical?: boolean }) => {
    const p = gameState.players[idx];
    return (
      <div className={`pc ${idx === cur ? 'pc-active' : ''} ${vertical ? 'pc-v' : ''}`}>
        <span className="pc-seat">{SEATS[idx]}</span>
        <span className="pc-score">{p.score}</span>
        <span className="pc-cnt">{p.handCount}张</span>
        <span className="pc-ic">{icons(idx)}</span>
      </div>
    );
  };

  /** River: discard matrix */
  const River = ({ idx, cls }: { idx: number; cls: string }) => {
    const tiles = gameState.players[idx].discardPool;
    return (
      <div className={`rv ${cls}`}>
        {tiles.map((t, i) => (
          <Tile key={t.id} tile={t} size="sm"
            isLastDrawn={i === tiles.length - 1 && gameState.lastDiscard?.playerIndex === idx} />
        ))}
      </div>
    );
  };

  const self = gameState.players[selfIdx];
  const sorted = [...gameState.myHand].sort((a, b) => {
    const o: Record<string, number> = { wan: 0, tiao: 1, tong: 2, feng: 3, zi: 4 };
    return (o[a.suit] ?? 9) - (o[b.suit] ?? 9) || a.value - b.value;
  });

  return (
    <div className="tb">
      {/* ── Header ── */}
      <header className="tb-hd">
        {roomId && <span className="hd-room">{roomId}</span>}
        <span>墙:{gameState.wallCount}</span>
        <span>第{gameState.roundNumber ?? 1}局 R{gameState.turnCount}</span>
        <span className={selfIdx === cur ? 'hd-my' : ''}>▶{cur === myIndex ? '你' : SEATS[cur]}</span>
        <button className="hd-btn" onClick={onVoteDissolve}>解散</button>
      </header>

      {/* ── Table surface ── */}
      <div className="tb-felt">
        {/* Top player: card + melds on edge, river toward center */}
        <div className="z-top">
          <div className="z-top-edge">
            <PCard idx={topIdx} />
            <MeldDisplay melds={gameState.players[topIdx].melds} />
          </div>
          <River idx={topIdx} cls="rv-h" />
        </div>

        {/* Left player: card + melds on left edge, river toward center */}
        <div className="z-left">
          <div className="z-left-edge">
            <PCard idx={leftIdx} vertical />
            <MeldDisplay melds={gameState.players[leftIdx].melds} />
          </div>
          <River idx={leftIdx} cls="rv-v" />
        </div>

        {/* Center: empty felt */}
        <div className="z-ctr" />

        {/* Right player: river toward center, card + melds on right edge */}
        <div className="z-right">
          <River idx={rightIdx} cls="rv-v" />
          <div className="z-right-edge">
            <PCard idx={rightIdx} vertical />
            <MeldDisplay melds={gameState.players[rightIdx].melds} />
          </div>
        </div>

        {/* Bottom river (self discards toward center) */}
        <div className="z-bot-rv">
          <River idx={selfIdx} cls="rv-h" />
        </div>
      </div>

      {/* ── Bottom: action bar + self info + hand ── */}
      <div className="tb-bot">
        {children}
        <div className="bot-info">
          <span className="pc-seat">{SEATS[selfIdx]}{selfIdx === gameState.dealerIndex ? '庄' : ''}</span>
          <span className="pc-score">分:{self.score}</span>
          {auto.includes(self.id) && <span>🤖</span>}
          <MeldDisplay melds={self.melds} />
        </div>
        <div className="bot-hand">
          {sorted.map((t) => (
            <Tile key={t.id} tile={t} size="lg"
              isSelected={t.id === selTile} isLastDrawn={t.id === lastDrawn}
              onClick={() => handleTile(t.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
