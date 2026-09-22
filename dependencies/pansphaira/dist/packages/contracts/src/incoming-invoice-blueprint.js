export const INCOMING_INVOICE_BLUEPRINT_SCHEMA_VERSION = "chimpmaera.incoming-invoice/blueprint/v1";
export const INCOMING_INVOICE_SCENARIO_INPUT_VERSION = "chimpmaera.incoming-invoice/scenario-input/v1";
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}
export const INCOMING_INVOICE_BLUEPRINT_V1 = deepFreeze({
    schemaVersion: INCOMING_INVOICE_BLUEPRINT_SCHEMA_VERSION,
    blueprintVersion: "1.0.0",
    claim: "LOCAL_SYNTHETIC_BLUEPRINT_ONLY_NO_CUSTOMER_DATA_NO_PRODUCTIVE_BOOKING",
    layers: [
        { ordinal: 1, layerId: "SOURCE", version: "1.0.0" },
        { ordinal: 2, layerId: "DOCUMENT", version: "1.0.0" },
        { ordinal: 3, layerId: "EXTRACTION", version: "1.0.0" },
        { ordinal: 4, layerId: "VALIDATION", version: "1.0.0" },
        { ordinal: 5, layerId: "MATCHING", version: "1.0.0" },
        { ordinal: 6, layerId: "EXCEPTION_ADVISOR", version: "1.0.0" },
        { ordinal: 7, layerId: "ADAPTIVE_UI", version: "1.0.0" },
        { ordinal: 8, layerId: "RECEIPT_EVIDENCE_VERDICT", version: "1.0.0" },
    ],
    complexityModel: {
        vectorVersion: "1.0.0",
        fields: ["documentVariance", "approvalDepth", "integrationCount", "segregationRequired"],
        rules: [
            { priority: 1, ruleId: "SEGREGATION_REQUIRED_V1", scenario: "SEGREGATED_ENTERPRISE", predicate: "segregationRequired === true" },
            { priority: 2, ruleId: "CONTROLLED_SCORE_V1", scenario: "CONTROLLED", predicate: "documentVariance + approvalDepth + integrationCount >= 3" },
            { priority: 3, ruleId: "LEAN_LOW_COMPLEXITY_V1", scenario: "LEAN", predicate: "otherwise" },
        ],
    },
    scopeFreeze: {
        scope: ["local synthetic incoming-invoice scenario resolution", "deterministic source-to-proof blueprint validation"],
        nonScope: ["customer data processing", "live provider calls", "productive accounting booking", "universal adaptability claims"],
        actors: ["local proof operator", "synthetic invoice fixture"],
        outcomes: ["deterministic scenario selection", "local synthetic proof contract"],
        risks: ["hidden complexity input", "unsupported effect authority", "productive booking confusion"],
        falsifiers: ["same vector resolves differently", "company size changes scenario", "customer data or productive booking becomes authorized"],
    },
    authority: {
        mode: "LOCAL_SYNTHETIC_PROOF",
        allowedEffects: ["READ_SYNTHETIC", "WRITE_LOCAL_PROOF"],
        customerDataAuthorized: false,
        productiveBookingAuthorized: false,
        externalCallsAuthorized: false,
    },
});
function isRecord(value) {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function hasExactKeys(value, expected) {
    const actual = Object.keys(value).sort();
    return actual.length === expected.length
        && actual.every((key, index) => key === [...expected].sort()[index]);
}
function denied(reason) {
    return deepFreeze({ outcome: "DENIED", reasonCodes: [reason] });
}
export function resolveIncomingInvoiceScenarioV1(input) {
    const inputKeys = ["requestedAuthority", "requestedEffects", "schemaVersion", "vector"];
    if (!isRecord(input))
        return denied("VECTOR_FIELD_DENIED");
    const unknownInput = Object.keys(input).some((key) => !inputKeys.includes(key));
    if (unknownInput)
        return denied("UNKNOWN_INPUT_FIELD_DENIED");
    if (!hasExactKeys(input, inputKeys))
        return denied("VECTOR_FIELD_DENIED");
    if (input.schemaVersion !== INCOMING_INVOICE_SCENARIO_INPUT_VERSION)
        return denied("VERSION_DENIED");
    if (input.requestedAuthority !== "LOCAL_SYNTHETIC_PROOF")
        return denied("AUTHORITY_DENIED");
    if (!Array.isArray(input.requestedEffects)
        || input.requestedEffects.length !== 2
        || input.requestedEffects[0] !== "READ_SYNTHETIC"
        || input.requestedEffects[1] !== "WRITE_LOCAL_PROOF")
        return denied("EFFECT_DENIED");
    const vectorKeys = ["approvalDepth", "documentVariance", "integrationCount", "segregationRequired"];
    if (!isRecord(input.vector))
        return denied("VECTOR_FIELD_DENIED");
    const unknownVector = Object.keys(input.vector)
        .some((key) => !vectorKeys.includes(key));
    if (unknownVector)
        return denied("UNKNOWN_VECTOR_FIELD_DENIED");
    if (!hasExactKeys(input.vector, vectorKeys))
        return denied("VECTOR_FIELD_DENIED");
    const dimensions = [input.vector.documentVariance, input.vector.approvalDepth, input.vector.integrationCount];
    if (dimensions.some((value) => !Number.isInteger(value) || ![0, 1, 2].includes(value))
        || typeof input.vector.segregationRequired !== "boolean")
        return denied("VECTOR_VALUE_DENIED");
    const vector = deepFreeze(structuredClone(input.vector));
    const score = vector.documentVariance + vector.approvalDepth + vector.integrationCount;
    const resolution = vector.segregationRequired
        ? { scenario: "SEGREGATED_ENTERPRISE", ruleId: "SEGREGATION_REQUIRED_V1" }
        : score >= 3
            ? { scenario: "CONTROLLED", ruleId: "CONTROLLED_SCORE_V1" }
            : { scenario: "LEAN", ruleId: "LEAN_LOW_COMPLEXITY_V1" };
    return deepFreeze({
        outcome: "ACCEPTED",
        scenario: resolution.scenario,
        derivation: { ruleId: resolution.ruleId, score, vector },
        authority: {
            mode: "LOCAL_SYNTHETIC_PROOF",
            allowedEffects: ["READ_SYNTHETIC", "WRITE_LOCAL_PROOF"],
            customerDataAuthorized: false,
            productiveBookingAuthorized: false,
        },
    });
}
