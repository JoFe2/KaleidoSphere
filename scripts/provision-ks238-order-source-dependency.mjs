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
 * Provisioning copies those bytes into `dependencies/pansphaira/`, the FIRST candidate of
 * the consumer's locator, so the canonical test finds the dependency WITHOUT any Git history
 * and WITHOUT a sibling checkout. Every copied byte is verified against the manifest and
 * against the consumer's own declared identity; a mismatch writes nothing.
 *
 * Usage:
 *   node scripts/provision-ks238-order-source-dependency.mjs --from ../PANSPHAIRA-source
 *   node scripts/provision-ks238-order-source-dependency.mjs --verify
 */
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  PAN_ORDER_SOURCE_DEPENDENCY,
  PAN_ORDER_SOURCE_RELEASE,
} from '../services/bi-control/src/business-bi/order-source-consumption.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'contracts/dependencies/pansphaira-order-source-v1.json');
const INSTALL_ROOT = path.join(REPO_ROOT, 'dependencies/pansphaira');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const walkJs = (root) => {
  const out = [];
  const walk = (dir) => {
    for (const entry of [...readdirSync(dir, {withFileTypes: true})]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  walk(root);
  return out;
};

/** Recompute the closure digest exactly as the consumer does, from a producer root. */
const measureClosure = (producerRoot) => {
  const closureRoot = path.join(producerRoot, PAN_ORDER_SOURCE_DEPENDENCY.runtimeClosureRoot);
  const partials = {};
  for (const file of walkJs(closureRoot)) {
    const rel = path.relative(producerRoot, file).split(path.sep).join('/');
    partials[rel] = sha256(readFileSync(file));
  }
  return {closureSha256: sha256(JSON.stringify(partials)), fileCount: Object.keys(partials).length};
};

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? true);
};
const verifyOnly = args.includes('--verify');

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const fail = (code, detail) => {
  process.stderr.write(`PROVISION-DENIED ${code}${detail ? `: ${detail}` : ''}\n`);
  process.exit(1);
};

if (manifest.moduleSha256 !== PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256) {
  fail('MANIFEST_MODULE_DISAGREES_WITH_CONSUMER_PIN',
    `${manifest.moduleSha256} != ${PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256}`);
}
if (manifest.runtimeClosureSha256 !== PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureSha256) {
  fail('MANIFEST_CLOSURE_DISAGREES_WITH_CONSUMER_PIN',
    `${manifest.runtimeClosureSha256} != ${PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureSha256}`);
}
if (manifest.files.length !== PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureFileCount) {
  fail('MANIFEST_FILE_COUNT_DISAGREES_WITH_CONSUMER_PIN',
    `${manifest.files.length} != ${PAN_ORDER_SOURCE_DEPENDENCY.expectedRuntimeClosureFileCount}`);
}
// The manifest's `release` block is the PUBLIC RELEASED SOURCE identity. It must agree with
// the consumer's own pinned release record, so the provision cannot drift away from the
// release it claims to reproduce -- and it must never claim a published compiled bundle.
const release = manifest.release ?? {};
const releaseDisagreements = [
  ['releaseId', release.releaseId, PAN_ORDER_SOURCE_RELEASE.releaseId],
  ['tag', release.tag, PAN_ORDER_SOURCE_RELEASE.tag],
  ['mainCommit', release.mainCommit, PAN_ORDER_SOURCE_RELEASE.mainCommit],
  ['publishedAt', release.publishedAt, PAN_ORDER_SOURCE_RELEASE.publishedAt],
  ['releaseClass', release.releaseClass, PAN_ORDER_SOURCE_RELEASE.releaseClass],
  ['sourceModuleSha256', release.sourceModuleSha256, PAN_ORDER_SOURCE_RELEASE.moduleSha256],
  ['attachedAssets', release.attachedAssets, PAN_ORDER_SOURCE_RELEASE.attachedAssets],
  ['compiledClosurePublished', release.compiledClosurePublished, PAN_ORDER_SOURCE_RELEASE.compiledClosurePublished],
].filter(([, actual, expected]) => actual !== expected);
if (releaseDisagreements.length > 0) {
  fail('MANIFEST_RELEASE_DISAGREES_WITH_CONSUMER_PIN',
    releaseDisagreements.map(([field, actual, expected]) => `${field}:${actual}!==${expected}`).join(', '));
}
if (release.compiledClosurePublished !== false) {
  fail('MANIFEST_RELEASE_INFLATED_INTO_A_PUBLICATION', 'the release is SOURCE_EVIDENCE_ONLY with no assets');
}

const verifyInstall = () => {
  if (!existsSync(path.join(INSTALL_ROOT, manifest.module))) {
    fail('INSTALL_MISSING', `${INSTALL_ROOT} has no provisioned module`);
  }
  const moduleDigest = sha256(readFileSync(path.join(INSTALL_ROOT, manifest.module)));
  if (moduleDigest !== manifest.moduleSha256) {
    fail('INSTALL_MODULE_DIGEST_MISMATCH', `${moduleDigest} != ${manifest.moduleSha256}`);
  }
  const measured = measureClosure(INSTALL_ROOT);
  if (measured.closureSha256 !== manifest.runtimeClosureSha256) {
    fail('INSTALL_CLOSURE_DIGEST_MISMATCH', `${measured.closureSha256} != ${manifest.runtimeClosureSha256}`);
  }
  if (measured.fileCount !== manifest.runtimeClosureFileCount) {
    fail('INSTALL_CLOSURE_FILE_COUNT_MISMATCH', `${measured.fileCount} != ${manifest.runtimeClosureFileCount}`);
  }
  return measured;
};

if (verifyOnly) {
  const measured = verifyInstall();
  process.stdout.write(
    `PROVISION-VERIFIED module=${manifest.moduleSha256.slice(0, 12)}`
    + ` closure=${measured.closureSha256.slice(0, 12)} files=${measured.fileCount}\n`);
  process.exit(0);
}

const from = flag('--from');
if (typeof from !== 'string') fail('MISSING_SOURCE', 'pass --from <producer-root> or --verify');
const producerRoot = path.resolve(process.cwd(), from);
if (!existsSync(producerRoot) || !statSync(producerRoot).isDirectory()) {
  fail('SOURCE_NOT_A_DIRECTORY', producerRoot);
}

const sourceParts = [...manifest.files.map((entry) => entry.path), manifest.module];
for (const rel of sourceParts) {
  if (!existsSync(path.join(producerRoot, rel))) fail('SOURCE_MISSING_FILE', rel);
}
const sourceModuleDigest = sha256(readFileSync(path.join(producerRoot, manifest.module)));
if (sourceModuleDigest !== manifest.moduleSha256) {
  fail('SOURCE_MODULE_DIGEST_MISMATCH', `${sourceModuleDigest} != ${manifest.moduleSha256}`);
}
const sourceClosure = measureClosure(producerRoot);
if (sourceClosure.closureSha256 !== manifest.runtimeClosureSha256) {
  fail('SOURCE_CLOSURE_DIGEST_MISMATCH',
    `${sourceClosure.closureSha256} != ${manifest.runtimeClosureSha256}`);
}
for (const entry of manifest.files) {
  const digest = sha256(readFileSync(path.join(producerRoot, entry.path)));
  if (digest !== entry.sha256) fail('SOURCE_FILE_DIGEST_MISMATCH', entry.path);
}

rmSync(INSTALL_ROOT, {recursive: true, force: true});
mkdirSync(INSTALL_ROOT, {recursive: true});
cpSync(path.join(producerRoot, manifest.module), path.join(INSTALL_ROOT, manifest.module));
cpSync(path.join(producerRoot, PAN_ORDER_SOURCE_DEPENDENCY.runtimeClosureRoot),
  path.join(INSTALL_ROOT, PAN_ORDER_SOURCE_DEPENDENCY.runtimeClosureRoot), {recursive: true});

const installed = verifyInstall();
process.stdout.write(
  `PROVISIONED module=${manifest.moduleSha256.slice(0, 12)}`
  + ` closure=${installed.closureSha256.slice(0, 12)} files=${installed.fileCount}\n`);
