import type { TMessage } from 'librechat-data-provider';
import { buildThreadIndex, ROOT_KEY } from './thread';

const focusedHistories = new WeakMap<TMessage[], string>();
const focusedSiblings = new WeakMap<TMessage[], number>();

/** One-commit hint when a page changes the roots of a partial tree. User selections then own it. */
export function focusHistory(messages: TMessage[], messageId?: string): void {
  if (messageId) focusedHistories.set(messages, messageId);
}

export function historyFocusIndexes(messages: TMessage[], rootKey: string): Map<string, number> {
  const result = new Map<string, number>();
  let id = focusedHistories.get(messages);
  if (!id) return result;
  const index = buildThreadIndex(messages);
  if (!index.messages.has(id)) return result;
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const parent = index.messages.get(id)?.parentMessageId;
    const key = parent && index.messages.has(parent) && parent !== id ? parent : ROOT_KEY;
    const siblings = index.children.get(key) ?? [];
    result.set(key === ROOT_KEY ? rootKey : key, siblings.length - siblings.indexOf(id) - 1);
    id = key || undefined;
  }
  return result;
}

/** Supplies the same one-commit hint to the recursive fallback renderer. */
export function focusHistoryTree(messages: TMessage[] | null, tree: TMessage[] | null): void {
  if (!messages || !tree || !focusedHistories.has(messages)) return;
  const indexes = historyFocusIndexes(messages, ROOT_KEY);
  let siblings = tree;
  let key = ROOT_KEY;
  while (siblings.length) {
    const selected = indexes.get(key);
    if (selected == null) break;
    focusedSiblings.set(siblings, selected);
    const node = siblings[siblings.length - selected - 1];
    key = node.messageId;
    siblings = node.children ?? [];
  }
}

export const historySiblingFocus = (tree?: TMessage[] | null): number | undefined =>
  tree ? focusedSiblings.get(tree) : undefined;
