import { describe, it, expect } from 'vitest';
import { computeFullJitterDelay, FullJitterBackoff } from '../stream-reconnect';

describe('computeFullJitterDelay (#726)', () => {
  it('returns 0 for a non-positive attempt count', () => {
    expect(computeFullJitterDelay(0)).toBe(0);
    expect(computeFullJitterDelay(-1)).toBe(0);
  });

  it('is uniformly distributed across [0, base * 2^(attempt-1)] below the ceiling', () => {
    const samples: number[] = [];
    // Deterministic sequence of "random" values spanning [0, 1).
    const randoms = Array.from({ length: 1000 }, (_, i) => i / 1000);
    let idx = 0;
    const random = () => randoms[idx++ % randoms.length];

    for (let i = 0; i < randoms.length; i++) {
      samples.push(computeFullJitterDelay(3, { baseMs: 1000, ceilingMs: 60000, random }));
    }

    // attempt=3 -> exponential = 1000 * 2^2 = 4000ms, within the ceiling.
    expect(Math.max(...samples)).toBeLessThanOrEqual(4000);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    // With a uniform random source, values should spread across a wide
    // range rather than clustering at one point (sanity check on "jitter").
    const unique = new Set(samples);
    expect(unique.size).toBeGreaterThan(100);
  });

  it('caps the delay at ceilingMs once the exponential value exceeds it', () => {
    const delay = computeFullJitterDelay(10, { baseMs: 1000, ceilingMs: 60000, random: () => 1 });
    // 1000 * 2^9 = 512000ms uncapped; Full Jitter draws from [0, min(ceiling, 512000)].
    expect(delay).toBeLessThanOrEqual(60000);
    expect(delay).toBe(60000);
  });

  it('never exceeds the 1s-60s range from the issue spec on attempts 1-10', () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = computeFullJitterDelay(attempt, { baseMs: 1000, ceilingMs: 60000, random: () => 1 });
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(60000);
    }
  });

  it('does not overflow to a nonsensical value on very high attempt counts', () => {
    const delay = computeFullJitterDelay(200, { baseMs: 1000, ceilingMs: 60000, random: () => 1 });
    expect(delay).toBe(60000);
    expect(Number.isFinite(delay)).toBe(true);
  });
});

describe('FullJitterBackoff', () => {
  it('starts with zero attempts and no delay history', () => {
    const backoff = new FullJitterBackoff();
    expect(backoff.attempts).toBe(0);
  });

  it('increments attempts and computes growing delay ceilings on repeated failures', () => {
    const backoff = new FullJitterBackoff({ baseMs: 10, ceilingMs: 1000, random: () => 1 });

    const d1 = backoff.onFailure();
    expect(d1).toBe(10); // 2^0 * 10
    expect(backoff.attempts).toBe(1);

    const d2 = backoff.onFailure();
    expect(d2).toBe(20); // 2^1 * 10
    expect(backoff.attempts).toBe(2);

    const d3 = backoff.onFailure();
    expect(d3).toBe(40); // 2^2 * 10
    expect(backoff.attempts).toBe(3);
  });

  it('caps delay at ceilingMs on repeated failures', () => {
    const backoff = new FullJitterBackoff({ baseMs: 10, ceilingMs: 15, random: () => 1 });

    backoff.onFailure(); // 10ms
    const capped = backoff.onFailure(); // uncapped 20ms -> capped to 15ms
    expect(capped).toBe(15);
  });

  it('resets the attempt counter back to zero', () => {
    const backoff = new FullJitterBackoff({ baseMs: 10, random: () => 1 });
    backoff.onFailure();
    backoff.onFailure();
    expect(backoff.attempts).toBe(2);

    backoff.reset();
    expect(backoff.attempts).toBe(0);

    const delay = backoff.onFailure();
    expect(delay).toBe(10); // back to the base delay for attempt 1
  });

  it('returns null once maxAttempts consecutive failures are exhausted', () => {
    const backoff = new FullJitterBackoff({ baseMs: 10, maxAttempts: 2, random: () => 1 });

    expect(backoff.onFailure()).not.toBeNull();
    expect(backoff.onFailure()).not.toBeNull();
    expect(backoff.onFailure()).toBeNull();
    // Attempts count stops growing once exhausted.
    expect(backoff.attempts).toBe(2);
  });
});
