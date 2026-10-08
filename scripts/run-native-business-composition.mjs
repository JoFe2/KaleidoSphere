// Trusted local owner CLI; JSON input never creates source/tenant/role authority.
import {openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {createNativeBusinessCompositionV1} from '../services/bi-control/src/business-bi/native-business-composition-v1.mjs';
let result;
try{
 const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--request-file')throw new Error('KS281_CLI_INPUT_DENIED');
 const fd=openSync(args[1],constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 let bytes;
 try{
  const state=fstatSync(fd);if(!state.isFile()||state.size>8192)throw new Error('KS281_CLI_INPUT_DENIED');
  const buffer=Buffer.alloc(8193);let count=0,n;
  while(count<buffer.length&&(n=readSync(fd,buffer,count,buffer.length-count,null))!==0)count+=n;
  if(count>8192)throw new Error('KS281_CLI_INPUT_DENIED');bytes=buffer.subarray(0,count);
 }finally{closeSync(fd);}
 const consumer=await createNativeBusinessCompositionV1(JSON.parse(bytes.toString('utf8')));
 result=consumer.read();
}catch(error){
 const reasonCode=/^(?:KS281|K03|K04|K05)_[A-Z0-9_]+$/.test(error.message)?error.message:'KS281_EXECUTION_DENIED';
 result={schema:'kaleidosphere/native-business-composition/v1',outcome:'DENIED',reasonCode,components:null,sharedSnapshot:null,stateVersion:0,previousQualifiedHeld:false,readOnly:true,persistentMutation:false,partialSuccess:false};
}
process.stdout.write(JSON.stringify(result)+'\n');
process.exitCode=result.outcome==='READ_COMPLETE_WITH_UNAVAILABLE_FACTS'?0:2;
