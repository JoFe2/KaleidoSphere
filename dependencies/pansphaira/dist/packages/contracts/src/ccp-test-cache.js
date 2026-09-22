import { canonicalJson } from "./canonical-json.js";
import { assertCcpDigestV1, assertCcpSafeUnsignedIntegerV1, assertCcpStringV1, ccpDigestDomainV1, ccpStrictDenyV1, CONTRIBUTION_ID_PATTERN, LEDGER_ID_PATTERN, readCcpClosedObjectV1, readCcpDenseArrayV1, REPOSITORY_ID_PATTERN, TENANT_ID_PATTERN, } from "./ccp-event-envelope.js";
/**
 * CCP PSAI52 test-cache boundary. Cache identity is content addressed by the
 * source, dependency lock, test plan and isolated runner profile digests, and
 * is additionally partitioned by ledger/tenant/repository/contribution. This
 * module only projects eligibility from injected cache state; it never runs a
 * test, reads a cache store, uses a clock, or grants execution or merge
 * authority.
 */
export const CCP_TEST_CACHE_KEY_SCHEMA_V1 = "cm.ccp-test-cache-key/v1";
export const CCP_TEST_CACHE_ENTRY_SCHEMA_V1 = "cm.ccp-test-cache-entry/v1";
export const CCP_TEST_CACHE_REQUEST_SCHEMA_V1 = "cm.ccp-test-cache-request/v1";
export const CCP_TEST_CACHE_CONTEXT_SCHEMA_V1 = "cm.ccp-test-cache-context/v1";
export const CCP_TEST_CACHE_RECEIPT_SCHEMA_V1 = "cm.ccp-test-cache-receipt/v1";
export const CCP_TEST_CACHE_DISPOSITIONS_V1 = Object.freeze([
    "CACHE_HIT",
    "CACHE_MISS",
    "INELIGIBLE",
]);
export const CCP_TEST_CACHE_REASON_CODES_V1 = Object.freeze([
    "CACHE_HIT_CONTENT_ADDRESSED",
    "CACHE_MISS",
    "CACHE_MISS_NAMESPACE_ISOLATED",
    "CACHE_MISS_PROFILE_MISMATCH",
    "CACHE_ENTRY_TEST_FAILED",
    "CACHE_ENTRY_CLEANUP_RESIDUE",
    "CACHE_ENTRY_FUTURE_DATED",
]);
const KEY_KEYS = Object.freeze([
    "schemaVersion", "sourceDigest", "dependencyLockDigest", "testPlanDigest", "runnerProfileDigest",
]);
const REQUEST_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId", "cacheKey",
]);
const ENTRY_KEYS = Object.freeze([
    "schemaVersion", "ledgerId", "tenantId", "repositoryId", "contributionId", "cacheKey",
    "resultDigest", "isolationLeaseReceiptDigest", "cleanupReceiptDigest", "testOutcome", "cleanupOutcome", "storedAtMs",
]);
const CONTEXT_KEYS = Object.freeze(["schemaVersion", "logicalAtMs", "entries"]);
const ELIGIBILITY_KEYS = Object.freeze(["cacheEligible", "executionAuthorized", "mergeAuthorized"]);
const RECEIPT_KEYS = Object.freeze([
    "schemaVersion", "request", "requestDigest", "context", "contextDigest", "cacheKey", "cacheKeyDigest",
    "entry", "entryDigest", "disposition", "reasonCode", "eligibility", "receiptDigest",
]);
const REQUEST_DENIED = "CCP_TEST_CACHE_REQUEST_SCHEMA_DENIED";
const KEY_DENIED = "CCP_TEST_CACHE_KEY_SCHEMA_DENIED";
const ENTRY_DENIED = "CCP_TEST_CACHE_ENTRY_SCHEMA_DENIED";
const CONTEXT_DENIED = "CCP_TEST_CACHE_CONTEXT_SCHEMA_DENIED";
const RECEIPT_DENIED = "CCP_TEST_CACHE_RECEIPT_SCHEMA_DENIED";
const OUTCOMES = Object.freeze(["PASS", "FAIL"]);
const CLEANUP_OUTCOMES = Object.freeze(["ZERO_RESIDUE", "RESIDUE_DETECTED"]);
const DISPOSITIONS = Object.freeze(["CACHE_HIT", "CACHE_MISS", "INELIGIBLE"]);
const REASONS = Object.freeze([
    "CACHE_HIT_CONTENT_ADDRESSED", "CACHE_MISS", "CACHE_MISS_NAMESPACE_ISOLATED", "CACHE_MISS_PROFILE_MISMATCH",
    "CACHE_ENTRY_TEST_FAILED", "CACHE_ENTRY_CLEANUP_RESIDUE", "CACHE_ENTRY_FUTURE_DATED",
]);
function identity(record, code) {
    return {
        ledgerId: assertCcpStringV1(record.ledgerId, LEDGER_ID_PATTERN, code),
        tenantId: assertCcpStringV1(record.tenantId, TENANT_ID_PATTERN, code),
        repositoryId: assertCcpStringV1(record.repositoryId, REPOSITORY_ID_PATTERN, code),
        contributionId: assertCcpStringV1(record.contributionId, CONTRIBUTION_ID_PATTERN, code),
    };
}
function enumValue(value, values, code) {
    if (typeof value !== "string" || !values.includes(value))
        ccpStrictDenyV1(code);
    return value;
}
export function parseCcpTestCacheKeyV1(value) {
    const record = readCcpClosedObjectV1(value, KEY_KEYS, new WeakSet(), KEY_DENIED);
    if (record.schemaVersion !== CCP_TEST_CACHE_KEY_SCHEMA_V1)
        ccpStrictDenyV1(KEY_DENIED);
    return Object.freeze({
        schemaVersion: CCP_TEST_CACHE_KEY_SCHEMA_V1,
        sourceDigest: assertCcpDigestV1(record.sourceDigest, KEY_DENIED),
        dependencyLockDigest: assertCcpDigestV1(record.dependencyLockDigest, KEY_DENIED),
        testPlanDigest: assertCcpDigestV1(record.testPlanDigest, KEY_DENIED),
        runnerProfileDigest: assertCcpDigestV1(record.runnerProfileDigest, KEY_DENIED),
    });
}
export function parseCcpTestCacheRequestV1(value) {
    const record = readCcpClosedObjectV1(value, REQUEST_KEYS, new WeakSet(), REQUEST_DENIED);
    if (record.schemaVersion !== CCP_TEST_CACHE_REQUEST_SCHEMA_V1)
        ccpStrictDenyV1(REQUEST_DENIED);
    return Object.freeze({
        schemaVersion: CCP_TEST_CACHE_REQUEST_SCHEMA_V1,
        ...identity(record, REQUEST_DENIED),
        cacheKey: parseCcpTestCacheKeyV1(record.cacheKey),
    });
}
export function parseCcpTestCacheEntryV1(value) {
    const record = readCcpClosedObjectV1(value, ENTRY_KEYS, new WeakSet(), ENTRY_DENIED);
    if (record.schemaVersion !== CCP_TEST_CACHE_ENTRY_SCHEMA_V1)
        ccpStrictDenyV1(ENTRY_DENIED);
    return Object.freeze({
        schemaVersion: CCP_TEST_CACHE_ENTRY_SCHEMA_V1,
        ...identity(record, ENTRY_DENIED),
        cacheKey: parseCcpTestCacheKeyV1(record.cacheKey),
        resultDigest: assertCcpDigestV1(record.resultDigest, ENTRY_DENIED),
        isolationLeaseReceiptDigest: assertCcpDigestV1(record.isolationLeaseReceiptDigest, ENTRY_DENIED),
        cleanupReceiptDigest: assertCcpDigestV1(record.cleanupReceiptDigest, ENTRY_DENIED),
        testOutcome: enumValue(record.testOutcome, OUTCOMES, ENTRY_DENIED),
        cleanupOutcome: enumValue(record.cleanupOutcome, CLEANUP_OUTCOMES, ENTRY_DENIED),
        storedAtMs: assertCcpSafeUnsignedIntegerV1(record.storedAtMs, ENTRY_DENIED),
    });
}
export function parseCcpTestCacheContextV1(value) {
    const seen = new WeakSet();
    const record = readCcpClosedObjectV1(value, CONTEXT_KEYS, seen, CONTEXT_DENIED);
    if (record.schemaVersion !== CCP_TEST_CACHE_CONTEXT_SCHEMA_V1)
        ccpStrictDenyV1(CONTEXT_DENIED);
    const rawEntries = readCcpDenseArrayV1(record.entries, seen, CONTEXT_DENIED);
    const entries = rawEntries.map(parseCcpTestCacheEntryV1);
    const digests = new Set();
    for (const entry of entries) {
        const digest = ccpDigestDomainV1(CCP_TEST_CACHE_ENTRY_SCHEMA_V1, entry);
        if (digests.has(digest))
            ccpStrictDenyV1(CONTEXT_DENIED);
        digests.add(digest);
    }
    return Object.freeze({
        schemaVersion: CCP_TEST_CACHE_CONTEXT_SCHEMA_V1,
        logicalAtMs: assertCcpSafeUnsignedIntegerV1(record.logicalAtMs, CONTEXT_DENIED),
        entries: Object.freeze(entries),
    });
}
export function ccpTestCacheKeyDigestV1(value) {
    return ccpDigestDomainV1(CCP_TEST_CACHE_KEY_SCHEMA_V1, parseCcpTestCacheKeyV1(value));
}
function sameIdentity(request, entry) {
    return request.ledgerId === entry.ledgerId && request.tenantId === entry.tenantId
        && request.repositoryId === entry.repositoryId && request.contributionId === entry.contributionId;
}
function sameKey(request, entry) {
    return ccpTestCacheKeyDigestV1(request.cacheKey) === ccpTestCacheKeyDigestV1(entry.cacheKey);
}
function sameContentExceptProfile(request, entry) {
    return request.cacheKey.sourceDigest === entry.cacheKey.sourceDigest
        && request.cacheKey.dependencyLockDigest === entry.cacheKey.dependencyLockDigest
        && request.cacheKey.testPlanDigest === entry.cacheKey.testPlanDigest;
}
function makeReceipt(request, context) {
    const requestDigest = ccpDigestDomainV1(CCP_TEST_CACHE_REQUEST_SCHEMA_V1, request);
    const contextDigest = ccpDigestDomainV1(CCP_TEST_CACHE_CONTEXT_SCHEMA_V1, context);
    const cacheKeyDigest = ccpTestCacheKeyDigestV1(request.cacheKey);
    const sameKeyEntries = context.entries.filter((entry) => sameKey(request, entry));
    const profileMismatchEntries = context.entries.filter((entry) => sameContentExceptProfile(request, entry)
        && entry.cacheKey.runnerProfileDigest !== request.cacheKey.runnerProfileDigest);
    const exact = sameKeyEntries.filter((entry) => sameIdentity(request, entry));
    if (exact.length > 1)
        ccpStrictDenyV1(CONTEXT_DENIED);
    const entry = exact[0] ?? null;
    let disposition = "CACHE_MISS";
    let reasonCode = sameKeyEntries.length > 0
        ? "CACHE_MISS_NAMESPACE_ISOLATED"
        : (profileMismatchEntries.some((entry) => sameIdentity(request, entry))
            ? "CACHE_MISS_PROFILE_MISMATCH"
            : "CACHE_MISS");
    if (entry !== null) {
        if (entry.storedAtMs > context.logicalAtMs) {
            disposition = "INELIGIBLE";
            reasonCode = "CACHE_ENTRY_FUTURE_DATED";
        }
        else if (entry.testOutcome !== "PASS") {
            disposition = "INELIGIBLE";
            reasonCode = "CACHE_ENTRY_TEST_FAILED";
        }
        else if (entry.cleanupOutcome !== "ZERO_RESIDUE") {
            disposition = "INELIGIBLE";
            reasonCode = "CACHE_ENTRY_CLEANUP_RESIDUE";
        }
        else {
            disposition = "CACHE_HIT";
            reasonCode = "CACHE_HIT_CONTENT_ADDRESSED";
        }
    }
    const eligibility = Object.freeze({
        cacheEligible: disposition === "CACHE_HIT",
        executionAuthorized: false,
        mergeAuthorized: false,
    });
    const unsigned = Object.freeze({
        schemaVersion: CCP_TEST_CACHE_RECEIPT_SCHEMA_V1,
        request,
        requestDigest,
        context,
        contextDigest,
        cacheKey: request.cacheKey,
        cacheKeyDigest,
        entry,
        entryDigest: entry === null ? null : ccpDigestDomainV1(CCP_TEST_CACHE_ENTRY_SCHEMA_V1, entry),
        disposition,
        reasonCode,
        eligibility,
    });
    return Object.freeze({
        ...unsigned,
        receiptDigest: ccpDigestDomainV1(CCP_TEST_CACHE_RECEIPT_SCHEMA_V1, unsigned),
    });
}
/** Project cache eligibility from a request and injected cache state. */
export function evaluateCcpTestCacheV1(request, context) {
    return makeReceipt(parseCcpTestCacheRequestV1(request), parseCcpTestCacheContextV1(context));
}
function normalizeEligibility(value) {
    const record = readCcpClosedObjectV1(value, ELIGIBILITY_KEYS, new WeakSet(), RECEIPT_DENIED);
    if (typeof record.cacheEligible !== "boolean" || record.executionAuthorized !== false || record.mergeAuthorized !== false)
        ccpStrictDenyV1(RECEIPT_DENIED);
    return Object.freeze({ cacheEligible: record.cacheEligible, executionAuthorized: false, mergeAuthorized: false });
}
/** Parse and re-derive a cache receipt; forged hits and namespace substitutions deny. */
export function parseCcpTestCacheReceiptV1(value) {
    const record = readCcpClosedObjectV1(value, RECEIPT_KEYS, new WeakSet(), RECEIPT_DENIED);
    if (record.schemaVersion !== CCP_TEST_CACHE_RECEIPT_SCHEMA_V1)
        ccpStrictDenyV1(RECEIPT_DENIED);
    const request = parseCcpTestCacheRequestV1(record.request);
    const requestDigest = assertCcpDigestV1(record.requestDigest, RECEIPT_DENIED);
    if (requestDigest !== ccpDigestDomainV1(CCP_TEST_CACHE_REQUEST_SCHEMA_V1, request))
        ccpStrictDenyV1(RECEIPT_DENIED);
    const context = parseCcpTestCacheContextV1(record.context);
    const cacheKey = parseCcpTestCacheKeyV1(record.cacheKey);
    if (canonicalJson(cacheKey) !== canonicalJson(request.cacheKey))
        ccpStrictDenyV1(RECEIPT_DENIED);
    const contextDigest = assertCcpDigestV1(record.contextDigest, RECEIPT_DENIED);
    if (contextDigest !== ccpDigestDomainV1(CCP_TEST_CACHE_CONTEXT_SCHEMA_V1, context))
        ccpStrictDenyV1(RECEIPT_DENIED);
    const entry = record.entry === null ? null : parseCcpTestCacheEntryV1(record.entry);
    const entryDigest = record.entryDigest === null ? null : assertCcpDigestV1(record.entryDigest, RECEIPT_DENIED);
    if ((entry === null) !== (entryDigest === null))
        ccpStrictDenyV1(RECEIPT_DENIED);
    if (entry !== null && entryDigest !== ccpDigestDomainV1(CCP_TEST_CACHE_ENTRY_SCHEMA_V1, entry))
        ccpStrictDenyV1(RECEIPT_DENIED);
    if (typeof record.disposition !== "string" || !DISPOSITIONS.includes(record.disposition)
        || typeof record.reasonCode !== "string" || !REASONS.includes(record.reasonCode))
        ccpStrictDenyV1(RECEIPT_DENIED);
    const disposition = record.disposition;
    const reasonCode = record.reasonCode;
    if ((disposition === "CACHE_HIT") !== (reasonCode === "CACHE_HIT_CONTENT_ADDRESSED")
        || (disposition === "CACHE_HIT" && entry === null)
        || (disposition === "CACHE_MISS" && entry !== null))
        ccpStrictDenyV1(RECEIPT_DENIED);
    const eligibility = normalizeEligibility(record.eligibility);
    if (eligibility.cacheEligible !== (disposition === "CACHE_HIT"))
        ccpStrictDenyV1(RECEIPT_DENIED);
    const unsigned = Object.freeze({
        schemaVersion: CCP_TEST_CACHE_RECEIPT_SCHEMA_V1,
        request,
        requestDigest,
        context,
        contextDigest,
        cacheKey,
        cacheKeyDigest: assertCcpDigestV1(record.cacheKeyDigest, RECEIPT_DENIED),
        entry,
        entryDigest,
        disposition,
        reasonCode,
        eligibility,
    });
    if (unsigned.cacheKeyDigest !== ccpDigestDomainV1(CCP_TEST_CACHE_KEY_SCHEMA_V1, cacheKey))
        ccpStrictDenyV1(RECEIPT_DENIED);
    const receiptDigest = assertCcpDigestV1(record.receiptDigest, RECEIPT_DENIED);
    const expected = makeReceipt(request, context);
    if (receiptDigest !== ccpDigestDomainV1(CCP_TEST_CACHE_RECEIPT_SCHEMA_V1, unsigned)
        || receiptDigest !== expected.receiptDigest)
        ccpStrictDenyV1(RECEIPT_DENIED);
    return Object.freeze({ ...unsigned, receiptDigest });
}
export function canonicalCcpTestCacheReceiptJsonV1(value) {
    return canonicalJson(parseCcpTestCacheReceiptV1(value));
}
export function ccpTestCacheReceiptDigestV1(value) {
    return parseCcpTestCacheReceiptV1(value).receiptDigest;
}
export function verifyCcpTestCacheReceiptV1(value) {
    try {
        return parseCcpTestCacheReceiptV1(value);
    }
    catch {
        return null;
    }
}
