const { ChatGenerationChunk } = require('@langchain/core/outputs');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { HumanMessage, AIMessage, AIMessageChunk } = require('@langchain/core/messages');
const {
  Run,
  GraphEvents,
  FakeChatModel,
  registerProvider,
  formatAgentMessages,
  createContentAggregator,
} = require('@librechat/agents');
const {
  GenerationJobManager,
  getLatestEventActorSummary,
  getAgentCheckpointer,
  forkAgentEventCheckpoint,
  checkpointOwnerNamespacePrefix,
  LIBRECHAT_CHECKPOINT_NAMESPACE_KEY,
  LIBRECHAT_EVENT_ACTOR_INVOCATION_KEY,
  LIBRECHAT_CHECKPOINT_OWNER_KEY,
} = require('@librechat/api');
const { getDefaultHandlers } = require('~/server/controllers/agents/callbacks');
const BaseClient = require('~/app/clients/BaseClient');
const db = require('~/models');

jest.mock('~/models', () => ({
  saveMessage: jest.fn(async (_ctx, message) => structuredClone(message)),
  saveConvo: jest.fn(async (_ctx, conversation) => conversation),
}));

jest.mock('~/cache', () => ({ logViolation: jest.fn() }));
jest.mock('~/server/services/Files/strategies', () => ({ getStrategyFunctions: jest.fn() }));
jest.mock('~/server/services/Files/Citations', () => ({ processFileCitations: jest.fn() }));
jest.mock('~/server/services/Files/process', () => ({ saveBase64Image: jest.fn() }));
jest.mock('~/server/services/Files/Code/process', () => ({
  processCodeOutput: jest.fn(),
  runPreviewFinalize: jest.fn(),
}));

const summaryText = 'Final checkpoint';
const answerText = 'Answer after compaction.';
const tokenCounter = (message) => JSON.stringify(message.content).length + 3;
const primaryInputs = [];

class PrimaryModel extends FakeChatModel {
  constructor() {
    super({ responses: [answerText] });
  }

  async *_streamResponseChunks(messages, options, runManager) {
    primaryInputs.push(messages.map(({ id, content }) => ({ id, content })));
    yield* super._streamResponseChunks(messages, options, runManager);
  }
}

class SummaryModel extends FakeChatModel {
  constructor() {
    super({ responses: ['unused'] });
  }

  async *_streamResponseChunks() {
    for (const chunk of [
      new AIMessageChunk({
        content: '',
        additional_kwargs: { reasoning: { type: 'reasoning', summary: [] } },
      }),
      new AIMessageChunk({
        content: '',
        additional_kwargs: {
          reasoning: {
            type: 'reasoning',
            encrypted_content: 'not-visible',
            summary: [
              { type: 'summary_text', text: '' },
              { type: 'summary_text', text: 'Temporary ' },
              { type: 'summary_text', text: 'reasoning' },
            ],
          },
        },
      }),
      new AIMessageChunk({ content: 'Final ' }),
      new AIMessageChunk({
        content: [{ type: 'text', text: 'checkpoint' }],
        additional_kwargs: { reasoning: { type: 'reasoning', summary: [] } },
      }),
    ]) {
      yield new ChatGenerationChunk({ text: '', message: chunk });
    }
  }
}

function createResponse() {
  const events = [];
  return {
    events,
    headersSent: true,
    writableEnded: false,
    write(payload) {
      for (const line of String(payload).split('\n')) {
        if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
      }
      return true;
    },
  };
}

describe('vendored summary reasoning through the consumer pipeline', () => {
  let mongoServer;
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await GenerationJobManager.destroy();
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  test('saves final summary coverage and retains recent history on cold and warm continuation', async () => {
    const unregisterPrimary = registerProvider({
      provider: 'summary-reasoning-primary-fixture',
      family: 'openai',
      model: PrimaryModel,
    });
    const unregisterSummary = registerProvider({
      provider: 'summary-reasoning-summary-fixture',
      family: 'openai',
      model: SummaryModel,
    });

    try {
      const res = createResponse();
      const { contentParts, aggregateContent } = createContentAggregator();
      const handlers = getDefaultHandlers({
        res,
        aggregateContent,
        contentParts,
        toolEndCallback: () => {},
        collectedUsage: [],
        summarizationOptions: { enabled: true },
      });
      const pad = 'context detail to overflow the tiny budget. '.repeat(40);
      const history = [
        new HumanMessage({ id: 'history-0', content: `First question. ${pad}` }),
        new AIMessage({ id: 'history-1', content: `First answer. ${pad}` }),
        new HumanMessage({ id: 'history-2', content: `Older question. ${pad}` }),
        new AIMessage({ id: 'history-3', content: `Older answer. ${pad}` }),
        new HumanMessage({ id: 'history-4', content: 'Second question.' }),
        new AIMessage({ id: 'history-5', content: 'Second answer.' }),
        new HumanMessage({ id: 'history-6', content: 'Final question.' }),
      ];
      const checkpointConfig = { type: 'mongo', ttl: 3600 };
      const checkpointer = await getAgentCheckpointer(checkpointConfig);
      const owner = checkpointOwnerNamespacePrefix('fixture-user');
      const agentConfig = {
        agentId: 'summary-reasoning-agent',
        provider: 'summary-reasoning-primary-fixture',
        clientOptions: { streaming: true },
        instructions: 'Use the compacted history.',
        reasoningKey: 'reasoning',
        // Overflow the budget while keeping the two recent turns small enough to retain.
        maxContextTokens: 6000,
        summarizationEnabled: true,
        summarizationConfig: {
          provider: 'summary-reasoning-summary-fixture',
          reserveRatio: 0.5,
        },
      };
      const graphConfig = { type: 'standard', agents: [agentConfig], edges: [] };
      const streamConfig = {
        configurable: {
          thread_id: 'summary-reasoning-thread',
          user_id: 'fixture-user',
          [LIBRECHAT_CHECKPOINT_NAMESPACE_KEY]: 'event-actor/base',
          [LIBRECHAT_EVENT_ACTOR_INVOCATION_KEY]: 'fixture-base',
          [LIBRECHAT_CHECKPOINT_OWNER_KEY]: owner,
        },
        streamMode: 'values',
        version: 'v2',
      };
      const run = await Run.create({
        runId: 'summary-reasoning-response',
        langfuse: { enabled: false },
        graphConfig: { ...graphConfig, compileOptions: { checkpointer } },
        returnContent: true,
        customHandlers: handlers,
        tokenCounter,
        indexTokenCountMap: Object.fromEntries(
          history.map((message, index) => [index, tokenCounter(message)]),
        ),
      });
      await run.processStream({ messages: history }, streamConfig);

      const summaryEvents = res.events.filter((event) =>
        [GraphEvents.ON_SUMMARIZE_DELTA, GraphEvents.ON_SUMMARIZE_COMPLETE].includes(event.event),
      );
      expect(summaryEvents.map((event) => event.event)).toEqual([
        GraphEvents.ON_SUMMARIZE_DELTA,
        GraphEvents.ON_SUMMARIZE_DELTA,
        GraphEvents.ON_SUMMARIZE_DELTA,
        GraphEvents.ON_SUMMARIZE_COMPLETE,
      ]);
      expect(summaryEvents.slice(0, 3).map((event) => event.data.delta.summary.content)).toEqual([
        [{ type: 'text', text: 'Temporary reasoning' }],
        [{ type: 'text', text: 'Final ' }],
        [{ type: 'text', text: 'checkpoint' }],
      ]);
      expect(summaryEvents[3].data).toMatchObject({
        summary: {
          content: [{ type: 'text', text: summaryText }],
          summaryVersion: 1,
          coverage: { retainedFromMessageId: 'history-4' },
        },
      });
      expect(summaryEvents[3].data.error).toBeUndefined();
      expect(contentParts.filter((part) => part.type === 'summary')).toEqual([
        expect.objectContaining({
          content: [{ type: 'text', text: summaryText }],
          summaryVersion: 1,
          coverage: { retainedFromMessageId: 'history-4' },
        }),
      ]);
      expect(contentParts).toContainEqual({ type: 'text', text: answerText });

      // Run the real save boundary; only the database and unrelated file services are fixtures.
      const client = Object.assign(Object.create(BaseClient.prototype), {
        user: 'fixture-user',
        fetchedConvo: true,
        options: {
          endpoint: 'agents',
          req: { user: { id: 'fixture-user' }, body: {} },
        },
      });
      const result = await client.saveMessageToDatabase(
        {
          messageId: run.id,
          parentMessageId: 'history-6',
          conversationId: 'summary-reasoning-thread',
          isCreatedByUser: false,
          text: answerText,
          content: contentParts,
        },
        {},
        client.user,
      );
      expect(db.saveMessage).toHaveBeenCalledTimes(1);
      const saved = db.saveMessage.mock.calls[0][1];
      expect(saved).toMatchObject({
        messageId: run.id,
        endpoint: 'agents',
        unfinished: false,
        content: contentParts,
      });
      expect(JSON.stringify(saved)).not.toMatch(/Temporary reasoning|not-visible|summary_text/);
      expect(result.message.content).toEqual(saved.content);
      expect(db.saveConvo).toHaveBeenCalledTimes(1);

      const rows = history.map((message, index) => ({
        messageId: message.id,
        parentMessageId: history[index - 1]?.id ?? null,
        isCreatedByUser: message.getType() === 'human',
        role: message.getType() === 'human' ? 'user' : 'assistant',
        text: message.content,
        content: [{ type: 'text', text: message.content }],
      }));
      const restored = BaseClient.getMessagesForConversation({
        messages: [...rows, result.message],
        parentMessageId: run.id,
        summary: true,
      });
      expect(restored.map((message) => message.messageId)).toEqual([
        'history-4',
        'history-5',
        'history-6',
        run.id,
      ]);
      const cold = formatAgentMessages(
        restored.map((message) => ({
          ...message,
          role: message.isCreatedByUser ? 'user' : 'assistant',
        })),
        {},
        new Set(),
      );
      expect(cold.summary).toMatchObject({ text: summaryText });
      expect(cold.messages.map((message) => message.content)).toEqual([
        [{ type: 'text', text: 'Second question.' }],
        [{ type: 'text', text: 'Second answer.' }],
        [{ type: 'text', text: 'Final question.' }],
        [{ type: 'text', text: answerText }],
      ]);

      const state = await run.graphRunnable.getState(streamConfig);
      expect(state.values.agentMessages ?? []).toEqual([]);
      // Automatic compaction leaves covered rows in the outer graph's message reducer.
      expect(state.values.messages.map((message) => message.id)).toContain('history-0');
      expect(state.values.messages.slice(-4).map((message) => message.content)).toEqual([
        'Second question.',
        'Second answer.',
        'Final question.',
        answerText,
      ]);
      const next = new HumanMessage({
        id: 'next-question',
        content: 'Continue with the recent details.',
      });
      const actorSummary = getLatestEventActorSummary(contentParts);
      expect(actorSummary).toMatchObject({
        text: summaryText,
        coverage: { retainedFromMessageId: 'history-4' },
      });
      const fork = await forkAgentEventCheckpoint(
        {
          threadId: streamConfig.configurable.thread_id,
          checkpointId: state.config.configurable.checkpoint_id,
          checkpointNs: 'event-actor/base',
        },
        'event-actor/continuation',
        'fixture-warm',
        checkpointConfig,
        {
          source: 'skill',
          messages: [],
          retainedFromMessageId: actorSummary.coverage.retainedFromMessageId,
        },
        owner,
      );
      expect(fork).not.toBeNull();
      for (const mode of ['cold', 'warm']) {
        const continuation = await Run.create({
          runId: `summary-reasoning-${mode}`,
          langfuse: { enabled: false },
          graphConfig: {
            ...graphConfig,
            agents: [
              { ...agentConfig, initialSummary: mode === 'warm' ? actorSummary : cold.summary },
            ],
            ...(mode === 'warm' ? { compileOptions: { checkpointer } } : {}),
          },
          tokenCounter,
          indexTokenCountMap: {},
        });
        await continuation.processStream(
          { messages: mode === 'warm' ? [next] : [...cold.messages, next] },
          mode === 'cold'
            ? streamConfig
            : {
                ...streamConfig,
                configurable: {
                  ...streamConfig.configurable,
                  [LIBRECHAT_CHECKPOINT_NAMESPACE_KEY]: fork.checkpointNs,
                  [LIBRECHAT_EVENT_ACTOR_INVOCATION_KEY]: 'fixture-warm',
                },
              },
        );
        const input = primaryInputs.at(-1);
        expect({
          mode,
          messages: input
            .slice(-5)
            .map(({ content }) =>
              typeof content === 'string' ? content : content.map((part) => part.text).join(''),
            ),
        }).toEqual({
          mode,
          messages: [
            'Second question.',
            'Second answer.',
            'Final question.',
            answerText,
            next.content,
          ],
        });
        expect(JSON.stringify(input).match(/Final checkpoint/g)).toHaveLength(1);
        expect(JSON.stringify(input)).not.toMatch(/context detail|Temporary reasoning|not-visible/);
      }
      const committed = await run.graphRunnable.getState(streamConfig);
      expect(committed.values.messages.map((message) => message.id)).toEqual(
        state.values.messages.map((message) => message.id),
      );
    } finally {
      unregisterSummary();
      unregisterPrimary();
    }
  });
});
