"""Maintenance-tool tests with real Git repos and controlled runner processes."""
import contextlib
import copy
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import patchset


CLI = Path(__file__).with_name('patchset.py').resolve()


class PatchsetTests(unittest.TestCase):
    def setUp(self):
        work = CLI.parents[1] / '.work'
        work.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='tool-test-', dir=work)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'catalog'
        self.target = Path(self.temporary.name) / 'application'
        self.root.mkdir()
        self.target.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Patchset test')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.write('file.txt', 'base\n')
        self.write('.gitignore', 'node_modules/\n')
        self.write('client/check.spec.ts', '// runner fixture\n')
        self.write('browser.spec.ts', '// runner fixture\n')
        self.write('playwright.config.ts', '// runner fixture\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'base')
        self.base = self.git('rev-parse', 'HEAD').decode().strip()
        self.manifest = {'format': 1, 'base': self.base, 'patches': []}
        self.add_patch('first', 'base', 'first')
        self.add_patch('second', 'first', 'second', ['first'])
        self.save()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.target), *args],
                                       stderr=subprocess.PIPE)

    def write(self, path, text):
        destination = self.target / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(text)

    def add_patch(self, name, before, after, dependencies=None):
        directory = self.root / 'patches' / name
        directory.mkdir(parents=True)
        (directory / 'README.md').write_text(f'# {name}\n')
        (directory / 'changes.patch').write_text(
            'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n'
            f'@@ -1 +1 @@\n-{before}\n+{after}\n')
        entry = {'id': name, 'status': 'keep', 'depends_on': dependencies or [],
                 'patch': f'patches/{name}/changes.patch', 'paths': ['file.txt'],
                 'tests': f'patches/{name}/tests.json'}
        self.manifest['patches'].append(entry)
        self.set_checks(entry, [{'name': 'real command', 'tier': 'focused', 'cwd': '.',
                                'requires': ['file.txt'], 'runner': 'command',
                                'command': [sys.executable, '-c',
                                            "from pathlib import Path; assert Path('file.txt').is_file()"]}])
        return entry

    def set_checks(self, entry, checks):
        (self.root / entry['tests']).write_text(json.dumps({'checks': checks}))

    def save(self):
        (self.root / 'manifest.json').write_text(json.dumps(self.manifest))

    def cli(self, action, *args):
        return subprocess.run([sys.executable, str(CLI), '--root', str(self.root), action,
                               '--target', str(self.target), *args],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def assert_clean(self):
        self.assertEqual(self.git('status', '--porcelain'), b'')
        self.assertEqual((self.target / 'file.txt').read_text(), 'base\n')

    def test_selection_includes_transitive_dependencies_once_in_manifest_order(self):
        self.add_patch('third', 'second', 'third', ['second'])
        chosen = patchset.select(self.manifest, ['third', 'first', 'third'])
        self.assertEqual([p['id'] for p in chosen], ['first', 'second', 'third'])
        self.manifest['patches'][2]['status'] = 'local'
        self.assertEqual(patchset.select(self.manifest, statuses=['local']), chosen)
        with self.assertRaisesRegex(patchset.Failure, 'Unknown patch ids'):
            patchset.select(self.manifest, ['typo'])

    def test_check_preserves_target_and_apply_stages_complete_selection(self):
        result = self.cli('check', '--only', 'second')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_clean()
        result = self.cli('apply', '--only', 'second')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.target / 'file.txt').read_text(), 'second\n')
        self.assertEqual(self.git('show', ':file.txt'), b'second\n')
        self.assertEqual(self.git('rev-parse', 'HEAD').decode().strip(), self.base)
        duplicate = self.cli('apply')
        self.assertNotEqual(duplicate.returncode, 0)
        self.assertIn('Repeated application is refused', duplicate.stderr)
        self.assertEqual((self.target / 'file.txt').read_text(), 'second\n')

    def test_later_conflict_does_not_leave_earlier_changes(self):
        path = self.root / self.manifest['patches'][1]['patch']
        path.write_text(path.read_text().replace('-first\n', '-not-the-base\n'))
        result = self.cli('apply')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Preflight stopped at second', result.stderr)
        self.assert_clean()

    def test_dirty_tracked_and_untracked_files_are_preserved(self):
        for path in ('file.txt', 'untracked.txt'):
            with self.subTest(path=path):
                self.write(path, 'user work\n')
                result = self.cli('apply')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Target has changes', result.stderr)
                self.assertEqual((self.target / path).read_text(), 'user work\n')
                self.assertEqual(self.git('diff', '--cached'), b'')

    def test_wrong_base_is_refused_without_switching_head(self):
        self.git('commit', '--allow-empty', '-qm', 'different base')
        head = self.git('rev-parse', 'HEAD')
        result = self.cli('apply')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('differs from fixed base', result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD'), head)
        self.assert_clean()

    def test_inventory_mismatch_and_duplicate_ids_are_rejected(self):
        self.manifest['patches'][0]['paths'] = ['other.txt']
        self.save()
        result = self.cli('apply')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Payload path inventory differs', result.stderr)
        self.assert_clean()
        self.manifest['patches'].append(copy.deepcopy(self.manifest['patches'][0]))
        self.save()
        with self.assertRaisesRegex(patchset.Failure, 'Duplicate id'):
            patchset.load_manifest(self.root)

    def test_dependency_order_and_empty_contract_are_rejected(self):
        self.manifest['patches'].reverse()
        self.save()
        with self.assertRaisesRegex(patchset.Failure, 'out-of-order dependency'):
            patchset.load_manifest(self.root)
        self.manifest['patches'].reverse()
        self.set_checks(self.manifest['patches'][0], [])
        self.save()
        with self.assertRaisesRegex(patchset.Failure, 'Empty test contract'):
            patchset.load_manifest(self.root)

    def test_skip_requires_documented_replacement_in_selected_target(self):
        entry = self.manifest['patches'][0]
        entry.update(status='upstream', patch=None, paths=[],
                     replacement={'commit': self.base, 'evidence': 'reviewed base helper'})
        self.save()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(patchset.applicable(self.target, [entry]), [])
        entry['replacement']['evidence'] = ''
        self.save()
        with self.assertRaisesRegex(patchset.Failure, 'Replacement evidence missing'):
            patchset.load_manifest(self.root)
        entry['replacement'].update(commit='0' * 40, evidence='absent commit')
        with self.assertRaises(patchset.Failure):
            patchset.applicable(self.target, [entry])
        self.assert_clean()

    def test_plan_validates_entries_and_never_runs_commands(self):
        entry = self.manifest['patches'][0]
        check = {'name': 'must not execute', 'tier': 'focused', 'cwd': '.',
                 'requires': ['file.txt'], 'runner': 'command',
                 'command': [sys.executable, '-c', 'raise SystemExit(7)']}
        self.set_checks(entry, [check])
        result = self.cli('test', '--only', 'first', '--plan')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('NOT RUN', result.stdout)
        self.assertNotIn('Completed', result.stdout)
        check['requires'] = ['missing.spec.ts']
        self.set_checks(entry, [check])
        result = self.cli('test', '--only', 'first', '--plan')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('entry missing', result.stderr)

    def test_command_uses_application_cwd_and_propagates_failure(self):
        entry = self.manifest['patches'][0]
        check = {'name': 'cwd contract', 'tier': 'focused', 'cwd': 'client',
                 'requires': ['client/check.spec.ts'], 'runner': 'command',
                 'command': [sys.executable, '-c',
                             "from pathlib import Path; assert Path('check.spec.ts').is_file()"]}
        self.set_checks(entry, [check])
        self.assertEqual(self.cli('test', '--only', 'first').returncode, 0)
        check['command'] = [sys.executable, '-c', 'raise SystemExit(9)']
        self.set_checks(entry, [check])
        result = self.cli('test', '--only', 'first')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('Completed', result.stdout)
        result = self.cli('test', '--only', 'first', '--tier', 'browser')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('No checks in tier', result.stderr)

    def install_runner(self, name):
        # This external-process fixture exercises arguments, discovery and reports
        # without claiming to execute Jest/Playwright or any application tests.
        script = '''import json, os, re, sys
from pathlib import Path
args = sys.argv[1:]
root = Path.cwd()
while not (root / '.git').exists():
    root = root.parent
mode = (root / '.git/mode').read_text()
with (root / '.git/invocations').open('a') as log:
    log.write(json.dumps({'args': args, 'cwd': str(Path.cwd())}) + '\\n')
if mode == 'exit':
    sys.exit(4)
if 'playwright' in Path(sys.argv[0]).name:
    test = 'browser.spec.ts'
    assert re.escape(str(root / test)) + '$' in args
    report = {'config': {'rootDir': str(root)}, 'errors': [],
              'suites': [{'suites': [{'specs': [{'file': test, 'tests': [{}]}]}]}],
              'stats': {'expected': 1, 'unexpected': 0, 'skipped': 0, 'flaky': 0}}
    if mode == 'missing-discovery':
        report['suites'] = []
    if '--list' not in args:
        if mode == 'empty': report['stats']['expected'] = 0
        if mode == 'skipped': report['stats']['skipped'] = 1
        if mode == 'flaky': report['stats']['flaky'] = 1
        if mode == 'failed': report['stats']['unexpected'] = 1
        if mode == 'errors': report['errors'] = [{'message': 'fixture error'}]
    Path(os.environ['PLAYWRIGHT_JSON_OUTPUT_FILE']).write_text(json.dumps(report))
else:
    files = [arg for arg in args if arg.endswith('.spec.ts')]
    assert Path.cwd() == root / 'client'
    assert '--runInBand' in args and '--runTestsByPath' in args
    if '--listTests' in args:
        print(json.dumps([] if mode == 'missing-discovery' else files))
        sys.exit(0)
    report = {'numPassedTests': 1, 'numFailedTests': 0, 'numPendingTests': 0,
              'numTodoTests': 0, 'testResults': [
                  {'name': file, 'status': 'passed', 'assertionResults': [{}]} for file in files]}
    if mode == 'empty': report['numPassedTests'] = 0
    if mode == 'skipped': report['numPendingTests'] = 1
    if mode == 'todo': report['numTodoTests'] = 1
    if mode == 'failed': report['numFailedTests'] = 1
    if mode == 'empty-file': report['testResults'][0]['assertionResults'] = []
    destination = next(arg.split('=', 1)[1] for arg in args if arg.startswith('--outputFile='))
    if mode != 'missing-report': Path(destination).write_text(json.dumps(report))
'''
        path = self.target / 'node_modules/.bin' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f'#!{sys.executable}\n' + script)
        path.chmod(0o755)

    def test_jest_discovery_execution_reports_and_skips(self):
        self.install_runner('jest')
        self.set_checks(self.manifest['patches'][0], [
            {'name': 'Jest fixture', 'tier': 'focused', 'cwd': 'client', 'runner': 'jest',
             'requires': ['client/check.spec.ts'], 'files': ['client/check.spec.ts']}])
        for mode in ('pass', 'missing-discovery', 'empty', 'skipped', 'todo',
                     'failed', 'empty-file', 'missing-report', 'exit'):
            with self.subTest(mode=mode):
                self.write('.git/mode', mode)
                result = self.cli('test', '--only', 'first')
                self.assertEqual(result.returncode == 0, mode == 'pass', result.stderr)
                if mode != 'pass':
                    self.assertNotIn('Completed', result.stdout)

    def test_playwright_exact_patterns_discovery_reports_and_skips(self):
        self.install_runner('playwright')
        self.set_checks(self.manifest['patches'][0], [
            {'name': 'Playwright fixture', 'tier': 'browser', 'cwd': '.', 'runner': 'playwright',
             'requires': ['browser.spec.ts', 'playwright.config.ts'],
             'files': ['browser.spec.ts'], 'config': 'playwright.config.ts'}])
        for mode in ('pass', 'missing-discovery', 'empty', 'skipped', 'flaky', 'failed', 'errors', 'exit'):
            with self.subTest(mode=mode):
                self.write('.git/mode', mode)
                result = self.cli('test', '--only', 'first', '--tier', 'browser')
                self.assertEqual(result.returncode == 0, mode == 'pass', result.stderr)
                if mode != 'pass':
                    self.assertNotIn('Completed', result.stdout)

    def test_paths_cannot_escape_checkout(self):
        for path in ('../outside', '/absolute'):
            with self.assertRaises(patchset.Failure):
                patchset.inside(self.target, path)
        (self.target / 'escape').symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(patchset.Failure):
            patchset.inside(self.target, 'escape/manifest.json')


if __name__ == '__main__':
    unittest.main()
