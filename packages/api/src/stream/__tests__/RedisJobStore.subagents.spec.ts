import type { Agents, SubagentUpdateEvent } from 'librechat-data-provider';
import type { SubagentContentBuffer } from '~/agents/subagentContent';
import { collectSubagentContent } from '~/agents/subagentContent';
import { RedisJobStore } from '../implementations/RedisJobStore';

const parent = (id = 'parent-step', index = 0) => ({
  event: 'on_run_step',
  data: {
    id,
    index,
    runId: 'parent',
    stepDetails: { type: 'tool_calls', tool_calls: [{ id: 'call', name: 'subagent', args: '{}' }] },
  },
});
const child = (phase: string, data?: object, subagentRunId = 'child') => ({
  event: 'on_subagent_update',
  data: {
    runId: 'parent',
    parentToolCallId: 'call',
    subagentRunId,
    subagentType: 'self',
    subagentKind: 'agent',
    subagentAgentId: 'agent',
    phase,
    data,
    timestamp: '2026-06-01T00:00:00Z',
  },
});
const text = (id: string, index: number, run = 'child') =>
  child(
    'run_step',
    {
      id,
      index,
      stepDetails: {
        type: 'message_creation',
        message_creation: { message_id: id, phase: 'commentary' },
      },
    },
    run,
  );
const delta = (id: string, value: string, run = 'child') =>
  child('message_delta', { id, delta: { content: [{ type: 'text', text: value }] } }, run);

async function reconstruct(chunks: object[]) {
  const store = Object.create(RedisJobStore.prototype) as RedisJobStore;
  Object.defineProperty(store, 'getChunkSnapshot', {
    value: async () => ({ chunks, durableEventCount: chunks.length }),
  });
  return (await store.getContentParts('parent', undefined, { durableOnly: true }))?.content;
}

it('projects the local host buffer without Redis reads and fences it by generation', async () => {
  const store = Object.create(RedisJobStore.prototype) as RedisJobStore;
  Object.defineProperty(store, 'localContentParts', { value: new Map() });
  Object.defineProperty(store, 'localGraphCache', { value: new Map() });
  const read = jest.fn(async () => ({ chunks: [], durableEventCount: 0 }));
  Object.defineProperty(store, 'getChunkSnapshot', { value: read });
  const content = [
    { type: 'tool_call', tool_call: { id: 'call', name: 'subagent', args: '{}' } },
  ] as Agents.MessageContentComplex[];
  const buffer: SubagentContentBuffer = new Map();
  store.setContentParts('parent', content, 100, buffer);
  collectSubagentContent(buffer, content, text('text', 0).data as SubagentUpdateEvent);
  collectSubagentContent(
    buffer,
    content,
    delta('text', 'Live snapshot').data as SubagentUpdateEvent,
  );
  expect((await store.getContentParts('parent', 100))?.content).toMatchObject([
    { tool_call: { subagent_content: [{ text: 'Live snapshot' }] } },
  ]);
  expect(read).not.toHaveBeenCalled();
  expect(await store.getContentParts('parent', 101)).toBeNull();
  expect(buffer.size).toBe(1);
});

it('recovers child activity while the parent is still running, including a finished child', async () => {
  const content = await reconstruct([
    parent(),
    text('child-text', 0),
    delta('child-text', 'Child work'),
    child('stop'),
  ]);
  expect(content).toHaveLength(1);
  expect(content?.[0]).toMatchObject({
    type: 'tool_call',
    tool_call: {
      id: 'call',
      subagent_content: [{ type: 'text', text: 'Child work', phase: 'commentary' }],
    },
  });
});

it('does not conflate repeated parent tool IDs or duplicate identified child events', async () => {
  const repeated = delta('second-text', 'Second', 'child-2');
  Object.assign(repeated.data, { activityEventId: 'event-1', activitySequence: 1 });
  const content = await reconstruct([
    parent(),
    text('first-text', 0),
    delta('first-text', 'First'),
    child('stop'),
    parent('second-parent-step', 1),
    text('second-text', 0, 'child-2'),
    repeated,
    repeated,
  ]);
  expect(content).toHaveLength(2);
  expect(content?.[0]).toMatchObject({ tool_call: { subagent_content: [{ text: 'First' }] } });
  expect(content?.[1]).toMatchObject({ tool_call: { subagent_content: [{ text: 'Second' }] } });
});

it('correlates delayed child starts with their parent run when parallel calls reuse an ID', async () => {
  const first = parent('first', 0);
  const second = parent('second', 1);
  second.data.runId = 'parallel-parent';
  const content = await reconstruct([first, second, text('text', 0), delta('text', 'First child')]);
  expect(content?.[0]).toMatchObject({
    tool_call: { subagent_content: [{ text: 'First child' }] },
  });
  expect(content?.[1]).not.toHaveProperty('tool_call.subagent_content');
});
