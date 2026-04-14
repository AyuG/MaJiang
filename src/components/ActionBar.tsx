'use client';

import type { GangInfo } from '@/hooks/useGameState';

interface ActionBarProps {
  availableActions: string[];
  gangOptions: GangInfo[];
  remainingSeconds: number;
  onPeng: () => void;
  onGang: (type: 'ming' | 'an' | 'bu', tileId?: number) => void;
  onHu: () => void;
  onPass: () => void;
}

export function ActionBar({
  availableActions,
  gangOptions,
  remainingSeconds,
  onPeng,
  onGang,
  onHu,
  onPass,
}: ActionBarProps) {
  const showPeng = availableActions.includes('peng');
  const showMingGang = availableActions.includes('ming_gang');
  const showAnGang = availableActions.includes('an_gang');
  const showBuGang = availableActions.includes('bu_gang');
  const showHu = availableActions.includes('hu');
  const showPass = availableActions.includes('pass');
  const showAnyGang = showMingGang || showAnGang || showBuGang;

  const hasActions = showPeng || showAnyGang || showHu || showPass;
  const showTimer = remainingSeconds > 0;

  // Hide entirely when nothing to show
  if (!hasActions && !showTimer) return null;

  const findGangTileId = (type: 'ming' | 'an' | 'bu'): number | undefined => {
    return gangOptions.find((g) => g.type === type)?.tileId;
  };

  return (
    <div className="action-bar">
      {showTimer && <span className="timer">⏱ {remainingSeconds}s</span>}
      {showTimer && hasActions && <span className="action-divider">|</span>}
      {showPeng && (
        <button className="action-btn" onClick={onPeng}>
          碰
        </button>
      )}
      {showMingGang && (
        <button className="action-btn" onClick={() => onGang('ming')}>
          杠
        </button>
      )}
      {showAnGang && (
        <button className="action-btn" onClick={() => onGang('an', findGangTileId('an'))}>
          暗杠
        </button>
      )}
      {showBuGang && (
        <button className="action-btn" onClick={() => onGang('bu', findGangTileId('bu'))}>
          补杠
        </button>
      )}
      {showHu && (
        <button className="action-btn action-hu" onClick={onHu}>
          胡
        </button>
      )}
      {showPass && (
        <button className="action-btn" onClick={onPass}>
          过
        </button>
      )}
    </div>
  );
}
