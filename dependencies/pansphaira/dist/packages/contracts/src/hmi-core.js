import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const HMI_GENERATION_SCHEMA_V1 = "chimpmaera.hmi/generation/v1";
export const HMI_CORE_VERSION_V1 = "1.0.0";
export const HMI_CONTRACT_VERSION_V1 = "1.0.0";
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
function isId(value) {
    return typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
}
function isIntegerBetween(value, minimum, maximum) {
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function isSafeRelativePath(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 240
        && value === value.normalize("NFC") && !value.startsWith("/") && !value.includes("\\")
        && !value.includes("\0") && !value.split("/").some((part) => ["", ".", ".."].includes(part));
}
function isUniqueStringArray(value, predicate) {
    return Array.isArray(value) && new Set(value).size === value.length && value.every(predicate);
}
function denied(reason) {
    return { outcome: "DENIED", reasonCodes: [reason] };
}
function normalizeJson(value) {
    if (typeof value === "string")
        return value.normalize("NFC");
    if (value === null || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new TypeError("HMI semantic normalization rejects non-finite numbers");
        return value;
    }
    if (Array.isArray(value))
        return value.map(normalizeJson);
    if (!isRecord(value))
        throw new TypeError("HMI semantic normalization accepts plain JSON values only");
    const normalizedEntries = Object.entries(value).map(([key, item]) => [key.normalize("NFC"), normalizeJson(item)]);
    if (new Set(normalizedEntries.map(([key]) => key)).size !== normalizedEntries.length) {
        throw new TypeError("HMI semantic normalization rejects Unicode-colliding object keys");
    }
    return Object.fromEntries(normalizedEntries);
}
export function normalizeHmiSemanticResultV1(value) {
    const canonicalBytes = canonicalJson(normalizeJson(value));
    return { canonicalBytes, responseDigest: sha256(canonicalBytes) };
}
export function hmiGenerationDigestV1(manifest) {
    if (!isRecord(manifest))
        throw new TypeError("INVALID_HMI_GENERATION_MANIFEST");
    const content = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "generationDigest"));
    return sha256(canonicalJson(content));
}
export function verifyHmiGenerationV1(value) {
    if (!exactKeys(value, ["manifest", "files"]) || !Array.isArray(value.files))
        return denied("HMI_SCHEMA_DENIED");
    const manifest = value.manifest;
    if (!exactKeys(manifest, [
        "schemaVersion", "generationId", "coreVersion", "contractVersion", "createdFrom", "provenance",
        "files", "capabilities", "validatorIds", "routes", "authority", "compatibility", "limits",
        "supersedes", "generationDigest",
    ]))
        return denied("HMI_SCHEMA_DENIED");
    if (manifest.schemaVersion !== HMI_GENERATION_SCHEMA_V1 || !isId(manifest.generationId)
        || !isDigest(manifest.generationDigest) || !(manifest.supersedes === null || isDigest(manifest.supersedes))) {
        return denied("HMI_SCHEMA_DENIED");
    }
    if (!exactKeys(manifest.createdFrom, ["sourceSetDigest", "generatorDigest", "schemaDigest"])
        || ![manifest.createdFrom.sourceSetDigest, manifest.createdFrom.generatorDigest, manifest.createdFrom.schemaDigest].every(isDigest)) {
        return denied("HMI_SCHEMA_DENIED");
    }
    if (!exactKeys(manifest.compatibility, ["coreVersion", "contractVersion", "evidenceStatus"])
        || manifest.coreVersion !== HMI_CORE_VERSION_V1 || manifest.contractVersion !== HMI_CONTRACT_VERSION_V1
        || manifest.compatibility.coreVersion !== HMI_CORE_VERSION_V1
        || manifest.compatibility.contractVersion !== HMI_CONTRACT_VERSION_V1
        || manifest.compatibility.evidenceStatus !== "LOCAL_SYNTHETIC")
        return denied("HMI_COMPATIBILITY_DENIED");
    if (!exactKeys(manifest.limits, ["maxReferences", "maxSourceBytes", "maxFindings", "maxOutputBytes"])
        || !isIntegerBetween(manifest.limits.maxReferences, 1, 4)
        || !isIntegerBetween(manifest.limits.maxSourceBytes, 1, 65_536)
        || !isIntegerBetween(manifest.limits.maxFindings, 1, 200)
        || !isIntegerBetween(manifest.limits.maxOutputBytes, 1, 16_384)) {
        return denied("HMI_SCHEMA_DENIED");
    }
    if (!Array.isArray(manifest.provenance) || manifest.provenance.length === 0)
        return denied("HMI_SCHEMA_DENIED");
    for (const source of manifest.provenance) {
        if (!exactKeys(source, ["sourceId", "relativeRef", "sourceDigest", "trustClass", "reviewStatus", "nonClaims"])
            || !isId(source.sourceId) || !isDigest(source.sourceDigest) || source.trustClass !== "PUBLIC_SYNTHETIC"
            || source.reviewStatus !== "REVIEWED_LOCAL_SYNTHETIC" || !isUniqueStringArray(source.nonClaims, (item) => typeof item === "string" && item.length > 0))
            return denied("HMI_SCHEMA_DENIED");
        if (!isSafeRelativePath(source.relativeRef))
            return denied("HMI_PATH_DENIED");
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0)
        return denied("HMI_SCHEMA_DENIED");
    const declaredPaths = new Set();
    const capabilityFileDigests = new Set();
    for (const file of manifest.files) {
        if (!exactKeys(file, ["path", "mediaType", "byteCount", "sha256", "role", "kind", "executable", "mutable"])) {
            return denied("HMI_SCHEMA_DENIED");
        }
        if (!isSafeRelativePath(file.path))
            return denied("HMI_PATH_DENIED");
        if (file.kind !== "REGULAR_FILE")
            return denied("HMI_FILE_KIND_DENIED");
        if (file.mutable !== false)
            return denied("HMI_MUTABLE_FILE_DENIED");
        if (file.executable !== false)
            return denied("HMI_EXECUTABLE_FILE_DENIED");
        if (!["application/json", "text/markdown"].includes(file.mediaType)
            || !isIntegerBetween(file.byteCount, 0, Number.MAX_SAFE_INTEGER) || !isDigest(file.sha256)
            || !["INDEX", "KNOWLEDGE", "CAPABILITY", "VALIDATOR", "NORMALIZATION"].includes(file.role)
            || declaredPaths.has(file.path))
            return denied("HMI_SCHEMA_DENIED");
        declaredPaths.add(file.path);
        if (file.role === "CAPABILITY")
            capabilityFileDigests.add(file.sha256);
    }
    if (!Array.isArray(manifest.capabilities))
        return denied("HMI_SCHEMA_DENIED");
    const capabilityIds = new Set();
    for (const capability of manifest.capabilities) {
        if (!exactKeys(capability, [
            "capabilityId", "descriptorDigest", "effectClass", "requestedRights", "routeId", "lifecycleState",
        ]) || !isId(capability.capabilityId) || !isDigest(capability.descriptorDigest)
            || !["DESCRIBE_ONLY", "PLAN_ONLY", "READ_ONLY_VALIDATE"].includes(capability.effectClass)
            || capability.lifecycleState !== "DESCRIBED_INACTIVE" || capabilityIds.has(capability.capabilityId)) {
            return denied("HMI_SCHEMA_DENIED");
        }
        if (!Array.isArray(capability.requestedRights) || capability.requestedRights.length !== 0 || capability.routeId !== null) {
            return denied("HMI_AUTHORITY_DENIED");
        }
        capabilityIds.add(capability.capabilityId);
    }
    if (capabilityIds.size !== capabilityFileDigests.size
        || [...manifest.capabilities].some((capability) => !capabilityFileDigests.has(capability.descriptorDigest))) {
        return denied("HMI_CAPABILITY_DENIED");
    }
    if (!isUniqueStringArray(manifest.validatorIds, isId))
        return denied("HMI_SCHEMA_DENIED");
    if (!Array.isArray(manifest.routes))
        return denied("HMI_SCHEMA_DENIED");
    if (!exactKeys(manifest.authority, [
        "requestedRights", "routeIds", "writeTargets", "networkRoutes", "externalDependencies",
    ]))
        return denied("HMI_SCHEMA_DENIED");
    const authorityArrays = [manifest.authority.requestedRights, manifest.authority.routeIds,
        manifest.authority.writeTargets, manifest.authority.networkRoutes, manifest.authority.externalDependencies];
    if (!authorityArrays.every(Array.isArray))
        return denied("HMI_SCHEMA_DENIED");
    if (manifest.routes.length !== 0 || authorityArrays.some((items) => items.length !== 0)) {
        return denied("HMI_AUTHORITY_DENIED");
    }
    if (hmiGenerationDigestV1(manifest) !== manifest.generationDigest) {
        return denied("HMI_GENERATION_DIGEST_DENIED");
    }
    const supplied = new Map();
    for (const file of value.files) {
        if (!exactKeys(file, ["path", "encoding", "content"]) || file.encoding !== "UTF8" || typeof file.content !== "string") {
            return denied("HMI_SCHEMA_DENIED");
        }
        if (!isSafeRelativePath(file.path))
            return denied("HMI_PATH_DENIED");
        if (supplied.has(file.path))
            return denied("HMI_FILE_SET_DENIED");
        supplied.set(file.path, file.content);
    }
    if (supplied.size !== declaredPaths.size || [...supplied.keys()].some((path) => !declaredPaths.has(path))) {
        return denied("HMI_FILE_SET_DENIED");
    }
    for (const file of manifest.files) {
        const content = supplied.get(file.path);
        if (content === undefined)
            return denied("HMI_FILE_SET_DENIED");
        if (Buffer.byteLength(content, "utf8") !== file.byteCount || sha256(content) !== file.sha256) {
            return denied("HMI_FILE_DIGEST_DENIED");
        }
    }
    return {
        outcome: "VERIFIED",
        reasonCodes: ["HMI_GENERATION_VERIFIED"],
        generationDigest: manifest.generationDigest,
        fileCount: manifest.files.length,
        rightsCount: 0,
        routeCount: 0,
        writeTargetCount: 0,
    };
}
