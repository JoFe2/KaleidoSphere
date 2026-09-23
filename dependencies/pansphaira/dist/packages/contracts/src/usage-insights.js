import { createHash, randomBytes } from "node:crypto";
import { isProxy } from "node:util/types";
import { canonicalJson } from "./canonical-json.js";
/**
 * AWI-INSIGHTS-1 core is the developer-facing, default-off, in-memory contract.
 * It deliberately remains free of I/O. The completion reference in
 * packages/usage-insights composes this primitive with the local consent,
 * persistence, lifecycle, loopback-sharing, and reporting boundaries.
 */
export const USAGE_INSIGHTS_EVENT_INPUT_SCHEMA_V1 = "chimpmaera.usage-insights/event-input/v1";
export const USAGE_INSIGHTS_EVENT_SCHEMA_V1 = "chimpmaera.usage-insights/event-record/v1";
export const USAGE_INSIGHTS_RUNTIME_SCHEMA_V1 = "chimpmaera.usage-insights/runtime-state/v1";
export const USAGE_INSIGHTS_RUNTIME_STATUS_SCHEMA_V1 = "chimpmaera.usage-insights/runtime-status/v1";
export const USAGE_INSIGHTS_PREVIEW_SCHEMA_V1 = "chimpmaera.usage-insights/local-owner-preview/v1";
export const USAGE_INSIGHTS_EXPORT_SCHEMA_V1 = "chimpmaera.usage-insights/local-owner-export/v1";
export const USAGE_INSIGHTS_AGGREGATE_SCHEMA_V1 = "chimpmaera.usage-insights/publishable-aggregate/v1";
export const USAGE_INSIGHTS_ERASURE_SCHEMA_V1 = "chimpmaera.usage-insights/erasure/v1";
export const USAGE_INSIGHTS_CLAIM_BOUNDARY_V1 = "USAGE_INSIGHTS_DEFAULT_OFF_IN_MEMORY_REFERENCE_NO_UX_NO_PERSISTENCE_NO_BACKGROUND_DELETION_NO_TRANSPORT_NO_PRODUCTION";
export const USAGE_INSIGHTS_PRODUCT_VERSION_V1 = "0.2.0-poc.20260810.5";
export const USAGE_INSIGHTS_PRODUCT_IDS_V1 = ["chimpmaera.poc"];
export const USAGE_INSIGHTS_CAPABILITY_IDS_V1 = [
    "capability.gateway",
    "capability.builder",
    "capability.hmi",
    "capability.agent-work-event",
    "capability.knowledge-envelope",
    "capability.verification-fabric",
];
export const USAGE_INSIGHTS_LIFECYCLE_OUTCOMES_V1 = [
    "INSTALL_STARTED",
    "INSTALL_SUCCEEDED",
    "INSTALL_FAILED",
    "UPGRADE_STARTED",
    "UPGRADE_SUCCEEDED",
    "UPGRADE_FAILED",
    "FIRST_SUCCESS",
    "RUNNING",
    "STOPPED",
    "ERROR",
    "DENIED",
    "ROLLBACK_SUCCEEDED",
    "ROLLBACK_FAILED",
    "UNINSTALLED",
];
export const USAGE_INSIGHTS_PROHIBITED_FIELDS_V1 = [
    "account", "address", "chat", "command", "content", "credential", "customer",
    "domain", "email", "file", "fileName", "filePath", "hostname", "identity",
    "ipAddress", "jobId", "message", "name", "path", "payload", "person", "phone",
    "prompt", "response", "secret", "sessionId", "tenantId", "token", "userId", "username",
];
/** Every retained record field has a closed classification. */
export const USAGE_INSIGHTS_FIELD_CLASSIFICATIONS_V1 = [
    ["/schemaVersion", "PUBLIC_FIXED"],
    ["/eventId", "OPAQUE_RANDOM"],
    ["/installationId", "PSEUDONYMOUS_RANDOM"],
    ["/productId", "PUBLIC_FIXED"],
    ["/capabilityId", "PUBLIC_FIXED"],
    ["/productVersion", "PUBLIC_FIXED"],
    ["/lifecycleOutcome", "PUBLIC_FIXED"],
    ["/occurredAtMs", "POLICY"],
    ["/eventDigest", "SENSITIVE_DIGEST"],
];
export const USAGE_INSIGHTS_ROTATION_INTERVAL_MS = 86_400_000;
export const USAGE_INSIGHTS_SMALL_CELL_THRESHOLD = 5;
export const USAGE_INSIGHTS_LAZY_EXPIRY_MS = 604_800_000;
export const USAGE_INSIGHTS_MAX_EVENT_RECORDS = 4_096;
const MAX_BOUNDARY_DEPTH = 8;
const MAX_BOUNDARY_ARRAY_LENGTH = 4_096;
const MAX_BOUNDARY_OBJECT_KEYS = 32;
const MAX_BOUNDARY_OBJECTS = 4_256;
const MAX_BOUNDARY_STRING_LENGTH = 512;
const RANDOM_RETRY_LIMIT = 8;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function boundaryFailure() {
    throw new TypeError("USAGE_INSIGHTS_UNSAFE_STRUCTURE");
}
function descriptorSafeClone(value, context = { seen: new Set(), objects: 0 }, depth = 0) {
    if (value === null || typeof value === "boolean")
        return value;
    if (typeof value === "string") {
        if (value.length > MAX_BOUNDARY_STRING_LENGTH)
            boundaryFailure();
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value))
            boundaryFailure();
        return value;
    }
    if (typeof value !== "object" || depth > MAX_BOUNDARY_DEPTH)
        boundaryFailure();
    const objectValue = value;
    if (isProxy(objectValue))
        boundaryFailure();
    if (context.seen.has(objectValue))
        boundaryFailure();
    context.seen.add(objectValue);
    context.objects += 1;
    if (context.objects > MAX_BOUNDARY_OBJECTS)
        boundaryFailure();
    let prototype;
    let keys;
    try {
        prototype = Object.getPrototypeOf(objectValue);
        keys = Reflect.ownKeys(objectValue);
    }
    catch {
        return boundaryFailure();
    }
    const isArray = Array.isArray(objectValue);
    if (prototype !== (isArray ? Array.prototype : Object.prototype))
        boundaryFailure();
    if (!isArray && keys.length > MAX_BOUNDARY_OBJECT_KEYS)
        boundaryFailure();
    const descriptors = new Map();
    for (const key of keys) {
        if (typeof key !== "string" || DANGEROUS_KEYS.has(key) || key.length > 128)
            boundaryFailure();
        let descriptor;
        try {
            descriptor = Reflect.getOwnPropertyDescriptor(objectValue, key);
        }
        catch {
            return boundaryFailure();
        }
        if (descriptor === undefined || !("value" in descriptor))
            boundaryFailure();
        if ((!isArray || key !== "length") && descriptor.enumerable !== true)
            boundaryFailure();
        descriptors.set(key, descriptor);
    }
    if (isArray) {
        const lengthDescriptor = descriptors.get("length");
        const length = lengthDescriptor?.value;
        if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BOUNDARY_ARRAY_LENGTH)
            boundaryFailure();
        if (keys.length !== length + 1)
            boundaryFailure();
        const clone = [];
        for (let index = 0; index < length; index += 1) {
            const descriptor = descriptors.get(String(index));
            if (descriptor === undefined)
                boundaryFailure();
            clone.push(descriptorSafeClone(descriptor.value, context, depth + 1));
        }
        return clone;
    }
    const clone = {};
    for (const [key, descriptor] of descriptors) {
        clone[key] = descriptorSafeClone(descriptor.value, context, depth + 1);
    }
    return clone;
}
function asPlainRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype
        ? value
        : null;
}
function exactKeys(value, keys) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isPseudonym(value) {
    return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}
function isEventId(value) {
    return typeof value === "string" && /^event:v1:[a-f0-9]{64}$/.test(value);
}
function isTimestamp(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function isEpoch(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function normalizedKey(value) {
    return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}
function containsProhibitedField(value) {
    if (Array.isArray(value))
        return value.some(containsProhibitedField);
    const record = asPlainRecord(value);
    if (record === null)
        return false;
    const prohibited = new Set(USAGE_INSIGHTS_PROHIBITED_FIELDS_V1.map(normalizedKey));
    return Object.entries(record).some(([key, nested]) => prohibited.has(normalizedKey(key)) || containsProhibitedField(nested));
}
function validEventInput(value) {
    return exactKeys(value, [
        "schemaVersion", "productId", "capabilityId", "productVersion", "lifecycleOutcome", "occurredAtMs",
    ])
        && value.schemaVersion === USAGE_INSIGHTS_EVENT_INPUT_SCHEMA_V1
        && USAGE_INSIGHTS_PRODUCT_IDS_V1.includes(value.productId)
        && USAGE_INSIGHTS_CAPABILITY_IDS_V1.includes(value.capabilityId)
        && value.productVersion === USAGE_INSIGHTS_PRODUCT_VERSION_V1
        && USAGE_INSIGHTS_LIFECYCLE_OUTCOMES_V1.includes(value.lifecycleOutcome)
        && isTimestamp(value.occurredAtMs);
}
function validEventRecord(value) {
    return exactKeys(value, [
        "schemaVersion", "eventId", "installationId", "productId", "capabilityId",
        "productVersion", "lifecycleOutcome", "occurredAtMs", "eventDigest",
    ])
        && value.schemaVersion === USAGE_INSIGHTS_EVENT_SCHEMA_V1
        && isEventId(value.eventId)
        && isPseudonym(value.installationId)
        && USAGE_INSIGHTS_PRODUCT_IDS_V1.includes(value.productId)
        && USAGE_INSIGHTS_CAPABILITY_IDS_V1.includes(value.capabilityId)
        && value.productVersion === USAGE_INSIGHTS_PRODUCT_VERSION_V1
        && USAGE_INSIGHTS_LIFECYCLE_OUTCOMES_V1.includes(value.lifecycleOutcome)
        && isTimestamp(value.occurredAtMs)
        && isDigest(value.eventDigest);
}
function digestPreparedExcluding(value, excludedKey) {
    const unsigned = {};
    for (const key of Object.keys(value)) {
        if (key !== excludedKey)
            unsigned[key] = value[key];
    }
    return createHash("sha256").update(canonicalJson(unsigned), "utf8").digest("hex");
}
function digestExcluding(value, excludedKey) {
    const prepared = asPlainRecord(descriptorSafeClone(value));
    if (prepared === null)
        throw new TypeError("USAGE_INSIGHTS_DIGEST_INPUT_DENIED");
    return digestPreparedExcluding(prepared, excludedKey);
}
function denied(reason) {
    return { outcome: "DENIED", reasonCodes: [reason] };
}
function copyEventRecord(event) {
    return {
        schemaVersion: event.schemaVersion,
        eventId: event.eventId,
        installationId: event.installationId,
        productId: event.productId,
        capabilityId: event.capabilityId,
        productVersion: event.productVersion,
        lifecycleOutcome: event.lifecycleOutcome,
        occurredAtMs: event.occurredAtMs,
        eventDigest: event.eventDigest,
    };
}
function inspectEventRecord(value) {
    let prepared;
    try {
        prepared = descriptorSafeClone(value);
    }
    catch {
        return { reason: "UNSAFE_STRUCTURE_DENIED" };
    }
    if (containsProhibitedField(prepared))
        return { reason: "PROHIBITED_FIELD_DENIED" };
    const record = asPlainRecord(prepared);
    if (record === null || !validEventRecord(record))
        return { reason: "SCHEMA_DENIED" };
    if (digestPreparedExcluding(record, "eventDigest") !== record.eventDigest) {
        return { reason: "DIGEST_MISMATCH_DENIED" };
    }
    return { event: copyEventRecord(record) };
}
function inspectEventInput(value) {
    let prepared;
    try {
        prepared = descriptorSafeClone(value);
    }
    catch {
        return { reason: "UNSAFE_STRUCTURE_DENIED" };
    }
    if (containsProhibitedField(prepared))
        return { reason: "PROHIBITED_FIELD_DENIED" };
    const record = asPlainRecord(prepared);
    if (record === null || !validEventInput(record))
        return { reason: "SCHEMA_DENIED" };
    return { input: record };
}
function generatePseudonym() {
    return `sha256:${createHash("sha256").update(randomBytes(32)).digest("hex")}`;
}
function generateEventId() {
    return `event:v1:${randomBytes(32).toString("hex")}`;
}
/** Canonical SHA-256 digest of a descriptor-safe event record, excluding eventDigest. */
export function usageInsightsEventDigestV1(value) {
    return digestExcluding(value, "eventDigest");
}
/** Canonical SHA-256 digest of a descriptor-safe aggregate, excluding aggregationDigest. */
export function usageInsightsAggregationDigestV1(value) {
    return digestExcluding(value, "aggregationDigest");
}
/** Verify a stored/exported record without projecting either opaque identifier. */
export function verifyUsageInsightsEventV1(value) {
    const inspected = inspectEventRecord(value);
    if ("reason" in inspected)
        return denied(inspected.reason);
    const { event } = inspected;
    return {
        outcome: "ACCEPTED",
        reasonCodes: ["USAGE_INSIGHTS_EVENT_VERIFIED"],
        productId: event.productId,
        capabilityId: event.capabilityId,
        productVersion: event.productVersion,
        lifecycleOutcome: event.lifecycleOutcome,
    };
}
function cellKey(cell) {
    return `${cell.productId}|${cell.capabilityId}|${cell.lifecycleOutcome}`;
}
/**
 * Publishable aggregation is all-or-nothing. If even one cell is below five
 * distinct opaque installation IDs, exact totals, multiplicity, and all cells
 * are withheld behind one fixed suppression reason.
 */
export function aggregateUsageInsightsV1(events, generatedAtMs) {
    if (!isTimestamp(generatedAtMs))
        throw new TypeError("INVALID_USAGE_INSIGHTS_AGGREGATION_INPUT");
    let prepared;
    try {
        prepared = descriptorSafeClone(events);
    }
    catch {
        throw new TypeError("INVALID_USAGE_INSIGHTS_AGGREGATION_INPUT");
    }
    if (!Array.isArray(prepared))
        throw new TypeError("INVALID_USAGE_INSIGHTS_AGGREGATION_INPUT");
    const verifiedEvents = [];
    const eventsById = new Map();
    for (const candidate of prepared) {
        const inspected = inspectEventRecord(candidate);
        if ("reason" in inspected)
            continue;
        const event = inspected.event;
        const existing = eventsById.get(event.eventId);
        if (existing !== undefined) {
            if (existing.eventDigest !== event.eventDigest)
                throw new TypeError("CONFLICTING_USAGE_INSIGHTS_EVENT_ID");
            continue;
        }
        eventsById.set(event.eventId, event);
        verifiedEvents.push(event);
    }
    const grouped = new Map();
    const installations = new Set();
    for (const event of verifiedEvents) {
        installations.add(event.installationId);
        const key = `${event.productId}|${event.capabilityId}|${event.lifecycleOutcome}`;
        const existing = grouped.get(key);
        if (existing === undefined) {
            grouped.set(key, {
                cell: {
                    productId: event.productId,
                    capabilityId: event.capabilityId,
                    lifecycleOutcome: event.lifecycleOutcome,
                    count: 1,
                },
                installations: new Set([event.installationId]),
            });
        }
        else {
            existing.cell = { ...existing.cell, count: existing.cell.count + 1 };
            existing.installations.add(event.installationId);
        }
    }
    const anySuppressed = [...grouped.values()].some((group) => group.installations.size < USAGE_INSIGHTS_SMALL_CELL_THRESHOLD);
    const empty = verifiedEvents.length === 0;
    const cells = empty || anySuppressed
        ? []
        : [...grouped.values()]
            .map((group) => ({ ...group.cell, distinctInstallations: group.installations.size }))
            .sort((a, b) => cellKey(a).localeCompare(cellKey(b)));
    const aggregate = {
        schemaVersion: USAGE_INSIGHTS_AGGREGATE_SCHEMA_V1,
        cohortLabel: "UNAUTHENTICATED_OPTED_IN_REFERENCE",
        coverageLabel: "PARTIAL_OPT_IN_NON_REPRESENTATIVE",
        suppressionPolicy: "ALL_OR_NOTHING_DISTINCT_INSTALLATIONS_THRESHOLD_5",
        minCellSize: USAGE_INSIGHTS_SMALL_CELL_THRESHOLD,
        publicationState: empty ? "EMPTY" : anySuppressed ? "SUPPRESSED" : "PUBLISHED",
        eventCount: anySuppressed ? null : verifiedEvents.length,
        installationsSeen: anySuppressed ? null : installations.size,
        suppressionReason: anySuppressed ? "ONE_OR_MORE_COHORTS_BELOW_THRESHOLD" : null,
        cells,
        generatedAtMs,
        aggregationDigest: "",
    };
    return { ...aggregate, aggregationDigest: usageInsightsAggregationDigestV1(aggregate) };
}
/** Fixed-vocabulary verification projection; no event or installation ID is emitted. */
export function renderPublicUsageInsightsDecisionV1(value) {
    const decision = verifyUsageInsightsEventV1(value);
    return canonicalJson({
        schemaVersion: USAGE_INSIGHTS_EVENT_SCHEMA_V1,
        outcome: decision.outcome,
        reasonCodes: decision.reasonCodes,
        productId: decision.outcome === "ACCEPTED" ? decision.productId : null,
        capabilityId: decision.outcome === "ACCEPTED" ? decision.capabilityId : null,
        lifecycleOutcome: decision.outcome === "ACCEPTED" ? decision.lifecycleOutcome : null,
        claimBoundary: USAGE_INSIGHTS_CLAIM_BOUNDARY_V1,
    });
}
function currentState(state) {
    if (state.deletedAtMs !== null)
        return "DELETED";
    if (state.revoked)
        return "REVOKED";
    return state.enabled ? "ENABLED" : "DISABLED";
}
function validSnapshotEvents(snapshot) {
    const eventIds = new Set();
    for (const candidate of snapshot.eventRecords) {
        const inspected = inspectEventRecord(candidate);
        if ("reason" in inspected)
            return false;
        const event = inspected.event;
        if (snapshot.installationId === null || event.installationId !== snapshot.installationId)
            return false;
        if (event.productId !== USAGE_INSIGHTS_PRODUCT_IDS_V1[0]
            || event.productVersion !== USAGE_INSIGHTS_PRODUCT_VERSION_V1)
            return false;
        if (eventIds.has(event.eventId))
            return false;
        eventIds.add(event.eventId);
    }
    return true;
}
function validRuntimeSnapshotShape(value) {
    if (!exactKeys(value, [
        "schemaVersion", "state", "enabled", "installationId", "epoch", "eventRecords", "createdAtMs",
        "capturedAtMs", "optedInAtMs", "lastRotatedAtMs", "revokedAtMs", "deleteByMs", "deletedAtMs",
        "claimBoundary", "stateDigest",
    ]))
        return false;
    if (value.schemaVersion !== USAGE_INSIGHTS_RUNTIME_SCHEMA_V1
        || value.claimBoundary !== USAGE_INSIGHTS_CLAIM_BOUNDARY_V1
        || !["DISABLED", "ENABLED", "REVOKED", "DELETED"].includes(value.state)
        || typeof value.enabled !== "boolean"
        || (value.installationId !== null && !isPseudonym(value.installationId))
        || !isEpoch(value.epoch)
        || !Array.isArray(value.eventRecords)
        || !isTimestamp(value.createdAtMs)
        || !isTimestamp(value.capturedAtMs)
        || !isDigest(value.stateDigest))
        return false;
    for (const field of [value.optedInAtMs, value.lastRotatedAtMs, value.revokedAtMs, value.deleteByMs, value.deletedAtMs]) {
        if (field !== null && !isTimestamp(field))
            return false;
    }
    return validSnapshotEvents(value);
}
function ordered(...values) {
    return values.every((value, index) => index === 0 || values[index - 1] <= value);
}
function validRuntimeSnapshotSemantics(snapshot, restoreAtMs) {
    if (!ordered(snapshot.createdAtMs, snapshot.capturedAtMs, restoreAtMs))
        return false;
    const eventsWithin = (lower, upper) => snapshot.eventRecords.every((event) => event.occurredAtMs >= lower && event.occurredAtMs <= upper);
    switch (snapshot.state) {
        case "DISABLED":
            return !snapshot.enabled && snapshot.installationId === null && snapshot.epoch === 0
                && snapshot.eventRecords.length === 0 && snapshot.optedInAtMs === null
                && snapshot.lastRotatedAtMs === null && snapshot.revokedAtMs === null
                && snapshot.deleteByMs === null && snapshot.deletedAtMs === null;
        case "ENABLED": {
            if (!snapshot.enabled || snapshot.installationId === null || snapshot.epoch < 1
                || snapshot.optedInAtMs === null || snapshot.lastRotatedAtMs === null
                || snapshot.revokedAtMs !== null || snapshot.deleteByMs !== null || snapshot.deletedAtMs !== null)
                return false;
            return ordered(snapshot.createdAtMs, snapshot.optedInAtMs, snapshot.lastRotatedAtMs, snapshot.capturedAtMs)
                && (snapshot.epoch !== 1 || snapshot.lastRotatedAtMs === snapshot.optedInAtMs)
                && eventsWithin(snapshot.lastRotatedAtMs, snapshot.capturedAtMs);
        }
        case "REVOKED": {
            if (snapshot.enabled || snapshot.installationId === null || snapshot.epoch < 1
                || snapshot.optedInAtMs === null || snapshot.lastRotatedAtMs === null
                || snapshot.revokedAtMs === null || snapshot.deleteByMs === null || snapshot.deletedAtMs !== null)
                return false;
            return ordered(snapshot.createdAtMs, snapshot.optedInAtMs, snapshot.lastRotatedAtMs, snapshot.revokedAtMs, snapshot.capturedAtMs)
                && (snapshot.epoch !== 1 || snapshot.lastRotatedAtMs === snapshot.optedInAtMs)
                && snapshot.deleteByMs === snapshot.revokedAtMs + USAGE_INSIGHTS_LAZY_EXPIRY_MS
                && snapshot.capturedAtMs < snapshot.deleteByMs
                && eventsWithin(snapshot.lastRotatedAtMs, snapshot.revokedAtMs);
        }
        case "DELETED":
            return !snapshot.enabled && snapshot.installationId === null && snapshot.epoch === 0
                && snapshot.eventRecords.length === 0 && snapshot.optedInAtMs === null
                && snapshot.lastRotatedAtMs === null && snapshot.revokedAtMs === null
                && snapshot.deleteByMs === null && snapshot.deletedAtMs !== null
                && ordered(snapshot.createdAtMs, snapshot.deletedAtMs, snapshot.capturedAtMs);
    }
}
/** Default-off, process-local reference runtime with no deterministic production seam. */
export class UsageInsightsRuntimeV1 {
    #state;
    constructor(nowMs = Date.now()) {
        if (arguments.length > 1)
            throw new TypeError("USAGE_INSIGHTS_TEST_SEAM_DENIED");
        if (!isTimestamp(nowMs))
            throw new TypeError("USAGE_INSIGHTS_INVALID_TIMESTAMP");
        this.#state = {
            enabled: false,
            revoked: false,
            installationId: null,
            epoch: 0,
            eventRecords: [],
            createdAtMs: nowMs,
            optedInAtMs: null,
            lastRotatedAtMs: null,
            revokedAtMs: null,
            deleteByMs: null,
            deletedAtMs: null,
        };
    }
    #assertNow(nowMs) {
        if (!isTimestamp(nowMs))
            throw new TypeError("USAGE_INSIGHTS_INVALID_TIMESTAMP");
        const state = this.#state;
        const latest = Math.max(state.createdAtMs, state.optedInAtMs ?? 0, state.lastRotatedAtMs ?? 0, state.revokedAtMs ?? 0, state.deletedAtMs ?? 0, ...state.eventRecords.map((event) => event.occurredAtMs));
        if (nowMs < latest)
            throw new TypeError("USAGE_INSIGHTS_TIME_REGRESSION");
    }
    #deleteIfDue(nowMs) {
        const state = this.#state;
        if (!state.revoked || state.deletedAtMs !== null || state.deleteByMs === null || nowMs < state.deleteByMs)
            return;
        state.eventRecords = [];
        state.installationId = null;
        state.epoch = 0;
        state.enabled = false;
        state.revoked = false;
        state.optedInAtMs = null;
        state.lastRotatedAtMs = null;
        state.revokedAtMs = null;
        state.deleteByMs = null;
        state.deletedAtMs = nowMs;
    }
    #freshInstallationId() {
        for (let attempt = 0; attempt < RANDOM_RETRY_LIMIT; attempt += 1) {
            const candidate = generatePseudonym();
            if (candidate !== this.#state.installationId)
                return candidate;
        }
        throw new Error("USAGE_INSIGHTS_RANDOM_COLLISION_LIMIT");
    }
    #freshEventId() {
        const used = new Set(this.#state.eventRecords.map((event) => event.eventId));
        for (let attempt = 0; attempt < RANDOM_RETRY_LIMIT; attempt += 1) {
            const candidate = generateEventId();
            if (!used.has(candidate))
                return candidate;
        }
        throw new Error("USAGE_INSIGHTS_RANDOM_COLLISION_LIMIT");
    }
    #rotate(nowMs) {
        const state = this.#state;
        if (state.installationId === null)
            throw new Error("USAGE_INSIGHTS_NOT_OPTED_IN");
        if (state.epoch >= Number.MAX_SAFE_INTEGER)
            throw new Error("USAGE_INSIGHTS_EPOCH_CAPACITY");
        const next = this.#freshInstallationId();
        const nextEpoch = state.epoch + 1;
        // Erasure is completed before the next pseudonym becomes observable.
        state.eventRecords = [];
        state.installationId = next;
        state.epoch = nextEpoch;
        state.lastRotatedAtMs = nowMs;
        return next;
    }
    #rotateIfDue(nowMs) {
        const state = this.#state;
        if (!state.enabled || state.revoked || state.deletedAtMs !== null || state.lastRotatedAtMs === null)
            return;
        if (nowMs - state.lastRotatedAtMs >= USAGE_INSIGHTS_ROTATION_INTERVAL_MS)
            this.#rotate(nowMs);
    }
    #refresh(nowMs) {
        this.#assertNow(nowMs);
        this.#deleteIfDue(nowMs);
        this.#rotateIfDue(nowMs);
    }
    #assertOperationalReadiness() {
        const state = this.#state;
        if (state.deletedAtMs !== null)
            throw new Error("USAGE_INSIGHTS_DELETED");
        if (state.revoked)
            throw new Error("USAGE_INSIGHTS_REVOKED");
        if (!state.enabled || state.installationId === null)
            throw new Error("USAGE_INSIGHTS_NOT_OPTED_IN");
    }
    status(nowMs = Date.now()) {
        this.#refresh(nowMs);
        const state = this.#state;
        return {
            schemaVersion: USAGE_INSIGHTS_RUNTIME_STATUS_SCHEMA_V1,
            state: currentState(state),
            enabled: state.enabled,
            installationId: state.installationId,
            epoch: state.epoch,
            eventCount: state.eventRecords.length,
            optedInAtMs: state.optedInAtMs,
            lastRotatedAtMs: state.lastRotatedAtMs,
            revokedAtMs: state.revokedAtMs,
            deleteByMs: state.deleteByMs,
            deletedAtMs: state.deletedAtMs,
            rotationIntervalMs: USAGE_INSIGHTS_ROTATION_INTERVAL_MS,
            deletionMode: "LAZY_ON_ACCESS",
            claimBoundary: USAGE_INSIGHTS_CLAIM_BOUNDARY_V1,
        };
    }
    /** Enable only through a fresh CSPRNG-generated process-local pseudonym. */
    optIn(nowMs = Date.now()) {
        if (arguments.length > 1)
            throw new TypeError("USAGE_INSIGHTS_CALLER_INSTALLATION_ID_DENIED");
        this.#refresh(nowMs);
        const state = this.#state;
        if (state.deletedAtMs !== null)
            throw new Error("USAGE_INSIGHTS_DELETED");
        if (state.revoked)
            throw new Error("USAGE_INSIGHTS_REVOKED");
        if (state.enabled)
            throw new Error("USAGE_INSIGHTS_ALREADY_OPTED_IN");
        const installationId = this.#freshInstallationId();
        state.enabled = true;
        state.installationId = installationId;
        state.epoch = 1;
        state.optedInAtMs = nowMs;
        state.lastRotatedAtMs = nowMs;
        return this.status(nowMs);
    }
    /** Revoke immediately; seven-day erasure is lazy on the next runtime access. */
    revoke(nowMs = Date.now()) {
        this.#refresh(nowMs);
        const state = this.#state;
        if (state.deletedAtMs !== null)
            throw new Error("USAGE_INSIGHTS_DELETED");
        if (state.revoked)
            throw new Error("USAGE_INSIGHTS_ALREADY_REVOKED");
        if (!state.enabled || state.installationId === null)
            throw new Error("USAGE_INSIGHTS_NOT_OPTED_IN");
        if (nowMs > Number.MAX_SAFE_INTEGER - USAGE_INSIGHTS_LAZY_EXPIRY_MS) {
            throw new TypeError("USAGE_INSIGHTS_INVALID_TIMESTAMP");
        }
        state.enabled = false;
        state.revoked = true;
        state.revokedAtMs = nowMs;
        state.deleteByMs = nowMs + USAGE_INSIGHTS_LAZY_EXPIRY_MS;
        return this.status(nowMs);
    }
    /** Immediately erase this runtime object's in-memory usage-insights state. */
    deleteState(nowMs = Date.now()) {
        this.#refresh(nowMs);
        const state = this.#state;
        if (state.deletedAtMs !== null)
            throw new Error("USAGE_INSIGHTS_DELETED");
        const erasedEventCount = state.eventRecords.length;
        const erasureDigest = createHash("sha256")
            .update(canonicalJson(state.eventRecords.map((event) => event.eventDigest)), "utf8")
            .digest("hex");
        state.eventRecords = [];
        state.installationId = null;
        state.epoch = 0;
        state.enabled = false;
        state.revoked = false;
        state.optedInAtMs = null;
        state.lastRotatedAtMs = null;
        state.revokedAtMs = null;
        state.deleteByMs = null;
        state.deletedAtMs = nowMs;
        return {
            schemaVersion: USAGE_INSIGHTS_ERASURE_SCHEMA_V1,
            erasedEventCount,
            erasedAtMs: nowMs,
            erasureDigest,
            claimBoundary: USAGE_INSIGHTS_CLAIM_BOUNDARY_V1,
        };
    }
    /** Record one identifier-free, closed-vocabulary input and mint its opaque ID internally. */
    record(value, nowMs = Date.now()) {
        this.#refresh(nowMs);
        const state = this.#state;
        if (state.deletedAtMs !== null)
            return denied("DELETED_DENIED");
        if (state.revoked)
            return denied("REVOKED_DENIED");
        if (!state.enabled || state.installationId === null || state.lastRotatedAtMs === null)
            return denied("DISABLED_DENIED");
        const inspected = inspectEventInput(value);
        if ("reason" in inspected)
            return denied(inspected.reason);
        if (inspected.input.occurredAtMs < state.lastRotatedAtMs || inspected.input.occurredAtMs > nowMs) {
            return denied("EVENT_TIME_DENIED");
        }
        if (state.eventRecords.length >= USAGE_INSIGHTS_MAX_EVENT_RECORDS)
            return denied("CAPACITY_DENIED");
        const eventId = this.#freshEventId();
        const unsigned = {
            schemaVersion: USAGE_INSIGHTS_EVENT_SCHEMA_V1,
            eventId,
            installationId: state.installationId,
            productId: inspected.input.productId,
            capabilityId: inspected.input.capabilityId,
            productVersion: inspected.input.productVersion,
            lifecycleOutcome: inspected.input.lifecycleOutcome,
            occurredAtMs: inspected.input.occurredAtMs,
            eventDigest: "",
        };
        const event = { ...unsigned, eventDigest: digestPreparedExcluding(unsigned, "eventDigest") };
        state.eventRecords.push(event);
        return { outcome: "ACCEPTED", reasonCodes: ["USAGE_INSIGHTS_EVENT_VERIFIED"], eventId };
    }
    /** Exact local-owner preview; this API does not establish export authorization. */
    preview(nowMs = Date.now()) {
        this.#refresh(nowMs);
        const state = this.#state;
        const publishableAggregation = aggregateUsageInsightsV1(state.eventRecords, nowMs);
        const preview = {
            schemaVersion: USAGE_INSIGHTS_PREVIEW_SCHEMA_V1,
            state: currentState(state),
            enabled: state.enabled,
            eventCount: state.eventRecords.length,
            distinctProductIds: [...new Set(state.eventRecords.map((event) => event.productId))].sort(),
            distinctCapabilityIds: [...new Set(state.eventRecords.map((event) => event.capabilityId))].sort(),
            distinctLifecycleOutcomes: [...new Set(state.eventRecords.map((event) => event.lifecycleOutcome))].sort(),
            productVersions: [...new Set(state.eventRecords.map((event) => event.productVersion))].sort(),
            publishableAggregation,
            claimBoundary: USAGE_INSIGHTS_CLAIM_BOUNDARY_V1,
            previewDigest: "",
        };
        return { ...preview, previewDigest: digestPreparedExcluding(preview, "previewDigest") };
    }
    /** Local-owner defensive copy; no authorization or transport is implemented. */
    exportState(nowMs = Date.now()) {
        this.#refresh(nowMs);
        const state = this.#state;
        if (state.deletedAtMs !== null)
            throw new Error("USAGE_INSIGHTS_DELETED");
        if (state.installationId === null)
            throw new Error("USAGE_INSIGHTS_NOT_OPTED_IN");
        const exportBundle = {
            schemaVersion: USAGE_INSIGHTS_EXPORT_SCHEMA_V1,
            state: currentState(state),
            installationId: state.installationId,
            eventRecords: state.eventRecords.map(copyEventRecord),
            exportedAtMs: nowMs,
            claimBoundary: USAGE_INSIGHTS_CLAIM_BOUNDARY_V1,
            exportDigest: "",
        };
        return { ...exportBundle, exportDigest: digestPreparedExcluding(exportBundle, "exportDigest") };
    }
    /** Rotate with fresh secret CSPRNG entropy; callers cannot provide entropy or a target ID. */
    rotateInstallationId(nowMs = Date.now()) {
        if (arguments.length > 1)
            throw new TypeError("USAGE_INSIGHTS_CALLER_ROTATION_ENTROPY_DENIED");
        this.#assertNow(nowMs);
        this.#deleteIfDue(nowMs);
        this.#assertOperationalReadiness();
        return this.#rotate(nowMs);
    }
    snapshot(nowMs = Date.now()) {
        this.#refresh(nowMs);
        const state = this.#state;
        const snapshot = {
            schemaVersion: USAGE_INSIGHTS_RUNTIME_SCHEMA_V1,
            state: currentState(state),
            enabled: state.enabled,
            installationId: state.installationId,
            epoch: state.epoch,
            eventRecords: state.eventRecords.map(copyEventRecord),
            createdAtMs: state.createdAtMs,
            capturedAtMs: nowMs,
            optedInAtMs: state.optedInAtMs,
            lastRotatedAtMs: state.lastRotatedAtMs,
            revokedAtMs: state.revokedAtMs,
            deleteByMs: state.deleteByMs,
            deletedAtMs: state.deletedAtMs,
            claimBoundary: USAGE_INSIGHTS_CLAIM_BOUNDARY_V1,
            stateDigest: "",
        };
        return { ...snapshot, stateDigest: digestPreparedExcluding(snapshot, "stateDigest") };
    }
    static restore(value, nowMs = Date.now()) {
        if (arguments.length > 2)
            throw new TypeError("USAGE_INSIGHTS_TEST_SEAM_DENIED");
        if (!isTimestamp(nowMs))
            throw new TypeError("USAGE_INSIGHTS_INVALID_TIMESTAMP");
        let prepared;
        try {
            prepared = descriptorSafeClone(value);
        }
        catch {
            throw new TypeError("INVALID_USAGE_INSIGHTS_RUNTIME_SNAPSHOT");
        }
        const record = asPlainRecord(prepared);
        if (record === null || !validRuntimeSnapshotShape(record)) {
            throw new TypeError("INVALID_USAGE_INSIGHTS_RUNTIME_SNAPSHOT");
        }
        const snapshot = record;
        if (digestPreparedExcluding(record, "stateDigest") !== snapshot.stateDigest) {
            throw new TypeError("USAGE_INSIGHTS_RUNTIME_SNAPSHOT_DIGEST_MISMATCH");
        }
        if (!validRuntimeSnapshotSemantics(snapshot, nowMs)) {
            throw new TypeError("INVALID_USAGE_INSIGHTS_RUNTIME_SNAPSHOT");
        }
        const runtime = new UsageInsightsRuntimeV1(snapshot.createdAtMs);
        const target = runtime.#state;
        target.enabled = snapshot.enabled;
        target.revoked = snapshot.state === "REVOKED";
        target.installationId = snapshot.installationId;
        target.epoch = snapshot.epoch;
        target.eventRecords = snapshot.eventRecords.map(copyEventRecord);
        target.optedInAtMs = snapshot.optedInAtMs;
        target.lastRotatedAtMs = snapshot.lastRotatedAtMs;
        target.revokedAtMs = snapshot.revokedAtMs;
        target.deleteByMs = snapshot.deleteByMs;
        target.deletedAtMs = snapshot.deletedAtMs;
        runtime.#refresh(nowMs);
        return runtime;
    }
}
