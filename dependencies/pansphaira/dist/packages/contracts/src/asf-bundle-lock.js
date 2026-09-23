/**
 * Pure canonical bundle and lock contract for one immutable content-addressed
 * skill generation with a finite capability pack reference.
 *
 * A bundle lock document binds one skill generation (content-addressed file
 * set) to a finite capability pack whose every reference is bound to an exact
 * catalogue entry. Verification is deterministic and fail-closed: parse,
 * canonicalize and verify all return an evidence-safe result union carrying a
 * closed reason-code set and a stable exit code.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const ASF_BUNDLE_LOCK_SCHEMA_V1 = "chimpmaera.asf/bundle-lock/v1";
export const ASF_BUNDLE_LOCK_INTEGRATION_RECEIPT_SCHEMA_V1 = "chimpmaera.asf/bundle-lock-integration-receipt/v1";
export const ASF_LOCK_VERSION_V1 = "1.0.0";
export const ASF_GENERATION_FORMAT_V1 = "OPENCLAW_SKILL";
export const ASF_GENERATION_ENTRYPOINT_V1 = "SKILL.md";
export const ASF_LIMITATIONS_V1 = [
    "CONTENT_ADDRESSED_GENERATION_ONLY",
    "DISCOVERY_OR_PRESENCE_IS_NOT_AUTHORITY",
    "FINITE_CAPABILITY_PACK_ONLY",
    "LOCAL_DETERMINISTIC_CONTRACT_ONLY",
    "NO_INSTALLATION_OR_ACTIVATION_AUTHORITY",
    "NO_LIVE_REGISTRY_OR_SIGNATURE_PROOF",
];
export const ASF_BUNDLE_LOCK_EXIT_CODES_V1 = Object.freeze({
    ASF_BUNDLE_LOCK_ACCEPTED: 0,
    INVALID_JSON_DENIED: 20,
    DUPLICATE_KEY_DENIED: 21,
    NONCANONICAL_ENCODING_DENIED: 22,
    SCHEMA_DENIED: 23,
    UNSUPPORTED_VERSION_DENIED: 24,
    MUTABLE_ALIAS_OR_RANGE_DENIED: 25,
    CATALOGUE_BINDING_MISSING_DENIED: 26,
    AUTHORITY_FIELD_MISSING_DENIED: 27,
    UNKNOWN_CAPABILITY_DENIED: 28,
    DIGEST_MISMATCH_DENIED: 29,
});
const EXACT_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const DIGEST = /^[a-f0-9]{64}$/;
const BUNDLE_ID = /^asfbundle:[a-z0-9][a-z0-9._-]{2,63}$/;
const SKILL_ID = /^skill:[a-z0-9][a-z0-9._-]{2,63}$/;
const CATALOG_ID = /^catalog:[a-z0-9][a-z0-9._-]{2,63}$/;
const PACK_ID = /^pack:[a-z0-9][a-z0-9._-]{2,63}$/;
const CAPABILITY_ID = /^capability:[a-z0-9][a-z0-9._-]{2,63}$/;
const FILE_PATH = /^[A-Za-z0-9._/-]+$/;
const UNRESOLVED = /(?:\$\{|{{|}}|<[^>]*>|latest|HEAD)/i;
const LOCAL_SOURCE_LOCATOR = /^local\+sha256:[a-f0-9]{64}$/;
const ASF_SOURCE_LOCATOR = /^asf-bundle\+sha256:[a-f0-9]{64}$/;
const FILE_MEDIA_TYPES = ["text/markdown", "application/json", "text/plain"];
const FILE_ROLES = ["ENTRYPOINT", "DOC", "CONFIG", "ASSET", "TEST_FIXTURE"];
const TOP_LEVEL_KEYS = ["authority", "bundleId", "capabilityCatalogue", "capabilityPack", "generation", "limitations", "lock", "schemaVersion"];
const INTEGRATION_RECEIPT_KEYS = [
    "bundleBytesSha256",
    "bundleDigest",
    "bundleId",
    "catalogDigest",
    "generationDigest",
    "lockIdentity",
    "packDigest",
    "receiptDigest",
    "rollback",
    "schemaVersion",
    "source",
];
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isDigest(value) {
    return typeof value === "string" && DIGEST.test(value);
}
function isExactVersion(value) {
    return typeof value === "string" && EXACT_VERSION.test(value);
}
function isValidId(value, pattern) {
    if (typeof value !== "string")
        return false;
    if (value.normalize("NFC") !== value)
        return false;
    if (UNRESOLVED.test(value))
        return false;
    return pattern.test(value);
}
function isValidPath(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 160)
        return false;
    if (value.normalize("NFC") !== value)
        return false;
    if (!FILE_PATH.test(value) || value.startsWith("/") || value.includes("\\"))
        return false;
    if (UNRESOLVED.test(value))
        return false;
    return !value.split("/").some((part) => part === "" || part === "." || part === "..");
}
function isUniqueNfc(ids) {
    return ids.length === new Set(ids.map((id) => id.normalize("NFC").toLowerCase())).size;
}
function validSource(value, locator) {
    return exactKeys(value, ["kind", "locator", "mutable"])
        && value.kind === "LOCAL_CONTENT"
        && value.mutable === false
        && typeof value.locator === "string"
        && locator.test(value.locator);
}
function validFile(value) {
    if (!exactKeys(value, ["mediaType", "path", "role", "sha256", "size"]))
        return false;
    if (!FILE_MEDIA_TYPES.includes(value.mediaType))
        return false;
    if (!FILE_ROLES.includes(value.role))
        return false;
    return isValidPath(value.path)
        && isDigest(value.sha256)
        && typeof value.size === "number"
        && Number.isSafeInteger(value.size)
        && !Object.is(value.size, -0)
        && value.size >= 0
        && value.size <= 131072;
}
function validFiles(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 64)
        return false;
    if (!value.every(validFile))
        return false;
    const files = value;
    if (!isUniqueNfc(files.map((file) => file.path)))
        return false;
    return files.some((file) => file.path === ASF_GENERATION_ENTRYPOINT_V1 && file.role === "ENTRYPOINT");
}
function validEntries(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 64)
        return false;
    if (!value.every((entry) => exactKeys(entry, ["capabilityId", "digest", "version"])
        && isValidId(entry.capabilityId, CAPABILITY_ID)
        && isExactVersion(entry.version)
        && isDigest(entry.digest)))
        return false;
    const entries = value;
    return isUniqueNfc(entries.map((entry) => entry.capabilityId));
}
function validReference(value) {
    if (!exactKeys(value, ["catalogueBinding", "capabilityId", "digest", "version"]))
        return false;
    if (!exactKeys(value.catalogueBinding, ["catalogDigest", "catalogId"]))
        return false;
    return isValidId(value.catalogueBinding.catalogId, CATALOG_ID)
        && isDigest(value.catalogueBinding.catalogDigest)
        && isValidId(value.capabilityId, CAPABILITY_ID)
        && isExactVersion(value.version)
        && isDigest(value.digest);
}
function validReferences(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 64)
        return false;
    if (!value.every(validReference))
        return false;
    const references = value;
    return isUniqueNfc(references.map((reference) => reference.capabilityId));
}
function validReferenceInputs(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 64)
        return false;
    if (!value.every((reference) => exactKeys(reference, ["capabilityId", "digest", "version"])
        && isValidId(reference.capabilityId, CAPABILITY_ID)
        && isExactVersion(reference.version)
        && isDigest(reference.digest)))
        return false;
    const references = value;
    return isUniqueNfc(references.map((reference) => reference.capabilityId));
}
function validAuthority(value) {
    return exactKeys(value, ["activation", "grantedCapabilities", "installation"])
        && value.activation === "NO_AUTHORITY"
        && value.installation === "NO_AUTHORITY"
        && Array.isArray(value.grantedCapabilities)
        && value.grantedCapabilities.length === 0;
}
function validLimitations(value) {
    if (!Array.isArray(value) || value.length !== ASF_LIMITATIONS_V1.length)
        return false;
    if (!value.every((item) => typeof item === "string"))
        return false;
    return canonicalJson([...value].sort()) === canonicalJson([...ASF_LIMITATIONS_V1].sort());
}
function validGenerationShape(value) {
    if (!exactKeys(value, ["content", "entrypoint", "format", "skillId", "source", "version"]))
        return false;
    if (value.entrypoint !== ASF_GENERATION_ENTRYPOINT_V1 || value.format !== ASF_GENERATION_FORMAT_V1)
        return false;
    if (!isExactVersion(value.version) || !isValidId(value.skillId, SKILL_ID))
        return false;
    if (!validSource(value.source, LOCAL_SOURCE_LOCATOR))
        return false;
    return exactKeys(value.content, ["files"]) && validFiles(value.content.files);
}
function validGeneration(value) {
    if (!exactKeys(value, ["content", "contentDigest", "entrypoint", "format", "skillId", "source", "version"]))
        return false;
    if (value.entrypoint !== ASF_GENERATION_ENTRYPOINT_V1 || value.format !== ASF_GENERATION_FORMAT_V1)
        return false;
    if (!isExactVersion(value.version) || !isValidId(value.skillId, SKILL_ID) || !isDigest(value.contentDigest))
        return false;
    if (!validSource(value.source, LOCAL_SOURCE_LOCATOR))
        return false;
    return exactKeys(value.content, ["files"]) && validFiles(value.content.files);
}
function validCatalogue(value) {
    if (!exactKeys(value, ["catalogDigest", "catalogId", "entries"]))
        return false;
    if (!isDigest(value.catalogDigest) || !isValidId(value.catalogId, CATALOG_ID))
        return false;
    return validEntries(value.entries);
}
function validPack(value) {
    if (!exactKeys(value, ["packDigest", "packId", "references"]))
        return false;
    if (!isDigest(value.packDigest) || !isValidId(value.packId, PACK_ID))
        return false;
    return validReferences(value.references);
}
function validLockShape(value) {
    if (!exactKeys(value, ["bundleBytesSha256", "bundleDigest", "bundleId", "catalogDigest", "generationDigest",
        "lockIdentity", "lockVersion", "packDigest", "rollback", "schemaVersion", "source"]))
        return false;
    if (value.lockVersion !== ASF_LOCK_VERSION_V1 || value.schemaVersion !== ASF_BUNDLE_LOCK_SCHEMA_V1)
        return false;
    if (!isDigest(value.bundleBytesSha256) || !isDigest(value.bundleDigest) || !isDigest(value.catalogDigest)
        || !isDigest(value.generationDigest) || !isDigest(value.lockIdentity) || !isDigest(value.packDigest))
        return false;
    if (!isValidId(value.bundleId, BUNDLE_ID))
        return false;
    if (!exactKeys(value.rollback, ["lkgLockIdentity", "mode"])
        || value.rollback.mode !== "RESTORE_EXACT_LOCK_OR_DENY"
        || !isDigest(value.rollback.lkgLockIdentity))
        return false;
    return validSource(value.source, ASF_SOURCE_LOCATOR);
}
function validRollback(value) {
    return exactKeys(value, ["lkgLockIdentity", "mode"])
        && value.mode === "RESTORE_EXACT_LOCK_OR_DENY"
        && isDigest(value.lkgLockIdentity);
}
function unescapeJsonString(text) {
    let out = "";
    for (let index = 0; index < text.length; index += 1) {
        const char = text.charAt(index);
        if (char !== "\\") {
            out += char;
            continue;
        }
        const next = text.charAt(index + 1);
        if (next === "u") {
            const code = Number.parseInt(text.slice(index + 2, index + 6), 16);
            out += Number.isFinite(code) ? String.fromCodePoint(code) : "u";
            index += 5;
            continue;
        }
        const simple = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        out += next === '"' || next === "\\" || next === "/" ? next : simple[next] ?? next;
        index += 1;
    }
    return out;
}
/** Deterministic raw-text scan that reports a duplicated object key. */
function hasDuplicateKey(raw) {
    const stack = [];
    let index = 0;
    while (index < raw.length) {
        const char = raw.charAt(index);
        if (char !== '"') {
            if (char === "{")
                stack.push(new Set());
            else if (char === "[")
                stack.push(null);
            else if (char === "}" || char === "]")
                stack.pop();
            index += 1;
            continue;
        }
        let cursor = index + 1;
        let text = "";
        while (cursor < raw.length) {
            const current = raw.charAt(cursor);
            if (current === "\\") {
                text += current + raw.charAt(cursor + 1);
                cursor += 2;
                continue;
            }
            if (current === '"')
                break;
            text += current;
            cursor += 1;
        }
        if (cursor >= raw.length)
            return false;
        index = cursor + 1;
        let lookahead = index;
        while (lookahead < raw.length && " \t\n\r".includes(raw.charAt(lookahead)))
            lookahead += 1;
        if (lookahead < raw.length && raw.charAt(lookahead) === ":") {
            const top = stack[stack.length - 1];
            if (top) {
                const key = unescapeJsonString(text);
                if (top.has(key))
                    return true;
                top.add(key);
            }
        }
    }
    return false;
}
/** Semantic preflight denial over a top-level-exact document. */
function preflightDenial(value) {
    const generation = isRecord(value.generation) ? value.generation : null;
    const lock = isRecord(value.lock) ? value.lock : null;
    const catalogue = isRecord(value.capabilityCatalogue) ? value.capabilityCatalogue : null;
    const pack = isRecord(value.capabilityPack) ? value.capabilityPack : null;
    const sources = [generation?.source, lock?.source].filter(isRecord);
    if (sources.some((source) => source.mutable === true))
        return "MUTABLE_ALIAS_OR_RANGE_DENIED";
    const locators = sources.map((source) => source.locator);
    if (locators.some((locator) => typeof locator === "string" && UNRESOLVED.test(locator))) {
        return "MUTABLE_ALIAS_OR_RANGE_DENIED";
    }
    const versionClaims = [generation?.version];
    if (Array.isArray(catalogue?.entries)) {
        for (const entry of catalogue.entries) {
            if (isRecord(entry))
                versionClaims.push(entry.version);
        }
    }
    if (Array.isArray(pack?.references)) {
        for (const reference of pack.references) {
            if (isRecord(reference))
                versionClaims.push(reference.version);
        }
    }
    if (versionClaims.some((claim) => typeof claim === "string" && !EXACT_VERSION.test(claim))) {
        return "MUTABLE_ALIAS_OR_RANGE_DENIED";
    }
    if (Array.isArray(pack?.references)) {
        for (const reference of pack.references) {
            if (isRecord(reference) && !("catalogueBinding" in reference))
                return "CATALOGUE_BINDING_MISSING_DENIED";
        }
    }
    if (!("authority" in value))
        return "AUTHORITY_FIELD_MISSING_DENIED";
    const entryIds = new Set();
    if (Array.isArray(catalogue?.entries)) {
        for (const entry of catalogue.entries) {
            if (isRecord(entry) && typeof entry.capabilityId === "string")
                entryIds.add(entry.capabilityId);
        }
    }
    if (entryIds.size > 0 && Array.isArray(pack?.references)) {
        for (const reference of pack.references) {
            if (isRecord(reference) && typeof reference.capabilityId === "string" && !entryIds.has(reference.capabilityId)) {
                return "UNKNOWN_CAPABILITY_DENIED";
            }
        }
    }
    return null;
}
function compareCanonical(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function normalizeDocument(document) {
    const files = [...document.generation.content.files].sort((left, right) => compareCanonical(left.path, right.path));
    const entries = [...document.capabilityCatalogue.entries].sort((left, right) => compareCanonical(left.capabilityId, right.capabilityId));
    const references = [...document.capabilityPack.references].sort((left, right) => compareCanonical(left.capabilityId, right.capabilityId));
    return {
        ...document,
        generation: { ...document.generation, content: { files } },
        capabilityCatalogue: { ...document.capabilityCatalogue, entries },
        capabilityPack: { ...document.capabilityPack, references },
        limitations: [...document.limitations].sort(),
    };
}
function lockIdentityCore(lock) {
    return {
        bundleBytesSha256: lock.bundleBytesSha256,
        bundleDigest: lock.bundleDigest,
        bundleId: lock.bundleId,
        catalogDigest: lock.catalogDigest,
        generationDigest: lock.generationDigest,
        lockVersion: lock.lockVersion,
        packDigest: lock.packDigest,
        schemaVersion: ASF_BUNDLE_LOCK_SCHEMA_V1,
    };
}
function boundReferences(references, catalog) {
    return references.map((reference) => ({
        catalogueBinding: { catalogDigest: catalog.catalogDigest, catalogId: catalog.catalogId },
        capabilityId: reference.capabilityId,
        digest: reference.digest,
        version: reference.version,
    }));
}
export function asfBundleLockDigestV1(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function asfBundleLockIntegrationReceiptDigestV1(value) {
    const core = { ...value };
    delete core.receiptDigest;
    return asfBundleLockDigestV1(core);
}
/** Validates a standalone bounded bundle-lock decision receipt. */
export function validateAsfBundleLockIntegrationReceiptV1(value) {
    if (!exactKeys(value, INTEGRATION_RECEIPT_KEYS))
        return false;
    if (value.schemaVersion !== ASF_BUNDLE_LOCK_INTEGRATION_RECEIPT_SCHEMA_V1
        || !isDigest(value.bundleBytesSha256)
        || !isDigest(value.bundleDigest)
        || !isValidId(value.bundleId, BUNDLE_ID)
        || !isDigest(value.catalogDigest)
        || !isDigest(value.generationDigest)
        || !isDigest(value.lockIdentity)
        || !isDigest(value.packDigest)
        || !isDigest(value.receiptDigest)
        || !validRollback(value.rollback)
        || !validSource(value.source, ASF_SOURCE_LOCATOR))
        return false;
    return asfBundleLockIntegrationReceiptDigestV1(value) === value.receiptDigest;
}
function invalid() {
    throw new Error("ASF_BUNDLE_LOCK_CONTRACT_INVALID_DENIED");
}
function validCore(core) {
    const record = core;
    if (!exactKeys(record, ["authority", "bundleId", "capabilityCatalogue", "capabilityPack", "generation", "limitations"])) {
        return false;
    }
    if (!isValidId(record.bundleId, BUNDLE_ID))
        return false;
    if (!validGenerationShape(record.generation))
        return false;
    const catalogue = record.capabilityCatalogue;
    if (!exactKeys(catalogue, ["catalogId", "entries"]) || !isValidId(catalogue.catalogId, CATALOG_ID))
        return false;
    if (!validEntries(catalogue.entries))
        return false;
    const pack = record.capabilityPack;
    if (!exactKeys(pack, ["packId", "references"]) || !isValidId(pack.packId, PACK_ID))
        return false;
    if (!validReferenceInputs(pack.references))
        return false;
    return validAuthority(record.authority) && validLimitations(record.limitations);
}
/**
 * Builds one complete, self-digested bundle lock document from a semantic
 * core. Every reference must bind to an exact catalogue entry (id, version
 * and digest); anything else throws ASF_BUNDLE_LOCK_CONTRACT_INVALID_DENIED.
 */
export function buildAsfBundleLockDocumentV1(core) {
    if (!validCore(core))
        invalid();
    const { bundleId, generation, capabilityCatalogue, capabilityPack } = core;
    const files = [...generation.content.files].sort((left, right) => compareCanonical(left.path, right.path));
    const entries = [...capabilityCatalogue.entries].sort((left, right) => compareCanonical(left.capabilityId, right.capabilityId));
    const references = [...capabilityPack.references].sort((left, right) => compareCanonical(left.capabilityId, right.capabilityId));
    const limitations = [...core.limitations].sort();
    const entryMap = new Map(entries.map((entry) => [entry.capabilityId, entry]));
    for (const reference of references) {
        const bound = entryMap.get(reference.capabilityId);
        if (bound === undefined || bound.version !== reference.version || bound.digest !== reference.digest) {
            invalid();
        }
    }
    const content = { files };
    const contentDigest = asfBundleLockDigestV1(content);
    const catalogDigest = asfBundleLockDigestV1(entries);
    const bound = boundReferences(references, { catalogDigest, catalogId: capabilityCatalogue.catalogId });
    const packDigest = asfBundleLockDigestV1(bound);
    const unsigned = {
        authority: core.authority,
        bundleId,
        capabilityCatalogue: { catalogDigest, catalogId: capabilityCatalogue.catalogId, entries },
        capabilityPack: { packDigest, packId: capabilityPack.packId, references: bound },
        generation: {
            content,
            contentDigest,
            entrypoint: generation.entrypoint,
            format: generation.format,
            skillId: generation.skillId,
            source: generation.source,
            version: generation.version,
        },
        limitations,
        schemaVersion: ASF_BUNDLE_LOCK_SCHEMA_V1,
    };
    const bundleDigest = asfBundleLockDigestV1(unsigned);
    const lock = {
        bundleBytesSha256: bundleDigest,
        bundleDigest,
        bundleId,
        catalogDigest,
        generationDigest: contentDigest,
        lockIdentity: asfBundleLockDigestV1({
            bundleBytesSha256: bundleDigest,
            bundleDigest,
            bundleId,
            catalogDigest,
            generationDigest: contentDigest,
            lockVersion: ASF_LOCK_VERSION_V1,
            packDigest,
            schemaVersion: ASF_BUNDLE_LOCK_SCHEMA_V1,
        }),
        lockVersion: ASF_LOCK_VERSION_V1,
        packDigest,
        rollback: { lkgLockIdentity: asfBundleLockDigestV1({
                bundleBytesSha256: bundleDigest,
                bundleDigest,
                bundleId,
                catalogDigest,
                generationDigest: contentDigest,
                lockVersion: ASF_LOCK_VERSION_V1,
                packDigest,
                schemaVersion: ASF_BUNDLE_LOCK_SCHEMA_V1,
            }), mode: "RESTORE_EXACT_LOCK_OR_DENY" },
        schemaVersion: ASF_BUNDLE_LOCK_SCHEMA_V1,
        source: {
            kind: "LOCAL_CONTENT",
            locator: `asf-bundle+sha256:${asfBundleLockDigestV1({
                bundleBytesSha256: bundleDigest,
                bundleDigest,
                bundleId,
                catalogDigest,
                generationDigest: contentDigest,
                lockVersion: ASF_LOCK_VERSION_V1,
                packDigest,
                schemaVersion: ASF_BUNDLE_LOCK_SCHEMA_V1,
            })}`,
            mutable: false,
        },
    };
    const document = { ...unsigned, lock };
    return document;
}
function denyResult(reason) {
    return { outcome: "DENIED", reasonCodes: [reason], exitCode: ASF_BUNDLE_LOCK_EXIT_CODES_V1[reason] };
}
function verifyCore(value) {
    const deny = (reason) => ({ result: denyResult(reason), normalized: null });
    if (!isRecord(value))
        return deny("SCHEMA_DENIED");
    if (!("authority" in value))
        return deny("AUTHORITY_FIELD_MISSING_DENIED");
    if (!exactKeys(value, TOP_LEVEL_KEYS)) {
        const version = value.schemaVersion;
        if (typeof version === "string" && version !== ASF_BUNDLE_LOCK_SCHEMA_V1) {
            return deny("UNSUPPORTED_VERSION_DENIED");
        }
        return deny("SCHEMA_DENIED");
    }
    if (value.schemaVersion !== ASF_BUNDLE_LOCK_SCHEMA_V1)
        return deny("UNSUPPORTED_VERSION_DENIED");
    const preflight = preflightDenial(value);
    if (preflight)
        return deny(preflight);
    if (!validGeneration(value.generation) || !validCatalogue(value.capabilityCatalogue)
        || !validPack(value.capabilityPack) || !validAuthority(value.authority)
        || !validLimitations(value.limitations) || !validLockShape(value.lock)) {
        return deny("SCHEMA_DENIED");
    }
    const normalized = normalizeDocument(value);
    const contentDigest = asfBundleLockDigestV1(normalized.generation.content);
    const catalogDigest = asfBundleLockDigestV1(normalized.capabilityCatalogue.entries);
    const packDigest = asfBundleLockDigestV1(normalized.capabilityPack.references);
    const unsigned = Object.fromEntries(Object.entries(normalized).filter(([key]) => key !== "lock"));
    const bundleDigest = asfBundleLockDigestV1(unsigned);
    const lockIdentity = asfBundleLockDigestV1(lockIdentityCore(normalized.lock));
    const lock = normalized.lock;
    if (normalized.generation.contentDigest !== contentDigest
        || normalized.capabilityCatalogue.catalogDigest !== catalogDigest
        || normalized.capabilityPack.packDigest !== packDigest
        || lock.generationDigest !== contentDigest
        || lock.catalogDigest !== catalogDigest
        || lock.packDigest !== packDigest
        || lock.bundleId !== normalized.bundleId
        || lock.bundleDigest !== bundleDigest
        || lock.bundleBytesSha256 !== bundleDigest
        || lock.lockIdentity !== lockIdentity
        || lock.rollback.lkgLockIdentity !== lockIdentity
        || lock.source.locator !== `asf-bundle+sha256:${lockIdentity}`) {
        return deny("DIGEST_MISMATCH_DENIED");
    }
    const entryMap = new Map(normalized.capabilityCatalogue.entries.map((entry) => [entry.capabilityId, entry]));
    for (const reference of normalized.capabilityPack.references) {
        const entry = entryMap.get(reference.capabilityId);
        if (entry === undefined
            || entry.version !== reference.version
            || entry.digest !== reference.digest
            || reference.catalogueBinding.catalogId !== normalized.capabilityCatalogue.catalogId
            || reference.catalogueBinding.catalogDigest !== catalogDigest) {
            return deny("DIGEST_MISMATCH_DENIED");
        }
    }
    const rendered = canonicalJson(normalized);
    const projection = {
        bundleId: normalized.bundleId,
        bundleDigest,
        capabilityIds: normalized.capabilityPack.references.map((reference) => reference.capabilityId),
        catalogId: normalized.capabilityCatalogue.catalogId,
        catalogDigest,
        catalogueEntries: normalized.capabilityCatalogue.entries.length,
        contentDigest,
        generationVersion: normalized.generation.version,
        lockIdentity,
        packId: normalized.capabilityPack.packId,
        packDigest,
        packReferences: normalized.capabilityPack.references.length,
        skillId: normalized.generation.skillId,
    };
    const receiptCore = {
        bundleBytesSha256: lock.bundleBytesSha256,
        bundleDigest,
        bundleId: normalized.bundleId,
        catalogDigest,
        generationDigest: contentDigest,
        lockIdentity,
        packDigest,
        rollback: lock.rollback,
        schemaVersion: ASF_BUNDLE_LOCK_INTEGRATION_RECEIPT_SCHEMA_V1,
        source: lock.source,
    };
    const receipt = Object.freeze({
        ...receiptCore,
        receiptDigest: asfBundleLockIntegrationReceiptDigestV1(receiptCore),
    });
    return {
        result: {
            outcome: "ACCEPTED",
            reasonCodes: ["ASF_BUNDLE_LOCK_ACCEPTED"],
            exitCode: 0,
            canonicalJson: rendered,
            bundleDigest,
            lockIdentity,
            projection,
            receipt,
            receiptDigest: receipt.receiptDigest,
            receiptJson: canonicalJson(receipt),
        },
        normalized,
    };
}
/**
 * Verifies a complete bundle lock document value (key order independent).
 * Acceptance requires every declared digest to match the recomputed
 * canonical digests.
 */
export function verifyAsfBundleLockV1(value) {
    return verifyCore(value).result;
}
/**
 * Canonicalizes one semantic core (key order and list order independent) into
 * the deterministic accepted result: canonical bytes, bundle digest and lock
 * identity. Invalid cores deny with SCHEMA_DENIED.
 */
export function canonicalizeAsfBundleLockV1(core) {
    let document;
    try {
        document = buildAsfBundleLockDocumentV1(core);
    }
    catch {
        return denyResult("SCHEMA_DENIED");
    }
    return verifyCore(document).result;
}
/**
 * Parses raw bundle lock bytes. Fail-closed precedence: duplicated object
 * key, JSON validity, semantic verification, then byte-exact canonical
 * encoding. Accepted input must be byte-identical to the canonical form.
 */
export function parseAsfBundleLockV1(raw) {
    if (typeof raw !== "string")
        return denyResult("INVALID_JSON_DENIED");
    if (hasDuplicateKey(raw))
        return denyResult("DUPLICATE_KEY_DENIED");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return denyResult("INVALID_JSON_DENIED");
    }
    const { result, normalized } = verifyCore(parsed);
    if (result.outcome !== "ACCEPTED" || normalized === null)
        return result;
    if (raw !== canonicalJson(normalized))
        return denyResult("NONCANONICAL_ENCODING_DENIED");
    return result;
}
