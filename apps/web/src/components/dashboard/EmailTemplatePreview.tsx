'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EmailTemplateDTO } from '@stellar-alerts/shared';

/**
 * Email template variables a merchant can customize before their receipt
 * emails are generated. The branding fields are persisted to the user
 * preference schema; the sample transaction values only drive the live
 * preview and are never saved.
 */
export interface EmailTemplateConfig extends EmailTemplateDTO {
  /** Sample transaction values rendered in the live preview. */
  amount: string;
  asset: string;
  fromAddress: string;
  txHash: string;
}

export const DEFAULT_EMAIL_TEMPLATE: EmailTemplateConfig = {
  brandName: 'StellarAlerts',
  logoUrl: '',
  primaryColor: '#0ea5e9',
  accentColor: '#7c3aed',
  footerText: 'You received this receipt because you monitor incoming Stellar payments with StellarAlerts.',
  amount: '250.0000000',
  asset: 'USDC',
  fromAddress: 'GCKF65D4G57T7754Y62F76J5W7P3R2A1B0C9D8E7F6G5H4I3J2K1L0M',
  txHash: 'a8f3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3',
};

/**
 * Safely coerces a hex color into a 6-digit normalized `#rrggbb` value.
 * Falls back to `#0ea5e9` (the default brand-cyan) when input is invalid.
 */
export function normalizeHexColor(color: string, fallback = '#0ea5e9'): string {
  const raw = color.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(raw)) {
    return fallback;
  }
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  return `#${expanded.toLowerCase()}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds the full HTML email document (inline-styled for email clients) from
 * the merchant's custom template variables. This is what the dashboard preview
 * renders live as the user edits their brand logo and colors.
 */
export function buildEmailTemplateHtml(config: EmailTemplateConfig): string {
  const brandName = escapeHtml(config.brandName.trim() || 'StellarAlerts');
  const primary = normalizeHexColor(config.primaryColor);
  const accent = normalizeHexColor(config.accentColor, primary);
  const logoUrl = config.logoUrl.trim();
  const footerText = escapeHtml(config.footerText.trim());
  const amount = escapeHtml(config.amount.trim());
  const asset = escapeHtml(config.asset.trim());
  const fromAddress = escapeHtml(config.fromAddress.trim());
  const txHash = escapeHtml(config.txHash.trim());

  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${brandName}" width="140" style="max-height:64px;border:0;display:inline-block;" />`
    : `<div style="width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,${primary},${accent});color:#ffffff;font-size:22px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;">${brandName
        .charAt(0)
        .toUpperCase()}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Payment Receipt — ${brandName}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
            <!-- Header -->
            <tr>
              <td style="background:linear-gradient(135deg,${primary},${accent});padding:28px 32px;text-align:center;">
                <div style="margin-bottom:8px;">${logoBlock}</div>
                <div style="color:#ffffff;font-size:13px;font-weight:600;letter-spacing:0.5px;opacity:0.95;">PAYMENT RECEIPT</div>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:32px;">
                <div style="font-size:18px;color:#0f172a;font-weight:700;margin-bottom:20px;">Hello ${brandName}!</div>
                <div style="color:#475569;font-size:14px;line-height:1.6;margin-bottom:24px;">
                  You received a new payment on the Stellar network.
                </div>

                <!-- Amount card -->
                <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td style="padding:6px 0;">
                        <div style="color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Amount Received</div>
                        <div style="color:${primary};font-size:32px;font-weight:800;line-height:1.2;">${amount} <span style="color:#0f172a;font-weight:700;">${asset}</span></div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;">
                        <div style="color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">From</div>
                        <div style="color:#334155;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;">${fromAddress}</div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;">
                        <div style="color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Transaction</div>
                        <div style="color:#334155;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;">${txHash}</div>
                      </td>
                    </tr>
                  </table>
                </div>

                <!-- CTA -->
                <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                  <tr>
                    <td align="center" style="border-radius:10px;">
                      <a href="#" style="display:inline-block;padding:12px 28px;background-color:${primary};color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;">View Transaction</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
                <div style="color:${accent};font-size:12px;font-weight:700;margin-bottom:6px;">${brandName}</div>
                <div style="color:#94a3b8;font-size:11px;line-height:1.5;">${footerText}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

interface EmailTemplatePreviewProps {
  /** Persist the finalized template variables to the user preference schema. */
  onSaveTemplate?: (template: EmailTemplateConfig) => void | Promise<void>;
  /** Optional initial template to hydrate the editor with (e.g. saved prefs). */
  initialTemplate?: Partial<EmailTemplateConfig>;
}

const FIELD_LABEL_CLASS =
  'block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5';
const FIELD_INPUT_CLASS =
  'w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/70 text-sm transition-colors';

type PreviewDevice = 'desktop' | 'mobile';

export const EmailTemplatePreview: React.FC<EmailTemplatePreviewProps> = ({
  onSaveTemplate,
  initialTemplate,
}) => {
  const [template, setTemplate] = useState<EmailTemplateConfig>({
    ...DEFAULT_EMAIL_TEMPLATE,
    ...initialTemplate,
  });
  const [showSource, setShowSource] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop');
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(
    null,
  );
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const previewHtml = useMemo(() => buildEmailTemplateHtml(template), [template]);

  // Hydrate from saved preferences without clobbering in-progress edits: the
  // key only changes when the parent supplies a different saved template.
  const initialTemplateKey = useMemo(
    () => (initialTemplate ? JSON.stringify(initialTemplate) : ''),
    [initialTemplate],
  );

  useEffect(() => {
    if (!initialTemplateKey) return;
    const parsed = JSON.parse(initialTemplateKey) as Partial<EmailTemplateConfig>;
    setTemplate((prev) => ({ ...prev, ...parsed }));
  }, [initialTemplateKey]);

  // Auto-dismiss the success confirmation but keep errors on screen.
  useEffect(() => {
    if (status?.kind !== 'success') return;
    const timer = window.setTimeout(() => setStatus(null), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);

  // Modal behaviour: Escape closes it, background scroll is locked, and focus
  // moves to the close control when it opens.
  useEffect(() => {
    if (!isPreviewOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPreviewOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isPreviewOpen]);

  const updateField = <K extends keyof EmailTemplateConfig>(field: K, value: EmailTemplateConfig[K]) => {
    setTemplate((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus(null);

    if (!onSaveTemplate) {
      setStatus({ kind: 'success', message: 'HTML generated' });
      return;
    }

    setIsSaving(true);
    try {
      await onSaveTemplate(template);
      setStatus({ kind: 'success', message: '✓ Saved' });
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Could not save your email template. Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyHtml = async () => {
    try {
      await navigator.clipboard.writeText(previewHtml);
    } catch {
      // Clipboard API can be unavailable in non-secure contexts; ignore.
    }
  };

  return (
    <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl mb-8">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span role="img" aria-label="email">
              ✉️
            </span>{' '}
            Email Receipt Template
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Customize your branded receipt logo &amp; color scheme. The HTML preview updates live.
          </p>
        </div>
        <div className="rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-200 px-3 py-1 text-xs font-semibold">
          Branding Preview
        </div>
      </div>

      <form onSubmit={handleSave}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Customization Controls */}
          <div className="space-y-4">
            <div>
              <label htmlFor="email-template-brand" className={FIELD_LABEL_CLASS}>
                Brand Name
              </label>
              <input
                id="email-template-brand"
                type="text"
                value={template.brandName}
                onChange={(e) => updateField('brandName', e.target.value)}
                placeholder="StellarAlerts"
                maxLength={80}
                className={FIELD_INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="email-template-logo" className={FIELD_LABEL_CLASS}>
                Brand Logo URL
              </label>
              <input
                id="email-template-logo"
                type="url"
                value={template.logoUrl}
                onChange={(e) => updateField('logoUrl', e.target.value)}
                placeholder="https://example.com/logo.png"
                className={FIELD_INPUT_CLASS}
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Leave empty to use an auto-generated monogram with your brand colors.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="email-template-primary" className={FIELD_LABEL_CLASS}>
                  Primary Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="email-template-primary"
                    type="color"
                    value={normalizeHexColor(template.primaryColor)}
                    onChange={(e) => updateField('primaryColor', e.target.value)}
                    className="h-11 w-12 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer"
                  />
                  <code className="text-xs font-mono text-slate-300">
                    {normalizeHexColor(template.primaryColor)}
                  </code>
                </div>
              </div>
              <div>
                <label htmlFor="email-template-accent" className={FIELD_LABEL_CLASS}>
                  Accent Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="email-template-accent"
                    type="color"
                    value={normalizeHexColor(template.accentColor, normalizeHexColor(template.primaryColor))}
                    onChange={(e) => updateField('accentColor', e.target.value)}
                    className="h-11 w-12 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer"
                  />
                  <code className="text-xs font-mono text-slate-300">
                    {normalizeHexColor(template.accentColor, normalizeHexColor(template.primaryColor))}
                  </code>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="email-template-footer" className={FIELD_LABEL_CLASS}>
                Footer Note
              </label>
              <textarea
                id="email-template-footer"
                value={template.footerText}
                onChange={(e) => updateField('footerText', e.target.value)}
                rows={2}
                maxLength={280}
                className={FIELD_INPUT_CLASS}
              />
            </div>

            <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
                Sample Transaction Variables
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="email-template-amount" className={FIELD_LABEL_CLASS}>
                    Amount
                  </label>
                  <input
                    id="email-template-amount"
                    type="text"
                    value={template.amount}
                    onChange={(e) => updateField('amount', e.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="email-template-asset" className={FIELD_LABEL_CLASS}>
                    Asset
                  </label>
                  <input
                    id="email-template-asset"
                    type="text"
                    value={template.asset}
                    onChange={(e) => updateField('asset', e.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="email-template-from" className={FIELD_LABEL_CLASS}>
                    From Address
                  </label>
                  <input
                    id="email-template-from"
                    type="text"
                    value={template.fromAddress}
                    onChange={(e) => updateField('fromAddress', e.target.value)}
                    className={FIELD_INPUT_CLASS}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-sm transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {onSaveTemplate ? (isSaving ? 'Saving…' : 'Save Template') : 'Generate HTML'}
              </button>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(true)}
                aria-haspopup="dialog"
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-600 hover:from-purple-400 hover:to-fuchsia-500 text-white font-semibold text-sm transition-all cursor-pointer"
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setShowSource((prev) => !prev)}
                className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sm font-semibold text-slate-200 transition-colors cursor-pointer"
              >
                {showSource ? 'Hide HTML' : 'View HTML'}
              </button>
              <button
                type="button"
                onClick={() => void handleCopyHtml()}
                className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sm font-semibold text-slate-200 transition-colors cursor-pointer"
              >
                Copy HTML
              </button>
              {status?.kind === 'success' && (
                <span
                  role="status"
                  className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm font-semibold"
                >
                  {status.message}
                </span>
              )}
            </div>

            {status?.kind === 'error' && (
              <p
                role="alert"
                className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm"
              >
                {status.message}
              </p>
            )}
          </div>

          {/* Live Preview */}
          <div className="rounded-xl bg-slate-950/60 border border-slate-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Live Email Preview
              </span>
              <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 px-2 py-0.5 text-[10px] font-semibold">
                Real-time
              </span>
            </div>
            <iframe
              title="Payment receipt email preview"
              srcDoc={previewHtml}
              sandbox=""
              data-testid="email-preview-frame"
              className="w-full h-[520px] bg-white border-0 block"
            />
            {showSource && (
              <pre className="max-h-64 overflow-auto border-t border-slate-800 bg-black/40 p-4 text-[11px] font-mono text-slate-300 whitespace-pre-wrap">
                {previewHtml}
              </pre>
            )}
          </div>
        </div>
      </form>

      {isPreviewOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsPreviewOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="email-preview-modal-title"
            data-testid="email-preview-modal"
            className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-slate-800">
              <div>
                <h3 id="email-preview-modal-title" className="text-base font-bold text-white">
                  Email Receipt Preview
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  This is how your branded payment receipt will render in an inbox.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div
                  role="group"
                  aria-label="Preview width"
                  className="flex rounded-lg border border-slate-700 overflow-hidden"
                >
                  <button
                    type="button"
                    aria-pressed={previewDevice === 'desktop'}
                    onClick={() => setPreviewDevice('desktop')}
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      previewDevice === 'desktop'
                        ? 'bg-cyan-500/20 text-cyan-200'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Desktop
                  </button>
                  <button
                    type="button"
                    aria-pressed={previewDevice === 'mobile'}
                    onClick={() => setPreviewDevice('mobile')}
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      previewDevice === 'mobile'
                        ? 'bg-cyan-500/20 text-cyan-200'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Mobile
                  </button>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={() => setIsPreviewOpen(false)}
                  aria-label="Close preview"
                  className="h-8 w-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-lg leading-none cursor-pointer"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-950 p-4 flex justify-center">
              <iframe
                title="Full-size payment receipt email preview"
                srcDoc={previewHtml}
                sandbox=""
                data-testid="email-preview-modal-frame"
                style={{ width: previewDevice === 'mobile' ? 390 : '100%' }}
                className="h-[620px] max-w-full bg-white border-0 block rounded-lg"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-slate-800">
              <p className="text-[11px] text-slate-500">
                Saved branding is applied to future payment receipt emails.
              </p>
              <button
                type="button"
                onClick={() => void handleCopyHtml()}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
              >
                Copy HTML
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
