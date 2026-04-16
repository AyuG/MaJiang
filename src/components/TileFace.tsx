'use client';

import { TileSuit } from '@/types';
import type { Tile } from '@/types';

/**
 * Renders the face of a mahjong tile using styled text/symbols.
 * Designed to match traditional mahjong tile aesthetics:
 * - 万 (wan): red number + red 萬
 * - 筒 (tong): colored circle patterns
 * - 条 (tiao): colored bamboo patterns
 * - 风 (feng): blue characters 東南西北
 * - 字 (zi): 中(red) 發(green) 白(blue outline)
 */

const WAN_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const FENG_CHARS = ['東', '南', '西', '北'];
const ZI_CHARS = ['中', '發', '白'];

// Circle patterns for 筒子 (1-9)
const TONG_COLORS: Record<number, string[]> = {
  1: ['#2a7f2a'],           // 1筒: green
  2: ['#1a5fb4', '#1a5fb4'],
  3: ['#1a5fb4', '#c53030', '#1a5fb4'],
  4: ['#1a5fb4', '#1a5fb4', '#1a5fb4', '#1a5fb4'],
  5: ['#1a5fb4', '#c53030', '#1a5fb4', '#1a5fb4', '#1a5fb4'],
  6: ['#1a5fb4', '#c53030', '#1a5fb4', '#1a5fb4', '#c53030', '#1a5fb4'],
  7: ['#1a5fb4', '#1a5fb4', '#1a5fb4', '#1a5fb4', '#1a5fb4', '#1a5fb4', '#1a5fb4'],
  8: ['#1a5fb4', '#1a5fb4', '#1a5fb4', '#1a5fb4', '#1a5fb4', '#1a5fb4', '#1a5fb4', '#1a5fb4'],
  9: ['#c53030', '#c53030', '#c53030', '#c53030', '#c53030', '#c53030', '#c53030', '#c53030', '#c53030'],
};

// Bamboo colors for 条子
const TIAO_COLORS: Record<number, string[]> = {
  1: ['#2a7f2a'],  // bird (special)
  2: ['#2a7f2a', '#2a7f2a'],
  3: ['#2a7f2a', '#2a7f2a', '#2a7f2a'],
  4: ['#2a7f2a', '#c53030', '#2a7f2a', '#2a7f2a'],
  5: ['#2a7f2a', '#c53030', '#2a7f2a', '#2a7f2a', '#2a7f2a'],
  6: ['#2a7f2a', '#2a7f2a', '#2a7f2a', '#2a7f2a', '#2a7f2a', '#2a7f2a'],
  7: ['#2a7f2a', '#c53030', '#2a7f2a', '#2a7f2a', '#2a7f2a', '#2a7f2a', '#2a7f2a'],
  8: ['#2a7f2a', '#2a7f2a', '#2a7f2a', '#2a7f2a', '#2a7f2a', '#2a7f2a', '#2a7f2a', '#2a7f2a'],
  9: ['#2a7f2a', '#c53030', '#1a5fb4', '#2a7f2a', '#c53030', '#1a5fb4', '#2a7f2a', '#c53030', '#1a5fb4'],
};

interface TileFaceProps {
  tile: Tile;
}

export function TileFace({ tile }: TileFaceProps) {
  switch (tile.suit) {
    case TileSuit.WAN:
      return <WanFace value={tile.value} />;
    case TileSuit.TONG:
      return <TongFace value={tile.value} />;
    case TileSuit.TIAO:
      return <TiaoFace value={tile.value} />;
    case TileSuit.FENG:
      return <FengFace value={tile.value} />;
    case TileSuit.ZI:
      return <ZiFace value={tile.value} />;
    default:
      return <span>?</span>;
  }
}

/** 万子: red number on top, red 萬 on bottom */
function WanFace({ value }: { value: number }) {
  return (
    <div className="tf tf-wan">
      <span className="tf-wan-num">{WAN_NUMS[value - 1]}</span>
      <span className="tf-wan-char">萬</span>
    </div>
  );
}

/** 筒子: colored circles arranged in grid */
function TongFace({ value }: { value: number }) {
  const colors = TONG_COLORS[value] ?? [];
  if (value === 1) {
    return (
      <div className="tf tf-tong1">
        <svg viewBox="0 0 24 24" className="tf-svg">
          <circle cx="12" cy="12" r="9" fill="none" stroke="#2a7f2a" strokeWidth="2" />
          <circle cx="12" cy="12" r="5" fill="none" stroke="#2a7f2a" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="1.5" fill="#2a7f2a" />
          {/* Decorative spokes */}
          {[0,45,90,135,180,225,270,315].map((a) => (
            <line key={a} x1="12" y1="3" x2="12" y2="5"
              stroke="#2a7f2a" strokeWidth="1"
              transform={`rotate(${a} 12 12)`} />
          ))}
        </svg>
      </div>
    );
  }
  return (
    <div className={`tf tf-tong tf-tong-${value}`}>
      {colors.map((c, i) => (
        <svg key={i} viewBox="0 0 12 12" className="tf-circle">
          <circle cx="6" cy="6" r="4.5" fill="none" stroke={c} strokeWidth="1.5" />
          <circle cx="6" cy="6" r="1.5" fill={c} />
        </svg>
      ))}
    </div>
  );
}

/** 条子: bamboo sticks */
function TiaoFace({ value }: { value: number }) {
  if (value === 1) {
    // Special: bird (simplified as a decorated stick)
    return (
      <div className="tf tf-tiao1">
        <svg viewBox="0 0 24 32" className="tf-svg">
          <ellipse cx="12" cy="10" rx="6" ry="5" fill="none" stroke="#2a7f2a" strokeWidth="1.5" />
          <circle cx="10" cy="9" r="1" fill="#c53030" />
          <line x1="12" y1="15" x2="12" y2="30" stroke="#2a7f2a" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="15" y1="8" x2="18" y2="5" stroke="#c53030" strokeWidth="1" />
        </svg>
      </div>
    );
  }
  const colors = TIAO_COLORS[value] ?? [];
  return (
    <div className={`tf tf-tiao tf-tiao-${value}`}>
      {colors.map((c, i) => (
        <svg key={i} viewBox="0 0 6 16" className="tf-bamboo">
          <rect x="1.5" y="0" width="3" height="16" rx="1.5" fill={c} />
          <line x1="1.5" y1="4" x2="4.5" y2="4" stroke="rgba(255,255,255,.3)" strokeWidth=".5" />
          <line x1="1.5" y1="8" x2="4.5" y2="8" stroke="rgba(255,255,255,.3)" strokeWidth=".5" />
          <line x1="1.5" y1="12" x2="4.5" y2="12" stroke="rgba(255,255,255,.3)" strokeWidth=".5" />
        </svg>
      ))}
    </div>
  );
}

/** 风牌: blue character */
function FengFace({ value }: { value: number }) {
  return (
    <div className="tf tf-feng">
      <span className="tf-feng-char">{FENG_CHARS[value - 1]}</span>
    </div>
  );
}

/** 字牌: 中(red), 發(green), 白(blue border) */
function ZiFace({ value }: { value: number }) {
  if (value === 1) return <div className="tf tf-zi"><span className="tf-zhong">中</span></div>;
  if (value === 2) return <div className="tf tf-zi"><span className="tf-fa">發</span></div>;
  // 白板: blue rectangle outline
  return (
    <div className="tf tf-zi">
      <svg viewBox="0 0 20 28" className="tf-svg">
        <rect x="3" y="4" width="14" height="20" rx="2" fill="none" stroke="#1a5fb4" strokeWidth="2" />
        <rect x="6" y="8" width="8" height="12" rx="1" fill="none" stroke="#1a5fb4" strokeWidth="1" />
      </svg>
    </div>
  );
}
