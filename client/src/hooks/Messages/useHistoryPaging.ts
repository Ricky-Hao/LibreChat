import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useStore } from 'jotai';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { TMessage } from 'librechat-data-provider';
import type { RefObject } from 'react';
import type { HistoryWindow } from '~/data-provider/Messages/window';
import { siblingIdxFamily } from '~/components/Chat/Messages/Thread/state';
import { buildThreadIndex, resolveThreadRows } from '~/utils/thread';
import { prependHistory } from '~/data-provider/Messages/window';

export default function useHistoryPaging(
  id: string | undefined,
  messages: TMessage[] | null | undefined,
  scrollableRef: RefObject<HTMLDivElement | null>,
  onLoad?: () => void,
) {
  const client = useQueryClient();
  const store = useStore();
  const key = [QueryKeys.historyWindow, id];
  const { data: window } = useQuery<HistoryWindow>(key, { enabled: false });
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const visit = useMemo(() => ({ id }), [id]);
  const activeVisit = useRef<typeof visit | null>(visit);
  useLayoutEffect(() => {
    activeVisit.current = visit;
    anchor.current = null;
    return () => {
      activeVisit.current = null;
    };
  }, [visit]);
  const mutation = useMutation(
    async () => {
      if (!id || !window?.nextCursor || client.isFetching([QueryKeys.messages, id])) return;
      const page = await dataService.getConversationHistory(id, {
        before: window.nextCursor,
        limit: window.limit,
      });
      if (activeVisit.current !== visit) return;
      const currentWindow = client.getQueryData<HistoryWindow>(key);
      if (currentWindow?.nextCursor?.position !== window.nextCursor.position) return;
      // Reader movement and streaming may change the visible rows during the request.
      const container = scrollableRef.current;
      const top = container?.getBoundingClientRect().top ?? 0;
      const element = container
        ? [...container.querySelectorAll<HTMLElement>('.message-render')].find(
            (row) => row.getBoundingClientRect().bottom > top,
          )
        : undefined;
      anchor.current =
        element && container
          ? { id: element.id, offset: element.getBoundingClientRect().top + container.scrollTop }
          : null;
      const current = client.getQueryData<TMessage[]>([QueryKeys.messages, id]) ?? [];
      const rows = resolveThreadRows(
        buildThreadIndex(current),
        id,
        (key) => store.get(siblingIdxFamily(key)),
        null,
      );
      const merged = prependHistory(page.messages, current);
      client.setQueryData<HistoryWindow>(key, {
        ...window,
        nextCursor: page.nextCursor,
        start: page.start ?? window.start,
        focusId: rows[rows.length - 1]?.source.messageId,
      });
      client.setQueryData([QueryKeys.messages, id], merged);
    },
    {
      onError: () => {
        anchor.current = null;
      },
    },
  );
  useLayoutEffect(() => {
    const container = scrollableRef.current;
    const captured = anchor.current;
    if (!captured || !container) return;
    const row = document.getElementById(captured.id);
    if (!row || !container.contains(row)) return;
    container.scrollTop += row.getBoundingClientRect().top + container.scrollTop - captured.offset;
    anchor.current = null;
  }, [messages, scrollableRef]);
  const pending = useRef(false);
  const load = useCallback(() => {
    if (pending.current || mutation.isLoading || !window?.nextCursor) return;
    onLoad?.();
    pending.current = true;
    mutation.mutate(undefined, {
      onSettled: () => {
        pending.current = false;
      },
    });
  }, [mutation, window?.nextCursor, onLoad]);
  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const container = event.currentTarget;
      const previous = Number(container.dataset.historyScrollTop ?? 0);
      container.dataset.historyScrollTop = String(container.scrollTop);
      if (container.scrollTop < previous && container.scrollTop <= container.clientHeight) load();
    },
    [load],
  );
  return {
    hasOlder: !!window?.nextCursor,
    isWindowed: window != null,
    focusId: window?.focusId,
    load,
    onScroll,
    isLoading: mutation.isLoading,
    isError: mutation.isError,
  };
}
