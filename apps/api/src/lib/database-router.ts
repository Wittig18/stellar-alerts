import { prisma, prismaRead, setReadTarget, getReadTarget, type DatabaseTarget } from './prisma';

/**
 * Read replica lag probing and failover (#728).
 *
 * `db-failover.ts` already handles the "primary is unreachable" case by
 * rerouting reads to the replica. This module covers the complementary,
 * previously-unmonitored case: the primary is healthy, but the configured
 * read replica has fallen behind on WAL replay. Serving reads from a
 * replica that is multiple seconds stale means users see stale payment and
 * alert states even though the data they need already committed on the
 * primary — the failure mode the issue describes.
 *
 * `ReplicaLagMonitor` polls `pg_last_xact_replay_timestamp()` on the
 * replica every `probeIntervalMs` and compares it against wall-clock time
 * to estimate replication delay in milliseconds. When lag exceeds
 * `lagThresholdMs` (or the probe itself fails/times out, which is treated
 * as "unknown and therefore unsafe" lag), it calls `setReadTarget('PRIMARY')`
 * so `getReadClient()` (lib/prisma.ts) routes reads to the primary instead.
 * Once the replica reports lag back under the threshold for
 * `recoveryProbeCount` consecutive probes, reads are routed back to the
 * replica to resume offloading the primary.
 */

export type ReplicaHealthState = 'IN_SYNC' | 'LAGGING';

export interface ReplicaLagMonitorConfig {
  /** How often to probe replication lag. Default 10,000ms per the issue. */
  probeIntervalMs: number;
  /** Lag above which reads fail over to primary. Default 2000ms per the issue. */
  lagThresholdMs: number;
  /** Probe timeout before the lag is treated as unknown (unsafe). */
  probeTimeoutMs: number;
  /** Consecutive under-threshold probes required before failing back to the replica. */
  recoveryProbeCount: number;
}

export interface ReplicaLagStatus {
  state: ReplicaHealthState;
  lastLagMs: number | null;
  lastProbeAt: Date | null;
  lastError: string | null;
  activeReadTarget: DatabaseTarget;
  consecutiveHealthyProbes: number;
}

export type LagProbeFn = () => Promise<number>;

const defaultConfig: ReplicaLagMonitorConfig = {
  probeIntervalMs: Number(process.env.REPLICA_LAG_PROBE_INTERVAL_MS) || 10_000,
  lagThresholdMs: Number(process.env.REPLICA_LAG_THRESHOLD_MS) || 2000,
  probeTimeoutMs: Number(process.env.REPLICA_LAG_PROBE_TIMEOUT_MS) || 3000,
  recoveryProbeCount: Number(process.env.REPLICA_LAG_RECOVERY_PROBE_COUNT) || 2,
};

/**
 * Measures replica replication delay in milliseconds: the wall-clock gap
 * between now and the replica's last-replayed transaction timestamp. On a
 * primary (not a replica) `pg_last_xact_replay_timestamp()` returns NULL —
 * callers running this against a non-replica client will see lag 0, which
 * is intentional (nothing to probe, treat it as in sync).
 */
async function defaultLagProbe(): Promise<number> {
  const rows = await prismaRead.$queryRaw<Array<{ lag_ms: number | null }>>`
    SELECT
      CASE
        WHEN pg_last_xact_replay_timestamp() IS NULL THEN 0
        ELSE EXTRACT(MILLISECONDS FROM (now() - pg_last_xact_replay_timestamp()))
      END AS lag_ms
  `;
  const lagMs = rows[0]?.lag_ms;
  if (lagMs === null || lagMs === undefined || !Number.isFinite(lagMs)) {
    throw new Error('Replica lag probe returned no measurement');
  }
  return Math.max(0, Math.round(lagMs));
}

export class ReplicaLagMonitor {
  private state: ReplicaHealthState = 'IN_SYNC';
  private lastLagMs: number | null = null;
  private lastProbeAt: Date | null = null;
  private lastError: string | null = null;
  private consecutiveHealthy = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ReplicaLagMonitorConfig = defaultConfig,
    private readonly probe: LagProbeFn = defaultLagProbe,
    private readonly onReroute: (target: DatabaseTarget) => void = setReadTarget,
    private readonly hasReplica: () => boolean = () => prismaRead !== prisma
  ) {}

  getStatus(): ReplicaLagStatus {
    return {
      state: this.state,
      lastLagMs: this.lastLagMs,
      lastProbeAt: this.lastProbeAt,
      lastError: this.lastError,
      activeReadTarget: getReadTarget(),
      consecutiveHealthyProbes: this.consecutiveHealthy,
    };
  }

  /** Runs one probe and applies the resulting state transition. Exposed for tests and manual triggering. */
  async check(): Promise<ReplicaLagStatus> {
    // No replica configured: there is nothing to probe or route around.
    if (!this.hasReplica()) {
      return this.getStatus();
    }

    this.lastProbeAt = new Date();
    let lagMs: number;
    try {
      lagMs = await this.runProbeWithTimeout();
      this.lastError = null;
    } catch (err) {
      // An unreachable or errroring replica is treated the same as "lag
      // exceeds the threshold": we have no evidence it's safe to read from,
      // so fail over to primary rather than risk serving stale or absent data.
      this.lastError = (err as Error).message;
      this.lastLagMs = null;
      this.consecutiveHealthy = 0;
      this.failOverToPrimary();
      return this.getStatus();
    }

    this.lastLagMs = lagMs;

    if (lagMs > this.config.lagThresholdMs) {
      this.consecutiveHealthy = 0;
      this.failOverToPrimary();
    } else {
      this.consecutiveHealthy++;
      if (this.state === 'LAGGING' && this.consecutiveHealthy >= this.config.recoveryProbeCount) {
        this.failBackToReplica();
      }
    }

    return this.getStatus();
  }

  private async runProbeWithTimeout(): Promise<number> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Replica lag probe timed out')), this.config.probeTimeoutMs);
    });
    try {
      return await Promise.race([this.probe(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private failOverToPrimary(): void {
    const wasInSync = this.state === 'IN_SYNC';
    this.state = 'LAGGING';
    this.onReroute('PRIMARY');
    if (wasInSync) {
      console.warn(
        `[ReplicaLagMonitor] 🚨 Read replica lag ${this.lastLagMs ?? 'unknown'}ms exceeds threshold ` +
          `(${this.config.lagThresholdMs}ms)${this.lastError ? ` (${this.lastError})` : ''}. Routing reads to primary.`
      );
    }
  }

  private failBackToReplica(): void {
    this.state = 'IN_SYNC';
    this.onReroute('REPLICA');
    console.log(
      `[ReplicaLagMonitor] 🟢 Read replica caught up (lag ${this.lastLagMs}ms, below ${this.config.lagThresholdMs}ms threshold ` +
        `for ${this.consecutiveHealthy} consecutive probes). Resuming reads from replica.`
    );
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), this.config.probeIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const replicaLagMonitor = new ReplicaLagMonitor();
