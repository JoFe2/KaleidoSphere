#!/usr/bin/env node
// Internal DuckDB worker. No arbitrary SQL, filenames, extensions or credentials from callers.
import { DuckDBInstance } from '/runtime/node_modules/@duckdb/node-api/lib/index.js';
const format = process.argv[2];
if (!['csv','parquet'].includes(format)) throw new Error('K02_FORMAT_DENIED');
const mode = process.argv[3];
if (!['SCHEMA_INFERENCE','FULL_READ_ONLY'].includes(mode)) throw new Error('K02_RIGHTS_DENIED');
const path = '/input/source.'+format;
const tableFunction = format==='csv' ? "read_csv('/input/source.csv', header=true)" : "read_parquet('/input/source.parquet')";
const db = await DuckDBInstance.create(':memory:', {
  threads:'1', memory_limit:'64MB', autoinstall_known_extensions:'false',
  autoload_known_extensions:'false', allow_unsigned_extensions:'false',
});
const connection = await db.connect();
try {
  await connection.run(`SET allowed_paths = ['${path}']`);
  await connection.run('SET enable_external_access = false');
  await connection.run('SET allow_community_extensions = false');
  await connection.run('SET lock_configuration = true');
 let denied=false,oom=false;try{await connection.runAndReadAll('SELECT list(i) FROM range(10000000) t(i)');}catch(e){denied=true;oom=/out of memory|memory limit/i.test(String(e));}if(!denied||!oom)throw new Error('MEMORY_PROBE_NOT_QUALIFIED');process.stdout.write(JSON.stringify({outcome:'SCHEMA_INFERRED',schema:{memoryProbe:{denied,oom}}})+'\n');}finally{connection.closeSync();db.closeSync();}
