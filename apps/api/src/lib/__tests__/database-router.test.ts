import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplicaLagMonitor, type ReplicaLagMonitorConfig } from '../database-router';

const testConfig: ReplicaLagMonitorConfig = {
  probeIntervalMs: 10_000,
  lagThresholdMs: 2000,
  probeTimeoutMs: 1000,
  recoveryProbeCount: 2,
};

describe('ReplicaLagMonitor (#728)', () => {
  let onReroute: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onReroute = vi.fn();
  });

  const makeMonitor = (probe: () => Promise<number>, hasReplica = () => true) =>
    new ReplicaLagMonitor(testConfig, probe, onReroute, hasReplica);

  it('starts IN_SYNC and does not reroute while lag stays under the threshold', async () => {
    const monitor = makeMonitor(async () => 500);
    const status = await monitor.check();

    expect(status.state).toBe('IN_SYNC');
    expect(status.lastLagMs).toBe(500);
    expect(onReroute).not.toHaveBeenCalled();
  });

  it('routes reads to primary once lag exceeds the threshold', async () => {
    const monitor = makeMonitor(async () => 2500);
    const status = await monitor.check();

    expect(status.state).toBe('LAGGING');
    expect(status.lastLagMs).toBe(2500);
    expect(onReroute).toHaveBeenCalledWith('PRIMARY');
  });

  it('routes reads to primary when the probe fails outright', async () => {
    const monitor = makeMonitor(async () => {
      throw new Error('replica connection refused');
    });
    const status = await monitor.check();

    expect(status.state).toBe('LAGGING');
    expect(status.lastError).toContain('replica connection refused');
    expect(onReroute).toHaveBeenCalledWith('PRIMARY');
  });

  it('routes reads to primary when the probe exceeds probeTimeoutMs', async () => {
    const monitor = new ReplicaLagMonitor(
      { ...testConfig, probeTimeoutMs: 5 },
      () => new Promise<number>((resolve) => setTimeout(() => resolve(0), 50)),
      onReroute,
      () => true
    );
    const status = await monitor.check();
    expect(status.state).toBe('LAGGING');
    expect(status.lastError).toContain('timed out');
  });

  it('does not fail back to the replica until recoveryProbeCount consecutive healthy probes', async () => {
    let lag = 3000;
    const monitor = makeMonitor(async () => lag);

    await monitor.check(); // lagging
    expect(monitor.getStatus().state).toBe('LAGGING');

    lag = 100;
    const afterFirstHealthy = await monitor.check();
    expect(afterFirstHealthy.state).toBe('LAGGING'); // only 1 of 2 required probes
    expect(onReroute).not.toHaveBeenCalledWith('REPLICA');

    const afterSecondHealthy = await monitor.check();
    expect(afterSecondHealthy.state).toBe('IN_SYNC');
    expect(onReroute).toHaveBeenCalledWith('REPLICA');
  });

  it('resets the healthy-probe streak when lag spikes again mid-recovery', async () => {
    let lag = 3000;
    const monitor = makeMonitor(async () => lag);

    await monitor.check(); // lagging, streak 0
    lag = 100;
    await monitor.check(); // healthy streak 1
    lag = 3000;
    await monitor.check(); // spike resets streak to 0, still lagging

    lag = 100;
    await monitor.check(); // streak 1
    const status = await monitor.check(); // streak 2 -> recovers
    expect(status.state).toBe('IN_SYNC');
  });

  it('is a no-op when no replica is configured', async () => {
    const probe = vi.fn(async () => 5000);
    const monitor = makeMonitor(probe, () => false);

    const status = await monitor.check();
    expect(probe).not.toHaveBeenCalled();
    expect(status.state).toBe('IN_SYNC');
    expect(onReroute).not.toHaveBeenCalled();
  });

  it('exposes current status via getStatus without re-probing', async () => {
    const monitor = makeMonitor(async () => 100);
    await monitor.check();

    const status = monitor.getStatus();
    expect(status.lastLagMs).toBe(100);
    expect(status.state).toBe('IN_SYNC');
  });
});
