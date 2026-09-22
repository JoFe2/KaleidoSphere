import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { canonicalJson } from "./canonical-json.js";
export const EXTERNAL_BI_SERVICE_CONFIG_SCHEMA_V2 = "chimpmaera.external-bi-service/config/v2";
export const EXTERNAL_BI_SERVICE_READBACK_SCHEMA_V2 = "chimpmaera.external-bi-service/readback/v2";
export const EXTERNAL_BI_SERVICE_PRODUCT_VERSION_V2 = "v0.8.0";
export const EXTERNAL_BI_SERVICE_CONTRACT_ID_V2 = "superset-bi-agent.external";
export const EXTERNAL_BI_SERVICE_CONTRACT_VERSION_V2 = "2.0.0";
export const EXTERNAL_BI_SERVICE_ATTESTATION_SCHEMA_V2 = "superset-bi-agent.external/capability-attestation/v2";
export const EXTERNAL_BI_SERVICE_REQUEST_SCHEMA_V2 = "superset-bi-agent.external/intent-request/v2";
export const EXTERNAL_BI_SERVICE_RESULT_SCHEMA_V2 = "superset-bi-agent.external/intent-result/v2";
export const EXTERNAL_BI_SERVICE_CAPABILITIES_V2 = Object.freeze([
    "bi.status.read",
    "bi.discovery.run",
    "bi.analysis.run",
    "bi.graph.adaptive-v1.plan",
    "bi.preview.create",
    "bi.readback.read",
]);
export const EXTERNAL_BI_SERVICE_ACTIONS_V2 = Object.freeze([
    "status",
    "discovery",
    "analyze",
    "plan",
    "preview",
    "readback",
]);
const OWNER_CAPABILITY_DESCRIPTORS_V2 = deepFreeze({
    "bi.status.read": { action: "status", authority: "read-only" },
    "bi.discovery.run": { action: "discovery", authority: "local-evidence-write" },
    "bi.analysis.run": { action: "analyze", authority: "source-read-only" },
    "bi.graph.adaptive-v1.plan": { action: "plan", authority: "proposal-only" },
    "bi.preview.create": { action: "preview", authority: "proposal-only" },
    "bi.readback.read": { action: "readback", authority: "read-only" },
});
/**
 * The expected compatibility profile is owned by PanSphaira. Transport
 * configuration may select an endpoint and timeout, but it cannot select or
 * attest a different product/contract/capability tuple.
 */
const OWNER_COMPATIBILITY_PROFILE_V2 = deepFreeze({
    schemaVersion: "pansphaira.external-bi-service/compatibility-profile/v2",
    product: {
        id: "superset-bi-agent",
        version: EXTERNAL_BI_SERVICE_PRODUCT_VERSION_V2,
        component: "bi-agent-runtime",
    },
    contract: {
        id: EXTERNAL_BI_SERVICE_CONTRACT_ID_V2,
        version: EXTERNAL_BI_SERVICE_CONTRACT_VERSION_V2,
    },
    capabilities: EXTERNAL_BI_SERVICE_CAPABILITIES_V2.map((id) => ({
        id,
        ...OWNER_CAPABILITY_DESCRIPTORS_V2[id],
    })),
});
const OWNER_GRAPH_PROFILE_V2 = deepFreeze({
    acceptedIncumbent: "adaptive-v1",
    candidatePromotion: "none",
});
const OWNER_BOUNDARY_PROFILE_V2 = deepFreeze({
    sourceDatabaseCredentialsAccepted: false,
    freeSqlAccepted: false,
    rawSourceRowsReturned: false,
    modelMutationAuthority: false,
    directSupersetMutationIntentAccepted: false,
    persistentSupersetWorkflow: "trusted-preview-approval-apply-readback-rollback-only",
});
const ENV_KEYS = Object.freeze([
    "BI_AGENT_BASE_URL",
    "BI_AGENT_EXPECTED_PRODUCT_VERSION",
    "BI_AGENT_EXPECTED_CONTRACT_VERSION",
    "BI_AGENT_TIMEOUT_MS",
    "SUPERSET_BASE_URL",
]);
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const OWNER_VERIFIED_DECISIONS_V2 = new WeakSet();
function isRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || nodeTypes.isProxy(value))
        return false;
    try {
        if (Object.getPrototypeOf(value) !== Object.prototype)
            return false;
        for (const key of Reflect.ownKeys(value)) {
            if (typeof key !== "string" || DANGEROUS_KEYS.has(key))
                return false;
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true)
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
function isDenseArray(value) {
    if (!Array.isArray(value) || nodeTypes.isProxy(value))
        return false;
    try {
        if (Object.getPrototypeOf(value) !== Array.prototype)
            return false;
        const keys = Reflect.ownKeys(value);
        if (keys.some((key) => typeof key !== "string"))
            return false;
        const expectedKeys = [
            ...Array.from({ length: value.length }, (_, index) => String(index)),
            "length",
        ];
        if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !keys.includes(key)))
            return false;
        return expectedKeys.slice(0, -1).every((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return descriptor !== undefined && "value" in descriptor && descriptor.enumerable === true;
        });
    }
    catch {
        return false;
    }
}
function safeJsonClone(value, ancestors = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isFinite(value) || Object.is(value, -0)
            || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
            throw new TypeError("UNSAFE_JSON_NUMBER");
        }
        return value;
    }
    if (isDenseArray(value)) {
        if (ancestors.has(value))
            throw new TypeError("CYCLIC_JSON_ARRAY");
        const next = new Set(ancestors).add(value);
        return Array.from({ length: value.length }, (_, index) => {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (descriptor === undefined || !("value" in descriptor))
                throw new TypeError("UNSAFE_JSON_ARRAY");
            return safeJsonClone(descriptor.value, next);
        });
    }
    if (!isRecord(value) || ancestors.has(value))
        throw new TypeError("UNSAFE_JSON_OBJECT");
    const next = new Set(ancestors).add(value);
    const output = {};
    for (const key of Object.keys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !("value" in descriptor))
            throw new TypeError("UNSAFE_JSON_OBJECT");
        Object.defineProperty(output, key, {
            value: safeJsonClone(descriptor.value, next),
            enumerable: true,
            writable: true,
            configurable: true,
        });
    }
    return output;
}
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const key of Reflect.ownKeys(value)) {
            if (key !== "length")
                deepFreeze(value[key]);
        }
        Object.freeze(value);
    }
    return value;
}
function immutable(value) {
    return deepFreeze(safeJsonClone(value));
}
function exactKeys(value, expected) {
    if (!isRecord(value))
        return false;
    const actual = Object.keys(value).sort();
    const sortedExpected = [...expected].sort();
    return actual.length === sortedExpected.length
        && actual.every((key, index) => key === sortedExpected[index]);
}
function sameCanonicalValue(actual, expected) {
    try {
        return canonicalJson(actual) === canonicalJson(expected);
    }
    catch {
        return false;
    }
}
function snapshotEnvironment(value) {
    if (!isRecord(value))
        return null;
    const snapshot = {};
    for (const key of ENV_KEYS) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined)
            continue;
        if (!("value" in descriptor)
            || (descriptor.value !== undefined && typeof descriptor.value !== "string"))
            return null;
        snapshot[key] = descriptor.value;
    }
    return snapshot;
}
function configDenied(reasonCode) {
    return immutable({ outcome: "DENIED", reasonCodes: [reasonCode] });
}
function disabled(reasonCodes) {
    return immutable({
        outcome: "DISABLED",
        reasonCodes: [...reasonCodes],
        config: {
            schemaVersion: EXTERNAL_BI_SERVICE_CONFIG_SCHEMA_V2,
            enabled: false,
            biAgentBaseUrl: null,
            expectedProductVersion: OWNER_COMPATIBILITY_PROFILE_V2.product.version,
            expectedContractVersion: OWNER_COMPATIBILITY_PROFILE_V2.contract.version,
            timeoutMs: 5000,
            requiredCapabilities: [...EXTERNAL_BI_SERVICE_CAPABILITIES_V2],
        },
    });
}
function sanitizeBaseUrl(input) {
    if (input.length > 2048 || /[\u0000-\u001f\s]/.test(input) || /%40/i.test(input))
        return null;
    let parsed;
    try {
        parsed = new URL(input);
    }
    catch {
        return null;
    }
    if (!["http:", "https:"].includes(parsed.protocol))
        return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
        return null;
    if (parsed.pathname !== "/" && parsed.pathname !== "")
        return null;
    const host = parsed.hostname.toLowerCase();
    if (!host || ["0.0.0.0", "169.254.169.254", "[::]", "::"].includes(host))
        return null;
    parsed.pathname = "/";
    return parsed.toString().replace(/\/$/, "");
}
function parseTimeout(value) {
    if (value === undefined || value === "")
        return 5000;
    if (!/^[0-9]{2,6}$/.test(value))
        return null;
    const parsed = Number(value);
    return parsed >= 100 && parsed <= 30000 ? parsed : null;
}
export function configureExternalBiServiceV2(env) {
    const envSnapshot = snapshotEnvironment(env);
    if (envSnapshot === null)
        return configDenied("EXTERNAL_BI_SERVICE_URL_DENIED");
    const hasAny = ENV_KEYS.some((key) => envSnapshot[key] !== undefined && envSnapshot[key] !== "");
    if (!hasAny)
        return disabled(["EXTERNAL_BI_SERVICE_NOT_CONFIGURED"]);
    if (envSnapshot.SUPERSET_BASE_URL) {
        return configDenied("EXTERNAL_BI_SERVICE_DIRECT_SUPERSET_CONFIG_DENIED");
    }
    if (envSnapshot.BI_AGENT_EXPECTED_PRODUCT_VERSION) {
        return configDenied("EXTERNAL_BI_SERVICE_PRODUCT_VERSION_DENIED");
    }
    if (envSnapshot.BI_AGENT_EXPECTED_CONTRACT_VERSION) {
        return configDenied("EXTERNAL_BI_SERVICE_CONTRACT_VERSION_DENIED");
    }
    const biAgentBaseUrl = envSnapshot.BI_AGENT_BASE_URL
        ? sanitizeBaseUrl(envSnapshot.BI_AGENT_BASE_URL)
        : null;
    if (!biAgentBaseUrl)
        return configDenied("EXTERNAL_BI_SERVICE_URL_DENIED");
    const timeoutMs = parseTimeout(envSnapshot.BI_AGENT_TIMEOUT_MS);
    if (timeoutMs === null)
        return configDenied("EXTERNAL_BI_SERVICE_TIMEOUT_DENIED");
    const decision = immutable({
        outcome: "VERIFIED",
        reasonCodes: ["EXTERNAL_BI_SERVICE_CONFIG_VERIFIED"],
        config: {
            schemaVersion: EXTERNAL_BI_SERVICE_CONFIG_SCHEMA_V2,
            enabled: true,
            biAgentBaseUrl,
            expectedProductVersion: OWNER_COMPATIBILITY_PROFILE_V2.product.version,
            expectedContractVersion: OWNER_COMPATIBILITY_PROFILE_V2.contract.version,
            timeoutMs,
            requiredCapabilities: [...EXTERNAL_BI_SERVICE_CAPABILITIES_V2],
        },
    });
    OWNER_VERIFIED_DECISIONS_V2.add(decision);
    return decision;
}
function endpoint(baseUrl, pathname) {
    const parsed = new URL(baseUrl);
    parsed.pathname = pathname;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
}
async function responseJson(response) {
    try {
        return await response.json();
    }
    catch {
        return null;
    }
}
function digest(value) {
    return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
function bodyWithout(value, key) {
    return Object.fromEntries(Object.entries(value).filter(([entry]) => entry !== key));
}
function ownerConfigError(value) {
    if (!exactKeys(value, [
        "schemaVersion", "enabled", "biAgentBaseUrl", "expectedProductVersion",
        "expectedContractVersion", "timeoutMs", "requiredCapabilities",
    ]) || value.schemaVersion !== EXTERNAL_BI_SERVICE_CONFIG_SCHEMA_V2 || value.enabled !== true) {
        return "EXTERNAL_BI_SERVICE_REQUEST_DENIED";
    }
    if (value.expectedProductVersion !== OWNER_COMPATIBILITY_PROFILE_V2.product.version) {
        return "EXTERNAL_BI_SERVICE_PRODUCT_VERSION_DENIED";
    }
    if (value.expectedContractVersion !== OWNER_COMPATIBILITY_PROFILE_V2.contract.version) {
        return "EXTERNAL_BI_SERVICE_CONTRACT_VERSION_DENIED";
    }
    if (!sameCanonicalValue(value.requiredCapabilities, EXTERNAL_BI_SERVICE_CAPABILITIES_V2)) {
        return "EXTERNAL_BI_SERVICE_CAPABILITY_MISSING";
    }
    if (typeof value.biAgentBaseUrl !== "string"
        || sanitizeBaseUrl(value.biAgentBaseUrl) !== value.biAgentBaseUrl) {
        return "EXTERNAL_BI_SERVICE_URL_DENIED";
    }
    if (!Number.isSafeInteger(value.timeoutMs)
        || value.timeoutMs < 100 || value.timeoutMs > 30000) {
        return "EXTERNAL_BI_SERVICE_TIMEOUT_DENIED";
    }
    return null;
}
function matchesOwnerProduct(value) {
    return exactKeys(value, ["id", "version", "component"])
        && sameCanonicalValue(value, OWNER_COMPATIBILITY_PROFILE_V2.product);
}
function matchesOwnerContract(value) {
    return exactKeys(value, ["id", "version"])
        && sameCanonicalValue(value, OWNER_COMPATIBILITY_PROFILE_V2.contract);
}
function matchesOwnerCapabilities(value) {
    return Array.isArray(value)
        && value.length === OWNER_COMPATIBILITY_PROFILE_V2.capabilities.length
        && value.every((item, index) => exactKeys(item, ["id", "action", "authority"])
            && sameCanonicalValue(item, OWNER_COMPATIBILITY_PROFILE_V2.capabilities[index]));
}
function validateAttestation(value) {
    if (!exactKeys(value, [
        "schemaVersion", "product", "contract", "capabilities", "graph", "boundaries", "attestation",
    ]) || value.schemaVersion !== EXTERNAL_BI_SERVICE_ATTESTATION_SCHEMA_V2) {
        return "EXTERNAL_BI_SERVICE_ATTESTATION_MALFORMED";
    }
    const proof = value.attestation;
    if (!exactKeys(proof, ["algorithm", "digest"])
        || proof.algorithm !== "sha256-canonical-json"
        || typeof proof.digest !== "string" || !SHA256_DIGEST.test(proof.digest)) {
        return "EXTERNAL_BI_SERVICE_ATTESTATION_MALFORMED";
    }
    try {
        if (proof.digest !== digest(bodyWithout(value, "attestation")))
            return "EXTERNAL_BI_SERVICE_DIGEST_DENIED";
    }
    catch {
        return "EXTERNAL_BI_SERVICE_ATTESTATION_MALFORMED";
    }
    if (!matchesOwnerProduct(value.product))
        return "EXTERNAL_BI_SERVICE_PRODUCT_VERSION_DENIED";
    if (!matchesOwnerContract(value.contract))
        return "EXTERNAL_BI_SERVICE_CONTRACT_VERSION_DENIED";
    if (!matchesOwnerCapabilities(value.capabilities))
        return "EXTERNAL_BI_SERVICE_CAPABILITY_MISSING";
    if (!exactKeys(value.graph, ["acceptedIncumbent", "candidatePromotion"])
        || !sameCanonicalValue(value.graph, OWNER_GRAPH_PROFILE_V2))
        return "EXTERNAL_BI_SERVICE_CAPABILITY_MISSING";
    if (!exactKeys(value.boundaries, [
        "sourceDatabaseCredentialsAccepted", "freeSqlAccepted", "rawSourceRowsReturned",
        "modelMutationAuthority", "directSupersetMutationIntentAccepted", "persistentSupersetWorkflow",
    ]) || !sameCanonicalValue(value.boundaries, OWNER_BOUNDARY_PROFILE_V2)) {
        return "EXTERNAL_BI_SERVICE_ATTESTATION_MALFORMED";
    }
    return null;
}
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FORBIDDEN_REQUEST_KEY = /^(?:sql|query|password|passwd|secret|token|credential|credentials|authorization|cookie|raw|rawrows|rows|url|uri|host|port)$/i;
const FORBIDDEN_REQUEST_TEXT = /(?:\b(?:select|insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec(?:ute)?|dbcc|backup|restore)\b|\braw\s+sql\b|\bsql\s*lab\b|password|credential|secret|api[_ -]?key|bearer\s+\S+|system\s+prompt|ignore\s+(?:all\s+)?previous)/i;
function unsafeRequestValue(value) {
    if (typeof value === "string")
        return FORBIDDEN_REQUEST_TEXT.test(value);
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))
        return false;
    if (Array.isArray(value))
        return value.some(unsafeRequestValue);
    if (!isRecord(value))
        return true;
    return Object.entries(value).some(([key, item]) => FORBIDDEN_REQUEST_KEY.test(key.replace(/[^A-Za-z0-9]/g, "")) || unsafeRequestValue(item));
}
function validateIntentRequest(request) {
    if (!isRecord(request) || typeof request.requestId !== "string"
        || !REQUEST_ID.test(request.requestId))
        return "EXTERNAL_BI_SERVICE_REQUEST_DENIED";
    if (!EXTERNAL_BI_SERVICE_ACTIONS_V2.includes(request.action))
        return "EXTERNAL_BI_SERVICE_ACTION_DENIED";
    const expectedKeys = Object.hasOwn(request, "input")
        ? ["requestId", "action", "input"]
        : ["requestId", "action"];
    if (!exactKeys(request, expectedKeys))
        return "EXTERNAL_BI_SERVICE_REQUEST_DENIED";
    if (Object.hasOwn(request, "input")
        && (!isRecord(request.input) || unsafeRequestValue(request.input))) {
        return "EXTERNAL_BI_SERVICE_UNSAFE_REQUEST_DENIED";
    }
    try {
        canonicalJson(request);
    }
    catch {
        return "EXTERNAL_BI_SERVICE_REQUEST_DENIED";
    }
    return null;
}
function validateIntentEnvelope(value, request, attestationDigest) {
    if (!exactKeys(value, [
        "schemaVersion", "requestId", "action", "runtime", "capabilityAttestationDigest", "result", "integrity",
    ]) || value.schemaVersion !== EXTERNAL_BI_SERVICE_RESULT_SCHEMA_V2
        || value.action !== request.action || value.requestId !== request.requestId) {
        return "EXTERNAL_BI_SERVICE_RESPONSE_MALFORMED";
    }
    const runtime = value.runtime;
    const integrity = value.integrity;
    const result = value.result;
    if (!exactKeys(runtime, ["product", "contract"])
        || !exactKeys(integrity, ["algorithm", "digest"])
        || integrity.algorithm !== "sha256-canonical-json"
        || typeof integrity.digest !== "string" || !SHA256_DIGEST.test(integrity.digest)
        || !isRecord(result) || typeof value.capabilityAttestationDigest !== "string") {
        return "EXTERNAL_BI_SERVICE_RESPONSE_MALFORMED";
    }
    try {
        if (integrity.digest !== digest(bodyWithout(value, "integrity")))
            return "EXTERNAL_BI_SERVICE_DIGEST_DENIED";
    }
    catch {
        return "EXTERNAL_BI_SERVICE_RESPONSE_MALFORMED";
    }
    if (!matchesOwnerProduct(runtime.product))
        return "EXTERNAL_BI_SERVICE_PRODUCT_VERSION_DENIED";
    if (!matchesOwnerContract(runtime.contract))
        return "EXTERNAL_BI_SERVICE_CONTRACT_VERSION_DENIED";
    if (value.capabilityAttestationDigest !== attestationDigest)
        return "EXTERNAL_BI_SERVICE_DIGEST_DENIED";
    if (unsafeRequestValue(result))
        return "EXTERNAL_BI_SERVICE_UNSAFE_REQUEST_DENIED";
    if (request.action === "status" && result.status !== "READY")
        return "EXTERNAL_BI_SERVICE_STATUS_MALFORMED";
    return null;
}
const REASON_CODES_V2 = new Set([
    "EXTERNAL_BI_SERVICE_DISABLED",
    "EXTERNAL_BI_SERVICE_NOT_CONFIGURED",
    "EXTERNAL_BI_SERVICE_CONFIG_VERIFIED",
    "EXTERNAL_BI_SERVICE_DIRECT_SUPERSET_CONFIG_DENIED",
    "EXTERNAL_BI_SERVICE_URL_DENIED",
    "EXTERNAL_BI_SERVICE_TIMEOUT_DENIED",
    "EXTERNAL_BI_SERVICE_PRODUCT_VERSION_DENIED",
    "EXTERNAL_BI_SERVICE_CONTRACT_VERSION_DENIED",
    "EXTERNAL_BI_SERVICE_ATTESTATION_MALFORMED",
    "EXTERNAL_BI_SERVICE_DIGEST_DENIED",
    "EXTERNAL_BI_SERVICE_CAPABILITY_MISSING",
    "EXTERNAL_BI_SERVICE_REQUEST_DENIED",
    "EXTERNAL_BI_SERVICE_ACTION_DENIED",
    "EXTERNAL_BI_SERVICE_UNSAFE_REQUEST_DENIED",
    "EXTERNAL_BI_SERVICE_RESPONSE_MALFORMED",
    "EXTERNAL_BI_SERVICE_STATUS_MALFORMED",
    "EXTERNAL_BI_SERVICE_UNAVAILABLE",
]);
function isReasonCodeArray(value) {
    return Array.isArray(value) && value.length > 0
        && value.every((item) => typeof item === "string"
            && REASON_CODES_V2.has(item));
}
function intentFailure(outcome, reasonCode) {
    return immutable({ outcome, reasonCodes: [reasonCode] });
}
export async function invokeExternalBiServiceV2(decision, request, fetchImpl = fetch) {
    const ownerDerived = OWNER_VERIFIED_DECISIONS_V2.has(decision);
    let decisionSnapshot;
    try {
        decisionSnapshot = safeJsonClone(decision);
    }
    catch {
        return intentFailure("DENIED", "EXTERNAL_BI_SERVICE_REQUEST_DENIED");
    }
    if (!isRecord(decisionSnapshot) || typeof decisionSnapshot.outcome !== "string") {
        return intentFailure("DENIED", "EXTERNAL_BI_SERVICE_REQUEST_DENIED");
    }
    if (decisionSnapshot.outcome === "DISABLED") {
        const disabledCodes = new Set(["EXTERNAL_BI_SERVICE_DISABLED", "EXTERNAL_BI_SERVICE_NOT_CONFIGURED"]);
        if (!exactKeys(decisionSnapshot, ["outcome", "reasonCodes", "config"])
            || !isReasonCodeArray(decisionSnapshot.reasonCodes)
            || !decisionSnapshot.reasonCodes.every((code) => disabledCodes.has(code))) {
            return intentFailure("DENIED", "EXTERNAL_BI_SERVICE_REQUEST_DENIED");
        }
        return immutable({
            outcome: "DISABLED",
            reasonCodes: [...decisionSnapshot.reasonCodes],
        });
    }
    if (decisionSnapshot.outcome === "DENIED") {
        if (!exactKeys(decisionSnapshot, ["outcome", "reasonCodes"])
            || !isReasonCodeArray(decisionSnapshot.reasonCodes)) {
            return intentFailure("DENIED", "EXTERNAL_BI_SERVICE_REQUEST_DENIED");
        }
        return immutable({ outcome: "DENIED", reasonCodes: [...decisionSnapshot.reasonCodes] });
    }
    if (decisionSnapshot.outcome !== "VERIFIED"
        || !exactKeys(decisionSnapshot, ["outcome", "reasonCodes", "config"])
        || !sameCanonicalValue(decisionSnapshot.reasonCodes, ["EXTERNAL_BI_SERVICE_CONFIG_VERIFIED"])) {
        return intentFailure("DENIED", "EXTERNAL_BI_SERVICE_REQUEST_DENIED");
    }
    const configError = ownerConfigError(decisionSnapshot.config);
    if (configError)
        return intentFailure("DENIED", configError);
    if (!ownerDerived)
        return intentFailure("DENIED", "EXTERNAL_BI_SERVICE_REQUEST_DENIED");
    const config = decisionSnapshot.config;
    const baseUrl = config.biAgentBaseUrl;
    if (baseUrl === null)
        return intentFailure("DENIED", "EXTERNAL_BI_SERVICE_URL_DENIED");
    let requestSnapshot;
    try {
        requestSnapshot = safeJsonClone(request);
    }
    catch {
        return intentFailure("DENIED", "EXTERNAL_BI_SERVICE_REQUEST_DENIED");
    }
    const requestError = validateIntentRequest(requestSnapshot);
    if (requestError)
        return intentFailure("DENIED", requestError);
    const safeRequest = requestSnapshot;
    try {
        const attestationResponse = await fetchImpl(endpoint(baseUrl, "/v2/capabilities"), {
            method: "GET", signal: AbortSignal.timeout(config.timeoutMs),
        });
        if (!attestationResponse.ok)
            return intentFailure("UNAVAILABLE", "EXTERNAL_BI_SERVICE_UNAVAILABLE");
        let attestation;
        try {
            attestation = safeJsonClone(await responseJson(attestationResponse));
        }
        catch {
            return intentFailure("DENIED", "EXTERNAL_BI_SERVICE_ATTESTATION_MALFORMED");
        }
        const attestationError = validateAttestation(attestation);
        if (attestationError)
            return intentFailure("DENIED", attestationError);
        const proof = attestation.attestation;
        const attestationDigest = proof.digest;
        const payload = {
            schemaVersion: EXTERNAL_BI_SERVICE_REQUEST_SCHEMA_V2,
            requestId: safeRequest.requestId,
            action: safeRequest.action,
            ...(safeRequest.input === undefined ? {} : { input: safeRequest.input }),
        };
        const response = await fetchImpl(endpoint(baseUrl, "/v2/intents"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(config.timeoutMs),
        });
        if (!response.ok)
            return intentFailure("UNAVAILABLE", "EXTERNAL_BI_SERVICE_UNAVAILABLE");
        let value;
        try {
            value = safeJsonClone(await responseJson(response));
        }
        catch {
            return intentFailure("DENIED", "EXTERNAL_BI_SERVICE_RESPONSE_MALFORMED");
        }
        const responseError = validateIntentEnvelope(value, safeRequest, attestationDigest);
        if (responseError)
            return intentFailure("DENIED", responseError);
        const record = value;
        const integrity = record.integrity;
        return immutable({
            outcome: "VERIFIED",
            reasonCodes: ["EXTERNAL_BI_SERVICE_CONFIG_VERIFIED"],
            readback: {
                action: safeRequest.action,
                requestId: safeRequest.requestId,
                attestationDigest,
                responseDigest: integrity.digest,
                result: record.result,
            },
        });
    }
    catch {
        return intentFailure("UNAVAILABLE", "EXTERNAL_BI_SERVICE_UNAVAILABLE");
    }
}
export async function probeExternalBiServiceV2(decision, fetchImpl = fetch) {
    const status = await invokeExternalBiServiceV2(decision, { requestId: "cm-external-bi-probe", action: "status" }, fetchImpl);
    if (status.outcome !== "VERIFIED")
        return status;
    try {
        return immutable({
            outcome: "VERIFIED",
            reasonCodes: ["EXTERNAL_BI_SERVICE_CONFIG_VERIFIED"],
            readback: {
                schemaVersion: EXTERNAL_BI_SERVICE_READBACK_SCHEMA_V2,
                outcome: "READY",
                productVersion: OWNER_COMPATIBILITY_PROFILE_V2.product.version,
                contractVersion: OWNER_COMPATIBILITY_PROFILE_V2.contract.version,
                capabilities: [...EXTERNAL_BI_SERVICE_CAPABILITIES_V2],
                acceptedGraphIncumbent: "adaptive-v1",
                attestationDigest: status.readback.attestationDigest,
                statusResponseDigest: status.readback.responseDigest,
                directSupersetAccessByCm: false,
            },
        });
    }
    catch {
        return immutable({
            outcome: "UNAVAILABLE",
            reasonCodes: ["EXTERNAL_BI_SERVICE_UNAVAILABLE"],
        });
    }
}
