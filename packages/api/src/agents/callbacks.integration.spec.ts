import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AgentCapabilities } from 'librechat-data-provider';
import { AIMessage } from '@librechat/agents/langchain/messages';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createModels, createMethods, runAsSystem } from '@librechat/data-schemas';
import {
  FakeChatModel,
  GraphEvents,
  HandlerRegistry,
  Providers,
  StandardGraph,
  SubagentExecutor,
  ToolNode,
} from '@librechat/agents';
import type { TaskCallbackRecord } from '@librechat/data-schemas';
import type { Server } from 'node:http';
import type { AgentTriggerService, AgentTriggerDeliveryPersistence } from './triggers/service';
import type { TaskCallbackLifecycle } from './callbacks';
import type { ServerRequest } from '~/types';
import {
  createTaskCallbackTool,
  createTaskCallbackLifecycle,
  TASK_CALLBACK_SOURCE,
  TASK_CALLBACK_TOOL,
} from './callbacks';
import { buildSubagentThreadTaskConfig, createSubagentThreadTaskStore } from './subagentThreads';
import { createAgentContinuationResolver } from './triggers/continuation';
import { createAgentTriggerExecutionHost } from './triggers/host';
import { createAgentTriggerService } from './triggers/service';
import { __resetShutdownStateForTests } from '../app/shutdown';
import { createToolExecuteHandler } from './handlers';

let mongo: MongoMemoryServer;
let service: AgentTriggerService;
let callbacks: TaskCallbackLifecycle;
let methods: ReturnType<typeof createMethods>;
let server: Server | undefined;
const user = new mongoose.Types.ObjectId().toString();
const settings = { enabled: true, publicUrl: 'http://127.0.0.1:3080/api/agents/task-callbacks' };
let fetcher: jest.Mock;
let job: { status: string; metadata?: { idempotencyClientRequestId?: string } } | null;
const fixtureKey = randomBytes(32);
async function encrypt(value: string): Promise<string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', fixtureKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((v) => v.toString('hex')).join(':');
}
async function decrypt(value: string): Promise<string> {
  const [iv, tag, encrypted] = value.split(':').map((v) => Buffer.from(v, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', fixtureKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { autoIndex: false });
  createModels(mongoose);
}, 60000);

beforeEach(async () => {
  methods = createMethods(mongoose);
  job = null;
  fetcher = jest.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        status: 'started',
        streamId: body.conversationId,
        conversationId: body.conversationId,
        generationCreatedAt: 25,
      }),
      { status: 200 },
    );
  });
  callbacks = createTaskCallbackLifecycle({
    methods,
    getConfig: async () => ({ endpoints: { agents: { taskCallbacks: settings } } }),
    getGenerationJob: async () => job,
    enqueue: (...args) => service.enqueue(...args),
  });
  service = createAgentTriggerService({
    methods: methods as typeof methods & AgentTriggerDeliveryPersistence,
    fetch: fetcher,
    mintToken: () => 'fixture-internal-trigger-token',
    isPrincipalActive: async () => true,
    prepareContinue: createAgentContinuationResolver({
      eventActor: async () => undefined,
      internalSources: new Map([[TASK_CALLBACK_SOURCE, callbacks.prepareContinue]]),
    }),
    deliveryOptions: { concurrency: 2, tickMs: 5, retryBaseMs: 5 },
  });
  await service.initialize({ address: { address: '127.0.0.1', family: 'IPv4', port: 3080 } });
  await callbacks.initialize();
  await mongoose.models.Conversation.create({
    user,
    conversationId: 'original',
    agent_id: 'agent-1',
    endpoint: 'agents',
  });
  await message('anchor', 'user-turn');
});

afterEach(async () => {
  await callbacks.stop();
  await service.stop();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  __resetShutdownStateForTests();
  await Promise.all(
    [
      'TaskCallback',
      'Conversation',
      'Message',
      'AgentTriggerDelivery',
      'AgentTriggerLaneSequence',
      'AgentTriggerUserPurge',
    ].map((name) => mongoose.models[name].deleteMany({})),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
}, 60000);

async function message(id: string, parent: string, extra = {}) {
  await mongoose.models.Message.create({
    user,
    conversationId: 'original',
    messageId: id,
    parentMessageId: parent,
    isCreatedByUser: false,
    text: '',
    ...extra,
  });
}
function callbackTool(
  agentId = 'agent-1',
  resolvedConversation?: ServerRequest['resolvedConversation'],
) {
  return createTaskCallbackTool({
    agentId,
    methods,
    encrypt,
    decrypt,
    req: {
      user: { id: user },
      resolvedConversation,
      config: {
        endpoints: {
          agents: { taskCallbacks: settings, capabilities: [AgentCapabilities.task_callbacks] },
        },
      },
    } as Pick<ServerRequest, 'user' | 'config' | 'resolvedConversation'>,
  });
}
async function registration({
  agentId = 'agent-1',
  conversationId = 'original',
  messageId = 'anchor',
} = {}) {
  const tool = callbackTool(agentId);
  const result = await tool.invoke(
    { type: 'tool_call', name: 'create_task_callback', id: 'call-1', args: {} },
    { configurable: { requestBody: { messageId, conversationId } } },
  );
  const value = JSON.parse(typeof result === 'string' ? result : (result.content as string));
  expect(value.callback_id).toMatch(/^tcb_[A-Za-z0-9_-]{43}$/);
  return { tool, value };
}

async function childRegistration(
  agentId: string,
  { eventDriven = false, background = false } = {},
) {
  const tool = callbackTool(agentId);
  const invoke = jest.spyOn(tool, 'invoke');
  const registry = new HandlerRegistry();
  registry.register(
    GraphEvents.ON_TOOL_EXECUTE,
    createToolExecuteHandler({ loadTools: async () => ({ loadedTools: [tool] }) }),
  );
  const store = background ? createSubagentThreadTaskStore(methods) : undefined;
  const taskConfig = store
    ? buildSubagentThreadTaskConfig(store, { userId: user, parentConversationId: 'original' })
    : undefined;
  const executor = new SubagentExecutor({
    parentRunId: 'anchor',
    parentAgentId: 'agent-1',
    parentHandlerRegistry: registry,
    taskConfig,
    configs: new Map([
      [
        agentId,
        {
          type: agentId,
          name: 'Callback fixture child',
          description: 'Register a callback from an isolated child execution.',
          maxTurns: 2,
          agentInputs: {
            agentId,
            provider: Providers.OPENAI,
            clientOptions: {
              model: 'gpt-4o-mini',
              apiKey: 'fixture-key',
              streaming: true,
              streamUsage: false,
            },
            tools: eventDriven ? [] : [tool],
            ...(eventDriven
              ? {
                  toolDefinitions: [
                    { name: TASK_CALLBACK_TOOL, parameters: { type: 'object', properties: {} } },
                  ],
                }
              : {}),
          },
        },
      ],
    ]),
    tokenCounter: (text) => String(text ?? '').length,
    createChildGraph: (input) => {
      const graph = new StandardGraph(input);
      graph.overrideModel = new FakeChatModel({
        responses: ['Callback fixture.'],
        toolCalls: [{ name: TASK_CALLBACK_TOOL, args: {}, id: 'call-1', type: 'tool_call' }],
      });
      return graph;
    },
  });
  const params = {
    description: 'Register an external task callback.',
    subagentType: agentId,
    parentToolCallId: 'spawn-call',
    threadId: 'original',
    parentConfigurable: {
      thread_id: 'original',
      user_id: user,
      requestBody: { messageId: 'anchor', conversationId: 'original' },
    },
  };
  try {
    if (store && taskConfig) {
      const handle: { background_task_id: string; subagent_thread_id: string } = JSON.parse(
        executor.executeInBackground(params),
      );
      await eventually(
        async () =>
          store.get(taskConfig.scopeId, handle.background_task_id)?.status === 'completed',
      );
      const conversation = await methods.getConvo(user, handle.subagent_thread_id);
      expect(conversation?.subagentThread?.parentConversationId).toBe('original');
      expect(conversation?.agent_id).toBe(agentId);
    } else {
      const result = await executor.execute(params);
      expect(result.error).toBeUndefined();
    }
    expect(invoke).toHaveBeenCalledTimes(1);
    const result: Awaited<ReturnType<typeof tool.invoke>> = await invoke.mock.results[0].value;
    const output = typeof result === 'string' ? result : result.content;
    if (typeof output !== 'string') throw new Error('Missing callback fixture tool output');
    return { value: JSON.parse(output), config: invoke.mock.calls[0][1] };
  } finally {
    await store?.destroyTaskControlTransport();
    store?.destroyActivityStream();
  }
}
function app() {
  const api = express();
  api.use(express.json({ limit: '256kb' }));
  api.post('/api/agents/task-callbacks', callbacks.handler);
  return api;
}
async function eventually(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 6000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('Callback fixture timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const body = (id: string) => ({
  version: 1,
  callback_id: id,
  status: 'success',
  output: 'External result',
});

it('real tool has no routing inputs, encrypts replay, and binds trusted Agent/turn context', async () => {
  const { tool, value } = await registration();
  const { value: replay } = await registration();
  expect(replay).toEqual(value);
  expect(value.guidance).toContain('Registration alone does not end generation');
  const stored = await mongoose.models.TaskCallback.findOne()
    .select('+encryptedId')
    .lean<TaskCallbackRecord>();
  expect(stored?.user).toBe(user);
  expect(stored?.messageId).toBe('anchor');
  expect(JSON.stringify(stored)).not.toContain(value.callback_id);
  await expect(tool.invoke({ target: 'other' })).rejects.toThrow();
});

it.each([
  { agentId: 'agent-1', eventDriven: false, background: false },
  { agentId: 'agent-2', eventDriven: false, background: false },
  { agentId: 'agent-1', eventDriven: true, background: false },
  { agentId: 'agent-2', eventDriven: true, background: false },
  { agentId: 'agent-1', eventDriven: false, background: true },
  { agentId: 'agent-2', eventDriven: true, background: true },
])(
  'rejects SDK child $agentId (event-driven: $eventDriven, detached: $background)',
  async ({ agentId, eventDriven, background }) => {
    const register = jest.spyOn(methods, 'registerTaskCallback');
    const { value, config } = await childRegistration(agentId, { eventDriven, background });
    expect(config?.metadata?.executionContext).toMatchObject({ depth: 1 });
    expect(config?.configurable?.requestBody).toMatchObject({
      conversationId: 'original',
      messageId: 'anchor',
    });
    expect(value.error).toBe('CALLBACK_UNSUPPORTED_CONTEXT');
    expect(value.callback_id).toBeUndefined();
    expect(value.guidance).toContain('cannot resume child Agent executions');
    expect(register).not.toHaveBeenCalled();
    expect(await mongoose.models.TaskCallback.countDocuments()).toBe(0);
    await callbacks.recover();
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('registers an ordinary SDK tool execution after SDK clears inherited child metadata', async () => {
  const tool = callbackTool();
  const node = new ToolNode({ tools: [tool], executingAgentId: 'agent-1' });
  await node.invoke(
    {
      messages: [
        new AIMessage({
          content: '',
          tool_calls: [{ id: 'call-1', name: TASK_CALLBACK_TOOL, args: {} }],
        }),
      ],
    },
    {
      configurable: {
        requestBody: { conversationId: 'original', messageId: 'anchor' },
        executionContext: { depth: 1 },
      },
      metadata: { executionContext: { depth: 1 } },
    },
  );
  expect(await mongoose.models.TaskCallback.countDocuments()).toBe(1);
  const stored = await mongoose.models.TaskCallback.findOne().lean<TaskCallbackRecord>();
  expect(stored).toMatchObject({
    user,
    agentId: 'agent-1',
    conversationId: 'original',
    messageId: 'anchor',
  });
});

it.each(['original', 'child'])(
  'rejects a resolved persistent child even when runtime conversation is %s',
  async (conversationId) => {
    await mongoose.models.Conversation.create({
      user,
      conversationId: 'child',
      agent_id: 'agent-1',
      endpoint: 'agents',
      subagentThread: {
        rootConversationId: 'original',
        parentConversationId: 'original',
        parentMessageId: 'anchor',
        parentToolCallId: 'spawn-call',
        parentAgentId: 'agent-1',
        subagentType: 'agent-1',
        subagentKind: 'agent',
        depth: 1,
      },
    });
    const tool = callbackTool('agent-1', await methods.getConvo(user, 'child'));
    const result = await tool.invoke(
      { type: 'tool_call', name: TASK_CALLBACK_TOOL, id: 'call-1', args: {} },
      { configurable: { requestBody: { conversationId, messageId: 'anchor' } } },
    );
    const output = typeof result === 'string' ? result : result.content;
    if (typeof output !== 'string') throw new Error('Missing callback fixture tool output');
    expect(JSON.parse(output).error).toBe('CALLBACK_UNSUPPORTED_CONTEXT');
    expect(await mongoose.models.TaskCallback.countDocuments()).toBe(0);
    await callbacks.recover();
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('keeps reused tool-call IDs isolated across ordinary turns, branches, and Agents', async () => {
  await message('alternate-anchor', 'alternate-user');
  await mongoose.models.Conversation.create({
    user,
    conversationId: 'other',
    agent_id: 'agent-2',
    endpoint: 'agents',
  });
  await message('other-anchor', 'other-user', { conversationId: 'other' });
  const contexts = [
    { agentId: 'agent-1', conversationId: 'original', messageId: 'anchor' },
    { agentId: 'agent-1', conversationId: 'original', messageId: 'alternate-anchor' },
    { agentId: 'agent-2', conversationId: 'other', messageId: 'other-anchor' },
  ];
  const registrations = await Promise.all(contexts.map((context) => registration(context)));
  expect(new Set(registrations.map(({ value }) => value.callback_id)).size).toBe(3);
  const replays = await Promise.all(contexts.map((context) => registration(context)));
  expect(replays.map(({ value }) => value.callback_id)).toEqual(
    registrations.map(({ value }) => value.callback_id),
  );
  expect(await mongoose.models.TaskCallback.countDocuments()).toBe(3);
  const responses = await Promise.all(
    registrations.map(({ value }) =>
      request(app()).post('/api/agents/task-callbacks').send(body(value.callback_id)),
    ),
  );
  expect(responses.map((response) => response.status)).toEqual([202, 202, 202]);
  await callbacks.recover();
  await eventually(async () => fetcher.mock.calls.length === 3);
  const targets = fetcher.mock.calls.map((call) => {
    const sent = JSON.parse(call[1].body);
    return {
      agentId: sent.agent_id,
      conversationId: sent.conversationId,
      messageId: sent.parentMessageId,
    };
  });
  expect(targets).toEqual(expect.arrayContaining(contexts));
});

it('concurrent duplicates and lost receipt return one durable 202; conflict cannot replace result', async () => {
  const { value } = await registration();
  const api = app();
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      request(api).post('/api/agents/task-callbacks').send(body(value.callback_id)),
    ),
  );
  expect(responses.map((r) => r.status)).toEqual(Array(8).fill(202));
  expect(new Set(responses.map((r) => JSON.stringify(r.body))).size).toBe(1);
  const replay = await request(api)
    .post('/api/agents/task-callbacks')
    .send(body(value.callback_id));
  expect(replay.body).toEqual(responses[0].body);
  expect(
    (
      await request(api)
        .post('/api/agents/task-callbacks')
        .send({ ...body(value.callback_id), output: 'changed' })
    ).status,
  ).toBe(409);
  await eventually(async () => fetcher.mock.calls.length === 1);
  const deliveries = await mongoose.models.AgentTriggerDelivery.find().lean();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0].requiredWorkerCapability).toBe('task_callback_v1');
  expect(JSON.stringify(deliveries)).not.toContain(value.callback_id);
  const sent = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(sent).toMatchObject({
    conversationId: 'original',
    parentMessageId: 'anchor',
    agent_id: 'agent-1',
  });
  expect(sent.text).toContain('External result');
});

it.each(['running', 'requires_action'])(
  'fast callback defers a %s parent before anchor persistence',
  async (status) => {
    const { value } = await registration();
    await mongoose.models.Message.deleteMany({});
    await mongoose.models.Conversation.deleteMany({});
    job = { status };
    const response = await request(app())
      .post('/api/agents/task-callbacks')
      .send(body(value.callback_id));
    expect(response.status).toBe(202);
    await callbacks.recover();
    await eventually(
      async () => (await mongoose.models.AgentTriggerDelivery.countDocuments()) === 1,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fetcher).not.toHaveBeenCalled();
    const delivery = await mongoose.models.AgentTriggerDelivery.findOne().lean<{
      attempts: number;
    }>();
    expect(delivery?.attempts).toBe(0);
    await mongoose.models.Conversation.create({
      user,
      conversationId: 'original',
      agent_id: 'agent-1',
      endpoint: 'agents',
    });
    await message('anchor', 'user-turn');
    job = null;
    service.expediteCompletionWakeups({ user, conversationId: 'original' });
    await mongoose.models.AgentTriggerDelivery.updateMany(
      {},
      { $set: { claimAvailableAt: new Date(), availableAt: new Date() } },
    );
    await eventually(async () => fetcher.mock.calls.length === 1);
  },
);

it('follows only an unambiguous descendant and ignores an unrelated newer global leaf', async () => {
  const { value } = await registration();
  await message('follow-user', 'anchor', { isCreatedByUser: true });
  await message('follow-assistant', 'follow-user');
  await message('unrelated-newest', 'unrelated-user');
  await request(app()).post('/api/agents/task-callbacks').send(body(value.callback_id));
  await callbacks.recover();
  await eventually(async () => fetcher.mock.calls.length === 1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).parentMessageId).toBe('follow-assistant');
});

it.each(['fork', 'deleted', 'retention', 'wrong-owner', 'tenant'])(
  'refuses generation for %s target',
  async (kind) => {
    const { value } = await registration();
    if (kind === 'fork') {
      await message('fork-a', 'anchor');
      await message('fork-b', 'anchor');
    }
    if (kind === 'deleted') await mongoose.models.Conversation.deleteMany({});
    if (kind === 'retention')
      await mongoose.models.Conversation.updateMany({}, { expiredAt: new Date(0) });
    if (kind === 'wrong-owner')
      await mongoose.models.Conversation.updateMany({}, { user: 'some-other-owner' });
    if (kind === 'tenant')
      await runAsSystem(async () =>
        mongoose.models.Conversation.updateMany({}, { tenantId: 'other-tenant' }),
      );
    await request(app()).post('/api/agents/task-callbacks').send(body(value.callback_id));
    await callbacks.recover();
    await eventually(async () => (await service.getDeadLetters()).length === 1);
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('expiry, bounded output, forbidden inputs, and safe database failure responses', async () => {
  const { value } = await registration();
  const api = app();
  for (const patch of [
    { output: '✓'.repeat(12000) },
    { input: 'arbitrary prompt' },
    { target: 'other' },
    { mode: 'fire' },
    { metadata: {} },
  ]) {
    expect(
      (
        await request(api)
          .post('/api/agents/task-callbacks')
          .send({ ...body(value.callback_id), ...patch })
      ).status,
    ).toBe(400);
  }
  await mongoose.models.TaskCallback.updateMany({}, { callbackExpiresAt: new Date(0) });
  expect(
    (await request(api).post('/api/agents/task-callbacks').send(body(value.callback_id))).status,
  ).toBe(410);
  const broken = jest
    .spyOn(methods, 'sealTaskCallback')
    .mockRejectedValueOnce(new Error(value.callback_id));
  const failed = await request(api)
    .post('/api/agents/task-callbacks')
    .send(body(value.callback_id));
  expect(failed.status).toBe(503);
  expect(JSON.stringify(failed.body)).not.toContain(value.callback_id);
  broken.mockRestore();
});

it('recovers a sealed result after crash before queue publication and after lost queue receipt', async () => {
  const { value } = await registration();
  await callbacks.stop();
  const result = await request(app())
    .post('/api/agents/task-callbacks')
    .send(body(value.callback_id));
  expect(result.status).toBe(202);
  expect(await methods.listPendingTaskCallbacks(5)).toHaveLength(1);
  const lost = jest
    .spyOn(methods, 'markTaskCallbackQueued')
    .mockRejectedValueOnce(new Error('injected lost queue receipt'));
  await callbacks.recover();
  expect(await methods.listPendingTaskCallbacks(5)).toHaveLength(1);
  await callbacks.recover();
  await eventually(async () => fetcher.mock.calls.length === 1);
  expect(await methods.listPendingTaskCallbacks(5)).toHaveLength(0);
  expect(await mongoose.models.AgentTriggerDelivery.countDocuments()).toBe(1);
  lost.mockRestore();
});

it('ACL denial at ordinary continuation admission dead-letters instead of starting a generation', async () => {
  const { value } = await registration();
  fetcher.mockImplementation(
    async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
  );
  await request(app()).post('/api/agents/task-callbacks').send(body(value.callback_id));
  await callbacks.recover();
  await eventually(async () => (await service.getDeadLetters()).length === 1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

const modulePath = process.env.CODER_MODULES_CHECKOUT;
it('enforces configurable ingress rate limits with safe responses', async () => {
  const { value } = await registration();
  await callbacks.stop();
  callbacks = createTaskCallbackLifecycle({
    methods,
    getConfig: async () => ({
      endpoints: { agents: { taskCallbacks: { ...settings, requestsPerMinute: 1 } } },
    }),
    getGenerationJob: async () => job,
    enqueue: (...args) => service.enqueue(...args),
  });
  await callbacks.initialize();
  const api = app();
  expect(
    (await request(api).post('/api/agents/task-callbacks').send(body(value.callback_id))).status,
  ).toBe(202);
  const limited = await request(api)
    .post('/api/agents/task-callbacks')
    .send(body(value.callback_id));
  expect(limited.status).toBe(429);
  expect(JSON.stringify(limited.body)).not.toContain(value.callback_id);
});

it.each(['error', 'cancelled'])(
  'accepts terminal %s data on the same strict protocol',
  async (status) => {
    const { value } = await registration();
    const response = await request(app())
      .post('/api/agents/task-callbacks')
      .send({ ...body(value.callback_id), status });
    expect(response.status).toBe(202);
    await callbacks.recover();
    await eventually(async () => fetcher.mock.calls.length === 1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).text).toContain(`"status":"${status}"`);
  },
);

it('lost generation admission reply retries the frozen parent and identical client request', async () => {
  const { value } = await registration();
  const respond = fetcher.getMockImplementation()!;
  fetcher
    .mockImplementationOnce(async () => {
      await message('admitted-user', 'anchor', { isCreatedByUser: true });
      await message('admitted-answer', 'admitted-user');
      throw new Error('injected response loss after admission');
    })
    .mockImplementation(respond);
  await request(app()).post('/api/agents/task-callbacks').send(body(value.callback_id));
  await callbacks.recover();
  await eventually(async () => fetcher.mock.calls.length === 2);
  const submissions = fetcher.mock.calls.map((call) => JSON.parse(call[1].body));
  expect(submissions.map((v) => v.parentMessageId)).toEqual(['anchor', 'anchor']);
  expect(new Set(submissions.map((v) => v.clientRequestId)).size).toBe(1);
});

it('conversation deletion purges private result and bearer lookup before generation', async () => {
  const { value } = await registration();
  await callbacks.stop();
  await request(app()).post('/api/agents/task-callbacks').send(body(value.callback_id));
  await methods.deleteConvos(user, { conversationId: 'original' });
  expect(await mongoose.models.TaskCallback.countDocuments()).toBe(0);
  expect(
    (await request(app()).post('/api/agents/task-callbacks').send(body(value.callback_id))).status,
  ).toBe(404);
  await callbacks.recover();
  expect(fetcher).not.toHaveBeenCalled();
});

it('a durable admission marker settles recovery after a lost queue finalization', async () => {
  const { value } = await registration();
  const blocked = jest
    .spyOn(methods, 'completeAgentTriggerDelivery')
    .mockRejectedValue(new Error('injected queue finalization outage'));
  await request(app()).post('/api/agents/task-callbacks').send(body(value.callback_id));
  await callbacks.recover();
  await eventually(
    async () =>
      (await mongoose.models.TaskCallback.countDocuments({ admittedAt: { $exists: true } })) === 1,
  );
  const delivery = await mongoose.models.AgentTriggerDelivery.findOne().lean<{
    envelope: unknown;
  }>();
  await service.stop();
  const restarted = createTaskCallbackLifecycle({
    methods,
    getConfig: async () => ({ endpoints: { agents: { taskCallbacks: settings } } }),
    enqueue: (...args) => service.enqueue(...args),
    getGenerationJob: async () => null,
  });
  await restarted.initialize();
  try {
    const host = createAgentTriggerExecutionHost({
      getBaseUrl: () => 'http://127.0.0.1:3080',
      mintToken: () => 'fixture-token',
      prepareContinue: restarted.prepareContinue,
      fetch: fetcher,
    });
    expect(await host.dispatch(delivery?.envelope)).toMatchObject({
      mode: 'continue',
      status: 'settled',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    await restarted.stop();
    blocked.mockRestore();
  }
});

it('accepted result still expires before a deferred generation and replays its original receipt', async () => {
  const { value } = await registration();
  await callbacks.stop();
  const accepted = await request(app())
    .post('/api/agents/task-callbacks')
    .send(body(value.callback_id));
  await mongoose.models.TaskCallback.updateMany({}, { callbackExpiresAt: new Date(0) });
  const replay = await request(app())
    .post('/api/agents/task-callbacks')
    .send(body(value.callback_id));
  expect(replay.status).toBe(202);
  expect(replay.body).toEqual(accepted.body);
  await callbacks.recover();
  await eventually(async () => (await service.getDeadLetters()).length === 1);
  expect(fetcher).not.toHaveBeenCalled();
  await mongoose.models.TaskCallback.updateMany({}, { expiresAt: new Date(0) });
  const expiredReceipt = await request(app())
    .post('/api/agents/task-callbacks')
    .send(body(value.callback_id));
  expect(expiredReceipt.status).toBe(410);
});

(modulePath && existsSync(`${modulePath}/opencode/tests/callback-fixture.mjs`)
  ? describe
  : describe.skip)('companion module protocol', () => {
  it('cross-repo: actual module TaskRunner POST is accepted and continues the original conversation', async () => {
    const { value } = await registration();
    server = app().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const port = (server.address() as { port: number }).port;
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [`${modulePath}/opencode/tests/callback-fixture.mjs`], {
        env: { PATH: '/usr/bin:/bin' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve(output) : reject(new Error('Module fixture failed')),
      );
      child.stdin.end(
        JSON.stringify({
          ...value,
          callback_url: `http://127.0.0.1:${port}/api/agents/task-callbacks`,
        }),
      );
    });
    expect(JSON.parse(result)).toMatchObject({
      state: 'delivered',
      executions: 1,
      result_status: 'success',
    });
    expect(result).not.toContain(value.callback_id);
    await callbacks.recover();
    await eventually(async () => fetcher.mock.calls.length === 1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).text).toContain(
      'Module result accepted across repositories.',
    );
  }, 15000);
});
