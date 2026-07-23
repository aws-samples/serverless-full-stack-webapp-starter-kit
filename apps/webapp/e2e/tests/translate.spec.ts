import { expect, test } from '../fixtures';
import { createTodo, deleteTodo, todoCard } from '../helpers';

test.setTimeout(150_000);

test('E08: translation event refreshes the page with a translated todo', async ({ loggedInAsUserA: page }) => {
  const title = `Buy milk from the store ${Date.now()}`;
  const translatedDescription = page.getByText(new RegExp(`^Translated from: ${title}`));
  const translatedCard = page.locator('[role="article"]', { has: translatedDescription });
  let translationObserved = false;

  await page.goto('/');

  try {
    await createTodo(page, { title, description: 'Created by E08.' });
    // FIXME: AppSync subscribe() has no observable readiness signal; if flaky on cold start, extend timeout to 10s or add app-side ready indicator.
    await page.waitForTimeout(5_000);
    await todoCard(page, title).getByRole('button', { name: 'Translate', exact: true }).click();

    await expect.poll(() => translatedCard.count(), { timeout: 120_000 }).toBeGreaterThan(0);
    translationObserved = true;

    await deleteTodo(page, title, translatedCard);
    await deleteTodo(page, title);
  } finally {
    if (translationObserved && (await translatedCard.isVisible().catch(() => false))) {
      await deleteTodo(page, title, translatedCard);
    }

    const originalTodo = todoCard(page, title);
    if (await originalTodo.isVisible().catch(() => false)) {
      await deleteTodo(page, title);
    }
    // A job that completes only after the 120-second poll timeout cannot be cleaned via UI; DB cleanup is out of scope.
  }
});
