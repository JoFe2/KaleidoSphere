// KaleidoSphere #236 — guided net-revenue journey: the practical dataset-bound view.
//
// R2 correction (focused review, finding R2).
//
// The guided CLI published a JSON receipt and offered no practical view at all: no table,
// no chart, nothing a user could look at. Two of the four permitted formats existed in
// lower layers (`renderNetRevenueTable` for the holdout readback, a chart for the same)
// but neither was reachable from the guided surface, and the F4 ledger-comparison sources
// have no renderer anywhere.
//
// This module renders ONE view for whichever source the user actually chose, from the
// session's OWN executed result, so the view can never describe a dataset other than the
// one that ran:
//
//   holdout source  the released readback TABLE (its own columns/rows, carried through the
//                   released `renderNetRevenueTable` artifact unmodified) plus its coverage
//                   state and oracle equality.
//   F4 source       the released comparison's period-by-period net revenue for both sides
//                   of the declared profile, as a table.
//
// The view is presentation only. It carries the same nonclaims as the receipt, and it is
// never a claim about comprehension, production readmission, or a second metric.
//
// A refused run renders NO view: there is no result to describe, and an empty table would
// be a fabricated fact.

export const NET_REVENUE_GUIDED_VIEW_SCHEMA = 'kaleidosphere.business-bi/net-revenue-guided-view/v1';

export const NET_REVENUE_GUIDED_VIEW_FORMATS = Object.freeze(['TABLE', 'HTML']);

const NONCLAIMS = Object.freeze([
  'presentation only — this view is not a comprehension, dashboard or BI-surface claim',
  'no human-comprehension claim is made by rendering it',
  'synthetic local source only — no production source is admitted by this view',
  'no second metric, arbitrary SQL, mutation or publish path',
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pad(value, width) {
  const s = String(value);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function markdownTable(columns, rows, legend) {
  const widths = columns.map((c) => Math.max(
    c.length,
    ...rows.map((r) => String(r[c] ?? '').length),
  ));
  const lines = legend.slice();
  lines.push(`| ${columns.map((c, i) => pad(c, widths[i])).join(' | ')} |`);
  lines.push(`| ${columns.map((_, i) => '-'.repeat(widths[i])).join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${columns.map((c, i) => pad(row[c] ?? '', widths[i])).join(' | ')} |`);
  }
  return lines;
}

function htmlTable(columns, rows, legend) {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<title>KaleidoSphere #236 — guided net-revenue view (synthetic local source)</title>',
    '<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#111}',
    'table{border-collapse:collapse;margin-top:1rem}',
    'th,td{border:1px solid #ccc;padding:.35rem .6rem;text-align:right}',
    'th:first-child,td:first-child{text-align:left}',
    'ul{color:#444}caption{caption-side:top;text-align:left;font-weight:600}</style>',
    '</head><body>',
    '<h1>Guided net-revenue view</h1>',
    '<ul>',
    ...legend.map((l) => `  <li>${escapeHtml(l)}</li>`),
    '</ul>',
    '<table>',
    `  <tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`,
    ...rows.map((r) => `  <tr>${columns.map((c) => `<td>${escapeHtml(r[c] ?? '')}</td>`).join('')}</tr>`),
    '</table>',
    '</body></html>',
  ].join('\n');
}

function format(formatKind, columns, rows, legend) {
  if (formatKind === 'TABLE') return `${markdownTable(columns, rows, legend).join('\n')}\n`;
  if (formatKind === 'HTML') return `${htmlTable(columns, rows, legend)}\n`;
  throw fail('GUIDED_VIEW_FORMAT_DENIED');
}

// The holdout view: the released journey result's OWN per-period figures, one row per
// period, with the released coverage/unknown facts stated alongside. The released readback
// keeps its 24-column single-row machine shape for the JSON receipt; this view is the
// human-shaped projection of the SAME released bytes (same numbers, one row per period).
function holdoutView(session, formatKind) {
  const presentation = session.result.presentation;
  const readback = presentation.readback;
  const result = session.result.result;
  const periods = result.periods ?? {};
  const columns = [
    'period', 'label', 'start', 'end', 'net_minor_units', 'sale_minor_units',
    'credit_minor_units', 'cancel_count', 'row_count', 'unknown_count',
    'unknown_quantified_minor_units', 'unknown_unquantified_count',
  ];
  // The released journey RESULT carries per-period figures; the contract-declared window
  // (label/start/end) lives in the resolved run parameters. Both are released values.
  const declaredWindow = session.runParameters.periods ?? {};
  const rows = Object.entries(periods).map(([periodId, p]) => ({
    period: periodId,
    label: declaredWindow[periodId]?.label ?? '',
    start: declaredWindow[periodId]?.start ?? '',
    end: declaredWindow[periodId]?.end ?? '',
    net_minor_units: p.netMinorUnits,
    sale_minor_units: p.saleMinorUnits,
    credit_minor_units: p.creditMinorUnits,
    cancel_count: p.cancelCount,
    row_count: p.rowCount,
    unknown_count: p.unknown?.count ?? 'unsupported',
    unknown_quantified_minor_units: p.unknown?.quantifiedAmountMinorUnits ?? 'unsupported',
    unknown_unquantified_count: p.unknown?.unquantifiedCount ?? 'unsupported',
  }));
  const unknown = result.unknown ?? {};
  const legend = [
    `dataset: ${session.runParameters.sourceId} [${session.runParameters.relation}]`,
    `question: ${session.runParameters.questionId}`,
    `unit: ${session.runParameters.unitId} (${session.runParameters.currency.code}, ${session.runParameters.currency.minorUnitsPerMajorUnit} minor units per major unit)`,
    `boundary: periods are inclusive of both ends`,
    `coverage: ${readback.coverage.state}${readback.coverage.reasonCode ? ` (${readback.coverage.reasonCode})` : ''}`,
    `oracle equality: ${presentation.jsonTableIdentity === true ? 'EXACT (released json/table identity verified)' : readback.oracleEquality}`,
    `reconciles to independent oracle: ${session.result.reconcilesToIndependentOracle === true}`,
    `released delta (current - comparison), minor units: ${result.deltaMinorUnits ?? 'unsupported'}`,
    `global unknown: count=${unknown.count ?? 'unsupported'} quantified_minor_units=${unknown.quantifiedAmountMinorUnits ?? 'unsupported'} unquantified_count=${unknown.unquantifiedCount ?? 'unsupported'} unassigned_count=${unknown.unassigned?.count ?? 'unsupported'}`,
    `excluded out-of-scope rows: ${result.excludedOutOfScopeCount ?? 'unsupported'}`,
    'UNKNOWN amounts are excluded from net, never counted as zero',
    ...NONCLAIMS.map((n) => `nonclaim: ${n}`),
  ];
  return format(formatKind, columns, rows, legend);
}

// The F4 view: the released segment comparison's own two sides, exactly as the released
// `buildSegmentComparisonReport` shaped them (current / comparison), plus its nonclaims.
function f4View(session, formatKind) {
  const comparison = session.result.comparison;
  const current = comparison.current ?? {};
  const prior = comparison.comparison ?? {};
  // Rows are the released report's OWN quantified fields, per side. A field the released
  // report leaves null (orderIntake, openOrder*) is shown as `unsupported`, never as 0.
  const scenarios = [
    ['current', current],
    ['comparison', prior],
  ];
  const columnPlan = [
    ['net_revenue_minor_units', 'netRevenue', true],
    ['sale_value_minor_units', 'saleValue', true],
    ['credit_value_minor_units', 'creditValue', true],
    ['cancel_count', 'cancelCount', true],
    ['direct_segment_minor_units', null, true],
    ['partner_segment_minor_units', null, true],
    ['observed_open_sale_row_count', 'observedOpenSaleRowCount', true],
    ['observed_open_sale_row_value', 'observedOpenSaleRowValue', true],
    ['order_intake', 'orderIntake', false],
    ['open_order_count', 'openOrderCount', false],
    ['open_order_value', 'openOrderValue', false],
  ];
  const columns = ['side', ...columnPlan.map(([name]) => name)];
  const valueFor = (row, [name, key]) => {
    if (name === 'direct_segment_minor_units') return row.segments?.direct ?? 'unsupported';
    if (name === 'partner_segment_minor_units') return row.segments?.partner ?? 'unsupported';
    const value = row[key];
    return value === null || value === undefined ? 'unsupported' : value;
  };
  const rows = scenarios.map(([side, sideReport]) => Object.fromEntries([
    ['side', side],
    ...columnPlan.map((col) => [col[0], valueFor(sideReport, col)]),
  ]));
  // The released report's OWN delta object, passed through — never re-derived here.
  const releasedDelta = comparison.delta ?? {};
  const legend = [
    `dataset: ${session.runParameters.sourceId} [${session.runParameters.relation}]`,
    `layout: ${session.result.layoutVersion}`,
    `kernel profile: ${session.result.kernelProfile}`,
    `declared profile used: ${session.result.usedDeclaredProfile === true}`,
    `kernel rows: ${session.result.kernelRowCount}`,
    `delta (released), minor units: netRevenue=${releasedDelta.netRevenue ?? 'unsupported'} saleValue=${releasedDelta.saleValue ?? 'unsupported'} orderIntake=${releasedDelta.orderIntake ?? 'unsupported'}`,
    'numbers are integer EUR minor units (cents)',
    ...(Array.isArray(comparison.nonclaims) ? comparison.nonclaims.map((n) => `owner nonclaim: ${n}`) : []),
    ...NONCLAIMS.map((n) => `nonclaim: ${n}`),
  ];
  return format(formatKind, columns, rows, legend);
}

export function renderGuidedNetRevenueView(session, formatKind) {
  if (session && typeof session === 'object' && session.phase !== 'EXECUTED') {
    throw fail(`GUIDED_VIEW_NOT_EXECUTED:${session.phase}`);
  }
  if (!session || !session.result) throw fail('GUIDED_VIEW_RESULT_REQUIRED');
  if (!NET_REVENUE_GUIDED_VIEW_FORMATS.includes(formatKind)) throw fail('GUIDED_VIEW_FORMAT_DENIED');
  if (session.result.presentation && session.result.presentation.readback) {
    return holdoutView(session, formatKind);
  }
  if (session.result.comparison) return f4View(session, formatKind);
  throw fail('GUIDED_VIEW_SOURCE_KIND_UNSUPPORTED');
}
