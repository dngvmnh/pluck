import { meterSession } from './api-client';

export async function reportUsage(
  jti: string,
  opts: { credits: number; reason?: string },
): Promise<void> {
  await meterSession(jti, opts.credits, opts.reason);
}
