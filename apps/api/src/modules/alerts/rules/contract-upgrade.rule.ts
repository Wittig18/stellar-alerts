import {
  ContractUpgradeSentinelEngine,
  ContractState,
  ContractUpgradeAlert,
  type UpgradeSeverity,
} from '../../../services/contract-upgrade-sentinel';

export interface ContractUpgradeRuleConfig {
  /** Minimum severity to trigger an alert (INFO, WARNING, or CRITICAL). */
  minSeverity?: UpgradeSeverity;
  /** Whether to treat admin removal as CRITICAL. */
  adminRemovalIsCritical?: boolean;
  /** Whether to treat WASM upgrades as CRITICAL. */
  wasmUpgradeIsCritical?: boolean;
}

export interface AlertRuleLike {
  id: string;
  userId: string;
  walletId?: string | null;
  name?: string | null;
  isActive: boolean;
  conditions?: any;
}

export interface ContractUpgradeMatchResult {
  matched: boolean;
  ruleId?: string;
  deliveryPayload?: {
    event: 'soroban.contract_upgrade';
    ruleId: string;
    userId: string;
    contractId: string;
    eventType: 'wasm_upgrade' | 'admin_change';
    oldWasmHash: string;
    newWasmHash: string;
    oldAdmin: string;
    newAdmin: string;
    ledgerSeq: number;
    txHash?: string;
    severity: UpgradeSeverity;
    message: string;
    actionItems: string[];
    metadata: Record<string, any>;
  };
}

export class ContractUpgradeRuleEvaluator {
  private sentinel: ContractUpgradeSentinelEngine;

  constructor(config?: ContractUpgradeRuleConfig) {
    this.sentinel = new ContractUpgradeSentinelEngine(config);
  }

  /**
   * Evaluates a contract state change against an AlertRule.
   * If the state change (WASM upgrade or admin change) meets the severity threshold,
   * produces an alert delivery payload with actionable items.
   */
  public evaluate(
    previousState: ContractState | null,
    currentState: ContractState,
    rule: AlertRuleLike,
  ): ContractUpgradeMatchResult {
    if (!rule.isActive) {
      return { matched: false };
    }

    const ruleConfig = this.extractRuleConfig(rule);
    if (!ruleConfig) {
      return { matched: false };
    }

    // Create sentinel with rule-specific config
    const sentinel = new ContractUpgradeSentinelEngine(ruleConfig);

    // Assess the state change
    const alert = sentinel.assessContractState(previousState, currentState);
    if (!alert) {
      return { matched: false };
    }

    // Check minimum severity
    const minSeverity = ruleConfig.minSeverity ?? 'WARNING';
    if (!this.meetsSeverityThreshold(alert.severity, minSeverity)) {
      return { matched: false };
    }

    return {
      matched: true,
      ruleId: rule.id,
      deliveryPayload: {
        event: 'soroban.contract_upgrade',
        ruleId: rule.id,
        userId: rule.userId,
        contractId: alert.contractId,
        eventType: alert.eventType,
        oldWasmHash: alert.oldWasmHash,
        newWasmHash: alert.newWasmHash,
        oldAdmin: alert.oldAdmin,
        newAdmin: alert.newAdmin,
        ledgerSeq: alert.ledgerSeq,
        txHash: alert.txHash,
        severity: alert.severity,
        message: alert.message,
        actionItems: alert.actionItems,
        metadata: {
          contractId: alert.contractId,
          ledgerSeq: alert.ledgerSeq,
        },
      },
    };
  }

  /**
   * Checks if a severity meets or exceeds the minimum threshold.
   */
  private meetsSeverityThreshold(
    severity: UpgradeSeverity,
    minSeverity: UpgradeSeverity,
  ): boolean {
    const order: UpgradeSeverity[] = ['INFO', 'WARNING', 'CRITICAL'];
    return order.indexOf(severity) >= order.indexOf(minSeverity);
  }

  /**
   * Extracts contract upgrade rule config from the AlertRule conditions.
   */
  private extractRuleConfig(rule: AlertRuleLike): ContractUpgradeRuleConfig | null {
    if (!rule.conditions) return null;

    if (typeof rule.conditions === 'object') {
      const cond = rule.conditions as any;
      if (cond.contractUpgrade) {
        return cond.contractUpgrade as ContractUpgradeRuleConfig;
      }
      // Support direct config in conditions
      if (cond.minSeverity || cond.adminRemovalIsCritical || cond.wasmUpgradeIsCritical) {
        return cond as ContractUpgradeRuleConfig;
      }
    }

    return null;
  }
}

/**
 * Default singleton instance with standard thresholds.
 */
export const contractUpgradeRuleEvaluator = new ContractUpgradeRuleEvaluator();
