import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const CAPABILITY_CATALOGUE_API_VERSION = "chimpmaera.security/capability-catalogue/v1";
export const CAPABILITY_ACTION_API_VERSION = "chimpmaera.security/capability-action/v1";
export const CAPABILITY_ACTIVATION_API_VERSION = "chimpmaera.security/capability-activation/v1";
export const CAPABILITY_POLICY_BINDING_API_VERSION = "chimpmaera.security/capability-policy-binding/v1";
export const CAPABILITY_EXECUTION_REQUEST_API_VERSION = "chimpmaera.security/capability-execution-request/v1";
export const CAPABILITY_GATEWAY_DECISION_API_VERSION = "chimpmaera.security/capability-gateway-decision/v1";
export const CAPABILITY_BROKER_RECEIPT_API_VERSION = "chimpmaera.security/capability-broker-receipt/v1";
export const SYNTHETIC_CAPABILITY_CATALOGUE_ID = "chimpmaera.local/synthetic-actions";
export const SYNTHETIC_CAPABILITY_CATALOGUE_VERSION = "1.0.0";
export const CAPABILITY_DECISION_ISSUES_V1 = [
    "ACTION_DIGEST_MISMATCH_DENIED",
    "ACTION_INACTIVE_DENIED",
    "ACTION_SCHEMA_INVALID_DENIED",
    "ACTION_UNKNOWN_DENIED",
    "ACTION_VERSION_STALE_DENIED",
    "ACTIVATION_AUTHORIZATION_INVALID_DENIED",
    "ACTIVATION_STALE_DENIED",
    "BROKER_DECISION_INVALID_DENIED",
    "CATALOGUE_DIGEST_MISMATCH_DENIED",
    "CATALOGUE_SCHEMA_INVALID_DENIED",
    "CATALOGUE_VERSION_STALE_DENIED",
    "CORRELATION_MISSING_DENIED",
    "CROSS_TENANT_DENIED",
    "EVIDENCE_SINK_MISSING_DENIED",
    "IDENTITY_MISSING_DENIED",
    "POLICY_BINDING_MISMATCH_DENIED",
    "POLICY_MISSING_DENIED",
    "POLICY_STALE_DENIED",
    "PREPARED_EFFECT_INVALID_DENIED",
    "REPLAY_CONSUMED_DENIED",
    "REPLAY_IN_FLIGHT_DENIED",
    "REQUEST_RESOURCE_DENIED",
    "REQUEST_SCHEMA_INVALID_DENIED",
    "REQUEST_SNAPSHOT_INVALID_DENIED",
    "RESOURCE_BOUNDS_DENIED",
    "RESPONSE_SCHEMA_INVALID_DENIED",
    "SYNTHETIC_COMMIT_AMBIGUOUS_CONSUMED",
];
const ACTION_IDS = ["crm.contact.create", "erp.order.create", "employee.directory.read_own"];
const CATALOGUE_KEYS = [
    "actions", "activationDefault", "catalogueId", "digest", "schemaVersion", "version",
];
const ACTION_KEYS = [
    "activationState", "actionId", "digest", "evidenceContract", "limitations", "requestSchema",
    "resource", "resourceBounds", "responseSchema", "schemaVersion", "version",
];
const ACTIVATION_KEYS = [
    "actionDigest", "actionId", "actionVersion", "activationId", "activationState", "authorizedAt",
    "catalogueDigest", "catalogueVersion", "digest", "expiresAt", "maintainerId", "schemaVersion", "tenant",
];
const POLICY_KEYS = [
    "actionIds", "digest", "expiresAt", "maintainerIds", "policyId", "schemaVersion",
    "tenant", "validFrom", "version",
];
const REQUEST_KEYS = [
    "actionDigest", "actionId", "actionVersion", "catalogueDigest", "catalogueVersion", "correlationId",
    "evidenceSink", "policyDigest", "request", "requestId", "resource", "schemaVersion", "tenant",
    "userIdentity", "workloadIdentity",
];
const GATEWAY_CORE_KEYS = [
    "actionDigest", "actionId", "actionVersion", "catalogueDigest", "catalogueVersion", "correlationDigest",
    "issues", "outcome", "requestDigest", "schemaVersion", "stage", "ticket",
];
const TICKET_KEYS = [
    "actionDigest", "actionId", "actionVersion", "activationDigest", "catalogueDigest", "catalogueVersion",
    "correlationDigest", "evidenceSink", "policyDigest", "policyId", "policyVersion", "request",
    "requestDigest", "requestId", "tenant",
];
const LIMITATIONS = [
    "LOCAL_SYNTHETIC_VALIDATION_ONLY",
    "NO_LIVE_PROVIDER_OR_CREDENTIAL_USE",
    "CATALOGUE_ADMISSION_DOES_NOT_ESTABLISH_SAFETY",
    "SYNCHRONOUS_PREPARE_BOUND_ONLY_NO_CANCELLATION",
    "IN_MEMORY_REPLAY_RESERVATION_ONLY",
];
const BOUNDS = {
    maxRequestBytes: 512,
    maxResponseBytes: 512,
    maxExecutionMs: 1000,
    maxInvocations: 1,
};
const EVIDENCE_CONTRACT = {
    required: true,
    allowedSinkTypes: ["SYNTHETIC_MEMORY"],
    receiptSchemaVersion: CAPABILITY_BROKER_RECEIPT_API_VERSION,
    correlationMode: "SHA256_SANITIZED",
};
const CRM_REQUEST_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["email", "name"],
    properties: {
        email: { type: "string", minLength: 3, maxLength: 120, pattern: "^[^@\\s]+@example\\.test$" },
        name: { type: "string", minLength: 1, maxLength: 80 },
    },
};
const CRM_RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["contactId"],
    properties: { contactId: { type: "string", pattern: "^synthetic-contact-[0-9]{3}$" } },
};
const ERP_REQUEST_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["quantity", "sku"],
    properties: {
        quantity: { type: "integer", minimum: 1, maximum: 100 },
        sku: { type: "string", minLength: 3, maxLength: 32, pattern: "^SYN-[A-Z0-9-]+$" },
    },
};
const ERP_RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["orderId"],
    properties: { orderId: { type: "string", pattern: "^synthetic-order-[0-9]{3}$" } },
};
const EMPLOYEE_DIRECTORY_REQUEST_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["userId"],
    properties: { userId: { type: "string", minLength: 6, maxLength: 80, pattern: "^user:[a-z0-9-]+$" } },
};
const EMPLOYEE_DIRECTORY_RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["displayName"],
    properties: { displayName: { type: "string", minLength: 1, maxLength: 80 } },
};
const ACTION_SPEC = {
    "crm.contact.create": {
        resource: "synthetic.crm.contact",
        requestSchema: CRM_REQUEST_SCHEMA,
        responseSchema: CRM_RESPONSE_SCHEMA,
    },
    "erp.order.create": {
        resource: "synthetic.erp.order",
        requestSchema: ERP_REQUEST_SCHEMA,
        responseSchema: ERP_RESPONSE_SCHEMA,
    },
    "employee.directory.read_own": {
        resource: "employee.directory.own",
        requestSchema: EMPLOYEE_DIRECTORY_REQUEST_SCHEMA,
        responseSchema: EMPLOYEE_DIRECTORY_RESPONSE_SCHEMA,
    },
};
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function digestOrNull(value) {
    try {
        return digest(value);
    }
    catch {
        return null;
    }
}
function isRecord(value) {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, expected) {
    return isRecord(value)
        && canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isBoundId(value, prefix) {
    return typeof value === "string"
        && new RegExp(`^${prefix}:[a-z0-9][a-z0-9._-]{2,63}$`).test(value);
}
function isCorrelationId(value) {
    return isBoundId(value, "correlation")
        || (typeof value === "string" && /^corr-aas035-[a-z0-9-]{8,64}$/.test(value));
}
function isTimestamp(value) {
    return typeof value === "string"
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
        && Number.isFinite(Date.parse(value));
}
function withoutDigest(value) {
    const { digest: _ignored, ...core } = value;
    return core;
}
function actionMaterial(actionId) {
    const spec = ACTION_SPEC[actionId];
    return {
        schemaVersion: CAPABILITY_ACTION_API_VERSION,
        actionId,
        version: "1.0.0",
        resource: spec.resource,
        requestSchema: spec.requestSchema,
        responseSchema: spec.responseSchema,
        resourceBounds: BOUNDS,
        evidenceContract: EVIDENCE_CONTRACT,
        limitations: LIMITATIONS,
        activationState: "INACTIVE",
    };
}
function expectedAction(actionId) {
    const core = actionMaterial(actionId);
    return { ...core, digest: digest(core) };
}
function validStrictSchema(value) {
    if (!exactKeys(value, ["additionalProperties", "properties", "required", "type"]))
        return false;
    if (value.type !== "object" || value.additionalProperties !== false || !isRecord(value.properties))
        return false;
    if (!Array.isArray(value.required)
        || value.required.some((key) => typeof key !== "string")
        || new Set(value.required).size !== value.required.length)
        return false;
    return canonicalJson([...value.required].sort()) === canonicalJson(Object.keys(value.properties).sort());
}
function validateJson(schema, value) {
    if (!isRecord(value))
        return false;
    const keys = Object.keys(value).sort();
    if (canonicalJson(keys) !== canonicalJson([...schema.required].sort()))
        return false;
    return keys.every((key) => {
        const rule = schema.properties[key];
        const item = value[key];
        if (rule === undefined)
            return false;
        if (rule.type === "string") {
            if (typeof item !== "string")
                return false;
            if (typeof rule.minLength === "number" && item.length < rule.minLength)
                return false;
            if (typeof rule.maxLength === "number" && item.length > rule.maxLength)
                return false;
            return typeof rule.pattern !== "string" || new RegExp(rule.pattern).test(item);
        }
        if (rule.type === "integer") {
            return Number.isSafeInteger(item)
                && (typeof rule.minimum !== "number" || Number(item) >= rule.minimum)
                && (typeof rule.maximum !== "number" || Number(item) <= rule.maximum);
        }
        return false;
    });
}
function validAction(value) {
    if (!exactKeys(value, ACTION_KEYS)
        || value.schemaVersion !== CAPABILITY_ACTION_API_VERSION
        || !ACTION_IDS.includes(value.actionId)
        || value.version !== "1.0.0"
        || value.activationState !== "INACTIVE"
        || !isDigest(value.digest)
        || !validStrictSchema(value.requestSchema)
        || !validStrictSchema(value.responseSchema))
        return false;
    const expected = expectedAction(value.actionId);
    return canonicalJson(value) === canonicalJson(expected)
        && digest(withoutDigest(value)) === value.digest;
}
export function verifyCapabilityCatalogueV1(value) {
    if (!exactKeys(value, CATALOGUE_KEYS)
        || value.schemaVersion !== CAPABILITY_CATALOGUE_API_VERSION
        || value.catalogueId !== SYNTHETIC_CAPABILITY_CATALOGUE_ID
        || value.version !== SYNTHETIC_CAPABILITY_CATALOGUE_VERSION
        || value.activationDefault !== "INACTIVE"
        || !isDigest(value.digest)
        || !Array.isArray(value.actions)
        || value.actions.length !== ACTION_IDS.length
        || !value.actions.every(validAction))
        throw new Error("CATALOGUE_SCHEMA_INVALID_DENIED");
    const actions = value.actions;
    if (new Set(actions.map(({ actionId }) => actionId)).size !== ACTION_IDS.length
        || canonicalJson(actions.map(({ actionId }) => actionId)) !== canonicalJson(ACTION_IDS)
        || digest(withoutDigest(value)) !== value.digest) {
        throw new Error("CATALOGUE_DIGEST_MISMATCH_DENIED");
    }
    return value;
}
export function syntheticCapabilityCatalogueV1() {
    const core = {
        schemaVersion: CAPABILITY_CATALOGUE_API_VERSION,
        catalogueId: SYNTHETIC_CAPABILITY_CATALOGUE_ID,
        version: SYNTHETIC_CAPABILITY_CATALOGUE_VERSION,
        activationDefault: "INACTIVE",
        actions: ACTION_IDS.map(expectedAction),
    };
    return { ...core, digest: digest(core) };
}
export function verifyCapabilityPolicyBindingV1(value, observedAt) {
    if (!exactKeys(value, POLICY_KEYS)
        || value.schemaVersion !== CAPABILITY_POLICY_BINDING_API_VERSION
        || !isBoundId(value.policyId, "policy")
        || value.version !== "1.0.0"
        || !isDigest(value.digest)
        || !isBoundId(value.tenant, "tenant")
        || !Array.isArray(value.actionIds)
        || canonicalJson(value.actionIds) !== canonicalJson(ACTION_IDS)
        || !Array.isArray(value.maintainerIds)
        || value.maintainerIds.length === 0
        || value.maintainerIds.some((id) => !isBoundId(id, "maintainer"))
        || new Set(value.maintainerIds).size !== value.maintainerIds.length
        || !isTimestamp(value.validFrom)
        || !isTimestamp(value.expiresAt)
        || digest(withoutDigest(value)) !== value.digest) {
        throw new Error("POLICY_BINDING_MISMATCH_DENIED");
    }
    if (!isTimestamp(observedAt)
        || Date.parse(value.validFrom) > Date.parse(observedAt)
        || Date.parse(value.expiresAt) <= Date.parse(observedAt)) {
        throw new Error("POLICY_STALE_DENIED");
    }
    return value;
}
export function syntheticCapabilityPolicyBindingV1() {
    const core = {
        schemaVersion: CAPABILITY_POLICY_BINDING_API_VERSION,
        policyId: "policy:synthetic-safe-guided",
        version: "1.0.0",
        tenant: "tenant:synthetic-zoo",
        actionIds: [...ACTION_IDS],
        maintainerIds: ["maintainer:synthetic-reviewer"],
        validFrom: "2026-08-09T10:00:00Z",
        expiresAt: "2026-08-10T10:00:00Z",
    };
    return { ...core, digest: digest(core) };
}
export function verifyCapabilityActivationV1(value, catalogue, policy, observedAt) {
    if (!exactKeys(value, ACTIVATION_KEYS)
        || value.schemaVersion !== CAPABILITY_ACTIVATION_API_VERSION
        || value.activationState !== "ACTIVE"
        || !isBoundId(value.activationId, "activation")
        || !isBoundId(value.tenant, "tenant")
        || !isBoundId(value.maintainerId, "maintainer")
        || !isTimestamp(value.authorizedAt)
        || !isTimestamp(value.expiresAt)
        || !isDigest(value.digest)
        || digest(withoutDigest(value)) !== value.digest) {
        throw new Error("ACTIVATION_AUTHORIZATION_INVALID_DENIED");
    }
    if (value.tenant !== policy.tenant)
        throw new Error("CROSS_TENANT_DENIED");
    if (!policy.maintainerIds.includes(value.maintainerId)) {
        throw new Error("ACTIVATION_AUTHORIZATION_INVALID_DENIED");
    }
    if (!isTimestamp(observedAt)
        || Date.parse(value.authorizedAt) > Date.parse(observedAt)
        || Date.parse(value.expiresAt) <= Date.parse(observedAt))
        throw new Error("ACTIVATION_STALE_DENIED");
    const action = catalogue.actions.find(({ actionId }) => actionId === value.actionId);
    if (value.catalogueVersion !== catalogue.version)
        throw new Error("CATALOGUE_VERSION_STALE_DENIED");
    if (value.catalogueDigest !== catalogue.digest)
        throw new Error("CATALOGUE_DIGEST_MISMATCH_DENIED");
    if (action === undefined)
        throw new Error("ACTION_UNKNOWN_DENIED");
    if (value.actionVersion !== action.version)
        throw new Error("ACTION_VERSION_STALE_DENIED");
    if (value.actionDigest !== action.digest)
        throw new Error("ACTION_DIGEST_MISMATCH_DENIED");
    return value;
}
export function syntheticCapabilityActivationV1(catalogue, actionId = "crm.contact.create") {
    const action = catalogue.actions.find((candidate) => candidate.actionId === actionId);
    if (action === undefined)
        throw new Error("ACTION_UNKNOWN_DENIED");
    const core = {
        schemaVersion: CAPABILITY_ACTIVATION_API_VERSION,
        activationId: "activation:synthetic-maintainer-001",
        catalogueVersion: catalogue.version,
        catalogueDigest: catalogue.digest,
        actionId: action.actionId,
        actionVersion: action.version,
        actionDigest: action.digest,
        tenant: "tenant:synthetic-zoo",
        maintainerId: "maintainer:synthetic-reviewer",
        authorizedAt: "2026-08-09T10:00:00Z",
        expiresAt: "2026-08-10T10:00:00Z",
        activationState: "ACTIVE",
    };
    return { ...core, digest: digest(core) };
}
function issueFrom(error) {
    const message = error instanceof Error ? error.message : "CATALOGUE_SCHEMA_INVALID_DENIED";
    return CAPABILITY_DECISION_ISSUES_V1.includes(message)
        ? message
        : "CATALOGUE_SCHEMA_INVALID_DENIED";
}
function requestReadback(value) {
    const candidate = isRecord(value) ? value : {};
    return {
        catalogueVersion: typeof candidate.catalogueVersion === "string" ? candidate.catalogueVersion : null,
        catalogueDigest: typeof candidate.catalogueDigest === "string" ? candidate.catalogueDigest : null,
        actionId: typeof candidate.actionId === "string" ? candidate.actionId : null,
        actionVersion: typeof candidate.actionVersion === "string" ? candidate.actionVersion : null,
        actionDigest: typeof candidate.actionDigest === "string" ? candidate.actionDigest : null,
        correlationDigest: typeof candidate.correlationId === "string" ? digest(candidate.correlationId) : null,
        requestDigest: digestOrNull(candidate.request),
    };
}
function makeGatewayDecision(core) {
    return { ...core, decisionDigest: digest(core) };
}
function denyGateway(value, issues) {
    return makeGatewayDecision({
        schemaVersion: CAPABILITY_GATEWAY_DECISION_API_VERSION,
        stage: "GATEWAY",
        outcome: "DENY",
        ...requestReadback(value),
        ticket: null,
        issues: [...new Set(issues)].sort(),
    });
}
export function admitCapabilityExecutionAtGatewayV1(catalogueValue, activationValue, policyValue, requestValue, observedAt) {
    const preIssues = [];
    if (!isRecord(requestValue) || requestValue.policyDigest === undefined)
        preIssues.push("POLICY_MISSING_DENIED");
    if (!isRecord(requestValue) || requestValue.workloadIdentity === undefined || requestValue.userIdentity === undefined) {
        preIssues.push("IDENTITY_MISSING_DENIED");
    }
    if (!isRecord(requestValue) || requestValue.correlationId === undefined || requestValue.requestId === undefined) {
        preIssues.push("CORRELATION_MISSING_DENIED");
    }
    if (!isRecord(requestValue) || requestValue.evidenceSink === undefined)
        preIssues.push("EVIDENCE_SINK_MISSING_DENIED");
    if (policyValue === null || policyValue === undefined)
        preIssues.push("POLICY_MISSING_DENIED");
    if (!exactKeys(requestValue, REQUEST_KEYS))
        preIssues.push("REQUEST_SCHEMA_INVALID_DENIED");
    if (preIssues.length > 0 || !isRecord(requestValue))
        return denyGateway(requestValue, preIssues);
    let catalogue;
    try {
        catalogue = verifyCapabilityCatalogueV1(catalogueValue);
    }
    catch (error) {
        return denyGateway(requestValue, [issueFrom(error)]);
    }
    let policy;
    try {
        policy = verifyCapabilityPolicyBindingV1(policyValue, observedAt);
    }
    catch (error) {
        return denyGateway(requestValue, [issueFrom(error)]);
    }
    const candidate = requestValue;
    if (candidate.schemaVersion !== CAPABILITY_EXECUTION_REQUEST_API_VERSION
        || !isDigest(candidate.policyDigest)
        || !isBoundId(candidate.tenant, "tenant")
        || !isBoundId(candidate.workloadIdentity, "workload")
        || !isBoundId(candidate.userIdentity, "user")
        || !isCorrelationId(candidate.correlationId)
        || !isBoundId(candidate.requestId, "request")
        || !exactKeys(candidate.evidenceSink, ["sinkId", "type"])
        || candidate.evidenceSink.type !== "SYNTHETIC_MEMORY"
        || !isBoundId(candidate.evidenceSink.sinkId, "evidence")) {
        return denyGateway(requestValue, ["REQUEST_SCHEMA_INVALID_DENIED"]);
    }
    if (candidate.catalogueVersion !== catalogue.version)
        return denyGateway(requestValue, ["CATALOGUE_VERSION_STALE_DENIED"]);
    if (candidate.catalogueDigest !== catalogue.digest)
        return denyGateway(requestValue, ["CATALOGUE_DIGEST_MISMATCH_DENIED"]);
    const action = catalogue.actions.find(({ actionId }) => actionId === candidate.actionId);
    if (action === undefined)
        return denyGateway(requestValue, ["ACTION_UNKNOWN_DENIED"]);
    if (candidate.actionVersion !== action.version)
        return denyGateway(requestValue, ["ACTION_VERSION_STALE_DENIED"]);
    if (candidate.actionDigest !== action.digest)
        return denyGateway(requestValue, ["ACTION_DIGEST_MISMATCH_DENIED"]);
    if (candidate.resource !== action.resource)
        return denyGateway(requestValue, ["REQUEST_RESOURCE_DENIED"]);
    if (candidate.tenant !== policy.tenant)
        return denyGateway(requestValue, ["CROSS_TENANT_DENIED"]);
    if (!policy.actionIds.includes(action.actionId) || candidate.policyDigest !== policy.digest) {
        return denyGateway(requestValue, ["POLICY_BINDING_MISMATCH_DENIED"]);
    }
    let activation;
    try {
        activation = verifyCapabilityActivationV1(activationValue, catalogue, policy, observedAt);
    }
    catch (error) {
        return denyGateway(requestValue, [issueFrom(error)]);
    }
    if (activation.actionId !== action.actionId)
        return denyGateway(requestValue, ["ACTION_INACTIVE_DENIED"]);
    if (!validateJson(action.requestSchema, candidate.request))
        return denyGateway(requestValue, ["REQUEST_SCHEMA_INVALID_DENIED"]);
    if (Buffer.byteLength(canonicalJson(candidate.request)) > action.resourceBounds.maxRequestBytes) {
        return denyGateway(requestValue, ["RESOURCE_BOUNDS_DENIED"]);
    }
    const readback = requestReadback(candidate);
    const ticket = {
        catalogueVersion: catalogue.version,
        catalogueDigest: catalogue.digest,
        actionId: action.actionId,
        actionVersion: action.version,
        actionDigest: action.digest,
        activationDigest: activation.digest,
        policyId: policy.policyId,
        policyVersion: policy.version,
        policyDigest: policy.digest,
        tenant: candidate.tenant,
        correlationDigest: readback.correlationDigest ?? digest("correlation:invalid"),
        requestId: candidate.requestId,
        requestDigest: readback.requestDigest ?? digest(null),
        evidenceSink: candidate.evidenceSink,
        request: candidate.request,
    };
    return makeGatewayDecision({
        schemaVersion: CAPABILITY_GATEWAY_DECISION_API_VERSION,
        stage: "GATEWAY",
        outcome: "ALLOW",
        ...readback,
        ticket,
        issues: [],
    });
}
export function verifyCapabilityGatewayDecisionV1(value) {
    if (!exactKeys(value, [...GATEWAY_CORE_KEYS, "decisionDigest"])) {
        throw new Error("BROKER_DECISION_INVALID_DENIED");
    }
    const { decisionDigest, ...core } = value;
    if (!isDigest(decisionDigest) || digest(core) !== decisionDigest
        || value.schemaVersion !== CAPABILITY_GATEWAY_DECISION_API_VERSION
        || value.stage !== "GATEWAY"
        || !Array.isArray(value.issues)
        || !value.issues.every((issue) => CAPABILITY_DECISION_ISSUES_V1.includes(issue))
        || (value.outcome === "ALLOW"
            ? !validExecutionTicket(value.ticket) || value.issues.length !== 0
                || value.catalogueVersion !== value.ticket.catalogueVersion
                || value.catalogueDigest !== value.ticket.catalogueDigest
                || value.actionId !== value.ticket.actionId
                || value.actionVersion !== value.ticket.actionVersion
                || value.actionDigest !== value.ticket.actionDigest
                || value.correlationDigest !== value.ticket.correlationDigest
                || value.requestDigest !== value.ticket.requestDigest
            : value.outcome !== "DENY" || value.ticket !== null)) {
        throw new Error("BROKER_DECISION_INVALID_DENIED");
    }
    return value;
}
function validExecutionTicket(value) {
    return exactKeys(value, TICKET_KEYS)
        && typeof value.catalogueVersion === "string"
        && isDigest(value.catalogueDigest)
        && typeof value.actionId === "string"
        && typeof value.actionVersion === "string"
        && isDigest(value.actionDigest)
        && isDigest(value.activationDigest)
        && isBoundId(value.policyId, "policy")
        && value.policyVersion === "1.0.0"
        && isDigest(value.policyDigest)
        && isBoundId(value.tenant, "tenant")
        && isDigest(value.correlationDigest)
        && isBoundId(value.requestId, "request")
        && isDigest(value.requestDigest)
        && exactKeys(value.evidenceSink, ["sinkId", "type"])
        && value.evidenceSink.type === "SYNTHETIC_MEMORY"
        && isBoundId(value.evidenceSink.sinkId, "evidence")
        && isRecord(value.request);
}
function makeBrokerReceipt(core) {
    return { ...core, receiptDigest: digest(core) };
}
function brokerReadback(value) {
    const candidate = isRecord(value) ? value : {};
    return {
        catalogueVersion: typeof candidate.catalogueVersion === "string" ? candidate.catalogueVersion : null,
        catalogueDigest: typeof candidate.catalogueDigest === "string" ? candidate.catalogueDigest : null,
        actionId: typeof candidate.actionId === "string" ? candidate.actionId : null,
        actionVersion: typeof candidate.actionVersion === "string" ? candidate.actionVersion : null,
        actionDigest: typeof candidate.actionDigest === "string" ? candidate.actionDigest : null,
        correlationDigest: typeof candidate.correlationDigest === "string" ? candidate.correlationDigest : null,
        requestDigest: typeof candidate.requestDigest === "string" ? candidate.requestDigest : null,
    };
}
function denyBroker(value, issues) {
    return makeBrokerReceipt({
        schemaVersion: CAPABILITY_BROKER_RECEIPT_API_VERSION,
        stage: "BROKER",
        outcome: "DENY",
        ...brokerReadback(value),
        responseDigest: null,
        response: null,
        effectCount: 0,
        effectState: "NONE",
        issues: [...new Set(issues)].sort(),
    });
}
function ambiguousBroker(value) {
    return makeBrokerReceipt({
        schemaVersion: CAPABILITY_BROKER_RECEIPT_API_VERSION,
        stage: "BROKER",
        outcome: "AMBIGUOUS",
        ...brokerReadback(value),
        responseDigest: null,
        response: null,
        effectCount: null,
        effectState: "AMBIGUOUS_CONSUMED",
        issues: ["SYNTHETIC_COMMIT_AMBIGUOUS_CONSUMED"],
    });
}
const SYSTEM_MONOTONIC_CLOCK = {
    nowMs: () => Number(process.hrtime.bigint()) / 1_000_000,
};
function readMonotonicClock(clock) {
    try {
        const value = clock.nowMs();
        return Number.isFinite(value) ? value : null;
    }
    catch {
        return null;
    }
}
function validPreparedEffect(value) {
    return exactKeys(value, ["commit", "response"])
        && isRecord(value.response)
        && typeof value.commit === "function";
}
function snapshotRecord(value) {
    try {
        const cloned = structuredClone(value);
        if (!isRecord(cloned))
            return null;
        return deepFreeze(cloned);
    }
    catch {
        return null;
    }
}
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}
function clearPreCommitReservation(replayStore, requestId) {
    if (replayStore.get(requestId) === "IN_FLIGHT")
        replayStore.delete(requestId);
}
export function executeCapabilityAtBrokerV1(catalogueValue, activationValue, policyValue, gatewayDecisionValue, observedAt, replayStore, executor, clock = SYSTEM_MONOTONIC_CLOCK) {
    let decision;
    try {
        decision = verifyCapabilityGatewayDecisionV1(gatewayDecisionValue);
    }
    catch {
        return denyBroker(isRecord(gatewayDecisionValue) ? gatewayDecisionValue.ticket : null, ["BROKER_DECISION_INVALID_DENIED"]);
    }
    if (decision.outcome !== "ALLOW" || decision.ticket === null) {
        return denyBroker(decision.ticket, ["BROKER_DECISION_INVALID_DENIED"]);
    }
    const ticket = decision.ticket;
    let catalogue;
    try {
        catalogue = verifyCapabilityCatalogueV1(catalogueValue);
    }
    catch (error) {
        return denyBroker(ticket, [issueFrom(error)]);
    }
    if (policyValue === null || policyValue === undefined) {
        return denyBroker(ticket, ["POLICY_MISSING_DENIED"]);
    }
    let policy;
    try {
        policy = verifyCapabilityPolicyBindingV1(policyValue, observedAt);
    }
    catch (error) {
        return denyBroker(ticket, [issueFrom(error)]);
    }
    let activation;
    try {
        activation = verifyCapabilityActivationV1(activationValue, catalogue, policy, observedAt);
    }
    catch (error) {
        return denyBroker(ticket, [issueFrom(error)]);
    }
    const action = catalogue.actions.find(({ actionId }) => actionId === ticket.actionId);
    if (action === undefined)
        return denyBroker(ticket, ["ACTION_UNKNOWN_DENIED"]);
    if (ticket.catalogueVersion !== catalogue.version)
        return denyBroker(ticket, ["CATALOGUE_VERSION_STALE_DENIED"]);
    if (ticket.catalogueDigest !== catalogue.digest)
        return denyBroker(ticket, ["CATALOGUE_DIGEST_MISMATCH_DENIED"]);
    if (ticket.actionVersion !== action.version)
        return denyBroker(ticket, ["ACTION_VERSION_STALE_DENIED"]);
    if (ticket.actionDigest !== action.digest)
        return denyBroker(ticket, ["ACTION_DIGEST_MISMATCH_DENIED"]);
    if (ticket.activationDigest !== activation.digest || activation.actionId !== action.actionId) {
        return denyBroker(ticket, ["ACTIVATION_AUTHORIZATION_INVALID_DENIED"]);
    }
    if (ticket.policyId !== policy.policyId
        || ticket.policyVersion !== policy.version
        || ticket.policyDigest !== policy.digest
        || !policy.actionIds.includes(action.actionId)) {
        return denyBroker(ticket, ["POLICY_BINDING_MISMATCH_DENIED"]);
    }
    if (ticket.tenant !== policy.tenant)
        return denyBroker(ticket, ["CROSS_TENANT_DENIED"]);
    if (ticket.evidenceSink.type !== "SYNTHETIC_MEMORY")
        return denyBroker(ticket, ["EVIDENCE_SINK_MISSING_DENIED"]);
    if (digest(ticket.request) !== ticket.requestDigest || !validateJson(action.requestSchema, ticket.request)) {
        return denyBroker(ticket, ["REQUEST_SCHEMA_INVALID_DENIED"]);
    }
    const replayState = replayStore.get(ticket.requestId);
    if (replayState === "IN_FLIGHT")
        return denyBroker(ticket, ["REPLAY_IN_FLIGHT_DENIED"]);
    if (replayState === "CONSUMED")
        return denyBroker(ticket, ["REPLAY_CONSUMED_DENIED"]);
    let preparedValue;
    replayStore.set(ticket.requestId, "IN_FLIGHT");
    const requestSnapshot = snapshotRecord(ticket.request);
    if (requestSnapshot === null
        || !validateJson(action.requestSchema, requestSnapshot)
        || digest(requestSnapshot) !== ticket.requestDigest) {
        clearPreCommitReservation(replayStore, ticket.requestId);
        return denyBroker(ticket, ["REQUEST_SNAPSHOT_INVALID_DENIED"]);
    }
    const startedAt = readMonotonicClock(clock);
    if (startedAt === null) {
        clearPreCommitReservation(replayStore, ticket.requestId);
        return denyBroker(ticket, ["RESOURCE_BOUNDS_DENIED"]);
    }
    try {
        preparedValue = executor.prepare(action, requestSnapshot);
    }
    catch {
        clearPreCommitReservation(replayStore, ticket.requestId);
        return denyBroker(ticket, ["RESPONSE_SCHEMA_INVALID_DENIED"]);
    }
    const preparedAt = readMonotonicClock(clock);
    if (preparedAt === null
        || preparedAt < startedAt
        || preparedAt - startedAt > action.resourceBounds.maxExecutionMs) {
        clearPreCommitReservation(replayStore, ticket.requestId);
        return denyBroker(ticket, ["RESOURCE_BOUNDS_DENIED"]);
    }
    if (!validPreparedEffect(preparedValue)) {
        clearPreCommitReservation(replayStore, ticket.requestId);
        return denyBroker(ticket, ["PREPARED_EFFECT_INVALID_DENIED"]);
    }
    const responseSnapshot = snapshotRecord(preparedValue.response);
    if (responseSnapshot === null || !validateJson(action.responseSchema, responseSnapshot)) {
        clearPreCommitReservation(replayStore, ticket.requestId);
        return denyBroker(ticket, ["RESPONSE_SCHEMA_INVALID_DENIED"]);
    }
    if (Buffer.byteLength(canonicalJson(responseSnapshot)) > action.resourceBounds.maxResponseBytes) {
        clearPreCommitReservation(replayStore, ticket.requestId);
        return denyBroker(ticket, ["RESOURCE_BOUNDS_DENIED"]);
    }
    try {
        preparedValue.commit();
    }
    catch {
        replayStore.set(ticket.requestId, "CONSUMED");
        return ambiguousBroker(ticket);
    }
    replayStore.set(ticket.requestId, "CONSUMED");
    const responseDigest = digest(responseSnapshot);
    return makeBrokerReceipt({
        schemaVersion: CAPABILITY_BROKER_RECEIPT_API_VERSION,
        stage: "BROKER",
        outcome: "EXECUTED",
        ...brokerReadback(ticket),
        responseDigest,
        response: responseSnapshot,
        effectCount: 1,
        effectState: "CONFIRMED_ONE",
        issues: [],
    });
}
export function syntheticCapabilityExecutionRequestV1(catalogue, actionId = "crm.contact.create", policy = syntheticCapabilityPolicyBindingV1()) {
    const action = catalogue.actions.find((candidate) => candidate.actionId === actionId);
    if (action === undefined)
        throw new Error("ACTION_UNKNOWN_DENIED");
    return {
        schemaVersion: CAPABILITY_EXECUTION_REQUEST_API_VERSION,
        catalogueVersion: catalogue.version,
        catalogueDigest: catalogue.digest,
        actionId: action.actionId,
        actionVersion: action.version,
        actionDigest: action.digest,
        resource: action.resource,
        tenant: "tenant:synthetic-zoo",
        workloadIdentity: "workload:synthetic-agent",
        userIdentity: "user:synthetic-operator",
        policyDigest: policy.digest,
        correlationId: "correlation:aas-012-001",
        requestId: "request:aas-012-001",
        evidenceSink: { type: "SYNTHETIC_MEMORY", sinkId: "evidence:synthetic-memory" },
        request: actionId === "crm.contact.create"
            ? { email: "alex@example.test", name: "Alex Example" }
            : actionId === "erp.order.create"
                ? { quantity: 2, sku: "SYN-ZOO-001" }
                : { userId: "user:synthetic-operator" },
    };
}
export function listCapabilityCatalogueV1(value) {
    try {
        const catalogue = verifyCapabilityCatalogueV1(value);
        return {
            catalogueVersion: catalogue.version,
            catalogueDigest: catalogue.digest,
            activationAuthority: false,
            executionAuthority: false,
            entries: catalogue.actions.map(({ actionId, version, digest: actionDigest, activationState }) => ({
                actionId, version, digest: actionDigest, activationState,
            })),
        };
    }
    catch {
        return {
            catalogueVersion: null,
            catalogueDigest: null,
            activationAuthority: false,
            executionAuthority: false,
            entries: [],
        };
    }
}
