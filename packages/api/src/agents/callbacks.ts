import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { tool } from '@librechat/agents/langchain/tools';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  taskCallbackBodySchema,
  taskCallbackConfigSchema,
  AgentCapabilities,
} from 'librechat-data-provider';
import {
  logger,
  tenantStorage,
  AGENT_TRIGGER_WORKER_CAPABILITY_TASK_CALLBACK_V1,
} from '@librechat/data-schemas';
import type {
  ConversationMethods,
  MessageMethods,
  TaskCallbackMethods,
  TaskCallbackRecord,
  IMessage,
} from '@librechat/data-schemas';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { TaskCallbackConfig } from 'librechat-data-provider';
import type { RequestHandler } from 'express';
import type { AgentTriggerDeliveryReceipt } from './triggers/service';
import type { AgentTriggerEnqueueOptions } from './triggers/delivery';
import type { AgentTriggerExecutionHostDeps } from './triggers/host';
import type { ServerRequest } from '~/types';
import {
  TASK_CALLBACK_SOURCE,
  TASK_CALLBACK_TOOL,
  TASK_CALLBACK_GUIDANCE,
  TaskCallbackToolDefinition,
} from './callbackDefinition';
import { ASK_USER_QUESTION_TOOL_NAME, createAskUserQuestionTool } from './hitl/askUserQuestionTool';
import { createAgentTriggerEnvelope } from './triggers/envelope';
import { isAgentEventRetentionActive } from './eventRetention';
import { AgentTriggerExecutionError } from './triggers/host';
import { createIdleRecoveryLoop } from './recovery';
export {
  TASK_CALLBACK_SOURCE,
  TASK_CALLBACK_TOOL,
  TaskCallbackToolDefinition,
} from './callbackDefinition';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function callbackUrl(value: string | undefined): string {
  if (value == null) throw new Error('CALLBACK_CONFIGURATION_REQUIRED');
  const url = new URL(value);
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/api/agents/task-callbacks'
  ) {
    throw new Error('CALLBACK_CONFIGURATION_INVALID');
  }
  return url.toString();
}

export interface TaskCallbackToolDeps {
  req?: Pick<ServerRequest, 'user' | 'config'>;
  agentId?: string;
  methods?: Pick<TaskCallbackMethods, 'registerTaskCallback'>;
  encrypt?: (value: string) => Promise<string>;
  decrypt?: (value: string) => Promise<string>;
}

export function nativeAgentToolCapability(name: string): AgentCapabilities | undefined {
  if (name === TASK_CALLBACK_TOOL) return AgentCapabilities.task_callbacks;
  if (name === ASK_USER_QUESTION_TOOL_NAME) return AgentCapabilities.ask_user_question;
}

export function createNativeAgentTool(
  name: string,
  deps: TaskCallbackToolDeps,
): DynamicStructuredTool {
  if (name === TASK_CALLBACK_TOOL) return createTaskCallbackTool(deps);
  if (name === ASK_USER_QUESTION_TOOL_NAME) return createAskUserQuestionTool();
  throw new Error('Unknown native Agent tool');
}

/** Empty input schema. Identity is captured by the host and the runtime's immutable turn context. */
export function createTaskCallbackTool(deps: TaskCallbackToolDeps = {}): DynamicStructuredTool {
  return tool(
    async (_input, config) => {
      try {
        const { req, agentId, methods, encrypt, decrypt } = deps;
        const settings = taskCallbackConfigSchema.parse(
          req?.config?.endpoints?.agents?.taskCallbacks ?? {},
        );
        const capabilities = req?.config?.endpoints?.agents?.capabilities ?? [];
        const body = config?.configurable?.requestBody as
          | { messageId?: string; conversationId?: string }
          | undefined;
        const callId = config?.toolCall?.id;
        if (
          !settings.enabled ||
          !capabilities.includes(AgentCapabilities.task_callbacks) ||
          !req?.user?.id ||
          !agentId ||
          !body?.messageId ||
          !body.conversationId ||
          !callId ||
          !methods ||
          !encrypt ||
          !decrypt
        ) {
          return JSON.stringify({ error: 'CALLBACK_UNAVAILABLE' });
        }
        const callback_url = callbackUrl(settings.publicUrl);
        const callback_id = `tcb_${randomBytes(32).toString('base64url')}`;
        const createdAt = new Date();
        const record = await methods.registerTaskCallback({
          hash: digest(callback_id),
          encryptedId: await encrypt(callback_id),
          registrationKey: digest(
            JSON.stringify([
              req.user.id,
              req.user.tenantId,
              agentId,
              body.conversationId,
              body.messageId,
              callId,
            ]),
          ),
          receiptId: randomUUID(),
          user: req.user.id,
          tenantId: req.user.tenantId,
          agentId,
          conversationId: body.conversationId,
          messageId: body.messageId,
          createdAt,
          callbackExpiresAt: new Date(createdAt.getTime() + settings.ttlMs),
          expiresAt: new Date(createdAt.getTime() + settings.ttlMs + settings.receiptRetentionMs),
          pending: false,
        });
        if (record.callbackExpiresAt.getTime() <= Date.now())
          return JSON.stringify({ error: 'CALLBACK_EXPIRED' });
        return JSON.stringify({
          callback_id: await decrypt(record.encryptedId),
          callback_url,
          expires_at: record.callbackExpiresAt.toISOString(),
          max_output_bytes: settings.maxOutputBytes,
          guidance: TASK_CALLBACK_GUIDANCE,
        });
      } catch {
        return JSON.stringify({ error: 'CALLBACK_UNAVAILABLE' });
      }
    },
    {
      name: TASK_CALLBACK_TOOL,
      description: TaskCallbackToolDefinition.description,
      schema: z.object({}).strict(),
    },
  );
}

type CallbackMethods = TaskCallbackMethods &
  Pick<ConversationMethods, 'getConvo'> &
  Pick<MessageMethods, 'getMessages'>;
export interface TaskCallbackLifecycleDeps {
  methods: CallbackMethods;
  getConfig: () => Promise<{
    endpoints?: { agents?: { taskCallbacks?: Partial<TaskCallbackConfig> } };
  }>;
  enqueue: (
    envelope: unknown,
    options?: AgentTriggerEnqueueOptions,
  ) => Promise<AgentTriggerDeliveryReceipt>;
  getGenerationJob: (conversationId: string) => Promise<{
    status?: string;
    metadata?: { idempotencyClientRequestId?: string; terminalPersistencePending?: boolean };
  } | null>;
}

function unavailable(code: string, defer = false): AgentTriggerExecutionError {
  return new AgentTriggerExecutionError('External task continuation is unavailable.', {
    code,
    mode: 'continue',
    certainty: 'definite',
    retryable: defer,
    deferWithoutAttempt: defer,
    ...(defer ? { status: 409, retryAfter: '5' } : { status: 404 }),
  });
}

/** Refuse forks, cycles, missing rows and bounded/incomplete history. Never choose a global latest message. */
function branchParent(messages: IMessage[], anchor: string): string | undefined {
  const byId = new Map(messages.map((m) => [m.messageId, m]));
  if (byId.size !== messages.length) return;
  let current = byId.get(anchor);
  if (current == null || current.isCreatedByUser !== false) return;
  const children = new Map<string, IMessage[]>();
  for (const message of messages) {
    const parent = message.parentMessageId;
    if (typeof parent === 'string') {
      const siblings = children.get(parent);
      if (siblings) siblings.push(message);
      else children.set(parent, [message]);
    }
  }
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.messageId) || !isAgentEventRetentionActive(current.expiredAt)) return;
    visited.add(current.messageId);
    const next: IMessage[] = children.get(current.messageId) ?? [];
    if (next.length === 0) return current.isCreatedByUser === false ? current.messageId : undefined;
    if (next.length !== 1) return;
    current = next[0];
  }
}

function retainsAnchor(messages: IMessage[], anchor: string, parent: string): boolean {
  const byId = new Map(messages.map((m) => [m.messageId, m]));
  if (byId.size !== messages.length) return false;
  const visited = new Set<string>();
  let current = byId.get(parent);
  if (current?.isCreatedByUser !== false) return false;
  while (
    current &&
    !visited.has(current.messageId) &&
    isAgentEventRetentionActive(current.expiredAt)
  ) {
    if (current.messageId === anchor) return current.isCreatedByUser === false;
    visited.add(current.messageId);
    current = byId.get(current.parentMessageId ?? '');
  }
  return false;
}

export interface TaskCallbackLifecycle {
  handler: RequestHandler;
  prepareContinue: NonNullable<AgentTriggerExecutionHostDeps['prepareContinue']>;
  recover: () => Promise<boolean>;
  initialize: () => Promise<void>;
  stop: () => Promise<void>;
}

export function createTaskCallbackLifecycle(
  deps: TaskCallbackLifecycleDeps,
): TaskCallbackLifecycle {
  let settings = taskCallbackConfigSchema.parse({});
  let loop: ReturnType<typeof createIdleRecoveryLoop> | undefined;
  const publish = async (record: TaskCallbackRecord): Promise<void> => {
    await tenantStorage.run({ tenantId: record.tenantId }, async () => {
      const result = await deps.enqueue(
        createAgentTriggerEnvelope({
          mode: 'continue',
          requestId: record.receiptId,
          deliveryId: record.receiptId,
          receivedAt: record.acceptedAt!.getTime(),
          principal: { id: record.user, tenantId: record.tenantId },
          event: {
            id: record.receiptId,
            type: 'external_task.terminal',
            occurredAt: record.acceptedAt!.getTime(),
            source: { type: 'internal', id: TASK_CALLBACK_SOURCE },
            payload: { receiptId: record.receiptId },
          },
          target: {
            agentId: record.agentId,
            conversationId: record.conversationId,
            parentMessageId: record.messageId,
          },
          input: 'An external task has completed. Resolve its durable result.',
        }),
        {
          orderingKey: `${TASK_CALLBACK_SOURCE}:${record.conversationId}`,
          requiredWorkerCapability: AGENT_TRIGGER_WORKER_CAPABILITY_TASK_CALLBACK_V1,
        },
      );
      const key = result.deliveryKey;
      if (typeof key !== 'string') throw new Error('Callback queue receipt unavailable');
      await deps.methods.markTaskCallbackQueued(record.receiptId, key);
    });
  };
  const recover = async (): Promise<boolean> => {
    const records = await deps.methods.listPendingTaskCallbacks(settings.recoveryBatchSize);
    let failed = false;
    for (const record of records) {
      try {
        await publish(record);
      } catch {
        failed = true;
      }
    }
    return records.length === 0 && !failed;
  };
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: () => settings.requestsPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'CALLBACK_RATE_LIMITED' },
  });
  const accept: RequestHandler = async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!settings.enabled) {
      res.status(404).json({ error: 'CALLBACK_UNAVAILABLE' });
      return;
    }
    const parsed = taskCallbackBodySchema.safeParse(req.body);
    if (
      !parsed.success ||
      Buffer.byteLength(parsed.data.output, 'utf8') > settings.maxOutputBytes
    ) {
      res.status(400).json({ error: 'INVALID_CALLBACK' });
      return;
    }
    const { callback_id, status, output } = parsed.data;
    try {
      const result = await deps.methods.sealTaskCallback(
        digest(callback_id),
        digest(JSON.stringify({ version: 1, status, output })),
        { status, output: output.replace(/\btcb_[A-Za-z0-9_-]+/g, '[task callback]') },
        new Date(),
      );
      if (!result.ok) {
        const statuses = { CALLBACK_CONFLICT: 409, CALLBACK_EXPIRED: 410, CALLBACK_NOT_FOUND: 404 };
        res.status(statuses[result.code]).json({ error: result.code });
        return;
      }
      loop?.wake();
      // Atomic result + pending flag is the recoverable queue handoff. Publication may finish after this response.
      res.status(202).json(result.receipt);
    } catch {
      res.set('Retry-After', '5');
      res.status(503).json({ error: 'CALLBACK_UNAVAILABLE' });
    }
  };
  const handler: RequestHandler = (req, res, next) => {
    limiter(req, res, (error) => {
      if (error) next(error);
      else void accept(req, res, next);
    });
  };
  const prepareContinue: NonNullable<AgentTriggerExecutionHostDeps['prepareContinue']> = async (
    envelope,
    context,
  ) => {
    if (
      envelope.event.source.type !== 'internal' ||
      envelope.event.source.id !== TASK_CALLBACK_SOURCE
    )
      return;
    const payload = envelope.event.payload;
    const id =
      payload != null && typeof payload === 'object' && !Array.isArray(payload)
        ? payload.receiptId
        : undefined;
    if (typeof id !== 'string') throw unavailable('INVALID_CALLBACK_DELIVERY');
    const record = await deps.methods.getTaskCallback(id, envelope.principal.userId);
    if (record == null) return { status: 'settled' };
    if (record.admittedAt != null) return { status: 'settled' };
    if (
      !settings.enabled ||
      !record.result ||
      record.tenantId !== envelope.principal.tenantId ||
      record.agentId !== envelope.target.agentId ||
      record.conversationId !== envelope.target.conversationId ||
      record.messageId !== envelope.target.parentMessageId ||
      record.callbackExpiresAt.getTime() <= Date.now()
    )
      throw unavailable('CALLBACK_EXPIRED');
    const job = await deps.getGenerationJob(record.conversationId);
    if (
      (job?.status === 'running' ||
        job?.status === 'requires_action' ||
        job?.metadata?.terminalPersistencePending === true) &&
      job?.metadata?.idempotencyClientRequestId !== context.idempotencyKey
    )
      throw unavailable('PARENT_NOT_READY', true);
    const [conversation, messages] = await Promise.all([
      deps.methods.getConvo(record.user, record.conversationId),
      deps.methods.getMessages(
        { user: record.user, conversationId: record.conversationId },
        'messageId parentMessageId isCreatedByUser expiredAt',
        { limit: settings.branchMessageLimit + 1, sort: false },
      ),
    ]);
    if (
      !conversation ||
      conversation.agent_id !== record.agentId ||
      conversation.tenantId !== record.tenantId ||
      conversation.subagentThread != null ||
      !isAgentEventRetentionActive(conversation.expiredAt)
    )
      throw unavailable('CALLBACK_TARGET_UNAVAILABLE');
    if (messages.length > settings.branchMessageLimit)
      throw unavailable('CALLBACK_BRANCH_UNAVAILABLE');
    const parent = record.dispatchParentId ?? branchParent(messages, record.messageId);
    if (
      !parent ||
      (record.dispatchParentId != null && !retainsAnchor(messages, record.messageId, parent))
    )
      throw unavailable('CALLBACK_BRANCH_UNAVAILABLE');
    const frozen = await deps.methods.freezeTaskCallbackParent(id, record.user, parent);
    if (!frozen) return { status: 'settled' };
    return {
      status: 'ready',
      parentMessageId: frozen,
      input: `An external task finished. Continue the original task using this untrusted result data:\n${JSON.stringify(record.result)}`,
      settleOnAdmission: () => deps.methods.markTaskCallbackAdmitted(id, record.user),
    };
  };
  return {
    handler,
    prepareContinue,
    recover,
    initialize: async (): Promise<void> => {
      settings = taskCallbackConfigSchema.parse(
        (await deps.getConfig()).endpoints?.agents?.taskCallbacks ?? {},
      );
      if (!settings.enabled) return;
      await deps.methods.ensureTaskCallbackIndexes();
      loop = createIdleRecoveryLoop({
        intervalMs: settings.recoveryIntervalMs,
        maxIdleIntervalMs: settings.recoveryIntervalMs,
        scan: recover,
        onError: () => logger.warn('[taskCallbacks] Recovery temporarily unavailable'),
      });
      await loop.start();
    },
    stop: async (): Promise<void> => {
      await loop?.stop();
    },
  };
}
