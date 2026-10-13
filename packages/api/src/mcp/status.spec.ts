import { z } from 'zod';
import { executeTools, Constants } from '@librechat/agents';
import { ToolMessage } from '@librechat/agents/langchain/messages';
import type { PtcToolCallEvent } from 'librechat-data-provider';
import { markMCPToolResultError, isMCPToolResultError } from './status';
import { instrumentPtcToolMap } from '~/agents/ptc';
import { createMCPStructuredTool } from './tools';
import { formatToolContent } from './parsers';

test('protocol errors retain content and status through the structured-tool adapter', async () => {
  const formatted = markMCPToolResultError(
    formatToolContent(
      { isError: true, content: [{ type: 'text', text: 'Invalid query' }] },
      'openai',
    ),
    true,
  );
  const probe = createMCPStructuredTool(async () => formatted, {
    name: 'probe',
    description: 'Protocol status probe',
    schema: z.object({}),
    responseFormat: 'content_and_artifact',
  });
  const result = await probe.invoke({ name: 'probe', args: {}, id: 'call-a', type: 'tool_call' });
  expect(result).toBeInstanceOf(ToolMessage);
  expect(result.status).toBe('error');
  expect(JSON.stringify(result.content)).toContain('Invalid query');
  expect(result.tool_call_id).toBe('call-a');
  expect(isMCPToolResultError(JSON.parse(JSON.stringify(formatted)))).toBe(false);
});

test('successful MCP results retain their existing content and artifact contract', async () => {
  const formatted = markMCPToolResultError(
    formatToolContent({ content: [{ type: 'text', text: 'Success' }] }, 'openai'),
    false,
  );
  const probe = createMCPStructuredTool(async () => formatted, {
    name: 'probe',
    description: 'Protocol status probe',
    schema: z.object({}),
    responseFormat: 'content_and_artifact',
  });
  const result = await probe.invoke({ name: 'probe', args: {}, id: 'call-a', type: 'tool_call' });
  expect(result.status).toBe('success');
  expect(result.artifact).toEqual(formatted[1]);
});

test.each([Constants.PROGRAMMATIC_TOOL_CALLING, Constants.BASH_PROGRAMMATIC_TOOL_CALLING])(
  '%s carries real MCP errors through instrumentation and preserves the next success',
  async (caller) => {
    for (const includePreviews of [false, true]) {
      const events: PtcToolCallEvent[] = [];
      const failed = markMCPToolResultError(
        formatToolContent(
          {
            isError: true,
            content: [{ type: 'text', text: 'Missing fixture file' }],
            structuredContent: { reason: 'missing' },
          },
          'openai',
        ),
        true,
      );
      const succeeded = formatToolContent(
        { content: [{ type: 'text', text: '{"sha":"fixture-sha"}' }] },
        'openai',
      );
      const schema = z.object({ id: z.string() }).strict();
      const probe = Object.assign(
        createMCPStructuredTool(
          async (input) => (schema.parse(input).id === 'missing' ? failed : succeeded),
          {
            name: 'probe',
            description: 'Local MCP adapter fixture',
            schema,
            responseFormat: 'content_and_artifact',
          },
        ),
        { mcp: true, schema },
      );
      const toolMap = instrumentPtcToolMap({
        toolMap: new Map([[probe.name, probe]]),
        toolCallId: 'outer',
        includePreviews,
        emit: (event) => events.push(event),
      });
      const input = Object.freeze({ id: 'missing', intent: 'Inspect fixture' });
      const [bad] = await executeTools([{ id: 'bad', name: 'probe', input }], toolMap, caller);
      expect(bad).toMatchObject({ is_error: true, error_message: 'Tool reported an error.' });
      expect(bad.result).toBeInstanceOf(ToolMessage);
      expect(bad.result.artifact).toBe(failed[1]);
      expect(events[1]).toMatchObject({ status: 'error' });
      expect(events[1].error).toBe(includePreviews ? 'Tool reported an error.' : undefined);
      expect(events[0].args).toEqual(
        includePreviews ? expect.stringContaining('Inspect fixture') : undefined,
      );
      const [good] = await executeTools(
        [{ id: 'good', name: 'probe', input: { id: 'valid' } }],
        toolMap,
        caller,
      );
      expect(good).toMatchObject({ is_error: false, result: '{"sha":"fixture-sha"}' });
      expect(events[3]).toMatchObject({ status: 'success' });
      expect(input.intent).toBe('Inspect fixture');
    }
  },
);
