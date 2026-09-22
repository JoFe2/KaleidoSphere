import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const ERP_READ_CONNECTOR_SCHEMA_V1 = "chimpmaera.connector/erp-read/v1";
export const ERP_READ_SOURCE_SCHEMA_V1 = "chimpmaera.connector/erp-supported-export/v1";
export const ERP_READ_SCOPE_V1 = "erp.synthetic.bi.read";
const CONTRACT_CONTENT = { schemaVersion: ERP_READ_CONNECTOR_SCHEMA_V1, contractVersion: "1.0.0", connectorId: "connector:synthetic-erp-bi-v1", defaultEnabled: false, adapter: "SUPPORTED_EXPORT_API_SHAPED", evidenceClass: "LOCAL_SYNTHETIC", tenantId: "tenant:synthetic-zoo", identity: { principalId: "principal:bi-m1-reader", scopes: [ERP_READ_SCOPE_V1], credentialSource: "EXPLICIT_REFERENCE_ONLY" }, operations: ["LIST_CUSTOMERS", "LIST_ORDERS", "LIST_INVOICES", "READ_SOURCE_FACTS"], fields: { customers: ["customerId", "customerStatus"], orders: ["orderId", "customerId", "orderStatus", "orderDate", "totalMinor", "currency"], invoices: ["invoiceId", "orderId", "customerId", "invoiceStatus", "issueDate", "dueDate", "totalMinor", "currency"] }, policy: { maxPageSize: 2, maxAgeSeconds: 3600, writesAllowed: false, approvalsAllowed: false, adminAllowed: false, broadDatabaseAccessAllowed: false, unknownFieldsAllowed: false } };
const sha = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const exact = (a, b) => canonicalJson(a) === canonicalJson(b);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const keys = (v, expected) => object(v) && exact(Object.keys(v).sort(), [...expected].sort());
const id = (v) => typeof v === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(v);
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const timestamp = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) && !Number.isNaN(Date.parse(v));
const date = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export function erpReadConnectorContractDigestV1(value) { return sha(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "contractDigest"))); }
export function verifyErpReadConnectorContractV1(value) { return keys(value, [...Object.keys(CONTRACT_CONTENT), "contractDigest"]) && digest(value.contractDigest) && exact(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "contractDigest")), CONTRACT_CONTENT) && value.contractDigest === sha(CONTRACT_CONTENT); }
function validFacts(entity, value) {
    if (entity === "customers")
        return keys(value, CONTRACT_CONTENT.fields.customers) && id(value.customerId) && ["ACTIVE", "ON_HOLD"].includes(String(value.customerStatus));
    if (entity === "orders")
        return keys(value, CONTRACT_CONTENT.fields.orders) && id(value.orderId) && id(value.customerId) && ["OPEN", "FULFILLED", "CANCELLED"].includes(String(value.orderStatus)) && date(value.orderDate) && Number.isSafeInteger(value.totalMinor) && value.totalMinor >= 0 && value.currency === "EUR";
    return keys(value, CONTRACT_CONTENT.fields.invoices) && id(value.invoiceId) && id(value.orderId) && id(value.customerId) && ["OPEN", "PAID", "VOID"].includes(String(value.invoiceStatus)) && date(value.issueDate) && date(value.dueDate) && Date.parse(`${value.dueDate}T00:00:00Z`) >= Date.parse(`${value.issueDate}T00:00:00Z`) && Number.isSafeInteger(value.totalMinor) && value.totalMinor >= 0 && value.currency === "EUR";
}
function validateSource(value) {
    if (!keys(value, ["schemaVersion", "exportId", "tenantId", "generatedAt", "expiresAt", "lineage", "batches"]) || value.schemaVersion !== ERP_READ_SOURCE_SCHEMA_V1 || !id(value.exportId) || !id(value.tenantId) || !timestamp(value.generatedAt) || !timestamp(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.generatedAt) || !keys(value.lineage, ["sourceSystem", "sourceDatasetId", "extractionMode", "sourceDigest"]) || value.lineage.sourceSystem !== "SYNTHETIC_ERP" || !id(value.lineage.sourceDatasetId) || value.lineage.extractionMode !== "SUPPORTED_EXPORT" || !digest(value.lineage.sourceDigest) || !Array.isArray(value.batches))
        return "SOURCE_MALFORMED";
    const batchIds = new Set();
    const recordIds = new Set();
    let previousBatch = 0;
    for (const batch of value.batches) {
        if (!keys(batch, ["batchId", "entity", "sequence", "complete", "records"]) || !id(batch.batchId) || !["customers", "orders", "invoices"].includes(String(batch.entity)) || !Number.isInteger(batch.sequence) || batch.sequence <= previousBatch || batchIds.has(batch.batchId) || typeof batch.complete !== "boolean" || !Array.isArray(batch.records))
            return "SOURCE_MALFORMED";
        previousBatch = batch.sequence;
        batchIds.add(batch.batchId);
        if (!batch.complete)
            return "SOURCE_PARTIAL";
        let previousRecord = 0;
        for (const entry of batch.records) {
            if (!keys(entry, ["recordMetadata", "facts"]) || !keys(entry.recordMetadata, ["sourceRecordId", "sourceUpdatedAt", "lineageSequence"]) || !id(entry.recordMetadata.sourceRecordId) || recordIds.has(entry.recordMetadata.sourceRecordId) || !timestamp(entry.recordMetadata.sourceUpdatedAt) || !Number.isInteger(entry.recordMetadata.lineageSequence) || entry.recordMetadata.lineageSequence <= previousRecord || !validFacts(batch.entity, entry.facts))
                return "SOURCE_MALFORMED";
            previousRecord = entry.recordMetadata.lineageSequence;
            recordIds.add(entry.recordMetadata.sourceRecordId);
        }
    }
    const content = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "lineage"));
    const lineage = Object.fromEntries(Object.entries(value.lineage).filter(([key]) => key !== "sourceDigest"));
    return value.lineage.sourceDigest === sha({ ...content, lineage }) ? null : "SOURCE_MALFORMED";
}
export function createErpReadAdapterV1({ contract, source, enabled, now }) {
    const consumed = new Set();
    return (request) => {
        if (!enabled)
            return { outcome: "DENIED", code: "CONNECTOR_DISABLED" };
        if (!verifyErpReadConnectorContractV1(contract) || !timestamp(now) || !object(request))
            return { outcome: "DENIED", code: "REQUEST_MALFORMED" };
        const allowedKeys = ["operation", "entity", "tenantId", "principalId", "scopes", "credentialPresent", "fields", "pageSize", "cursor"];
        if (Object.keys(request).some((key) => !allowedKeys.includes(key)))
            return { outcome: "DENIED", code: /sql|database|table|query/i.test(Object.keys(request).join(" ")) ? "DATABASE_ACCESS_DENIED" : "MUTATION_DENIED" };
        if (!request.credentialPresent)
            return { outcome: "DENIED", code: "CREDENTIAL_MISSING" };
        if (![...contract.operations].includes(request.operation)) {
            const op = String(request.operation);
            return { outcome: "DENIED", code: /DATABASE|SQL|QUERY_TABLE|DUMP|EXPORT_ALL/i.test(op) ? "DATABASE_ACCESS_DENIED" : /CREATE|POST|APPROVE|WRITE|UPDATE|DELETE|ADMIN|MUTAT/i.test(op) ? "MUTATION_DENIED" : "OPERATION_DENIED" };
        }
        if (request.tenantId !== contract.tenantId)
            return { outcome: "DENIED", code: "TENANT_MISMATCH" };
        if (request.principalId !== contract.identity.principalId || !exact(request.scopes, contract.identity.scopes))
            return { outcome: "DENIED", code: "SCOPE_DENIED" };
        const entity = request.operation === "LIST_CUSTOMERS" ? "customers" : request.operation === "LIST_ORDERS" ? "orders" : request.operation === "LIST_INVOICES" ? "invoices" : request.entity;
        if (!["customers", "orders", "invoices"].includes(String(entity)))
            return { outcome: "DENIED", code: "REQUEST_MALFORMED" };
        const typedEntity = entity;
        if (!Array.isArray(request.fields) || !exact(request.fields, contract.fields[typedEntity]))
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
            const match = /^erp1:([a-f0-9]{16}):(customers|orders|invoices):(\d+)$/.exec(request.cursor);
            if (!match || match[1] !== typedSource.lineage.sourceDigest.slice(0, 16) || match[2] !== typedEntity)
                return { outcome: "DENIED", code: "CURSOR_STALE" };
            offset = Number(match[3]);
            consumed.add(request.cursor);
        }
        const batches = typedSource.batches.filter((batch) => batch.entity === typedEntity);
        const all = batches.flatMap((batch) => batch.records);
        const page = all.slice(offset, offset + request.pageSize);
        const next = offset + page.length;
        const nextCursor = next < all.length ? `erp1:${typedSource.lineage.sourceDigest.slice(0, 16)}:${typedEntity}:${next}` : null;
        const records = page.map((entry) => entry.facts);
        const metadata = { tenantId: typedSource.tenantId, trust: "LOCAL_SYNTHETIC", principalId: contract.identity.principalId, scope: ERP_READ_SCOPE_V1, exportId: typedSource.exportId, generatedAt: typedSource.generatedAt, expiresAt: typedSource.expiresAt, sourceDatasetId: typedSource.lineage.sourceDatasetId, sourceDigest: typedSource.lineage.sourceDigest, batchIds: batches.map((batch) => batch.batchId), recordMetadata: page.map((entry) => entry.recordMetadata), recordCount: page.length, pageSize: request.pageSize, nextCursor };
        return { outcome: "READ", entity: typedEntity, records: structuredClone(records), metadata: structuredClone(metadata), readbackDigest: sha({ entity: typedEntity, records, metadata }) };
    };
}
const ERP_ORDER_SOURCE_LABEL_V1 = "LOCAL_SYNTHETIC_ERP_ORDER_SOURCE_V1";
const bytesSha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function decodeJsonBytesV1(value) {
    try {
        const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return { bytes, json: JSON.parse(text) };
    }
    catch {
        return null;
    }
}
/**
 * Narrow PAN437 consumer entry point. It runs the existing ERP read adapter
 * against labelled source bytes, including source-digest, tenant, freshness
 * and pagination checks. It never derives delivery facts from an order result.
 */
export function readErpOrdersFromLabelledSourceBytesV1({ contract, sourceBytes, sourceLabel, enabled, now, }) {
    if (sourceLabel !== ERP_ORDER_SOURCE_LABEL_V1)
        return { outcome: "DENIED", code: "SOURCE_LABEL_DENIED" };
    const decoded = decodeJsonBytesV1(sourceBytes);
    if (decoded === null)
        return { outcome: "DENIED", code: "SOURCE_BYTES_MALFORMED" };
    const read = createErpReadAdapterV1({ contract, source: decoded.json, enabled, now });
    const firstRequest = {
        operation: "LIST_ORDERS", entity: "orders", tenantId: "tenant:synthetic-zoo",
        principalId: "principal:bi-m1-reader", scopes: [ERP_READ_SCOPE_V1], credentialPresent: true,
        fields: ["orderId", "customerId", "orderStatus", "orderDate", "totalMinor", "currency"], pageSize: 2,
    };
    const pages = [];
    let request = firstRequest;
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const result = read(request);
        if (result.outcome === "DENIED")
            return result;
        if (result.entity !== "orders")
            return { outcome: "DENIED", code: "SOURCE_MALFORMED" };
        pages.push(result);
        if (result.metadata.nextCursor === null)
            break;
        request = { ...firstRequest, cursor: result.metadata.nextCursor };
        if (pageNumber === 99)
            return { outcome: "DENIED", code: "SOURCE_MALFORMED" };
    }
    const first = pages[0];
    if (first === undefined || pages.some((page) => page.metadata.sourceDigest !== first.metadata.sourceDigest
        || page.metadata.tenantId !== first.metadata.tenantId || page.metadata.exportId !== first.metadata.exportId)) {
        return { outcome: "DENIED", code: "SOURCE_MALFORMED" };
    }
    const records = pages.flatMap((page) => page.records);
    const metadata = {
        ...first.metadata,
        sourceBytesSha256: bytesSha256(decoded.bytes),
        batchIds: [...new Set(pages.flatMap((page) => page.metadata.batchIds))],
        recordMetadata: pages.flatMap((page) => page.metadata.recordMetadata),
        recordCount: records.length,
        pageSize: first.metadata.pageSize,
        nextCursor: null,
    };
    return { outcome: "READ", entity: "orders", records: structuredClone(records), metadata, readbackDigest: sha({ entity: "orders", records, metadata }) };
}
