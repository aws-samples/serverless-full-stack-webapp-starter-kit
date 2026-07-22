import { expect, test as base, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import path from 'node:path';

export type User = {
  email: string;
  password: string;
};

type AuthenticatedFixtures = {
  loggedInAsUserA: Page;
  loggedInAsUserB: Page;
};

export function authStatePath(user: 'userA' | 'userB') {
  return path.join(__dirname, '.auth', `${user}.json`);
}

export function newIsolatedContext(browser: Browser, options: BrowserContextOptions = {}) {
  return browser.newContext({ ...options, baseURL: process.env.E2E_BASE_URL });
}

export const test = base.extend<AuthenticatedFixtures>({
  loggedInAsUserA: async ({ browser }, use) => {
    const context = await newIsolatedContext(browser, { storageState: authStatePath('userA') });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  loggedInAsUserB: async ({ browser }, use) => {
    const context = await newIsolatedContext(browser, { storageState: authStatePath('userB') });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
