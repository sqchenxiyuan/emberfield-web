export class CampAudio {
  private context: AudioContext | null = null;
  enabled = true;
  private voices = 0;
  unlock() {
    if (!this.context) this.context = new AudioContext();
    void this.context.resume();
  }
  play(kind: 'click' | 'good' | 'danger' | 'shot') {
    const ctx = this.context;
    if (!ctx || !this.enabled || ctx.state !== 'running' || this.voices > 20) return;
    const notes =
      kind === 'danger'
        ? [330, 247, 220]
        : kind === 'good'
          ? [523, 659]
          : kind === 'shot'
            ? [95]
            : [440];
    notes.forEach((frequency, i) => {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain(),
        start = ctx.currentTime + i * 0.14,
        duration = kind === 'shot' ? 0.07 : 0.16;
      osc.type = kind === 'shot' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(frequency, start);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.6, start + duration);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(kind === 'danger' ? 0.06 : 0.025, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
      this.voices++;
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        this.voices--;
      };
    });
  }
}
export const campAudio = new CampAudio();
