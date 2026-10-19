import { DEFAULT_HISTORY_WINDOW_SIZE } from 'librechat-data-provider';
import type {
  HistoryCursor,
  HistoryOptions,
  HistoryPage,
  TMessage,
  TFilePreview,
} from 'librechat-data-provider';
import type { FilterQuery, Model, Mongoose, Types } from 'mongoose';
import type { IMessage } from '~/types';
import { CLIENT_MESSAGE_SELECT } from './message';

export type HistoryScope = { user: string; conversationId: string; tenantId?: string | null };
export type HistoryMethods = {
  getDisplayMessages(
    input: HistoryScope & { lazyAttachments: boolean; page?: HistoryOptions },
  ): Promise<HistoryPage>;
  getHistoryAttachment(
    input: HistoryScope & { messageId: string; index: number; revision?: string },
  ): Promise<Pick<TFilePreview, 'text' | 'textFormat'> | null>;
};

const scopeFilter = ({ user, conversationId, tenantId }: HistoryScope): FilterQuery<IMessage> => ({
  user,
  conversationId,
  tenantId: tenantId ?? { $exists: false },
});

type HistoryRow = TMessage & { _id: Types.ObjectId };
const cursorOf = (message?: HistoryRow): HistoryCursor | null =>
  message?.createdAt == null
    ? null
    : { createdAt: new Date(message.createdAt).toISOString(), position: message._id.toString() };

/** Indexed display reads; model context and exports continue to use the ordinary full reader. */
export function createHistoryMethods(mongoose: Mongoose): HistoryMethods {
  return {
    async getDisplayMessages(input) {
      const Message = mongoose.models.Message as Model<IMessage>;
      const { page } = input;
      const boundary = page?.before ?? page?.since;
      const filter = scopeFilter(input);
      if (page?.messageId) filter.messageId = page.messageId;
      if (boundary) {
        const time = new Date(boundary.createdAt);
        const position = new mongoose.Types.ObjectId(boundary.position);
        filter.$or = page?.before
          ? [{ createdAt: { $lt: time } }, { createdAt: time, _id: { $lt: position } }]
          : [{ createdAt: { $gt: time } }, { createdAt: time, _id: { $gte: position } }];
      }
      const bounded = page != null && page.since == null;
      const limit = page?.limit ?? DEFAULT_HISTORY_WINDOW_SIZE;
      const order = bounded ? -1 : 1;
      const query = Message.find(filter)
        .select(
          `${CLIENT_MESSAGE_SELECT.replace('-_id', '')}${input.lazyAttachments ? ' -attachments.text -files.text' : ''}`,
        )
        .sort({ createdAt: order, _id: order });
      if (bounded) query.limit(limit + 1);
      const messages = await query.lean<HistoryRow[]>();
      const hasMore = bounded && messages.length > limit;
      if (hasMore) messages.pop();
      if (bounded) messages.reverse();
      const start = cursorOf(messages[0]);
      return {
        messages: messages.map(({ _id: _position, ...message }) => message),
        start,
        nextCursor: hasMore ? start : null,
      };
    },
    async getHistoryAttachment(input) {
      const Message = mongoose.models.Message as Model<IMessage>;
      const [row] = await Message.aggregate<{ body?: Pick<TFilePreview, 'text' | 'textFormat'> }>([
        {
          $match: {
            ...scopeFilter(input),
            messageId: input.messageId,
            ...(input.revision ? { updatedAt: new Date(input.revision) } : {}),
          },
        },
        { $project: { body: { $arrayElemAt: ['$attachments', input.index] } } },
        { $project: { 'body.text': 1, 'body.textFormat': 1 } },
      ]);
      return row?.body ?? null;
    },
  };
}
