import {
  ContractUpgradeRuleEvaluator,
  type ContractUpgradeRuleConfig,
} from '../contract-upgrade.rule';
import {
  ContractUpgradeSentinelEngine,
  ContractState,
} from '../../../services/contract-upgrade-sentinel';

describe('ContractUpgradeRuleEvaluator (#649)', () => {
  const evaluator = new ContractUpgradeRuleEvaluator();

  function makeContractState(overrides: Partial<ContractState> = {}): ContractState {
    return {
      contractId: 'CCONTRACT1',
      wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      admin: 'GAADMIN1',
      ledgerSeq: 100000,
      ...overrides,
    };
  }

  function makeAlertRule(overrides: any = {}): any {
    return {
      id: 'rule1',
      userId: 'user1',
      isActive: true,
      conditions: {
        contractUpgrade: {
          minSeverity: 'WARNING',
          adminRemovalIsCritical: true,
          wasmUpgradeIsCritical: true,
        },
        ...overrides,
      },
    };
  }

  describe('evaluate', () => {
    it('matches WASM upgrade event with CRITICAL severity', () => {
      const previous = makeContractState({
        wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      });
      const current = makeContractState({
        wasmHash: Buffer.from('b'.repeat(32), 'hex'),
      });
      const rule = makeAlertRule();

      const result = evaluator.evaluate(previous, current, rule);
      expect(result.matched).toBe(true);
      expect(result.deliveryPayload?.event).toBe('soroban.contract_upgrade');
      expect(result.deliveryPayload?.eventType).toBe('wasm_upgrade');
      expect(result.deliveryPayload?.severity).toBe('CRITICAL');
    });

    it('matches admin change event with WARNING severity', () => {
      const previous = makeContractState({
        admin: 'GAADMIN1',
      });
      const current = makeContractState({
        admin: 'GAADMIN2',
      });
      const rule = makeAlertRule();

      const result = evaluator.evaluate(previous, current, rule);
      expect(result.matched).toBe(true);
      expect(result.deliveryPayload?.event).toBe('soroban.contract_upgrade');
      expect(result.deliveryPayload?.eventType).toBe('admin_change');
      expect(result.deliveryPayload?.severity).toBe('WARNING');
    });

    it('matches admin removal as CRITICAL', () => {
      const previous = makeContractState({
        admin: 'GAADMIN1',
      });
      const current = makeContractState({
        admin: null,
      });
      const rule = makeAlertRule();

      const result = evaluator.evaluate(previous, current, rule);
      expect(result.matched).toBe(true);
      expect(result.deliveryPayload?.severity).toBe('CRITICAL');
      expect(result.deliveryPayload?.newAdmin).toBe('none');
    });

    it('does not match when rule is inactive', () => {
      const previous = makeContractState({
        wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      });
      const current = makeContractState({
        wasmHash: Buffer.from('b'.repeat(32), 'hex'),
      });
      const rule = makeAlertRule({ isActive: false });

      const result = evaluator.evaluate(previous, current, rule);
      expect(result.matched).toBe(false);
    });

    it('does not match when no state change', () => {
      const previous = makeContractState();
      const current = makeContractState();
      const rule = makeAlertRule();

      const result = evaluator.evaluate(previous, current, rule);
      expect(result.matched).toBe(false);
    });

    it('respects minSeverity threshold', () => {
      const previous = makeContractState({
        admin: 'GAADMIN1',
      });
      const current = makeContractState({
        admin: 'GAADMIN2',
      });
      const rule = makeAlertRule({
        contractUpgrade: {
          minSeverity: 'CRITICAL',
        },
      });

      const result = evaluator.evaluate(previous, current, rule);
      expect(result.matched).toBe(false); // WARNING < CRITICAL
    });

    it('matches when severity meets minSeverity threshold', () => {
      const previous = makeContractState({
        wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      });
      const current = makeContractState({
        wasmHash: Buffer.from('b'.repeat(32), 'hex'),
      });
      const rule = makeAlertRule({
        contractUpgrade: {
          minSeverity: 'CRITICAL',
        },
      });

      const result = evaluator.evaluate(previous, current, rule);
      expect(result.matched).toBe(true); // CRITICAL >= CRITICAL
    });

    it('does not match when rule has no conditions', () => {
      const previous = makeContractState({
        wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      });
      const current = makeContractState({
        wasmHash: Buffer.from('b'.repeat(32), 'hex'),
      });
      const rule = makeAlertRule({ conditions: null });

      const result = evaluator.evaluate(previous, current, rule);
      expect(result.matched).toBe(false);
    });

    it('supports direct config in conditions (without contractUpgrade wrapper)', () => {
      const previous = makeContractState({
        wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      });
      const current = makeContractState({
        wasmHash: Buffer.from('b'.repeat(32), 'hex'),
      });
      const rule = makeAlertRule({
        conditions: {
          minSeverity: 'WARNING',
          wasmUpgradeIsCritical: false,
        },
      });

      const result = evaluator.evaluate(previous, current, rule);
      expect(result.matched).toBe(true);
      expect(result.deliveryPayload?.severity).toBe('WARNING');
    });

    it('includes action items in delivery payload', () => {
      const previous = makeContractState({
        wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      });
      const current = makeContractState({
        wasmHash: Buffer.from('b'.repeat(32), 'hex'),
      });
      const rule = makeAlertRule();

      const result = evaluator.evaluate(previous, current, rule);
      expect(result.deliveryPayload?.actionItems).toBeDefined();
      expect(result.deliveryPayload?.actionItems.length).toBeGreaterThan(0);
    });

    it('includes message in delivery payload', () => {
      const previous = makeContractState({
        wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      });
      const current = makeContractState({
        wasmHash: Buffer.from('b'.repeat(32), 'hex'),
      });
      const rule = makeAlertRule();

      const result = evaluator.evaluate(previous, current, rule);
      expect(result.deliveryPayload?.message).toBeDefined();
      expect(result.deliveryPayload?.message).toContain('WASM');
    });

    it('includes metadata in delivery payload', () => {
      const previous = makeContractState({
        wasmHash: Buffer.from('a'.repeat(32), 'hex'),
      });
      const current = makeContractState({
        wasmHash: Buffer.from('b'.repeat(32), 'hex'),
      });
      const rule = makeAlertRule();

      const result = evaluator.evaluate(previous, current, rule);
      expect(result.deliveryPayload?.metadata).toBeDefined();
      expect(result.deliveryPayload?.metadata.contractId).toBe('CCONTRACT1');
    });
  });

  describe('meetsSeverityThreshold', () => {
    it('returns true when severity equals minSeverity', () => {
      const result = evaluator['meetsSeverityThreshold']('WARNING', 'WARNING');
      expect(result).toBe(true);
    });

    it('returns true when severity exceeds minSeverity', () => {
      const result = evaluator['meetsSeverityThreshold']('CRITICAL', 'WARNING');
      expect(result).toBe(true);
    });

    it('returns false when severity is below minSeverity', () => {
      const result = evaluator['meetsSeverityThreshold']('INFO', 'WARNING');
      expect(result).toBe(false);
    });

    it('returns true when INFO meets INFO threshold', () => {
      const result = evaluator['meetsSeverityThreshold']('INFO', 'INFO');
      expect(result).toBe(true);
    });
  });

  describe('extractRuleConfig', () => {
    it('extracts config from contractUpgrade wrapper', () => {
      const rule = makeAlertRule({
        contractUpgrade: {
          minSeverity: 'CRITICAL',
          adminRemovalIsCritical: false,
        },
      });

      const config = evaluator['extractRuleConfig'](rule);
      expect(config).not.toBeNull();
      expect(config?.minSeverity).toBe('CRITICAL');
      expect(config?.adminRemovalIsCritical).toBe(false);
    });

    it('extracts config from direct conditions', () => {
      const rule = makeAlertRule({
        conditions: {
          minSeverity: 'WARNING',
          wasmUpgradeIsCritical: false,
        },
      });

      const config = evaluator['extractRuleConfig'](rule);
      expect(config).not.toBeNull();
      expect(config?.minSeverity).toBe('WARNING');
      expect(config?.wasmUpgradeIsCritical).toBe(false);
    });

    it('returns null when conditions is null', () => {
      const rule = makeAlertRule({ conditions: null });
      const config = evaluator['extractRuleConfig'](rule);
      expect(config).toBeNull();
    });

    it('returns null when conditions is empty object', () => {
      const rule = makeAlertRule({ conditions: {} });
      const config = evaluator['extractRuleConfig'](rule);
      expect(config).toBeNull();
    });
  });
});
