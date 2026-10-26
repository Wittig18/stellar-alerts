import React, { useState, useEffect, useCallback } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
const PREFERENCES_URL = `${API_BASE_URL}/users/me/preferences`;

// Numeric chat/group ids (groups are negative) or an @channelusername.
const TELEGRAM_CHAT_ID_PATTERN = /^(-?\d+|@[A-Za-z0-9_]{5,})$/;

export interface NotificationPreferencesInput {
  telegramChatId?: string;
  telegramEnabled: boolean;
  emailEnabled: boolean;
  mfaToken?: string;
}

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Session bearer token. Without it the modal cannot load or save preferences. */
  accessToken?: string;
  /** Called after the preferences were persisted by the API. */
  onSavePreferences?: (prefs: NotificationPreferencesInput) => void;
}

interface ApiErrorBody {
  error?: { message?: string } | string;
  message?: string;
}

function errorMessageFrom(body: ApiErrorBody | null, fallback: string): string {
  if (!body) return fallback;
  if (typeof body.error === 'string') return body.error;
  return body.error?.message || body.message || fallback;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  accessToken,
  onSavePreferences,
}) => {
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  }, [accessToken]);

  // Load the stored preferences and MFA status each time the modal opens.
  useEffect(() => {
    if (!isOpen || !accessToken) return;
    let mounted = true;

    setErrorMessage(null);
    setMfaToken('');
    setIsLoading(true);

    async function load() {
      try {
        const [prefsRes, mfaRes] = await Promise.all([
          fetch(PREFERENCES_URL, { headers: authHeaders() }),
          fetch(`${API_BASE_URL}/auth/mfa/status`, { headers: authHeaders() }),
        ]);
        if (!mounted) return;

        if (prefsRes.ok) {
          const data = await prefsRes.json();
          const prefs = data.preferences ?? {};
          setTelegramChatId(prefs.telegramChatId ?? '');
          setTelegramEnabled(Boolean(prefs.telegramEnabled && prefs.telegramChatId));
          setEmailEnabled(prefs.emailEnabled ?? true);
        } else {
          setErrorMessage('Could not load your current notification preferences.');
        }

        if (mfaRes.ok) {
          const data = await mfaRes.json();
          if (data.success) setMfaRequired(Boolean(data.mfaEnabled));
        }
      } catch {
        if (mounted) setErrorMessage('Could not reach the server to load your preferences.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [isOpen, accessToken, authHeaders]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const chatId = telegramChatId.trim();
    if (chatId && !TELEGRAM_CHAT_ID_PATTERN.test(chatId)) {
      setErrorMessage('Telegram Chat ID must be a number (e.g. 123456789) or an @channel name.');
      return;
    }
    if (telegramEnabled && !chatId) {
      setErrorMessage('Enter a Telegram Chat ID to enable Telegram alerts.');
      return;
    }
    if (mfaRequired && mfaToken.length !== 6) {
      setErrorMessage('Please enter your 6-digit MFA code');
      return;
    }
    if (!accessToken) {
      setErrorMessage('You must be signed in to save preferences.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(PREFERENCES_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          // An empty id clears the stored value rather than leaving it untouched.
          telegramChatId: chatId || null,
          telegramEnabled: telegramEnabled && Boolean(chatId),
          emailEnabled,
          ...(mfaRequired ? { mfaToken } : {}),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        setErrorMessage(errorMessageFrom(body, 'Failed to save preferences. Please try again.'));
        return;
      }

      setMfaToken('');
      onSavePreferences?.({
        telegramChatId: chatId || undefined,
        telegramEnabled: telegramEnabled && Boolean(chatId),
        emailEnabled,
      });
      onClose();
    } catch {
      setErrorMessage('Could not reach the server. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-modal-title"
    >
      <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 id="notification-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
            <span>🔔</span> Alert Channels &amp; Preferences
          </h3>
          <button
            onClick={onClose}
            aria-label="Close preferences modal"
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" aria-busy={isLoading || isSaving}>
          <div>
            <label
              htmlFor="notification-telegram-chat-id"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1"
            >
              Telegram Chat ID
            </label>
            <input
              id="notification-telegram-chat-id"
              type="text"
              placeholder="e.g. 123456789"
              value={telegramChatId}
              disabled={isLoading}
              onChange={(e) => setTelegramChatId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 text-sm font-mono disabled:opacity-50"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Start a chat with our bot to get your Telegram Chat ID.
            </p>
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div>
              <label htmlFor="notification-telegram-enabled" className="text-sm font-medium text-white">
                Telegram Alerts
              </label>
              <div className="text-xs text-slate-400">Receive payment alerts in Telegram</div>
            </div>
            <input
              id="notification-telegram-enabled"
              type="checkbox"
              checked={telegramEnabled}
              disabled={isLoading}
              onChange={(e) => setTelegramEnabled(e.target.checked)}
              className="w-4 h-4 rounded accent-purple-600 bg-slate-900 border-slate-700"
            />
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div>
              <label htmlFor="notification-email-enabled" className="text-sm font-medium text-white">
                Email Receipts
              </label>
              <div className="text-xs text-slate-400">Receive payment alerts via email</div>
            </div>
            <input
              id="notification-email-enabled"
              type="checkbox"
              checked={emailEnabled}
              disabled={isLoading}
              onChange={(e) => setEmailEnabled(e.target.checked)}
              className="w-4 h-4 rounded accent-purple-600 bg-slate-900 border-slate-700"
            />
          </div>

          {/* MFA Token Input (conditionally shown) */}
          {mfaRequired && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3">
              <div className="flex items-center gap-2 text-amber-300 text-sm font-semibold">
                <span>🔐</span> MFA Required
              </div>
              <p className="text-xs text-amber-200/80">
                Multi-factor authentication is enabled. Please enter your 6-digit code to update preferences.
              </p>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="6-digit MFA code"
                value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-amber-500/30 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 text-center text-xl font-mono tracking-widest"
              />
            </div>
          )}

          {errorMessage && (
            <div role="alert" className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
              {errorMessage}
            </div>
          )}

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || isSaving}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-all duration-200 shadow-md shadow-purple-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving…' : 'Save Preferences'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
