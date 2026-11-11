import { useRef } from 'react';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { HistoryPage, TMessage } from 'librechat-data-provider';
import useHistoryPaging from '../useHistoryPaging';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});
const row = (id: number): TMessage => ({
  messageId: String(id),
  parentMessageId: String(id - 1),
  conversationId: 'chat',
  sender: 'User',
  text: String(id),
  isCreatedByUser: true,
});
const detach = jest.fn();
function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const { data: messages } = useQuery<TMessage[]>([QueryKeys.messages, 'chat'], { enabled: false });
  const history = useHistoryPaging('chat', messages, ref, detach);
  return (
    <div
      ref={(element) => {
        Object.assign(ref, { current: element });
        if (element) {
          element.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
          Object.defineProperty(element, 'clientHeight', { value: 200 });
        }
      }}
      data-testid="scrollable"
    >
      <button onClick={history.load}>{history.isError ? 'Retry' : 'Older'}</button>
      {messages?.map((message, index) => (
        <div
          key={message.messageId}
          id={message.messageId}
          className="message-render"
          ref={(element) => {
            if (element)
              element.getBoundingClientRect = () =>
                new DOMRect(0, index * 100 - (ref.current?.scrollTop ?? 0), 400, 100);
          }}
        >
          {message.text}
        </div>
      ))}
    </div>
  );
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: Infinity } },
  });
  client.setQueryData([QueryKeys.messages, 'chat'], [row(2), row(3), row(4)]);
  client.setQueryData([QueryKeys.historyWindow, 'chat'], {
    start: { createdAt: '2026-01-01T00:00:00.000Z', position: '000000000000000000000002' },
    nextCursor: { createdAt: '2026-01-01T00:00:00.000Z', position: '000000000000000000000002' },
    limit: 24,
  });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return client;
}

test('does not prefetch; prepends once and preserves the reader anchor including movement during the request', async () => {
  let finish!: (page: HistoryPage) => void;
  const request = jest.spyOn(dataService, 'getConversationHistory').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const client = mount();
  expect(request).not.toHaveBeenCalled();
  const container = screen.getByTestId('scrollable');
  container.scrollTop = 50;
  fireEvent.click(screen.getByRole('button', { name: 'Older' }));
  fireEvent.click(screen.getByRole('button', { name: 'Older' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(detach).toHaveBeenCalledTimes(1);
  container.scrollTop = 80;
  // A streaming commit during the fetch must not consume the prepend anchor.
  client.setQueryData([QueryKeys.messages, 'chat'], [row(2), row(3), row(4), row(5)]);
  finish({ messages: [row(0), row(1), row(2)], start: null, nextCursor: null });
  await waitFor(() => expect(container.scrollTop).toBe(280));
  expect(
    client
      .getQueryData<TMessage[]>([QueryKeys.messages, 'chat'])
      ?.map((message) => message.messageId),
  ).toEqual(['0', '1', '2', '3', '4', '5']);
  expect(request).toHaveBeenCalledTimes(1);
  client.clear();
});

test('a failed page leaves history intact and can be retried', async () => {
  const request = jest
    .spyOn(dataService, 'getConversationHistory')
    .mockRejectedValue(new Error('offline'));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const client = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Older' }));
  await screen.findByRole('button', { name: 'Retry' });
  expect(client.getQueryData<TMessage[]>([QueryKeys.messages, 'chat'])).toHaveLength(3);
  request.mockResolvedValue({ messages: [row(0), row(1)], start: null, nextCursor: null });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(client.getQueryData<TMessage[]>([QueryKeys.messages, 'chat'])).toHaveLength(5),
  );
  client.clear();
});
