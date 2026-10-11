import React from 'react';
import { Provider, createStore } from 'jotai';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { TConversation, TMessage } from 'librechat-data-provider';
import type { MessagesViewContextValue } from '~/Providers/MessagesViewContext';
import type { ScrollNavigation } from '../useMessageScrolling';
import { MessagesViewContext } from '~/Providers/MessagesViewContext';
import useMessageScrolling from '../useMessageScrolling';
import { autoScrollAtom } from '~/store/autoScroll';

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  observe = jest.fn();
  disconnect = jest.fn();
  unobserve = jest.fn();
  constructor(readonly listener: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  callback() {
    this.listener([], this);
  }
}

const originalResizeObserver = global.ResizeObserver;
const treeFor = (conversationId: string): TMessage[] =>
  [
    { conversationId, messageId: `${conversationId}-response`, isCreatedByUser: false },
  ] as TMessage[];

type Props = {
  route: string;
  context: string;
  tree: TMessage[] | null;
  submitting: boolean;
  ready: boolean;
  sendId?: string;
  abort?: boolean;
};

let latestScroll: ReturnType<typeof useMessageScrolling>;
let height = 1000;
const scrollTo = jest.fn();
const setAbortScroll = jest.fn();
const bottomLabel = 'Bottom';
const oldButtonLabel = 'Old button';

function Harness({ tree, route, ready, sendId }: Props) {
  const navigation: ScrollNavigation = { conversationKey: route, ready, explicitSendId: sendId };
  const scrolling = useMessageScrolling(tree, navigation);
  latestScroll = scrolling;
  return (
    <>
      <div
        data-testid="scrollable"
        onScroll={scrolling.debouncedHandleScroll}
        ref={(el) => {
          scrolling.scrollableRef.current = el;
          if (el) {
            Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => height });
            Object.defineProperty(el, 'clientHeight', { configurable: true, value: 200 });
            el.scrollTo = scrollTo;
          }
        }}
      >
        <div ref={scrolling.contentRef} data-testid="content">
          <textarea aria-label="Edit" />
          <div ref={scrolling.messagesEndRef} />
        </div>
      </div>
      <button onClick={scrolling.handleSmoothToRef}>{bottomLabel}</button>
    </>
  );
}

function setup(overrides: Partial<Props> = {}, autoScroll = true) {
  const store = createStore();
  store.set(autoScrollAtom, autoScroll);
  let props: Props = {
    route: 'a',
    context: 'a',
    tree: treeFor('a'),
    submitting: false,
    ready: true,
    ...overrides,
  };
  const renderTree = () => {
    const value: MessagesViewContextValue = {
      conversation: { conversationId: props.context } as TConversation,
      conversationId: props.context,
      isSubmitting: props.submitting,
      abortScroll: props.abort ?? false,
      setAbortScroll,
      readOnly: false,
      ask: jest.fn(),
      regenerate: jest.fn(),
      handleContinue: jest.fn(),
      index: 0,
      latestMessageId: undefined,
      latestMessageDepth: undefined,
      getMessages: jest.fn(),
      setMessages: jest.fn(),
    };
    return (
      <Provider store={store}>
        <MessagesViewContext.Provider value={value}>
          <Harness {...props} />
        </MessagesViewContext.Provider>
      </Provider>
    );
  };
  const view = render(renderTree(), { wrapper: React.StrictMode });
  return {
    ...view,
    el: screen.getByTestId('scrollable'),
    update: (next: Partial<Props>) => {
      props = { ...props, ...next };
      view.rerender(renderTree());
    },
    toggle: (value: boolean) => act(() => store.set(autoScrollAtom, value)),
  };
}

function resize(nextHeight: number) {
  height = nextHeight;
  act(() => ResizeObserverMock.instances.at(-1)?.callback());
}

function upward(el: HTMLElement, method: string) {
  if (method === 'wheel') fireEvent.wheel(el, { deltaY: -100 });
  if (method === 'keyboard') fireEvent.keyDown(el, { key: 'PageUp' });
  if (method === 'touch') {
    fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ clientY: 200 }] });
  }
  if (method === 'scrollbar') fireEvent.pointerDown(el);
  el.scrollTop = 300;
  fireEvent.scroll(el);
}

describe('conversation scroll ownership', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    height = 1000;
    ResizeObserverMock.instances = [];
    global.ResizeObserver = ResizeObserverMock;
    scrollTo.mockReset();
    setAbortScroll.mockReset();
  });
  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it.each([false, true])('lands running navigation only with preference %s', (enabled) => {
    const { el, update } = setup({ submitting: true }, enabled);
    expect(el.scrollTop).toBe(enabled ? 800 : 0);
    update({ tree: treeFor('a') });
    resize(1400);
    expect(el.scrollTop).toBe(enabled ? 1200 : 0);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves non-running opening preference %s', (enabled) => {
    expect(setup({}, enabled).el.scrollTop).toBe(enabled ? 800 : 0);
  });

  it('waits for route, context, rendered tree and visible route readiness', () => {
    const { el, update } = setup({
      route: 'b',
      context: 'a',
      tree: treeFor('a'),
      submitting: true,
    });
    expect(el.scrollTop).toBe(0);
    update({ tree: treeFor('b') });
    resize(1200);
    expect(el.scrollTop).toBe(0);
    update({ context: 'b', ready: false });
    expect(el.scrollTop).toBe(0);
    update({ ready: true });
    expect(el.scrollTop).toBe(1000);
  });

  it('lands cold history and follows delayed revalidation, resume and row bodies', () => {
    const { el, update } = setup({ tree: null });
    expect(el.scrollTop).toBe(0);
    update({ tree: treeFor('a') });
    expect(el.scrollTop).toBe(800);
    resize(1800);
    expect(el.scrollTop).toBe(1600);
    update({ submitting: true });
    resize(2200);
    expect(el.scrollTop).toBe(2000);
  });

  it('re-arms running A -> running B while isSubmitting stays true', () => {
    const { el, update } = setup({ submitting: true });
    upward(el, 'wheel');
    update({ route: 'b', tree: treeFor('b') });
    expect(el.scrollTop).toBe(300);
    update({ context: 'b' });
    expect(el.scrollTop).toBe(800);
    resize(1300);
    expect(el.scrollTop).toBe(1100);
  });

  it('re-arms the same id via new chat, even with the outgoing tree still cached', () => {
    const { el, update } = setup({ submitting: true });
    upward(el, 'wheel');
    update({ route: 'new' });
    update({ route: 'a' });
    expect(el.scrollTop).toBe(800);
  });

  it('records the bottom of a short thread before its first growth', () => {
    height = 100;
    const { el } = setup({ submitting: true });
    expect(el.scrollTop).toBe(0);
    resize(1100);
    expect(el.scrollTop).toBe(900);
  });

  it.each(['wheel', 'keyboard', 'touch', 'scrollbar'])(
    'lets upward %s beat late history, resume, resize and glide timeout',
    (method) => {
      const { el, update } = setup();
      upward(el, method);
      update({ tree: treeFor('a'), submitting: true });
      resize(1600);
      act(() => jest.advanceTimersByTime(1000));
      expect(el.scrollTop).toBe(300);
      expect(scrollTo).not.toHaveBeenCalled();
    },
  );

  it.each(['wheel', 'keyboard', 'touch', 'scrollbar'])(
    'lets %s during identity recovery consume the pending navigation',
    (method) => {
      const { el, update } = setup({ context: 'b', ready: false });
      el.scrollTop = 600;
      fireEvent.pointerDown(el);
      upward(el, method);
      update({ context: 'a', ready: true, submitting: true });
      resize(1600);
      expect(el.scrollTop).toBe(300);
    },
  );

  it.each(['wheel', 'keyboard', 'touch'])(
    'honors %s intent even when a short thread cannot move yet',
    (method) => {
      height = 100;
      const { el, update } = setup();
      if (method === 'wheel') fireEvent.wheel(el, { deltaY: -1 });
      if (method === 'keyboard') fireEvent.keyDown(el, { key: 'ArrowUp' });
      if (method === 'touch') {
        fireEvent.touchStart(el, { touches: [{ clientY: 0 }] });
        fireEvent.touchMove(el, { touches: [{ clientY: 10 }] });
      }
      update({ submitting: true });
      resize(1100);
      expect(el.scrollTop).toBe(0);
    },
  );

  it('does not mistake editing keys for a scroll gesture', () => {
    const { el } = setup();
    fireEvent.keyDown(screen.getByLabelText('Edit'), { key: 'Home' });
    resize(1000);
    resize(1200);
    expect(el.scrollTop).toBe(1000);
  });

  it.each([false, true])('explicit sends retain their glide with preference %s', (enabled) => {
    const { el, update } = setup({}, enabled);
    upward(el, 'wheel');
    update({ submitting: true, sendId: 'send-1', abort: true });
    expect(scrollTo).not.toHaveBeenCalled();
    update({ abort: false });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: 'smooth' });
    resize(1500);
    expect(el.scrollTop).toBe(300);
    fireEvent(el, new Event('scrollend'));
    expect(el.scrollTop).toBe(1300);
  });

  it('a gesture while an explicit send waits for connection cancels its pending glide', () => {
    const { el, update } = setup({}, false);
    update({ submitting: true, sendId: 'send', abort: true });
    upward(el, 'keyboard');
    update({ abort: false });
    resize(1500);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(el.scrollTop).toBe(300);
  });

  it('cancels both browser glide and timeout when the reader takes over', () => {
    const { el, update } = setup({}, false);
    update({ submitting: true, sendId: 'send' });
    upward(el, 'wheel');
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    fireEvent(el, new Event('scrollend'));
    act(() => jest.advanceTimersByTime(1000));
    resize(1500);
    expect(el.scrollTop).toBe(300);
  });

  it.each(['scroll', 'button'])(
    'returning by %s resumes following even with preference off',
    (method) => {
      const { el, update } = setup({ submitting: true }, false);
      el.scrollTop = 500;
      fireEvent.pointerDown(el);
      upward(el, 'wheel');
      if (method === 'scroll') {
        fireEvent.keyDown(screen.getByTestId('content'), { key: 'End' });
        el.scrollTop = 800;
        fireEvent.scroll(el);
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Bottom' }));
        fireEvent(el, new Event('scrollend'));
      }
      update({ abort: true });
      resize(1500);
      expect(el.scrollTop).toBe(1300);
    },
  );

  it('never reattaches on a stationary scroll event after upward intent', () => {
    const { el } = setup({ submitting: true });
    fireEvent.wheel(el, { deltaY: -1 });
    fireEvent.scroll(el);
    resize(1500);
    expect(el.scrollTop).toBe(800);
  });

  it('honors a small upward scrollbar movement inside the arrival threshold', () => {
    const { el, update } = setup();
    fireEvent.pointerDown(el);
    el.scrollTop -= 10;
    fireEvent.scroll(el);
    update({ submitting: true });
    resize(1400);
    expect(el.scrollTop).toBe(790);
  });

  it('a gesture in a running visit survives a later false-to-true submission transition', () => {
    const { el, update } = setup({ submitting: true });
    upward(el, 'wheel');
    update({ submitting: false });
    update({ submitting: true });
    resize(1600);
    expect(el.scrollTop).toBe(300);
  });

  it('scopes old resize, button, jump, scrollend and wheel frame callbacks to their visit', () => {
    const { el, update } = setup({ submitting: true });
    const old = latestScroll;
    render(<button onClick={old.handleSmoothToRef}>{oldButtonLabel}</button>);
    const observer = ResizeObserverMock.instances.at(-1);
    fireEvent.wheel(el, { deltaY: 10 });
    fireEvent.click(screen.getByRole('button', { name: 'Bottom' }));
    update({ route: 'b', context: 'b', tree: treeFor('b') });
    upward(el, 'wheel');
    setAbortScroll.mockClear();
    act(() => {
      old.scrollToBottom();
      fireEvent.click(screen.getByRole('button', { name: 'Old button' }));
      observer?.callback();
      jest.advanceTimersByTime(1000);
    });
    fireEvent(el, new Event('scrollend'));
    expect(el.scrollTop).toBe(300);
    expect(setAbortScroll).not.toHaveBeenCalled();
  });

  it('a navigation during a glide cancels its old completion', () => {
    const { el, update } = setup({}, false);
    update({ submitting: true, sendId: 'send' });
    update({ route: 'b', context: 'b', tree: treeFor('b'), sendId: undefined });
    el.scrollTop = 200;
    act(() => jest.advanceTimersByTime(1000));
    fireEvent(el, new Event('scrollend'));
    expect(el.scrollTop).toBe(200);
  });

  it.each([false, true])(
    'preserves first-send ownership across admission (detached=%s)',
    (detached) => {
      height = 100;
      const { el, update } = setup(
        {
          route: 'new',
          context: 'new',
          tree: treeFor('new'),
          submitting: true,
          sendId: 'first',
        },
        false,
      );
      if (detached) fireEvent.wheel(el, { deltaY: -1 });
      update({ route: 'a', context: 'a', tree: treeFor('a') });
      resize(1000);
      expect(el.scrollTop).toBe(detached ? 0 : 800);
    },
  );

  it('turning off stops navigation following, and enabling honors a fresh opening', () => {
    const { el, toggle } = setup({ submitting: true }, false);
    toggle(true);
    expect(el.scrollTop).toBe(800);
    toggle(false);
    resize(1400);
    expect(el.scrollTop).toBe(800);
  });

  it('keeps multi-resize content expansion detached', () => {
    const { el } = setup({ submitting: true });
    fireEvent.pointerDown(screen.getByTestId('content'));
    resize(1800);
    resize(2200);
    expect(el.scrollTop).toBe(800);
  });

  it('clamps a shrunken scroll range without reattaching', () => {
    const { el } = setup({ submitting: true });
    upward(el, 'wheel');
    resize(400);
    expect(el.scrollTop).toBe(200);
    resize(1400);
    expect(el.scrollTop).toBe(200);
  });
});
