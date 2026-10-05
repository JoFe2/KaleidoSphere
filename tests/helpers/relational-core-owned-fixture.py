"""Owned synthetic fixture mutation only; never part of worker execution."""
import json
import os
import pathlib
import subprocess
import sys
import pymysql
cfg = json.loads(pathlib.Path(sys.argv[1]).read_text())
server = cfg['servers']['mariadb']
actual = json.loads(subprocess.run(['docker', 'inspect', server['container']], check=True, capture_output=True, text=True).stdout)[0]
assert actual['Config']['Labels']['ks.owner'] == os.environ['KS288_TEST_OWNER']
assert actual['Image'] == server['imageId'] and actual['State']['Running']
assert server['host'] in [n['IPAddress'] for n in actual['NetworkSettings']['Networks'].values()]
assert not any(actual['NetworkSettings']['Ports'].values())
password = pathlib.Path(cfg['secrets']['maria-owner']).read_text().strip()
operations = {
    'add-column': 'ALTER TABLE ks288.payments ADD COLUMN ks288_added_after_approval INTEGER',
    'drop-column': 'ALTER TABLE ks288.payments DROP COLUMN ks288_added_after_approval',
    'change-decimal': 'ALTER TABLE ks288.payments MODIFY amount DECIMAL(21,5) NULL',
    'restore-decimal': 'ALTER TABLE ks288.payments MODIFY amount DECIMAL(20,4) NULL',
    'change-collation': 'ALTER TABLE ks288.payments MODIFY label VARCHAR(16) COLLATE utf8mb4_general_ci NOT NULL',
    'restore-collation': 'ALTER TABLE ks288.payments MODIFY label VARCHAR(16) COLLATE utf8mb4_bin NOT NULL',
}
assert sys.argv[2] in operations or sys.argv[2] in ['clean-abandoned-own-reader', 'hold-write-lock', 'check-waiting-reader', 'check-no-reader-residue']
con = pymysql.connect(host=server['host'], port=server['port'], user='root', password=password, database='ks288', autocommit=True)
try:
    with con.cursor() as q:
        if sys.argv[2] == 'hold-write-lock':
            q.execute('LOCK TABLES ks288.payments WRITE')
            print(json.dumps({'exactOwnWriteLock': True}), flush=True)
            try:
                assert sys.stdin.readline().strip() == 'release'
            finally:
                q.execute('UNLOCK TABLES')
            print(json.dumps({'released': True}), flush=True)
            sys.exit(0)
        if sys.argv[2] == 'check-waiting-reader':
            q.execute("SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='ks288_reader' AND DB='ks288' AND COMMAND='Query' AND STATE LIKE '%lock%'")
            print(json.dumps({'waitingOwnReaderQueries': q.fetchone()[0]}))
            sys.exit(0)
        if sys.argv[2] == 'check-no-reader-residue':
            q.execute("SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='ks288_reader' AND DB='ks288'")
            count = q.fetchone()[0]
            assert count == 0, 'Own worker reader connection residue'
            print(json.dumps({'actualOwnReaderConnections': count}))
            sys.exit(0)
        if sys.argv[2] == 'clean-abandoned-own-reader':
            cid = int(sys.argv[3])
            q.execute("SELECT ID FROM information_schema.PROCESSLIST WHERE ID=%s AND USER='ks288_reader' AND DB='ks288' AND INFO='SELECT SLEEP(10)'", (cid,))
            if q.fetchone():
                q.execute('KILL QUERY %s', (cid,))
            print(json.dumps({'exactOwnReaderCleanup': True}))
            sys.exit(0)
        q.execute(operations[sys.argv[2]])
        if 'decimal' in sys.argv[2]:
            q.execute("SELECT NUMERIC_PRECISION,NUMERIC_SCALE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='ks288' AND TABLE_NAME='payments' AND COLUMN_NAME='amount'")
            assert q.fetchone() == ((21, 5) if sys.argv[2] == 'change-decimal' else (20, 4))
        elif 'collation' in sys.argv[2]:
            q.execute("SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='ks288' AND TABLE_NAME='payments' AND COLUMN_NAME='label'")
            assert q.fetchone()[0] == ('utf8mb4_general_ci' if sys.argv[2] == 'change-collation' else 'utf8mb4_bin')
        else:
            q.execute("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='ks288' AND TABLE_NAME='payments' AND COLUMN_NAME='ks288_added_after_approval'")
            expected = 1 if sys.argv[2] == 'add-column' else 0
            assert q.fetchone()[0] == expected
    print(json.dumps({'operation': sys.argv[2], 'actualOwnSchemaReadback': True, 'source': 'DECLARED_SYNTHETIC_TASK_OWNED_MARIADB_ONLY'}))
finally:
    con.close()
