import { prisma } from '../../lib/prisma';
import {
  getContractWasmHash,
  getContractAdmin,
  getSorobanLatestLedger,
} from '../../lib/soroban';
import {
  ContractUpgradeSentinelEngine,
  ContractState,
  ContractUpgradeAlert,
} from '../../services/contract-upgrade-sentinel';
import { registerSupervisorHeartbeat } from '../supervisor';

// #649: Smart Contract Upgrade & Admin State Modification Alert Sentinel
// Detects Soroban contract WASM bytecode upgrades and administrator ownership
// transfers, dispatching immediate emergency alerts with old vs. new details.

const POLL_INTERVAL_MS = 30_000;
const DEFAULT_LOOKBACK_LEDGERS = 100;

let isProcessing = false;

export const contractUpgradeSentinelEngine = new ContractUpgradeSentinelEngine();

export type ContractUpgradeNotifier = (alert: ContractUpgradeAlert) => Promise<void> | void;

export const defaultContractUpgradeNotifier: ContractUpgradeNotifier = (alert) => {
  const tag = alert.severity === 'CRITICAL' ? '🚨' : alert.severity === 'WARNING' ? '⚠️' : 'ℹ️';
  console.log(
    `[ContractUpgradeSentinel] ${tag} ${alert.contractId.slice(0, 8)}... [${alert.eventType}] ` +
    `[${alert.severity}] ${alert.message}`,
  );
};

/**
 * Gets the list of contract IDs to monitor for upgrades and admin changes.
 * First checks environment variable, then falls back to active subscriptions.
 */
export function getContractUpgradeWatchedContractIds(): string[] {
  const fromEnv = (process.env.CONTRACT_UPGRADE_SENTINEL_CONTRACT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (fromEnv.length > 0) {
    return Array.from(new Set(fromEnv));
  }

  return [];
}

/**
 * Fetches the current state (WASM hash and admin) for a contract.
 */
export async function fetchContractState(
  contractId: string,
): Promise<{ wasmHash: Buffer | null; admin: string | null }> {
  const [wasmHash, admin] = await Promise.all([
    getContractWasmHash(contractId),
    getContractAdmin(contractId),
  ]);

  return { wasmHash, admin };
}

/**
 * Processes a single contract for upgrade and admin changes.
 * Fetches current state, compares with last snapshot, and notifies on changes.
 */
export async function processContractUpgrade(
  contractId: string,
  latestLedger: number,
  notify: ContractUpgradeNotifier = defaultContractUpgradeNotifier,
) {
  // Fetch last snapshot
  const lastSnapshot = await prisma.sorobanEventSnapshot.findFirst({
    where: {
      contractId,
      eventType: 'contract_upgrade',
    },
    orderBy: { ledgerSeq: 'desc' },
    select: { ledgerSeq: true, amount: true }, // amount stores serialized state
  });

  const currentState = await fetchContractState(contractId);

  let previousState: ContractState | null = null;
  if (lastSnapshot) {
    try {
      const parsed = JSON.parse(lastSnapshot.amount);
      previousState = {
        contractId,
        wasmHash: parsed.wasmHash ? Buffer.from(parsed.wasmHash, 'hex') : null,
        admin: parsed.admin || null,
        ledgerSeq: lastSnapshot.ledgerSeq,
      };
    } catch (error: any) {
      console.error(
        `[ContractUpgradeSentinel] Failed to parse previous state for ${contractId}:`,
        error?.message || error,
      );
    }
  }

  const currentContractState: ContractState = {
    contractId,
    wasmHash: currentState.wasmHash,
    admin: currentState.admin,
    ledgerSeq: latestLedger,
  };

  // Assess for changes
  const alert = contractUpgradeSentinelEngine.assessContractState(
    previousState,
    currentContractState,
  );

  if (alert) {
    try {
      // Snapshot the new state to avoid duplicate notifications
      await prisma.sorobanEventSnapshot.create({
        data: {
          contractId: alert.contractId,
          from: alert.oldAdmin,
          to: alert.newAdmin,
          amount: JSON.stringify({
            wasmHash: currentState.wasmHash?.toString('hex') || null,
            admin: currentState.admin || null,
          }),
          ledgerSeq: alert.ledgerSeq,
          eventType: 'contract_upgrade',
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        // Duplicate - already processed, skip notification
        return;
      }
      console.error(
        `[ContractUpgradeSentinel] Failed to persist contract upgrade snapshot for ${contractId}:`,
        error?.message || error,
      );
      return;
    }

    await notify(alert);
  } else if (!previousState && currentState.wasmHash) {
    // First time seeing this contract - snapshot initial state
    try {
      await prisma.sorobanEventSnapshot.create({
        data: {
          contractId,
          from: currentState.admin || 'none',
          to: currentState.admin || 'none',
          amount: JSON.stringify({
            wasmHash: currentState.wasmHash?.toString('hex') || null,
            admin: currentState.admin || null,
          }),
          ledgerSeq: latestLedger,
          eventType: 'contract_upgrade',
        },
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') {
        console.error(
          `[ContractUpgradeSentinel] Failed to persist initial state snapshot for ${contractId}:`,
          error?.message || error,
        );
      }
    }
  }
}

/**
 * Runs a single pass over all watched contracts for upgrade and admin changes.
 */
export async function runContractUpgradeSentinelPass(
  notify: ContractUpgradeNotifier = defaultContractUpgradeNotifier,
) {
  let contractIds = getContractUpgradeWatchedContractIds();

  // Fall back to active Soroban contract subscriptions if no env override
  if (contractIds.length === 0) {
    const subscriptions = await prisma.sorobanContractSubscription.findMany({
      where: { isActive: true },
      select: { contractId: true },
    });
    for (const subscription of subscriptions) {
      if (!contractIds.includes(subscription.contractId)) {
        contractIds.push(subscription.contractId);
      }
    }
  }

  if (contractIds.length === 0) return;

  const latestLedger = await getSorobanLatestLedger();
  if (latestLedger === 0) {
    console.warn('[ContractUpgradeSentinel] Could not fetch latest Soroban ledger this pass, skipping');
    return;
  }

  for (const contractId of contractIds) {
    try {
      await processContractUpgrade(contractId, latestLedger, notify);
    } catch (error: any) {
      console.error(
        `[ContractUpgradeSentinel] Failed to process contract ${contractId}:`,
        error?.message || error,
      );
    }
  }
}

/**
 * Main entry point for the Contract Upgrade Sentinel watcher worker.
 * Polls watched contracts at regular intervals for upgrade and admin changes.
 */
export async function runContractUpgradeSentinel() {
  console.log('[ContractUpgradeSentinel] 🚀 Starting Smart Contract Upgrade & Admin State Modification Sentinel...');

  const poll = async () => {
    if (isProcessing) return;
    isProcessing = true;

    try {
      await runContractUpgradeSentinelPass();
    } catch (error: any) {
      console.error('[ContractUpgradeSentinel] Polling error:', error?.message || error);
    } finally {
      isProcessing = false;
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

if (require.main === module) {
  registerSupervisorHeartbeat();
  runContractUpgradeSentinel();
}
