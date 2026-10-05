import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const cli=id=>spawnSync(process.execPath,['scripts/run-stock-analysis.mjs','--fixture',id,'--as-of','2026-06-30T23:59:59+02:00'],{encoding:'utf8',timeout:5000});
test('K05 actual admitted synthetic deadline CLI distinguishes on-time versus late arrival at the same stock and never claims reservation events',()=>{
 // Independent deadline oracle: two usable current units cover two of six
 // committed units. Four more arriving by the due instant cover the remainder;
 // after that instant they cover none of it. No production projection import.
 const expected={ 'K05-DEMAND-ON-TIME':0, 'K05-DEMAND-LATE':4 };
 const results=[];
 for(const [id,missing] of Object.entries(expected)){
  const p=cli(id);assert.equal(p.status,0,p.stdout+p.stderr);const r=JSON.parse(p.stdout);results.push(r);
  assert.equal(r.shortage.state,'KNOWN');assert.equal(r.shortage.value,missing);
  assert.equal(r.shortage.rows[0].dueAt,'2026-07-01T10:00:00+02:00');
  assert.equal(r.shortage.rows[0].quantity,6);assert.equal(r.shortage.rows[0].missing,missing);
  assert.equal(r.source.syntheticOnly,true);assert.equal(r.mutationAuthority,false);
  assert.equal(r.stock.reservationProvenance,'EXPLICIT_SYNTHETIC_SCENARIO_ASSUMPTION_NOT_EVENT_EVIDENCE');
 }
 assert.deepEqual(results[0].stock,results[1].stock);
 assert.deepEqual(['physical','reserved','blocked','free'].map(k=>results[0].stock[k]),[2,2,0,0]);
});
