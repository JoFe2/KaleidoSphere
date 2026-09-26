// KS254 (#254) — content-address the crash-safe generation surface in SOURCE-MAP.json so the
// family stays tamper-evident without a full repository re-digest.
//
// Convention mirrors the sibling updaters (scripts/update-ks238-order-source-consumption-source-map.mjs):
// hash the raw bytes of every authored file present on disk, keep the files table sorted by
// localeCompare, and write atomically (unique temp + rename). Idempotent on re-run.
//
// `package.json` is deliberately NOT rewritten by this updater: the canonical command is
// byte-bound to the released C1 certificate's manifest digest, so the new suite is registered
// through the imported-parent route instead of a direct root.
import { createHash } from 'node:crypto';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const sourceMapPath = resolve(root, 'SOURCE-MAP.json');

const authoredFiles = [
  // The shared crash-safe generation store and the two native surfaces that consume it.
  'services/bi-control/src/generation-store.mjs',
  'services/bi-control/src/projection-generation.mjs',
  'services/bi-control/src/business-bi/order-source-provisioning.mjs',
  // The rewired native entry points of the affected paths.
  'services/bi-control/src/business-bi/order-source-consumption.mjs',
  'services/bi-control/src/server.mjs',
  'scripts/provision-ks238-order-source-dependency.mjs',
  // The interruption probes, their crash runner and the evidence runner.
  'tests/ks254-generation-safety.test.mjs',
  'tests/helpers/ks254-generation-runner.mjs',
  'scripts/run-ks254-generation-safety-evidence.mjs',
  // The native HTTP qualification leg: its suite, its loopback server harness and the
  // evidence runner that drives the real product server over actual routes.
  'tests/ks254-http-qualification.test.mjs',
  'tests/helpers/ks254-http-harness.mjs',
  'scripts/run-ks254-http-qualification-evidence.mjs',
  // The registration and self-integrity bytes this migration touches.
  'tests/source-map.test.mjs',
  'tests/canonical-test-topology.test.mjs',
  'scripts/update-ks254-generation-source-map.mjs',
  'docs/evidence/legacy-identity/legacy-technical-identity-inventory-v1.json',
];

const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
for (const file of authoredFiles) {
  try { await access(resolve(root, file)); } catch { continue; }
  sourceMap.files[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
}
sourceMap.files = Object.fromEntries(Object.entries(sourceMap.files).sort(([left], [right]) => left.localeCompare(right)));
const temporary = `${sourceMapPath}.ks254-${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(sourceMap, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, sourceMapPath);
process.stdout.write(
  `KS254 source map updated: ${authoredFiles.filter((file) => Object.hasOwn(sourceMap.files, file)).length} authored files, ${Object.keys(sourceMap.files).length} total entries\n`,
);
