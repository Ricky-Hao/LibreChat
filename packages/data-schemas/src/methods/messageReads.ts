import type { MessageReadTimeField } from 'librechat-data-provider';
import type { Model, PipelineStage } from 'mongoose';
import type { IMessage } from '~/types';
import { activeExpirationFilter } from '~/utils/retention';

export interface MessageReadScope {
  user: string;
  tenantId?: string;
  conversationId: string;
  messageId?: string;
}

/** Internal projection. Identity/revision fields are digested, never returned verbatim. */
export interface MessageReadRow {
  _id: { toString(): string };
  __v?: number;
  conversationId: string;
  messageId: string;
  parentMessageId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  isCreatedByUser?: boolean;
  sender?: string;
  model?: string;
  endpoint?: string;
  thread_id?: string;
  finish_reason?: string;
  unfinished?: boolean;
  error?: boolean;
  tokenCount?: unknown;
  summaryTokenCount?: unknown;
  metadata?: { usage?: unknown; contextUsage?: unknown; summaryUsedTokens?: unknown };
  text?: unknown;
  content?: unknown;
}

export interface MessageReadPageInput extends MessageReadScope {
  includeContext?: boolean;
  timeField: MessageReadTimeField;
  direction: 1 | -1;
  from?: string;
  to?: string;
  after?: { time: string; id: string };
  limit: number;
}

export interface BoundedMessageMethods {
  getMessageReadMetadata(input: MessageReadPageInput): Promise<MessageReadRow[]>;
  getMessageReadContent(input: ContentReadInput): Promise<ProjectedMessageRead | null>;
}

export interface ContentReadInput extends MessageReadScope {
  messageId: string;
  ancestry: number[];
  position: number;
  limit: number;
  field?: 'text' | 'entry' | 'args' | 'output';
  index?: number;
}

export interface ProjectedMessageRead extends MessageReadRow {
  validScope: boolean;
  entries?: Record<string, unknown>[];
  hasMore?: boolean;
  textRecorded?: boolean;
  recorded?: boolean;
  stringWindow?: string;
  value?: unknown;
}

const identity = {
  _id: 1,
  __v: 1,
  conversationId: 1,
  messageId: 1,
  parentMessageId: 1,
  createdAt: 1,
  updatedAt: 1,
  unfinished: 1,
  error: 1,
} as const;

/** Positive projection: metadata reads never hydrate text, content, files or other metadata. */
const MESSAGE_READ_METADATA_PROJECTION: Record<string, 1> = {
  ...identity,
  isCreatedByUser: 1,
  sender: 1,
  model: 1,
  endpoint: 1,
  thread_id: 1,
  finish_reason: 1,
  tokenCount: 1,
  summaryTokenCount: 1,
  'metadata.usage': 1,
  'metadata.contextUsage.contextBudget': 1,
  'metadata.contextUsage.effectiveInstructionTokens': 1,
  'metadata.contextUsage.prePruneContextTokens': 1,
  'metadata.contextUsage.remainingContextTokens': 1,
  'metadata.contextUsage.calibrationRatio': 1,
  'metadata.contextUsage.cacheRead': 1,
  'metadata.contextUsage.cacheWrite': 1,
  'metadata.contextUsage.completedOutputTokens': 1,
  'metadata.contextUsage.resumedOutputTokens': 1,
  'metadata.contextUsage.retainedToolTokens': 1,
  'metadata.contextUsage.breakdown.maxContextTokens': 1,
  'metadata.contextUsage.breakdown.instructionTokens': 1,
  'metadata.contextUsage.breakdown.systemMessageTokens': 1,
  'metadata.contextUsage.breakdown.dynamicInstructionTokens': 1,
  'metadata.contextUsage.breakdown.toolSchemaTokens': 1,
  'metadata.contextUsage.breakdown.summaryTokens': 1,
  'metadata.contextUsage.breakdown.toolCount': 1,
  'metadata.contextUsage.breakdown.messageCount': 1,
  'metadata.contextUsage.breakdown.messageTokens': 1,
  'metadata.contextUsage.breakdown.availableForMessages': 1,
  'metadata.contextUsage.breakdown.toolMessageTokens': 1,
  'metadata.contextUsage.breakdown.toolTokenCounts': 1,
  'metadata.contextUsage.breakdown.toolMessageTokenCounts': 1,
  'metadata.summaryUsedTokens': 1,
} as const;

const scope = (input: MessageReadScope) => ({
  user: input.user,
  tenantId: input.tenantId == null ? { $exists: false } : input.tenantId,
  conversationId: input.conversationId,
  ...(input.messageId == null ? {} : { messageId: input.messageId }),
  ...activeExpirationFilter<IMessage>(),
});

export function createBoundedMessageMethods(
  mongoose: typeof import('mongoose'),
): BoundedMessageMethods {
  return {
    async getMessageReadMetadata(input) {
      const Message = mongoose.models.Message as Model<IMessage>;
      const range = {
        ...(input.from == null ? {} : { $gte: new Date(input.from) }),
        ...(input.to == null ? {} : { $lt: new Date(input.to) }),
      };
      const op = input.direction === 1 ? '$gt' : '$lt';
      return Message.find({
        ...scope(input),
        ...(Object.keys(range).length === 0 ? {} : { [input.timeField]: range }),
        ...(input.after == null
          ? {}
          : {
              $and: [
                {
                  $or: [
                    { [input.timeField]: { [op]: new Date(input.after.time) } },
                    {
                      [input.timeField]: new Date(input.after.time),
                      messageId: { [op]: input.after.id },
                    },
                  ],
                },
              ],
            }),
      })
        .select(
          Object.fromEntries(
            Object.entries(MESSAGE_READ_METADATA_PROJECTION).filter(
              ([key]) => input.includeContext || !key.startsWith('metadata.contextUsage.'),
            ),
          ),
        )
        .collation({ locale: 'simple' })
        .sort({ [input.timeField]: input.direction, messageId: input.direction })
        .limit(input.limit)
        .lean<MessageReadRow[]>();
    },
    async getMessageReadContent(input) {
      const Message = mongoose.models.Message as Model<IMessage>;
      let content: unknown = '$content';
      for (const index of input.ancestry) {
        content = {
          $let: {
            vars: { parent: { $arrayElemAt: [array(content), index] } },
            in: '$$parent.tool_call.subagent_content',
          },
        };
      }
      const stages: PipelineStage[] = [
        { $match: scope(input) },
        { $limit: 1 },
        {
          $project: {
            ...identity,
            text: input.field === 'text' ? 1 : { $ne: [{ $type: '$text' }, 'missing'] },
            scopeContent: content,
          },
        },
      ];
      const validScope = input.ancestry.length
        ? { $isArray: '$scopeContent' }
        : { $in: [{ $type: '$scopeContent' }, ['array', 'missing']] };
      if (input.field) {
        const raw = { $arrayElemAt: [array('$scopeContent'), input.index ?? 0] };
        const field = input.field;
        const value =
          field === 'text'
            ? { value: '$text' }
            : {
                $let: {
                  vars: { part: raw },
                  in:
                    field === 'entry'
                      ? {
                          $cond: [
                            { $eq: [{ $type: '$$part' }, 'object'] },
                            { value: publicEntryProjection('$$part') },
                            {},
                          ],
                        }
                      : {
                          value: {
                            $switch: {
                              branches: [
                                {
                                  case: exists(`$$part.tool_call.${field}`),
                                  then: `$$part.tool_call.${field}`,
                                },
                                {
                                  case: exists(
                                    `$$part.tool_call.function.${field === 'args' ? 'arguments' : 'output'}`,
                                  ),
                                  then: `$$part.tool_call.function.${field === 'args' ? 'arguments' : 'output'}`,
                                },
                              ],
                              default: `$$part.tool_call.code_interpreter.${field === 'args' ? 'input' : 'outputs'}`,
                            },
                          },
                        },
                },
              };
        stages.push({
          $replaceRoot: {
            newRoot: {
              $mergeObjects: [pick('$$ROOT', Object.keys(identity)), { validScope }, value],
            },
          },
        });
        stages.push({
          $replaceRoot: {
            newRoot: {
              $mergeObjects: [
                pick('$$ROOT', [...Object.keys(identity), 'validScope']),
                { recorded: exists('$value') },
                {
                  $cond: [
                    { $eq: [{ $type: '$value' }, 'string'] },
                    { stringWindow: { $substrCP: ['$value', input.position, input.limit + 1] } },
                    pick('$$ROOT', ['value']),
                  ],
                },
              ],
            },
          },
        });
      } else {
        stages.push({
          $project: {
            ...identity,
            validScope,
            textRecorded: '$text',
            hasMore: { $gt: [{ $size: array('$scopeContent') }, input.position + input.limit] },
            entries: {
              $map: {
                input: {
                  $range: [
                    input.position,
                    { $min: [{ $size: array('$scopeContent') }, input.position + input.limit] },
                  ],
                },
                as: 'i',
                in: {
                  $let: {
                    vars: { part: { $arrayElemAt: [array('$scopeContent'), '$$i'] } },
                    in: descriptor('$$part', '$$i'),
                  },
                },
              },
            },
          },
        });
      }
      // Single-document aggregation: revision, incarnation and selected data share one read.
      // No full body, sibling or descendant array is returned to the driver.
      const rows = await Message.aggregate<ProjectedMessageRead>(stages);
      return rows[0] ?? null;
    },
  };
}

const array = (value: unknown): unknown => ({ $cond: [{ $isArray: value }, value, []] });
const exists = (value: string): unknown => ({ $ne: [{ $type: value }, 'missing'] });
const pick = (value: string, fields: readonly string[]): unknown => ({
  $arrayToObject: {
    $filter: {
      input: { $objectToArray: { $cond: [{ $eq: [{ $type: value }, 'object'] }, value, {}] } },
      as: 'f',
      cond: { $in: ['$$f.k', fields] },
    },
  },
});
const partFields = [
  'type',
  'agentId',
  'groupId',
  'text',
  'think',
  'steer',
  'error',
  'phase',
  'tool_call_ids',
  'reasoning_label',
  'reasoning_label_step_id',
  'reasoning_label_status',
  'reasoning_unavailable',
  'steerId',
  'clientSteerId',
  'createdAt',
  'quotes',
  'activity_label',
  'activity_label_type',
  'activity_start_index',
  'activity_end_index',
  'activity_count',
  'agent_ids',
  'status',
  'pending',
  'tokenCount',
  'summarizing',
  'failed',
  'initiatedBy',
  'summaryVersion',
  'model',
  'provider',
  'subagentRunId',
  'subagentSequence',
  'subagentStatus',
  'stepId',
];
const toolFields = [
  'type',
  'id',
  'name',
  'args',
  'output',
  'stepId',
  'agentId',
  'groupId',
  'progress',
  'status',
  'runStepStatus',
  'runStepDurationMs',
  'runStepClosedAt',
  'toolPreparationStartedAt',
  'toolDispatchedAt',
  'toolPreparationDurationMs',
  'toolExecutionDurationMs',
  'backgrounded',
  'executor',
];
const summaryFields = [
  'type',
  'agentId',
  'groupId',
  'id',
  'name',
  'stepId',
  'status',
  'runStepStatus',
  'runStepDurationMs',
  'runStepClosedAt',
  'toolPreparationStartedAt',
  'toolDispatchedAt',
  'toolPreparationDurationMs',
  'toolExecutionDurationMs',
  'progress',
  'backgrounded',
];

function descriptor(part: string, index: string): unknown {
  const tool = `${part}.tool_call`;
  const source = {
    $mergeObjects: [
      pick(part, summaryFields),
      pick(`${tool}.code_interpreter`, ['name']),
      pick(`${tool}.function`, ['name']),
      pick(tool, summaryFields),
    ],
  };
  const safe = {
    $switch: {
      branches: [
        {
          case: { $eq: [{ $type: '$$f.v' }, 'string'] },
          then: { $lte: [{ $strLenBytes: '$$f.v' }, 512] },
        },
      ],
      default: { $in: [{ $type: '$$f.v' }, ['bool', 'int', 'long', 'double', 'decimal', 'null']] },
    },
  };
  return {
    $mergeObjects: [
      {
        $let: {
          vars: { source },
          in: {
            $arrayToObject: {
              $filter: { input: { $objectToArray: '$$source' }, as: 'f', cond: safe },
            },
          },
        },
      },
      {
        index,
        tool: { $eq: [{ $type: tool }, 'object'] },
        supported: { $eq: [{ $type: part }, 'object'] },
        fields: {
          $concatArrays: [
            { $cond: [{ $eq: [{ $type: part }, 'object'] }, ['entry'], []] },
            ...(['args', 'output'] as const).map((field) => ({
              $cond: [
                {
                  $or: [
                    exists(`${tool}.${field}`),
                    exists(`${tool}.function.${field === 'args' ? 'arguments' : 'output'}`),
                    exists(`${tool}.code_interpreter.${field === 'args' ? 'input' : 'outputs'}`),
                  ],
                },
                [field],
                [],
              ],
            })),
          ],
        },
        // Explicitly indicate invalid/oversized summary leaves without returning them.
        omittedFields: {
          $let: {
            vars: { source },
            in: {
              $map: {
                input: {
                  $filter: {
                    input: { $objectToArray: '$$source' },
                    as: 'f',
                    cond: { $not: [safe] },
                  },
                },
                as: 'f',
                in: '$$f.k',
              },
            },
          },
        },
      },
      { $cond: [{ $isArray: `${tool}.subagent_content` }, { children: true }, {}] },
    ],
  };
}

/** Positive public-entry projection before driver materialization. Children/private state never leave Mongo. */
function publicEntryProjection(part: string): unknown {
  const optional = (key: string, expression: unknown): unknown => ({
    $cond: [exists(`${part}.${key}`), { [key]: expression }, {}],
  });
  const tool = `${part}.tool_call`;
  return {
    $cond: [
      { $eq: [{ $type: part }, 'object'] },
      {
        $mergeObjects: [
          pick(part, partFields),
          ...['text', 'think'].map((key) =>
            optional(key, {
              $cond: [
                { $eq: [{ $type: `${part}.${key}` }, 'object'] },
                {
                  $mergeObjects: [
                    pick(`${part}.${key}`, ['value']),
                    {
                      $cond: [
                        { $isArray: `${part}.${key}.annotations` },
                        {
                          annotations: {
                            $map: {
                              input: `${part}.${key}.annotations`,
                              as: 'a',
                              in: {
                                $mergeObjects: [
                                  pick('$$a', ['type', 'text', 'start_index', 'end_index']),
                                  ...['file_citation', 'file_path'].map((field) => ({
                                    $cond: [
                                      exists(`$$a.${field}`),
                                      { [field]: pick(`$$a.${field}`, ['file_id', 'quote']) },
                                      {},
                                    ],
                                  })),
                                ],
                              },
                            },
                          },
                        },
                        {},
                      ],
                    },
                  ],
                },
                `${part}.${key}`,
              ],
            }),
          ),
          optional('tool_call', {
            $mergeObjects: [
              pick(tool, toolFields),
              ...[
                ['function', ['name', 'arguments', 'output']],
                ['code_interpreter', ['name', 'input', 'outputs']],
                [
                  'backgroundTask',
                  ['version', 'taskId', 'toolName', 'status', 'cancelled', 'settledAt'],
                ],
              ].map(([key, fields]) => ({
                $cond: [
                  exists(`${tool}.${key}`),
                  { [key as string]: pick(`${tool}.${key}`, fields as string[]) },
                  {},
                ],
              })),
            ],
          }),
          optional('agent_update', pick(`${part}.agent_update`, ['index', 'runId', 'agentId'])),
          ...['image_url', 'video_url', 'input_audio', 'image_file'].map((key) =>
            optional(key, {
              $cond: [
                { $eq: [{ $type: `${part}.${key}` }, 'object'] },
                pick(`${part}.${key}`, [
                  'url',
                  'detail',
                  'data',
                  'format',
                  'file_id',
                  'filename',
                  'filepath',
                  'width',
                  'height',
                  'prompt',
                ]),
                `${part}.${key}`,
              ],
            }),
          ),
          {
            $cond: [
              { $eq: [`${part}.type`, 'summary'] },
              {
                $mergeObjects: [
                  optional('content', {
                    $map: {
                      input: array(`${part}.content`),
                      as: 's',
                      in: pick('$$s', ['type', 'text']),
                    },
                  }),
                  optional('boundary', pick(`${part}.boundary`, ['messageId', 'contentIndex'])),
                ],
              },
              {},
            ],
          },
        ],
      },
      {},
    ],
  };
}
