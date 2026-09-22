import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const BUILDER_DISCOVERY_INPUT_API_VERSION = "chimpmaera.builder/discovery-input/v1";
export const BUILDER_DISCOVERY_RESULT_API_VERSION = "chimpmaera.builder/discovery-record/v1";
export const BUILDER_MACHINE_MANIFEST_API_VERSION = "chimpmaera.builder/machine-manifest/v1";
export const BUILDER_SYSTEM_ADVISOR_GUIDE_API_VERSION = "chimpmaera.builder/system-advisor-guide/v1";
export const BUILDER_DISCOVERY_EFFECT_CLASSES_V1 = [
    "READ_ONLY",
    "REVERSIBLE_WRITE",
    "IRREVERSIBLE_EFFECT",
    "INSTALL_ACTIVATE",
    "PUBLICATION",
];
export const BUILDER_CONTEXT_KINDS_V1 = [
    "CAUSE_EFFECT",
    "SAFETY",
    "ROLLBACK",
];
function isRecord(value) {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, expected) {
    return isRecord(value)
        && canonicalJson(Object.keys(value).sort())
            === canonicalJson([...expected].sort());
}
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function invalid() {
    throw new Error("BUILDER_DISCOVERY_INPUT_INVALID_DENIED");
}
function isIdentifier(value) {
    return typeof value === "string"
        && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(value);
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isBoundedText(value, maximum) {
    if (typeof value !== "string"
        || value.length === 0
        || value.length > maximum
        || value !== value.trim()
        || value !== value.normalize("NFC")
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
        return false;
    return !(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
        || /\b(?:gh[pousr]_|glpat-|sk-|hf_)[A-Za-z0-9_-]{16,}\b/.test(value)
        || /\b(?:password|passwd|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S{8,}/i.test(value));
}
function normalizeIdentifiers(value, minimum = 0, maximum = 32) {
    if (!Array.isArray(value)
        || value.length < minimum
        || value.length > maximum
        || value.some((entry) => !isIdentifier(entry)))
        return invalid();
    const normalized = [...value].sort();
    if (new Set(normalized).size !== normalized.length)
        return invalid();
    return normalized;
}
function normalizeTexts(value, maximumItems = 16) {
    if (!Array.isArray(value)
        || value.length > maximumItems
        || value.some((entry) => !isBoundedText(entry, 256)))
        return invalid();
    const normalized = [...value].sort();
    if (new Set(normalized).size !== normalized.length)
        return invalid();
    return normalized;
}
function normalizeObjects(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
        return invalid();
    }
    const objects = value.map((entry) => {
        if (!exactKeys(entry, [
            "dependencyObjectTypes",
            "description",
            "objectType",
        ]))
            return invalid();
        if (!isIdentifier(entry.objectType) || !isBoundedText(entry.description, 256)) {
            return invalid();
        }
        return {
            objectType: entry.objectType,
            description: entry.description,
            dependencyObjectTypes: normalizeIdentifiers(entry.dependencyObjectTypes),
        };
    }).sort((left, right) => left.objectType.localeCompare(right.objectType));
    const objectTypes = new Set(objects.map(({ objectType }) => objectType));
    if (objectTypes.size !== objects.length)
        return invalid();
    if (objects.some(({ dependencyObjectTypes }) => dependencyObjectTypes.some((reference) => !objectTypes.has(reference)))) {
        return invalid();
    }
    return objects;
}
function normalizeOperations(value, objectTypes) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
        return invalid();
    }
    const operations = value.map((entry) => {
        if (!exactKeys(entry, [
            "capabilityHint",
            "cause",
            "contextRefs",
            "effect",
            "effectClass",
            "objectType",
            "operationId",
            "reversible",
        ]))
            return invalid();
        if (!isIdentifier(entry.operationId)
            || !isIdentifier(entry.objectType)
            || !objectTypes.has(entry.objectType)
            || !BUILDER_DISCOVERY_EFFECT_CLASSES_V1.includes(entry.effectClass)
            || !isBoundedText(entry.cause, 256)
            || !isBoundedText(entry.effect, 256)
            || typeof entry.reversible !== "boolean"
            || !isIdentifier(entry.capabilityHint))
            return invalid();
        const effectClass = entry.effectClass;
        if ((effectClass === "READ_ONLY" && entry.reversible !== false)
            || (effectClass === "REVERSIBLE_WRITE" && entry.reversible !== true)
            || (["IRREVERSIBLE_EFFECT", "PUBLICATION"].includes(effectClass)
                && entry.reversible !== false))
            return invalid();
        return {
            operationId: entry.operationId,
            objectType: entry.objectType,
            effectClass,
            cause: entry.cause,
            effect: entry.effect,
            reversible: entry.reversible,
            contextRefs: normalizeIdentifiers(entry.contextRefs, 1),
            capabilityHint: entry.capabilityHint,
        };
    }).sort((left, right) => left.operationId.localeCompare(right.operationId));
    if (new Set(operations.map(({ operationId }) => operationId)).size !== operations.length) {
        return invalid();
    }
    return operations;
}
function normalizeContexts(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
        return invalid();
    }
    const contexts = value.map((entry) => {
        if (!exactKeys(entry, [
            "contextId",
            "dataClassification",
            "kind",
            "sourceRef",
            "statement",
        ]))
            return invalid();
        if (!isIdentifier(entry.contextId)
            || !BUILDER_CONTEXT_KINDS_V1.includes(entry.kind)
            || !isBoundedText(entry.statement, 512)
            || entry.dataClassification !== "SYNTHETIC"
            || !isIdentifier(entry.sourceRef))
            return invalid();
        return {
            contextId: entry.contextId,
            kind: entry.kind,
            statement: entry.statement,
            dataClassification: "SYNTHETIC",
            sourceRef: entry.sourceRef,
        };
    }).sort((left, right) => left.contextId.localeCompare(right.contextId));
    if (new Set(contexts.map(({ contextId }) => contextId)).size !== contexts.length) {
        return invalid();
    }
    return contexts;
}
function normalizeGuides(value, systemType, operationIds, contextIds) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
        return invalid();
    }
    const guides = value.map((entry) => {
        if (!exactKeys(entry, [
            "contentDigest",
            "contextRefs",
            "guideId",
            "operationRefs",
            "schemaVersion",
            "systemType",
            "title",
        ]))
            return invalid();
        if (entry.schemaVersion !== BUILDER_SYSTEM_ADVISOR_GUIDE_API_VERSION
            || !isIdentifier(entry.guideId)
            || entry.systemType !== systemType
            || !isBoundedText(entry.title, 160)
            || !isDigest(entry.contentDigest))
            return invalid();
        const operationRefs = normalizeIdentifiers(entry.operationRefs, 1);
        const contextRefs = normalizeIdentifiers(entry.contextRefs, 1);
        if (operationRefs.some((reference) => !operationIds.has(reference))
            || contextRefs.some((reference) => !contextIds.has(reference)))
            return invalid();
        return {
            schemaVersion: BUILDER_SYSTEM_ADVISOR_GUIDE_API_VERSION,
            guideId: entry.guideId,
            systemType,
            title: entry.title,
            operationRefs,
            contextRefs,
            contentDigest: entry.contentDigest,
        };
    }).sort((left, right) => left.guideId.localeCompare(right.guideId));
    if (new Set(guides.map(({ guideId }) => guideId)).size !== guides.length) {
        return invalid();
    }
    return guides;
}
function dependencyClosure(seed, objects) {
    const byType = new Map(objects.map((object) => [object.objectType, object]));
    const selected = new Set(seed);
    const pending = [...seed];
    while (pending.length > 0) {
        const current = pending.pop();
        if (current === undefined)
            break;
        for (const dependency of byType.get(current)?.dependencyObjectTypes ?? []) {
            if (!selected.has(dependency)) {
                selected.add(dependency);
                pending.push(dependency);
            }
        }
    }
    return selected;
}
export function discoverBuilderSystemV1(input) {
    if (!exactKeys(input, [
        "actor",
        "contexts",
        "guides",
        "intake",
        "machineManifest",
        "schemaVersion",
        "tenant",
    ]))
        return invalid();
    if (input.schemaVersion !== BUILDER_DISCOVERY_INPUT_API_VERSION
        || !isIdentifier(input.tenant)
        || !isIdentifier(input.actor)
        || !exactKeys(input.intake, ["constraints", "goal", "requestedOperationIds"])
        || !isBoundedText(input.intake.goal, 512)
        || !exactKeys(input.machineManifest, [
            "dataClassification",
            "manifestId",
            "objects",
            "operations",
            "schemaVersion",
            "systemId",
            "systemType",
            "tenant",
        ]))
        return invalid();
    const manifest = input.machineManifest;
    if (manifest.schemaVersion !== BUILDER_MACHINE_MANIFEST_API_VERSION
        || !isIdentifier(manifest.manifestId)
        || manifest.tenant !== input.tenant
        || !isIdentifier(manifest.systemId)
        || !isIdentifier(manifest.systemType)
        || manifest.dataClassification !== "SYNTHETIC")
        return invalid();
    const objects = normalizeObjects(manifest.objects);
    const objectTypes = new Set(objects.map(({ objectType }) => objectType));
    const operations = normalizeOperations(manifest.operations, objectTypes);
    const operationIds = new Set(operations.map(({ operationId }) => operationId));
    const contexts = normalizeContexts(input.contexts);
    const contextIds = new Set(contexts.map(({ contextId }) => contextId));
    if (operations.some(({ contextRefs }) => contextRefs.some((reference) => !contextIds.has(reference))))
        return invalid();
    const guides = normalizeGuides(input.guides, manifest.systemType, operationIds, contextIds);
    const contextSourceIds = new Set([
        manifest.manifestId,
        ...guides.map(({ guideId }) => guideId),
    ]);
    if (contexts.some(({ sourceRef }) => !contextSourceIds.has(sourceRef))) {
        return invalid();
    }
    const requestedOperationIds = normalizeIdentifiers(input.intake.requestedOperationIds, 1);
    if (requestedOperationIds.some((reference) => !operationIds.has(reference))) {
        return invalid();
    }
    const constraints = normalizeTexts(input.intake.constraints);
    const requestedSet = new Set(requestedOperationIds);
    const discoveredOperations = operations.filter(({ operationId }) => requestedSet.has(operationId));
    const selectedGuides = guides.filter(({ operationRefs }) => operationRefs.some((reference) => requestedSet.has(reference)));
    if (selectedGuides.length === 0 || discoveredOperations.some((operation) => !selectedGuides.some((guide) => guide.operationRefs.includes(operation.operationId)
        && operation.contextRefs.every((contextId) => guide.contextRefs.includes(contextId))))) {
        return invalid();
    }
    const selectedContextIds = new Set(discoveredOperations.flatMap(({ contextRefs }) => contextRefs));
    const selectedObjectTypes = dependencyClosure(discoveredOperations.map(({ objectType }) => objectType), objects);
    const normalizedManifest = {
        schemaVersion: BUILDER_MACHINE_MANIFEST_API_VERSION,
        manifestId: manifest.manifestId,
        tenant: input.tenant,
        systemId: manifest.systemId,
        systemType: manifest.systemType,
        dataClassification: "SYNTHETIC",
        objects,
        operations,
    };
    const normalizedInput = {
        schemaVersion: BUILDER_DISCOVERY_INPUT_API_VERSION,
        tenant: input.tenant,
        actor: input.actor,
        intake: {
            goal: input.intake.goal,
            requestedOperationIds,
            constraints,
        },
        machineManifest: normalizedManifest,
        guides,
        contexts,
    };
    const core = {
        schemaVersion: BUILDER_DISCOVERY_RESULT_API_VERSION,
        claim: "DISCOVERY_RECORD_ONLY_NO_AUTHORITY_OR_EFFECT",
        tenant: input.tenant,
        actor: input.actor,
        goal: input.intake.goal,
        system: {
            manifestId: manifest.manifestId,
            systemId: manifest.systemId,
            systemType: manifest.systemType,
            dataClassification: "SYNTHETIC",
        },
        requestedOperationIds,
        constraints,
        discoveredObjects: objects.filter(({ objectType }) => selectedObjectTypes.has(objectType)),
        discoveredOperations,
        selectedGuides,
        selectedContexts: contexts.filter(({ contextId }) => selectedContextIds.has(contextId)),
        sourceDigests: {
            manifest: digest(normalizedManifest),
            guides: selectedGuides.map(({ guideId, contentDigest }) => ({
                guideId,
                contentDigest,
            })),
        },
        inputDigest: digest(normalizedInput),
    };
    return { ...core, recordDigest: digest(core) };
}
