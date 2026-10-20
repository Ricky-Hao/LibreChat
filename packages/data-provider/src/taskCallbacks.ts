import { z } from 'zod';

export const TASK_CALLBACK_OUTPUT_MAX_BYTES = 32_768;
export const taskCallbackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  publicUrl: z.string().url().optional(),
  ttlMs: z.number().int().min(60_000).max(604_800_000).default(86_400_000),
  receiptRetentionMs: z.number().int().min(86_400_000).max(7_776_000_000).default(604_800_000),
  maxOutputBytes: z
    .number()
    .int()
    .min(1)
    .max(TASK_CALLBACK_OUTPUT_MAX_BYTES)
    .default(TASK_CALLBACK_OUTPUT_MAX_BYTES),
  requestsPerMinute: z.number().int().min(1).max(10_000).default(60),
  recoveryIntervalMs: z.number().int().min(1000).max(300_000).default(30_000),
  recoveryBatchSize: z.number().int().min(1).max(1000).default(25),
  branchMessageLimit: z.number().int().min(10).max(10_000).default(2000),
});

export type TaskCallbackConfig = z.infer<typeof taskCallbackConfigSchema>;

/** No routing, prompt, metadata, or execution controls cross this boundary. */
export const taskCallbackBodySchema = z
  .object({
    version: z.literal(1),
    callback_id: z.string().regex(/^tcb_[A-Za-z0-9_-]{43}$/),
    status: z.enum(['success', 'error', 'cancelled']),
    output: z.string().max(TASK_CALLBACK_OUTPUT_MAX_BYTES),
  })
  .strict();

export type TaskCallbackBody = z.infer<typeof taskCallbackBodySchema>;
export interface TaskCallbackReceipt {
  version: 1;
  receipt_id: string;
  accepted_at: string;
}

/** Display/diagnostic projection only; model-bound tool traffic retains the bearer. */
export function redactTaskCallbackIds(text: string): string {
  return text.replace(/\btcb_[A-Za-z0-9_-]*/g, '[task callback]');
}
