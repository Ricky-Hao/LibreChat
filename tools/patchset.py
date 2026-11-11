#!/usr/bin/env python3
"""Apply the manifest's ordered Git diffs and run contracts in an application checkout."""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACTIVE = {'keep', 'feature', 'local', 'awaiting-upstream'}
STATUSES = ACTIVE | {'upstream', 'replaced'}
TIERS = {'focused', 'types', 'browser', 'project'}


class Failure(Exception):
    pass


def require(condition, message):
    if not condition:
        raise Failure(message)


def inside(root, relative):
    path = Path(relative)
    require(not path.is_absolute() and '..' not in path.parts, f'Unsafe path: {relative}')
    resolved = (root / path).resolve()
    require(resolved.is_relative_to(root.resolve()), f'Path escapes checkout: {relative}')
    return resolved


def git(target, *args, env=None, data=None):
    result = subprocess.run(['git', '-C', str(target), *args], input=data,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if result.returncode:
        raise Failure(f'git {" ".join(args)} failed in {target}:\n'
                      + result.stderr.decode(errors='replace'))
    return result.stdout


def load_manifest(root=ROOT):
    manifest = json.loads((root / 'manifest.json').read_text())
    require(manifest['format'] == 1, 'Unsupported manifest format')
    require(re.fullmatch(r'[0-9a-f]{40}', manifest['base']), 'Base must be a full commit SHA')
    seen = set()
    for entry in manifest['patches']:
        name = entry['id']
        require(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', name), f'Invalid id: {name}')
        require(name not in seen, f'Duplicate id: {name}')
        require(entry['status'] in STATUSES, f'Unknown status: {name}')
        require(set(entry['depends_on']) <= seen, f'Missing or out-of-order dependency: {name}')
        require(entry['status'] not in ACTIVE or entry['patch'], f'Active patch missing: {name}')
        if entry['status'] not in ACTIVE:
            require(re.fullmatch(r'[0-9a-f]{40}', entry['replacement']['commit']),
                    f'Replacement commit missing: {name}')
            require(bool(entry['replacement']['evidence']), f'Replacement evidence missing: {name}')
        seen.add(name)
        if entry['patch']:
            require(inside(root, entry['patch']).is_file(), f'Payload missing: {name}')
        require(inside(root, f'patches/{name}/README.md').is_file(), f'Guide missing: {name}')
        contract = inside(root, entry['tests'])
        require(contract.is_file(), f'Test contract missing: {name}')
        checks = json.loads(contract.read_text())['checks']
        require(bool(checks), f'Empty test contract: {name}')
        for check in checks:
            validate_check(check)
    return manifest


def validate_check(check):
    require(bool(check['name']) and check['tier'] in TIERS, 'Invalid check name or tier')
    require(check['runner'] in {'jest', 'playwright', 'command'}, 'Unknown test runner')
    require(bool(check['requires']), f'No check entry paths: {check["name"]}')
    if check['runner'] in {'jest', 'playwright'}:
        require(bool(check['files']), f'No test files: {check["name"]}')
        require(set(check['files']) <= set(check['requires']), 'Test files must be required paths')
    else:
        require(isinstance(check['command'], list) and bool(check['command'])
                and all(isinstance(arg, str) and arg for arg in check['command']),
                f'Command must be a nonempty argument array: {check["name"]}')
    if check['runner'] == 'playwright':
        require(check['config'] in check['requires'], 'Playwright config must be a required path')


def select(manifest, only=None, statuses=None):
    entries = manifest['patches']
    known = {p['id']: p for p in entries}
    wanted = set(only) if only else {p['id'] for p in entries
                                    if not statuses or p['status'] in statuses}
    require(wanted <= known.keys(), f'Unknown patch ids: {sorted(wanted - known.keys())}')
    pending = list(wanted)
    while pending:
        for dependency in known[pending.pop()]['depends_on']:
            if dependency not in wanted:
                wanted.add(dependency)
                pending.append(dependency)
    require(bool(wanted), 'Selection is empty')
    return [p for p in entries if p['id'] in wanted]


def checkout(target):
    target = target.resolve()
    top = Path(git(target, 'rev-parse', '--show-toplevel').decode().strip()).resolve()
    require(top == target, '--target must name the application Git checkout root')
    return target


def clean_base(target, base):
    require(not git(target, 'status', '--porcelain', '--untracked-files=all'),
            f'Target has changes or untracked files: {target}; nothing applied. '
            'Repeated application is refused. Use a fresh checkout for a new selection.')
    head = git(target, 'rev-parse', 'HEAD').decode().strip()
    require(head == base, f'Target HEAD {head} differs from fixed base {base}; '
            'nothing applied. Adapt the patch set explicitly; the tool never changes base.')


def applicable(target, entries):
    result = []
    for entry in entries:
        if entry['status'] in ACTIVE:
            result.append(entry)
            continue
        commit = entry['replacement']['commit']
        git(target, 'merge-base', '--is-ancestor', commit, 'HEAD')
        print(f'SKIP {entry["id"]}: {entry["status"]}, included commit {commit}')
    return result


def payload(root, target, entry):
    path = inside(root, entry['patch'])
    stats = git(target, 'apply', '--numstat', '-z', str(path)).split(b'\0')
    paths = []
    for stat in filter(None, stats):
        _, _, name = stat.split(b'\t', 2)
        relative = name.decode()
        require('.git' not in Path(relative).parts, f'Git metadata in payload: {relative}')
        inside(target, relative)
        paths.append(relative)
    require(paths and len(paths) == len(set(paths)), f'Empty or duplicate diff paths: {entry["id"]}')
    require(set(paths) == set(entry['paths']), f'Payload path inventory differs: {entry["id"]}')
    return path.read_bytes()


def prepare(root, target, manifest, entries):
    clean_base(target, manifest['base'])
    entries = applicable(target, entries)
    # Preflight the entire sequence with a private index. A later conflict cannot
    # leave earlier patches in the user's index or working tree.
    git_dir = git(target, 'rev-parse', '--absolute-git-dir').decode().strip()
    with tempfile.TemporaryDirectory(prefix='patchset-', dir=git_dir) as temporary:
        env = {**os.environ, 'GIT_INDEX_FILE': str(Path(temporary) / 'index')}
        git(target, 'read-tree', manifest['base'], env=env)
        for entry in entries:
            try:
                git(target, 'apply', '--cached', '--binary', '--unidiff-zero', '--whitespace=nowarn', '-',
                    env=env, data=payload(root, target, entry))
            except Failure as error:
                raise Failure(f'Preflight stopped at {entry["id"]}. Target unchanged.\n{error}') from error
        result_tree = git(target, 'write-tree', env=env).decode().strip()
        combined = git(target, 'diff', '--binary', '--full-index', '--no-ext-diff',
                       '--no-renames', manifest['base'], result_tree)
    return entries, result_tree, combined


def apply(root, target, manifest, entries, write=False):
    entries, result_tree, combined = prepare(root, target, manifest, entries)
    if write and combined:
        clean_base(target, manifest['base'])
        git(target, 'apply', '--index', '--binary', '--whitespace=nowarn', '-', data=combined)
    action = 'APPLIED (staged)' if write else 'CHECKED (no application files changed)'
    print(f'{action}: {len(entries)} patches; tree {result_tree}')
    return result_tree


def contracts(root, target, entries, tier):
    checks = []
    seen = set()
    for entry in entries:
        contract = json.loads(inside(root, entry['tests']).read_text())
        for check in contract['checks']:
            validate_check(check)
            if tier != 'all' and check['tier'] != tier:
                continue
            key = json.dumps(check, sort_keys=True)
            if key in seen:
                continue
            seen.add(key)
            cwd = inside(target, check['cwd'])
            require(cwd.is_dir(), f'Check directory missing: {cwd}')
            for path in check['requires']:
                require(inside(target, path).is_file(), f'Test/check entry missing: {path}')
            checks.append(check)
    require(bool(checks), f'No checks in tier {tier}; nothing was run')
    return checks


def jest(target, check):
    cwd = inside(target, check['cwd'])
    executable = inside(target, 'node_modules/.bin/jest')
    require(executable.is_file(), 'Jest is not installed in target; run npm ci there first')
    files = [str(inside(target, path)) for path in check['files']]
    command = [str(executable), '--runInBand', '--coverage=false', '--runTestsByPath', *files]
    env = {**os.environ, 'NODE_ENV': 'test'}
    discovery = subprocess.run([*command, '--listTests', '--json'], cwd=cwd, env=env,
                               stdout=subprocess.PIPE, check=True)
    found = {str(Path(path).resolve()) for path in json.loads(discovery.stdout)}
    require(found == set(files), f'Jest did not discover all contracted files: {set(files) - found}')
    git_dir = git(target, 'rev-parse', '--absolute-git-dir').decode().strip()
    with tempfile.TemporaryDirectory(prefix='patchset-jest-', dir=git_dir) as temporary:
        report = Path(temporary) / 'results.json'
        subprocess.run([*command, '--json', f'--outputFile={report}'], cwd=cwd, env=env, check=True)
        result = json.loads(report.read_text())
        require(result['numPassedTests'] > 0 and result['numFailedTests'] == 0,
                'Jest returned no successful tests')
        require(result['numPendingTests'] == 0 and result['numTodoTests'] == 0,
                'PARTIAL: Jest skipped tests; the full contract did not pass')
        suites = result['testResults']
        require({str(Path(suite['name']).resolve()) for suite in suites} == set(files),
                'Jest result files differ from the contract')
        require(all(suite['status'] == 'passed' and suite['assertionResults'] for suite in suites),
                'Jest did not pass tests in every contracted file')


def playwright_specs(suites):
    for suite in suites:
        yield from suite.get('specs', [])
        yield from playwright_specs(suite.get('suites', []))


def playwright_files(report):
    require(not report.get('errors'), 'Playwright reported errors')
    root = Path(report['config']['rootDir'])
    specs = list(playwright_specs(report['suites']))
    require(specs and all(spec['tests'] for spec in specs), 'Playwright discovered no tests')
    return {str((root / spec['file']).resolve()) for spec in specs}


def playwright(target, check):
    executable = inside(target, 'node_modules/.bin/playwright')
    require(executable.is_file(), 'Playwright is not installed in target; run npm ci there first')
    files = {str(inside(target, path)) for path in check['files']}
    command = [str(executable), 'test', f'--config={inside(target, check["config"])}',
               '--workers=1', '--retries=0', '--forbid-only', '--reporter=json',
               *[re.escape(path) + '$' for path in sorted(files)]]
    cwd = inside(target, check['cwd'])
    env = {key: value for key, value in os.environ.items()
           if not key.startswith('PLAYWRIGHT_JSON_OUTPUT_')}
    git_dir = git(target, 'rev-parse', '--absolute-git-dir').decode().strip()
    with tempfile.TemporaryDirectory(prefix='patchset-playwright-', dir=git_dir) as temporary:
        listing = Path(temporary) / 'listing.json'
        env['PLAYWRIGHT_JSON_OUTPUT_FILE'] = str(listing)
        subprocess.run([*command, '--list'], cwd=cwd, env=env, check=True)
        require(playwright_files(json.loads(listing.read_text())) == files,
                'Playwright did not discover exactly the contracted files')
        report = Path(temporary) / 'results.json'
        env['PLAYWRIGHT_JSON_OUTPUT_FILE'] = str(report)
        subprocess.run(command, cwd=cwd, env=env, check=True)
        result = json.loads(report.read_text())
        require(playwright_files(result) == files, 'Playwright result files differ from the contract')
        stats = result['stats']
        require(stats['expected'] > 0 and stats['unexpected'] == 0, 'Playwright had no successful tests')
        require(stats['skipped'] == 0 and stats['flaky'] == 0,
                'PARTIAL: Playwright skipped or retried tests; the full contract did not pass')


def test(root, target, entries, tier='focused', plan=False):
    checks = contracts(root, target, entries, tier)
    for check in checks:
        print(f'{"NOT RUN" if plan else "RUN"}: {check["name"]} ({check["cwd"]})', flush=True)
        if plan:
            continue
        if check['runner'] == 'jest':
            jest(target, check)
        elif check['runner'] == 'playwright':
            playwright(target, check)
        else:
            subprocess.run(check['command'], cwd=inside(target, check['cwd']), check=True)
    if not plan:
        print(f'Completed {len(checks)} {tier} check commands; see runner output for scope.')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT, help=argparse.SUPPRESS)
    parser.add_argument('action', choices=['list', 'check', 'apply', 'test'])
    parser.add_argument('--target', type=Path)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument('--only', nargs='+', metavar='ID', help='include ids and their dependencies')
    selection.add_argument('--status', nargs='+', choices=sorted(STATUSES))
    parser.add_argument('--tier', choices=['focused', 'types', 'browser', 'project', 'all'], default='focused')
    parser.add_argument('--plan', action='store_true', help='validate test paths without running commands')
    args = parser.parse_args(argv)
    root = args.root.resolve()
    manifest = load_manifest(root)
    entries = select(manifest, args.only, args.status)
    if args.action == 'list':
        for entry in entries:
            print(f'{entry["id"]}\t{entry["status"]}\t'
                  f'deps={",".join(entry["depends_on"]) or "-"}\t{entry["patch"] or "no payload"}')
        return
    require(args.target is not None, '--target is required')
    target = checkout(args.target)
    require(target != root, 'Use an application checkout, not the patch repository')
    if args.action == 'test':
        test(root, target, entries, args.tier, args.plan)
    else:
        apply(root, target, manifest, entries, args.action == 'apply')


if __name__ == '__main__':
    try:
        main()
    except (Failure, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
