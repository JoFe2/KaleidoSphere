import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const KNOWLEDGE_ENVELOPE_SCHEMA_V1 = "chimpmaera.knowledge/envelope/v1";
export const KNOWLEDGE_TAXONOMY_SCHEMA_V1 = "chimpmaera.knowledge/taxonomy/v1";
export const KNOWLEDGE_SELECTION_SCHEMA_V1 = "chimpmaera.knowledge/selection/v1";
export const KNOWLEDGE_EXPLANATION_SCHEMA_V1 = "chimpmaera.hmi/knowledge-explanation/v1";
export const KNOWLEDGE_AUTHORITY_BOUNDARY_V1 = "READ_ONLY_KNOWLEDGE_NO_CREDENTIAL_POLICY_CAPABILITY_TOOL_WRITE_OR_EXECUTION_AUTHORITY";
const sha256 = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => record(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value) => typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
const unique = (value, predicate, min = 0, max = 32) => Array.isArray(value) && value.length >= min && value.length <= max && value.every(predicate) && new Set(value).size === value.length;
const text = (value, max = 512) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
const timestamp = (value) => Number.isSafeInteger(value) && value >= 0;
export function knowledgeTaxonomyDigestV1(value) {
    return sha256(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "taxonomyDigest")));
}
export function knowledgeEnvelopeDigestV1(value) {
    return sha256(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "envelopeDigest")));
}
export function validateKnowledgeTaxonomyV1(value) {
    if (!exact(value, ["schemaVersion", "taxonomyId", "generation", "priorGeneration", "kinds", "migrations", "compatibility", "taxonomyDigest"])
        || value.schemaVersion !== KNOWLEDGE_TAXONOMY_SCHEMA_V1 || !id(value.taxonomyId)
        || !Number.isSafeInteger(value.generation) || value.generation < 1
        || !(value.priorGeneration === null || Number.isSafeInteger(value.priorGeneration))
        || !unique(value.kinds, (item) => typeof item === "string" && /^[A-Z][A-Z0-9_]{1,47}$/.test(item), 6)
        || !Array.isArray(value.migrations) || !value.migrations.every((item) => exact(item, ["fromKind", "toKind"]) && value.kinds.includes(item.toKind))
        || value.compatibility !== "STRICT_ADDITIVE_OR_EXPLICIT_RENAME" || !digest(value.taxonomyDigest))
        return false;
    return knowledgeTaxonomyDigestV1(value) === value.taxonomyDigest;
}
export function migrateKnowledgeTaxonomyV1(prior, candidate) {
    const safe = validateKnowledgeTaxonomyV1(prior) && validateKnowledgeTaxonomyV1(candidate)
        && candidate.taxonomyId === prior.taxonomyId && candidate.generation === prior.generation + 1
        && candidate.priorGeneration === prior.generation
        && prior.kinds.every((kind) => candidate.kinds.includes(kind) || candidate.migrations.some((migration) => migration.fromKind === kind))
        && candidate.migrations.every((migration) => prior.kinds.includes(migration.fromKind) && migration.fromKind !== migration.toKind)
        && new Set(candidate.migrations.map((migration) => migration.fromKind)).size === candidate.migrations.length
        && new Set(candidate.migrations.map((migration) => migration.toKind)).size === candidate.migrations.length;
    return safe ? { outcome: "ACTIVATED", active: candidate, lastKnownGood: prior }
        : { outcome: "DENIED", active: prior, lastKnownGood: prior, reason: "UNSAFE_MIGRATION_DENIED" };
}
function authorityEmpty(value) {
    return exact(value, ["credentials", "policyApprovals", "capabilities", "toolAccess", "writeTargets", "executionRoutes"])
        && Object.values(value).every((item) => Array.isArray(item) && item.length === 0);
}
export function validateKnowledgeEnvelopeV1(value, taxonomy) {
    if (!validateKnowledgeTaxonomyV1(taxonomy) || !exact(value, ["schemaVersion", "envelopeId", "taxonomy", "scope", "kind", "statement", "attribution", "epistemicStatus", "trust", "freshness", "sensitivity", "permittedUses", "conflictsWith", "derivedFrom", "generationCandidate", "authority", "authorityBoundary", "envelopeDigest"]))
        return ["SCHEMA_DENIED"];
    if (value.authorityBoundary !== KNOWLEDGE_AUTHORITY_BOUNDARY_V1 || !authorityEmpty(value.authority))
        return ["AUTHORITY_DENIED"];
    if (value.schemaVersion !== KNOWLEDGE_ENVELOPE_SCHEMA_V1 || !id(value.envelopeId) || !exact(value.taxonomy, ["taxonomyId", "generation", "taxonomyDigest"])
        || !exact(value.scope, ["namespace", "audience"]) || !text(value.scope.namespace, 96) || !["PUBLIC_SYNTHETIC", "OWNER_PRIVATE"].includes(value.scope.audience)
        || !text(value.statement, 2048) || !["VERIFIED", "SUPPORTED", "UNVERIFIED", "DISPUTED", "UNRESOLVED"].includes(value.epistemicStatus)
        || !["LOW", "MEDIUM", "HIGH"].includes(value.trust) || !["PUBLIC", "INTERNAL", "RESTRICTED"].includes(value.sensitivity)
        || !exact(value.freshness, ["assessedAtMs", "staleAfterMs"]) || !timestamp(value.freshness.assessedAtMs) || !timestamp(value.freshness.staleAfterMs)
        || !unique(value.permittedUses, (item) => ["CURATED_READ", "EXPLORATORY_READ", "KNOWLEDGE_GENERATION_CANDIDATE"].includes(item), 1)
        || !unique(value.conflictsWith, id) || !unique(value.derivedFrom, id) || !["ACCEPTED", "NOT_CANDIDATE"].includes(value.generationCandidate)
        || !digest(value.envelopeDigest))
        return ["SCHEMA_DENIED"];
    if (value.taxonomy.taxonomyId !== taxonomy.taxonomyId || value.taxonomy.generation !== taxonomy.generation || value.taxonomy.taxonomyDigest !== taxonomy.taxonomyDigest)
        return ["TAXONOMY_MISMATCH_DENIED"];
    if (!taxonomy.kinds.includes(value.kind))
        return ["KIND_UNSUPPORTED"];
    if (!Array.isArray(value.attribution) || value.attribution.length < 1 || value.attribution.length > 16 || !value.attribution.every((source) => exact(source, ["sourceId", "citation", "sourceDigest", "observedAtMs", "licence"]) && id(source.sourceId) && text(source.citation, 512) && digest(source.sourceDigest) && timestamp(source.observedAtMs) && ["CC0-1.0", "CC-BY-4.0", "APACHE-2.0", "MIT", "OWNER_AUTHORIZED"].includes(source.licence)))
        return ["MISSING_EVIDENCE_DENIED"];
    if (value.conflictsWith.includes(value.envelopeId) || value.derivedFrom.includes(value.envelopeId))
        return ["CIRCULAR_DERIVATION_DENIED"];
    if (value.generationCandidate === "ACCEPTED" && !value.permittedUses.includes("KNOWLEDGE_GENERATION_CANDIDATE"))
        return ["USE_DENIED"];
    if (knowledgeEnvelopeDigestV1(value) !== value.envelopeDigest)
        return ["DIGEST_TAMPERED_DENIED"];
    return [];
}
const trustRank = { LOW: 0, MEDIUM: 1, HIGH: 2 };
export function selectKnowledgeV1(taxonomy, envelopes, policy) {
    if (!validateKnowledgeTaxonomyV1(taxonomy) || !timestamp(policy.evaluatedAtMs) || !Number.isSafeInteger(policy.maxResults) || policy.maxResults < 1 || policy.maxResults > 100
        || (policy.mode === "CURATED" && policy.allowUnresolvedExploratory))
        throw new Error("KNOWLEDGE_SELECTION_POLICY_DENIED");
    const selected = [];
    const rejected = [];
    const ordered = [...envelopes].sort((a, b) => a.envelopeId.localeCompare(b.envelopeId));
    const byId = new Map(ordered.map((item) => [item.envelopeId, item]));
    const cyclic = new Set();
    const visit = (start, current, seen) => {
        const envelope = byId.get(current);
        if (!envelope)
            return;
        for (const parent of envelope.derivedFrom) {
            if (parent === start)
                cyclic.add(start);
            else if (!seen.has(parent))
                visit(start, parent, new Set([...seen, parent]));
        }
    };
    for (const envelope of ordered)
        visit(envelope.envelopeId, envelope.envelopeId, new Set([envelope.envelopeId]));
    for (const envelope of ordered) {
        const reasons = [...validateKnowledgeEnvelopeV1(envelope, taxonomy)];
        if (envelope.derivedFrom.some((parent) => !byId.has(parent)))
            reasons.push("MISSING_EVIDENCE_DENIED");
        if (cyclic.has(envelope.envelopeId))
            reasons.push("CIRCULAR_DERIVATION_DENIED");
        if (envelope.scope.namespace !== policy.scopeNamespace)
            reasons.push("SCOPE_MISMATCH");
        if (!policy.allowedSensitivity.includes(envelope.sensitivity))
            reasons.push("SENSITIVITY_DENIED");
        if (envelope.attribution.some((source) => !policy.allowedLicences.includes(source.licence)))
            reasons.push("LICENSE_DENIED");
        if (trustRank[envelope.trust] < trustRank[policy.minimumTrust])
            reasons.push("TRUST_DENIED");
        if (envelope.freshness.staleAfterMs < policy.evaluatedAtMs)
            reasons.push("STALE_EVIDENCE_DENIED");
        const neededUse = policy.mode === "CURATED" ? "CURATED_READ" : "EXPLORATORY_READ";
        if (!envelope.permittedUses.includes(neededUse))
            reasons.push("USE_DENIED");
        if (policy.mode === "CURATED") {
            if (envelope.epistemicStatus === "UNVERIFIED")
                reasons.push("UNVERIFIED_DENIED");
            if (envelope.epistemicStatus === "UNRESOLVED")
                reasons.push("UNRESOLVED_DENIED");
            if (envelope.epistemicStatus === "DISPUTED" || envelope.conflictsWith.length > 0)
                reasons.push("CONFLICT_DENIED");
        }
        else if (["UNVERIFIED", "UNRESOLVED", "DISPUTED"].includes(envelope.epistemicStatus) && !policy.allowUnresolvedExploratory)
            reasons.push("UNRESOLVED_DENIED");
        const stableReasons = [...new Set(reasons)];
        if (stableReasons.length === 0 && selected.length < policy.maxResults)
            selected.push({ envelopeId: envelope.envelopeId, envelopeDigest: envelope.envelopeDigest, reason: policy.mode === "CURATED" ? "SELECTED_CURATED" : "SELECTED_EXPLORATORY" });
        else
            rejected.push({ envelopeId: envelope.envelopeId, envelopeDigest: envelope.envelopeDigest, reasons: stableReasons.length ? stableReasons : ["USE_DENIED"] });
    }
    const residualConflicts = ordered.filter((item) => item.conflictsWith.length > 0).map((item) => ({ envelopeId: item.envelopeId, conflictsWith: [...item.conflictsWith].sort() }));
    const unsigned = { schemaVersion: KNOWLEDGE_SELECTION_SCHEMA_V1, mode: policy.mode, scopeNamespace: policy.scopeNamespace, taxonomyId: taxonomy.taxonomyId, taxonomyGeneration: taxonomy.generation, taxonomyDigest: taxonomy.taxonomyDigest, selected, rejected, residualConflicts, authorityBoundary: KNOWLEDGE_AUTHORITY_BOUNDARY_V1 };
    return { ...unsigned, selectionDigest: sha256(unsigned) };
}
export function explainKnowledgeSelectionV1(selection, envelopes) {
    const byId = new Map(envelopes.map((item) => [item.envelopeId, item]));
    const explain = (item) => {
        const envelope = byId.get(item.envelopeId);
        if (!envelope || envelope.envelopeDigest !== item.envelopeDigest)
            throw new Error("KNOWLEDGE_EXPLANATION_BINDING_DENIED");
        return { envelopeId: envelope.envelopeId, envelopeDigest: envelope.envelopeDigest, kind: envelope.kind, epistemicStatus: envelope.epistemicStatus, citations: envelope.attribution.map((source) => ({ sourceId: source.sourceId, citation: source.citation, sourceDigest: source.sourceDigest })), rationale: item.reason ? [item.reason] : item.reasons, conflictsWith: envelope.conflictsWith };
    };
    return { schemaVersion: KNOWLEDGE_EXPLANATION_SCHEMA_V1, operation: "explain", readOnly: true, scopeNamespace: selection.scopeNamespace, taxonomy: { taxonomyId: selection.taxonomyId, generation: selection.taxonomyGeneration, taxonomyDigest: selection.taxonomyDigest }, generation: { selectionDigest: selection.selectionDigest }, selected: selection.selected.map(explain), rejected: selection.rejected.map(explain), residualConflicts: selection.residualConflicts, authority: { credentials: [], policyApprovals: [], capabilities: [], toolAccess: [], writeTargets: [], executionRoutes: [] }, authorityBoundary: KNOWLEDGE_AUTHORITY_BOUNDARY_V1 };
}
