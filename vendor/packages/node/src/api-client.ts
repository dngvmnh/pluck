import { loadConfig } from './config';
import { InsufficientFundsError, SessionNotFoundError } from './errors';

async function post(path: string, body: unknown): Promise<Response> {
  const { apiUrl } = loadConfig();
  return fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function consumeSession(jti: string): Promise<Response> {
  return post(`/api/apps/sessions/${jti}/consume`, {});
}

export async function meterSession(
  jti: string,
  credits: number,
  reason?: string,
): Promise<void> {
  const res = await post(`/api/apps/sessions/${jti}/meter`, { credits, reason });

  if (res.status === 402) throw new InsufficientFundsError();
  if (res.status === 404) throw new SessionNotFoundError(jti);
  if (!res.ok) throw new Error(`Meter request failed: ${res.status}`);
}
