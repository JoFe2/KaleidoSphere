import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { HMI_CORE_VERSION_V1, normalizeHmiSemanticResultV1, verifyHmiGenerationV1, } from "./hmi-core.js";
export const HMI_ADAPTER_REQUEST_SCHEMA_V1 = "chimpmaera.hmi/adapter-request/v1";
export const HMI_ADAPTER_CONTRACT_VERSION_V1 = "1.0.0";
function sha256(bytes) {
    return createHash("sha256").update(bytes, "utf8").digest("hex");
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isSelector(value) {
    return typeof value === "string"
        && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
}
function isBoundedInteger(value, maximum) {
    return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}
function denied(reason) {
    return { outcome: "DENIED", reasonCodes: [reason] };
}
function hasValidLimits(value, ceiling) {
    return exactKeys(value, ["maxReferences", "maxSourceBytes", "maxFindings", "maxOutputBytes"])
        && isBoundedInteger(value.maxReferences, ceiling.maxReferences)
        && isBoundedInteger(value.maxSourceBytes, ceiling.maxSourceBytes)
        && isBoundedInteger(value.maxFindings, ceiling.maxFindings)
        && isBoundedInteger(value.maxOutputBytes, ceiling.maxOutputBytes);
}
function isValidTransportTuple(harnessId, adapterVersion) {
    return (harnessId === "SYNTHETIC_OPENCLAW" && adapterVersion === "synthetic-v1")
        || (harnessId === "SYNTHETIC_CODEX" && adapterVersion === "synthetic-v1")
        || (harnessId === "OPENCLAW" && adapterVersion === "openclaw-entrypoint-v1")
        || (harnessId === "CODEX" && adapterVersion === "codex-entrypoint-v1");
}
export function mapHmiHarnessInvocationV1(bundle, pin, value) {
    if (!exactKeys(pin, ["coreVersion", "adapterContractVersion", "generationDigest"])
        || pin.coreVersion !== HMI_CORE_VERSION_V1
        || pin.adapterContractVersion !== HMI_ADAPTER_CONTRACT_VERSION_V1
        || !isDigest(pin.generationDigest))
        return denied("HMI_ADAPTER_PIN_DENIED");
    const verification = verifyHmiGenerationV1(bundle);
    if (verification.outcome !== "VERIFIED")
        return denied("HMI_ADAPTER_GENERATION_DENIED");
    if (verification.generationDigest !== pin.generationDigest)
        return denied("HMI_ADAPTER_PIN_DENIED");
    if (!exactKeys(value, ["schemaVersion", "operation", "query", "selectors", "selectedInput", "limits", "transport"])) {
        return denied("HMI_ADAPTER_SCHEMA_DENIED");
    }
    if (value.schemaVersion !== HMI_ADAPTER_REQUEST_SCHEMA_V1
        || typeof value.operation !== "string"
        || !["discover", "explain", "plan", "handoff", "validate", "contribute"].includes(value.operation)) {
        return denied("HMI_ADAPTER_OPERATION_DENIED");
    }
    if (typeof value.query !== "string" || value.query.length < 1 || value.query.length > 4_096
        || value.query !== value.query.normalize("NFC")
        || !Array.isArray(value.selectors) || value.selectors.length > 4
        || new Set(value.selectors).size !== value.selectors.length
        || !value.selectors.every(isSelector))
        return denied("HMI_ADAPTER_INPUT_DENIED");
    if (!hasValidLimits(value.limits, bundle.manifest.limits))
        return denied("HMI_ADAPTER_LIMIT_DENIED");
    if (!exactKeys(value.transport, ["harnessId", "adapterVersion", "invocationCorrelation", "presentationMode"])
        || !isValidTransportTuple(value.transport.harnessId, value.transport.adapterVersion)
        || typeof value.transport.invocationCorrelation !== "string"
        || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(value.transport.invocationCorrelation)
        || !["JSON", "MARKDOWN"].includes(value.transport.presentationMode)) {
        return denied("HMI_ADAPTER_SCHEMA_DENIED");
    }
    let inputDigest = null;
    if (value.selectedInput !== null) {
        try {
            const normalized = normalizeHmiSemanticResultV1(value.selectedInput);
            if (Buffer.byteLength(normalized.canonicalBytes, "utf8") > value.limits.maxSourceBytes) {
                return denied("HMI_ADAPTER_LIMIT_DENIED");
            }
            inputDigest = normalized.responseDigest;
        }
        catch {
            return denied("HMI_ADAPTER_INPUT_DENIED");
        }
    }
    const request = {
        schemaVersion: HMI_ADAPTER_REQUEST_SCHEMA_V1,
        operation: value.operation,
        generationDigest: pin.generationDigest,
        adapterContractVersion: HMI_ADAPTER_CONTRACT_VERSION_V1,
        query: value.query,
        selectors: [...value.selectors].sort(),
        inputDigest,
        limits: {
            maxReferences: value.limits.maxReferences,
            maxSourceBytes: value.limits.maxSourceBytes,
            maxFindings: value.limits.maxFindings,
            maxOutputBytes: value.limits.maxOutputBytes,
        },
    };
    const canonicalRequestBytes = canonicalJson(request);
    return {
        outcome: "MAPPED",
        request,
        canonicalRequestBytes,
        requestDigest: sha256(canonicalRequestBytes),
        transportEnvelope: value.transport,
    };
}
export function mapHmiHarnessResponseV1(mapping, semanticResult) {
    if (mapping.outcome !== "MAPPED")
        return { outcome: "DENIED", reasonCodes: mapping.reasonCodes };
    try {
        const normalized = normalizeHmiSemanticResultV1(semanticResult);
        if (Buffer.byteLength(normalized.canonicalBytes, "utf8") > mapping.request.limits.maxOutputBytes) {
            return { outcome: "DENIED", reasonCodes: ["HMI_ADAPTER_LIMIT_DENIED"] };
        }
        return {
            outcome: "MAPPED",
            canonicalResponseBytes: normalized.canonicalBytes,
            responseDigest: normalized.responseDigest,
            transportEnvelope: mapping.transportEnvelope,
        };
    }
    catch {
        return { outcome: "DENIED", reasonCodes: ["HMI_ADAPTER_INPUT_DENIED"] };
    }
}
