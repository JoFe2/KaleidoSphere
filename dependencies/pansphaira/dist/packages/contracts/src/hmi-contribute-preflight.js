import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { verifyHmiGenerationV1 } from "./hmi-core.js";
export const HMI_CONTRIBUTE_PREFLIGHT_SCHEMA_V1 = "chimpmaera.hmi/contribute-preflight/v1";
export const HMI_CONTRIBUTE_PREFLIGHT_CONTRACT_VERSION_V1 = "1.0.0";
const requiredPreflightReasons = [
    "CONTRIBUTION_CAPABILITY_ABSENT",
    "PUBLICATION_ROUTE_ABSENT",
];
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
export function validateHmiContributePreflightV1(bundle, mapping, value) {
    const generation = verifyHmiGenerationV1(bundle);
    if (generation.outcome !== "VERIFIED" || mapping.outcome !== "MAPPED") {
        return denied("HMI_CONTRIBUTE_BINDING_DENIED");
    }
    if (!exactKeys(value, [
        "schemaVersion", "operation", "requestDigest", "inputDigest", "generationDigest",
        "preparationStatus", "preflightReasons", "subjectCapabilityIds", "citedSourceIds",
        "evidenceStatus", "authority", "effects",
    ]) || value.schemaVersion !== HMI_CONTRIBUTE_PREFLIGHT_SCHEMA_V1) {
        return denied("HMI_CONTRIBUTE_SCHEMA_DENIED");
    }
    if (value.operation !== "contribute" || mapping.request.operation !== "contribute") {
        return denied("HMI_CONTRIBUTE_OPERATION_DENIED");
    }
    if (!isDigest(value.requestDigest) || value.requestDigest !== mapping.requestDigest
        || !isDigest(value.inputDigest) || mapping.request.inputDigest === null
        || value.inputDigest !== mapping.request.inputDigest
        || !isDigest(value.generationDigest) || value.generationDigest !== mapping.request.generationDigest
        || value.generationDigest !== generation.generationDigest) {
        return denied("HMI_CONTRIBUTE_BINDING_DENIED");
    }
    if (value.preparationStatus !== "PREPARATION_ONLY"
        || canonicalJson(value.preflightReasons) !== canonicalJson(requiredPreflightReasons)
        || value.evidenceStatus !== "LOCAL_SYNTHETIC") {
        return denied("HMI_CONTRIBUTE_PREPARATION_DENIED");
    }
    const subjectCapabilityIds = sortedUnique(value.subjectCapabilityIds, 0, 4);
    const mappedSelectors = [...mapping.request.selectors].sort();
    if (subjectCapabilityIds === null || subjectCapabilityIds.length !== 0
        || canonicalJson(subjectCapabilityIds) !== canonicalJson(mappedSelectors)) {
        return denied("HMI_CONTRIBUTE_SUBJECT_DENIED");
    }
    const citedSourceIds = sortedUnique(value.citedSourceIds, 1, mapping.request.limits.maxReferences);
    const generationSources = new Set(bundle.manifest.provenance.map((item) => item.sourceId));
    if (citedSourceIds === null || citedSourceIds.some((item) => !generationSources.has(item))) {
        return denied("HMI_CONTRIBUTE_CITATION_DENIED");
    }
    if (!exactKeys(value.authority, ["requestedRights", "routeIds", "writeTargets"])) {
        return denied("HMI_CONTRIBUTE_SCHEMA_DENIED");
    }
    const authorityLists = [value.authority.requestedRights, value.authority.routeIds, value.authority.writeTargets];
    if (!authorityLists.every(Array.isArray) || authorityLists.some((items) => items.length !== 0)) {
        return denied("HMI_CONTRIBUTE_AUTHORITY_DENIED");
    }
    if (!exactKeys(value.effects, ["submissionPerformed", "publicationPerformed"])) {
        return denied("HMI_CONTRIBUTE_SCHEMA_DENIED");
    }
    if (value.effects.submissionPerformed !== false || value.effects.publicationPerformed !== false) {
        return denied("HMI_CONTRIBUTE_EFFECT_DENIED");
    }
    const payload = {
        schemaVersion: HMI_CONTRIBUTE_PREFLIGHT_SCHEMA_V1,
        operation: "contribute",
        requestDigest: value.requestDigest,
        inputDigest: value.inputDigest,
        generationDigest: value.generationDigest,
        preparationStatus: "PREPARATION_ONLY",
        preflightReasons: ["CONTRIBUTION_CAPABILITY_ABSENT", "PUBLICATION_ROUTE_ABSENT"],
        subjectCapabilityIds,
        citedSourceIds,
        evidenceStatus: "LOCAL_SYNTHETIC",
        authority: { requestedRights: [], routeIds: [], writeTargets: [] },
        effects: { submissionPerformed: false, publicationPerformed: false },
    };
    const canonicalBytes = canonicalJson(payload);
    return { outcome: "ACCEPTED", payload, canonicalBytes, payloadDigest: sha256(canonicalBytes) };
}
