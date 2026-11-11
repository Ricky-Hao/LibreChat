import express from 'express';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, EmptyResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { AddressInfo } from 'node:net';
import { MCPConnection } from '../connection';

test('one HTTP session answers recurring server heartbeats between tool calls', async () => {
  const server = new Server(
    { name: 'heartbeat-test', version: '1' },
    { capabilities: { tools: {} } },
  );
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => 'test-session' });
  const outgoing: JSONRPCMessage[] = [];
  const incoming: JSONRPCMessage[] = [];
  const send = transport.send.bind(transport);
  jest.spyOn(transport, 'send').mockImplementation(async (message, options) => {
    outgoing.push(message);
    return send(message, options);
  });
  let toolCalls = 0;
  server.setRequestHandler(CallToolRequestSchema, () => {
    toolCalls++;
    return { content: [{ type: 'text', text: `call ${toolCalls}` }] };
  });
  await server.connect(transport);
  const onmessage = transport.onmessage!;
  transport.onmessage = (message, extra) => {
    incoming.push(message);
    onmessage(message, extra);
  };

  let initializes = 0;
  let streams = 0;
  const sessions = new Set<string | undefined>();
  const httpErrors: unknown[] = [];
  const app = express();
  app.use(express.json());
  app.all('/mcp', (req, res) => {
    if (req.body?.method === 'initialize') initializes++;
    else sessions.add(req.headers['mcp-session-id'] as string | undefined);
    if (req.method === 'GET') streams++;
    void transport.handleRequest(req, res, req.body).catch((error) => {
      httpErrors.push(error);
      res.destroy();
    });
  });
  const http = createServer(app);
  let connection: MCPConnection | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const pending: Promise<void>[] = [];
  const heartbeatErrors: unknown[] = [];
  let acknowledged = 0;
  async function waitFor(predicate: () => boolean) {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      if (heartbeatErrors.length) throw heartbeatErrors[0];
      if (Date.now() >= deadline) throw new Error('Local heartbeat test deadline exceeded');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  try {
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const { port } = http.address() as AddressInfo;
    connection = new MCPConnection({
      serverName: 'heartbeat-test',
      serverConfig: {
        type: 'streamable-http',
        url: `http://127.0.0.1:${port}/mcp`,
        initTimeout: 2000,
        timeout: 1000,
      },
    });
    await connection.connectClient();
    await waitFor(() => streams === 1);
    const call = () => connection!.client.callTool({ name: 'echo' }, undefined, { timeout: 1000 });
    await expect(call()).resolves.toEqual({ content: [{ type: 'text', text: 'call 1' }] });
    heartbeat = setInterval(() => {
      pending.push(
        server.request({ method: 'ping' }, EmptyResultSchema, { timeout: 500 }).then(
          (result) => {
            expect(result).toEqual({});
            acknowledged++;
          },
          (error) => {
            heartbeatErrors.push(error);
          },
        ),
      );
    }, 50);
    await waitFor(() => acknowledged >= 4);
    await expect(call()).resolves.toEqual({ content: [{ type: 'text', text: 'call 2' }] });
    clearInterval(heartbeat);
    await Promise.all(pending);

    const pings = outgoing.filter((message) => 'method' in message && message.method === 'ping');
    const responses = incoming.filter((message) => 'result' in message);
    expect(pings.length).toBeGreaterThanOrEqual(4);
    expect(responses).toEqual(
      pings.map((message) => ({
        jsonrpc: '2.0',
        id: 'id' in message ? message.id : undefined,
        result: {},
      })),
    );
    expect(new Set(pings.map((message) => ('id' in message ? message.id : undefined))).size).toBe(
      pings.length,
    );
    expect(initializes).toBe(1);
    expect(streams).toBe(1);
    expect(sessions).toEqual(new Set(['test-session']));
    expect(transport.sessionId).toBe('test-session');
    expect(toolCalls).toBe(2);
    expect(heartbeatErrors).toEqual([]);
    expect(httpErrors).toEqual([]);
  } finally {
    clearInterval(heartbeat);
    await connection?.dispose();
    await server.close();
    await Promise.all(pending);
    http.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    );
  }
}, 10_000);
