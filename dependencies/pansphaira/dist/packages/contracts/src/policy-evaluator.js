import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const POLICY_EVALUATION_INPUT_API_VERSION = "chimpmaera.demo/policy-evaluation-input/v1";
export const TRUSTED_POLICY_CONTEXT_API_VERSION = "chimpmaera.demo/trusted-policy-context/v1";
export const POLICY_DECISION_API_VERSION = "chimpmaera.demo/policy-decision/v1";
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function exactKeys(value, expected) {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && canonicalJson(Object.keys(value).sort())
            === canonicalJson([...expected].sort());
}
export function verifyPolicyDecisionV1(decision, input, context) {
    if (!exactKeys(decision, [
        "constraints", "contextDigest", "decisionDigest", "evaluator",
        "inputDigest", "outcome", "reasonCodes", "schemaVersion",
    ]))
        return false;
    const { decisionDigest, ...core } = decision;
    return decision.schemaVersion === POLICY_DECISION_API_VERSION
        && input.schemaVersion === POLICY_EVALUATION_INPUT_API_VERSION
        && context.schemaVersion === TRUSTED_POLICY_CONTEXT_API_VERSION
        && decision.inputDigest === digest(input)
        && decision.contextDigest === digest(context)
        && decisionDigest === digest(core)
        && ["AUTO_GRANT", "OWNER_ESCALATION", "DENY"].includes(decision.outcome)
        && decision.constraints.authorityIssuer === "CHIMPMAERA_GATE_ONLY"
        && decision.constraints.exactInputRequired === true
        && decision.constraints.maximumEffects === (decision.outcome === "DENY" ? 0 : 1);
}
