import { createElement } from 'react';
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
