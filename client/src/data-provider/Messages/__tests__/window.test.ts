import { QueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { HistoryWindow } from '../window';
import { readDisplayMessages, prependHistory } from '../window';
jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

const message = (id: number): TMessage => ({
  messageId: String(id),
  conversationId: 'chat',
  sender: 'Assistant',
  text: `Synthetic reply ${id}`,
  parentMessageId: String(id - 1),
  isCreatedByUser: false,
  createdAt: new Date(2026, 0, 1, 0, 0, id).toISOString(),
});
const start = { createdAt: message(40).createdAt!, position: '000000000000000000000040' };
const makeClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, cacheTime: Infinity } } });

test('a cold read fetches only one recent page; revalidation keeps the complete loaded span', async () => {
  const client = makeClient();
  const recent = jest
    .spyOn(dataService, 'getConversationHistory')
    .mockResolvedValue({ messages: [message(40), message(41)], start, nextCursor: start });
  const full = jest.spyOn(dataService, 'getMessagesByConvoId');
  const messages = await readDisplayMessages('chat', client, 24);
  expect(recent).toHaveBeenCalledTimes(1);
  expect(recent).toHaveBeenLastCalledWith('chat', { limit: 24 });
  expect(full).not.toHaveBeenCalled();
  client.setQueryData([QueryKeys.messages, 'chat'], messages);
  recent.mockResolvedValue({ messages: [message(40), message(42)], start, nextCursor: null });
  expect(await readDisplayMessages('chat', client)).toEqual([message(40), message(42)]);
  expect(recent).toHaveBeenLastCalledWith('chat', { limit: 24, since: start });
  expect(client.getQueryData<HistoryWindow>([QueryKeys.historyWindow, 'chat'])?.nextCursor).toEqual(
    start,
  );
  client.clear();
});

test('disabling the preference reads full lightweight history and clears paging', async () => {
  const client = makeClient();
  client.setQueryData([QueryKeys.historyWindow, 'chat'], { start, nextCursor: start, limit: 24 });
  const full = jest.spyOn(dataService, 'getMessagesByConvoId').mockResolvedValue([message(0)]);
  expect(await readDisplayMessages('chat', client, 0)).toEqual([message(0)]);
  expect(full).toHaveBeenCalledWith('chat', { toolPreviews: true, lazyAttachments: true });
  expect(client.getQueryData([QueryKeys.historyWindow, 'chat'])).toBeUndefined();
  client.clear();
});

test('a live cache write during revalidation cannot roll back a prepended boundary', async () => {
  const client = makeClient();
  client.setQueryData([QueryKeys.messages, 'chat'], [message(40)]);
  client.setQueryData([QueryKeys.historyWindow, 'chat'], { start, nextCursor: start, limit: 24 });
  let finish!: (page: Awaited<ReturnType<typeof dataService.getConversationHistory>>) => void;
  jest.spyOn(dataService, 'getConversationHistory').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = readDisplayMessages('chat', client);
  const older = { createdAt: message(20).createdAt!, position: '000000000000000000000020' };
  client.setQueryData([QueryKeys.messages, 'chat'], [message(20), message(40)]);
  client.setQueryData([QueryKeys.historyWindow, 'chat'], {
    start: older,
    nextCursor: older,
    limit: 24,
  });
  finish({ messages: [message(40)], start, nextCursor: null });
  await pending;
  expect(client.getQueryData<HistoryWindow>([QueryKeys.historyWindow, 'chat'])?.start).toEqual(
    older,
  );
  client.clear();
});

test('older pages preserve newer streamed objects and never duplicate a boundary message', () => {
  const live = { ...message(40), text: 'Newest streaming text' };
  const merged = prependHistory([message(39), message(40)], [live, message(41)]);
  expect(merged.map((row) => row.messageId)).toEqual(['39', '40', '41']);
  expect(merged[1]).toBe(live);
});
