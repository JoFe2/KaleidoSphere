// The candidate sees ONLY permitted aggregate stdin, never source rows or an oracle.
import { NET_REVENUE_OPERATION_ID } from './net-revenue-plan.mjs';
import { createHash } from 'node:crypto';
import { canonicalJson as canonicalJSON } from '../canonical-json.js';
export const APPROVED_AGGREGATE_SHA256 = '123eaf9ae8d773dbef5272443226abfa3dd8b7627b12242c0c070c7739a9c75b';

export const AGGREGATE_SOURCE = Object.freeze({
  id: 'synth_x.pay_feed', revision: 'synthetic-unfamiliar-source-v1',
  sha256: '56724bfa95e66d8b61a837e82098aeee67ad430434794da944d033d61dd9737e',
});
export function validateAggregateProfile(input) {
  if (input.accessMode !== 'PERMITTED_AGGREGATES') throw new Error('K01_PROFILE_DENIED');
  if (!input.source || Object.keys(input.source).sort().join(',') !== 'id,revision,sha256' ||
      Object.entries(AGGREGATE_SOURCE).some(([key, value]) => input.source[key] !== value)) {
    throw new Error('K01_SOURCE_DENIED');
  }
  // The operator's immutable synthetic grant binds aggregate BYTES, not caller labels.
  // No expected answers or raw rows are needed/available in this candidate closure.
  if (createHash('sha256').update(canonicalJSON(input)).digest('hex') !== APPROVED_AGGREGATE_SHA256) {
    throw new Error('K01_APPROVED_PACKAGE_DENIED');
  }
  return input;
}
export function computePermittedAggregate(input) {
  validateAggregateProfile(input);
  if (input.operationId !== NET_REVENUE_OPERATION_ID) throw new Error('K01_OPERATION_DENIED');
  const totals = Object.fromEntries(input.periods.map((period) =>
    [period.key, period.saleMinorUnits - period.creditMinorUnits]));
  return {
    schemaVersion: 'kaleidosphere.business-bi/permitted-aggregate-result/v1',
    outcome: 'ACCEPTED', reasonCode: null,
    source: AGGREGATE_SOURCE, operationId: NET_REVENUE_OPERATION_ID,
    numbers: { comparisonNetMinorUnits: totals.comparison,
      currentNetMinorUnits: totals.current, deltaMinorUnits: totals.current - totals.comparison },
    unknownRows: Object.fromEntries(input.periods.map((period) => [period.key, period.unknownRows])),
    unassignedUnknownRows: input.unassignedUnknownRows,
    unit: 'EUR_MINOR_UNITS', rule: 'INCLUDE_BOUNDARY_DATES',
    mutationAuthority: false, drilldownPermitted: false,
  };
}
