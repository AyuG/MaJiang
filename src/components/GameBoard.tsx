'use client';

import { useState, useEffect } from 'react';
import type { ClientGameState } from '@/types';
import { Tile } from './Tile';
import { MeldDisplay } from './MeldDisplay';
import { WallDisplay } from './WallDisplay';
import { audioService } from '@/services/audioService';

const SEATS = ['东', '南', '西', '北'];

interface Props {
  gameState: ClientGameState;
  myPlayerId: string;
  roomId?: string;
  onTileClick: (tileId: number) => void;
  onVoteDissolve: () => void;
  children?: React.ReactNode;
}

export function GameBoard({ gameState, myPlayerId, roomId, onTileClick, onVoteDissolve, children }: Props) {
  const myIdx = gameState.players.findIndex((p) => p.id === myPlayerId);
  const [selfI, rightI, topI, leftI] = [0,1,2,3].map((o) => (myIdx + o) % 4);
  const cur = gameState.currentPlayerIndex;
  const auto = gameState.autoPlayPlayerIds || [];
  const lastDrawn = gameState.lastDrawnTileId ?? undefined;

  // Two-click discard
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { setSel(null); }, [gameState.turnCount, gameState.phase, cur]);

  const tap = (id: number) => {
    if (sel === id) { audioService.play('discard'); onTileClick(id); setSel(null); }
    else { audioService.play('select'); setSel(id); }
  };

  const ic = (i: number) => {
    const p = gameState.players[i];
    const a: string[] = [];
    if (!p.isConnected) a.push('🔴');
    if (auto.includes(p.id)) a.push('🤖');
    if (i === cur) a.push('🕒');
    if (i === gameState.dealerIndex) a.push('庄');
    return a.join('');
  };

  const PCard = ({ i, v }: { i: number; v?: boolean }) => {
    const p = gameState.players[i];
    return (
      <div className={`pc${i === cur ? ' pc-act' : ''}${v ? ' pc-v' : ''}`}>
        <span className="pc-s">{SEATS[i]}</span>
        <span className="pc-sc">{p.score}</span>
        <span className="pc-n">{p.handCount}张</span>
        <span className="pc-i">{ic(i)}</span>
      </div>
    );
  };

  /** River: dynamic columns based on available width */
  const River = ({ i, cls }: { i: number; cls: string }) => {
    const tiles = gameState.players[i].discardPool;
    if (!tiles.length) return <div className={`rv ${cls}`} />;
    return (
      <div className={`rv ${cls}`}>
        {tiles.map((t, ti) => (
          <Tile key={t.id} tile={t} size="sm"
            isLastDrawn={ti === tiles.length - 1 && gameState.lastDiscard?.playerIndex === i} />
        ))}
      </div>
    );
  };

  const self = gameState.players[selfI];
  const sorted = [...gameState.myHand].sort((a, b) => {
    const o: Record<string, number> = { wan: 0, tiao: 1, tong: 2, feng: 3, zi: 4 };
    return (o[a.suit] ?? 9) - (o[b.suit] ?? 9) || a.value - b.value;
  });

  return (
    <div className="T">
      {/* Header */}
      <header className="T-hd">
        {roomId && <span className="hd-r">{roomId}</span>}
        <span>第{gameState.roundNumber ?? 1}局 R{gameState.turnCount}</span>
        <span className={selfI === cur ? 'hd-my' : ''}>▶{cur === myIdx ? '你' : SEATS[cur]}</span>
        <button className="hd-b" onClick={onVoteDissolve}>解散</button>
      </header>

      {/* Felt — 5-row layout:
          row1: top-player + melds
          row2: top-river (toward center)
          row3: left-edge | left-rv | CENTER | right-rv | right-edge
          row4: bottom-river (toward center)
          row5: (empty, self melds in bottom bar)
      */}
      <div className="T-felt">
        {/* Row 1: Top player info + melds (edge zone) */}
        <div className="f-top-edge">
          <PCard i={topI} />
          <MeldDisplay melds={gameState.players[topI].melds} />
        </div>

        {/* Row 2: Top river (closest to top player, inside felt) */}
        <div className="f-top-rv">
          <River i={topI} cls="rv-h" />
        </div>

        {/* Row 3: Middle — left | center | right */}
        <div className="f-mid">
          {/* Left edge: card + melds */}
          <div className="f-left-edge">
            <PCard i={leftI} v />
            <MeldDisplay melds={gameState.players[leftI].melds} />
          </div>
          {/* Left river (toward center) */}
          <div className="f-left-rv">
            <River i={leftI} cls="rv-v" />
          </div>
          {/* Center: wall display */}
          <div className="f-ctr">
            <WallDisplay wallCount={gameState.wallCount} />
          </div>
          {/* Right river (toward center — LEFT side of right zone) */}
          <div className="f-right-rv">
            <River i={rightI} cls="rv-v" />
          </div>
          {/* Right edge: card + melds */}
          <div className="f-right-edge">
            <PCard i={rightI} v />
            <MeldDisplay melds={gameState.players[rightI].melds} />
          </div>
        </div>

        {/* Row 4: Bottom river (self discards, toward center) */}
        <div className="f-bot-rv">
          <River i={selfI} cls="rv-h" />
        </div>
      </div>

      {/* Bottom: action bar + self info + hand */}
      <div className="T-bot">
        {children}
        <div className="b-info">
          <span className="pc-s">{SEATS[selfI]}{selfI === gameState.dealerIndex ? '庄' : ''}</span>
          <span className="pc-sc">分:{self.score}</span>
          {auto.includes(self.id) && <span>🤖</span>}
          <MeldDisplay melds={self.melds} />
        </div>
        <div className="b-hand">
          {sorted.map((t) => (
            <Tile key={t.id} tile={t} size="lg"
              isSelected={t.id === sel} isLastDrawn={t.id === lastDrawn}
              onClick={() => tap(t.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
