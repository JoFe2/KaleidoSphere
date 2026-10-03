import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const args=['scripts/run-invoice-date-o2c.mjs','--fixture','COMMON-TRADE-01','--period-start','2026-06-01','--period-end','2026-08-01'];
const run=(extra=[])=>spawnSync(process.execPath,[...args,...extra],{encoding:'utf8',timeout:5000});
test('K03 actual table, SVG data, permitted drilldown and export use the same invoice-date facts',()=>{
  const p=run();assert.equal(p.status,0,p.stderr||p.stdout);const v=JSON.parse(p.stdout);
  assert.deepEqual(v.chart.series,v.table.rows.map(r=>({month:r.month,net_minor:r.net_minor})));
  assert.match(v.chart.svg,/<svg/);assert.match(v.chart.svg,/data-month="2026-06" data-net-minor="80000"/);assert.match(v.chart.svg,/data-month="2026-07" data-net-minor="10000"/);
  const csv=v.export.csv.trim().split('\n').slice(1).map(line=>{const [month,minor,currency]=line.split(',');return {month,net_minor:Number(minor),currency};});assert.deepEqual(csv,v.table.rows);
  for(const row of v.table.rows)assert.equal(v.drilldown.rows.filter(d=>d.invoice_date.startsWith(row.month)).reduce((n,d)=>n+d.signed_net_minor,0),row.net_minor);
  assert.equal(v.drilldown.rows.find(d=>d.document_id==='CN-01').signed_net_minor,-10000);
});
test('K03 export entry emits actual CSV bytes, not a mocked file descriptor',()=>{
  const p=run(['--view','export']);assert.equal(p.status,0,p.stdout||p.stderr);assert.equal(p.stdout,'month,net_minor,currency\n2026-06,80000,EUR\n2026-07,10000,EUR\n');
});
test('K03 chart date/currency/non-order-intake caption is split into visible footer lines',()=>{
  const p=run(['--view','chart']);assert.equal(p.status,0,p.stdout||p.stderr);
  assert.match(p.stdout,/viewBox="0 0 720 540"/);
  assert.match(p.stdout,/<text x="60" y="510">Datenwerte in EUR-Cent; Gutschriften auf eigenem Rechnungsdatum\.<\/text>/);
  assert.match(p.stdout,/<text x="60" y="530">Kein Auftragseingang\.<\/text>/);
});
test('K03 chart entry emits an actual standalone SVG',()=>{
  const p=run(['--view','chart']);assert.equal(p.status,0,p.stdout||p.stderr);assert.match(p.stdout,/^<svg/);assert.match(p.stdout,/800\.00 EUR/);assert.match(p.stdout,/100\.00 EUR/);
});
