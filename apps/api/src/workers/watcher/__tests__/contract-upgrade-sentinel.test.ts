import {
  ContractUpgradeSentinelEngine,
  ContractState,
} from '../../../services/contract-upgrade-sentinel';

describe('ContractUpgradeSentinel Worker (#649)', () => {
  const engine = new ContractUpgradeSentinelEngine();

  function makeContractState(overrides: Partial<ContractState> = {}): ContractState {
    return {
      contractId: 'CCONTRACT1',
      wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      admin: 'GAADMIN1',
      ledgerSeq: 100000,
      ...overrides,
    };
  }

  describe('ContractUpgradeSentinelEngine', () => {
    it('detects WASM bytecode upgrade', () => {
      const previous = makeContractState({
        wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      });
      const current = makeContractState({
        wasmHash: Buffer.from('b'.repeat(32), 'hex'),
      });

      const alert = engine.assessContractState(previous, current);
      expect(alert).not.toBeNull();
      expect(alert?.eventType).toBe('wasm_upgrade');
      expect(alert?.severity).toBe('CRITICAL');
      expect(alert?.oldWasmHash).toBe('a'.repeat(32));
      expect(alert?.newWasmHash).toBe('b'.repeat(32));
    });

    it('detects admin address change', () => {
      const previous = makeContractState({
        admin: 'GAADMIN1',
      });
      const current = makeContractState({
        admin: 'GAADMIN2',
      });

      const alert = engine.assessContractState(previous, current);
      expect(alert).not.toBeNull();
      expect(alert?.eventType).toBe('admin_change');
      expect(alert?.severity).toBe('WARNING');
      expect(alert?.oldAdmin).toBe('GAADMIN1');
      expect(alert?.newAdmin).toBe('GAADMIN2');
    });

    it('detects admin removal as CRITICAL', () => {
      const previous = makeContractState({
        admin: 'GAADMIN1',
      });
      const current = makeContractState({
        admin: null,
      });

      const alert = engine.assessContractState(previous, current);
      expect(alert).not.toBeNull();
      expect(alert?.eventType).toBe('admin_change');
      expect(alert?.severity).toBe('CRITICAL');
      expect(alert?.oldAdmin).toBe('GAADMIN1');
      expect(alert?.newAdmin).toBe('none');
    });

    it('returns null when no state change', () => {
      const previous = makeContractState();
      const current = makeContractState();

      const alert = engine.assessContractState(previous, current);
      expect(alert).toBeNull();
    });

    it('returns null when previous state is null and current is valid (initial state)', () => {
      const previous = null;
      const current = makeContractState();

      const alert = engine.assessContractState(previous, current);
      expect(alert).toBeNull();
    });

    it('returns null when WASM hash is null in both states', () => {
      const previous = makeContractState({ wasmHash: null });
      const current = makeContractState({ wasmHash: null });

      const alert = engine.assessContractState(previous, current);
      expect(alert).toBeNull();
    });

    it('returns null when admin is null in both states', () => {
      const previous = makeContractState({ admin: null });
      const current = makeContractState({ admin: null });

      const alert = engine.assessContractState(previous, current);
      expect(alert).toBeNull();
    });

    it('generates action items for WASM upgrade', () => {
      const previous = makeContractState({
        wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      });
      const current = makeContractState({
        wasmHash: Buffer.from('b'.repeat(32), 'hex'),
      });

      const alert = engine.assessContractState(previous, current);
      expect(alert?.actionItems).toBeDefined();
      expect(alert?.actionItems.length).toBeGreaterThan(0);
      expect(alert?.actionItems[0]).toContain('Verify');
    });

    it('generates action items for admin change', () => {
      const previous = makeContractState({
        admin: 'GAADMIN1',
      });
      const current = makeContractState({
        admin: 'GAADMIN2',
      });

      const alert = engine.assessContractState(previous, current);
      expect(alert?.actionItems).toBeDefined();
      expect(alert?.actionItems.length).toBeGreaterThan(0);
      expect(alert?.actionItems[0]).toContain('Verify');
    });

    it('includes rugpull warning in action items when admin is removed', () => {
      const previous = makeContractState({
        admin: 'GAADMIN1',
      });
      const current = makeContractState({
        admin: null,
      });

      const alert = engine.assessContractState(previous, current);
      expect(alert?.actionItems).toBeDefined();
      const hasRugpullWarning = alert?.actionItems.some(item =>
        item.toLowerCase().includes('rugpull') || item.toLowerCase().includes('abandonment')
      );
      expect(hasRugpullWarning).toBe(true);
    });

    it('respects custom wasmUpgradeIsCritical config', () => {
      const customEngine = new ContractUpgradeSentinelEngine({
        wasmUpgradeIsCritical: false,
      });

      const previous = makeContractState({
        wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      });
      const current = makeContractState({
        wasmHash: Buffer.from('b'.repeat(32), 'hex'),
      });

      const alert = customEngine.assessContractState(previous, current);
      expect(alert).not.toBeNull();
      expect(alert?.severity).toBe('WARNING');
    });

    it('respects custom adminRemovalIsCritical config', () => {
      const customEngine = new ContractUpgradeSentinelEngine({
        adminRemovalIsCritical: false,
      });

      const previous = makeContractState({
        admin: 'GAADMIN1',
      });
      const current = makeContractState({
        admin: null,
      });

      const alert = customEngine.assessContractState(previous, current);
      expect(alert).not.toBeNull();
      expect(alert?.severity).toBe('WARNING');
    });

    it('handles batch assessment of multiple contracts', () => {
      const states = [
        {
          previous: makeContractState({ wasmHash: Buffer.from('a'.repeat(32), 'hex') }),
          current: makeContractState({ wasmHash: Buffer.from('b'.repeat(32), 'hex') }),
        },
        {
          previous: makeContractState({ admin: 'GAADMIN1' }),
          current: makeContractState({ admin: 'GAADMIN2' }),
        },
        {
          previous: makeContractState(),
          current: makeContractState(),
        },
      ];

      const alerts = engine.assessContractStates(states);
      expect(alerts).toHaveLength(2);
      expect(alerts[0].eventType).toBe('wasm_upgrade');
      expect(alerts[1].eventType).toBe('admin_change');
    });
  });
});
