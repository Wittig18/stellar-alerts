/**
 * Unit tests for the pure bitmask scope manipulation functions in
 * api-key-rbac.ts (issue #730). These exercise hasScope/addScope/removeScope
 * and the derived helpers with no Fastify or database involvement.
 */
import { describe, it, expect } from 'vitest';
import {
  ScopeMatrix,
  ALL_SCOPES,
  hasScope,
  addScope,
  removeScope,
  hasAllScopes,
  hasAnyScope,
  buildMask,
  scopeNamesFromMask,
  missingScopes,
  hashApiKey,
  generateApiKey,
} from '../api-key-rbac';

describe('ScopeMatrix bitmask constants', () => {
  it('assigns each scope a distinct power-of-two bit', () => {
    const bits = Object.values(ScopeMatrix);
    expect(bits).toHaveLength(4);
    // Every bit is a unique single bit (power of two) and none overlap.
    for (const bit of bits) {
      expect(bit).toBeGreaterThan(0);
      expect(bit & (bit - 1)).toBe(0); // power-of-two check
    }
    const all = bits.reduce((acc, b) => acc | b, 0);
    expect(new Set(bits).size).toBe(bits.length);
    expect(all).toBe(ALL_SCOPES);
  });

  it('uses the documented public scope names', () => {
    expect(Object.keys(ScopeMatrix)).toEqual([
      'wallets:read',
      'wallets:write',
      'alerts:write',
      'webhooks:admin',
    ]);
  });
});

describe('hasScope', () => {
  it('returns true only when the scope bit is set', () => {
    expect(hasScope(ScopeMatrix['wallets:read'], 'wallets:read')).toBe(true);
    expect(hasScope(ScopeMatrix['wallets:write'], 'wallets:read')).toBe(false);
    expect(hasScope(0, 'wallets:read')).toBe(false);
  });

  it('detects a scope within a composite mask', () => {
    const mask = addScope(addScope(0, 'wallets:read'), 'alerts:write');
    expect(hasScope(mask, 'wallets:read')).toBe(true);
    expect(hasScope(mask, 'alerts:write')).toBe(true);
    expect(hasScope(mask, 'wallets:write')).toBe(false);
    expect(hasScope(mask, 'webhooks:admin')).toBe(false);
  });

  it('throws on an unknown scope name', () => {
    expect(() => hasScope(0, 'bogus:scope' as any)).toThrow(RangeError);
  });
});

describe('addScope', () => {
  it('sets the scope bit and is idempotent', () => {
    let mask = 0;
    mask = addScope(mask, 'wallets:read');
    expect(mask).toBe(ScopeMatrix['wallets:read']);
    mask = addScope(mask, 'wallets:read');
    expect(mask).toBe(ScopeMatrix['wallets:read']); // no duplicate bit
  });

  it('composes independent scopes via OR', () => {
    const mask = ['wallets:read', 'wallets:write', 'webhooks:admin'].reduce(
      (m, s) => addScope(m, s as any),
      0,
    );
    expect(mask).toBe(
      ScopeMatrix['wallets:read'] | ScopeMatrix['wallets:write'] | ScopeMatrix['webhooks:admin'],
    );
  });
});

describe('removeScope', () => {
  it('clears the scope bit and is idempotent', () => {
    let mask = addScope(addScope(0, 'wallets:read'), 'wallets:write');
    mask = removeScope(mask, 'wallets:read');
    expect(hasScope(mask, 'wallets:read')).toBe(false);
    expect(hasScope(mask, 'wallets:write')).toBe(true);
    mask = removeScope(mask, 'wallets:read'); // already absent
    expect(hasScope(mask, 'wallets:read')).toBe(false);
    expect(hasScope(mask, 'wallets:write')).toBe(true);
  });

  it('leaves an empty mask unchanged when removing an ungranted scope', () => {
    expect(removeScope(0, 'wallets:read')).toBe(0);
  });
});

describe('hasAllScopes / hasAnyScope', () => {
  const mask = buildMask(['wallets:read', 'alerts:write']);

  it('hasAllScopes requires every scope', () => {
    expect(hasAllScopes(mask, ['wallets:read'])).toBe(true);
    expect(hasAllScopes(mask, ['wallets:read', 'alerts:write'])).toBe(true);
    expect(hasAllScopes(mask, ['wallets:read', 'wallets:write'])).toBe(false);
  });

  it('hasAnyScope needs only one', () => {
    expect(hasAnyScope(mask, ['wallets:write', 'alerts:write'])).toBe(true);
    expect(hasAnyScope(mask, ['wallets:write', 'webhooks:admin'])).toBe(false);
    expect(hasAnyScope(mask, [])).toBe(true); // vacuous
  });
});

describe('buildMask / scopeNamesFromMask / missingScopes', () => {
  it('round-trips between scope names and a mask', () => {
    const names = ['wallets:read', 'wallets:write', 'alerts:write', 'webhooks:admin'] as const;
    const mask = buildMask([...names]);
    expect(scopeNamesFromMask(mask)).toEqual([...names]);
  });

  it('reports exactly the missing required scopes', () => {
    const mask = buildMask(['wallets:read']);
    expect(missingScopes(mask, ['wallets:write', 'alerts:write'])).toEqual([
      'wallets:write',
      'alerts:write',
    ]);
    expect(missingScopes(mask, ['wallets:read'])).toEqual([]);
  });
});

describe('API key generation & hashing', () => {
  it('generates a prefixed key and a distinct sha256 hash', () => {
    const { key, hash, prefix } = generateApiKey();
    expect(key.startsWith('sk_live_')).toBe(true);
    expect(key.length).toBeGreaterThan('sk_live_'.length + 16);
    expect(prefix).toBe(key.slice(0, 12));
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toHaveLength(64); // sha256 hex
  });

  it('produces unique keys across calls', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).not.toBe(b.key);
    expect(a.hash).not.toBe(b.hash);
  });

  it('hashes deterministically and is stable', () => {
    const key = 'sk_live_testkey';
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
  });
});
