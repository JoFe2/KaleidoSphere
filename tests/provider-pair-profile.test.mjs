import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const currentApi = await import('../services/bi-agent/src/external-api-v2.mjs');
test('J02 real provider entry binds deterministic artifact, attestation and only dispatchable operations', () => {
  const result=spawnSync(process.execPath,['scripts/describe-bi-provider.mjs'],{cwd:ROOT,encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
  const description=JSON.parse(result.stdout);
  assert.equal(description.schemaVersion,'superset-bi-agent.external/provider-profile/v1');
  assert.deepEqual(description.product,currentApi.capabilityAttestationV2().product);
  assert.equal(description.artifact.packageName,'@chimpmaera-bi/agent');
  assert.equal(description.artifact.packageSha256,'826bcc27fa1a59514001b550a8d07c2fd129bf68089ddc98bdf626b2eb346145');
  assert.deepEqual(description.attestations,[currentApi.capabilityAttestationV2()]);
  assert.deepEqual(description.allowedOperations.map(v=>v.action),['status','discovery','analyze','plan','preview','readback']);
  assert.equal(description.consumerProfile.attestation.digest,'sha256:203fab47d7f37110e6de37e71cd5d61f245baeb7ddcde17f3fa6b208c90d4378');
  assert.equal(description.registry.promotionPerformed,false);
  assert.equal(description.registry.blockedScope,'EXACT_HELD_PROFILE_ONLY');
  assert.equal(description.execution.standaloneAnalysisBlockedByHandshake,false);
  assert.deepEqual(description,currentApi.externalBiProviderProfileV1());
  assert.deepEqual(description,JSON.parse(readFileSync('contracts/analytics/provider-profile-v1.json','utf8')));
  const again=spawnSync(process.execPath,['scripts/describe-bi-provider.mjs'],{cwd:ROOT,encoding:'utf8',timeout:5000});
  assert.equal(again.stdout,result.stdout);
});
test('J02 checked provider profile rejects re-digested promotion, alien identity or undocumented operations', () => {
  const good=currentApi.externalBiProviderProfileV1();
  assert.deepEqual(currentApi.validateProviderProfileV1(good),good);
  const attempts=[p=>{p.product.version='v0.26.0';},p=>{p.artifact.packageName='alien';},p=>{p.allowedOperations.push({id:'undocumented',action:'undocumented',authority:'write'});},p=>{p.registry.promotionPerformed=true;},p=>{p.registry.blockedScope='ALL_HANDOFFS';},p=>{p.productFromUser=true;}];
  for(const change of attempts){const bad=structuredClone(good);change(bad);const {integrity,...body}=bad;bad.integrity={...integrity,digest:currentApi.sha256Digest(body)};assert.throws(()=>currentApi.validateProviderProfileV1(bad),/J02_PROVIDER_PROFILE_DRIFT_DENIED/);}
  assert.equal(Object.isFrozen(good),true);
  assert.equal(Object.isFrozen(good.allowedOperations[0]),true);
});
function artifactSnapshot() {
  const root = mkdtempSync(join(tmpdir(), 'ks-j02-artifact-'));
  cpSync(join(ROOT, 'services/bi-agent'), join(root, 'bi-agent'), {recursive:true});
  return root;
}
function run(root, expression, extraEnv={}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', expression], {
    cwd:root, encoding:'utf8', timeout:5000,
    env:{PATH:process.env.PATH,HOME:root,TMPDIR:process.env.TMPDIR ?? tmpdir(),...extraEnv},
  });
}
test('J02 root metadata, caller input and environment cannot substitute product identity',()=>{
  const root=artifactSnapshot();try{
    writeFileSync(join(root,'package.json'),JSON.stringify({name:'root',version:'99.99.99'})+'\n');
    const r=run(root,"import {externalBiProviderProfileV1} from './bi-agent/src/external-api-v2.mjs';console.log(JSON.stringify(externalBiProviderProfileV1({product:{version:'v999'}})))",{SBA_PRODUCT_VERSION:'v999',PRODUCT_VERSION:'v999'});
    assert.equal(r.status,0,r.stderr);const p=JSON.parse(r.stdout);assert.equal(p.product.version,'v0.18.1');assert.equal(p.artifact.packageVersion,'0.18.1');
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('J02 wrong service package version is denied rather than relabeled as root version',()=>{
  const root=artifactSnapshot();try{
    const path=join(root,'bi-agent/package.json');const raw=readFileSync(path,'utf8');writeFileSync(path,raw.replace('0.18.1','0.26.0'));
    const r=run(root,"import {capabilityAttestationV2} from './bi-agent/src/external-api-v2.mjs';console.log(JSON.stringify(capabilityAttestationV2()))");
    assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/J02_AGENT_ARTIFACT_DENIED/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('J02 provider CLI denies every identity override before returning any description',()=>{
  const r=spawnSync(process.execPath,['scripts/describe-bi-provider.mjs','--product-version','v999'],{cwd:ROOT,encoding:'utf8',timeout:5000});
  assert.equal(r.status,1);assert.deepEqual(JSON.parse(r.stdout),{outcome:'DENIED',reasonCode:'J02_PROVIDER_INPUT_DENIED',partialSuccess:false});
});
test('J02 actual attestation refuses a substituted agent artifact before advertising identity', () => {
  const root=artifactSnapshot();
  try {
    const path=join(root,'bi-agent/package.json');
    const pkg=JSON.parse(readFileSync(path,'utf8'));pkg.name='@synthetic/alien-agent';
    writeFileSync(path,JSON.stringify(pkg)+'\n');
    const result=run(root,"import {capabilityAttestationV2} from './bi-agent/src/external-api-v2.mjs';console.log(JSON.stringify(capabilityAttestationV2()))");
    assert.equal(result.status,1,result.stdout);
    assert.match(result.stderr,/J02_AGENT_ARTIFACT_DENIED/);
    assert.equal(result.stdout,'');
  } finally {rmSync(root,{recursive:true,force:true});}
});
