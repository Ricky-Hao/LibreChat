import { getAttachmentBody, getConversationHistory } from './data-service';
import { interfaceSchema } from './config';
import request from './request';

jest.mock('./request', () => ({ __esModule: true, default: { get: jest.fn() } }));
const get = jest.mocked(request.get);

test('history limits are configurable and bounded, with the existing preference as the client gate', () => {
  expect(interfaceSchema.parse({}).historyWindowSize).toBe(24);
  expect(interfaceSchema.parse({ historyWindowSize: 0 }).historyWindowSize).toBe(0);
  expect(interfaceSchema.safeParse({ historyWindowSize: 101 }).success).toBe(false);
});

test('encodes identifiers and cursor selectors without colliding with literal message ids', async () => {
  const page = { messages: [], nextCursor: null, start: null };
  get.mockResolvedValueOnce(page);
  expect(
    await getConversationHistory('chat/id', {
      limit: 12,
      before: { createdAt: '2026-01-01T00:00:00.000Z', position: '000000000000000000000001' },
    }),
  ).toEqual(page);
  const url = new URL(get.mock.calls[get.mock.calls.length - 1][0], 'http://localhost');
  expect(url.pathname).toBe('/api/messages/chat%2Fid');
  expect(url.searchParams.get('history')).toBe('recent');
  expect(JSON.parse(url.searchParams.get('before')!)).toHaveProperty(
    'position',
    '000000000000000000000001',
  );
  get.mockResolvedValueOnce({ text: 'Body' });
  await getAttachmentBody({
    conversationId: 'chat/id',
    messageId: 'message/id',
    index: 2,
    revision: 'v1',
  });
  expect(get.mock.calls[get.mock.calls.length - 1][0]).toContain(
    '/api/messages/chat%2Fid/message%2Fid/attachments/2',
  );
});

test('an old server full-array response remains complete during a rolling upgrade', async () => {
  get.mockResolvedValueOnce([{ messageId: 'legacy' }]);
  expect(await getConversationHistory('chat')).toEqual({
    messages: [{ messageId: 'legacy' }],
    nextCursor: null,
    start: null,
  });
});
