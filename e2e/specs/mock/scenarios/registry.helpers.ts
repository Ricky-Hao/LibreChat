import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import vendor from '../../../../vendor/agents.json';
import { repoRoot } from './lint.helpers';

type Manifest = {
  name?: string;
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

/** Return unusable origins, preserving the original named diagnostic contract. */
export function offRegistry(head: Lockfile, root = repoRoot): string[] {
  const problems: string[] = [];
  let vendorValid: boolean | undefined;
  for (const [key, entry] of Object.entries(head.packages)) {
    if (entry.link && workspaceLink(key, entry, head, root)) continue;
    if (packageOf(key) === vendor.name) {
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
