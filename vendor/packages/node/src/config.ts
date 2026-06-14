import type { MythosConfig } from './types';

const DEFAULT_API_URL = 'https://api.mythos.work';
// The Mythos platform mints launch tokens with iss:'mythos' (see backend
// apps.service.ts) — NOT the API URL. Validate against that, overridable for tests.
const DEFAULT_ISSUER = 'mythos';

export function loadConfig(): MythosConfig {
  const apiUrl = process.env.MYTHOS_API_URL ?? DEFAULT_API_URL;
  const issuer = process.env.MYTHOS_ISSUER ?? DEFAULT_ISSUER;
  const multi = process.env.MYTHOS_LISTING_IDS;
  const single = process.env.MYTHOS_LISTING_ID;

  const listingIds = multi
    ? multi.split(',').map((id) => id.trim()).filter(Boolean)
    : single
      ? [single]
      : [];

  if (listingIds.length === 0) {
    throw new Error('MYTHOS_LISTING_ID or MYTHOS_LISTING_IDS env var is required');
  }

  return { listingIds, apiUrl, issuer };
}
