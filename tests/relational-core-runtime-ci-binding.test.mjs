import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateRelationalCoreProfile,runRelationalCoreProfile} from '../services/bi-control/src/db-analyzer/relational-core-workflow.mjs';

const root=new URL('../',import.meta.url);
const read=async(name)=>readFile(new URL(name,root),'utf8');

test('K06 required CI actually provisions exact optional runtime and own MariaDB before mandatory canonical/native execution',async()=>{
 const ci=await read('.github/workflows/ci.yml');
 assert.match(ci,/name: Provision and execute the pinned relational Core MariaDB worker/);
 assert.match(ci,/python-version: '3\.12\.3'/);
 assert.match(ci,/python scripts\/provision-relational-core-runtime\.py --install/);
 assert.match(ci,/python scripts\/provision-relational-core-runtime\.py --verify/);
 assert.match(ci,/prepare-relational-core-native-fixture\.py --start/);
 assert.match(ci,/node --test --test-concurrency=1 tests\/relational-core-product\.test\.mjs/);
 assert.match(ci,/KS288_NATIVE_TEST_CONFIG/);assert.match(ci,/KS288_RELATIONAL_PYTHON/);assert.match(ci,/KS288_TEST_OWNER/);
 assert.ok(ci.indexOf('name: Provision and execute the pinned relational Core MariaDB worker')<ci.indexOf('- run: npm test'));
 assert.match(ci,/name: Read back exact owned relational fixture cleanup[\s\S]*if: always\(\)[\s\S]*--cleanup/);
});

test('K06 optional runtime lock pins one actual MariaDB target and four exact official artifacts, not a new ADBC target',async()=>{
 const lock=JSON.parse(await read('contracts/dependencies/relational-core-worker-lock-v1.json'));
 assert.equal(lock.pythonVersion,'3.12.3');assert.equal(lock.platform,'linux-x86_64');assert.equal(lock.server.engine,'mariadb');assert.equal(lock.server.version,'11.8.3-MariaDB-ubu2404');assert.match(lock.server.image,/^mariadb@sha256:[0-9a-f]{64}$/);assert.equal(lock.dialect,'mariadb+pymysql');
 assert.deepEqual(lock.wheels.map(w=>[w.distribution,w.version]),[['SQLAlchemy','2.0.54'],['PyMySQL','1.1.2'],['greenlet','3.5.6'],['typing_extensions','4.16.0']]);
 for(const wheel of lock.wheels){assert.match(wheel.url,/^https:\/\/files\.pythonhosted\.org\//);assert.match(wheel.sha256,/^[0-9a-f]{64}$/);assert.ok(Number.isSafeInteger(wheel.size)&&wheel.size>0);}
 assert.equal(lock.callerSqlOrNewSourceRights,false);
});

test('K06 test fixture mutates only owner-label bound synthetic server and cleanup deletes only its exact IDs and generated secrets',async()=>{
 const source=await read('scripts/prepare-relational-core-native-fixture.py');
 assert.match(source,/'--internal'/);assert.match(source,/actual\['Config'\]\['Labels'\]\.get\('ks.owner'\) != state\['nonce'\]/);assert.match(source,/exactOwnedContainerAndNetworkAbsent/);assert.match(source,/taskGeneratedCredentialFilesAbsent/);assert.match(source,/foreignResourcesModified': False/);
 const helper=await read('tests/helpers/relational-core-owned-fixture.py');assert.match(helper,/ks.owner/);assert.match(helper,/KS288_TEST_OWNER/);
 const installer=await read('scripts/provision-relational-core-runtime.py');assert.match(installer,/--require-hashes/);assert.match(installer,/--no-index/);assert.match(installer,/K06_RUNTIME_BYTES_DENIED/);assert.match(installer,/K06_RUNTIME_ROOT_EXISTS/);
});

const typedProfile=()=>({schemaVersion:'kaleidosphere.db/relational-core-profile/v1',profileId:'ks288-boundary',engine:'mariadb',mode:'RUNTIME',scope:{database:'ks288',tables:['payments']},policy:{access:'READ_ONLY',allowRowSamples:false,maxQueryTimeoutMs:100,maxMetadataRows:16},adapter:{kind:'sqlalchemy-core',host:'127.0.0.1',port:3306,user:'ks288_reader',passwordEnv:'CM_MARIADB_PASSWORD',ssl:false},approval:{state:'PREVIEW_ONLY',schemaSha256:null}});

test('K06 approval digest must be an actual string, not a JSON array coerced by regexp',()=>{
 const profile=typedProfile();profile.approval={state:'APPROVED_SCOPE',schemaSha256:['a'.repeat(64)]};
 assert.throws(()=>validateRelationalCoreProfile(profile),error=>error.code==='K06_APPROVAL_DENIED'&&error.partialSuccess===false);
});

test('K06 malformed cancellation object is typed-denied before runtime selection or child spawn',async()=>{
 const previous=process.env.KS288_RELATIONAL_PYTHON;
 try{delete process.env.KS288_RELATIONAL_PYTHON;await assert.rejects(runRelationalCoreProfile(typedProfile(),{signal:{aborted:false}}),error=>error.code==='K06_CANCELLATION_INVALID'&&error.partialSuccess===false);}
 finally{if(previous===undefined)delete process.env.KS288_RELATIONAL_PYTHON;else process.env.KS288_RELATIONAL_PYTHON=previous;}
});
