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

  /** River (discard pool) - innermost layer */
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

  /** Meld zone - middle layer */
  const MeldZone = ({ i, position }: { i: number; position: 'self' | 'right' | 'top' | 'left' }) => (
    <div className="meld-zone">
      <MeldDisplay 
        melds={gameState.players[i].melds} 
        ownerSeatIndex={i} 
        allPlayerIds={allIds}
        position={position}
      />
    </div>
  );

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
        {/* ── Layer 1: Player labels (outermost edges) ── */}
        <div className="G-top"><PLabel i={topI} /></div>
        <div className="G-left"><PLabel i={leftI} /></div>
        <div className="G-right"><PLabel i={rightI} /></div>

        {/* ── Center area with 3 concentric layers ── */}
        <div className="G-center">
          {/* ── Layer 2: Meld zone (middle layer) ── */}
          <div className="G-meld-layer">
            <div className="G-meld-top"><MeldZone i={topI} position="top" /></div>
            <div className="G-meld-left"><MeldZone i={leftI} position="left" /></div>
            <div className="G-meld-right"><MeldZone i={rightI} position="right" /></div>
            <div className="G-meld-self"><MeldZone i={selfI} position="self" /></div>
          </div>

          {/* ── Layer 3: River zone (inner layer) ── */}
          <div className="G-river-layer">
            <div className="G-river-top"><River i={topI} /></div>
            <div className="G-river-left"><River i={leftI} /></div>
            <div className="G-river-right"><River i={rightI} /></div>
            <div className="G-river-self"><River i={selfI} /></div>
          </div>

          {/* ── Compass (center) ── */}
          <div className="G-compass">
            <Compass
              seatOrder={[selfI, rightI, topI, leftI]}
              currentSeatIndex={cur}
              wallCount={gameState.wallCount}
            />
          </div>
        </div>

        {/* ── Layer 1: Self hand (outermost) ── */}
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
