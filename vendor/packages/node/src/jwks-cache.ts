import { createLocalJWKSet, type JSONWebKeySet } from 'jose';

const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  keySet: ReturnType<typeof createLocalJWKSet>;
  fetchedAt: number;
}

// Keyed by listingId — Mythos signing keys are per-listing.
const _cache = new Map<string, CacheEntry>();

function isStale(entry: CacheEntry | undefined): boolean {
  return entry === undefined || Date.now() - entry.fetchedAt > CACHE_TTL_MS;
}

async function fetchJwks(
  apiUrl: string,
  listingId: string,
): Promise<ReturnType<typeof createLocalJWKSet>> {
  // The Mythos platform serves signing keys PER LISTING at
  // /api/listings/:listingId/jwks, wrapped in its standard { success, data } envelope.
  // (The global /.well-known/jwks.json is empty.) Accept either the wrapped envelope
  // or a raw JWKS so a simpler/mocked backend also works.
  const res = await fetch(`${apiUrl}/api/listings/${encodeURIComponent(listingId)}/jwks`);
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as { keys?: unknown; data?: JSONWebKeySet };
  const jwks = (body && typeof body === 'object' && 'data' in body && body.data
    ? body.data
    : body) as JSONWebKeySet;
  const keySet = createLocalJWKSet(jwks);
  _cache.set(listingId, { keySet, fetchedAt: Date.now() });
  return keySet;
}

export async function getKeySet(
  apiUrl: string,
  listingId: string,
  forceRefresh = false,
): Promise<ReturnType<typeof createLocalJWKSet>> {
  const entry = _cache.get(listingId);
  if (!forceRefresh && !isStale(entry) && entry) {
    return entry.keySet;
  }
  return fetchJwks(apiUrl, listingId);
}

export async function getKeySetWithKidFallback(
  apiUrl: string,
  listingId: string,
): Promise<ReturnType<typeof createLocalJWKSet>> {
  // A kid miss means our cached JWKS is stale — always force a fresh fetch.
  // (Returning the cache first would just hand back the same stale keys and fail again.)
  return getKeySet(apiUrl, listingId, true);
}

export function clearCache(): void {
  _cache.clear();
}
