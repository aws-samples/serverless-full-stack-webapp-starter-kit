import { expect, test } from '@playwright/test';

test('E01: health endpoint returns plaintext ok', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);
  expect(await response.text()).toBe('ok');
});
