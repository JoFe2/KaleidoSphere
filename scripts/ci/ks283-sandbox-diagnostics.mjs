// KS326: bounded hosted-CI diagnostics, never sandbox admission or a fallback.
// No raw environment/argv/input dump; unknown diagnostic values are redacted.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateSandboxCommand } from '../../services/bi-control/src/business-bi/permitted-aggregate-sandbox.mjs';

const PROFILES = new Set(['ks283-ci-bwrap', 'ks283-ci-child', 'ks283-ci-bwrap//&ks283-ci-child',
  'bwrap', 'unpriv_bwrap', 'bwrap//&unpriv_bwrap', 'unconfined']);
const OPERATIONS = new Set(['capable', 'exec', 'open', 'file_mmap', 'userns_create', 'mount', 'umount', 'pivotroot', 'change_onexec', 'change_profile']);
const CAPABILITIES = new Set(['net_admin', 'sys_admin', 'sys_chroot', 'setuid', 'setgid', 'setpcap', 'sys_ptrace', 'mknod', 'dac_override', 'dac_read_search', 'chown', 'fowner']);
const MASKS = new Set(['r', 'w', 'rw', 'x', 'm', 'userns_create']);
const PATHS = new Set(['/usr/bin/bwrap', '/bin/bwrap', '/proc/self/exe', '/runtime/node',
  '/', '/usr', '/lib', '/lib64', '/proc', '/dev', '/app',
  '/app/scripts/run-permitted-aggregate-candidate.mjs',
  '/app/services/bi-control/src/business-bi/permitted-aggregate-candidate.mjs',
  '/app/services/bi-control/src/business-bi/net-revenue-plan.mjs', '/app/services/bi-control/src/canonical-json.js']);
const FLAGS = new Set(['--unshare-all', '--die-with-parent', '--new-session', '--clearenv', '--ro-bind', '--proc', '--dev', '--chdir', '--remount-ro']);
function selected(value, known, other) { return known.has(value) ? value : other; }

// A deliberately limited kernel-record grammar, not a general log parser.
// Unsupported quoting/escaping or ANY duplicate/malformed field rejects the
// whole record. In particular, unknown values are consumed once, never rescanned.
function auditFields(line) {
  if (line.length > 8192) return null;
  const prefix = line.match(/^[ \t]*(?:\[\s*\d+(?:\.\d+)?\]\s+)?(?:audit:\s+)?(?:type=1400\s+audit\(\d+(?:\.\d+)?:\d+\):\s+)?/)[0];
  const fields = new Map(prefix.includes('type=1400') ? [['type', '1400']] : []);
  let at = prefix.length;
  while (at < line.length) {
    while (line[at] === ' ' || line[at] === '\t') at++;
    if (at === line.length) break;
    const key = line.slice(at).match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!key || fields.has(key[1]) || fields.size >= 64) return null;
    at += key[0].length;
    const quoted = line[at] === '"';
    if (quoted) at++;
    const start = at;
    while (at < line.length && (quoted ? line[at] !== '"' : line[at] !== ' ' && line[at] !== '\t')) {
      const code = line.charCodeAt(at);
      if (code < 32 || code > 126 || line[at] === '\\' || !quoted && (line[at] === '"' || line[at] === "'")) return null;
      at++;
    }
    const value = line.slice(start, at);
    if (quoted) {
      if (line[at] !== '"') return null;
      at++;
    } else if (!value) return null;
    if (at < line.length && line[at] !== ' ' && line[at] !== '\t') return null;
    fields.set(key[1], value);
  }
  if (fields.has('type') && fields.get('type') !== '1400') return null;
  return fields;
}

export function selectKs283AuditFacts(text) {
  const events = [];
  let matched = 0;
  for (const line of text.split('\n')) {
    const fields = auditFields(line);
    if (!fields || !['ALLOWED', 'DENIED', 'AUDIT'].includes(fields.get('apparmor'))
      || !fields.get('operation') || !fields.get('profile')) continue;
    const profile = fields.get('profile');
    if (!(PROFILES.has(profile) && profile !== 'unconfined' || fields.get('comm') === 'bwrap')) continue;
    matched++;
    if (events.length >= 32) continue;
    const event = { apparmor: fields.get('apparmor') };
    for (const [key, known, other] of [['operation', OPERATIONS, 'OTHER_OPERATION'], ['profile', PROFILES, 'OTHER_PROFILE'],
      ['target', PROFILES, 'OTHER_PROFILE'], ['capname', CAPABILITIES, 'OTHER_CAPABILITY'],
      ['requested_mask', MASKS, 'OTHER_MASK'], ['denied_mask', MASKS, 'OTHER_MASK']]) {
      if (fields.has(key)) event[key] = selected(fields.get(key), known, other);
    }
    if (fields.has('comm')) event.comm = ['bwrap', 'node'].includes(fields.get('comm')) ? fields.get('comm') : 'OTHER';
    for (const key of ['pid', 'ppid', 'capability', 'error']) {
      const value = fields.get(key);
      if (/^-?\d{1,10}$/.test(value ?? '')) {
        const number = Number(value);
        if (key === 'capability' ? number >= 0 && number <= 40
          : key === 'error' ? Math.abs(number) <= 4095 : number >= 0 && number <= 4194304) event[key] = number;
      }
    }
    if (fields.has('name')) event.path = selected(fields.get('name'), PATHS, 'OTHER_PATH');
    events.push(event);
  }
  return { events, matched, truncated: matched > events.length };
}

function displayedProfile(value) {
  const mode = value.match(/^(.*) \((enforce|complain|kill)\)$/);
  return mode ? `${selected(mode[1], PROFILES, 'OTHER_PROFILE')} (${mode[2]})` : selected(value, PROFILES, 'OTHER_PROFILE');
}

// Fixed output shapes for the other metadata readers; no generic value passthrough.
export function selectKs283RuntimeFacts({ bwrapVersion, packages, kernelRelease, realPath, collectorProfile, loadedProfiles, launch }) {
  const rows = loadedProfiles.split('\n').filter(line => {
    const mode = line.match(/^(.*) \((enforce|complain|kill)\)$/);
    return mode && (PROFILES.has(mode[1]) || mode[1].includes('bwrap'));
  }).map(displayedProfile);
  return {
    bwrapVersion: /^bubblewrap \d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bwrapVersion.trim()) ? bwrapVersion.trim() : null,
    packages: [...new Set(packages.split('\n').filter(line => /^(bubblewrap|apparmor|apparmor-utils)(?::(?:amd64|arm64))? (?:\d{1,3}:)?\d{1,3}(?:\.\d{1,4}){1,3}(?:-\d{1,4}(?:ubuntu\d{1,4}(?:\.\d{1,4})*)?)?(?:~\d{2}\.\d{2}(?:\.\d{1,3})?)?(?:\+b\d{1,3})?$/.test(line)))].slice(0, 32),
    kernelRelease: /^Linux \d{1,3}\.\d{1,3}\.\d{1,4}(?:-\d{1,5})?(?:-(?:azure|generic|aws|gcp))? (?:x86_64|aarch64)$/.test(kernelRelease.trim()) ? kernelRelease.trim() : null,
    realPath: ['/usr/bin/bwrap', '/bin/bwrap'].includes(realPath) ? realPath : 'OTHER_PATH',
    collectorProfile: collectorProfile === null ? null : displayedProfile(collectorProfile.trim()),
    bwrapProfiles: [...new Set(rows)].slice(0, 32),
    launch: { command: launch.command === '/usr/bin/bwrap' ? launch.command : 'OTHER_EXECUTABLE',
      args: launch.args.map(arg => FLAGS.has(arg) || PATHS.has(arg) ? arg : 'OTHER_PATH_OR_ARGUMENT') },
  };
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
    kernelPolicy: Object.fromEntries(policyKeys.map(key => {
      const value = fixedRead('/proc/sys/kernel/' + key);
      return [key, ['0', '1'].includes(value) ? value : null];
    })) };
  if (phase === 'before') {
    const version = command('/usr/bin/bwrap', ['--version']);
    const packages = command('/usr/bin/dpkg-query', ['-W', '-f=${binary:Package} ${Version}\n', 'bubblewrap', 'apparmor', 'apparmor-utils']);
    const kernel = command('/usr/bin/uname', ['-srm']);
    const profiles = command('/usr/bin/sudo', ['-n', '/usr/bin/cat', '/sys/kernel/security/apparmor/profiles']);
    const facts = selectKs283RuntimeFacts({ bwrapVersion: version.stdout, packages: packages.stdout,
      kernelRelease: kernel.stdout, realPath: realpathSync('/usr/bin/bwrap'), collectorProfile: fixedRead('/proc/self/attr/current'),
      loadedProfiles: profiles.stdout, launch: aggregateSandboxCommand(process.cwd()) });
    result.bwrapVersion = { ...summary(version), version: facts.bwrapVersion };
    result.packages = { ...summary(packages), versions: facts.packages };
    result.kernel = { ...summary(kernel), release: facts.kernelRelease };
    const stat = statSync('/usr/bin/bwrap');
    result.executable = { requestedPath: '/usr/bin/bwrap', realPath: facts.realPath,
      mode: (stat.mode & 0o7777).toString(8), size: stat.size,
      sha256: stat.size <= 16 * 1024 * 1024 ? createHash('sha256').update(readFileSync('/usr/bin/bwrap')).digest('hex') : null };
    result.launch = facts.launch;
    result.collectorProfile = facts.collectorProfile;
    result.bwrapProfiles = { ...summary(profiles), rows: facts.bwrapProfiles };
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
