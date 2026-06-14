import { jwtVerify } from 'jose';
import { getKeySet, getKeySetWithKidFallback } from './jwks-cache';
import { loadConfig } from './config';
import type { MythosSession } from './types';

export async function verifyLaunchToken(token: string): Promise<MythosSession> {
  const { listingIds, apiUrl, issuer } = loadConfig();

  let keySet = await getKeySet(apiUrl);

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
    keySet = await getKeySetWithKidFallback(apiUrl);
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
