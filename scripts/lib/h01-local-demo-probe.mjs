import { readBoundedObservedJson } from './h01-observed-json.mjs';

// KS-specific business fact adapter for the existing, public synthetic MSSQL
// metadata demo. This is NOT the PAN-led portable RuntimeIdentity/ReadinessReceipt
// contract, a capability, a permission source, or a hosted-route admission.
// Oracle: qualified mssql-results-v1.json (2 relations, 3 columns, 1 constraint,
// 1 index, 9 collector coverage rows); the real product materializes this truth.
export function checkLocalDemoBusinessReadback(reply) {
  const result = (status, code) => ({status, code, hostedRouteOpen: false,
    scope: 'LOCAL_SYNTHETIC_METADATA_DEMO_ONLY_NO_LIVE_DATABASE_OR_PROVIDER_CLAIM'});
  try { reply = readBoundedObservedJson(reply); }
  catch { return result('NOT_READY', 'LOCAL_DEMO_INPUT_DENIED'); }
  if (reply?.httpStatus !== 200 || reply?.body?.schemaVersion !== 'chimpmaera.bi/readback/v1') {
    return result('NOT_READY', 'LOCAL_DEMO_TRANSPORT_OR_FORMAT_DENIED');
  }
  const {summary, technicalOverview: technical, projectionMirror: mirror} = reply.body;
  if (summary?.source_engine !== 'mssql' || summary?.source_database !== 'CM_BI_FIXTURE'
    || summary?.source_mode !== 'fixture' || summary?.runtime_validation !== 'SYNTHETIC_UNVALIDATED'
    || summary?.status !== 'ANALYZED_READ_ONLY' || summary?.source_read_only !== 1
    || mirror?.state !== 'IN_SYNC' || mirror?.inSync !== true) {
    return result('NOT_READY', 'LOCAL_DEMO_SOURCE_OR_PROJECTION_DENIED');
  }
  if (summary.relation_count !== 2 || summary.column_count !== 3
    || summary.constraint_count !== 1 || summary.index_count !== 1
    || reply.body.detailCount !== 3 || technical?.systemSchemaRows !== 1
    || technical?.tableCapacityRows !== 2 || technical?.codeDependencyRows !== 0
    || technical?.coverageRows !== 9 || technical?.biCandidateRows !== 2) {
    return result('NOT_READY', 'LOCAL_DEMO_BUSINESS_VALUE_MISMATCH');
  }
  return result('LOCAL_BUSINESS_FACTS_VERIFIED', 'LOCAL_DEMO_BUSINESS_ORACLE_MATCH');
}
