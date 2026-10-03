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
  const checks=[];
  for(const [name,sql] of [
    ['unwanted-read',"SELECT * FROM read_csv('/proc/self/status')"],
    ['network-read',"SELECT * FROM read_csv('https://example.invalid/not-permitted.csv')"],
    ['extension-install',"INSTALL httpfs"],
    ['extension-load',"LOAD httpfs"],
    ['source-overwrite',"COPY (SELECT 1) TO '/input/source.csv'"],
    ['configuration-unlock',"SET enable_external_access=true"]
  ]) { let denied=false;try {await connection.runAndReadAll(sql);}catch {denied=true;} if(!denied)throw new Error('PROBE_UNEXPECTED_ALLOWED_'+name);checks.push({name,denied}); }
  const fs=await import('node:fs');
  for(const [name,fn] of [ ['native-source-write',()=>fs.writeFileSync('/input/source.csv','MUTATE')], ['unmounted-oracle',()=>fs.readFileSync('/outside-oracle.txt')] ]) {
    let denied=false,code;try{fn();}catch(e){denied=true;code=e.code;}if(!denied)throw new Error('PROBE_UNEXPECTED_ALLOWED_'+name);checks.push({name,denied,code});
  }
  const net=await import('node:net');
  const status=await new Promise(resolve=>{const s=net.createConnection({host:'192.0.2.1',port:80});s.once('error',e=>{s.destroy();resolve(e.code);});s.once('connect',()=>{s.destroy();resolve('CONNECTED');});s.setTimeout(500,()=>{s.destroy();resolve('TIMEOUT');});});
  if(!['ENETUNREACH','EHOSTUNREACH','EPERM','EACCES'].includes(status))throw new Error('PROBE_NETWORK_NOT_DENIED_'+status);checks.push({name:'kernel-network',denied:true,code:status});
  process.stdout.write(JSON.stringify({outcome:'SCHEMA_INFERRED',schema:{probeChecks:checks}})+'\n');
} finally { connection.closeSync(); db.closeSync(); }
