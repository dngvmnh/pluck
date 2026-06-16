"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKeySet = getKeySet;
exports.getKeySetWithKidFallback = getKeySetWithKidFallback;
exports.clearCache = clearCache;
const jose_1 = require("jose");
const CACHE_TTL_MS = 10 * 60 * 1000;
// Keyed by listingId — Mythos signing keys are per-listing.
const _cache = new Map();
function isStale(entry) {
    return entry === undefined || Date.now() - entry.fetchedAt > CACHE_TTL_MS;
}
async function fetchJwks(apiUrl, listingId) {
    // The Mythos platform serves signing keys PER LISTING at
    // /api/listings/:listingId/jwks, wrapped in its standard { success, data } envelope.
    // (The global /.well-known/jwks.json is empty.) Accept either the wrapped envelope
    // or a raw JWKS so a simpler/mocked backend also works.
    const res = await fetch(`${apiUrl}/api/listings/${encodeURIComponent(listingId)}/jwks`);
    if (!res.ok) {
        throw new Error(`JWKS fetch failed: ${res.status}`);
    }
    const body = (await res.json());
    const jwks = (body && typeof body === 'object' && 'data' in body && body.data
        ? body.data
        : body);
    const keySet = (0, jose_1.createLocalJWKSet)(jwks);
    _cache.set(listingId, { keySet, fetchedAt: Date.now() });
    return keySet;
}
async function getKeySet(apiUrl, listingId, forceRefresh = false) {
    const entry = _cache.get(listingId);
    if (!forceRefresh && !isStale(entry) && entry) {
        return entry.keySet;
    }
    return fetchJwks(apiUrl, listingId);
}
async function getKeySetWithKidFallback(apiUrl, listingId) {
    // A kid miss means our cached JWKS is stale — always force a fresh fetch.
    // (Returning the cache first would just hand back the same stale keys and fail again.)
    return getKeySet(apiUrl, listingId, true);
}
function clearCache() {
    _cache.clear();
}
