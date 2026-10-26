import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'jotai';
import type { TFile, TMessage } from 'librechat-data-provider';
import type { ThreadIndex, ThreadRow } from '~/utils/thread';
import {
  ROOT_KEY,
  buildThreadIndex,
  changedParentKeys,
  reconcileSiblingIdx,
  resolveThreadRows,
} from '~/utils/thread';
import {
  siblingIdxFamily,
  siblingKey,
  useSiblingIndexes,
} from '~/components/Chat/Messages/Thread/state';
import { historyFocusIndexes } from '~/utils/history';

const EMPTY_KEYS: string[] = [];

/**
 * The visible thread as a flat list of rows, derived from the messages cache
 * plus the sibling selection of the branch points only. A streaming delta
 * changes one message object, so every other row is reused by reference and
 * the memoized row components bail without a field diff.
 *
 * Selection reconciliation (follow an appended sibling, keep the viewed one
 * through churn) runs once per index change over the parents whose children
 * list actually changed, instead of once per rendered level.
 */
export default function useThreadRows(
  messages: TMessage[] | null | undefined,
  rootKey: string | null | undefined,
  fileMap?: Record<string, TFile>,
): ThreadRow[] | null {
  const jotaiStore = useStore();
  const rootSiblingKey = siblingKey(rootKey);
  const index = useMemo(
    () => (messages ? buildThreadIndex(messages, fileMap) : null),
    [messages, fileMap],
  );
  const branchKeys = useMemo(
    () =>
      index
        ? index.branchParentKeys.map((key) => (key === ROOT_KEY ? rootSiblingKey : key))
        : EMPTY_KEYS,
    [index, rootSiblingKey],
  );
  const siblingIndexes = useSiblingIndexes(branchKeys);
  const previousIndexRef = useRef<{
    rootKey: string;
    index: ThreadIndex;
    messages: typeof messages;
  } | null>(null);
  const focus = useMemo(
    () => (messages ? historyFocusIndexes(messages, rootSiblingKey) : new Map<string, number>()),
    [messages, rootSiblingKey],
  );

  const previousRowsRef = useRef<{ rootKey: string; rows: ThreadRow[] } | null>(null);
  const rows = useMemo(() => {
    if (!index) {
      previousRowsRef.current = null;
      return null;
    }
    const previous = previousRowsRef.current;
    const next = resolveThreadRows(
      index,
      rootSiblingKey,
      (key) =>
        (previousIndexRef.current?.messages !== messages ? focus.get(key) : undefined) ??
        siblingIndexes[key] ??
        0,
      previous?.rootKey === rootSiblingKey ? previous.rows : null,
    );
    previousRowsRef.current = { rootKey: rootSiblingKey, rows: next };
    return next;
  }, [index, rootSiblingKey, siblingIndexes, focus, messages]);

  useEffect(() => {
    if (!index) {
      previousIndexRef.current = null;
      return;
    }
    const previous = previousIndexRef.current;
    previousIndexRef.current = { rootKey: rootSiblingKey, index, messages };
    const previousIndex = previous && previous.rootKey === rootSiblingKey ? previous.index : null;
    if (focus.size && previous?.messages !== messages) {
      for (const [key, value] of focus) jotaiStore.set(siblingIdxFamily(key), value);
      return;
    }
    for (const key of changedParentKeys(previousIndex, index)) {
      const atom = siblingIdxFamily(key === ROOT_KEY ? rootSiblingKey : key);
      const nextIdx = reconcileSiblingIdx(
        previousIndex?.children.get(key),
        index.children.get(key) ?? [],
        jotaiStore.get(atom),
      );
      if (nextIdx != null) {
        jotaiStore.set(atom, nextIdx);
      }
    }
  }, [index, rootSiblingKey, jotaiStore, focus, messages]);

  return rows;
}
