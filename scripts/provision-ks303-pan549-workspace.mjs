// Own immutable public input and isolated browser preparation; no global installs,
// provider/auth config writes, production/source-right grants or whole-PAN gate.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {accessSync,constants,existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,isAbsolute,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {loadPan549ExistingWorkspaceInputV1} from '../services/bi-control/src/assistant-foundation/pan549-existing-workspace-composition-v1.mjs';
import {loadPan520StockSourceV1} from '../services/bi-control/src/business-bi/pan520-stock-consumer.mjs';
const KS=resolve(fileURLToPath(new URL('../',import.meta.url))),commit='81de8d2cacfd6b697ebe2295aec8142812397ae8',tree='ffed01563de0d79b72bf552f30d22128bd52f778';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const args=process.argv.slice(2),mode=args.shift();assert.ok(['--prepare','--verify-existing'].includes(mode),'KS303_PROVISION_MODE_REQUIRED');
const options={};while(args.length){const key=args.shift(),value=args.shift();assert.ok(['--root','--pan-source','--k05-source','--browser-cache','--certutil','--evidence-dir','--output'].includes(key)&&value&&!options[key],'KS303_PROVISION_OPTIONS_DENIED');options[key]=value;}
const dir=value=>{assert.ok(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&realpathSync(value)===value&&lstatSync(value).isDirectory(),'KS303_EXACT_OWNED_DIRECTORY_REQUIRED');return value;};
const scratch=dir(process.env.TMPDIR);let root,pan,cache;
const env={PATH:process.env.PATH,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TMPDIR:scratch,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',npm_config_update_notifier:'false',npm_config_userconfig:'/dev/null'};
const run=(command,argv,cwd)=>{const p=spawnSync(command,argv,{cwd,env,encoding:'utf8',timeout:300000,maxBuffer:4*1024*1024});if(p.status!==0){process.stderr.write(p.stderr??'');throw new Error('KS303_REAL_PROVISION_FAILED: '+command+' exit '+p.status);}return (p.stdout??'').trim();};
if(mode==='--prepare'){
 assert.ok(options['--root']&&!options['--pan-source']&&!options['--browser-cache'],'KS303_PREPARE_OPTIONS_DENIED');root=resolve(options['--root']);const rel=relative(scratch,root);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel)&&!existsSync(root),'KS303_NEW_INVOCATION_ROOT_REQUIRED');mkdirSync(root,{mode:0o700});dir(root);
 for(const part of ['home','npm-cache','browser-cache','product-evidence'])mkdirSync(join(root,part),{mode:0o700});env.HOME=join(root,'home');env.npm_config_cache=join(root,'npm-cache');cache=join(root,'browser-cache');env.PLAYWRIGHT_BROWSERS_PATH=cache;pan=join(root,'pan');
 run('git',['init',pan],root);run('git',['-C',pan,'-c','credential.helper=','-c','http.extraheader=','fetch','--depth=1','https://github.com/JoFe2/PANSPHAIRA.git',commit],root);run('git',['-C',pan,'-c','core.hooksPath=/dev/null','checkout','--detach','FETCH_HEAD'],root);
 assert.equal(run('git',['-C',pan,'rev-parse','HEAD'],root),commit);assert.equal(run('git',['-C',pan,'rev-parse','HEAD^{tree}'],root),tree);
 run('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],pan);run('npm',['run','build'],pan);run('node',['scripts/build-pan541-browser.mjs'],pan);run('node',['node_modules/playwright/cli.js','install','chromium'],pan);
}else{
 assert.ok(options['--pan-source']&&options['--browser-cache']&&!options['--root'],'KS303_VERIFY_OPTIONS_DENIED');pan=dir(options['--pan-source']);cache=dir(options['--browser-cache']);env.HOME=process.env.HOME;env.PLAYWRIGHT_BROWSERS_PATH=cache;
}
const ksSource=dir(options['--k05-source']??process.env.KS285_PAN520_SOURCE);const certutil=options['--certutil'];assert.ok(certutil&&isAbsolute(certutil)&&realpathSync(certutil)===certutil&&lstatSync(certutil).isFile(),'KS303_INVOCATION_CERTUTIL_REQUIRED');accessSync(certutil,constants.X_OK);
await loadPan549ExistingWorkspaceInputV1({sourceRoot:pan});await loadPan520StockSourceV1({sourceRoot:ksSource});
// Resolver reads only the already installed locked Playwright package and cache.
const executable=run('node',['--input-type=module','-e','import {chromium} from "./node_modules/playwright/index.mjs";console.log(chromium.executablePath())'],pan);assert.ok(executable.startsWith(cache+'/')&&lstatSync(executable).isFile(),'KS303_LOCKED_CHROMIUM_NOT_FOUND');accessSync(executable,constants.X_OK);
const evidence=dir(options['--evidence-dir']??join(root,'product-evidence'));const output=options['--output'];assert.ok(output&&isAbsolute(output)&&resolve(output)===output&&!existsSync(output),'KS303_NEW_OUTPUT_RECEIPT_REQUIRED');
const productEnv={...Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','HOME','PLAYWRIGHT_BROWSERS_PATH'].map(k=>[k,env[k]])),KS303_PAN549_SOURCE_ROOT:pan,KS303_K05_SOURCE_ROOT:ksSource,KS303_PLAYWRIGHT_MODULE:pathToFileURL(join(pan,'node_modules/playwright/index.mjs')).href,KS303_CHROMIUM_EXECUTABLE:executable,KS303_CERTUTIL:certutil,KS303_BROWSER_EVIDENCE_DIR:evidence,KS303_REQUIRE_REAL_WORKSPACE:'1'};
writeFileSync(output,JSON.stringify({schemaVersion:'kaleidosphere/ks303-owned-existing-workspace-provision/v1',atUtc:new Date().toISOString(),mode,publicPANCommit:commit,publicPANTree:tree,qualifiedPANHandle:true,qualifiedSeparateK05Handle:true,globalInstallOrTrustOrAuthWrite:false,wholePANGate:false,productEnv,bytePins:{script:sha(readFileSync(join(pan,'dist/browser-workspace/app.js'))),chromium:sha(readFileSync(executable)),certutil:sha(readFileSync(certutil)),manifest:sha(readFileSync(join(KS,'contracts/dependencies/pan549-stock-workspace-v1/workspace-byte-closure-v39.json')))}},null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Actual existing public PAN/K05 handles and locked browser qualified; receipt '+output);
