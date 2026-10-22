/**
 * Burst protection for feed cards. The first `passThrough` items of a burst are delivered
 * one by one; everything after that is held and flushed as ONE summary when the burst goes
 * quiet (`quietMs`) or at the latest `maxHoldMs` after the first held item. Summaries are
 * capped per hour; over the cap items keep accumulating until a slot is free.
 * A flush of a single held item delivers it normally instead of a summary.
 * Pure apart from the injected clock/scheduler (tests drive both).
 */

export interface BurstGateOptions<T> {
  quietMs: number;
  maxHoldMs: number;
  passThrough: number;
  maxSummariesPerHour: number;
  deliver: (item: T) => Promise<void>;
  summarize: (items: T[]) => Promise<void>;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

const HOUR = 3_600_000;

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, Math.max(0, ms));
  t.unref?.();
  return () => clearTimeout(t);
};

export class BurstGate<T> {
  private readonly o: Required<BurstGateOptions<T>>;
  private lastAt: number | undefined;
  private passed = 0;
  private held: T[] = [];
  private firstHeldAt = 0;
  private cancel: (() => void) | undefined;
  private summaryTimes: number[] = [];

  constructor(options: BurstGateOptions<T>) {
    this.o = { now: Date.now, schedule: defaultSchedule, ...options };
  }

  /** Number of items currently held for the next summary. */
  get pending(): number {
    return this.held.length;
  }

  async submit(item: T): Promise<'delivered' | 'held'> {
    const now = this.o.now();
    if (this.lastAt === undefined || (this.held.length === 0 && now - this.lastAt > this.o.quietMs)) this.passed = 0;
    this.lastAt = now;
    if (this.held.length === 0 && this.passed < this.o.passThrough) {
      this.passed++;
      await this.o.deliver(item);
      return 'delivered';
    }
    if (this.held.length === 0) this.firstHeldAt = now;
    this.held.push(item);
    this.arm(now);
    return 'held';
  }

  /** Flush now (shutdown / tests). Respects nothing but "held is not empty". */
  async flush(): Promise<void> {
    this.cancel?.();
    this.cancel = undefined;
    const items = this.held;
    if (!items.length) return;
    const now = this.o.now();
    this.summaryTimes = this.summaryTimes.filter((t) => now - t < HOUR);
    if (items.length > 1 && this.summaryTimes.length >= this.o.maxSummariesPerHour) {
      this.arm(now);
      return;
    }
    this.held = [];
    if (items.length === 1) {
      await this.o.deliver(items[0]!);
      return;
    }
    this.summaryTimes.push(now);
    await this.o.summarize(items);
  }

  private arm(now: number): void {
    this.cancel?.();
    const due = Math.min((this.lastAt ?? now) + this.o.quietMs, this.firstHeldAt + this.o.maxHoldMs);
    const recent = this.summaryTimes.filter((t) => now - t < HOUR);
    const capFree = recent.length >= this.o.maxSummariesPerHour ? Math.min(...recent) + HOUR : 0;
    const at = Math.max(due, capFree, now);
    this.cancel = this.o.schedule(() => {
      this.cancel = undefined;
      void this.flush().catch(() => undefined);
    }, at - now);
  }
}
