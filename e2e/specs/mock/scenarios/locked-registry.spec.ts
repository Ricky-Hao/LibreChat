import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { LockEntry, Lockfile } from './registry.helpers';
import { inOneProject, repoRoot } from './lint.helpers';
import { offRegistry, PUBLIC_REGISTRY } from './registry.helpers';

/**
 * Every job on this pull request died in `npm ci`: the lockfile entries the stack
 * added resolved to a private mirror that no GitHub runner and no contributor can
 * reach. What a clean install needs is that each locked tarball comes from a host
 * this repository already installs from, and that the registry actually serves
 * it. Hosts are checked for the whole lockfile, with the declared, integrity-checked
 * repaired SDK archive as the sole file exception. Registry availability is
 * already exercised by this job's clean install.
 */

test.describe('the locked dependency set', () => {
  test('every locked package resolves from the public registry @scenario:every-locked-package-resolves-from-the-public-registry', () => {
    inOneProject();
    test.setTimeout(180_000);

    const head = JSON.parse(
      readFileSync(resolve(repoRoot, 'package-lock.json'), 'utf8'),
    ) as Lockfile;
    const entries = Object.entries(head.packages);
    expect(entries.length).toBeGreaterThan(0);
    expect(
      offRegistry(head),
      'a locked tarball outside the public registry cannot be installed in CI',
    ).toEqual([]);

    /** And what that rule actually says, on lockfiles written for the purpose:
     *  the CDN belongs to `xlsx` and to no one else, at any version. */
    const at = (host: string, version: string): LockEntry => ({
      resolved: `https://${host}/package.tgz`,
      version,
    });
    const locked: Lockfile = {
      packages: {
        'node_modules/xlsx': at('cdn.sheetjs.com', '0.20.0'),
        'node_modules/lodash': at(PUBLIC_REGISTRY, '4.17.21'),
      },
    };
    expect(
      offRegistry({
        packages: { ...locked.packages, 'node_modules/xlsx': at('cdn.sheetjs.com', '0.20.3') },
      }),
      'upgrading xlsx on its own CDN is not a new vendor host',
    ).toEqual([]);
    expect(
      offRegistry({
        packages: { ...locked.packages, 'node_modules/lodash': at('cdn.sheetjs.com', '4.17.21') },
      }),
      'a package rewritten onto the CDN at the same version passed',
    ).toEqual(['node_modules/lodash -> https://cdn.sheetjs.com/package.tgz']);
    expect(
      offRegistry({
        packages: { ...locked.packages, 'node_modules/new': at('mirror.internal', '1.0.0') },
      }),
      'a package added from a private mirror passed',
    ).toEqual(['node_modules/new -> https://mirror.internal/package.tgz']);
    expect(
      offRegistry({
        packages: {
          ...locked.packages,
          'node_modules/a/node_modules/xlsx': at('cdn.sheetjs.com', '0.20.3'),
        },
      }),
      'a nested xlsx on its own CDN is the same package',
    ).toEqual([]);

    /** A declared dependency with no entry of its own is the other way a clean
     *  install reaches the network: `npm ci` would resolve it live. */
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    const unlocked = declared.filter(
      (name) => !head.packages[`node_modules/${name}`] && !head.packages[name],
    );
    expect(
      unlocked,
      'a declared dependency has no lockfile entry; npm ci would resolve it live',
    ).toEqual([]);

    /** Deliberately no request to the registry: whether it serves these tarballs
     *  today is what `npm ci` in this very job already proved, and a 429 from a
     *  rate limit would otherwise fail a pull request that changed none of this.
     *  What the lockfile says is what this scenario owns. */
  });
});
