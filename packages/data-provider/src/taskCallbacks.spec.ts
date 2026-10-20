import {
  taskCallbackBodySchema,
  taskCallbackConfigSchema,
  redactTaskCallbackIds,
} from './taskCallbacks';
import { configSchema } from './config';

describe('external task callback contract', () => {
  it('defaults off and admits explicit deployment configuration', () => {
    expect(taskCallbackConfigSchema.parse({})).toMatchObject({
      enabled: false,
      ttlMs: 86400000,
      maxOutputBytes: 32768,
    });
    const config = configSchema.parse({
      version: '1.3.8',
      endpoints: {
        agents: {
          taskCallbacks: {
            enabled: true,
            publicUrl: 'https://chat.example/api/agents/task-callbacks',
            ttlMs: 60000,
          },
        },
      },
    });
    expect(config.endpoints?.agents?.taskCallbacks?.ttlMs).toBe(60000);
    expect(taskCallbackConfigSchema.safeParse({ ttlMs: 0 }).success).toBe(false);
    expect(taskCallbackConfigSchema.safeParse({ maxOutputBytes: 32769 }).success).toBe(false);
  });
  it('only admits the shared terminal protocol; display projection masks streamed prefixes', () => {
    const body = {
      version: 1,
      callback_id: `tcb_${'a'.repeat(43)}`,
      status: 'success',
      output: 'done',
    };
    expect(taskCallbackBodySchema.parse(body)).toEqual(body);
    for (const field of ['target', 'input', 'prompt', 'mode', 'metadata']) {
      expect(taskCallbackBodySchema.safeParse({ ...body, [field]: 'untrusted' }).success).toBe(
        false,
      );
    }
    expect(redactTaskCallbackIds(`Task ${body.callback_id} finished; tcb_partial`)).toBe(
      'Task [task callback] finished; [task callback]',
    );
  });
});
