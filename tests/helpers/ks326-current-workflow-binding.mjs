// KS326 test-only compatibility fence for CURRENT workflow bytes. Never use this
// to rewrite historical evidence, source identities or recorded workflow receipts.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Same exact recovery previously local to H03. No test registration or file I/O.
export function originalCiWorkflow(workflow){
 assert.equal(typeof workflow,'string','current workflow text required');
 const pinned='    runs-on: ubuntu-24.04\n';
 assert.equal(workflow.split(pinned).length-1,1,'exactly one required-job runner pin');
 assert.equal(workflow.split('ubuntu-24.04').length-1,1,'no duplicate/hidden runner pin');
 const budget='    timeout-minutes: 30\n';
 assert.equal(workflow.split(budget).length-1,1,'exactly one approved whole-job runner budget');
 assert.equal(workflow.split('timeout-minutes:').length-1,1,'no duplicate/hidden timeout key');
 let original=workflow.replace(budget,'    timeout-minutes: 20\n').replace(pinned,'    runs-on: ubuntu-latest\n');
 const diagnostics=[
  '          ks283_audit_since="$(date +%s)"\n',
  '          # Diagnostics cannot replace a failed gate or change its exit status.\n',
  String.raw`          trap 'ks283_status=$?; trap - EXIT; if [ "$ks283_status" -ne 0 ]; then if node scripts/ci/ks283-sandbox-diagnostics.mjs failure "$ks283_audit_since"; then :; else printf "%s\n" "K01 diagnostics unavailable; original failure retained"; fi; fi; exit "$ks283_status"' EXIT`+'\n',
  '          node scripts/ci/ks283-sandbox-diagnostics.mjs before\n'
 ];
 for(const line of diagnostics){
  assert.equal(original.split(line).length-1,1,'exactly one unchanged diagnostic line');
  original=original.replace(line,'');
 }
 const pidLog='console.log("K01 runner sandbox status:",p.status,"signal:",p.signal,"error:",p.error?.code??null,"pid:",p.pid??null);';
 assert.equal(original.split(pidLog).length-1,1,'exactly one unchanged PID logging addition');
 original=original.replace(pidLog,pidLog.replace(',"pid:",p.pid??null',''));
 assert.equal(createHash('sha256').update(original).digest('hex'),
  '09807b18dbd5594d93bd9355eb653d1e9fc931e0dc0f360d86512bea934160ec','entire retained original workflow');
 return original;
}
