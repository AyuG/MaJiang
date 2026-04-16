/**
 * Audio service — plays sound effects for key game actions.
 * Currently a stub that logs events; replace with actual Audio() calls
 * when sound assets are added to /public/sounds/.
 *
 * Usage: audioService.play('discard')
 */

type SoundEvent =
  | 'select'    // tile selected (first click)
  | 'discard'   // tile discarded (second click)
  | 'draw'      // tile drawn from wall
  | 'peng'      // peng action
  | 'gang'      // gang action
  | 'hu'        // hu (win)
  | 'timeout'   // turn timeout
  | 'dice';     // dice roll

class AudioService {
  private enabled = true;
  private sounds: Partial<Record<SoundEvent, string>> = {
    // Future: map to actual audio file paths
    // select: '/sounds/select.mp3',
    // discard: '/sounds/discard.mp3',
  };

  play(event: SoundEvent): void {
    if (!this.enabled) return;
    const src = this.sounds[event];
    if (src && typeof window !== 'undefined') {
      try {
        const audio = new Audio(src);
        audio.volume = 0.5;
        audio.play().catch(() => { /* autoplay blocked */ });
      } catch { /* ignore */ }
    }
    // Debug: uncomment to trace audio events
    // console.log(`[audio] ${event}`);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

export const audioService = new AudioService();
