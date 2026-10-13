import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { MESSAGE_READS_HEADER, messageReadsConfigSchema } from 'librechat-data-provider';
import type { MessageReadOperation, TMessageReadsConfig } from 'librechat-data-provider';
import type { BoundedMessageMethods, MessageReadRow } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { MessageRequestValidation } from '~/middleware/messageValidation';
import { getAppConfigOptionsFromUser } from '~/app/service';

type ObjectValue = Record<string, unknown>;
type ReadRequest = Request & { user?: { id?: string; tenantId?: string | null } };
type Selection = {
  conversationId: string;
  messageId?: string;
  ancestry: number[];
  kind: 'all' | 'tools';
  limit: number;
  maxBytes: number;
  timeField: 'createdAt' | 'updatedAt';
  direction: 'asc' | 'desc';
  from?: string;
  to?: string;
  includeContext: boolean;
  field?: 'text' | 'entry' | 'args' | 'output';
  index?: number;
};
type Token = {
  v: 2;
  principal: string;
  expiresAt: number;
  op: MessageReadOperation | 'ref';
  selection: Selection;
  version?: string;
  position?: number;
  offset?: number;
  after?: { time: string; id: string };
};
type ReadDeps = BoundedMessageMethods & {
  validate(req: ReadRequest): MessageRequestValidation;
  getLimits(req: ReadRequest): Promise<TMessageReadsConfig | undefined>;
  getCursorKey(): string;
};
const object = (value: unknown): value is ObjectValue =>
  value != null && typeof value === 'object' && !Array.isArray(value);
const own = (value: ObjectValue, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('base64url');
class ReadError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
const fail = (code = 'INVALID_REQUEST', status = 400): never => {
  throw new ReadError(code, status);
};
const hints: Record<string, string> = {
  INVALID_REQUEST: 'Use either start parameters or only cursor; check selectors and limits.',
  INVALID_CURSOR: 'Restart the read; this reference or cursor is invalid for this request.',
  STALE_CURSOR: 'The stored message changed. Restart content discovery.',
  NOT_FOUND: 'The message or conversation is unavailable.',
  FIELD_NOT_RECORDED: 'The selected scope or field was not recorded.',
  UNSUPPORTED_CONTENT: 'This stored value is not supported by the public reader.',
  ITEM_TOO_LARGE: 'The selected record cannot fit the response budget.',
  UNAVAILABLE: 'Bounded message reading is temporarily unavailable.',
};
function integer(value: unknown, fallback: number, max: number, min = 1): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return fail();
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fail();
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > 512) return fail();
  return value;
}
function timestamp(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value))
    return fail();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19))
    return fail();
  return date.toISOString();
}
function codec(key: string, principal: string, ttl: number) {
  if (!key) return fail('UNAVAILABLE', 503);
  const sign = (text: string) =>
    createHmac('sha256', key).update('message-reads-v2\0').update(text).digest('base64url');
  return {
    encode(token: Omit<Token, 'v' | 'principal' | 'expiresAt'>): string {
      const text = Buffer.from(
        JSON.stringify({ ...token, v: 2, principal, expiresAt: Date.now() + ttl * 1000 }),
      ).toString('base64url');
      return `${text}.${sign(text)}`;
    },
    decode(raw: unknown, op: Token['op']): Token {
      if (typeof raw !== 'string' || raw.length > 8192 || !/^[\w-]+\.[\w-]+$/.test(raw))
        return fail('INVALID_CURSOR');
      const [text, signature] = raw.split('.');
      const expected = sign(text);
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      )
        return fail('INVALID_CURSOR');
      try {
        const token = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Token;
        if (
          token.v !== 2 ||
          token.principal !== principal ||
          token.op !== op ||
          !object(token.selection) ||
          !Number.isFinite(token.expiresAt) ||
          token.expiresAt <= Date.now()
        )
          return fail('INVALID_CURSOR');
        return token;
      } catch {
        return fail('INVALID_CURSOR');
      }
    },
  };
}

/** Historical measurement types and absence are preserved; arbitrary metadata never leaves. */
function measurements(input: unknown): { value?: unknown; omitted: boolean } {
  let remaining = 128;
  let omitted = false;
  const visit = (value: unknown, depth: number): unknown => {
    if (--remaining < 0 || depth > 8) {
      omitted = true;
      return undefined;
    }
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return value;
    if (
      typeof value === 'string' &&
      value.length <= 64 &&
      /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|unknown|not_recorded|unsupported)$/.test(value)
    )
      return value;
    if (object(value)) {
      const result: ObjectValue = Object.create(null);
      for (const [key, child] of Object.entries(value)) {
        if (
          key.length > 128 ||
          /secret|password|credential|authorization|cookie|signature|config|routing|api[_-]?key|^token$|^jwt$/i.test(
            key,
          )
        ) {
          omitted = true;
          continue;
        }
        const selected = visit(child, depth + 1);
        if (selected !== undefined) result[key] = selected;
      }
      return result;
    }
    if (Array.isArray(value) && value.length <= remaining) {
      const result = value.map((child) => visit(child, depth + 1));
      if (result.every((child) => child !== undefined)) return result;
    }
    omitted = true;
    return undefined;
  };
  const value = visit(input, 0);
  return { value, omitted };
}
function metadata(row: MessageReadRow): ObjectValue {
  const output: ObjectValue = {};
  const omitted: string[] = [];
  for (const key of [
    'messageId',
    'parentMessageId',
    'createdAt',
    'updatedAt',
    'isCreatedByUser',
    'sender',
    'model',
    'endpoint',
    'thread_id',
    'finish_reason',
    'unfinished',
    'error',
  ] as const) {
    const value = row[key];
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) omitted.push(key);
    else output[key] = value;
  }
  for (const key of ['tokenCount', 'summaryTokenCount'] as const) {
    if (row[key] === undefined) continue;
    const selected = measurements(row[key]);
    if (selected.value !== undefined) output[key] = selected.value;
    if (selected.omitted) omitted.push(key);
  }
  if (object(row.metadata)) {
    const meta: ObjectValue = {};
    for (const key of ['usage', 'summaryUsedTokens', 'contextUsage']) {
      if (!own(row.metadata, key)) continue;
      const selected = measurements(row.metadata[key as keyof typeof row.metadata]);
      if (selected.value !== undefined) meta[key] = selected.value;
      if (selected.omitted) omitted.push(`metadata.${key}`);
    }
    if (Object.keys(meta).length) output.metadata = meta;
  }
  if (omitted.length) output.omittedFields = omitted;
  return output;
}

/** Reject malformed scalar leaves even after the database's positive entry projection. */
function checkEntry(value: unknown): void {
  if (!object(value)) return fail('UNSUPPORTED_CONTENT', 422);
  const scalars = (row: ObjectValue, exceptions: string[]) => {
    for (const [key, child] of Object.entries(row))
      if (!exceptions.includes(key) && child !== null && typeof child === 'object')
        fail('UNSUPPORTED_CONTENT', 422);
  };
  scalars(value, [
    'text',
    'think',
    'quotes',
    'tool_call_ids',
    'agent_ids',
    'tool_call',
    'content',
    'boundary',
    'agent_update',
    'image_url',
    'video_url',
    'input_audio',
    'image_file',
  ]);
  for (const key of ['quotes', 'tool_call_ids', 'agent_ids'])
    if (
      own(value, key) &&
      (!Array.isArray(value[key]) || !(value[key] as unknown[]).every((v) => typeof v === 'string'))
    )
      fail('UNSUPPORTED_CONTENT', 422);
  for (const key of ['text', 'think']) {
    const text = value[key];
    if (Array.isArray(text)) fail('UNSUPPORTED_CONTENT', 422);
    if (object(text)) {
      scalars(text, ['annotations']);
      if (Array.isArray(text.annotations))
        for (const a of text.annotations) {
          if (!object(a)) fail('UNSUPPORTED_CONTENT', 422);
          scalars(a, ['file_path', 'file_citation']);
          for (const k of ['file_path', 'file_citation']) if (object(a[k])) scalars(a[k], []);
        }
    }
  }
  if (object(value.tool_call)) {
    scalars(value.tool_call, ['args', 'output', 'function', 'code_interpreter', 'backgroundTask']);
    if (object(value.tool_call.function))
      scalars(value.tool_call.function, ['arguments', 'output']);
    if (object(value.tool_call.code_interpreter))
      scalars(value.tool_call.code_interpreter, ['input', 'outputs']);
    if (object(value.tool_call.backgroundTask)) scalars(value.tool_call.backgroundTask, []);
  }
  for (const key of [
    'boundary',
    'agent_update',
    'image_url',
    'video_url',
    'input_audio',
    'image_file',
  ])
    if (object(value[key])) scalars(value[key], []);
  if (Array.isArray(value.content))
    for (const part of value.content)
      if (!object(part) || part.type !== 'text' || typeof part.text !== 'string')
        fail('UNSUPPORTED_CONTENT', 422);
}

/** Three operations; all continuation selectors live in authenticated, principal-bound tokens. */
export function createMessageReadHandler(
  deps: ReadDeps,
  operation: MessageReadOperation,
): (req: ReadRequest, res: Response) => Promise<void> {
  return async (req, res): Promise<void> => {
    res.setHeader(MESSAGE_READS_HEADER, '2');
    res.setHeader('Cache-Control', 'private, no-store');
    let budget = 65_536;
    const wire = (value: unknown) => ({ schemaVersion: 2, ...(value as ObjectValue) });
    const fits = (value: unknown) => bytes(wire(value)) <= budget;
    const send = (value: unknown, status = 200) => {
      if (!fits(value)) fail('ITEM_TOO_LARGE', 422);
      res
        .status(status)
        .type('application/json')
        .send(JSON.stringify(wire(value)));
    };
    try {
      if (!req.user?.id) return fail('NOT_FOUND', 404);
      const limits = messageReadsConfigSchema.parse((await deps.getLimits(req)) ?? {});
      budget = limits.responseBytes;
      const tokens = codec(
        deps.getCursorKey(),
        hash([req.user.id, req.user.tenantId ?? null]),
        limits.tokenTtlSeconds,
      );
      const q = req.query;
      let prior: Token | undefined;
      let selection: Selection;
      if (q.cursor !== undefined) {
        if (Object.keys(q).length !== 1) return fail();
        prior = tokens.decode(q.cursor, operation);
        selection = prior.selection;
      } else {
        const allowed = {
          list: [
            'conversationId',
            'messageId',
            'timeField',
            'from',
            'to',
            'direction',
            'limit',
            'includeContext',
          ],
          content: ['conversationId', 'messageId', 'ref', 'ancestry', 'kind', 'limit'],
          read: ['ref', 'field', 'index', 'maxBytes'],
        }[operation];
        if (Object.keys(q).some((key) => !allowed.includes(key))) return fail();
        if (q.ref !== undefined) prior = tokens.decode(q.ref, 'ref');
        if (prior && (q.conversationId !== undefined || q.messageId !== undefined)) return fail();
        if (operation === 'read' && !prior) return fail();
        selection = {
          conversationId: prior?.selection.conversationId ?? identifier(q.conversationId),
          messageId:
            prior?.selection.messageId ??
            (q.messageId === undefined ? undefined : identifier(q.messageId)),
          ancestry: prior?.selection.ancestry ?? [],
          kind: 'all',
          limit: limits.pageSize,
          maxBytes: limits.bodyBytes,
          timeField: 'createdAt',
          direction: 'asc',
          includeContext: false,
        };
        if (operation === 'list') {
          if (
            selection.messageId &&
            ['timeField', 'from', 'to', 'direction', 'limit'].some((key) => q[key] !== undefined)
          )
            return fail();
          if (
            q.timeField !== undefined &&
            q.timeField !== 'createdAt' &&
            q.timeField !== 'updatedAt'
          )
            return fail();
          if (q.direction !== undefined && q.direction !== 'asc' && q.direction !== 'desc')
            return fail();
          if (
            q.includeContext !== undefined &&
            q.includeContext !== 'true' &&
            q.includeContext !== 'false'
          )
            return fail();
          selection.timeField = (q.timeField as Selection['timeField']) ?? 'createdAt';
          selection.direction = (q.direction as Selection['direction']) ?? 'asc';
          selection.includeContext = q.includeContext === 'true';
          selection.from = timestamp(q.from);
          selection.to = timestamp(q.to);
          if (selection.from && selection.to && selection.from >= selection.to) return fail();
        } else if (!selection.messageId) return fail();
        if (operation === 'content') {
          if (q.kind !== undefined && q.kind !== 'all' && q.kind !== 'tools') return fail();
          selection.kind = (q.kind as Selection['kind']) ?? 'all';
          if (q.ancestry !== undefined) {
            if (typeof q.ancestry !== 'string' || !/^\d+(,\d+)*$/.test(q.ancestry)) return fail();
            const ancestry = q.ancestry
              .split(',')
              .map((value) => integer(value, 0, 2_147_483_647, 0));
            if (
              ancestry.length > 16 ||
              (prior && prior.selection.ancestry.some((index, i) => ancestry[i] !== index))
            )
              return fail();
            selection.ancestry = ancestry;
          }
        }
        selection.limit = integer(q.limit, limits.pageSize, 100);
        if (operation === 'read') {
          const field = q.field ?? 'entry';
          if (!['text', 'entry', 'args', 'output'].includes(field as string)) return fail();
          if (field === 'text' && (q.index !== undefined || selection.ancestry.length))
            return fail();
          if (field !== 'text' && q.index === undefined) return fail();
          selection.field = field as Selection['field'];
          selection.index =
            q.index === undefined ? undefined : integer(q.index, 0, 2_147_483_647, 0);
          selection.maxBytes = integer(
            q.maxBytes,
            limits.bodyBytes,
            Math.min(32_768, limits.bodyBytes),
          );
        }
      }
      // Re-resolve access on every request, including token-only calls. Tokens grant no access.
      req.params = {
        conversationId: selection.conversationId,
        ...(selection.messageId ? { messageId: selection.messageId } : {}),
      };
      const validation = deps.validate(req);
      const access = await validation.promise;
      if (!access.ok || !validation.shouldFetchMessages) return fail('NOT_FOUND', 404);
      const scope = {
        user: req.user.id,
        tenantId: req.user.tenantId ?? undefined,
        conversationId: selection.conversationId,
        ...(selection.messageId ? { messageId: selection.messageId } : {}),
      };
      const continuation = (extra: Partial<Token>) =>
        tokens.encode({ op: operation, selection, ...extra });
      if (operation === 'list') {
        const rows = await deps.getMessageReadMetadata({
          ...scope,
          ...selection,
          direction: selection.direction === 'asc' ? 1 : -1,
          limit: selection.messageId ? 1 : selection.limit + 1,
          after: prior?.after,
        });
        const base = {
          conversationId: selection.conversationId,
          observability: { llmRequests: 'not_recorded', ptcInnerCalls: 'not_recorded' },
          ...(!selection.messageId ? { consistency: 'live' } : {}),
          ...(selection.includeContext ? { contextProjection: 'measurements' } : {}),
        };
        const items: ObjectValue[] = [];
        let nextCursor: string | null = null;
        for (let i = 0; i < Math.min(rows.length, selection.limit); i++) {
          const row = rows[i];
          const time = row[selection.timeField];
          if (!selection.messageId && (!(time instanceof Date) || !Number.isFinite(time.getTime())))
            return fail('UNSUPPORTED_CONTENT', 422);
          const next =
            !selection.messageId && i < rows.length - 1
              ? continuation({ after: { time: time!.toISOString(), id: row.messageId } })
              : null;
          const item = metadata(row);
          if (!fits({ ...base, items: [...items, item], nextCursor: next })) {
            if (!items.length) return fail('ITEM_TOO_LARGE', 422);
            break;
          }
          items.push(item);
          nextCursor = next;
        }
        send({ ...base, items, nextCursor });
        return;
      }
      const position = prior?.op === operation ? (prior.position ?? 0) : 0;
      const offset = prior?.op === operation ? (prior.offset ?? 0) : 0;
      const maxBytes = Math.min(selection.maxBytes, limits.bodyBytes);
      const row = await deps.getMessageReadContent({
        ...scope,
        messageId: selection.messageId!,
        ancestry: selection.ancestry,
        position,
        limit: operation === 'read' ? maxBytes : selection.limit,
        ...(operation === 'read' ? { field: selection.field, index: selection.index } : {}),
      });
      if (!row) return fail('NOT_FOUND', 404);
      // Writer-maintained consistency, not full-source hashing. Missing __v is distinct from zero.
      const version = hash([
        String(row._id),
        own(row as unknown as ObjectValue, '__v') ? row.__v : 'missing',
        row.updatedAt,
        row.parentMessageId,
        row.unfinished,
        row.error,
      ]);
      if (prior?.version && prior.version !== version) return fail('STALE_CURSOR', 409);
      if (!row.validScope) return fail('FIELD_NOT_RECORDED', 404);
      if (operation === 'content') {
        const ref = tokens.encode({ op: 'ref', selection, version });
        const base = {
          ref,
          ancestry: selection.ancestry,
          ...(!selection.ancestry.length && row.textRecorded ? { text: true } : {}),
        };
        const items: ObjectValue[] = [];
        let end = position;
        for (const raw of row.entries ?? []) {
          const index = raw.index as number;
          if (selection.kind === 'tools' && !raw.tool) {
            end = index + 1;
            continue;
          }
          const { tool: _tool, children, omittedFields, ...item } = raw;
          if (Array.isArray(omittedFields) && omittedFields.length)
            item.omittedFields = omittedFields;
          if (children) item.children = { ancestry: [...selection.ancestry, index], omitted: true };
          const next = continuation({ version, position: index + 1 });
          if (!fits({ ...base, items: [...items, item], nextCursor: next })) {
            if (!items.length) return fail('ITEM_TOO_LARGE', 422);
            break;
          }
          items.push(item);
          end = index + 1;
        }
        const more = row.hasMore || end < position + (row.entries?.length ?? 0);
        send({
          ...base,
          items,
          nextCursor: more ? continuation({ version, position: end }) : null,
        });
        return;
      }
      if (!row.recorded) return fail('FIELD_NOT_RECORDED', 404);
      const string = row.stringWindow !== undefined;
      if (selection.field === 'text' && row.value !== null && typeof row.value === 'object')
        return fail('UNSUPPORTED_CONTENT', 422);
      if (!string && selection.field === 'entry') checkEntry(row.value);
      const representation = string ? 'utf8' : 'json';
      const data = Buffer.from(string ? row.stringWindow! : JSON.stringify(row.value), 'utf8');
      const start = string ? 0 : offset;
      if (start > data.length) return fail('INVALID_CURSOR');
      let end = Math.min(start + maxBytes, data.length);
      const make = () => {
        while (end > start && end < data.length && (data[end] & 0xc0) === 0x80) end--;
        const segment = data.subarray(start, end).toString('utf8');
        const complete = end === data.length;
        return {
          representation,
          offsetBytes: offset,
          data: segment,
          complete,
          ...(selection.field === 'entry'
            ? {
                projection: 'public-entry',
                nestedContentOmitted: true,
                unlistedFieldsOmitted: true,
              }
            : {}),
          nextCursor: complete
            ? null
            : continuation({
                version,
                position: string ? position + Array.from(segment).length : 0,
                offset: offset + end - start,
              }),
        };
      };
      let result = make();
      while (!fits(result) && end > start) {
        end = start + Math.floor((end - start) / 2);
        result = make();
      }
      if (end === start && start < data.length) return fail('ITEM_TOO_LARGE', 422);
      send(result);
    } catch (error) {
      const known = error instanceof ReadError ? error : new ReadError('UNAVAILABLE', 503);
      send(
        { error: { code: known.code, message: hints[known.code] ?? hints.UNAVAILABLE } },
        known.status,
      );
    }
  };
}

/** Configuration adapter keeps legacy CJS routes wiring-only. */
export function createMessageReadLimits(
  getConfig: (
    options: ReturnType<typeof getAppConfigOptionsFromUser> & { skipRuntimeAugmentation: true },
  ) => Promise<{ messageReads?: TMessageReadsConfig } | null | undefined>,
): ReadDeps['getLimits'] {
  return async (req) =>
    (
      await getConfig({
        ...getAppConfigOptionsFromUser({ ...req.user, tenantId: req.user?.tenantId ?? undefined }),
        skipRuntimeAugmentation: true,
      })
    )?.messageReads;
}
