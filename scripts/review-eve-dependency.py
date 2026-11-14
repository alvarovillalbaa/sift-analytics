"""Task-owned public CI only: resolve, audit, qualify exact locked source, clean."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

repo = Path.cwd()
out = Path(os.environ['AUDIT_OUTPUT_DIR'])
out.mkdir()
task = Path(tempfile.mkdtemp(prefix='sift-eve-', dir=os.environ['RUNNER_TEMP']))
owned_dirs = ['node_modules', '.next', '.eve', '.output', '.vercel', 'public/duckdb']
owned_files = ['tsconfig.tsbuildinfo']
assert all(not (repo / name).exists() for name in owned_dirs + owned_files), 'Checkout already has unowned outputs'
next_env = (repo / 'next-env.d.ts').read_bytes()
manifest = (repo / 'package.json').read_bytes()
original_lock = (repo / 'package-lock.json').read_bytes()
env = {**os.environ, 'npm_config_cache': str(task / 'cache'), 'npm_config_userconfig': str(task / 'empty.npmrc'), 'npm_config_registry': 'https://registry.npmjs.org/'}
(task / 'empty.npmrc').write_text('')
(task / 'package.json').write_bytes(manifest)
(task / 'package-lock.json').write_bytes(original_lock)
(out / 'package.json').write_bytes(manifest)
receipt = {'source': os.environ['GITHUB_SHA'], 'node': subprocess.check_output(['node', '--version'], text=True).strip(), 'npm': subprocess.check_output(['npm', '--version'], text=True).strip(), 'commands': [], 'cleanup': False, 'qualified': False}


def run(name, args, cwd=repo, timeout=180):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, timeout=timeout)
    (out / (name + '.stdout')).write_bytes(result.stdout)
    (out / (name + '.stderr')).write_bytes(result.stderr)
    receipt['commands'].append({'name': name, 'argv': args, 'exitCode': result.returncode, 'stdoutSha256': hashlib.sha256(result.stdout).hexdigest(), 'stderrSha256': hashlib.sha256(result.stderr).hexdigest()})
    print(name, result.returncode, flush=True)
    return result


try:
    assert run('resolve', ['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], task).returncode == 0
    lock = (task / 'package-lock.json').read_bytes()
    (out / 'package-lock.json').write_bytes(lock)
    receipt['lockSha256'] = hashlib.sha256(lock).hexdigest()
    old_graph = json.loads(original_lock)['packages']
    graph = json.loads(lock)['packages']
    changed = [key for key in sorted(old_graph.keys() | graph.keys()) if key and old_graph.get(key) != graph.get(key)]
    receipt['changedPackageNodes'] = changed
    assert set(changed) <= {'node_modules/eve', 'node_modules/eve/node_modules/undici'}, 'Unrelated graph drift'
    assert graph['node_modules/eve']['version'] == '0.88.1'
    assert graph['node_modules/eve/node_modules/undici']['version'] == '8.12.3'
    audit = run('audit', ['npm', 'audit', '--json', '--package-lock-only', '--ignore-scripts'], task)
    report = json.loads(audit.stdout)
    assert report.get('auditReportVersion') == 2 and not report.get('error')
    receipt['vulnerabilities'] = report['metadata']['vulnerabilities']
    assert audit.returncode == 0 and receipt['vulnerabilities']['total'] == 0
    receipt['sourceLockMatchesResolved'] = original_lock == lock
    if original_lock == lock:
        assert run('source-before', ['node', 'tests/support/source-manifest.mjs', str(out / 'source-before.json')]).returncode == 0
        for name, args in [
            ('ci', ['npm', 'ci', '--no-audit', '--no-fund']),
            ('migration', ['node', '--test', '--test-reporter=tap', 'tests/unit/chat-archive.test.mjs', 'tests/unit/agent-channel.test.mjs', 'tests/unit/chat-component.test.mjs', 'tests/unit/session-usage.test.mjs']),
            ('check', ['npm', 'run', 'check']),
            ('build', ['npm', 'run', 'build']),
        ]:
            assert run(name, args, timeout=360).returncode == 0, name + ' failed'
        assert (repo / 'package-lock.json').read_bytes() == lock
        receipt['qualified'] = True
    else:
        print('Generated lock retained; exact committed-lock qualification is pending.', flush=True)
finally:
    generated = (repo / 'next-env.d.ts').read_bytes()
    receipt['generatedNextEnvChanged'] = generated != next_env
    if generated != next_env:
        (out / 'next-env.generated.txt').write_bytes(generated)
        (repo / 'next-env.d.ts').write_bytes(next_env)
    for name in owned_dirs:
        if (repo / name).exists():
            shutil.rmtree(repo / name)
    for name in owned_files:
        if (repo / name).exists():
            (repo / name).unlink()
    shutil.rmtree(task)
    receipt['cleanup'] = not task.exists() and all(not (repo / name).exists() for name in owned_dirs + owned_files)
    receipt['sourceUnchanged'] = subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--']).returncode == 0
    receipt['endedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if receipt['qualified']:
        result = run('source-after', ['node', 'tests/support/source-manifest.mjs', str(out / 'source-after.json')])
        receipt['sourceManifestsMatch'] = result.returncode == 0 and (out / 'source-before.json').read_bytes() == (out / 'source-after.json').read_bytes()
        receipt['qualified'] = receipt['sourceManifestsMatch']
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    if receipt['sourceLockMatchesResolved'] and all(command['exitCode'] == 0 for command in receipt['commands']):
        assert receipt['qualified']
    assert receipt['cleanup'] and receipt['sourceUnchanged']
