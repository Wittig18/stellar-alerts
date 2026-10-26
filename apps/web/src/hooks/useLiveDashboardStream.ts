'use client';

import { useEffect, useRef, useState } from 'react';
import type { DeliveryEventDTO, PaymentDTO } from '@stellar-alerts/shared';
import { getSocket } from '@/lib/socket';

const DELIVERY_TOAST_MS = 6000;

export interface LiveDashboardStream {
  isStreamConnected: boolean;
  latestDelivery: DeliveryEventDTO | null;
}

/**
 * Live payment stream: relays persisted payment events for the signed-in
 * user's own wallets over the authenticated WebSocket (server enforces
 * tenant isolation — see apps/api/src/plugins/websocket.ts).
 */
export function useLiveDashboardStream(
  accessToken: string | undefined,
  selectedWalletId: string | null,
  onPayment: (payment: PaymentDTO) => void,
): LiveDashboardStream {
  const [isStreamConnected, setIsStreamConnected] = useState<boolean>(false);
  const [latestDelivery, setLatestDelivery] = useState<DeliveryEventDTO | null>(null);

  // Kept in refs (not dependencies) so the handler always reads the current
  // filter/callback without tearing down and reconnecting the socket every
  // time the user switches the selected wallet.
  const selectedWalletIdRef = useRef(selectedWalletId);
  const onPaymentRef = useRef(onPayment);
  useEffect(() => {
    selectedWalletIdRef.current = selectedWalletId;
    onPaymentRef.current = onPayment;
  }, [selectedWalletId, onPayment]);

  useEffect(() => {
    if (!accessToken) return;

    const socket = getSocket();
    socket.connect(accessToken);

    const unsubscribeConnection = socket.on('connection', (msg) => {
      setIsStreamConnected(msg.payload?.status === 'connected');
    });

    const unsubscribePayment = socket.onPayment((payment) => {
      const currentWalletId = selectedWalletIdRef.current;
      if (currentWalletId && payment.walletId !== currentWalletId) return;
      onPaymentRef.current(payment);
    });

    const unsubscribeDelivery = socket.onDelivery((delivery) => {
      setLatestDelivery(delivery);
    });

    return () => {
      unsubscribeConnection();
      unsubscribePayment();
      unsubscribeDelivery();
      socket.disconnect();
      setIsStreamConnected(false);
    };
  }, [accessToken]);

  // Auto-dismiss the live delivery toast after a few seconds.
  useEffect(() => {
    if (!latestDelivery) return;
    const timer = setTimeout(() => setLatestDelivery(null), DELIVERY_TOAST_MS);
    return () => clearTimeout(timer);
  }, [latestDelivery]);

  return { isStreamConnected, latestDelivery };
}
