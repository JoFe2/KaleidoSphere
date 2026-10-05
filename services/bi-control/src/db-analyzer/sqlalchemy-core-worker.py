"""Optional, process-private SQLAlchemy Core MariaDB metadata worker.

Only explicitly scoped metadata is exposed. No caller SQL, ORM, row samples,
production credentials, vendor parity inference, or execution-authority claim.
"""
import contextlib
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import signal
import sys
import threading

PROFILE_SCHEMA = 'kaleidosphere.db/relational-core-profile/v1'
EVIDENCE_SCHEMA = 'kaleidosphere.db/relational-core-evidence/v1'
PINS = {'SQLAlchemy': '2.0.54', 'PyMySQL': '1.1.2'}


class Refusal(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def deny(code):
    raise Refusal(code)


def exact_keys(value, names):
    return isinstance(value, dict) and set(value) == set(names)


def identifier(value):
    return isinstance(value, str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}', value) is not None


def validate_profile(p):
    if not exact_keys(p, ['schemaVersion', 'profileId', 'engine', 'mode', 'scope', 'policy', 'adapter', 'approval']) or p['schemaVersion'] != PROFILE_SCHEMA or not isinstance(p['profileId'], str) or not identifier(p['profileId'].replace('-', '_')) or p['engine'] != 'mariadb' or p['mode'] != 'RUNTIME':
        deny('K06_PROFILE_DENIED')
    s, policy, a, approval = (p[n] for n in ['scope', 'policy', 'adapter', 'approval'])
    if not exact_keys(s, ['database', 'tables']) or not identifier(s['database']) or not isinstance(s['tables'], list) or not 1 <= len(s['tables']) <= 8 or any(not identifier(t) for t in s['tables']) or len(set(s['tables'])) != len(s['tables']):
        deny('K06_SCOPE_DENIED')
    if not exact_keys(policy, ['access', 'allowRowSamples', 'maxQueryTimeoutMs', 'maxMetadataRows']) or policy['access'] != 'READ_ONLY' or policy['allowRowSamples'] is not False or type(policy['maxQueryTimeoutMs']) is not int or not 100 <= policy['maxQueryTimeoutMs'] <= 10000 or type(policy['maxMetadataRows']) is not int or not 1 <= policy['maxMetadataRows'] <= 256:
        deny('K06_POLICY_DENIED')
    if not exact_keys(a, ['kind', 'host', 'port', 'user', 'passwordEnv', 'ssl']) or a['kind'] != 'sqlalchemy-core' or not isinstance(a['host'], str) or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.\-]{0,252}', a['host']) is None or type(a['port']) is not int or not 1 <= a['port'] <= 65535 or not identifier(a['user']) or a['passwordEnv'] != 'CM_MARIADB_PASSWORD' or type(a['ssl']) is not bool:
        deny('K06_ADAPTER_DENIED')
    if not exact_keys(approval, ['state', 'schemaSha256']) or approval['state'] not in ['PREVIEW_ONLY', 'APPROVED_SCOPE'] or (approval['schemaSha256'] is not None if approval['state'] == 'PREVIEW_ONLY' else not isinstance(approval['schemaSha256'], str) or re.fullmatch(r'[0-9a-f]{64}', approval['schemaSha256']) is None):
        deny('K06_APPROVAL_DENIED')
    return p


def qualify_runtime():
    if platform.python_version() != '3.12.3' or sys.platform != 'linux' or platform.machine() != 'x86_64':
        deny('K06_PYTHON_RUNTIME_DENIED')
    for name, pin in PINS.items():
        try:
            actual = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            deny('K06_DRIVER_UNAVAILABLE')
        if actual != pin:
            deny('K06_DRIVER_VERSION_DENIED')


class RelationalCoreWorker:
    def __init__(self):
        qualify_runtime()
        from sqlalchemy import create_engine, URL, inspect, text
        self.create_engine, self.URL, self.inspect, self.text = create_engine, URL, inspect, text
        self.owner = (os.getpid(), threading.get_ident())
        self.engine = None
        self.active_connection = None
        self.active_connection_id = None
        self.active_profile = None
        self.cancelled = False
        self.lifecycle = {'checkedOutAfter': 0, 'poolDisposed': True}
        if threading.current_thread() is threading.main_thread():
            signal.signal(signal.SIGTERM, self.cancel)

    def cancel(self, _signal, _frame):
        self.assert_owner()
        self.cancelled = True
        control = None
        try:
            if self.active_connection_id is not None and self.active_profile is not None:
                import pymysql
                a = self.active_profile['adapter']
                args = {'host': a['host'], 'port': a['port'], 'user': a['user'], 'password': os.environ[a['passwordEnv']], 'database': self.active_profile['scope']['database'], 'connect_timeout': 1, 'read_timeout': 1, 'write_timeout': 1, 'autocommit': True}
                if a['ssl']:
                    args['ssl'] = {'check_hostname': True}
                control = pymysql.connect(**args)
                with control.cursor() as cursor:
                    cursor.execute('KILL QUERY %s', (self.active_connection_id,))
                self.lifecycle['ownQueryCancellationSent'] = True
        finally:
            if control is not None:
                control.close()
            self.lifecycle['cancelControlClosed'] = True
        deny('K06_CANCELLED')

    def assert_owner(self):
        if self.owner != (os.getpid(), threading.get_ident()):
            deny('K06_WORKER_OWNER_DENIED')

    @contextlib.contextmanager
    def session(self, profile):
        self.assert_owner()
        if self.cancelled:
            deny('K06_CANCELLED')
        p = validate_profile(profile)
        secret = os.environ.get(p['adapter']['passwordEnv'])
        if not isinstance(secret, str) or not 8 <= len(secret) <= 1024:
            deny('K06_CREDENTIAL_MISSING')
        a, s = p['adapter'], p['scope']
        args = {'connect_timeout': 2, 'read_timeout': p['policy']['maxQueryTimeoutMs'] / 1000 + 2, 'write_timeout': 2}
        if a['ssl']:
            args['ssl'] = {'check_hostname': True}
        url = self.URL.create('mariadb+pymysql', username=a['user'], password=secret, host=a['host'], port=a['port'], database=s['database'])
        self.engine = self.create_engine(url, pool_size=1, max_overflow=0, pool_timeout=2, echo=False, hide_parameters=True, connect_args=args)
        self.lifecycle = {'checkedOutAfter': None, 'poolDisposed': False, 'workerPid': self.owner[0], 'threadOwnerVerified': True}
        try:
            with self.engine.connect() as con:
                con.exec_driver_sql('SET SESSION TRANSACTION READ ONLY')
                con.commit()
                con.execute(self.text('SET SESSION max_statement_time = :seconds'), {'seconds': p['policy']['maxQueryTimeoutMs'] / 1000})
                identity = con.exec_driver_sql('SELECT VERSION(), DATABASE(), CURRENT_USER(), @@tx_read_only, CONNECTION_ID()').one()
                if identity[0] != '11.8.3-MariaDB-ubu2404' or identity[1] != s['database'] or not identity[2].startswith(a['user'] + '@') or identity[3] != 1 or self.engine.dialect.name != 'mariadb' or self.engine.dialect.driver != 'pymysql':
                    deny('K06_SERVER_IDENTITY_DENIED')
                # Only SELECT/USAGE grants. Grant payloads stay in memory, never evidence.
                grants = [row[0] for row in con.exec_driver_sql('SHOW GRANTS FOR CURRENT_USER')]
                for grant in grants:
                    if not (grant.startswith('GRANT USAGE ON *.* TO ') or grant.startswith('GRANT SELECT ON `' + s['database'] + '`.* TO ')) or 'WITH GRANT OPTION' in grant:
                        deny('K06_PRINCIPAL_NOT_READ_ONLY')
                self.active_connection = con
                self.active_connection_id = identity[4]
                self.active_profile = p
                try:
                    yield con, identity[0]
                except BaseException:
                    # Unwind the interrupted DBAPI buffered read BEFORE physical close.
                    if self.cancelled:
                        con.invalidate()
                    raise
        finally:
            self.active_connection = None
            self.active_connection_id = None
            self.active_profile = None
            self.lifecycle['checkedOutAfter'] = self.engine.pool.checkedout()
            self.engine.dispose()
            self.lifecycle['poolDisposed'] = True
            self.engine = None

    def metadata(self, con, profile):
        s, cap = profile['scope'], profile['policy']['maxMetadataRows']
        inspector = self.inspect(con)
        tables = []
        total = 0
        for table in sorted(s['tables']):
            relation_kind = con.execute(self.text('SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=:database AND TABLE_NAME=:table'), {'database': s['database'], 'table': table}).scalar_one_or_none()
            if relation_kind != 'BASE TABLE':
                deny('K06_SCOPED_TABLE_DENIED')
            native = con.execute(self.text('SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, NUMERIC_PRECISION, NUMERIC_SCALE, COLLATION_NAME, CHARACTER_SET_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=:database AND TABLE_NAME=:table ORDER BY ORDINAL_POSITION LIMIT :cap'), {'database': s['database'], 'table': table, 'cap': cap + 1}).mappings().all()
            total += len(native)
            if not native or total > cap:
                deny('K06_METADATA_BUDGET_DENIED')
            reflected = inspector.get_columns(table, schema=s['database'])
            if [c['name'] for c in reflected] != [c['COLUMN_NAME'] for c in native]:
                deny('K06_SCHEMA_CHANGED')
            columns = []
            for item, raw in zip(reflected, native):
                if not identifier(item['name']):
                    deny('K06_METADATA_DENIED')
                columns.append({'name': item['name'], 'type': raw['DATA_TYPE'].upper(), 'nullable': item['nullable'], 'precision': raw['NUMERIC_PRECISION'], 'scale': raw['NUMERIC_SCALE'], 'collation': raw['COLLATION_NAME'], 'charset': raw['CHARACTER_SET_NAME'], 'metadataOrigin': 'ACTUAL_SCOPED_NATIVE_COLUMN_METADATA_AND_CORE_REFLECTION'})
            pk = inspector.get_pk_constraint(table, schema=s['database'])['constrained_columns']
            fk = [{'columns': f['constrained_columns'], 'targetDatabase': f['referred_schema'], 'targetTable': f['referred_table'], 'targetColumns': f['referred_columns']} for f in inspector.get_foreign_keys(table, schema=s['database'])]
            if any(not identifier(n) for n in pk) or any(not all(identifier(n) for n in f['columns'] + f['targetColumns'] + [f['targetDatabase'], f['targetTable']]) for f in fk):
                deny('K06_METADATA_DENIED')
            tables.append({'name': table, 'columns': columns, 'primaryKey': pk, 'foreignKeys': fk, 'vendorOnlyMetadata': {'postgresqlNativeOID': 'NOT_APPLICABLE', 'validationFlags': 'UNKNOWN_NOT_INFERRED'}})
        return {'database': s['database'], 'tables': tables, 'metadataRows': total}

    def aggregate_facts(self, con, metadata):
        from decimal import Decimal
        from sqlalchemy import Column, MetaData, Table, distinct, func, select
        facts = []
        for target in metadata['tables']:
            table = Table(target['name'], MetaData(), *(Column(c['name']) for c in target['columns']), schema=metadata['database'])
            expressions = [func.count().label('row_count')]
            for index, column in enumerate(target['columns']):
                source = table.c[column['name']]
                expressions.extend([func.count(source).label('nonnull_' + str(index)), func.count(distinct(source)).label('distinct_' + str(index))])
                if column['type'] == 'DECIMAL':
                    expressions.append(func.sum(source).label('sum_' + str(index)))
            row = con.execute(select(*expressions).select_from(table)).mappings().one()
            if any(type(value) is int and not 0 <= value <= 9007199254740991 for value in row.values()):
                deny('K06_AGGREGATE_RANGE_DENIED')
            columns = []
            for index, column in enumerate(target['columns']):
                fact = {'column': column['name'], 'nullCount': row['row_count'] - row['nonnull_' + str(index)], 'distinctCount': row['distinct_' + str(index)]}
                if column['type'] == 'DECIMAL':
                    value = row['sum_' + str(index)]
                    if value is not None and not isinstance(value, Decimal):
                        deny('K06_DECIMAL_PARITY_DENIED')
                    fact.update({'exactDecimalSum': str(value) if value is not None else None, 'sumRepresentation': 'DECIMAL_STRING_NOT_FLOAT'})
                columns.append(fact)
            facts.append({'table': target['name'], 'rowCount': row['row_count'], 'columns': columns, 'aggregateOnly': True})
        return facts

    def run(self, profile):
        self.assert_owner()
        with self.session(profile) as (con, version):
            metadata = self.metadata(con, profile)
            fingerprint = hashlib.sha256(json.dumps(metadata, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
            if profile['approval']['state'] == 'APPROVED_SCOPE' and profile['approval']['schemaSha256'] != fingerprint:
                deny('K06_SCHEMA_CHANGED')
        result = {
            'schemaVersion': EVIDENCE_SCHEMA, 'engine': 'mariadb',
            'state': 'PREVIEW', 'metadata': metadata, 'schemaSha256': fingerprint,
            'server': {'version': version, 'dialect': 'mariadb', 'driver': 'pymysql', 'Python': platform.python_version(), 'packages': PINS},
            'disclosure': {'rowMaterialPersisted': False, 'executionAuthorityGranted': False, 'missingVendorMetadataInferred': False},
        }
        if profile['approval']['state'] == 'APPROVED_SCOPE':
            with self.session(profile) as (con, _version):
                current = self.metadata(con, profile)
                if hashlib.sha256(json.dumps(current, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest() != fingerprint:
                    deny('K06_SCHEMA_CHANGED')
                result['aggregateFacts'] = self.aggregate_facts(con, current)
                after = self.metadata(con, profile)
                if hashlib.sha256(json.dumps(after, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest() != fingerprint:
                    deny('K06_SCHEMA_CHANGED')
            result['state'] = 'ANALYZED'
        result['lifecycle'] = dict(self.lifecycle)
        return result


def main():
    worker = None
    try:
        body = sys.stdin.buffer.read(65537)
        if len(body) > 65536:
            deny('K06_INPUT_DENIED')
        request = json.loads(body)
        if not exact_keys(request, ['profile']):
            deny('K06_INPUT_DENIED')
        profile = validate_profile(request['profile'])
        worker = RelationalCoreWorker()
        result = worker.run(profile)
        packet = {'ok': True, 'result': result}
        text = json.dumps(packet, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
        if os.environ.get('CM_MARIADB_PASSWORD', '\0') in text:
            deny('K06_SECRET_DISCLOSURE_DENIED')
        print(text)
        return 0
    except Exception as error:
        code = error.code if isinstance(error, Refusal) else 'K06_WORKER_FAILED'
        print(json.dumps({'ok': False, 'reasonCode': code, 'partialSuccess': False, 'lifecycle': worker.lifecycle if worker else None}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
