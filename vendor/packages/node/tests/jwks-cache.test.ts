import { generateKeyPair, exportJWK } from 'jose';
import { getKeySet, getKeySetWithKidFallback, clearCache } from '../src/jwks-cache';

const LISTING = '11111111-1111-1111-1111-111111111111';

describe('jwks-cache kid-miss fallback', () => {
  let envelope: { success: boolean; data: { keys: unknown[] } };

  beforeAll(async () => {
    const { publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'k1';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    // Platform serves the per-listing JWKS in a { success, data } envelope.
    envelope = { success: true, data: { keys: [jwk] } };
  });

  beforeEach(() => {
    clearCache();
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => envelope });
  });

  test('fetches the per-listing JWKS path and unwraps the envelope', async () => {
    await getKeySet('https://api.example', LISTING);
    expect(global.fetch).toHaveBeenCalledWith(`https://api.example/api/listings/${LISTING}/jwks`);
  });

  test('getKeySet reuses a warm cache (no extra fetch)', async () => {
    await getKeySet('https://api.example', LISTING);
    await getKeySet('https://api.example', LISTING);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('getKeySetWithKidFallback force-refreshes even when the cache is warm', async () => {
    await getKeySet('https://api.example', LISTING);                  // fetch #1 — primes the cache
    await getKeySetWithKidFallback('https://api.example', LISTING);   // must re-fetch (was: returned stale cache)
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
