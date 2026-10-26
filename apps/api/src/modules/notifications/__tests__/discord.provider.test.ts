import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/prisma', () => {
  return {
    prisma: {
      notificationPreference: {
        upsert: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    },
  };
});

vi.mock('../../auth/mfa.service', () => {
  return {
    mfaService: {
      isMFAEnabled: vi.fn().mockResolvedValue(false),
      verifyMFAToken: vi.fn().mockResolvedValue(true),
    },
  };
});

import {
  DISCORD_EMBED_COLORS,
  discordNotificationProvider,
  getStellarExpertTxLink,
  resolveAssetIcon,
} from '../providers/discord.provider';
import type {
  DiscordAlertInput,
  DiscordWebhookPayload,
} from '../providers/discord.provider';
import { notificationsService } from '../notifications.service';

const paymentAlert: DiscordAlertInput = {
  paymentId: 'pay-uuid-1234',
  txHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  amount: '1250.75',
  asset: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  fromAddress: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  recipientAddress: 'GBTYAFB3RFT6EJV7R6ZMQK442B5YCYJ2LUS5EAGB5WVRM6R5UGK5K4KZ',
  receivedAt: new Date('2026-10-19T14:30:00.000Z'),
  alertId: 'alert-abc-987',
  memo: 'Invoice #INV-2026-001',
  network: 'public',
  severity: 'critical',
};

const contractAlert: DiscordAlertInput = {
  alertId: 'alert-contract-1',
  type: 'contract',
  txHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  eventType: 'pause',
  severity: 'warning',
  receivedAt: '2026-10-19T15:00:00.000Z',
  network: 'testnet',
};

const WEBHOOK_URL = 'https://discord.com/api/webhooks/123/token';

function fieldsByName(payload: DiscordWebhookPayload): Record<string, string> {
  return Object.fromEntries(
    payload.embeds[0].fields.map((field) => [field.name, field.value]),
  );
}

describe('DiscordNotificationProvider embed schema', () => {
  it('builds a payment embed with amount, asset badge, from/to, hash link, and severity color', () => {
    const payload = discordNotificationProvider.buildWebhookPayload(paymentAlert);
    const embed = payload.embeds[0];
    const fields = fieldsByName(payload);

    expect(payload.username).toBe('Stellar Alerts');
    expect(embed.title).toContain('Payment');
    expect(embed.color).toBe(DISCORD_EMBED_COLORS.critical);
    expect(fields.Amount).toBe('`1250.75 USDC`');
    expect(fields.Asset).toContain('USDC');
    expect(fields.Asset).toContain('GA5Z...KZVN');
    expect(fields.From).toBe(`\`${paymentAlert.fromAddress}\``);
    expect(fields.To).toBe(`\`${paymentAlert.recipientAddress}\``);
    expect(fields.Hash).toContain(
      getStellarExpertTxLink(paymentAlert.txHash, 'public'),
    );
    expect(fields.Memo).toBe(paymentAlert.memo);
    expect(fields.Severity).toContain('CRITICAL');
    expect(embed.thumbnail?.url).toBe(resolveAssetIcon('USDC'));
    expect(embed.url).toBe(getStellarExpertTxLink(paymentAlert.txHash, 'public'));
    expect(embed.timestamp).toBe('2026-10-19T14:30:00.000Z');
    expect(embed.footer?.text).toContain('Stellar Public Network');
    expect(embed.footer?.text).toContain('alert-abc-987');
  });

  it('builds a contract alert embed with contract/event fields and severity color', () => {
    const payload = discordNotificationProvider.buildWebhookPayload(contractAlert);
    const embed = payload.embeds[0];
    const fields = fieldsByName(payload);

    expect(embed.title).toContain('Contract Alert');
    expect(embed.color).toBe(DISCORD_EMBED_COLORS.warning);
    expect(fields.Contract).toContain('/contract/');
    expect(fields.Event).toBe('pause');
    expect(fields.Hash).toContain(
      getStellarExpertTxLink(contractAlert.txHash, 'testnet'),
    );
    expect(fields.Amount).toBeUndefined();
    expect(embed.footer?.text).toContain('Stellar Testnet');
  });

  it('resolves XLM, USDC and EURC icons dynamically and ignores unknown assets', () => {
    expect(resolveAssetIcon('XLM')).toBe(
      'https://cryptologos.cc/logos/stellar-xlm-logo.png',
    );
    expect(resolveAssetIcon('usdc')).toBe(
      'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
    );
    expect(resolveAssetIcon('EURC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')).toBe(
      'https://cryptologos.cc/logos/euro-coin-eurc-logo.png',
    );
    expect(resolveAssetIcon('BOGUS')).toBeUndefined();
    expect(resolveAssetIcon(null)).toBeUndefined();
  });

  it('omits the thumbnail for assets without a known icon', () => {
    const embed = discordNotificationProvider.buildEmbed({
      ...paymentAlert,
      asset: 'BOGUS',
    });

    expect(embed.thumbnail).toBeUndefined();
  });
});

describe('DiscordNotificationProvider delivery', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('honors the X-RateLimit-Reset header on HTTP 429', async () => {
    const resetAtSeconds = Math.floor(Date.now() / 1000) + 30;
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'You are being rate limited.' }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'x-ratelimit-reset': String(resetAtSeconds),
        },
      }),
    );

    const payload = discordNotificationProvider.buildWebhookPayload(paymentAlert);
    const result = await discordNotificationProvider.sendWebhook(WEBHOOK_URL, payload, {
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(31);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to retry_after in the response body when headers are absent', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ retry_after: 2.5 }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const payload = discordNotificationProvider.buildWebhookPayload(paymentAlert);
    const result = await discordNotificationProvider.sendWebhook(WEBHOOK_URL, payload, {
      maxRetries: 0,
    });

    expect(result.rateLimited).toBe(true);
    expect(result.retryAfterSeconds).toBe(2.5);
  });

  it('retries a rate-limited request and succeeds', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { 'retry-after': '0' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const payload = discordNotificationProvider.buildWebhookPayload(paymentAlert);
    const result = await discordNotificationProvider.sendWebhook(WEBHOOK_URL, payload, {
      maxRetries: 1,
      baseRetryDelayMs: 0,
      maxRetryDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(204);
    expect(result.attempts).toBe(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('returns an error for non-retryable HTTP failures', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('bad payload', { status: 400 }));

    const payload = discordNotificationProvider.buildWebhookPayload(paymentAlert);
    const result = await discordNotificationProvider.sendWebhook(WEBHOOK_URL, payload);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toContain('HTTP 400');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid Discord webhook URLs without a network request', async () => {
    global.fetch = vi.fn();

    const payload = discordNotificationProvider.buildWebhookPayload(paymentAlert);
    const result = await discordNotificationProvider.sendWebhook(
      'https://example.com/api/webhooks/1/x',
      payload,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid Discord webhook URL');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('is wired into notificationsService.dispatchDiscordNotification', async () => {
    const dispatchSpy = vi
      .spyOn(discordNotificationProvider, 'dispatch')
      .mockResolvedValue({ success: true, statusCode: 204 });

    const result = await notificationsService.dispatchDiscordNotification(
      { webhookUrl: WEBHOOK_URL },
      paymentAlert,
    );

    expect(result.success).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(
      { webhookUrl: WEBHOOK_URL },
      paymentAlert,
      undefined,
    );
  });
});
