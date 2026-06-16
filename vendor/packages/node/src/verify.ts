import { decodeJwt, jwtVerify } from 'jose';
import { getKeySet, getKeySetWithKidFallback } from './jwks-cache';
import { loadConfig } from './config';
import type { MythosSession } from './types';

// Pick which listing's JWKS to fetch from the token's (unverified) audience. Reading
// aud before verifying is safe: it only selects the key set; a mismatched/forged aud
// just yields keys that can't validate the signature, so verification still fails.
function pickListingId(token: string, listingIds: string[]): string {
  try {
    const aud = decodeJwt(token).aud;
    const a = Array.isArray(aud) ? aud[0] : aud;
    if (a && listingIds.includes(a)) return a;
  } catch {
    // malformed token — fall back; jwtVerify will reject it anyway
  }
  return listingIds[0];
}

export async function verifyLaunchToken(token: string): Promise<MythosSession> {
  const { listingIds, apiUrl, issuer } = loadConfig();
  const listingId = pickListingId(token, listingIds);

  let keySet = await getKeySet(apiUrl, listingId);

  let payload;
  try {
    ({ payload } = await jwtVerify(token, keySet, {
      algorithms: ['RS256'],
      issuer,
    }));
  } catch (err: unknown) {
    const isKidError =
      err instanceof Error && err.message.includes('no applicable key found');
    if (!isKidError) throw err;

    // kid miss — re-fetch once
    keySet = await getKeySetWithKidFallback(apiUrl, listingId);
    ({ payload } = await jwtVerify(token, keySet, {
      algorithms: ['RS256'],
      issuer,
    }));
  }

  const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
  if (!aud || !listingIds.includes(aud)) {
    throw new Error('Token audience does not match configured listing ID');
  }

  return {
    userId: payload.sub as string,
    email: payload['email'] as string,
    displayName: payload['displayName'] as string,
    listingId: payload['listingId'] as string,
    sessionJti: payload.jti as string,
  };
}
