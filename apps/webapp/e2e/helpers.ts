import { expect, type Locator, type Page } from '@playwright/test';

type TodoInput = {
  title: string;
  description: string;
};

async function countFromHeading(page: Page, name: 'Pending' | 'Completed') {
  const heading = page.getByRole('heading', { name: new RegExp(`^${name} Tasks \\(\\d+\\)$`) });
  const text = await heading.textContent();
  const count = text?.match(/\((\d+)\)/)?.[1];

  if (!count) {
    throw new Error(`Could not parse ${name.toLowerCase()} todo count from heading: ${text}`);
  }

  return Number(count);
}

export function todoCard(page: Page, title: string): Locator {
  // exact: true prevents a title that is a substring of another title (e.g. `foo` vs `foo-updated`)
  // from matching the wrong article's accessible name.
  return page.getByRole('article', { name: title, exact: true });
}

export async function createTodo(page: Page, { title, description }: TodoInput) {
  await page.getByRole('button', { name: '+ Add New Todo' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Create Todo' }).click();
  await expect(page.getByRole('heading', { name: 'Create New Todo' })).toBeHidden();
}

export async function deleteTodo(page: Page, title: string, card: Locator = todoCard(page, title)) {
  await expect(card).toBeVisible();

  const deleteButton = card.getByRole('button', { name: 'Delete', exact: true });
  page.once('dialog', (dialog) => dialog.accept());
  await deleteButton.click();

  await expect(card).toBeHidden();
}

export function getPendingCount(page: Page) {
  return countFromHeading(page, 'Pending');
}

export function getCompletedCount(page: Page) {
  return countFromHeading(page, 'Completed');
}

export async function waitForPendingCount(page: Page, expected: number) {
  await expect(page.getByRole('heading', { name: new RegExp(`Pending Tasks \\(${expected}\\)`) })).toBeVisible({
    timeout: 60_000,
  });
}

export async function waitForCompletedCount(page: Page, expected: number) {
  await expect(page.getByRole('heading', { name: new RegExp(`Completed Tasks \\(${expected}\\)`) })).toBeVisible({
    timeout: 60_000,
  });
}
