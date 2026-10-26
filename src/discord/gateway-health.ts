// Discord gateway state for GET /healthz. No discord.js import (the probe is injected by client.ts), so the logic
// is testable without a client. The report never contains tokens, ids, names or guild data: only booleans,
// a coarse state, the websocket ping and timestamps/durations.

export interface GatewayProbe {
  /** True while the websocket is in the Ready state (discord.js `client.isReady()`). */
  ready: boolean;
  /** `client.ws.ping` in ms, null when unknown (-1 / NaN before the first heartbeat ack). */
  pingMs: number | null;
}

export type GatewayState = 'ready' | 'starting' | 'reconnecting';

export interface GatewayReport {
  ready: boolean;
  /** starting = never ready since process start; reconnecting = was ready, is not now. */
  state: GatewayState;
  pingMs: number | null;
  /** ISO timestamp of the last ready/resume, null if never ready. */
  lastReadyAt: string | null;
  /** Seconds since the gateway stopped being ready (or since process start while starting); null when ready. */
  notReadySeconds: number | null;
  graceSeconds: number;
  /** True when the gateway has been not ready for longer than the grace window. */
  beyondGrace: boolean;
}

export class GatewayTracker {
  private lastReadyAt: number | null = null;
  private notReadySince: number | null = null;

  constructor(private readonly startedAt: number) {}

  noteReady(now: number): void {
    this.lastReadyAt = now;
    this.notReadySince = null;
  }

  noteDown(now: number): void {
    if (this.notReadySince === null) this.notReadySince = now;
  }

  report(probe: GatewayProbe, now: number, graceMs: number): GatewayReport {
    // Reconcile with the live state in case an event was missed.
    if (probe.ready) {
      if (this.notReadySince !== null || this.lastReadyAt === null) this.noteReady(now);
    } else if (this.notReadySince === null) {
      this.notReadySince = this.lastReadyAt === null ? this.startedAt : now;
    }
    const ready = probe.ready;
    const downFor = ready || this.notReadySince === null ? null : Math.max(0, now - this.notReadySince);
    const ping = probe.pingMs !== null && Number.isFinite(probe.pingMs) && probe.pingMs >= 0 ? Math.round(probe.pingMs) : null;
    return {
      ready,
      state: ready ? 'ready' : this.lastReadyAt === null ? 'starting' : 'reconnecting',
      pingMs: ready ? ping : null,
      lastReadyAt: this.lastReadyAt === null ? null : new Date(this.lastReadyAt).toISOString(),
      notReadySeconds: downFor === null ? null : Math.floor(downFor / 1000),
      graceSeconds: Math.round(graceMs / 1000),
      beyondGrace: downFor !== null && downFor > graceMs,
    };
  }
}

const tracker = new GatewayTracker(Date.now());
let probe: (() => GatewayProbe) | null = null;

/** client.ts registers the live probe once the discord.js client exists. */
export function setGatewayProbe(fn: (() => GatewayProbe) | null): void {
  probe = fn;
}

export function noteGatewayReady(now = Date.now()): void {
  tracker.noteReady(now);
}

export function noteGatewayDown(now = Date.now()): void {
  tracker.noteDown(now);
}

/** Without a registered probe (client not created yet) the gateway counts as not ready / starting. */
export function gatewayReport(graceSeconds: number, now = Date.now()): GatewayReport {
  const live = probe ? probe() : { ready: false, pingMs: null };
  return tracker.report(live, now, graceSeconds * 1000);
}
