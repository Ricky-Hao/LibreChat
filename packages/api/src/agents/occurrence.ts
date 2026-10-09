import { createContentAggregator, GraphEvents } from '@librechat/agents';
import type { RunStep, RunStepDeltaEvent, ToolEndEvent } from '@librechat/agents';

/** The SDK indexes tool calls by provider ID. Reconstruction spans multiple runs,
 * where those IDs can repeat, so use step-scoped IDs internally and restore the wire IDs. */
export function createOccurrenceAggregator(): ReturnType<typeof createContentAggregator> {
  const aggregator = createContentAggregator();
  const originalIds = new Map<string, string>();
  const indicesByStep = new Map<string, Set<number>>();
  const scoped = (step: string, id: string) => {
    const key = JSON.stringify([step, id]);
    originalIds.set(key, id);
    return key;
  };
  return {
    ...aggregator,
    aggregateContent(input) {
      let data = input.data;
      if (input.event === GraphEvents.ON_RUN_STEP) {
        const step = data as RunStep;
        if (step.stepDetails.type === 'tool_calls') {
          data = {
            ...step,
            stepDetails: {
              ...step.stepDetails,
              tool_calls: step.stepDetails.tool_calls?.map((call) =>
                call.id ? { ...call, id: scoped(step.id, call.id) } : call,
              ),
            },
          };
        }
      } else if (input.event === GraphEvents.ON_RUN_STEP_DELTA) {
        const delta = data as RunStepDeltaEvent;
        if (delta.delta.type === 'tool_calls') {
          data = {
            ...delta,
            delta: {
              ...delta.delta,
              tool_calls: delta.delta.tool_calls?.map((call) => ({
                ...call,
                id: call.id ? scoped(delta.id, call.id) : call.id,
              })),
            },
          };
        }
      } else if (input.event === GraphEvents.ON_RUN_STEP_COMPLETED) {
        const completed = data as { result: ToolEndEvent };
        const call = completed.result?.tool_call;
        if (call?.id) {
          data = {
            ...completed,
            result: {
              ...completed.result,
              tool_call: { ...call, id: scoped(completed.result.id, call.id) },
            },
          };
        }
      }
      // Restore only the updated step's slots, not the whole parent transcript per token.
      const previousLength = aggregator.contentParts.length;
      aggregator.aggregateContent({ ...input, data });
      const id =
        (data as { id?: string; result?: { id?: string } }).id ??
        (data as { result?: { id?: string } }).result?.id;
      const step = id == null ? undefined : aggregator.stepMap.get(id);
      if (step?.stepDetails.type !== 'tool_calls') return;
      const indices = indicesByStep.get(step.id) ?? new Set<number>([step.index]);
      for (let index = previousLength; index < aggregator.contentParts.length; index++) {
        indices.add(index);
      }
      indicesByStep.set(step.id, indices);
      for (const index of indices) {
        const part = aggregator.contentParts[index];
        if (part?.type !== 'tool_call') continue;
        const original = originalIds.get(part.tool_call.id ?? '');
        if (original != null) part.tool_call.id = original;
        part.tool_call.stepId = step.id;
      }
      // Expose parent steps using the same IDs as the host content for child correlation.
      step.stepDetails = {
        ...step.stepDetails,
        tool_calls: step.stepDetails.tool_calls?.map((call) =>
          call.id ? { ...call, id: originalIds.get(call.id) ?? call.id } : call,
        ),
      };
    },
  };
}
