import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const ROOT=process.cwd();
test('K03 actual entry refuses missing, invalid or reversed explicit periods without partial data',()=>{
  for(const args of [[],['--period-start','2026-06-01'],['--period-start','2026-07-01','--period-end','2026-06-01'],['--period-start','2026-02-30','--period-end','2026-08-01']]){
    const p=spawnSync(process.execPath,['scripts/run-invoice-date-o2c.mjs','--fixture','KS-ORIGINAL-500-700',...args],{cwd:ROOT,encoding:'utf8',timeout:5000});const v=JSON.parse(p.stdout);
    assert.equal(p.status,1,p.stdout);assert.equal(v.outcome,'DENIED');assert.equal(v.reasonCode,'K03_PERIOD_DENIED');assert.equal(v.table,null);assert.equal(v.partialSuccess,false);
  }
});
test('K03 exact COMMON-TRADE-01 facts agree under two known mappings without becoming a second context',()=>{
  const a=cli('COMMON-TRADE-01',['--mapping','common-snake-reference/v1']);const b=cli('COMMON-TRADE-01',['--mapping','ks-camel-fixture/v1']);
  assert.equal(a.status,0,a.stderr||a.stdout);assert.equal(b.status,0,b.stderr||b.stdout);
  for(const v of [a.value,b.value]){
    assert.deepEqual(v.table.rows,[{month:'2026-06',net_minor:80000,currency:'EUR'},{month:'2026-07',net_minor:10000,currency:'EUR'}]);
    assert.equal(v.orderIntake.netMinor,100000);assert.equal(v.delivery.onTimeQuantityPercent,80);assert.equal(v.delivery.positionOtifPercent,0);
    assert.equal(v.customerReceipt.outcome,'UNKNOWN_NO_CUSTOMER_RECEIPT_EVIDENCE');assert.equal(v.source.id,'COMMON-TRADE-01');
  }
  assert.deepEqual(a.value.table,b.value.table);assert.deepEqual(a.value.delivery,b.value.delivery);
});
function cli(fixture='KS-ORIGINAL-500-700', extra=[]){
  const p=spawnSync(process.execPath,['scripts/run-invoice-date-o2c.mjs','--fixture',fixture,'--period-start','2026-06-01','--period-end','2026-08-01',...extra],{cwd:ROOT,encoding:'utf8',timeout:5000});
  return {status:p.status,stdout:p.stdout,stderr:p.stderr,value:p.stdout?JSON.parse(p.stdout):null};
}
test('K03 actual additive invoice-date entry keeps original500/700 distinct from order intake and original-deadline OTIF',()=>{
  const p=cli();assert.equal(p.status,0,p.stderr||p.stdout);const v=p.value;
  assert.equal(v.outcome,'ACCEPTED');assert.equal(v.profile.dateBasis,'INVOICE_DATE');
  assert.deepEqual(v.table.rows,[{month:'2026-06',net_minor:50000,currency:'EUR'},{month:'2026-07',net_minor:70000,currency:'EUR'}]);
  assert.equal(v.orderIntake.netMinor,100000);assert.equal(v.delivery.onTimeQuantityPercent,80);assert.equal(v.delivery.positionOtifPercent,0);
  assert.equal(v.customerReceipt.outcome,'UNKNOWN_NO_CUSTOMER_RECEIPT_EVIDENCE');
  assert.equal(v.producerPairing,'NOT_EXECUTED_LOCAL_FIXTURE_ONLY');
});
