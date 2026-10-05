#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {executeO2cInvestigationV1} from '../services/bi-control/src/business-bi/o2c-investigation-profile.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
try{
 const {values,tokens}=parseArgs({options:{fixture:{type:'string'},mapping:{type:'string'},view:{type:'string'},'period-start':{type:'string'},'period-end':{type:'string'},'profile-save':{type:'string'},'profile-read':{type:'string'},'profile-revise':{type:'string'},'profile-version':{type:'string'},'profile-compare':{type:'string'},'compare-with':{type:'string'},'left-version':{type:'string'},'right-version':{type:'string'},'expected-version':{type:'string'},store:{type:'string'}},strict:true,tokens:true});
 const seen=new Set();for(const token of tokens)if(token.kind==='option'){if(seen.has(token.name))throw new Error('K08_OPTIONS_DUPLICATE_DENIED');seen.add(token.name);}
 process.stdout.write(JSON.stringify(executeO2cInvestigationV1({root,values}))+'\n');
}catch(error){const reasonCode=/^(K08_|K03_)[A-Z0-9_]+$/.test(error.message)?error.message:'K08_ENTRY_DENIED';process.stdout.write(JSON.stringify({outcome:'DENIED',reasonCode,freshness:['K08_SOURCE_INVALIDATED','K08_DEFINITION_INVALIDATED','K03_SOURCE_DRIFT_DENIED','K03_RIGHTS_DENIED'].includes(reasonCode)?'INVALIDATED':'NOT_EXECUTED',invalidationReason:reasonCode,table:null,chart:null,export:null,drilldown:null,partialSuccess:false,humanUsability:'NOT_OBSERVED',humanUsabilityTechnicalHold:false})+'\n');process.exitCode=1;}
