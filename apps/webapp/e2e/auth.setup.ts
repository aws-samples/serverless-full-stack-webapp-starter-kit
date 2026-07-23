import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { cognito } from './selectors';

// Serialize the two setup logins: parallel navigations to Cognito Managed Login can race and time out.
test.describe.configure({ mode: 'serial' });

type User = {
  email: string;
  password: string;
};

const authDirectory = path.join(__dirname, '.auth');

function getUser(label: 'A' | 'B'): User {
  const email = process.env[`E2E_USER_${label}_EMAIL`];
  const password = process.env[`E2E_USER_${label}_PASSWORD`];

  if (!email || !password) {
    throw new Error(`Missing E2E_USER_${label}_EMAIL or E2E_USER_${label}_PASSWORD`);
  }

  return { email, password };
}

async function authenticate(page: Page, user: User) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in with Cognito' }).click();

  // FRAGILE: Cognito Managed Login DOM is not a public contract. Update if AWS changes the hosted UI. Verify with: npx playwright codegen <cognito-domain>/login?client_id=...&response_type=code&scope=email+openid+profile&redirect_uri=...
  await page.locator(cognito.usernameInput).fill(user.email);
  await page.locator(cognito.passwordInput).fill(user.password);
  await page.locator(cognito.submitButton).click();

  await expect(page.getByRole('link', { name: 'Todo App' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Pending Tasks \(\d+\)/ })).toBeVisible();
}

test('authenticate as User A', async ({ page }) => {
  mkdirSync(authDirectory, { recursive: true });
  await authenticate(page, getUser('A'));
  await page.context().storageState({ path: path.join(__dirname, '.auth/userA.json') });
});

test('authenticate as User B', async ({ page }) => {
  mkdirSync(authDirectory, { recursive: true });
  await authenticate(page, getUser('B'));
  await page.context().storageState({ path: path.join(__dirname, '.auth/userB.json') });
});
