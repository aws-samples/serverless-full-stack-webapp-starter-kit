import { expect, test, authStatePath, newIsolatedContext } from '../fixtures';
import { createTodo, deleteTodo, todoCard } from '../helpers';

test('E10: User B cannot see a todo created by User A', async ({ browser, loggedInAsUserA: userAPage }) => {
  const title = `e2e-isolation-${Date.now()}`;
  await userAPage.goto('/');
  await createTodo(userAPage, { title, description: 'Created by User A for E10.' });

  let userBContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    userBContext = await newIsolatedContext(browser, { storageState: authStatePath('userB') });
    const userBPage = await userBContext.newPage();
    await userBPage.goto('/');
    await expect(userBPage.getByRole('heading', { name: /Pending Tasks \(\d+\)/ })).toBeVisible();
    await expect(todoCard(userBPage, title)).not.toBeVisible();
  } finally {
    await userBContext?.close();
    const userATodo = todoCard(userAPage, title);
    if (await userATodo.isVisible().catch(() => false)) {
      await deleteTodo(userAPage, title);
    }
  }
});
