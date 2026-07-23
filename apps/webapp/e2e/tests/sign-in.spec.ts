import { expect, newIsolatedContext, test } from '../fixtures';
import { cognito } from '../selectors';

function getUserA() {
  const email = process.env.E2E_USER_A_EMAIL;
  const password = process.env.E2E_USER_A_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing E2E_USER_A_EMAIL or E2E_USER_A_PASSWORD');
  }

  return { email, password };
}

test('E03: repeat sign-in for User A is idempotent', async ({ browser }) => {
  const context = await newIsolatedContext(browser);
  const page = await context.newPage();
  const user = getUserA();

  try {
    await page.goto('/');
    await page.getByRole('link', { name: 'Sign in with Cognito' }).click();
    await page.locator(cognito.usernameInput).fill(user.email);
    await page.locator(cognito.passwordInput).fill(user.password);
    await page.locator(cognito.submitButton).click();

    await expect(page.getByRole('link', { name: 'Todo App' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign Out' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Pending Tasks \(\d+\)/ })).toBeVisible();
  } finally {
    await context.close();
  }
});
