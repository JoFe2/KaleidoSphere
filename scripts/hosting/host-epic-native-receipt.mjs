// Evidence shape binding only. This never executes a runtime, creates rights,
// or accepts unrelated child PASS files as an integrated native observation.
const fail=code=>{throw new Error(code);};
export function bindHostEpicNativeEvidenceV1(native,browser){
 const flow=browser?.hostEpicFlow;
 if(native?.status!=='PASS_ACTUAL_NATIVE_DEVELOPMENT_SCOPE'||flow?.schemaVersion!=='kaleidosphere/host-epic-native-flow/v1')
  fail('H282_CONNECTED_NATIVE_FLOW_REQUIRED');
 if(flow.owner!==native.owner||flow.sourceCommit!==native.sourceCommit||flow.sourceTree!==native.sourceTree)
  fail('H282_NATIVE_SOURCE_OWNER_MISMATCH');
 if(!/^[a-f0-9]{64}$/.test(flow.exportedGenerationId??'')||flow.exportedGenerationId!==flow.reacquiredGenerationId)
  fail('H282_NATIVE_GENERATION_MISMATCH');
 const control=native.actualNativeProcesses?.find(p=>p.tenantId==='tenant-a'&&p.role==='control');
 if(!control||flow.controlContainerId!==control.containerId||control.node!=='v24.14.0'||control.sourceOverlayReadOnly!==true)
  fail('H282_NATIVE_COMPONENT_MISMATCH');
 const phaseIds=['actual-epic-native-template-and-budget','actual-epic-export-from-browser-origin','actual-epic-bad-restore-retains-origin',
 'actual-epic-restored-native-and-protected-browser','actual-epic-tombstone-scoped-cleanup','actual-epic-retained-backup-reacquisition'];
 for(const id of phaseIds){const matches=browser.cases?.filter(c=>c.id===id&&c.status==='PASS');
  if(matches?.length!==1||matches[0].value.controlContainerId!==control.containerId||matches[0].value.owner!==native.owner)
   fail('H282_CONNECTED_NATIVE_PHASE_REQUIRED');}
 const origin=browser.cases.find(c=>c.id==='actual-epic-export-from-browser-origin').value;
 if(flow.browserOriginReceiptId!==origin.firstBrowserCatalogReceipt?.receiptId||flow.browserOriginSnapshotSha256!==origin.firstBrowserCatalogReceipt?.snapshotSha256
  ||origin.before?.question?.provenance?.receiptId!==flow.browserOriginReceiptId||origin.before?.question?.provenance?.snapshotSha256!==flow.browserOriginSnapshotSha256
  ||origin.exported?.checkpoint?.generationId!==flow.exportedGenerationId)
  fail('H282_NATIVE_ORIGIN_RECEIPT_MISMATCH');
 if(browser.fail!==0||browser.skipped!==0||browser.tests!==browser.pass||browser.cases.length!==browser.tests)
  fail('H282_NATIVE_CASES_INCOMPLETE');
 if(native.cleanup?.remainingOwnedContainers!==0||native.cleanup?.remainingOwnedNetworks!==0||native.cleanup?.transientOwnedStateRemoved!==true)
  fail('H282_NATIVE_CLEANUP_INCOMPLETE');
 return Object.freeze({state:'BOUND_EVIDENCE_NOT_RUNTIME_AUTHORITY',sourceCommit:native.sourceCommit,sourceTree:native.sourceTree,
  owner:native.owner,controlContainerId:control.containerId,tests:browser.tests,pass:browser.pass,fail:0,skipped:0,runtimeActivationGranted:false});
}
