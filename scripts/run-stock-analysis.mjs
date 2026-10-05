#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {loadPan520StockSourceV1,capturePan520StockPlanV1,executePan520StockReadV1} from '../services/bi-control/src/business-bi/pan520-stock-consumer.mjs';
import {openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {projectStockDeadlineV1} from '../services/bi-control/src/business-bi/stock-deadline-analysis.mjs';
import {projectNarrowM3StockV1} from '../services/bi-control/src/business-bi/stock-narrow-profile.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function readBoundedRegular(relativePath,maxBytes) {
  const metadataPath='contracts/business-bi/v1/synthetic-stock-deadline-routes-v1.json';
  if(typeof relativePath!=='string'||(relativePath!==metadataPath&&!/^examples\/stock\/[a-z0-9-]+\.json$/.test(relativePath)))throw new Error('K05_SOURCE_DENIED');
  let fd,directory;
  try {
    // Linux v1 qualification: pin each parent directory and never follow a replaced symlink.
    const dirFlags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
    directory=openSync(ROOT,dirFlags);const parts=relativePath.split('/');
    for(const component of parts.slice(0,-1)){
      const next=openSync('/proc/self/fd/'+directory+'/'+component,dirFlags);closeSync(directory);directory=next;
    }
    fd=openSync('/proc/self/fd/'+directory+'/'+parts.at(-1),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=fstatSync(fd);if(!stat.isFile()||stat.size>maxBytes)throw new Error('K05_SOURCE_DENIED');
    const bytes=Buffer.alloc(stat.size+1);let offset=0;
    while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)break;offset+=n;}
    if(offset!==stat.size)throw new Error('K05_SOURCE_DENIED');
    return bytes.subarray(0,offset);
  } catch {throw new Error('K05_SOURCE_DENIED');}
  finally {if(fd!==undefined)closeSync(fd);if(directory!==undefined)closeSync(directory);}
}
try{
 const {values}=parseArgs({options:{fixture:{type:'string'},'producer-source':{type:'string'},'native-root':{type:'string'},'as-of':{type:'string'},view:{type:'string'}},strict:true});
 if(values.fixture!==undefined){
  if(values['native-root']!==undefined||values['producer-source']!==undefined||values.view!==undefined||!values['as-of'])throw new Error('K05_MODE_DENIED');
  const route=JSON.parse(readBoundedRegular('contracts/business-bi/v1/synthetic-stock-deadline-routes-v1.json',65536));
  if(route.syntheticOnly!==true||route.portableNativeGrant!==false||!Array.isArray(route.operations)||!route.operations.includes('aggregate')||!Array.isArray(route.routes))throw new Error('K05_SOURCE_DENIED');
  const selected=route.routes.filter(r=>r.id===values.fixture);if(selected.length!==1)throw new Error('K05_SOURCE_DENIED');const entry=selected[0];
  const bytes=readBoundedRegular(entry.path,262144);if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('K05_SOURCE_DRIFT_DENIED');
  const data=JSON.parse(bytes);if(data.id!==entry.id||data.revision!==entry.revision)throw new Error('K05_SOURCE_DENIED');
  const result=data.schemaVersion==='kaleidosphere/narrow-m3-stock-source/v1'?projectNarrowM3StockV1(data,{asOf:values['as-of']}):projectStockDeadlineV1(data,{asOf:values['as-of']});process.stdout.write(JSON.stringify(result)+'\n');
 }else{
 const sourceRoot=values['producer-source']??process.env.KS285_PAN520_SOURCE;
 if(!sourceRoot||!values['native-root']||!values['as-of'])throw new Error('K05_NATIVE_SOURCE_AND_CUTOFF_REQUIRED_DENIED');
 if(values.view!==undefined&&!['table','export','all'].includes(values.view))throw new Error('K05_VIEW_DENIED');
 const source=await loadPan520StockSourceV1({sourceRoot}),request={schemaVersion:'pansphaira.pan520/projection-request/v1',profile:'STOCK',scope:{sourceId:'SYN-COMMON',tenantId:'SYN-TENANT-01',entityId:'SYN-ENTITY-01',orderId:'SO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',currency:'EUR',unit:'STK'},questions:['STOCK_POSITION','STOCK_RUNWAY','STOCK_VALUE']};
 const result=executePan520StockReadV1(capturePan520StockPlanV1({source,nativeRoot:values['native-root'],request,asOf:values['as-of']}));
 if(result.outcome==='DENIED')throw new Error(result.reasonCode);
 process.stdout.write(values.view==='export'?result.export.csv:JSON.stringify(values.view==='table'?result.table:result)+'\n');
 }
}catch(error){const text=String(error.message),reasonCode=/^(K05_|PAN)[A-Z0-9_]{1,120}$/.test(text)?text:'K05_ENTRY_DENIED';process.stdout.write(JSON.stringify({outcome:'DENIED',reasonCode,table:null,export:null,partialSuccess:false})+'\n');process.exitCode=1;}
