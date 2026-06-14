"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKeySet = getKeySet;
exports.getKeySetWithKidFallback = getKeySetWithKidFallback;
exports.clearCache = clearCache;
const jose_1 = require("jose");
const CACHE_TTL_MS = 10 * 60 * 1000;
let _cache = null;
function isStale() {
    return _cache === null || Date.now() - _cache.fetchedAt > CACHE_TTL_MS;
}
async function fetchJwks(apiUrl) {
    const res = await fetch(`${apiUrl}/.well-known/jwks.json`);
    if (!res.ok) {
        throw new Error(`JWKS fetch failed: ${res.status}`);
    }
    const jwks = (await res.json());
    const keySet = (0, jose_1.createLocalJWKSet)(jwks);
    _cache = { keySet, fetchedAt: Date.now() };
    return keySet;
}
async function getKeySet(apiUrl, forceRefresh = false) {
    if (!forceRefresh && !isStale() && _cache) {
        return _cache.keySet;
    }
    return fetchJwks(apiUrl);
}
async function getKeySetWithKidFallback(apiUrl) {
    // A kid miss means our cached JWKS is stale — always force a fresh fetch.
    // (Returning the cache first would just hand back the same stale keys and fail again.)
    return getKeySet(apiUrl, true);
}
function clearCache() {
    _cache = null;
}
