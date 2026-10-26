import { describe, it, expect, beforeEach, vi } from 'vitest';

const webhookMock = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: { webhook: webhookMock },
}));

import { WebhooksService, SECRET_ROTATION_GRACE_PERIOD_MS } from '../webhooks.service';
import { cryptoVault } from '../../../utils/crypto-vault';
import { evaluateWebhookVerification } from '../../../utils/webhook-signer';

/** Builds a persisted-looking Webhook row with a real encrypted secret. */
function encryptedWebhookRow(secret: string, overrides: Record<string, unknown> = {}) {
  const encrypted = cryptoVault.encrypt(secret);
  const [version, iv, authTag, ciphertext] = encrypted.split(':');
  return {
    id: 'wh_1',
    userId: 'user_1',
    url: 'https://example.com/hook',
    keyVersion: parseInt(version, 10),
    secretIv: iv,
    secretAuthTag: authTag,
    secretCiphertext: ciphertext,
    previousSecretCiphertext: null,
    previousSecretIv: null,
    previousSecretAuthTag: null,
    previousKeyVersion: null,
    previousSecretExpiresAt: null,
    ...overrides,
  };
}

describe('WebhooksService secret rotation (#721)', () => {
  let service: WebhooksService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WebhooksService();
  });

  it('rotateSecret generates a new secret, demotes the old one, and sets a 24h grace expiry', async () => {
    const existing = encryptedWebhookRow('old-secret-value');
    webhookMock.findFirst.mockResolvedValue(existing);
    webhookMock.update.mockResolvedValue({});

    const before = Date.now();
    const result = await service.rotateSecret('wh_1', 'user_1');
    const after = Date.now();

    expect(result.id).toBe('wh_1');
    expect(result.secret).toBeTruthy();
    expect(result.secret).not.toBe('old-secret-value');

    const expiresAt = result.previousSecretExpiresAt.getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + SECRET_ROTATION_GRACE_PERIOD_MS - 50);
    expect(expiresAt).toBeLessThanOrEqual(after + SECRET_ROTATION_GRACE_PERIOD_MS + 50);

    expect(webhookMock.update).toHaveBeenCalledTimes(1);
    const updateArg = webhookMock.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'wh_1' });
    // The previously-active secret's encrypted parts are what gets demoted.
    expect(updateArg.data.previousSecretCiphertext).toBe(existing.secretCiphertext);
    expect(updateArg.data.previousSecretIv).toBe(existing.secretIv);
    expect(updateArg.data.previousSecretAuthTag).toBe(existing.secretAuthTag);
    expect(updateArg.data.previousKeyVersion).toBe(existing.keyVersion);
  });

  it('rotateSecret throws "Webhook not found" when the webhook does not belong to the user', async () => {
    webhookMock.findFirst.mockResolvedValue(null);

    await expect(service.rotateSecret('wh_1', 'someone-else')).rejects.toThrow('Webhook not found');
    expect(webhookMock.update).not.toHaveBeenCalled();
  });

  it('buildDualSignatureHeaders signs with only the active secret when no rotation is in progress', () => {
    const row = encryptedWebhookRow('active-secret');
    const { headers } = service.buildDualSignatureHeaders(row, 'payload-body');

    expect(headers['X-Stellar-Signature']).toBeTruthy();
    expect(headers['X-Stellar-Signature-Secondary']).toBeUndefined();

    const verified = evaluateWebhookVerification('payload-body', headers['X-Stellar-Signature'], 'active-secret', {
      nonce: headers['X-Stellar-Alerts-Nonce'],
    });
    expect(verified.valid).toBe(true);
  });

  it('buildDualSignatureHeaders attaches a secondary signature that verifies with the previous secret during the grace window', () => {
    const activeEncrypted = cryptoVault.encrypt('new-secret');
    const [activeVersion, activeIv, activeAuthTag, activeCiphertext] = activeEncrypted.split(':');
    const previousEncrypted = cryptoVault.encrypt('old-secret');
    const [previousVersion, previousIv, previousAuthTag, previousCiphertext] = previousEncrypted.split(':');

    const row = {
      id: 'wh_1',
      keyVersion: parseInt(activeVersion, 10),
      secretIv: activeIv,
      secretAuthTag: activeAuthTag,
      secretCiphertext: activeCiphertext,
      previousKeyVersion: parseInt(previousVersion, 10),
      previousSecretIv: previousIv,
      previousSecretAuthTag: previousAuthTag,
      previousSecretCiphertext: previousCiphertext,
      previousSecretExpiresAt: new Date(Date.now() + SECRET_ROTATION_GRACE_PERIOD_MS),
    };

    const { headers } = service.buildDualSignatureHeaders(row, 'payload-body');

    expect(headers['X-Stellar-Signature']).toBeTruthy();
    expect(headers['X-Stellar-Signature-Secondary']).toBeTruthy();

    const verifiedWithNew = evaluateWebhookVerification('payload-body', headers['X-Stellar-Signature'], 'new-secret', {
      nonce: headers['X-Stellar-Alerts-Nonce'],
    });
    expect(verifiedWithNew.valid).toBe(true);

    const verifiedWithOld = evaluateWebhookVerification(
      'payload-body',
      headers['X-Stellar-Signature-Secondary'],
      'old-secret',
      { nonce: headers['X-Stellar-Alerts-Nonce'] }
    );
    expect(verifiedWithOld.valid).toBe(true);
  });

  it('buildDualSignatureHeaders omits the secondary signature once the grace period has expired', () => {
    const activeEncrypted = cryptoVault.encrypt('new-secret');
    const [activeVersion, activeIv, activeAuthTag, activeCiphertext] = activeEncrypted.split(':');
    const previousEncrypted = cryptoVault.encrypt('old-secret');
    const [previousVersion, previousIv, previousAuthTag, previousCiphertext] = previousEncrypted.split(':');

    const row = {
      id: 'wh_1',
      keyVersion: parseInt(activeVersion, 10),
      secretIv: activeIv,
      secretAuthTag: activeAuthTag,
      secretCiphertext: activeCiphertext,
      previousKeyVersion: parseInt(previousVersion, 10),
      previousSecretIv: previousIv,
      previousSecretAuthTag: previousAuthTag,
      previousSecretCiphertext: previousCiphertext,
      // Grace window elapsed an hour ago.
      previousSecretExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
    };

    const { headers } = service.buildDualSignatureHeaders(row, 'payload-body');
    expect(headers['X-Stellar-Signature-Secondary']).toBeUndefined();
  });

  it('decommissionExpiredPreviousSecret clears previous-secret columns once the grace period elapses', async () => {
    webhookMock.updateMany.mockResolvedValue({ count: 1 });

    await service.decommissionExpiredPreviousSecret('wh_1');

    expect(webhookMock.updateMany).toHaveBeenCalledTimes(1);
    const call = webhookMock.updateMany.mock.calls[0][0];
    expect(call.where.id).toBe('wh_1');
    expect(call.where.previousSecretExpiresAt).toHaveProperty('lte');
    expect(call.data).toEqual({
      previousSecretCiphertext: null,
      previousSecretIv: null,
      previousSecretAuthTag: null,
      previousKeyVersion: null,
      previousSecretExpiresAt: null,
    });
  });
});
