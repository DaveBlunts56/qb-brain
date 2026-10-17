/**
 * Animation scheduling rules, independent of the DOM so they can be unit
 * tested with fake time. The overlay renderer supplies "runners" that start
 * real Web Animations and call `done` when they finish.
 *
 * Rules for simultaneous / rapid events:
 *  - Value lanes (one per bound element): latest value wins. A new value
 *    cancels the in-flight transition and animates from what is on screen to
 *    the newest value. Bursts faster than `minIntervalMs` are coalesced so
 *    the viewer sees a clean roll to the final number, never a backlog.
 *  - Toggle lanes (visibility-bound elements: flag, possession, pips, the
 *    scorebug itself): flipping mid-animation reverses the running
 *    animation from its current point instead of jumping.
 *  - Takeover lane (TOUCHDOWN, FIELD GOAL, banners): exclusive. Equal or
 *    higher priority preempts; lower priority waits in a short queue; an
 *    identical request inside the dedupe window is ignored (double-tap);
 *    queued requests older than `staleMs` are dropped.
 *  - Emergency clear cancels everything and empties the queue.
 *  - `done` callbacks from cancelled runs are ignored (token guarded).
 */

export interface Cancelable {
  cancel(): void;
  /** Reverse from the current point; must call onDone when back at start. Return false if unsupported. */
  reverse?(onDone: () => void): boolean;
}

export interface LaneClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: LaneClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class ValueLane<T> {
  private displayed: T;
  private pending: { value: T } | null = null;
  private running: Cancelable | null = null;
  private token = 0;
  private lastStart = -Infinity;
  private timer: unknown = null;

  constructor(
    initial: T,
    private readonly run: (from: T, to: T, done: () => void) => Cancelable,
    private readonly setInstant: (value: T) => void,
    private readonly clock: LaneClock = realClock,
    private readonly minIntervalMs = 120,
    private readonly equals: (a: T, b: T) => boolean = Object.is,
  ) {
    this.displayed = initial;
  }

  /** The value the lane is heading to. */
  get target(): T {
    return this.pending ? this.pending.value : this.displayed;
  }

  get isAnimating(): boolean {
    return this.running !== null;
  }

  update(value: T, animate: boolean): void {
    if (!animate) {
      this.stop(false);
      this.displayed = value;
      this.setInstant(value);
      return;
    }
    if (this.equals(value, this.target)) return;
    const since = this.clock.now() - this.lastStart;
    if (this.timer === null && since >= this.minIntervalMs) {
      this.start(value);
    } else {
      this.pending = { value };
      if (this.timer === null) this.timer = this.clock.setTimeout(() => this.flush(), Math.max(0, this.minIntervalMs - since));
    }
  }

  /** Cancel any animation and pending update, leaving the last target on screen. */
  stop(settle = true): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    if (this.pending) {
      this.displayed = this.pending.value;
      this.pending = null;
    }
    if (this.running) {
      this.token++;
      this.running.cancel();
      this.running = null;
      if (settle) this.setInstant(this.displayed);
    }
  }

  private flush() {
    this.timer = null;
    const p = this.pending;
    this.pending = null;
    if (p && !this.equals(p.value, this.displayed)) this.start(p.value);
  }

  private start(value: T) {
    if (this.running) this.running.cancel();
    const from = this.displayed;
    this.displayed = value;
    this.lastStart = this.clock.now();
    const token = ++this.token;
    this.running = this.run(from, value, () => {
      if (token === this.token) this.running = null;
    });
  }
}

export class ToggleLane {
  private shown: boolean;
  private running: Cancelable | null = null;
  private token = 0;

  constructor(
    initial: boolean,
    private readonly run: (show: boolean, done: () => void) => Cancelable,
    private readonly setInstant: (show: boolean) => void,
  ) {
    this.shown = initial;
  }

  get target(): boolean {
    return this.shown;
  }

  get isAnimating(): boolean {
    return this.running !== null;
  }

  set(show: boolean, animate: boolean): void {
    if (show === this.shown) return;
    this.shown = show;
    const token = ++this.token;
    const done = () => {
      if (token !== this.token) return;
      this.running = null;
      this.setInstant(this.shown);
    };
    if (!animate) {
      this.running?.cancel();
      this.running = null;
      this.setInstant(show);
      return;
    }
    // Reverse the in-flight animation smoothly from its current point.
    if (this.running?.reverse && this.running.reverse(done)) return;
    this.running?.cancel();
    this.running = this.run(show, done);
  }

  stop(): void {
    this.token++;
    this.running?.cancel();
    this.running = null;
    this.setInstant(this.shown);
  }
}

export interface TakeoverRequest {
  /** Dedupe key, e.g. "touchdown:home". */
  key: string;
  priority: number;
  /** Lane-clock time the request arrived. */
  at: number;
  data: unknown;
}

export type TakeoverOutcome = 'started' | 'preempted' | 'queued' | 'duplicate';

export class TakeoverController {
  private current: { req: TakeoverRequest; anim: Cancelable; token: number } | null = null;
  private queue: TakeoverRequest[] = [];
  private token = 0;

  constructor(
    private readonly play: (req: TakeoverRequest, done: () => void) => Cancelable,
    private readonly clock: LaneClock = realClock,
    private readonly opts: { dedupeWindowMs?: number; maxQueue?: number; staleMs?: number } = {},
  ) {}

  get active(): TakeoverRequest | null {
    return this.current?.req ?? null;
  }

  get queued(): readonly TakeoverRequest[] {
    return this.queue;
  }

  request(req: TakeoverRequest): TakeoverOutcome {
    const dedupe = this.opts.dedupeWindowMs ?? 1500;
    if (this.current && this.current.req.key === req.key && req.at - this.current.req.at < dedupe) return 'duplicate';
    if (this.queue.some((q) => q.key === req.key)) return 'duplicate';
    if (!this.current) {
      this.start(req);
      return 'started';
    }
    if (req.priority >= this.current.req.priority) {
      this.token++;
      this.current.anim.cancel();
      this.current = null;
      this.start(req);
      return 'preempted';
    }
    this.queue.push(req);
    this.queue.sort((a, b) => b.priority - a.priority || a.at - b.at);
    const max = this.opts.maxQueue ?? 2;
    if (this.queue.length > max) this.queue.length = max;
    return 'queued';
  }

  clear(): void {
    this.queue = [];
    if (this.current) {
      this.token++;
      this.current.anim.cancel();
      this.current = null;
    }
  }

  private start(req: TakeoverRequest) {
    const token = ++this.token;
    let finished = false;
    const anim = this.play(req, () => {
      if (token !== this.token || finished) return;
      finished = true;
      if (this.current?.token === token) this.current = null;
      this.next();
    });
    // play() may have finished synchronously (e.g. an empty timeline).
    if (!finished && token === this.token) this.current = { req, anim, token };
  }

  private next() {
    const stale = this.opts.staleMs ?? 15_000;
    const now = this.clock.now();
    while (this.queue.length) {
      const req = this.queue.shift()!;
      if (now - req.at <= stale) {
        this.start(req);
        return;
      }
    }
  }
}
