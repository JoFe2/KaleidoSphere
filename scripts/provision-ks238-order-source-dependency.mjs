#!/usr/bin/env node
/**
 * FINDING 4 -- portable canonical provisioning.
 *
 * The KS238 canonical test consumed the PAN order-source handoff from a local sibling
 * checkout (`../PANSPHAIRA-source`) that a CI machine may not have, which made the no-`.git`
 * qualification fail. The producer is also PUBLICLY RELEASED (`bounded-order-source-
 * dbdea89e1d55`, Main `dbdea89e1d553a7fdb60727224e1ab677717d371`), and the manifest's
 * `release` block records that released SOURCE identity alongside the bytes below.
 *
 * This provisions the dependency from the PINNED ARTIFACT MANIFEST instead:
 *
 *   contracts/dependencies/pansphaira-order-source-v1.json
 *
 * The manifest records the exact bytes of the wrapper and of the complete compiled runtime
 * closure (`dist/packages/contracts/src`, every `.js` file, path-keyed and sha256-valued).
 *
 * KS254 (#254) -- crash-safe provisioning. The provisioner no longer deletes the installed
 * generation before writing a new one. The complete generation is staged and re-verified
 * inside an owned staging directory, published as an immutable content-addressed generation
 * directory, and committed by flipping ONE pointer symlink (see
 * `services/bi-control/src/generation-store.mjs` and
 * `services/bi-control/src/business-bi/order-source-provisioning.mjs`). The pinned
 * in-repository tree `dependencies/pansphaira/` is never mutated: it remains the shipped,
 * always-complete generation a reader falls back to. An interrupted run therefore leaves
 * either that pinned generation, the previous provisioned generation, or the complete new
 * generation -- never a partial tree and never a deleted-only dependency state.
 *
 * Usage:
 *   node scripts/provision-ks238-order-source-dependency.mjs --from ../PANSPHAIRA-source
 *   node scripts/provision-ks238-order-source-dependency.mjs --from dependencies/pansphaira
 *   node scripts/provision-ks238-order-source-dependency.mjs --verify
 *   node scripts/provision-ks238-order-source-dependency.mjs --inspect
 *   node scripts/provision-ks238-order-source-dependency.mjs --recover
 *   node scripts/provision-ks238-order-source-dependency.mjs --cleanup
 *
 * `--root <dir>` relocates the PROVISIONING TARGET only (an isolated synthetic root); the
 * manifest, the expected digests and the pinned in-repository generation are unaffected.
 * A process killed at any point of a run is the interruption this design is qualified
 * against; storage power loss is not claimed.
 */
import path from 'node:path';
import process from 'node:process';

import {
  ORDER_SOURCE_ACTIVE_RELATIVE,
  ORDER_SOURCE_INSTALL_RELATIVE,
  cleanupOrderSourceDependency,
  inspectOrderSourceDependency,
  orderSourceProvisioningLayout,
  provisionOrderSourceDependency,
  readProvisioningManifest,
  recoverOrderSourceDependency,
  verifyInstalledTree,
} from '../services/bi-control/src/business-bi/order-source-provisioning.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? true);
};
const verifyOnly = args.includes('--verify');
const inspectOnly = args.includes('--inspect');
const recoverOnly = args.includes('--recover');
const cleanupOnly = args.includes('--cleanup');

const fail = (code, detail) => {
  process.stderr.write(`PROVISION-DENIED ${code}${detail ? `: ${detail}` : ''}\n`);
  process.exit(1);
};

// `--root` relocates the PROVISIONING TARGET (the generation store) only; the pinned
// manifest, the pinned in-repository generation and every expected digest stay bound to the
// repository this script ships in.
const requestedRoot = flag('--root');
const targetRoot = typeof requestedRoot === 'string' && requestedRoot.length > 0
  ? path.resolve(process.cwd(), requestedRoot)
  : null;
const repoRoot = REPO_ROOT;

const { manifest } = readProvisioningManifest(repoRoot);
const layout = orderSourceProvisioningLayout(repoRoot, targetRoot);

const summarize = (result) => (
  `module=${result.moduleSha256.slice(0, 12)} closure=${result.closureSha256.slice(0, 12)}`
  + ` files=${result.fileCount}`
);

if (verifyOnly) {
  // The pinned in-repository install remains the reader-visible generation whenever no
  // provisioned generation is active; verify it exactly as before.
  const pinned = verifyInstalledTree(layout.installRoot, manifest);
  if (!pinned.ok) fail(pinned.code, pinned.modulePath ?? pinned.expected ?? pinned.closureRoot ?? '');
  const store = inspectOrderSourceDependency(repoRoot, targetRoot);
  const activeLabel = store.active.ok ? store.active.generationId.slice(0, 12) : 'PINNED_IN_REPO';
  process.stdout.write(
    `PROVISION-VERIFIED module=${pinned.moduleDigest.slice(0, 12)} closure=${pinned.closureSha256.slice(0, 12)}`
    + ` files=${pinned.fileCount} active=${activeLabel} pinned=${ORDER_SOURCE_INSTALL_RELATIVE}`
    + ` pointer=${ORDER_SOURCE_ACTIVE_RELATIVE}\n`,
  );
  process.exit(0);
}

if (inspectOnly) {
  process.stdout.write(`${JSON.stringify(inspectOrderSourceDependency(repoRoot, targetRoot), null, 2)}\n`);
  process.exit(0);
}

if (recoverOnly) {
  const recovered = recoverOrderSourceDependency({ repoRoot, root: targetRoot });
  process.stdout.write(
    `PROVISION-RECOVERED activated=${recovered.activated.length} discarded=${recovered.discarded.length}`
    + ` pointer=${recovered.active.code} pinned=${recovered.pinnedInstall.code}\n`,
  );
  process.exit(0);
}

if (cleanupOnly) {
  const cleaned = cleanupOrderSourceDependency({ repoRoot, root: targetRoot });
  process.stdout.write(
    `PROVISION-CLEANED generations=${cleaned.removedGenerations.length} staging=${cleaned.removedStaging.length}`
    + ` active=${cleaned.activeGenerationId?.slice(0, 12) ?? 'NONE'} pointer=${cleaned.active.code}\n`,
  );
  process.exit(0);
}

const from = flag('--from');
if (typeof from !== 'string') fail('MISSING_SOURCE', 'pass --from <producer-root>, --verify, --inspect, --recover or --cleanup');
const producerRoot = path.resolve(process.cwd(), from);

const result = provisionOrderSourceDependency({ repoRoot, root: targetRoot, producerRoot });
if (!result.ok) {
  const detail = result.disagreements
    ? result.disagreements.map(([code, field, actual, expected]) => `${code}:${field}:${actual}!==${expected}`).join(', ')
    : result.file ?? result.generationId ?? result.producerRoot ?? result.installRoot ?? '';
  fail(result.code, detail);
}
if (!result.active.ok) fail('POLICY_ACTIVE_GENERATION_UNRESOLVED', result.active.code);
process.stdout.write(
  `PROVISIONED module=${result.moduleSha256.slice(0, 12)} closure=${result.closureSha256.slice(0, 12)}`
  + ` files=${result.fileCount} status=${result.status} generation=${result.generationId.slice(0, 12)}`
  + ` pointer=${ORDER_SOURCE_ACTIVE_RELATIVE}\n`,
);
