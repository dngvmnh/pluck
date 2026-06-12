import { generateKeyPair, exportJWK } from 'jose';
import { getKeySet, getKeySetWithKidFallback, clearCache } from '../src/jwks-cache';

describe('jwks-cache kid-miss fallback', () => {
  let jwks: { keys: unknown[] };

  beforeAll(async () => {
    const { publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'k1';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    jwks = { keys: [jwk] };
  });

  beforeEach(() => {
    clearCache();
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => jwks });
  });

  test('getKeySet reuses a warm cache (no extra fetch)', async () => {
    await getKeySet('https://api.example');
    await getKeySet('https://api.example');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('getKeySetWithKidFallback force-refreshes even when the cache is warm', async () => {
    await getKeySet('https://api.example');                  // fetch #1 — primes the cache
    await getKeySetWithKidFallback('https://api.example');   // must re-fetch (was: returned stale cache)
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
