import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync, openSync, fstatSync, readSync, closeSync, constants,
  mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readLocalObservedWireJson } from '../../../../scripts/lib/h01-local-wire-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const binding = JSON.parse(readFileSync(resolve(root, 'contracts/dependencies/pan526-runtime-source-v1.json'), 'utf8'));
const sources = new WeakMap();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const operations = ['validateRuntimeIdentityV1', 'runtimeIdentityDigestV1', 'assessRuntimeReadinessV1',
  'validateRuntimeDesiredStateV1', 'validateRuntimeObservedStateV1', 'runtimeDesiredStateDigestV1',
  'validateRuntimeLifecycleJobV1', 'runtimeLifecycleJobDigestV1', 'validateRuntimeLifecycleReceiptV1'];
function denied() { throw new Error('H01_PAN_SOURCE_DENIED'); }

// Reuse the approved descriptor-relative no-follow/nonblocking regular-file
// qualification pattern. Source bytes, not pathname existence, bind the SDK.
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
function qualify(sourceRoot, snapshot = false) {
  try {
    if (!snapshot) {
      const git = (...args) => {
        const result = spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', sourceRoot, ...args],
          { encoding: 'utf8', timeout: 5000, maxBuffer: 16384 });
        if (result.error || result.status !== 0) denied();
        return result.stdout.trim();
      };
      if (git('rev-parse', '--show-toplevel') !== sourceRoot || git('rev-parse', 'HEAD') !== binding.producerCommit
        || git('rev-parse', 'HEAD^{tree}') !== binding.producerTree
        || git('status', '--porcelain=v1', '--untracked-files=no') !== '') denied();
    }
    for (const [name, expected] of Object.entries(binding.fileSha256)) {
      if (digest(pinnedRead(sourceRoot, name)) !== expected) denied();
    }
  } catch { denied(); }
}

// An operator-owned exact checkout is required. No network fetch, alias, caller
// API, component registration or execution authority is accepted here. Import
// a private copy of the qualified closure, never a raceable caller module path.
export async function loadH01PanRuntimeSourceV1(sourceRoot) {
  let snapshot;
  try {
    if (typeof sourceRoot !== 'string' || !sourceRoot || !lstatSync(sourceRoot).isDirectory()) denied();
    const heldRoot = realpathSync(sourceRoot); qualify(heldRoot);
    snapshot = mkdtempSync(resolve(tmpdir(), 'ks292-pan-source-'));
    for (const [name, expected] of Object.entries(binding.fileSha256)) {
      const bytes = pinnedRead(heldRoot, name);
      if (digest(bytes) !== expected) denied();
      const destination = resolve(snapshot, name);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, bytes, { flag: 'wx', mode: 0o400 });
    }
    qualify(snapshot, true);
    const api = await import(pathToFileURL(resolve(snapshot, binding.entry)).href);
    qualify(heldRoot); qualify(snapshot, true);
    if (operations.some(name => typeof api[name] !== 'function')) denied();
    const source = Object.freeze({ producerCommit: binding.producerCommit, producerTree: binding.producerTree,
      contractSha256: binding.contractSha256, executionAuthorityGranted: false });
    sources.set(source, { heldRoot, snapshot, api });
    return source;
  } catch {
    if (snapshot) rmSync(snapshot, { recursive: true, force: true });
    denied();
  }
}

// These are the producer's real pure validators/comparers. Neither a validated
// job nor READY grants dispatch, route authority or native observation status.
export function applyH01PanRuntimeContractV1(source, operation, value, context) {
  const held = sources.get(source);
  if (!held || !operations.includes(operation)) denied();
  qualify(held.heldRoot); qualify(held.snapshot, true);
  const wire = readLocalObservedWireJson(value);
  const answer = context === undefined ? held.api[operation](wire)
    : held.api[operation](wire, readLocalObservedWireJson(context));
  qualify(held.heldRoot); qualify(held.snapshot, true);
  return answer;
}

export function releaseH01PanRuntimeSourceV1(source) {
  const entry = sources.get(source);
  if (!entry) denied();
  sources.delete(source);
  rmSync(entry.snapshot, { recursive: true, force: true });
}
