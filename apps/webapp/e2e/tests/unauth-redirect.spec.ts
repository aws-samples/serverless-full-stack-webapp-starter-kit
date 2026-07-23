import { expect, newIsolatedContext, test } from '../fixtures';

test('E02: unauthenticated root request redirects to sign-in', async ({ browser }) => {
  const context = await newIsolatedContext(browser);
  const page = await context.newPage();

  try {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole('heading', { name: 'Todo App' })).toBeVisible();
  } finally {
    await context.close();
  }
});
