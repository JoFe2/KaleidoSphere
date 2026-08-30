import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';

import { validateOrThrow } from '../services/bi-control/src/graph-pilot/schema-validator.mjs';

export const DECISION_PACKAGE_SCHEMA = 'kaleidosphere.future.remote-connector/go-no-go-evidence-index/v1';
export const RECEIPT_SCHEMA = 'kaleidosphere.future.remote-connector/local-decision-receipt/v1';
export const CONTRACT_ID = 'PLAN-KS93-DECISION-CONTRACT-01';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(scriptRoot, 'docs/future/remote-connector/GO_NO_GO_EVIDENCE_INDEX.schema.json');
const expectedBaseline = ['Operating Model v1.1', 'D-001', 'D-002', 'D-003', 'D-004', 'D-005', 'D-006', 'D-007'];
const expectedCitationIds = ['FRC.0', 'FRC.1', 'FRC.2', 'FRC.3'];
const expectedDimensions = ['feasibility', 'risk', 'cost', 'compliance', 'support', 'rollback', 'scope-boundary'];
const expectedAssessments = ['feasibility', 'risks', 'costs', 'complianceGaps', 'supportBurden', 'rollback'];
const expectedScopeRules = [
  'discovery-as-implementation-approval',
  'hosted-endpoint-creation',
  'external-api-v2-widening',
  'credentials-or-customer-data-evidence',
];
const expectedSteps = [
  'validate-schema',
  'verify-local-citations',
  'resolve-claim-references',
  'classify-evidence',
  'evaluate-required-fields',
  'evaluate-reject-rules',
  'apply-verdict-precedence',
  'verify-authorization-firewall',
];
const forbiddenValuePattern = /(?:password|secret|bearer\s+|customer[ -]data|raw\s+source\s+rows|https?:\/\/)/i;
const localPathPattern = /^(?!\/)(?!.*\.\.)(?!.*:\/\/)[A-Za-z0-9._/-]+$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const fixedFirewall = {
  decisionAuthority: 'DISCOVERY_DECISION_ONLY',
  implementationChildStatus: 'BLOCKED_NO_SEPARATE_DELIVERY_AUTHORIZATION',
  separateDeliveryAuthorizationRequired: true,
  embeddedAuthorizationAccepted: false,
  implementationAuthorized: false,
  runtimeDispatchAuthorized: false,
  hostedEndpointCreationAuthorized: false,
  externalApiV2WideningAuthorized: false,
  credentialsOrCustomerDataAuthorized: false,
  deliveryScopeInheritance: 'NONE',
};

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => isObject(value) && Object.hasOwn(value, key);
const claimsFor = (slot) => Array.isArray(slot?.claims) ? slot.claims : [];


function collectStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (isObject(value)) Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

function localRepositoryPath(root, candidate) {
  if (typeof candidate !== 'string' || !localPathPattern.test(candidate)) throw new Error('NON_LOCAL_PATH');
  const absolute = resolve(root, candidate);
  const normalized = relative(root, absolute).split('\\').join('/');
  if (!normalized || normalized.startsWith('../') || normalized === '..') throw new Error('PATH_OUTSIDE_REPOSITORY');
  return { absolute, path: normalized };
}

async function ensureLocalFile(root, candidate) {
  const requested = localRepositoryPath(root, candidate);
  const actual = await realpath(requested.absolute);
  const actualRelative = relative(root, actual).split('\\').join('/');
  if (!actualRelative || actualRelative.startsWith('../') || actualRelative === '..') throw new Error('SYMLINK_OUTSIDE_REPOSITORY');
  return { absolute: actual, path: requested.path };
}

async function verifyCitation(root, slot, errors) {
  if (!isObject(slot) || slot.status !== 'VERIFIED_LOCAL') return;
  const required = ['artifactReference', 'revision', 'citationAnchor', 'artifactTitle', 'artifactPath', 'sourceCommit', 'artifactSha256', 'citedSections', 'claims'];
  for (const key of required) if (!hasOwn(slot, key)) errors.push(`${slot.artifactId}:MISSING_${key}`);
  if (errors.some((error) => error.startsWith(`${slot.artifactId}:MISSING_`))) return;

  try {
    const artifact = await ensureLocalFile(root, slot.artifactPath);
    if (artifact.path !== slot.artifactReference.path || artifact.path !== slot.citationAnchor.path) errors.push(`${slot.artifactId}:PATH_BINDING_MISMATCH`);
    if (!revisionPattern.test(slot.revision) || slot.revision !== slot.artifactReference.revision || slot.revision !== slot.sourceCommit) errors.push(`${slot.artifactId}:REVISION_BINDING_MISMATCH`);
    if (!digestPattern.test(slot.artifactSha256) || slot.artifactSha256 !== slot.artifactReference.sha256) errors.push(`${slot.artifactId}:DIGEST_BINDING_MISMATCH`);

    const bytes = await readFile(artifact.absolute);
    if (sha256(bytes) !== slot.artifactSha256) errors.push(`${slot.artifactId}:CURRENT_CHECKOUT_DIGEST_MISMATCH`);
    if (!bytes.toString('utf8').includes(slot.citationAnchor.locator)) errors.push(`${slot.artifactId}:CITATION_ANCHOR_MISSING`);
  } catch (error) {
    errors.push(`${slot.artifactId}:LOCAL_ARTIFACT_UNAVAILABLE:${error.code ?? error.message}`);
  }
}

function assertFixedShape(packageValue, errors) {
  if (!isObject(packageValue)) {
    errors.push('PACKAGE_NOT_OBJECT');
    return;
  }
  if (packageValue.schemaVersion !== DECISION_PACKAGE_SCHEMA) errors.push('SCHEMA_VERSION_MISMATCH');
  if (packageValue.contractId !== CONTRACT_ID) errors.push('CONTRACT_ID_MISMATCH');
  if (JSON.stringify(packageValue.governanceBaseline) !== JSON.stringify(expectedBaseline)) errors.push('GOVERNANCE_BASELINE_MISMATCH');
  const expectedScope = {
    repository: 'JoFe2/KaleidoSphere',
    mode: 'LOCAL_ONLY',
    discoveryOnly: true,
    implementationPermitted: false,
    networkPermitted: false,
    liveServicePermitted: false,
    hostedEndpointCreationPermitted: false,
    externalApiV2ChangePermitted: false,
    credentialsOrCustomerDataPermitted: false,
  };
  if (JSON.stringify(packageValue.reviewScope) !== JSON.stringify(expectedScope)) errors.push('REVIEW_SCOPE_MISMATCH');
  if (!Array.isArray(packageValue.citations) || packageValue.citations.length !== 4) errors.push('CITATION_CARDINALITY_MISMATCH');
  if (!Array.isArray(packageValue.scopeEvaluation) || packageValue.scopeEvaluation.length !== 4) errors.push('SCOPE_RULE_CARDINALITY_MISMATCH');
  if (JSON.stringify(packageValue.authorizationFirewall) !== JSON.stringify(fixedFirewall)) errors.push('AUTHORIZATION_FIREWALL_MISMATCH');
  const citationEvidenceText = (packageValue.citations ?? []).flatMap((slot) => [
    slot?.evidenceSummary,
    ...(slot?.claims ?? []).map((claim) => claim?.statement),
  ]).filter((value) => typeof value === 'string');
  if (citationEvidenceText.some((text) => forbiddenValuePattern.test(text))) errors.push('FORBIDDEN_EVIDENCE_VALUE');

  if (Array.isArray(packageValue.citations)) {
    if (JSON.stringify(packageValue.citations.map((slot) => slot?.artifactId)) !== JSON.stringify(expectedCitationIds)) errors.push('CITATION_ORDER_MISMATCH');
    for (const slot of packageValue.citations) {
      if (!isObject(slot)) {
        errors.push('CITATION_NOT_OBJECT');
        continue;
      }
      if (slot.terminalDisposition !== slot.status) errors.push(`${slot.artifactId ?? 'UNKNOWN'}:TERMINAL_DISPOSITION_MISMATCH`);
      if (!['VERIFIED_LOCAL', 'MISSING', 'INVALID'].includes(slot.status)) errors.push(`${slot.artifactId ?? 'UNKNOWN'}:INVALID_STATUS`);
      if (!isObject(slot.forbiddenDataAttestation) || Object.values(slot.forbiddenDataAttestation).some((value) => value !== false)) errors.push(`${slot.artifactId ?? 'UNKNOWN'}:FORBIDDEN_DATA_ATTESTATION`);
      if (slot.status === 'VERIFIED_LOCAL') {
        if (slot.contradictionStatus !== 'RESOLVED') errors.push(`${slot.artifactId}:CONTRADICTION_NOT_RESOLVED`);
        if (!Array.isArray(slot.claims) || slot.claims.length === 0) errors.push(`${slot.artifactId}:CLAIMS_MISSING`);
        if (!Array.isArray(slot.citedSections) || slot.citedSections.length === 0) errors.push(`${slot.artifactId}:CITED_SECTIONS_MISSING`);
        const claimIds = new Set();
        for (const claim of claimsFor(slot)) {
          if (!isObject(claim) || typeof claim.claimId !== 'string') {
            errors.push(`${slot.artifactId}:CLAIM_INVALID`);
            continue;
          }
          if (claimIds.has(claim.claimId)) errors.push(`${slot.artifactId}:DUPLICATE_CLAIM:${claim.claimId}`);
          claimIds.add(claim.claimId);
          if (claim.claimClass === 'inferred-candidate' && claim.decisionEffect !== 'INCONCLUSIVE') errors.push(`${slot.artifactId}:INFERENCE_SUPPORTS_DECISION`);
          if (claim.claimClass === 'non-claim' && claim.decisionEffect !== 'BOUNDARY_ONLY') errors.push(`${slot.artifactId}:NON_CLAIM_SUPPORTS_DECISION`);
          if (['FAIL', 'INCONCLUSIVE'].includes(claim.localVerification) && !['INCONCLUSIVE', 'BOUNDARY_ONLY'].includes(claim.decisionEffect)) errors.push(`${slot.artifactId}:UNVERIFIED_CLAIM_SUPPORTS_DECISION`);
        }
      } else {
        if (slot.contradictionStatus !== 'NOT_ASSESSED' || typeof slot.unavailableReason !== 'string') errors.push(`${slot.artifactId ?? 'UNKNOWN'}:FAIL_CLOSED_SLOT_INVALID`);
        for (const key of ['artifactReference', 'revision', 'citationAnchor', 'artifactTitle', 'artifactPath', 'sourceCommit', 'artifactSha256', 'citedSections', 'claims']) if (hasOwn(slot, key)) errors.push(`${slot.artifactId ?? 'UNKNOWN'}:FAIL_CLOSED_SLOT_CONTAINS_${key}`);
      }
    }
  }
  if (Array.isArray(packageValue.scopeEvaluation)) {
    packageValue.scopeEvaluation.forEach((rule, index) => {
      if (rule?.ruleId !== expectedScopeRules[index] || rule?.policy !== 'REJECT') errors.push(`SCOPE_RULE_${index}_IDENTITY_MISMATCH`);
      if (!['CLEAR', 'VIOLATION', 'INCONCLUSIVE'].includes(rule?.status)) errors.push(`SCOPE_RULE_${index}_STATUS_INVALID`);
    });
  }
}

function resolveReferences(packageValue, errors) {
  const claims = new Map();
  const citations = Array.isArray(packageValue.citations) ? packageValue.citations : [];
  const scopeEvaluation = Array.isArray(packageValue.scopeEvaluation) ? packageValue.scopeEvaluation : [];
  for (const slot of citations) {
    for (const claim of claimsFor(slot)) {
      if (isObject(slot) && isObject(claim)) claims.set(`${slot.artifactId}#${claim.claimId}`, claim);
    }
  }
  const checkRefs = (refs, label) => {
    if (!Array.isArray(refs)) {
      errors.push(`${label}:REFERENCES_NOT_ARRAY`);
      return;
    }
    const seen = new Set();
    for (const ref of refs) {
      if (seen.has(ref)) errors.push(`${label}:DUPLICATE_REFERENCE:${ref}`);
      seen.add(ref);
      if (!claims.has(ref)) errors.push(`${label}:UNRESOLVED_REFERENCE:${ref}`);
    }
  };
  for (const [name, assessment] of Object.entries(packageValue.assessments ?? {})) {
    if (['PASS', 'FAIL'].includes(assessment?.status) && (!Array.isArray(assessment.evidenceRefs) || assessment.evidenceRefs.length === 0)) errors.push(`ASSESSMENT_${name}:NONEMPTY_REFERENCE_REQUIRED`);
    checkRefs(assessment?.evidenceRefs, `ASSESSMENT_${name}`);
  }
  for (const [index, rule] of scopeEvaluation.entries()) {
    if (['CLEAR', 'VIOLATION'].includes(rule?.status) && (!Array.isArray(rule.evidenceRefs) || rule.evidenceRefs.length === 0)) errors.push(`SCOPE_RULE_${index}:NONEMPTY_REFERENCE_REQUIRED`);
    checkRefs(rule?.evidenceRefs, `SCOPE_RULE_${index}`);
  }
  checkRefs(packageValue.decision?.evidenceRefs, 'DECISION');
  return claims;
}

function hasGoClaim(citations, dimension) {
  return citations.some((slot) => claimsFor(slot).some((claim) => (
    claim?.dimension === dimension
    && ['observed-fact', 'computed-fact'].includes(claim?.claimClass)
    && claim?.localVerification === 'PASS'
    && claim?.decisionEffect === 'SUPPORTS_GO'
  )));
}

function calculateVerdict(packageValue, checks, errors) {
  const citations = Array.isArray(packageValue.citations) ? packageValue.citations : [];
  const scopeEvaluation = Array.isArray(packageValue.scopeEvaluation) ? packageValue.scopeEvaluation : [];
  const decisiveFailure = packageValue.assessments && expectedAssessments.some((name) => packageValue.assessments[name]?.status === 'FAIL');
  const scopeViolation = scopeEvaluation.some((rule) => rule?.status === 'VIOLATION');
  const supportsReject = citations.some((slot) => claimsFor(slot).some((claim) => claim?.localVerification === 'PASS' && claim?.decisionEffect === 'SUPPORTS_REJECT'));
  if (decisiveFailure || scopeViolation || supportsReject) return 'REJECT';

  const incomplete = errors.length > 0
    || checks.citationVerification !== 'PASS'
    || checks.referenceResolution !== 'PASS'
    || checks.assessmentEvaluation !== 'PASS'
    || checks.rejectRuleEvaluation !== 'CLEAR'
    || !citations.every((slot) => slot?.status === 'VERIFIED_LOCAL' && slot?.contradictionStatus === 'RESOLVED')
    || !expectedAssessments.every((name) => packageValue.assessments?.[name]?.status === 'PASS')
    || !scopeEvaluation.every((rule) => rule?.status === 'CLEAR')
    || !expectedDimensions.every((dimension) => hasGoClaim(citations, dimension));
  return incomplete ? 'NO-GO' : 'GO';
}

function ruleResults(packageValue, fallbackStatus = 'INCONCLUSIVE') {
  return expectedScopeRules.map((ruleId, index) => {
    const rule = packageValue?.scopeEvaluation?.[index];
    return {
      ruleId,
      policy: 'REJECT',
      status: rule?.ruleId === ruleId ? rule.status : fallbackStatus,
      rationale: rule?.ruleId === ruleId && typeof rule.rationale === 'string'
        ? rule.rationale
        : 'The fixed local rule could not be evaluated from an admissible package.',
    };
  });
}

function noExternalActionAttestation() {
  return {
    localFilesOnly: true,
    networkAccessed: false,
    externalCallsPerformed: 0,
    mutationsPerformed: 0,
    liveRuntimeAccessed: false,
    hostedEndpointCreated: false,
    externalApiV2Changed: false,
    credentialsOrCustomerDataAccessed: false,
    statement: 'This dry-run/readback performed no external call and no mutation; it has no delivery authority.',
  };
}

export async function validateDecisionPackage(packageValue, { root = scriptRoot } = {}) {
  const errors = [];
  const artifactInputs = [];
  let schema;
  try {
    schema = JSON.parse(await readFile(schemaPath, 'utf8'));
    validateOrThrow(packageValue, schema, 'decision-package');
  } catch (error) {
    errors.push(`SCHEMA_VALIDATION:${error.code ?? error.message}`);
  }
  assertFixedShape(packageValue, errors);
  const citations = Array.isArray(packageValue?.citations) ? packageValue.citations : [];
  const scopeEvaluation = Array.isArray(packageValue?.scopeEvaluation) ? packageValue.scopeEvaluation : [];
  for (const slot of citations) {
    if (slot?.status === 'VERIFIED_LOCAL') artifactInputs.push({ path: slot.artifactPath, revision: slot.sourceCommit, sha256: slot.artifactSha256 });
    await verifyCitation(root, slot, errors);
  }

  const checks = {
    schemaValidation: errors.some((error) => error.startsWith('SCHEMA_VALIDATION:')) ? 'FAIL' : 'PASS',
    citationVerification: errors.some((error) => /ARTIFACT|PATH_BINDING|REVISION_BINDING|DIGEST_BINDING|CITATION_|LOCAL_ARTIFACT/.test(error)) ? 'FAIL' : 'PASS',
    referenceResolution: 'PASS',
    assessmentEvaluation: 'PASS',
    rejectRuleEvaluation: 'CLEAR',
    authorizationFirewall: errors.includes('AUTHORIZATION_FIREWALL_MISMATCH') ? 'FAIL' : 'PASS',
  };
  if (isObject(packageValue)) {
    resolveReferences(packageValue, errors);
    checks.referenceResolution = errors.some((error) => error.includes('REFERENCE')) ? 'FAIL' : 'PASS';
    checks.assessmentEvaluation = expectedAssessments.every((name) => ['PASS', 'FAIL', 'INCONCLUSIVE'].includes(packageValue.assessments?.[name]?.status)) ? 'PASS' : 'INCONCLUSIVE';
    checks.rejectRuleEvaluation = scopeEvaluation.every((rule) => ['CLEAR', 'VIOLATION', 'INCONCLUSIVE'].includes(rule?.status)) ? (scopeEvaluation.some((rule) => rule?.status === 'VIOLATION') ? 'VIOLATION' : 'CLEAR') : 'INCONCLUSIVE';
  }
  const verdict = isObject(packageValue) ? calculateVerdict(packageValue, checks, errors) : null;
  if (verdict && packageValue.decision?.verdict !== verdict) errors.push('DECISION_VERDICT_CONTRADICTION');
  if (verdict && packageValue.decision?.implementationSuccessClaimed !== false) errors.push('IMPLEMENTATION_SUCCESS_CLAIM');
  if (verdict) {
    const expectedRule = verdict === 'GO'
      ? 'ALL_REQUIRED_LOCAL_EVIDENCE_PASSES'
      : verdict === 'NO-GO'
        ? 'REQUIRED_LOCAL_EVIDENCE_INCOMPLETE_OR_INCONCLUSIVE'
        : 'DECISIVE_EVIDENCE_FAILURE_OR_FORBIDDEN_SCOPE';
    if (packageValue.decision?.decisionRule !== expectedRule) errors.push('DECISION_RULE_CONTRADICTION');
    if (packageValue.decision?.goEvidenceSatisfied !== (verdict === 'GO')) errors.push('GO_EVIDENCE_FLAG_CONTRADICTION');
    const receiptChecks = packageValue.reviewReceipt ?? {};
    for (const [key, expected] of [
      ['citationVerification', checks.citationVerification],
      ['referenceResolution', checks.referenceResolution],
      ['assessmentEvaluation', checks.assessmentEvaluation],
      ['rejectRuleEvaluation', checks.rejectRuleEvaluation],
    ]) if (receiptChecks[key] !== expected) errors.push(`REVIEW_RECEIPT_${key.toUpperCase()}_CONTRADICTION`);
    if (verdict === 'GO' && !expectedDimensions.every((dimension) => hasGoClaim(citations, dimension))) errors.push('GO_DIMENSION_EVIDENCE_INCOMPLETE');
  }

  const structurallyInvalid = errors.some((error) => error.startsWith('SCHEMA_VALIDATION:') || error.includes('MISMATCH') || error.includes('CONTRADICTION') || error.includes('FORBIDDEN') || error.includes('UNAVAILABLE') || error.includes('INVALID') || error.includes('CONTAINS_') || error.includes('NOT_OBJECT') || error.includes('MISSING_') || error.includes('IMPLEMENTATION_SUCCESS_CLAIM'));
  const status = structurallyInvalid
    ? 'INVALID_PACKAGE'
    : verdict === 'REJECT' || verdict === 'NO-GO'
      ? 'REJECTED_WITH_EVIDENCE'
      : 'VALID';
  return {
    status,
    verdict: structurallyInvalid ? null : verdict,
    errors: [...new Set(errors)].sort(),
    checks,
    ruleResults: ruleResults(packageValue, structurallyInvalid ? 'INCONCLUSIVE' : undefined),
    stepsCompleted: expectedSteps,
    artifactInputs,
  };
}

function emptyValidation(error) {
  return {
    status: 'INVALID_PACKAGE',
    verdict: null,
    errors: [error],
    checks: {
      schemaValidation: 'FAIL',
      citationVerification: 'FAIL',
      referenceResolution: 'FAIL',
      assessmentEvaluation: 'INCONCLUSIVE',
      rejectRuleEvaluation: 'INCONCLUSIVE',
      authorizationFirewall: 'FAIL',
    },
    ruleResults: ruleResults(null),
    stepsCompleted: expectedSteps,
    artifactInputs: [],
  };
}

export async function runDecisionValidator(inputPath, { root = scriptRoot } = {}) {
  let input;
  let inputBytes;
  let inputDigest;
  try {
    input = await ensureLocalFile(root, inputPath);
    inputBytes = await readFile(input.absolute);
    inputDigest = sha256(inputBytes);
  } catch (error) {
    return {
      input: { path: inputPath, sha256: null },
      validation: emptyValidation(`INPUT_UNAVAILABLE:${error.code ?? error.message}`),
    };
  }

  let packageValue;
  try {
    packageValue = JSON.parse(inputBytes.toString('utf8'));
  } catch (error) {
    return {
      input: { path: input.path, sha256: inputDigest },
      validation: emptyValidation(`INPUT_JSON_INVALID:${error.message}`),
    };
  }
  const validation = await validateDecisionPackage(packageValue, { root });
  return { input: { path: input.path, sha256: inputDigest }, validation };
}

export function renderReceipt(result, mode) {
  const validation = result.validation;
  return {
    schemaVersion: RECEIPT_SCHEMA,
    contractId: CONTRACT_ID,
    mode,
    input: result.input,
    validation: {
      status: validation.status,
      verdict: validation.verdict,
      errors: validation.errors,
      checks: validation.checks,
      stepsCompleted: validation.stepsCompleted,
    },
    inputArtifacts: validation.artifactInputs,
    ruleResults: validation.ruleResults,
    disposition: {
      decisionArtifactEligibility: validation.status === 'INVALID_PACKAGE' ? 'INELIGIBLE' : 'ELIGIBLE',
      eligibility: validation.status === 'VALID' && validation.verdict === 'GO'
        ? 'ELIGIBLE_FOR_DECISION_ARTIFACT_ONLY'
        : 'NOT_ELIGIBLE_FOR_DELIVERY',
      implementationEligible: false,
      deliveryEligible: false,
      runtimeDispatchEligible: false,
      implementationChildStatus: 'BLOCKED_NO_SEPARATE_DELIVERY_AUTHORIZATION',
    },
    noExternalActionAttestation: noExternalActionAttestation(),
  };
}

function usage() {
  process.stderr.write('Usage: node scripts/dry-run-go-no-go-decision.mjs --input <repository-relative-json> --offline\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const inputIndex = process.argv.indexOf('--input');
  const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
  if (!inputPath || !process.argv.includes('--offline')) {
    usage();
    process.exitCode = 2;
  } else {
    const result = await runDecisionValidator(inputPath);
    process.stdout.write(`${JSON.stringify(renderReceipt(result, 'OFFLINE_DRY_RUN'), null, 2)}\n`);
  }
}
