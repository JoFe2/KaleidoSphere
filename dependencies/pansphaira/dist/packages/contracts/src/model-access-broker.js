import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const MODEL_REQUEST_SCHEMA_V1 = "chimpmaera.model/model-request/v1";
export const MODEL_RESPONSE_SCHEMA_V1 = "chimpmaera.model/model-response/v1";
export const MODEL_STREAM_SCHEMA_V1 = "chimpmaera.model/model-stream-event/v1";
const requestKeys = [
    "attachments", "budget", "correlationId", "dataClassification",
    "delegationDigest", "model", "operationId", "optionalFields", "protocol",
    "provider", "purpose", "routeId", "schemaVersion", "structuredOutput",
    "tenant", "text", "tools", "trustClass", "userIdentity",
    "workloadIdentity",
].sort();
const budgetKeys = [
    "maxCostMicros", "maxInputBytes", "maxOutputBytes", "maxRequests",
    "maxTokens", "timeoutMs",
].sort();
const secretPattern = /(?:sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:password|api[_-]?key|access[_-]?token)\s*[:=]\s*\S{8,})/gi;
const injectionPattern = /(?:ignore (?:all )?(?:previous|system) instructions|system prompt|developer message|mint authority|execute tool now)/gi;
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function exactObject(value, keys) {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype
        && canonicalJson(Object.keys(value).sort()) === canonicalJson(keys);
}
function boundedInteger(value, min, max) {
    return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}
function boundId(value, prefix) {
    return typeof value === "string"
        && new RegExp(`^${prefix}:[a-z0-9][a-z0-9._-]{2,63}$`).test(value);
}
function issueResult(request, outcome, issues) {
    const candidate = request;
    const operationId = typeof candidate.operationId === "string" ? candidate.operationId : "operation:invalid";
    const correlationId = typeof candidate.correlationId === "string" ? candidate.correlationId : "correlation:invalid";
    return {
        outcome,
        response: null,
        issues,
        replay: "NONE",
        audit: {
            schemaVersion: "chimpmaera.model/model-audit/v1",
            operationId,
            correlationId,
            tenantDigest: digest(candidate.tenant ?? null),
            purposeDigest: digest(candidate.purpose ?? null),
            requestDigest: digest(request),
            responseDigest: null,
            outcome,
            usage: null,
            issues,
        },
    };
}
function validateBudget(value, ceiling) {
    if (!exactObject(value, budgetKeys))
        return false;
    const checks = [
        ["maxInputBytes", ceiling.maxInputBytes],
        ["maxOutputBytes", ceiling.maxOutputBytes],
        ["maxTokens", ceiling.maxTokens],
        ["maxCostMicros", ceiling.maxCostMicros],
        ["maxRequests", ceiling.maxRequests],
        ["timeoutMs", ceiling.timeoutMs],
    ];
    return checks.every(([key, max]) => boundedInteger(value[key], 1, max));
}
function validateAttachments(value, route, inputLimit) {
    return Array.isArray(value)
        && value.length <= 8
        && value.every((item) => exactObject(item, ["bytes", "digest", "mediaType", "reference"])
            && route.attachmentMediaTypes.includes(item.mediaType)
            && boundedInteger(item.bytes, 1, inputLimit)
            && typeof item.digest === "string" && /^[a-f0-9]{64}$/.test(item.digest)
            && typeof item.reference === "string" && /^attachment:[a-z0-9._-]{3,80}$/.test(item.reference));
}
function validateTools(value) {
    return Array.isArray(value)
        && value.length <= 32
        && value.every((tool) => exactObject(tool, ["description", "inputSchema", "name"])
            && typeof tool.name === "string" && /^[a-z][a-z0-9_.-]{2,63}$/.test(tool.name)
            && typeof tool.description === "string" && tool.description.length <= 512
            && tool.inputSchema !== null && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema));
}
function findRoute(policy, candidate) {
    return policy.routes.find((route) => route.routeId === candidate.routeId
        && route.provider === candidate.provider
        && route.model === candidate.model
        && route.protocol === candidate.protocol);
}
export function guardModelRequestV1(value, policy) {
    if (!exactObject(value, requestKeys))
        return { outcome: "DENY", issues: ["MODEL_REQUEST_SCHEMA_DENIED"] };
    if (value.schemaVersion !== MODEL_REQUEST_SCHEMA_V1)
        return { outcome: "DENY", issues: ["MODEL_REQUEST_VERSION_DENIED"] };
    const candidate = value;
    const route = findRoute(policy, candidate);
    if (route === undefined)
        return { outcome: "DENY", issues: ["MODEL_ROUTE_CLOSED_DENIED"] };
    if (!policy.workloadIdentities.includes(candidate.workloadIdentity)
        || !policy.userIdentities.includes(candidate.userIdentity)
        || !route.allowedTenants.includes(candidate.tenant)
        || !route.allowedPurposes.includes(candidate.purpose)) {
        return { outcome: "DENY", issues: ["MODEL_AUTHORITY_BINDING_DENIED"] };
    }
    if (!boundId(candidate.workloadIdentity, "workload")
        || !boundId(candidate.userIdentity, "user")
        || !boundId(candidate.tenant, "tenant")
        || !boundId(candidate.purpose, "purpose")
        || !boundId(candidate.operationId, "operation")
        || !boundId(candidate.correlationId, "correlation")
        || !/^[a-f0-9]{64}$/.test(candidate.delegationDigest)) {
        return { outcome: "DENY", issues: ["MODEL_IDENTITY_FORMAT_DENIED"] };
    }
    if (!validateBudget(candidate.budget, policy.maxBudget)) {
        return { outcome: "DENY", issues: ["MODEL_BUDGET_SCHEMA_OR_CEILING_DENIED"] };
    }
    if (typeof candidate.text !== "string"
        || Buffer.byteLength(candidate.text) > candidate.budget.maxInputBytes
        || !validateAttachments(candidate.attachments, route, candidate.budget.maxInputBytes)
        || !validateTools(candidate.tools)) {
        return { outcome: "DENY", issues: ["MODEL_INPUT_LIMIT_OR_FEATURE_DENIED"] };
    }
    if (candidate.structuredOutput !== null
        && (typeof candidate.structuredOutput !== "object" || Array.isArray(candidate.structuredOutput))) {
        return { outcome: "DENY", issues: ["MODEL_STRUCTURED_OUTPUT_SCHEMA_DENIED"] };
    }
    if (candidate.optionalFields === null || typeof candidate.optionalFields !== "object" || Array.isArray(candidate.optionalFields)) {
        return { outcome: "DENY", issues: ["MODEL_OPTIONAL_FIELDS_SCHEMA_DENIED"] };
    }
    const unknownOptional = Object.keys(candidate.optionalFields).filter((key) => !route.optionalFields.includes(key));
    if (unknownOptional.length > 0) {
        return { outcome: "DENY", issues: unknownOptional.map((key) => `MODEL_OPTIONAL_FIELD_UNSUPPORTED:${key}`) };
    }
    if (candidate.dataClassification === "SECRET") {
        return { outcome: "OWNER_ESCALATION", issues: ["MODEL_SECRET_CLASSIFICATION_OWNER_ESCALATION"] };
    }
    if (!["PUBLIC", "INTERNAL", "CONFIDENTIAL"].includes(candidate.dataClassification)
        || !["TRUSTED_OWNER_INPUT", "UNTRUSTED_AGENT_INPUT"].includes(candidate.trustClass)) {
        return { outcome: "DENY", issues: ["MODEL_CLASSIFICATION_OR_TRUST_DENIED"] };
    }
    let redactions = 0;
    const text = candidate.text.replace(secretPattern, () => {
        redactions += 1;
        return "[REDACTED_BEFORE_PROVIDER]";
    });
    return { outcome: "ALLOW", request: { ...candidate, text }, route, redactions };
}
export function adaptCanonicalRequestV1(request, route) {
    const common = {
        model: request.model,
        max_tokens: request.budget.maxTokens,
        ...request.optionalFields,
    };
    const tools = request.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    }));
    if (route.protocol === "OPENAI_CHAT_COMPLETIONS") {
        return {
            ...common,
            messages: [{ role: "user", content: request.text }],
            tools,
            response_format: request.structuredOutput === null ? undefined : { type: "json_schema", json_schema: request.structuredOutput },
            attachments: request.attachments,
        };
    }
    if (route.protocol === "OPENAI_RESPONSES") {
        return {
            model: request.model,
            input: [{ role: "user", content: [{ type: "input_text", text: request.text }] }],
            max_output_tokens: request.budget.maxTokens,
            tools: tools.map(({ function: fn }) => ({ type: "function", ...fn })),
            text: request.structuredOutput === null ? undefined : { format: { type: "json_schema", ...request.structuredOutput } },
            attachments: request.attachments,
            ...request.optionalFields,
        };
    }
    return {
        model: request.model,
        max_tokens: request.budget.maxTokens,
        messages: [{ role: "user", content: request.text }],
        tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
        output_config: request.structuredOutput,
        attachments: request.attachments,
        ...request.optionalFields,
    };
}
export function guardModelResponseV1(request, route, providerRequestDigest, value) {
    if (!["text/plain", "application/json"].includes(value.contentType)) {
        return { outcome: "QUARANTINE", issues: ["MODEL_RESPONSE_MIME_QUARANTINED"] };
    }
    if (typeof value.text !== "string" || Buffer.byteLength(value.text) > request.budget.maxOutputBytes) {
        return { outcome: "QUARANTINE", issues: ["MODEL_RESPONSE_SIZE_QUARANTINED"] };
    }
    if (!boundedInteger(value.usage?.inputTokens, 0, request.budget.maxTokens)
        || !boundedInteger(value.usage?.outputTokens, 0, request.budget.maxTokens)
        || !boundedInteger(value.usage?.costMicros, 0, request.budget.maxCostMicros)) {
        return { outcome: "QUARANTINE", issues: ["MODEL_RESPONSE_BUDGET_QUARANTINED"] };
    }
    const toolCallCandidates = [];
    for (const tool of value.toolCalls ?? []) {
        if (!request.tools.some((allowed) => allowed.name === tool.name)
            || typeof tool.id !== "string" || !/^tool:[a-z0-9._-]{3,80}$/.test(tool.id)
            || tool.arguments === null || typeof tool.arguments !== "object" || Array.isArray(tool.arguments)) {
            return { outcome: "QUARANTINE", issues: ["MODEL_TOOL_CANDIDATE_QUARANTINED"] };
        }
        const args = tool.arguments;
        if (["authority", "approval", "credentialHandle", "execute", "tenant", "userIdentity"].some((key) => Object.hasOwn(args, key))) {
            return { outcome: "QUARANTINE", issues: ["MODEL_TOOL_AUTHORITY_SMUGGLING_QUARANTINED"] };
        }
        toolCallCandidates.push({ id: tool.id, name: tool.name, arguments: args, trust: "UNTRUSTED_MODEL_OUTPUT", authority: "NONE" });
    }
    let redactions = 0;
    const text = value.text
        .replace(secretPattern, () => { redactions += 1; return "[REDACTED_MODEL_OUTPUT]"; })
        .replace(injectionPattern, (match) => { redactions += 1; return `[UNTRUSTED_INSTRUCTION:${digest(match).slice(0, 12)}]`; });
    const providerResponseDigest = digest(value);
    return {
        outcome: "ALLOW",
        redactions,
        response: {
            schemaVersion: MODEL_RESPONSE_SCHEMA_V1,
            operationId: request.operationId,
            correlationId: request.correlationId,
            provider: request.provider,
            model: request.model,
            protocol: request.protocol,
            trust: "UNTRUSTED_MODEL_OUTPUT",
            contentType: value.contentType,
            text,
            structuredOutput: value.structuredOutput ?? null,
            toolCallCandidates,
            provenance: { routeId: route.routeId, providerRequestDigest, providerResponseDigest },
            usage: value.usage,
        },
    };
}
export function parseGuardedSseV1(request, lines) {
    const events = [];
    const toolDigests = new Map();
    let done = false;
    let totalBytes = 0;
    for (const line of lines) {
        totalBytes += Buffer.byteLength(line);
        if (totalBytes > request.budget.maxOutputBytes)
            return { outcome: "QUARANTINE", issues: ["MODEL_STREAM_SIZE_QUARANTINED"] };
        if (!line.startsWith("data: "))
            return { outcome: "QUARANTINE", issues: ["MODEL_STREAM_SSE_FRAMING_QUARANTINED"] };
        if (line === "data: [DONE]") {
            done = true;
            continue;
        }
        let parsed;
        try {
            parsed = JSON.parse(line.slice(6));
        }
        catch {
            return { outcome: "QUARANTINE", issues: ["MODEL_STREAM_SSE_JSON_QUARANTINED"] };
        }
        if (!exactObject(parsed, ["data", "event", "sequence"]))
            return { outcome: "QUARANTINE", issues: ["MODEL_STREAM_EVENT_SCHEMA_QUARANTINED"] };
        if (!boundedInteger(parsed.sequence, 0, 1_000_000) || parsed.sequence !== events.length)
            return { outcome: "QUARANTINE", issues: ["MODEL_STREAM_SEQUENCE_QUARANTINED"] };
        if (!["TEXT_DELTA", "TOOL_CANDIDATE", "USAGE", "DONE"].includes(String(parsed.event))
            || parsed.data === null || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
            return { outcome: "QUARANTINE", issues: ["MODEL_STREAM_EVENT_SCHEMA_QUARANTINED"] };
        }
        if (parsed.event === "TOOL_CANDIDATE") {
            const data = parsed.data;
            if (typeof data.id !== "string" || typeof data.name !== "string" || data.complete !== true || data.arguments === null || typeof data.arguments !== "object") {
                return { outcome: "QUARANTINE", issues: ["MODEL_STREAM_TOOL_INCOMPLETE_QUARANTINED"] };
            }
            const nextDigest = digest(data);
            const prior = toolDigests.get(data.id);
            if (prior !== undefined && prior !== nextDigest)
                return { outcome: "QUARANTINE", issues: ["MODEL_STREAM_TOOL_CHANGED_QUARANTINED"] };
            toolDigests.set(data.id, nextDigest);
        }
        events.push({
            schemaVersion: MODEL_STREAM_SCHEMA_V1,
            operationId: request.operationId,
            sequence: parsed.sequence,
            event: parsed.event,
            trust: "UNTRUSTED_MODEL_OUTPUT",
            data: parsed.data,
        });
    }
    if (!done || events.at(-1)?.event !== "DONE")
        return { outcome: "QUARANTINE", issues: ["MODEL_STREAM_PARTIAL_QUARANTINED"] };
    return { outcome: "ALLOW", events };
}
export class ModelAccessBrokerV1 {
    #policy;
    #receipts = new Map();
    #reserved = new Map();
    constructor(policy) {
        this.#policy = structuredClone(policy);
    }
    async invoke(value, providerCall) {
        const guarded = guardModelRequestV1(value, this.#policy);
        if (guarded.outcome !== "ALLOW")
            return issueResult(value, guarded.outcome, guarded.issues);
        const requestDigest = digest(guarded.request);
        const prior = this.#receipts.get(guarded.request.operationId);
        if (prior !== undefined) {
            if (prior.requestDigest !== requestDigest)
                return issueResult(value, "DENY", ["MODEL_REPLAY_CONFLICT_DENIED"]);
            return { ...prior.result, replay: "SAME_RECEIPT" };
        }
        const budgetKey = `${guarded.request.tenant}\n${guarded.request.purpose}\n${guarded.route.routeId}`;
        const used = this.#reserved.get(budgetKey) ?? 0;
        if (used >= guarded.request.budget.maxRequests)
            return issueResult(value, "THROTTLE", ["MODEL_REQUEST_BUDGET_THROTTLED"]);
        this.#reserved.set(budgetKey, used + 1);
        const adapted = adaptCanonicalRequestV1(guarded.request, guarded.route);
        const providerRequest = {
            route: guarded.route,
            credentialHandle: guarded.route.credentialHandle,
            request: adapted,
            requestDigest: digest(adapted),
        };
        let providerResponse;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), guarded.request.budget.timeoutMs);
        try {
            providerResponse = await providerCall(providerRequest, controller.signal);
            if (controller.signal.aborted)
                throw new Error("timeout");
        }
        catch {
            clearTimeout(timer);
            return issueResult(value, "QUARANTINE", ["MODEL_PROVIDER_UNAVAILABLE_QUARANTINED"]);
        }
        clearTimeout(timer);
        const responseGuard = guardModelResponseV1(guarded.request, guarded.route, providerRequest.requestDigest, providerResponse);
        if (responseGuard.outcome !== "ALLOW")
            return issueResult(value, "QUARANTINE", responseGuard.issues);
        const result = {
            outcome: "ALLOW",
            response: responseGuard.response,
            issues: guarded.redactions + responseGuard.redactions > 0 ? ["MODEL_CONTENT_REDACTED"] : [],
            replay: "FIRST",
            audit: {
                schemaVersion: "chimpmaera.model/model-audit/v1",
                operationId: guarded.request.operationId,
                correlationId: guarded.request.correlationId,
                tenantDigest: digest(guarded.request.tenant),
                purposeDigest: digest(guarded.request.purpose),
                requestDigest,
                responseDigest: digest(responseGuard.response),
                outcome: "ALLOW",
                usage: providerResponse.usage,
                issues: guarded.redactions + responseGuard.redactions > 0 ? ["MODEL_CONTENT_REDACTED"] : [],
            },
        };
        this.#receipts.set(guarded.request.operationId, { requestDigest, result });
        return result;
    }
}
export function syntheticModelAccessPolicyV1(protocol = "OPENAI_CHAT_COMPLETIONS") {
    return {
        schemaVersion: "chimpmaera.model/model-access-policy/v1",
        routes: [{
                routeId: `route:synthetic-${protocol.toLowerCase().replaceAll("_", "-")}`,
                provider: "provider:synthetic-model",
                model: "model:synthetic-v1",
                protocol,
                credentialHandle: "credential-handle:synthetic-model-v1",
                allowedTenants: ["tenant:synthetic-zoo"],
                allowedPurposes: ["purpose:agent-assistance"],
                optionalFields: protocol === "ANTHROPIC_MESSAGES" ? ["temperature", "top_p"] : ["seed", "temperature", "top_p"],
                attachmentMediaTypes: ["image/png", "image/jpeg", "application/pdf"],
            }],
        workloadIdentities: ["workload:isolated-openclaw"],
        userIdentities: ["user:synthetic-owner"],
        maxBudget: {
            maxInputBytes: 65_536,
            maxOutputBytes: 65_536,
            maxTokens: 4_096,
            maxCostMicros: 100_000,
            maxRequests: 32,
            timeoutMs: 30_000,
        },
    };
}
export function syntheticCanonicalModelRequestV1(protocol = "OPENAI_CHAT_COMPLETIONS") {
    const policy = syntheticModelAccessPolicyV1(protocol);
    const route = policy.routes[0];
    return {
        schemaVersion: MODEL_REQUEST_SCHEMA_V1,
        workloadIdentity: "workload:isolated-openclaw",
        userIdentity: "user:synthetic-owner",
        tenant: "tenant:synthetic-zoo",
        purpose: "purpose:agent-assistance",
        delegationDigest: "a".repeat(64),
        operationId: "operation:model-0001",
        correlationId: "correlation:model-0001",
        routeId: route.routeId,
        provider: route.provider,
        model: route.model,
        protocol,
        dataClassification: "INTERNAL",
        trustClass: "UNTRUSTED_AGENT_INPUT",
        text: "Return one typed candidate without executing it.",
        attachments: [{ mediaType: "image/png", digest: "b".repeat(64), bytes: 128, reference: "attachment:synthetic-image" }],
        tools: [{ name: "crm.contact.create", description: "Propose a synthetic contact candidate.", inputSchema: { type: "object", properties: { name: { type: "string" } } } }],
        structuredOutput: { name: "candidate", schema: { type: "object" }, strict: true },
        optionalFields: { temperature: 0 },
        budget: { maxInputBytes: 8_192, maxOutputBytes: 8_192, maxTokens: 512, maxCostMicros: 1_000, maxRequests: 1, timeoutMs: 2_000 },
    };
}
