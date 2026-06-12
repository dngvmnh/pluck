import * as apiClient from '../src/api-client';
import { InsufficientFundsError, SessionNotFoundError } from '../src/errors';

beforeEach(() => {
  process.env.MYTHOS_LISTING_ID = 'listing-abc';
  process.env.MYTHOS_API_URL = 'https://api.mythos.work';
});

test('reportUsage calls /meter with correct body', async () => {
  const { reportUsage } = await import('../src/reportUsage');
  const spy = jest.spyOn(apiClient, 'meterSession').mockResolvedValue(undefined);

  await reportUsage('jti-001', { credits: 5, reason: 'page-view' });

  expect(spy).toHaveBeenCalledWith('jti-001', 5, 'page-view');
});

test('reportUsage propagates InsufficientFundsError', async () => {
  const { reportUsage } = await import('../src/reportUsage');
  jest.spyOn(apiClient, 'meterSession').mockRejectedValue(new InsufficientFundsError());

  await expect(reportUsage('jti-001', { credits: 100 })).rejects.toBeInstanceOf(InsufficientFundsError);
});

test('reportUsage propagates SessionNotFoundError', async () => {
  const { reportUsage } = await import('../src/reportUsage');
  jest.spyOn(apiClient, 'meterSession').mockRejectedValue(new SessionNotFoundError('jti-missing'));

  await expect(reportUsage('jti-missing', { credits: 1 })).rejects.toBeInstanceOf(SessionNotFoundError);
});
