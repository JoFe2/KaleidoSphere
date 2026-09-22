import { canonicalJson } from "./canonical-json.js";
import { assertCcpSafePositiveIntegerV1, assertCcpSafeUnsignedIntegerV1, assertCcpStringV1, ccpDigestDomainV1, ccpStrictDenyV1, CONTRIBUTION_ID_PATTERN, LEDGER_ID_PATTERN, readCcpClosedObjectV1, REPOSITORY_ID_PATTERN, TENANT_ID_PATTERN, } from "./ccp-event-envelope.js";
/**
 * CCP PSAI52 bounded intake boundary (M2 scheduler, cost side): a pure,
 * finite, explicit cost budget for a contribution's selection window. A
 * bounded receipt declaring how many finite cost units the window holds,
 * how many are committed and how many of those were consumed, with derived
 * remaining-units and exhausted counters.
 *
 * It has no network, persistence, clock, randomness, queue, runner, merge or
 * code-execution capability: declaring a budget allocates nothing, schedules
 * nothing and reads no clock or randomness. `logicalAtMs` is injected logical
 * time carried as data only. `remainingUnits` is a derived, bounded value:
 * budgetUnits - committedUnits. `exhausted` is a derived boolean: the budget
 * is exhausted when every unit is committed. Any malformed budget or
 * derived-count drift denies fail-closed before any budget receipt exists.
 */
export const CCP_COST_BUDGET_SCHEMA_V1 = "cm.ccp-cost-budget/v1";
const COST_BUDGET_SCHEMA_DENIED = "CCP_COST_BUDGET_SCHEMA_DENIED";
const COST_BUDGET_INPUT_KEYS = Object.freeze([
    "budgetId", "ledgerId", "tenantId", "repositoryId", "contributionId",
    "logicalAtMs", "budgetUnits", "committedUnits", "consumedUnits",
]);
const COST_BUDGET_KEYS = Object.freeze([
    "schemaVersion", "budgetId", "ledgerId", "tenantId", "repositoryId",
    "contributionId", "logicalAtMs", "budgetUnits", "committedUnits",
    "consumedUnits", "remainingUnits", "exhausted", "budgetDigest",
]);
const NAMESPACED_ID_SUFFIX = "[a-z0-9][a-z0-9._-]{2,95}";
const BUDGET_ID_PATTERN = new RegExp(`^budget:${NAMESPACED_ID_SUFFIX}$`);
function readIdentityV1(record) {
    return Object.freeze({
        ledgerId: assertCcpStringV1(record.ledgerId, LEDGER_ID_PATTERN, COST_BUDGET_SCHEMA_DENIED),
        tenantId: assertCcpStringV1(record.tenantId, TENANT_ID_PATTERN, COST_BUDGET_SCHEMA_DENIED),
        repositoryId: assertCcpStringV1(record.repositoryId, REPOSITORY_ID_PATTERN, COST_BUDGET_SCHEMA_DENIED),
        contributionId: assertCcpStringV1(record.contributionId, CONTRIBUTION_ID_PATTERN, COST_BUDGET_SCHEMA_DENIED),
    });
}
function readBudgetUnitsV1(record) {
    const logicalAtMs = assertCcpSafeUnsignedIntegerV1(record.logicalAtMs, COST_BUDGET_SCHEMA_DENIED);
    const budgetUnits = assertCcpSafePositiveIntegerV1(record.budgetUnits, COST_BUDGET_SCHEMA_DENIED);
    const committedUnits = assertCcpSafeUnsignedIntegerV1(record.committedUnits, COST_BUDGET_SCHEMA_DENIED);
    const consumedUnits = assertCcpSafeUnsignedIntegerV1(record.consumedUnits, COST_BUDGET_SCHEMA_DENIED);
    if (committedUnits > budgetUnits || consumedUnits > committedUnits) {
        ccpStrictDenyV1(COST_BUDGET_SCHEMA_DENIED);
    }
    return { logicalAtMs, budgetUnits, committedUnits, consumedUnits };
}
/**
 * Build an explicit finite cost budget for a contribution's selection window.
 * A malformed identity, a malformed budget id, a non-finite unit count or a
 * unit count out of order (committed > budget, consumed > committed) denies
 * fail-closed. Declaring a budget allocates nothing and reads no clock or
 * randomness.
 */
export function makeCcpCostBudgetV1(candidate) {
    const input = readCcpClosedObjectV1(candidate, COST_BUDGET_INPUT_KEYS, new WeakSet(), COST_BUDGET_SCHEMA_DENIED);
    const budgetId = assertCcpStringV1(input.budgetId, BUDGET_ID_PATTERN, COST_BUDGET_SCHEMA_DENIED);
    const identity = readIdentityV1(input);
    const { logicalAtMs, budgetUnits, committedUnits, consumedUnits } = readBudgetUnitsV1(input);
    const unsigned = Object.freeze({
        schemaVersion: CCP_COST_BUDGET_SCHEMA_V1,
        budgetId,
        ...identity,
        logicalAtMs,
        budgetUnits,
        committedUnits,
        consumedUnits,
        remainingUnits: budgetUnits - committedUnits,
        exhausted: committedUnits === budgetUnits,
    });
    return Object.freeze({
        ...unsigned,
        budgetDigest: ccpDigestDomainV1(CCP_COST_BUDGET_SCHEMA_V1, unsigned),
    });
}
/**
 * Parse and close a cost budget receipt. The identity, the budget id, the
 * finite unit counts and the derived counters are cross-validated; any drift
 * denies with a TypeError carrying the closed denial code. The returned
 * budget is the expected frozen budget.
 */
export function parseCcpCostBudgetV1(value) {
    const record = readCcpClosedObjectV1(value, COST_BUDGET_KEYS, new WeakSet(), COST_BUDGET_SCHEMA_DENIED);
    if (record.schemaVersion !== CCP_COST_BUDGET_SCHEMA_V1) {
        ccpStrictDenyV1(COST_BUDGET_SCHEMA_DENIED);
    }
    const budgetId = assertCcpStringV1(record.budgetId, BUDGET_ID_PATTERN, COST_BUDGET_SCHEMA_DENIED);
    const identity = readIdentityV1(record);
    const { logicalAtMs, budgetUnits, committedUnits, consumedUnits } = readBudgetUnitsV1(record);
    const remainingUnits = assertCcpSafeUnsignedIntegerV1(record.remainingUnits, COST_BUDGET_SCHEMA_DENIED);
    if (remainingUnits !== budgetUnits - committedUnits) {
        ccpStrictDenyV1(COST_BUDGET_SCHEMA_DENIED);
    }
    if (typeof record.exhausted !== "boolean" || record.exhausted !== (committedUnits === budgetUnits)) {
        ccpStrictDenyV1(COST_BUDGET_SCHEMA_DENIED);
    }
    const unsigned = Object.freeze({
        schemaVersion: CCP_COST_BUDGET_SCHEMA_V1,
        budgetId,
        ...identity,
        logicalAtMs,
        budgetUnits,
        committedUnits,
        consumedUnits,
        remainingUnits,
        exhausted: committedUnits === budgetUnits,
    });
    const budgetDigest = ccpDigestDomainV1(CCP_COST_BUDGET_SCHEMA_V1, unsigned);
    if (typeof record.budgetDigest !== "string" || record.budgetDigest !== budgetDigest) {
        ccpStrictDenyV1(COST_BUDGET_SCHEMA_DENIED);
    }
    return Object.freeze({ ...unsigned, budgetDigest });
}
/** Canonical JSON of the closed budget; byte order independent of input key order. */
export function canonicalCcpCostBudgetJsonV1(value) {
    return canonicalJson(parseCcpCostBudgetV1(value));
}
/** Domain-bound content digest of the closed budget. */
export function ccpCostBudgetDigestV1(value) {
    return parseCcpCostBudgetV1(value).budgetDigest;
}
/**
 * Verify a cost budget on read-back. Returns the closed budget on success;
 * returns null when the budget is malformed or forged (any rehashed drift in
 * the identity, the finite units, the derived counters or the budget digest).
 */
export function verifyCcpCostBudgetV1(value) {
    try {
        return parseCcpCostBudgetV1(value);
    }
    catch {
        return null;
    }
}
