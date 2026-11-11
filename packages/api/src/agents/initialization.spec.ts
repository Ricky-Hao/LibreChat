import { GraphInterrupt } from '@langchain/langgraph';
import type { SubagentResolutionDiagnostic } from '@librechat/agents';
import {
  createSubagentResolutionFailureHandler,
  SubagentInitializationError,
  validateSelectedSubagent,
  withInitializationStage,
} from './initialization';

const secret = 'Bearer private-token query=request prompt=secret 401';
const detail: SubagentResolutionDiagnostic = {
  phase: 'config',
  subagentType: secret,
  aborted: false,
  type: 'Error',
  cause: 'unknown',
  message: 'Subagent error: Unable to initialize the selected subagent.',
  parentRunId: '11111111-1111-4111-8111-111111111111',
  childRunId: '22222222-2222-4222-8222-222222222222',
  parentToolCallId: secret,
};

describe('subagent initialization diagnostics', () => {
  it.each(['configuration_changed', 'agent_unavailable', 'model_unavailable'] as const)(
    'classifies %s through a cause chain without disclosing text',
    (code) => {
      const log = jest.fn();
      const handler = createSubagentResolutionFailureHandler(log);
      const error = new Error(secret, { cause: new SubagentInitializationError(code) });
      expect(handler(detail, error)).toBe(code);
      expect(log.mock.calls[0][1]).toMatchObject({
        cause: code,
        parentRunId: detail.parentRunId,
        childRunId: detail.childRunId,
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    },
  );

  it.each(['provider', 'tools', 'skills'] as const)(
    'retains %s stage and unknown cause',
    async (stage) => {
      const error = Object.assign(new Error(secret), { name: secret, code: secret, status: 401 });
      await expect(
        withInitializationStage(stage, () => {
          throw error;
        }),
      ).rejects.toBe(error);
      const log = jest.fn();
      expect(createSubagentResolutionFailureHandler(log)(detail, error)).toBe('unknown');
      expect(log.mock.calls[0][1]).toMatchObject({
        errors: [{ type: 'Error', stage, status: 401 }],
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    },
  );

  it('allowlists MCP codes without misclassifying them as agent permission failures', () => {
    const log = jest.fn();
    const handler = createSubagentResolutionFailureHandler(log);
    expect(
      handler(detail, Object.assign(new Error(secret), { code: 'MCP_AUTHENTICATION_REJECTED' })),
    ).toBe('unknown');
    expect(log.mock.calls[0][1]).toMatchObject({
      errors: [{ code: 'MCP_AUTHENTICATION_REJECTED' }],
    });
  });

  it('bounds circular/deep causes and survives hostile getters and prototype traps', () => {
    const log = jest.fn();
    const handler = createSubagentResolutionFailureHandler(log);
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error(secret);
        },
        getPrototypeOf() {
          throw new Error(secret);
        },
      },
    );
    expect(handler(detail, hostile)).toBe('unknown');
    const circular = { cause: {} };
    circular.cause = circular;
    expect(handler(detail, circular)).toBe('unknown');
    let deep: Error = new SubagentInitializationError('model_unavailable');
    for (let i = 0; i < 20; i++) deep = new Error(secret, { cause: deep });
    expect(handler(detail, deep)).toBe('unknown');
    expect(log.mock.calls[2][1].errors).toHaveLength(6);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });

  it('keeps classification when the logger fails', () => {
    const handler = createSubagentResolutionFailureHandler(() => {
      throw new Error(secret);
    });
    expect(handler(detail, new SubagentInitializationError('configuration_changed'))).toBe(
      'configuration_changed',
    );
  });

  it('retains SDK host-argument refusals and recognizes a stable LangChain code', () => {
    const log = jest.fn();
    const handler = createSubagentResolutionFailureHandler(log);
    expect(handler({ ...detail, cause: 'host_argument_rejected' }, new Error(secret))).toBe(
      'host_argument_rejected',
    );
    expect(handler(detail, { code: secret, lc_error_code: 'MODEL_NOT_FOUND' })).toBe(
      'model_unavailable',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });

  it.each([new GraphInterrupt([]), new DOMException('Aborted', 'AbortError')])(
    'preserves control-flow error identity',
    async (error) => {
      await expect(withInitializationStage('provider', () => Promise.reject(error))).rejects.toBe(
        error,
      );
    },
  );
});

describe('selected subagent preflight', () => {
  function setup() {
    return {
      agent: { version: 'current' },
      configId: 'current',
      getConfigId: (agent: { version: string }) => agent.version,
      canView: jest.fn().mockResolvedValue(true),
      validateModel: jest.fn().mockResolvedValue({ isValid: true }),
      signal: new AbortController().signal,
    };
  }

  it.each(['configuration', 'permission', 'model'] as const)(
    'rejects %s before child initialization',
    async (stage) => {
      const params = setup();
      if (stage === 'configuration') params.configId = 'old';
      if (stage === 'permission') params.canView.mockResolvedValue(false);
      if (stage === 'model')
        params.validateModel.mockResolvedValue({ isValid: false, error: { message: secret } });
      const initialize = jest.fn();
      const log = jest.fn();
      const codes = {
        configuration: 'configuration_changed',
        permission: 'agent_unavailable',
        model: 'model_unavailable',
      };
      await validateSelectedSubagent(params).then(initialize, (error) => {
        expect(createSubagentResolutionFailureHandler(log)(detail, error)).toBe(codes[stage]);
      });
      expect(initialize).not.toHaveBeenCalled();
      expect(log.mock.calls[0][1]).toMatchObject({ errors: [{ stage, code: codes[stage] }] });
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
      if (stage !== 'model') expect(params.validateModel).not.toHaveBeenCalled();
    },
  );

  it('reuses prior VIEW check and still validates the model', async () => {
    const params = setup();
    await validateSelectedSubagent({ ...params, viewAccessChecked: true });
    expect(params.canView).not.toHaveBeenCalled();
    expect(params.validateModel).toHaveBeenCalledTimes(1);
  });

  it('preserves owned cancellation without invoking the model validator', async () => {
    const params = setup();
    const controller = new AbortController();
    const error = new Error(secret);
    controller.abort(error);
    await expect(validateSelectedSubagent({ ...params, signal: controller.signal })).rejects.toBe(
      error,
    );
    expect(params.validateModel).not.toHaveBeenCalled();
  });
});
