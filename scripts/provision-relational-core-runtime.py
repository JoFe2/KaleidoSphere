#!/usr/bin/env python3
"""Install/verify exact official wheels in a task-private optional runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import sys
import urllib.parse
import urllib.request
import venv

REPOSITORY = Path(__file__).resolve().parents[1]
LOCK = REPOSITORY / 'contracts/dependencies/relational-core-worker-lock-v1.json'


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def snapshot(root):
    rows = {}
    for p in sorted(root.rglob('*')):
        relative = p.relative_to(root).as_posix()
        s = p.lstat()
        if stat.S_ISLNK(s.st_mode):
            require(relative in ['venv/bin/python', 'venv/bin/python3', 'venv/bin/python3.12', 'venv/lib64'], 'K06_RUNTIME_LINK_DENIED')
            rows[relative] = {'kind': 'symlink', 'target': os.readlink(p)}
        elif stat.S_ISREG(s.st_mode):
            rows[relative] = {'kind': 'file', 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'mode': stat.S_IMODE(s.st_mode)}
        else:
            require(stat.S_ISDIR(s.st_mode), 'K06_RUNTIME_SPECIAL_FILE_DENIED')
    return rows


def run(args):
    lock_bytes = LOCK.read_bytes()
    lock = json.loads(lock_bytes)
    lock_sha = hashlib.sha256(lock_bytes).hexdigest()
    require(lock['schemaVersion'] == 'kaleidosphere.dependencies/relational-core-worker-lock/v1', 'K06_RUNTIME_LOCK_DENIED')
    require(platform.python_version() == lock['pythonVersion'] and sys.platform == 'linux' and platform.machine() == 'x86_64', 'K06_RUNTIME_PYTHON_DENIED')
    require(len(lock['wheels']) == 4 and len({w['distribution'] for w in lock['wheels']}) == 4, 'K06_RUNTIME_LOCK_DENIED')
    root = Path(args.root).absolute()
    require(root.name == '.ks-relational-core-runtime' or re.fullmatch(r'[A-Za-z][A-Za-z0-9._-]{0,127}', root.name) is not None, 'K06_RUNTIME_ROOT_DENIED')
    require(len(root.parts) >= 3 and not root.is_symlink(), 'K06_RUNTIME_ROOT_DENIED')
    receipt = root / 'verified-runtime.json'
    if args.install:
        # Never replace a prior or partially installed root blindly.
        require(not root.exists(), 'K06_RUNTIME_ROOT_EXISTS')
        root.mkdir(mode=0o700, parents=True)
        wheels = root / 'wheels'
        wheels.mkdir(mode=0o700)
        for wheel in lock['wheels']:
            require(re.fullmatch(r'[A-Za-z0-9._-]+\.whl', wheel['filename']) is not None and re.fullmatch(r'[0-9a-f]{64}', wheel['sha256']) is not None, 'K06_RUNTIME_WHEEL_DENIED')
            url = urllib.parse.urlsplit(wheel['url'])
            require(url.scheme == 'https' and url.hostname == 'files.pythonhosted.org' and not url.username and not url.password, 'K06_RUNTIME_ORIGIN_DENIED')
            with urllib.request.urlopen(wheel['url'], timeout=45) as response:
                data = response.read(wheel['size'] + 1)
            require(len(data) == wheel['size'] and hashlib.sha256(data).hexdigest() == wheel['sha256'], 'K06_RUNTIME_WHEEL_HASH_DENIED')
            (wheels / wheel['filename']).write_bytes(data)
        requirements = root / 'exact-requirements.txt'
        requirements.write_text(''.join(w['distribution'] + '==' + w['version'] + ' --hash=sha256:' + w['sha256'] + '\n' for w in lock['wheels']))
        venv.EnvBuilder(with_pip=True, symlinks=True).create(root / 'venv')
        python = root / 'venv/bin/python'
        install = subprocess.run([str(python), '-I', '-B', '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--no-compile', '--no-index', '--find-links', str(wheels), '--require-hashes', '-r', str(requirements)], capture_output=True, text=True, timeout=180, env={'PATH': os.environ.get('PATH', ''), 'LANG': 'C.UTF-8'})
        (root / 'install.stdout').write_text(install.stdout)
        (root / 'install.stderr').write_text(install.stderr)
        require(install.returncode == 0, 'K06_RUNTIME_INSTALL_FAILED')
        names = [w['distribution'] for w in lock['wheels']]
        expected = {w['distribution']: w['version'] for w in lock['wheels']}
        code = 'import importlib.metadata as m,json,platform; print(json.dumps({"python":platform.python_version(),"packages":{n:m.version(n) for n in ' + repr(names) + '}}))'
        observed = subprocess.run([str(python), '-I', '-B', '-c', code], capture_output=True, text=True, timeout=30)
        require(observed.returncode == 0 and not observed.stderr, 'K06_RUNTIME_VERSION_DENIED')
        actual = json.loads(observed.stdout)
        require(actual['python'] == lock['pythonVersion'] and actual['packages'] == expected, 'K06_RUNTIME_VERSION_DENIED')
        files = snapshot(root)
        body = {'schemaVersion': 'kaleidosphere.dependencies/verified-relational-runtime/v1', 'sourceLockSha256': lock_sha, 'observed': actual, 'files': files, 'runtimeRoot': str(root), 'noGlobalInstallationOrRegistryChange': True}
        receipt.write_text(json.dumps(body, sort_keys=True, indent=2) + '\n')
        receipt.chmod(0o600)
    else:
        require(receipt.is_file() and not receipt.is_symlink(), 'K06_RUNTIME_RECEIPT_DENIED')
        body = json.loads(receipt.read_text())
        require(body['sourceLockSha256'] == lock_sha and body['runtimeRoot'] == str(root), 'K06_RUNTIME_BINDING_DENIED')
        current = snapshot(root)
        current.pop('verified-runtime.json', None)
        require(current == body['files'], 'K06_RUNTIME_BYTES_DENIED')
    return {'state': 'VERIFIED', 'lockSha256': lock_sha, 'python': body['observed']['python'], 'packages': body['observed']['packages'], 'managedEntries': len(body['files']), 'noGlobalInstallationOrRegistryChange': True}


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--install', action='store_true')
    group.add_argument('--verify', action='store_true')
    parser.add_argument('--root', default=str(REPOSITORY / '.ks-relational-core-runtime'))
    args = parser.parse_args()
    try:
        print(json.dumps(run(args)))
        return 0
    except Exception as error:
        code = str(error)
        print(json.dumps({'state': 'DENIED', 'reasonCode': code if re.fullmatch(r'K06_[A-Z0-9_]+', code) else 'K06_RUNTIME_SETUP_FAILED', 'partialSuccess': False}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
