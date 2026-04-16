'use client';

import type { Tile, Meld } from '@/types';
import { HandDisplay } from './HandDisplay';
import { MeldDisplay } from './MeldDisplay';

interface PlayerData {
  id: string;
  handCount: number;
  melds: Meld[];
  discardPool: Tile[];
  score: number;
  isConnected: boolean;
}

interface PlayerAreaProps {
  player: PlayerData;
  isSelf: boolean;
  tiles?: Tile[];
  seatLabel: string;
  isDealer: boolean;
  isCurrent: boolean;
  lastDrawnTileId?: number;
  selectedTileId?: number | null;
  onTileClick?: (tileId: number) => void;
  isAutoPilot?: boolean;
}

export function PlayerArea({
  player, isSelf, tiles, seatLabel, isDealer, isCurrent,
  lastDrawnTileId, selectedTileId, onTileClick, isAutoPilot = false,
}: PlayerAreaProps) {
  const statusIcon = player.isConnected ? '🟢' : '🔴';
  const dealerMark = isDealer ? ' [庄]' : '';

  return (
    <div className={`player-area${isSelf ? ' player-self' : ''}${isCurrent ? ' player-current' : ''}`}>
      <div className="player-info">
        {statusIcon} {seatLabel}{dealerMark} | 分数: {player.score}
        {isCurrent && <span className="current-marker"> ◀ 出牌中</span>}
        {isAutoPilot && <span className="autopilot-badge"> 🤖托管</span>}
      </div>
      {isSelf && tiles ? (
        <HandDisplay tiles={tiles} isSelf={true} lastDrawnTileId={lastDrawnTileId} selectedTileId={selectedTileId} onTileClick={onTileClick} />
      ) : (
        <span className="hand-hidden">手牌: {player.handCount}张</span>
      )}
      <MeldDisplay melds={player.melds} />
    </div>
  );
}
