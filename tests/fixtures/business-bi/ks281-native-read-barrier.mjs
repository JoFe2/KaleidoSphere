// Test-only scheduling barrier: native result transports and data readers unchanged.
// Pause the second Git qualification boundary after O2C's actual read, apply one
// actual authorized native RETURN_RECEIPT in a child, then allow later readers.
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function installNativeReadBarrier(sourceRoot,nativeRoot){
 const realGit=spawnSync('which',['git'],{encoding:'utf8'});
 if(realGit.status!==0)throw new Error('KS281_TEST_GIT_MISSING');
 const owned=mkdtempSync(join(tmpdir(),'ks281-native-barrier-')),priorPath=process.env.PATH;
 const writer=join(owned,'writer.mjs'),marker=join(owned,'applied.json'),counter=join(owned,'count'),trace=join(owned,'trace.jsonl');
 const moduleURL=pathToFileURL(join(sourceRoot,'src/pan515/trade-state.mjs')).href;
 writeFileSync(writer,`import * as trade from ${JSON.stringify(moduleURL)};
import {writeFileSync} from 'node:fs';
const root=${JSON.stringify(nativeRoot)};
const command={schemaVersion:'pansphaira.pan517/fulfilment-command/v1',effectId:'synthetic:ks281-return-01',transportId:'synthetic:ks281-native-barrier',expectedRevision:7,orderId:'SO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',unit:'STK',kind:'RETURN_RECEIPT',quantity:1,referenceId:'SH-01',physicalEvidenceId:'synthetic:ks281-evidence-03',effectiveAt:'2026-07-03T12:00:00+02:00',reason:'Actual disposable combined-read mismatch probe'};
trade.executePan515TradeCommand({root,command,grant:trade.authorizePan515TradeCommand({root,command,owner:'LOCAL_SYNTHETIC_OWNER'})});
writeFileSync(${JSON.stringify(marker)},JSON.stringify({actualNativeReturnApplied:true,expectedPriorRevision:7}));
`,{flag:'wx',mode:0o600});
 const wrapper=join(owned,'git');
 writeFileSync(wrapper,`#!${process.execPath}
const {spawnSync}=require('node:child_process'),fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({args})+'\\n');
if(args.includes('status')){
 const counter=${JSON.stringify(counter)};const count=fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8'))+1:1;fs.writeFileSync(counter,String(count));
 if(count===2){const applied=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(writer)}],{encoding:'utf8',timeout:10000});fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({writerStatus:applied.status,writerError:applied.error?.code,writerStderr:applied.stderr})+'\\n');if(applied.status!==0){process.stderr.write(applied.stderr);process.exit(1);}}
}
const result=spawnSync(${JSON.stringify(realGit.stdout.trim())},args,{encoding:'utf8',timeout:10000});process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exit(result.status??1);
`,{flag:'wx',mode:0o700});
 process.env.PATH=owned+':'+priorPath;
 return {observation:()=>JSON.parse(readFileSync(marker,'utf8')),diagnostic:()=>({counter:readOptional(counter),trace:readOptional(trace)}),close(){process.env.PATH=priorPath;rmSync(owned,{recursive:true,force:true});}};
}
function readOptional(path){try{return readFileSync(path,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}}
