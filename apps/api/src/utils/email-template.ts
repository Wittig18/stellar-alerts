import type { EmailTemplateDTO } from '@stellar-alerts/shared';
import { ValidationError } from '../lib/errors';

/**
 * Validation/normalization for the merchant-customizable payment receipt
 * template persisted on `NotificationPreference.emailTemplate` (#572).
 *
 * The dashboard sends the whole branding object on every save, so missing
 * optional fields fall back to the platform defaults rather than retaining a
 * stale value. Anything that does not look like a safe HTML/email value is
 * rejected with a `400 INVALID_EMAIL_TEMPLATE` instead of being silently
 * coerced, because these values are interpolated into outgoing receipt emails.
 */

export const DEFAULT_EMAIL_TEMPLATE_BRANDING: EmailTemplateDTO = {
  brandName: 'StellarAlerts',
  logoUrl: '',
  primaryColor: '#0ea5e9',
  accentColor: '#7c3aed',
  footerText:
    'You received this receipt because you monitor incoming Stellar payments with StellarAlerts.',
};

export const MAX_BRAND_NAME_LENGTH = 80;
export const MAX_FOOTER_TEXT_LENGTH = 280;
export const MAX_LOGO_URL_LENGTH = 2048;

const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function invalidEmailTemplate(message: string): ValidationError {
  return new ValidationError(message, undefined, 'INVALID_EMAIL_TEMPLATE');
}

/**
 * Coerces a hex color into a normalized `#rrggbb` value, expanding the
 * 3-digit shorthand. Throws for anything that is not a hex color so a typo
 * cannot leak into the rendered email.
 */
export function normalizeEmailTemplateColor(value: string, field: string): string {
  if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value.trim())) {
    throw invalidEmailTemplate(`${field} must be a hex color, e.g. #0ea5e9.`);
  }

  const raw = value.trim().replace(/^#/, '').toLowerCase();
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((char) => char + char)
          .join('')
      : raw;

  return `#${expanded}`;
}

function readOptionalString(
  source: Record<string, unknown>,
  field: keyof EmailTemplateDTO,
): string | undefined {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw invalidEmailTemplate(`emailTemplate.${field} must be a string.`);
  }
  return value;
}

/**
 * Validates a logo URL: empty (monogram fallback) or an absolute https URL.
 * `http:`, `data:` and `javascript:` URLs are rejected.
 */
export function normalizeEmailTemplateLogoUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (trimmed.length > MAX_LOGO_URL_LENGTH) {
    throw invalidEmailTemplate(
      `emailTemplate.logoUrl must be at most ${MAX_LOGO_URL_LENGTH} characters.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalidEmailTemplate('emailTemplate.logoUrl must be an absolute https URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw invalidEmailTemplate('emailTemplate.logoUrl must use https.');
  }

  return parsed.toString();
}

/**
 * Normalizes an untrusted `emailTemplate` payload into the exact shape stored
 * on the preference row.
 */
export function normalizeEmailTemplatePreferences(input: unknown): EmailTemplateDTO {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidEmailTemplate('emailTemplate must be an object.');
  }

  const source = input as Record<string, unknown>;

  const rawBrandName = readOptionalString(source, 'brandName');
  const brandName = (rawBrandName ?? DEFAULT_EMAIL_TEMPLATE_BRANDING.brandName).trim();
  if (!brandName) {
    throw invalidEmailTemplate('emailTemplate.brandName must not be empty.');
  }
  if (brandName.length > MAX_BRAND_NAME_LENGTH) {
    throw invalidEmailTemplate(
      `emailTemplate.brandName must be at most ${MAX_BRAND_NAME_LENGTH} characters.`,
    );
  }

  const rawFooter = readOptionalString(source, 'footerText');
  const footerText = (rawFooter ?? DEFAULT_EMAIL_TEMPLATE_BRANDING.footerText).trim();
  if (footerText.length > MAX_FOOTER_TEXT_LENGTH) {
    throw invalidEmailTemplate(
      `emailTemplate.footerText must be at most ${MAX_FOOTER_TEXT_LENGTH} characters.`,
    );
  }

  const rawLogo = readOptionalString(source, 'logoUrl');
  const logoUrl = normalizeEmailTemplateLogoUrl(
    rawLogo ?? DEFAULT_EMAIL_TEMPLATE_BRANDING.logoUrl,
  );

  const rawPrimary = readOptionalString(source, 'primaryColor');
  const primaryColor = normalizeEmailTemplateColor(
    rawPrimary ?? DEFAULT_EMAIL_TEMPLATE_BRANDING.primaryColor,
    'emailTemplate.primaryColor',
  );

  const rawAccent = readOptionalString(source, 'accentColor');
  const accentColor = normalizeEmailTemplateColor(
    rawAccent ?? DEFAULT_EMAIL_TEMPLATE_BRANDING.accentColor,
    'emailTemplate.accentColor',
  );

  return { brandName, logoUrl, primaryColor, accentColor, footerText };
}

/**
 * Best-effort reader for the `NotificationPreference.emailTemplate` JSON
 * column. Returns `null` for missing/malformed rows (e.g. written by an older
 * version) so receipt delivery falls back to the default template instead of
 * failing the notification job.
 */
export function parseStoredEmailTemplate(value: unknown): EmailTemplateDTO | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return normalizeEmailTemplatePreferences(value);
  } catch {
    return null;
  }
}
