import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const cutoff='2026-06-30T21:59:59Z';
test('K05 actual declared historical narrow M3 CLI preserves unavailable reservation/blocking/free instead of extending the old profile',()=>{
 const path='dependencies/pansphaira/dist/packages/contracts/src/bestand-nachschub-v1.js';
 const before=createHash('sha256').update(readFileSync(path)).digest('hex');
 const p=spawnSync(process.execPath,['scripts/run-stock-analysis.mjs','--fixture','K05-HISTORICAL-NARROW-M3','--as-of',cutoff],{encoding:'utf8',timeout:5000});
 assert.equal(p.status,0,p.stdout+p.stderr);const result=JSON.parse(p.stdout);
 assert.equal(result.stockFacts.physical.value,2);
 for(const key of ['reserved','blocked','free']){assert.equal(result.stockFacts[key].state,'UNKNOWN');assert.equal(result.stockFacts[key].value,null);}
 assert.equal(result.shortage.state,'UNKNOWN');assert.equal(result.stockRunwayDays.state,'UNKNOWN');assert.equal(result.stockValueMinor.state,'UNKNOWN');
 assert.equal(result.source.nativeEvidence,false);assert.equal(result.source.syntheticOnly,true);assert.equal(result.legacyProfileExpanded,false);assert.equal(result.mutationAuthority,false);
 assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),before);
});
