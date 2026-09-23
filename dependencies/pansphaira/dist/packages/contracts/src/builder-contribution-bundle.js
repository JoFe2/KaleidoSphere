import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const BUILDER_CONTRIBUTION_INPUT_API_VERSION = "chimpmaera.builder/contribution-input/v1";
export const BUILDER_CONTRIBUTION_BUNDLE_API_VERSION = "chimpmaera.builder/contribution-bundle/v1";
const EXCLUDED_CLASSES = [
    "CREDENTIAL_OR_TOKEN",
    "PRIVATE_OR_ABSOLUTE_PATH",
    "RAW_PROMPT_OR_RUNTIME_RECEIPT",
    "CUSTOMER_OR_TENANT_DATA",
    "UNKNOWN_FIELD",
];
const UNSAFE_TEXT = [
    /(?:^|[\s"'=])(?:sk-[A-Za-z0-9_-]{12,}|gh[opusr]_[A-Za-z0-9]{12,}|hf_[A-Za-z0-9]{12,})/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:authorization|bearer)\s*[:=]\s*\S+/i,
    /(?:\/(?:home|mnt|var|etc)\/|[A-Za-z]:\\)/,
    /\b(?:rawPrompt|rawRuntimeReceipt|credentialValue|customerRecord|tenantPayload)\b/i,
];
function isRecord(value) {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, expected) {
    return isRecord(value)
        && canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function invalid() {
    throw new Error("BUILDER_CONTRIBUTION_BUNDLE_INVALID_DENIED");
}
function validDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function safeText(value) {
    return typeof value === "string"
        && value.length > 0
        && value.length <= 320
        && value === value.normalize("NFC")
        && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
        && !UNSAFE_TEXT.some((pattern) => pattern.test(value));
}
function safePublicPath(value) {
    return typeof value === "string"
        && value.length <= 200
        && /^(?:demo|docs|examples|packages|schemas|scripts|tests)\/[A-Za-z0-9._/-]+$/.test(value)
        && !value.split("/").some((part) => part === "" || part === "." || part === "..");
}
function uniqueSortedStrings(value, min, max) {
    if (!Array.isArray(value) || value.length < min || value.length > max
        || !value.every(safeText))
        return invalid();
    const result = [...value].sort((left, right) => left.localeCompare(right));
    if (new Set(result).size !== result.length)
        return invalid();
    return result;
}
function uniqueSortedObjects(value, min, max, key, parse) {
    if (!Array.isArray(value) || value.length < min || value.length > max)
        return invalid();
    const parsed = value.map(parse).sort((left, right) => String(left[key]).localeCompare(String(right[key])));
    if (new Set(parsed.map((entry) => entry[key])).size !== parsed.length)
        return invalid();
    return parsed;
}
function parseDependency(value) {
    if (!exactKeys(value, ["dependencyId", "status"])
        || typeof value.dependencyId !== "string"
        || !/^[A-Z]+-[0-9]+$/.test(value.dependencyId)
        || value.status !== "LOCALLY_VALIDATED")
        return invalid();
    return value;
}
function parseAcceptance(value) {
    if (!exactKeys(value, ["criterionId", "description", "status"])
        || typeof value.criterionId !== "string"
        || !/^[A-Z]+-[0-9]+-G[0-9]+$/.test(value.criterionId)
        || !safeText(value.description)
        || value.status !== "PASS")
        return invalid();
    return value;
}
function parseNegativeProbe(value) {
    if (!exactKeys(value, ["description", "probeId", "status"])
        || typeof value.probeId !== "string"
        || !/^[A-Z][A-Z0-9_]{2,63}$/.test(value.probeId)
        || !safeText(value.description)
        || value.status !== "PASS")
        return invalid();
    return value;
}
function parseEvidence(value) {
    if (!exactKeys(value, ["evidenceId", "sha256"])
        || typeof value.evidenceId !== "string"
        || !/^[A-Z]+-[0-9]+-E-G[0-9]+-[0-9]{8}$/.test(value.evidenceId)
        || !validDigest(value.sha256))
        return invalid();
    return value;
}
function parseSource(value) {
    if (!exactKeys(value, ["path", "sha256"])
        || !safePublicPath(value.path)
        || !validDigest(value.sha256))
        return invalid();
    return value;
}
function normalizeInput(value) {
    if (!exactKeys(value, [
        "acceptanceCriteria", "claimIds", "dependencies", "evidenceReferences",
        "issueId", "negativeProbes", "nonClaims", "nonScope", "recoverySteps",
        "schemaVersion", "scope", "sourceArtifacts",
    ])
        || value.schemaVersion !== BUILDER_CONTRIBUTION_INPUT_API_VERSION
        || typeof value.issueId !== "string"
        || !/^[A-Z]+-[0-9]+$/.test(value.issueId))
        return invalid();
    const claimIds = uniqueSortedStrings(value.claimIds, 1, 16);
    if (!claimIds.every((claimId) => new RegExp(`^${value.issueId}-G[0-9]+$`).test(claimId)))
        return invalid();
    return {
        issueId: value.issueId,
        claimIds,
        scope: uniqueSortedStrings(value.scope, 1, 16),
        nonScope: uniqueSortedStrings(value.nonScope, 1, 16),
        dependencies: uniqueSortedObjects(value.dependencies, 1, 32, "dependencyId", parseDependency),
        acceptanceCriteria: uniqueSortedObjects(value.acceptanceCriteria, 1, 16, "criterionId", parseAcceptance),
        negativeProbes: uniqueSortedObjects(value.negativeProbes, 1, 32, "probeId", parseNegativeProbe),
        evidenceReferences: uniqueSortedObjects(value.evidenceReferences, 1, 32, "evidenceId", parseEvidence),
        sourceArtifacts: uniqueSortedObjects(value.sourceArtifacts, 1, 64, "path", parseSource),
        recoverySteps: uniqueSortedStrings(value.recoverySteps, 1, 16),
        nonClaims: uniqueSortedStrings(value.nonClaims, 1, 16),
    };
}
export function buildBuilderContributionBundleV1(input) {
    const normalized = normalizeInput(input);
    const inputDigest = digest({
        schemaVersion: BUILDER_CONTRIBUTION_INPUT_API_VERSION,
        ...normalized,
    });
    const core = {
        schemaVersion: BUILDER_CONTRIBUTION_BUNDLE_API_VERSION,
        bundleId: `bundle:${digest({ issueId: normalized.issueId, inputDigest }).slice(0, 24)}`,
        ...normalized,
        dataClassification: "SYNTHETIC",
        contributionMode: "OPT_IN",
        publicationAuthorization: "ABSENT",
        deliveryStatus: "LOCALLY_VALIDATED",
        releaseStatus: "NOT_RELEASED",
        sanitization: {
            policyId: "chimpmaera.builder/contribution-allow-list/v1",
            excludedClasses: EXCLUDED_CLASSES,
        },
        inputDigest,
    };
    return { ...core, bundleDigest: digest(core) };
}
export function verifyBuilderContributionBundleV1(value) {
    if (!exactKeys(value, [
        "acceptanceCriteria", "bundleDigest", "bundleId", "claimIds", "contributionMode",
        "dataClassification", "deliveryStatus", "dependencies", "evidenceReferences",
        "inputDigest", "issueId", "negativeProbes", "nonClaims", "nonScope",
        "publicationAuthorization", "recoverySteps", "releaseStatus", "sanitization",
        "schemaVersion", "scope", "sourceArtifacts",
    ]))
        return invalid();
    const { bundleDigest, ...core } = value;
    if (value.schemaVersion !== BUILDER_CONTRIBUTION_BUNDLE_API_VERSION
        || typeof value.bundleId !== "string"
        || !/^bundle:[a-f0-9]{24}$/.test(value.bundleId)
        || value.dataClassification !== "SYNTHETIC"
        || value.contributionMode !== "OPT_IN"
        || value.publicationAuthorization !== "ABSENT"
        || value.deliveryStatus !== "LOCALLY_VALIDATED"
        || value.releaseStatus !== "NOT_RELEASED"
        || !validDigest(value.inputDigest)
        || !validDigest(bundleDigest)
        || digest(core) !== bundleDigest
        || !exactKeys(value.sanitization, ["excludedClasses", "policyId"])
        || value.sanitization.policyId !== "chimpmaera.builder/contribution-allow-list/v1"
        || canonicalJson(value.sanitization.excludedClasses) !== canonicalJson(EXCLUDED_CLASSES))
        return invalid();
    normalizeInput({
        schemaVersion: BUILDER_CONTRIBUTION_INPUT_API_VERSION,
        issueId: value.issueId,
        claimIds: value.claimIds,
        scope: value.scope,
        nonScope: value.nonScope,
        dependencies: value.dependencies,
        acceptanceCriteria: value.acceptanceCriteria,
        negativeProbes: value.negativeProbes,
        evidenceReferences: value.evidenceReferences,
        sourceArtifacts: value.sourceArtifacts,
        recoverySteps: value.recoverySteps,
        nonClaims: value.nonClaims,
    });
    return value;
}
