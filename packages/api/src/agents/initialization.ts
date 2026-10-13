import { createHash } from 'crypto';
import type { SubagentResolutionCause, SubagentResolutionFailureHandler } from '@librechat/agents';
import { getSafeErrorMetadata } from '~/utils/errors';

type InitializationStage =
  | 'configuration'
  | 'permission'
  | 'model'
  | 'provider'
  | 'tools'
  | 'skills';
type SelectionFailure = 'configuration_changed' | 'agent_unavailable' | 'model_unavailable';

/** Stage annotations preserve exception identity, including cancellation and graph interrupts. */
const stages = new WeakMap<object, InitializationStage>();

export class SubagentInitializationError extends Error {
  constructor(public readonly code: SelectionFailure) {
    super('Selected subagent initialization was rejected.');
    this.name = 'SubagentInitializationError';
  }
}

export async function withInitializationStage<T>(
  stage: InitializationStage,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error != null && typeof error === 'object' && !stages.has(error)) {
      stages.set(error, stage);
    }
    throw error;
  }
}

/** Reuses the selected document and request's authorization/model checks without extra reads. */
export async function validateSelectedSubagent<T>({
  agent,
  configId,
  getConfigId,
  canView,
  validateModel,
  signal,
  viewAccessChecked = false,
}: {
  agent: T | null | undefined;
  configId: string;
  getConfigId: (agent: T) => string;
  canView: () => Promise<boolean>;
  validateModel: () => Promise<{ isValid: boolean }>;
  signal: AbortSignal;
  viewAccessChecked?: boolean;
}): Promise<void> {
  signal.throwIfAborted();
  await withInitializationStage('configuration', () => {
    if (agent == null || getConfigId(agent) !== configId) {
      throw new SubagentInitializationError('configuration_changed');
    }
  });
  await withInitializationStage('permission', async () => {
    if (!viewAccessChecked && !(await canView())) {
      throw new SubagentInitializationError('agent_unavailable');
    }
  });
  signal.throwIfAborted();
  await withInitializationStage('model', async () => {
    const validation = await validateModel();
    signal.throwIfAborted();
    if (!validation.isValid) {
      throw new SubagentInitializationError('model_unavailable');
    }
  });
}

const knownCodes = new Map<string, SubagentResolutionCause>([
  ['configuration_changed', 'configuration_changed'],
  ['agent_unavailable', 'agent_unavailable'],
  ['model_unavailable', 'model_unavailable'],
  ['AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE', 'unknown'],
  ['MCP_AUTHENTICATION_REJECTED', 'unknown'],
  ['MCP_AUTHENTICATION_REFRESH_FAILED', 'unknown'],
  ['MCP_DOMAIN_NOT_ALLOWED', 'unknown'],
  ['MCP_INSPECTION_FAILED', 'unknown'],
  ['MODEL_NOT_FOUND', 'model_unavailable'],
]);

function property(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** UUIDs stay searchable; other identifiers are hashed so names or hostile text cannot leak. */
function correlation(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    return undefined;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** Only bounded, allowlisted metadata reaches the sink; classification never reads error text. */
export function createSubagentResolutionFailureHandler(
  log: (message: string, metadata: object) => void,
): SubagentResolutionFailureHandler {
  return (detail, error) => {
    let cause: SubagentResolutionCause =
      detail.cause === 'host_argument_rejected' ? 'host_argument_rejected' : 'unknown';
    const chain: Array<
      ReturnType<typeof getSafeErrorMetadata> & {
        code?: string;
        stage?: InitializationStage;
      }
    > = [];
    const seen = new Set<object>();
    let current = error;
    for (let depth = 0; depth < 6 && current != null && typeof current === 'object'; depth++) {
      if (seen.has(current)) break;
      seen.add(current);
      const code = [property(current, 'code'), property(current, 'lc_error_code')].find(
        (value): value is string => typeof value === 'string' && knownCodes.has(value),
      );
      const stage = stages.get(current);
      chain.push({
        ...getSafeErrorMetadata(current),
        ...(code && { code }),
        ...(stage && { stage }),
      });
      if (cause === 'unknown' && code != null) cause = knownCodes.get(code) ?? 'unknown';
      current = property(current, 'cause');
    }
    try {
      log('[SubagentExecutor] Subagent initialization failed', {
        phase: detail.phase === 'identity' ? 'identity' : 'config',
        type: chain[0]?.type ?? 'UnknownError',
        aborted: detail.aborted === true,
        cause,
        parentRunId: correlation(detail.parentRunId),
        parentAgentId: correlation(detail.parentAgentId),
        parentToolCallId: correlation(detail.parentToolCallId),
        threadId: correlation(detail.threadId),
        childRunId: correlation(detail.childRunId),
        childThreadId: correlation(detail.childThreadId),
        taskId: correlation(detail.taskId),
        errors: chain,
      });
    } catch {
      // Diagnostics must not replace the initialization failure or its safe classification.
    }
    return cause;
  };
}
