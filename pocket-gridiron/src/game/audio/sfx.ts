/**
 * Synthesized sound effects (WebAudio, no audio files). iOS requires a user gesture before audio
 * can play, so `unlock()` is called from the first touch.
 */
export type SfxName =
  | "click" | "whistle" | "hut" | "throw" | "catch" | "hit" | "incomplete" | "touchdown" | "firstDown"
  | "interception" | "juke" | "crowdCheer" | "groan" | "kick" | "error";

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowd: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.7;

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyVolume();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? this.volume * 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  /** Create/resume the audio context. Call from a touch/click handler. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.applyVolume();
        this.noise = this.makeNoise(2);
        // Silent blip primes iOS.
        const b = this.ctx.createBuffer(1, 1, 22050);
        const s = this.ctx.createBufferSource();
        s.buffer = b;
        s.connect(this.master);
        s.start(0);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      // Slightly brown noise: softer, more like a crowd than hiss.
      last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
      d[i] = last * 3.2 + (Math.random() * 2 - 1) * 0.15;
    }
    return buf;
  }

  /** Crowd bed: looping filtered noise whose level swells on big moments. */
  startCrowd(): void {
    if (!this.ctx || !this.master || !this.noise || this.crowd) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 700;
    filter.Q.value = 0.6;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.05;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.crowd = { src, gain, filter };
  }

  stopCrowd(): void {
    if (!this.crowd) return;
    try {
      this.crowd.src.stop();
    } catch {
      /* already stopped */
    }
    this.crowd = null;
  }

  private swell(level: number, hold: number): void {
    if (!this.ctx || !this.crowd) return;
    const g = this.crowd.gain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(level, t, 0.08);
    g.setTargetAtTime(0.05, t + hold, 0.6);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, gain: number, type: BiquadFilterType = "lowpass", when = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }

  play(name: SfxName): void {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== "running") return;
    switch (name) {
      case "click":
        this.tone(880, 0.05, "square", 0.08);
        break;
      case "whistle": {
        // Referee whistle: two detuned tones with a pea-rattle wobble.
        const ctx = this.ctx;
        const t = ctx.currentTime;
        for (const f of [2950, 3120]) {
          const o = ctx.createOscillator();
          const lfo = ctx.createOscillator();
          const lg = ctx.createGain();
          const g = ctx.createGain();
          o.frequency.value = f;
          lfo.frequency.value = 38;
          lg.gain.value = 90;
          lfo.connect(lg).connect(o.frequency);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
          g.gain.setValueAtTime(0.07, t + 0.32);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
          o.connect(g).connect(this.master);
          o.start(t);
          lfo.start(t);
          o.stop(t + 0.45);
          lfo.stop(t + 0.45);
        }
        break;
      }
      case "hut":
        this.tone(170, 0.12, "sawtooth", 0.12, 0, 120);
        this.burst(0.06, 900, 0.08);
        break;
      case "throw":
        this.burst(0.22, 1600, 0.12, "bandpass");
        break;
      case "catch":
        this.tone(140, 0.09, "sine", 0.35, 0, 80);
        this.burst(0.05, 2400, 0.08, "highpass");
        break;
      case "hit":
        this.burst(0.16, 420, 0.5);
        this.tone(90, 0.14, "sine", 0.4, 0, 45);
        break;
      case "incomplete":
        this.tone(220, 0.25, "triangle", 0.12, 0, 140);
        this.swell(0.09, 0.4);
        break;
      case "firstDown":
        this.tone(660, 0.08, "square", 0.07);
        this.tone(990, 0.12, "square", 0.07, 0.08);
        this.swell(0.14, 0.6);
        break;
      case "touchdown": {
        const notes = [523, 659, 784, 1047, 784, 1047];
        notes.forEach((n, i) => this.tone(n, i === notes.length - 1 ? 0.5 : 0.13, "square", 0.08, i * 0.12));
        this.swell(0.32, 2.2);
        break;
      }
      case "interception":
        this.tone(330, 0.18, "sawtooth", 0.1, 0, 220);
        this.tone(311, 0.3, "sawtooth", 0.1, 0.16, 150);
        this.swell(0.2, 1.2);
        break;
      case "juke":
        this.burst(0.09, 3000, 0.08, "highpass");
        break;
      case "crowdCheer":
        this.swell(0.22, 1.0);
        break;
      case "groan":
        this.swell(0.12, 0.6);
        break;
      case "kick":
        this.tone(110, 0.1, "sine", 0.5, 0, 60);
        this.burst(0.05, 1200, 0.2);
        break;
      case "error":
        this.tone(160, 0.12, "square", 0.06);
        break;
    }
  }
}
