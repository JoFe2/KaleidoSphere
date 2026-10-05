import { createHash } from 'node:crypto';
import { openSync, fstatSync, readSync, closeSync, constants, readFileSync,
  lstatSync, realpathSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readLocalObservedWireJson } from '../../../../scripts/lib/h01-local-wire-data.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const descriptorSha256 = '4f8ed30d2446639fa4f3b28589a8c9ef362ca8b1083f702fabcc40d22b887255';
const descriptorBytes = readFileSync(resolve(root, 'contracts/dependencies/pan529-runtime-budget-development-v1.json'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const denied = () => { throw new Error('H05_PAN_SHARED_SOURCE_DENIED'); };
if (digest(descriptorBytes) !== descriptorSha256) denied();
const binding = JSON.parse(descriptorBytes);
// Reuse only byte-identical, already pinned Ajv dependencies from the H01
// contract acquisition. This is dependency-byte reuse, not H01/PAN runtime or
// store qualification. Copy them privately too; never import a caller symlink.
const dependencyBindingBytes = readFileSync(resolve(root, 'contracts/dependencies/pan526-runtime-source-v1.json'));
if (digest(dependencyBindingBytes) !== 'bb818eff1be99a2b962a5e89904d120d0f85f949fe5fc77e38389973c0e3ad44') denied();
const dependencyPins = Object.fromEntries(Object.entries(JSON.parse(dependencyBindingBytes).fileSha256)
  .filter(([name]) => name.startsWith('node_modules/')));
const pins = Object.freeze({ ...Object.fromEntries(binding.sourceClosure.map(row => [row.path, row.sha256])),
  ...binding.build.compiledContractPins, ...dependencyPins });
const sources = new WeakMap();
function pinnedRead(sourceRoot, name) {
  let directory, file;
  try {
    const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    directory = openSync(sourceRoot, directoryFlags);
    const parts = name.split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) denied();
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
  } finally { if (file !== undefined) closeSync(file); if (directory !== undefined) closeSync(directory); }
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
      if (git('rev-parse', '--show-toplevel') !== sourceRoot || git('rev-parse', 'HEAD') !== binding.sourceCommit
        || git('rev-parse', 'HEAD^{tree}') !== binding.sourceTree
        || git('status', '--porcelain=v1', '--untracked-files=no') !== '') denied();
    }
    for (const [name, expected] of Object.entries(pins)) if (digest(pinnedRead(sourceRoot, name)) !== expected) denied();
  } catch { denied(); }
}
// Owner-only offline source acquisition. Copy and import exact pure contracts,
// never the PAN native store. Development bytes grant no runtime/source rights.
export async function loadH05SharedRuntimeSourceV1(candidate) {
  let snapshot;
  try {
    const options = readLocalObservedWireJson(candidate);
    if (!options || Array.isArray(options) || Object.keys(options).length !== 2 || options.optIn !== true
      || !Object.hasOwn(options, 'sourceRoot') || typeof options.sourceRoot !== 'string'
      || !lstatSync(options.sourceRoot).isDirectory()) denied();
    const heldRoot = realpathSync(options.sourceRoot); qualify(heldRoot);
    snapshot = mkdtempSync(resolve(tmpdir(), 'ks295-shared-source-'));
    for (const [name, expected] of Object.entries(pins)) {
      const bytes = pinnedRead(heldRoot, name); if (digest(bytes) !== expected) denied();
      const destination = resolve(snapshot, name); mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, bytes, { flag: 'wx', mode: 0o400 });
    }
    qualify(snapshot, true);
    const importPath = name => import(pathToFileURL(resolve(snapshot, name)).href);
    const [budget, envelope, broker, templates, canonical] = await Promise.all([
      importPath('dist/packages/contracts/src/ccp-cost-budget.js'),
      importPath('dist/packages/contracts/src/ccp-event-envelope.js'),
      importPath('dist/packages/contracts/src/model-access-broker.js'),
      importPath('src/pan529/runtime-template-contract.mjs'),
      importPath('dist/packages/contracts/src/canonical-json.js'),
    ]);
    qualify(heldRoot); qualify(snapshot, true);
    if (typeof budget.makeCcpCostBudgetV1 !== 'function' || typeof envelope.readCcpClosedObjectV1 !== 'function'
      || typeof broker.ModelAccessBrokerV1 !== 'function' || typeof templates.planRuntimeTemplateV1 !== 'function') denied();
    const source = Object.freeze({ producerCommit: binding.sourceCommit, producerTree: binding.sourceTree,
      descriptorSha256, classification: binding.classification, executionAuthorityGranted: false,
      PANOwnerStoreQualifiedAsKSLedger: false });
    sources.set(source, { heldRoot, snapshot, api: Object.freeze({ budget, envelope, broker, templates, canonical }) });
    return source;
  } catch { if (snapshot) rmSync(snapshot, { recursive: true, force: true }); denied(); }
}
// Privileged local composition seam. Never route module handles to agents.
export function getH05SharedRuntimeApisV1(source) {
  const held = sources.get(source); if (!held) denied();
  qualify(held.heldRoot); qualify(held.snapshot, true); return held.api;
}
export function releaseH05SharedRuntimeSourceV1(source) {
  const held = sources.get(source); if (!held) denied();
  sources.delete(source); rmSync(held.snapshot, { recursive: true, force: true });
}
