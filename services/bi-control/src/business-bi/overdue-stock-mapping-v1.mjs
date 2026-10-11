// #317: a bounded stock/event mapping extension of the existing #237 mapping owner.
// Pure normalization is NOT runtime/source/permission authority. No inference of units or dates.
import { canonicalJson } from '../canonical-json.js';
import { LEDGER_CURRENCY } from './net-revenue-ledger-mapping.mjs';

export const OVERDUE_MAPPING_VERSION = 'kaleidosphere.business-bi/overdue-stock-mapping/v1';
export const OVERDUE_SOURCE_SCHEMA = 'kaleidosphere.business-bi/overdue-synthetic-source/v1';
const fail = (suffix) => { const e = new Error(`OVERDUE_${suffix}`); e.code = e.message; throw e; };
const keys = (v, expected) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join('|') === [...expected].sort().join('|');
const id = (v) => typeof v === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(v);
const day = (v) => {
  if (typeof v !== 'string' || !/^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) fail('BUSINESS_DATE_DENIED');
  const d = new Date(`${v}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== v) fail('BUSINESS_DATE_DENIED');
  return v;
};
export const normalizeOverdueBusinessDateV1 = day;
export function normalizeOverdueInstantV1(value) {
  const m = typeof value === 'string' && value.match(/^(20\d{2}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,3})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/);
  if (!m) fail('INSTANT_EXPLICIT_OFFSET_REQUIRED');
  day(m[1]);
  if (/^[+-]14:/.test(m[6]) && !/^[+-]14:00$/.test(m[6])) fail('INSTANT_OFFSET_DENIED');
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) fail('INSTANT_DENIED');
  return d.toISOString();
}
const amount = (v) => {
  if (v === null) return null;
  if (!Number.isSafeInteger(v) || v < 0) fail('AMOUNT_INTEGER_DENIED');
  return String(v); // integer decimal, never IEEE754 aggregate/rounding
};
const monetary = (row) => {
  if (!(row.currency === null || row.currency === LEDGER_CURRENCY.code)) fail('CURRENCY_DENIED');
  if (!(row.unit === null || row.unit === 'MINOR_UNITS')) fail('UNIT_DENIED');
  return {amountMinorUnits: amount(row.amountMinorUnits), currency: row.currency, unit: row.unit};
};
const common = ['tenantId', 'invoiceId', 'amountMinorUnits', 'currency', 'unit', 'validAt', 'knownAt'];
export function mapOverdueSnapshotV1(source) {
  const metadata = ['schemaVersion', 'classification', 'sourceId', 'sourceRevision', 'snapshotId', 'historyRequiredFrom', 'historyCompleteFrom', 'historyCompleteThrough', 'knowledgeCompleteThrough'];
  if (!keys(source, [...metadata, 'invoices', 'payments', 'adjustments'])
    || source.schemaVersion !== OVERDUE_SOURCE_SCHEMA || source.classification !== 'SYNTHETIC_NON_CUSTOMER_BYTES'
    || ['sourceId', 'sourceRevision', 'snapshotId'].some((k) => !id(source[k]))) fail('SOURCE_SHAPE_DENIED');
  const result = Object.fromEntries(metadata.map((k) => [k, k.endsWith('From') || k.endsWith('Through') ? normalizeOverdueInstantV1(source[k]) : source[k]]));
  for (const relation of ['invoices', 'payments', 'adjustments']) {
    if (!Array.isArray(source[relation]) || source[relation].length > 1000) fail('SOURCE_CARDINALITY_DENIED');
    const rowId = relation === 'invoices' ? 'invoiceId' : relation === 'payments' ? 'paymentId' : 'adjustmentId';
    const required = [...common, ...(relation === 'invoices' ? ['siteId', 'invoiceDate', 'dueDate'] : [rowId]), ...(relation === 'adjustments' ? ['kind'] : [])];
    const seen = new Set();
    result[relation] = source[relation].map((row) => {
      if (!keys(row, required) || ['tenantId', 'invoiceId', rowId, ...(relation === 'invoices' ? ['siteId'] : [])].some((k) => !id(row[k]))) fail('ROW_SHAPE_DENIED');
      const identity = `${row.tenantId}|${row[rowId]}`;
      if (seen.has(identity)) fail('DUPLICATE_ID_DENIED');
      seen.add(identity);
      const base = {...row, ...monetary(row), validAt: normalizeOverdueInstantV1(row.validAt), knownAt: normalizeOverdueInstantV1(row.knownAt)};
      if (relation === 'invoices') {
        base.invoiceDate = row.invoiceDate === null ? null : day(row.invoiceDate);
        base.dueDate = row.dueDate === null ? null : day(row.dueDate);
      }
      if (relation === 'adjustments' && (!['CREDIT', 'CANCEL'].includes(row.kind)
        || (row.kind === 'CANCEL' && row.amountMinorUnits !== 0))) fail('ADJUSTMENT_KIND_DENIED');
      return base;
    }).sort((a, b) => `${a.tenantId}|${a[rowId]}`.localeCompare(`${b.tenantId}|${b[rowId]}`, 'en'));
  }
  const invoiceIds = new Set(result.invoices.map((r) => `${r.tenantId}|${r.invoiceId}`));
  for (const row of [...result.payments, ...result.adjustments]) if (!invoiceIds.has(`${row.tenantId}|${row.invoiceId}`)) fail('ORPHAN_EVENT_DENIED');
  return JSON.parse(canonicalJson(result));
}
