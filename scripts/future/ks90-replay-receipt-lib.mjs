export const RECEIPT_VERSION = 'ks90.current-head-presentation.v2';
export const RECEIPT_PATH = 'tests/fixtures/ks90-current-main-replay-receipt.json';
export const EXACT_BASE_SHA = 'eb200aa4c3bb206c4bec70a6b92b73a89453d55e';
export const ACCEPTED_DOCUMENT_HEAD_SHA = '173333384798d3a069a97b6cd489b6609238b302';
export const ISSUE = 'JoFe2/KaleidoSphere#90';
export const DISPOSITION = 'REJECTED_WITH_EVIDENCE';

// These are SHA-256 digests of the exact document bytes at the accepted
// document head. They are authority constants, not caller-authored values.
export const PACKET = Object.freeze([
  Object.freeze({
    path: 'docs/future/remote-connector/PRODUCT_BOUNDARY_THREAT_MODEL.md',
    role: 'released issue-89 DEFER/REJECT-NOW decision evidence referenced by the issue-90 disposition',
    sha256: '97ca82d288050233e50eac314e080afb43352b516bd4816e422f76eb18e604ce',
  }),
  Object.freeze({
    path: 'docs/future/remote-connector/IDENTITY_AUTHORITY_RECEIPTS.md',
    role: 'accepted issue-90 requirements and REJECTED_WITH_EVIDENCE disposition document',
    sha256: '8bcf41343763ef9c38ffbe7f51671d8e8c5ee52c415960138cde092c689fda30',
  }),
]);

export const REASONS = Object.freeze({
  structure_missing: 'structure_missing',
  invalid_constant: 'invalid_constant',
  presentation_context_missing: 'presentation_context_missing',
  presentation_context_mismatch: 'presentation_context_mismatch',
  packet_binding_mismatch: 'packet_binding_mismatch',
  packet_digest_set_mismatch: 'packet_digest_set_mismatch',
  live_material_present: 'live_material_present',
  signature_as_execution_authority: 'signature_as_execution_authority',
  execution_permission_claimed: 'execution_permission_claimed',
});

const LIVE_MATERIAL = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/,
  /\b(?:ghp|gho|ghs|ghr|ghu)_[A-Za-z0-9]{20,}\b/,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
}

export function canonicalSerialize(value) {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

function sameKeys(value, keys) {
  return isObject(value) &&
    Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function scanStrings(value, visit) {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) value.forEach((item) => scanStrings(item, visit));
  else if (isObject(value)) Object.values(value).forEach((item) => scanStrings(item, visit));
}

export function validateReceipt(receipt, ctx) {
  const failures = new Set();
  const fail = (reason) => failures.add(reason);

  if (!isObject(receipt)) {
    return { ok: false, failures: [REASONS.structure_missing] };
  }

  if (!sameKeys(receipt, ['receipt_version', 'status', 'presentation', 'packet', 'authority', 'nonclaims'])) {
    fail(REASONS.structure_missing);
  }
  if (receipt.receipt_version !== RECEIPT_VERSION || receipt.status !== DISPOSITION) {
    fail(REASONS.invalid_constant);
  }

  const presentation = receipt.presentation;
  if (!sameKeys(presentation, ['exact_base_sha', 'accepted_document_head_sha', 'issue', 'disposition'])) {
    fail(REASONS.structure_missing);
  } else if (
    presentation.exact_base_sha !== EXACT_BASE_SHA ||
    presentation.accepted_document_head_sha !== ACCEPTED_DOCUMENT_HEAD_SHA ||
    presentation.issue !== ISSUE ||
    presentation.disposition !== DISPOSITION
  ) {
    fail(REASONS.invalid_constant);
  }

  if (!Array.isArray(receipt.packet) || receipt.packet.length !== PACKET.length) {
    fail(REASONS.packet_binding_mismatch);
  } else {
    for (let i = 0; i < PACKET.length; i += 1) {
      const actual = receipt.packet[i];
      const expected = PACKET[i];
      if (!sameKeys(actual, ['path', 'role', 'sha256']) ||
          actual.path !== expected.path || actual.role !== expected.role || actual.sha256 !== expected.sha256) {
        fail(REASONS.packet_binding_mismatch);
      }
    }
  }

  const authority = receipt.authority;
  if (!sameKeys(authority, [
    'evidence_only', 'execution_permission_granted',
    'signature_is_execution_authority', 'receipt_is_command_or_permission',
  ])) {
    fail(REASONS.structure_missing);
  } else {
    if (authority.evidence_only !== true) fail(REASONS.invalid_constant);
    if (authority.signature_is_execution_authority !== false) fail(REASONS.signature_as_execution_authority);
    if (authority.execution_permission_granted !== false || authority.receipt_is_command_or_permission !== false) {
      fail(REASONS.execution_permission_claimed);
    }
  }

  if (!Array.isArray(receipt.nonclaims) ||
      !receipt.nonclaims.includes('no implementation, integration, execution, release, or closure permission')) {
    fail(REASONS.structure_missing);
  }

  const requiredContext = ['exactBaseSha', 'acceptedDocumentHeadSha', 'issue', 'disposition', 'packetDigests'];
  if (!sameKeys(ctx, requiredContext) || !isObject(ctx?.packetDigests)) {
    fail(REASONS.presentation_context_missing);
  } else {
    if (ctx.exactBaseSha !== EXACT_BASE_SHA ||
        ctx.acceptedDocumentHeadSha !== ACCEPTED_DOCUMENT_HEAD_SHA ||
        ctx.issue !== ISSUE || ctx.disposition !== DISPOSITION) {
      fail(REASONS.presentation_context_mismatch);
    }
    const expectedDigestKeys = PACKET.map(({ path }) => path);
    if (!sameKeys(ctx.packetDigests, expectedDigestKeys) ||
        PACKET.some(({ path, sha256 }) => ctx.packetDigests[path] !== sha256)) {
      fail(REASONS.packet_digest_set_mismatch);
    }
  }

  scanStrings(receipt, (value) => {
    if (LIVE_MATERIAL.some((pattern) => pattern.test(value))) fail(REASONS.live_material_present);
  });

  return { ok: failures.size === 0, failures: [...failures] };
}
