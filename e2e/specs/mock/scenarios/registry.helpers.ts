import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import vendor from '../../../../vendor/agents.json';
import code from '../../../../vendor/code/package.json';
import { repoRoot } from './lint.helpers';

type Manifest = {
  name?: string;
  version?: string;
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
export type LockEntry = Manifest & {
  resolved?: string;
  integrity?: string;
  version?: string;
  link?: boolean;
};
export type Lockfile = { packages: Record<string, LockEntry> };

export const PUBLIC_REGISTRY = 'registry.npmjs.org';
const INHERITED_HOST_OF: Record<string, string> = { xlsx: 'cdn.sheetjs.com' };
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;
const packageOf = (key: string): string => key.split('node_modules/').pop() ?? key;
const manifestAt = (root: string, directory: string): Manifest =>
  JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8')) as Manifest;

/** The root declares exact directories and single-level workspace globs. */
function workspaces(root: string, manifest: Manifest): string[] {
  return (manifest.workspaces ?? []).flatMap((pattern) => {
    if (!pattern.endsWith('/*')) return [pattern];
    const directory = pattern.slice(0, -2);
    return readdirSync(resolve(root, directory), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${directory}/${entry.name}`);
  });
}

/** Only the reviewed root SDK archive and its declared consumers earn a file exception.
 * Hash once per policy invocation; never load the SDK or spawn its export verifier. */
function validVendor(head: Lockfile, root: string): boolean {
  const key = `node_modules/${vendor.name}`;
  const entry = head.packages[key];
  if (
    !entry ||
    entry.link ||
    entry.version !== vendor.version ||
    entry.resolved !== `file:${vendor.artifact}` ||
    Object.keys(head.packages).filter((name) => packageOf(name) === vendor.name).length !== 1
  ) {
    return false;
  }
  try {
    const rootManifest = manifestAt(root, '');
    const consumers = new Set<string>();
    for (const directory of ['', ...workspaces(root, rootManifest)]) {
      const manifest = directory === '' ? rootManifest : manifestAt(root, directory);
      const locked = head.packages[directory];
      for (const field of dependencyFields) {
        const declared = manifest[field]?.[vendor.name];
        const pinned = locked?.[field]?.[vendor.name];
        if (declared === undefined && pinned === undefined) continue;
        if (
          !vendor.consumers.includes(directory) ||
          declared !==
            `file:${relative(resolve(root, directory), resolve(root, vendor.artifact))}` ||
          pinned !== declared
        ) {
          return false;
        }
        consumers.add(directory);
      }
    }
    if (consumers.size !== vendor.consumers.length) return false;
    for (const [directory, locked] of Object.entries(head.packages)) {
      if (
        !vendor.consumers.includes(directory) &&
        dependencyFields.some((field) => locked[field]?.[vendor.name])
      ) {
        return false;
      }
    }
    // Exact spelling above excludes traversal; lstat excludes both directory and archive symlinks.
    if (!lstatSync(resolve(root, 'vendor')).isDirectory()) return false;
    if (!lstatSync(resolve(root, vendor.artifact)).isFile()) return false;
    const archive = readFileSync(resolve(root, vendor.artifact));
    return (
      createHash('sha256').update(archive).digest('hex') === vendor.sha256 &&
      entry.integrity === `sha512-${createHash('sha512').update(archive).digest('base64')}`
    );
  } catch {
    return false;
  }
}

function workspaceLink(key: string, entry: LockEntry, head: Lockfile, root: string): boolean {
  try {
    const directory = entry.resolved;
    if (!directory || !workspaces(root, manifestAt(root, '')).includes(directory)) return false;
    return (
      head.packages[directory] !== undefined &&
      key === `node_modules/${manifestAt(root, directory).name}`
    );
  } catch {
    return false;
  }
}

/** Upstream vendors only the browser enrollment protocol, pinned to its source digest. */
function validCodeVendor(head: Lockfile, root: string): boolean {
  try {
    const entry = head.packages[`node_modules/${code.name}`];
    if (
      !entry?.link ||
      entry.resolved !== 'vendor/code' ||
      head.packages['vendor/code']?.version !== code.version ||
      Object.keys(head.packages).filter((key) => packageOf(key) === code.name).length !== 1
    )
      return false;
    for (const directory of ['', ...workspaces(root, manifestAt(root, ''))]) {
      const manifest = manifestAt(root, directory);
      for (const field of dependencyFields) {
        const expected =
          directory === 'packages/api' && field === 'dependencies'
            ? 'file:../../vendor/code'
            : undefined;
        if (
          manifest[field]?.[code.name] !== expected ||
          head.packages[directory]?.[field]?.[code.name] !== expected
        )
          return false;
      }
    }
    if (
      Object.entries(head.packages).some(
        ([directory, locked]) =>
          directory !== 'packages/api' &&
          dependencyFields.some((field) => locked[field]?.[code.name]),
      )
    )
      return false;
    if (
      !lstatSync(resolve(root, 'vendor')).isDirectory() ||
      !lstatSync(resolve(root, 'vendor/code')).isDirectory()
    )
      return false;
    for (const file of [
      'package.json',
      'browser-enrollment-protocol.ts',
      'browser-enrollment-protocol.js',
    ]) {
      if (!lstatSync(resolve(root, 'vendor/code', file)).isFile()) return false;
    }
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'vendor/code/package.json'), 'utf8'),
    ) as typeof code;
    if (JSON.stringify(manifest) !== JSON.stringify(code)) return false;
    const source = readFileSync(
      resolve(root, 'vendor/code/browser-enrollment-protocol.ts'),
      'utf8',
    );
    return (
      createHash('sha256').update(source).digest('hex') === code.librechatUpstream.sha256 &&
      readFileSync(resolve(root, 'vendor/code/browser-enrollment-protocol.js'), 'utf8') ===
        stripTypeScriptTypes(source).replace(/[ \t]+$/gm, '')
    );
  } catch {
    return false;
  }
}

/** Return unusable origins, preserving the original named diagnostic contract. */
export function offRegistry(head: Lockfile, root = repoRoot): string[] {
  const problems: string[] = [];
  let vendorValid: boolean | undefined;
  let codeValid: boolean | undefined;
  for (const [key, entry] of Object.entries(head.packages)) {
    if (entry.link && workspaceLink(key, entry, head, root)) continue;
    if (packageOf(key) === code.name) {
      codeValid ??= validCodeVendor(head, root);
      if (key === `node_modules/${code.name}` && codeValid) continue;
    } else if (packageOf(key) === vendor.name) {
      vendorValid ??= validVendor(head, root);
      if (key === `node_modules/${vendor.name}` && vendorValid) continue;
      // The declared SDK must not silently revert to the stock registry package.
    } else if (!entry.link && !entry.resolved) {
      continue;
    } else if (!entry.link && entry.resolved?.startsWith('https://')) {
      try {
        const url = new URL(entry.resolved);
        if (
          !url.username &&
          !url.password &&
          (url.host === PUBLIC_REGISTRY || INHERITED_HOST_OF[packageOf(key)] === url.host)
        ) {
          continue;
        }
      } catch {
        // Malformed URLs are reported alongside other unusable origins.
      }
    }
    problems.push(`${key} -> ${entry.resolved}`);
  }
  if (
    !head.packages[`node_modules/${code.name}`] &&
    head.packages['packages/api']?.dependencies?.[code.name]
  ) {
    problems.push(`node_modules/${code.name} -> undefined`);
  }
  if (
    !head.packages[`node_modules/${vendor.name}`] &&
    vendor.consumers.some((consumer) => {
      const entry = head.packages[consumer];
      return dependencyFields.some((field) => entry?.[field]?.[vendor.name]);
    })
  ) {
    problems.push(`node_modules/${vendor.name} -> undefined`);
  }
  return problems;
}
