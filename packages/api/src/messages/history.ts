import { z } from 'zod';
import { MAX_HISTORY_PAGE_SIZE, DEFAULT_HISTORY_WINDOW_SIZE, Tools } from 'librechat-data-provider';
import type { HistoryOptions, TMessage } from 'librechat-data-provider';
import type { HistoryMethods } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type {
  MessageRequestValidation,
  FailedMessageValidationResult,
} from '~/middleware/messageValidation';
import type { prepareToolCallPreviews } from './previews';

type HistoryRequest = Request & { user?: { id?: string; tenantId?: string | null } };
type Deps = HistoryMethods & {
  validate(req: HistoryRequest): MessageRequestValidation;
  sendValidationResponse(res: Response, result: FailedMessageValidationResult): Response;
  previews(req: HistoryRequest): ReturnType<typeof prepareToolCallPreviews>;
  logError(): void;
};
type ReadResult<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settleRead = <T>(read: Promise<T>): Promise<ReadResult<T>> =>
  read.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
const cursor = z
  .object({ createdAt: z.string().datetime(), position: z.string().regex(/^[a-f\d]{24}$/i) })
  .strict();
const querySchema = z
  .object({
    messageId: z.string().min(1).max(512).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_HISTORY_PAGE_SIZE)
      .default(DEFAULT_HISTORY_WINDOW_SIZE),
    before: z
      .string()
      .max(1024)
      .transform((text, ctx) => parseCursor(text, ctx))
      .optional(),
    since: z
      .string()
      .max(1024)
      .transform((text, ctx) => parseCursor(text, ctx))
      .optional(),
  })
  .refine(
    (query) =>
      !(query.before && query.since) && !(query.messageId && (query.before || query.since)),
  );

function parseCursor(text: string, ctx: z.RefinementCtx) {
  try {
    return cursor.parse(JSON.parse(text));
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid history cursor' });
    return z.NEVER;
  }
}

/** Body references live only in the display projection, never in stored messages. */
export function withAttachmentRefs(messages: TMessage[]): TMessage[] {
  return messages.map((message) => ({
    ...message,
    attachments: message.attachments?.map((attachment, index) =>
      attachment.type === Tools.web_search ||
      attachment.type === Tools.file_search ||
      !(attachment.filename || attachment.filepath || 'file_id' in attachment)
        ? attachment
        : {
            ...attachment,
            bodyRef: {
              conversationId: message.conversationId ?? '',
              messageId: message.messageId,
              index,
              revision: message.updatedAt ? new Date(message.updatedAt).toISOString() : '',
            },
          },
    ),
  }));
}

/** Validation and the user/tenant-scoped read overlap, but no data leaves before access settles. */
export function createHistoryHandler(deps: Deps, windowed = false) {
  return async (req: HistoryRequest, res: Response): Promise<void> => {
    if (!req.user?.id) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    const isWindowed = windowed || req.query.history === 'recent';
    const parsed = isWindowed ? querySchema.safeParse(req.query) : undefined;
    if (parsed && !parsed.success) {
      res.status(400).json({ error: 'Invalid history request' });
      return;
    }
    const page: HistoryOptions | undefined = parsed?.success ? parsed.data : undefined;
    const lazyAttachments = isWindowed || req.query.attachmentBodies === 'lazy';
    try {
      const validation = deps.validate(req);
      const preview = deps.previews(req);
      const read = validation.shouldFetchMessages
        ? deps.getDisplayMessages({
            user: req.user.id,
            tenantId: req.user.tenantId,
            conversationId: req.params.conversationId,
            lazyAttachments,
            page,
          })
        : Promise.resolve({ messages: [], start: null, nextCursor: null });
      const [access, settled] = await Promise.all([validation.promise, settleRead(read)]);
      if (!access.ok) {
        deps.sendValidationResponse(res, access);
        return;
      }
      if (!settled.ok) throw settled.error;
      const result = settled.value;
      const messages = await preview(
        lazyAttachments ? withAttachmentRefs(result.messages) : result.messages,
      );
      res.status(200).json(isWindowed ? { ...result, messages } : messages);
    } catch {
      deps.logError();
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export function createAttachmentBodyHandler(deps: Omit<Deps, 'previews'>) {
  return async (req: HistoryRequest, res: Response): Promise<void> => {
    if (!req.user?.id) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }
    if (!/^\d+$/.test(req.params.index) || !Number.isSafeInteger(Number(req.params.index))) {
      res.status(400).json({ error: 'Invalid attachment index' });
      return;
    }
    const revision = z.string().datetime().optional().safeParse(req.query.revision);
    if (!revision.success) {
      res.status(400).json({ error: 'Invalid attachment revision' });
      return;
    }
    try {
      const validation = deps.validate(req);
      const read = validation.shouldFetchMessages
        ? deps.getHistoryAttachment({
            user: req.user.id,
            tenantId: req.user.tenantId,
            conversationId: req.params.conversationId,
            messageId: req.params.messageId,
            index: Number(req.params.index),
            revision: revision.data,
          })
        : Promise.resolve(null);
      const [access, settled] = await Promise.all([validation.promise, settleRead(read)]);
      if (!access.ok) {
        deps.sendValidationResponse(res, access);
        return;
      }
      if (!settled.ok) throw settled.error;
      const body = settled.value;
      if (!body) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(200).json(body);
    } catch {
      deps.logError();
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
