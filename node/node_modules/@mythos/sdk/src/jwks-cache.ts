import { createLocalJWKSet, type JSONWebKeySet } from 'jose';

const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  keySet: ReturnType<typeof createLocalJWKSet>;
  fetchedAt: number;
}

let _cache: CacheEntry | null = null;

function isStale(): boolean {
  return _cache === null || Date.now() - _cache.fetchedAt > CACHE_TTL_MS;
}

async function fetchJwks(apiUrl: string): Promise<ReturnType<typeof createLocalJWKSet>> {
  const res = await fetch(`${apiUrl}/.well-known/jwks.json`);
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${res.status}`);
  }
  const jwks = (await res.json()) as JSONWebKeySet;
  const keySet = createLocalJWKSet(jwks);
  _cache = { keySet, fetchedAt: Date.now() };
  return keySet;
}

export async function getKeySet(apiUrl: string, forceRefresh = false): Promise<ReturnType<typeof createLocalJWKSet>> {
  if (!forceRefresh && !isStale() && _cache) {
    return _cache.keySet;
  }
  return fetchJwks(apiUrl);
}

export async function getKeySetWithKidFallback(apiUrl: string): Promise<ReturnType<typeof createLocalJWKSet>> {
  // A kid miss means our cached JWKS is stale — always force a fresh fetch.
  // (Returning the cache first would just hand back the same stale keys and fail again.)
  return getKeySet(apiUrl, true);
}

export function clearCache(): void {
  _cache = null;
}
