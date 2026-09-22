import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { VERIFICATION_FABRIC_BUNDLE_SCHEMA_V1 } from "./verification-fabric.js";
export const ANALYTICS_PROJECTION_SCHEMA_V1 = "chimpmaera.analytics/v1";
export const ANALYTICS_PROJECTION_VERSION_V1 = "1.0.0";
const EXPECTED_LANE_SELECTION = {
    defaultLane: "SQL_ADLS_FABRIC_IMPORT",
    fallbackLane: "DATAVERSE_IMPORT",
    directQueryAllowed: false,
    directQueryJustificationRequired: true,
    directQueryEvidenceMeasurements: [],
};
const EXPECTED_LINEAGE = {
    sourceSystem: "CHIMPMAERA_VERIFICATION_FABRIC",
    sourceContractSchemaVersion: VERIFICATION_FABRIC_BUNDLE_SCHEMA_V1,
    sourceContractDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    lineageComplete: true,
};
const EXPECTED_RECEIPT_REFERENCE = {
    receiptSchemaVersion: "chimpmaera.connector/power-platform-read/v1",
    receiptOperationKey: "GET_RECEIPT",
    receiptDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};
const EXPECTED_TIMESTAMPS = {
    projectedAt: "2026-08-04T00:00:00Z",
    sourceValidatedAt: "2026-08-04T00:00:00Z",
    schemaFrozenAt: "2026-08-04T00:00:00Z",
};
const EXPECTED_FIELD_CLASSIFICATION = [
    { fieldName: "projectionId", classification: "PUBLIC", redaction: "NONE" },
    { fieldName: "schemaVersion", classification: "PUBLIC", redaction: "NONE" },
    { fieldName: "contractVersion", classification: "PUBLIC", redaction: "NONE" },
    { fieldName: "evidenceClass", classification: "PUBLIC", redaction: "NONE" },
    { fieldName: "laneSelection", classification: "INTERNAL", redaction: "NONE" },
    { fieldName: "lineage", classification: "INTERNAL", redaction: "HASHED" },
    { fieldName: "receiptReference", classification: "INTERNAL", redaction: "HASHED" },
    { fieldName: "timestamps", classification: "INTERNAL", redaction: "NONE" },
];
const EXPECTED_REDACTION_POLICY = {
    excludedFields: ["rawEvidence", "secrets", "credentials", "policyState", "mutablePolicy"],
    hashedFields: ["sourceContractDigest", "receiptDigest"],
    rawEvidenceIncluded: false,
};
const EXPECTED_AUTHORITY_BOUNDARY = {
    authoritativePlane: false,
    policyPlane: false,
    approvalPlane: false,
    actionPlane: false,
    systemOfRecord: false,
    credentialPlane: false,
    secretPlane: false,
    rawEvidencePlane: false,
    mutablePolicyPlane: false,
    arbitraryHostAllowed: false,
    arbitraryPathAllowed: false,
    writeSemanticsAllowed: false,
};
const EXPECTED_COMPATIBILITY_CLAIMS = {
    desktopCompatibilityProven: false,
    gatewayCompatibilityProven: false,
    serviceCompatibilityProven: false,
    tenantCompatibilityProven: false,
    performanceProven: false,
    costProven: false,
};
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isId(value) {
    return typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function denied(reason) {
    return { outcome: "DENIED", reasonCodes: [reason] };
}
export function analyticsProjectionDigestV1(projection) {
    if (!isRecord(projection))
        throw new TypeError("INVALID_ANALYTICS_PROJECTION");
    const content = Object.fromEntries(Object.entries(projection).filter(([key]) => key !== "projectionDigest"));
    return createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
}
export function verifyAnalyticsProjectionV1(value) {
    if (!exactKeys(value, [
        "schemaVersion", "projectionId", "contractVersion", "evidenceClass", "laneSelection",
        "lineage", "receiptReference", "timestamps", "fieldClassification", "redactionPolicy",
        "authorityBoundary", "compatibilityClaims", "projectionDigest",
    ]) || value.schemaVersion !== ANALYTICS_PROJECTION_SCHEMA_V1
        || !isId(value.projectionId) || !isDigest(value.projectionDigest)
        || value.contractVersion !== ANALYTICS_PROJECTION_VERSION_V1
        || value.evidenceClass !== "LOCAL_SYNTHETIC") {
        return denied("ANALYTICS_PROJECTION_SCHEMA_DENIED");
    }
    if (!exactKeys(value.laneSelection, [
        "defaultLane", "fallbackLane", "directQueryAllowed",
        "directQueryJustificationRequired", "directQueryEvidenceMeasurements",
    ])) {
        return denied("ANALYTICS_PROJECTION_LANE_DENIED");
    }
    if (value.laneSelection.directQueryAllowed !== false) {
        return denied("ANALYTICS_PROJECTION_DIRECTQUERY_DENIED");
    }
    if (canonicalJson(value.laneSelection) !== canonicalJson(EXPECTED_LANE_SELECTION)) {
        return denied("ANALYTICS_PROJECTION_LANE_DENIED");
    }
    if (!isRecord(value.lineage) || canonicalJson(value.lineage) !== canonicalJson(EXPECTED_LINEAGE)) {
        return denied("ANALYTICS_PROJECTION_LINEAGE_DENIED");
    }
    if (!isRecord(value.receiptReference) || canonicalJson(value.receiptReference) !== canonicalJson(EXPECTED_RECEIPT_REFERENCE)) {
        return denied("ANALYTICS_PROJECTION_RECEIPT_DENIED");
    }
    if (!isRecord(value.timestamps) || canonicalJson(value.timestamps) !== canonicalJson(EXPECTED_TIMESTAMPS)) {
        return denied("ANALYTICS_PROJECTION_TIMESTAMP_DENIED");
    }
    if (!Array.isArray(value.fieldClassification) || canonicalJson(value.fieldClassification) !== canonicalJson(EXPECTED_FIELD_CLASSIFICATION)) {
        return denied("ANALYTICS_PROJECTION_CLASSIFICATION_DENIED");
    }
    if (!isRecord(value.redactionPolicy) || canonicalJson(value.redactionPolicy) !== canonicalJson(EXPECTED_REDACTION_POLICY)) {
        return denied("ANALYTICS_PROJECTION_REDACTION_DENIED");
    }
    if (!isRecord(value.authorityBoundary) || canonicalJson(value.authorityBoundary) !== canonicalJson(EXPECTED_AUTHORITY_BOUNDARY)) {
        return denied("ANALYTICS_PROJECTION_AUTHORITY_DENIED");
    }
    if (!isRecord(value.compatibilityClaims) || canonicalJson(value.compatibilityClaims) !== canonicalJson(EXPECTED_COMPATIBILITY_CLAIMS)) {
        return denied("ANALYTICS_PROJECTION_COMPATIBILITY_DENIED");
    }
    const projection = value;
    if (analyticsProjectionDigestV1(projection) !== projection.projectionDigest) {
        return denied("ANALYTICS_PROJECTION_DIGEST_DENIED");
    }
    return {
        outcome: "VERIFIED",
        reasonCodes: ["ANALYTICS_PROJECTION_VERIFIED"],
        projectionDigest: projection.projectionDigest,
        laneCount: 2,
        directQueryAllowed: false,
        fieldClassificationCount: projection.fieldClassification.length,
    };
}
