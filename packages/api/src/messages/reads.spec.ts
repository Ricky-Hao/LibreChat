import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { messageReadsConfigSchema } from 'librechat-data-provider';
import { createMethods, createModels, tenantStorage } from '@librechat/data-schemas';
import type { AllMethods, IMessage } from '@librechat/data-schemas';
import type { Request } from 'express';
import { createMessageRequestMiddleware } from '~/middleware/messageValidation';
import { createMessageReadHandler } from './reads';

const conversationId = '00000000-0000-4000-8000-000000000001';
const otherConversation = '00000000-0000-4000-8000-000000000002';
const childConversation = '00000000-0000-4000-8000-000000000003';
const now = new Date('2026-10-01T12:00:00.123Z');
let mongo: MongoMemoryServer;
let methods: AllMethods;
let app: express.Express;
let Message: mongoose.Model<IMessage>;
let limits = messageReadsConfigSchema.parse({});
const identity = { conversationId, messageId: 'm' };
const url = (op: string) => `/api/message-reads/${op}`;
const bounded = (response: request.Response, status = 200) => {
  expect(response.status).toBe(status);
  expect(Buffer.byteLength(response.text)).toBeLessThanOrEqual(limits.responseBytes);
  expect(response.headers['x-librechat-message-reads']).toBe('2');
  expect(response.text).not.toMatch(/private-sentinel|secret-sentinel|stack trace/);
};
async function seed(messageId = 'm', values: Record<string, unknown> = {}) {
  await Message.collection.insertOne({
    user: 'owner',
    conversationId,
    messageId,
    parentMessageId: 'root',
    createdAt: now,
    updatedAt: now,
    isCreatedByUser: false,
    ...values,
  });
}
async function content(query: Record<string, unknown> = {}) {
  const res = await request(app)
    .get(url('content'))
    .query({ ...identity, ...query });
  bounded(res);
  return res.body;
}
async function reconstruct(ref: string, field: string, index?: number, expected?: string) {
  let query: Record<string, unknown> = {
    ref,
    field,
    ...(index === undefined ? {} : { index }),
    maxBytes: 257,
  };
  let result = '';
  let offset = 0;
  let pages = 0;
  do {
    const response = await request(app).get(url('read')).query(query);
    bounded(response);
    expect(response.body.offsetBytes).toBe(offset);
    expect(response.body.complete).toBe(response.body.nextCursor === null);
    result += response.body.data;
    offset += Buffer.byteLength(response.body.data);
    query = response.body.nextCursor ? { cursor: response.body.nextCursor } : {};
    expect(++pages).toBeLessThan(10_000);
  } while (query.cursor);
  if (expected !== undefined) expect(result).toBe(expected);
  return result;
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose);
  Message = mongoose.models.Message as mongoose.Model<IMessage>;
  const validation = createMessageRequestMiddleware({
    getConvo: (user, convo, tenant) =>
      convo == null ? Promise.resolve(null) : methods.getConvoOwnership(user, convo, tenant),
    getJob: async () => null,
    isPendingActionStale: () => true,
    logger: { warn: () => undefined },
  });
  app = express();
  app.use((req, _res, next) => {
    if (req.headers['x-user'] === 'anonymous') return next();
    const tenantId =
      typeof req.headers['x-tenant'] === 'string' ? req.headers['x-tenant'] : undefined;
    (req as Request & { user: { id: string; tenantId?: string } }).user = {
      id: String(req.headers['x-user'] ?? 'owner'),
      tenantId,
    };
    if (tenantId) tenantStorage.run({ tenantId }, next);
    else next();
  });
  const deps = {
    getMessageReadMetadata: (...args: Parameters<typeof methods.getMessageReadMetadata>) =>
      methods.getMessageReadMetadata(...args),
    getMessageReadContent: (...args: Parameters<typeof methods.getMessageReadContent>) =>
      methods.getMessageReadContent(...args),
    validate: (req: Request) =>
      validation.createMessageRequestValidation(
        {
          method: req.method,
          params: req.params,
          user: (req as Request & { user: { id: string } }).user,
        },
        { explicitTenantScope: true },
      ),
    getLimits: async () => limits,
    getCursorKey: () => 'synthetic-reader-signing-key',
  };
  for (const op of ['list', 'content', 'read'] as const)
    app.get(url(op), createMessageReadHandler(deps, op));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  jest.restoreAllMocks();
  limits = messageReadsConfigSchema.parse({});
  await Message.deleteMany({});
  await mongoose.models.Conversation.deleteMany({});
  await mongoose.models.Conversation.collection.insertMany([
    { conversationId, user: 'owner' },
    { conversationId: otherConversation, user: 'owner' },
    { conversationId, user: 'owner', tenantId: 'tenant-b' },
    {
      conversationId: childConversation,
      user: 'owner',
      subagentThread: { parentConversationId: conversationId },
    },
  ]);
});

it('positive metadata projection excludes bodies and opt-in context at the database boundary', async () => {
  await seed('m', {
    text: '巨'.repeat(300_000),
    content: [{ type: 'text', text: 'x'.repeat(500_000) }],
    metadata: {
      usage: { input: '12', future: [1, '2', null], credential: 'secret-sentinel' },
      contextUsage: { contextBudget: 8192, private: 'private-sentinel' },
    },
    langfuseRunId: 'private-sentinel',
  });
  const source = methods.getMessageReadMetadata;
  const rows: unknown[] = [];
  jest.spyOn(methods, 'getMessageReadMetadata').mockImplementation(async (input) => {
    const result = await source(input);
    rows.push(result);
    return result;
  });
  const a = await request(app).get(url('list')).query(identity);
  bounded(a);
  expect(a.body.items[0].metadata).toEqual({ usage: { input: '12', future: [1, '2', null] } });
  expect(a.body.items[0].omittedFields).toEqual(['metadata.usage']);
  const b = await request(app)
    .get(url('list'))
    .query({ ...identity, includeContext: true });
  bounded(b);
  expect(b.body.items[0].metadata.contextUsage).toEqual({ contextBudget: 8192 });
  expect(JSON.stringify(rows[0])).not.toContain('contextBudget');
  expect(Buffer.byteLength(JSON.stringify(rows))).toBeLessThan(2000);
});
it.each([undefined, null, {}, { output: 2 }, { future: [1, '2', null] }])(
  'preserves usage without invented counts: %p',
  async (usage) => {
    await seed('m', usage === undefined ? {} : { metadata: { usage } });
    const response = await request(app).get(url('list')).query(identity);
    bounded(response);
    const item = response.body.items[0];
    if (usage === undefined) expect(item.metadata).toBeUndefined();
    else expect(item.metadata.usage).toEqual(usage);
    expect(item.callCounts).toBeUndefined();
    expect(item.unfinished).toBeUndefined();
    expect(item.completed).toBeUndefined();
  },
);
it.each([undefined, 'stop', 'length', 'tool_calls'])(
  'preserves stored finish_reason without completion inference: %p',
  async (reason) => {
    await seed('m', {
      ...(reason === undefined ? {} : { finish_reason: reason }),
      thread_id: 'public-thread',
      langfuseRunId: 'private-sentinel',
    });
    const r = await request(app).get(url('list')).query(identity);
    bounded(r);
    expect(r.body.items[0].finish_reason).toBe(reason);
    expect(r.body.items[0].thread_id).toBe('public-thread');
    expect(r.body.items[0].unfinished).toBeUndefined();
    expect(r.body.items[0].error).toBeUndefined();
  },
);
it.each(['createdAt', 'updatedAt'])(
  'pages all branches with exact ties, bounds and directions: %s',
  async (timeField) => {
    for (const messageId of ['a', 'b', 'c', 'd'])
      await seed(messageId, {
        parentMessageId: messageId === 'c' ? 'branch' : null,
        updatedAt: new Date(now.getTime() + (messageId === 'd' ? 1 : 0)),
      });
    for (const direction of ['asc', 'desc']) {
      let query: Record<string, unknown> = {
        conversationId,
        timeField,
        direction,
        limit: 1,
        from: now.toISOString(),
        to: new Date(now.getTime() + 2).toISOString(),
      };
      const ids: string[] = [];
      do {
        const r = await request(app).get(url('list')).query(query);
        bounded(r);
        expect(r.body.consistency).toBe('live');
        ids.push(...r.body.items.map((v: { messageId: string }) => v.messageId));
        query = r.body.nextCursor ? { cursor: r.body.nextCursor } : {};
      } while (query.cursor);
      expect(ids).toEqual(direction === 'asc' ? ['a', 'b', 'c', 'd'] : ['d', 'c', 'b', 'a']);
    }
    const missing = await request(app)
      .get(url('list'))
      .query({ ...identity, messageId: 'absent' });
    bounded(missing);
    expect(missing.body.items).toEqual([]);
  },
);
it('projects descriptor windows and string segments before Node hydration', async () => {
  const giant = '中😀\n"\\\u0000'.repeat(50_000);
  await seed('m', {
    text: giant,
    content: [
      {
        type: 'tool_call',
        tool_call: {
          id: 'call',
          name: 'run_tools_with_bash',
          args: { giant },
          output: giant,
          subagent_content: [{ type: 'text', text: giant }],
        },
      },
      { type: 'text', text: giant },
    ],
  });
  const source = methods.getMessageReadContent;
  const sizes: number[] = [];
  jest.spyOn(methods, 'getMessageReadContent').mockImplementation(async (input) => {
    const row = await source(input);
    sizes.push(Buffer.byteLength(JSON.stringify(row)));
    expect(JSON.stringify(row)).not.toContain(giant);
    expect(row).not.toHaveProperty('content');
    expect(row).not.toHaveProperty('text');
    return row;
  });
  const first = await content({ limit: 1 });
  expect(first.items[0].children).toEqual({ ancestry: [0], omitted: true });
  expect(first.items[0].fields).toEqual(['entry', 'args', 'output']);
  expect(first.items[0].bytes).toBeUndefined();
  const next = await request(app).get(url('content')).query({ cursor: first.nextCursor });
  bounded(next);
  expect(next.body.items[0].index).toBe(1);
  const body = await request(app)
    .get(url('read'))
    .query({ ref: first.ref, field: 'output', index: 0, maxBytes: 257 });
  bounded(body);
  expect(body.body.representation).toBe('utf8');
  expect(body.body.totalBytes).toBeUndefined();
  expect(Math.max(...sizes)).toBeLessThan(5000);
  console.info(
    JSON.stringify({
      projectedDescriptorAndStringResultMaxBytes: Math.max(...sizes),
      syntheticFieldBytes: Buffer.byteLength(giant),
    }),
  );
});
it('reconstructs string, JSON-looking string, structured args and escaped Unicode using cursor only', async () => {
  const text = '中😀\n"\\\u0000'.repeat(1000);
  const args = { script: text };
  await seed('m', {
    text,
    content: [{ type: 'tool_call', tool_call: { args, output: '{"literal":true}' } }],
  });
  const first = await content();
  await reconstruct(first.ref, 'text', undefined, text);
  await reconstruct(first.ref, 'args', 0, JSON.stringify(args));
  const r = await request(app)
    .get(url('read'))
    .query({ ref: first.ref, field: 'output', index: 0 });
  bounded(r);
  expect(r.body.representation).toBe('utf8');
  expect(r.body.data).toBe('{"literal":true}');
});
it('explicit nested scope and public entry projection exclude descendants and private fields', async () => {
  await seed('m', {
    content: [
      {
        type: 'tool_call',
        tool_call: {
          args: 'a',
          output: 'b',
          backgroundTask: { status: 'completed', resultClaim: { value: 'private-sentinel' } },
          subagent_content: [
            {
              type: 'tool_call',
              tool_call: { output: 'child', subagent_content: [{ type: 'text', text: 'deep' }] },
            },
          ],
        },
      },
    ],
  });
  const first = await content();
  const entry = JSON.parse(await reconstruct(first.ref, 'entry', 0));
  expect(entry.tool_call.subagent_content).toBeUndefined();
  expect(entry.tool_call.backgroundTask).toEqual({ status: 'completed' });
  const child = await request(app).get(url('content')).query({ ref: first.ref, ancestry: '0' });
  bounded(child);
  expect(child.body.ancestry).toEqual([0]);
  await reconstruct(child.body.ref, 'output', 0, 'child');
  const deep = await request(app)
    .get(url('content'))
    .query({ ref: child.body.ref, ancestry: '0,0' });
  bounded(deep);
  expect(JSON.parse(await reconstruct(deep.body.ref, 'entry', 0))).toEqual({
    type: 'text',
    text: 'deep',
  });
  bounded(await request(app).get(url('read')).query({ ref: child.body.ref, field: 'text' }), 400);
});
it('bounds source-index scanning, including empty tool pages and repeated call IDs', async () => {
  await seed('m', {
    content: [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      ...[1, 2].map((i) => ({ type: 'tool_call', tool_call: { id: 'same', args: i } })),
    ],
  });
  let query: Record<string, unknown> = { ...identity, kind: 'tools', limit: 1 };
  const indices: number[] = [];
  let pages = 0;
  do {
    const r = await request(app).get(url('content')).query(query);
    bounded(r);
    indices.push(...r.body.items.map((item: { index: number }) => item.index));
    query = r.body.nextCursor ? { cursor: r.body.nextCursor } : {};
    pages++;
  } while (query.cursor);
  expect(indices).toEqual([2, 3]);
  expect(pages).toBe(4);
});
it.each(['save', 'edit', 'import', 'settle', 'claim', 'confirm', 'release', 'recreate'])(
  'invalidates references and cursors after supported same-ms %s',
  async (mode) => {
    const task = {
      version: 1,
      taskId: 'task',
      toolName: 'synthetic',
      status: 'completed',
      ...(mode === 'claim' ? {} : { resultClaim: { kind: 'manual', claimId: 'claim' } }),
    };
    await seed('m', {
      text: 'text'.repeat(500),
      __v: 1,
      content: [
        {
          type: 'tool_call',
          tool_call: { id: 'call', output: 'x'.repeat(1000), backgroundTask: task },
        },
        { type: 'text', text: 'next' },
      ],
    });
    const first = await content({ limit: 1 });
    const body = await request(app)
      .get(url('read'))
      .query({ ref: first.ref, field: 'output', index: 0, maxBytes: 100 });
    bounded(body);
    // Freeze application timestamps: revision must do the fencing, not clock resolution.
    const clock = jest.spyOn(mongoose, 'now').mockReturnValue(now);
    if (mode === 'save')
      await methods.saveMessage({ userId: 'owner' }, { ...identity, text: 'new' });
    if (mode === 'edit') await methods.updateMessage('owner', { messageId: 'm', text: 'new' });
    if (mode === 'import')
      await methods.bulkSaveMessages(
        [{ ...identity, user: 'owner', text: 'new', updatedAt: now }],
        true,
      );
    if (mode === 'settle')
      await methods.updateToolCallResult({
        userId: 'owner',
        ...identity,
        toolCallId: 'call',
        output: 'settled',
      });
    if (mode === 'claim') {
      await methods.claimBackgroundToolResults({
        userId: 'owner',
        ...identity,
        taskId: 'task',
        kind: 'manual',
        claimId: 'next',
      });
    }
    if (mode === 'confirm')
      expect(
        await methods.confirmBackgroundToolResultClaim({
          userId: 'owner',
          ...identity,
          taskId: 'task',
          claimId: 'claim',
        }),
      ).toBe(true);
    if (mode === 'release')
      expect(
        await methods.releaseBackgroundToolResultClaims({
          userId: 'owner',
          ...identity,
          kind: 'manual',
          claimId: 'claim',
        }),
      ).toBe(true);
    if (mode === 'recreate') {
      await Message.deleteOne({ messageId: 'm' });
      await seed('m', { __v: 1, text: 'new' });
    }
    clock.mockRestore();
    expect((await Message.findOne({ messageId: 'm' }).lean())!.updatedAt).toEqual(now);
    for (const [op, query] of [
      ['content', { cursor: first.nextCursor }],
      ['read', { cursor: body.body.nextCursor }],
      ['read', { ref: first.ref, field: 'output', index: 0 }],
    ] as const) {
      const r = await request(app).get(url(op)).query(query);
      bounded(r, 409);
      expect(r.body.error.code).toBe('STALE_CURSOR');
    }
  },
);
it('documents raw database writes without revision/timestamp changes as outside the consistency guarantee', async () => {
  await seed('m', {
    text: 'old',
    content: [
      { type: 'text', text: 'old' },
      { type: 'text', text: 'next' },
    ],
  });
  const first = await content({ limit: 1 });
  await Message.collection.updateOne({ messageId: 'm' }, { $set: { text: 'raw-new' } });
  const r = await request(app).get(url('read')).query({ ref: first.ref, field: 'text' });
  bounded(r);
  expect(r.body.data).toBe('raw-new');
  // The earlier strict digest tests are retained in task artifacts, not claimed as passing v2.
});
it('binds revision and selected data to the same atomic query despite a subsequent writer', async () => {
  await seed('m', { text: 'old'.repeat(1000) });
  const first = await content();
  const source = methods.getMessageReadContent;
  jest.spyOn(methods, 'getMessageReadContent').mockImplementationOnce(async (input) => {
    const snapshot = await source(input);
    await methods.updateMessageText('owner', { messageId: 'm', text: 'new'.repeat(1000) });
    return snapshot;
  });
  const r = await request(app)
    .get(url('read'))
    .query({ ref: first.ref, field: 'text', maxBytes: 100 });
  bounded(r);
  expect(r.body.data).toBe('old'.repeat(1000).slice(0, 100));
  bounded(await request(app).get(url('read')).query({ cursor: r.body.nextCursor }), 409);
});
it.each(['user', 'tenant', 'expired-message', 'expired-conversation', 'child', 'anonymous'])(
  'rechecks access for cursor-only requests: %s',
  async (mode) => {
    expect.hasAssertions();
    await seed('m', {
      text: 'x'.repeat(1000),
      content: [
        { type: 'text', text: 'x' },
        { type: 'text', text: 'y' },
      ],
    });
    const first = await content({ limit: 1 });
    if (mode === 'expired-message')
      await Message.collection.updateOne({ messageId: 'm' }, { $set: { expiredAt: new Date(0) } });
    if (mode === 'expired-conversation')
      await mongoose.models.Conversation.collection.updateOne(
        { conversationId },
        { $set: { expiredAt: new Date(0) } },
      );
    if (mode === 'child')
      await mongoose.models.Conversation.collection.updateOne(
        { conversationId },
        { $set: { subagentThread: {} } },
      );
    let r = request(app).get(url('content')).query({ cursor: first.nextCursor });
    if (mode === 'user') r = r.set('x-user', 'other');
    if (mode === 'tenant') r = r.set('x-tenant', 'tenant-b');
    if (mode === 'anonymous') r = r.set('x-user', 'anonymous');
    bounded(await r, ['user', 'tenant'].includes(mode) ? 400 : 404);
  },
);
it('rejects token tampering, expiration, operation confusion and mixed scope overrides', async () => {
  expect.hasAssertions();
  await seed('m', {
    content: [
      { type: 'text', text: 'x' },
      { type: 'text', text: 'y' },
    ],
  });
  const first = await content({ limit: 1 });
  bounded(
    await request(app)
      .get(url('content'))
      .query({ cursor: `${first.nextCursor}x` }),
    400,
  );
  bounded(await request(app).get(url('read')).query({ cursor: first.nextCursor }), 400);
  bounded(
    await request(app)
      .get(url('content'))
      .query({ ref: first.ref, conversationId: otherConversation }),
    400,
  );
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_001);
  bounded(await request(app).get(url('content')).query({ cursor: first.nextCursor }), 400);
  clock.mockRestore();
});
it.each([
  ['list', { ...identity, limit: 1 }],
  ['list', { conversationId, includeContext: 'maybe' }],
  ['list', { conversationId, from: '2026-02-30T00:00:00Z' }],
  ['list', { conversationId, limit: 0 }],
  ['list', { conversationId, limit: 101 }],
  ['content', { ...identity, limit: 1.5 }],
  ['content', { ...identity, ancestry: '-1' }],
  ['content', { ...identity, ancestry: 'content.0' }],
  ['content', { ...identity, kind: 'full' }],
  ['content', { cursor: 'x', limit: 1 }],
  ['read', { ...identity, field: 'text' }],
  ['read', { ref: 'x', field: 'output' }],
])('rejects invalid request %s %p', async (op, query) => {
  expect.hasAssertions();
  bounded(
    await request(app)
      .get(url(op as string))
      .query(query as Record<string, unknown>),
    400,
  );
});
it('fits outer JSON budgets under control-character expansion without skipping data', async () => {
  expect.hasAssertions();
  limits = messageReadsConfigSchema.parse({ responseBytes: 4096 });
  const value = '\u0000中😀'.repeat(1000);
  await seed('m', { text: value });
  const first = await content();
  await reconstruct(first.ref, 'text', undefined, value);
});

it('supports historical tool forms, null values and public summary entries', async () => {
  const summary = {
    type: 'summary',
    content: [{ type: 'text', text: 'summary' }],
    boundary: { messageId: 'before', contentIndex: 2 },
  };
  await seed('m', {
    content: [
      {
        type: 'tool_call',
        tool_call: { function: { name: 'legacy', arguments: '{"x":1}', output: null } },
      },
      { type: 'tool_call', tool_call: { code_interpreter: { input: 'print(1)', outputs: ['1'] } } },
      summary,
    ],
  });
  const first = await content();
  expect(first.items[0].name).toBe('legacy');
  await reconstruct(first.ref, 'args', 0, '{"x":1}');
  await reconstruct(first.ref, 'output', 0, 'null');
  await reconstruct(first.ref, 'args', 1, 'print(1)');
  await reconstruct(first.ref, 'output', 1, '["1"]');
  expect(JSON.parse(await reconstruct(first.ref, 'entry', 2))).toEqual(summary);
  bounded(
    await request(app).get(url('read')).query({ ref: first.ref, field: 'args', index: 2 }),
    404,
  );
});

it('does not hydrate private entry metadata or sibling/descendant bodies in the public entry result', async () => {
  await seed('m', {
    content: [
      {
        type: 'text',
        text: {
          value: 'display',
          auth: 'private-sentinel',
          annotations: [
            {
              type: 'citation',
              text: 'label',
              private: 'private-sentinel',
              file_citation: { file_id: 'file', quote: 'quote', secret: 'private-sentinel' },
            },
          ],
        },
        trace: 'private-sentinel',
      },
      { type: 'tool_call', tool_call: { output: 'giant'.repeat(100_000) } },
    ],
  });
  const source = methods.getMessageReadContent;
  jest.spyOn(methods, 'getMessageReadContent').mockImplementation(async (input) => {
    const row = await source(input);
    expect(JSON.stringify(row)).not.toContain('private-sentinel');
    expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThan(4096);
    return row;
  });
  const first = await content();
  const entry = JSON.parse(await reconstruct(first.ref, 'entry', 0));
  expect(entry.text.value).toBe('display');
  expect(entry.text.annotations[0].file_citation).toEqual({ file_id: 'file', quote: 'quote' });
});

it('detects repeated same-ms supported edits and the missing-to-present revision transition', async () => {
  await seed('m', { text: 'before' });
  const clock = jest.spyOn(mongoose, 'now').mockReturnValue(now);
  const a = await content();
  await methods.updateMessageText('owner', { messageId: 'm', text: 'one' });
  const b = await content();
  await methods.updateMessageText('owner', { messageId: 'm', text: 'two' });
  clock.mockRestore();
  expect((await Message.findOne({ messageId: 'm' }).lean())!.updatedAt).toEqual(now);
  expect((await Message.findOne({ messageId: 'm' }).lean())!.__v).toBe(2);
  for (const ref of [a.ref, b.ref])
    bounded(await request(app).get(url('read')).query({ ref, field: 'text' }), 409);
});

it('enforces configured body ceilings, rejects duplicate query values, and bounds safe DB errors', async () => {
  limits = messageReadsConfigSchema.parse({ bodyBytes: 256 });
  await seed('m', { text: 'x'.repeat(1000) });
  const first = await content();
  bounded(
    await request(app).get(url('read')).query({ ref: first.ref, field: 'text', maxBytes: 257 }),
    400,
  );
  bounded(
    await request(app).get(`${url('list')}?conversationId=${conversationId}&limit=1&limit=2`),
    400,
  );
  jest
    .spyOn(methods, 'getMessageReadContent')
    .mockRejectedValueOnce(new Error('secret-sentinel stack trace'));
  const r = await request(app).get(url('read')).query({ ref: first.ref, field: 'text' });
  bounded(r, 503);
  expect(r.body.error.code).toBe('UNAVAILABLE');
});

it.each(['wrong-user', 'wrong-tenant', 'tenantless', 'wrong-conversation', 'child'])(
  'denies initial scoped reads without disclosing content: %s',
  async (mode) => {
    expect.hasAssertions();
    await seed('m', mode === 'tenantless' ? { tenantId: 'tenant-a' } : {});
    let r = request(app)
      .get(url('content'))
      .query({
        ...identity,
        ...(mode === 'wrong-conversation' ? { conversationId: otherConversation } : {}),
        ...(mode === 'child' ? { conversationId: childConversation } : {}),
      });
    if (mode === 'wrong-user') r = r.set('x-user', 'other');
    if (mode === 'wrong-tenant') r = r.set('x-tenant', 'tenant-b');
    bounded(await r, 404);
  },
);

it('rejects malformed message text instead of exporting a legacy metadata object', async () => {
  await seed('m', { text: { value: 'display', auth: 'private-sentinel' } });
  const first = await content();
  const r = await request(app).get(url('read')).query({ ref: first.ref, field: 'text' });
  bounded(r, 422);
  expect(r.body.error.code).toBe('UNSUPPORTED_CONTENT');
});

it('attributes every list/exact/cursor page once and budgets the complete observability envelope', async () => {
  limits = messageReadsConfigSchema.parse({ responseBytes: 4096 });
  const scopedConversation = 'c'.repeat(512);
  await mongoose.models.Conversation.collection.insertOne({
    user: 'owner',
    conversationId: scopedConversation,
  });
  for (let i = 0; i < 6; i++)
    await seed(`m${i}`, { conversationId: scopedConversation, sender: '"'.repeat(600) });
  const verify = (r: request.Response) => {
    bounded(r);
    expect(r.body.conversationId).toBe(scopedConversation);
    expect(r.body.observability).toEqual({
      llmRequests: 'not_recorded',
      ptcInnerCalls: 'not_recorded',
    });
    expect(r.text.match(/"conversationId":/g)).toHaveLength(1);
    expect(r.text.match(/"observability":/g)).toHaveLength(1);
    for (const item of r.body.items) {
      expect(item).not.toHaveProperty('conversationId');
      expect(item).not.toHaveProperty('observability');
    }
  };
  let query: Record<string, unknown> = { conversationId: scopedConversation, limit: 100 };
  const ids: string[] = [];
  let pages = 0;
  do {
    const r = await request(app).get(url('list')).query(query);
    verify(r);
    ids.push(...r.body.items.map((item: { messageId: string }) => item.messageId));
    pages++;
    query = r.body.nextCursor ? { cursor: r.body.nextCursor } : {};
  } while (query.cursor);
  expect(pages).toBeGreaterThan(1);
  expect(ids).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
  for (const messageId of ['m0', 'missing'])
    verify(
      await request(app).get(url('list')).query({ conversationId: scopedConversation, messageId }),
    );
});

it('uses bounded stored name fallbacks, preserves direct precedence, and recovers oversized names through entry', async () => {
  const longName = '中'.repeat(171);
  await seed('m', {
    content: [
      {
        type: 'tool_call',
        tool_call: { name: 'direct', function: { name: 'fallback', arguments: 'args' } },
      },
      {
        type: 'tool_call',
        tool_call: { function: { name: 'function-only', arguments: 'args', output: 'result' } },
      },
      {
        type: 'tool_call',
        tool_call: { code_interpreter: { name: 'stored-code-name', input: 'code', outputs: [] } },
      },
      { type: 'tool_call', tool_call: { code_interpreter: { input: 'code', outputs: [] } } },
      { type: 'tool_call', tool_call: { function: { name: longName, arguments: {} } } },
      { type: 'tool_call', tool_call: { name: null, function: { name: 'not-a-replacement' } } },
    ],
  });
  const page = await content({ kind: 'tools' });
  expect(page.items.map((item: { name?: string | null }) => item.name)).toEqual([
    'direct',
    'function-only',
    'stored-code-name',
    undefined,
    undefined,
    null,
  ]);
  expect(page.items[1].fields).toEqual(['entry', 'args', 'output']);
  expect(page.items[4].omittedFields).toContain('name');
  expect(JSON.parse(await reconstruct(page.ref, 'entry', 4)).tool_call.function.name).toBe(
    longName,
  );
  expect(JSON.parse(await reconstruct(page.ref, 'entry', 2)).tool_call.code_interpreter.name).toBe(
    'stored-code-name',
  );
});

it.each(['', '.1', '.12', '.123'])(
  'accepts UTC seconds with supported fractional precision: %s',
  async (fraction) => {
    const r = await request(app)
      .get(url('list'))
      .query({ conversationId, from: `2026-10-01T00:00:00${fraction}Z` });
    bounded(r);
    expect(r.body.conversationId).toBe(conversationId);
  },
);

it.each(['2026-10-01T00:00:00.1234Z', '2026-10-01T00:00Z', '2026-10-01T00:00:00+00:00'])(
  'rejects timestamps outside the advertised UTC syntax: %s',
  async (from) => {
    const r = await request(app).get(url('list')).query({ conversationId, from });
    bounded(r, 400);
    expect(r.body.error.code).toBe('INVALID_REQUEST');
  },
);
