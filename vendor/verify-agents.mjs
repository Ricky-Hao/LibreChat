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

for (const consumer of consumers) {
  const require = createRequire(resolve(root, consumer, 'package.json'));
  const manifest = JSON.parse(
    readFileSync(
      resolve(dirname(require.resolve('@librechat/agents')), '../../package.json'),
      'utf8',
    ),
  );
  assert.equal(manifest.version, version);
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
    assert.match(sdk.buildSkillCarrierText('fixture', { skillName: 'fixture' }), /Skill source/);
  `;
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: resolve(root, consumer),
    encoding: 'utf8',
  });
  assert.equal(imported.status, 0, imported.stderr);
  console.log(
    `${consumer}: ${manifest.version}; all ${Object.keys(manifest.exports).length} require/import subpaths verified`,
  );
}
console.log('Tarball integrity and single SDK lock resolution verified');
