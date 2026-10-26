import React from 'react';
import type { DeliveryEventDTO } from '@stellar-alerts/shared';

interface DeliveryToastProps {
  delivery: DeliveryEventDTO | null;
}

/** Live webhook delivery toast (populated over the authenticated WebSocket). */
export const DeliveryToast: React.FC<DeliveryToastProps> = ({ delivery }) => {
  if (!delivery) return null;

  return (
    <div
      data-testid="delivery-toast"
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] max-w-sm px-4 py-3 rounded-xl bg-slate-900/90 border border-slate-700 backdrop-blur-xl shadow-2xl"
    >
      <p className="text-xs font-semibold text-white flex items-center gap-2">
        <span>📬</span> Webhook Delivery
      </p>
      <p className="text-xs text-slate-400 mt-1">
        {delivery.error ? `Failed: ${delivery.error}` : `Status ${delivery.statusCode ?? 'unknown'}`}
      </p>
    </div>
  );
};
