import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const source = path.dirname(fileURLToPath(import.meta.url));

function fixture(t, uid = process.getuid(), gid = process.getgid()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'librechat-setup-'));
  const own = (filename) => {
    if (process.getuid() === 0) fs.chownSync(filename, uid, gid);
  };
  own(root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of [
    '.devcontainer',
    'bin',
    'home',
    'node_modules',
    'node_modules/playwright',
    'node_modules/mongodb-memory-server-core',
  ]) {
    fs.mkdirSync(path.join(root, directory));
    own(path.join(root, directory));
  }
  const write = (name, content, mode = 0o644) => {
    const filename = path.join(root, name);
    fs.writeFileSync(filename, content, { mode });
    own(filename);
  };
  for (const script of ['setup.sh', 'lighthouse.sh']) {
    write(`.devcontainer/${script}`, fs.readFileSync(path.join(source, script)));
  }
  write('.nvmrc', process.versions.node);
  write('package.json', JSON.stringify({ packageManager: 'npm@11.13.0' }));
  write('package-lock.json', '{}');
  write(
    'bin/npm',
    `#!/bin/sh
if [ "$1" = --version ]; then echo "\${TEST_NPM_VERSION:-11.13.0}"; exit; fi
if [ "$1" = ci ]; then
  [ "$HUSKY" = 0 ] || exit 91
  echo "$*" >> "$TEST_ROOT/calls"
  exit "\${TEST_INSTALL_EXIT:-0}"
fi
if [ "$1" = run ]; then
  node "$TEST_ROOT/record.cjs"
  exit
fi
exit 90
`,
    0o755,
  );
  write(
    'record.cjs',
    `require('node:fs').writeFileSync(process.env.TEST_ROOT + '/environment.json', JSON.stringify(Object.fromEntries(['CHROME_PATH', 'LIGHTHOUSE_CHROME_FLAGS', 'E2E_BASE_URL', 'E2E_USE_MEMORY_MONGO', 'E2E_STREAM_STORE', 'E2E_REPLICAS', 'E2E_CHROMIUM_CHANNEL'].map(key => [key, process.env[key]]))))`,
  );
  write(
    'node_modules/playwright/cli.js',
    `require('node:fs').appendFileSync(process.env.TEST_ROOT + '/calls', 'browser ' + process.argv.slice(2).join(' ') + '\\n')`,
  );
  write(
    'node_modules/playwright/index.js',
    `exports.chromium = { executablePath: () => process.env.TEST_ROOT + '/chrome' };`,
  );
  write(
    'node_modules/mongodb-memory-server-core/index.js',
    `exports.MongoBinary = {getPath: async () => { require('node:fs').appendFileSync(process.env.TEST_ROOT + '/calls', 'mongo-download\\n'); }};`,
  );
  write('chrome', '#!/bin/sh\nexit 0\n', 0o755);
  // A project-local runtime may live under root-only ancestors in a fallback host.
  if (uid !== process.getuid()) write('bin/node', fs.readFileSync(process.execPath), 0o755);
  const run = (script = 'setup.sh', extra = {}) => {
    const env = {
      ...process.env,
      HOME: path.join(root, 'home'),
      TEST_ROOT: root,
      PATH: `${root}/bin:${process.env.PATH}`,
      ...extra,
    };
    const command = ['bash', path.join(root, '.devcontainer', script)];
    return uid === process.getuid()
      ? spawnSync(command[0], command.slice(1), { cwd: root, env, encoding: 'utf8' })
      : spawnSync(
          'runuser',
          ['-u', 'vscode', '--', 'env', `HOME=${env.HOME}`, `PATH=${env.PATH}`, ...command],
          { cwd: root, env, encoding: 'utf8' },
        );
  };
  return { root, run, write, calls: () => fs.readFileSync(path.join(root, 'calls'), 'utf8') };
}

test('setup is repeatable and installs development dependencies before browser/Mongo downloads', (t) => {
  const f = fixture(t);
  for (let i = 0; i < 2; i++) assert.equal(f.run().status, 0);
  assert.equal(
    f.calls(),
    'ci --include=dev --no-audit --no-fund\nbrowser install chromium\nmongo-download\n'.repeat(2),
  );
});

test('a failed locked install stops before downloading or starting anything else', (t) => {
  const f = fixture(t);
  assert.equal(f.run('setup.sh', { TEST_INSTALL_EXIT: '42' }).status, 42);
  assert.equal(f.calls(), 'ci --include=dev --no-audit --no-fund\n');
});

test('runtime mismatch stops before npm ci', (t) => {
  const f = fixture(t);
  assert.equal(f.run('setup.sh', { TEST_NPM_VERSION: '0.0.0' }).status, 1);
  assert.equal(fs.existsSync(path.join(f.root, 'calls')), false);
  f.write('.nvmrc', '0.0.0');
  assert.equal(f.run().status, 1);
  assert.equal(fs.existsSync(path.join(f.root, 'calls')), false);
});

test(
  'mixed ownership fails without rewriting node_modules',
  { skip: process.getuid() !== 0 },
  (t) => {
    const f = fixture(t);
    fs.chownSync(path.join(f.root, 'node_modules'), 65534, 65534);
    assert.equal(f.run().status, 1);
    assert.equal(fs.statSync(path.join(f.root, 'node_modules')).uid, 65534);
    assert.equal(fs.existsSync(path.join(f.root, 'calls')), false);
  },
);

test('Lighthouse is loopback/memory-only and resolves the matching browser', (t) => {
  const f = fixture(t);
  const before = process.env.LIGHTHOUSE_CHROME_FLAGS;
  assert.equal(
    f.run('lighthouse.sh', {
      LIGHTHOUSE_CHROME_FLAGS: '',
      E2E_CHROMIUM_CHANNEL: 'chrome',
      E2E_BASE_URL: 'https://example.invalid',
    }).status,
    0,
  );
  const env = JSON.parse(fs.readFileSync(path.join(f.root, 'environment.json')));
  assert.equal(env.E2E_BASE_URL, 'http://127.0.0.1:3098');
  assert.equal(env.E2E_USE_MEMORY_MONGO, 'true');
  assert.equal(env.E2E_STREAM_STORE, 'memory');
  assert.equal(env.E2E_REPLICAS, '1');
  assert.equal(env.E2E_CHROMIUM_CHANNEL, undefined);
  assert.equal(env.CHROME_PATH, path.join(f.root, 'chrome'));
  assert.ok(env.LIGHTHOUSE_CHROME_FLAGS.includes('--disable-dev-shm-usage'));
  assert.equal(env.LIGHTHOUSE_CHROME_FLAGS.includes('--no-sandbox'), process.getuid() === 0);
  assert.equal(process.env.LIGHTHOUSE_CHROME_FLAGS, before);
});

test(
  'an inherited HOME owned by another user fails before installing',
  { skip: process.getuid() !== 0 },
  (t) => {
    const f = fixture(t);
    fs.chownSync(path.join(f.root, 'home'), 65534, 65534);
    assert.equal(f.run().status, 1);
    assert.equal(fs.statSync(path.join(f.root, 'home')).uid, 65534);
    assert.equal(fs.existsSync(path.join(f.root, 'calls')), false);
  },
);

test('a missing Chromium stops before launching the Lighthouse harness', (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'chrome'));
  assert.notEqual(f.run('lighthouse.sh').status, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'environment.json')), false);
});

test(
  'actual vscode execution owns its install and keeps the non-root sandbox',
  { skip: process.getuid() !== 0 },
  (t) => {
    const identity = spawnSync('id', ['-u', 'vscode'], { encoding: 'utf8' });
    if (identity.status !== 0) return t.skip('vscode user is not provisioned on this host');
    const gid = Number(spawnSync('id', ['-g', 'vscode'], { encoding: 'utf8' }).stdout.trim());
    const uid = Number(identity.stdout.trim());
    const f = fixture(t, uid, gid);
    const setup = f.run();
    assert.equal(setup.status, 0, setup.stderr);
    assert.equal(fs.statSync(path.join(f.root, 'calls')).uid, uid);
    const lighthouse = f.run('lighthouse.sh', { LIGHTHOUSE_CHROME_FLAGS: '' });
    assert.equal(lighthouse.status, 0, lighthouse.stderr);
    const env = JSON.parse(fs.readFileSync(path.join(f.root, 'environment.json')));
    assert.equal(env.LIGHTHOUSE_CHROME_FLAGS, '--disable-dev-shm-usage');
  },
);
