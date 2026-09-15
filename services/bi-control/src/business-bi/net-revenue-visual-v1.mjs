import {createHash} from 'node:crypto';
import {NET_REVENUE_OPERATION_REQUEST, NET_REVENUE_EXECUTION_STATES} from './net-revenue-plan.mjs';
import {canonicalJson} from '../canonical-json.js';
import {createNetRevenueReadback} from './net-revenue-readback.mjs';

// The public product boundary: reuse C2 verification, never accept a bare visual
// digest as source authentication. Projection-only helpers are for offline display.
export function createNetRevenueVisualInputV1(sources) {
  const readback = createNetRevenueReadback(sources);
  const contract = JSON.parse(sources.metricContractBytes.toString('utf8'));
  const input = JSON.parse(canonicalJson({
    schemaVersion: NET_REVENUE_VISUAL_INPUT_V1,
    metricId: contract.metric.id,
    scope: {relation: contract.relation.name, classification: contract.metric.classification},
    units: {currency: contract.currency.code, minorUnitsPerMajorUnit: contract.currency.minorUnitsPerMajorUnit},
    periods: contract.periods,
    coverage: {state: readback.coverage.state, reasonCode: readback.coverage.reasonCode},
    provenance: {...readback.identity, readbackSha256: readback.readbackSha256},
    result: sources.receipt.result,
    nonclaims: readback.nonclaims,
  }));
  validateInput(input);
  return input;
}

export const NET_REVENUE_VISUAL_INPUT_V1 = 'kaleidosphere.business-bi/net-revenue-visual-input/v1';
export const NET_REVENUE_VISUAL_V1 = 'kaleidosphere.business-bi/net-revenue-visual/v1';
const PERIODS = ['comparison', 'current'];
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
const deny = () => {throw new Error('VISUAL_INPUT_DENIED');};
const exact = (value, keys) => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) deny();
};
function validateInput(input) {
  exact(input, ['schemaVersion', 'metricId', 'scope', 'units', 'periods', 'coverage', 'provenance', 'result', 'nonclaims']);
  if (input.schemaVersion !== NET_REVENUE_VISUAL_INPUT_V1 || input.metricId !== 'bi-ks-01-net-revenue') deny();
  exact(input.scope, ['relation', 'classification']);
  exact(input.units, ['currency', 'minorUnitsPerMajorUnit']);
  const source = NET_REVENUE_OPERATION_REQUEST.source;
  if (input.scope.relation !== source.relation || input.scope.classification !== 'SYNTHETIC_HOLDOUT_METRIC' ||
      input.units.currency !== source.currency.code || input.units.minorUnitsPerMajorUnit !== source.currency.minorUnitsPerMajorUnit) deny();
  const periods = Object.fromEntries(source.periods.map(({key, ...period}) => [key, period]));
  if (canonicalJson(input.periods) !== canonicalJson(periods)) deny();
  exact(input.coverage, ['state', 'reasonCode']);
  if (!NET_REVENUE_EXECUTION_STATES.includes(input.coverage.state) ||
      (input.coverage.state === 'COMPLETE' ? input.coverage.reasonCode !== null : !/^[A-Z][A-Z0-9_]{2,127}$/.test(input.coverage.reasonCode ?? ''))) deny();
  exact(input.provenance, ['resultSha256', 'readbackSha256', 'executionReceiptSha256', 'planSha256', 'operationSha256', 'metricContractSha256', 'holdoutSha256', 'oracleSha256', 'outputSha256']);
  for (const [key, value] of Object.entries(input.provenance)) {
    if (value === null && ['resultSha256', 'outputSha256'].includes(key) && input.result === null) continue;
    if (!/^[a-f0-9]{64}$/.test(value ?? '')) deny();
  }
  if (!Array.isArray(input.nonclaims) || input.nonclaims.length > 30 || input.nonclaims.some(x => typeof x !== 'string' || x.length > 2048)) deny();
  if ((input.coverage.state === 'COMPLETE') !== (input.result !== null)) deny();
  if (input.result === null) {if (input.provenance.resultSha256 !== null) deny(); return;}
  if (hash(input.result) !== input.provenance.resultSha256) deny();
  const integer = x => {if (!Number.isSafeInteger(x) || Object.is(x, -0)) deny();};
  const counts = x => {for (const n of Object.values(x)) {integer(n); if (n < 0) deny();}};
  const channel = x => {exact(x, ['count', 'quantifiedAmountMinorUnits', 'unquantifiedCount']); counts(x); if (x.unquantifiedCount > x.count) deny();};
  const result = input.result;
  exact(result, ['periods', 'deltaMinorUnits', 'unknown', 'excludedOutOfScopeCount']);
  exact(result.periods, PERIODS);
  for (const p of Object.values(result.periods)) {
    exact(p, ['netMinorUnits', 'saleMinorUnits', 'creditMinorUnits', 'cancelCount', 'rowCount', 'unknown']);
    integer(p.netMinorUnits); channel(p.unknown);
    counts({sale: p.saleMinorUnits, credit: p.creditMinorUnits, cancel: p.cancelCount, rows: p.rowCount});
    if (BigInt(p.saleMinorUnits) - BigInt(p.creditMinorUnits) !== BigInt(p.netMinorUnits) || p.cancelCount + p.unknown.count > p.rowCount) deny();
  }
  integer(result.deltaMinorUnits);
  if (BigInt(result.periods.current.netMinorUnits) - BigInt(result.periods.comparison.netMinorUnits) !== BigInt(result.deltaMinorUnits)) deny();
  exact(result.unknown, ['count', 'quantifiedAmountMinorUnits', 'unquantifiedCount', 'unassigned']);
  const {unassigned, ...total} = result.unknown; channel(total); channel(unassigned);
  counts({excluded: result.excludedOutOfScopeCount});
}

const escape = value => String(value ?? 'UNKNOWN').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const amount = value => value === null || value === undefined ? 'UNKNOWN' : String(value);

export function renderNetRevenueVisualHtmlV1(input, options = {}) {
  const selected = projectNetRevenueVisualV1(input, options);
  const model = projectNetRevenueVisualV1(input);
  const max = model.table.reduce((n, row) => Math.max(n, Math.abs(row.netMinorUnits ?? 0)), 1);
  const bars = model.table.map((row, i) => {
    const value = row.netMinorUnits;
    // Geometry only is approximate; financial values and labels remain exact integers.
    const width = value === null ? 0 : Number((BigInt(Math.abs(value)) * 24000n) / BigInt(max)) / 100;
    const y = 35 + i * 65;
    return `<g class="${row.period}" data-period="${row.period}"><text x="5" y="${y + 17}">${escape(row.label)}</text>${value === null ? '' : `<rect data-value="${value}" x="${value < 0 ? 355 - width : 355}" y="${y}" width="${width}" height="24" fill="${value < 0 ? '#a33131' : '#195c94'}"><title>${escape(row.label)}: ${value} EUR cents; ${row.state}</title></rect>`}<text x="610" y="${y + 17}">${amount(value)} (${row.state})</text></g>`;
  }).join('');
  const rows = model.table.map(row => `<tr class="${row.period}" data-period="${row.period}"><th scope="row">${escape(row.label)}<br>${escape(row.start)} — ${escape(row.end)}<br>inclusive</th><td>${amount(row.netMinorUnits)}</td><td>${row.state}</td><td>${amount(row.saleMinorUnits)}</td><td>${amount(row.creditMinorUnits)}</td><td>${amount(row.cancelCount)}</td><td>${amount(row.rowCount)}</td><td>${amount(row.unknown?.count)}</td><td>${amount(row.unknown?.quantifiedAmountMinorUnits)}</td><td>${amount(row.unknown?.unquantifiedCount)}</td></tr>`).join('');
  const details = model.drilldown.map((row, i) => `<details class="${row.period}" data-period="${row.period}"><summary>${escape(model.table[i].label)} contributing aggregates</summary><p>Bound result: ${escape(model.provenance.resultSha256)}. Aggregates only; no source-row access.</p><ul>${row.contributions.map(c => `<li>${c.kind}: ${c.minorUnits} EUR cents${c.count === undefined ? '' : `; count ${c.count}`}</li>`).join('')}</ul><p>Net: ${amount(row.totalMinorUnits)}; retained contract aggregate: ${amount(model.table[i].aggregateNetMinorUnits)}. UNKNOWN is excluded, not zero: ${escape(canonicalJson(row.unknown))}</p></details>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><title>Synthetic Net Revenue — VIS-01</title><style>
body{font:16px system-ui;max-width:1200px;margin:2rem auto;padding:1rem;color:#172b40;background:#fff}h1{font-size:1.8rem}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{padding:.6rem;border:1px solid #bcc8d0;text-align:right}th:first-child{text-align:left}.scroll{overflow-x:auto}svg{width:100%;min-width:700px}details{margin:1rem 0;border:1px solid #bcc8d0;padding:1rem}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}label{margin-right:1rem}#comparison:checked~main .current,#current:checked~main .comparison{display:none}
</style></head><body><h1>Synthetic Net Revenue</h1><p>One fixed KPI, EUR integer minor units (cents). Synthetic non-customer scope; no proof of live database execution from rendering alone.</p><p id="filter-label">Period filter (global counterevidence remains visible):</p>
${['all', ...PERIODS].map(p => `<input type="radio" name="period" id="${p}" aria-describedby="filter-label"${selected.filter === p ? ' checked' : ''}><label for="${p}">${p === 'all' ? 'Both periods' : escape(input.periods[p].label)}</label>`).join('')}
<main><p>Execution coverage: <strong>${model.coverage.state}</strong>; reason: ${escape(model.coverage.reasonCode ?? 'NONE')}. PARTIAL means observed net excludes UNKNOWN amounts. MISSING is not zero; no bar is drawn. A counted zero remains zero.</p>
<h2>Authoritative table</h2><div class="scroll"><table><caption>Exact EUR cents; credits are positive magnitudes subtracted from sales</caption><thead><tr>${['Period', 'Net cents', 'State', 'Sales cents', 'Credit magnitude cents', 'Cancellations', 'Rows', 'UNKNOWN count', 'UNKNOWN quantified cents', 'UNKNOWN unquantified count'].map(x => `<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
<h2>Net by period</h2><p>Signed bars from the same result bytes. Zero baseline; left is negative. Exact labels, not pixel lengths, are authoritative.</p><div class="scroll"><svg role="img" aria-labelledby="chart-title chart-desc" viewBox="0 0 870 175"><title id="chart-title">Net revenue by fixed period, EUR cents</title><desc id="chart-desc">${model.table.map(r => `${escape(r.label)}: ${amount(r.netMinorUnits)}; ${r.state}`).join('. ')}. UNKNOWN amounts excluded.</desc><line x1="355" y1="20" x2="355" y2="145" stroke="#172b40"/><text x="350" y="165">0</text>${bars}</svg></div>
<h2>Drilldown</h2>${details}<h2>Global counterevidence — not filtered</h2><p>UNKNOWN totals (including Unassigned/null-date rows), quantified amounts and unquantified counts; excluded out-of-scope rows:</p><pre>${escape(canonicalJson(model.counterevidence))}</pre><h2>Scope and provenance</h2><pre>${escape(canonicalJson({scope: model.scope, units: model.units, provenance: model.provenance}))}</pre><h2>Retained source nonclaims</h2><ul>${model.nonclaims.map(x => `<li>${escape(x)}</li>`).join('')}</ul><p>Source nonclaims retain their original scope; VIS-01 adds only this bounded visual, not a general dashboard or independently verified business truth.</p></main></body></html>\n`;
}

export function projectNetRevenueVisualV1(input, options = {}) {
  validateInput(input);
  if (!options || Object.keys(options).some(k => k !== 'period') ||
      !['all', ...PERIODS].includes(Object.hasOwn(options, 'period') ? options.period : 'all')) throw new Error('VISUAL_FILTER_DENIED');
  const filter = options.period ?? 'all';
  const table = PERIODS.filter(period => filter === 'all' || period === filter).map(period => {
    const aggregate = input.result?.periods[period];
    const state = !aggregate ? input.coverage.state : aggregate.rowCount === 0 ? 'MISSING' : aggregate.unknown.count ? 'PARTIAL' : 'COMPLETE';
    return {period, ...input.periods[period], ...(aggregate ?? {}), state,
      aggregateNetMinorUnits: aggregate?.netMinorUnits ?? null,
      netMinorUnits: !aggregate || state === 'MISSING' ? null : aggregate.netMinorUnits};
  });
  const drilldown = table.map(row => ({period: row.period, totalMinorUnits: row.netMinorUnits, unknown: row.unknown ?? null,
    contributions: row.aggregateNetMinorUnits === null ? [] : [{kind: 'sale', minorUnits: row.saleMinorUnits}, {kind: 'credit', minorUnits: row.creditMinorUnits === 0 ? 0 : -row.creditMinorUnits}, {kind: 'cancel', minorUnits: 0, count: row.cancelCount}],
  }));
  return JSON.parse(canonicalJson({
    schemaVersion: NET_REVENUE_VISUAL_V1,
    table, drilldown, filter, coverage: input.coverage,
    scope: input.scope, units: input.units,
    counterevidence: {unknown: input.result?.unknown ?? null, excludedOutOfScopeCount: input.result?.excludedOutOfScopeCount ?? null},
    nonclaims: input.nonclaims,
    chart: {kind: 'SIGNED_PERIOD_BAR', zeroBaseline: true, values: table.map(row => row.netMinorUnits)},
    provenance: input.provenance,
  }));
}
