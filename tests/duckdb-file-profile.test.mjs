import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Independent synthetic reference, not DuckDB output or a cached candidate answer.
function reference() {
  const lines = readFileSync('examples/file-profile/approved.csv', 'utf8').trimEnd().split('\n').slice(1);
  const groups = new Map();
  for (const line of lines) {
    const [category, units] = line.split(',');
    const g = groups.get(category) ?? { category, sum: 0n, nulls: 0 };
    if (units === '') g.nulls += 1;
    else g.sum += BigInt(units);
    groups.set(category, g);
  }
  return [...groups.values()].sort((a,b) => a.category.localeCompare(b.category)).map(g =>
    ({ category:g.category, sum_units:g.sum.toString(), null_units:g.nulls }));
}
test('K02 actual CSV entry runs DuckDB to independently correct table and CSV export', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ks284-csv-entry-'));
  try {
    const runtime = process.env.KS284_DUCKDB_RUNTIME ?? join(process.cwd(), '.ks-file-runtime');
    const out = spawnSync(process.execPath, ['scripts/run-file-profile.mjs',
      '--runtime-root', runtime,
      '--source', 'examples/file-profile/approved.csv', '--question', 'sum-units-by-category',
      '--export', join(dir,'result.csv')], { encoding:'utf8', timeout:10000 });
    assert.equal(out.error, undefined);
    assert.equal(out.status, 0, 'genuine guided file entry must succeed, not just register a connector');
    const result = JSON.parse(out.stdout);
    assert.equal(result.outcome, 'ACCEPTED');
    assert.equal(result.engine.version, 'v1.5.6');
    assert.equal(result.engine.clientVersion, '1.5.6-r.1');
    assert.deepEqual(result.table.rows, reference());
    assert.equal(readFileSync(join(dir,'result.csv'),'utf8'),
      'category,sum_units,null_units\nalpha,11,1\nbeta,5,0\n');
    assert.equal(result.schema.inferenceReadsValues, true);
    assert.equal(result.dataReadPerformed, true);
    assert.equal(result.source.contentHashVerified, true);
    assert.equal(result.schema.sourceRows, 5);
    assert.equal(result.schema.nullCounts.units, 1);
    assert.deepEqual(result.binding, { groupColumn:'category', valueColumn:'units', valueType:'BIGINT' });
    assert.equal(result.plan.questionId, 'sum-units-by-category');
    assert.match(result.plan.sql, /SUM\(units\)/);
    assert.equal(result.budget.inputBytesMax, 1048576);
    assert.equal(result.budget.sourceRowsMax, 10000);
    assert.equal(result.budget.resultRowsMax, 100);
    assert.equal(result.budget.wallTimeMs, 5000);
    assert.equal(result.budget.stdoutBytesMax, 65536);
    assert.equal(result.budget.engineMemory, '64MB');
    assert.equal(result.engine.extensionsPolicy, 'BUILTIN_ONLY_NO_INSTALL_NO_AUTOLOAD');
    assert.equal(result.provenance.freshness, 'LOCAL_FILE_MTIME_NOT_UPSTREAM_FRESHNESS');
    assert.equal(result.mutationPerformed, false);
    assert.equal(out.stderr, '');
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('K02 actual Parquet entry agrees with independent CSV reference and export', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ks284-parquet-entry-'));
  try {
    const runtime = process.env.KS284_DUCKDB_RUNTIME ?? join(process.cwd(), '.ks-file-runtime');
    const out = spawnSync(process.execPath, ['scripts/run-file-profile.mjs', '--runtime-root',runtime,
      '--source','examples/file-profile/approved.parquet','--question','sum-units-by-category',
      '--export',join(dir,'result.csv')], {encoding:'utf8',timeout:10000});
    assert.equal(out.error, undefined);
    assert.equal(out.status, 0, 'genuine Parquet route must not be a registration-only claim');
    const result=JSON.parse(out.stdout);
    assert.equal(result.engine.version, 'v1.5.6');
    assert.deepEqual(result.table.rows, reference());
    assert.equal(readFileSync(join(dir,'result.csv'),'utf8'),'category,sum_units,null_units\nalpha,11,1\nbeta,5,0\n');
    assert.equal(out.stderr,'');
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('K02 metadata-only operation reads no values and does not require an engine', () => {
  const out=spawnSync(process.execPath,['scripts/run-file-profile.mjs',
    '--source','examples/file-profile/approved.csv','--question','sum-units-by-category',
    '--mode','METADATA_ONLY','--runtime-root','/does-not-exist/ks284-runtime'],{encoding:'utf8',timeout:3000});
  assert.equal(out.error,undefined);
  assert.equal(out.status,0);
  const result=JSON.parse(out.stdout);
  assert.equal(result.outcome,'METADATA_ONLY');
  assert.equal(result.dataReadPerformed,false);
  assert.equal(result.source.contentHashVerified,false);
  assert.equal(result.schema.coverage,'DECLARED_NOT_INFERRED');
  assert.equal(result.schema.inferenceReadsValues,false);
  assert.equal(result.table,null);
  assert.equal(result.export,null);
  assert.equal(out.stderr,'');
});

test('K02 schema inference is a distinct value-reading capability without calculation or export', () => {
  const runtime=process.env.KS284_DUCKDB_RUNTIME??join(process.cwd(),'.ks-file-runtime');
  const out=spawnSync(process.execPath,['scripts/run-file-profile.mjs','--source','examples/file-profile/approved.parquet',
    '--question','sum-units-by-category','--mode','SCHEMA_INFERENCE','--runtime-root',runtime],{encoding:'utf8',timeout:10000});
  assert.equal(out.error,undefined);
  assert.equal(out.status,0);
  const result=JSON.parse(out.stdout);
  assert.equal(result.outcome,'SCHEMA_INFERRED');
  assert.equal(result.dataReadPerformed,true);
  assert.equal(result.schema.coverage,'INFERRED_FROM_VALUES');
  assert.equal(result.schema.inferenceReadsValues,true);
  assert.equal(result.source.contentHashVerified,true);
  assert.deepEqual(result.schema.columns.map(x=>[x.column_name,x.column_type]),[['category','VARCHAR'],['units','BIGINT']]);
  assert.equal(result.table,null);
  assert.equal(result.export,null);
  assert.equal(result.artifactWritesPerformed,false);
  assert.equal(out.stderr,'');
});

test('K02 denied mutation mode has an understandable non-partial diagnosis', () => {
  const out=spawnSync(process.execPath,['scripts/run-file-profile.mjs','--source','examples/file-profile/approved.csv',
    '--question','sum-units-by-category','--mode','WRITE','--runtime-root','/never-open-runtime'],{encoding:'utf8',timeout:3000});
  assert.equal(out.status,1);
  const result=JSON.parse(out.stdout);
  assert.equal(result.outcome,'DENIED');
  assert.equal(result.reasonCode,'K02_RIGHTS_DENIED');
  assert.equal(result.partialSuccess,false);
  assert.equal(result.table,null);
  assert.equal(result.export,null);
  assert.match(result.diagnostic,/nicht freigegeben/i);
  assert.equal(out.stderr,'');
});
