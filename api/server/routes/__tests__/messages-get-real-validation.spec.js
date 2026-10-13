const { CLIENT_MESSAGE_SELECT } = require('@librechat/data-schemas');
const express = require('express');
const request = require('supertest');

jest.mock('@librechat/agents', () => ({
  ...jest.requireActual('@librechat/agents'),
  CODE_EXECUTION_TOOLS: new Set(['execute_code', 'bash_tool']),
  BashExecutionToolDefinition: {
    name: 'bash_tool',
    description: 'bash',
    schema: { type: 'object', properties: {} },
  },
  ReadFileToolDefinition: {
    name: 'read_file',
    description: 'Read a file',
    parameters: { type: 'object', properties: {} },
    responseFormat: 'content',
  },
  buildBashExecutionToolDescription: () => 'bash',
  sleep: jest.fn(),
}));

jest.mock('@librechat/api', () => ({
  createMessageReadHandler: jest.requireActual('@librechat/api').createMessageReadHandler,
  createMessageReadLimits: jest.requireActual('@librechat/api').createMessageReadLimits,
  prepareToolCallPreviews: jest.fn(() => (messages) => Promise.resolve(messages)),
  createToolCallPartHandler: jest.fn(() => (_req, res) => res.status(404).end()),
  rejectToolCallPreviewWrites: (_req, _res, next) => next(),
  withMessageToolCallPreviews: (_req, message) => message,
  createPrivateTextView: jest.fn(() => (_req, _res, next) => next()),
  createContentFilter: jest.fn(() => (req, res, next) => next()),
  inspectContent: jest.fn(() => null),
  extractFeedbackContent: jest.fn(() => []),
  extractStoredMessageContent: jest.fn(() => []),
  contentFilterBlockResponse: jest.fn(),
  createMessageRequestMiddleware:
    jest.requireActual('@librechat/api').createMessageRequestMiddleware,
  unescapeLaTeX: jest.fn((x) => x),
  countTokens: jest.fn().mockResolvedValue(10),
  sendFeedbackScore: jest.fn().mockResolvedValue(undefined),
  traceIdForMessage: jest.fn((messageId) => `trace-${messageId}`),
  mergeQuotedTextForCount: jest.fn((text) => text),
  GenerationJobManager: {
    getJob: jest.fn(),
  },
  isPendingActionStale: jest.fn(() => false),
  CHILD_THREAD_READ_ONLY_ERROR: 'Child thread is view-only.',
  isSubagentThreadWriteBlocked: jest.fn().mockResolvedValue(false),
  requireFeedbackEnabled: (req, res, next) => next(),
}));

jest.mock('~/server/services/Config', () => ({ getAppConfig: jest.fn() }));

jest.mock('~/server/services/Endpoints/agents/subagentThreadStore', () => ({}));

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
}));

jest.mock('~/models', () => ({
  saveConvo: jest.fn(),
  getConvoOwnership: jest.fn(),
  getMessage: jest.fn(),
  saveMessage: jest.fn(),
  getMessages: jest.fn(),
  updateMessage: jest.fn(),
  deleteMessages: jest.fn(),
  getConvosQueried: jest.fn(),
  searchMessages: jest.fn(),
  getMessagesByCursor: jest.fn(),
  getMessageReadMetadata: jest.fn(),
  getMessageReadContent: jest.fn(),
}));

jest.mock('~/server/services/Artifacts/update', () => ({
  findAllArtifacts: jest.fn(),
  replaceArtifactContent: jest.fn(),
}));

jest.mock('~/server/middleware/requireJwtAuth', () => (req, res, next) => next());

jest.mock('~/server/middleware', () => {
  const { sendValidationResponse, validateMessageReq, prepareMessageRequestValidation } =
    jest.requireActual('~/server/middleware/messageValidation');

  return {
    createMessageRequestValidation: jest.requireActual('~/server/middleware/messageValidation')
      .createMessageRequestValidation,
    requireJwtAuth: (req, res, next) => next(),
    validateMessageReq,
    sendValidationResponse,
    prepareMessageRequestValidation,
    configMiddleware: (req, res, next) => next(),
  };
});

jest.mock('~/db/models', () => ({
  Message: {
    findOne: jest.fn(),
    find: jest.fn(),
    meiliSearch: jest.fn(),
  },
}));

describe('GET /api/messages/:conversationId with real validation middleware', () => {
  let app;
  const { getConvoOwnership, getMessages } = require('~/models');
  const authenticatedUserId = 'user-owner-123';

  beforeAll(() => {
    const messagesRouter = require('../messages');

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { id: authenticatedUserId };
      next();
    });
    app.use('/api/messages', messagesRouter);
    app.use('/api/message-reads', require('../message-reads'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    { messages: [] },
    { messages: [{ conversationId: 'c', messageId: 'metadata', text: 'legacy body' }] },
  ])(
    'keeps the legacy zero-or-one array for the literal messageId metadata: %p',
    async ({ messages }) => {
      const db = require('~/models');
      getConvoOwnership.mockResolvedValue({ user: authenticatedUserId });
      getMessages.mockResolvedValue(messages);
      const response = await request(app).get('/api/messages/c/metadata');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toEqual(messages);
      expect(response.headers['x-librechat-message-reads']).toBeUndefined();
      expect(getMessages).toHaveBeenCalledWith(
        { conversationId: 'c', messageId: 'metadata', user: authenticatedUserId },
        CLIENT_MESSAGE_SELECT,
      );
      expect(db.getMessageReadMetadata).not.toHaveBeenCalled();
    },
  );

  it('serves the noncolliding list and single metadata routes with authorization and byte bounds', async () => {
    const db = require('~/models');
    const oldKey = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'synthetic-route-key';
    try {
      const row = {
        _id: 'incarnation',
        conversationId: 'c',
        messageId: 'metadata',
        createdAt: new Date('2026-10-01T00:00:00.123Z'),
      };
      getConvoOwnership.mockResolvedValue({ user: authenticatedUserId });
      db.getMessageReadMetadata.mockResolvedValue([row]);
      const list = await request(app).get('/api/message-reads/list').query({ conversationId: 'c' });
      expect(list.status).toBe(200);
      expect(list.headers['x-librechat-message-reads']).toBe('2');
      expect(list.body).toMatchObject({
        schemaVersion: 2,
        conversationId: 'c',
        observability: { llmRequests: 'not_recorded', ptcInnerCalls: 'not_recorded' },
        consistency: 'live',
        items: [{ messageId: 'metadata' }],
        nextCursor: null,
      });
      expect(Buffer.byteLength(list.text)).toBeLessThanOrEqual(65_536);
      expect(getConvoOwnership).toHaveBeenCalledWith(authenticatedUserId, 'c', null);
      expect(db.getMessageReadMetadata.mock.calls[0][0].messageId).toBeUndefined();
      const single = await request(app)
        .get('/api/message-reads/list')
        .query({ conversationId: 'c', messageId: 'metadata' });
      expect(single.status).toBe(200);
      expect(single.body.items[0].messageId).toBe('metadata');
      expect(single.body.conversationId).toBe('c');
      expect(single.body.observability).toEqual({
        llmRequests: 'not_recorded',
        ptcInnerCalls: 'not_recorded',
      });
      expect(db.getMessageReadMetadata.mock.calls[1][0]).toHaveProperty('messageId', 'metadata');
      expect(getMessages).not.toHaveBeenCalled();
      for (const conversation of [
        { user: 'other-owner' },
        { user: authenticatedUserId, subagentThread: {} },
      ]) {
        getConvoOwnership.mockResolvedValue(conversation);
        db.getMessageReadMetadata.mockClear();
        const denied = await request(app)
          .get('/api/message-reads/list')
          .query({ conversationId: 'c' });
        expect(denied.status).toBe(404);
        expect(denied.body.error.code).toBe('NOT_FOUND');
        expect(Buffer.byteLength(denied.text)).toBeLessThanOrEqual(65_536);
        expect(db.getMessageReadMetadata).not.toHaveBeenCalled();
      }
    } finally {
      if (oldKey === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = oldKey;
    }
  });

  it('wires bounded routes through real validation before fetching selected data', async () => {
    const db = require('~/models');
    const oldKey = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'synthetic-route-key';
    try {
      getConvoOwnership.mockResolvedValue({ user: authenticatedUserId });
      db.getMessageReadMetadata.mockResolvedValue([
        { _id: 'incarnation', conversationId: 'c', messageId: 'm', tokenCount: 4 },
      ]);
      const response = await request(app)
        .get('/api/message-reads/list')
        .query({ conversationId: 'c', messageId: 'm' });
      expect(response.status).toBe(200);
      expect(response.headers['x-librechat-message-reads']).toBe('2');
      expect(response.body.items[0]).toMatchObject({ messageId: 'm', tokenCount: 4 });
      expect(getConvoOwnership).toHaveBeenCalledWith(authenticatedUserId, 'c', null);
      expect(db.getMessageReadMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ user: authenticatedUserId, conversationId: 'c', messageId: 'm' }),
      );
      expect(getMessages).not.toHaveBeenCalled();
      getConvoOwnership.mockResolvedValue({ user: authenticatedUserId, subagentThread: {} });
      db.getMessageReadMetadata.mockClear();
      const denied = await request(app)
        .get('/api/message-reads/list')
        .query({ conversationId: 'c', messageId: 'm' });
      expect(denied.status).toBe(404);
      expect(denied.body.error.code).toBe('NOT_FOUND');
      expect(db.getMessageReadMetadata).not.toHaveBeenCalled();
    } finally {
      if (oldKey === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = oldKey;
    }
  });

  it('returns the existing empty response for new conversations without fetching messages', async () => {
    const response = await request(app).get('/api/messages/new');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(getConvoOwnership).not.toHaveBeenCalled();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('wires content and ref-only body reads, and exposes no superseded analysis routes', async () => {
    const db = require('~/models');
    const oldKey = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'synthetic-route-key';
    try {
      getConvoOwnership.mockResolvedValue({ user: authenticatedUserId });
      const row = {
        _id: 'incarnation',
        conversationId: 'c',
        messageId: 'm',
        __v: 1,
        validScope: true,
      };
      db.getMessageReadContent.mockResolvedValue({
        ...row,
        textRecorded: true,
        entries: [],
        hasMore: false,
      });
      const page = await request(app)
        .get('/api/message-reads/content')
        .query({ conversationId: 'c', messageId: 'm' });
      expect(page.status).toBe(200);
      expect(page.body.text).toBe(true);
      db.getMessageReadContent.mockResolvedValue({ ...row, recorded: true, stringWindow: 'hello' });
      const body = await request(app)
        .get('/api/message-reads/read')
        .query({ ref: page.body.ref, field: 'text' });
      expect(body.status).toBe(200);
      expect(body.body).toMatchObject({
        representation: 'utf8',
        data: 'hello',
        complete: true,
        nextCursor: null,
      });
      expect(getConvoOwnership).toHaveBeenCalledTimes(2);
      expect(db.getMessageReadContent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          user: authenticatedUserId,
          conversationId: 'c',
          messageId: 'm',
          field: 'text',
        }),
      );
      for (const path of [
        '/api/messages/c/metadata/list',
        '/api/messages/c/m/metadata',
        '/api/messages/c/m/entries',
        '/api/messages/c/m/body',
      ]) {
        expect((await request(app).get(path)).status).toBe(404);
      }
    } finally {
      if (oldKey === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = oldKey;
    }
  });

  it('starts user-scoped message reads before real conversation validation resolves', async () => {
    const events = [];
    let resolveConvo;
    const convoPromise = new Promise((resolve) => {
      resolveConvo = resolve;
    });

    getConvoOwnership.mockImplementation(() => {
      events.push('convo-started');
      return convoPromise;
    });

    let resolveMessagesStarted;
    const messagesStartedPromise = new Promise((resolve) => {
      resolveMessagesStarted = resolve;
    });
    getMessages.mockImplementation(() => {
      events.push('messages-started');
      resolveMessagesStarted();
      return Promise.resolve([{ messageId: 'message-1', conversationId: 'convo-1' }]);
    });

    const responsePromise = new Promise((resolve, reject) => {
      request(app)
        .get('/api/messages/convo-1')
        .end((error, response) => (error ? reject(error) : resolve(response)));
    });

    await Promise.race([
      messagesStartedPromise,
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
    const eventsBeforeValidation = [...events];

    resolveConvo({ conversationId: 'convo-1', user: authenticatedUserId });
    const response = await responsePromise;

    expect(eventsBeforeValidation).toEqual(['convo-started', 'messages-started']);
    expect(getConvoOwnership).toHaveBeenCalledWith(authenticatedUserId, 'convo-1');
    expect(getMessages).toHaveBeenCalledWith(
      { conversationId: 'convo-1', user: authenticatedUserId },
      CLIENT_MESSAGE_SELECT,
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ messageId: 'message-1', conversationId: 'convo-1' }]);
  });

  it('does not return messages for a directly addressed child thread', async () => {
    getConvoOwnership.mockResolvedValue({
      conversationId: 'child-convo',
      user: authenticatedUserId,
      subagentThread: { parentConversationId: 'parent-convo' },
    });
    getMessages.mockResolvedValue([{ messageId: 'child-message', conversationId: 'child-convo' }]);

    const response = await request(app).get('/api/messages/child-convo');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Conversation not found' });
  });

  it('does not expose a directly addressed child thread through HEAD', async () => {
    getConvoOwnership.mockResolvedValue({
      conversationId: 'child-convo',
      user: authenticatedUserId,
      subagentThread: { parentConversationId: 'parent-convo' },
    });

    const response = await request(app).head('/api/messages/child-convo');

    expect(response.status).toBe(404);
  });
});
