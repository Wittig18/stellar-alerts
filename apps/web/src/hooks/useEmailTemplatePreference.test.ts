import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useEmailTemplatePreference } from './useEmailTemplatePreference';

const SAVED_TEMPLATE = {
  brandName: 'Northwind Goods',
  logoUrl: 'https://cdn.example.com/logo.png',
  primaryColor: '#123456',
  accentColor: '#abcdef',
  footerText: 'Thanks for your business.',
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('useEmailTemplatePreference', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hydrates the saved template for the signed-in user', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, preferences: { emailTemplate: SAVED_TEMPLATE } }),
    );

    const { result } = renderHook(() => useEmailTemplatePreference('token-1'));

    await waitFor(() => expect(result.current.template).toEqual(SAVED_TEMPLATE));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/notifications/preferences'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
  });

  it('does not call the API without an access token', async () => {
    renderHook(() => useEmailTemplatePreference(undefined));

    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it('surfaces the API error envelope when loading fails', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } },
        false,
        401,
      ),
    );

    const { result } = renderHook(() => useEmailTemplatePreference('expired-token'));

    await waitFor(() => expect(result.current.loadError).toBe('Authentication required'));
    expect(result.current.template).toBeNull();
  });

  it('posts the branding subset when saving', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, preferences: { emailTemplate: null } }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));

    const { result } = renderHook(() => useEmailTemplatePreference('token-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.saveTemplate(SAVED_TEMPLATE);
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/notifications/preferences'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ emailTemplate: SAVED_TEMPLATE }),
      }),
    );
    expect(result.current.template).toEqual(SAVED_TEMPLATE);
  });

  it('throws the API message when the save is rejected', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, preferences: { emailTemplate: null } }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'INVALID_EMAIL_TEMPLATE',
            message: 'emailTemplate.primaryColor must be a hex color, e.g. #0ea5e9.',
          },
        },
        false,
        400,
      ),
    );

    const { result } = renderHook(() => useEmailTemplatePreference('token-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.saveTemplate(SAVED_TEMPLATE)).rejects.toThrow(
        /must be a hex color/,
      );
    });
  });
});
