import React from 'react';
import axios from 'axios';
import { RecoilRoot } from 'recoil';
import { useAtomValue, useStore } from 'jotai';
import { ContentTypes } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TMessageContentParts, ToolCallPartResponse } from 'librechat-data-provider';
import {
  activeSubagentPanel,
  recoverSubagentProgress,
  reduceSubagentProgress,
  subagentProgressByToolCallId,
  subagentProgressKey,
} from './state';
import ContentParts from '~/components/Chat/Messages/Content/ContentParts';
import SubagentThreadPanel from './SubagentThreadPanel';
import { ChatSurfaceHarness } from 'test/harness';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useFocusTrap: jest.requireActual('~/hooks/useFocusTrap').default,
  useNavigateToConvo: () => ({ navigateToConvo: jest.fn() }),
  useExpandCollapse: () => ({ style: {}, ref: { current: null } }),
  useLazyCollapseBody: jest.requireActual('~/hooks/Messages/useLazyCollapseBody').default,
  useProgress: (initial: number) => initial,
  scheduleMessageContentLayoutReconcile: jest.fn(() => jest.fn()),
}));
jest.mock('~/hooks/MCP', () => ({
  useMCPIconMap: () => new Map(),
  useMCPServerNames: () => [],
}));
jest.mock('~/Providers', () => ({
  ...jest.requireActual('~/Providers'),
  useAgentsMapContext: () => ({}),
}));
jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGetStartupConfig: () => ({ data: undefined }),
  useSubagentThreadQuery: () => ({ data: undefined }),
  useForkConvoMutation: () => ({ mutate: jest.fn() }),
  useSubagentControlMutation: () => ({ mutate: jest.fn() }),
}));
jest.mock('./ParentSubagentsProvider', () => ({
  useParentSubagents: () => ({ byMessageId: new Map(), byThreadId: new Map() }),
}));
jest.mock('~/data-provider/Subagents/useSubagentActivityStream', () => ({
  __esModule: true,
  default: () => undefined,
}));
jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
  useMediaQuery: () => false,
}));
jest.mock('~/components/Chat/Messages/Content/Parts/Text', () => ({
  __esModule: true,
  default: ({ text }: { text: string }) => <div>{text}</div>,
}));
jest.mock('~/components/Chat/Messages/Content/MarkdownLite', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

const content = [
  ...Array.from({ length: 26 }, (_, index) => ({
    type: ContentTypes.TOOL_CALL,
    tool_call: {
      id: `child-${index}`,
      name: 'fixture_tool',
      args: '{}',
      output: 'ok',
      progress: 1,
    },
  })),
  ...Array.from({ length: 5 }, (_, index) => ({
    type: ContentTypes.TEXT,
    text: `Recovered child text ${index}`,
    phase: index === 4 ? 'final_answer' : 'commentary',
  })),
] as TMessageContentParts[];
const tool_call = {
  id: 'parent-call',
  type: 'tool_call' as const,
  name: 'subagent',
  args: '{"task":"Review"}',
  output: 'Done.',
  progress: 1,
  runStepStatus: 'completed' as const,
  stepId: 'parent-step',
};
const preview = [
  {
    type: ContentTypes.TOOL_CALL,
    tool_call: {
      ...tool_call,
      subagentContentOmitted: true,
      subagentContentParts: 31,
      previewRevision: 'revision-1',
    },
  },
] as TMessageContentParts[];
const response: ToolCallPartResponse = {
  conversationId: 'parent',
  messageId: 'message',
  partIndex: 0,
  tool_call: { ...tool_call, subagent_content: content },
};

function PanelHost() {
  const selection = useAtomValue(activeSubagentPanel);
  return selection == null ? null : <SubagentThreadPanel selection={selection} />;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const frame = (parts: TMessageContentParts[]) => (
    <QueryClientProvider client={client}>
      <RecoilRoot>
        <ChatSurfaceHarness>
          <ContentParts
            content={parts}
            messageId="message"
            conversationId="parent"
            isSubmitting={false}
            isCreatedByUser={false}
            showThinking={true}
            isLast={true}
          />
          <PanelHost />
        </ChatSurfaceHarness>
      </RecoilRoot>
    </QueryClientProvider>
  );
  return { ...render(frame(preview)), frame, client };
}

afterEach(() => jest.restoreAllMocks());

it('recovers completed activity after a cold mount and keeps it through a parent preview refetch', async () => {
  let resolve!: (part: ToolCallPartResponse) => void;
  const request = jest.fn(
    () =>
      new Promise((done) => {
        resolve = (data) => done({ data });
      }),
  );
  jest
    .spyOn(axios, 'get')
    .mockImplementation((url) =>
      url.includes('/parts/') ? request() : Promise.resolve({ data: [] }),
    );
  const view = mount();
  fireEvent.click(screen.getByRole('button', { name: /com_ui_subagent_complete/ }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('Recovered child text 4')).not.toBeInTheDocument();
  await act(async () => resolve(response));
  expect(await screen.findByText('Recovered child text 4')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /com_ui_ran_n_actions/ }));
  await waitFor(() =>
    expect(view.container.querySelectorAll('[data-tool-call-id^="child-"]')).toHaveLength(26),
  );
  for (let index = 0; index < 4; index++) {
    expect(screen.getByText(`Recovered child text ${index}`)).toBeInTheDocument();
  }
  view.rerender(view.frame(JSON.parse(JSON.stringify(preview))));
  expect(screen.getByText('Recovered child text 4')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));
  fireEvent.click(screen.getByRole('button', { name: /com_ui_subagent_complete/ }));
  expect(screen.getByText('Recovered child text 4')).toBeVisible();
  expect(request).toHaveBeenCalledTimes(1);
});

it('offers visible retry after detail loading fails', async () => {
  const request = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ data: response });
  jest
    .spyOn(axios, 'get')
    .mockImplementation((url) =>
      url.includes('/parts/') ? request() : Promise.resolve({ data: [] }),
    );
  mount();
  fireEvent.click(screen.getByRole('button', { name: /com_ui_subagent_complete/ }));
  const retry = await screen.findByRole('button', { name: 'com_ui_retry' }, { timeout: 5000 });
  fireEvent.click(retry);
  expect(await screen.findByText('Recovered child text 4')).toBeVisible();
});

it('renders recovered running activity and subsequent deltas in the same open panel', async () => {
  jest.spyOn(axios, 'get').mockResolvedValue({ data: [] });
  const recovered = [
    {
      type: ContentTypes.TEXT,
      text: 'Before',
      phase: 'commentary',
      stepId: 'child-text',
      subagentRunId: 'child',
      subagentSequence: 2,
    },
  ] as TMessageContentParts[];
  function Continue() {
    const store = useStore();
    return (
      <button
        type="button"
        onClick={() => {
          const atom = subagentProgressByToolCallId(
            subagentProgressKey('message', 'parent-call', 0),
          );
          store.set(
            atom,
            reduceSubagentProgress(recoverSubagentProgress(null, recovered), [
              {
                runId: 'message',
                parentToolCallId: 'parent-call',
                subagentRunId: 'child',
                subagentAgentId: 'agent',
                subagentType: 'self',
                phase: 'message_delta',
                timestamp: '',
                activitySequence: 3,
                data: { id: 'child-text', delta: { content: [{ type: 'text', text: ' after' }] } },
              },
            ]),
          );
        }}
      >
        {'Continue fixture'}
      </button>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecoilRoot>
        <ChatSurfaceHarness>
          <ContentParts
            content={[
              {
                type: ContentTypes.TOOL_CALL,
                tool_call: {
                  ...tool_call,
                  progress: 0.5,
                  runStepStatus: undefined,
                  output: '',
                  subagent_content: recovered,
                },
              } as TMessageContentParts,
            ]}
            messageId="message"
            conversationId="parent"
            isSubmitting={true}
            isLatestMessage={true}
            isCreatedByUser={false}
            showThinking={true}
            isLast={true}
          />
          <Continue />
          <PanelHost />
        </ChatSurfaceHarness>
      </RecoilRoot>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /com_ui_subagent_running/ }));
  expect(await screen.findByText('Before')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Continue fixture' }));
  expect(await screen.findByText('Before after')).toBeVisible();
});
