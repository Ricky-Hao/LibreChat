import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { expect, test } from '@playwright/test';
import type { LockEntry, Lockfile } from './registry.helpers';
import vendor from '../../../../vendor/agents.json';
import { inOneProject, repoRoot } from './lint.helpers';
import { offRegistry } from './registry.helpers';

const sdk = `node_modules/${vendor.name}`;
const lock = (): Lockfile =>
  JSON.parse(readFileSync(resolve(repoRoot, 'package-lock.json'), 'utf8')) as Lockfile;

test.describe('locked origin policy', () => {
  test.beforeEach(() => inOneProject());

  test('rejects other file, link, git and private origins', () => {
    for (const entry of [
      { resolved: `file:${vendor.artifact}` },
      { resolved: 'file:vendor/other.tgz' },
      { resolved: 'file:../other.tgz' },
      { resolved: 'link:vendor/other' },
      { resolved: 'git+https://github.com/example/package.git' },
      { resolved: 'http://registry.npmjs.org/package.tgz' },
      { resolved: 'https://mirror.internal/package.tgz' },
      { resolved: 'https://registry.npmjs.org.evil.test/package.tgz' },
      { resolved: 'https://user:password@registry.npmjs.org/package.tgz' },
      { resolved: 'https://' },
      { resolved: 'vendor/other', link: true },
      { resolved: 'packages/api', link: true },
      { resolved: '../outside', link: true },
    ]) {
      expect(offRegistry({ packages: { 'node_modules/other': entry } })).toEqual([
        `node_modules/other -> ${entry.resolved}`,
      ]);
    }
  });

  test('requires the exact root SDK resolution, version and integrity', () => {
    const head = lock();
    expect(offRegistry(head)).toEqual([]);
    for (const change of [
      { version: '4.0.4' },
      { integrity: undefined },
      { integrity: 'sha512-tampered' },
      { resolved: undefined },
      { resolved: 'https://registry.npmjs.org/@librechat/agents/-/agents-4.0.4.tgz' },
      { resolved: 'file:vendor/../vendor/librechat-agents-4.0.4-ricky.1.tgz' },
      { resolved: 'file:vendor/%2e%2e/librechat-agents-4.0.4-ricky.1.tgz' },
      { resolved: `file:${resolve(repoRoot, vendor.artifact)}` },
      { link: true },
    ] satisfies LockEntry[]) {
      const changed = structuredClone(head);
      Object.assign(changed.packages[sdk], change);
      expect(offRegistry(changed)).toContain(`${sdk} -> ${changed.packages[sdk].resolved}`);
    }
    const nested = structuredClone(head);
    nested.packages[`node_modules/other/${sdk}`] = { ...head.packages[sdk] };
    expect(offRegistry(nested)).toHaveLength(2);
    delete nested.packages[sdk];
    expect(offRegistry(nested)).toContain(`${sdk} -> undefined`);
    expect(offRegistry(nested)).toContain(
      `node_modules/other/${sdk} -> ${head.packages[sdk].resolved}`,
    );
    const unexpectedConsumer = structuredClone(head);
    unexpectedConsumer.packages['node_modules/other'] = {
      dependencies: { [vendor.name]: `file:${vendor.artifact}` },
    };
    expect(offRegistry(unexpectedConsumer)).toContain(`${sdk} -> ${head.packages[sdk].resolved}`);
  });

  test('validates consumers and rejects missing, symlinked or tampered archives', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'registry-policy-'));
    const head = lock();
    const artifact = resolve(root, vendor.artifact);
    const copyArchive = () => copyFileSync(resolve(repoRoot, vendor.artifact), artifact);
    const rejects = (changed = head) =>
      expect(offRegistry(changed, root)).toContain(`${sdk} -> ${head.packages[sdk].resolved}`);
    try {
      const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
        workspaces: string[];
      };
      const directories = Object.keys(head.packages).filter((key) => !key.includes('node_modules'));
      for (const directory of directories) {
        mkdirSync(resolve(root, directory), { recursive: true });
        copyFileSync(
          resolve(repoRoot, directory, 'package.json'),
          resolve(root, directory, 'package.json'),
        );
      }
      mkdirSync(resolve(root, 'vendor'));
      copyArchive();
      expect(offRegistry(head, root)).toEqual([]);
      for (const consumer of vendor.consumers) {
        const changed = structuredClone(head);
        for (const field of ['dependencies', 'peerDependencies'] as const) {
          if (changed.packages[consumer][field]?.[vendor.name]) {
            changed.packages[consumer][field][vendor.name] = '^4.0.4';
          }
        }
        rejects(changed);
        const manifestPath = resolve(root, consumer, 'package.json');
        const original = readFileSync(manifestPath);
        writeFileSync(manifestPath, '{"dependencies":{}}');
        rejects();
        writeFileSync(manifestPath, original);
      }
      const rootPath = resolve(root, 'package.json');
      const original = readFileSync(rootPath);
      writeFileSync(
        rootPath,
        JSON.stringify({ ...manifest, dependencies: { [vendor.name]: '^4.0.4' } }),
      );
      rejects();
      writeFileSync(rootPath, original);

      rmSync(artifact);
      rejects();
      symlinkSync(resolve(repoRoot, vendor.artifact), artifact);
      rejects();
      rmSync(artifact);
      rmSync(resolve(root, 'vendor'), { recursive: true });
      symlinkSync(resolve(repoRoot, 'vendor'), resolve(root, 'vendor'));
      rejects();
      rmSync(resolve(root, 'vendor'));
      mkdirSync(resolve(root, 'vendor'));
      writeFileSync(artifact, 'tampered archive');
      rejects();
      const tampered = structuredClone(head);
      tampered.packages[sdk].integrity =
        `sha512-${createHash('sha512').update(readFileSync(artifact)).digest('base64')}`;
      rejects(tampered);
      copyArchive();
      expect(offRegistry(head, root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
