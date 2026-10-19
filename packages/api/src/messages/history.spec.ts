import express from 'express';
import request from 'supertest';
import type { MessageRequestValidation } from '~/middleware/messageValidation';
import { createHistoryHandler, createAttachmentBodyHandler } from './history';

const messages = [
  {
    messageId: 'reply',
    conversationId: 'conversation',
    text: 'Synthetic reply',
    attachments: [{ filename: 'sample.txt' }],
  },
];
const page = { messages, start: null, nextCursor: null };
const getDisplayMessages = jest.fn().mockResolvedValue(page);
const getHistoryAttachment = jest.fn().mockResolvedValue({ text: 'Synthetic body' });
let validation: MessageRequestValidation;
const deps = {
  getDisplayMessages,
  getHistoryAttachment,
  validate: () => validation,
  previews: () => async (input: typeof messages) => input,
  sendValidationResponse: (res: express.Response, result: { status: number; body: unknown }) =>
    res.status(result.status).json(result.body),
  logError: jest.fn(),
};
function app() {
  const server = express();
  server.use((req, _res, next) => {
    Object.assign(req, { user: { id: 'owner', tenantId: 'tenant' } });
    next();
  });
  server.get(
    '/:conversationId/history',
    createHistoryHandler(deps as Parameters<typeof createHistoryHandler>[0], true),
  );
  server.get(
    '/:conversationId',
    createHistoryHandler(deps as Parameters<typeof createHistoryHandler>[0]),
  );
  server.get('/:conversationId/:messageId/attachments/:index', createAttachmentBodyHandler(deps));
  return server;
}
beforeEach(() => {
  jest.clearAllMocks();
  validation = { shouldFetchMessages: true, promise: Promise.resolve({ ok: true }) };
});

test('keeps old full clients compatible while new history responses expose body references', async () => {
  const full = await request(app()).get('/conversation').expect(200);
  expect(full.body).toEqual(messages);
  expect(getDisplayMessages).toHaveBeenLastCalledWith(
    expect.objectContaining({ lazyAttachments: false, user: 'owner', tenantId: 'tenant' }),
  );
  const recent = await request(app()).get('/conversation/history?limit=12').expect(200);
  expect(recent.body.messages[0].attachments[0].bodyRef).toMatchObject({
    conversationId: 'conversation',
    messageId: 'reply',
    index: 0,
  });
  expect(getDisplayMessages).toHaveBeenLastCalledWith(
    expect.objectContaining({ lazyAttachments: true, page: { limit: 12 } }),
  );
});

test.each([
  'limit=0',
  'limit=101',
  'before=bad',
  'before=%7B%7D',
  'before=%7B%22createdAt%22%3A%22bad%22%7D',
])('rejects malformed paging (%s)', async (query) => {
  await request(app()).get(`/conversation/history?${query}`).expect(400);
  expect(getDisplayMessages).not.toHaveBeenCalled();
});

test('never sends scoped records until authorization succeeds, including active-job reads', async () => {
  let allow!: (value: Awaited<MessageRequestValidation['promise']>) => void;
  validation.promise = new Promise((resolve) => {
    allow = resolve;
  });
  const response = request(app()).get('/conversation/history');
  const pending = response.then((result) => result);
  await new Promise((resolve) => setImmediate(resolve));
  allow({ ok: false, status: 404, body: { error: 'Conversation not found' } });
  const result = await pending;
  expect(result.status).toBe(404);
  expect(JSON.stringify(result.body)).not.toContain('Synthetic');
});

test('gates body reads, handles absence, and never exposes operational errors', async () => {
  validation.promise = Promise.resolve({ ok: false, status: 403, body: { error: 'Forbidden' } });
  await request(app()).get('/conversation/reply/attachments/0').expect(403);
  expect(getHistoryAttachment).toHaveBeenCalledWith(
    expect.objectContaining({
      user: 'owner',
      tenantId: 'tenant',
      conversationId: 'conversation',
      messageId: 'reply',
      index: 0,
    }),
  );
  validation.promise = Promise.resolve({ ok: true });
  await request(app()).get('/conversation/reply/attachments/-1').expect(400);
  getHistoryAttachment.mockResolvedValueOnce(null);
  await request(app()).get('/conversation/reply/attachments/0').expect(404);
  getHistoryAttachment.mockRejectedValueOnce(new Error('sensitive database diagnostic'));
  const failed = await request(app()).get('/conversation/reply/attachments/0').expect(500);
  expect(failed.body).toEqual({ error: 'Internal server error' });
});

test('a scoped read failure cannot respond ahead of a pending denial', async () => {
  let finish!: (result: Awaited<MessageRequestValidation['promise']>) => void;
  validation.promise = new Promise((resolve) => {
    finish = resolve;
  });
  getDisplayMessages.mockRejectedValueOnce(new Error('private database error'));
  const pending = request(app())
    .get('/conversation/history')
    .then((response) => response);
  await new Promise((resolve) => setImmediate(resolve));
  finish({ ok: false, status: 403, body: { error: 'Forbidden' } });
  const response = await pending;
  expect(response.status).toBe(403);
  expect(response.body).toEqual({ error: 'Forbidden' });
});
