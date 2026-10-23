import { Schema } from 'mongoose';
import type { TaskCallbackBody, TaskCallbackReceipt } from 'librechat-data-provider';
import type { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import { createIndexesWithRetry } from '~/utils/retry';
import { runAsSystem } from '~/config/tenantContext';

export interface TaskCallbackRecord {
  hash: string;
  registrationKey: string;
  encryptedId: string;
  receiptId: string;
  user: string;
  tenantId?: string;
  agentId: string;
  conversationId: string;
  messageId: string;
  createdAt: Date;
  callbackExpiresAt: Date;
  expiresAt: Date;
  result?: Pick<TaskCallbackBody, 'status' | 'output'>;
  resultDigest?: string;
  acceptedAt?: Date;
  pending: boolean;
  deliveryKey?: string;
  /** Freeze the branch before transport; lost admissions replay the same parent. */
  dispatchParentId?: string;
  admittedAt?: Date;
}

const schema = new Schema<TaskCallbackRecord>(
  {
    hash: { type: String, required: true, unique: true },
    registrationKey: { type: String, required: true, unique: true },
    encryptedId: { type: String, required: true, select: false },
    receiptId: { type: String, required: true, unique: true },
    user: { type: String, required: true, index: true },
    tenantId: String,
    agentId: { type: String, required: true },
    conversationId: { type: String, required: true, index: true },
    messageId: { type: String, required: true },
    createdAt: { type: Date, required: true },
    callbackExpiresAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
    result: {
      type: new Schema(
        {
          status: { type: String, enum: ['success', 'error', 'cancelled'] },
          output: { type: String, maxlength: 32768 },
        },
        { _id: false },
      ),
      select: false,
    },
    resultDigest: String,
    acceptedAt: Date,
    pending: { type: Boolean, required: true },
    deliveryKey: String,
    dispatchParentId: String,
    admittedAt: Date,
  },
  { versionKey: false },
);
schema.index({ pending: 1, acceptedAt: 1 });

export function createTaskCallbackModel(
  mongoose: typeof import('mongoose'),
): Model<TaskCallbackRecord> {
  applyTenantIsolation(schema);
  return mongoose.models.TaskCallback || mongoose.model<TaskCallbackRecord>('TaskCallback', schema);
}

function receipt(record: TaskCallbackRecord): TaskCallbackReceipt {
  if (record.acceptedAt == null) throw new Error('Callback receipt is not sealed');
  return { version: 1, receipt_id: record.receiptId, accepted_at: record.acceptedAt.toISOString() };
}

export type SealTaskCallbackResult =
  | { ok: true; receipt: TaskCallbackReceipt; record: TaskCallbackRecord }
  | { ok: false; code: 'CALLBACK_NOT_FOUND' | 'CALLBACK_CONFLICT' | 'CALLBACK_EXPIRED' };

/** The sole bearer is hashed before this storage boundary. Ingress lookup and
 * recovery are explicit system operations; all execution reads retain owner scope. */
export function createTaskCallbackMethods(mongoose: typeof import('mongoose')) {
  const model = createTaskCallbackModel(mongoose);
  return {
    ensureTaskCallbackIndexes: async (): Promise<void> => {
      await createIndexesWithRetry(model);
    },
    registerTaskCallback: async (input: TaskCallbackRecord): Promise<TaskCallbackRecord> => {
      try {
        await model.create(input);
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
      const stored = await model
        .findOne({ registrationKey: input.registrationKey, user: input.user })
        .select('+encryptedId')
        .lean();
      if (stored == null) throw new Error('Callback registration unavailable');
      return stored;
    },
    sealTaskCallback: async (
      hash: string,
      digest: string,
      result: Pick<TaskCallbackBody, 'status' | 'output'>,
      now: Date,
    ): Promise<SealTaskCallbackResult> =>
      runAsSystem(async () => {
        const record = await model
          .findOneAndUpdate(
            {
              hash,
              resultDigest: { $exists: false },
              callbackExpiresAt: { $gt: now },
              expiresAt: { $gt: now },
            },
            { $set: { resultDigest: digest, result, acceptedAt: now, pending: true } },
            { new: true },
          )
          .lean();
        const current = record ?? (await model.findOne({ hash }).lean());
        if (current == null) return { ok: false, code: 'CALLBACK_NOT_FOUND' };
        if (current.expiresAt.getTime() <= now.getTime())
          return { ok: false, code: 'CALLBACK_EXPIRED' };
        if (current.resultDigest == null) return { ok: false, code: 'CALLBACK_EXPIRED' };
        if (current.resultDigest !== digest) return { ok: false, code: 'CALLBACK_CONFLICT' };
        return { ok: true, receipt: receipt(current), record: current };
      }),
    getTaskCallback: async (receiptId: string, user: string): Promise<TaskCallbackRecord | null> =>
      model.findOne({ receiptId, user }).select('+result').lean(),
    freezeTaskCallbackParent: async (
      receiptId: string,
      user: string,
      parentId: string,
    ): Promise<string | undefined> => {
      await model.updateOne(
        { receiptId, user, dispatchParentId: { $exists: false } },
        { $set: { dispatchParentId: parentId } },
      );
      return (await model.findOne({ receiptId, user }).lean())?.dispatchParentId;
    },
    listPendingTaskCallbacks: async (limit: number): Promise<TaskCallbackRecord[]> =>
      runAsSystem(async () =>
        model.find({ pending: true }).sort({ acceptedAt: 1 }).limit(limit).lean(),
      ),
    markTaskCallbackQueued: async (receiptId: string, deliveryKey: string): Promise<void> =>
      runAsSystem(async () => {
        await model.updateOne(
          { receiptId, pending: true },
          { $set: { pending: false, deliveryKey } },
        );
      }),
    markTaskCallbackAdmitted: async (receiptId: string, user: string): Promise<void> => {
      await model.updateOne(
        { receiptId, user, admittedAt: { $exists: false } },
        { $set: { admittedAt: new Date() } },
      );
    },
    deleteTaskCallbacks: async (user: string, conversationIds?: string[]): Promise<void> => {
      await model.deleteMany({
        user,
        ...(conversationIds == null ? {} : { conversationId: { $in: conversationIds } }),
      });
    },
  };
}

export type TaskCallbackMethods = ReturnType<typeof createTaskCallbackMethods>;
