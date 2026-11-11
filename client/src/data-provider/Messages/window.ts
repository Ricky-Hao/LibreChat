import { QueryKeys, dataService } from 'librechat-data-provider';
import type { HistoryCursor, TMessage } from 'librechat-data-provider';
import type { QueryClient } from '@tanstack/react-query';

export type HistoryWindow = {
  start: HistoryCursor | null;
  nextCursor: HistoryCursor | null;
  limit: number;
  focusId?: string;
};

/** A full client read still uses the lightweight display projection. Exports opt into full bodies. */
export async function readDisplayMessages(
  id: string,
  queryClient?: QueryClient,
  size?: number,
): Promise<TMessage[]> {
  const key = [QueryKeys.historyWindow, id];
  const previous = queryClient?.getQueryData<HistoryWindow>(key);
  const limit = size ?? previous?.limit ?? 0;
  if (!queryClient || limit === 0) {
    const messages = await dataService.getMessagesByConvoId(id, {
      toolPreviews: true,
      lazyAttachments: true,
    });
    queryClient?.removeQueries(key);
    return messages;
  }
  const current = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, id]);
  if (!previous)
    queryClient.setQueryData<HistoryWindow>(key, { limit, start: null, nextCursor: null });
  const first = current?.[0];
  const since = current?.length
    ? (previous?.start ??
      (first?.createdAt
        ? {
            createdAt: new Date(first.createdAt).toISOString(),
            position: '000000000000000000000000',
          }
        : undefined))
    : undefined;
  const page = await dataService.getConversationHistory(id, { limit, ...(since ? { since } : {}) });
  if (
    current !== queryClient.getQueryData([QueryKeys.messages, id]) &&
    (previous || queryClient.getQueryData<HistoryWindow>(key)?.start)
  )
    return page.messages;
  queryClient.setQueryData<HistoryWindow>(key, {
    limit,
    start: page.start ?? previous?.start ?? null,
    nextCursor: since ? (previous?.nextCursor ?? null) : page.nextCursor,
    focusId: current?.length
      ? previous?.focusId
      : page.messages[page.messages.length - 1]?.messageId,
  });
  return page.messages;
}

/** Prepending never overwrites a newer live object or creates duplicate identities. */
export function prependHistory(older: TMessage[], current: TMessage[]): TMessage[] {
  const existing = new Set(current.map((message) => message.messageId));
  return [...older.filter((message) => !existing.has(message.messageId)), ...current];
}
