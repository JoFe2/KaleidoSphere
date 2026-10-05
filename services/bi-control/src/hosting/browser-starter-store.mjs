import {mkdirSync,openSync,fstatSync,closeSync,constants} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const fail=code=>{throw new Error(code);};
// Bounded KS-owned starter state only. No source database, session, resource
// budget, hosted identity or model policy is reset by this store.
export function createH03OwnedStarterStoreV1(root,binding){
 if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root||/[\x00-\x1f\x7f]/.test(root))fail('H03_STATE_ROOT_DENIED');
 mkdirSync(root,{recursive:true,mode:0o700});const dir=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 let fd,db;try{
 const ds=fstatSync(dir);if(ds.uid!==process.getuid()||(ds.mode&0o077)!==0)fail('H03_STATE_ROOT_DENIED');
 const name='/proc/self/fd/'+dir+'/ks294-starter.sqlite';
 try{fd=openSync(name,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);}
 catch(error){if(error.code!=='EEXIST')throw error;fd=openSync(name,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 const fs=fstatSync(fd);if(!fs.isFile()||fs.nlink!==1||fs.uid!==process.getuid()||(fs.mode&0o077)!==0)fail('H03_STATE_FILE_DENIED');closeSync(fd);fd=undefined;
 db=new DatabaseSync(name);db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
 db.exec(`CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1),binding TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 1000000),state TEXT NOT NULL,operation_id TEXT,result TEXT) STRICT;
 CREATE TABLE IF NOT EXISTS operations(operation_id TEXT PRIMARY KEY,request TEXT NOT NULL,generation INTEGER NOT NULL,state TEXT NOT NULL,result TEXT) STRICT;`);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 transaction(()=>{db.prepare("INSERT OR IGNORE INTO owner VALUES(1,?,1,'idle',NULL,NULL)").run(binding);if(db.prepare('SELECT binding FROM owner WHERE id=1').get().binding!==binding)fail('H03_STATE_BINDING_DRIFT_DENIED');});
 const read=()=>{const row=db.prepare('SELECT * FROM owner WHERE id=1').get();if(row.binding!==binding)fail('H03_STATE_BINDING_DRIFT_DENIED');return{state:row.state,operationId:row.operation_id,starterGeneration:row.generation,result:row.result===null?null:JSON.parse(row.result)};};
 return Object.freeze({read,begin(command){return transaction(()=>{const current=read();if(current.state==='outcome_unknown')fail('H03_OUTCOME_UNKNOWN_HOLD');
 const prior=db.prepare('SELECT * FROM operations WHERE operation_id=?').get(command.operationId);
 if(prior){if(prior.request!==JSON.stringify(command))fail('H03_OPERATION_CONFLICT_DENIED');if(prior.generation!==current.starterGeneration)fail('H03_OPERATION_RESET_DENIED');return{dispatch:false,state:prior.state,result:prior.result===null?null:JSON.parse(prior.result)};}
 if(db.prepare('SELECT count(*) AS n FROM operations').get().n>=128)fail('H03_OPERATION_BOUND_EXHAUSTED');
 db.prepare("INSERT INTO operations VALUES(?,?,?,'outcome_unknown',NULL)").run(command.operationId,JSON.stringify(command),current.starterGeneration);
 db.prepare("UPDATE owner SET state='outcome_unknown',operation_id=?,result=NULL WHERE id=1").run(command.operationId);return{dispatch:true};});},
 complete(operationId,state,result){return transaction(()=>{const current=read();if(current.operationId!==operationId||current.state!=='outcome_unknown')fail('H03_COMPLETION_BINDING_DENIED');
 const encoded=result===null?null:JSON.stringify(result);db.prepare('UPDATE operations SET state=?,result=? WHERE operation_id=?').run(state,encoded,operationId);
 db.prepare('UPDATE owner SET state=?,result=? WHERE id=1').run(state,encoded);return read();});},
 reset(instanceId,expectedGeneration){return transaction(()=>{const current=read();const identity=JSON.parse(binding);
 if(instanceId!==identity.instanceId||expectedGeneration!==current.starterGeneration||!Number.isSafeInteger(expectedGeneration))fail('H03_RESET_BINDING_DENIED');
 if(current.state==='outcome_unknown')fail('H03_RESET_OUTCOME_UNKNOWN_DENIED');if(current.starterGeneration>=1000000)fail('H03_RESET_GENERATION_EXHAUSTED');
 db.prepare("UPDATE owner SET generation=generation+1,state='idle',operation_id=NULL,result=NULL WHERE id=1").run();return read();});},
 close(){db.close();closeSync(dir);}});
 }catch(error){if(db)db.close();if(fd!==undefined)closeSync(fd);closeSync(dir);throw error;}}
