#!/usr/bin/env python3
"""Owned synthetic MariaDB fixture for the required optional-worker CI lane."""
import argparse
from decimal import Decimal
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import pymysql

REPOSITORY = Path(__file__).resolve().parents[1]
LOCK = REPOSITORY / 'contracts/dependencies/relational-core-worker-lock-v1.json'


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError('K06_NATIVE_FIXTURE_COMMAND_FAILED')
    return result.stdout.strip()


def inspect(kind, name):
    return json.loads(command(['docker', kind, 'inspect', name]))[0]


def save(file, data):
    file.write_text(json.dumps(data, indent=2) + '\n')
    file.chmod(0o600)


def start(root):
    if root.exists() or root.is_symlink():
        raise RuntimeError('K06_NATIVE_FIXTURE_ROOT_EXISTS')
    root.mkdir(mode=0o700, parents=True)
    nonce = 'ks288-' + secrets.token_hex(8)
    state_file = root / 'owned-state.json'
    state = {'nonce': nonce, 'state': 'CREATING', 'network': None, 'container': None}
    save(state_file, state)
    lock = json.loads(LOCK.read_text())
    image_ref = lock['server']['image']
    command(['docker', 'pull', '--platform', 'linux/amd64', image_ref])
    image = inspect('image', image_ref)
    if image['Architecture'] != 'amd64' or image['Os'] != 'linux':
        raise RuntimeError('K06_NATIVE_FIXTURE_IMAGE_DENIED')
    network_name = nonce + '-private'
    state['network'] = command(['docker', 'network', 'create', '--internal', '--label', 'ks.owner=' + nonce, network_name])
    save(state_file, state)
    private = root / 'secrets'
    private.mkdir(mode=0o700)
    password_files = {}
    for name in ['maria-owner', 'maria-reader']:
        file = private / name
        file.write_text(secrets.token_hex(24))
        file.chmod(0o600)
        password_files[name] = str(file)
    container_name = nonce + '-mariadb'
    state['container'] = command(['docker', 'run', '-d', '--platform', 'linux/amd64', '--name', container_name, '--network', network_name, '--label', 'ks.owner=' + nonce, '--label', 'ks.issue=288', '--mount', 'type=bind,src=' + password_files['maria-owner'] + ',dst=/run/secrets/ks288-root,readonly', '-e', 'MARIADB_ROOT_PASSWORD_FILE=/run/secrets/ks288-root', '-e', 'MARIADB_DATABASE=ks288', image_ref])
    save(state_file, state)
    actual = inspect('container', state['container'])
    if actual['Config']['Labels'].get('ks.owner') != nonce or actual['Image'] != image['Id'] or not actual['State']['Running']:
        raise RuntimeError('K06_NATIVE_FIXTURE_CONTAINER_DENIED')
    network = actual['NetworkSettings']['Networks'][network_name]
    host = network['IPAddress']
    if not host or any(actual['NetworkSettings']['Ports'].values()):
        raise RuntimeError('K06_NATIVE_FIXTURE_NETWORK_DENIED')
    owner = Path(password_files['maria-owner']).read_text()
    reader = Path(password_files['maria-reader']).read_text()
    con = None
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            con = pymysql.connect(host=host, port=3306, user='root', password=owner, database='ks288', connect_timeout=1, read_timeout=2, autocommit=True)
            break
        except (pymysql.Error, OSError):
            latest = inspect('container', state['container'])
            if not latest['State']['Running'] or latest['State'].get('OOMKilled'):
                raise RuntimeError('K06_NATIVE_FIXTURE_SERVER_STOPPED')
            time.sleep(0.5)
    if con is None:
        raise RuntimeError('K06_NATIVE_FIXTURE_REAL_TCP_NOT_READY')
    try:
        with con.cursor() as q:
            q.execute('SELECT VERSION()')
            version_row = q.fetchone()
            if version_row is None or version_row[0] != lock['server']['version']:
                raise RuntimeError('K06_NATIVE_FIXTURE_SERVER_VERSION_DENIED')
            q.execute('CREATE TABLE accounts(tenant INTEGER NOT NULL,id INTEGER NOT NULL,label VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,PRIMARY KEY(tenant,id))')
            q.execute('CREATE TABLE payments(tenant INTEGER NOT NULL,id INTEGER NOT NULL,account_id INTEGER NOT NULL,amount DECIMAL(20,4) NULL,label VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,PRIMARY KEY(tenant,id),CONSTRAINT payments_account FOREIGN KEY(tenant,account_id) REFERENCES accounts(tenant,id))')
            q.executemany('INSERT INTO accounts VALUES(%s,%s,%s)', [(1, 1, 'a'), (1, 2, 'A')])
            q.executemany('INSERT INTO payments VALUES(%s,%s,%s,%s,%s)', [(1, 10, 1, Decimal('1234567890123456.1234'), 'a'), (1, 11, 2, Decimal('0.0001'), 'A'), (1, 12, 2, None, 'a')])
            q.execute("CREATE USER 'ks288_reader'@'%%' IDENTIFIED BY %s", (reader,))
            q.execute("GRANT SELECT ON ks288.* TO 'ks288_reader'@'%'")
            q.execute('SELECT COUNT(*),COUNT(amount),COUNT(DISTINCT label),SUM(amount) FROM payments')
            result = q.fetchone()
            if result is None or result[:3] != (3, 2, 2) or str(result[3]) != '1234567890123456.1235':
                raise RuntimeError('K06_NATIVE_FIXTURE_ORACLE_DENIED')
    finally:
        con.close()
    missing = root / 'missing-driver-runtime'
    command([sys.executable, '-m', 'venv', '--without-pip', str(missing)])
    cfg = {'servers': {'mariadb': {'container': state['container'], 'name': container_name, 'imageRef': image_ref, 'imageId': image['Id'], 'host': host, 'port': 3306, 'database': 'ks288', 'publicPorts': []}}, 'secrets': password_files, 'missingDriverPython': str(missing / 'bin/python'), 'source': str(REPOSITORY), 'declaredSyntheticOnly': True}
    save(root / 'config.json', cfg)
    state.update({'state': 'READY', 'config': str(root / 'config.json'), 'actualRealTCPAndOracle': True})
    save(state_file, state)
    return {'state': 'READY', 'owner': nonce, 'config': str(root / 'config.json'), 'actualRealTCPAndOracle': True, 'noPublishedPortsOrProductionMutation': True}


def cleanup(root):
    state = json.loads((root / 'owned-state.json').read_text())
    already_removed = state['state'] in ['CLEANED_EXACT_IDS_ABSENT', 'CLEANED_EXACT_IDS_AND_SECRETS_ABSENT']
    if not already_removed:
        if state['container']:
            actual = inspect('container', state['container'])
            if actual['Config']['Labels'].get('ks.owner') != state['nonce']:
                raise RuntimeError('K06_NATIVE_FIXTURE_CLEANUP_OWNER_DENIED')
            command(['docker', 'rm', '-f', state['container']])
        if state['network']:
            actual = inspect('network', state['network'])
            if actual['Labels'].get('ks.owner') != state['nonce'] or actual.get('Containers'):
                raise RuntimeError('K06_NATIVE_FIXTURE_CLEANUP_NETWORK_DENIED')
            command(['docker', 'network', 'rm', state['network']])
    for kind, identifier in [('container', state['container']), ('network', state['network'])]:
        if identifier:
            result = subprocess.run(['docker', kind, 'inspect', identifier], capture_output=True, timeout=30)
            if result.returncode == 0:
                raise RuntimeError('K06_NATIVE_FIXTURE_CLEANUP_READBACK_FAILED')
    private = root / 'secrets'
    if private.is_symlink():
        raise RuntimeError('K06_NATIVE_FIXTURE_SECRET_PATH_DENIED')
    if private.exists():
        for name in ['maria-owner', 'maria-reader']:
            file = private / name
            if file.is_symlink() or (file.exists() and not file.is_file()):
                raise RuntimeError('K06_NATIVE_FIXTURE_SECRET_PATH_DENIED')
            if file.exists():
                file.unlink()
        if list(private.iterdir()):
            raise RuntimeError('K06_NATIVE_FIXTURE_SECRET_RESIDUE_DENIED')
        private.rmdir()
    state['state'] = 'CLEANED_EXACT_IDS_AND_SECRETS_ABSENT'
    save(root / 'owned-state.json', state)
    return {'state': state['state'], 'exactOwnedContainerAndNetworkAbsent': True, 'taskGeneratedCredentialFilesAbsent': True, 'foreignResourcesModified': False}


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--start', action='store_true')
    group.add_argument('--cleanup', action='store_true')
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    root = Path(args.root).absolute()
    try:
        print(json.dumps(start(root) if args.start else cleanup(root)))
        return 0
    except Exception as error:
        code = str(error)
        print(json.dumps({'state': 'DENIED', 'reasonCode': code if code.startswith('K06_') else 'K06_NATIVE_FIXTURE_SETUP_FAILED', 'partialStatePreserved': True, 'notProductCapabilityPass': True}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
