/** Bounded analysis protocol; unrelated browser message APIs retain their contracts. */
export const MESSAGE_READS_VERSION = 2;
export const MESSAGE_READS_HEADER = 'x-librechat-message-reads';
export type MessageReadTimeField = 'createdAt' | 'updatedAt';
export type MessageReadBodyField = 'text' | 'entry' | 'args' | 'output';
export type MessageReadOperation = 'list' | 'content' | 'read';
