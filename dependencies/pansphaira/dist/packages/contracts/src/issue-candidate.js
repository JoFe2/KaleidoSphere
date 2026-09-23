import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const ISSUE_CANDIDATE_SCHEMA_V1 = "cm.issue-candidate/v1";
const digest = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const isDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isId = (value) => typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
const safeDestination = (value) => typeof value === "string" && /^repo:[a-z0-9][a-z0-9._-]{2,63}$/.test(value);
function append(candidate, state, code, atMs, patch = {}) {
    if (!Number.isSafeInteger(atMs) || atMs < 0)
        throw new TypeError("ISSUE_TIME_DENIED");
    const next = { ...candidate, ...patch, state };
    const unsigned = {
        sequence: candidate.history.length + 1, state, code, atMs, candidateId: next.candidateId,
        contentDigest: next.contentDigest, approvalDigest: next.approvalDigest, attemptId: next.attemptId,
        receiptDigest: next.receiptDigest, readbackDigest: next.readbackDigest,
        previousEventDigest: candidate.history.at(-1)?.eventDigest ?? null,
    };
    const event = { ...unsigned, eventDigest: digest(unsigned) };
    return { ...next, history: Object.freeze([...candidate.history, Object.freeze(event)]) };
}
function requireState(candidate, ...states) {
    if (!states.includes(candidate.state))
        throw new Error(`ISSUE_TRANSITION_DENIED:${candidate.state}`);
}
function assertContent(content) {
    if (typeof content?.title !== "string" || typeof content.body !== "string"
        || content.title.length < 3 || content.title.length > 160 || content.body.length < 3 || content.body.length > 20_000)
        throw new TypeError("ISSUE_CONTENT_SCHEMA_DENIED");
}
export function observeIssueCandidateV1(input) {
    if (!isId(input.candidateId))
        throw new TypeError("ISSUE_CANDIDATE_ID_DENIED");
    assertContent(input.content);
    const content = Object.freeze({ ...input.content });
    const contentDigest = digest(content);
    const base = {
        schemaVersion: ISSUE_CANDIDATE_SCHEMA_V1, candidateId: input.candidateId, parentIssue: 39,
        content, contentDigest, classification: null, route: null, redactions: [], duplicateSearchDigest: null,
        approvalDigest: null, attemptId: null, receiptDigest: null, readbackDigest: null, remote: null,
        state: "observed", recoveryCode: null, publicBytesEmitted: 0, history: [],
    };
    return append(base, "observed", "OBSERVED", input.observedAtMs);
}
export function draftIssueCandidateV1(candidate, content, atMs) {
    requireState(candidate, "observed");
    assertContent(content);
    const immutable = Object.freeze({ ...content });
    return append(candidate, "drafted", "DRAFTED", atMs, { content: immutable, contentDigest: digest(immutable) });
}
const forbidden = [
    ["SECRET_OR_TOKEN", /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_|sk-|hf_|glpat-)[A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:password|api[_-]?key|secret|token)\s*[:=]\s*\S{8,})/i],
    ["PRIVATE_PATH", /(?:^|[\s`'"(])(?:\/(?:home|Users|mnt|srv|var\/lib)\/[^\s`'"),]+)/im],
    ["TENANT_OR_USER_IDENTITY", /(?:\btenant[_ -]?id\b|\buser[_ -]?id\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i],
    ["INTERNAL_HOST", /(?:\b(?:localhost|[a-z0-9-]+\.(?:internal|local|corp))\b|\b(?:10\.|127\.|169\.254\.|192\.168\.)\d{1,3}(?:\.\d{1,3}){1,2}\b)/i],
    ["SESSION_OR_JOB_ID", /\b(?:session|job|jti|correlation)[_-]?(?:id)?\s*[:=]\s*[a-z0-9._:-]{4,}\b/i],
    ["EXPLOIT_PAYLOAD", /(?:<script\b|\b(?:union\s+select|drop\s+table)\b|\.\.\/\.\.\/|\$\([^)]{1,80}\)|`[^`]*(?:curl|wget|nc)\b)/i],
];
export function sanitizeIssueCandidateV1(candidate, atMs) {
    requireState(candidate, "drafted");
    const joined = `${candidate.content.title}\n${candidate.content.body}`;
    const hits = forbidden.filter(([, pattern]) => pattern.test(joined)).map(([code]) => code).sort();
    if (hits.length > 0)
        return append(candidate, "quarantined", `QUARANTINED:${hits.join(",")}`, atMs, {
            classification: hits.includes("EXPLOIT_PAYLOAD") || hits.includes("SECRET_OR_TOKEN") ? "SECURITY" : "PRIVATE",
            route: hits.includes("EXPLOIT_PAYLOAD") || hits.includes("SECRET_OR_TOKEN") ? "SECURITY_POLICY" : "PRIVATE_REVIEW",
            redactions: hits, publicBytesEmitted: 0,
        });
    const sanitized = Object.freeze({
        title: candidate.content.title.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(),
        body: candidate.content.body.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim(),
    });
    assertContent(sanitized);
    return append(candidate, "sanitized", "SANITIZED", atMs, {
        content: sanitized, contentDigest: digest(sanitized), redactions: joined === `${sanitized.title}\n${sanitized.body}` ? [] : ["TEXT_NORMALIZED"],
    });
}
export function classifyIssueCandidateV1(candidate, classification, atMs) {
    requireState(candidate, "sanitized");
    if (classification !== "PUBLIC")
        return append(candidate, "quarantined", `CLASSIFICATION_${classification}_DENIED`, atMs, {
            classification, route: classification === "SECURITY" ? "SECURITY_POLICY" : "PRIVATE_REVIEW", publicBytesEmitted: 0,
        });
    return append(candidate, "classified", "CLASSIFIED_PUBLIC", atMs, { classification, route: "PUBLIC_PREFLIGHT" });
}
export async function deduplicateIssueCandidateV1(candidate, destination, adapter) {
    requireState(candidate, "classified");
    if (!safeDestination(destination) || !adapter || !isId(adapter.adapterId))
        throw new Error("DUPLICATE_SEARCH_ADAPTER_DENIED");
    const result = await adapter.search({ destination, contentDigest: candidate.contentDigest });
    if (!Number.isSafeInteger(result.searchedAtMs) || result.destination !== destination
        || result.queryDigest !== candidate.contentDigest || !Array.isArray(result.matches))
        throw new Error("DUPLICATE_SEARCH_RESULT_DENIED");
    const normalized = [...result.matches].sort((a, b) => a.remoteId.localeCompare(b.remoteId, "en"));
    if (normalized.some((match) => !isId(match.remoteId) || !isDigest(match.contentDigest)
        || !Number.isSafeInteger(match.similarityPermille) || match.similarityPermille < 0 || match.similarityPermille > 1000))
        throw new Error("DUPLICATE_SEARCH_RESULT_DENIED");
    const searchDigest = digest({ adapterId: adapter.adapterId, destination, queryDigest: result.queryDigest, matches: normalized });
    const patch = { duplicateSearchDigest: searchDigest };
    if (normalized.some((match) => match.contentDigest === candidate.contentDigest || match.similarityPermille === 1000))
        return append(candidate, "duplicate_blocked", "EXACT_DUPLICATE_BLOCKED", result.searchedAtMs, patch);
    if (normalized.some((match) => match.similarityPermille >= 700))
        return append(candidate, "review_required", "AMBIGUOUS_SIMILARITY_REVIEW_REQUIRED", result.searchedAtMs, patch);
    return append(candidate, "deduplicated", "NO_DUPLICATE", result.searchedAtMs, patch);
}
export function resolveAmbiguousDuplicateV1(candidate, decision, atMs) {
    requireState(candidate, "review_required");
    return append(candidate, decision === "PROCEED" ? "deduplicated" : "duplicate_blocked", decision === "PROCEED" ? "OWNER_DEDUPE_OVERRIDE" : "OWNER_DEDUPE_BLOCK", atMs);
}
export function previewIssueCandidateV1(candidate, destination) {
    requireState(candidate, "deduplicated");
    if (!safeDestination(destination) || !candidate.duplicateSearchDigest)
        throw new Error("ISSUE_PREVIEW_DENIED");
    const value = { action: "CREATE_ISSUE", destination, candidateId: candidate.candidateId,
        content: candidate.content, contentDigest: candidate.contentDigest, duplicateSearchDigest: candidate.duplicateSearchDigest };
    return { ...value, previewDigest: digest(value) };
}
export function approveIssueCandidateV1(candidate, destination, input) {
    const preview = previewIssueCandidateV1(candidate, destination);
    if (!isId(input.approvalId) || !/^[a-z0-9][a-z0-9._-]{7,95}$/.test(input.nonce)
        || !Number.isSafeInteger(input.issuedAtMs) || !Number.isSafeInteger(input.expiresAtMs)
        || input.issuedAtMs < 0 || input.expiresAtMs <= input.issuedAtMs || input.expiresAtMs - input.issuedAtMs > 300_000)
        throw new Error("ISSUE_APPROVAL_SCHEMA_DENIED");
    const unsigned = { approvalId: input.approvalId, candidateId: candidate.candidateId, contentDigest: candidate.contentDigest,
        destination, action: "CREATE_ISSUE", duplicateSearchDigest: preview.duplicateSearchDigest,
        issuedAtMs: input.issuedAtMs, expiresAtMs: input.expiresAtMs, nonce: input.nonce };
    const approval = Object.freeze({ ...unsigned, approvalDigest: digest(unsigned) });
    return { approval, candidate: append(candidate, "owner_reviewed", "EXACT_ACTION_APPROVED", input.issuedAtMs, { approvalDigest: approval.approvalDigest }) };
}
function validApproval(candidate, approval, destination, nowMs) {
    const { approvalDigest, ...unsigned } = approval;
    return digest(unsigned) === approvalDigest && candidate.approvalDigest === approvalDigest
        && approval.candidateId === candidate.candidateId && approval.contentDigest === candidate.contentDigest
        && approval.destination === destination && approval.action === "CREATE_ISSUE"
        && approval.duplicateSearchDigest === candidate.duplicateSearchDigest && nowMs >= approval.issuedAtMs && nowMs <= approval.expiresAtMs;
}
function receiptDigest(receipt) { return digest(receipt); }
function readbackDigest(readback) { return digest(readback); }
export async function submitIssueCandidateV1(candidate, destination, approval, adapter, nowMs) {
    requireState(candidate, "owner_reviewed");
    if (!safeDestination(destination) || !validApproval(candidate, approval, destination, nowMs))
        throw new Error("ISSUE_APPROVAL_DENIED");
    if (!adapter || !isId(adapter.adapterId)
        || canonicalJson(adapter.declaredCapabilities) !== canonicalJson(["CREATE_ISSUE", "READ_ISSUE_BY_IDEMPOTENCY"]))
        throw new Error("ISSUE_SUBMIT_ADAPTER_DENIED");
    const attemptId = `attempt:${digest({ candidateId: candidate.candidateId, approvalDigest: approval.approvalDigest }).slice(0, 32)}`;
    const idempotencyKey = digest({ candidateId: candidate.candidateId, contentDigest: candidate.contentDigest,
        approvalDigest: approval.approvalDigest, destination });
    let receipt;
    try {
        receipt = await adapter.submit({ destination, content: candidate.content, candidateId: candidate.candidateId,
            contentDigest: candidate.contentDigest, approvalDigest: approval.approvalDigest, attemptId, idempotencyKey });
    }
    catch {
        return append(candidate, "recovery_required", "SUBMIT_TIMEOUT", nowMs, { attemptId, recoveryCode: "SUBMIT_TIMEOUT" });
    }
    const { receiptDigest: claimed, ...unsigned } = receipt;
    const valid = receiptDigest(unsigned) === claimed && receipt.schemaVersion === "cm.issue-submit-receipt/v1"
        && receipt.attemptId === attemptId && receipt.idempotencyKey === idempotencyKey
        && receipt.candidateId === candidate.candidateId && receipt.contentDigest === candidate.contentDigest
        && receipt.approvalDigest === approval.approvalDigest && receipt.destination === destination
        && isId(receipt.remoteId) && /^https:\/\/example\.invalid\/issues\/[a-z0-9._-]+$/.test(receipt.remoteUrl);
    if (!valid)
        return append(candidate, "recovery_required", "RECEIPT_DENIED", nowMs, { attemptId, receiptDigest: receiptDigest(unsigned), recoveryCode: "RECEIPT_DENIED" });
    if (receipt.status !== "ACCEPTED")
        return append(candidate, "recovery_required", "SUBMIT_PARTIAL", nowMs, { attemptId, receiptDigest: claimed, recoveryCode: "SUBMIT_PARTIAL", remote: { id: receipt.remoteId, url: receipt.remoteUrl } });
    return append(candidate, "submitted", "SUBMITTED", nowMs, { attemptId, receiptDigest: claimed,
        remote: { id: receipt.remoteId, url: receipt.remoteUrl }, publicBytesEmitted: Buffer.byteLength(canonicalJson(candidate.content)) });
}
export async function readbackIssueCandidateV1(candidate, destination, adapter, atMs) {
    requireState(candidate, "submitted", "recovery_required");
    if (!adapter || !candidate.attemptId || !candidate.approvalDigest || !safeDestination(destination))
        throw new Error("ISSUE_READBACK_ADAPTER_DENIED");
    const idempotencyKey = digest({ candidateId: candidate.candidateId, contentDigest: candidate.contentDigest,
        approvalDigest: candidate.approvalDigest, destination });
    let readback;
    try {
        readback = await adapter.readByIdempotency({ destination, idempotencyKey });
    }
    catch {
        return append(candidate, "recovery_required", "READBACK_MISSING", atMs, { recoveryCode: "READBACK_MISSING" });
    }
    const { readbackDigest: claimed, ...unsigned } = readback;
    const shapeValid = readbackDigest(unsigned) === claimed && readback.schemaVersion === "cm.issue-readback/v1"
        && readback.attemptId === candidate.attemptId && readback.idempotencyKey === idempotencyKey;
    if (!shapeValid || readback.status === "AMBIGUOUS")
        return append(candidate, "recovery_required", "READBACK_AMBIGUOUS", atMs, { recoveryCode: "READBACK_AMBIGUOUS" });
    if (readback.status === "MISSING")
        return append(candidate, "recovery_required", "READBACK_MISSING", atMs, { recoveryCode: "READBACK_MISSING", readbackDigest: claimed });
    const matches = candidate.remote !== null && readback.remoteId === candidate.remote.id && readback.remoteUrl === candidate.remote.url
        && readback.content !== null && digest(readback.content) === candidate.contentDigest;
    if (!matches)
        return append(candidate, "recovery_required", "READBACK_MISMATCH", atMs, { recoveryCode: "READBACK_MISMATCH", readbackDigest: claimed });
    return append(candidate, "readback_confirmed", "READBACK_CONFIRMED", atMs, { recoveryCode: null, readbackDigest: claimed });
}
export function linkIssueCandidateV1(candidate, parentIssue, atMs) {
    requireState(candidate, "readback_confirmed");
    if (parentIssue !== 39)
        throw new Error("ISSUE_PARENT_LINK_DENIED");
    return append(candidate, "linked", "LINKED_TO_PARENT_39", atMs);
}
export function resolveIssueCandidateV1(candidate, atMs) {
    requireState(candidate, "linked");
    return append(candidate, "resolved", "LOCALLY_RESOLVED_NO_REMOTE_CLOSE", atMs);
}
export function verifyIssueCandidateHistoryV1(candidate) {
    if (candidate.schemaVersion !== ISSUE_CANDIDATE_SCHEMA_V1 || candidate.history.length === 0
        || candidate.history.at(-1)?.state !== candidate.state || candidate.history.at(-1)?.contentDigest !== candidate.contentDigest)
        return false;
    return candidate.history.every((event, index) => {
        const { eventDigest, ...unsigned } = event;
        return event.sequence === index + 1 && event.candidateId === candidate.candidateId
            && event.previousEventDigest === (index === 0 ? null : candidate.history[index - 1]?.eventDigest)
            && digest(unsigned) === eventDigest;
    });
}
