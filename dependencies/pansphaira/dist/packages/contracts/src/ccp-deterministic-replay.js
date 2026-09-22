import { canonicalJson } from "./canonical-json.js";
import { assertCcpDigestV1, assertCcpSafeUnsignedIntegerV1, ccpDigestDomainV1, ccpStrictDenyV1, canonicalCcpEventEnvelopeJsonV1, readCcpClosedObjectV1, assertCcpSafePositiveIntegerV1, } from "./ccp-event-envelope.js";
import { appendCcpIntakeDeliveryV1, createCcpIntakeLedgerV1, } from "./ccp-intake-ledger.js";
import { projectCcpHeadSupersessionV1 } from "./ccp-head-supersession.js";
import { CCP_SYNTHETIC_PROFILE_SCHEMA_V1, parseCcpSyntheticProfileV1, } from "./ccp-profile-generator.js";
/**
 * CCP PSAI52 deterministic replay oracle. It replays local closed synthetic
 * inputs through the existing intake ledger, compares canonical event bytes
 * and coverage counts, and emits a bounded digest-bound receipt. It measures
 * no timing or throughput and makes no events/hour capacity claim.
 */
export const CCP_DETERMINISTIC_REPLAY_SCHEMA_V1 = "cm.ccp-deterministic-replay/v1";
export const CCP_DETERMINISTIC_REPLAY_TASK_ID_V1 = "QWEN-PSAI52-PROFILE-REPLAY-08";
export const CCP_CANONICAL_EVENT_STREAM_DOMAIN_V1 = "cm.ccp-canonical-event-stream/v1";
export const CCP_DETERMINISTIC_REPLAY_DECISIONS_V1 = Object.freeze([
    "REPLAY_MATCH",
    "REPLAY_MISMATCH",
]);
const COVERAGE_KEYS = Object.freeze([
    "eventCount", "admittedCount", "semanticDuplicateCount", "transportDuplicateCount", "staleCount",
    "quarantinedCount", "appendedCount", "effectCount", "currentCount", "supersededCount", "invalidatedCount",
]);
const RECEIPT_KEYS = Object.freeze([
    "schemaVersion", "taskId", "profileSchemaVersion", "seed", "profileId", "eventsPerHour", "inputEventCount",
    "inputCanonicalBytesDigest", "replayCanonicalBytesDigest", "canonicalBytesMatch", "expectedCoverage",
    "replayCoverage", "coverageCountsMatch", "ledgerDigest", "supersessionDigest", "decision", "evidenceComplete",
    "timingObserved", "throughputMeasured", "capacityEvidence", "verificationClaimed", "executionAuthorized",
    "mergeAuthorized", "receiptDigest",
]);
const SEED_PATTERN = /^SOL-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const PROFILE_ID_PATTERN = /^profile:[a-z0-9][a-z0-9._-]{2,95}$/;
function coverageForReplay(profile) {
    let ledger = createCcpIntakeLedgerV1(profile.identity);
    const canonicalEventBytes = [];
    let admittedCount = 0;
    let semanticDuplicateCount = 0;
    let transportDuplicateCount = 0;
    let staleCount = 0;
    let quarantinedCount = 0;
    let appendedCount = 0;
    let effectCount = 0;
    for (const event of profile.events) {
        const result = appendCcpIntakeDeliveryV1(ledger, event);
        ledger = result.ledger;
        canonicalEventBytes.push(result.receipt.canonicalEventBytes);
        if (result.appended)
            appendedCount += 1;
        if (result.effectApplied)
            effectCount += 1;
        switch (result.receipt.disposition) {
            case "ADMITTED":
                admittedCount += 1;
                break;
            case "SEMANTIC_DUPLICATE":
                semanticDuplicateCount += 1;
                break;
            case "TRANSPORT_DUPLICATE":
                transportDuplicateCount += 1;
                break;
            case "STALE":
                staleCount += 1;
                break;
            case "QUARANTINED":
                quarantinedCount += 1;
                break;
        }
    }
    const supersession = projectCcpHeadSupersessionV1(ledger);
    return {
        ledger,
        coverage: Object.freeze({
            eventCount: profile.events.length,
            admittedCount,
            semanticDuplicateCount,
            transportDuplicateCount,
            staleCount,
            quarantinedCount,
            appendedCount,
            effectCount,
            currentCount: supersession.currentCount,
            supersededCount: supersession.supersededCount,
            invalidatedCount: supersession.invalidatedCount,
        }),
        canonicalEventBytes: Object.freeze(canonicalEventBytes),
    };
}
function canonicalEventStream(profile) {
    return canonicalJson(profile.events.map((event) => canonicalCcpEventEnvelopeJsonV1(event)));
}
function normalizeCoverage(value) {
    const record = readCcpClosedObjectV1(value, COVERAGE_KEYS, new WeakSet(), "CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED");
    const numbers = COVERAGE_KEYS.map((key) => assertCcpSafeUnsignedIntegerV1(record[key], "CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED"));
    return Object.freeze({
        eventCount: numbers[0], admittedCount: numbers[1], semanticDuplicateCount: numbers[2],
        transportDuplicateCount: numbers[3], staleCount: numbers[4], quarantinedCount: numbers[5],
        appendedCount: numbers[6], effectCount: numbers[7], currentCount: numbers[8],
        supersededCount: numbers[9], invalidatedCount: numbers[10],
    });
}
function coverageEqual(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}
function makeReceipt(profile) {
    const replay = coverageForReplay(profile);
    const inputCanonicalBytes = canonicalEventStream(profile);
    const replayCanonicalBytes = canonicalJson(replay.canonicalEventBytes);
    const canonicalBytesMatch = inputCanonicalBytes === replayCanonicalBytes;
    const coverageCountsMatch = coverageEqual(profile.expectedCoverage, replay.coverage);
    const evidenceComplete = canonicalBytesMatch && coverageCountsMatch;
    const unsigned = Object.freeze({
        schemaVersion: CCP_DETERMINISTIC_REPLAY_SCHEMA_V1,
        taskId: CCP_DETERMINISTIC_REPLAY_TASK_ID_V1,
        profileSchemaVersion: CCP_SYNTHETIC_PROFILE_SCHEMA_V1,
        seed: profile.seed,
        profileId: profile.profileId,
        eventsPerHour: profile.eventsPerHour,
        inputEventCount: profile.events.length,
        inputCanonicalBytesDigest: ccpDigestDomainV1(CCP_CANONICAL_EVENT_STREAM_DOMAIN_V1, inputCanonicalBytes),
        replayCanonicalBytesDigest: ccpDigestDomainV1(CCP_CANONICAL_EVENT_STREAM_DOMAIN_V1, replayCanonicalBytes),
        canonicalBytesMatch,
        expectedCoverage: profile.expectedCoverage,
        replayCoverage: replay.coverage,
        coverageCountsMatch,
        ledgerDigest: replay.ledger.ledgerDigest,
        supersessionDigest: projectCcpHeadSupersessionV1(replay.ledger).supersessionDigest,
        decision: evidenceComplete ? "REPLAY_MATCH" : "REPLAY_MISMATCH",
        evidenceComplete,
        timingObserved: false,
        throughputMeasured: false,
        capacityEvidence: false,
        verificationClaimed: false,
        executionAuthorized: false,
        mergeAuthorized: false,
    });
    return Object.freeze({
        ...unsigned,
        receiptDigest: ccpDigestDomainV1(CCP_DETERMINISTIC_REPLAY_SCHEMA_V1, unsigned),
    });
}
/** Replay one closed profile and return a bounded oracle receipt. */
export function replayCcpSyntheticProfileV1(value) {
    return makeReceipt(parseCcpSyntheticProfileV1(value));
}
export const replayCcpProfileV1 = replayCcpSyntheticProfileV1;
export const runCcpDeterministicReplayV1 = replayCcpSyntheticProfileV1;
/** Parse and re-derive a replay receipt; forged matches or authority claims deny. */
export function parseCcpDeterministicReplayReceiptV1(value) {
    const record = readCcpClosedObjectV1(value, RECEIPT_KEYS, new WeakSet(), "CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED");
    if (record.schemaVersion !== CCP_DETERMINISTIC_REPLAY_SCHEMA_V1
        || record.taskId !== CCP_DETERMINISTIC_REPLAY_TASK_ID_V1
        || record.profileSchemaVersion !== CCP_SYNTHETIC_PROFILE_SCHEMA_V1
        || typeof record.seed !== "string" || !SEED_PATTERN.test(record.seed)
        || typeof record.profileId !== "string" || !PROFILE_ID_PATTERN.test(record.profileId)
        || record.timingObserved !== false || record.throughputMeasured !== false || record.capacityEvidence !== false
        || record.verificationClaimed !== false || record.executionAuthorized !== false || record.mergeAuthorized !== false) {
        ccpStrictDenyV1("CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED");
    }
    const eventsPerHour = assertCcpSafePositiveIntegerV1(record.eventsPerHour, "CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED");
    const inputEventCount = assertCcpSafeUnsignedIntegerV1(record.inputEventCount, "CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED");
    if (inputEventCount !== eventsPerHour)
        ccpStrictDenyV1("CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED");
    const expectedCoverage = normalizeCoverage(record.expectedCoverage);
    const replayCoverage = normalizeCoverage(record.replayCoverage);
    const canonicalBytesMatch = record.canonicalBytesMatch;
    const coverageCountsMatch = record.coverageCountsMatch;
    if (typeof canonicalBytesMatch !== "boolean" || typeof coverageCountsMatch !== "boolean"
        || typeof record.evidenceComplete !== "boolean"
        || record.evidenceComplete !== (canonicalBytesMatch && coverageCountsMatch)
        || record.decision !== (record.evidenceComplete ? "REPLAY_MATCH" : "REPLAY_MISMATCH")
        || (record.evidenceComplete && (!canonicalBytesMatch || !coverageCountsMatch))) {
        ccpStrictDenyV1("CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED");
    }
    const unsigned = Object.freeze({
        schemaVersion: CCP_DETERMINISTIC_REPLAY_SCHEMA_V1,
        taskId: CCP_DETERMINISTIC_REPLAY_TASK_ID_V1,
        profileSchemaVersion: CCP_SYNTHETIC_PROFILE_SCHEMA_V1,
        seed: record.seed,
        profileId: record.profileId,
        eventsPerHour,
        inputEventCount,
        inputCanonicalBytesDigest: assertCcpDigestV1(record.inputCanonicalBytesDigest, "CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED"),
        replayCanonicalBytesDigest: assertCcpDigestV1(record.replayCanonicalBytesDigest, "CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED"),
        canonicalBytesMatch,
        expectedCoverage,
        replayCoverage,
        coverageCountsMatch,
        ledgerDigest: assertCcpDigestV1(record.ledgerDigest, "CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED"),
        supersessionDigest: assertCcpDigestV1(record.supersessionDigest, "CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED"),
        decision: record.decision,
        evidenceComplete: record.evidenceComplete,
        timingObserved: false,
        throughputMeasured: false,
        capacityEvidence: false,
        verificationClaimed: false,
        executionAuthorized: false,
        mergeAuthorized: false,
    });
    const receiptDigest = assertCcpDigestV1(record.receiptDigest, "CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED");
    if (receiptDigest !== ccpDigestDomainV1(CCP_DETERMINISTIC_REPLAY_SCHEMA_V1, unsigned)) {
        ccpStrictDenyV1("CCP_DETERMINISTIC_REPLAY_SCHEMA_DENIED");
    }
    return Object.freeze({ ...unsigned, receiptDigest });
}
export function canonicalCcpDeterministicReplayReceiptJsonV1(value) {
    return canonicalJson(parseCcpDeterministicReplayReceiptV1(value));
}
export function ccpDeterministicReplayReceiptDigestV1(value) {
    return parseCcpDeterministicReplayReceiptV1(value).receiptDigest;
}
export function verifyCcpDeterministicReplayReceiptV1(value) {
    try {
        return parseCcpDeterministicReplayReceiptV1(value);
    }
    catch {
        return null;
    }
}
