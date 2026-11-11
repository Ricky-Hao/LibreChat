import { Constants } from 'librechat-data-provider';
import type { TMessage, ChatFinalFrame } from 'librechat-data-provider';
import type { StreamStatusResponse } from './host';
import type { TerminalContext } from './terminal';
import {
  handoffToReplacement,
  clearAttachedDrainAfterAbort,
  retryFencedTerminalAttachment,
  clearAttachedGenerationCreatedAt,
  clearPendingApprovalForTerminal,
} from './terminal';
import { completedResponseMessageId, isInitialNewConversation } from './messages';
import { getRecoverySteerId, toStartGenerationError } from './start';
import { supportsGenerationProtocolV2 } from '../protocol';

/** A synthesized lifecycle frame: the run ended without an ordinary final payload. */
export type LifecycleFrame = Pick<
  ChatFinalFrame,
  'reconcileReason' | 'terminalStatus' | 'generationCreatedAt' | 'conversation'
>;

/**
 * Settles a run the server reports through a synthesized lifecycle frame. Such frames carry no
 * response payload, so durable history is reconciled (or the attachment handed to the
 * replacement epoch) instead of passing them to the final handler.
 */
export async function reconcileGenerationLifecycle(
  ctx: TerminalContext,
  event: LifecycleFrame,
): Promise<void> {
  const { sub, host } = ctx;
  const { run, generationCreatedAt, generationProtocolVersion } = sub;
  const currentStreamId = sub.streamId;
  if (!sub.isCurrent()) {
    return;
  }
  const reconciliationConvoId =
    event.conversation?.conversationId ??
    sub.submission.conversation?.conversationId ??
    currentStreamId;
  if (
    generationCreatedAt != null &&
    event.generationCreatedAt != null &&
    event.generationCreatedAt !== generationCreatedAt
  ) {
    return;
  }

  run.reconnectAttempt = Math.max(run.reconnectAttempt, 1);
  sub.close();
  // The terminal status is the persistence barrier; history read before it can be stale.
  let status: StreamStatusResponse;
  try {
    status = await host.fetchStatus(reconciliationConvoId);
    if (!sub.isCurrent()) {
      return;
    }
    if (await handoffToReplacement(ctx, reconciliationConvoId, status)) {
      return;
    }
    if (!supportsGenerationProtocolV2(status) || status.active !== false) {
      retryFencedTerminalAttachment(ctx, 'synthesized status is not terminal');
      return;
    }
  } catch {
    retryFencedTerminalAttachment(ctx, 'synthesized terminal status unavailable');
    return;
  }
  if (!sub.isCurrent()) {
    return;
  }

  host.events.clearStepMaps();
  let persistedMessages: TMessage[] | undefined;
  try {
    // Fetch persistence directly; a cache-only query may have no fetching observer.
    await host.cache.invalidateMessages(reconciliationConvoId, 'none');
    if (!sub.isCurrent()) {
      return;
    }
    const fetched = await host.cache.fetchMessages(reconciliationConvoId);
    if (!sub.isCurrent()) {
      return;
    }
    if (Array.isArray(fetched)) {
      persistedMessages = fetched;
      host.messages.set(fetched);
      run.terminalRecoveryAttempt = 0;
    }
  } catch (error) {
    if (!sub.isCurrent()) {
      return;
    }
    host.logger.warn('ResumableSSE', 'Could not refetch synthesized terminal state', {
      conversationId: reconciliationConvoId,
      error,
    });
    if (toStartGenerationError(error)?.response?.status !== 404) {
      retryFencedTerminalAttachment(ctx, 'terminal history unavailable');
      return;
    }
  }
  try {
    await host.cache.refreshConversation(reconciliationConvoId);
    if (!sub.isCurrent()) {
      return;
    }
    await host.cache.refreshConversationLists();
    if (!sub.isCurrent()) {
      return;
    }
    await host.cache.refreshPinnedConversations();
    if (!sub.isCurrent()) {
      return;
    }
  } catch (error) {
    if (!sub.isCurrent()) {
      return;
    }
    host.logger.warn('ResumableSSE', 'Could not refresh synthesized conversation metadata', {
      conversationId: reconciliationConvoId,
      error,
    });
  }

  const authoritativeValues = [
    ...(persistedMessages ?? []),
    ...(status?.resumeState?.aggregatedContent ?? status?.aggregatedContent ?? []),
  ];
  const reconciledIds = new Set(host.steers.appliedIds(authoritativeValues));
  host.steers.settleApplied(reconciliationConvoId, authoritativeValues);
  const unrecovered = status?.unrecoveredSteers ?? [];
  if (unrecovered.length > 0) {
    const recoverySteerId = getRecoverySteerId(sub.submission);
    host.steers.convertToQueued(reconciliationConvoId, unrecovered, {
      ...(recoverySteerId != null && {
        allowPreviouslyConvertedIds: [recoverySteerId],
      }),
    });
    for (const steer of unrecovered) {
      reconciledIds.add(steer.steerId);
      if (steer.clientSteerId) {
        reconciledIds.add(steer.clientSteerId);
      }
    }
  }
  if (persistedMessages) {
    host.steers.convertLocalToQueued(reconciliationConvoId, {
      excludeSteerIds: reconciledIds,
      generationProtocolVersion,
    });
  }

  host.events.resetLive(sub.liveSubmission());
  host.cache.removeActiveJob(currentStreamId);
  clearAttachedGenerationCreatedAt(ctx);
  clearPendingApprovalForTerminal(ctx, reconciliationConvoId);
  host.pane.clearComposerDrafts(reconciliationConvoId, {
    includeNewChatDraft:
      !reconciliationConvoId ||
      reconciliationConvoId === Constants.NEW_CONVO ||
      run.optimisticStreamIds.has(currentStreamId) ||
      isInitialNewConversation(sub.submission),
  });
  host.pane.setIsSubmitting(false);
  host.pane.setShowStopButton(false);
  if (persistedMessages == null || event.reconcileReason === 'abort_persistence_failed') {
    /** Interrupt & send arms an override that drains even an `aborted`
     * run. This terminal frame explicitly says durable persistence is
     * unknown, so consume that override before publishing runEnd; the
     * queued words remain available for a deliberate retry. */
    clearAttachedDrainAfterAbort(ctx, reconciliationConvoId);
  }
  let reconciliationOutcome: 'completed' | 'aborted' | 'error' = 'aborted';
  if (event.terminalStatus === 'complete') {
    reconciliationOutcome = persistedMessages != null ? 'completed' : 'error';
  } else if (event.terminalStatus === 'error') {
    reconciliationOutcome = 'error';
  }
  const reconciledResponseMessageId =
    reconciliationOutcome === 'completed'
      ? completedResponseMessageId(
          persistedMessages,
          sub.userMessage?.messageId,
          status?.resumeState?.responseMessageId ?? sub.submission.initialResponse?.messageId,
        )
      : undefined;
  host.pane.publishRunEnd({
    conversationId: reconciliationConvoId,
    outcome: reconciliationOutcome,
    endedAt: run.scheduler.now(),
    generationCreatedAt: status?.createdAt ?? generationCreatedAt,
    ...(reconciledResponseMessageId != null && {
      responseMessageId: reconciledResponseMessageId,
    }),
  });
  host.pane.setSubmission(null);
  host.pane.setStreamId(null);
  run.releaseStream(currentStreamId);
  run.reconnectAttempt = 0;
}
