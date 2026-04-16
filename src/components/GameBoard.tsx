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
  const allIds = gameState.players.map((p) => p.id);

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

  const Melds = ({ i }: { i: number }) => (
    <MeldDisplay melds={gameState.players[i].melds} ownerSeatIndex={i} allPlayerIds={allIds} />
  );

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
      <header className="T-hd">
        {roomId && <span className="hd-r">{roomId}</span>}
        <span>第{gameState.roundNumber ?? 1}局 R{gameState.turnCount}</span>
        <span className={selfI === cur ? 'hd-my' : ''}>▶{cur === myIdx ? '你' : SEATS[cur]}</span>
        <button className="hd-b" onClick={onVoteDissolve}>解散</button>
      </header>

      <div className="T-felt">
        {/* Top: card on edge, then meld+river toward center (left-to-right start) */}
        <div className="f-top-edge"><PCard i={topI} /></div>
        <div className="f-top-rv">
          <div className="meld-river-row">
            <Melds i={topI} />
            <River i={topI} cls="rv-h" />
          </div>
        </div>

        {/* Middle row */}
        <div className="f-mid">
          {/* Left: card on edge, meld+river toward center (top-to-bottom start) */}
          <div className="f-left-edge"><PCard i={leftI} v /></div>
          <div className="f-left-rv">
            <div className="meld-river-col">
              <Melds i={leftI} />
              <River i={leftI} cls="rv-v" />
            </div>
          </div>

          <div className="f-ctr"><WallDisplay wallCount={gameState.wallCount} /></div>

          {/* Right: mirror of left — river+meld from center outward (top-to-bottom start) */}
          <div className="f-right-rv">
            <div className="meld-river-col meld-river-col-r">
              <Melds i={rightI} />
              <River i={rightI} cls="rv-v" />
            </div>
          </div>
          <div className="f-right-edge"><PCard i={rightI} v /></div>
        </div>

        {/* Bottom: self meld+river toward center (left-to-right start) */}
        <div className="f-bot-rv">
          <div className="meld-river-row">
            <Melds i={selfI} />
            <River i={selfI} cls="rv-h" />
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="T-bot">
        {children}
        <div className="b-info">
          <span className="pc-s">{SEATS[selfI]}{selfI === gameState.dealerIndex ? '庄' : ''}</span>
          <span className="pc-sc">分:{self.score}</span>
          {auto.includes(self.id) && <span>🤖</span>}
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
