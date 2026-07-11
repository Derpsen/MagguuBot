export interface RevocationRecord {
  userId: string;
  notValidBefore: Date;
}

export type RevocationLoader = () => readonly RevocationRecord[];

export class RevocationCache {
  private readonly values = new Map<string, number>();
  private stampedAt: number | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  isRevoked(userId: string, issuedAt: number, load: RevocationLoader): boolean {
    this.refresh(load);
    const notValidBefore = this.values.get(userId);
    return notValidBefore !== undefined && issuedAt <= notValidBefore;
  }

  record(userId: string, notValidBefore: Date, load: RevocationLoader): void {
    // A forced snapshot prevents the first revocation after startup from making
    // a one-entry cache look complete for the full TTL.
    this.refresh(load, true);
    this.values.set(userId, notValidBefore.getTime());
    this.stampedAt = this.now();
  }

  private refresh(load: RevocationLoader, force = false): void {
    const now = this.now();
    if (!force && this.stampedAt !== null && now - this.stampedAt < this.ttlMs) return;

    const rows = load();
    this.values.clear();
    for (const row of rows) {
      this.values.set(row.userId, row.notValidBefore.getTime());
    }
    this.stampedAt = now;
  }
}
