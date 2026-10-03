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
  const engine = (await connection.runAndReadAll('SELECT version() AS version')).getRowObjectsJson()[0];
  if (engine.version !== 'v1.5.6') throw new Error('K02_ENGINE_IDENTITY_DENIED');
  const schema = (await connection.runAndReadAll(`DESCRIBE SELECT * FROM ${tableFunction}`)).getRowObjectsJson();
  if (JSON.stringify(schema.map(c=>[c.column_name,c.column_type]))!==JSON.stringify([['category','VARCHAR'],['units','BIGINT']])) throw new Error('K02_SCHEMA_DENIED');
  let result;
  const engineProfile = {...engine,clientVersion:'1.5.6-r.1',extensionsPolicy:'BUILTIN_ONLY_NO_INSTALL_NO_AUTOLOAD'};
  if (mode==='SCHEMA_INFERENCE') {
    result = {outcome:'SCHEMA_INFERRED',engine:engineProfile,schema:{columns:schema,coverage:'INFERRED_FROM_VALUES',inferenceReadsValues:true},table:null,export:null,mutationPerformed:false,mutationScope:'SOURCE_DATA_ONLY'};
  } else {
    const counts=(await connection.runAndReadAll(`SELECT COUNT(*)::INT AS source_rows, (COUNT(*)-COUNT(units))::INT AS null_units FROM ${tableFunction}`)).getRowObjectsJson()[0];
    if (counts.source_rows>10000) throw new Error('K02_ROW_BUDGET_DENIED');
    const sql=`SELECT category, SUM(units)::VARCHAR AS sum_units, (COUNT(*)-COUNT(units))::INT AS null_units FROM ${tableFunction} GROUP BY category ORDER BY category LIMIT 101`;
    const rows = (await connection.runAndReadAll(sql)).getRowObjectsJson();
    if (rows.length>100) throw new Error('K02_ROW_BUDGET_DENIED');
    result = {outcome:'ACCEPTED',engine:engineProfile,schema:{columns:schema,coverage:'INFERRED_FROM_VALUES',inferenceReadsValues:true,sourceRows:counts.source_rows,nullCounts:{units:counts.null_units}},binding:{groupColumn:'category',valueColumn:'units',valueType:'BIGINT'},plan:{questionId:'sum-units-by-category',sql,nullPolicy:'SUM excludes NULL units; null_units is the separate count'},table:{columns:['category','sum_units','null_units'],rows},mutationPerformed:false,mutationScope:'SOURCE_DATA_ONLY'};
  }
  process.stdout.write(JSON.stringify(result)+'\n');
} catch (error) {
  const reasonCode=['K02_SCHEMA_DENIED','K02_ROW_BUDGET_DENIED','K02_ENGINE_IDENTITY_DENIED'].includes(error?.message)?error.message:'K02_EXECUTOR_DENIED';
  process.stdout.write(JSON.stringify({outcome:'DENIED',reasonCode,partialSuccess:false,table:null,export:null})+'\n');
  process.exitCode=1;
} finally { connection.closeSync(); db.closeSync(); }
