/**
 * Audio service — plays sound effects for key game actions.
 * Sound assets from mahjong-master (MIT license).
 */

type SoundEvent =
  | 'select'
  | 'discard'
  | 'draw'
  | 'peng'
  | 'gang'
  | 'hu'
  | 'timeout'
  | 'dice';

const SOUND_MAP: Partial<Record<SoundEvent, string>> = {
  discard: '/sounds/discard.mp3',
  peng: '/sounds/action.mp3',
  gang: '/sounds/action.mp3',
  hu: '/sounds/win.mp3',
  dice: '/sounds/action.mp3',
};

class AudioService {
  private enabled = true;

  play(event: SoundEvent): void {
    if (!this.enabled || typeof window === 'undefined') return;
    const src = SOUND_MAP[event];
    if (!src) return;
    try {
      const audio = new Audio(src);
      audio.volume = 0.5;
      audio.play().catch(() => { /* autoplay blocked */ });
    } catch { /* ignore */ }
  }

  setEnabled(v: boolean): void { this.enabled = v; }
}

export const audioService = new AudioService();
