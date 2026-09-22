// KaleidoSphere #238 — the KS RECEIVING side of the PAN order/source handoff, and the
// SUPPORTED CURRENT-ORDER comparison.  This is a RECEIVER, not a second order-management
// module and not a second producer.
//
// What it composes (nothing is reimplemented):
//
//   PAN (producer, the actual dependency)
//     `src/ks238/order-source-handoff.mjs` on the pinned parent candidate
//     2fb96e3f8ef599459da7f2ca8bd087c463366fc1:
//       createKs238OrderSourceHandoff({ contract, sourceBytes, sourceLabel, enabled, now })
//         -> { outcome: "ADAPTED", binding, bindingDigest, supported, unsupportedFacts,
//              contentBinding }
//       rebindSerializedOrderSource({ sourceLabel, sourceBytes, sourceBytesSha256,
//                                     contract, now, binding, bindingDigest })
//         -> { outcome: "REBOUND", ... } | { outcome: "DENIED", code }
//     The producer owns ALL source authority: it decodes and labels the synthetic source
//     bytes and EXECUTES the released ERP readers itself.  This module never re-implements
//     the reader, never re-decodes the source, and never re-derives the binding digest.
//
//   KS (this module)
//     `net-revenue-segment-comparison.mjs` — the RELEASED net-revenue comparison.  It is
//     imported read-only and its own published numbers are CARRIED THROUGH VERBATIM.
//
// The point of the module is the SEPARATION the issue asks for: order intake / current
// order counts by status come from the actual released readers over the labelled synthetic
// order/source export, while net revenue comes from the separately bounded segment
// comparison over a DIFFERENT synthetic dataset.  The two are reported SIDE BY SIDE and
// are never added, netted, reconciled, or causally linked — see ORDER_VS_REVENUE_SEPARATION
// and the nonclaims below.
//
// Explicitly unavailable, never inferred (the producer's own closed contract is carried
// through unchanged): netRevenue-derived order facts, orderedQuantity, quantity unit,
// amount/currency value, delivery facts, historical order book (including
// `history.previousStates`), order intake monetary aggregates, and credit/cancellation
// netting.  Per-order quantity AND unit are UNAVAILABLE for this reader, so a unitless
// reader result never becomes a per-order EACH fact.
//
// This is the LOCAL synthetic source over released readers.  It grants no production ERP
// qualification, no order-management, write, approval, network, provider, runtime,
// publication or public-write authority, and it is not the complete KS238 capability.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  NET_REVENUE_SEGMENT_COMPARISON_SCHEMA,
  SYNTHETIC_SEGMENT_SOURCE,
  PERIODS as NET_REVENUE_COMPARISON_PERIODS,
  compareSegmentsAcrossPeriods,
  buildSegmentComparisonReport,
  comparisonDigest,
} from './net-revenue-segment-comparison.mjs';

export const ORDER_SOURCE_CONSUMPTION_SCHEMA =
  'kaleidosphere.business-bi/order-source-consumption/v1';

// The pinned PAN source handoff, as an EXACT identity.  `expectedModuleSha256` is the
// digest of `src/ks238/order-source-handoff.mjs` at that commit; `expectedRuntimeSha256`
// is the digest of the runtime commit a1b65af that the AUFTRAG names.  Both are verified
// BEFORE the producer module is imported (see resolveOrderSourceHandoffModule), so a
// substituted or drifted producer is refused rather than silently consumed.
export const PAN_ORDER_SOURCE_DEPENDENCY = Object.freeze({
  module: 'src/ks238/order-source-handoff.mjs',
  producerRepo: 'PANSPHAIRA',
  branch: 'integrate/ks238-corrected',
  parentCandidateCommit: '2fb96e3f8ef599459da7f2ca8bd087c463366fc1',
  runtimeCommit: 'a1b65af354e17f206bc7bc1c5df29cdcb11bef6f',
  expectedModuleSha256: 'a9b3e0d28133c0f2a2aa2a1b7a630693a50aea993814993c23e3d4c573d2b917',
  // The producer wrapper IMPORTS its real implementation from
  // `../../dist/packages/contracts/src/index.js`. Pinning only the wrapper bytes therefore
  // does NOT bind the executable reader: an isolated directory can carry the exact genuine
  // wrapper plus a substituted runtime and be consumed as if it were the pinned producer.
  //
  // This is the ARTIFACT-BASED closure pin. It is the content digest of the producer's
  // compiled runtime directory (every `.js` under
  // `dist/packages/contracts/src`, path-keyed in sorted order), so it is verifiable from
  // bytes alone: no private Git history, no network, no published release required. The
  // digest is computed from the actual pinned build, and the git blob check below remains
  // an ADDITIONAL, optional confirmation rather than the identity itself.
  runtimeClosureRoot: 'dist/packages/contracts/src',
  expectedRuntimeClosureSha256: 'a4db88ea0b8dc08024992e433d5742fa01a7b24f463d281d3a5beed9fe8dd866',
  expectedRuntimeClosureFileCount: 156,
  // The two release-critical members of the closure, named explicitly so a caller can
  // report WHICH byte drifted instead of only that something did.
  runtimeCriticalFiles: Object.freeze({
    'index.js': '06af2801509b54af28dae3a380fa5079404b4a761c7a9f5e0632ffb517f5a6eb',
    'erp-read-connector.js': '63d592d8b9ba194bba1927df92d09ffc8eb60c8070f47f529fd31698e701fe82',
  }),
  expectedRuntimeSha256: '06af2801509b54af28dae3a380fa5079404b4a761c7a9f5e0632ffb517f5a6eb',
  producerEntryPoints: Object.freeze({
    create: 'createKs238OrderSourceHandoff',
    rebind: 'rebindSerializedOrderSource',
  }),
  // The producer module is consumed ONLY through this explicit locator.  It is never
  // resolved through a private Git history, an absolute host path baked into source, or a
  // package registry the CI machine may not have.
  defaultCandidates: Object.freeze([
    // FIRST a local sibling checkout when one is present (it carries a Git object
    // database, so the commit binding can be a positive MATCH), THEN the pinned artifact
    // provision, which needs no Git history at all. Both are integrity-checked against the
    // same module + runtime-closure pins, so a provisioned tree is a first-class identity,
    // not a fallback that weakens the check. The producer IS publicly released
    // (PAN_ORDER_SOURCE_RELEASE below), so canonical qualification needs NEITHER the
    // sibling NOR any private history: the released source bytes are the identity.
    '../PANSPHAIRA-source/src/ks238/order-source-handoff.mjs',
    'dependencies/pansphaira/src/ks238/order-source-handoff.mjs',
  ]),
  scanBases: Object.freeze([
    'KaleidoSphere',
    'PANSPHAIRA-source',
    'PANSPHAIRA',
    '.',
  ]),
  envVar: 'KS238_PAN_ORDER_SOURCE_MODULE',
  defaultSourceBytes: 'tests/fixtures/erp-read/supported-export-v1.json',
  defaultContract: 'tests/fixtures/erp-read/contract-v1.json',
});

// The PUBLIC RELEASED SOURCE IDENTITY of the producer, independent of any local checkout.
//
// The producer is NOT unpublished: `bounded-order-source-dbdea89e1d55` is a public GitHub
// release whose tag resolves to Main `dbdea89e1d553a7fdb60727224e1ab677717d371`, published
// 2026-09-22T20:43:57Z. It is a SOURCE_EVIDENCE_ONLY release and carries NO attached assets:
// the released artifact IS the source module, and the released repository's own SHA256SUMS
// lists that module at exactly `moduleSha256` below. Nothing here is a placeholder for a
// future publication, and nothing here claims a published COMPILED bundle.
//
// The three identities this record keeps apart (FINDING: they must never be conflated):
//
//   1. PUBLIC RELEASED SOURCE — the module bytes at the released Main / release tag. This is
//      the authority. It is what `moduleSha256` binds.
//   2. RETAINED COMPILED ARTIFACT — `dist/packages/contracts/src` beside the located module.
//      The release publishes SOURCE ONLY, so this closure is a LOCAL BUILD of the released
//      source (locked build `tsc -p tsconfig.json`), reproducible from the released bytes.
//      It is byte-identical to `runtimeClosureSha256`, but it was NOT published as a release
//      asset and `compiledClosurePublished` stays false.
//   3. HISTORICAL CANDIDATE COMMITS — the corrected-branch commits below. They are public
//      and they carry the SAME handoff module bytes, but they are NOT Main and NOT the
//      release. A commit binding to them is provenance, never a public release identifier.
//
// A fourth, optional fact is the Git object-database binding reported as `commitBinding`
// (MATCH / MISMATCH / UNRESOLVED). It is additional confirmation, never the identity.
export const PAN_ORDER_SOURCE_RELEASE = Object.freeze({
  host: 'github',
  repository: 'JoFe2/PANSPHAIRA',
  releaseId: 'bounded-order-source-dbdea89e1d55',
  tag: 'bounded-order-source-dbdea89e1d55',
  mainCommit: 'dbdea89e1d553a7fdb60727224e1ab677717d371',
  publishedAt: '2026-09-22T20:43:57Z',
  releaseClass: 'SOURCE_EVIDENCE_ONLY',
  proofClass: 'SOURCE_EVIDENCE',
  gate: 'ANONYMOUS_PUBLIC_READBACK',
  // The published release has no attached assets: it is source-only.
  attachedAssets: 0,
  module: 'src/ks238/order-source-handoff.mjs',
  // The released module bytes, equal to the release's own SHA256SUMS entry.
  moduleSha256: 'a9b3e0d28133c0f2a2aa2a1b7a630693a50aea993814993c23e3d4c573d2b917',
  // The locked, supported local build that compiles the released source to the closure.
  buildCommand: 'tsc -p tsconfig.json',
  runtimeClosureRoot: 'dist/packages/contracts/src',
  runtimeClosureSha256: 'a4db88ea0b8dc08024992e433d5742fa01a7b24f463d281d3a5beed9fe8dd866',
  runtimeClosureFileCount: 156,
  // SOURCE-EVIDENCE ONLY: the compiled closure is a reproducible local build of the released
  // source, NOT a published release artifact. Never reported as published.
  compiledClosurePublished: false,
  // Historical candidate commits (public; NOT Main, NOT the release). Same module bytes.
  historicalCandidateCommits: Object.freeze([
    'a1b65af354e17f206bc7bc1c5df29cdcb11bef6f',
    '2fb96e3f8ef599459da7f2ca8bd087c463366fc1',
  ]),
});

export const ORDER_SOURCE_CONSUMPTION_NONCLAIMS = Object.freeze([
  'This is a RECEIVER of the PAN order/source handoff. It is not a second order-management module and it does not re-read, re-decode or re-bind the source.',
  'The synthetic ORDER/source export and the synthetic REVENUE ledger are DISTINCT datasets. Their published numbers are reported side by side and are never added, netted, reconciled or claimed to be causally related.',
  'No causal attribution: an order-status move is not an explanation of a net-revenue move.',
  'Order status counts are a census of ORDER events, not revenue. netRevenue is never inferred from orderStatus, ordered quantity, or the reader totalMinor field.',
  'Per-order ordered quantity and unit are UNAVAILABLE for this reader: the selected order source and the released readers expose no quantity and no unit, so a unitless reader result never becomes a per-order EACH fact.',
  'Order intake monetary aggregates, delivery facts, historical order book (history.previousStates) and credit/cancellation netting remain UNAVAILABLE.',
  'A HELD, unattested or unpinned PAN dependency is consumed as an explicit UNAVAILABLE status, never as a fabricated RELEASED proof; no release is inferred or upgraded here.',
  'No production ERP qualification and no complete KS238 capability is claimed.',
]);

// ------------------------------------------------ producer locator + integrity

const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

/**
 * Compute the ARTIFACT-BASED identity of the producer's executable runtime closure.
 *
 * The producer wrapper does not implement the reader; it imports it. So the bytes that
 * decide what a consumption actually REPORTS are the compiled runtime files, and an
 * identity that pins only the wrapper is not an identity of the executed code.
 *
 * This walks every `.js` file under `runtimeClosureRoot` beside the located wrapper,
 * keyed by its path relative to the producer root, in sorted order, and hashes the
 * resulting map. It needs NO Git history: the same bytes on any host produce the same
 * digest, so the check is portable and the portable artifact digest is the identity.
 *
 * Returns an explicit verdict; a missing directory is `UNAVAILABLE` (honest absence,
 * e.g. an unbuilt checkout), never a silent pass.
 */
export function computeRuntimeClosureSha256({ moduleFile, dependency = PAN_ORDER_SOURCE_DEPENDENCY } = {}) {
  // The wrapper lives at <producerRoot>/src/ks238/order-source-handoff.mjs and imports
  // '../../dist/...'. Walk up from the wrapper's own directory to that producer root, so
  // the closure is measured beside the ACTUAL resolved module rather than from any other
  // repository a caller happens to name.
  const producerRoot = path.resolve(path.dirname(moduleFile), '..', '..');
  const closureRoot = path.resolve(producerRoot, dependency.runtimeClosureRoot);
  if (!existsSync(closureRoot)) {
    return { ok: false, state: 'UNAVAILABLE', code: 'PAN_ORDER_SOURCE_RUNTIME_CLOSURE_MISSING', closureRoot };
  }
  const files = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(closureRoot);
  if (files.length === 0) {
    return { ok: false, state: 'UNAVAILABLE', code: 'PAN_ORDER_SOURCE_RUNTIME_CLOSURE_EMPTY', closureRoot };
  }
  const partials = {};
  let criticalMismatch = null;
  for (const file of files) {
    const rel = path.relative(producerRoot, file).split(path.sep).join('/');
    const digest = sha256Hex(readFileSync(file));
    partials[rel] = digest;
    const criticalName = Object.keys(dependency.runtimeCriticalFiles ?? {})
      .find((name) => rel === `${dependency.runtimeClosureRoot}/${name}`);
    if (criticalName !== undefined && digest !== dependency.runtimeCriticalFiles[criticalName]) {
      criticalMismatch = { file: rel, actual: digest, expected: dependency.runtimeCriticalFiles[criticalName] };
    }
  }
  const closureSha256 = sha256Hex(JSON.stringify(partials));
  const expected = dependency.expectedRuntimeClosureSha256;
  return {
    ok: closureSha256 === expected && criticalMismatch === null,
    state: closureSha256 === expected && criticalMismatch === null ? 'AVAILABLE' : 'DENIED',
    code: closureSha256 === expected && criticalMismatch === null
      ? 'OK'
      : 'PAN_ORDER_SOURCE_RUNTIME_CLOSURE_DENIED',
    closureRoot,
    fileCount: files.length,
    closureSha256,
    expectedClosureSha256: expected,
    criticalMismatch,
  };
}

/**
 * QUALIFY a located producer against the PUBLIC RELEASED SOURCE IDENTITY.
 *
 * This is the narrow executable binding that keeps four identities apart instead of
 * letting them collapse into "the producer":
 *
 *   - PUBLIC RELEASED SOURCE      the module bytes at the released Main / release tag;
 *   - RETAINED COMPILED ARTIFACT  the closure built beside the located module;
 *   - HISTORICAL CANDIDATE        the public corrected-branch commits (same module bytes);
 *   - GIT EVIDENCE                the optional `commitBinding` (MATCH / MISMATCH / UNRESOLVED).
 *
 * It is BYTES-ONLY and therefore PORTABLE: no network, no `.git`, no sibling checkout, no
 * package registry. Given the same released bytes on any host it returns the same verdict,
 * and it refuses when the bytes are not the released ones — it never upgrades a source-only
 * release into a compiled publication.
 *
 * Expected values come ONLY from the pinned released identity (`release`, defaulting to
 * PAN_ORDER_SOURCE_RELEASE) and the consumer pin (`dependency`). A caller may pass `claimed`
 * to have its own declaration checked, and any disagreement is a DENIAL: an unverified
 * release id is not an identity. Naming a HISTORICAL CANDIDATE commit as the release is the
 * wrong-release-identity case and is refused the same way.
 *
 * A missing module is an honest UNAVAILABLE, never a pass.
 */
export function qualifyReleasedOrderSourceBinding({
  moduleFile,
  dependency = PAN_ORDER_SOURCE_DEPENDENCY,
  release = PAN_ORDER_SOURCE_RELEASE,
  claimed = null,
} = {}) {
  const base = {
    release: {
      host: release.host,
      repository: release.repository,
      releaseId: release.releaseId,
      tag: release.tag,
      mainCommit: release.mainCommit,
      publishedAt: release.publishedAt,
      releaseClass: release.releaseClass,
      proofClass: release.proofClass,
      gate: release.gate,
      attachedAssets: release.attachedAssets,
      compiledClosurePublished: release.compiledClosurePublished,
    },
    historicalCandidate: {
      commits: [...release.historicalCandidateCommits],
      isTheRelease: false,
      state: 'NOT_THE_RELEASE',
    },
  };
  const deny = (code, detail) => ({
    ok: false, state: 'DENIED', code, ...base, ...detail,
    // A decision this function makes is never itself a release identifier.
    releaseBinding: null,
  });
  const unavailable = (code, detail) => ({
    ok: false, state: 'UNAVAILABLE', code, ...base, ...detail, releaseBinding: null,
  });

  // 0. The two pins must agree with each other before either is used as an expectation.
  //    A silent divergence here would let the consumer verify one identity while reporting
  //    another, so it is a DENIAL rather than a warning.
  const pinDivergence = [];
  if (dependency.expectedModuleSha256 !== release.moduleSha256) pinDivergence.push('moduleSha256');
  if (dependency.expectedRuntimeClosureSha256 !== release.runtimeClosureSha256) pinDivergence.push('runtimeClosureSha256');
  if (dependency.expectedRuntimeClosureFileCount !== release.runtimeClosureFileCount) pinDivergence.push('runtimeClosureFileCount');
  if (pinDivergence.length > 0) {
    return deny('PAN_ORDER_SOURCE_RELEASE_PIN_DIVERGENCE', { pinDivergence });
  }

  // 1. A caller's own release declaration, when supplied, must match the pinned release.
  //    This is the "wrong release identity" boundary: it distinguishes the release from the
  //    historical candidate commits, which carry the same module bytes.
  if (claimed !== null && claimed !== undefined) {
    const claim = claimed ?? {};
    const identityFields = ['releaseId', 'tag', 'mainCommit'];
    const identityMismatch = identityFields
      .filter((field) => claim[field] !== undefined && claim[field] !== release[field])
      .map((field) => ({ field, claimed: claim[field], expected: release[field] }));
    if (identityMismatch.length > 0) {
      const namesHistoricalCandidate = identityMismatch.some((m) => (
        release.historicalCandidateCommits.includes(m.claimed)
      ));
      return deny('PAN_ORDER_SOURCE_RELEASE_IDENTITY_DENIED', {
        identityMismatch,
        namesHistoricalCandidate,
        reason: namesHistoricalCandidate
          ? 'A HISTORICAL CANDIDATE commit was presented as the public release identity; '
            + 'the candidate carries the same module bytes but is not Main and not the release.'
          : 'The claimed release identity is not the pinned public release identity.',
      });
    }
    if (claim.moduleSha256 !== undefined && claim.moduleSha256 !== release.moduleSha256) {
      return deny('PAN_ORDER_SOURCE_RELEASE_MODULE_DENIED', {
        claimed: { moduleSha256: claim.moduleSha256 },
        actual: { moduleSha256: release.moduleSha256 },
        reason: 'The claimed released module bytes are not the pinned released module bytes.',
      });
    }
    if (claim.runtimeClosureSha256 !== undefined
      && claim.runtimeClosureSha256 !== release.runtimeClosureSha256) {
      return deny('PAN_ORDER_SOURCE_RELEASE_CLOSURE_DENIED', {
        claimed: { runtimeClosureSha256: claim.runtimeClosureSha256 },
        actual: { runtimeClosureSha256: release.runtimeClosureSha256 },
        reason: 'The claimed released closure bytes are not the pinned released closure bytes.',
      });
    }
  }

  // 2. Measure the ACTUAL bytes. Nothing below is taken from the caller.
  if (typeof moduleFile !== 'string' || moduleFile.length === 0) {
    return unavailable('PAN_ORDER_SOURCE_RELEASE_MODULE_MISSING', { moduleFile: moduleFile ?? null });
  }
  if (!existsSync(moduleFile)) {
    return unavailable('PAN_ORDER_SOURCE_RELEASE_MODULE_NOT_FOUND', { moduleFile });
  }
  const moduleBytes = readFileSync(moduleFile);
  const moduleSha256 = sha256Hex(moduleBytes);
  if (moduleSha256 !== release.moduleSha256) {
    return deny('PAN_ORDER_SOURCE_RELEASE_MODULE_DENIED', {
      moduleFile,
      actual: { moduleSha256 },
      expected: { moduleSha256: release.moduleSha256 },
      reason: 'The located module bytes are not the bytes of the public released source.',
    });
  }
  const runtimeClosure = computeRuntimeClosureSha256({ moduleFile, dependency });
  if (!runtimeClosure.ok) {
    return deny('PAN_ORDER_SOURCE_RELEASE_CLOSURE_DENIED', {
      moduleFile,
      runtimeClosure,
      expected: { runtimeClosureSha256: release.runtimeClosureSha256, fileCount: release.runtimeClosureFileCount },
      reason: 'The compiled closure beside the located module is not the closure of the released source.',
    });
  }

  return {
    ok: true,
    state: 'QUALIFIED',
    code: 'OK',
    releaseBinding: 'PUBLIC_RELEASED_SOURCE',
    ...base,
    publicReleasedSource: {
      module: release.module,
      moduleSha256,
      expectedModuleSha256: release.moduleSha256,
      state: 'MATCH',
      // SOURCE_EVIDENCE_ONLY: the released artifact IS the source module.
      compiledAssetsPublished: false,
    },
    retainedCompiledArtifact: {
      closureRoot: runtimeClosure.closureRoot,
      fileCount: runtimeClosure.fileCount,
      closureSha256: runtimeClosure.closureSha256,
      expectedClosureSha256: release.runtimeClosureSha256,
      // Byte-identical to the closure the released source compiles to, under the locked
      // local build. Reproducible from the released bytes -- and NOT a published asset.
      state: 'BYTE_IDENTICAL_TO_RELEASED_SOURCE_BUILD',
      buildCommand: release.buildCommand,
      publishedAsReleaseAsset: false,
    },
    historicalCandidate: {
      commits: [...release.historicalCandidateCommits],
      isTheRelease: false,
      state: 'NOT_THE_RELEASE',
      // Recorded: the candidate commits carry the same module bytes, so bytes alone cannot
      // tell the candidate from the release -- the release identity above is what does.
      moduleSha256,
      sameModuleBytesAsRelease: true,
    },
  };
}

function locateOrderSourceModuleFile(explicitPath, repoRoot) {
  if (typeof explicitPath === 'string' && explicitPath.length > 0) {
    if (!existsSync(explicitPath)) return { ok: false, reason: 'EXPLICIT_PATH_MISSING' };
    return { ok: true, file: path.resolve(explicitPath) };
  }
  const envPath = process.env?.[PAN_ORDER_SOURCE_DEPENDENCY.envVar];
  if (typeof envPath === 'string' && envPath.length > 0) {
    if (!existsSync(envPath)) return { ok: false, reason: 'ENV_PATH_MISSING' };
    return { ok: true, file: path.resolve(envPath) };
  }
  for (const base of PAN_ORDER_SOURCE_DEPENDENCY.scanBases) {
    for (const candidate of PAN_ORDER_SOURCE_DEPENDENCY.defaultCandidates) {
      const file = path.resolve(repoRoot, base, candidate);
      if (existsSync(file)) return { ok: true, file };
    }
  }
  return { ok: false, reason: 'NOT_FOUND' };
}

/**
 * Resolve the ACTUAL PAN producer module and PROVE its identity before use.
 *
 * Two independent facts are required, and a caller may not supply either as its own
 * authority:
 *
 *  1. BYTES — the module's sha256 must equal PAN_ORDER_SOURCE_DEPENDENCY
 *     .expectedModuleSha256.  A substituted or drifted producer file is refused.
 *  2. COMMIT — when `producerRepoRoot` is a Git checkout of the pinned repository, the
 *     module's blob must equal the content of the pinned module path at
 *     `parentCandidateCommit`.  This is read from the producer's OWN object database
 *     (`git cat-file`), so it is independent of whatever bytes are currently in the
 *     working tree.
 *
 * A missing module is NOT an exception: it is an explicit, honest UNAVAILABLE status.
 * Callers decide whether that is fatal for their run.
 */
export async function resolveOrderSourceHandoffModule({
  repoRoot,
  explicitPath = null,
  producerRepoRoot = null,
  spawnSyncImpl = null,
} = {}) {
  const root = repoRoot ?? process.cwd();
  const located = locateOrderSourceModuleFile(explicitPath, root);
  if (!located.ok) {
    return {
      ok: false,
      state: 'UNAVAILABLE',
      code: `PAN_ORDER_SOURCE_MODULE_${located.reason}`,
      dependency: PAN_ORDER_SOURCE_DEPENDENCY,
    };
  }
  const bytes = readFileSync(located.file);
  const moduleSha256 = sha256Hex(bytes);
  if (moduleSha256 !== PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256) {
    return {
      ok: false,
      state: 'DENIED',
      code: 'PAN_ORDER_SOURCE_MODULE_INTEGRITY_DENIED',
      file: located.file,
      moduleSha256,
      expectedModuleSha256: PAN_ORDER_SOURCE_DEPENDENCY.expectedModuleSha256,
      dependency: PAN_ORDER_SOURCE_DEPENDENCY,
    };
  }
  let commitBinding = 'UNRESOLVED';
  if (typeof producerRepoRoot === 'string' && producerRepoRoot.length > 0) {
    const spawn = spawnSyncImpl ?? (await import('node:child_process')).spawnSync;
    const result = spawn('git', ['cat-file', 'blob',
      `${PAN_ORDER_SOURCE_DEPENDENCY.parentCandidateCommit}:${PAN_ORDER_SOURCE_DEPENDENCY.module}`,
    ], { cwd: producerRepoRoot, encoding: null, maxBuffer: 64 * 1024 * 1024 });
    if (result.status === 0 && result.stdout) {
      const committed = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
      commitBinding = sha256Hex(committed) === moduleSha256 ? 'MATCH' : 'MISMATCH';
    } else {
      commitBinding = 'UNRESOLVED';
    }
  }
  if (commitBinding === 'MISMATCH') {
    return {
      ok: false,
      state: 'DENIED',
      code: 'PAN_ORDER_SOURCE_MODULE_COMMIT_DENIED',
      file: located.file,
      moduleSha256,
      commitBinding,
      dependency: PAN_ORDER_SOURCE_DEPENDENCY,
    };
  }
  // FINDING 3: the wrapper's own bytes are pinned above, but the wrapper does not
  // implement the reader -- it imports it from the compiled runtime. Verify the FULL
  // runtime closure BEFORE importing, so a genuine wrapper carrying a substituted
  // implementation is refused instead of consumed. This runs pre-import by construction:
  // no producer code has executed at this point.
  const runtimeClosure = computeRuntimeClosureSha256({
    moduleFile: located.file,
    dependency: PAN_ORDER_SOURCE_DEPENDENCY,
  });
  if (!runtimeClosure.ok) {
    return {
      ok: false,
      state: runtimeClosure.state,
      code: runtimeClosure.code,
      file: located.file,
      moduleSha256,
      commitBinding,
      runtimeClosure,
      dependency: PAN_ORDER_SOURCE_DEPENDENCY,
    };
  }
  // Independently QUALIFY the located producer against the PUBLIC RELEASED SOURCE IDENTITY
  // before any producer code executes. This keeps the released source, the retained compiled
  // artifact, the historical candidate commits and the optional Git evidence apart instead of
  // collapsing them into "the producer". The qualification is bytes-only, so it holds with no
  // `.git` and no sibling checkout.
  const release = qualifyReleasedOrderSourceBinding({
    moduleFile: located.file,
    dependency: PAN_ORDER_SOURCE_DEPENDENCY,
  });
  if (!release.ok) {
    return {
      ok: false,
      state: release.state,
      code: release.code,
      file: located.file,
      moduleSha256,
      commitBinding,
      runtimeClosure,
      release,
      dependency: PAN_ORDER_SOURCE_DEPENDENCY,
    };
  }
  const producer = await import(pathToFileURL(located.file).href);
  for (const name of Object.values(PAN_ORDER_SOURCE_DEPENDENCY.producerEntryPoints)) {
    if (typeof producer[name] !== 'function') {
      return {
        ok: false,
        state: 'DENIED',
        code: 'PAN_ORDER_SOURCE_ENTRYPOINT_MISSING',
        file: located.file,
        missingEntryPoint: name,
        dependency: PAN_ORDER_SOURCE_DEPENDENCY,
      };
    }
  }
  return {
    ok: true,
    state: 'AVAILABLE',
    code: 'OK',
    file: located.file,
    moduleSha256,
    commitBinding,
    release,
    producer,
    dependency: PAN_ORDER_SOURCE_DEPENDENCY,
  };
}

// ------------------------------------------ retained source authority (OUTSIDE payload)

/**
 * Build the source identity that the receiver RETAINS, independently of any carried
 * handoff payload.
 *
 * The producer's rebind contract deliberately accepts only non-payload identity:
 * `sourceLabel`, `sourceBytes`, `sourceBytesSha256`, the released `contract`, and the
 * decision `now`.  A bundle that carried both its own evidence AND the anchor it is
 * checked against would not be source authority at all, so the receiver keeps the anchor
 * on the OUTSIDE and requires the caller to name the files it selected.  The receiver
 * then reads those bytes itself; the caller's claimed digests are never trusted.
 */
export function createRetainedSourceAuthority({
  sourceBytesFile,
  contractFile,
  sourceLabel,
  now,
  enabled = true,
  repoRoot = null,
}) {
  // Paths are resolved against the CALLER's repo root (defaulting to cwd), so the
  // retained identity does not depend on the process's ambient working directory.
  const root = repoRoot ?? process.cwd();
  const resolve = (p) => (path.isAbsolute(p) ? p : path.resolve(root, p));
  const missing = [];
  if (typeof sourceBytesFile !== 'string' || sourceBytesFile.length === 0) missing.push('sourceBytesFile');
  if (typeof contractFile !== 'string' || contractFile.length === 0) missing.push('contractFile');
  if (typeof sourceLabel !== 'string' || sourceLabel.length === 0) missing.push('sourceLabel');
  if (typeof now !== 'string' || now.length === 0) missing.push('now');
  if (missing.length > 0) {
    return {
      ok: false,
      state: 'UNAVAILABLE',
      code: 'RETAINED_SOURCE_AUTHORITY_REQUIRED',
      missing,
    };
  }
  const sourceBytesPath = resolve(sourceBytesFile);
  const contractPath = resolve(contractFile);
  if (!existsSync(sourceBytesPath)) {
    return { ok: false, state: 'UNAVAILABLE', code: 'RETAINED_SOURCE_BYTES_MISSING', file: sourceBytesPath };
  }
  if (!existsSync(contractPath)) {
    return { ok: false, state: 'UNAVAILABLE', code: 'RETAINED_CONTRACT_MISSING', file: contractPath };
  }
  const sourceBytes = readFileSync(sourceBytesPath);
  const contractBytes = readFileSync(contractPath);
  let contract;
  try {
    contract = JSON.parse(contractBytes.toString('utf8'));
  } catch {
    return { ok: false, state: 'DENIED', code: 'RETAINED_CONTRACT_MALFORMED', file: contractPath };
  }
  // FINDING 2: freezing the authority record stops FIELD reassignment, but the retained
  // source bytes are a Buffer -- a mutable object whose freeze() only blocks property
  // changes, not writes into the bytes themselves. In-place mutation (e.g.
  // `authority.sourceBytes.write('2026-01', offset)`) therefore changed what the producer
  // re-read while `sourceBytesSha256` kept asserting the ORIGINAL byte identity, so a
  // forged payload could be consumed as if it were the retained one.
  //
  // The fix is to consume an IMMUTABLE COPY, and to make the identity a property of the
  // copy that is recomputed from the copy's own bytes. A caller holding a reference to the
  // buffer it passed in can no longer reach the bytes this authority consumes.
  const retainedBytes = Buffer.from(sourceBytes); // deliberate copy: never the caller's buffer
  const authority = {
    sourceLabel,
    sourceBytes: retainedBytes,
    sourceBytesSha256: sha256Hex(retainedBytes),
    contract,
    contractSha256: sha256Hex(contractBytes),
    now,
    enabled: enabled === true,
    sourceBytesFile: sourceBytesPath,
    contractFile: contractPath,
  };
  // The anchor is FROZEN: it is a plain, non-extensible record, so nothing downstream can
  // mutate the retained identity into agreeing with a substituted payload.
  return { ok: true, state: 'RETAINED', code: 'OK', authority: Object.freeze(authority) };
}

function assertRetainedAuthority(authority) {
  if (authority === null || typeof authority !== 'object' || !Object.isFrozen(authority)) {
    const e = new Error('RETAINED_SOURCE_AUTHORITY_REQUIRED');
    e.code = 'RETAINED_SOURCE_AUTHORITY_REQUIRED';
    throw e;
  }
  if (typeof authority.sourceLabel !== 'string' || !Buffer.isBuffer(authority.sourceBytes)
    || typeof authority.sourceBytesSha256 !== 'string' || authority.contract === undefined
    || typeof authority.now !== 'string' || typeof authority.enabled !== 'boolean') {
    const e = new Error('RETAINED_SOURCE_AUTHORITY_MALFORMED');
    e.code = 'RETAINED_SOURCE_AUTHORITY_MALFORMED';
    throw e;
  }
  return authority;
}

// ------------------------------------------------------- receiving-side consumption

function normalizeUnsupportedFacts(unsupportedFacts) {
  // The producer's closed list is carried through VERBATIM: the receiver never narrows,
  // expands or renames it, and never turns an unavailable fact into a fact.
  if (Array.isArray(unsupportedFacts)) return Object.freeze([...unsupportedFacts]);
  if (unsupportedFacts && typeof unsupportedFacts === 'object') {
    return Object.freeze({ ...unsupportedFacts });
  }
  return Object.freeze([]);
}

function normalizeSupportedFacts(supported) {
  if (supported && typeof supported === 'object' && !Array.isArray(supported)) {
    return Object.freeze({ ...supported });
  }
  if (Array.isArray(supported)) return Object.freeze([...supported]);
  return Object.freeze({});
}

/**
 * CONSUME the handoff PAN created — receiving side, real reader re-execution.
 *
 * PAN's `createKs238OrderSourceHandoff` owns the source: this receiver obtains the
 * producer module from the ACTUAL dependency, then re-does the producer's own real work
 * against the RETAINED source authority:
 *
 *   1. create   — ask the producer to build the handoff from the retained source bytes.
 *                 The receiver does not pre-compute, pre-decode or pre-bind anything.
 *   2. payload  — if the caller carried a handoff payload, rebind it with the producer's
 *                 `rebindSerializedOrderSource`, passing the retained authority fields
 *                 from OUTSIDE the payload.  A payload that no longer matches the source
 *                 is DENIED by the producer, not by us.
 *   3. readers  — ask the producer to RE-EXECUTE the released readers over the labelled
 *                 synthetic export and report the current-order facts.  The receiver
 *                 never fabricates a reader result and never reads the source directly.
 *
 * Returns an explicit status. A DENIED or UNAVAILABLE result is returned, never thrown
 * past the caller, so a receiving run can report honestly instead of crashing.
 */
export async function consumeOrderSourceHandoff({
  retainedAuthority,
  handoffPayload = null,
  repoRoot,
  explicitModulePath = null,
  producerRepoRoot = null,
} = {}) {
  const authority = assertRetainedAuthority(retainedAuthority);
  // FINDING 2 (consume-time half): re-derive the digest from the bytes we are ABOUT to
  // hand the producer and compare it to the identity the authority declares. This closes
  // the gap between "the retained identity" and "the bytes actually consumed" for ANY
  // route that could still reach the bytes -- a subclassed/aliased buffer, a caller that
  // reached the copy through another reference, or a future authority shape. A mismatch is
  // a hard DENIAL naming both digests, never a silent consume.
  const consumedBytesSha256 = sha256Hex(authority.sourceBytes);
  if (consumedBytesSha256 !== authority.sourceBytesSha256) {
    return {
      outcome: 'DENIED',
      code: 'RETAINED_SOURCE_BYTES_MUTATED',
      state: 'DENIED',
      reason: 'The retained source bytes no longer match the retained byte identity.',
      declaredSourceBytesSha256: authority.sourceBytesSha256,
      consumedSourceBytesSha256: consumedBytesSha256,
      retainedSourceLabel: authority.sourceLabel,
    };
  }
  const resolved = await resolveOrderSourceHandoffModule({
    repoRoot,
    explicitPath: explicitModulePath,
    producerRepoRoot,
  });
  if (!resolved.ok) {
    // A DENIED dependency resolution (substituted bytes, drifted commit, missing entry
    // point) is a HARD refusal. UNAVAILABLE is reserved for "not found / not pinned",
    // which is an honest absence rather than a rejection.
    return {
      outcome: resolved.state === 'DENIED' ? 'DENIED' : 'UNAVAILABLE',
      code: resolved.code,
      state: resolved.state,
      reason: resolved.reason ?? null,
      dependency: resolved.dependency,
      retainedSourceLabel: authority.sourceLabel,
      retainedSourceBytesSha256: authority.sourceBytesSha256,
    };
  }
  const { producer } = resolved;
  const createArgs = {
    contract: authority.contract,
    sourceBytes: authority.sourceBytes,
    sourceLabel: authority.sourceLabel,
    // The released reader takes `enabled` explicitly; the receiver must not rely on a
    // default that a future producer could flip.
    enabled: authority.enabled,
    now: authority.now,
  };
  let created;
  try {
    created = producer.createKs238OrderSourceHandoff(createArgs);
  } catch (error) {
    return {
      outcome: 'DENIED',
      code: 'PAN_ORDER_SOURCE_CREATE_THREW',
      message: String(error?.message ?? error),
      retainedSourceLabel: authority.sourceLabel,
    };
  }
  if (!created || created.outcome === 'DENIED' || created.outcome === undefined) {
    return {
      outcome: created?.outcome === 'DENIED' ? 'DENIED' : 'UNAVAILABLE',
      code: created?.code ?? 'PAN_ORDER_SOURCE_CREATE_REFUSED',
      created,
      retainedSourceLabel: authority.sourceLabel,
    };
  }
  if (created.outcome !== 'ADAPTED') {
    return {
      outcome: 'UNAVAILABLE',
      code: created.code ?? 'PAN_ORDER_SOURCE_CREATE_UNSUPPORTED_OUTCOME',
      createdOutcome: created.outcome,
      retainedSourceLabel: authority.sourceLabel,
    };
  }

  // 2. carried payload, if any, must REBIND against the retained authority.
  let rebind = null;
  if (handoffPayload !== null && handoffPayload !== undefined) {
    let rebound;
    try {
      rebound = producer.rebindSerializedOrderSource({
        sourceLabel: authority.sourceLabel,
        sourceBytes: authority.sourceBytes,
        sourceBytesSha256: authority.sourceBytesSha256,
        contract: authority.contract,
        now: authority.now,
        enabled: authority.enabled,
        binding: handoffPayload.binding,
        bindingDigest: handoffPayload.bindingDigest,
      });
    } catch (error) {
      return {
        outcome: 'DENIED',
        code: 'PAN_ORDER_SOURCE_REBIND_THREW',
        message: String(error?.message ?? error),
        retainedSourceLabel: authority.sourceLabel,
      };
    }
    if (rebound?.outcome !== 'REBOUND') {
      return {
        outcome: 'DENIED',
        code: rebound?.code ?? 'PAN_ORDER_SOURCE_REBIND_REFUSED',
        rebindOutcome: rebound?.outcome ?? null,
        retainedSourceLabel: authority.sourceLabel,
        retainedSourceBytesSha256: authority.sourceBytesSha256,
      };
    }
    rebind = rebound;
  }

  return {
    outcome: 'CONSUMED',
    code: 'OK',
    module: {
      file: resolved.file,
      moduleSha256: resolved.moduleSha256,
      commitBinding: resolved.commitBinding,
      parentCandidateCommit: PAN_ORDER_SOURCE_DEPENDENCY.parentCandidateCommit,
      // The narrow executable binding: public released source vs retained compiled artifact
      // vs historical candidate vs optional Git evidence. Never a published compiled bundle.
      release: resolved.release ?? null,
    },
    retainedSourceAuthority: {
      sourceLabel: authority.sourceLabel,
      sourceBytesSha256: authority.sourceBytesSha256,
      sourceBytesFile: authority.sourceBytesFile,
      contractFile: authority.contractFile,
      contractSha256: authority.contractSha256,
      now: authority.now,
      enabled: authority.enabled,
      retainedOutsidePayload: true,
    },
    handoff: {
      source: 'PAN createKs238OrderSourceHandoff',
      bindingDigest: created.bindingDigest,
      binding: created.binding,
      contentBinding: created.contentBinding ?? null,
      supportedFacts: normalizeSupportedFacts(created.supported),
      unsupportedFacts: normalizeUnsupportedFacts(created.unsupportedFacts),
    },
    rebind: rebind === null ? null : {
      source: 'PAN rebindSerializedOrderSource',
      outcome: rebind.outcome,
      bindingDigest: rebind.bindingDigest,
      payloadReboundAgainstRetainedAuthority: true,
    },
  };
}

// -------------------------------------------------------------- fact extraction

function statusCountsOf(consumption) {
  const raw = consumption?.handoff?.supportedFacts?.statusCounts;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return Object.freeze({});
  // Keys are sorted so the published census is stable and digest-comparable.
  const sorted = {};
  for (const key of Object.keys(raw).sort()) sorted[key] = raw[key];
  return Object.freeze(sorted);
}

function orderFactsOf(consumption) {
  const raw = consumption?.handoff?.supportedFacts?.orderFacts;
  if (!Array.isArray(raw)) return Object.freeze([]);
  return Object.freeze([...raw]);
}

const MISSING = Object.freeze({ state: 'UNAVAILABLE', reason: null, value: null });

// The PRODUCER's frozen per-order quantity/unit record (KS238_QUANTITY_UNAVAILABLE_V1).
// This is evidence carried from the reader, not a receiver-side missing record.
const PRODUCER_UNAVAILABLE_QUANTITY_UNIT = Object.freeze({
  quantity: 'UNAVAILABLE',
  unit: 'UNAVAILABLE',
});

const missing = (reason) => Object.freeze({ state: 'UNAVAILABLE', reason, value: null });
const present = (value) => Object.freeze({ state: 'AVAILABLE', reason: null, value });

/**
 * The EXPLICIT missing-semantics record for this handoff. Every entry is either
 * AVAILABLE with the evidenced value, or UNAVAILABLE with the reason it is unavailable.
 * Nothing here is inferred, defaulted, zero-filled or carried over from the revenue side.
 *
 * This is the shape the issue asks for: missing HISTORY, missing UNIT and missing REVENUE
 * are stated as first-class facts about the handoff, not as absences a reader has to
 * notice for itself.
 */
export function buildOrderSourceMissingSemantics(consumption) {
  const unsupported = consumption?.handoff?.unsupportedFacts ?? {};
  const facts = orderFactsOf(consumption);
  const quantities = facts.map((entry) => ({
    orderId: entry?.order?.orderId ?? null,
    quantityUnit: entry?.order?.quantityUnit ?? null,
  }));
  const unitsDistinct = [...new Set(quantities.map((q) => JSON.stringify(q.quantityUnit)))];
  // Evidence, not assertion: the unit is only "uniformly unavailable" when every order
  // slot is exactly the PRODUCER's frozen UNAVAILABLE shape. That shape is the producer's
  // per-order record, which is deliberately NOT this module's `{state, reason, value}`
  // record -- comparing against the latter would make this test unsatisfiable.
  const producerUnavailableUnits = quantities.length > 0
    && unitsDistinct.length === 1
    && unitsDistinct[0] === JSON.stringify(PRODUCER_UNAVAILABLE_QUANTITY_UNIT);
  const quantityEvidence = Object.freeze({
    orderCount: quantities.length,
    distinctUnitSlots: unitsDistinct.length,
    quantities: Object.freeze(quantities),
  });

  const periods = Object.freeze([...new Set(
    facts.map((entry) => entry?.order?.period?.month).filter((p) => typeof p === 'string'),
  )].sort());

  // The producer's closed fact vocabulary is carried through as a SET rather than
  // re-listed, so a fact the producer later withdraws cannot linger here as available.
  const unsupportedSet = new Set(Array.isArray(unsupported?.facts) ? unsupported.facts : []);
  const producerMissingFields = Object.freeze(
    Array.isArray(unsupported?.missingFields) ? [...unsupported.missingFields] : [],
  );
  const unavailableBecause = (fact, fallback) => (unsupportedSet.has(fact)
    ? `${unsupported?.code ?? 'PRODUCER_DECLARED_UNAVAILABLE'}:${fact}`
    : fallback);

  return Object.freeze({
    producerContract: Object.freeze({
      code: unsupported?.code ?? null,
      facts: Object.freeze([...(unsupported?.facts ?? [])]),
      missingFields: producerMissingFields,
      nonClaims: Object.freeze([...(unsupported?.nonClaims ?? [])]),
    }),

    // --- HISTORY: the handoff carries the CURRENT order state only. There is no prior
    // order book, so there is no previous-state comparison and no order-history
    // baseline. This is the producer's declared `historicalOrderBook` /
    // `history.previousStates` unavailability, restated as a first-class receiver fact.
    history: missing(unavailableBecause('historicalOrderBook',
      'NO_HISTORICAL_ORDER_BOOK_RETAINED_BY_THIS_HANDOFF')),
    previousStates: missing(unavailableBecause('historicalOrderBook',
      'NO_PREVIOUS_STATES_IN_ORDER_SOURCE_BINDING')),
    historicalOrderBook: missing(unavailableBecause('historicalOrderBook',
      'NO_HISTORICAL_ORDER_BOOK_RETAINED_BY_THIS_HANDOFF')),

    // --- UNIT + QUANTITY: the reader proves status, never quantity and never unit.
    orderedQuantity: missing(unavailableBecause('orderedQuantity',
      'NO_PER_ORDER_QUANTITY_IN_READER')),
    quantityUnit: producerUnavailableUnits
      ? missing(unavailableBecause('quantityUnit', 'NO_PER_ORDER_UNIT_IN_READER'))
      : missing('PER_ORDER_UNIT_NOT_UNIFORMLY_UNAVAILABLE_WITHOUT_READER_PROOF'),

    // --- REVENUE: never inferred from order status, quantity, or the reader's totalMinor.
    netRevenue: missing(unavailableBecause('netRevenue',
      'NET_REVENUE_IS_NOT_INFERRED_FROM_ORDER_STATUS_OR_QUANTITY')),
    amount: missing(unavailableBecause('amount', 'NO_AMOUNT_VALUE_IN_ORDER_SOURCE_READER')),
    currencyValue: missing(unavailableBecause('currencyValue', 'NO_CURRENCY_IN_ORDER_SOURCE_READER')),
    deliveryFacts: missing(unavailableBecause('deliveryFacts', 'NO_DELIVERY_FACTS_IN_ORDER_SOURCE_READER')),
    orderIntake: missing(unavailableBecause('orderIntake', 'ORDER_INTAKE_MONETARY_AGGREGATES_UNAVAILABLE')),
    creditsCancellationsNetting: missing(unavailableBecause('creditsCancellationsNetting',
      'NO_CREDIT_OR_CANCELLATION_NETTING')),

    // --- what IS available, stated explicitly rather than left implicit.
    orderStatusCensus: present(statusCountsOf(consumption)),
    orderCount: present(facts.length),
    periodsObserved: present(periods),
    supportedFacts: present(Object.freeze([...(consumption?.handoff?.binding?.supportedFacts ?? [])])),
    quantityEvidence,
  });
}

// ---------------------------------------------- supported CURRENT-ORDER comparison

/**
 * FINDING 1: the default supported-order vocabulary must be the READER'S OWN vocabulary.
 *
 * The released ERP reader validates orderStatus against exactly ['OPEN', 'FULFILLED',
 * 'CANCELLED'] (see the producer's erp-read-connector contract) and customerStatus against
 * exactly ['ACTIVE', 'ON_HOLD']. The previous default -- ['CONFIRMED', 'PENDING'] -- was a
 * vocabulary this reader can NEVER emit, so the shipped positive journey "compared" three
 * orders against a bill that could only ever be empty: supportedOrderCount 0, byPeriod {},
 * and every real order EXCLUDED as unsupported. That is a fail-closed claim, not a user
 * journey, and it reported the reader's actual facts as unusable.
 *
 * The default is therefore derived from what the reader DECLARES, and the receiver keeps
 * `supportedStatuses` overridable so a caller can still narrow it deliberately.
 */
const READER_ORDER_STATUS_VOCABULARY = Object.freeze(['OPEN', 'FULFILLED', 'CANCELLED']);
const READER_CUSTOMER_STATUS_VOCABULARY = Object.freeze(['ACTIVE', 'ON_HOLD']);
const DEFAULT_SUPPORTED_ORDER_STATUSES = READER_ORDER_STATUS_VOCABULARY;
const DEFAULT_SUPPORTED_CUSTOMER_STATUSES = READER_CUSTOMER_STATUS_VOCABULARY;

/**
 * The SUPPORTED CURRENT-ORDER comparison.
 *
 * Supports exactly one decidable question, over the retained labelled synthetic export:
 *
 *   "For the supported statuses, how many current orders does the released reader
 *    evidence, and how does that census distribute across the periods the reader
 *    itself reported?"
 *
 * Deliberately bounded:
 *   - the comparable status set is explicit and FROZEN; an unsupported status is
 *     reported as UNSUPPORTED and is never silently folded into a supported bucket;
 *   - the reopened status (REOPENED) is excluded from the supported set and is
 *     surfaced as EXCLUDED_UNSUPPORTED, because a reopened order is a history-dependent
 *     state this handoff retains no history for;
 *   - no revenue, no amount, no currency, no quantity, no unit and no delta-versus-
 *     prior-period is computed. The comparison is a CURRENT-order census, nothing else.
 *
 * Returns an explicit status object; it never throws for a malformed or empty census,
 * and never invents orders to make a comparison possible.
 */
export function compareSupportedCurrentOrders({
  consumption,
  supportedStatuses = DEFAULT_SUPPORTED_ORDER_STATUSES,
  supportedCustomerStatuses = DEFAULT_SUPPORTED_CUSTOMER_STATUSES,
} = {}) {
  if (!consumption || consumption.outcome !== 'CONSUMED') {
    return {
      outcome: 'UNAVAILABLE',
      code: 'CURRENT_ORDER_COMPARISON_REQUIRES_CONSUMED_HANDOFF',
      handoffOutcome: consumption?.outcome ?? null,
      handoffCode: consumption?.code ?? null,
      comparable: false,
    };
  }
  if (!Array.isArray(supportedStatuses) || supportedStatuses.length === 0) {
    return {
      outcome: 'DENIED',
      code: 'CURRENT_ORDER_COMPARISON_SUPPORTED_STATUSES_REQUIRED',
      comparable: false,
    };
  }
  const supported = Object.freeze([...new Set(supportedStatuses.map((s) => String(s)))].sort());
  const supportedSet = new Set(supported);
  const census = statusCountsOf(consumption);
  const facts = orderFactsOf(consumption);

  const observedStatuses = Object.freeze(Object.keys(census).sort());
  const unsupportedObserved = Object.freeze(observedStatuses.filter((s) => !supportedSet.has(s)));
  const supportedObserved = Object.freeze(observedStatuses.filter((s) => supportedSet.has(s)));

  // Counts come from the reader's own evidenced census. A supported status with no
  // reader evidence is reported as 0 WITH its evidence state, never as an inferred order.
  const byStatus = {};
  for (const status of supported) {
    byStatus[status] = Object.prototype.hasOwnProperty.call(census, status)
      ? { status, count: census[status], evidence: 'READER_CENSUS' }
      : { status, count: 0, evidence: 'NO_READER_EVIDENCE' };
  }

  // Period distribution, restricted to supported statuses and to the periods the reader
  // itself reported. A fact with no period is counted under an explicit UNKNOWN bucket
  // rather than being dropped or guessed into a period.
  const supportedCustomerSet = new Set(
    (Array.isArray(supportedCustomerStatuses) ? supportedCustomerStatuses : [])
      .map((s) => String(s)),
  );

  // FINDING 1 (composition half): the period distribution and the customer-segment
  // distribution are computed over the reader's REAL orders -- the same orders the census
  // above is derived from -- keyed by the reader's own EVALUATED period fact, not by a
  // second, narrower status filter that could silently empty them. The census, the period
  // spread and the segment spread are therefore three views of ONE evidenced fact set.
  const byPeriod = {};
  const byCustomerSegment = {};
  let supportedOrderCount = 0;
  let unsupportedOrderCount = 0;
  let unknownPeriodCount = 0;
  let unknownCustomerStatusCount = 0;
  const countedOrderIds = [];
  for (const fact of facts) {
    const status = fact?.order?.orderStatus;
    // The producer's period fact is a structured object ({granularity, month, orderDate}),
    // not a bare string. The bucket key is its calendar month; a period fact that does not
    // carry a month is routed to an explicit UNKNOWN bucket rather than being dropped or
    // guessed into a month from its date.
    const period = fact?.order?.period !== null && typeof fact?.order?.period === 'object'
      && typeof fact.order.period.month === 'string' && fact.order.period.month.length > 0
      ? fact.order.period.month
      : null;
    // The reader's own customer fact. `UNAVAILABLE` is the producer's explicit
    // missing-customer evidence and stays explicit here -- it is never folded into a
    // segment, and never dropped.
    const rawCustomerStatus = fact?.customerStatus;
    const customerStatus = typeof rawCustomerStatus === 'string' && rawCustomerStatus.length > 0
      ? rawCustomerStatus
      : null;
    const isSupportedStatus = supportedSet.has(status);
    if (isSupportedStatus) supportedOrderCount += 1;
    else unsupportedOrderCount += 1;
    // Period and segment are reported for EVERY observed order, including orders in a
    // status outside the supported set: the reader evidenced their period and their
    // customer, and suppressing that because of a status choice would be the same
    // empty-the-evidence defect in a different place. `totals.supportedOrderCount` and
    // `.unsupportedOrderCount` still state the supported/unsupported split explicitly.
    const bucket = period ?? 'UNKNOWN_PERIOD';
    if (period === null) unknownPeriodCount += 1;
    byPeriod[bucket] = byPeriod[bucket] ?? { period: bucket, count: 0, orderIds: [] };
    byPeriod[bucket].count += 1;
    byPeriod[bucket].orderIds.push(fact?.order?.orderId ?? null);

    const segment = customerStatus ?? 'UNKNOWN_CUSTOMER_STATUS';
    if (customerStatus === null) unknownCustomerStatusCount += 1;
    const segmentSupported = supportedCustomerSet.size === 0
      ? customerStatus !== null
      : supportedCustomerSet.has(customerStatus);
    byCustomerSegment[segment] = byCustomerSegment[segment] ?? {
      customerStatus: segment,
      count: 0,
      supported: segmentSupported,
      orderIds: [],
    };
    byCustomerSegment[segment].count += 1;
    byCustomerSegment[segment].orderIds.push(fact?.order?.orderId ?? null);

    if (isSupportedStatus) countedOrderIds.push(fact?.order?.orderId ?? null);
  }
  const byPeriodSorted = Object.freeze(Object.fromEntries(
    Object.keys(byPeriod).sort().map((k) => [k, Object.freeze({
      ...byPeriod[k], orderIds: Object.freeze(byPeriod[k].orderIds),
    })]),
  ));
  const byCustomerSegmentSorted = Object.freeze(Object.fromEntries(
    Object.keys(byCustomerSegment).sort().map((k) => [k, Object.freeze({
      ...byCustomerSegment[k], orderIds: Object.freeze(byCustomerSegment[k].orderIds),
    })]),
  ));

  const totalObserved = observedStatuses.reduce((sum, s) => sum + census[s], 0);
  const supportedCensusTotal = supportedObserved.reduce((sum, s) => sum + census[s], 0);

  return Object.freeze({
    outcome: 'COMPARED',
    code: 'OK',
    comparison: 'SUPPORTED_CURRENT_ORDER_CENSUS',
    basis: 'PAN released order reader over the retained labelled LOCAL_SYNTHETIC export',
    // Boundedness, stated as data rather than as prose.
    supportedStatuses: supported,
    unsupportedStatusesObserved: unsupportedObserved,
    excludedUnsupported: Object.freeze(unsupportedObserved.map((status) => ({
      status,
      count: census[status],
      disposition: 'EXCLUDED_UNSUPPORTED',
    }))),
    byStatus: Object.freeze(Object.fromEntries(
      Object.keys(byStatus).sort().map((k) => [k, Object.freeze(byStatus[k])]),
    )),
    byPeriod: byPeriodSorted,
    knownPeriods: Object.freeze(Object.keys(byPeriodSorted).filter((k) => k !== 'UNKNOWN_PERIOD')),
    // The customer-segment composition, from the reader's own customer fact. This is the
    // "customer segment" half of the composition: the same evidenced orders as the census,
    // grouped by the status the customer reader actually reported.
    byCustomerSegment: byCustomerSegmentSorted,
    knownCustomerStatuses: Object.freeze(Object.keys(byCustomerSegmentSorted)
      .filter((k) => k !== 'UNKNOWN_CUSTOMER_STATUS')),
    supportedCustomerStatuses: Object.freeze([...supportedCustomerSet].sort()),
    totals: Object.freeze({
      supportedOrderCount,
      unsupportedOrderCount,
      totalObserved,
      supportedCensusTotal,
      unknownPeriodCount,
      unknownCustomerStatusCount,
    }),
    countedOrderIds: Object.freeze(countedOrderIds),
    // Explicit separation from revenue: no monetary or quantity value exists here at all.
    revenueFields: missing('NET_REVENUE_REPORTED_SEPARATELY_AND_NEVER_NETTED_HERE'),
    quantityFields: missing('QUANTITY_AND_UNIT_UNAVAILABLE_FOR_THIS_READER'),
    historyFields: missing('NO_HISTORICAL_ORDER_BOOK_RETAINED'),
    comparable: true,
  });
}

// ------------------------------------------------------------ separation + report

/**
 * The explicit boundary between the two sides. This is the machine-checkable statement of
 * "separately from net revenue": the order census and the net-revenue comparison are
 * produced from different datasets by different released code, and this record proves the
 * receiver did not merge them.
 *
 * `netRevenue` is read from the RELEASED segment-comparison output, carried through
 * verbatim, and is clearly marked as a value this handoff does not own.
 */
// ------------------------------------------- released net-revenue execution binding

// FINDING 1 (revenue half, hard part). A released-LOOKING object with a self-consistent
// digest is NOT evidence that the released module executed. The parent's exact reproducer
// is `{schemaVersion, current:{netRevenue:12345}, comparison:{netRevenue:11000},
// source:{sourceRelation}, nonclaims:['not real']}`: every "public label" the previous
// revision demanded, plus a digest `comparisonDigest` recomputes -- and it was published
// as AVAILABLE. Public labels plus self-consistent hashes are not execution evidence.
//
// The published comparison is therefore bound to ACTUAL EXECUTION in exactly one of two
// ways, and neither is a caller-settable field:
//
//   1. the candidate object is the one `composeReleasedNetRevenueComparison` returned in
//      this process (recorded below in a private WeakMap), or
//   2. the caller supplies the SEPARATELY RETAINED source rows, and re-executing the
//      released module over those rows reproduces the candidate digest exactly.
const RELEASED_COMPARISON_EXECUTIONS = new WeakMap();

const releasedComparisonModule = (released) => ({
  comparisonDigest,
  compareSegmentsAcrossPeriods,
  buildSegmentComparisonReport,
  ...(released ?? {}),
});

/**
 * The SHAPE + DIGEST half of attestation: the released schema tag, the released provenance
 * declaration and non-claims attached by `buildSegmentComparisonReport`, safe-integer
 * period nets, and a digest the released module's own `comparisonDigest` reproduces.
 *
 * This is necessary but NOT sufficient: it says the object is well-formed and
 * self-consistent, never that the released module produced it. Execution binding is a
 * separate step (see `attestReleasedNetRevenueComparison`).
 */
function inspectReleasedComparisonShape(report, mod) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { ok: false, state: 'DENIED', code: 'NET_REVENUE_RELEASED_COMPARISON_REQUIRED' };
  }
  if (report.schemaVersion !== NET_REVENUE_SEGMENT_COMPARISON_SCHEMA
    && report.schema !== NET_REVENUE_SEGMENT_COMPARISON_SCHEMA) {
    return {
      ok: false,
      state: 'DENIED',
      code: 'NET_REVENUE_RELEASED_SCHEMA_DENIED',
      observed: report.schemaVersion ?? report.schema ?? null,
      expected: NET_REVENUE_SEGMENT_COMPARISON_SCHEMA,
    };
  }
  if (!Number.isSafeInteger(report.current?.netRevenue)
    || !Number.isSafeInteger(report.comparison?.netRevenue)) {
    return { ok: false, state: 'DENIED', code: 'NET_REVENUE_RELEASED_PERIODS_DENIED' };
  }
  let digest;
  try {
    digest = mod.comparisonDigest(report);
  } catch (error) {
    return {
      ok: false,
      state: 'DENIED',
      code: 'NET_REVENUE_RELEASED_DIGEST_REFUSED',
      message: String(error?.message ?? error),
    };
  }
  // `comparisonDigest` is the released module's own digest of ANY object, so a bare
  // `{current, comparison}` stub recomputes to a matching digest. What a genuine released
  // report carries because `buildSegmentComparisonReport` attached it: the released
  // `source` declaration and the released non-claims. Require them so an ad-hoc object
  // cannot even reach the execution-binding step.
  if (report.source?.sourceRelation !== SYNTHETIC_SEGMENT_SOURCE.sourceRelation
    || !Array.isArray(report.nonclaims) || report.nonclaims.length === 0) {
    return {
      ok: false,
      state: 'DENIED',
      code: 'NET_REVENUE_RELEASED_PROVENANCE_DENIED',
      reason: 'A released comparison carries the released source declaration and non-claims.',
      observed: {
        sourceRelation: report.source?.sourceRelation ?? null,
        nonclaims: Array.isArray(report.nonclaims) ? report.nonclaims.length : null,
      },
    };
  }
  const declared = typeof report.digest === 'string' ? report.digest : null;
  if (declared !== null && declared !== digest) {
    return {
      ok: false,
      state: 'DENIED',
      code: 'NET_REVENUE_RELEASED_DIGEST_MISMATCH',
      declaredDigest: declared,
      recomputedDigest: digest,
    };
  }
  return {
    ok: true,
    state: 'AVAILABLE',
    code: 'OK',
    digest,
    schema: NET_REVENUE_SEGMENT_COMPARISON_SCHEMA,
    periodWindows: {
      comparison: { ...NET_REVENUE_COMPARISON_PERIODS.comparison },
      current: { ...NET_REVENUE_COMPARISON_PERIODS.current },
    },
  };
}

/**
 * FINDING 1 (revenue half): COMPOSE the revenue side from the RELEASED module over REAL
 * source rows, instead of accepting an opaque object.
 *
 * The released module's own default periods are REUSED (2026-06 comparison, 2026-07
 * current) rather than invented here. The exact returned report object is recorded in this
 * module's private execution registry together with the digest of the rows it was composed
 * from, which is what makes it attestable later without any caller-minted certification.
 */
export function composeReleasedNetRevenueComparison({
  sourceRows,
  released = null,
} = {}) {
  const mod = releasedComparisonModule(released);
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
    return {
      ok: false,
      outcome: 'UNAVAILABLE',
      code: 'NET_REVENUE_SOURCE_ROWS_REQUIRED',
    };
  }
  let report;
  try {
    report = mod.buildSegmentComparisonReport(mod.compareSegmentsAcrossPeriods(sourceRows));
  } catch (error) {
    return {
      ok: false,
      outcome: 'DENIED',
      code: 'NET_REVENUE_COMPOSITION_REFUSED',
      message: String(error?.message ?? error),
    };
  }
  const shape = inspectReleasedComparisonShape(report, mod);
  if (!shape.ok) return { ...shape, report };
  const sourceRowsSha256 = sha256Hex(JSON.stringify(sourceRows));
  // Bind THIS object to the execution that produced it, and to the rows it came from. The
  // registry is a private WeakMap: there is no public field, token or digest a caller can
  // mint to qualify a report, and a JSON round-trip of a genuine report is a DIFFERENT
  // object that must be re-qualified through separately retained rows.
  RELEASED_COMPARISON_EXECUTIONS.set(report, Object.freeze({
    sourceRowsSha256,
    digest: shape.digest,
  }));
  return {
    ok: true,
    outcome: 'COMPOSED',
    code: 'OK',
    report,
    schema: report.schemaVersion,
    digest: shape.digest,
    sourceRowsSha256,
    periods: {
      comparison: { ...NET_REVENUE_COMPARISON_PERIODS.comparison },
      current: { ...NET_REVENUE_COMPARISON_PERIODS.current },
    },
  };
}

/**
 * Attest that a candidate is genuinely the RELEASED comparison.
 *
 * Two INDEPENDENT facts are required, and neither is a caller-settable field:
 *
 *  1. SHAPE + DIGEST (see `inspectReleasedComparisonShape`) -- necessary, not sufficient.
 *  2. ACTUAL EXECUTION BINDING, established in exactly one of two ways:
 *       a. the candidate object is the object that `composeReleasedNetRevenueComparison`
 *          returned in this process (private WeakMap provenance), or
 *       b. the caller supplies the SEPARATELY RETAINED source rows the comparison is about,
 *          and re-executing the released module over those rows reproduces the candidate
 *          digest exactly.
 *
 * Anything else -- however many released labels it wears, and however self-consistent its
 * digest is -- is DENIED as unverified execution evidence. No certification field is added
 * and no validation path is bypassed.
 */
export function attestReleasedNetRevenueComparison(report, {
  released = null,
  retainedSourceRows = null,
} = {}) {
  const mod = releasedComparisonModule(released);
  const shape = inspectReleasedComparisonShape(report, mod);
  if (!shape.ok) return shape;
  const recorded = RELEASED_COMPARISON_EXECUTIONS.get(report);
  if (recorded !== undefined && recorded.digest === shape.digest) {
    return {
      ok: true,
      state: 'AVAILABLE',
      code: 'OK',
      digest: shape.digest,
      schema: NET_REVENUE_SEGMENT_COMPARISON_SCHEMA,
      basis: 'IN_PROCESS_RELEASED_COMPOSITION',
      sourceRowsSha256: recorded.sourceRowsSha256,
      periodWindows: shape.periodWindows,
    };
  }
  if (Array.isArray(retainedSourceRows) && retainedSourceRows.length > 0) {
    let recomposed;
    try {
      recomposed = mod.buildSegmentComparisonReport(mod.compareSegmentsAcrossPeriods(retainedSourceRows));
    } catch (error) {
      return {
        ok: false,
        state: 'DENIED',
        code: 'NET_REVENUE_RETAINED_ROWS_RECOMPOSITION_REFUSED',
        message: String(error?.message ?? error),
      };
    }
    const recomposedDigest = mod.comparisonDigest(recomposed);
    if (recomposedDigest !== shape.digest) {
      return {
        ok: false,
        state: 'DENIED',
        code: 'NET_REVENUE_RETAINED_ROWS_DIGEST_MISMATCH',
        declaredDigest: shape.digest,
        recomposedDigest,
      };
    }
    return {
      ok: true,
      state: 'AVAILABLE',
      code: 'OK',
      digest: shape.digest,
      schema: NET_REVENUE_SEGMENT_COMPARISON_SCHEMA,
      basis: 'RECOMPOSED_FROM_SEPARATELY_RETAINED_SOURCE_ROWS',
      sourceRowsSha256: sha256Hex(JSON.stringify(retainedSourceRows)),
      periodWindows: shape.periodWindows,
    };
  }
  return {
    ok: false,
    state: 'DENIED',
    code: 'NET_REVENUE_RELEASED_EXECUTION_UNVERIFIED',
    reason: 'Released labels and a self-consistent digest are not execution evidence. Attest an output of composeReleasedNetRevenueComparison, or supply the separately retained source rows for recomputation.',
    observed: {
      sourceRelation: report.source?.sourceRelation ?? null,
      nonclaims: Array.isArray(report.nonclaims) ? report.nonclaims.length : null,
      selfConsistentDigest: shape.digest,
    },
  };
}

export function buildOrderVsRevenueSeparation({
  currentOrderComparison,
  netRevenueReport,
  netRevenueSourceRows = null,
  requireReleasedAttestation = true,
}) {
  const orderSide = currentOrderComparison?.outcome === 'COMPARED'
    ? present(Object.freeze({
      census: currentOrderComparison.byStatus,
      totals: currentOrderComparison.totals,
      basis: currentOrderComparison.basis,
      // The period and customer-segment composition travel with the order side, so a
      // consumer does not have to re-derive them from the raw facts.
      byPeriod: currentOrderComparison.byPeriod ?? null,
      byCustomerSegment: currentOrderComparison.byCustomerSegment ?? null,
    }))
    : missing(currentOrderComparison?.code ?? 'CURRENT_ORDER_COMPARISON_UNAVAILABLE');

  // FINDING 1 (revenue half): an object is NOT sufficient evidence that a comparison was
  // released. Unless the caller explicitly opts out, the revenue side is published only
  // when the RELEASED module attests it -- its schema tag, its recomputed digest, its
  // period shape. A stub is DENIED instead of being carried as a released number.
  const attestation = (netRevenueReport && typeof netRevenueReport === 'object')
    ? attestReleasedNetRevenueComparison(netRevenueReport, { retainedSourceRows: netRevenueSourceRows })
    : null;
  if (requireReleasedAttestation && netRevenueReport && typeof netRevenueReport === 'object'
    && attestation !== null && !attestation.ok) {
    return Object.freeze({
      separation: 'ORDER_CENSUS_AND_NET_REVENUE_ARE_SEPARATE_FACTS',
      combinedTotal: missing('NET_REVENUE_RELEASED_COMPARISON_NOT_ATTESTED'),
      reconciliation: missing('NET_REVENUE_RELEASED_COMPARISON_NOT_ATTESTED'),
      attribution: missing('NET_REVENUE_RELEASED_COMPARISON_NOT_ATTESTED'),
      arithmeticPerformedAcrossSides: false,
      datasetsAreDistinct: true,
      orderSide,
      revenueSide: Object.freeze({
        state: 'DENIED',
        reason: 'NET_REVENUE_RELEASED_ATTESTATION_FAILED',
        value: null,
        attestation: Object.freeze({ ...attestation }),
      }),
    });
  }

  let revenueSide;
  if (netRevenueReport && typeof netRevenueReport === 'object') {
    revenueSide = present(Object.freeze({
      // `releasedComparison` is the released comparison object ITSELF -- carried through
      // verbatim, not summarised, not re-derived, not reinterpreted. The released
      // module's own schema tag and digest are surfaced alongside it for reconciliation.
      // The key is named `releasedComparison` rather than `report` so that a reader
      // cannot confuse it with a receiver-produced report.
      releasedComparison: netRevenueReport,
      schema: netRevenueReport.schema ?? netRevenueReport.schemaVersion
        ?? NET_REVENUE_SEGMENT_COMPARISON_SCHEMA,
      releasedDigest: typeof netRevenueReport.digest === 'string' ? netRevenueReport.digest : null,
      // HOW the released comparison was bound to actual execution (in-process composition,
      // or recomputation from separately retained rows). Not a caller claim: it is the
      // verdict of attestReleasedNetRevenueComparison, which this branch only reaches when
      // `attestation.ok` is true.
      attestation: Object.freeze({ ...attestation }),
      ownedByThisHandoff: false,
    }));
  } else {
    revenueSide = missing('NET_REVENUE_COMPARISON_NOT_SUPPLIED');
  }

  return Object.freeze({
    separation: 'ORDER_CENSUS_AND_NET_REVENUE_ARE_SEPARATE_FACTS',
    orderSide,
    revenueSide,
    // The three things a merger would have to do. All are refused, explicitly.
    combinedTotal: missing('NO_COMBINED_ORDER_AND_REVENUE_TOTAL_EXISTS'),
    reconciliation: missing('NO_ORDER_TO_REVENUE_RECONCILIATION_PERFORMED'),
    attribution: missing('NO_ORDER_STATUS_EXPLAINS_NET_REVENUE_CHANGE'),
    datasetsAreDistinct: true,
    arithmeticPerformedAcrossSides: false,
  });
}

/**
 * Compose the full receiving-side report: the consumed handoff, the missing semantics,
 * the bounded current-order comparison, and the separation record.
 *
 * `netRevenueComparison` is OPTIONAL and, when supplied, must be a real released
 * comparison output. When it is absent the report still resolves — with an explicit
 * UNAVAILABLE revenue side — because net revenue being unavailable must not make the
 * order-side result disappear, and must never be replaced by an inferred number.
 */
export function buildOrderSourceConsumptionReport({
  consumption,
  netRevenueComparison = null,
  netRevenueSourceRows = null,
  supportedStatuses = DEFAULT_SUPPORTED_ORDER_STATUSES,
  generatedAt,
} = {}) {
  const currentOrderComparison = compareSupportedCurrentOrders({ consumption, supportedStatuses });
  const missingSemantics = buildOrderSourceMissingSemantics(consumption);
  const separation = buildOrderVsRevenueSeparation({
    currentOrderComparison,
    netRevenueReport: netRevenueComparison,
    netRevenueSourceRows,
  });
  const report = {
    schema: ORDER_SOURCE_CONSUMPTION_SCHEMA,
    side: 'RECEIVING',
    trust: consumption?.handoff?.binding?.trust ?? 'UNKNOWN',
    generatedAt: generatedAt ?? consumption?.retainedSourceAuthority?.now ?? null,
    handoff: {
      outcome: consumption?.outcome ?? 'UNAVAILABLE',
      code: consumption?.code ?? null,
      module: consumption?.module ?? null,
      retainedSourceAuthority: consumption?.retainedSourceAuthority ?? null,
      bindingDigest: consumption?.handoff?.bindingDigest ?? null,
      rebind: consumption?.rebind ?? null,
      unsupportedFacts: consumption?.handoff?.unsupportedFacts ?? null,
    },
    missingSemantics,
    currentOrderComparison,
    separation,
    nonclaims: ORDER_SOURCE_CONSUMPTION_NONCLAIMS,
  };
  return Object.freeze({
    ...report,
    digest: orderSourceConsumptionDigest(report),
  });
}

/**
 * Deterministic digest over the published report.
 *
 * A DIGEST-bearing field is stripped before hashing so the digest cannot depend on itself.
 * The remaining structure is canonicalised by key order, so two runs over the same
 * retained authority produce the same digest.
 */
export function orderSourceConsumptionDigest(report) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) {
        if (key === 'digest' || key.endsWith('Digest')) continue;
        out[key] = canonical(value[key]);
      }
      return out;
    }
    return value;
  };
  return `sha256:${sha256Hex(JSON.stringify(canonical(report)))}`;
}

// --------------------------------------------------------------- self-checks

/**
 * TASK-SPECIFIC SELF-CHECKS.
 *
 * These are the invariants the issue names, checked against this module's own release
 * artefacts rather than asserted in prose. Each check returns
 * `{ id, ok, detail }`; `runOrderSourceConsumptionSelfChecks` returns the collection, and
 * `assertOrderSourceConsumptionSelfChecks` throws on the first failure.
 *
 * They are deliberately written so that BREAKING the separation, the missing semantics or
 * the boundedness makes them fail — a self-check that cannot fail is not a check.
 */
export function runOrderSourceConsumptionSelfChecks({
  report,
  consumption,
  moduleSourceText,
} = {}) {
  const checks = [];
  const push = (id, ok, detail) => checks.push(Object.freeze({ id, ok, detail }));

  const comparison = report?.currentOrderComparison ?? null;
  const sep = report?.separation ?? null;
  const ms = report?.missingSemantics ?? null;

  // Checked on the PUBLISHED report as well as on the live consumption: a report that
  // failed to carry the producer's identity is not a proof that the real producer was
  // used, even if the run that produced it did use it.
  const publishedModule = report?.handoff?.module ?? null;
  push('S1_handoff_consumed_from_real_producer_module',
    consumption?.outcome === 'CONSUMED'
      && typeof consumption.module?.moduleSha256 === 'string'
      && consumption.module.commitBinding !== 'MISMATCH'
      && publishedModule !== null
      && typeof publishedModule.moduleSha256 === 'string'
      && publishedModule.moduleSha256 === consumption.module.moduleSha256
      && publishedModule.parentCandidateCommit === PAN_ORDER_SOURCE_DEPENDENCY.parentCandidateCommit,
    {
      outcome: consumption?.outcome ?? null,
      moduleSha256: consumption?.module?.moduleSha256 ?? null,
      publishedModuleSha256: publishedModule?.moduleSha256 ?? null,
      publishedParentCandidateCommit: publishedModule?.parentCandidateCommit ?? null,
    });

  push('S2_source_authority_retained_outside_payload',
    consumption?.retainedSourceAuthority?.retainedOutsidePayload === true
      && typeof consumption.retainedSourceAuthority.sourceBytesSha256 === 'string'
      && typeof consumption.retainedSourceAuthority.sourceLabel === 'string',
    consumption?.retainedSourceAuthority ?? null);

  push('S3_current_order_comparison_is_bounded',
    comparison?.outcome === 'COMPARED'
      && Array.isArray(comparison.supportedStatuses) && comparison.supportedStatuses.length > 0
      && Array.isArray(comparison.unsupportedStatusesObserved)
      && comparison.excludedUnsupported.every((e) => e.disposition === 'EXCLUDED_UNSUPPORTED'),
    { supported: comparison?.supportedStatuses ?? null, unsupportedObserved: comparison?.unsupportedStatusesObserved ?? null });

  push('S4_missing_history_is_explicit',
    ms?.history?.state === 'UNAVAILABLE' && ms?.previousStates?.state === 'UNAVAILABLE'
      && ms.netRevenue.state === 'UNAVAILABLE',
    { history: ms?.history ?? null, previousStates: ms?.previousStates ?? null });

  push('S5_unit_and_quantity_are_explicitly_unavailable',
    ms?.orderedQuantity?.state === 'UNAVAILABLE' && ms?.quantityUnit?.state === 'UNAVAILABLE'
      && ms?.quantityEvidence?.orderCount === comparison?.totals?.supportedOrderCount
        + comparison?.totals?.unsupportedOrderCount,
    { orderedQuantity: ms?.orderedQuantity ?? null, quantityUnit: ms?.quantityUnit ?? null, evidence: ms?.quantityEvidence ?? null });

  push('S6_revenue_never_inferred_from_orders',
    ms?.netRevenue?.state === 'UNAVAILABLE'
      && sep?.combinedTotal?.state === 'UNAVAILABLE'
      && sep?.reconciliation?.state === 'UNAVAILABLE'
      && sep?.attribution?.state === 'UNAVAILABLE'
      && sep?.arithmeticPerformedAcrossSides === false,
    { netRevenue: ms?.netRevenue ?? null, combinedTotal: sep?.combinedTotal ?? null, arithmeticPerformedAcrossSides: sep?.arithmeticPerformedAcrossSides ?? null });

  push('S7_no_quantity_or_amount_field_is_available_anywhere_in_report',
    JSON.stringify(comparison?.byStatus ?? {}).includes('amount') === false
      && comparison?.revenueFields?.state === 'UNAVAILABLE'
      && comparison?.quantityFields?.state === 'UNAVAILABLE'
      && comparison?.historyFields?.state === 'UNAVAILABLE',
    { revenueFields: comparison?.revenueFields ?? null });

  // A digest that does not cover the body it claims to cover would let a tampered report
  // keep its old, matching digest. So: recompute, then ALSO prove the digest is not a
  // function of itself, and that a body-level tamper changes it. `digest` and
  // `handoff.bindingDigest` are the two envelope-carried values excluded from the body
  // hash, so they are the only fields that may change without changing the digest.
  const recomputed = orderSourceConsumptionDigest(report);
  const withoutEnvelope = { ...report };
  delete withoutEnvelope.digest;
  const digestCosmetic =
    typeof report?.digest === 'string'
    && recomputed === orderSourceConsumptionDigest(withoutEnvelope)
    && recomputed === orderSourceConsumptionDigest({ ...report, digest: 'sha256:deliberately-wrong' });
  // A body tamper that clears the envelope digest must move the digest.
  const tampered = JSON.parse(JSON.stringify(report));
  tampered.digest = null;
  if (tampered.missingSemantics?.netRevenue) tampered.missingSemantics.netRevenue.state = 'AVAILABLE';
  const digestDetectsTamper = orderSourceConsumptionDigest(tampered) !== recomputed;
  push('S8_report_digest_is_deterministic_and_self_excluded',
    digestCosmetic && digestDetectsTamper,
    {
      declared: report?.digest ?? null,
      recomputed,
      matches: report?.digest === recomputed,
      digestCosmetic,
      digestDetectsTamper,
    });

  push('S9_unsupported_statuses_are_never_folded_into_supported_buckets',
    Object.keys(comparison?.byStatus ?? {}).every((s) => comparison.supportedStatuses.includes(s)),
    { byStatusKeys: Object.keys(comparison?.byStatus ?? {}) });

  // The receiver must DELEGATE all source authority to the producer module, and must not
  // fork the released reader or the released revenue comparison:
  //   - the producer entry points must be named (it really is consuming PAN);
  //   - the released reader must NOT be called directly here (the producer owns it);
  //   - the released revenue comparison must NOT be re-implemented, but importing it is
  //     correct and expected — the separation is about not MERGING the numbers, which
  //     S6 already checks.
  // The forbidden calls are assembled at runtime so that this check's own source text
  // does not contain the tokens it searches for — otherwise the check could never pass.
  const forbiddenReleasedCalls = [
    ['readErpOrders', 'FromLabelledSourceBytesV1'].join(''),
    ['createErpRead', 'AdapterV1'].join(''),
    ['decode', 'SourceBytes'].join(''),
  ];
  const forks = typeof moduleSourceText === 'string'
    ? forbiddenReleasedCalls.filter((token) => moduleSourceText.includes(token))
    : [];
  push('S10_module_delegates_source_authority_and_does_not_fork_the_released_reader',
    typeof moduleSourceText === 'string'
      ? (moduleSourceText.includes('createKs238OrderSourceHandoff')
        && moduleSourceText.includes('rebindSerializedOrderSource')
        && forks.length === 0)
      : true,
    {
      moduleSourceInspected: typeof moduleSourceText === 'string',
      delegatesCreate: typeof moduleSourceText === 'string' ? moduleSourceText.includes('createKs238OrderSourceHandoff') : null,
      forbiddenTokensFound: forks,
    });

  // The receiving side must not inflate a SOURCE_EVIDENCE_ONLY release into a published
  // compiled bundle, and must keep the public released source, the retained compiled
  // artifact, the historical candidate commits and the optional Git evidence apart. Checked
  // on the LIVE consumption AND on the PUBLISHED report: a report that dropped the release
  // binding is not proof that a released producer was used, so it fails here.
  const liveRelease = consumption?.module?.release ?? null;
  const publishedRelease = publishedModule?.release ?? null;
  const releaseBound = (value) => value !== null && typeof value === 'object'
    && value.state === 'QUALIFIED'
    && value.releaseBinding === 'PUBLIC_RELEASED_SOURCE'
    && value.publicReleasedSource?.state === 'MATCH'
    && value.release?.releaseClass === 'SOURCE_EVIDENCE_ONLY'
    && value.release?.compiledClosurePublished === false
    && value.retainedCompiledArtifact?.publishedAsReleaseAsset === false
    && value.historicalCandidate?.isTheRelease === false
    && Array.isArray(value.historicalCandidate?.commits)
    && typeof value.release?.mainCommit === 'string'
    && value.historicalCandidate.commits.includes(value.release.mainCommit) === false;
  push('S11_released_source_is_bound_without_inflating_it_into_a_publication',
    releaseBound(liveRelease) && releaseBound(publishedRelease)
      && liveRelease.release.mainCommit === publishedRelease.release.mainCommit
      && liveRelease.retainedCompiledArtifact.closureSha256
        === publishedRelease.retainedCompiledArtifact.closureSha256,
    {
      liveState: liveRelease?.state ?? null,
      publishedState: publishedRelease?.state ?? null,
      releaseBinding: liveRelease?.releaseBinding ?? null,
      compiledClosurePublished: liveRelease?.release?.compiledClosurePublished ?? null,
      publishedAsReleaseAsset: liveRelease?.retainedCompiledArtifact?.publishedAsReleaseAsset ?? null,
    });

  return Object.freeze(checks.map((c) => Object.freeze(c)));
}

export function assertOrderSourceConsumptionSelfChecks(...args) {
  const checks = runOrderSourceConsumptionSelfChecks(...args);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    const error = new Error(`ORDER_SOURCE_CONSUMPTION_SELF_CHECK_FAILED: ${failed.map((f) => f.id).join(',')}`);
    error.code = 'ORDER_SOURCE_CONSUMPTION_SELF_CHECK_FAILED';
    error.failed = failed;
    throw error;
  }
  return checks;
}
