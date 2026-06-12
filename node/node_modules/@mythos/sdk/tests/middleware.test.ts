import { SignJWT, generateKeyPair, exportJWK, type KeyLike } from 'jose';
import * as jwksCache from '../src/jwks-cache';
import * as apiClient from '../src/api-client';
import type { Request, Response as ExpressResponse, NextFunction } from 'express';

let privateKey: KeyLike;

function mockRes(): ExpressResponse {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
  return res;
}

beforeAll(async () => {
  const kp = await generateKeyPair('RS256', { modulusLength: 2048 });
  privateKey = kp.privateKey;
  const publicKey = kp.publicKey;

  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-kid';
  jwk.alg = 'RS256';

  const { createLocalJWKSet } = await import('jose');
  const keySet = createLocalJWKSet({ keys: [jwk] });
  jest.spyOn(jwksCache, 'getKeySet').mockResolvedValue(keySet as never);
  jest.spyOn(jwksCache, 'getKeySetWithKidFallback').mockResolvedValue(keySet as never);
});

beforeEach(() => {
  process.env.MYTHOS_LISTING_ID = 'listing-abc';
  process.env.MYTHOS_API_URL = 'https://api.mythos.work';
  delete process.env.MYTHOS_LISTING_IDS;
});

async function mintToken(jti = 'jti-001'): Promise<string> {
  return new SignJWT({ sub: 'user-1', email: 'e@e.com', displayName: 'User', listingId: 'listing-abc' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuedAt()
    .setIssuer('https://api.mythos.work')
    .setAudience('listing-abc')
    .setJti(jti)
    .setExpirationTime('5m')
    .sign(privateKey);
}

test('happy path: req.mythos populated and next() called', async () => {
  const { requireLaunchToken } = await import('../src/middleware');
  jest.spyOn(apiClient, 'consumeSession').mockResolvedValue({ status: 200 } as unknown as globalThis.Response);

  const token = await mintToken();
  const req = { query: { lt: token }, mythos: undefined } as unknown as Request;
  const res = mockRes();
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await requireLaunchToken()(req, res, next);

  expect(next).toHaveBeenCalled();
  expect(req.mythos?.userId).toBe('user-1');
  expect(req.mythos?.sessionJti).toBe('jti-001');
});

test('replay: consume returns 409 → 401 to client', async () => {
  const { requireLaunchToken } = await import('../src/middleware');
  jest.spyOn(apiClient, 'consumeSession').mockResolvedValue({ status: 409 } as unknown as globalThis.Response);

  const token = await mintToken('jti-replay');
  const req = { query: { lt: token } } as unknown as Request;
  const res = mockRes();
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await requireLaunchToken()(req, res, next);

  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
});

test('consume 500 → 503, never grants access', async () => {
  const { requireLaunchToken } = await import('../src/middleware');
  jest.spyOn(apiClient, 'consumeSession').mockResolvedValue({ status: 500 } as unknown as globalThis.Response);

  const token = await mintToken('jti-500');
  const req = { query: { lt: token } } as unknown as Request;
  const res = mockRes();
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await requireLaunchToken()(req, res, next);

  expect(res.status).toHaveBeenCalledWith(503);
  expect(next).not.toHaveBeenCalled();
});

test('consume network error → 503, never grants access', async () => {
  const { requireLaunchToken } = await import('../src/middleware');
  jest.spyOn(apiClient, 'consumeSession').mockRejectedValue(new Error('fetch failed'));

  const token = await mintToken('jti-net');
  const req = { query: { lt: token } } as unknown as Request;
  const res = mockRes();
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await requireLaunchToken()(req, res, next);

  expect(res.status).toHaveBeenCalledWith(503);
  expect(next).not.toHaveBeenCalled();
});

test('iss mismatch → 401, token with wrong issuer rejected', async () => {
  const { requireLaunchToken } = await import('../src/middleware');

  const badToken = await new SignJWT({ sub: 'user-evil', email: 'e@e.com', displayName: 'Evil', listingId: 'listing-abc' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuedAt()
    .setIssuer('https://evil.example')
    .setAudience('listing-abc')
    .setJti('jti-evil')
    .setExpirationTime('5m')
    .sign(privateKey);

  const req = { query: { lt: badToken } } as unknown as Request;
  const res = mockRes();
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await requireLaunchToken()(req, res, next);

  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
});
