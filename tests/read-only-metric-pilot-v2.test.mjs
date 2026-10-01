import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  buildReadOnlyMetricPilot as build,
  verifyReadOnlyMetricPilot as verify,
  renderReadOnlyMetricPilot as render,
  PILOT_INTERNALS,
} from '../services/bi-control/src/business-bi/read-only-metric-pilot-protocol-v2.mjs';
const read = (p) => JSON.parse(readFileSync(p,'utf8'));
const fd = 'tests/fixtures/business-bi/ks250-metric-pilot';
const base = () => ({
  protocol: read(`${fd}/protocol-v1.json`),
  contexts: read(`${fd}/contexts-authorized-rehearsal-v1.json`),
  explanations: read(`${fd}/explanations-v1.json`),
  rows: read('tests/fixtures/business-bi/net-revenue-segment-v1.json').rows,
  sourceIdentity: read(`${fd}/source-identity-v1.json`),
  now: '2026-09-23T00:00:00.000Z',
});
const clone = (v) => structuredClone(v);
const relabel = (input) => {
  for (const e of input.explanations.explanations) e.declarationClass='HUMAN_READING';
  return input;
};
const missing = (state='MISSING') => ({state, permissionId:null, grantedAt:null, scopeNote:null});

test('T1: synthetic classification cannot be promoted by HUMAN_READING label, timing, or text', () => {
  for (const variant of ['label-only','new-text-and-timings']) {
    const input = relabel(base());
    if (variant==='new-text-and-timings') for (const e of input.explanations.explanations) {
      e.declaredNumberText='Untrusted declarative string, not a human observation';
      e.declaredSourceText='Synthetic source'; e.timings.setupMs=12;
    }
    const p=build(input);
    assert.equal(p.outcome,'PREPARED'); assert.equal(p.realPilotExecuted,false);
    assert.equal(p.schemaVersion,'kaleidosphere.business-bi/read-only-metric-pilot-package/v2');
    assert.equal(p.qualifiedContextCount,0);
    assert.equal(p.trust,'LOCAL_SYNTHETIC');
    for (const c of p.contexts) {
      assert.equal(c.realPilot,false); assert.equal(c.evidenceClass,null);
      assert.equal(c.realPilotStatus,'CONTRACT_LEVEL_ONLY');
      assert.equal(c.readiness,'CONTRACT_LEVEL_ONLY');
      assert.equal(c.explanation.humanComprehensionEvidence,false);
      assert.equal(c.explanation.declarationClass,'HUMAN_READING');
      assert.equal(c.rehearsal.realPilot,false);
    }
    assert.equal(p.secondContextReuse.state,'CONTRACT_LEVEL_ONLY');
    assert.equal(p.secondContextReuse.comparativeFindings,null);
    const checked=verify({...input,pilot:p,bindingDigest:p.bindingDigest});
    assert.equal(checked.outcome,'VERIFIED'); assert.equal(checked.realPilotExecuted,false);
    assert.doesNotMatch(render(p,'TABLE').text,/realPilotExecuted=true|REAL_READ_ONLY_PILOT/);
  }
});

test('T1 counterpart: unchanged authored fixtures still rehearse the existing metric path', () => {
  const input=base(); const p=build(input);
  assert.equal(p.outcome,'PREPARED'); assert.equal(p.realPilotExecuted,false);
  assert.equal(p.contexts[0].explanation.declarationClass,'AUTHORED_TEST_INPUT');
  // Independent fixture arithmetic, not the product's metric implementation.
  const oracle=(month)=>input.rows.filter(r=>r.order_date.startsWith(month)).reduce((total,r)=>
    total+(r.record_kind==='sale'?r.amount_minor_units:r.record_kind==='credit'?-r.amount_minor_units:0),0);
  const comparison=oracle('2026-06');const current=oracle('2026-07');
  assert.equal(p.contexts[0].rehearsal.numbers.comparisonNetMinorUnits,comparison);
  assert.equal(p.contexts[0].rehearsal.numbers.currentNetMinorUnits,current);
  assert.equal(p.contexts[0].rehearsal.numbers.deltaNetMinorUnits,current-comparison);
  assert.equal(verify({...input,pilot:p,bindingDigest:p.bindingDigest}).outcome,'VERIFIED');
  assert.equal(render(p,'JSON').outcome,'RENDERED');
});

test('T2: either missing or revoked permission blocks second-context reuse by exact named gate', () => {
  for (const index of [0,1]) for (const state of ['MISSING','REVOKED']) {
    const input=relabel(base());
    input.contexts.contexts[index].permission=missing(state);
    input.explanations.explanations=input.explanations.explanations.filter(e=>e.contextId!==input.contexts.contexts[index].contextId);
    const p=build(input);
    assert.equal(p.outcome,'PREPARED'); assert.equal(p.realPilotExecuted,false);
    assert.equal(p.secondContextReuse.state,'BLOCKED_EXTERNAL');
    assert.equal(p.secondContextReuse.code,index===0?'KS250_PILOT_BLOCKED_EXTERNAL:FIRST_CONTEXT_NOT_PERMITTED':'KS250_PILOT_BLOCKED_EXTERNAL:SECOND_CONTEXT_NOT_PERMITTED');
    assert.equal(p.secondContextReuse.additionalMappingCodeLines,null);
    assert.equal(p.secondContextReuse.specialCaseCount,null);
    assert.equal(p.secondContextReuse.comparativeFindings,null);
  }
});

test('T3: no mapping/special-case observation yields null with explicit UNKNOWN, never invented zero', () => {
  for (const input of [base(),relabel(base())]) {
    const p=build(input);
    assert.equal(p.secondContextReuse.additionalMappingCodeLines,null);
    assert.equal(p.secondContextReuse.specialCaseCount,null);
    assert.match(p.secondContextReuse.unmeasuredEffortReason,/^UNKNOWN:/);
    assert.equal(p.secondContextReuse.comparativeFindings,null);
    for (const c of p.contexts) {
      assert.deepEqual(Object.values(c.timings),[null,null,null,null]);
      assert.match(c.unmeasuredTimingReason,/^UNKNOWN:/);
    }
  }
});

test('binding: carried visible payload must equal independently rederived binding', () => {
  const input=base(); const p=build(input);
  for (const mutate of [
    q=>{q.realPilotExecuted=true;},
    q=>{q.contexts=clone(q.contexts);q.contexts[0].explanation.humanComprehensionEvidence=true;},
    q=>{q.secondContextReuse=clone(q.secondContextReuse);q.secondContextReuse.additionalMappingCodeLines=0;},
    q=>{q.bindingDigest='a'.repeat(64);},
    q=>{q.untrustedExtra='claim';},
    q=>{q.outcome='QUALIFIED';},
    q=>{q.code='OTHER';},
  ]) {
    const q=clone(p); mutate(q);
    const v=verify({...input,pilot:q,bindingDigest:p.bindingDigest});
    assert.equal(v.outcome,'DENIED');
    assert.equal(v.code,'KS250_PILOT_DENIED:PROTOCOL_DIGEST_MISMATCH');
    assert.equal(render(q,'JSON').outcome,'DENIED');
  }
});

test('binding: coherently resealed false real-pilot claim still fails independent rederivation', () => {
  const input=base(); const p=build(input); const q=clone(p);
  q.realPilotExecuted=true; q.binding.realPilotExecuted=true;
  q.bindingDigest=PILOT_INTERNALS.sha256(q.binding);
  assert.equal(verify({...input,pilot:q,bindingDigest:q.bindingDigest}).code,'KS250_PILOT_DENIED:PROTOCOL_DIGEST_MISMATCH');
  assert.equal(render(q,'JSON').code,'KS250_PILOT_DENIED:PROTOCOL_DIGEST_MISMATCH');
});

test('source identity: each context must identify the actual retained rehearsal bytes', () => {
  const input=base(); input.contexts.contexts[1].sourceIdentity.sourceBytesSha256=createHash('sha256').update('other context bytes').digest('hex');
  assert.equal(build(input).code,'KS250_PILOT_DENIED:CONTEXT_IDENTITY_SUBSTITUTED');
});

test('active CLI negative gates actually pass with nonzero exit for an unexpected gate', () => {
  const r=spawnSync(process.execPath,['scripts/run-read-only-metric-pilot.mjs','--negative'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr+r.stdout);
  assert.match(r.stdout,/negative gates: 24 executed, 0 unexpected/);
  assert.doesNotMatch(r.stdout,/UNEXPECTEDLY_ACCEPTED|THREW:/);
});

test('active CLI fails closed when a real negative gate is deliberately broken', () => {
  const original=readFileSync('scripts/run-read-only-metric-pilot.mjs','utf8');
  const absolute=pathToFileURL(resolve('services/bi-control/src/business-bi/read-only-metric-pilot-protocol-v2.mjs')).href;
  const variant=original.replace("'../services/bi-control/src/business-bi/read-only-metric-pilot-protocol-v2.mjs'",JSON.stringify(absolute))
    .replace("addGate('synthetic-human-label-not-real-pilot', 'true'","addGate('synthetic-human-label-not-real-pilot', 'deliberately-wrong-expected'");
  assert.notEqual(variant,original);
  const dir=mkdtempSync(join(tmpdir(),'ks250-v2-gate-'));
  try {
    const file=join(dir,'variant.mjs');writeFileSync(file,variant);
    const r=spawnSync(process.execPath,[file,'--negative'],{encoding:'utf8'});
    assert.equal(r.status,1,r.stdout+r.stderr);
    assert.match(r.stdout,/negative gates: 24 executed, 1 unexpected/);
    assert.match(r.stdout,/synthetic-human-label-not-real-pilot.*UNEXPECTEDLY_ACCEPTED/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('historical v1 source, authored fixtures and exact old CLI remain hash-frozen', () => {
  const record=read('docs/evidence/ks250-metric-pilot-v1-frozen.json');
  assert.equal(record.role,'HISTORICAL_REPLAY_ONLY_NOT_ACTIVE_QUALIFICATION');
  for(const [file,hash] of Object.entries(record.files))
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash,file);
});

test('active CLI preserves EOF admission and uses v2 on explicit existing fixture inputs', () => {
  const eof=spawnSync(process.execPath,['scripts/run-read-only-metric-pilot.mjs'],{encoding:'utf8'});
  assert.equal(eof.status,0);assert.match(eof.stdout,/pilot=null realPilotExecuted=false/);
  const r=spawnSync(process.execPath,['scripts/run-read-only-metric-pilot.mjs',
    '--protocol',`${fd}/protocol-v1.json`,'--contexts',`${fd}/contexts-authorized-rehearsal-v1.json`,
    '--explanations',`${fd}/explanations-v1.json`,'--source-identity',`${fd}/source-identity-v1.json`,
    '--source-rows','tests/fixtures/business-bi/net-revenue-segment-v1.json'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const p=JSON.parse(r.stdout.split('PILOT-RECEIPT ')[0]);
  assert.equal(p.schemaVersion,'kaleidosphere.business-bi/read-only-metric-pilot-package/v2');
  assert.equal(p.realPilotExecuted,false); assert.equal(p.secondContextReuse.additionalMappingCodeLines,null);
});
