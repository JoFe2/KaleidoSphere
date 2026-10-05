// Fixed-argument opt-in local owner CLI; no account, shell or hosted authority.
import {openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {isAbsolute,resolve,dirname,basename} from 'node:path';
import {exportH08BundleV1} from '../../services/bi-control/src/hosting/portable-runtime.mjs';
import {createH08PortableLifecycleV1,openH08PortableLifecycleV1} from '../../services/bi-control/src/hosting/portable-runtime-lifecycle.mjs';
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
function path(value){if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value.length>4096||/[\x00-\x1f\x7f]/.test(value))fail('H08_CLI_PATH_DENIED');return value;}
function readKey(value){path(value);let directory=openSync('/',constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK),file;
 try{for(const part of dirname(value).split('/').filter(Boolean)){const next=openSync('/proc/self/fd/'+directory+'/'+part,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);closeSync(directory);directory=next;}
 file=openSync('/proc/self/fd/'+directory+'/'+basename(value),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const st=fstatSync(file);
 if(!st.isFile()||st.uid!==process.getuid()||st.nlink!==1||(st.mode&0o077)!==0||st.size!==32)fail('H08_CLI_PRIVATE_KEY_REQUIRED');
 const bytes=Buffer.alloc(33);let n=0;while(n<bytes.length){const got=readSync(file,bytes,n,bytes.length-n,null);if(!got)break;n+=got;}if(n!==32){bytes.fill(0);fail('H08_CLI_PRIVATE_KEY_REQUIRED');}return bytes.subarray(0,32);
 }finally{if(file!==undefined)closeSync(file);closeSync(directory);}}
function parse(args){const action=args.shift();if(!['export','restore','inspect','tombstone','cleanup'].includes(action))fail('H08_CLI_ACTION_DENIED');
 const allowed=new Set(['--local-synthetic-opt-in','--key-file','--bundle',...(action==='export'?['--receipt-dir']:['--target-root','--generation'])]);const values={};
 while(args.length){const name=args.shift();if(!allowed.has(name)||Object.hasOwn(values,name))fail('H08_CLI_OPTIONS_DENIED');if(name==='--local-synthetic-opt-in'){values[name]=true;continue;}const value=args.shift();if(typeof value!=='string'||value.startsWith('--'))fail('H08_CLI_OPTIONS_DENIED');values[name]=value;}
 if(values['--local-synthetic-opt-in']!==true)fail('H08_OPT_IN_REQUIRED');if([...allowed].some(name=>!Object.hasOwn(values,name)))fail('H08_CLI_OPTIONS_DENIED');
 for(const name of ['--key-file','--bundle',action==='export'?'--receipt-dir':'--target-root'])path(values[name]);
 if(action!=='export'&&!/^[a-f0-9]{64}$/.test(values['--generation']))fail('H08_CLI_GENERATION_DENIED');
 return{action,values};}
let secret,handle;
try{const {action,values}=parse(process.argv.slice(2));secret=readKey(values['--key-file']);const options={optIn:true,key:secret,bundlePath:values['--bundle'],targetRoot:values['--target-root'],expectedGeneration:values['--generation']};let result;
 if(action==='export')result=exportH08BundleV1({...options,receiptDir:values['--receipt-dir']});
 else{handle=action==='restore'?createH08PortableLifecycleV1(options):openH08PortableLifecycleV1(options);result=action==='tombstone'?handle.tombstone(options.expectedGeneration):action==='cleanup'?handle.cleanup(options.expectedGeneration):handle.inspect();}
 console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({state:'DENIED',reason:/^H08_[A-Z0-9_]+$/.test(error.code??'')?error.code:'H08_CLI_FAILED',runtimeReadyClaimed:false}));process.exitCode=1;
}finally{if(handle)handle.close();if(secret)secret.fill(0);}
