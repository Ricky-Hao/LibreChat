import { expect, test } from '@playwright/test';
import {
  seedConversations,
  seedMessages,
  deleteMessagesByConversation,
  deleteConversations,
} from './db';
import { getE2EUser } from '../../setup/user';

test('a completed foreground child survives a hard reload with preview-only history', async ({
  page,
}) => {
  const conversationId = '16390000-0000-4000-8000-000000000011';
  const email = getE2EUser().email;
  await seedConversations(email, [
    { conversationId, title: 'Subagent recovery fixture', updatedAt: new Date() },
  ]);
  await seedMessages(email, conversationId, [
    {
      messageId: 'recovery-user',
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      text: 'Review the fixture.',
      isCreatedByUser: true,
      sender: 'User',
    },
    {
      messageId: 'recovery-parent',
      parentMessageId: 'recovery-user',
      text: '',
      isCreatedByUser: false,
      sender: 'Assistant',
      content: [
        {
          type: 'tool_call',
          tool_call: {
            id: 'recovery-call',
            type: 'tool_call',
            name: 'subagent',
            args: '{"task":"Review the fixture."}',
            output: 'Done.',
            progress: 1,
            runStepStatus: 'completed',
            stepId: 'recovery-step',
            subagent_content: [
              ...Array.from({ length: 26 }, (_, index) => ({
                type: 'tool_call',
                tool_call: {
                  id: `child-${index}`,
                  name: 'fixture_tool',
                  args: '{}',
                  output: 'ok',
                  progress: 1,
                },
              })),
              ...Array.from({ length: 5 }, (_, index) => ({
                type: 'text',
                text: `Recovered browser child ${index}`,
                phase: index === 4 ? 'final_answer' : 'commentary',
              })),
            ],
          },
        },
      ],
    },
  ]);
  try {
    for (const coldReload of [false, true]) {
      const history = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/messages/${conversationId}`) &&
          response.request().method() === 'GET',
      );
      if (coldReload) await page.reload();
      else await page.goto(`/c/${conversationId}`);
      const messages = await (await history).json();
      const stored = messages.find(
        (message: { messageId: string }) => message.messageId === 'recovery-parent',
      );
      expect(stored.content[0].tool_call).toMatchObject({
        subagentContentOmitted: true,
        subagentContentParts: 31,
        output: 'Done.',
      });
      expect(stored.content[0].tool_call.subagent_content).toBeUndefined();
      const detail = page.waitForResponse(
        (response) =>
          response.url().includes('/parts/') && response.url().includes('recovery-parent'),
      );
      await page.locator('[data-subagent-tool-call="recovery-call"]').click();
      expect((await detail).ok()).toBe(true);
      const panel = page.getByRole('region', { name: 'Child agent activity' });
      await expect(panel.getByText('Recovered browser child 4')).toBeVisible();
      await expect(panel.getByText('Recovered browser child 0')).toBeVisible();
      await panel.getByRole('button', { name: /Ran 26 actions/ }).click();
      await expect(panel.locator('[data-tool-call-id^="child-"]')).toHaveCount(26);
    }
  } finally {
    await deleteMessagesByConversation([conversationId]);
    await deleteConversations([conversationId]);
  }
});
