#!/usr/bin/env node
// Parent closure verification for the KS073 distribution epic (live issue #73)
// on the exact base d038aaf0595f0bef4a762ddd06d1938ccb82eda9.
//
// Pure, one-shot, fail-closed. Reads the committed closure receipt
// (docs/release/ks73-epic-closure-v1.json) and verifies, against the on-disk
// bytes of this base:
//   - the single canonical skill source and host contracts are digest-exact;
//   - the five child slices (#74-#78) carry their real terminal states and
//     digest-pinned evidence; the completed K4b/#75 ClawHub publication is
//     represented as version-bound recorded public delivery at exactly
//     catalog version 0.18.2, bound by digest to the committed public facts
//     record (docs/release/k4b-clawhub-publication-v1.json), with its
//     publication wait resolved; every other per-child publicListingClaim is
//     false;
//   - the two remaining external waits (Codex, Claude) are nonterminal with
//     exactly one bounded resume action each;
//   - the K4e slice is serial after K4a and bound to the exact six External
//     API v2 runtime intents with runtimeDispatch false;
//   - the KS076/KS077 branch reconciliation record is well-formed and the
//     claimed integration is digest-anchored to the committed K4c/K4d
//     evidence present at this base.
//
// It performs no submission, publication, listing, identity, credential, or
// release operation and uses no network. It never claims a public
// marketplace listing of the current source package: the receipt's
// publicListingClaim must stay false, and the K4b child's claim is bound to
// the recorded catalog version 0.18.2 only.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RECEIPT_SCHEMA = 'kaleidosphere/ks73-epic-closure/v1';
const VERDICT_SCHEMA = 'kaleidosphere/ks73-epic-closure-verdict/v1';
const BASE_COMMIT = 'd038aaf0595f0bef4a762ddd06d1938ccb82eda9';
const EXPECTED_CHILDREN = Object.freeze({
  74: 'source-local-terminal',
  75: 'published-version-bound',
  76: 'nonterminal-external-wait',
  77: 'nonterminal-external-wait',
  78: 'source-local-terminal',
});
// The K4b/#75 child is the recorded public delivery (clawhub catalog 0.18.2);
// every other child must keep a false public listing claim.
const EXPECTED_CHILD_LISTING_CLAIMS = Object.freeze({
  74: false,
  75: true,
  76: false,
  77: false,
  78: false,
});
// The only unresolved external waits after the recorded K4b publication.
const EXPECTED_WAIT_IDS = Object.freeze([
  'claude-marketplace-identity',
  'codex-portal-identity',
]);
const K4B_FACTS_PATH = 'docs/release/k4b-clawhub-publication-v1.json';
const K4B_FACTS_SCHEMA = 'ks-series/k4b-public-facts/v1';
const K4B_PUBLISHED_VERSION = '0.18.2';
const K4B_RELEASE_TAG = 'v0.18.2';
const K4B_ARCHIVE_PREFIX = `kaleidosphere-clawhub-skill-v${K4B_PUBLISHED_VERSION}/`;
const K4B_PUBLISHER = 'jofe2';
const K4B_CLAWHUB_URL = 'https://clawhub.ai/jofe2/skills/kaleidosphere';
const K4B_ISSUE_URL = 'https://github.com/JoFe2/KaleidoSphere/issues/75';
const K4B_TERMINAL_COMMENT_ID = 5470919529;
const K4B_SOURCE_026_NONCLAIM = 'No current source version 0.26.0 marketplace publication';
const EXPECTED_EXTERNAL_API_V2_INTENTS = Object.freeze([
  'status',
  'discovery',
  'analyze',
  'plan',
  'preview',
  'readback',
]);
const REQUIRED_NON_CLAIMS = Object.freeze([
  'NO_MARKETPLACE_LISTING_BESIDES_K4B_CATALOG_0.18.2',
  'NO_PUBLIC_INSTALLABILITY_BESIDES_K4B_CATALOG_0.18.2',
  'NO_FRESH_CLAWHUB_OR_CODEX_OR_CLAUDE_RUNTIME_EXECUTION',
  'NO_LIVE_CODEX_PROVIDER_RESPONSE',
  'NO_RELEASE_OR_TAG_CREATED',
  'NO_HOSTED_SERVICE_OR_MANAGED_CONNECTOR',
  'NO_PRODUCTION_READINESS',
  'NO_CREDENTIAL_OR_NETWORK_ACCESS',
  'NO_SECOND_MAINTAINED_SKILL_COPY',
]);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const isSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isCommit = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

// `receiptText`, when provided, replaces reading the receipt from disk; the
// evidence and single-source bytes are always read from disk so digest
// anchoring can never be bypassed by an in-memory receipt.
export async function verifyEpicClosure(root, { receiptText } = {}) {
  const violations = [];
  const deny = (code, detail) => violations.push({ code, detail });

  let receipt;
  try {
    const text =
      receiptText ?? (await readFile(path.join(root, 'docs', 'release', 'ks73-epic-closure-v1.json'), 'utf8'));
    receipt = JSON.parse(text);
  } catch (error) {
    return { schemaVersion: VERDICT_SCHEMA, ok: false, violations: [{ code: 'RECEIPT_UNREADABLE', detail: String(error) }] };
  }

  if (receipt.schemaVersion !== RECEIPT_SCHEMA) deny('SCHEMA_DRIFT', `schemaVersion must be ${RECEIPT_SCHEMA}`);
  if (receipt.task?.id !== 'KS073-DISTRIBUTION-EPIC' || receipt.task?.issue !== 73) {
    deny('TASK_IDENTITY', 'task must identify KS073-DISTRIBUTION-EPIC / issue 73');
  }
  if (receipt.baseCommit !== BASE_COMMIT) deny('BASE_COMMIT_DRIFT', `baseCommit must be ${BASE_COMMIT}`);
  if (receipt.terminalState !== 'nonterminal-external-wait') {
    deny('TERMINAL_STATE', 'epic terminalState must stay nonterminal-external-wait on this base');
  }
  if (receipt.publicListingClaim !== false) deny('LISTING_CLAIM_DENIED', 'publicListingClaim must be false');

  // Single canonical source: exactly the three skill files, digest-exact.
  const singleSource = receipt.singleSource;
  if (singleSource?.root !== 'agent-skills/kaleidosphere') deny('SINGLE_SOURCE_ROOT', 'singleSource.root drifted');
  const canonicalFiles = Object.keys(singleSource?.files ?? {}).sort();
  if (JSON.stringify(canonicalFiles) !== JSON.stringify(['SKILL.md', 'references/contract.json', 'scripts/validate-request.mjs'])) {
    deny('SINGLE_SOURCE_FILES', 'singleSource.files must be exactly the three canonical skill files');
  }
  for (const [relative, expected] of Object.entries(singleSource?.files ?? {})) {
    if (!isSha256(expected)) { deny('SINGLE_SOURCE_DIGEST_FORMAT', relative); continue; }
    try {
      const actual = sha256(await readFile(path.join(root, 'agent-skills', 'kaleidosphere', relative)));
      if (actual !== expected) deny('SINGLE_SOURCE_DIGEST_DRIFT', relative);
    } catch {
      deny('SINGLE_SOURCE_MISSING', relative);
    }
  }
  const hostContracts = singleSource?.hostContracts;
  if (hostContracts?.path !== 'agent-skills/host-contracts.json' || !isSha256(hostContracts?.sha256)) {
    deny('HOST_CONTRACTS_REFERENCE', 'singleSource.hostContracts must pin agent-skills/host-contracts.json');
  } else {
    try {
      if (sha256(await readFile(path.join(root, hostContracts.path))) !== hostContracts.sha256) {
        deny('HOST_CONTRACTS_DIGEST_DRIFT', hostContracts.path);
      }
    } catch {
      deny('HOST_CONTRACTS_MISSING', hostContracts.path);
    }
  }

  // Children: exactly #74-#78 with their real terminal states.
  const children = Array.isArray(receipt.children) ? receipt.children : [];
  if (JSON.stringify(children.map((child) => child.issue).sort((a, b) => a - b)) !== JSON.stringify([74, 75, 76, 77, 78])) {
    deny('CHILD_SET', 'children must be exactly issues 74-78');
  }
  const waitIds = new Set((Array.isArray(receipt.externalWaits) ? receipt.externalWaits : []).map((wait) => wait.id));
  for (const child of children) {
    const label = `child#${child.issue}`;
    if (typeof child.issue !== 'number') continue;
    const expectedState = EXPECTED_CHILDREN[child.issue];
    if (expectedState && child.terminalState !== expectedState) {
      deny('CHILD_TERMINAL_STATE', `${label} terminalState must be ${expectedState}`);
    }
    const expectedClaim = EXPECTED_CHILD_LISTING_CLAIMS[child.issue];
    if (typeof expectedClaim === 'boolean' && child.publicListingClaim !== expectedClaim) {
      deny('CHILD_LISTING_CLAIM_DENIED', `${label} publicListingClaim must be ${expectedClaim}`);
    }
    if (!Array.isArray(child.externalWaits)) deny('CHILD_WAITS_FORMAT', label);
    for (const waitId of child.externalWaits ?? []) {
      if (!waitIds.has(waitId)) deny('CHILD_WAIT_UNRESOLVED', `${label} references unknown wait ${waitId}`);
    }
    if (!Array.isArray(child.evidence) || child.evidence.length === 0) {
      deny('CHILD_EVIDENCE_EMPTY', label);
      continue;
    }
    for (const evidence of child.evidence) {
      if (!isNonEmptyString(evidence?.path) || !isSha256(evidence?.sha256)) {
        deny('CHILD_EVIDENCE_FORMAT', `${label} ${evidence?.path ?? '(missing path)'}`);
        continue;
      }
      const resolved = path.resolve(root, evidence.path);
      if (!resolved.startsWith(path.resolve(root) + path.sep)) {
        deny('CHILD_EVIDENCE_PATH_ESCAPE', evidence.path);
        continue;
      }
      try {
        if (sha256(await readFile(resolved)) !== evidence.sha256) deny('CHILD_EVIDENCE_DIGEST_DRIFT', evidence.path);
      } catch {
        deny('CHILD_EVIDENCE_MISSING', evidence.path);
      }
    }
  }

  // K4b (#75): the completed ClawHub publication is represented as
  // version-bound recorded public delivery at exactly catalog version 0.18.2,
  // bound by digest to the committed public facts record. Its publication
  // wait is resolved and must not reappear as an external wait. The facts
  // record is always read from disk, so the binding cannot be bypassed by an
  // in-memory receipt.
  const k4b = children.find((child) => child.issue === 75);
  if (k4b) {
    if (Array.isArray(k4b.externalWaits) && k4b.externalWaits.length !== 0) {
      deny('K4B_PUBLICATION_WAIT_RESURRECTED', 'child#75 must carry no external waits: the clawhub publication wait is resolved by the recorded 0.18.2 delivery');
    }
    const publication = k4b.publication;
    if (!publication || typeof publication !== 'object' || publication.host !== 'clawhub') {
      deny('K4B_PUBLICATION_MISSING', 'child#75 must bind the recorded clawhub publication as version-bound recorded public delivery');
    } else {
      if (publication.version !== K4B_PUBLISHED_VERSION) {
        deny('K4B_PUBLICATION_VERSION_DRIFT', `child#75 publication version must be exactly ${K4B_PUBLISHED_VERSION}`);
      }
      const factsRef = publication.facts;
      let facts = null;
      if (factsRef?.path !== K4B_FACTS_PATH || !isSha256(factsRef?.sha256)) {
        deny('K4B_PUBLICATION_FACTS', 'child#75 publication.facts must pin the committed public facts record by exact path and sha256');
      } else {
        try {
          const factsBytes = await readFile(path.join(root, K4B_FACTS_PATH));
          if (sha256(factsBytes) !== factsRef.sha256) {
            deny('K4B_PUBLICATION_FACTS', `committed public facts digest drift at ${K4B_FACTS_PATH}`);
          } else {
            facts = JSON.parse(factsBytes.toString('utf8'));
          }
        } catch (error) {
          deny('K4B_PUBLICATION_FACTS', String(error));
        }
      }
      if (facts) {
        if (facts.schema !== K4B_FACTS_SCHEMA) deny('K4B_PUBLICATION_FACTS_SCHEMA', `facts schema must be ${K4B_FACTS_SCHEMA}`);
        if (facts.anonymous !== true) deny('K4B_PUBLICATION_FACTS_IDENTITY', 'facts must record a fresh anonymous readback');
        const clawhub = facts.clawhub ?? {};
        if (
          clawhub.publisher !== K4B_PUBLISHER
          || clawhub.url !== K4B_CLAWHUB_URL
          || clawhub.version !== K4B_PUBLISHED_VERSION
          || !isSha256(clawhub.page_sha256)
          || !isNonEmptyString(clawhub.scope)
        ) {
          deny('K4B_PUBLICATION_FACTS_IDENTITY', 'clawhub facts must keep the exact recorded publisher, slug URL, version and page digest');
        }
        const issue = facts.issue ?? {};
        if (issue.state !== 'closed' || issue.state_reason !== 'completed' || issue.url !== K4B_ISSUE_URL) {
          deny('K4B_PUBLICATION_FACTS_IDENTITY', 'issue facts must record #75 closed/completed at the exact public issue URL');
        }
        const release = facts.release ?? {};
        if (
          release.tag !== K4B_RELEASE_TAG
          || release.draft !== false
          || !isSha256(release.archive_sha256)
          || !isCommit(release.target)
          || !isNonEmptyString(release.archive)
          || !isNonEmptyString(release.archive_url)
          || !isNonEmptyString(release.sidecar_url)
        ) {
          deny('K4B_PUBLICATION_FACTS_RELEASE', 'release facts must keep the exact recorded non-draft tag, archive digest, target and sidecar');
        }
        const comment = facts.terminal_comment ?? {};
        if (
          comment.id !== K4B_TERMINAL_COMMENT_ID
          || !isSha256(comment.body_sha256)
          || !isNonEmptyString(comment.published_at)
          || !isNonEmptyString(comment.scope)
          || !isNonEmptyString(comment.url)
        ) {
          deny('K4B_PUBLICATION_FACTS_COMMENT', 'terminal comment facts must keep the exact recorded historical comment identity and scope');
        }
        if (!isNonEmptyString(facts.observed_at)) deny('K4B_PUBLICATION_FACTS_SCOPE', 'facts must record the exact observation time');
        if (!Array.isArray(facts.nonclaims) || !facts.nonclaims.includes(K4B_SOURCE_026_NONCLAIM)) {
          deny('K4B_PUBLICATION_FACTS_SCOPE', 'facts must keep the explicit non-claim of a source 0.26.0 marketplace publication');
        }
        // The public v0.18.2 archive must carry exactly the canonical skill
        // bytes pinned by the receipt, so the recorded delivery is anchored
        // to the single maintained source rather than a substituted copy.
        const canonicalFiles = singleSource?.files ?? {};
        const releaseFiles = release.files ?? {};
        const expectedArchiveKeys = Object.keys(canonicalFiles).map((file) => `${K4B_ARCHIVE_PREFIX}${file}`).sort();
        if (JSON.stringify(Object.keys(releaseFiles).sort()) !== JSON.stringify(expectedArchiveKeys)) {
          deny('K4B_PUBLICATION_CANONICAL_DRIFT', 'release files must be exactly the three canonical skill files under the v0.18.2 archive prefix');
        }
        for (const [relative, expected] of Object.entries(canonicalFiles)) {
          const archiveKey = `${K4B_ARCHIVE_PREFIX}${relative}`;
          if (releaseFiles[archiveKey] !== expected) deny('K4B_PUBLICATION_CANONICAL_DRIFT', archiveKey);
        }
        // No version substitution between the receipt binding and the
        // recorded catalog version.
        if (publication.version !== clawhub.version) {
          deny('K4B_PUBLICATION_VERSION_DRIFT', `publication version ${publication.version} differs from recorded clawhub version ${clawhub.version}`);
        }
      }
    }
  }

  // K4e ordering and the External API v2 intent bound, checked against the
  // digest-verified host contracts on disk.
  const k4e = children.find((child) => child.issue === 78);
  if (k4e) {
    if (k4e.ordering?.after !== 74 || k4e.ordering?.afterSatisfied !== true) {
      deny('K4E_ORDERING', 'K4e must be serial after K4a (#74) with afterSatisfied true');
    }
    const intentBound = k4e.intentBound;
    if (
      JSON.stringify(intentBound?.externalApiV2RuntimeIntents ?? []) !== JSON.stringify(EXPECTED_EXTERNAL_API_V2_INTENTS)
      || intentBound?.widened !== false
      || intentBound?.runtimeDispatch !== false
    ) {
      deny('K4E_INTENT_BOUND', 'K4e must be bound to the exact six External API v2 intents, unwidened, runtimeDispatch false');
    }
    try {
      const hostContractsJson = JSON.parse(await readFile(path.join(root, 'agent-skills', 'host-contracts.json'), 'utf8'));
      const crossHarness = hostContractsJson.crossHarness;
      if (JSON.stringify(crossHarness?.externalApiV2Intents ?? []) !== JSON.stringify(EXPECTED_EXTERNAL_API_V2_INTENTS)) {
        deny('K4E_HOST_INTENT_DRIFT', 'host contracts externalApiV2Intents drifted from the six bounded intents');
      }
      if (crossHarness?.runtimeDispatch !== false || crossHarness?.security?.skillsOnly !== true) {
        deny('K4E_HOST_AUTHORITY_DRIFT', 'host contracts must keep runtimeDispatch false and skillsOnly true');
      }
    } catch {
      deny('HOST_CONTRACTS_UNREADABLE', 'agent-skills/host-contracts.json');
    }
  }

  // External waits: exactly the two unresolved Codex/Claude waits,
  // nonterminal, with exactly one bounded resume action each. The clawhub
  // publication wait is resolved by the recorded K4b 0.18.2 delivery and must
  // not reappear.
  const waits = Array.isArray(receipt.externalWaits) ? receipt.externalWaits : [];
  if (waits.length !== EXPECTED_WAIT_IDS.length) {
    deny('WAIT_SET', 'exactly two unresolved external waits (Codex, Claude) are expected; the K4b clawhub publication wait is resolved by the recorded 0.18.2 delivery');
  }
  if (JSON.stringify(waits.map((wait) => wait.id).sort()) !== JSON.stringify([...EXPECTED_WAIT_IDS].sort())) {
    deny('WAIT_SET', `unresolved external waits must be exactly ${[...EXPECTED_WAIT_IDS].join(' and ')}`);
  }
  for (const wait of waits) {
    const label = `wait#${wait.id ?? '(unknown)'}`;
    if (wait.satisfied !== false) deny('WAIT_MUST_BE_NONTERMINAL', label);
    if (!isNonEmptyString(wait?.resumeAction)) deny('WAIT_RESUME_ACTION_MISSING', label);
    const childrenForWait = children.filter((child) => (child.externalWaits ?? []).includes(wait.id));
    if (childrenForWait.length === 0) deny('WAIT_UNATTACHED', label);
    for (const child of childrenForWait) {
      if (wait.child !== child.issue) deny('WAIT_CHILD_MISMATCH', label);
    }
  }

  // Branch reconciliation: well-formed and integration-anchored.
  const reconciliations = Array.isArray(receipt.branchReconciliation) ? receipt.branchReconciliation : [];
  if (reconciliations.length !== 2) deny('RECONCILIATION_SET', 'exactly two branch reconciliations (KS076, KS077) are expected');
  for (const record of reconciliations) {
    const label = `reconciliation#${record.taskId ?? '(unknown)'}`;
    if (!['KS076-CODEX-DISTRIBUTION', 'KS077-CLAUDE-DISTRIBUTION'].includes(record.taskId)) {
      deny('RECONCILIATION_TASK', label);
    }
    if (!isCommit(record?.remoteTip) || !isCommit(record?.deliveryCommit)) deny('RECONCILIATION_SHA_FORMAT', label);
    if (record?.integratedInBase !== true) deny('RECONCILIATION_STATE', `${label} must record integratedInBase true`);
    if (!isNonEmptyString(record?.integrationProof)) deny('RECONCILIATION_PROOF_MISSING', label);
    const issue = record.taskId === 'KS076-CODEX-DISTRIBUTION' ? 76 : 77;
    if (record.issue !== issue) deny('RECONCILIATION_ISSUE', label);
    const child = children.find((candidate) => candidate.issue === issue);
    if (!child || (child.externalWaits ?? []).length === 0) {
      deny('RECONCILIATION_CHILD_MISSING', label);
    }
  }

  // Epic-level non-claims.
  const nonClaims = Array.isArray(receipt.nonClaims) ? receipt.nonClaims : [];
  for (const required of REQUIRED_NON_CLAIMS) {
    if (!nonClaims.includes(required)) deny('NON_CLAIM_MISSING', required);
  }

  return { schemaVersion: VERDICT_SCHEMA, ok: violations.length === 0, violations };
}

function parseArgs(argv) {
  const args = { root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') args.root = path.resolve(argv[i + 1] ?? '');
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { root, json } = parseArgs(process.argv.slice(2));
  const verdict = await verifyEpicClosure(root);
  if (json) {
    process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  } else if (verdict.ok) {
    process.stdout.write('ks73-epic-closure: VERIFIED\n');
  } else {
    for (const violation of verdict.violations) {
      process.stderr.write(`ks73-epic-closure: DENIED ${violation.code} ${violation.detail}\n`);
    }
  }
  process.exitCode = verdict.ok ? 0 : 1;
}