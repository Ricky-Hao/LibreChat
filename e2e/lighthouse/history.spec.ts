import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { HistoryPage } from 'librechat-data-provider';
import { seedConversations, withMongo } from '../specs/mock/db';
import { getAccessToken } from '../specs/mock/helpers';
import { getE2EUser } from '../setup/user';

const conversationId = '16400000-0000-4000-8000-000000000001';
const fileId = '16400000-0000-4000-8000-000000001000';
const id = (i: number) => `16400000-0000-4000-8000-${String(i + 2).padStart(12, '0')}`;
const body = (i: number, j: number) =>
  `SYNTHETIC_BODY_${i}_${j}\n${'Synthetic file content.\n'.repeat(1400)}`;
const noParent = '00000000-0000-0000-0000-000000000000';

test('large history loads one recent page, preserves an upward anchor, and opens bodies on demand', async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(25_000);
  page.setDefaultNavigationTimeout(30_000);
  const email = getE2EUser().email;
  await seedConversations(email, [
    { conversationId, title: 'Synthetic history window', updatedAt: new Date() },
  ]);
  await withMongo(async (db) => {
    const user = await db.collection('users').findOne({ email });
    if (!user) throw new Error('Missing local fixture user');
    const start = Date.now() - 600_000;
    const messages = Array.from({ length: 541 }, (_, i) => {
      const assistant = i % 2 === 0;
      const attachments = assistant
        ? Array.from({ length: i < 268 ? 2 : 1 }, (_, j) => ({
            filename: `synthetic-${i}-${j}.txt`,
            filepath: `/synthetic-${i}-${j}.txt`,
            ...(i === 540 ? { file_id: fileId, source: 'text', user: user._id.toString() } : {}),
            conversationId,
            messageId: id(i),
            toolCallId: `file-tool-${i}`,
            type: 'execute_code',
            text: body(i, j),
            textFormat: 'text',
            bytes: body(i, j).length,
          }))
        : undefined;
      return {
        user: user._id.toString(),
        conversationId,
        messageId: id(i),
        parentMessageId: i ? id(i - 1) : noParent,
        text: `Synthetic history message ${i}. ${'A bounded display window keeps older stored history available. '.repeat(4)}`,
        sender: assistant ? 'Assistant' : 'User',
        isCreatedByUser: !assistant,
        endpoint: 'openAI',
        model: 'gpt-4o-mini',
        createdAt: new Date(start + Math.floor(i / 3)),
        updatedAt: new Date(start + i),
        attachments,
        ...(assistant
          ? {
              content: [
                { type: 'text', text: `Synthetic history message ${i}.` },
                {
                  type: 'tool_call',
                  tool_call: {
                    id: `file-tool-${i}`,
                    name: 'execute_code',
                    args: '{}',
                    output: 'Synthetic files ready',
                    progress: 1,
                  },
                },
              ],
            }
          : {}),
      };
    });
    await db.collection('messages').insertMany(messages);
    await db.collection('files').insertOne({
      file_id: fileId,
      user: user._id,
      filename: 'synthetic-540-0.txt',
      filepath: '/synthetic-540-0.txt',
      source: 'text',
      type: 'text/plain',
      bytes: body(540, 0).length,
      text: body(540, 0),
      textFormat: 'text',
    });
  });
  const historyRequests: { url: string; recent: boolean; before: boolean; limit: string | null }[] =
    [];
  const bodyRequests: string[] = [];
  const responseStatuses: { path: string; status: number }[] = [];
  const pageErrorNames: string[] = [];
  page.on('pageerror', (error) => pageErrorNames.push(error.name));
  page.on('request', (request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === `/api/messages/${conversationId}`)
      historyRequests.push({
        url: `${url.origin}${path}`,
        recent: url.searchParams.get('history') === 'recent',
        before: url.searchParams.has('before'),
        limit: url.searchParams.get('limit'),
      });
    if (path.includes('/preview') || path.includes('/attachments/'))
      bodyRequests.push(`${url.origin}${path}`);
  });
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (
      path === `/api/messages/${conversationId}` ||
      path.includes('/preview') ||
      path.includes('/attachments/')
    )
      responseStatuses.push({ path, status: response.status() });
  });
  const setAutoScroll = async (enabled: boolean) => {
    await page.getByTestId('nav-user').click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await page
      .getByRole('switch', { name: 'Auto-Scroll to latest message on chat open' })
      .setChecked(enabled);
    await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('autoScroll'))).toBe(String(enabled));
  };
  try {
    await page.goto('/c/new');
    await setAutoScroll(true);
    const firstResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/messages/${conversationId}` &&
        new URL(response.url()).searchParams.get('history') === 'recent',
    );
    await page.goto(`${baseURL}/c/${conversationId}`);
    const initialText = await (await firstResponse).text();
    const initial = JSON.parse(initialText) as HistoryPage;
    expect(initial.messages).toHaveLength(24);
    expect(initial.messages.map((message) => message.messageId)).toEqual(
      Array.from({ length: 24 }, (_, i) => id(517 + i)),
    );
    expect(JSON.stringify(initial)).not.toContain('SYNTHETIC_BODY');
    await expect(page.locator(`[id="${id(540)}"]`)).toBeVisible();
    await expect(page.locator(`[id="${id(540)}"]`)).toBeInViewport();
    await expect(page.getByText('synthetic-540-0.txt', { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(700);
    expect(historyRequests).toHaveLength(1);
    expect(historyRequests[0]).toMatchObject({ recent: true, before: false, limit: '24' });
    expect(bodyRequests).toHaveLength(0);
    const initialRequestCounts = { history: historyRequests.length, bodies: bodyRequests.length };

    const previewResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/files/${fileId}/preview`,
    );
    await page.getByRole('button', { name: 'Preview', exact: true }).last().click();
    expect((await (await previewResponse).json()).text).toBe(body(540, 0));
    const preview = page.getByRole('region', { name: 'synthetic-540-0.txt', exact: true });
    const previewText = preview.frameLocator('iframe').getByText('SYNTHETIC_BODY_540_0', {
      exact: false,
    });
    await expect(previewText).toBeVisible();
    await expect(previewText).toHaveText(body(540, 0), { useInnerText: true });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await preview.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(body(540, 0));
    const artifactDownload = page.waitForEvent('download');
    await preview.getByRole('button', { name: 'Download Artifact', exact: true }).click();
    const artifactPath = await (await artifactDownload).path();
    expect(artifactPath).not.toBeNull();
    expect(await readFile(artifactPath!, 'utf8')).toBe(body(540, 0));
    const card = page.getByRole('group', { name: 'synthetic-540-0.txt', exact: true });
    const fileDownload = page.waitForEvent('download');
    await card
      .getByRole('button', { name: 'Download synthetic-540-0.txt', exact: true })
      .first()
      .click();
    const filePath = await (await fileDownload).path();
    expect(filePath).not.toBeNull();
    expect(await readFile(filePath!, 'utf8')).toBe(body(540, 0));
    await preview.getByRole('button', { name: 'Close', exact: true }).click();
    await card.getByRole('button', { name: 'Hide', exact: true }).click();
    await card.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(previewText).toBeVisible();
    expect(bodyRequests).toHaveLength(1);
    await preview.getByRole('button', { name: 'Close', exact: true }).click();

    const anchorId = id(518);
    const anchor = page.locator(`[id="${anchorId}"]`);
    const olderResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).searchParams.has('before') &&
        new URL(response.url()).pathname === `/api/messages/${conversationId}`,
    );
    await anchor.evaluate((row) => {
      const container = row.closest('.scrollbar-gutter-stable') as HTMLElement;
      container.scrollTop = 1;
    });
    const before = await anchor.boundingBox();
    const older = (await (await olderResponse).json()) as HistoryPage;
    expect(older.messages).toHaveLength(24);
    expect(older.messages.map((message) => message.messageId)).toEqual(
      Array.from({ length: 24 }, (_, i) => id(493 + i)),
    );
    expect(
      new Set([...older.messages, ...initial.messages].map((message) => message.messageId)).size,
    ).toBe(48);
    await expect(page.locator(`[id="${older.messages[0].messageId}"]`)).toBeAttached();
    await expect
      .poll(async () => Math.abs((await anchor.boundingBox())!.y - before!.y))
      .toBeLessThan(3);
    const anchorShiftPx = Math.abs((await anchor.boundingBox())!.y - before!.y);

    const token = await getAccessToken(page);
    const fullResponse = await page.request.get(`/api/messages/${conversationId}?toolPreviews=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(fullResponse.ok()).toBe(true);
    const fullText = await fullResponse.text();
    const full = JSON.parse(fullText) as HistoryPage['messages'];
    expect(full).toHaveLength(541);
    expect(full.flatMap((message) => message.attachments ?? [])).toHaveLength(405);
    expect(fullText).toContain('SYNTHETIC_BODY_540_0');
    await writeFile(
      testInfo.outputPath('payload.json'),
      JSON.stringify(
        {
          fixture: {
            messages: 541,
            attachments: 405,
            attachmentTextBytes: full
              .flatMap((message) => message.attachments ?? [])
              .reduce((sum, file) => sum + Buffer.byteLength((file as { text: string }).text), 0),
          },
          initial: {
            messages: initial.messages.length,
            decodedJsonBytes: Buffer.byteLength(initialText),
          },
          full: { messages: full.length, decodedJsonBytes: Buffer.byteLength(fullText) },
          historyRequests: historyRequests.length,
          bodyRequests: bodyRequests.length,
          initialRequestCounts,
          older: { messages: older.messages.length, anchorShiftPx },
        },
        null,
        2,
      ),
    );
    await page.goto('/c/new');
    await setAutoScroll(false);
    const disabledResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/messages/${conversationId}` &&
        !new URL(response.url()).searchParams.has('history'),
    );
    await page.goto(`${baseURL}/c/${conversationId}`);
    expect((await (await disabledResponse).json()).length).toBe(541);
    await expect(page.locator(`[id="${id(0)}"]`)).toBeVisible();
    await expect(page.locator(`[id="${id(0)}"]`)).toBeInViewport();
  } catch (error) {
    await writeFile(
      testInfo.outputPath('diagnostics.json'),
      JSON.stringify(
        {
          path: new URL(page.url()).pathname,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          historyRequests,
          bodyRequests,
          responseStatuses,
          pageErrorNames,
        },
        null,
        2,
      ),
    );
    throw error;
  }
});
