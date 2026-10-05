import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync, openSync, fstatSync, readSync, closeSync, constants,
  mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const binding = JSON.parse(readFileSync(resolve(root, 'contracts/dependencies/pan527-origin-source-development-v1.json'), 'utf8'));
const sessionBinding = JSON.parse(readFileSync(resolve(root, 'contracts/dependencies/pan527-origin-session-source-development-v3.json'), 'utf8'));
const sources = new WeakMap();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function denied() { throw new Error('H02_PAN_ORIGIN_SOURCE_DENIED'); }

// Reuse the H01 descriptor-relative, nonblocking, no-follow source guard.
function pinnedRead(sourceRoot, name) {
  let directory, file;
  try {
    const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    directory = openSync(sourceRoot, directoryFlags);
    const parts = name.split('/');
    for (const part of parts.slice(0, -1)) {
      const next = openSync('/proc/self/fd/' + directory + '/' + part, directoryFlags);
      closeSync(directory); directory = next;
    }
    file = openSync('/proc/self/fd/' + directory + '/' + parts.at(-1), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(file);
    if (!stat.isFile() || stat.size > 1048576) denied();
    const bytes = Buffer.alloc(stat.size + 1); let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(file, bytes, offset, bytes.length - offset, null);
      if (!count) break;
      offset += count;
    }
    if (offset !== stat.size) denied();
    return bytes.subarray(0, offset);
  } finally {
    if (file !== undefined) closeSync(file);
    if (directory !== undefined) closeSync(directory);
  }
}
function qualify(sourceRoot, snapshot = false, selector = binding) {
  try {
    if (!snapshot) {
      const git = (...args) => {
        const result = spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', sourceRoot, ...args],
          { encoding: 'utf8', timeout: 5000, maxBuffer: 16384 });
        if (result.error || result.status !== 0) denied();
        return result.stdout.trim();
      };
      if (git('rev-parse', '--show-toplevel') !== sourceRoot || git('rev-parse', 'HEAD') !== selector.producerCommit
        || git('rev-parse', 'HEAD^{tree}') !== selector.producerTree
        || git('status', '--porcelain=v1', '--untracked-files=no') !== '') denied();
    }
    for (const [name, expected] of Object.entries(selector.fileSha256)) {
      if (digest(pinnedRead(sourceRoot, name)) !== expected) denied();
    }
  } catch { denied(); }
}


// Only the immutable producer's origin rule is exposed. This development
// candidate explicitly lacks a KaleidoSphere protected-session implementation;
// loading it cannot grant hosted routes, CSRF, OIDC or dispatch authority.
export async function loadH02PanOriginSourceV1(sourceRoot) {
  return loadSource(sourceRoot, binding, false);
}

// A distinct exact executable successor, never implicit promotion of v1.
export async function loadH02PanSessionSourceV1(sourceRoot) {
  return loadSource(sourceRoot, sessionBinding, true);
}

async function loadSource(sourceRoot, selector, hasKSReadSession) {
  let snapshot;
  try {
    if (typeof sourceRoot !== 'string' || !sourceRoot || !lstatSync(sourceRoot).isDirectory()) denied();
    const heldRoot = realpathSync(sourceRoot); qualify(heldRoot, false, selector);
    snapshot = mkdtempSync(resolve(tmpdir(), 'ks293-pan-origin-source-'));
    for (const [name, expected] of Object.entries(selector.fileSha256)) {
      const bytes = pinnedRead(heldRoot, name);
      if (digest(bytes) !== expected) denied();
      const destination = resolve(snapshot, name);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, bytes, { flag: 'wx', mode: 0o400 });
    }
    qualify(snapshot, true, selector);
    const contract = JSON.parse(pinnedRead(snapshot, selector.contractPath));
    if (contract.candidateClass !== 'SCOPED_DEVELOPMENT_SOURCE_NOT_RELEASE_OR_ADMISSION') denied();
    if (!hasKSReadSession) {
      if (contract.interfaces.currentlyImplementedComponent !== 'pansphaira-local-demo'
        || contract.interfaces.audience !== 'pansphaira-hosted-origin-v1') denied();
    } else {
      const fields = contract.interfaces;
      if (contract.profileVersion !== '1.0.0-development.3'
        || fields.newExplicitControlRouteNotPortableComponent !== 'kaleidosphere-bi-control'
        || fields.controlAudience !== 'kaleidosphere-protected-control-origin-v1'
        || fields.controlCookie !== '__Host-ks293-session' || fields.controlReadOperationCsrfHeader !== 'x-pan527-csrf'
        || fields.controlMutationMethodAbsent !== true || fields.noNewEffectiveRights !== true
        || JSON.stringify(fields.portableComponentsUnchanged) !== JSON.stringify(['pansphaira-local-demo', 'kaleidosphere-bi-agent'])
        || contract.observedCounterpartSourceNotNewRuntimeObservation.commit !== '67c611c6b523d8d8ee329a65f8a00a589de81e1e'
        || contract.observedCounterpartSourceNotNewRuntimeObservation.tree !== 'c36229b762bac232eb5cc942c9d68272076ee46c') denied();
    }
    const api = await import(pathToFileURL(resolve(snapshot, selector.entry)).href);
    qualify(heldRoot, false, selector); qualify(snapshot, true, selector);
    if (typeof api.validateHostedOriginV1 !== 'function') denied();
    if (hasKSReadSession && ['validateProtectedRouteBindingV1', 'createProtectedRouteSessionAdapterV1'].some(name => typeof api[name] !== 'function')) denied();
    const source = Object.freeze({ producerCommit: selector.producerCommit, producerTree: selector.producerTree,
      contractSha256: selector.contractSha256, KSProtectedSessionAvailable: hasKSReadSession, executionAuthorityGranted: false });
    sources.set(source, { heldRoot, snapshot, api, selector });
    return source;
  } catch {
    if (snapshot) rmSync(snapshot, { recursive: true, force: true });
    denied();
  }
}

export function validateH02PanOriginV1(source, origin) {
  const held = sources.get(source);
  if (!held) denied();
  qualify(held.heldRoot, false, held.selector); qualify(held.snapshot, true, held.selector);
  const answer = held.api.validateHostedOriginV1(origin);
  qualify(held.heldRoot, false, held.selector); qualify(held.snapshot, true, held.selector);
  return answer;
}

// Shared session operations stay inside the exact producer closure. This is a
// KS consumer, not a signing/store/session implementation or mutation grant.
// The origin-only v1 source intentionally fails before any session is created.
export function createH02PanProtectedRouteSessionsV1(source, options) {
  const held = sources.get(source);
  if (!held) denied();
  const guard = () => {
    if (sources.get(source) !== held) denied();
    qualify(held.heldRoot, false, held.selector); qualify(held.snapshot, true, held.selector);
  };
  guard();
  if (source.KSProtectedSessionAvailable !== true
    || typeof held.api.createProtectedRouteSessionAdapterV1 !== 'function') {
    throw new Error('H02_KS_SESSION_CAPABILITY_UNAVAILABLE');
  }
  const adapter = held.api.createProtectedRouteSessionAdapterV1(options);
  guard();
  if (adapter.binding?.componentId !== 'kaleidosphere-bi-control'
    || adapter.binding?.audience !== 'kaleidosphere-protected-control-origin-v1'
    || adapter.authorizeMutation !== undefined
    || ['issueOwnerSession', 'authenticate', 'responseCookie', 'authorizeReadOperation'].some(name => typeof adapter[name] !== 'function')) denied();
  const use = name => (...args) => {
    guard();
    const result = adapter[name](...args);
    guard();
    return result;
  };
  return Object.freeze({ binding: adapter.binding,
    issueOwnerSession: use('issueOwnerSession'), authenticate: use('authenticate'),
    responseCookie: use('responseCookie'),
    authorizeReadOperation: use('authorizeReadOperation') });
}

export function releaseH02PanOriginSourceV1(source) {
  const entry = sources.get(source);
  if (!entry) denied();
  sources.delete(source);
  rmSync(entry.snapshot, { recursive: true, force: true });
}
