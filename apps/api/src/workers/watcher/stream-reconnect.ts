/**
 * Bounded adaptive reconnect backoff with Full Jitter (#726).
 *
 * When a public Horizon node restarts or drops a connection, every watcher
 * stream subscribed to it observes the failure at essentially the same
 * instant. Plain exponential backoff (delay = base * 2^attempt, no
 * randomness) keeps every client's clock in lockstep, so they all retry at
 * the same moment again and again — a thundering herd that re-triggers
 * Horizon's HTTP 429 rate limiting instead of recovering from it.
 *
 * Full Jitter (AWS Architecture Blog, "Exponential Backoff And Jitter")
 * decorrelates those clients by drawing the actual delay uniformly from
 * `[0, min(ceiling, base * 2^attempt)]` rather than using the exponential
 * value directly. Delays are bounded by `ceilingMs` (default 60s per the
 * issue) and the number of attempts is itself bounded (default unbounded —
 * callers that want a hard cap pass `maxAttempts`), so a single ever-flapping
 * stream can't retry forever without anyone noticing either.
 */

export interface FullJitterBackoffOptions {
  /** Base delay in ms for the first retry (attempt 1). Default 1000ms. */
  baseMs?: number;
  /** Upper bound no computed delay may exceed. Default 60,000ms per #726. */
  ceilingMs?: number;
  /** Maximum consecutive failed attempts before giving up. Default Infinity. */
  maxAttempts?: number;
  /** Injectable RNG in [0, 1) — overridable so tests get deterministic delays. */
  random?: () => number;
}

export interface FullJitterBackoffState {
  /** Number of consecutive failures observed so far (0 = healthy). */
  readonly attempts: number;
}

const DEFAULT_BASE_MS = 1000;
const DEFAULT_CEILING_MS = 60_000;

/**
 * Computes the Full Jitter exponential delay for a given 1-indexed attempt
 * count, without mutating any state. Exposed for direct testing of the
 * distribution/bounds independent of the stateful controller below.
 */
export function computeFullJitterDelay(
  attempt: number,
  options: Pick<FullJitterBackoffOptions, 'baseMs' | 'ceilingMs' | 'random'> = {}
): number {
  const base = options.baseMs ?? DEFAULT_BASE_MS;
  const ceiling = options.ceilingMs ?? DEFAULT_CEILING_MS;
  const random = options.random ?? Math.random;

  if (attempt < 1) return 0;

  // 2^(attempt-1) * base, capped at the ceiling before jitter is applied so
  // the exponent never overflows to Infinity on a long-running stream.
  const exponential = base * 2 ** (attempt - 1);
  const uncappedMax = Number.isFinite(exponential) ? exponential : ceiling;
  const max = Math.min(ceiling, uncappedMax);

  return Math.floor(random() * max);
}

/**
 * Stateful controller tracking consecutive-failure count for one stream and
 * handing back the next Full Jitter delay. `onFailure` returns `null` once
 * `maxAttempts` is exceeded so the caller knows to stop reconnecting
 * entirely rather than compute a meaningless delay.
 */
export class FullJitterBackoff implements FullJitterBackoffState {
  private failureCount = 0;
  private readonly baseMs: number;
  private readonly ceilingMs: number;
  private readonly maxAttempts: number;
  private readonly random: () => number;

  constructor(options: FullJitterBackoffOptions = {}) {
    this.baseMs = options.baseMs ?? DEFAULT_BASE_MS;
    this.ceilingMs = options.ceilingMs ?? DEFAULT_CEILING_MS;
    this.maxAttempts = options.maxAttempts ?? Infinity;
    this.random = options.random ?? Math.random;
  }

  get attempts(): number {
    return this.failureCount;
  }

  /** Resets the failure count. Call on every successful connect/message. */
  reset(): void {
    this.failureCount = 0;
  }

  /**
   * Records a new failure and returns the delay (ms) to wait before the next
   * reconnect attempt, or `null` when `maxAttempts` consecutive failures
   * have already been exhausted.
   */
  onFailure(): number | null {
    if (this.failureCount >= this.maxAttempts) {
      return null;
    }
    this.failureCount++;
    return computeFullJitterDelay(this.failureCount, {
      baseMs: this.baseMs,
      ceilingMs: this.ceilingMs,
      random: this.random,
    });
  }
}
