// Only authored synthetic test rows. No real source packet, owner grant, source IDs or human answers.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyzeIssueStateSnapshot, verifyIssueStateSnapshot, prepareIssueSnapshotReaderTask } from '../services/bi-control/src/business-bi/issue-state-snapshot-metric.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const root = path.resolve(import.meta.dirname, '..');
const copy = v => JSON.parse(JSON.stringify(v));
function inputs(rows) {
  const source = { repositoryId: 'synthetic-repository-id', issues: rows ?? [
    { id: 'synthetic-issue-a', number: 1, state: 'OPEN', createdAt: '2026-01-01T01:00:00Z', updatedAt: '2026-01-02T00:00:00Z', closedAt: null },
    { id: 'synthetic-issue-b', number: 2, state: 'CLOSED', createdAt: '2026-01-01T01:00:00Z', updatedAt: '2026-01-02T00:00:00Z', closedAt: '2026-01-02T00:00:00Z' },
    { id: 'synthetic-issue-c', number: 3, state: 'OPEN', createdAt: '2026-01-01T01:00:00Z', updatedAt: '2026-01-02T00:00:00Z', closedAt: null },
  ] };
  const sourceBytes = JSON.stringify(source);
  const permission = { schemaVersion: 'kaleidosphere.business-bi/issue-snapshot-permission/v1', contextId: 'synthetic-context', repositoryId: source.repositoryId, sourceBytesSha256: hash(sourceBytes), access: 'READ_ONLY_FROZEN_SNAPSHOT', allowedFields: ['id', 'number', 'state', 'createdAt', 'updatedAt', 'closedAt'], grantId: hash('authored test grant; not real owner authority'), grantedAt: '2026-01-01T00:00:00Z', secondContextApproved: false };
  const capture = { schemaVersion: 'kaleidosphere.business-bi/issue-snapshot-capture/v1', sourceBytesSha256: hash(sourceBytes), startedAt: '2026-01-02T00:00:00Z', finishedAt: '2026-01-02T00:00:01Z', atomic: false, pages: [{ rows: source.issues.length, totalCount: source.issues.length, hasNextPage: false }] };
  return { sourceBytes, permission, capture };
}
function rebind(x, mutate) { const s=JSON.parse(x.sourceBytes); mutate(s); x.sourceBytes=JSON.stringify(s); x.permission.sourceBytesSha256=hash(x.sourceBytes); x.capture.sourceBytesSha256=hash(x.sourceBytes); return x; }
function denied(x, code) { assert.deepEqual(analyzeIssueStateSnapshot(x), { outcome: 'DENIED', code: `KS250_ISSUE_SNAPSHOT_DENIED:${code}` }); }

test('fixed-domain actual product path counts authored states, not sales; no unsupported acceptance or raw rows', () => {
  const x=inputs(); const result=analyzeIssueStateSnapshot(x);
  assert.equal(result.outcome,'ANALYZED_FROZEN_SNAPSHOT');
  assert.deepEqual(result.counts,{totalIssues:3,capturedOpenIssues:2,capturedClosedIssues:1});
  for(const key of ['sourceAuthenticityVerifiedByProduct','independentBusinessDefinitionConfirmed','humanComprehensionObserved','realPilotQualified','secondContextExecuted']) assert.equal(result[key],false);
  assert.equal(result.historicalAsOfOpenBalance,null);assert.deepEqual(Object.values(result.observedHumanEffort),[null,null,null,null]);
  assert.equal(result.capture.atomic,false);assert.equal(JSON.stringify(result).includes('synthetic-issue-a'),false);
  assert.equal(JSON.stringify(result).includes('synthetic-repository-id'),false);
});
test('empty captured population is zero, not a missing input or unmeasured-effort zero',()=>{
  const r=analyzeIssueStateSnapshot(inputs([]));assert.deepEqual(r.counts,{totalIssues:0,capturedOpenIssues:0,capturedClosedIssues:0});assert.equal(r.observedHumanEffort.setupMs,null);
});
test('closed-only and open-only populations use independent exact expected counts',()=>{
  const s=JSON.parse(inputs().sourceBytes);assert.deepEqual(analyzeIssueStateSnapshot(inputs([s.issues[1]])).counts,{totalIssues:1,capturedOpenIssues:0,capturedClosedIssues:1});
  assert.deepEqual(analyzeIssueStateSnapshot(inputs([s.issues[0]])).counts,{totalIssues:1,capturedOpenIssues:1,capturedClosedIssues:0});
});
test('non-atomic complete multipage input admitted, duplicate source rows denied without silently deduplicating',()=>{
  const x=inputs();x.capture.pages=[{rows:2,totalCount:3,hasNextPage:true},{rows:1,totalCount:3,hasNextPage:false}];assert.equal(analyzeIssueStateSnapshot(x).capture.pageCount,2);
  denied(rebind(inputs(),s=>s.issues[1].id=s.issues[0].id),'DUPLICATE_ISSUE');denied(rebind(inputs(),s=>s.issues[1].number=s.issues[0].number),'DUPLICATE_ISSUE');
});
test('a retained prior close time on a currently OPEN issue does not fabricate history',()=>{
  const x=rebind(inputs(),s=>s.issues[0].closedAt='2026-01-01T12:00:00Z');assert.equal(analyzeIssueStateSnapshot(x).counts.capturedOpenIssues,2);assert.equal(analyzeIssueStateSnapshot(x).historicalAsOfOpenBalance,null);
});
test('close timestamp after update is preserved as a caveat, not silently repaired or excluded',()=>{
  const x=rebind(inputs(),s=>s.issues[1].closedAt='2026-01-02T00:00:01Z');const r=analyzeIssueStateSnapshot(x);
  assert.deepEqual(r.counts,{totalIssues:3,capturedOpenIssues:2,capturedClosedIssues:1});assert.equal(r.timestampCaveats.closedAtAfterUpdatedCount,1);
});
test('required independent inputs never default to synthetic fixture/permission',()=>{denied({},'INPUT_REQUIRED');const x=inputs();delete x.permission;denied(x,'INPUT_REQUIRED');});
for(const [name,mutate,code] of [
  ['revoked access',x=>x.permission.access='REVOKED','PERMISSION_SCOPE'],
  ['second-source label',x=>x.permission.secondContextApproved=true,'PERMISSION_SCOPE'],
  ['widened field scope',x=>x.permission.allowedFields.push('body'),'PERMISSION_SCOPE'],
  ['duplicate field allowance',x=>x.permission.allowedFields.push('state'),'PERMISSION_SCOPE'],
  ['credential permission field',x=>x.permission.token='synthetic-token','PERMISSION_SCOPE'],
  ['changed source bytes',x=>x.sourceBytes+=' ','SOURCE_BYTES_MISMATCH'],
  ['wrong repository identity',x=>x.permission.repositoryId='other-repository','SOURCE_IDENTITY'],
  ['atomic claim',x=>x.capture.atomic=true,'CAPTURE_BOUNDARY'],
  ['source hash substitution',x=>x.capture.sourceBytesSha256=hash('other'),'CAPTURE_BOUNDARY'],
  ['late grant',x=>x.permission.grantedAt='2026-01-03T00:00:00Z','CAPTURE_BOUNDARY'],
  ['reverse capture interval',x=>x.capture.startedAt='2026-01-03T00:00:00Z','CAPTURE_BOUNDARY'],
  ['unfinished pagination',x=>x.capture.pages[0].hasNextPage=true,'PAGINATION'],
  ['declared row count mismatch',x=>x.capture.pages[0].rows=2,'PAGINATION'],
  ['changing page totals',x=>x.capture.pages=[{rows:2,totalCount:3,hasNextPage:true},{rows:1,totalCount:4,hasNextPage:false}],'PAGINATION'],
  ['future row timestamp',x=>rebind(x,s=>s.issues[0].updatedAt='2026-01-03T00:00:00Z'),'ROW_TIME'],
  ['impossible calendar day',x=>rebind(x,s=>s.issues[0].createdAt='2026-02-30T00:00:00Z'),'ROW_TIME'],
  ['calendar normalization',x=>rebind(x,s=>s.issues[0].createdAt='2026-01-01T24:00:00Z'),'ROW_TIME'],
  ['unrecognized state',x=>rebind(x,s=>s.issues[0].state='UNKNOWN'),'ROW_STATE'],
  ['PR-shaped extra field',x=>rebind(x,s=>s.issues[0].isPullRequest=true),'ROW_FIELDS'],
  ['content field',x=>rebind(x,s=>s.issues[0].body='not permitted'),'ROW_FIELDS'],
  ['author field',x=>rebind(x,s=>s.issues[0].author={login:'synthetic-author'}),'ROW_FIELDS'],
  ['unsafe number',x=>rebind(x,s=>s.issues[0].number=Number.MAX_SAFE_INTEGER+1),'ROW_ID'],
  ['closed without close time',x=>rebind(x,s=>s.issues[1].closedAt=null),'ROW_TIME'],
  ['closed after capture time',x=>rebind(x,s=>s.issues[1].closedAt='2026-01-03T00:00:00Z'),'ROW_TIME'],
  ['unscoped root contents',x=>rebind(x,s=>s.contents=[]),'SOURCE_FIELDS'],
]) test(`exact denial: ${name}`,()=>{const x=inputs();mutate(x);denied(x,code);});
test('malformed JSON denial after independent source binding, not an arbitrary thrown exception',()=>{
  const x=inputs();x.sourceBytes='{';x.permission.sourceBytesSha256=hash(x.sourceBytes);x.capture.sourceBytesSha256=hash(x.sourceBytes);denied(x,'SOURCE_JSON');
});
test('verification rederives all visible content from retained inputs; a forged/resealed output is rejected',()=>{
  const x=inputs();const carried=analyzeIssueStateSnapshot(x);assert.equal(verifyIssueStateSnapshot({...x,carried}).outcome,'VERIFIED');
  const forged=copy(carried);forged.counts.capturedOpenIssues=99;assert.equal(verifyIssueStateSnapshot({...x,carried:forged}).code,'KS250_ISSUE_SNAPSHOT_DENIED:CARRIED_RESULT_MISMATCH');
  forged.bindingDigest=hash(JSON.stringify(forged));assert.equal(verifyIssueStateSnapshot({...x,carried:forged}).outcome,'DENIED');
});
test('#236 reader artifact derives actual displayed product figures and separates every blank human slot from grading',()=>{
  const x=inputs();const product=analyzeIssueStateSnapshot(x);const p=prepareIssueSnapshotReaderTask(x);
  assert.equal(p.worksheet.schemaVersion,'kaleidosphere.business-bi/ks236-reader-task/v2');
  assert.equal(p.worksheet.readerFacing.figures.capturedOpenIssues,product.counts.capturedOpenIssues);
  assert.equal(p.worksheet.readerFacing.resultBindingDigest,product.bindingDigest);
  assert.equal('referenceAnswers' in p.worksheet,false);assert.deepEqual(Object.values(p.worksheet.comprehensionRecord.answers),[null,null,null,null,null]);
  for(const [k,v] of Object.entries(p.worksheet.comprehensionRecord))if(k!=='answers')assert.equal(v,null);
  assert.match(p.referenceAnswers.T1,/^2 distinct/);assert.match(p.referenceAnswers.T4,/not zero/);
});
// KS250-FINAL-01: exact microsecond regressions and permitted boundary counterparts.
for (const [name, mutate, code] of [
  ['late grant microsecond', x => x.permission.grantedAt='2026-01-02T00:00:00.000001Z', 'CAPTURE_BOUNDARY'],
  ['reverse capture microsecond', x => x.capture.startedAt='2026-01-02T00:00:01.000001Z', 'CAPTURE_BOUNDARY'],
  ['future update microsecond', x => rebind(x,s => s.issues[0].updatedAt='2026-01-02T00:00:01.000001Z'), 'ROW_TIME'],
  ['future close microsecond', x => rebind(x,s => s.issues[1].closedAt='2026-01-02T00:00:01.000001Z'), 'ROW_TIME'],
  ['created after updated microsecond', x => rebind(x,s => s.issues[0].createdAt='2026-01-02T00:00:00.000001Z'), 'ROW_TIME'],
  ['closed before created microsecond', x => rebind(x,s => {s.issues[1].createdAt='2026-01-01T00:00:00.000002Z';s.issues[1].closedAt='2026-01-01T00:00:00.000001Z';}), 'ROW_TIME'],
]) test(`KS250-FINAL-01: ${name}`,()=>{const x=inputs();mutate(x);denied(x,code);});
test('KS250-FINAL-01: positive sub-millisecond caveat is counted without modifying captured bytes',()=>{
  const x=rebind(inputs(),s=>s.issues[1].closedAt='2026-01-02T00:00:00.000001Z');const bytes=x.sourceBytes;
  const r=analyzeIssueStateSnapshot(x);assert.equal(r.outcome,'ANALYZED_FROZEN_SNAPSHOT');assert.equal(r.timestampCaveats.closedAtAfterUpdatedCount,1);
  assert.equal(x.sourceBytes,bytes);assert.equal(r.sourceBytesSha256,hash(bytes));
});
test('KS250-FINAL-01: equal exact microsecond grant/start/end boundaries remain admitted',()=>{
  const x=inputs();x.permission.grantedAt=x.capture.startedAt=x.capture.finishedAt='2026-01-02T00:00:00.000001Z';
  const r=analyzeIssueStateSnapshot(x);assert.equal(r.outcome,'ANALYZED_FROZEN_SNAPSHOT');assert.equal(r.capture.startedAt,x.capture.startedAt);
});
test('KS250-FINAL-01: equivalent offset microseconds compare equally and preserve original strings',()=>{
  const x=rebind(inputs(),s=>{for(const r of s.issues){r.updatedAt='2026-01-02T00:00:00.000001Z';if(r.state==='CLOSED')r.closedAt='2026-01-02T01:00:00.000001+01:00';}});
  x.permission.grantedAt='2026-01-02T02:00:00.000001+02:00';x.capture.startedAt='2026-01-02T00:00:00.000001Z';x.capture.finishedAt='2026-01-02T01:00:00.000001+01:00';
  const r=analyzeIssueStateSnapshot(x);assert.equal(r.outcome,'ANALYZED_FROZEN_SNAPSHOT');assert.equal(r.timestampCaveats.closedAtAfterUpdatedCount,0);
  assert.equal(r.capture.finishedAt,x.capture.finishedAt);assert.equal(r.sourceBytesSha256,hash(x.sourceBytes));
});
test('KS250-FINAL-01: pre-epoch microseconds keep signed order rather than unsafe floating epoch arithmetic',()=>{
  const x=rebind(inputs(),s=>{for(const r of s.issues){r.createdAt='1969-12-31T23:59:58Z';r.updatedAt='1969-12-31T23:59:59.999998Z';if(r.state==='CLOSED')r.closedAt='1969-12-31T23:59:59.999999Z';}});
  x.permission.grantedAt=x.capture.startedAt='1969-12-31T23:59:59.999998Z';x.capture.finishedAt='1969-12-31T23:59:59.999999Z';
  assert.equal(analyzeIssueStateSnapshot(x).timestampCaveats.closedAtAfterUpdatedCount,1);
  x.permission.grantedAt='1970-01-01T00:00:00Z';denied(x,'CAPTURE_BOUNDARY');
});

test('existing installable CLI executes snapshot / verify / reader modes and closed-world flag denials without writes/network',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'ks250-issue-snapshot-'));
  try {
    const x=inputs();const source=path.join(dir,'source.json'),permission=path.join(dir,'permission.json'),capture=path.join(dir,'capture.json'),binding=path.join(dir,'binding.json');
    writeFileSync(source,x.sourceBytes);writeFileSync(permission,JSON.stringify(x.permission));writeFileSync(capture,JSON.stringify(x.capture));
    const args=['scripts/run-read-only-metric-pilot.mjs','--issue-snapshot',source,'--issue-permission',permission,'--issue-capture',capture];
    const run=a=>spawnSync(process.execPath,a,{cwd:root,encoding:'utf8'});
    let r=run(args);assert.equal(r.status,0,r.stderr);const actual=JSON.parse(r.stdout);assert.equal(actual.counts.capturedOpenIssues,2);writeFileSync(binding,JSON.stringify(actual));
    r=run([...args,'--verify','--binding',binding]);assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).outcome,'VERIFIED');
    r=run([...args,'--reader-task']);assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).worksheet.comprehensionRecord.readAt,null);
    for(const a of [[...args,'--source-rows',source],[...args,'--token','synthetic'],[...args,'--verify'],[...args,'--reader-task','--verify','--binding',binding],[...args,'--binding',binding],[...args,'--issue-snapshot',source]]) {r=run(a);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).outcome,'DENIED');assert.equal(r.stderr,'');}
    r=run(['scripts/run-read-only-metric-pilot.mjs','--issue-snapshot',source]);assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).code,'KS250_ISSUE_SNAPSHOT_DENIED:INPUT_REQUIRED');
    // Existing EOF behavior stays a missing-input denial, not a snapshot default.
    const eof=execFileSync(process.execPath,['scripts/run-read-only-metric-pilot.mjs'],{cwd:root,encoding:'utf8'});assert.match(eof,/mode=eof pilot=null realPilotExecuted=false/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
