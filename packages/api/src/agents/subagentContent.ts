import { Constants, ContentTypes } from 'librechat-data-provider';
import { createContentAggregator, GraphEvents } from '@librechat/agents';
import type {
  Agents,
  SubagentIdentity,
  SubagentUpdateEvent,
  SubagentContentMetadata,
} from 'librechat-data-provider';
import type { RunStep } from '@librechat/agents';
import type { ToolTimingAdapter } from './toolTiming';
import { captureSubagentIdentity } from './subagentIdentity';
import { createOccurrenceAggregator } from './occurrence';
import { createToolTimingAdapter } from './toolTiming';

type Part = Agents.MessageContentComplex & SubagentContentMetadata;
type Parts = Array<Part | undefined>;
type Aggregator = ReturnType<typeof createContentAggregator>;
type Child = Aggregator & {
  subagentIdentity?: SubagentIdentity;
  owner?: Part;
  parentToolCallId?: string;
  parentStepId?: string;
  subagentRunId?: string;
  sequence?: number;
  status?: SubagentUpdateEvent['phase'];
  eventIds?: Set<string>;
  timing?: ToolTimingAdapter;
};
export type SubagentContentBuffer = Map<string, Child>;

/** Matches the client's existing receipt horizon; this bounds dedup metadata, not activity. */
const RECENT_RECEIPTS = 256;

function graphEvent(update: SubagentUpdateEvent): GraphEvents | undefined {
  switch (update.phase) {
    case 'run_step':
      return (update.data as Agents.RunStep | undefined)?.stepDetails
        ? GraphEvents.ON_RUN_STEP
        : undefined;
    case 'run_step_delta':
      return GraphEvents.ON_RUN_STEP_DELTA;
    case 'run_step_completed':
      return GraphEvents.ON_RUN_STEP_COMPLETED;
    case 'message_delta':
      return GraphEvents.ON_MESSAGE_DELTA;
    case 'reasoning_delta':
      return GraphEvents.ON_REASONING_DELTA;
    default:
      return undefined;
  }
}

function findOwner(parts: Parts, child: Child): Part | undefined {
  if (child.owner != null && parts.includes(child.owner)) return child.owner;
  let owner: Part | undefined;
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index];
    if (part?.type !== ContentTypes.TOOL_CALL || part.tool_call.name !== Constants.SUBAGENT)
      continue;
    if (part.tool_call.id !== child.parentToolCallId) continue;
    if (child.parentStepId != null && part.tool_call.stepId !== child.parentStepId) continue;
    if (owner != null) return undefined;
    owner = part;
  }
  return owner;
}

function seedChild(child: Child, prefix: Part[]): void {
  const groups = new Map<string, Part[]>();
  for (const part of prefix) {
    if (part.subagentRunId !== child.subagentRunId || !part.stepId) continue;
    const members = groups.get(part.stepId) ?? [];
    members.push(part);
    groups.set(part.stepId, members);
  }
  for (const [stepId, members] of groups) {
    const part = members[0];
    const index = child.contentParts.length;
    const step = {
      id: stepId,
      index,
      stepDetails:
        part.type === ContentTypes.TOOL_CALL
          ? {
              type: 'tool_calls',
              tool_calls: members.flatMap((entry) =>
                entry.type === ContentTypes.TOOL_CALL ? [{ ...entry.tool_call, args: '' }] : [],
              ),
            }
          : {
              type: 'message_creation',
              message_creation: {
                message_id: stepId,
                phase: 'phase' in part ? part.phase : undefined,
              },
            },
    } as RunStep;
    child.aggregateContent({ event: GraphEvents.ON_RUN_STEP, data: step });
    for (let offset = 0; offset < members.length; offset++) {
      child.contentParts[index + offset] = structuredClone(members[offset]);
    }
    child.sequence = Math.max(child.sequence ?? -1, part.subagentSequence ?? -1);
  }
}

/** Fold only child envelopes, never child deltas into the parent answer. */
export function collectSubagentContent(
  buffer: SubagentContentBuffer | undefined,
  parts: Parts | undefined,
  update: SubagentUpdateEvent,
  parentSteps?: Aggregator['stepMap'],
): void {
  if (!buffer || !update.parentToolCallId) return;
  const key = JSON.stringify([
    update.parentRunId ?? update.runId,
    update.parentToolCallId,
    update.subagentRunId,
  ]);
  let child = buffer.get(key);
  if (!child) {
    child = Object.assign(createOccurrenceAggregator(), {
      parentToolCallId: update.parentToolCallId,
      subagentRunId: update.subagentRunId,
    });
    // Resolve against the current parent run-step before binding. The same provider
    // call ID may occur in a later step or another parallel agent's run.
    for (const step of parentSteps?.values() ?? []) {
      if (step?.stepDetails.type !== 'tool_calls') continue;
      if (step.runId && step.runId !== (update.parentRunId ?? update.runId)) continue;
      const callIndex =
        step.stepDetails.tool_calls?.findIndex((call) => call.id === update.parentToolCallId) ?? -1;
      if (callIndex < 0) continue;
      const owner = parts?.[step.index + callIndex];
      if (owner?.type !== ContentTypes.TOOL_CALL || owner.tool_call.id !== update.parentToolCallId)
        continue;
      owner.tool_call.stepId = step.id;
      child.parentStepId = step.id;
    }
    child.owner = parts == null ? undefined : findOwner(parts, child);
    if (child.owner?.type === ContentTypes.TOOL_CALL) {
      child.parentStepId = child.owner.tool_call.stepId;
      seedChild(child, (child.owner.tool_call.subagent_content as Part[]) ?? []);
    }
    buffer.set(key, child);
  }
  // Sequences are authoritative where supplied. The fallback retains only a bounded
  // duplicate horizon; identical unlabelled deltas are legitimate repeated tokens.
  if (update.activityEventId) {
    child.eventIds ??= new Set();
    if (child.eventIds.has(update.activityEventId)) return;
    child.eventIds.add(update.activityEventId);
    if (child.eventIds.size > RECENT_RECEIPTS)
      child.eventIds.delete(child.eventIds.values().next().value!);
  }
  update.activitySequence ??= (child.sequence ?? -1) + 1;
  if (child.sequence != null && update.activitySequence <= child.sequence) return;
  child.sequence = update.activitySequence;
  child.status = update.phase;
  update.activityEventId ??= `${update.subagentRunId}:${update.activitySequence}`;
  captureSubagentIdentity(child, update);
  const event = graphEvent(update);
  const stepId = (update.data as { id?: string } | undefined)?.id;
  if (event && !(update.phase === 'run_step' && stepId && child.stepMap.has(stepId))) {
    let data = update.data as Parameters<Aggregator['aggregateContent']>[0]['data'];
    if (event === GraphEvents.ON_RUN_STEP) {
      const step = data as RunStep;
      if (
        step.stepDetails.type === 'message_creation' &&
        step.stepDetails.message_creation == null
      ) {
        data = {
          ...step,
          stepDetails: { ...step.stepDetails, message_creation: { message_id: step.id } },
        };
      }
    }
    child.aggregateContent({ event, data });
  }
  child.timing ??= createToolTimingAdapter({ emit: () => undefined });
  child.timing.child(child, update);
  const data = update.data as Agents.RunStep | undefined;
  const step = data?.id == null ? undefined : child.stepMap.get(data.id);
  const calls = data?.stepDetails?.type === 'tool_calls' ? data.stepDetails.tool_calls : undefined;
  for (let index = 0; index < (calls?.length ?? 0); index++) {
    const source = calls?.[index];
    const target = step == null ? undefined : child.contentParts[step.index + index];
    if (
      target?.type === ContentTypes.TOOL_CALL &&
      target.tool_call.id === source?.id &&
      source &&
      'mcpServerName' in source &&
      typeof source.mcpServerName === 'string'
    ) {
      target.tool_call.mcpServerName = source.mcpServerName;
    }
  }
}

/** Snapshot without draining live aggregators. Copies parent calls so future deltas cannot
 * mutate an already captured reconnect snapshot. Existing resumed activity is retained. */
export function snapshotSubagentContent(parts: Part[], buffer?: SubagentContentBuffer): Part[];
export function snapshotSubagentContent(parts: Parts, buffer?: SubagentContentBuffer): Parts;
export function snapshotSubagentContent(parts: Parts, buffer?: SubagentContentBuffer): Parts {
  if (!buffer?.size) return parts;
  const result = parts.slice();
  const indices = new Map<Part, number>();
  const owners = new Map<string, Part | undefined>();
  // SDK content is sparse. Index only present owners without compacting stream positions.
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part?.type !== ContentTypes.TOOL_CALL || part.tool_call.name !== Constants.SUBAGENT)
      continue;
    indices.set(part, index);
    owners.set(JSON.stringify([part.tool_call.id, part.tool_call.stepId]), part);
    const callKey = JSON.stringify([part.tool_call.id]);
    // Without a retained object or step identity, a reused raw ID is ambiguous.
    owners.set(callKey, owners.has(callKey) ? undefined : part);
  }
  for (const [key, child] of buffer) {
    // Compatibility with already-created legacy buffers keyed by the parent tool ID.
    child.parentToolCallId ??= key;
    const owner =
      child.owner != null && indices.has(child.owner)
        ? child.owner
        : owners.get(
            JSON.stringify(
              child.parentStepId == null
                ? [child.parentToolCallId]
                : [child.parentToolCallId, child.parentStepId],
            ),
          );
    if (owner?.type !== ContentTypes.TOOL_CALL) continue;
    const index = indices.get(owner)!;
    const stepByIndex = new Map<number, string>();
    const stepByTool = new Map<string, string>();
    for (const step of child.stepMap?.values() ?? []) {
      if (!step) continue;
      stepByIndex.set(step.index, step.id);
      if (step.stepDetails.type === 'tool_calls') {
        for (const call of step.stepDetails.tool_calls ?? []) {
          if (call.id) stepByTool.set(call.id, step.id);
        }
      }
    }
    const content = child.contentParts.flatMap((part, index) =>
      part == null
        ? []
        : [
            {
              ...part,
              ...(part.type === ContentTypes.TOOL_CALL
                ? {
                    tool_call: {
                      ...part.tool_call,
                      stepId: part.tool_call.stepId ?? stepByTool.get(part.tool_call.id ?? ''),
                    },
                  }
                : {}),
              ...(child.subagentRunId == null ? {} : { subagentRunId: child.subagentRunId }),
              stepId:
                part.type === ContentTypes.TOOL_CALL
                  ? (part.tool_call.stepId ?? stepByTool.get(part.tool_call.id ?? ''))
                  : stepByIndex.get(index),
              ...(child.sequence == null ? {} : { subagentSequence: child.sequence }),
              ...(child.status == null ? {} : { subagentStatus: child.status }),
            },
          ],
    );
    const projected = result[index]!;
    const existing =
      projected.type === ContentTypes.TOOL_CALL
        ? (projected.tool_call.subagent_content as Part[] | undefined)
        : undefined;
    const prefix = (existing ?? []).filter(
      (part) =>
        child.subagentRunId == null ||
        part.subagentRunId !== child.subagentRunId ||
        part.stepId == null,
    );
    result[index] = {
      ...owner,
      tool_call: {
        ...(projected.type === ContentTypes.TOOL_CALL ? projected.tool_call : owner.tool_call),
        ...(child.subagentIdentity == null ? {} : { subagentIdentity: child.subagentIdentity }),
        ...(content.length === 0 ? {} : { subagent_content: [...(prefix ?? []), ...content] }),
      },
    };
  }
  return result;
}

/** Final save has the same projection as reconnect, then releases the completed run. */
export function finalizeSubagentContent(parts: Parts, buffer: SubagentContentBuffer): void {
  const snapshot = snapshotSubagentContent(parts, buffer);
  if (snapshot !== parts) parts.splice(0, parts.length, ...snapshot);
  buffer.clear();
}
