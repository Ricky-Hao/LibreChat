import React, { createElement } from 'react';
import { createStore, Provider } from 'jotai';
import { act, renderHook } from '@testing-library/react';
import type { TMessage, TFile } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { siblingIdxFamily } from '~/components/Chat/Messages/Thread/state';
import { focusHistory } from '~/utils/history';
import useThreadRows from '../useThreadRows';

const message = (id: string, parent: string): TMessage => ({
  messageId: id,
  parentMessageId: parent,
  conversationId: 'chat',
  sender: 'Assistant',
  text: id,
  isCreatedByUser: false,
});

test('renders the newest reply in a partial forest and preserves the chosen branch as parents arrive', () => {
  const store = createStore();
  const partial = [
    message('a', 'parent-a'),
    message('a-child', 'a'),
    message('b', 'parent-b'),
    message('b-child', 'b'),
    message('newest-reply', 'a-child'),
  ];
  focusHistory(partial, 'newest-reply');
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store }, children);
  const { result, rerender } = renderHook<
    ReturnType<typeof useThreadRows>,
    { messages: TMessage[]; fileMap?: Record<string, TFile> }
  >(
    ({ messages, fileMap }: { messages: TMessage[]; fileMap?: Record<string, TFile> }) =>
      useThreadRows(messages, 'chat', fileMap),
    { wrapper, initialProps: { messages: partial } },
  );
  expect(result.current?.map((row) => row.source.messageId)).toEqual([
    'a',
    'a-child',
    'newest-reply',
  ]);
  act(() => store.set(siblingIdxFamily('chat'), 0));
  expect(result.current?.at(-1)?.source.messageId).toBe('b-child');
  const full = [message('parent-a', 'none'), message('parent-b', 'none'), ...partial];
  focusHistory(full, 'b-child');
  rerender({ messages: full });
  expect(result.current?.map((row) => row.source.messageId)).toEqual(['parent-b', 'b', 'b-child']);
  act(() => store.set(siblingIdxFamily('chat'), 1));
  expect(result.current?.at(-1)?.source.messageId).toBe('newest-reply');
  rerender({ messages: full, fileMap: {} });
  expect(result.current?.at(-1)?.source.messageId).toBe('newest-reply');
});

import * as thread from '~/utils/thread';

function history(conversationId: string, count: number): TMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    messageId: `${conversationId}-${index}`,
    parentMessageId: index === 0 ? null : `${conversationId}-${index - 1}`,
    conversationId,
    text: `${index}`,
  })) as TMessage[];
}

function setup(messages: TMessage[] | null, conversationId: string) {
  const store = createStore();
  return renderHook(
    (props: { messages: TMessage[] | null; conversationId: string }) =>
      useThreadRows(props.messages, props.conversationId),
    {
      initialProps: { messages, conversationId },
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    },
  );
}

describe('useThreadRows ownership', () => {
  it('does not index the departing large thread for row reuse in another conversation', () => {
    const resolve = jest.spyOn(thread, 'resolveThreadRows');
    const large = history('large', 12_000);
    const small = history('small', 2);
    const { result, rerender } = setup(large, 'large');
    expect(result.current).toHaveLength(12_000);

    rerender({ messages: small, conversationId: 'small' });

    expect(result.current).toHaveLength(2);
    expect(resolve.mock.calls[resolve.mock.calls.length - 1][3]).toBeNull();
    expect(result.current?.[0].source).toBe(small[0]);
  });

  it('preserves row identity for unchanged messages within the same conversation', () => {
    const messages = history('same', 3);
    const { result, rerender } = setup(messages, 'same');
    const first = result.current?.[0];
    const tail = result.current?.[2];

    rerender({
      messages: [messages[0], messages[1], { ...messages[2], text: 'updated' }],
      conversationId: 'same',
    });

    expect(result.current?.[0]).toBe(first);
    expect(result.current?.[2]).not.toBe(tail);
  });

  it('releases the previous rows when the transcript is absent', () => {
    const resolve = jest.spyOn(thread, 'resolveThreadRows');
    const messages = history('same', 3);
    const { result, rerender } = setup(messages, 'same');

    rerender({ messages: null, conversationId: 'same' });
    expect(result.current).toBeNull();
    rerender({ messages, conversationId: 'same' });

    expect(resolve.mock.calls[resolve.mock.calls.length - 1][3]).toBeNull();
  });
});
