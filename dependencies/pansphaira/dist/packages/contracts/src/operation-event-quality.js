import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const OPERATION_EVENT_QUALITY_SCHEMA_V1 = "chimpmaera.cm-obs/operation-event-quality/v1";
export const OPERATION_EVENT_QUALITY_DECISION_SCHEMA_V1 = "chimpmaera.cm-obs/operation-event-quality-decision/v1";
export const OPERATION_EVENT_QUALITY_CLAIM_BOUNDARY_V1 = "DECLARATIVE_CM_OBS_CONTRACT_ONLY_NO_COLLECTOR_NO_DASHBOARD_AUTHORITY_NO_RUNTIME_ACTIVATION_NO_PRODUCTION_TELEMETRY";
export const OPERATION_EVENT_QUALITY_PROHIBITED_FIELDS_V1 = [
    "collectorUrl", "command", "content", "credential", "email", "hostname",
    "ipAddress", "message", "path", "prompt", "providerKey", "rawPrompt",
    "rawResponse", "secret", "sessionId", "tenantId", "token", "userId",
];
export const OPERATION_EVENT_QUALITY_FIELD_CLASSIFICATIONS_V1 = [
    ["/schemaVersion", "PUBLIC_FIXED"],
    ["/operation/operationId", "PSEUDONYMOUS"],
    ["/operation/runId", "PSEUDONYMOUS"],
    ["/operation/attemptId", "PSEUDONYMOUS"],
    ["/operation/traceId", "PSEUDONYMOUS"],
    ["/operation/correlationId", "PSEUDONYMOUS_NULLABLE"],
    ["/times/eventTimeMs", "POLICY"],
    ["/times/observedTimeMs", "POLICY"],
    ["/times/ingestTimeMs", "POLICY"],
    ["/source/producer", "PUBLIC_FIXED"],
    ["/source/sequence", "PUBLIC_FIXED"],
    ["/source/replayWindowMs", "POLICY"],
    ["/source/eventDigest", "SENSITIVE_DIGEST"],
    ["/source/previousEventDigest", "SENSITIVE_DIGEST_NULLABLE"],
    ["/source/rawEvidenceDigest", "SENSITIVE_DIGEST"],
    ["/source/rawEvidenceRef", "PUBLIC_SYNTHETIC_REFERENCE"],
    ["/source/rawEvidenceClass", "PUBLIC_FIXED"],
    ["/missingness/status", "PUBLIC_FIXED"],
    ["/missingness/reasons", "PUBLIC_FIXED"],
    ["/missingness/expectedAtMs", "POLICY_NULLABLE"],
    ["/quality/state", "PUBLIC_FIXED"],
    ["/quality/purpose", "PUBLIC_FIXED"],
    ["/quality/purposeFit", "POLICY"],
    ["/quality/assessmentKind", "PUBLIC_FIXED"],
    ["/quality/assessmentDigest", "SENSITIVE_DIGEST"],
    ["/retention/classification", "POLICY"],
    ["/retention/retainUntilMs", "POLICY"],
    ["/retention/minimization", "PUBLIC_FIXED"],
    ["/retention/rollbackProfile", "PUBLIC_FIXED"],
    ["/claimBoundary", "PUBLIC_FIXED"],
    ["/recordDigest", "SENSITIVE_DIGEST"],
];
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isTimestamp(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function isPositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isIdentifier(value, prefix) {
    return typeof value === "string" && new RegExp(`^${prefix}:[a-z0-9][a-z0-9-]{7,63}$`).test(value);
}
function isTraceId(value) {
    return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}
function uniqueClosedArray(value, allowed, allowEmpty = false) {
    return Array.isArray(value) && (allowEmpty || value.length > 0)
        && value.every((item) => typeof item === "string" && allowed.includes(item))
        && new Set(value).size === value.length;
}
function normalizedKey(value) {
    return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}
function containsProhibitedField(value) {
    if (Array.isArray(value))
        return value.some(containsProhibitedField);
    if (!isRecord(value))
        return false;
    const prohibited = new Set(OPERATION_EVENT_QUALITY_PROHIBITED_FIELDS_V1.map(normalizedKey));
    return Object.entries(value).some(([key, nested]) => prohibited.has(normalizedKey(key)) || containsProhibitedField(nested));
}
function validOperation(value) {
    return exactKeys(value, ["operationId", "runId", "attemptId", "traceId", "correlationId"])
        && isIdentifier(value.operationId, "op")
        && isIdentifier(value.runId, "run")
        && isIdentifier(value.attemptId, "attempt")
        && isTraceId(value.traceId)
        && (value.correlationId === null || isIdentifier(value.correlationId, "corr"));
}
function validTimes(value) {
    return exactKeys(value, ["eventTimeMs", "observedTimeMs", "ingestTimeMs"])
        && isTimestamp(value.eventTimeMs)
        && isTimestamp(value.observedTimeMs)
        && isTimestamp(value.ingestTimeMs);
}
function validSource(value) {
    return exactKeys(value, [
        "producer", "sequence", "replayWindowMs", "eventDigest", "previousEventDigest",
        "rawEvidenceDigest", "rawEvidenceRef", "rawEvidenceClass",
    ])
        && ["AWI", "VERIFICATION_FABRIC", "DEV_WORKER", "LEARNING_ROUTER", "BI_PROJECTION", "CM_OBS_FIXTURE"].includes(value.producer)
        && isPositiveInteger(value.sequence)
        && isPositiveInteger(value.replayWindowMs)
        && isDigest(value.eventDigest)
        && (value.previousEventDigest === null || isDigest(value.previousEventDigest))
        && isDigest(value.rawEvidenceDigest)
        && typeof value.rawEvidenceRef === "string"
        && /^obs-fixture:[a-z0-9][a-z0-9-]{7,63}$/.test(value.rawEvidenceRef)
        && ["PUBLIC_SYNTHETIC", "OWNER_PRIVATE_REFERENCE"].includes(value.rawEvidenceClass);
}
function validMissingness(value) {
    const allowed = [
        "EVIDENCE_NOT_PRODUCED", "SOURCE_REDACTED", "LATE_OBSERVED_EVENT",
        "DIGEST_UNAVAILABLE", "SEQUENCE_GAP", "ASSESSMENT_PENDING",
    ];
    return exactKeys(value, ["status", "reasons", "expectedAtMs"])
        && ["PRESENT", "MISSING", "PROVISIONAL"].includes(value.status)
        && uniqueClosedArray(value.reasons, allowed, true)
        && (value.expectedAtMs === null || isTimestamp(value.expectedAtMs));
}
function validQuality(value) {
    return exactKeys(value, ["state", "purpose", "purposeFit", "assessmentKind", "assessmentDigest"])
        && ["PASS", "WARN", "QUARANTINE", "BLOCK", "UNKNOWN"].includes(value.state)
        && ["AWI_JOIN", "VF_ATTESTATION", "DEV_WORKER_RECEIPT", "LR_EPISODE_NORMALIZATION", "BI_READ_ONLY_PROJECTION"].includes(value.purpose)
        && typeof value.purposeFit === "boolean"
        && value.assessmentKind === "APPEND_ONLY_ASSESSMENT"
        && isDigest(value.assessmentDigest);
}
function validRetention(value) {
    return exactKeys(value, ["classification", "retainUntilMs", "minimization", "rollbackProfile"])
        && ["PUBLIC_SYNTHETIC", "OWNER_PRIVATE_DERIVED"].includes(value.classification)
        && isTimestamp(value.retainUntilMs)
        && value.minimization === "DIGESTS_AND_REASON_CODES_ONLY_NO_RAW_CONTENT"
        && value.rollbackProfile === "DISABLE_OBS_PROJECTION_FAIL_CLOSED";
}
function validRecord(value) {
    return exactKeys(value, [
        "schemaVersion", "operation", "times", "source", "missingness", "quality",
        "retention", "claimBoundary", "recordDigest",
    ])
        && value.schemaVersion === OPERATION_EVENT_QUALITY_SCHEMA_V1
        && validOperation(value.operation)
        && validTimes(value.times)
        && validSource(value.source)
        && validMissingness(value.missingness)
        && validQuality(value.quality)
        && validRetention(value.retention)
        && value.claimBoundary === OPERATION_EVENT_QUALITY_CLAIM_BOUNDARY_V1
        && isDigest(value.recordDigest);
}
function decision(outcome, reasonCodes) {
    return {
        schemaVersion: OPERATION_EVENT_QUALITY_DECISION_SCHEMA_V1,
        outcome,
        reasonCodes,
        claimBoundary: OPERATION_EVENT_QUALITY_CLAIM_BOUNDARY_V1,
    };
}
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function eventDigestInput(value) {
    return {
        schemaVersion: value.schemaVersion,
        operation: value.operation,
        times: value.times,
        source: {
            producer: value.source.producer,
            sequence: value.source.sequence,
            replayWindowMs: value.source.replayWindowMs,
            previousEventDigest: value.source.previousEventDigest,
            rawEvidenceDigest: value.source.rawEvidenceDigest,
            rawEvidenceRef: value.source.rawEvidenceRef,
            rawEvidenceClass: value.source.rawEvidenceClass,
        },
        missingness: value.missingness,
        quality: value.quality,
        retention: value.retention,
        claimBoundary: value.claimBoundary,
    };
}
export function operationEventQualityEventDigestV1(value) {
    return digest(eventDigestInput(value));
}
export function operationEventQualityRecordDigestV1(value) {
    const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "recordDigest"));
    return digest(unsigned);
}
export function evaluateOperationEventQualityV1(value) {
    if (containsProhibitedField(value))
        return decision("DENIED", ["PROHIBITED_FIELD_DENIED"]);
    if (!validRecord(value))
        return decision("DENIED", ["SCHEMA_DENIED"]);
    if (operationEventQualityRecordDigestV1(value) !== value.recordDigest) {
        return decision("DENIED", ["DIGEST_MISMATCH_DENIED"]);
    }
    if (operationEventQualityEventDigestV1(value) !== value.source.eventDigest) {
        return decision("DENIED", ["EVENT_DIGEST_MISMATCH_DENIED"]);
    }
    if (value.times.eventTimeMs > value.times.observedTimeMs || value.times.observedTimeMs > value.times.ingestTimeMs) {
        return decision("DENIED", ["TIME_ORDER_DENIED"]);
    }
    if (value.retention.retainUntilMs < value.times.ingestTimeMs) {
        return decision("DENIED", ["RETENTION_POLICY_DENIED"]);
    }
    if (value.retention.classification === "PUBLIC_SYNTHETIC"
        && value.source.rawEvidenceClass !== "PUBLIC_SYNTHETIC") {
        return decision("DENIED", ["RAW_EVIDENCE_POLICY_DENIED"]);
    }
    if (value.missingness.status === "PRESENT"
        && (value.missingness.reasons.length !== 0 || value.missingness.expectedAtMs !== null)) {
        return decision("DENIED", ["MISSINGNESS_REASON_DENIED"]);
    }
    if (value.missingness.status !== "PRESENT"
        && (value.missingness.reasons.length === 0 || value.missingness.expectedAtMs === null)) {
        return decision("DENIED", ["MISSINGNESS_REASON_DENIED"]);
    }
    const isLate = value.times.observedTimeMs - value.times.eventTimeMs > value.source.replayWindowMs;
    if (isLate
        && (value.missingness.status !== "PROVISIONAL"
            || !value.missingness.reasons.includes("LATE_OBSERVED_EVENT")
            || !["WARN", "QUARANTINE"].includes(value.quality.state))) {
        return decision("DENIED", ["LATE_WINDOW_DENIED"]);
    }
    if (value.quality.assessmentKind !== "APPEND_ONLY_ASSESSMENT") {
        return decision("DENIED", ["APPEND_ONLY_ASSESSMENT_DENIED"]);
    }
    if ((value.quality.state === "PASS" && (!value.quality.purposeFit || value.missingness.status !== "PRESENT"))
        || (value.quality.state === "BLOCK" && value.quality.purposeFit)
        || (value.quality.state === "UNKNOWN" && value.missingness.status === "PRESENT")) {
        return decision("DENIED", ["QUALITY_STATE_DENIED"]);
    }
    return decision("ACCEPTED", ["OBS_RECORD_CONFORMANT"]);
}
export function renderPublicOperationEventQualityDecisionV1(value) {
    return canonicalJson(evaluateOperationEventQualityV1(value));
}
