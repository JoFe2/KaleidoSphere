#!/usr/bin/env node
// KS238 PAN-side bounded order/source handoff — read-only composition.
//
// This is the concrete PAN-side source handoff required by KaleidoSphere
// KS238 (SALES-ANALYSIS-01): it reuses the released order/source definitions
// and existing capability cells rather than building a second order module.
//
// It provides a small, executable, read-only adapter over the ACTUAL
// existing PAN order-reader results:
//   - readErpOrdersFromLabelledSourceBytesV1 (contract
//     chimpmaera.connector/erp-read/v1, LOCAL_SYNTHETIC trust)
//   - createErpReadAdapterV1 LIST_CUSTOMERS, drained across pages by its own
//     cursor with bounded page identity checks
//   - the ERP_ORDER_SEMANTICS_V1 vocabulary of the erp-order-capability-cell,
//     retained ONLY as explicitly non-evidentiary capability metadata for
//     this reader (see KS238_SEMANTICS_V1 / KS238_QUANTITY_UNAVAILABLE_V1)
//
// Authority model:
//   - The public entry point executes the released readers itself against the
//     labelled source bytes, the released read contract, and the decision
//     time. It never accepts caller-owned read results or caller-owned
//     bindings as authority.
//   - A serialized consumer carries exactly: the serialized binding +
//     bindingDigest, the source label, the source bytes, the source bytes
//     sha256, the released read contract, and the decision time. Rebinding
//     re-executes the released readers against THOSE independently selected
//     bytes/contract/time — the identity retained outside the substituted
//     payload — and requires the freshly derived binding to match the carried
//     one exactly. Raw caller-rehashed reader facts are not accepted at this
//     boundary at all.
//
// It exposes ONLY evidenced order/customer/status/period facts and explicit
// unsupported/missing semantics to the downstream sales analysis:
//   - net revenue is NEVER inferred from order status or ordered quantity;
//   - ordered quantity and its unit are UNAVAILABLE for this reader: the
//     selected order source and the released reader expose no per-order
//     quantity or unit, and a unitless reader result never becomes a
//     per-order EACH fact;
//   - absent currency/amount/history/delivery facts remain unavailable, and
//     the explicit unsupported/missing semantics are part of the binding, so
//     they are digest-bound to the consumer contract, survive serialization
//     and are returned on rebind.
//
// This is a local synthetic source handoff, not production ERP qualification
// or a complete KS238 capability. It grants no order-management, write,
// approval, network, provider, runtime, publication or public-write authority.

import { createHash } from "node:crypto";
import {
  ERP_ORDER_SEMANTICS_V1,
  canonicalJson,
  createErpReadAdapterV1,
  readErpOrdersFromLabelledSourceBytesV1,
  verifyErpReadConnectorContractV1,
} from "../../dist/packages/contracts/src/index.js";

export const KS238_ORDER_SOURCE_SCHEMA_V1 = "pansphaira.ks238/order-source-handoff/v1";
export const KS238_CONSUMER_CONTRACT_V1 = "ks238.sales-analysis.order-source/v1";
export const KS238_SOURCE_LABEL_V1 = "LOCAL_SYNTHETIC_ERP_ORDER_SOURCE_V1";
export const KS238_SOURCE_MODULE_ID_V1 = "connector:synthetic-erp-bi-v1";
export const KS238_SOURCE_CONTRACT_V1 = "chimpmaera.connector/erp-read/v1";
export const KS238_PERIOD_GRANULARITY_V1 = "CALENDAR_MONTH";
// Retained vocabulary of the erp-order-capability-cell. For THIS reader the
// selected source and the released reader expose no quantity and no unit, so
// this is non-evidentiary capability metadata only; it is never emitted as a
// per-order unit fact (see KS238_QUANTITY_UNAVAILABLE_V1).
export const KS238_SEMANTICS_V1 = ERP_ORDER_SEMANTICS_V1;
export const KS238_QUANTITY_MEANING_V1 = "DISCRETE_UNITS";
export const KS238_QUANTITY_UNIT_V1 = "EACH";
// Per-order quantity and unit are explicitly unavailable for this reader.
export const KS238_QUANTITY_UNAVAILABLE_V1 = { quantity: "UNAVAILABLE", unit: "UNAVAILABLE" };

export const KS238_SUPPORTED_FACTS_V1 = [
  "orderIdentity",
  "customerIdentity",
  "orderStatus",
  "orderPeriod",
];
export const KS238_UNSUPPORTED_FACTS_V1 = [
  "netRevenue",
  "orderedQuantity",
  "quantityUnit",
  "amount",
  "currencyValue",
  "deliveryFacts",
  "historicalOrderBook",
  "orderIntake",
  "creditsCancellationsNetting",
];
export const KS238_MISSING_FIELDS_V1 = [
  "amount.currencyValue",
  "amount.netRevenue",
  "quantity.orderedQuantity",
  "quantity.unit",
  "delivery.deliveryId",
  "delivery.deliveredAt",
  "history.previousStates",
];

// Bounded cursor drain for the customer reader: hard ceiling on pages. The
// released reader itself denies a replayed cursor (CURSOR_REPLAYED); the
// per-page record-digest check below additionally fails closed on any
// duplicated page content within one drain.
const KS238_CUSTOMER_MAX_PAGES_V1 = 128;

// The released reader proves a closed customer status vocabulary.
const CUSTOMER_STATUS = new Set(["ACTIVE", "ON_HOLD"]);

// Explicit, closed missing/unsupported semantics. This object is embedded in
// the binding so it is digest-bound to the consumer contract and returned on
// rebind; it is never re-invented, dropped or widened at the serialization
// boundary.
const KS238_UNSUPPORTED_CONTRACT_V1 = {
  code: "REVENUE_AND_HISTORY_UNAVAILABLE",
  facts: [...KS238_UNSUPPORTED_FACTS_V1],
  missingFields: [...KS238_MISSING_FIELDS_V1],
  nonClaims: [
    "netRevenue is never inferred from orderStatus, ordered quantity, or totalMinor",
    "orderedQuantity and quantity unit are never inferred; the selected order source and the released reader expose no per-order quantity or unit (quantityUnit is UNAVAILABLE)",
    "currency/amount value is never inferred from the totalMinor field; no monetary conversion is performed",
    "delivery, historical order-book and order-intake facts remain unavailable",
  ],
};

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, keys) =>
  isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const sha256Hex = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const closedId = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
const sha = (value) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
const bytesSha = (value) =>
  createHash("sha256").update(typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value)).digest("hex");

// The order-status vocabulary the released reader proves (exact, closed).
const ORDER_STATUS = new Set(["OPEN", "FULFILLED", "CANCELLED"]);

/**
 * Verify an actual `orders` reader result (readErpOrdersFromLabelledSourceBytesV1
 * READ shape) and return its content binding. This is an INTERNAL,
 * non-authoritative projection: it verifies the shape and the
 * caller-recomputable readback hash, but the records and metadata are
 * caller-owned here. A result returned by this verifier is NEVER approval —
 * approval exists only where the released reader was executed by the handoff
 * itself against independently selected source bytes
 * (createKs238OrderSourceHandoff / rebindSerializedOrderSource).
 */
export function verifyOrderSourceRead(result) {
  if (!isRecord(result) || result.outcome !== "READ" || result.entity !== "orders"
    || !Array.isArray(result.records) || !isRecord(result.metadata)
    || !exactKeys(result.metadata, [
      "tenantId", "trust", "principalId", "scope", "exportId", "generatedAt",
      "expiresAt", "sourceDatasetId", "sourceDigest", "sourceBytesSha256",
      "batchIds", "recordMetadata", "recordCount", "pageSize", "nextCursor",
    ])
    || result.metadata.trust !== "LOCAL_SYNTHETIC"
    || result.metadata.nextCursor !== null
    || !closedId(result.metadata.tenantId)
    || !sha256Hex(result.metadata.sourceDigest)
    || !sha256Hex(result.metadata.sourceBytesSha256)
    || !sha256Hex(result.readbackDigest)
    || result.metadata.recordCount !== result.records.length) {
    return { ok: false, code: "ORDER_SOURCE_READ_UNVERIFIED" };
  }
  const orders = new Map();
  for (const record of result.records) {
    if (!exactKeys(record, ["orderId", "customerId", "orderStatus", "orderDate", "totalMinor", "currency"])
      || !closedId(record.orderId) || !closedId(record.customerId)
      || !ORDER_STATUS.has(record.orderStatus)
      || typeof record.orderDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.orderDate)
      || !Number.isSafeInteger(record.totalMinor) || record.totalMinor < 0
      || record.currency !== "EUR") {
      return { ok: false, code: "ORDER_SOURCE_FACT_MALFORMED" };
    }
    if (orders.has(record.orderId)) return { ok: false, code: "ORDER_ID_AMBIGUOUS" };
    orders.set(record.orderId, record);
  }
  const readerReadback = sha({
    entity: "orders",
    records: result.records,
    metadata: result.metadata,
  });
  if (readerReadback !== result.readbackDigest) {
    return { ok: false, code: "ORDER_SOURCE_READBACK_MISMATCH" };
  }
  return {
    ok: true,
    code: "OK",
    contentBinding: {
      tenantId: result.metadata.tenantId,
      sourceDigest: result.metadata.sourceDigest,
      sourceBytesSha256: result.metadata.sourceBytesSha256,
      readbackDigest: result.readbackDigest,
    },
  };
}

/**
 * Verify an array of actual `customers` reader pages (LIST_CUSTOMERS READ
 * results drained by cursor). Every page is re-verified: the closed record
 * shape, the page's own readback digest, and a consistent page identity
 * (tenant, source digest, export, principal, scope) across the drain. No
 * customer may appear twice and no page content may repeat. This is an
 * INTERNAL, non-authoritative projection like verifyOrderSourceRead: the
 * pages are caller-owned here and verification alone is never approval.
 */
function verifyCustomerPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0
    || pages.length > KS238_CUSTOMER_MAX_PAGES_V1) {
    return { ok: false, code: "CUSTOMER_SOURCE_READ_UNVERIFIED" };
  }
  const customers = new Map();
  const seenRecordDigests = new Set();
  for (const [index, result] of pages.entries()) {
    if (!isRecord(result) || result.outcome !== "READ" || result.entity !== "customers"
      || !Array.isArray(result.records) || !isRecord(result.metadata)
      || result.metadata.trust !== "LOCAL_SYNTHETIC"
      || !closedId(result.metadata.tenantId)
      || !sha256Hex(result.metadata.sourceDigest)
      || !sha256Hex(result.readbackDigest)) {
      return { ok: false, code: "CUSTOMER_SOURCE_READ_UNVERIFIED" };
    }
    if (index > 0) {
      const first = pages[0];
      if (result.metadata.tenantId !== first.metadata.tenantId
        || result.metadata.sourceDigest !== first.metadata.sourceDigest
        || result.metadata.exportId !== first.metadata.exportId
        || result.metadata.principalId !== first.metadata.principalId
        || result.metadata.scope !== first.metadata.scope) {
        return { ok: false, code: "CUSTOMER_PAGE_IDENTITY_MISMATCH" };
      }
    }
    for (const record of result.records) {
      if (!exactKeys(record, ["customerId", "customerStatus"])
        || !closedId(record.customerId)
        || !CUSTOMER_STATUS.has(record.customerStatus)) {
        return { ok: false, code: "CUSTOMER_SOURCE_FACT_MALFORMED" };
      }
      if (customers.has(record.customerId)) return { ok: false, code: "CUSTOMER_ID_AMBIGUOUS" };
      const recordDigest = sha({ entity: "customers", record, metadata: result.metadata });
      if (seenRecordDigests.has(recordDigest)) return { ok: false, code: "CUSTOMER_PAGE_REPEATED" };
      seenRecordDigests.add(recordDigest);
      customers.set(record.customerId, record);
    }
    const readerReadback = sha({ entity: "customers", records: result.records, metadata: result.metadata });
    if (readerReadback !== result.readbackDigest) {
      return { ok: false, code: "CUSTOMER_SOURCE_READBACK_MISMATCH" };
    }
  }
  return { ok: true, code: "OK", customers, sourceDigest: pages[0].metadata.sourceDigest };
}

/** Legacy single-page customer verification (retained internal surface). */
function verifyCustomerRead(result) {
  return verifyCustomerPages([result]);
}

/**
 * Execute the ACTUAL customer reader (createErpReadAdapterV1 LIST_CUSTOMERS)
 * and drain it to completion via its own cursor. Bounded: at most
 * KS238_CUSTOMER_MAX_PAGES_V1 pages; a drain that is still paged at the
 * ceiling, or a cursor the released reader refuses (CURSOR_REPLAYED /
 * CURSOR_STALE), denies the read instead of silently truncating it. The
 * released reader is consumed exactly once per page, so its own replay guard
 * remains intact.
 */
function drainCustomerReader({ read, baseRequest }) {
  const pages = [];
  let cursor = null;
  for (let page = 0; page < KS238_CUSTOMER_MAX_PAGES_V1; page += 1) {
    const result = read(cursor === null ? { ...baseRequest } : { ...baseRequest, cursor });
    if (result.outcome !== "READ") return { ok: false, code: result.code };
    pages.push(result);
    cursor = result.metadata.nextCursor;
    if (cursor === null) break;
  }
  if (cursor !== null) return { ok: false, code: "CUSTOMER_SOURCE_PAGINATION_UNRESOLVED" };
  const check = verifyCustomerPages(pages);
  if (!check.ok) return check;
  return { ok: true, code: "OK", pages, customers: check.customers, sourceDigest: check.sourceDigest };
}

function periodOf(orderDate) {
  // Calendar month from the evidenced order date (YYYY-MM). No other period
  // semantics are inferred.
  return { granularity: KS238_PERIOD_GRANULARITY_V1, month: orderDate.slice(0, 7), orderDate };
}

/**
 * Compose the read-only order/source handoff from ACTUAL reader results.
 * `orderRead` is the result of readErpOrdersFromLabelledSourceBytesV1 and
 * `customerRead` the drained LIST_CUSTOMERS pages of the existing customer
 * adapter. Neither is accepted on a caller label or digest: both are
 * re-verified and re-digested here, so serialization and re-binding survive
 * without treating a caller-resealed substitution as approval.
 */
export function adaptOrderSourceToSalesAnalysis({ orderRead, customerRead }) {
  const orderCheck = verifyOrderSourceRead(orderRead);
  if (!orderCheck.ok) return { outcome: "DENIED", code: orderCheck.code };
  const customerCheck = verifyCustomerPages(customerRead);
  if (!customerCheck.ok) return { outcome: "DENIED", code: customerCheck.code };
  if (orderCheck.contentBinding.tenantId !== customerRead[0].metadata.tenantId) {
    return { outcome: "DENIED", code: "ORDER_CUSTOMER_TENANT_MISMATCH" };
  }
  if (customerCheck.sourceDigest !== orderCheck.contentBinding.sourceDigest) {
    return { outcome: "DENIED", code: "ORDER_CUSTOMER_SOURCE_MISMATCH" };
  }
  const customers = customerCheck.customers;
  const orders = [];
  for (const record of orderRead.records) {
    const customer = customers.get(record.customerId);
    if (customer === undefined) {
      // The customer referenced by an order is not evidenced by the drained
      // customer reader. This is an explicit missing fact, never inferred —
      // and never a page that was left unread, because the drain refuses to
      // stop before the cursor is exhausted.
      orders.push(makeOrderFact(record, "UNAVAILABLE"));
      continue;
    }
    orders.push(makeOrderFact(record, customer.customerStatus));
  }
  const contentBinding = {
    ...orderCheck.contentBinding,
    customerSourceDigest: customerCheck.sourceDigest,
  };
  const supported = {
    orderFacts: orders,
    // Evidence-only aggregates over status. These are NOT revenue: the
    // released order reader proves status counts, not any amount.
    statusCounts: countBy(orders, (entry) => entry.order.orderStatus),
  };
  const binding = {
    schemaVersion: KS238_ORDER_SOURCE_SCHEMA_V1,
    consumerContract: KS238_CONSUMER_CONTRACT_V1,
    trust: "LOCAL_SYNTHETIC",
    supportedFacts: [...KS238_SUPPORTED_FACTS_V1],
    contentBinding,
    supported,
    unsupportedFacts: cloneUnsupportedContract(),
  };
  return {
    outcome: "ADAPTED",
    code: "OK",
    contentBinding,
    supported,
    binding,
    bindingDigest: sha(binding),
    unsupportedFacts: binding.unsupportedFacts,
  };
}

function makeOrderFact(record, customerStatus) {
  return {
    order: {
      orderId: record.orderId,
      customerId: record.customerId,
      orderStatus: record.orderStatus,
      period: periodOf(record.orderDate),
      // The selected source and the released reader expose no per-order
      // quantity or unit. A unitless reader result never becomes a per-order
      // EACH fact; the capability-cell vocabulary is non-evidentiary here.
      quantityUnit: { ...KS238_QUANTITY_UNAVAILABLE_V1 },
    },
    customerStatus,
  };
}

function cloneUnsupportedContract() {
  return {
    code: KS238_UNSUPPORTED_CONTRACT_V1.code,
    facts: [...KS238_UNSUPPORTED_CONTRACT_V1.facts],
    missingFields: [...KS238_UNSUPPORTED_CONTRACT_V1.missingFields],
    nonClaims: [...KS238_UNSUPPORTED_CONTRACT_V1.nonClaims],
  };
}

function countBy(entries, keyOf) {
  const counts = {};
  for (const entry of entries) {
    const key = keyOf(entry);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Mandatory content-bound re-binding after serialization. The consumer
 * carries exactly: the serialized binding + bindingDigest, the source label,
 * the source bytes, the source bytes sha256, the released read contract, and
 * the decision time. The released readers are re-executed against THOSE
 * independently selected bytes/contract/time — the identity retained outside
 * the substituted payload — and the freshly derived binding must match the
 * carried one exactly. Raw caller-rehashed reader results are not accepted
 * here at all: a rehashed record that merely re-proves its own readback hash
 * cannot re-establish the source identity.
 */
export function rebindSerializedOrderSource({
  sourceLabel = KS238_SOURCE_LABEL_V1,
  sourceBytes,
  sourceBytesSha256,
  contract,
  now,
  binding,
  bindingDigest,
} = {}) {
  if (typeof sourceLabel !== "string" || sourceBytes === undefined || contract === undefined
    || typeof now !== "string" || typeof sourceBytesSha256 !== "string") {
    return { outcome: "DENIED", code: "REBIND_INPUT_REQUIRED" };
  }
  if (!sha256Hex(sourceBytesSha256) || bytesSha(sourceBytes) !== sourceBytesSha256) {
    return { outcome: "DENIED", code: "SOURCE_BYTES_MISMATCH" };
  }
  if (!verifyErpReadConnectorContractV1(contract)) {
    return { outcome: "DENIED", code: "ORDER_SOURCE_CONTRACT_MALFORMED" };
  }
  const orderRead = readErpOrdersFromLabelledSourceBytesV1({
    contract, sourceBytes, sourceLabel, enabled: true, now,
  });
  if (orderRead.outcome !== "READ") return { outcome: "DENIED", code: orderRead.code };
  const source = decodeSourceBytes(sourceBytes);
  if (source === null) return { outcome: "DENIED", code: "SOURCE_BYTES_MALFORMED" };
  const read = createErpReadAdapterV1({ contract, source, enabled: true, now });
  const baseRequest = {
    operation: "LIST_CUSTOMERS",
    tenantId: contract.tenantId,
    principalId: contract.identity.principalId,
    scopes: contract.identity.scopes,
    credentialPresent: true,
    fields: contract.fields.customers,
    pageSize: contract.policy.maxPageSize,
  };
  const drained = drainCustomerReader({ read, baseRequest });
  if (!drained.ok) return { outcome: "DENIED", code: drained.code };
  const fresh = adaptOrderSourceToSalesAnalysis({ orderRead, customerRead: drained.pages });
  if (fresh.outcome !== "ADAPTED") return { outcome: "DENIED", code: fresh.code };
  if (!isRecord(binding) || !sha256Hex(bindingDigest)) {
    return { outcome: "DENIED", code: "SERIALIZED_BINDING_MALFORMED" };
  }
  if (fresh.bindingDigest !== bindingDigest) {
    return { outcome: "DENIED", code: "SERIALIZED_BINDING_MISMATCH" };
  }
  if (fresh.bindingDigest !== sha(binding)) {
    return { outcome: "DENIED", code: "SERIALIZED_BINDING_MISMATCH" };
  }
  return {
    outcome: "REBOUND",
    code: "OK",
    binding,
    bindingDigest: fresh.bindingDigest,
    supported: fresh.supported,
    unsupportedFacts: fresh.unsupportedFacts,
  };
}

/**
 * Public read-only entry point. It owns the actual reader execution: callers
 * provide only the labelled source bytes, the released read contract, and the
 * decision time; a caller-supplied read-result object is never accepted as
 * handoff authority. The customer reader is drained across pages by its own
 * cursor before joining.
 */
export function createKs238OrderSourceHandoff({
  contract,
  sourceBytes,
  sourceLabel = KS238_SOURCE_LABEL_V1,
  enabled = true,
  now,
} = {}) {
  if (contract === undefined || sourceBytes === undefined || typeof now !== "string") {
    return { outcome: "DENIED", code: "ORDER_SOURCE_INPUT_REQUIRED" };
  }
  if (!verifyErpReadConnectorContractV1(contract)) {
    return { outcome: "DENIED", code: "ORDER_SOURCE_CONTRACT_MALFORMED" };
  }
  const orderRead = readErpOrdersFromLabelledSourceBytesV1({
    contract, sourceBytes, sourceLabel, enabled, now,
  });
  if (orderRead.outcome !== "READ") return { outcome: "DENIED", code: orderRead.code };
  // The released reader already validated and decoded the labelled source
  // bytes (malformed bytes fail SOURCE_BYTES_MALFORMED above). Decode again
  // here solely to feed the existing customer adapter the same source.
  const source = decodeSourceBytes(sourceBytes);
  if (source === null) return { outcome: "DENIED", code: "SOURCE_BYTES_MALFORMED" };
  const read = createErpReadAdapterV1({ contract, source, enabled, now });
  const baseRequest = {
    operation: "LIST_CUSTOMERS",
    tenantId: contract.tenantId,
    principalId: contract.identity.principalId,
    scopes: contract.identity.scopes,
    credentialPresent: true,
    fields: contract.fields.customers,
    pageSize: contract.policy.maxPageSize,
  };
  const drained = drainCustomerReader({ read, baseRequest });
  if (!drained.ok) return { outcome: "DENIED", code: drained.code };
  return adaptOrderSourceToSalesAnalysis({ orderRead, customerRead: drained.pages });
}

function decodeSourceBytes(sourceBytes) {
  try {
    const bytes = typeof sourceBytes === "string" ? new TextEncoder().encode(sourceBytes) : new Uint8Array(sourceBytes);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text);
    return isRecord(parsed) && Array.isArray(parsed.batches) ? parsed : null;
  } catch {
    return null;
  }
}
