import { expect, test } from '../fixtures';
import { createTodo, deleteTodo, todoCard } from '../helpers';

test('E04: Todo lifecycle (create → edit → complete → delete)', async ({ loggedInAsUserA: page }) => {
  const createdTitle = `e2e-crud-${Date.now()}`;
  const updatedTitle = `${createdTitle}-updated`;
  await page.goto('/');

  try {
    // E04: create — verify the new card exists and is not yet marked completed.
    await createTodo(page, { title: createdTitle, description: 'Created by E04-E07.' });
    await expect(todoCard(page, createdTitle)).toBeVisible();
    await expect(todoCard(page, createdTitle).getByRole('heading', { name: createdTitle })).not.toHaveClass(
      /line-through/,
    );

    // E05: edit — the accessible name of the article updates because it labels the h3.
    await todoCard(page, createdTitle).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Title').fill(updatedTitle);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(todoCard(page, updatedTitle)).toBeVisible();
    await expect(todoCard(page, createdTitle)).toBeHidden();

    // E06: toggle status — verify the todo becomes completed via the line-through class.
    // Use click() not check(): check() waits for the checkbox to reach checked=true, but
    // revalidatePath('/') from the server action re-renders the page before Playwright can
    // observe the state, so check() races. The line-through assertion still verifies the
    // transition, and it is count-independent so parallel specs cannot break it.
    await todoCard(page, updatedTitle).getByRole('checkbox').click();
    await expect(todoCard(page, updatedTitle).getByRole('heading', { name: updatedTitle })).toHaveClass(/line-through/);

    // E07: delete — deleteTodo() verifies the card becomes hidden.
    await deleteTodo(page, updatedTitle);
  } finally {
    for (const title of [updatedTitle, createdTitle]) {
      const card = todoCard(page, title);
      if (await card.isVisible().catch(() => false)) {
        await deleteTodo(page, title);
      }
    }
  }
});
