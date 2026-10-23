import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { seedConversations, seedMessages } from './db';
import { getE2EUser } from '../../setup/user';
import { MOCK_ENDPOINTS, selectMockEndpoint, sendMessage } from './helpers';

const scroller = (page: Page) => page.locator('[data-chat-pane="0"] .scrollbar-gutter-stable');
const gap = (page: Page) =>
  scroller(page).evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
const row = (page: Page, id: string) => page.locator(`nav [data-conversation-id="${id}"]`);
const output = (page: Page) =>
  page.locator('[data-testid="screenshot-target"] .message-render').last();

async function setAutoScroll(page: Page, enabled: boolean) {
  await page.getByTestId('nav-user').click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Auto-Scroll to latest message on chat open' });
  await toggle.setChecked(enabled);
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('autoScroll') ?? 'false')))
    .toBe(enabled);
}

async function seedThread() {
  const id = randomUUID();
  const email = getE2EUser().email;
  await seedConversations(email, [
    { conversationId: id, title: `Scroll ${id}`, updatedAt: new Date() },
  ]);
  let parent = '00000000-0000-0000-0000-000000000000';
  await seedMessages(
    email,
    id,
    Array.from({ length: 50 }, (_, index) => {
      const messageId = randomUUID();
      const result = {
        messageId,
        parentMessageId: parent,
        text: `Navigation history row ${index}. This is synthetic scrolling test content.`,
        isCreatedByUser: index % 2 === 0,
        sender: index % 2 === 0 ? 'User' : 'Assistant',
      };
      parent = messageId;
      return result;
    }),
  );
  return id;
}

test.describe('running conversation navigation scrolling', () => {
  test.use({ serviceWorkers: 'block', viewport: { width: 1100, height: 700 } });

  for (const enabled of [false, true]) {
    test(`navigation and resumed output honor autoScroll=${enabled}`, async ({ page }) => {
      test.setTimeout(120_000);
      const id = await seedThread();
      const otherId = enabled ? await seedThread() : undefined;
      await page.goto(`/c/${id}`);
      await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
      // Exercise the existing control and persistence, including the default false.
      await setAutoScroll(page, !enabled);
      await setAutoScroll(page, enabled);
      await sendMessage(page, `E2E_RUNNING_REPLY:scroll-${enabled}`);
      await expect(output(page)).toContainText('chunk-005', { timeout: 30_000 });
      await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);
      // Cold running load reads the stored preference before restoring submission.
      await page.reload();
      await expect(output(page)).toContainText('chunk-015', { timeout: 30_000 });
      if (enabled) await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);
      else await expect.poll(() => gap(page)).toBeGreaterThan(200);
      await page.getByRole('link', { name: 'New chat', exact: true }).click();
      await expect(page).toHaveURL(/\/c\/new/);
      const resumed = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/agents/chat/stream/${id}?`) &&
          response.url().includes('resume=true'),
      );
      await row(page, id).click();
      await resumed;
      await expect(output(page)).toContainText('chunk-020', { timeout: 30_000 });
      if (enabled) {
        await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);
        const height = await scroller(page).evaluate((el) => el.scrollHeight);
        await expect
          .poll(() => scroller(page).evaluate((el) => el.scrollHeight))
          .toBeGreaterThan(height);
        await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);
        await scroller(page).hover();
        await page.mouse.wheel(0, -600);
        await expect.poll(() => gap(page)).toBeGreaterThan(200);
        const top = await scroller(page).evaluate((el) => el.scrollTop);
        await expect(output(page)).toContainText('chunk-070', { timeout: 30_000 });
        await expect
          .poll(() => scroller(page).evaluate((el) => el.scrollTop))
          .toBeLessThanOrEqual(top + 2);
      } else {
        await expect.poll(() => gap(page)).toBeGreaterThan(200);
        const top = await scroller(page).evaluate((el) => el.scrollTop);
        await expect(output(page)).toContainText('chunk-070', { timeout: 30_000 });
        expect(await scroller(page).evaluate((el) => el.scrollTop)).toBeLessThanOrEqual(top + 2);
      }
      await page
        .getByRole('button', { name: 'Scroll to bottom', exact: true })
        .and(page.locator(':not([data-msg-id])'))
        .click();
      await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);
      await expect(output(page)).toContainText('chunk-090', { timeout: 30_000 });
      await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);

      // Sidebar navigation preserves the outgoing cache; New chat clears it.
      // Keep both chats running while the return visit revalidates that cache.
      if (otherId) {
        await row(page, otherId).click();
        await selectMockEndpoint(page, MOCK_ENDPOINTS[0]);
        await sendMessage(page, 'E2E_RUNNING_REPLY:scroll-other');
        await expect(output(page)).toContainText('chunk-005', { timeout: 30_000 });
        let release!: () => void;
        const historyGate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let requested!: (route: Route) => void;
        const historyRequested = new Promise<Route>((resolve) => {
          requested = resolve;
        });
        await page.route(
          (url) => url.pathname === `/api/messages/${id}`,
          async (route) => {
            const response = await route.fetch();
            requested(route);
            await historyGate;
            await route.fulfill({ response });
          },
          { times: 1 },
        );
        try {
          await row(page, id).click();
          const historyRoute = await historyRequested;
          await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);
          await scroller(page).hover();
          await page.mouse.wheel(0, -600);
          await expect.poll(() => gap(page)).toBeGreaterThan(200);
          const top = await scroller(page).evaluate((el) => el.scrollTop);
          const historyReturned = page.waitForResponse(
            (response) => response.request() === historyRoute.request(),
          );
          release();
          expect(await (await historyReturned).finished()).toBeNull();
          await expect(output(page)).toContainText('chunk-130', { timeout: 30_000 });
          expect(await scroller(page).evaluate((el) => el.scrollTop)).toBeLessThanOrEqual(top + 2);
          await expect.poll(() => gap(page)).toBeGreaterThan(200);
        } finally {
          release();
        }
      } else {
        await page.getByRole('link', { name: 'New chat', exact: true }).click();
        await row(page, id).click();
        await expect(output(page)).toContainText('chunk-100', { timeout: 30_000 });
        await expect.poll(() => gap(page)).toBeGreaterThan(200);
      }
      await page.getByRole('button', { name: 'Stop generating', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toBeHidden();
      if (otherId) {
        await row(page, otherId).click();
        await page.getByRole('button', { name: 'Stop generating', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Stop generating', exact: true }),
        ).toBeHidden();
      }
    });
  }
});
