#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {deriveProcurementV1} from '../services/bi-control/src/business-bi/procurement-analysis.mjs';
import {buildProcurementViewsV1} from '../services/bi-control/src/business-bi/procurement-analysis-views.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function readBoundedRegular(relativePath,maxBytes) {
  const metadataPath='contracts/business-bi/v1/synthetic-p2p-fixture-routes-v1.json';
  if(typeof relativePath!=='string'||(relativePath!==metadataPath&&!/^examples\/p2p\/[a-z0-9-]+\.json$/.test(relativePath)))throw new Error('K04_SOURCE_DENIED');
  let fd,directory;
  try {
    // Linux v1 qualification: pin each parent directory and never follow a replaced symlink.
    const dirFlags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
    directory=openSync(ROOT,dirFlags);const parts=relativePath.split('/');
    for(const component of parts.slice(0,-1)){
      const next=openSync('/proc/self/fd/'+directory+'/'+component,dirFlags);closeSync(directory);directory=next;
    }
    fd=openSync('/proc/self/fd/'+directory+'/'+parts.at(-1),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=fstatSync(fd);if(!stat.isFile()||stat.size>maxBytes)throw new Error('K04_SOURCE_DENIED');
    const bytes=Buffer.alloc(stat.size+1);let offset=0;
    while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)break;offset+=n;}
    if(offset!==stat.size)throw new Error('K04_SOURCE_DENIED');
    return bytes.subarray(0,offset);
  } catch {throw new Error('K04_SOURCE_DENIED');}
  finally {if(fd!==undefined)closeSync(fd);if(directory!==undefined)closeSync(directory);}
}
try{
 const {values}=parseArgs({options:{fixture:{type:'string'},view:{type:'string'},'producer-source':{type:'string'},'native-root':{type:'string'},'as-of':{type:'string'}},strict:true});
 const view=values.view??'all';if(!['all','aggregate','chart','drilldown','export'].includes(view))throw new Error('K04_VIEW_DENIED');
 if(values['native-root']!==undefined){
  if(values.fixture!==undefined)throw new Error('K04_MODE_DENIED');
  const {loadPan520P2pSourceV1,capturePan520P2pPlanV1,executePan520P2pReadV1}=await import('../services/bi-control/src/business-bi/pan520-p2p-consumer.mjs');
  const sourceRoot=values['producer-source']??process.env.KS286_PAN520_SOURCE;if(!sourceRoot)throw new Error('K04_SOURCE_DENIED');
  const source=await loadPan520P2pSourceV1({sourceRoot}),request={schemaVersion:'pansphaira.pan520/projection-request/v1',profile:'P2P',scope:{sourceId:'SYN-COMMON',tenantId:'SYN-TENANT-01',entityId:'SYN-ENTITY-01',orderId:'PO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',currency:'EUR',unit:'STK'},questions:['PROCUREMENT_QUANTITY','PROCUREMENT_PRICE_VARIANCE','PROCUREMENT_TIMELINESS']};
  const result=executePan520P2pReadV1(capturePan520P2pPlanV1({source,nativeRoot:values['native-root'],request,...(values['as-of']!==undefined?{asOf:values['as-of']}:{})}));
  if(result.outcome==='DENIED')throw new Error(result.reasonCode);
  if(view==='chart')process.stdout.write(result.chart.svg);else if(view==='export')process.stdout.write(result.export.csv);else process.stdout.write(JSON.stringify(view==='all'?result:{...result,chart:undefined,export:undefined,...(view==='aggregate'?{drilldown:undefined}:{})})+'\n');
 }else{
 if(values['producer-source']!==undefined||values['as-of']!==undefined)throw new Error('K04_MODE_DENIED');
 const route=JSON.parse(readBoundedRegular('contracts/business-bi/v1/synthetic-p2p-fixture-routes-v1.json',65536));
 if(values.fixture!==route.id||route.syntheticOnly!==true||route.portableNativeGrant!==false)throw new Error('K04_SOURCE_DENIED');
 const required=view==='all'?['aggregate','chart','drilldown','export']:['aggregate',...(view==='aggregate'?[]:[view])];
 if(!Array.isArray(route.operations)||required.some(op=>!route.operations.includes(op)))throw new Error('K04_RIGHTS_DENIED');
 const bytes=readBoundedRegular(route.path,262144),hash=createHash('sha256').update(bytes).digest('hex');if(hash!==route.sha256)throw new Error('K04_SOURCE_DRIFT_DENIED');
 const data=JSON.parse(bytes);if(data.id!==route.id||data.revision!==route.revision||data.scope.source_id!==route.source_id)throw new Error('K04_SOURCE_DENIED');
 const result=deriveProcurementV1(data),all={...result,...buildProcurementViewsV1(result),source:{id:route.id,revision:route.revision,sha256:hash,syntheticOnly:true},operationAuthority:'BUNDLED_EXACT_SYNTHETIC_REFERENCE_NOT_CALLER_ROLE_OR_NATIVE_GRANT'};
 if(view==='chart')process.stdout.write(all.chart.svg);else if(view==='export')process.stdout.write(all.export.csv);else process.stdout.write(JSON.stringify(view==='all'?all:{...all,chart:undefined,export:undefined,...(view==='aggregate'?{drilldown:undefined}:{})})+'\n');
 }
}catch(error){const text=String(error.message),reasonCode=/^(K04_|PAN)[A-Z0-9_]{1,120}$/.test(text)?text:'K04_ENTRY_DENIED';process.stdout.write(JSON.stringify({outcome:'DENIED',reasonCode,table:null,chart:null,drilldown:null,export:null,partialSuccess:false})+'\n');process.exitCode=1;}
