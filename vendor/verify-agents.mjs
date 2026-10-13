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
assert.equal(source.dirty, true, 'This artifact records an uncommitted source patch');
assert.match(source.baseCommit, /^[a-f0-9]{40}$/);
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

for (const consumer of consumers) {
  const require = createRequire(resolve(root, consumer, 'package.json'));
  const packageRoot = resolve(dirname(require.resolve('@librechat/agents')), '../..');
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.version, version);
  assert.equal(manifest.types, manifest.exports['.'].types);
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
  await verifyIntent(sdk, DynamicStructuredTool, ToolMessage);
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
    await (${verifyIntent.toString()})(sdk, DynamicStructuredTool, ToolMessage);
    assert.match(sdk.buildSkillCarrierText('fixture', { skillName: 'fixture' }), /Skill source/);
  `;
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: resolve(root, consumer),
    encoding: 'utf8',
  });
  assert.equal(imported.status, 0, imported.stderr);
  console.log(
    `${consumer}: ${manifest.version}; all ${Object.keys(manifest.exports).length} require/import subpaths, CJS/ESM intent/result status and declaration exports verified`,
  );
}
console.log('Tarball integrity and single SDK lock resolution verified');
