import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { verifyHmiGenerationV1 } from "./hmi-core.js";
export const HMI_EXPLAIN_PAYLOAD_SCHEMA_V1 = "chimpmaera.hmi/explain-payload/v1";
export const HMI_EXPLAIN_PAYLOAD_CONTRACT_VERSION_V1 = "1.0.0";
function sha256(bytes) {
    return createHash("sha256").update(bytes, "utf8").digest("hex");
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isContractId(value) {
    return typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
}
function sortedUnique(value, minimum, maximum) {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum
        || !value.every(isContractId) || new Set(value).size !== value.length)
        return null;
    return [...value].sort();
}
function denied(reason) {
    return { outcome: "DENIED", reasonCodes: [reason] };
}
export function validateHmiExplainPayloadV1(bundle, mapping, value) {
    const generation = verifyHmiGenerationV1(bundle);
    if (generation.outcome !== "VERIFIED" || mapping.outcome !== "MAPPED") {
        return denied("HMI_EXPLAIN_BINDING_DENIED");
    }
    if (!exactKeys(value, [
        "schemaVersion", "operation", "requestDigest", "generationDigest", "subjectCapabilityIds",
        "citedSourceIds", "citationPolicy", "evidenceStatus", "authority",
    ]) || value.schemaVersion !== HMI_EXPLAIN_PAYLOAD_SCHEMA_V1) {
        return denied("HMI_EXPLAIN_SCHEMA_DENIED");
    }
    if (value.operation !== "explain" || mapping.request.operation !== "explain") {
        return denied("HMI_EXPLAIN_OPERATION_DENIED");
    }
    if (!isDigest(value.requestDigest) || value.requestDigest !== mapping.requestDigest
        || !isDigest(value.generationDigest) || value.generationDigest !== mapping.request.generationDigest
        || value.generationDigest !== generation.generationDigest) {
        return denied("HMI_EXPLAIN_BINDING_DENIED");
    }
    if (value.citationPolicy !== "CITATIONS_REQUIRED" || value.evidenceStatus !== "LOCAL_SYNTHETIC") {
        return denied("HMI_EXPLAIN_CITATION_DENIED");
    }
    const subjectCapabilityIds = sortedUnique(value.subjectCapabilityIds, 0, 4);
    const mappedSelectors = [...mapping.request.selectors].sort();
    const generationCapabilities = new Set(bundle.manifest.capabilities.map((item) => item.capabilityId));
    if (subjectCapabilityIds === null
        || canonicalJson(subjectCapabilityIds) !== canonicalJson(mappedSelectors)
        || subjectCapabilityIds.some((item) => !generationCapabilities.has(item))) {
        return denied("HMI_EXPLAIN_SUBJECT_DENIED");
    }
    const citedSourceIds = sortedUnique(value.citedSourceIds, 1, mapping.request.limits.maxReferences);
    const generationSources = new Set(bundle.manifest.provenance.map((item) => item.sourceId));
    if (citedSourceIds === null || citedSourceIds.some((item) => !generationSources.has(item))) {
        return denied("HMI_EXPLAIN_CITATION_DENIED");
    }
    if (!exactKeys(value.authority, ["requestedRights", "routeIds", "writeTargets"])) {
        return denied("HMI_EXPLAIN_SCHEMA_DENIED");
    }
    const authorityLists = [value.authority.requestedRights, value.authority.routeIds, value.authority.writeTargets];
    if (!authorityLists.every(Array.isArray) || authorityLists.some((items) => items.length !== 0)) {
        return denied("HMI_EXPLAIN_AUTHORITY_DENIED");
    }
    const payload = {
        schemaVersion: HMI_EXPLAIN_PAYLOAD_SCHEMA_V1,
        operation: "explain",
        requestDigest: value.requestDigest,
        generationDigest: value.generationDigest,
        subjectCapabilityIds,
        citedSourceIds,
        citationPolicy: "CITATIONS_REQUIRED",
        evidenceStatus: "LOCAL_SYNTHETIC",
        authority: { requestedRights: [], routeIds: [], writeTargets: [] },
    };
    const canonicalBytes = canonicalJson(payload);
    return { outcome: "ACCEPTED", payload, canonicalBytes, payloadDigest: sha256(canonicalBytes) };
}
