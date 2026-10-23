const { ChatGenerationChunk } = require('@langchain/core/outputs');
const { HumanMessage, AIMessage, AIMessageChunk } = require('@langchain/core/messages');
const {
  Run,
  GraphEvents,
  FakeChatModel,
  registerProvider,
  createContentAggregator,
} = require('@librechat/agents');
const { GenerationJobManager } = require('@librechat/api');
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

class PrimaryModel extends FakeChatModel {
  constructor() {
    super({ responses: [answerText] });
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
  afterAll(async () => {
    await GenerationJobManager.destroy();
  });

  test('streams block arrays, completes in order, and saves only final summary content', async () => {
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
        new HumanMessage(`First question. ${pad}`),
        new AIMessage(`First answer. ${pad}`),
        new HumanMessage('Second question.'),
        new AIMessage('Second answer.'),
        new HumanMessage('Final question.'),
      ];
      const run = await Run.create({
        runId: 'summary-reasoning-response',
        langfuse: { enabled: false },
        graphConfig: {
          type: 'standard',
          llmConfig: { provider: 'summary-reasoning-primary-fixture', streaming: true },
          instructions: 'Use the compacted history.',
          reasoningKey: 'reasoning',
          maxContextTokens: 700,
          summarizationEnabled: true,
          summarizationConfig: { provider: 'summary-reasoning-summary-fixture' },
        },
        returnContent: true,
        customHandlers: handlers,
        tokenCounter,
        indexTokenCountMap: Object.fromEntries(
          history.map((message, index) => [index, tokenCounter(message)]),
        ),
      });
      await run.processStream(
        { messages: history },
        {
          configurable: { thread_id: 'summary-reasoning-thread', user_id: 'fixture-user' },
          streamMode: 'values',
          version: 'v2',
        },
      );

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
        summary: { content: [{ type: 'text', text: summaryText }], summaryVersion: 1 },
      });
      expect(summaryEvents[3].data.error).toBeUndefined();
      expect(contentParts.filter((part) => part.type === 'summary')).toEqual([
        expect.objectContaining({
          content: [{ type: 'text', text: summaryText }],
          summaryVersion: 1,
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
    } finally {
      unregisterSummary();
      unregisterPrimary();
    }
  });
});
