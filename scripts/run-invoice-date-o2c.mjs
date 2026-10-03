#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {deriveInvoiceDateO2cV1,normalizeKnownO2cV1,assertO2cPeriodV1} from '../services/bi-control/src/business-bi/invoice-date-o2c.mjs';
import {buildInvoiceDateViewsV1} from '../services/bi-control/src/business-bi/invoice-date-o2c-views.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function readBoundedRegular(relativePath,maxBytes) {
  const metadataPath='contracts/business-bi/v1/synthetic-o2c-fixture-grants-v1.json';
  if(typeof relativePath!=='string'||(relativePath!==metadataPath&&!/^examples\/o2c\/[a-z0-9-]+\.json$/.test(relativePath)))throw new Error('K03_SOURCE_DENIED');
  let fd,directory;
  try {
    // Linux v1 qualification: pin each parent directory and never follow a replaced symlink.
    const dirFlags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
    directory=openSync(ROOT,dirFlags);const parts=relativePath.split('/');
    for(const component of parts.slice(0,-1)){
      const next=openSync('/proc/self/fd/'+directory+'/'+component,dirFlags);closeSync(directory);directory=next;
    }
    fd=openSync('/proc/self/fd/'+directory+'/'+parts.at(-1),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=fstatSync(fd);if(!stat.isFile()||stat.size>maxBytes)throw new Error('K03_SOURCE_DENIED');
    const bytes=Buffer.alloc(stat.size+1);let offset=0;
    while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)break;offset+=n;}
    if(offset!==stat.size)throw new Error('K03_SOURCE_DENIED');
    return bytes.subarray(0,offset);
  } catch {throw new Error('K03_SOURCE_DENIED');}
  finally {if(fd!==undefined)closeSync(fd);if(directory!==undefined)closeSync(directory);}
}
try {
  const {values}=parseArgs({options:{fixture:{type:'string'},mapping:{type:'string'},view:{type:'string'},'period-start':{type:'string'},'period-end':{type:'string'}},strict:true});
  const period=assertO2cPeriodV1({start:values['period-start'],end:values['period-end']});
  const catalog=JSON.parse(readBoundedRegular('contracts/business-bi/v1/synthetic-o2c-fixture-grants-v1.json',65536).toString('utf8'));
  const grant=Object.hasOwn(catalog.sources,values.fixture)?catalog.sources[values.fixture]:null;if(!grant)throw new Error('K03_SOURCE_DENIED');
  const view=values.view??'all';if(!['all','aggregate','chart','drilldown','export'].includes(view))throw new Error('K03_VIEW_DENIED');
  const required=view==='all'?['aggregate','chart','drilldown','export']:['aggregate',...(view==='aggregate'?[]:[view])];
  if(!Array.isArray(grant.operations)||required.some(op=>!grant.operations.includes(op)))throw new Error('K03_RIGHTS_DENIED');
  const selected=values.mapping??grant.defaultMapping;const binding=grant.variants?(Object.hasOwn(grant.variants,selected)?grant.variants[selected]:null):grant;
  if(!binding||(values.mapping&&binding.mapping!==values.mapping))throw new Error('K03_MAPPING_DENIED');
  const bytes=readBoundedRegular(binding.path,262144);
  if(createHash('sha256').update(bytes).digest('hex')!==binding.sha256)throw new Error('K03_SOURCE_DRIFT_DENIED');
  const data=normalizeKnownO2cV1(JSON.parse(bytes),binding.mapping);if(data.id!==values.fixture||data.scope.source_id!==grant.source_id||data.revision!==grant.revision)throw new Error('K03_SOURCE_DENIED');
  const result=deriveInvoiceDateO2cV1(data,period);
  const materialized=view==='aggregate'?{}:buildInvoiceDateViewsV1(data,result,period);
  if(view==='chart')process.stdout.write(materialized.chart.svg);
  else if(view==='export')process.stdout.write(materialized.export.csv);
  else process.stdout.write(JSON.stringify({...result,...(view==='all'?materialized:(view==='drilldown'?{drilldown:materialized.drilldown}:{})),source:{id:data.id,revision:data.revision,sha256:binding.sha256,mapping:binding.mapping,syntheticOnly:true},operationAuthority:'BUNDLED_EXACT_SYNTHETIC_FIXTURE_NOT_CALLER_ROLE'})+'\n');
} catch(error){const reasonCode=String(error.message).startsWith('K03_')?error.message:'K03_ENTRY_DENIED';process.stdout.write(JSON.stringify({outcome:'DENIED',reasonCode,diagnostic:reasonCode==='K03_PERIOD_DENIED'?'Ein vollständiger gültiger Zeitraum (Start inklusiv, Ende exklusiv) ist erforderlich. Kein Teilergebnis.':'Die begrenzte Rechnungs-/Versand-Auswertung wurde nicht vollständig ausgeführt. Kein Teilergebnis.',table:null,chart:null,export:null,partialSuccess:false})+'\n');process.exitCode=1;}
