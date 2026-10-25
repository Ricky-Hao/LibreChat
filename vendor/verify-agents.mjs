import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const metadata = JSON.parse(readFileSync(new URL('./agents.json', import.meta.url), 'utf8'));
const { artifact, version, consumers, sha256 } = metadata;
const archive = readFileSync(resolve(root, artifact));
assert.equal(createHash('sha256').update(archive).digest('hex'), sha256);
const { source } = metadata;
assert.equal(source.dirty, false, 'This artifact was built from a clean source commit');
assert.equal(source.buildState, 'clean-commit');
assert.match(source.baseCommit, /^[a-f0-9]{40}$/);
assert.match(source.committedSource.commit, /^[a-f0-9]{40}$/);
assert.match(source.committedSource.tree, /^[a-f0-9]{40}$/);
assert.equal(
  createHash('sha256')
    .update(readFileSync(resolve(root, source.patch)))
    .digest('hex'),
  source.patchSha256,
);
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const entries = Object.entries(lock.packages).filter(([name]) =>
  name.endsWith('node_modules/@librechat/agents'),
);
assert.equal(entries.length, 1, 'A nested SDK copy is forbidden');
assert.equal(entries[0][1].version, version);
assert.equal(entries[0][1].resolved, `file:${artifact}`);
assert.equal(
  entries[0][1].integrity,
  `sha512-${createHash('sha512').update(archive).digest('base64')}`,
);

/** Self-contained so the identical summary smoke also runs in the ESM subprocess. */
function verifySummaryReasoning(sdk) {
  for (const provider of [
    sdk.Providers.OPENAI,
    sdk.Providers.AZURE,
    sdk.Providers.OPENROUTER,
    sdk.Providers.DEEPSEEK,
    undefined,
  ]) {
    const emptyReasoning = { reasoning: { type: 'reasoning', summary: [] } };
    const content = [
      { type: 'text', text: 'First ' },
      { type: 'text', text: 'second' },
    ];
    for (const body of ['', 'Body', content]) {
      assert.equal(
        sdk.getChunkContent({
          chunk: { content: body, additional_kwargs: emptyReasoning },
          provider,
          reasoningKey: 'reasoning',
        }),
        body,
      );
    }
    assert.equal(
      sdk.getChunkContent({
        chunk: {
          content: '',
          additional_kwargs: {
            reasoning: {
              type: 'reasoning',
              encrypted_content: 'not-visible',
              summary: [
                { type: 'summary_text', text: '' },
                { type: 'summary_text', text: 'First ' },
                { type: 'summary_text', text: 'second' },
              ],
            },
          },
        },
        provider,
        reasoningKey: 'reasoning',
      }),
      'First second',
    );
  }
}

/** Self-contained so the identical behavioral smoke also runs in the ESM subprocess. */
async function verifyIntent(sdk, DynamicStructuredTool, ToolMessage) {
  const strictTool = new DynamicStructuredTool({
    name: 'intent_fixture',
    description: 'Local invocation smoke test',
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    func: async (input) => JSON.stringify(input),
  });
  const input = Object.freeze({ id: 'fixture', intent: 'Inspecting fixture' });
  assert.deepEqual(sdk.stripIntentForInvoke(input, strictTool), { id: 'fixture' });
  const [result] = await sdk.executeTools(
    [{ id: 'call', name: strictTool.name, input: JSON.stringify(input) }],
    new Map([[strictTool.name, strictTool]]),
  );
  assert.equal(result.is_error, false);
  assert.deepEqual(JSON.parse(result.result), { id: 'fixture' });
  assert.equal(input.intent, 'Inspecting fixture');

  const referenced = {
    type: 'object',
    $defs: {
      business: {
        type: 'object',
        properties: { id: { type: 'string' }, intent: { type: 'string' } },
        required: ['id', 'intent'],
        additionalProperties: false,
      },
    },
    allOf: [{ $ref: '#/$defs/business' }],
  };
  assert.equal(sdk.stripIntentForInvoke(input, { schema: referenced }), input);
  const businessTool = new DynamicStructuredTool({
    name: 'business_fixture',
    description: 'Local reference smoke test',
    schema: referenced,
    func: async (args) => JSON.stringify(args),
  });
  const [business] = await sdk.executeTools(
    [{ id: 'business', name: businessTool.name, input: JSON.stringify(input) }],
    new Map([[businessTool.name, businessTool]]),
  );
  assert.equal(business.is_error, false);
  assert.deepEqual(JSON.parse(business.result), input);

  let probes = 0;
  Object.defineProperty(strictTool, 'schema', {
    get() {
      probes++;
      throw new Error('PRIVATE_SCHEMA_FIXTURE');
    },
  });
  const [unsafe] = await sdk.executeTools(
    [{ id: 'unsafe', name: strictTool.name, input }],
    new Map([[strictTool.name, strictTool]]),
  );
  assert.equal(unsafe.is_error, true);
  assert.equal(unsafe.error_message, 'Tool input schema could not be inspected safely.');
  assert.equal(probes, 0);

  const failure = new ToolMessage({
    content: 'Missing fixture',
    status: 'error',
    tool_call_id: '',
  });
  const resultTool = Object.assign(
    new DynamicStructuredTool({
      name: 'result_fixture',
      description: 'Local result status smoke',
      schema: { type: 'object', properties: {} },
      func: async () => failure,
    }),
    { mcp: true },
  );
  for (const caller of [
    sdk.Constants.PROGRAMMATIC_TOOL_CALLING,
    sdk.Constants.BASH_PROGRAMMATIC_TOOL_CALLING,
  ]) {
    const [failed] = await sdk.executeTools(
      [{ id: 'failed', name: resultTool.name, input: {} }],
      new Map([[resultTool.name, resultTool]]),
      caller,
    );
    assert.equal(failed.is_error, true);
    assert.equal(failed.error_message, 'Tool reported an error.');
    assert.equal(failed.result, failure);
  }
  assert.equal(
    sdk.normalizeProgrammaticToolResponse(JSON.parse(JSON.stringify(failure)), true).is_error,
    true,
  );
  for (const envelope of [
    JSON.parse(JSON.stringify(failure)),
    { isError: true, content: [], structuredContent: { reason: 'fixture' } },
  ]) {
    const pair = [envelope, { type: 'file', uri: 'fixture.txt' }];
    const outcome = sdk.normalizeProgrammaticToolResponse(pair, true);
    assert.equal(outcome.is_error, true);
    assert.equal(outcome.result, pair);
  }
  const success = new ToolMessage({
    content: 'success',
    status: 'success',
    tool_call_id: '',
    artifact: new Date('2026-10-13T00:00:00.000Z'),
  });
  const nonMcpSuccess = new ToolMessage({
    content: 'success',
    status: 'success',
    tool_call_id: '',
  });
  assert.equal(sdk.normalizeProgrammaticToolResponse(nonMcpSuccess, false).result, nonMcpSuccess);
  for (const mcp of [false, true]) {
    const outcome = sdk.normalizeProgrammaticToolResponse(success, mcp);
    assert.equal(outcome.is_error, false);
    assert.equal(outcome.result, success);
  }
  assert.equal(
    sdk.normalizeProgrammaticToolResponse({ status: 'error', error: 'business value' }, true)
      .is_error,
    false,
  );
}

/** Exercises installed public factories and prompt construction without executing a model or tool. */
async function verifyArtifactGuidance(sdk) {
  const includesAll = (text, phrases) => {
    for (const phrase of phrases) {
      assert.ok(text.includes(phrase), `Missing artifact guidance: ${phrase}`);
    }
  };
  const internal = [
    'Prefer memory for single-call reads',
    'unique /tmp scratch (mktemp)',
    'consume it and clean it up in that call',
    'prompts, receipts, bridge scripts or report copies',
    'A callback completion notice is not a request for attachments',
    'authorized original workspace',
    'rather than defaulting to base64 round-trips',
    'Requested files and necessary deliverables are allowed',
    'Never hide files or change extensions to evade collection',
  ];
  const managed = [
    'automatically collected/displayed, not private scratch',
    'requested files, necessary deliverables, or unavoidable cross-call storage',
    '`/tmp` and other sandbox directories are not durable',
  ];
  const attached = [
    '${LIBRECHAT_CODE_DATA_DIR:-/mnt/data}',
    'automatically collected/displayed',
    'execution-scoped, not cross-call storage',
    'authorized selected project/workspace',
  ];
  const python = sdk.createProgrammaticToolCallingTool();
  const bash = sdk.createBashProgrammaticToolCallingTool();
  const workspace = sdk.createBashProgrammaticToolCallingTool({
    workspaceId: 'artifact-guidance-fixture',
  });
  for (const runner of [python, bash, workspace]) {
    for (const text of [runner.description, runner.schema.properties.code.description]) {
      includesAll(text, internal);
      assert.ok(!text.includes('Anything a later call needs'));
      assert.ok(!/\/mnt\/data\/(sf|ny)\.json/.test(text));
    }
  }
  for (const runner of [python, bash]) {
    for (const text of [runner.description, runner.schema.properties.code.description]) {
      includesAll(text, managed);
    }
  }
  for (const runner of [bash, workspace]) {
    for (const text of [runner.description, runner.schema.properties.code.description]) {
      includesAll(text, [
        "raw=$(tool '{}')",
        'direct tool > file may be empty',
        'mktemp -d /tmp/ptc.XXXXXXXXXX',
        'trap \'rm -rf -- "$tmp_dir"\' EXIT',
        '> "$tmp_dir/sf.json"',
        '> "$tmp_dir/ny.json"',
        'Only when an HTML preview is requested',
      ]);
    }
  }
  for (const text of [bash.description, bash.schema.properties.code.description]) {
    assert.ok(text.includes('> /mnt/data/report.html'));
  }
  for (const text of [workspace.description, workspace.schema.properties.code.description]) {
    includesAll(text, attached);
    assert.ok(text.includes('project file changes persist between calls'));
    assert.ok(text.includes('> "${LIBRECHAT_CODE_DATA_DIR:-/mnt/data}"/report.html'));
    assert.ok(!text.includes('Managed sandbox:'));
    assert.ok(!text.includes('unavoidable cross-call storage'));
    assert.ok(!text.includes('/mnt/data/report.html'));
  }
  for (const statefulSessions of [false, true]) {
    const options = { statefulSessions };
    const parameters = [
      sdk.buildCodeExecutionToolSchema(options).properties.code.description,
      sdk.buildBashExecutionToolSchema(options).properties.command.description,
    ];
    for (const text of [
      ...parameters,
      sdk.buildCodeExecutionToolDescription(options),
      sdk.buildBashExecutionToolDescription(options),
    ]) {
      includesAll(text, managed);
      assert.ok(!text.includes('Anything a later call needs'));
      assert.ok(!text.includes('write anything that must survive there'));
    }
    for (const text of parameters) {
      includesAll(text, internal);
    }
  }
  for (const text of [
    sdk.buildBashExecutionToolDescription({ attachedWorkspace: true }),
    sdk.buildBashExecutionToolSchema({ attachedWorkspace: true }).properties.command.description,
  ]) {
    includesAll(text, attached);
    assert.ok(!text.includes('Managed sandbox:'));
    assert.ok(!text.includes('Prior /mnt/data files'));
    assert.ok(!text.includes('unavoidable cross-call storage'));
  }
  const graph = sdk.createGraph({
    kind: 'standard',
    input: {
      agents: [
        {
          agentId: 'artifact-guidance-fixture',
          provider: sdk.Providers.OPENAI,
          instructions: 'Local prompt verification',
          toolDefinitions: [python, bash].map(({ name }) => ({ name })),
        },
      ],
    },
  });
  const context = graph.agentContexts.get('artifact-guidance-fixture');
  const messages = await context.systemRunnable.invoke([]);
  const content = String(messages[0].content);
  includesAll(content, internal);
  assert.equal(
    content.match(/A callback completion notice is not a request for attachments/g)?.length,
    1,
  );
  assert.ok(!content.includes('/mnt/data'));
}

for (const consumer of consumers) {
  const require = createRequire(resolve(root, consumer, 'package.json'));
  const packageRoot = resolve(dirname(require.resolve('@librechat/agents')), '../..');
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.version, version);
  assert.equal(manifest.types, manifest.exports['.'].types);
  assert.match(
    readFileSync(resolve(packageRoot, manifest.types), 'utf8'),
    /export \* from ['"]\.\/stream['"]/,
  );
  assert.match(
    readFileSync(resolve(packageRoot, 'dist/types/stream.d.ts'), 'utf8'),
    /export declare function getChunkContent\(/,
  );
  assert.match(
    readFileSync(resolve(packageRoot, manifest.types), 'utf8'),
    /export \* from ['"]\.\/tools\/intentArg['"]/,
  );
  const declarations = readFileSync(
    resolve(packageRoot, 'dist/types/tools/intentArg.d.ts'),
    'utf8',
  );
  for (const helper of ['stripIntentForInvoke', 'inspectToolInputSchema']) {
    assert.ok(declarations.includes(`export declare function ${helper}(`));
  }
  assert.match(
    readFileSync(resolve(packageRoot, manifest.types), 'utf8'),
    /export \* from ['"]\.\/tools\/response['"]/,
  );
  assert.match(
    readFileSync(resolve(packageRoot, 'dist/types/tools/response.d.ts'), 'utf8'),
    /export declare function normalizeProgrammaticToolResponse\(/,
  );
  const sdk = require('@librechat/agents');
  const { DynamicStructuredTool } = require('@librechat/agents/langchain/tools');
  const { ToolMessage } = require('@librechat/agents/langchain/messages');
  verifySummaryReasoning(sdk);
  await verifyIntent(sdk, DynamicStructuredTool, ToolMessage);
  await verifyArtifactGuidance(sdk);
  for (const subpath of Object.keys(manifest.exports)) {
    const specifier = `@librechat/agents${subpath === '.' ? '' : subpath.slice(1)}`;
    assert.ok(require(specifier));
  }
  assert.equal(
    require('@librechat/agents').isMetadataSummaryStub('[Metadata summary: 1 messages (1 human)]'),
    true,
  );
  const code = `
    import assert from 'node:assert/strict';
    const subpaths = ${JSON.stringify(Object.keys(manifest.exports))};
    for (const subpath of subpaths) {
      const specifier = '@librechat/agents' + (subpath === '.' ? '' : subpath.slice(1));
      assert.match(import.meta.resolve(specifier), /dist\\/esm\\/.*\\.mjs$/);
      await import(specifier);
    }
    const sdk = await import('@librechat/agents');
    const { DynamicStructuredTool } = await import('@librechat/agents/langchain/tools');
    const { ToolMessage } = await import('@librechat/agents/langchain/messages');
    (${verifySummaryReasoning.toString()})(sdk);
    await (${verifyIntent.toString()})(sdk, DynamicStructuredTool, ToolMessage);
    await (${verifyArtifactGuidance.toString()})(sdk);
    assert.match(sdk.buildSkillCarrierText('fixture', { skillName: 'fixture' }), /Skill source/);
  `;
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: resolve(root, consumer),
    encoding: 'utf8',
  });
  assert.equal(imported.status, 0, imported.stderr);
  console.log(
    `${consumer}: ${manifest.version}; all ${Object.keys(manifest.exports).length} require/import subpaths, CJS/ESM summary reasoning/intent/result status/artifact guidance, public PTC system prompt and declaration exports verified`,
  );
}
console.log('Tarball integrity and single SDK lock resolution verified');
