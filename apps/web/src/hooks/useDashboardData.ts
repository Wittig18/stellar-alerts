'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { PaymentDTO, WalletDTO } from '@stellar-alerts/shared';
import { useBatchReader } from '@/lib/hooks/useBatchReader';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export interface DashboardData {
  wallets: WalletDTO[];
  payments: PaymentDTO[];
  selectedWalletId: string | null;
  setSelectedWalletId: (id: string | null) => void;
  isLoadingPayments: boolean;
  /**
   * Until the first portfolio fetch lands, "no wallets" is unknown, not empty.
   * Without this the onboarding card would flash for users who already have one.
   */
  hasLoadedPortfolio: boolean;
  totalPaymentsCount: number;
  totalVolumeXLM: number;
  /** Merges a payment pushed over the live stream into the current view. */
  applyLivePayment: (payment: PaymentDTO) => void;
  /** Drops cached reads and refetches the portfolio after a mutation. */
  refreshAfterMutation: () => void;
  removeWallet: (id: string) => Promise<void>;
}

/** Owns the dashboard's portfolio state: fetching, selection and mutations. */
export function useDashboardData(): DashboardData {
  const { data: session } = useSession();
  const batchReader = useBatchReader();

  const [wallets, setWallets] = useState<WalletDTO[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentDTO[]>([]);
  const [isLoadingPayments, setIsLoadingPayments] = useState<boolean>(false);
  const [hasLoadedPortfolio, setHasLoadedPortfolio] = useState<boolean>(false);
  const [totalVolumeXLM, setTotalVolumeXLM] = useState<number>(0);
  const [totalPaymentsCount, setTotalPaymentsCount] = useState<number>(0);

  const fetchDashboardData = useCallback(async () => {
    if (!session) return;
    setIsLoadingPayments(true);
    try {
      const data = await batchReader.fetchUserPortfolioBatched(selectedWalletId || undefined);
      setWallets(data.wallets);
      setPayments(data.payments);
      setTotalVolumeXLM(Number(data.summary.totalVolumeXLM || 0));
      setTotalPaymentsCount(Number(data.summary.totalPayments || 0));
      setHasLoadedPortfolio(true);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setIsLoadingPayments(false);
    }
  }, [session, selectedWalletId, batchReader]);

  useEffect(() => {
    if (session) void fetchDashboardData();
  }, [session, selectedWalletId, fetchDashboardData]);

  const refreshAfterMutation = useCallback(() => {
    batchReader.invalidateAll();
    void fetchDashboardData();
  }, [batchReader, fetchDashboardData]);

  const applyLivePayment = useCallback((payment: PaymentDTO) => {
    setPayments((prev) => {
      if (prev.some((p) => p.id === payment.id)) return prev;
      return [payment, ...prev];
    });
    setTotalPaymentsCount((prev) => prev + 1);
    setTotalVolumeXLM((prev) => prev + Number(payment.amount || 0));
  }, []);

  const removeWallet = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`${API_BASE_URL}/wallets/${id}`, {
          method: 'DELETE',
          headers: {
            Authorization: session?.accessToken ? `Bearer ${session.accessToken}` : '',
          },
        });
        if (res.ok) {
          if (selectedWalletId === id) setSelectedWalletId(null);
          refreshAfterMutation();
        }
      } catch (err) {
        console.error('Failed to remove wallet:', err);
      }
    },
    [session, selectedWalletId, refreshAfterMutation],
  );

  return {
    wallets,
    payments,
    selectedWalletId,
    setSelectedWalletId,
    isLoadingPayments,
    hasLoadedPortfolio,
    // Fall back to the loaded rows until the server summary is available.
    totalPaymentsCount: totalPaymentsCount || payments.length,
    totalVolumeXLM: totalVolumeXLM || payments.reduce((acc, p) => acc + Number(p.amount || 0), 0),
    applyLivePayment,
    refreshAfterMutation,
    removeWallet,
  };
}
