// BI-KS-01 / PORTFOLIO-KS145-IMPLEMENT
//
// Focused oracle gate for the single synthetic net-revenue metric admitted on
// the frozen current-Main worktree. The independent exact-cent calculator is
// implemented INLINE in this file (CANON-5): it imports no production
// analysis code, and a self-scan below proves this file's own import
// specifiers are node: built-ins only.
//
// Synthetic non-customer bytes only. No production, customer, general BI,
// dashboard, or release/publish claim. No push, publish, or release.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_PATH = resolve(ROOT, 'contracts/business-bi/v1/net-revenue.metric.json');
const HOLDOUT_PATH = resolve(ROOT, 'tests/fixtures/business-bi/net-revenue-holdout-v1.json');
const ORACLE_PATH = resolve(ROOT, 'tests/fixtures/business-bi/net-revenue-oracle-v1.json');
const SELF_PATH = fileURLToPath(import.meta.url);

const contractBytes = await readFile(CONTRACT_PATH);
const holdoutBytes = await readFile(HOLDOUT_PATH);
const oracleBytes = await readFile(ORACLE_PATH);
const testSource = await readFile(SELF_PATH, 'utf8');

const contract = JSON.parse(contractBytes.toString('utf8'));
const holdout = JSON.parse(holdoutBytes.toString('utf8'));
const oracle = JSON.parse(oracleBytes.toString('utf8'));

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// ---------------------------------------------------------------------------
// Independent exact-cent calculator (CANON-5). Self-contained on purpose:
// no production analysis code is imported anywhere in this file.
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 'kaleidosphere.business-bi/net-revenue-metric/v1';
const RECORD_KINDS = Object.freeze(['sale', 'credit', 'cancel', 'unknown']);
const ROW_FIELDS = Object.freeze(['amount_minor_units', 'order_date', 'order_id', 'record_kind']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SYNTHETIC_ID = /^s-\d{3,}$/;
const PERIOD_NAMES = Object.freeze(['current', 'comparison']);
const REQUIRED_NONCLAIM_MARKERS = ['production', 'customer', 'general bi', 'dashboard', 'release or publish'];

function isExactCent(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

function isValidCalendarDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// ---------------------------------------------------------------------------
// PSai Canon applicability validation (recorded at issue admission).
// A NOT_APPLICABLE claim without a recorded admission basis is UNSUPPORTED
// and fails closed.
// ---------------------------------------------------------------------------

function canonApplicabilityErrors(section) {
  const errors = [];
  if (!section || typeof section !== 'object') {
    errors.push('canonApplicability: the matrix must be recorded at issue admission');
    return errors;
  }
  if (typeof section.recordedAt !== 'string') {
    errors.push('canonApplicability.recordedAt: the matrix must be recorded at issue admission');
  }
  if (!Array.isArray(section.laws) || section.laws.length === 0) {
    errors.push('canonApplicability.laws: at least one law must be recorded with an applicability verdict');
    return errors;
  }
  const seen = new Set();
  for (const law of section.laws) {
    if (!law || typeof law.id !== 'string' || seen.has(law.id)) {
      errors.push(`canon ${law?.id ?? '<missing>'}: law id must be present and unique`);
      continue;
    }
    seen.add(law.id);
    if (typeof law.statement !== 'string' || law.statement.trim().length < 16) {
      errors.push(`canon ${law.id}: a substantive statement is required`);
    }
    if (typeof law.recordedAt !== 'string') {
      errors.push(`canon ${law.id}: recordedAt is required at issue admission`);
    }
    if (law.applicability !== 'APPLICABLE' && law.applicability !== 'NOT_APPLICABLE') {
      errors.push(`canon ${law.id}: applicability must be APPLICABLE or NOT_APPLICABLE`);
    }
    if (
      law.applicability === 'NOT_APPLICABLE' &&
      (typeof law.admissionBasis !== 'string' || law.admissionBasis.trim().length < 16)
    ) {
      errors.push(`canon ${law.id}: unsupported NOT_APPLICABLE claim (no admission basis recorded at issue admission)`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// v1 structural validation of the admitted metric contract: exactly ONE
// relation, ONE ORDER_DATE role, ONE currency, TWO periods, and explicit
// credit/cancel/UNKNOWN rules. Any widening is a contract violation.
// ---------------------------------------------------------------------------

function contractValidationErrors(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== 'object') {
    return ['contract: the admitted metric must be a JSON object'];
  }
  if (candidate.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`contract: schemaVersion must be ${SCHEMA_VERSION}`);
  }
  // Exactly one relation.
  if (Array.isArray(candidate.relation)) {
    errors.push('relation: exactly one relation is admitted; an array widens scope');
  } else if (typeof candidate.relation?.name !== 'string' || candidate.relation.name.trim().length === 0) {
    errors.push('relation: exactly one named relation is required');
  }
  // Exactly one ORDER_DATE role.
  if (Array.isArray(candidate.orderDateRole)) {
    errors.push('orderDateRole: exactly one ORDER_DATE role is admitted; an array widens scope');
  } else if (
    typeof candidate.orderDateRole?.column !== 'string' ||
    candidate.orderDateRole?.role !== 'ORDER_DATE'
  ) {
    errors.push('orderDateRole: exactly one column may hold the ORDER_DATE role');
  }
  // Exactly one currency.
  if (Array.isArray(candidate.currency?.code)) {
    errors.push('currency: exactly one currency is admitted; an array of codes widens scope');
  } else if (
    typeof candidate.currency?.code !== 'string' ||
    !/^[A-Z]{3}$/.test(candidate.currency?.code ?? '')
  ) {
    errors.push('currency: exactly one ISO-4217 currency code is required');
  }
  if (candidate.currency?.minorUnitsPerMajorUnit !== 2) {
    errors.push('currency: minorUnitsPerMajorUnit must be 2 for exact-cent integer arithmetic');
  }
  // Exactly two periods, named current and comparison, non-overlapping.
  const periods =
    candidate.periods && typeof candidate.periods === 'object' && !Array.isArray(candidate.periods)
      ? Object.entries(candidate.periods)
      : [];
  if (periods.length !== 2) {
    errors.push('periods: exactly two periods are admitted');
  } else {
    if (periods.map(([name]) => name).sort().join(',') !== 'comparison,current') {
      errors.push('periods: the two periods must be named exactly current and comparison');
    }
    for (const [name, period] of periods) {
      if (
        !isValidCalendarDate(period?.start) ||
        !isValidCalendarDate(period?.end) ||
        period.start >= period.end
      ) {
        errors.push(`periods.${name}: start and end must be valid calendar dates with start < end`);
      }
    }
    const [first, second] = periods.map(([, p]) => p).sort((a, b) => (a.start < b.start ? -1 : 1));
    if (second.start <= first.end) {
      errors.push('periods: the two periods must not overlap');
    }
  }
  // Explicit credit/cancel/UNKNOWN (and sale) rules, no extra kinds.
  if (
    candidate.recordRules &&
    typeof candidate.recordRules === 'object' &&
    Object.keys(candidate.recordRules).length !== RECORD_KINDS.length
  ) {
    errors.push(`recordRules: exactly the ${RECORD_KINDS.length} record kinds are admitted`);
  }
  for (const kind of RECORD_KINDS) {
    if (
      typeof candidate.recordRules?.[kind]?.contribution !== 'string' ||
      typeof candidate.recordRules?.[kind]?.amountConstraint !== 'string'
    ) {
      errors.push(`recordRules.${kind}: an explicit contribution and amountConstraint are required`);
    }
  }
  // Explicit null policy: null is routed to UNKNOWN, never treated as zero.
  if (typeof candidate.nullPolicy?.amount_minor_units_null !== 'string') {
    errors.push('nullPolicy.amount_minor_units_null: a null amount must be routed to the UNKNOWN channel');
  }
  if (typeof candidate.nullPolicy?.order_date_null !== 'string') {
    errors.push('nullPolicy.order_date_null: a null order date must be routed to the UNKNOWN channel');
  }
  // UNKNOWN distinct from exactly two things: zero and absence.
  if (
    !Array.isArray(candidate.unknownPolicy?.distinctFrom) ||
    JSON.stringify([...candidate.unknownPolicy.distinctFrom].sort()) !== JSON.stringify(['absence', 'zero'])
  ) {
    errors.push('unknownPolicy.distinctFrom: UNKNOWN must be declared distinct from exactly zero and absence');
  }
  if (typeof candidate.unknownPolicy?.statement !== 'string') {
    errors.push('unknownPolicy.statement: the UNKNOWN channel policy must be stated explicitly');
  }
  // Required nonclaims are explicit.
  const nonclaims = Array.isArray(candidate.nonclaims) ? candidate.nonclaims.join('\n').toLowerCase() : '';
  for (const marker of REQUIRED_NONCLAIM_MARKERS) {
    if (!nonclaims.includes(marker)) {
      errors.push(`nonclaims: a required nonclaim is missing (${marker})`);
    }
  }
  // Canon applicability matrix.
  errors.push(...canonApplicabilityErrors(candidate.canonApplicability));
  return errors;
}

// ---------------------------------------------------------------------------
// The independent calculator. Fails closed: any rule violation, shape
// violation, or scope widening THROWS rather than silently producing a
// number. All arithmetic is on integer minor units.
// ---------------------------------------------------------------------------

function computeNetRevenue(candidateContract, candidateHoldout) {
  const periods = {};
  for (const name of PERIOD_NAMES) {
    periods[name] = {
      netMinorUnits: 0,
      saleMinorUnits: 0,
      creditMinorUnits: 0,
      cancelCount: 0,
      unknown: { count: 0, quantifiedAmountMinorUnits: 0, unquantifiedCount: 0 },
      rowCount: 0,
    };
  }
  const current = candidateContract.periods.current;
  const comparison = candidateContract.periods.comparison;
  let unassignedUnknownCount = 0;
  let excludedOutOfScopeCount = 0;

  if (!candidateHoldout || !Array.isArray(candidateHoldout.rows)) {
    throw new Error('holdout: a rows array is required');
  }

  for (const row of candidateHoldout.rows) {
    const label = row?.order_id ?? '<missing-order-id>';

    // Strict synthetic row shape: exactly the admitted four fields. Any extra
    // field (e.g. a second currency or date column) widens scope and fails.
    const fields = Object.keys(row ?? {}).sort();
    if (fields.join(',') !== ROW_FIELDS.join(',')) {
      throw new Error(
        `holdout row ${label}: strict synthetic row shape violated (an extra or missing field widens relation/currency/date-role scope)`,
      );
    }

    // Synthetic non-customer identifier namespace only.
    if (typeof row.order_id !== 'string' || !SYNTHETIC_ID.test(row.order_id)) {
      throw new Error(`holdout row ${label}: order_id must be a synthetic s-NNN identifier (no production/customer data)`);
    }

    const { order_date: date, record_kind: kind, amount_minor_units: amount } = row;
    if (date !== null && !isValidCalendarDate(date)) {
      throw new Error(`holdout row ${label}: order_date must be a valid YYYY-MM-DD date or null`);
    }
    if (typeof kind !== 'string' || !RECORD_KINDS.includes(kind)) {
      throw new Error(`holdout row ${label}: record_kind must be one of ${RECORD_KINDS.join(', ')}`);
    }
    const hasAmount = isExactCent(amount);
    if (amount !== null && !hasAmount) {
      throw new Error(`holdout row ${label}: amount_minor_units must be an integer or null (exact-cent arithmetic)`);
    }

    // Explicit record-rule violations fail closed before any aggregation.
    if (kind === 'cancel' && hasAmount && amount !== 0) {
      throw new Error(`holdout row ${label}: cancel rule violation (a cancellation amount must be exactly 0)`);
    }
    if (kind === 'credit' && hasAmount && amount <= 0) {
      throw new Error(`holdout row ${label}: credit rule violation (a credit amount must be a positive integer; a double-negative is forbidden)`);
    }
    if ((kind === 'sale' || kind === 'unknown') && hasAmount && amount < 0) {
      throw new Error(`holdout row ${label}: ${kind} rule violation (amount must be a non-negative integer)`);
    }

    // A null order date is PERIOD_UNASSIGNABLE: routed to the UNKNOWN channel
    // as unassigned. Never zero, never dropped without a count.
    if (date === null) {
      unassignedUnknownCount += 1;
      continue;
    }

    const inCurrent = date >= current.start && date <= current.end;
    const inComparison = date >= comparison.start && date <= comparison.end;

    // UNKNOWN routing: kind-unknown or null-amount rows never touch the net
    // total; they are counted (and quantified when an integer amount exists).
    if (kind === 'unknown' || amount === null) {
      if (inCurrent || inComparison) {
        const bucket = periods[inCurrent ? 'current' : 'comparison'];
        bucket.rowCount += 1;
        bucket.unknown.count += 1;
        if (hasAmount) {
          bucket.unknown.quantifiedAmountMinorUnits += amount;
        } else {
          bucket.unknown.unquantifiedCount += 1;
        }
      } else {
        excludedOutOfScopeCount += 1;
      }
      continue;
    }

    if (inCurrent || inComparison) {
      const bucket = periods[inCurrent ? 'current' : 'comparison'];
      bucket.rowCount += 1;
      if (kind === 'sale') {
        bucket.saleMinorUnits += amount;
        bucket.netMinorUnits += amount;
      } else if (kind === 'credit') {
        bucket.creditMinorUnits += amount;
        bucket.netMinorUnits -= amount;
      } else {
        bucket.cancelCount += 1;
      }
    } else {
      excludedOutOfScopeCount += 1;
    }
  }

  return {
    periods: {
      current: periods.current,
      comparison: periods.comparison,
    },
    deltaMinorUnits: periods.current.netMinorUnits - periods.comparison.netMinorUnits,
    unassignedUnknownCount,
    excludedOutOfScopeCount,
  };
}

// ---------------------------------------------------------------------------
// Import self-scan (CANON-5 / shared-production-import sabotage case).
// Extracts import specifiers from source text and flags any that point at
// production analysis code rather than node: built-ins.
// ---------------------------------------------------------------------------

const PRODUCTION_IMPORT_PATTERNS = [/services\//, /packages\//, /analyzer/, /bi-control/, /progressive-analysis/];

// NOTE: the tampered production specifier below is built by joining path
// fragments so that THIS file's own source never contains a contiguous
// production import path that the self-scan could flag.
const TAMPERED_PRODUCTION_SPEC = ['..', 'services', 'bi-control', 'src', 'bi-specialist', 'specialist-agent.mjs'].join('/');

function importSpecifiers(sourceText) {
  const specs = [];
  const staticImport = /import\s+(?:[\w${}\s,*]+\s+from\s+)?['"]([^'"\n]+)['"]/g;
  const dynamicImport = /import\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  for (const re of [staticImport, dynamicImport]) {
    for (const match of sourceText.matchAll(re)) {
      specs.push(match[1]);
    }
  }
  return specs;
}

function productionImportSpecifiers(sourceText) {
  return importSpecifiers(sourceText).filter(
    (spec) => !spec.startsWith('node:') && PRODUCTION_IMPORT_PATTERNS.some((re) => re.test(spec)),
  );
}

function assertAllIntegers(value, path = 'result') {
  if (typeof value === 'number') {
    assert.ok(Number.isInteger(value), `${path} must be an exact integer (floating point is forbidden)`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertAllIntegers(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assertAllIntegers(child, `${path}.${key}`);
    }
  }
}

const computed = computeNetRevenue(contract, holdout);
const expected = oracle.expected;

// ---------------------------------------------------------------------------
// Positive success cases (owned by this worker).
// ---------------------------------------------------------------------------

test('contract fixes exactly one relation, one ORDER_DATE role, one currency, and two periods with explicit credit/cancel/UNKNOWN rules', () => {
  assert.deepEqual(contractValidationErrors(contract), []);
  assert.equal(contract.schemaVersion, SCHEMA_VERSION);
  assert.equal(contract.relation.name, 'synthetic_bi.orders');
  assert.equal(contract.orderDateRole.column, 'order_date');
  assert.equal(contract.orderDateRole.role, 'ORDER_DATE');
  assert.equal(contract.currency.code, 'EUR');
  assert.equal(contract.currency.minorUnitsPerMajorUnit, 2);
  assert.deepEqual(Object.keys(contract.periods).sort(), ['comparison', 'current']);
  assert.equal(contract.periods.comparison.start, '2026-06-01');
  assert.equal(contract.periods.comparison.end, '2026-06-30');
  assert.equal(contract.periods.current.start, '2026-07-01');
  assert.equal(contract.periods.current.end, '2026-07-31');
  for (const kind of RECORD_KINDS) {
    assert.ok(
      typeof contract.recordRules[kind].contribution === 'string' &&
        contract.recordRules[kind].contribution.length > 0,
      `recordRules.${kind} must carry an explicit contribution`,
    );
    assert.ok(
      typeof contract.recordRules[kind].amountConstraint === 'string' &&
        contract.recordRules[kind].amountConstraint.length > 0,
      `recordRules.${kind} must carry an explicit amountConstraint`,
    );
  }
});

test('synthetic holdout coverage matrix covers positive, credit, cancelled, boundary-date, null, UNKNOWN, zero-amount, and out-of-scope cases on non-customer bytes', () => {
  const rows = holdout.rows;
  assert.equal(rows.length, 17);
  for (const row of rows) {
    assert.ok(SYNTHETIC_ID.test(row.order_id), `order_id ${row.order_id} must stay in the synthetic s-NNN namespace`);
    assert.deepEqual(Object.keys(row).sort(), ROW_FIELDS, 'each row must carry exactly the admitted four fields');
  }
  const count = (predicate) => rows.filter(predicate).length;
  // Required classes are all present.
  assert.ok(count((r) => r.record_kind === 'sale' && r.amount_minor_units > 0) >= 1, 'positive sale cases required');
  assert.ok(count((r) => r.record_kind === 'credit') >= 1, 'credit cases required');
  assert.ok(count((r) => r.record_kind === 'cancel') >= 1, 'cancelled cases required');
  assert.ok(count((r) => r.record_kind === 'unknown') >= 1, 'UNKNOWN cases required');
  assert.ok(count((r) => r.amount_minor_units === null) >= 1, 'null amount cases required');
  assert.ok(count((r) => r.order_date === null) >= 1, 'null date (unassigned) cases required');
  assert.ok(count((r) => r.amount_minor_units === 0) >= 1, 'zero-amount cases required (distinct from UNKNOWN)');
  // Every period boundary date is occupied by a row.
  for (const boundaryDate of ['2026-06-01', '2026-06-30', '2026-07-01', '2026-07-31']) {
    assert.ok(count((r) => r.order_date === boundaryDate) >= 1, `boundary date ${boundaryDate} must be covered`);
  }
  // Out-of-scope dates exist so the calculator cannot silently widen periods.
  assert.ok(
    count((r) => r.order_date !== null && (r.order_date < '2026-06-01' || r.order_date > '2026-07-31')) >= 1,
    'out-of-scope date cases required',
  );
  // No production/customer bytes: identifiers and relation are synthetic only.
  assert.equal(holdout.classification, 'SYNTHETIC_NON_CUSTOMER_BYTES');
  assert.equal(holdout.relation, contract.relation.name);
  assert.equal(holdout.currencyCode, contract.currency.code);
});

test('independent exact-cent oracle: computed period totals and delta equal the frozen oracle', () => {
  assertAllIntegers(computed);
  assert.equal(computed.periods.comparison.netMinorUnits, 30000);
  assert.equal(computed.periods.current.netMinorUnits, 100059);
  assert.equal(computed.deltaMinorUnits, 70059);
  assert.deepStrictEqual(computed, expected);
});

test('byte-bound receipt: contract and holdout bytes match the oracle-recorded sha256 digests', () => {
  assert.equal(oracle.receipt.binding, 'sha256-of-exact-file-bytes');
  assert.equal(sha256(contractBytes), oracle.receipt.contract.sha256);
  assert.equal(sha256(holdoutBytes), oracle.receipt.holdout.sha256);
  assert.match(oracle.receipt.contract.sha256, /^[a-f0-9]{64}$/);
  assert.match(oracle.receipt.holdout.sha256, /^[a-f0-9]{64}$/);
});

test('determinism: repeated and row-reordered computation returns identical exact-cent results', () => {
  const repeated = computeNetRevenue(contract, holdout);
  const reversed = computeNetRevenue(contract, { ...holdout, rows: [...holdout.rows].reverse() });
  assert.deepStrictEqual(repeated, computed);
  assert.deepStrictEqual(reversed, computed);
  // Mechanical determinism check: no wall-clock or randomness in this file.
  assert.ok(!/Date\.now\s*\(/.test(testSource), 'no wall-clock reads (Date.now) allowed in the oracle gate');
  assert.ok(!/Math\.random\s*\(/.test(testSource), 'no randomness (Math.random) allowed in the oracle gate');
});

test('required nonclaims are explicit: no production, customer, general BI, dashboard, or release/publish claim', () => {
  const nonclaims = contract.nonclaims.join('\n').toLowerCase();
  for (const marker of REQUIRED_NONCLAIM_MARKERS) {
    assert.ok(nonclaims.includes(marker), `required nonclaim missing: ${marker}`);
  }
  assert.equal(contract.metric.classification, 'SYNTHETIC_HOLDOUT_METRIC');
});

test('PSai Canon applicability and non-applicability are recorded at issue admission', () => {
  assert.deepEqual(canonApplicabilityErrors(contract.canonApplicability), []);
  const laws = contract.canonApplicability.laws;
  assert.ok(laws.some((law) => law.applicability === 'APPLICABLE'), 'at least one APPLICABLE law must be recorded');
  assert.ok(
    laws.some((law) => law.applicability === 'NOT_APPLICABLE'),
    'at least one NOT_APPLICABLE law must be recorded',
  );
  for (const law of laws.filter((l) => l.applicability === 'NOT_APPLICABLE')) {
    assert.ok(
      typeof law.admissionBasis === 'string' && law.admissionBasis.trim().length >= 16,
      `canon ${law.id}: every NOT_APPLICABLE claim must carry a recorded admission basis`,
    );
  }
  // Recorded at issue admission, on the same day the metric was admitted.
  assert.equal(contract.canonApplicability.recordedAt, contract.metric.admission.admittedAt);
  assert.equal(contract.canonApplicability.recordedAt, '2026-09-01');
});

test('independent calculator imports no production analysis code (self-scan of this file)', () => {
  const specs = importSpecifiers(testSource);
  assert.ok(specs.length >= 1, 'the self-scan must find this file import specifiers');
  for (const spec of specs) {
    assert.ok(spec.startsWith('node:'), `only node: built-ins may be imported, found: ${spec}`);
  }
  assert.deepEqual(productionImportSpecifiers(testSource), []);
  assert.ok(
    /function computeNetRevenue\(/.test(testSource),
    'the exact-cent calculator must live inline in this file, not be imported',
  );
});

// ---------------------------------------------------------------------------
// Fail-closed adversarial cases (sabotage proof). Each mutation must be
// detected: an exception, a deviation from the frozen oracle, or a rejected
// contract. None of these mutations may yield a silently accepted number.
// ---------------------------------------------------------------------------

test('one-cent mutation fails closed: totals deviate from the oracle and the byte-bound receipt breaks', () => {
  const mutated = structuredClone(holdout);
  const row = mutated.rows.find((r) => r.order_id === 's-014');
  row.amount_minor_units = 61; // 60 -> 61: a one-cent mutation

  const result = computeNetRevenue(contract, mutated);
  assert.notDeepStrictEqual(result, expected, 'a one-cent mutation must not match the frozen oracle');
  assert.equal(result.periods.current.netMinorUnits, expected.periods.current.netMinorUnits + 1);
  assert.equal(result.deltaMinorUnits, expected.deltaMinorUnits + 1);

  // The byte-bound receipt is bound to the exact frozen bytes: any changed
  // holdout byte produces a different digest than the recorded one.
  const mutatedBytes = Buffer.from(JSON.stringify(mutated, null, 2));
  assert.notEqual(sha256(mutatedBytes), oracle.receipt.holdout.sha256, 'changed holdout bytes must break the receipt digest');
});

test('cancel rule mutation fails closed: a cancellation with a nonzero amount is rejected', () => {
  const mutated = structuredClone(holdout);
  mutated.rows.find((r) => r.order_id === 's-004').amount_minor_units = 500;
  assert.throws(() => computeNetRevenue(contract, mutated), /cancel rule violation/);
});

test('credit rule mutation fails closed: a double-negative credit is rejected', () => {
  const mutated = structuredClone(holdout);
  mutated.rows.find((r) => r.order_id === 's-003').amount_minor_units = -5500;
  assert.throws(() => computeNetRevenue(contract, mutated), /credit rule violation/);
});

test('UNKNOWN rule mutation fails closed: unknown amounts never enter net and a negative unknown amount is rejected', () => {
  // Unknown rows are quantified in their own channel only: 777 must not
  // appear in the comparison net total (30000), only in the unknown channel.
  const comparison = computed.periods.comparison;
  assert.equal(comparison.unknown.quantifiedAmountMinorUnits, 777);
  assert.equal(comparison.netMinorUnits, 30000);
  assert.ok(!String(comparison.netMinorUnits).includes('777') || comparison.netMinorUnits !== 777, 'unknown amounts must not be added to net');
  // A null amount routes to the unknown channel (unquantified), never to zero.
  assert.equal(comparison.unknown.unquantifiedCount, 1);
  // A negative unknown amount is a rule violation and fails closed.
  const mutated = structuredClone(holdout);
  mutated.rows.find((r) => r.order_id === 's-005').amount_minor_units = -777;
  assert.throws(() => computeNetRevenue(contract, mutated), /unknown rule violation/);
});

test('widening to a second relation or a third period fails closed', () => {
  // Second relation.
  const secondRelation = structuredClone(contract);
  secondRelation.relation = [contract.relation, { name: 'synthetic_bi.refunds', kind: 'SYNTHETIC_TABLE' }];
  const relationErrors = contractValidationErrors(secondRelation);
  assert.ok(relationErrors.some((e) => e.includes('relation:')), 'a second relation must be rejected');

  // Third period.
  const thirdPeriod = structuredClone(contract);
  thirdPeriod.periods.prior = { label: '2026-05', start: '2026-05-01', end: '2026-05-31', boundary: 'inclusive-both-ends' };
  assert.ok(contractValidationErrors(thirdPeriod).some((e) => e.includes('periods:')), 'a third period must be rejected');

  // Missing period.
  const onePeriod = structuredClone(contract);
  delete onePeriod.periods.comparison;
  assert.ok(contractValidationErrors(onePeriod).some((e) => e.includes('periods:')), 'a single period must be rejected');
});

test('widening to a second currency or a second ORDER_DATE role fails closed (contract and row level)', () => {
  // Second currency code at the contract level.
  const secondCurrency = structuredClone(contract);
  secondCurrency.currency.code = ['EUR', 'USD'];
  assert.ok(contractValidationErrors(secondCurrency).some((e) => e.includes('currency:')), 'a second currency must be rejected');

  // Second date role at the contract level.
  const secondDateRole = structuredClone(contract);
  secondDateRole.orderDateRole = [
    contract.orderDateRole,
    { column: 'shipping_date', role: 'SHIPPING_DATE', format: 'YYYY-MM-DD' },
  ];
  assert.ok(
    contractValidationErrors(secondDateRole).some((e) => e.includes('orderDateRole:')),
    'a second ORDER_DATE role must be rejected',
  );

  // Row-level currency widening: an extra currency_code field breaks the
  // strict synthetic row shape and is rejected by the calculator.
  const widenedRows = structuredClone(holdout);
  widenedRows.rows = [
    { order_id: 's-099', order_date: '2026-07-05', record_kind: 'sale', amount_minor_units: 100, currency_code: 'USD' },
  ];
  assert.throws(
    () => computeNetRevenue(contract, widenedRows),
    /strict synthetic row shape violated/,
  );
});

test('shared production implementation import fails closed', () => {
  const tamperedSource = "import { RealBiSpecialist } from '" + TAMPERED_PRODUCTION_SPEC + "';";
  const flagged = productionImportSpecifiers(tamperedSource);
  assert.deepEqual(flagged, [TAMPERED_PRODUCTION_SPEC], 'a production import specifier must be flagged');
  // And this file itself remains clean (the oracle gate stays independent).
  assert.deepEqual(productionImportSpecifiers(testSource), []);
});

test('unsupported Canon NOT_APPLICABLE claim fails closed', () => {
  // An APPLICABLE law flipped to NOT_APPLICABLE with no admission basis is
  // an unsupported claim and must be rejected at admission.
  const unsupported = structuredClone(contract);
  const target = unsupported.canonApplicability.laws.find((law) => law.id === 'CANON-1');
  target.applicability = 'NOT_APPLICABLE';
  target.admissionBasis = '';
  assert.ok(
    contractValidationErrors(unsupported).some((e) => e.includes('unsupported NOT_APPLICABLE')),
    'an unsupported NOT_APPLICABLE claim (empty basis) must be rejected',
  );

  // Whitespace-only basis is equally unsupported.
  const padded = structuredClone(contract);
  const target2 = padded.canonApplicability.laws.find((law) => law.id === 'CANON-1');
  target2.applicability = 'NOT_APPLICABLE';
  target2.admissionBasis = '   ';
  assert.ok(
    contractValidationErrors(padded).some((e) => e.includes('unsupported NOT_APPLICABLE')),
    'an unsupported NOT_APPLICABLE claim (whitespace basis) must be rejected',
  );

  // A valid NOT_APPLICABLE law with a recorded basis still passes.
  assert.deepEqual(canonApplicabilityErrors(contract.canonApplicability), []);
});