import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const CRM_READ_CONNECTOR_SCHEMA_V1 = "chimpmaera.connector/crm-read/v1";
export const CRM_READ_SOURCE_SCHEMA_V1 = "chimpmaera.connector/crm-supported-export/v1";
export const CRM_READ_SCOPE_V1 = "crm.synthetic.bi.read";
const CONTRACT_CONTENT = {
    schemaVersion: CRM_READ_CONNECTOR_SCHEMA_V1, contractVersion: "1.0.0", connectorId: "connector:synthetic-crm-bi-v1", defaultEnabled: false,
    adapter: "SUPPORTED_EXPORT_API_SHAPED", evidenceClass: "LOCAL_SYNTHETIC", tenantId: "tenant:synthetic-zoo",
    identity: { principalId: "principal:bi-m1-reader", scopes: [CRM_READ_SCOPE_V1], credentialSource: "EXPLICIT_REFERENCE_ONLY" },
    operations: ["LIST_ACCOUNTS", "LIST_OPPORTUNITIES", "READ_SOURCE_FACTS"],
    fields: { accounts: ["accountId", "accountName", "industry"], opportunities: ["opportunityId", "accountId", "opportunityName", "stage", "amount", "currency", "expectedCloseDate"] },
    policy: { maxPageSize: 2, maxAgeSeconds: 3600, writesAllowed: false, adminAllowed: false, unknownFieldsAllowed: false },
};
const sha = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const exact = (a, b) => canonicalJson(a) === canonicalJson(b);
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const keys = (v, expected) => record(v) && exact(Object.keys(v).sort(), [...expected].sort());
const id = (v) => typeof v === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(v);
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const timestamp = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) && !Number.isNaN(Date.parse(v));
export function crmReadConnectorContractDigestV1(value) {
    const content = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "contractDigest"));
    return sha(content);
}
export function verifyCrmReadConnectorContractV1(value) {
    return keys(value, [...Object.keys(CONTRACT_CONTENT), "contractDigest"]) && digest(value.contractDigest)
        && exact(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "contractDigest")), CONTRACT_CONTENT)
        && value.contractDigest === sha(CONTRACT_CONTENT);
}
function validRecord(entity, value) {
    if (entity === "accounts")
        return keys(value, CONTRACT_CONTENT.fields.accounts) && id(value.accountId) && typeof value.accountName === "string" && /^[A-Za-z0-9 &-]{1,64}$/.test(value.accountName) && typeof value.industry === "string" && /^[A-Z_]{2,32}$/.test(value.industry);
    return keys(value, CONTRACT_CONTENT.fields.opportunities) && id(value.opportunityId) && id(value.accountId) && typeof value.opportunityName === "string" && /^[A-Za-z0-9 &-]{1,64}$/.test(value.opportunityName) && ["QUALIFY", "PROPOSE", "WON", "LOST"].includes(String(value.stage)) && typeof value.amount === "number" && Number.isSafeInteger(value.amount) && value.amount >= 0 && value.currency === "EUR" && typeof value.expectedCloseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.expectedCloseDate);
}
function validateSource(value) {
    if (!keys(value, ["schemaVersion", "exportId", "tenantId", "generatedAt", "expiresAt", "lineage", "batches"]) || value.schemaVersion !== CRM_READ_SOURCE_SCHEMA_V1 || !id(value.exportId) || !id(value.tenantId) || !timestamp(value.generatedAt) || !timestamp(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.generatedAt) || !keys(value.lineage, ["sourceSystem", "sourceDatasetId", "extractionMode", "sourceDigest"]) || value.lineage.sourceSystem !== "SYNTHETIC_CRM" || !id(value.lineage.sourceDatasetId) || value.lineage.extractionMode !== "SUPPORTED_EXPORT" || !digest(value.lineage.sourceDigest) || !Array.isArray(value.batches))
        return "SOURCE_MALFORMED";
    const seen = new Set();
    let previous = 0;
    for (const batch of value.batches) {
        if (!keys(batch, ["batchId", "entity", "sequence", "complete", "records"]) || !id(batch.batchId) || !["accounts", "opportunities"].includes(String(batch.entity)) || !Number.isInteger(batch.sequence) || batch.sequence <= previous || seen.has(batch.batchId) || typeof batch.complete !== "boolean" || !Array.isArray(batch.records) || !batch.records.every((item) => validRecord(batch.entity, item)))
            return "SOURCE_MALFORMED";
        previous = batch.sequence;
        seen.add(batch.batchId);
        if (!batch.complete)
            return "SOURCE_PARTIAL";
    }
    const content = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "lineage"));
    const lineageContent = Object.fromEntries(Object.entries(value.lineage).filter(([key]) => key !== "sourceDigest"));
    if (value.lineage.sourceDigest !== sha({ ...content, lineage: lineageContent }))
        return "SOURCE_MALFORMED";
    return null;
}
export function createCrmReadAdapterV1({ contract, source, enabled, now }) {
    const consumed = new Set();
    return (request) => {
        if (!enabled)
            return { outcome: "DENIED", code: "CONNECTOR_DISABLED" };
        if (!verifyCrmReadConnectorContractV1(contract) || !timestamp(now) || !record(request))
            return { outcome: "DENIED", code: "REQUEST_MALFORMED" };
        if (Object.keys(request).some((key) => !["operation", "tenantId", "principalId", "scopes", "credentialPresent", "fields", "pageSize", "cursor"].includes(key)))
            return { outcome: "DENIED", code: "MUTATION_DENIED" };
        if (!request.credentialPresent)
            return { outcome: "DENIED", code: "CREDENTIAL_MISSING" };
        if (![...contract.operations].includes(request.operation))
            return { outcome: "DENIED", code: /CREATE|WRITE|UPDATE|DELETE|ADMIN|MUTAT/i.test(String(request.operation)) ? "MUTATION_DENIED" : "OPERATION_DENIED" };
        if (request.tenantId !== contract.tenantId)
            return { outcome: "DENIED", code: "TENANT_MISMATCH" };
        if (request.principalId !== contract.identity.principalId || !exact(request.scopes, contract.identity.scopes))
            return { outcome: "DENIED", code: "SCOPE_DENIED" };
        const entity = request.operation === "LIST_ACCOUNTS" ? "accounts" : "opportunities";
        const expectedFields = contract.fields[entity];
        if (!Array.isArray(request.fields) || !exact(request.fields, expectedFields))
            return { outcome: "DENIED", code: "FIELD_DENIED" };
        if (!Number.isInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > contract.policy.maxPageSize)
            return { outcome: "DENIED", code: "REQUEST_MALFORMED" };
        const sourceError = validateSource(source);
        if (sourceError)
            return { outcome: "DENIED", code: sourceError };
        const typedSource = source;
        if (typedSource.tenantId !== contract.tenantId)
            return { outcome: "DENIED", code: "TENANT_MISMATCH" };
        if (Date.parse(now) > Date.parse(typedSource.expiresAt) || Date.parse(now) - Date.parse(typedSource.generatedAt) > contract.policy.maxAgeSeconds * 1000)
            return { outcome: "DENIED", code: "SOURCE_STALE" };
        let offset = 0;
        if (request.cursor !== undefined) {
            if (typeof request.cursor !== "string")
                return { outcome: "DENIED", code: "REQUEST_MALFORMED" };
            if (consumed.has(request.cursor))
                return { outcome: "DENIED", code: "CURSOR_REPLAYED" };
            const match = /^crm1:([a-f0-9]{16}):(accounts|opportunities):(\d+)$/.exec(request.cursor);
            if (!match || match[1] !== typedSource.lineage.sourceDigest.slice(0, 16) || match[2] !== entity)
                return { outcome: "DENIED", code: "CURSOR_STALE" };
            offset = Number(match[3]);
            consumed.add(request.cursor);
        }
        const batches = typedSource.batches.filter((batch) => batch.entity === entity);
        const all = batches.flatMap((batch) => batch.records);
        const page = all.slice(offset, offset + request.pageSize);
        const next = offset + page.length;
        const nextCursor = next < all.length ? `crm1:${typedSource.lineage.sourceDigest.slice(0, 16)}:${entity}:${next}` : null;
        const metadata = { tenantId: typedSource.tenantId, trust: "LOCAL_SYNTHETIC", exportId: typedSource.exportId, generatedAt: typedSource.generatedAt, expiresAt: typedSource.expiresAt, sourceDatasetId: typedSource.lineage.sourceDatasetId, sourceDigest: typedSource.lineage.sourceDigest, batchIds: batches.map((batch) => batch.batchId), recordCount: page.length, pageSize: request.pageSize, nextCursor };
        return { outcome: "READ", entity, records: structuredClone(page), metadata, readbackDigest: sha({ entity, records: page, metadata }) };
    };
}
