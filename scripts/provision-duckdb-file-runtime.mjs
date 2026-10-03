#!/usr/bin/env node
// Installation is an explicit, task-private setup step, never part of analysis.
import { parseArgs } from 'node:util';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, lstatSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { verifyDuckdbRuntime } from '../services/bi-control/src/db-analyzer/duckdb-file-workflow.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
try {
  const {values}=parseArgs({options:{install:{type:'boolean'},verify:{type:'boolean'},'runtime-root':{type:'string',default:join(root,'.ks-file-runtime')}},strict:true,allowPositionals:false});
  if(Boolean(values.install)===Boolean(values.verify))throw new Error('K02_PROVISION_MODE_DENIED');
  if(process.platform!=='linux'||process.arch!=='x64'||!process.report.getReport().header.glibcVersionRuntime||process.versions.node.split('.')[0]!=='24')throw new Error('K02_PROVISION_PLATFORM_DENIED');
  const runtimeRoot=resolve(values['runtime-root']);
  if(values.install) {
    if(runtimeRoot!==join(root,'.ks-file-runtime'))throw new Error('K02_PROVISION_INSTALL_ROOT_DENIED');
    if(existsSync(runtimeRoot)&&(!lstatSync(runtimeRoot).isDirectory()||lstatSync(runtimeRoot).isSymbolicLink()||existsSync(join(runtimeRoot,'node_modules'))))throw new Error('K02_PROVISION_EXISTING_ROOT_DENIED');
    mkdirSync(runtimeRoot,{recursive:true});
    for(const file of ['package.json','package-lock.json'])copyFileSync(join(root,'dependencies/ks-file-runtime',file),join(runtimeRoot,file));
    const home=mkdtempSync(join(tmpdir(),'ks284-npm-'));
    try {
      const config=join(home,'user.npmrc'),globalConfig=join(home,'global.npmrc');writeFileSync(config,'');writeFileSync(globalConfig,'');
      const p=spawnSync('npm',['ci','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--userconfig',config,'--globalconfig',globalConfig,'--cache',join(home,'cache')],{cwd:runtimeRoot,encoding:'utf8',timeout:120000,maxBuffer:1048576,env:{PATH:process.env.PATH,HOME:home,TMPDIR:home}});
      if(p.error||p.signal||p.status!==0)throw new Error('K02_PROVISION_INSTALL_DENIED');
    } finally {rmSync(home,{recursive:true,force:true});}
  }
  const {lock}=verifyDuckdbRuntime(root,runtimeRoot);
  const declared=JSON.parse(readFileSync(join(root,'dependencies/ks-file-runtime/package.json')));
  const packages=JSON.parse(readFileSync(join(root,'dependencies/ks-file-runtime/package-lock.json'))).packages;
  if(declared.dependencies['@duckdb/node-api']!==lock.clientVersion||packages['node_modules/@duckdb/node-api'].version!==lock.clientVersion||packages['node_modules/@duckdb/node-bindings'].version!==lock.clientVersion||packages['node_modules/@duckdb/node-bindings-linux-x64'].version!==lock.clientVersion)throw new Error('K02_RUNTIME_IDENTITY_DENIED');
  process.stdout.write(JSON.stringify({outcome:'VERIFIED',clientVersion:lock.clientVersion,engineVersion:lock.engineVersion,closureSha256:lock.closureSha256,files:Object.keys(lock.files).length,engineLoaded:false})+'\n');
} catch(error) {
  const reasonCode=/^K02_[A-Z_]+$/.test(error?.message??'')?error.message:'K02_RUNTIME_IDENTITY_DENIED';
  process.stdout.write(JSON.stringify({outcome:'DENIED',reasonCode,engineLoaded:false})+'\n');process.exitCode=1;
}
