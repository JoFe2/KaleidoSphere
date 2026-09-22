import { createPrivateKey, createPublicKey, createHash, generateKeyPairSync, sign, verify, } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const PROTECTED_AUDIT_EVENT_SCHEMA_V1 = "chimpmaera.audit/protected-event/v1";
export const PROTECTED_AUDIT_ENVELOPE_SCHEMA_V1 = "chimpmaera.audit/protected-envelope/v1";
export const PROTECTED_AUDIT_CHECKPOINT_SCHEMA_V1 = "chimpmaera.audit/protected-checkpoint/v1";
export const PROTECTED_AUDIT_EXPLANATION_SCHEMA_V1 = "chimpmaera.audit/deterministic-explanation/v1";
const EVENT_KINDS = [
    "IDENTITY", "INTENT", "PLAN", "POLICY", "APPROVAL", "BUDGET", "EFFECT",
    "READBACK", "RECONCILE", "STOP", "ROLLBACK",
];
const OUTCOMES = [
    "OBSERVED", "ALLOW", "DENY", "OWNER_ESCALATION", "THROTTLE", "QUARANTINE",
    "COMMITTED", "FAILED", "UNCERTAIN", "RECONCILED", "STOPPED", "ROLLED_BACK",
];
const REFERENCE_KEYS = [
    "identity", "intent", "plan", "policy", "approval", "budget", "effect",
    "readback", "reconcile", "stop",
];
const EVENT_KEYS = [
    "actorId", "correlationId", "eventId", "eventKind", "facts", "observedAtMs",
    "occurredAtMs", "operationId", "references", "schemaVersion", "sequence",
    "tenant", "timelineId",
].sort();
const FACT_KEYS = ["evidenceDigests", "outcome", "reasonCodes"].sort();
const SIGNER_KEYS = ["algorithm", "generation", "keyId"].sort();
const ENVELOPE_KEYS = [
    "event", "eventDigest", "previousEnvelopeDigest", "schemaVersion", "signatureBase64",
    "signedAtMs", "signer",
].sort();
const CHECKPOINT_KEYS = [
    "eventCount", "headEnvelopeDigest", "issuedAtMs", "schemaVersion", "signatureBase64",
    "signer", "tenant", "timelineId",
].sort();
const REQUIRED_REFERENCES = {
    IDENTITY: [],
    INTENT: ["identity"],
    PLAN: ["identity", "intent"],
    POLICY: ["identity", "intent", "plan"],
    APPROVAL: ["identity", "intent", "plan", "policy"],
    BUDGET: ["identity", "intent", "plan", "policy", "approval"],
    EFFECT: ["identity", "intent", "plan", "policy", "approval", "budget"],
    READBACK: ["identity", "intent", "plan", "policy", "approval", "budget", "effect"],
    RECONCILE: ["identity", "intent", "plan", "policy", "approval", "budget", "effect"],
    STOP: ["identity", "policy"],
    ROLLBACK: ["identity", "intent", "plan", "policy", "approval", "effect"],
};
const KIND_BY_REFERENCE = {
    identity: "IDENTITY",
    intent: "INTENT",
    plan: "PLAN",
    policy: "POLICY",
    approval: "APPROVAL",
    budget: "BUDGET",
    effect: "EFFECT",
    readback: "READBACK",
    reconcile: "RECONCILE",
    stop: "STOP",
};
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
function exactObject(value, keys) {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype
        && canonicalJson(Object.keys(value).sort()) === canonicalJson(keys);
}
function validDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function validId(value) {
    return typeof value === "string"
        && /^[a-z][a-z0-9_-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
}
function validTime(value) {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}
function sortedUnique(values) {
    return values.every((value, index) => index === 0 || String(values[index - 1]) < value);
}
function validSignerReference(value) {
    return exactObject(value, SIGNER_KEYS)
        && value.algorithm === "Ed25519"
        && validId(value.keyId)
        && Number.isSafeInteger(value.generation)
        && Number(value.generation) >= 1;
}
export function protectedAuditEventDigestV1(event) {
    return sha256(canonicalJson(event));
}
export function protectedAuditEnvelopeDigestV1(envelope) {
    return sha256(canonicalJson(envelope));
}
export function protectedAuditCheckpointDigestV1(checkpoint) {
    return sha256(canonicalJson(checkpoint));
}
export function validateProtectedAuditEventV1(value) {
    if (!exactObject(value, EVENT_KEYS))
        return { outcome: "DENY", issues: ["AUDIT_EVENT_SCHEMA_DENIED"] };
    if (value.schemaVersion !== PROTECTED_AUDIT_EVENT_SCHEMA_V1
        || !validId(value.timelineId)
        || !validId(value.tenant)
        || !validId(value.eventId)
        || !validId(value.actorId)
        || !validId(value.operationId)
        || !validId(value.correlationId)
        || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1
        || !EVENT_KINDS.includes(value.eventKind)
        || !validTime(value.occurredAtMs)
        || !validTime(value.observedAtMs)
        || Number(value.occurredAtMs) > Number(value.observedAtMs)) {
        return { outcome: "DENY", issues: ["AUDIT_EVENT_BINDING_DENIED"] };
    }
    const references = value.references;
    if (!exactObject(references, [...REFERENCE_KEYS].sort())
        || !REFERENCE_KEYS.every((key) => references[key] === null || validDigest(references[key]))) {
        return { outcome: "DENY", issues: ["AUDIT_EVENT_REFERENCES_DENIED"] };
    }
    if (!exactObject(value.facts, FACT_KEYS)
        || !OUTCOMES.includes(value.facts.outcome)
        || !Array.isArray(value.facts.reasonCodes)
        || value.facts.reasonCodes.length > 32
        || !value.facts.reasonCodes.every((item) => typeof item === "string" && /^[A-Z][A-Z0-9_]{2,95}$/.test(item))
        || !sortedUnique(value.facts.reasonCodes)
        || !Array.isArray(value.facts.evidenceDigests)
        || value.facts.evidenceDigests.length > 32
        || !value.facts.evidenceDigests.every(validDigest)
        || !sortedUnique(value.facts.evidenceDigests)) {
        return { outcome: "DENY", issues: ["AUDIT_EVENT_FACTS_DENIED"] };
    }
    const event = value;
    return { outcome: "ALLOW", event, eventDigest: protectedAuditEventDigestV1(event) };
}
function envelopeCore(envelope) {
    return envelope;
}
function checkpointCore(checkpoint) {
    return checkpoint;
}
function signerReference(signer) {
    return { algorithm: signer.algorithm, keyId: signer.keyId, generation: signer.generation };
}
function assertSignerUsable(signer, atMs) {
    if (signer.algorithm !== "Ed25519" || !validId(signer.keyId)
        || !Number.isSafeInteger(signer.generation) || signer.generation < 1
        || !validTime(atMs) || atMs < signer.validFromMs || atMs >= signer.validUntilMs) {
        throw new Error("AUDIT_SIGNER_WINDOW_DENIED");
    }
}
export function createProtectedAuditEnvelopeV1(eventValue, previousEnvelopeDigest, signer, signedAtMs) {
    const validated = validateProtectedAuditEventV1(eventValue);
    if (validated.outcome !== "ALLOW")
        throw new Error(validated.issues[0]);
    if (previousEnvelopeDigest !== null && !validDigest(previousEnvelopeDigest)) {
        throw new Error("AUDIT_PREVIOUS_ENVELOPE_DIGEST_DENIED");
    }
    assertSignerUsable(signer, signedAtMs);
    if (eventValue.observedAtMs > signedAtMs)
        throw new Error("AUDIT_SIGNED_BEFORE_OBSERVATION_DENIED");
    const core = envelopeCore({
        schemaVersion: PROTECTED_AUDIT_ENVELOPE_SCHEMA_V1,
        event: eventValue,
        eventDigest: validated.eventDigest,
        previousEnvelopeDigest,
        signedAtMs,
        signer: signerReference(signer),
    });
    const signatureBase64 = sign(null, Buffer.from(canonicalJson(core)), createPrivateKey(signer.privateKeyPem)).toString("base64");
    return { ...core, signatureBase64 };
}
function createCheckpoint(envelopes, signer, issuedAtMs) {
    if (envelopes.length < 1)
        throw new Error("AUDIT_CHECKPOINT_EMPTY_DENIED");
    const first = envelopes[0];
    const head = envelopes.at(-1);
    if (first === undefined || head === undefined)
        throw new Error("AUDIT_CHECKPOINT_EMPTY_DENIED");
    assertSignerUsable(signer, issuedAtMs);
    if (issuedAtMs < head.signedAtMs)
        throw new Error("AUDIT_CHECKPOINT_CLOCK_DENIED");
    const core = checkpointCore({
        schemaVersion: PROTECTED_AUDIT_CHECKPOINT_SCHEMA_V1,
        timelineId: first.event.timelineId,
        tenant: first.event.tenant,
        eventCount: envelopes.length,
        headEnvelopeDigest: protectedAuditEnvelopeDigestV1(head),
        issuedAtMs,
        signer: signerReference(signer),
    });
    const signatureBase64 = sign(null, Buffer.from(canonicalJson(core)), createPrivateKey(signer.privateKeyPem)).toString("base64");
    return { ...core, signatureBase64 };
}
function keyFor(trust, signer, atMs, issues) {
    const key = trust.keys.find((candidate) => candidate.keyId === signer.keyId && candidate.generation === signer.generation);
    if (key === undefined) {
        issues.push("AUDIT_SIGNER_UNKNOWN_DENIED");
        return undefined;
    }
    if (signer.generation < trust.minimumGeneration || key.status !== "ACTIVE") {
        issues.push("AUDIT_SIGNER_GENERATION_STALE_DENIED");
        return undefined;
    }
    if (key.algorithm !== "Ed25519" || atMs < key.validFromMs || atMs >= key.validUntilMs) {
        issues.push("AUDIT_SIGNER_WINDOW_DENIED");
        return undefined;
    }
    return key;
}
function validateEnvelopeShape(value) {
    return exactObject(value, ENVELOPE_KEYS)
        && value.schemaVersion === PROTECTED_AUDIT_ENVELOPE_SCHEMA_V1
        && validDigest(value.eventDigest)
        && (value.previousEnvelopeDigest === null || validDigest(value.previousEnvelopeDigest))
        && validTime(value.signedAtMs)
        && validSignerReference(value.signer)
        && typeof value.signatureBase64 === "string"
        && /^[A-Za-z0-9+/]+={0,2}$/.test(value.signatureBase64);
}
function validateCheckpointShape(value) {
    return exactObject(value, CHECKPOINT_KEYS)
        && value.schemaVersion === PROTECTED_AUDIT_CHECKPOINT_SCHEMA_V1
        && validId(value.timelineId)
        && validId(value.tenant)
        && Number.isSafeInteger(value.eventCount) && Number(value.eventCount) >= 1
        && validDigest(value.headEnvelopeDigest)
        && validTime(value.issuedAtMs)
        && validSignerReference(value.signer)
        && typeof value.signatureBase64 === "string"
        && /^[A-Za-z0-9+/]+={0,2}$/.test(value.signatureBase64);
}
function verifySignature(core, signatureBase64, publicKeyPem) {
    try {
        const signature = Buffer.from(signatureBase64, "base64");
        return signature.length > 0
            && signature.toString("base64") === signatureBase64
            && verify(null, Buffer.from(canonicalJson(core)), createPublicKey(publicKeyPem), signature);
    }
    catch {
        return false;
    }
}
function pushUnique(issues, issue) {
    if (!issues.includes(issue))
        issues.push(issue);
}
function causalIssues(event, priorByKind) {
    const issues = [];
    for (const key of REQUIRED_REFERENCES[event.eventKind]) {
        if (event.references[key] === null)
            pushUnique(issues, "AUDIT_CAUSAL_LINK_MISSING_DENIED");
    }
    for (const key of REFERENCE_KEYS) {
        const reference = event.references[key];
        if (reference === null)
            continue;
        if (priorByKind.get(KIND_BY_REFERENCE[key]) !== reference) {
            pushUnique(issues, "AUDIT_CAUSAL_REFERENCE_MISMATCH_DENIED");
        }
    }
    return issues;
}
export function verifyProtectedAuditTimelineV1(envelopeValues, checkpointValue, trust) {
    const issues = [];
    if (!validateCheckpointShape(checkpointValue)) {
        return { outcome: "UNVERIFIABLE", issues: ["AUDIT_CHECKPOINT_SCHEMA_DENIED"], facts: [] };
    }
    const checkpoint = checkpointValue;
    if (checkpoint.timelineId !== trust.timelineId || checkpoint.tenant !== trust.tenant) {
        pushUnique(issues, "AUDIT_CHECKPOINT_SCOPE_DENIED");
    }
    const checkpointKey = keyFor(trust, checkpoint.signer, checkpoint.issuedAtMs, issues);
    if (checkpointKey !== undefined) {
        const { signatureBase64: _signature, ...core } = checkpoint;
        if (!verifySignature(core, checkpoint.signatureBase64, checkpointKey.publicKeyPem)) {
            pushUnique(issues, "AUDIT_CHECKPOINT_SIGNATURE_DENIED");
        }
    }
    if (envelopeValues.length !== checkpoint.eventCount) {
        pushUnique(issues, "AUDIT_CHECKPOINT_COUNT_MISMATCH_DENIED");
    }
    const facts = [];
    const priorByKind = new Map();
    const eventIds = new Set();
    let priorEnvelopeDigest = null;
    let priorSignedAt = -1;
    let priorOccurredAt = -1;
    let priorObservedAt = -1;
    let operationId;
    let correlationId;
    for (let index = 0; index < envelopeValues.length; index += 1) {
        const candidate = envelopeValues[index];
        if (!validateEnvelopeShape(candidate)) {
            pushUnique(issues, "AUDIT_ENVELOPE_SCHEMA_DENIED");
            continue;
        }
        const validated = validateProtectedAuditEventV1(candidate.event);
        if (validated.outcome !== "ALLOW") {
            for (const issue of validated.issues)
                pushUnique(issues, issue);
            continue;
        }
        const event = validated.event;
        if (candidate.eventDigest !== validated.eventDigest)
            pushUnique(issues, "AUDIT_EVENT_DIGEST_MISMATCH_DENIED");
        if (event.timelineId !== checkpoint.timelineId || event.tenant !== checkpoint.tenant) {
            pushUnique(issues, "AUDIT_EVENT_SCOPE_DENIED");
        }
        if (event.sequence !== index + 1)
            pushUnique(issues, "AUDIT_SEQUENCE_DENIED");
        if (index === 0 && event.eventKind !== "IDENTITY")
            pushUnique(issues, "AUDIT_IDENTITY_ROOT_MISSING_DENIED");
        if (candidate.previousEnvelopeDigest !== priorEnvelopeDigest)
            pushUnique(issues, "AUDIT_ENVELOPE_CHAIN_DENIED");
        if (candidate.signedAtMs <= priorSignedAt || event.occurredAtMs < priorOccurredAt
            || event.observedAtMs < priorObservedAt || event.observedAtMs > candidate.signedAtMs) {
            pushUnique(issues, "AUDIT_CLOCK_ROLLBACK_DENIED");
        }
        if (eventIds.has(event.eventId))
            pushUnique(issues, "AUDIT_EVENT_REPLAY_DUPLICATE_DENIED");
        if (priorByKind.has(event.eventKind))
            pushUnique(issues, "AUDIT_EVENT_KIND_DUPLICATE_DENIED");
        if (operationId !== undefined && event.operationId !== operationId)
            pushUnique(issues, "AUDIT_OPERATION_BINDING_DENIED");
        if (correlationId !== undefined && event.correlationId !== correlationId)
            pushUnique(issues, "AUDIT_CORRELATION_BINDING_DENIED");
        for (const issue of causalIssues(event, priorByKind))
            pushUnique(issues, issue);
        const key = keyFor(trust, candidate.signer, candidate.signedAtMs, issues);
        if (key !== undefined) {
            const { signatureBase64: _signature, ...core } = candidate;
            if (!verifySignature(core, candidate.signatureBase64, key.publicKeyPem)) {
                pushUnique(issues, "AUDIT_ENVELOPE_SIGNATURE_DENIED");
            }
        }
        facts.push({
            sequence: event.sequence,
            eventId: event.eventId,
            eventKind: event.eventKind,
            eventDigest: validated.eventDigest,
            outcome: event.facts.outcome,
            reasonCodes: [...event.facts.reasonCodes],
            references: { ...event.references },
        });
        eventIds.add(event.eventId);
        priorByKind.set(event.eventKind, validated.eventDigest);
        priorEnvelopeDigest = protectedAuditEnvelopeDigestV1(candidate);
        priorSignedAt = candidate.signedAtMs;
        priorOccurredAt = event.occurredAtMs;
        priorObservedAt = event.observedAtMs;
        operationId ??= event.operationId;
        correlationId ??= event.correlationId;
    }
    if (priorEnvelopeDigest !== checkpoint.headEnvelopeDigest)
        pushUnique(issues, "AUDIT_CHECKPOINT_HEAD_MISMATCH_DENIED");
    if (checkpoint.issuedAtMs < priorSignedAt)
        pushUnique(issues, "AUDIT_CHECKPOINT_CLOCK_DENIED");
    if (issues.length > 0)
        return { outcome: "UNVERIFIABLE", issues, facts: [] };
    return {
        outcome: "VERIFIED",
        timelineId: checkpoint.timelineId,
        tenant: checkpoint.tenant,
        checkpointDigest: protectedAuditCheckpointDigestV1(checkpoint),
        facts,
    };
}
export function explainProtectedAuditTimelineV1(envelopeValues, checkpointValue, trust) {
    const verification = verifyProtectedAuditTimelineV1(envelopeValues, checkpointValue, trust);
    if (verification.outcome !== "VERIFIED") {
        return {
            schemaVersion: PROTECTED_AUDIT_EXPLANATION_SCHEMA_V1,
            status: "UNVERIFIABLE",
            summary: `UNVERIFIABLE protected timeline: ${verification.issues.join(",")}`,
            issues: verification.issues,
            stages: [],
        };
    }
    const terminal = verification.facts.at(-1);
    const success = terminal !== undefined
        && ((terminal.eventKind === "READBACK" && terminal.outcome === "COMMITTED")
            || (terminal.eventKind === "RECONCILE" && terminal.outcome === "RECONCILED")
            || (terminal.eventKind === "ROLLBACK" && terminal.outcome === "ROLLED_BACK"));
    return {
        schemaVersion: PROTECTED_AUDIT_EXPLANATION_SCHEMA_V1,
        status: success ? "VERIFIED_SUCCESS" : "VERIFIED_NON_SUCCESS",
        summary: terminal === undefined
            ? "VERIFIED_NON_SUCCESS: no protected facts"
            : `${success ? "VERIFIED_SUCCESS" : "VERIFIED_NON_SUCCESS"} ${terminal.eventKind} ${terminal.outcome}; ${verification.facts.length} protected facts; checkpoint ${verification.checkpointDigest}`,
        issues: [],
        stages: verification.facts,
    };
}
export class ProtectedAuditWriterV1 {
    #timelineId;
    #tenant;
    #signer;
    #envelopes = [];
    #eventsById = new Map();
    constructor(timelineId, tenant, signer) {
        if (!validId(timelineId) || !validId(tenant))
            throw new Error("AUDIT_WRITER_SCOPE_DENIED");
        this.#timelineId = timelineId;
        this.#tenant = tenant;
        this.#signer = signer;
    }
    append(eventValue, signedAtMs) {
        const validated = validateProtectedAuditEventV1(eventValue);
        if (validated.outcome !== "ALLOW")
            throw new Error(validated.issues[0]);
        const existing = this.#eventsById.get(eventValue.eventId);
        if (existing !== undefined) {
            if (existing.digest !== validated.eventDigest)
                throw new Error("AUDIT_EVENT_REPLAY_CONFLICT_DENIED");
            return { replay: "SAME_ENVELOPE", envelope: structuredClone(existing.envelope) };
        }
        if (eventValue.timelineId !== this.#timelineId || eventValue.tenant !== this.#tenant) {
            throw new Error("AUDIT_WRITER_SCOPE_DENIED");
        }
        if (eventValue.sequence !== this.#envelopes.length + 1)
            throw new Error("AUDIT_SEQUENCE_DENIED");
        if (this.#envelopes.length === 0 && eventValue.eventKind !== "IDENTITY") {
            throw new Error("AUDIT_IDENTITY_ROOT_MISSING_DENIED");
        }
        const priorByKind = new Map(this.#envelopes.map((envelope) => [envelope.event.eventKind, envelope.eventDigest]));
        if (priorByKind.has(eventValue.eventKind))
            throw new Error("AUDIT_EVENT_KIND_DUPLICATE_DENIED");
        const causal = causalIssues(eventValue, priorByKind);
        if (causal[0] !== undefined)
            throw new Error(causal[0]);
        const previous = this.#envelopes.at(-1);
        if (previous !== undefined) {
            if (eventValue.operationId !== previous.event.operationId)
                throw new Error("AUDIT_OPERATION_BINDING_DENIED");
            if (eventValue.correlationId !== previous.event.correlationId)
                throw new Error("AUDIT_CORRELATION_BINDING_DENIED");
            if (eventValue.occurredAtMs < previous.event.occurredAtMs
                || eventValue.observedAtMs < previous.event.observedAtMs
                || signedAtMs <= previous.signedAtMs)
                throw new Error("AUDIT_CLOCK_ROLLBACK_DENIED");
        }
        const envelope = createProtectedAuditEnvelopeV1(eventValue, previous === undefined ? null : protectedAuditEnvelopeDigestV1(previous), this.#signer, signedAtMs);
        this.#envelopes.push(envelope);
        this.#eventsById.set(eventValue.eventId, { digest: validated.eventDigest, envelope });
        return { replay: "FIRST", envelope: structuredClone(envelope) };
    }
    snapshot() {
        return structuredClone(this.#envelopes);
    }
    checkpoint(issuedAtMs) {
        return createCheckpoint(this.#envelopes, this.#signer, issuedAtMs);
    }
}
export function createSyntheticProtectedAuditSignerV1(options = {}) {
    const pair = generateKeyPairSync("ed25519");
    return {
        keyId: options.keyId ?? "audit_key:fixture-001",
        generation: options.generation ?? 1,
        algorithm: "Ed25519",
        privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
        validFromMs: options.validFromMs ?? 1_780_000_000_000,
        validUntilMs: options.validUntilMs ?? 1_790_000_000_000,
    };
}
function emptyReferences() {
    return {
        identity: null, intent: null, plan: null, policy: null, approval: null,
        budget: null, effect: null, readback: null, reconcile: null, stop: null,
    };
}
export function syntheticProtectedAuditTimelineV1(options = {}) {
    const signer = options.signer ?? createSyntheticProtectedAuditSignerV1();
    const timelineId = "timeline:aas023-fixture";
    const tenant = "tenant:panskys-zoo";
    const writer = new ProtectedAuditWriterV1(timelineId, tenant, signer);
    const kinds = [
        "IDENTITY", "INTENT", "PLAN", "POLICY", "APPROVAL", "BUDGET", "EFFECT", "READBACK",
    ];
    const outcomes = [
        "OBSERVED", "OBSERVED", "COMMITTED", "ALLOW", "ALLOW", "ALLOW", "COMMITTED", "COMMITTED",
    ];
    const byKind = new Map();
    const base = 1_785_000_000_000;
    for (const [index, kind] of kinds.entries()) {
        const references = emptyReferences();
        for (const key of REFERENCE_KEYS) {
            references[key] = byKind.get(KIND_BY_REFERENCE[key]) ?? null;
        }
        const sequence = index + 1;
        const event = {
            schemaVersion: PROTECTED_AUDIT_EVENT_SCHEMA_V1,
            timelineId,
            tenant,
            sequence,
            eventId: `event:${String(sequence).padStart(8, "0")}`,
            eventKind: kind,
            actorId: kind === "APPROVAL" ? "owner:fixture-owner" : "workload:admin-ai",
            operationId: "operation:audit-fixture",
            correlationId: "correlation:audit-fixture",
            occurredAtMs: base + sequence * 10,
            observedAtMs: base + sequence * 10 + 1,
            references,
            facts: {
                outcome: outcomes[index] ?? "OBSERVED",
                reasonCodes: [`AAS023_${kind}_VERIFIED`],
                evidenceDigests: [sha256(`${kind}:synthetic-evidence`)],
            },
        };
        const appended = writer.append(event, base + sequence * 10 + 2);
        byKind.set(kind, appended.envelope.eventDigest);
    }
    const envelopes = writer.snapshot();
    const checkpoint = writer.checkpoint(base + 100);
    const trust = {
        tenant,
        timelineId,
        minimumGeneration: options.minimumGeneration ?? signer.generation,
        keys: [{
                keyId: signer.keyId,
                generation: signer.generation,
                algorithm: "Ed25519",
                publicKeyPem: signer.publicKeyPem,
                validFromMs: signer.validFromMs,
                validUntilMs: signer.validUntilMs,
                status: "ACTIVE",
            }],
    };
    return { signer, trust, writer, envelopes, checkpoint };
}
