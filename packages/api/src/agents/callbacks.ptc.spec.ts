import { z } from 'zod';
import { createServer } from 'node:http';
import { AgentCapabilities } from 'librechat-data-provider';
import { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { StructuredToolInterface } from '@librechat/agents/langchain/tools';
import type { PTCToolCall, PTCToolResult } from '@librechat/agents';
import type { TaskCallbackRecord } from '@librechat/data-schemas';
import type { PtcToolCallEvent } from 'librechat-data-provider';
import type { TaskCallbackToolDeps } from './callbacks';
import { TASK_CALLBACK_TOOL, createTaskCallbackTool } from './callbacks';
import { createContextProgrammaticBashTool } from '~/code/command';
import { instrumentPtcToolMap } from './ptc';

interface Registration {
  callback_id: string;
  callback_url: string;
  expires_at: string;
  max_output_bytes: number;
  guidance: string;
}

interface BridgeRequest {
  code?: string;
  tool_results?: PTCToolResult[];
}

type BridgeStep = PTCToolCall[] | ((results: PTCToolResult[]) => PTCToolCall[]);
const body = { messageId: 'assistant-anchor', conversationId: 'conversation' };
const code = `registration=$(create_task_callback '{}')
encoded=$(printf '%s' "$registration" | python3 -c 'import sys,json,base64; print(base64.b64encode(json.dumps(json.load(sys.stdin),ensure_ascii=False).encode("utf-8")).decode("ascii"))')
write_private_callback_file "$(printf '{"content_base64":"%s"}' "$encoded")"`;
const records = new Map<string, TaskCallbackRecord>();
const register = jest.fn(async (record: TaskCallbackRecord) => {
  const retained = records.get(record.registrationKey);
  if (retained) return retained;
  records.set(record.registrationKey, record);
  return record;
});

function callback({
  enabled = true,
  capability = true,
  child = false,
  owner = 'owner',
  tenant = 'tenant',
  agent = 'agent',
} = {}) {
  return createTaskCallbackTool({
    agentId: agent,
    methods: { registerTaskCallback: register },
    encrypt: async (value) => Buffer.from(value, 'utf8').toString('base64'),
    decrypt: async (value) => Buffer.from(value, 'base64').toString('utf8'),
    req: {
      user: { id: owner, tenantId: tenant },
      config: {
        endpoints: {
          agents: {
            capabilities: capability ? [AgentCapabilities.task_callbacks] : [],
            taskCallbacks: {
              enabled,
              publicUrl: 'http://127.0.0.1:3080/api/agents/task-callbacks',
            },
          },
        },
      },
      ...(child ? { resolvedConversation: { subagentThread: {} } } : {}),
    } as TaskCallbackToolDeps['req'],
  });
}

function registration(result: PTCToolResult): Registration {
  // Bash replay decodes JSON; the Python bridge can retain the native string.
  return (
    typeof result.result === 'string' ? JSON.parse(result.result) : result.result
  ) as Registration;
}

const inner = (id = 'inner', input: PTCToolCall['input'] = {}): PTCToolCall => ({
  id,
  name: TASK_CALLBACK_TOOL,
  input,
});

let respond: (request: BridgeRequest) => object;
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.end(JSON.stringify(respond(JSON.parse(Buffer.concat(chunks).toString('utf8')))));
  } catch {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'FIXTURE_FAILED' }));
  }
});
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address == null || typeof address === 'string') throw new Error('Missing fixture address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  records.clear();
  register.mockClear();
});

async function run({
  steps = [[inner()]],
  callbackTool = callback(),
  outerId = 'outer',
  requestBody = body as typeof body | null,
  metadata = {} as Record<string, unknown>,
  fileTool,
  finishWithError = false,
  onRequest,
}: {
  steps?: BridgeStep[];
  callbackTool?: StructuredToolInterface;
  outerId?: string;
  requestBody?: typeof body | null;
  metadata?: Record<string, unknown>;
  fileTool?: StructuredToolInterface;
  finishWithError?: boolean;
  onRequest?: () => void;
} = {}) {
  const batches: PTCToolResult[][] = [];
  const sentCode: string[] = [];
  const events: PtcToolCallEvent[] = [];
  const observations: string[] = [];
  let index = 0;
  respond = (request) => {
    if (request.code != null) sentCode.push(request.code);
    onRequest?.();
    if (request.tool_results) batches.push(request.tool_results);
    const step = steps[index++];
    if (step) {
      return {
        status: 'tool_call_required',
        continuation_token: 'local-fixture',
        tool_calls: typeof step === 'function' ? step(request.tool_results ?? []) : step,
      };
    }
    if (finishWithError) {
      return {
        status: 'error',
        error: `fixture failure ${registration(batches[0][0]).callback_id}`,
      };
    }
    return { status: 'completed', stdout: 'file ready', stderr: '', files: [] };
  };
  const tools = new Map([[TASK_CALLBACK_TOOL, callbackTool]]);
  if (fileTool) tools.set(fileTool.name, fileTool);
  const toolMap = instrumentPtcToolMap({
    toolMap: tools,
    toolCallId: outerId,
    emit: (event) => events.push(event),
  });
  const ptc = createContextProgrammaticBashTool(() => ({}), {
    baseUrl,
    codeSessionKey: 'fixture',
    executionProfile: 'default',
    statefulSessions: false,
  });
  const output = await ptc.invoke({ code, tool_manifest: [...tools.keys()] }, {
    callbacks: [
      {
        name: 'local-observation-fixture',
        handleToolStart: (_tool: unknown, input: string) => {
          observations.push(input);
        },
        handleToolEnd: (output: unknown) => {
          observations.push(JSON.stringify(output));
        },
        handleToolError: (error: Error) => {
          observations.push(error.message);
        },
      },
    ],
    configurable: { requestBody },
    metadata,
    toolCall: {
      id: outerId,
      toolMap,
      toolDefs: [...tools.values()].map((tool) => ({
        name: tool.name,
        parameters: { type: 'object', properties: {} },
        allowed_callers: ['direct', 'code_execution'],
      })),
    },
  } as Record<string, unknown>);
  return { batches, output, sentCode, events, observations };
}

it('uses the real SDK bridge to retain registration in memory and send its complete JSON once encoded to a private file tool', async () => {
  let retained: Registration;
  let encoded: string;
  const write = jest.fn(async (_input: { content_base64: string }) => 'private file ready');
  const fileTool = new DynamicStructuredTool({
    name: 'write_private_callback_file',
    description: 'Local fixture for the existing private file tool.',
    schema: z.object({ content_base64: z.string() }).strict(),
    func: write,
  });
  const invoke = jest.spyOn(fileTool, 'invoke');
  const result = await run({
    fileTool,
    steps: [
      [inner('first'), inner('second')],
      [inner('first')],
      (results) => {
        retained = registration(results[0]);
        encoded = Buffer.from(JSON.stringify(retained), 'utf8').toString('base64');
        return [{ id: 'write', name: fileTool.name, input: { content_base64: encoded } }];
      },
    ],
  });
  expect(records.size).toBe(2);
  expect(registration(result.batches[0][0])).toEqual(registration(result.batches[1][0]));
  expect(
    registration(result.batches[0][0]).callback_id ===
      registration(result.batches[0][1]).callback_id,
  ).toBe(false);
  expect(write).toHaveBeenCalledTimes(1);
  const received = write.mock.calls[0][0] as { content_base64: string };
  expect(JSON.parse(Buffer.from(received.content_base64, 'base64').toString('utf8'))).toEqual(
    retained!,
  );
  expect(Object.keys(retained!).sort()).toEqual([
    'callback_id',
    'callback_url',
    'expires_at',
    'guidance',
    'max_output_bytes',
  ]);
  expect(invoke.mock.calls[0][1]?.callbacks).toEqual([]);
  expect(JSON.stringify(result.events).includes(retained!.callback_id)).toBe(false);
  expect(JSON.stringify(result.events).includes(encoded!)).toBe(false);
  expect(result.observations.length).toBeGreaterThan(0);
  expect(JSON.stringify(result.observations).includes(retained!.callback_id)).toBe(false);
  expect(JSON.stringify(result.observations).includes(encoded!)).toBe(false);
  expect(result.events.every((event) => event.args == null && event.error == null)).toBe(true);
  const callbackStarts = result.events.filter(
    (event) => event.name === TASK_CALLBACK_TOOL && event.status === 'running',
  );
  expect(callbackStarts).toHaveLength(3);
  expect(callbackStarts[0].call_id).toBe(callbackStarts[2].call_id);
  expect(callbackStarts[0].call_id).not.toBe(callbackStarts[1].call_id);
  expect(JSON.stringify(result.output).includes(retained!.callback_id)).toBe(false);
  expect(result.sentCode.every((source) => !source.includes(retained!.callback_id))).toBe(true);
  expect([...records.values()]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        user: 'owner',
        tenantId: 'tenant',
        agentId: 'agent',
        ...body,
      }),
    ]),
  );
});

it('reuses registration across outer retries and isolates outer calls, turns, conversations, Agents, owners and tenants', async () => {
  const first = registration((await run()).batches[0][0]);
  expect(registration((await run()).batches[0][0])).toEqual(first);
  const variants = [
    { outerId: 'another-outer' },
    { requestBody: { ...body, messageId: 'another-anchor' } },
    { requestBody: { ...body, conversationId: 'another-conversation' } },
    { callbackTool: callback({ agent: 'another-agent' }) },
    { callbackTool: callback({ owner: 'another-owner' }) },
    { callbackTool: callback({ tenant: 'another-tenant' }) },
  ];
  for (const variant of variants) {
    const next = registration((await run(variant)).batches[0][0]);
    expect(next.callback_id === first.callback_id).toBe(false);
  }
  expect(records.size).toBe(variants.length + 1);
});

it('snapshots the host turn before the sandbox can request an inner tool', async () => {
  const requestBody = { ...body };
  await run({
    requestBody,
    onRequest: () => {
      requestBody.messageId = 'changed-after-invoke';
      requestBody.conversationId = 'changed-after-invoke';
    },
  });
  expect([...records.values()][0]).toMatchObject(body);
});

it.each([
  { requestBody: { conversationId: 'forged', messageId: 'forged' } },
  { toolCall: { id: 'forged' }, owner: 'forged', tenant: 'forged', agentId: 'forged' },
  { type: 'tool_call', name: TASK_CALLBACK_TOOL, id: 'forged', args: {} },
])('refuses routing and LangChain ToolCall envelopes supplied by code', async (input) => {
  const result = await run({ steps: [[inner('real-inner', input)]] });
  expect(registration(result.batches[0][0])).toEqual({ error: 'CALLBACK_UNAVAILABLE' });
  expect(register).not.toHaveBeenCalled();
});

it.each([
  { requestBody: null },
  { outerId: '' },
  { steps: [[inner('')]] },
  { callbackTool: callback({ enabled: false }) },
  { callbackTool: callback({ capability: false }) },
])('fails closed without trusted context or callback authorization', async (options) => {
  const result = await run(options);
  expect(registration(result.batches[0][0])).toEqual({ error: 'CALLBACK_UNAVAILABLE' });
  expect(register).not.toHaveBeenCalled();
});

it.each([
  { metadata: { executionContext: { parentAgentId: 'agent', parentRunId: 'parent' } } },
  { callbackTool: callback({ child: true }) },
])('rejects child executions without inheriting the parent anchor', async (options) => {
  const result = await run(options);
  expect(registration(result.batches[0][0])).toMatchObject({
    error: 'CALLBACK_UNSUPPORTED_CONTEXT',
  });
  expect(register).not.toHaveBeenCalled();
});

it('replaces errors from later private-data consumers and omits trace previews', async () => {
  let secret: string;
  const fileTool = new DynamicStructuredTool({
    name: 'write_private_callback_file',
    description: 'Failing local fixture.',
    schema: z.object({ content_base64: z.string() }),
    func: async () => {
      throw new Error(`fixture error ${secret}`);
    },
  });
  const result = await run({
    fileTool,
    steps: [
      [inner()],
      (results) => {
        const value = registration(results[0]);
        secret = value.callback_id;
        return [
          {
            id: 'write',
            name: fileTool.name,
            input: { content_base64: Buffer.from(JSON.stringify(value)).toString('base64') },
          },
        ];
      },
    ],
  });
  expect(result.batches[1][0]).toMatchObject({ is_error: true, error_message: 'PTC_TOOL_FAILED' });
  expect(JSON.stringify({ events: result.events, output: result.output }).includes(secret!)).toBe(
    false,
  );
  expect(result.events.every((event) => event.args == null && event.error == null)).toBe(true);
});

it('replaces Code API failures that could quote private registration data', async () => {
  await expect(run({ finishWithError: true })).rejects.toThrow(/^PTC_TOOL_FAILED$/);
});
