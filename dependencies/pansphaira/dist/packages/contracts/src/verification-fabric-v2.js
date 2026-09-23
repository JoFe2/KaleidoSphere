import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const VERIFICATION_DAG_SCHEMA_V2 = "chimpmaera.verification/evidence-dag/v2";
export const VERIFICATION_IMPACT_PLAN_SCHEMA_V2 = "chimpmaera.verification/impact-plan/v2";
export const VERIFICATION_ATTESTATION_SCHEMA_V2 = "chimpmaera.verification/attestation/v2";
export const VERIFICATION_SHADOW_REPORT_SCHEMA_V2 = "chimpmaera.verification/shadow-report/v2";
export const DEFAULT_VERIFICATION_HARD_GATES_V2 = [
    "npm run lint",
    "npm run release-governance:verify",
    "npm run supply-chain:verify",
    "sha256sum -c SHA256SUMS",
    "./scripts/build-public-release.sh --output <isolated-absolute-path>",
];
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, required, optional = []) {
    if (!isRecord(value))
        return false;
    const actual = Object.keys(value);
    return required.every((key) => actual.includes(key))
        && actual.every((key) => required.includes(key) || optional.includes(key));
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isCommit(value) {
    return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}
function isIdentifier(value) {
    return typeof value === "string" && /^[a-z][a-z0-9-]{1,63}$/.test(value);
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 512;
}
function uniqueStrings(value, predicate = isNonEmptyString) {
    return Array.isArray(value) && value.every(predicate) && new Set(value).size === value.length;
}
export function isSafeRepositoryPathV2(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 512
        || value.startsWith("/") || value.includes("\\") || value.includes("\0")
        || value !== value.normalize("NFC"))
        return false;
    return value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}
function validInput(value) {
    const roles = [
        "SOURCE", "CONTRACT", "SCHEMA", "FIXTURE", "VALIDATOR", "TOOLCHAIN",
        "ENVIRONMENT", "SECURITY", "DERIVED_EVIDENCE",
    ];
    return exactKeys(value, ["path", "role", "sha256"], ["releaseId"])
        && (!Object.hasOwn(value, "releaseId") || isIdentifier(value.releaseId))
        && isSafeRepositoryPathV2(value.path)
        && roles.includes(value.role)
        && isDigest(value.sha256);
}
function validNodeShape(value) {
    if (!exactKeys(value, [
        "id", "dependsOn", "inputs", "ownedTests", "invariants", "riskClass", "globalInvalidation",
    ], ["evidenceTtlMs", "ttlJustification"]))
        return false;
    if (!isIdentifier(value.id) || !uniqueStrings(value.dependsOn, isIdentifier)
        || !Array.isArray(value.inputs) || value.inputs.length === 0 || !value.inputs.every(validInput)
        || new Set(value.inputs.map((input) => input.path)).size !== value.inputs.length
        || !uniqueStrings(value.ownedTests) || value.ownedTests.length === 0
        || !uniqueStrings(value.invariants) || value.invariants.length === 0
        || !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(value.riskClass)
        || typeof value.globalInvalidation !== "boolean")
        return false;
    const hasTtl = Object.hasOwn(value, "evidenceTtlMs") || Object.hasOwn(value, "ttlJustification");
    return !hasTtl || (Number.isSafeInteger(value.evidenceTtlMs) && value.evidenceTtlMs > 0
        && isNonEmptyString(value.ttlJustification));
}
function cycleOrUnknown(nodes) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    if (byId.size !== nodes.length)
        return true;
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => {
        if (visiting.has(id))
            return true;
        if (visited.has(id))
            return false;
        const node = byId.get(id);
        if (!node)
            return true;
        visiting.add(id);
        if (node.dependsOn.some((dependency) => !byId.has(dependency) || visit(dependency)))
            return true;
        visiting.delete(id);
        visited.add(id);
        return false;
    };
    return nodes.some((node) => visit(node.id));
}
export function validateVerificationDagV2(value) {
    if (!exactKeys(value, ["schemaVersion", "graphId", "graphVersion", "environment", "hardGates", "nodes"])
        || value.schemaVersion !== VERIFICATION_DAG_SCHEMA_V2 || !isIdentifier(value.graphId)
        || !Number.isSafeInteger(value.graphVersion) || value.graphVersion < 1
        || !exactKeys(value.environment, ["node", "os", "architecture", "packageManager"])
        || !Object.values(value.environment).every(isNonEmptyString)
        || !uniqueStrings(value.hardGates) || value.hardGates.length === 0
        || !Array.isArray(value.nodes) || value.nodes.length === 0 || !value.nodes.every(validNodeShape))
        return false;
    return !cycleOrUnknown(value.nodes);
}
export function verificationDagDigestV2(graph) {
    return digest(graph);
}
export function verificationNodeDigestV2(node) {
    return digest(node);
}
function finalizePlan(value) {
    return { ...value, planDigest: digest(value) };
}
function sortedUnique(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}
function fallbackPlan(args) {
    const nodes = isRecord(args.graph) && Array.isArray(args.graph.nodes)
        ? args.graph.nodes.filter(validNodeShape) : [];
    const hardGates = isRecord(args.graph) && uniqueStrings(args.graph.hardGates)
        ? args.graph.hardGates : [...DEFAULT_VERIFICATION_HARD_GATES_V2];
    return finalizePlan({
        schemaVersion: VERIFICATION_IMPACT_PLAN_SCHEMA_V2,
        mode: "FULL_FALLBACK",
        baseSha: isCommit(args.baseSha) ? args.baseSha : "0".repeat(40),
        headSha: isCommit(args.headSha) ? args.headSha : "0".repeat(40),
        graphDigest: digest(args.graph),
        changedPaths: sortedUnique(args.changedPaths.filter((path) => typeof path === "string")),
        selectedNodes: sortedUnique(nodes.map((node) => node.id)),
        selectedTests: sortedUnique(nodes.flatMap((node) => [...node.ownedTests])),
        hardGates: sortedUnique(hardGates),
        reasons: sortedUnique(args.reasons),
        authoritativeComparator: "npm test",
    });
}
export function buildVerificationImpactPlanV2(args) {
    const unsafe = args.changedPaths.some((path) => !isSafeRepositoryPathV2(path));
    if (unsafe)
        return fallbackPlan({ ...args, reasons: ["UNSAFE_PATH"] });
    if (!validateVerificationDagV2(args.graph) || !isCommit(args.baseSha) || !isCommit(args.headSha)
        || !isSafeRepositoryPathV2(args.graphPath)) {
        return fallbackPlan({ ...args, reasons: ["INVALID_GRAPH"] });
    }
    const graph = args.graph;
    const changedPaths = sortedUnique(args.changedPaths);
    if (changedPaths.includes(args.graphPath))
        return fallbackPlan({ ...args, reasons: ["GRAPH_CHANGED"] });
    const inputs = graph.nodes.flatMap((node) => node.inputs.map((input) => ({ node, input })));
    if (inputs.some(({ input }) => args.observedInputDigests[input.path] !== input.sha256)) {
        return fallbackPlan({ ...args, reasons: ["GRAPH_DRIFT"] });
    }
    const selected = new Set();
    for (const path of changedPaths) {
        const owners = inputs.filter(({ input }) => input.path === path);
        if (owners.length === 0)
            return fallbackPlan({ ...args, reasons: ["UNMAPPED_PATH"] });
        if (owners.length > 1)
            return fallbackPlan({ ...args, reasons: ["AMBIGUOUS_OWNERSHIP"] });
        const owner = owners[0];
        if (!owner)
            return fallbackPlan({ ...args, reasons: ["CLASSIFIER_FAILURE"] });
        if (owner.node.globalInvalidation || ["TOOLCHAIN", "ENVIRONMENT", "SECURITY"].includes(owner.input.role)) {
            return fallbackPlan({ ...args, reasons: ["CENTRAL_INPUT_CHANGED"] });
        }
        selected.add(owner.node.id);
    }
    let expanded = true;
    while (expanded) {
        expanded = false;
        for (const node of graph.nodes) {
            if (!selected.has(node.id) && node.dependsOn.some((dependency) => selected.has(dependency))) {
                selected.add(node.id);
                expanded = true;
            }
        }
    }
    const selectedNodes = graph.nodes.filter((node) => selected.has(node.id));
    return finalizePlan({
        schemaVersion: VERIFICATION_IMPACT_PLAN_SCHEMA_V2,
        mode: "IMPACTED_SHADOW",
        baseSha: args.baseSha,
        headSha: args.headSha,
        graphDigest: verificationDagDigestV2(graph),
        changedPaths,
        selectedNodes: sortedUnique(selectedNodes.map((node) => node.id)),
        selectedTests: sortedUnique(selectedNodes.flatMap((node) => [...node.ownedTests])),
        hardGates: sortedUnique(graph.hardGates),
        reasons: [],
        authoritativeComparator: "npm test",
    });
}
export function buildVerificationImpactPlanFailClosedV2(args, classifier = buildVerificationImpactPlanV2) {
    try {
        return classifier(args);
    }
    catch {
        return fallbackPlan({ ...args, reasons: ["CLASSIFIER_FAILURE"] });
    }
}
function validAttestation(value) {
    if (!exactKeys(value, [
        "schemaVersion", "nodeId", "nodeDigest", "graphDigest", "toolchainDigest", "environmentDigest",
        "createdAtMs", "testResults", "attestationDigest",
    ], ["expiresAtMs"]) || value.schemaVersion !== VERIFICATION_ATTESTATION_SCHEMA_V2
        || !isIdentifier(value.nodeId) || !isDigest(value.nodeDigest) || !isDigest(value.graphDigest)
        || !isDigest(value.toolchainDigest) || !isDigest(value.environmentDigest)
        || !Number.isSafeInteger(value.createdAtMs) || value.createdAtMs < 0
        || (Object.hasOwn(value, "expiresAtMs") && (!Number.isSafeInteger(value.expiresAtMs) || value.expiresAtMs < 0))
        || !Array.isArray(value.testResults) || value.testResults.length === 0 || !isDigest(value.attestationDigest))
        return false;
    return value.testResults.every((result) => exactKeys(result, ["test", "outcome"])
        && isNonEmptyString(result.test) && result.outcome === "PASS")
        && new Set(value.testResults.map((result) => result.test)).size === value.testResults.length;
}
export function verificationAttestationDigestV2(value) {
    return digest(value);
}
export function verifyPrototypeAttestationV2(args) {
    if (args.attestation === null || args.attestation === undefined) {
        return { outcome: "DENIED", authoritative: false, reasons: ["ATTESTATION_MISSING_DENIED"] };
    }
    if (!validAttestation(args.attestation)) {
        return { outcome: "DENIED", authoritative: false, reasons: ["ATTESTATION_SCHEMA_DENIED"] };
    }
    const attestation = args.attestation;
    const { attestationDigest: ignored, ...unsigned } = attestation;
    if (ignored !== digest(unsigned)) {
        return { outcome: "DENIED", authoritative: false, reasons: ["ATTESTATION_TAMPERED_DENIED"] };
    }
    if (attestation.expiresAtMs !== undefined && args.nowMs > attestation.expiresAtMs) {
        return { outcome: "DENIED", authoritative: false, reasons: ["ATTESTATION_STALE_DENIED"] };
    }
    const expectedExpiry = args.node.evidenceTtlMs === undefined
        ? undefined : attestation.createdAtMs + args.node.evidenceTtlMs;
    const exactTests = sortedUnique(attestation.testResults.map(({ test }) => test));
    if (attestation.nodeId !== args.node.id || attestation.nodeDigest !== verificationNodeDigestV2(args.node)
        || attestation.graphDigest !== args.graphDigest || attestation.toolchainDigest !== args.toolchainDigest
        || attestation.environmentDigest !== args.environmentDigest || attestation.expiresAtMs !== expectedExpiry
        || canonicalJson(exactTests) !== canonicalJson(sortedUnique(args.node.ownedTests))) {
        return { outcome: "DENIED", authoritative: false, reasons: ["ATTESTATION_MISMATCH_DENIED"] };
    }
    return { outcome: "REUSABLE_PROTOTYPE", authoritative: false };
}
export async function runVerificationShadowComparatorV2(plan, executeFullSuite) {
    let exitCode = 1;
    try {
        exitCode = await executeFullSuite();
    }
    catch {
        exitCode = 1;
    }
    return {
        schemaVersion: VERIFICATION_SHADOW_REPORT_SCHEMA_V2,
        status: exitCode === 0 ? "SHADOW_PASS" : "SHADOW_FAIL",
        activation: "BLOCKED_SAMPLE_GATE",
        plan,
        comparator: { command: "npm test", authoritative: true, executed: true, exitCode },
    };
}
