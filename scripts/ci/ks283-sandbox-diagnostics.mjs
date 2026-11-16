// KS326: bounded hosted-CI diagnostics, never sandbox admission or a fallback.
// No environment/argv/input dump; kernel messages are reduced to selected fields.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateSandboxCommand } from '../../services/bi-control/src/business-bi/permitted-aggregate-sandbox.mjs';

export function selectKs283AuditFacts(text) {
  const events = [];
  let matched = 0;
  for (const line of text.split('\n')) {
    const fields = Object.fromEntries([...line.matchAll(/\b([a-z_]+)=(?:"([^"]*)"|([^\s]+))/g)]
      .map(match => [match[1], match[2] ?? match[3]]));
    if (!['ALLOWED', 'DENIED', 'AUDIT'].includes(fields.apparmor)
      || !(fields.profile?.startsWith('ks283-ci-') || fields.comm === 'bwrap')) continue;
    matched++;
    if (events.length >= 32) continue;
    const event = { apparmor: fields.apparmor };
    for (const key of ['operation', 'profile', 'target', 'capname', 'requested_mask', 'denied_mask']) {
      if (typeof fields[key] === 'string' && /^[A-Za-z0-9_./:&+()-]{1,256}$/.test(fields[key])) event[key] = fields[key];
    }
    if (fields.comm) event.comm = ['bwrap', 'node'].includes(fields.comm) ? fields.comm : 'OTHER';
    for (const key of ['pid', 'ppid', 'capability', 'error']) {
      if (/^-?\d{1,10}$/.test(fields[key] ?? '')) event[key] = Number(fields[key]);
    }
    if (fields.name) event.path = /^\/(?:usr|lib|lib64|proc|runtime|app|opt\/hostedtoolcache)(?:\/[A-Za-z0-9_./:-]*)?$/.test(fields.name)
      ? fields.name.slice(0, 512) : 'OTHER_PATH';
    events.push(event);
  }
  return { events, matched, truncated: matched > events.length };
}

function command(file, args, maxBuffer = 65536) {
  const result = spawnSync(file, args, { encoding: 'utf8', env: {}, timeout: 3000, maxBuffer });
  return { status: result.status, signal: result.signal, error: result.error?.code ?? null, pid: result.pid ?? null,
    stdout: result.stdout ?? '' };
}
function summary(result) { const { stdout, ...status } = result; return status; }
function fixedRead(file) { try { return readFileSync(file, 'utf8').trim(); } catch { return null; } }

function collect(phase, since) {
  if (process.platform !== 'linux' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.env.RUNNER_OS !== 'Linux')
    throw new Error('K01_DIAGNOSTICS_HOSTED_LINUX_ONLY');
  const now = Math.floor(Date.now() / 1000);
  if (!['before', 'failure'].includes(phase) || phase === 'failure'
    && (!Number.isSafeInteger(since) || since < now - 300 || since > now)) throw new Error('K01_DIAGNOSTICS_REQUEST_DENIED');
  const policyKeys = ['apparmor_restrict_unprivileged_userns', 'apparmor_restrict_unprivileged_unconfined', 'unprivileged_userns_clone'];
  const result = { purpose: 'DIAGNOSTICS_ONLY_NOT_ACCEPTANCE', phase,
    kernelPolicy: Object.fromEntries(policyKeys.map(key => [key, fixedRead('/proc/sys/kernel/' + key)])) };
  if (phase === 'before') {
    const version = command('/usr/bin/bwrap', ['--version']);
    const packages = command('/usr/bin/dpkg-query', ['-W', '-f=${binary:Package} ${Version}\n', 'bubblewrap', 'apparmor', 'apparmor-utils']);
    const kernel = command('/usr/bin/uname', ['-srm']);
    result.bwrapVersion = { ...summary(version), version: version.stdout.match(/^bubblewrap [0-9][A-Za-z0-9.+~:-]*$/m)?.[0] ?? null };
    result.packages = { ...summary(packages), versions: packages.stdout.split('\n')
      .filter(line => /^(bubblewrap|apparmor|apparmor-utils)(?::[a-z0-9]+)? [0-9][A-Za-z0-9.+~:-]*$/.test(line)) };
    result.kernel = { ...summary(kernel), release: /^[A-Za-z0-9 ._+-]+$/.test(kernel.stdout.trim()) ? kernel.stdout.trim() : null };
    const stat = statSync('/usr/bin/bwrap');
    result.executable = { requestedPath: '/usr/bin/bwrap', realPath: realpathSync('/usr/bin/bwrap'),
      mode: (stat.mode & 0o7777).toString(8), size: stat.size,
      sha256: stat.size <= 16 * 1024 * 1024 ? createHash('sha256').update(readFileSync('/usr/bin/bwrap')).digest('hex') : null };
    result.launch = aggregateSandboxCommand(process.cwd());
    result.collectorProfile = fixedRead('/proc/self/attr/current');
    const profiles = command('/usr/bin/sudo', ['-n', '/usr/bin/cat', '/sys/kernel/security/apparmor/profiles']);
    result.bwrapProfiles = { ...summary(profiles), rows: profiles.stdout.split('\n')
      .filter(line => /bwrap|ks283-ci-/.test(line) && /^[A-Za-z0-9_./:&+() -]{1,512}$/.test(line)).slice(0, 32) };
  } else {
    // Read-only metadata queries. No privileged sandbox or policy write.
    const journal = command('/usr/bin/sudo', ['-n', '/usr/bin/journalctl', '--kernel', '--no-pager', '--output=cat', `--since=@${since}`], 1048576);
    result.journal = { ...summary(journal), ...selectKs283AuditFacts(journal.stdout) };
    if (journal.status !== 0 || result.journal.matched === 0) {
      const messages = command('/usr/bin/sudo', ['-n', '/usr/bin/dmesg', '--since', new Date(since * 1000).toISOString()], 1048576);
      result.dmesg = { ...summary(messages), ...selectKs283AuditFacts(messages.stdout) };
    }
    result.qualification = 'Missing or truncated audit output is not proof of no denial or of a cause.';
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(collect(process.argv[2], process.argv[3] === undefined ? null : Number(process.argv[3])))); }
  catch (error) {
    console.error(JSON.stringify({ purpose: 'DIAGNOSTICS_ONLY_NOT_ACCEPTANCE', unavailable: true,
      code: ['K01_DIAGNOSTICS_HOSTED_LINUX_ONLY', 'K01_DIAGNOSTICS_REQUEST_DENIED'].includes(error.message) ? error.message : 'K01_DIAGNOSTICS_UNAVAILABLE' }));
    process.exitCode = 1;
  }
}
