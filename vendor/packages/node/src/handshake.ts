import type { RequestHandler } from 'express';

const SDK_VERSION = '0.1.0';

export function handshakeRoute(): RequestHandler {
  return (_req, res) => {
    res.json({ ok: true, sdk_version: SDK_VERSION });
  };
}
