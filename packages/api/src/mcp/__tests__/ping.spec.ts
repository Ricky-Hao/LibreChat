import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { EmptyResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { MCPConnection } from '../connection';

describe('MCP response forwarding', () => {
  let connection: MCPConnection;
  let server: Server;
  let sent: JSONRPCMessage[];

  async function connect() {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    sent = [];
    const send = clientTransport.send.bind(clientTransport);
    jest.spyOn(clientTransport, 'send').mockImplementation(async (message) => {
      sent.push(message);
      return send(message);
    });
    connection['transport'] = clientTransport;
    connection['patchTransportSend']();
    server = new Server({ name: 'test', version: '1' });
    await server.connect(serverTransport);
    await connection.client.connect(clientTransport);
    connection['setupTransportOnMessageHandler']();
  }

  async function request(method = 'ping') {
    const result = server.request({ method }, EmptyResultSchema, { timeout: 100 }).then(
      (value) => value,
      (error: unknown) => error,
    );
    await jest.advanceTimersByTimeAsync(100);
    expect(await result).toEqual({});
  }

  beforeEach(async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    connection = new MCPConnection({
      serverName: 'test',
      serverConfig: { command: 'unused', args: [], type: 'stdio' },
    });
    await connect();
  });

  afterEach(async () => {
    await connection.dispose();
    await server.close();
    jest.useRealTimers();
  });

  it.each([0, 300_001, -60_000])(
    'answers distinct pings regardless of clock offset %i',
    async (offset) => {
      jest.setSystemTime(1_000_000 + offset);
      for (let i = 0; i < 3; i++) await request();
      const responses = sent.filter((message) => 'result' in message);
      expect(responses).toEqual([
        { jsonrpc: '2.0', id: 0, result: {} },
        { jsonrpc: '2.0', id: 1, result: {} },
        { jsonrpc: '2.0', id: 2, result: {} },
      ]);
    },
  );

  it('forwards legitimate non-ping empty results through the SDK', async () => {
    connection.client.setRequestHandler(z.object({ method: z.literal('test/empty') }), () => ({}));
    await request('test/empty');
    await request('test/empty');
    expect(sent.filter((message) => 'result' in message)).toEqual([
      { jsonrpc: '2.0', id: 0, result: {} },
      { jsonrpc: '2.0', id: 1, result: {} },
    ]);
  });

  it('does not carry response throttling across close and reconnect', async () => {
    jest.setSystemTime(1_300_001);
    await request();
    await connection.disconnect();
    await server.close();
    await connect();
    for (let i = 0; i < 3; i++) await request();
    expect(sent.filter((message) => 'result' in message)).toHaveLength(3);
  });

  it('preserves nonempty results, errors, notifications and requests', async () => {
    const messages: JSONRPCMessage[] = [
      { jsonrpc: '2.0', id: 'result', result: { value: 1 } },
      { jsonrpc: '2.0', id: 'error', error: { code: -32601, message: 'Unknown method' } },
      { jsonrpc: '2.0', method: 'notifications/test', params: { value: 2 } },
      { jsonrpc: '2.0', id: 'request', method: 'ping' },
    ];
    sent.length = 0;
    for (const message of messages) await connection['transport']!.send(message);
    expect(sent).toEqual(messages);
    await expect(connection.client.ping({ timeout: 100 })).resolves.toEqual({});
  });
});
