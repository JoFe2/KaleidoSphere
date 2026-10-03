// Trusted launcher: a fresh empty namespace, NOT a mounted checkout with hidden rows.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

const CODE_CLOSURE = Object.freeze([
  'scripts/run-permitted-aggregate-candidate.mjs',
  'services/bi-control/src/business-bi/permitted-aggregate-candidate.mjs',
  'services/bi-control/src/business-bi/net-revenue-plan.mjs',
  'services/bi-control/src/canonical-json.js',
]);
export function aggregateSandboxCommand(root) {
  const args = ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
    '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
    '--proc', '/proc', '--dev', '/dev'];
  for (const rel of CODE_CLOSURE) args.push('--ro-bind', realpathSync(join(root, rel)), '/app/' + rel);
  args.push('--ro-bind', realpathSync(process.execPath), '/runtime/node',
    '--chdir', '/app', '--remount-ro', '/', '/runtime/node',
    '/app/scripts/run-permitted-aggregate-candidate.mjs');
  return { command: '/usr/bin/bwrap', args };
}
export function runAggregateCandidate(root, payload) {
  const { command, args } = aggregateSandboxCommand(root);
  const out = spawnSync(command, args, { input: JSON.stringify(payload), encoding: 'utf8',
    timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 65536, env: {} });
  // Never forward process errors, caller paths or raw subprocess stderr.
  if (out.error || out.signal || out.status !== 0) throw new Error('K01_ISOLATED_CANDIDATE_FAILED');
  const result = JSON.parse(out.stdout);
  if (result.outcome !== 'ACCEPTED') throw new Error('K01_ISOLATED_CANDIDATE_FAILED');
  return { ...result, isolation: 'PRIVATE_MOUNT_PID_NETWORK_NAMESPACE',
    rawSourceAccessible: false, oracleAccessible: false };
}
