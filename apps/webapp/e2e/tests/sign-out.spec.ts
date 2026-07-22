import { expect, newIsolatedContext, test } from '../fixtures';

test('E09: sign-out invalidates access for the current and a new browser context', async ({
  browser,
  loggedInAsUserA: page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign Out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Todo App' })).toBeVisible();

  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);

  const unauthenticatedContext = await newIsolatedContext(browser);
  const unauthenticatedPage = await unauthenticatedContext.newPage();

  try {
    await unauthenticatedPage.goto('/');
    await expect(unauthenticatedPage).toHaveURL(/\/sign-in$/);
  } finally {
    await unauthenticatedContext.close();
  }
});
