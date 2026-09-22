import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
/**
 * CKS-06 (issue #286) — pure advisory resource-admission contract v1.
 *
 * This module validates one atomic scheduling-capacity proposal. It admits a
 * parallel candidate set only when all declared predecessors are positively
 * terminal, dependency leases do not conflict, normalized and controller-
 * resolved repository paths do not have a conflicting prefix overlap, every
 * complete context demand fits the exact profile limits, and the aggregate
 * demand fits the smallest contemporaneously measured KV-capacity bucket.
 * Work-order budget and measured resident-memory bounds are checked in the
 * same decision so that a partial or best-effort admission is impossible.
 *
 * Time and path resolution are explicit inputs: this pure module never reads
 * a clock or filesystem. The caller supplies decisionAtMs and controller-
 * resolved paths; canonical digests bind those inputs. VALID therefore means
 * only a positive advisory scheduling-capacity receipt. It does not measure,
 * acquire a lease, reserve a resource, invoke a provider, execute a route, or
 * grant Capability or Authority.
 */
export const CKS_RESOURCE_ADMISSION_SCHEMA_V1 = "chimpmaera.dev/cks-resource-admission/v1";
export const CKS_RESOURCE_ADMISSION_CLAIM_BOUNDARY_V1 = "SCHEDULING_CAPACITY_RECEIPT_ONLY_NOT_RESOURCE_PLANE_AUTHORITY_AND_NOT_EXECUTION";
export const CKS_LEASE_MODES_V1 = ["READ", "WRITE"];
export const CKS_DEPENDENCY_TERMINAL_OUTCOMES_V1 = ["POSITIVE", "DENIED", "UNKNOWN"];
export const CKS_REQUEST_FIELDS_V1 = [
    "schemaVersion",
    "decisionAtMs",
    "measurement",
    "budget",
    "candidates",
    "requestDigest",
];
export const CKS_MEASUREMENT_FIELDS_V1 = [
    "taskDemandDigest",
    "exactProfileDigest",
    "runtimeAndHardwareClassDigest",
    "capacityMeasurementMethodDigest",
    "capacityBucketDigest",
    "observedAtMs",
    "expiresAtMs",
    "dependencyGraphDigest",
    "pathLeaseSetDigest",
    "workOrderBudgetDigest",
    "catalogDigest",
    "priceBookDigest",
    "contextWindowTokens",
    "maximumInputTokens",
    "maximumOutputTokens",
    "capacityBuckets",
    "measurementDigest",
];
export const CKS_BUDGET_FIELDS_V1 = [
    "remainingCalls",
    "remainingTokens",
    "remainingCostMicros",
    "remainingElapsedMs",
    "remainingResidentBytes",
    "reservedCalls",
    "reservedTokens",
    "reservedCostMicros",
    "reservedElapsedMs",
    "reservedResidentBytes",
];
export const CKS_CAPACITY_BUCKET_FIELDS_V1 = [
    "bucketId",
    "ordinal",
    "maximumTotalTokens",
    "maximumConcurrentSequences",
    "measuredKvPeakBytes",
    "residentModelAndRuntimePeakBytes",
    "reservableMeasuredBytes",
    "bucketDigest",
];
export const CKS_CANDIDATE_FIELDS_V1 = [
    "candidateId",
    "predecessors",
    "dependencyLeases",
    "pathLeases",
    "demand",
];
export const CKS_DEMAND_FIELDS_V1 = [
    "inputTokens",
    "toolSchemaTokens",
    "maximumOutputTokens",
    "safetyReserveTokens",
    "concurrentSequences",
];
export const CKS_PREDECESSOR_FIELDS_V1 = [
    "predecessorId",
    "terminalOutcome",
    "terminalReceiptDigest",
];
export const CKS_DEPENDENCY_LEASE_FIELDS_V1 = ["dependencyId", "mode"];
export const CKS_PATH_LEASE_FIELDS_V1 = [
    "path",
    "resolvedPath",
    "mode",
    "resolutionDigest",
];
const MAX_CANDIDATES = 64;
const MAX_PREDECESSORS = 128;
const MAX_LEASES = 128;
const MAX_CAPACITY_BUCKETS = 32;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_PATH_LENGTH = 240;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._@+-]+$/;
const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");
const denied = (reason, detail) => ({ outcome: "DENIED", reason, detail });
const isPlainObject = (value) => typeof value === "object"
    && value !== null
    && Object.getPrototypeOf(value) === Object.prototype;
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isNonNegativeInteger = (value) => typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0);
const isPositiveInteger = (value) => isNonNegativeInteger(value) && value >= 1;
const isDigest = (value) => typeof value === "string" && DIGEST_PATTERN.test(value);
const isIdentifier = (value) => typeof value === "string"
    && value.length <= MAX_IDENTIFIER_LENGTH
    && IDENTIFIER_PATTERN.test(value);
const isRepositoryPath = (value) => {
    if (typeof value !== "string" || value.length < 1 || value.length > MAX_PATH_LENGTH)
        return false;
    if (value.startsWith("/") || value.includes("\\") || value.includes("\0"))
        return false;
    const segments = value.split("/");
    return segments.every((segment) => segment.length > 0
        && segment !== "."
        && segment !== ".."
        && PATH_SEGMENT_PATTERN.test(segment));
};
const checkFields = (value, fields, path) => {
    for (const key of Object.keys(value)) {
        if (!fields.includes(key))
            return denied("UNKNOWN_FIELD", `${path}.${key}`);
    }
    for (const key of fields) {
        if (!hasOwn(value, key))
            return denied("MISSING_FIELD", `${path}.${key}`);
    }
    return undefined;
};
const safeSum = (values) => {
    let total = 0;
    for (const value of values) {
        if (value > Number.MAX_SAFE_INTEGER - total)
            return undefined;
        total += value;
    }
    return total;
};
const pathsOverlap = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
export function cksPathResolutionDigestV1(resolution) {
    return sha256Hex(canonicalJson({ path: resolution.path, resolvedPath: resolution.resolvedPath }));
}
export function cksCapacityBucketDigestV1(bucket) {
    return sha256Hex(canonicalJson({
        bucketId: bucket.bucketId,
        maximumConcurrentSequences: bucket.maximumConcurrentSequences,
        maximumTotalTokens: bucket.maximumTotalTokens,
        measuredKvPeakBytes: bucket.measuredKvPeakBytes,
        ordinal: bucket.ordinal,
        reservableMeasuredBytes: bucket.reservableMeasuredBytes,
        residentModelAndRuntimePeakBytes: bucket.residentModelAndRuntimePeakBytes,
    }));
}
export function cksTaskDemandDigestV1(candidates) {
    return sha256Hex(canonicalJson(candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        demand: candidate.demand,
    }))));
}
export function cksDependencyGraphDigestV1(candidates) {
    return sha256Hex(canonicalJson(candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        dependencyLeases: candidate.dependencyLeases,
        predecessors: candidate.predecessors,
    }))));
}
export function cksPathLeaseSetDigestV1(candidates) {
    return sha256Hex(canonicalJson(candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        pathLeases: candidate.pathLeases,
    }))));
}
export function cksWorkOrderBudgetDigestV1(budget) {
    return sha256Hex(canonicalJson(budget));
}
export function cksMeasurementDigestV1(measurement) {
    return sha256Hex(canonicalJson({
        capacityBucketDigest: measurement.capacityBucketDigest,
        capacityBuckets: measurement.capacityBuckets,
        capacityMeasurementMethodDigest: measurement.capacityMeasurementMethodDigest,
        catalogDigest: measurement.catalogDigest,
        contextWindowTokens: measurement.contextWindowTokens,
        dependencyGraphDigest: measurement.dependencyGraphDigest,
        exactProfileDigest: measurement.exactProfileDigest,
        expiresAtMs: measurement.expiresAtMs,
        maximumInputTokens: measurement.maximumInputTokens,
        maximumOutputTokens: measurement.maximumOutputTokens,
        observedAtMs: measurement.observedAtMs,
        pathLeaseSetDigest: measurement.pathLeaseSetDigest,
        priceBookDigest: measurement.priceBookDigest,
        runtimeAndHardwareClassDigest: measurement.runtimeAndHardwareClassDigest,
        taskDemandDigest: measurement.taskDemandDigest,
        workOrderBudgetDigest: measurement.workOrderBudgetDigest,
    }));
}
export function cksRequestDigestV1(request) {
    return sha256Hex(canonicalJson({
        budget: request.budget,
        candidates: request.candidates,
        decisionAtMs: request.decisionAtMs,
        measurement: request.measurement,
        schemaVersion: request.schemaVersion,
    }));
}
function findDependencyLeaseConflict(leases) {
    for (let i = 0; i < leases.length; i += 1) {
        for (let j = i + 1; j < leases.length; j += 1) {
            const a = leases[i];
            const b = leases[j];
            if (a.candidateIndex !== b.candidateIndex
                && a.id === b.id
                && (a.mode === "WRITE" || b.mode === "WRITE")) {
                return denied("LEASE_CONFLICT", `dependency:${a.id} (${a.candidateId} vs ${b.candidateId})`);
            }
        }
    }
    return undefined;
}
function findPathLeaseConflict(leases) {
    for (let i = 0; i < leases.length; i += 1) {
        for (let j = i + 1; j < leases.length; j += 1) {
            const a = leases[i];
            const b = leases[j];
            if (a.candidateIndex !== b.candidateIndex
                && pathsOverlap(a.id, b.id)
                && (a.mode === "WRITE" || b.mode === "WRITE")) {
                return denied("LEASE_CONFLICT", `path:${a.id}|${b.id} (${a.candidateId} vs ${b.candidateId})`);
            }
        }
    }
    return undefined;
}
/**
 * Closed, deterministic and fail-closed validation. Every structural and
 * digest binding is checked before freshness, dependency, lease, capacity,
 * and budget semantics. No partial candidate subset is ever returned.
 */
export function validateCksResourceAdmissionRequestV1(input) {
    if (!isPlainObject(input))
        return denied("MALFORMED_VALUE", "request");
    const requestFieldDenial = checkFields(input, CKS_REQUEST_FIELDS_V1, "request");
    if (requestFieldDenial !== undefined)
        return requestFieldDenial;
    if (input.schemaVersion !== CKS_RESOURCE_ADMISSION_SCHEMA_V1) {
        return denied("MALFORMED_VALUE", "request.schemaVersion");
    }
    if (!isNonNegativeInteger(input.decisionAtMs)) {
        return denied("MALFORMED_VALUE", "request.decisionAtMs");
    }
    if (!isDigest(input.requestDigest))
        return denied("MALFORMED_VALUE", "request.requestDigest");
    if (!isPlainObject(input.measurement))
        return denied("MALFORMED_VALUE", "request.measurement");
    const measurementRecord = input.measurement;
    const measurementFieldDenial = checkFields(measurementRecord, CKS_MEASUREMENT_FIELDS_V1, "request.measurement");
    if (measurementFieldDenial !== undefined)
        return measurementFieldDenial;
    const measurementDigestFields = [
        "taskDemandDigest",
        "exactProfileDigest",
        "runtimeAndHardwareClassDigest",
        "capacityMeasurementMethodDigest",
        "capacityBucketDigest",
        "dependencyGraphDigest",
        "pathLeaseSetDigest",
        "workOrderBudgetDigest",
        "catalogDigest",
        "priceBookDigest",
        "measurementDigest",
    ];
    for (const field of measurementDigestFields) {
        if (!isDigest(measurementRecord[field])) {
            return denied("MALFORMED_VALUE", `request.measurement.${field}`);
        }
    }
    if (!isNonNegativeInteger(measurementRecord.observedAtMs)) {
        return denied("MALFORMED_VALUE", "request.measurement.observedAtMs");
    }
    if (!isNonNegativeInteger(measurementRecord.expiresAtMs)) {
        return denied("MALFORMED_VALUE", "request.measurement.expiresAtMs");
    }
    for (const field of ["contextWindowTokens", "maximumInputTokens", "maximumOutputTokens"]) {
        if (!isPositiveInteger(measurementRecord[field])) {
            return denied("MALFORMED_VALUE", `request.measurement.${field}`);
        }
    }
    if (measurementRecord.maximumInputTokens > measurementRecord.contextWindowTokens
        || measurementRecord.maximumOutputTokens > measurementRecord.contextWindowTokens) {
        return denied("MALFORMED_VALUE", "request.measurement.contextLimits");
    }
    const rawBuckets = measurementRecord.capacityBuckets;
    if (!Array.isArray(rawBuckets)
        || rawBuckets.length < 1
        || rawBuckets.length > MAX_CAPACITY_BUCKETS) {
        return denied("MALFORMED_VALUE", "request.measurement.capacityBuckets");
    }
    const bucketIds = new Set();
    const bucketDigests = new Set();
    for (let i = 0; i < rawBuckets.length; i += 1) {
        const rawBucket = rawBuckets[i];
        const bucketPath = `request.measurement.capacityBuckets[${i}]`;
        if (!isPlainObject(rawBucket))
            return denied("MALFORMED_VALUE", bucketPath);
        const bucketFieldDenial = checkFields(rawBucket, CKS_CAPACITY_BUCKET_FIELDS_V1, bucketPath);
        if (bucketFieldDenial !== undefined)
            return bucketFieldDenial;
        if (!isIdentifier(rawBucket.bucketId) || bucketIds.has(rawBucket.bucketId)) {
            return denied("MALFORMED_VALUE", `${bucketPath}.bucketId`);
        }
        bucketIds.add(rawBucket.bucketId);
        if (!isNonNegativeInteger(rawBucket.ordinal) || rawBucket.ordinal !== i) {
            return denied("MALFORMED_VALUE", `${bucketPath}.ordinal`);
        }
        for (const field of [
            "maximumTotalTokens",
            "maximumConcurrentSequences",
            "measuredKvPeakBytes",
            "residentModelAndRuntimePeakBytes",
            "reservableMeasuredBytes",
        ]) {
            if (!isPositiveInteger(rawBucket[field])) {
                return denied("MALFORMED_VALUE", `${bucketPath}.${field}`);
            }
        }
        if (!isDigest(rawBucket.bucketDigest) || bucketDigests.has(rawBucket.bucketDigest)) {
            return denied("MALFORMED_VALUE", `${bucketPath}.bucketDigest`);
        }
        bucketDigests.add(rawBucket.bucketDigest);
        const typedBucket = rawBucket;
        if (cksCapacityBucketDigestV1(typedBucket) !== typedBucket.bucketDigest) {
            return denied("BINDING_DIGEST_MISMATCH", `${bucketPath}.bucketDigest`);
        }
    }
    if (!isPlainObject(input.budget))
        return denied("MALFORMED_VALUE", "request.budget");
    const budgetRecord = input.budget;
    const budgetFieldDenial = checkFields(budgetRecord, CKS_BUDGET_FIELDS_V1, "request.budget");
    if (budgetFieldDenial !== undefined)
        return budgetFieldDenial;
    for (const field of CKS_BUDGET_FIELDS_V1) {
        if (!isNonNegativeInteger(budgetRecord[field])) {
            return denied("MALFORMED_VALUE", `request.budget.${field}`);
        }
    }
    for (const field of [
        "remainingCalls",
        "remainingTokens",
        "remainingElapsedMs",
        "remainingResidentBytes",
        "reservedCalls",
        "reservedElapsedMs",
        "reservedResidentBytes",
    ]) {
        if (budgetRecord[field] < 1) {
            return denied("MALFORMED_VALUE", `request.budget.${field}`);
        }
    }
    const rawCandidates = input.candidates;
    if (!Array.isArray(rawCandidates)
        || rawCandidates.length < 1
        || rawCandidates.length > MAX_CANDIDATES) {
        return denied("MALFORMED_VALUE", "request.candidates");
    }
    const candidateIds = new Set();
    for (let i = 0; i < rawCandidates.length; i += 1) {
        const rawCandidate = rawCandidates[i];
        const candidatePath = `request.candidates[${i}]`;
        if (!isPlainObject(rawCandidate))
            return denied("MALFORMED_VALUE", candidatePath);
        const candidateFieldDenial = checkFields(rawCandidate, CKS_CANDIDATE_FIELDS_V1, candidatePath);
        if (candidateFieldDenial !== undefined)
            return candidateFieldDenial;
        if (!isIdentifier(rawCandidate.candidateId) || candidateIds.has(rawCandidate.candidateId)) {
            return denied("MALFORMED_VALUE", `${candidatePath}.candidateId`);
        }
        candidateIds.add(rawCandidate.candidateId);
        if (!isPlainObject(rawCandidate.demand)) {
            return denied("MALFORMED_VALUE", `${candidatePath}.demand`);
        }
        const demandFieldDenial = checkFields(rawCandidate.demand, CKS_DEMAND_FIELDS_V1, `${candidatePath}.demand`);
        if (demandFieldDenial !== undefined)
            return demandFieldDenial;
        for (const field of CKS_DEMAND_FIELDS_V1) {
            if (!isNonNegativeInteger(rawCandidate.demand[field])) {
                return denied("MALFORMED_VALUE", `${candidatePath}.demand.${field}`);
            }
        }
        if (rawCandidate.demand.concurrentSequences < 1) {
            return denied("MALFORMED_VALUE", `${candidatePath}.demand.concurrentSequences`);
        }
        if (!Array.isArray(rawCandidate.predecessors)
            || rawCandidate.predecessors.length > MAX_PREDECESSORS) {
            return denied("MALFORMED_VALUE", `${candidatePath}.predecessors`);
        }
        const predecessorIds = new Set();
        for (let j = 0; j < rawCandidate.predecessors.length; j += 1) {
            const predecessor = rawCandidate.predecessors[j];
            const predecessorPath = `${candidatePath}.predecessors[${j}]`;
            if (!isPlainObject(predecessor))
                return denied("MALFORMED_VALUE", predecessorPath);
            const predecessorFieldDenial = checkFields(predecessor, CKS_PREDECESSOR_FIELDS_V1, predecessorPath);
            if (predecessorFieldDenial !== undefined)
                return predecessorFieldDenial;
            if (!isIdentifier(predecessor.predecessorId) || predecessorIds.has(predecessor.predecessorId)) {
                return denied("MALFORMED_VALUE", `${predecessorPath}.predecessorId`);
            }
            predecessorIds.add(predecessor.predecessorId);
            if (typeof predecessor.terminalOutcome !== "string"
                || !CKS_DEPENDENCY_TERMINAL_OUTCOMES_V1
                    .includes(predecessor.terminalOutcome)) {
                return denied("MALFORMED_VALUE", `${predecessorPath}.terminalOutcome`);
            }
            if (!isDigest(predecessor.terminalReceiptDigest)) {
                return denied("MALFORMED_VALUE", `${predecessorPath}.terminalReceiptDigest`);
            }
        }
        if (!Array.isArray(rawCandidate.dependencyLeases)
            || rawCandidate.dependencyLeases.length > MAX_LEASES) {
            return denied("MALFORMED_VALUE", `${candidatePath}.dependencyLeases`);
        }
        const dependencyIds = new Set();
        for (let j = 0; j < rawCandidate.dependencyLeases.length; j += 1) {
            const lease = rawCandidate.dependencyLeases[j];
            const leasePath = `${candidatePath}.dependencyLeases[${j}]`;
            if (!isPlainObject(lease))
                return denied("MALFORMED_VALUE", leasePath);
            const leaseFieldDenial = checkFields(lease, CKS_DEPENDENCY_LEASE_FIELDS_V1, leasePath);
            if (leaseFieldDenial !== undefined)
                return leaseFieldDenial;
            if (!isIdentifier(lease.dependencyId) || dependencyIds.has(lease.dependencyId)) {
                return denied("MALFORMED_VALUE", `${leasePath}.dependencyId`);
            }
            dependencyIds.add(lease.dependencyId);
            if (typeof lease.mode !== "string"
                || !CKS_LEASE_MODES_V1.includes(lease.mode)) {
                return denied("MALFORMED_VALUE", `${leasePath}.mode`);
            }
        }
        if (!Array.isArray(rawCandidate.pathLeases) || rawCandidate.pathLeases.length > MAX_LEASES) {
            return denied("MALFORMED_VALUE", `${candidatePath}.pathLeases`);
        }
        const declaredPaths = new Set();
        const resolvedPaths = new Set();
        for (let j = 0; j < rawCandidate.pathLeases.length; j += 1) {
            const lease = rawCandidate.pathLeases[j];
            const leasePath = `${candidatePath}.pathLeases[${j}]`;
            if (!isPlainObject(lease))
                return denied("MALFORMED_VALUE", leasePath);
            const leaseFieldDenial = checkFields(lease, CKS_PATH_LEASE_FIELDS_V1, leasePath);
            if (leaseFieldDenial !== undefined)
                return leaseFieldDenial;
            if (!isRepositoryPath(lease.path) || declaredPaths.has(lease.path)) {
                return denied("MALFORMED_VALUE", `${leasePath}.path`);
            }
            declaredPaths.add(lease.path);
            if (!isRepositoryPath(lease.resolvedPath) || resolvedPaths.has(lease.resolvedPath)) {
                return denied("MALFORMED_VALUE", `${leasePath}.resolvedPath`);
            }
            resolvedPaths.add(lease.resolvedPath);
            if (typeof lease.mode !== "string"
                || !CKS_LEASE_MODES_V1.includes(lease.mode)) {
                return denied("MALFORMED_VALUE", `${leasePath}.mode`);
            }
            if (!isDigest(lease.resolutionDigest)) {
                return denied("MALFORMED_VALUE", `${leasePath}.resolutionDigest`);
            }
            const typedLease = lease;
            if (cksPathResolutionDigestV1(typedLease) !== typedLease.resolutionDigest) {
                return denied("BINDING_DIGEST_MISMATCH", `${leasePath}.resolutionDigest`);
            }
        }
    }
    const measurement = measurementRecord;
    const budget = budgetRecord;
    const candidates = rawCandidates;
    const buckets = rawBuckets;
    const request = input;
    const expectedBindings = [
        ["taskDemandDigest", measurement.taskDemandDigest, cksTaskDemandDigestV1(candidates)],
        ["dependencyGraphDigest", measurement.dependencyGraphDigest, cksDependencyGraphDigestV1(candidates)],
        ["pathLeaseSetDigest", measurement.pathLeaseSetDigest, cksPathLeaseSetDigestV1(candidates)],
        ["workOrderBudgetDigest", measurement.workOrderBudgetDigest, cksWorkOrderBudgetDigestV1(budget)],
    ];
    for (const [field, actual, expected] of expectedBindings) {
        if (actual !== expected) {
            return denied("BINDING_DIGEST_MISMATCH", `request.measurement.${field}`);
        }
    }
    if (!bucketDigests.has(measurement.capacityBucketDigest)) {
        return denied("BINDING_DIGEST_MISMATCH", "request.measurement.capacityBucketDigest");
    }
    if (cksMeasurementDigestV1(measurement) !== measurement.measurementDigest) {
        return denied("MEASUREMENT_DIGEST_MISMATCH", "request.measurement.measurementDigest");
    }
    if (cksRequestDigestV1(request) !== request.requestDigest) {
        return denied("DIGEST_MISMATCH", "request.requestDigest");
    }
    if (measurement.observedAtMs > request.decisionAtMs
        || request.decisionAtMs >= measurement.expiresAtMs
        || measurement.observedAtMs >= measurement.expiresAtMs) {
        return denied("STALE_MEASUREMENT", "request.decisionAtMs");
    }
    const dependencyLeases = [];
    const pathLeases = [];
    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        for (const predecessor of candidate.predecessors) {
            if (predecessor.terminalOutcome !== "POSITIVE"
                || candidateIds.has(predecessor.predecessorId)
                || predecessor.predecessorId === candidate.candidateId) {
                return denied("DEPENDENCY_NOT_READY", `${candidate.candidateId}:${predecessor.predecessorId}`);
            }
        }
        for (const lease of candidate.dependencyLeases) {
            dependencyLeases.push({
                candidateIndex: i,
                candidateId: candidate.candidateId,
                id: lease.dependencyId,
                mode: lease.mode,
            });
        }
        for (const lease of candidate.pathLeases) {
            pathLeases.push({
                candidateIndex: i,
                candidateId: candidate.candidateId,
                id: lease.resolvedPath,
                mode: lease.mode,
            });
        }
    }
    const leaseConflict = findDependencyLeaseConflict(dependencyLeases)
        ?? findPathLeaseConflict(pathLeases);
    if (leaseConflict !== undefined)
        return leaseConflict;
    let totalTokens = 0;
    let totalSequences = 0;
    for (const candidate of candidates) {
        const inputDemand = safeSum([
            candidate.demand.inputTokens,
            candidate.demand.toolSchemaTokens,
        ]);
        const completeDemand = safeSum([
            candidate.demand.inputTokens,
            candidate.demand.toolSchemaTokens,
            candidate.demand.maximumOutputTokens,
            candidate.demand.safetyReserveTokens,
        ]);
        if (inputDemand === undefined
            || completeDemand === undefined
            || inputDemand > measurement.maximumInputTokens
            || candidate.demand.maximumOutputTokens > measurement.maximumOutputTokens
            || completeDemand > measurement.contextWindowTokens) {
            return denied("CONTEXT_CAPACITY_VIOLATION", candidate.candidateId);
        }
        const nextTotalTokens = safeSum([totalTokens, completeDemand]);
        const nextTotalSequences = safeSum([totalSequences, candidate.demand.concurrentSequences]);
        if (nextTotalTokens === undefined || nextTotalSequences === undefined) {
            return denied("KV_CAPACITY_VIOLATION", "aggregateDemandOverflow");
        }
        totalTokens = nextTotalTokens;
        totalSequences = nextTotalSequences;
    }
    const smallestFittingBucket = buckets.find((bucket) => bucket.maximumTotalTokens >= totalTokens
        && bucket.maximumConcurrentSequences >= totalSequences);
    if (smallestFittingBucket === undefined) {
        return denied("KV_CAPACITY_VIOLATION", "noMeasuredCapacityBucket");
    }
    if (smallestFittingBucket.bucketDigest !== measurement.capacityBucketDigest) {
        return denied("CAPACITY_BUCKET_MISMATCH", "request.measurement.capacityBucketDigest");
    }
    const measuredResidentBytes = safeSum([
        smallestFittingBucket.measuredKvPeakBytes,
        smallestFittingBucket.residentModelAndRuntimePeakBytes,
    ]);
    if (measuredResidentBytes === undefined
        || measuredResidentBytes > smallestFittingBucket.reservableMeasuredBytes) {
        return denied("KV_CAPACITY_VIOLATION", smallestFittingBucket.bucketId);
    }
    if (budget.reservedCalls < totalSequences
        || budget.reservedTokens < totalTokens
        || budget.reservedResidentBytes < measuredResidentBytes
        || budget.reservedCalls > budget.remainingCalls
        || budget.reservedTokens > budget.remainingTokens
        || budget.reservedCostMicros > budget.remainingCostMicros
        || budget.reservedElapsedMs > budget.remainingElapsedMs
        || budget.reservedResidentBytes > budget.remainingResidentBytes) {
        return denied("BUDGET_VIOLATION", "request.budget");
    }
    return {
        outcome: "VALID",
        requestDigest: request.requestDigest,
        capacityBucketDigest: measurement.capacityBucketDigest,
        claimBoundary: CKS_RESOURCE_ADMISSION_CLAIM_BOUNDARY_V1,
    };
}
