import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const SIGNAL_RELEASE_INTAKE_SCHEMA_V1 = "chimpmaera.dev/signal-release-intake/v1";
export const SIGNAL_RELEASE_INTAKE_GATES_V1 = [
    "THREAD_LIVE",
    "NOT_DUPLICATE",
    "CHIMPMAERA_FIT",
    "PROBLEM_EVIDENCED",
    "ACTIONABLE",
    "PUBLIC_ONLY",
    "CONTENT_SAFE",
    "IP_CLEAR",
    "LOCAL_DECISION_ONLY",
];
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, expected) {
    return canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}
/** Pure, closed and fail-closed: this function has no monitoring, posting or release path. */
export function evaluateSignalReleaseIntakeV1(value) {
    if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "signalDigest", "gates"])
        || value.schemaVersion !== SIGNAL_RELEASE_INTAKE_SCHEMA_V1
        || typeof value.signalDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.signalDigest)
        || !isRecord(value.gates) || !exactKeys(value.gates, SIGNAL_RELEASE_INTAKE_GATES_V1)
        || !Object.values(value.gates).every((gate) => typeof gate === "boolean")) {
        throw new TypeError("SIGNAL_RELEASE_INTAKE_SCHEMA_DENIED");
    }
    const gates = value.gates;
    const rejectionReasons = SIGNAL_RELEASE_INTAKE_GATES_V1
        .filter((gate) => !gates[gate])
        .map((gate) => `${gate}_DENIED`);
    const unsigned = {
        disposition: rejectionReasons.length === 0 ? "PRE_CANDIDATE" : "REJECTED",
        rejectionReasons,
        evaluatedGates: SIGNAL_RELEASE_INTAKE_GATES_V1,
        authorityBoundary: "LOCAL_SYNTHETIC_DECISION_NO_MONITORING_POSTING_OR_RELEASE",
    };
    return {
        ...unsigned,
        decisionDigest: createHash("sha256").update(canonicalJson({ signalDigest: value.signalDigest, ...unsigned })).digest("hex"),
    };
}
