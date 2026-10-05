// Optional saved recipes around the existing exact synthetic O2C entry.
// No new metric engine, source, vendor connector, role or dashboard authority.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,renameSync,openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {join} from 'node:path';
import {canonicalJson} from '../canonical-json.js';
const SCHEMA='kaleidosphere/o2c-investigation-profile/v1';
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw new Error(code);};
const clone=value=>JSON.parse(canonicalJson(value));
function id(value){if(typeof value!=='string'||! /^[a-z][a-z0-9-]{0,63}$/.test(value))fail('K08_PROFILE_ID_DENIED');return value;}
function definition(root){
 try{return digest(Buffer.concat(['scripts/run-invoice-date-o2c.mjs','services/bi-control/src/business-bi/invoice-date-o2c.mjs','services/bi-control/src/business-bi/invoice-date-o2c-views.mjs'].map(p=>Buffer.from(readStoreFile(join(root,p))))));}
 catch{fail('K08_DEFINITION_INVALIDATED');}
}
function executeExisting(root,recipe){
 if(!['all','aggregate','drilldown'].includes(recipe.view))fail('K08_PROFILE_VIEW_DENIED');
 const definitionSha256=definition(root);
 const args=['scripts/run-invoice-date-o2c.mjs','--fixture',recipe.fixtureId,'--period-start',recipe.period.start,'--period-end',recipe.period.end,'--view',recipe.view];
 if(recipe.mapping)args.push('--mapping',recipe.mapping);
 const p=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:512*1024});
 if(p.error)fail('K08_EXECUTION_NOT_COMPLETE');
 let result;try{result=JSON.parse(p.stdout);}catch{fail('K08_EXECUTION_NOT_COMPLETE');}
 if(p.status!==0||result.outcome!=='ACCEPTED')fail(result.reasonCode?.startsWith('K03_')?result.reasonCode:'K08_EXECUTION_NOT_COMPLETE');
 if(definition(root)!==definitionSha256)fail('K08_DEFINITION_INVALIDATED');
 return {result,definitionSha256};
}
// Pin all parent descriptors and bound regular-file reads; never follow a replaced
// ancestor/leaf or block on a FIFO. This is a Linux-qualified local store boundary.
function readStoreFile(path){
 let directory,fd;
 try{
  if(typeof path!=='string'||!path.startsWith('/'))fail('K08_PROFILE_PATH_DENIED');
  const parts=path.split('/').filter(Boolean),flags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
  directory=openSync('/',flags);
  for(const part of parts.slice(0,-1)){const next=openSync('/proc/self/fd/'+directory+'/'+part,flags);closeSync(directory);directory=next;}
  fd=openSync('/proc/self/fd/'+directory+'/'+parts.at(-1),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=fstatSync(fd);if(!stat.isFile()||stat.size>32768)fail('K08_PROFILE_PATH_DENIED');
  const bytes=Buffer.alloc(stat.size+1);let offset=0;
  while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)break;offset+=n;}
  if(offset!==stat.size)fail('K08_PROFILE_PATH_DENIED');
  return bytes.subarray(0,offset);
 }catch{fail('K08_PROFILE_PATH_DENIED');}
 finally{if(fd!==undefined)closeSync(fd);if(directory!==undefined)closeSync(directory);}
}
function readProfile(store,name,requested=null){
 id(name);
 try{
  const head=JSON.parse(readStoreFile(join(store,name,'head.json')));
  if(!Number.isSafeInteger(head.profileVersion)||head.profileVersion<1||head.profileVersion>1000)fail('K08_PROFILE_RECORD_DENIED');
  if(requested!==null&&(typeof requested!=='string'||! /^[1-9][0-9]{0,3}$/.test(requested)))fail('K08_PROFILE_VERSION_DENIED');
  const selected=requested===null?head.profileVersion:Number(requested);
  if(selected>head.profileVersion)fail('K08_PROFILE_VERSION_DENIED');
  let expected=head.sha256;
  for(let version=head.profileVersion;version>=selected;version--){
   const record=JSON.parse(readStoreFile(join(store,name,'v'+version+'.json')));
   if(record.schema!==SCHEMA||record.profile?.profileId!==name||record.profile?.profileVersion!==version||record.sha256!==expected||digest(canonicalJson(record.profile))!==record.sha256)fail('K08_PROFILE_RECORD_DENIED');
   if(version===selected)return clone(record.profile);
   expected=record.profile.predecessorSha256;
  }
  fail('K08_PROFILE_RECORD_DENIED');
 }catch(error){fail(['K08_PROFILE_PATH_DENIED','K08_PROFILE_VERSION_DENIED'].includes(error.message)?error.message:'K08_PROFILE_RECORD_DENIED');}
}
function openProfileDirectory(path){
 let directory;
 try{
  const flags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
  directory=openSync('/',flags);
  for(const part of path.split('/').filter(Boolean)){
   const pinned='/proc/self/fd/'+directory+'/'+part;
   try{mkdirSync(pinned,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
   const next=openSync(pinned,flags);closeSync(directory);directory=next;
  }
  return directory;
 }catch{if(directory!==undefined)closeSync(directory);fail('K08_PROFILE_PATH_DENIED');}
}
function saveProfile(store,profile,previous=null){
 const directory=openProfileDirectory(join(store,id(profile.profileId))),dir='/proc/self/fd/'+directory;
 const sha256=digest(canonicalJson(profile));
 try{
  if(previous&&digest(canonicalJson(readProfile(store,profile.profileId)))!==digest(canonicalJson(previous)))fail('K08_PROFILE_VERSION_CONFLICT');
  writeFileSync(join(dir,'v'+profile.profileVersion+'.json'),canonicalJson({schema:SCHEMA,profile,sha256})+'\n',{flag:'wx',mode:0o600});
  const head=canonicalJson({profileVersion:profile.profileVersion,sha256})+'\n';
  if(previous){const pending=join(dir,'head-'+sha256+'.pending');writeFileSync(pending,head,{flag:'wx',mode:0o600});renameSync(pending,join(dir,'head.json'));}
  else writeFileSync(join(dir,'head.json'),head,{flag:'wx',mode:0o600});
 }catch(error){fail(error.message==='K08_PROFILE_VERSION_CONFLICT'?error.message:'K08_PROFILE_WRITE_DENIED');}
 finally{closeSync(directory);}
 return profile;
}
export function executeO2cInvestigationV1({root,values}){
 if(process.env.KS_O2C_PROFILES_DISABLED==='1')fail('K08_PROFILES_DISABLED');
 const save=values['profile-save'],read=values['profile-read'],revise=values['profile-revise'],compare=values['profile-compare'];
 if([save,read,revise,compare].filter(Boolean).length!==1||typeof values.store!=='string')fail('K08_PROFILE_MODE_DENIED');
 if(!values.store.startsWith('/')||values.store.length>4096||/[\x00-\x1f\x7f]/.test(values.store)||values.store.split('/').slice(1).some(part=>['','.','..'].includes(part)))fail('K08_PROFILE_PATH_DENIED');
 const recipeKeys=['fixture','mapping','view','period-start','period-end'];
 const allowed=read?['profile-read','profile-version','store']:compare?['profile-compare','compare-with','left-version','right-version','store']:['store',...(save?['profile-save']:['profile-revise','expected-version']),...recipeKeys];
 if(Object.keys(values).some(key=>!allowed.includes(key)))fail(read?'K08_PROFILE_READ_OPTIONS_DENIED':'K08_PROFILE_OPTIONS_DENIED');
 if(compare){
  const observed=(name,version)=>{
   const profile=readProfile(values.store,id(name),version??null);
   const metadata={profileId:profile.profileId,profileVersion:profile.profileVersion,source:profile.source,period:profile.period,mapping:profile.mapping,definitionSha256:profile.definitionSha256,semanticDefinition:profile.semanticDefinition??null};
   try{
    const actual=executeO2cInvestigationV1({root,values:{'profile-read':name,'profile-version':String(profile.profileVersion),store:values.store}});
    return {...metadata,resultReference:actual.investigation.resultReference,freshness:actual.investigation.freshness,invalidationReason:null};
   }catch(error){return {...metadata,resultReference:null,freshness:'INVALIDATED',invalidationReason:/^(K08_|K03_)[A-Z0-9_]+$/.test(error.message)?error.message:'K08_EXECUTION_NOT_COMPLETE'};}
  };
  const left=observed(compare,values['left-version']),right=observed(values['compare-with'],values['right-version']);
  const changedDimensions=[];
  for(const [label,key] of [['SOURCE','source'],['PERIOD','period'],['MAPPING','mapping'],['SEMANTIC_DEFINITION','definitionSha256']])if(canonicalJson(left[key])!==canonicalJson(right[key]))changedDimensions.push(label);
  return {outcome:'COMPARISON',comparison:{left,right,changedDimensions,sameBoundResult:changedDimensions.length===0&&left.freshness==='FRESH_BOUND_EXECUTION'&&right.freshness==='FRESH_BOUND_EXECUTION'&&left.resultReference===right.resultReference,numericComparisonAllowed:false,numericDelta:null,comparisonPolicy:'BOUND_METADATA_ONLY_NOT_A_NEW_METRIC_DIFFERENCE'},table:null,chart:null,export:null,drilldown:null,partialSuccess:false,humanUsability:'NOT_OBSERVED',humanUsabilityTechnicalHold:false};
 }
 let profile,result;
 if(read){
  if(['fixture','mapping','view','period-start','period-end','expected-version'].some(key=>Object.hasOwn(values,key)))fail('K08_PROFILE_READ_OPTIONS_DENIED');
  profile=readProfile(values.store,read,values['profile-version']??null);
  if(profile.definitionSha256!==definition(root))fail('K08_DEFINITION_INVALIDATED');
  const executed=executeExisting(root,{fixtureId:profile.source.fixtureId,mapping:profile.mapping,period:profile.period,view:profile.view});
  if(executed.definitionSha256!==profile.definitionSha256)fail('K08_DEFINITION_INVALIDATED');
  result=executed.result;
  if(result.source.sha256!==profile.source.snapshotSha256||result.source.revision!==profile.source.sourceRevision||result.source.id!==profile.source.fixtureId||result.source.mapping!==profile.mapping)fail('K08_SOURCE_INVALIDATED');
 }else{
  const name=id(save??revise),previous=revise?readProfile(values.store,name):null;
  if(previous&&values['expected-version']!==String(previous.profileVersion))fail('K08_PROFILE_VERSION_CONFLICT');
  if(previous&&previous.profileVersion>=1000)fail('K08_PROFILE_VERSION_DENIED');
  const period={start:values['period-start']??previous?.period.start,end:values['period-end']??previous?.period.end};
  const view=values.view??previous?.view??'all';
  const executed=executeExisting(root,{fixtureId:values.fixture??previous?.source.fixtureId,mapping:values.mapping??previous?.mapping,period,view});result=executed.result;
  profile={profileId:name,profileVersion:previous?previous.profileVersion+1:1,predecessorSha256:previous?digest(canonicalJson(previous)):null,family:'O2C_INVOICE_DATE',period,mapping:result.source.mapping,view,semanticDefinition:result.profile,definitionSha256:executed.definitionSha256,source:{fixtureId:result.source.id,sourceRevision:result.source.revision,snapshotSha256:result.source.sha256},syntheticOnly:true};
  saveProfile(values.store,profile,previous);
 }
 const resultReference=digest(canonicalJson({profile,result}));
 const investigation={profileId:profile.profileId,profileVersion:profile.profileVersion,resultReference,snapshotSha256:profile.source.snapshotSha256,fixtureId:profile.source.fixtureId,sourceRevision:profile.source.sourceRevision,period:profile.period,mapping:profile.mapping,semanticDefinition:result.profile,definitionSha256:profile.definitionSha256,freshness:'FRESH_BOUND_EXECUTION',humanUsability:'NOT_OBSERVED',humanUsabilityTechnicalHold:false,sourceAuthority:'BUNDLED_EXACT_SYNTHETIC_FIXTURE_NOT_CALLER_ROLE'};
 const presented={...result,investigation};
 for(const key of ['table','chart','export','drilldown'])if(result[key])presented[key]={...result[key],investigation:clone(investigation)};
 if(presented.chart){
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const legend=[`Profile ${profile.profileId} v${profile.profileVersion}`,`${profile.period.start} inclusive to ${profile.period.end} exclusive`,`${profile.source.fixtureId} revision ${profile.source.sourceRevision}; ${profile.mapping}`,`FRESH_BOUND_EXECUTION; result ${resultReference.slice(0,16)}; Human usability NOT_OBSERVED`];
  presented.chart.svg=presented.chart.svg.replace('<svg ',`<svg data-result-reference="${resultReference}" `).replace('height="540"','height="640"').replace('viewBox="0 0 720 540"','viewBox="0 0 720 640"').replace('</svg>',`<metadata>${escape(canonicalJson(investigation))}</metadata><g font-family="sans-serif" font-size="12">${legend.map((line,i)=>`<text x="60" y="${550+i*20}">${escape(line)}</text>`).join('')}</g></svg>`);
 }
 if(presented.export)presented.export.csv=`# investigation ${resultReference} ${canonicalJson(investigation)}\n${presented.export.csv}`;
 return presented;
}
