"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyLaunchToken = verifyLaunchToken;
const jose_1 = require("jose");
const jwks_cache_1 = require("./jwks-cache");
const config_1 = require("./config");
// Pick which listing's JWKS to fetch from the token's (unverified) audience. Reading
// aud before verifying is safe: it only selects the key set; a mismatched/forged aud
// just yields keys that can't validate the signature, so verification still fails.
function pickListingId(token, listingIds) {
    try {
        const aud = (0, jose_1.decodeJwt)(token).aud;
        const a = Array.isArray(aud) ? aud[0] : aud;
        if (a && listingIds.includes(a))
            return a;
    }
    catch {
        // malformed token — fall back; jwtVerify will reject it anyway
    }
    return listingIds[0];
}
async function verifyLaunchToken(token) {
    const { listingIds, apiUrl, issuer } = (0, config_1.loadConfig)();
    const listingId = pickListingId(token, listingIds);
    let keySet = await (0, jwks_cache_1.getKeySet)(apiUrl, listingId);
    let payload;
    try {
        ({ payload } = await (0, jose_1.jwtVerify)(token, keySet, {
            algorithms: ['RS256'],
            issuer,
        }));
    }
    catch (err) {
        const isKidError = err instanceof Error && err.message.includes('no applicable key found');
        if (!isKidError)
            throw err;
        // kid miss — re-fetch once
        keySet = await (0, jwks_cache_1.getKeySetWithKidFallback)(apiUrl, listingId);
        ({ payload } = await (0, jose_1.jwtVerify)(token, keySet, {
            algorithms: ['RS256'],
            issuer,
        }));
    }
    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    if (!aud || !listingIds.includes(aud)) {
        throw new Error('Token audience does not match configured listing ID');
    }
    return {
        userId: payload.sub,
        email: payload['email'],
        displayName: payload['displayName'],
        listingId: payload['listingId'],
        sessionJti: payload.jti,
    };
}
