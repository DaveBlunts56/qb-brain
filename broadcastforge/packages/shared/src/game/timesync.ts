/**
 * Estimates the server's monotonic clock from a client, NTP-style.
 *
 * Each ping records client send time t0, the server's monotonic time when it
 * answered, and client receive time t1. offset = serverMono - (t0 + rtt/2).
 * The lowest-RTT sample in a sliding window is the most trustworthy. The
 * displayed offset slews gently toward new estimates so clocks never visibly
 * jump on a resync, but snaps when the error is large (e.g. server restart).
 */
export interface TimeSample {
  offset: number;
  rtt: number;
  at: number;
}

export class ServerTimeEstimator {
  private samples: TimeSample[] = [];
  private current: number | null = null;
  private lastUpdate = 0;

  constructor(
    private readonly opts: { window?: number; snapThresholdMs?: number; slewPerSecondMs?: number } = {},
  ) {}

  get hasEstimate(): boolean {
    return this.current !== null;
  }

  get bestRtt(): number | null {
    return this.samples.length ? Math.min(...this.samples.map((s) => s.rtt)) : null;
  }

  reset() {
    this.samples = [];
    this.current = null;
  }

  addSample(t0: number, serverMono: number, t1: number) {
    const rtt = Math.max(0, t1 - t0);
    const offset = serverMono - (t0 + rtt / 2);
    this.samples.push({ offset, rtt, at: t1 });
    const window = this.opts.window ?? 8;
    if (this.samples.length > window) this.samples.shift();
    if (this.current === null) {
      this.current = offset;
      this.lastUpdate = t1;
    }
  }

  /** Coarse fallback when no ping has completed yet: assume zero latency. */
  seed(serverMono: number, clientNow: number) {
    if (this.current === null) {
      this.current = serverMono - clientNow;
      this.lastUpdate = clientNow;
    }
  }

  private target(): number | null {
    if (!this.samples.length) return this.current;
    let best = this.samples[0]!;
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    return best.offset;
  }

  /** Offset to add to the client's performance.now() to get server monotonic time. */
  offset(clientNow: number): number {
    const target = this.target();
    if (target === null || this.current === null) return 0;
    const diff = target - this.current;
    const snap = this.opts.snapThresholdMs ?? 250;
    if (Math.abs(diff) > snap) {
      this.current = target;
    } else {
      const dt = Math.max(0, clientNow - this.lastUpdate) / 1000;
      const maxStep = (this.opts.slewPerSecondMs ?? 50) * dt;
      this.current += Math.max(-maxStep, Math.min(maxStep, diff));
    }
    this.lastUpdate = clientNow;
    return this.current;
  }

  serverNow(clientNow: number): number {
    return clientNow + this.offset(clientNow);
  }
}
