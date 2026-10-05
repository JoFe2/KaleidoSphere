"""Executing product-worker probes over declared owned synthetic MariaDB data."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import time
worker_file = Path(__file__).resolve().parents[2] / 'services/bi-control/src/db-analyzer/sqlalchemy-core-worker.py'
spec = importlib.util.spec_from_file_location('ks288_product_worker', worker_file)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cfg = json.loads(Path(sys.argv[1]).read_text())
s = cfg['servers']['mariadb']
p = {'schemaVersion': module.PROFILE_SCHEMA, 'profileId': 'ks288_real_probe', 'engine': 'mariadb', 'mode': 'RUNTIME', 'scope': {'database': 'ks288', 'tables': ['accounts', 'payments']}, 'policy': {'access': 'READ_ONLY', 'allowRowSamples': False, 'maxQueryTimeoutMs': 5000, 'maxMetadataRows': 128}, 'adapter': {'kind': 'sqlalchemy-core', 'host': s['host'], 'port': s['port'], 'user': 'ks288_reader', 'passwordEnv': 'CM_MARIADB_PASSWORD', 'ssl': False}, 'approval': {'state': 'PREVIEW_ONLY', 'schemaSha256': None}}
worker = module.RelationalCoreWorker()
mode = sys.argv[2]
result = {'mode': mode, 'actualWorkerModule': True, 'noMock': True}
if mode == 'read-only':
    from sqlalchemy.exc import DBAPIError
    codes = []
    for statement in ["UPDATE ks288.payments SET label='FORBIDDEN' WHERE id=10", 'CREATE TABLE ks288.forbidden_worker_write(id INTEGER)']:
        with worker.session(p) as (con, version):
            try:
                con.exec_driver_sql(statement)
                raise AssertionError('Actual worker permitted write')
            except DBAPIError as error:
                code = error.orig.args[0]
                assert code in [1142, 1792, 1290], code
                codes.append(code)
            con.rollback()
        assert worker.lifecycle['checkedOutAfter'] == 0 and worker.lifecycle['poolDisposed']
    with worker.session(p) as (con, version):
        row = con.exec_driver_sql('SELECT COUNT(*),SUM(amount),COUNT(DISTINCT label) FROM ks288.payments').one()
        assert row[0] == 3 and str(row[1]) == '1234567890123456.1235' and row[2] == 2
        assert con.exec_driver_sql("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='ks288' AND TABLE_NAME='forbidden_worker_write'").scalar_one() == 0
    result.update({'actualDmlDdlCodes': codes, 'sameDataAndNoDdlResidueReadback': True})
elif mode == 'owner-boundary':
    errors = []
    with worker.session(p) as (con, version):
        # Fork before creating the test thread: Thread.join can release its Python
        # sentinel while its OS thread is still exiting on a single CPU. Never
        # fork that transient multi-threaded process or suppress its warning.
        read_fd, write_fd = os.pipe()
        child = os.fork()
        if child == 0:
            os.close(read_fd)
            try:
                worker.run(p)
                payload = {'code': 'UNEXPECTED_SUCCESS'}
            except module.Refusal as error:
                payload = {'code': error.code, 'pidDiffers': os.getpid() != worker.owner[0]}
            os.write(write_fd, json.dumps(payload).encode()); os.close(write_fd); os._exit(0)
        os.close(write_fd)
        fork = json.loads(os.read(read_fd, 4096)); os.close(read_fd)
        _, status = os.waitpid(child, 0)
        assert status == 0 and fork == {'code': 'K06_WORKER_OWNER_DENIED', 'pidDiffers': True}
        assert con.exec_driver_sql('SELECT 1').scalar_one() == 1
        def wrong_thread():
            try:
                worker.run(p)
            except module.Refusal as error:
                errors.append(error.code)
        t = threading.Thread(target=wrong_thread)
        t.start(); t.join(timeout=3)
        assert not t.is_alive() and errors == ['K06_WORKER_OWNER_DENIED']
        assert con.exec_driver_sql('SELECT 1').scalar_one() == 1
        assert worker.engine.pool.checkedout() == 1
    result.update({'threadCode': errors[0], 'fork': fork, 'parentLiveConnectionStillHealthy': True})
elif mode == 'timeout':
    from sqlalchemy.exc import DBAPIError
    p['policy']['maxQueryTimeoutMs'] = 100
    start = time.monotonic()
    with worker.session(p) as (con, version):
        try:
            con.exec_driver_sql('SELECT SLEEP(2)')
            raise AssertionError('Required actual server timeout did not occur')
        except DBAPIError as error:
            code = error.orig.args[0]
            assert code == 1969, code
    elapsed = time.monotonic() - start
    assert elapsed < 1.5
    result.update({'actualTimeoutCode': code, 'elapsedSeconds': elapsed, 'sleepSeconds': 2})
elif mode == 'cancel':
    import signal
    timer = None
    try:
        with worker.session(p) as (con, version):
            cid = con.exec_driver_sql('SELECT CONNECTION_ID()').scalar_one()
            print(json.dumps({'phase': 'ACTUAL_OWN_READER_SESSION', 'connectionId': cid}), flush=True)
            timer = threading.Timer(0.15, lambda: os.kill(os.getpid(), signal.SIGTERM))
            timer.start()
            con.exec_driver_sql('SELECT SLEEP(10)')
            raise AssertionError('Actual worker cancellation did not occur')
    except module.Refusal as error:
        assert error.code == 'K06_CANCELLED'
        result.update({'reasonCode': error.code, 'actualSigtermDeliveredToLiveWorker': True})
    finally:
        if timer:
            timer.cancel()
else:
    raise AssertionError('Unknown trusted probe mode')
assert worker.lifecycle['checkedOutAfter'] == 0 and worker.lifecycle['poolDisposed']
result['lifecycle'] = worker.lifecycle
body = json.dumps(result)
assert os.environ['CM_MARIADB_PASSWORD'] not in body
print(body)
