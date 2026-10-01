import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd();
const entries=[
 ['scripts/run-net-revenue-f4-composition.mjs','F4_CLI_OUT_PATH_DENIED'],
 ['scripts/run-connected-net-revenue-journey.mjs','CONNECTED_CLI_OUT_PATH_DENIED'],
 ['scripts/run-guided-net-revenue-journey.mjs','GUIDED_CLI_OUT_PATH_DENIED'],
 ['scripts/run-net-revenue-journey.mjs','JOURNEY_CLI_OUT_PATH_DENIED'],
 ['scripts/emit-ks236-reader-task.mjs','KS236_READER_OUT_PATH_DENIED'],
];
const run=(cli,args=[],env=process.env)=>spawnSync(process.execPath,[cli,...args],{cwd:root,env,encoding:'utf8',input:'',timeout:30000});

test('reader v2: actual worksheet contains every null field required by grading, with all human fields blank',()=>{
 const r=run(entries[4][0]);assert.equal(r.status,0,r.stderr);
 const {worksheet:w,referenceAnswers:g}=JSON.parse(r.stdout);
 assert.equal(w.schemaVersion,'kaleidosphere.business-bi/ks236-reader-task/v2');
 assert.equal(w.readerFacing.sourceMode,'SYNTHETIC_FALLBACK');
 const f=w.readerFacing.figures;
 assert.deepEqual(Object.entries(f).filter(([,v])=>v===null).map(([k])=>k).sort(),['openOrderCount','openOrderValue','orderIntake']);
 const expectedNulls=g.T4.split(' are null:')[0].split(/, | and /).map(s=>s.trim()).sort();
 assert.deepEqual(expectedNulls,Object.keys(f).filter(k=>f[k]===null).sort());
 const c=w.comprehensionRecord;
 assert.equal(c.readerIdentity,null);assert.equal(c.readAt,null);assert.equal(c.sourceModeSeen,null);assert.equal(c.notes,null);
 assert.deepEqual(Object.keys(c.answers).sort(),['T1','T2','T3','T4','T5','T6','T7']);
 assert.deepEqual(Object.values(c.answers),Array(7).fill(null));
 assert.equal(Object.hasOwn(w.readerFacing,'referenceAnswers'),false);
 assert.equal(f.currentNetRevenueMinorUnits,f.comparisonNetRevenueMinorUnits+f.deltaNetRevenueMinorUnits);
 assert.match(w.provenance,/SYNTHETIC_FALLBACK/);
});

for(const [cli,code] of entries)test(`${cli}: exact task-private TMPDIR, honest output, prefix/ancestor/leaf/no-follow denials`,()=>{
 const sandbox=mkdtempSync(join(tmpdir(),'ks236-v2-boundary-'));const tmp=join(sandbox,'approved');const outside=join(sandbox,'outside');
 mkdirSync(tmp);mkdirSync(outside);const env={...process.env,TMPDIR:tmp,TMP:tmp,TEMP:tmp};
 const existing=join(outside,'existing.json');writeFileSync(existing,'untouched');
 try{
  const positive=join(tmp,'positive.json');const first=run(cli,['--out',positive],env);
  assert.equal(first.status,0,first.stderr);assert.equal(existsSync(positive),true);
  assert.doesNotThrow(()=>JSON.parse(readFileSync(positive,'utf8')));
  writeFileSync(positive,'old data');const overwrite=run(cli,['--out',positive],env);
  assert.equal(overwrite.status,0,overwrite.stderr);assert.notEqual(readFileSync(positive,'utf8'),'old data');
  const leaf=join(tmp,'existing-link.json');symlinkSync(existing,leaf);
  const danglingTarget=join(outside,'new.json');const dangling=join(tmp,'dangling.json');symlinkSync(danglingTarget,dangling);
  const ancestor=join(tmp,'ancestor');symlinkSync(outside,ancestor);
  const lookalike=tmp+'-evil';mkdirSync(lookalike);
  const repoLookalike=resolve(root+'-evil','must-not-create.json');
  for(const out of [leaf,dangling,join(ancestor,'leak.json'),join(lookalike,'leak.json'),join(outside,'leak.json'),repoLookalike,tmp,positive+'/not-a-directory.json']){
   const r=run(cli,['--out',out],env);assert.equal(r.status,1,`${out}: ${r.stderr}`);assert.match(r.stderr,new RegExp(code));
  }
  assert.equal(readFileSync(existing,'utf8'),'untouched');assert.equal(existsSync(danglingTarget),false);
  assert.equal(existsSync(join(outside,'leak.json')),false);assert.equal(existsSync(join(lookalike,'leak.json')),false);
  assert.equal(existsSync(repoLookalike),false);
  // An in-boundary symlink is also refused: lexical resolution is not authority to follow it.
  const insideTarget=join(tmp,'inside.json');writeFileSync(insideTarget,'still untouched');
  const insideLink=join(tmp,'inside-link.json');symlinkSync(insideTarget,insideLink);
  const inside=run(cli,['--out',insideLink],env);assert.equal(inside.status,1);assert.match(inside.stderr,new RegExp(code));
  assert.equal(readFileSync(insideTarget,'utf8'),'still untouched');
  // The configured directory is the policy, not an implicit extra inherited scratch root.
  // Even a deliberately broken guard can only write inside this authorized task sandbox.
  const denied=run(cli,['--out',join(sandbox,'implicit-extra-root.json')],env);
  assert.equal(denied.status,1);assert.match(denied.stderr,new RegExp(code));
  assert.equal(existsSync(join(sandbox,'implicit-extra-root.json')),false);
  const repoSandbox=mkdtempSync(join(root,'.ks236-v2-boundary-'));
  try{
   const repoOut=join(repoSandbox,'allowed.json');const repoResult=run(cli,['--out',repoOut],env);
   assert.equal(repoResult.status,0,repoResult.stderr);assert.doesNotThrow(()=>JSON.parse(readFileSync(repoOut,'utf8')));
  }finally{rmSync(repoSandbox,{recursive:true,force:true});}
 }finally{rmSync(sandbox,{recursive:true,force:true});}
});

test('roadmap distinguishes actually released F4/guided work from human acceptance',()=>{
 const doc=readFileSync('docs/ROADMAP.md','utf8');
 const section=doc.split('A positive local F4 composition')[1].split('## Candidate next capabilities')[0];
 assert.match(section,/2026_09_22_v2/);assert.match(section,/seed\/read/);
 assert.match(section,/human|reader/i);assert.doesNotMatch(section,/fixture mutations directly rather than database reads|not.*already publicly released/);
});
