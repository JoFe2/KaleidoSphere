import { canonicalJson } from "./canonical-json.js";
import { evaluateAgentWorkProcessInputV1, } from "./agent-work-process-input.js";
export const AGENT_WORK_PROCESS_TRACE_SCHEMA_V1 = "chimpmaera.agent-work-intelligence/process-trace/v1";
export const AGENT_WORK_PROCESS_TRACE_CLAIM_BOUNDARY_V1 = "LOCAL_SYNTHETIC_CAUSAL_TRACE_ONLY_NO_METRICS_NO_DURATION_NO_BOTTLENECK_NO_QUALITY_NO_COLLECTION_NO_TELEMETRY_NO_MONITORING_NO_PRODUCTION_INGESTION";
function fixed(outcome) {
    if (outcome === "DENIED") {
        return {
            schemaVersion: AGENT_WORK_PROCESS_TRACE_SCHEMA_V1,
            outcome,
            reasonCode: "INPUT_DENIED",
            claimBoundary: AGENT_WORK_PROCESS_TRACE_CLAIM_BOUNDARY_V1,
        };
    }
    return {
        schemaVersion: AGENT_WORK_PROCESS_TRACE_SCHEMA_V1,
        outcome,
        reasonCode: "CAUSALITY_UNKNOWN",
        claimBoundary: AGENT_WORK_PROCESS_TRACE_CLAIM_BOUNDARY_V1,
    };
}
function compareEvents(left, right) {
    return left.occurredAtMs - right.occurredAtMs || left.eventId.localeCompare(right.eventId);
}
export function evaluateAgentWorkProcessTraceV1(value) {
    if (evaluateAgentWorkProcessInputV1(value).outcome !== "ACCEPTED") {
        return fixed("DENIED");
    }
    const input = value;
    const byId = new Map(input.events.map((event) => [event.eventId, event]));
    const indegree = new Map(input.events.map((event) => [event.eventId, event.causeEventIds.length]));
    const dependants = new Map(input.events.map((event) => [event.eventId, []]));
    for (const event of input.events) {
        for (const causeId of event.causeEventIds) {
            const cause = byId.get(causeId);
            if (cause.occurredAtMs > event.occurredAtMs)
                return fixed("UNKNOWN");
            dependants.get(causeId).push(event);
        }
    }
    const ready = input.events.filter((event) => indegree.get(event.eventId) === 0).sort(compareEvents);
    const ordered = [];
    while (ready.length > 0) {
        const event = ready.shift();
        ordered.push(event);
        for (const dependant of dependants.get(event.eventId).sort(compareEvents)) {
            const remaining = indegree.get(dependant.eventId) - 1;
            indegree.set(dependant.eventId, remaining);
            if (remaining === 0) {
                ready.push(dependant);
                ready.sort(compareEvents);
            }
        }
    }
    if (ordered.length !== input.events.length)
        return fixed("UNKNOWN");
    return {
        schemaVersion: AGENT_WORK_PROCESS_TRACE_SCHEMA_V1,
        outcome: "ACCEPTED",
        reasonCode: "TRACE_RECONSTRUCTED",
        claimBoundary: AGENT_WORK_PROCESS_TRACE_CLAIM_BOUNDARY_V1,
        trace: ordered.map((event, ordinal) => ({
            ordinal,
            eventId: event.eventId,
            phase: event.phase,
            outcome: event.outcome,
            occurredAtMs: event.occurredAtMs,
            causeEventIds: [...event.causeEventIds].sort(),
            evidenceDigests: [...event.evidenceDigests].sort(),
        })),
    };
}
export function renderPublicAgentWorkProcessTraceV1(value) {
    return canonicalJson(evaluateAgentWorkProcessTraceV1(value));
}
