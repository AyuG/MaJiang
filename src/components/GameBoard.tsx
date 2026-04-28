'use client';

import { useState, useEffect } from 'react';
import type { ClientGameState } from '@/types';
import { Tile } from './Tile';
import { MeldDisplay } from './MeldDisplay';
import { Compass } from './Compass';
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
  const [selfI, rightI, topI, leftI] = [0, 1, 2, 3].map((o) => (myIdx + o) % 4);
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

  const icons = (i: number) => {
    const p = gameState.players[i];
    const ic: string[] = [];
    if (!p.isConnected) ic.push('🔴');
    if (auto.includes(p.id)) ic.push('🤖');
    if (i === cur) ic.push('🕒');
    if (i === gameState.dealerIndex) ic.push('庄');
    return ic.join('');
  };

  /** Player info label */
  const PLabel = ({ i }: { i: number }) => {
    const p = gameState.players[i];
    return (
      <div className={`plbl${i === cur ? ' plbl-act' : ''}`}>
        <span className="plbl-seat">{SEATS[i]}</span>
        <span className="plbl-score">{p.score}分</span>
        <span className="plbl-cnt">{p.handCount}张</span>
        <span className="plbl-ic">{icons(i)}</span>
      </div>
    );
  };

  /** River (discard pool) */
  const River = ({ i }: { i: number }) => {
    const tiles = gameState.players[i].discardPool;
    return (
      <div className="river">
        {tiles.map((t, ti) => (
          <Tile key={t.id} tile={t} size="sm"
            isLastDrawn={ti === tiles.length - 1 && gameState.lastDiscard?.playerIndex === i} />
        ))}
      </div>
    );
  };

  const sorted = [...gameState.myHand].sort((a, b) => {
    const o: Record<string, number> = { wan: 0, tiao: 1, tong: 2, feng: 3, zi: 4 };
    return (o[a.suit] ?? 9) - (o[b.suit] ?? 9) || a.value - b.value;
  });

  return (
    <div className="G">
      {/* ── Header ── */}
      <header className="G-hd">
        <span className="hd-room">房间号：{roomId || '----'}</span>
        <span>第{gameState.roundNumber ?? 1}局</span>
        <span className={selfI === cur ? 'hd-my' : ''}>
          ▶ {cur === myIdx ? '你' : SEATS[cur]}出牌
        </span>
        <button className="hd-btn" onClick={onVoteDissolve}>解散</button>
      </header>

      {/* ── Table ── */}
      <div className="G-table">
        {/* Top opponent: label + hand(hidden) */}
        <div className="G-top">
          <PLabel i={topI} />
        </div>

        {/* Left opponent */}
        <div className="G-left">
          <PLabel i={leftI} />
        </div>

        {/* Right opponent */}
        <div className="G-right">
          <PLabel i={rightI} />
        </div>

        {/* Center area: melds → rivers → compass */}
        <div className="G-center">
          {/* Top meld + river */}
          <div className="G-c-top">
            <div className="meld-zone"><MeldDisplay melds={gameState.players[topI].melds} ownerSeatIndex={topI} allPlayerIds={allIds} /></div>
            <River i={topI} />
          </div>

          {/* Middle: left-river | compass | right-river */}
          <div className="G-c-mid">
            <div className="G-c-left-rv">
              <div className="meld-zone"><MeldDisplay melds={gameState.players[leftI].melds} ownerSeatIndex={leftI} allPlayerIds={allIds} /></div>
              <River i={leftI} />
            </div>

            <Compass
              seatOrder={[selfI, rightI, topI, leftI]}
              currentSeatIndex={cur}
              wallCount={gameState.wallCount}
            />

            <div className="G-c-right-rv">
              <River i={rightI} />
              <div className="meld-zone"><MeldDisplay melds={gameState.players[rightI].melds} ownerSeatIndex={rightI} allPlayerIds={allIds} /></div>
            </div>
          </div>

          {/* Bottom meld + river */}
          <div className="G-c-bot">
            <div className="meld-zone"><MeldDisplay melds={gameState.players[selfI].melds} ownerSeatIndex={selfI} allPlayerIds={allIds} /></div>
            <River i={selfI} />
          </div>
        </div>

        {/* Bottom: self hand */}
        <div className="G-bot">
          {children}
          <div className="G-hand">
            {sorted.map((t) => (
              <Tile key={t.id} tile={t} size="lg"
                isSelected={t.id === sel} isLastDrawn={t.id === lastDrawn}
                onClick={() => tap(t.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
