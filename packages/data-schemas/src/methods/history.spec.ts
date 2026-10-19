import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { HistoryCursor } from 'librechat-data-provider';
import { createHistoryMethods } from './history';
import { createMessageMethods } from './message';
import { createModels } from '../models';

let mongo: MongoMemoryServer;
const scope = { user: 'history-owner', conversationId: 'history-fixture' };
const methods = createHistoryMethods(mongoose);
const body = 'Synthetic attachment body. '.repeat(16_384);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  createModels(mongoose);
  await mongoose.connect(mongo.getUri());
  await mongoose.models.Message.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await mongoose.models.Message.deleteMany({});
  await mongoose.models.Message.collection.insertMany(
    Array.from({ length: 101 }, (_, i) => ({
      ...scope,
      messageId: String(i).padStart(4, '0'),
      parentMessageId: String(i - 1).padStart(4, '0'),
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(i / 3))),
      updatedAt: new Date('2026-01-01'),
      text: `Synthetic message ${i}`,
      privateText: 'private',
      attachments: [
        { filename: 'synthetic.txt', text: body, textFormat: 'text', bytes: body.length },
      ],
      files: [{ file_id: 'uploaded', filename: 'upload.txt', text: body }],
      summary: 'Synthetic model summary',
    })),
  );
});

test('pages backwards without skips or duplicates across tied timestamps, and projects bodies in Mongo', async () => {
  let before: HistoryCursor | undefined;
  const ids: string[] = [];
  do {
    const page = await methods.getDisplayMessages({
      ...scope,
      lazyAttachments: true,
      page: { limit: 24, before },
    });
    expect(page.messages.length).toBeLessThanOrEqual(24);
    expect(JSON.stringify(page)).not.toContain('Synthetic attachment body');
    expect(JSON.stringify(page)).not.toContain('private');
    ids.unshift(...page.messages.map((message) => message.messageId));
    before = page.nextCursor ?? undefined;
  } while (before);
  expect(ids).toEqual(Array.from({ length: 101 }, (_, i) => String(i).padStart(4, '0')));
  const full = await methods.getDisplayMessages({ ...scope, lazyAttachments: false });
  expect(full.messages).toHaveLength(101);
  expect(full.messages[0].attachments?.[0]).toHaveProperty('text', body);
  expect(full.messages[0].files?.[0]).toHaveProperty('text', body);
  const modelHistory = await createMessageMethods(mongoose).getMessages(scope);
  expect(modelHistory).toHaveLength(101);
  expect(modelHistory[0]).toMatchObject({
    summary: 'Synthetic model summary',
    attachments: [{ text: body }],
  });
  const plan = await mongoose.models.Message.collection
    .find(scope)
    .sort({ createdAt: -1, _id: -1 })
    .limit(25)
    .explain('executionStats');
  expect(plan.executionStats.totalDocsExamined).toBeLessThanOrEqual(25);
});

test('revalidates the complete loaded span including new replies and deletions', async () => {
  const page = await methods.getDisplayMessages({
    ...scope,
    lazyAttachments: true,
    page: { limit: 24 },
  });
  await mongoose.models.Message.deleteOne({ ...scope, messageId: '0085' });
  await mongoose.models.Message.collection.insertOne({
    ...scope,
    messageId: '0101',
    parentMessageId: '0100',
    createdAt: new Date('2026-01-02'),
    text: 'New reply',
  });
  const refreshed = await methods.getDisplayMessages({
    ...scope,
    lazyAttachments: true,
    page: { since: page.start! },
  });
  expect(refreshed.messages.map((message) => message.messageId)).toEqual([
    ...page.messages.map((message) => message.messageId).filter((id) => id !== '0085'),
    '0101',
  ]);
});

test('scopes history and embedded bodies to the owner and exact tenant', async () => {
  await mongoose.models.Message.collection.insertOne({
    ...scope,
    tenantId: 'other-tenant',
    messageId: 'tenant-message',
    createdAt: new Date('2026-01-03'),
    attachments: [{ text: 'other tenant body' }],
  });
  expect(
    (await methods.getDisplayMessages({ ...scope, lazyAttachments: true })).messages,
  ).toHaveLength(101);
  expect(
    (
      await methods.getDisplayMessages({
        ...scope,
        tenantId: 'other-tenant',
        lazyAttachments: true,
      })
    ).messages,
  ).toHaveLength(1);
  expect(
    (await methods.getDisplayMessages({ ...scope, user: 'stranger', lazyAttachments: true }))
      .messages,
  ).toEqual([]);
  expect(await methods.getHistoryAttachment({ ...scope, messageId: '0002', index: 0 })).toEqual({
    text: body,
    textFormat: 'text',
  });
  expect(
    await methods.getHistoryAttachment({ ...scope, user: 'stranger', messageId: '0002', index: 0 }),
  ).toBeNull();
  expect(
    await methods.getHistoryAttachment({ ...scope, messageId: 'tenant-message', index: 0 }),
  ).toBeNull();
  expect(await methods.getHistoryAttachment({ ...scope, messageId: '0002', index: 1 })).toBeNull();
  expect(
    await methods.getHistoryAttachment({
      ...scope,
      messageId: '0002',
      index: 0,
      revision: '2025-01-01T00:00:00.000Z',
    }),
  ).toBeNull();
});
