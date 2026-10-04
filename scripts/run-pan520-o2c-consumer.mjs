#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {assertO2cPeriodV1} from '../services/bi-control/src/business-bi/invoice-date-o2c.mjs';
import {loadPan520O2cSourceV1,capturePan520O2cPlanV1,executePan520O2cReadV1} from '../services/bi-control/src/business-bi/pan520-o2c-consumer.mjs';
try {
  const {values}=parseArgs({options:{'pan-source-root':{type:'string'},'native-root':{type:'string'},'period-start':{type:'string'},'period-end':{type:'string'},'as-of':{type:'string'},view:{type:'string'}},strict:true});
  const period=assertO2cPeriodV1({start:values['period-start'],end:values['period-end']});
  const view=values.view??'all';if(!['all','table','chart','drilldown','export'].includes(view))throw new Error('K03_PAN520_VIEW_DENIED');
  const source=await loadPan520O2cSourceV1({sourceRoot:values['pan-source-root']});
  // The existing native source rechecks the actual current composite scope and
  // durable controls. This fixed COMMON request grants no arbitrary SQL/roles.
  const request={schemaVersion:'pansphaira.pan520/projection-request/v1',profile:'O2C',scope:{sourceId:'SYN-COMMON',tenantId:'SYN-TENANT-01',entityId:'SYN-ENTITY-01',orderId:'SO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',currency:'EUR',unit:'STK'},questions:['ORDER_SOURCE','DISPATCH_TIMELINESS','CUSTOMER_RECEIPT_TIMELINESS','BILLED_NET']};
  const held=capturePan520O2cPlanV1({source,nativeRoot:values['native-root'],request,period,asOf:values['as-of']??null});
  const result=executePan520O2cReadV1(held);
  if(result.outcome==='DENIED'){process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=1;}
  else if(view==='chart')process.stdout.write(result.chart.svg);
  else if(view==='export')process.stdout.write(result.export.csv);
  else process.stdout.write(JSON.stringify(view==='all'?result:{outcome:result.outcome,[view]:result[view],pair:result.pair,requestedPeriod:result.requestedPeriod,periodApplication:result.periodApplication,nativeAsOf:result.nativeAsOf})+'\n');
}catch(error){const message=String(error.message),reasonCode=/^(K03_|PAN)[A-Z0-9_]{1,120}$/.test(message)?message:'K03_PAN520_ENTRY_DENIED';process.stdout.write(JSON.stringify({outcome:'DENIED',reasonCode,table:null,chart:null,drilldown:null,export:null,partialSuccess:false})+'\n');process.exitCode=1;}
