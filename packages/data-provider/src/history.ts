import type { TMessage } from './schemas';

/** Safety ceiling for a single older-history page. Revalidation covers the already loaded span. */
export const MAX_HISTORY_PAGE_SIZE = 100;
export const DEFAULT_HISTORY_WINDOW_SIZE = 24;

export type HistoryCursor = { createdAt: string; position: string };
export type HistoryPage = {
  messages: TMessage[];
  nextCursor: HistoryCursor | null;
  start: HistoryCursor | null;
};
export type HistoryOptions = {
  /** An explicit action may need one parent outside the loaded window. */
  messageId?: string;
  limit?: number;
  before?: HistoryCursor;
  /** Inclusive lower bound when revalidating an already loaded window. */
  since?: HistoryCursor;
};
export type AttachmentBodyRef = {
  conversationId: string;
  messageId: string;
  index: number;
  revision: string;
};
