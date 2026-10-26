'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EmailTemplateDTO } from '@stellar-alerts/shared';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

interface PreferencesResponse {
  success?: boolean;
  preferences?: { emailTemplate?: EmailTemplateDTO | null } | null;
  error?: { message?: string; code?: string } | string;
  message?: string;
}

function extractErrorMessage(data: PreferencesResponse, fallback: string): string {
  if (typeof data.error === 'string' && data.error) return data.error;
  if (data.error && typeof data.error === 'object' && data.error.message) {
    return data.error.message;
  }
  if (typeof data.message === 'string' && data.message) return data.message;
  return fallback;
}

/**
 * Loads and saves the user's branded receipt template (#572) through
 * `GET/POST /notifications/preferences`.
 *
 * The settings page and the dashboard card both use this so a template saved
 * in one place is hydrated in the other instead of silently resetting the
 * user's branding back to the platform default.
 */
export function useEmailTemplatePreference(accessToken?: string | null) {
  const [template, setTemplate] = useState<EmailTemplateDTO | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    let active = true;
    setIsLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/notifications/preferences`, {
          headers: authHeaders(),
        });
        const data = (await response.json().catch(() => ({}))) as PreferencesResponse;

        if (!response.ok || data.success === false) {
          throw new Error(
            extractErrorMessage(data, 'Could not load your saved email template.'),
          );
        }

        if (active) setTemplate(data.preferences?.emailTemplate ?? null);
      } catch (error) {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Could not load your saved email template.',
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [accessToken, authHeaders]);

  /**
   * Persists the template and throws with a user-safe message when the API
   * rejects it, so the editor can show the failure instead of a false "Saved".
   */
  const saveTemplate = useCallback(
    async (nextTemplate: EmailTemplateDTO): Promise<void> => {
      const response = await fetch(`${API_BASE_URL}/notifications/preferences`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ emailTemplate: nextTemplate }),
      });
      const data = (await response.json().catch(() => ({}))) as PreferencesResponse;

      if (!response.ok || data.success === false) {
        throw new Error(
          extractErrorMessage(data, 'Could not save your email template. Please try again.'),
        );
      }

      // Persist only the branding subset; preview-only sample values are not
      // part of the stored preference.
      const savedTemplate: EmailTemplateDTO = {
        brandName: nextTemplate.brandName,
        logoUrl: nextTemplate.logoUrl,
        primaryColor: nextTemplate.primaryColor,
        accentColor: nextTemplate.accentColor,
        footerText: nextTemplate.footerText,
      };
      setTemplate(savedTemplate);
      setLoadError(null);
    },
    [authHeaders],
  );

  return { template, isLoading, loadError, saveTemplate };
}
