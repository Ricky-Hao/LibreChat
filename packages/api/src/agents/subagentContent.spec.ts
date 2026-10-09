import { ContentTypes } from 'librechat-data-provider';
import { createContentAggregator, GraphEvents, StepTypes } from '@librechat/agents';
import type { Agents, SubagentUpdateEvent } from 'librechat-data-provider';
import type { SubagentContentBuffer } from './subagentContent';
import {
  collectSubagentContent,
  snapshotSubagentContent,
  finalizeSubagentContent,
} from './subagentContent';

const parent = (): Agents.MessageContentComplex => ({
  type: ContentTypes.TOOL_CALL,
  tool_call: { id: 'call', name: 'subagent', args: '{}', stepId: 'parent-step' },
});
const update = (
  phase: SubagentUpdateEvent['phase'],
  data?: object,
  run = 'child',
): SubagentUpdateEvent => ({
  runId: 'parent',
  parentToolCallId: 'call',
  subagentRunId: run,
  subagentType: 'self',
  subagentAgentId: 'agent',
  phase,
  data,
  timestamp: '',
});
function start(
  buffer: SubagentContentBuffer,
  parts: Array<Agents.MessageContentComplex | undefined>,
  run = 'child',
) {
  collectSubagentContent(
    buffer,
    parts,
    update(
      'run_step',
      {
        id: 'text',
        index: 0,
        stepDetails: {
          type: 'message_creation',
          message_creation: { message_id: 'text', phase: 'commentary' },
        },
      },
      run,
    ),
  );
}
function delta(
  buffer: SubagentContentBuffer,
  parts: Array<Agents.MessageContentComplex | undefined>,
  text: string,
  run = 'child',
) {
  collectSubagentContent(
    buffer,
    parts,
    update('message_delta', { id: 'text', delta: { content: [{ type: 'text', text }] } }, run),
  );
}

it('snapshots without draining or mutating a previously captured view', () => {
  const parts = [parent()];
  const buffer: SubagentContentBuffer = new Map();
  start(buffer, parts);
  delta(buffer, parts, 'Before');
  const first = snapshotSubagentContent(parts, buffer);
  delta(buffer, parts, ' after');
  expect(buffer.size).toBe(1);
  expect(first[0]).toMatchObject({ tool_call: { subagent_content: [{ text: 'Before' }] } });
  expect(snapshotSubagentContent(parts, buffer)[0]).toMatchObject({
    tool_call: { subagent_content: [{ text: 'Before after' }] },
  });
  finalizeSubagentContent(parts, buffer);
  expect(buffer.size).toBe(0);
  expect(parts[0]).toMatchObject({ tool_call: { subagent_content: [{ text: 'Before after' }] } });
});

it.each(['snapshot', 'finalize'] as const)(
  '%s preserves SDK sparse parent indices and child activity',
  (operation) => {
    const aggregator = createContentAggregator();
    aggregator.aggregateContent({
      event: GraphEvents.ON_RUN_STEP,
      data: {
        type: StepTypes.TOOL_CALLS,
        id: 'parent-step',
        runId: 'parent',
        index: 2,
        stepDetails: {
          type: StepTypes.TOOL_CALLS,
          tool_calls: [{ id: 'call', name: 'subagent', args: {} }],
        },
      },
    });
    const parts = aggregator.contentParts;
    // The SDK reserves global step indices even when preceding steps have no content.
    expect(parts).toHaveLength(3);
    expect(0 in parts).toBe(false);
    const owner = parts[2];
    const buffer: SubagentContentBuffer = new Map();
    start(buffer, parts);
    delta(buffer, parts, 'Child answer');
    // Preserve a separate parent answer after another unfilled slot.
    parts[4] = { type: ContentTypes.TEXT, text: 'Parent answer' };
    let result = parts;
    if (operation === 'snapshot') {
      result = snapshotSubagentContent(parts, buffer);
    } else {
      finalizeSubagentContent(parts, buffer);
    }
    expect(result).toHaveLength(5);
    expect(result[0]).toBeUndefined();
    expect(result[1]).toBeUndefined();
    expect(result[3]).toBeUndefined();
    expect(result[2]).toMatchObject({
      tool_call: {
        id: 'call',
        subagent_content: [{ text: 'Child answer', subagentRunId: 'child' }],
      },
    });
    expect(result[4]).toEqual({ type: ContentTypes.TEXT, text: 'Parent answer' });
    expect(owner).not.toHaveProperty('tool_call.subagent_content');
    expect(buffer.size).toBe(operation === 'snapshot' ? 1 : 0);
    if (operation === 'snapshot') {
      expect(parts[2]).toBe(owner);
      delta(buffer, parts, ' continued');
      expect(snapshotSubagentContent(parts, buffer)[2]).toMatchObject({
        tool_call: { subagent_content: [{ text: 'Child answer continued' }] },
      });
      expect(result[2]).toMatchObject({
        tool_call: { subagent_content: [{ text: 'Child answer' }] },
      });
    }
  },
);

it('does not guess a parent occurrence from an ambiguous legacy call ID', () => {
  const parts = [parent(), parent()];
  const buffer: SubagentContentBuffer = new Map();
  start(buffer, parts);
  delta(buffer, parts, 'Unassigned');
  expect(snapshotSubagentContent(parts, buffer)).toEqual(parts);
});

it('keeps legitimate repeated tokens while deduplicating identified receipts', () => {
  const parts = [parent()];
  const buffer: SubagentContentBuffer = new Map();
  start(buffer, parts);
  delta(buffer, parts, 'ha');
  delta(buffer, parts, 'ha');
  const receipt = {
    ...update('message_delta', { id: 'text', delta: { content: [{ type: 'text', text: '!' }] } }),
    activityEventId: 'receipt',
  };
  collectSubagentContent(buffer, parts, receipt);
  collectSubagentContent(buffer, parts, receipt);
  expect(snapshotSubagentContent(parts, buffer)[0]).toMatchObject({
    tool_call: { subagent_content: [{ text: 'haha!' }] },
  });
});

it('retains a HITL prefix, resumes the same child step, and rejects overlapping sequence receipts', () => {
  const parts = [parent()];
  const buffer: SubagentContentBuffer = new Map();
  start(buffer, parts);
  delta(buffer, parts, 'Before');
  const paused = JSON.parse(JSON.stringify(snapshotSubagentContent(parts, buffer)));
  const resumed: SubagentContentBuffer = new Map();
  const duplicate = {
    ...update('message_delta', {
      id: 'text',
      delta: { content: [{ type: 'text', text: 'Before' }] },
    }),
    activitySequence: 1,
  };
  collectSubagentContent(resumed, paused, duplicate);
  start(resumed, paused);
  delta(resumed, paused, ' after');
  expect(snapshotSubagentContent(paused, resumed)[0]).toMatchObject({
    tool_call: { subagent_content: [{ text: 'Before after' }] },
  });
  expect(
    (snapshotSubagentContent(paused, resumed)[0] as { tool_call: { subagent_content: object[] } })
      .tool_call.subagent_content,
  ).toHaveLength(1);
});

it('retains prior child runs and handles parent index shifts and object replacement by step identity', () => {
  const parts = [parent()];
  const buffer: SubagentContentBuffer = new Map();
  start(buffer, parts);
  delta(buffer, parts, 'First');
  finalizeSubagentContent(parts, buffer);
  parts.unshift({ type: ContentTypes.TEXT, text: 'Parent answer' });
  start(buffer, parts, 'second-child');
  delta(buffer, parts, 'Second', 'second-child');
  parts[1] = { ...parts[1] };
  const snapshot = snapshotSubagentContent(parts, buffer);
  expect(snapshot[0]).toEqual({ type: ContentTypes.TEXT, text: 'Parent answer' });
  expect(snapshot[1]).toMatchObject({
    tool_call: { subagent_content: [{ text: 'First' }, { text: 'Second' }] },
  });
});

it('keeps successive child runs on one occurrence without waiting for a final save', () => {
  const parts = [parent()];
  const buffer: SubagentContentBuffer = new Map();
  start(buffer, parts);
  delta(buffer, parts, 'First');
  start(buffer, parts, 'second-child');
  delta(buffer, parts, 'Second', 'second-child');
  expect(snapshotSubagentContent(parts, buffer)[0]).toMatchObject({
    tool_call: { subagent_content: [{ text: 'First' }, { text: 'Second' }] },
  });
  collectSubagentContent(buffer, parts, update('start', undefined, 'empty-child'));
  expect(snapshotSubagentContent(parts, buffer)[0]).toMatchObject({
    tool_call: { subagent_content: [{ text: 'First' }, { text: 'Second' }] },
  });
});

it('keeps reused child tool IDs scoped to their step across a resumed snapshot', () => {
  const parts = [parent()];
  const buffer: SubagentContentBuffer = new Map();
  for (const [id, index] of [
    ['first', 0],
    ['second', 1],
  ] as const) {
    collectSubagentContent(
      buffer,
      parts,
      update('run_step', {
        id,
        index,
        stepDetails: {
          type: 'tool_calls',
          tool_calls: [{ id: 'reused', name: 'lookup', args: '{}' }],
        },
      }),
    );
  }
  const paused = JSON.parse(JSON.stringify(snapshotSubagentContent(parts, buffer)));
  const resumed: SubagentContentBuffer = new Map();
  collectSubagentContent(
    resumed,
    paused,
    update('run_step_completed', {
      result: {
        id: 'second',
        index: 1,
        type: 'tool_call',
        tool_call: {
          id: 'reused',
          name: 'lookup',
          args: '{}',
          output: 'Second result',
          progress: 1,
        },
      },
    }),
  );
  expect(snapshotSubagentContent(paused, resumed)[0]).toMatchObject({
    tool_call: {
      subagent_content: [
        { stepId: 'first', tool_call: { id: 'reused' } },
        { stepId: 'second', tool_call: { id: 'reused', output: 'Second result' } },
      ],
    },
  });
});

it('restores wire IDs for tool calls discovered incrementally within a batch', () => {
  const parts = [parent()];
  const buffer: SubagentContentBuffer = new Map();
  collectSubagentContent(
    buffer,
    parts,
    update('run_step', {
      id: 'batch',
      index: 0,
      stepDetails: { type: 'tool_calls', tool_calls: [] },
    }),
  );
  for (const index of [0, 1]) {
    collectSubagentContent(
      buffer,
      parts,
      update('run_step_delta', {
        id: 'batch',
        delta: {
          type: 'tool_calls',
          tool_calls: [{ index, id: `tool-${index}`, name: 'lookup', args: '{}' }],
        },
      }),
    );
  }
  expect(snapshotSubagentContent(parts, buffer)[0]).toMatchObject({
    tool_call: {
      subagent_content: [
        { stepId: 'batch', tool_call: { id: 'tool-0', args: '{}' } },
        { stepId: 'batch', tool_call: { id: 'tool-1', args: '{}' } },
      ],
    },
  });
});
