import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const HMI_DISCLOSURE_SCHEMA_V1 = "chimpmaera.hmi/disclosure/v1";
export const HMI_DISCLOSURE_CONTRACT_VERSION_V1 = "1.0.0";
export const HMI_DISCLOSURE_CLAIM_BOUNDARY_V1 = "LOCAL_SYNTHETIC_NOT_RELEASED_OR_PRODUCTION_READY";
const tierRank = {
    SUMMARY: 0,
    DETAIL: 1,
    EVIDENCE: 2,
};
const operations = new Set([
    "discover", "explain", "plan", "handoff", "validate", "contribute",
]);
const unsafeTextPatterns = [
    /(?:authorization\s*:\s*bearer|(?:api[\s_-]?key|password|secret|access[\s_-]?token)\s*[:=]\s*\S+)/iu,
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u,
    /(?:^|[\s"'(])\/(?:home|Users)\/[A-Za-z0-9._-]+(?:\/|$)/u,
    /[A-Za-z]:\\Users\\[^\s\\]+/u,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
    /https?:\/\/[^/\s:@]+:[^/\s@]+@/iu,
    /(?:session|job)[\s_-]?id\s*[:=]\s*\S+/iu,
    /(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})/u,
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
function isId(value) {
    return typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
}
function isTier(value) {
    return typeof value === "string" && Object.hasOwn(tierRank, value);
}
function isPublicSafeText(value) {
    return typeof value === "string" && value.length >= 1 && value.length <= 1_024
        && value === value.normalize("NFC") && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
        && !unsafeTextPatterns.some((pattern) => pattern.test(value));
}
function denied(reason) {
    return { outcome: "DENIED", reasonCodes: [reason] };
}
export function projectHmiDisclosureV1(mapping, value) {
    if (mapping.outcome !== "MAPPED")
        return denied("HMI_DISCLOSURE_BINDING_DENIED");
    if (!exactKeys(value, [
        "schemaVersion", "operation", "requestDigest", "generationDigest", "requestedTier", "maxItems", "items", "authority",
    ]))
        return denied("HMI_DISCLOSURE_SCHEMA_DENIED");
    if (value.schemaVersion !== HMI_DISCLOSURE_SCHEMA_V1)
        return denied("HMI_DISCLOSURE_SCHEMA_DENIED");
    if (typeof value.operation !== "string" || !operations.has(value.operation)) {
        return denied("HMI_DISCLOSURE_OPERATION_DENIED");
    }
    if (value.operation !== mapping.request.operation || !isDigest(value.requestDigest)
        || value.requestDigest !== mapping.requestDigest || !isDigest(value.generationDigest)
        || value.generationDigest !== mapping.request.generationDigest) {
        return denied("HMI_DISCLOSURE_BINDING_DENIED");
    }
    if (!isTier(value.requestedTier))
        return denied("HMI_DISCLOSURE_TIER_DENIED");
    if (!Number.isSafeInteger(value.maxItems) || value.maxItems < 1 || value.maxItems > 16
        || value.maxItems > mapping.request.limits.maxFindings
        || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 32
        || value.items.length > mapping.request.limits.maxFindings) {
        return denied("HMI_DISCLOSURE_LIMIT_DENIED");
    }
    if (!exactKeys(value.authority, ["requestedRights", "routeIds", "writeTargets"])) {
        return denied("HMI_DISCLOSURE_SCHEMA_DENIED");
    }
    const authorityLists = [value.authority.requestedRights, value.authority.routeIds, value.authority.writeTargets];
    if (!authorityLists.every(Array.isArray) || authorityLists.some((items) => items.length !== 0)) {
        return denied("HMI_DISCLOSURE_AUTHORITY_DENIED");
    }
    const itemIds = new Set();
    const sourceIds = new Set();
    const validatedItems = [];
    let totalBytes = 0;
    for (const item of value.items) {
        if (!exactKeys(item, ["itemId", "tier", "text", "sourceIds", "evidenceDigest", "contentClass", "claimStatus"])) {
            return denied("HMI_DISCLOSURE_SCHEMA_DENIED");
        }
        if (!isId(item.itemId) || itemIds.has(item.itemId) || !isTier(item.tier)) {
            return denied("HMI_DISCLOSURE_SCHEMA_DENIED");
        }
        if (item.contentClass !== "PUBLIC_SYNTHETIC" || item.claimStatus !== "LOCAL_SYNTHETIC"
            || !isPublicSafeText(item.text))
            return denied("HMI_DISCLOSURE_CONTENT_DENIED");
        if (!Array.isArray(item.sourceIds) || item.sourceIds.length > 8
            || new Set(item.sourceIds).size !== item.sourceIds.length || !item.sourceIds.every(isId)) {
            return denied("HMI_DISCLOSURE_PROVENANCE_DENIED");
        }
        if (item.tier === "EVIDENCE") {
            if (!isDigest(item.evidenceDigest) || item.sourceIds.length === 0) {
                return denied("HMI_DISCLOSURE_PROVENANCE_DENIED");
            }
        }
        else if (item.evidenceDigest !== null) {
            return denied("HMI_DISCLOSURE_PROVENANCE_DENIED");
        }
        for (const sourceId of item.sourceIds)
            sourceIds.add(sourceId);
        if (sourceIds.size > mapping.request.limits.maxReferences) {
            return denied("HMI_DISCLOSURE_LIMIT_DENIED");
        }
        totalBytes += Buffer.byteLength(item.text, "utf8");
        if (totalBytes > 16_384)
            return denied("HMI_DISCLOSURE_LIMIT_DENIED");
        itemIds.add(item.itemId);
        validatedItems.push({
            itemId: item.itemId,
            tier: item.tier,
            text: item.text,
            sourceIds: [...item.sourceIds],
            evidenceDigest: item.evidenceDigest,
            contentClass: "PUBLIC_SYNTHETIC",
            claimStatus: "LOCAL_SYNTHETIC",
        });
    }
    const ordered = validatedItems.sort((left, right) => tierRank[left.tier] - tierRank[right.tier] || (left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0));
    const included = ordered
        .filter((item) => tierRank[item.tier] <= tierRank[value.requestedTier])
        .slice(0, value.maxItems);
    const disclosure = {
        schemaVersion: HMI_DISCLOSURE_SCHEMA_V1,
        contractVersion: HMI_DISCLOSURE_CONTRACT_VERSION_V1,
        operation: value.operation,
        requestDigest: value.requestDigest,
        generationDigest: value.generationDigest,
        effectiveTier: value.requestedTier,
        items: included,
        omittedCount: validatedItems.length - included.length,
        authority: { requestedRights: [], routeIds: [], writeTargets: [] },
        claimBoundary: HMI_DISCLOSURE_CLAIM_BOUNDARY_V1,
    };
    const canonicalBytes = canonicalJson(disclosure);
    if (Buffer.byteLength(canonicalBytes, "utf8") > mapping.request.limits.maxOutputBytes) {
        return denied("HMI_DISCLOSURE_LIMIT_DENIED");
    }
    return {
        outcome: "PUBLISHED",
        disclosure,
        canonicalBytes,
        disclosureDigest: sha256(canonicalBytes),
    };
}
