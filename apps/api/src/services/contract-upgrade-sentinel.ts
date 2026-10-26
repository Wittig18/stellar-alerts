/**
 * Contract Upgrade & Admin State Modification Sentinel (#649)
 *
 * Soroban smart contracts can be upgradeable, and a sudden contract bytecode
 * upgrade or admin key transfer could signal a rugpull or compromised admin key.
 * This sentinel monitors contract code hash updates and admin state changes,
 * dispatching immediate emergency alerts with old vs. new details.
 *
 * This engine is pure logic: given contract state (WASM hash and admin address),
 * it detects changes and produces actionable alerts.
 */

export type UpgradeSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface ContractState {
  contractId: string;
  wasmHash: Buffer | null;
  admin: string | null;
  ledgerSeq: number;
}

export interface ContractUpgradeAlert {
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
}

export interface ContractUpgradeSentinelOptions {
  /**
   * Whether to treat admin removal (setting to none) as CRITICAL.
   * Defaults to true.
   */
  adminRemovalIsCritical?: boolean;
  /**
   * Whether to treat any WASM upgrade as CRITICAL.
   * Defaults to true.
   */
  wasmUpgradeIsCritical?: boolean;
}

export class ContractUpgradeSentinelEngine {
  private readonly adminRemovalIsCritical: boolean;
  private readonly wasmUpgradeIsCritical: boolean;

  constructor(options: ContractUpgradeSentinelOptions = {}) {
    this.adminRemovalIsCritical = options.adminRemovalIsCritical ?? true;
    this.wasmUpgradeIsCritical = options.wasmUpgradeIsCritical ?? true;
  }

  /**
   * Compares current and previous contract state to detect upgrades or admin changes.
   * Returns an alert if any significant change is detected, null otherwise.
   */
  public assessContractState(
    previousState: ContractState | null,
    currentState: ContractState,
  ): ContractUpgradeAlert | null {
    const contractId = currentState.contractId;
    const ledgerSeq = currentState.ledgerSeq;

    // Check for WASM upgrade
    const wasmUpgrade = this.detectWasmUpgrade(previousState, currentState);
    if (wasmUpgrade) {
      const severity = this.wasmUpgradeIsCritical ? 'CRITICAL' : 'WARNING';
      return {
        contractId,
        eventType: 'wasm_upgrade',
        oldWasmHash: wasmUpgrade.oldWasmHash,
        newWasmHash: wasmUpgrade.newWasmHash,
        oldAdmin: previousState?.admin || 'none',
        newAdmin: currentState.admin || 'none',
        ledgerSeq,
        txHash: wasmUpgrade.txHash,
        severity,
        message: this.buildWasmUpgradeMessage(wasmUpgrade, severity),
        actionItems: this.buildWasmUpgradeActionItems(wasmUpgrade),
      };
    }

    // Check for admin change
    const adminChange = this.detectAdminChange(previousState, currentState);
    if (adminChange) {
      const severity = this.assessAdminChangeSeverity(adminChange);
      return {
        contractId,
        eventType: 'admin_change',
        oldWasmHash: previousState?.wasmHash?.toString('hex') || 'none',
        newWasmHash: currentState.wasmHash?.toString('hex') || 'none',
        oldAdmin: adminChange.oldAdmin,
        newAdmin: adminChange.newAdmin,
        ledgerSeq,
        txHash: adminChange.txHash,
        severity,
        message: this.buildAdminChangeMessage(adminChange, severity),
        actionItems: this.buildAdminChangeActionItems(adminChange),
      };
    }

    return null;
  }

  /**
   * Detects a WASM bytecode upgrade by comparing hashes.
   */
  private detectWasmUpgrade(
    previousState: ContractState | null,
    currentState: ContractState,
  ): { oldWasmHash: string; newWasmHash: string; txHash?: string } | null {
    const oldHash = previousState?.wasmHash;
    const newHash = currentState.wasmHash;

    if (!oldHash || !newHash) return null;
    if (oldHash.equals(newHash)) return null;

    return {
      oldWasmHash: oldHash.toString('hex'),
      newWasmHash: newHash.toString('hex'),
      txHash: undefined, // Would be populated from transaction metadata
    };
  }

  /**
   * Detects an admin address change.
   */
  private detectAdminChange(
    previousState: ContractState | null,
    currentState: ContractState,
  ): { oldAdmin: string; newAdmin: string; txHash?: string } | null {
    const oldAdmin = previousState?.admin || 'none';
    const newAdmin = currentState.admin || 'none';

    if (oldAdmin === newAdmin) return null;

    return {
      oldAdmin,
      newAdmin,
      txHash: undefined, // Would be populated from transaction metadata
    };
  }

  /**
   * Assesses the severity of an admin change.
   */
  private assessAdminChangeSeverity(
    adminChange: { oldAdmin: string; newAdmin: string },
  ): UpgradeSeverity {
    // Admin removal is typically critical (could signal rugpull preparation)
    if (this.adminRemovalIsCritical && adminChange.newAdmin === 'none') {
      return 'CRITICAL';
    }

    // Setting a new admin is at least a warning
    return 'WARNING';
  }

  /**
   * Builds a human-readable message for a WASM upgrade.
   */
  private buildWasmUpgradeMessage(
    upgrade: { oldWasmHash: string; newWasmHash: string },
    severity: UpgradeSeverity,
  ): string {
    const oldShort = upgrade.oldWasmHash.slice(0, 8);
    const newShort = upgrade.newWasmHash.slice(0, 8);

    return (
      `${severity}: Contract WASM bytecode upgraded from ${oldShort}... to ${newShort}.... ` +
      `This indicates the contract's executable logic has been modified. Verify this change ` +
      `was authorized by the legitimate project team before interacting with this contract.`
    );
  }

  /**
   * Builds actionable items for a WASM upgrade.
   */
  private buildWasmUpgradeActionItems(
    upgrade: { oldWasmHash: string; newWasmHash: string },
  ): string[] {
    return [
      `Verify the upgrade was announced by the project team via official channels`,
      `Check the new WASM hash against the project's published upgrade notes`,
      `Review the new code if source is available on the project's repository`,
      `Pause any automated interactions with this contract until the upgrade is verified`,
      `Monitor for follow-up transactions that could indicate malicious activity`,
    ];
  }

  /**
   * Builds a human-readable message for an admin change.
   */
  private buildAdminChangeMessage(
    adminChange: { oldAdmin: string; newAdmin: string },
    severity: UpgradeSeverity,
  ): string {
    const oldShort = adminChange.oldAdmin === 'none' ? 'none' : adminChange.oldAdmin.slice(0, 8);
    const newShort = adminChange.newAdmin === 'none' ? 'none' : adminChange.newAdmin.slice(0, 8);

    return (
      `${severity}: Contract admin changed from ${oldShort}... to ${newShort}.... ` +
      `This changes who has authority to upgrade the contract or modify critical state. ` +
      `Verify this transfer was intentional and authorized by the legitimate project team.`
    );
  }

  /**
   * Builds actionable items for an admin change.
   */
  private buildAdminChangeActionItems(
    adminChange: { oldAdmin: string; newAdmin: string },
  ): string[] {
    const actions: string[] = [
      `Verify the admin change was announced by the project team via official channels`,
      `Check if the new admin address is a known project multisig or team wallet`,
    ];

    if (adminChange.newAdmin === 'none') {
      actions.push(
        `Admin removal may indicate the contract is being locked or prepared for abandonment`,
        `Exercise extreme caution: this could be a rugpull preparation signal`,
      );
    } else {
      actions.push(
        `Review the new admin's on-chain history for any suspicious activity`,
        `Monitor for subsequent contract upgrades that could be malicious`,
      );
    }

    return actions;
  }

  /**
   * Batch assesses multiple contract state updates and returns only those that trigger alerts.
   */
  public assessContractStates(
    states: { previous: ContractState | null; current: ContractState }[],
  ): ContractUpgradeAlert[] {
    const alerts: ContractUpgradeAlert[] = [];

    for (const { previous, current } of states) {
      const alert = this.assessContractState(previous, current);
      if (alert) {
        alerts.push(alert);
      }
    }

    return alerts;
  }
}

/**
 * Default singleton instance with standard thresholds.
 */
export const contractUpgradeSentinel = new ContractUpgradeSentinelEngine();
