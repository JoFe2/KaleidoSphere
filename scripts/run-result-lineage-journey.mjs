#!/usr/bin/env node
// KaleidoSphere KS247 (KS-EVO-02-AC02/AC03/AC04) — the ONE runnable LOCAL read-only result
// lineage entry point on the existing CLI/TABLE/HTML read path.
//
// It runs the RETAINED KS246 composition (dependency/ks246 = 37cf871, unchanged) against an
// actual local synthetic database, then separates the released read output into
// independently verified numbers, free-form explanation, unavailable facts and the ACTUAL
// completion state — and refuses to present any of them as one of the others.
//
//   node scripts/run-result-lineage-journey.mjs
//       EOF run: no answers at all, so the proposal stays PROPOSED and nothing is
//       executed.  The truthfully rendered outcome is "no completion, no verified number".
//
//   node scripts/run-result-lineage-journey.mjs --answers <file> --kind-decisions <file> \
//       --business-semantics <file> --source-revision <rev> \
//       [--source <path>] [--expectation <path>] [--evidence-claim <path>] \
//       [--explanation <path>] [--effect-status <path>] [--format JSON|TABLE|HTML]
//       [--pglite <absolute dist/index.js path>] [--goal <name>]
//
//       --kind-decisions, --business-semantics and --source-revision are REQUIRED to execute
//       and are NEVER defaulted here (the retained KS246 composition owns that refusal and
//       refuses BEFORE any database is created, seeded or read).
//       --expectation names the INDEPENDENTLY MAINTAINED expectation.  Its default is the
//       authored fixture; a caller may name its OWN maintained expectation, which is exactly
//       the point: the numbers the read produced are compared against a declaration that was
//       not derived from the read.
//       --evidence-claim lets a CALLER state which digests the presented numbers rest on.
//       Without it the CLI states the ACTUAL evidence it observed.  A claim whose digest was
//       recomputed for substituted bytes is still refused, because the claim is compared
//       against the maintained expectation and not against its own self-consistency.
//       --explanation supplies the free-form interpretation.  It is rendered labelled
//       UNVERIFIED and never counted as verified.
//       --effect-status supplies the SEPARATELY CONFIRMED effect status.  This journey is
//       read-only and declares no effect journal; a synthetic effect shown without this
//       input is refused rather than invented.
//       Without --pglite the journey runs against a clearly-labelled synthetic adapter; with
//       it, against a real in-process PGlite supplied by the caller.
//
//   node scripts/run-result-lineage-journey.mjs --negative
//       execute the bounded negative gates and print their exact rejection codes.  Every
//       input below is authored here FOR THE GATE, never adopted on the caller path.
//
// This CLI writes NOTHING: it prints to stdout, opens no socket, sends no SQL of its own,
// mutates no public state, and grants no authority beyond one local read-only synthetic
// execution.  The separately owned PAN452 read-purpose binding stays NOT_INTEGRATED.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createListAnswerSource,
  runUnfamiliarSchemaProposalEntryPoint,
} from '../services/bi-control/src/business-bi/unfamiliar-schema-proposal.mjs';
import {
  buildUnfamiliarSyntheticDatabase,
  requireJourneyCallerBindings,
  runUnfamiliarMetricJourney,
} from '../services/bi-control/src/business-bi/net-revenue-unfamiliar-composition.mjs';
import { buildPgliteJourneyDatabase } from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';
import {
  RESULT_LINEAGE_EVIDENCE_CLAIM_SCHEMA,
  RESULT_LINEAGE_FORMATS,
  buildReadOnlyResultLineage,
  loadConfirmedEffectStatus,
  loadEvidenceClaim,
  loadFreeExplanation,
  loadIndependentExpectation,
  renderResultLineage,
  verifyReadOnlyResultLineage,
} from '../services/bi-control/src/business-bi/result-lineage-v1.mjs';

const KS246_FD = 'tests/fixtures/business-bi/ks246-unfamiliar-schema';
const KS247_FD = 'tests/fixtures/business-bi/ks247-result-lineage';
const METADATA_PATH = `${KS246_FD}/metadata-v1.json`;
const AGGREGATE_PATH = `${KS246_FD}/aggregate-profile-v1.json`;
const SOURCE_PATH = `${KS246_FD}/source-pay-feed-v1.json`;
const KIND_DECISIONS_PATH = `${KS246_FD}/kind-decisions-v1.json`;
const BUSINESS_SEMANTICS_PATH = `${KS246_FD}/business-semantics-v1.json`;
const CONTRACT_PATH = 'contracts/business-bi/v1/net-revenue.metric.json';
const ORACLE_PATH = 'tests/fixtures/business-bi/net-revenue-oracle-v1.json';
const EXPECTATION_PATH = `${KS247_FD}/independent-expectation-v1.json`;
const SOURCE_REVISION = 'synthetic-unfamiliar-source-v1';

const CONFIRMED_ANSWERS = Object.freeze([
  'synth_x.pay_feed.pf_id', // grain
  'synth_x.pay_feed.val_dt', // period
  'MINOR_UNITS', // released arithmetic unit
  'synth_x.pay_feed.amt_a', // metric amount column
  'EUR', // released currency
  'R', // credit value
  'V', // cancel value
]);

const AUTHORITY = Object.freeze({
  localSyntheticReadOnly: true,
  mutationAuthority: false,
  publicWrites: false,
});

// The caller inputs the retained composition refuses without, kept in one place so the
// pre-database refusal below and the composition's own guard agree exactly.
const PRE_DATABASE_DENIALS = new Set([
  'KS246_JOURNEY_DENIED:MISSING_KIND_DECISION_INPUT',
  'KS246_JOURNEY_DENIED:MISSING_BUSINESS_SEMANTIC_CONFIRMATION',
  'KS246_JOURNEY_DENIED:MISSING_SOURCE_REVISION_BINDING',
]);

const args = process.argv.slice(2);
const optionOf = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
};

const metadataBytes = readFileSync(METADATA_PATH);
const aggregateBytes = readFileSync(AGGREGATE_PATH);
const sourceBytes = readFileSync(optionOf('--source') ?? SOURCE_PATH);
const metricContractBytes = readFileSync(CONTRACT_PATH);
const oracleBytes = readFileSync(ORACLE_PATH);

const answersPath = optionOf('--answers');
const kindDecisionsPath = optionOf('--kind-decisions');
const businessSemanticsPath = optionOf('--business-semantics');
const sourceRevisionOption = optionOf('--source-revision');
const expectationPath = optionOf('--expectation') ?? EXPECTATION_PATH;
const evidenceClaimPath = optionOf('--evidence-claim');
const explanationPath = optionOf('--explanation');
const effectStatusPath = optionOf('--effect-status');
const goalOption = optionOf('--goal');
const formatOption = (optionOf('--format') ?? 'JSON').toUpperCase();

const expectationBytes = readFileSync(expectationPath);
const explanationBytes = explanationPath === null ? null : readFileSync(explanationPath);
const effectStatusBytes = effectStatusPath === null ? null : readFileSync(effectStatusPath);

function proposalFor(lines) {
  return runUnfamiliarSchemaProposalEntryPoint({
    metadataBytes,
    aggregateBytes,
    answerSource: lines === undefined ? undefined : createListAnswerSource(lines),
  });
}

function answersFrom(pathname) {
  if (pathname === null) return undefined;
  return readFileSync(pathname, 'utf8').split('\n');
}

async function makeDatabase() {
  const pglitePath = optionOf('--pglite');
  if (pglitePath === null) return buildUnfamiliarSyntheticDatabase();
  if (!path.isAbsolute(pglitePath)) {
    throw new Error('KS247_CLI_PGLITE_PATH_DENIED: --pglite must be an absolute path');
  }
  const { PGlite } = await import(pathToFileURL(pglitePath).href);
  return buildPgliteJourneyDatabase(new PGlite());
}

const denial = (kind, error) => ({ kind, code: error?.code ?? null, message: String(error?.message ?? error) });

// The evidence claim the CLI states when the caller names none: the ACTUAL digests it
// observed.  It is a statement of fact, not an authority, and it is still compared against
// the maintained expectation.
function observedEvidenceClaim(journey) {
  return loadEvidenceClaim({
    schemaVersion: RESULT_LINEAGE_EVIDENCE_CLAIM_SCHEMA,
    issue: 'KS-EVO-02',
    sourceRevision: journey.binding.sourceRevision,
    sourceByteSha256: journey.binding.sourceSha256,
    canonicalHoldoutSha256: journey.binding.canonicalHoldoutSha256,
    resultSha256: journey.resultSha256 ?? null,
  });
}

function lineageInput(journey) {
  return {
    journey,
    expectation: loadIndependentExpectation(expectationBytes),
    metricContractBytes,
    evidenceClaim: evidenceClaimPath === null
      ? observedEvidenceClaim(journey)
      : loadEvidenceClaim(readFileSync(evidenceClaimPath)),
    explanation: explanationBytes === null ? null : loadFreeExplanation(explanationBytes),
    effectStatus: effectStatusBytes === null ? null : loadConfirmedEffectStatus(effectStatusBytes),
  };
}

function renderLineage(input, format) {
  const lineage = buildReadOnlyResultLineage(input);
  // Round-trip: the rendering is emitted only for a lineage that re-derives identically.
  verifyReadOnlyResultLineage({ lineage, ...input });
  return { lineage, text: renderResultLineage(lineage, format) };
}

// ---------------------------------------------------------------------------------
// Negative mode: every gate is exercised with an authored contradicting input, and the
// EXACT intended rejection is reported.  An unexpected acceptance is reported as such.
// ---------------------------------------------------------------------------------
function mutatedJson(bytes, mutate) {
  const copy = JSON.parse(bytes.toString('utf8'));
  mutate(copy);
  return Buffer.from(JSON.stringify(copy), 'utf8');
}

function record(codes, label, run) {
  try {
    const out = run();
    codes.push(`${label}=UNEXPECTEDLY_ACCEPTED:${JSON.stringify(out?.lineageSha256 ?? out ?? null)}`);
  } catch (error) {
    codes.push(`${label}=${error?.code ?? String(error?.message ?? error)}`);
  }
}

// The same report for a gate whose run reaches the retained composition's own async entry
// point: the intended rejection is still reported as an exact code, never as an exception.
async function recordAsync(codes, label, run) {
  try {
    const out = await run();
    codes.push(`${label}=UNEXPECTEDLY_ACCEPTED:${JSON.stringify(out?.lineageSha256 ?? null)}`);
  } catch (error) {
    codes.push(`${label}=${error?.code ?? String(error?.message ?? error)}`);
  }
}

async function runNegative() {
  const codes = [];
  const proposal = proposalFor(CONFIRMED_ANSWERS);
  const explanationAuthored = loadFreeExplanation({
    schemaVersion: 'kaleidosphere.business-bi/result-lineage-explanation/v1',
    issue: 'KS-EVO-02',
    authoredInput: true,
    assertions: [{ assertionId: 'authored-prose', kind: 'DESCRIPTIVE', text: 'authored gate input' }],
  });
  const base = {
    proposal,
    sourceBytes,
    kindDecisionBytes: readFileSync(KIND_DECISIONS_PATH),
    businessSemanticBytes: readFileSync(BUSINESS_SEMANTICS_PATH),
    metricContractBytes,
    oracleBytes,
    database: buildUnfamiliarSyntheticDatabase(),
    sourceRevision: SOURCE_REVISION,
    authority: AUTHORITY,
  };
  const journey = await runUnfamiliarMetricJourney(base);
  const expectation = loadIndependentExpectation(expectationBytes);
  const explanationFixture = loadFreeExplanation(readFileSync(`${KS247_FD}/explanation-v1.json`));
  const effectStatusFixture = readFileSync(`${KS247_FD}/effect-status-v1.json`);
  const claim = () => observedEvidenceClaim(journey);
  const input = (over) => ({
    journey, expectation, metricContractBytes, evidenceClaim: claim(),
    explanation: explanationFixture, effectStatus: loadConfirmedEffectStatus(effectStatusFixture), ...over,
  });
  const badExplanation = (assertions) => loadFreeExplanation({
    schemaVersion: 'kaleidosphere.business-bi/result-lineage-explanation/v1',
    issue: 'KS-EVO-02',
    assertions,
  });

  // A journey whose binding names a source digest the maintained expectation does not pin is
  // refused before any number is compared.
  record(codes, 'binding-source-digest-not-current', () => buildReadOnlyResultLineage(input({
    journey: { ...journey, binding: { ...journey.binding, sourceSha256: '0'.repeat(64) } },
  })));

  // AC02 — the independent comparison, dimension by dimension.
  const expectationBytesFor = (mutate) => mutatedJson(expectationBytes, mutate);
  record(codes, 'wrong-number', () => buildReadOnlyResultLineage(input({
    expectation: loadIndependentExpectation(expectationBytesFor((value) => {
      value.expectedNumbers['periods.current.netMinorUnits'] = 999999;
    })),
  })));
  record(codes, 'wrong-unit', () => buildReadOnlyResultLineage(input({
    expectation: loadIndependentExpectation(expectationBytesFor((value) => {
      value.unit = { id: 'CHF_MINOR_UNITS', currency: 'CHF', minorUnitsPerMajorUnit: 100, amountUnit: 'MINOR_UNITS' };
    })),
  })));
  record(codes, 'wrong-period', () => buildReadOnlyResultLineage(input({
    expectation: loadIndependentExpectation(expectationBytesFor((value) => {
      value.periods.current.end = '2026-07-30';
    })),
  })));
  record(codes, 'source-substitution-with-recomputed-digest', () => buildReadOnlyResultLineage(input({
    evidenceClaim: loadEvidenceClaim({
      schemaVersion: RESULT_LINEAGE_EVIDENCE_CLAIM_SCHEMA,
      issue: 'KS-EVO-02',
      sourceRevision: SOURCE_REVISION,
      sourceByteSha256: '1'.repeat(64),
      canonicalHoldoutSha256: journey.binding.canonicalHoldoutSha256,
      resultSha256: journey.resultSha256,
      recomputedByCaller: true,
    }),
  })));
  record(codes, 'stale-evidence', () => buildReadOnlyResultLineage(input({
    evidenceClaim: loadEvidenceClaim({
      schemaVersion: RESULT_LINEAGE_EVIDENCE_CLAIM_SCHEMA,
      issue: 'KS-EVO-02',
      sourceRevision: SOURCE_REVISION,
      sourceByteSha256: expectation.supersededEvidence[0].evidenceSha256,
      canonicalHoldoutSha256: journey.binding.canonicalHoldoutSha256,
      resultSha256: journey.resultSha256,
    }),
  })));
  record(codes, 'evidence-not-current', () => buildReadOnlyResultLineage(input({
    evidenceClaim: loadEvidenceClaim({
      schemaVersion: RESULT_LINEAGE_EVIDENCE_CLAIM_SCHEMA,
      issue: 'KS-EVO-02',
      sourceRevision: SOURCE_REVISION,
      sourceByteSha256: journey.binding.sourceSha256,
      canonicalHoldoutSha256: '2'.repeat(64),
      resultSha256: journey.resultSha256,
    }),
  })));
  record(codes, 'contract-substituted', () => buildReadOnlyResultLineage(input({
    metricContractBytes: mutatedJson(metricContractBytes, (contract) => { contract.currency.code = 'CHF'; }),
  })));
  record(codes, 'source-revision-stale', () => buildReadOnlyResultLineage(input({
    journey: { ...journey, binding: { ...journey.binding, sourceRevision: 'synthetic-unfamiliar-v1' } },
  })));
  // The retained KS246 confinement still holds on this path: a resealed source is refused by
  // the released composition at bind time, before any database is created, seeded or read.
  const substitutedSource = mutatedJson(sourceBytes, (source) => { source.rows[0].amt_a = 999999; });
  await recordAsync(codes, 'resealed-source-refused-by-released-confinement', () => (
    runUnfamiliarMetricJourney({ ...base, sourceBytes: substitutedSource })
  ));

  // AC03 — explanation is never verified, and unavailable facts are not numbers.
  record(codes, 'causal-assertion-presented-as-verified', () => buildReadOnlyResultLineage(input({
    explanation: badExplanation([{ assertionId: 'c', kind: 'CAUSAL', text: 'the delta was caused by the campaign', assertedAsVerified: true }]),
  })));
  record(codes, 'completion-assertion-presented-as-verified', () => buildReadOnlyResultLineage(input({
    explanation: badExplanation([{ assertionId: 'k', kind: 'COMPLETION', text: 'the journey completed', assertedAsVerified: true }]),
  })));
  record(codes, 'explanation-presented-as-verified', () => buildReadOnlyResultLineage(input({
    explanation: badExplanation([{ assertionId: 'x', kind: 'DESCRIPTIVE', text: 'prose', assertedAsVerified: true }]),
  })));
  record(codes, 'unavailable-fact-asserted', () => buildReadOnlyResultLineage(input({
    explanation: badExplanation([{ assertionId: 'gross_margin', kind: 'NUMBER', text: 'gross margin was 12%', assertedAsVerified: true }]),
  })));
  record(codes, 'explanation-numeric-payload', () => badExplanation([
    { assertionId: 'n', kind: 'DESCRIPTIVE', text: 'prose', value: 70059 },
  ]));

  // AC04 — completion and effects.
  record(codes, 'fabricated-effect-journal', () => buildReadOnlyResultLineage(input({
    explanation: badExplanation([{ assertionId: 'e', kind: 'EFFECT', text: 'a synthetic effect was applied' }]),
    effectStatus: null,
  })));
  record(codes, 'effect-status-not-separately-confirmed', () => loadConfirmedEffectStatus({
    schemaVersion: 'kaleidosphere.business-bi/result-lineage-effect-status/v1',
    issue: 'KS-EVO-02',
    sourceRevision: SOURCE_REVISION,
    mutationAuthority: false,
    effects: [{
      effectId: 'eff-1',
      kind: 'SYNTHETIC_EFFECT',
      status: 'SYNTHETIC_EFFECT_CONFIRMED_APPLIED',
      separateConfirmation: { kind: 'INFERRED_FROM_READ', confirmationId: 'self', confirmationSha256: '3'.repeat(64) },
    }],
  }));
  record(codes, 'read-only-effect-claim', () => loadConfirmedEffectStatus({
    schemaVersion: 'kaleidosphere.business-bi/result-lineage-effect-status/v1',
    issue: 'KS-EVO-02',
    sourceRevision: SOURCE_REVISION,
    mutationAuthority: true,
    effects: [],
  }));

  // Input completeness and rendering boundaries.
  record(codes, 'missing-evidence-claim', () => buildReadOnlyResultLineage({
    journey, expectation, metricContractBytes, evidenceClaim: null,
    explanation: explanationAuthored, effectStatus: null,
  }));
  record(codes, 'missing-independent-expectation', () => buildReadOnlyResultLineage({
    journey, expectation: {}, metricContractBytes, evidenceClaim: claim(),
    explanation: explanationAuthored, effectStatus: null,
  }));
  record(codes, 'render-format', () => renderResultLineage(
    buildReadOnlyResultLineage(input({})), 'XML',
  ));
  record(codes, 'lineage-substitution', () => {
    const built = buildReadOnlyResultLineage(input({}));
    return verifyReadOnlyResultLineage({ ...input({}), lineage: { ...built, lineageId: 'tampered' } });
  });

  return { entryPoint: 'run-result-lineage-journey', mode: 'negative', codes };
}

// ---------------------------------------------------------------------------------
// Caller path.
// ---------------------------------------------------------------------------------
if (args.includes('--negative')) {
  process.stdout.write(`${JSON.stringify(await runNegative(), null, 2)}\n`);
} else {
  if (!RESULT_LINEAGE_FORMATS.includes(formatOption)) {
    process.stdout.write(`${JSON.stringify({
      entryPoint: 'run-result-lineage-journey',
      cliDenial: { code: 'KS247_CLI_FORMAT_DENIED', message: '--format must be JSON, TABLE or HTML' },
    }, null, 2)}\n`);
    process.exit(0);
  }
  const proposal = proposalFor(answersFrom(answersPath));
  const summary = {
    entryPoint: 'run-result-lineage-journey',
    mode: answersPath === null ? 'eof' : 'answers',
    format: formatOption,
    expectationPath,
    explanationPath,
    effectStatusPath,
    evidenceClaimPath,
    authority: AUTHORITY,
    // The PAN452 read-purpose binding is separately owned and NOT accepted; this CLI neither
    // designs, stubs nor duplicates its handles.
    sharedReadPurposeBinding: 'NOT_INTEGRATED',
    ac05: 'PARENT_OWNED_OPEN',
  };
  if (proposal.metricCandidate.status !== 'CONFIRMED') {
    summary.lineage = null;
    summary.executed = false;
    summary.note = 'The proposal is not caller-confirmed, so nothing is read and no lineage is built.';
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    try {
      const callerKindDecisionBytes = kindDecisionsPath === null ? undefined : readFileSync(kindDecisionsPath);
      const callerBusinessSemanticBytes = businessSemanticsPath === null ? undefined : readFileSync(businessSemanticsPath);
      // Refuses BEFORE makeDatabase(): a missing caller input must not create, seed or read
      // any database.
      requireJourneyCallerBindings({
        kindDecisionBytes: callerKindDecisionBytes,
        businessSemanticBytes: callerBusinessSemanticBytes,
        sourceRevision: sourceRevisionOption,
      });
      const journey = await runUnfamiliarMetricJourney({
        proposal,
        sourceBytes,
        kindDecisionBytes: callerKindDecisionBytes,
        businessSemanticBytes: callerBusinessSemanticBytes,
        metricContractBytes,
        oracleBytes,
        database: await makeDatabase(),
        sourceRevision: sourceRevisionOption,
        authority: AUTHORITY,
        ...(goalOption === null ? {} : { semanticGoal: goalOption }),
      });
      const rendered = renderLineage(lineageInput(journey), formatOption);
      process.stdout.write(rendered.text);
      if (formatOption !== 'JSON') {
        // The machine receipt accompanies a human rendering so the same run stays checkable.
        process.stdout.write(`${JSON.stringify({
          entryPoint: summary.entryPoint,
          format: formatOption,
          lineageSha256: rendered.lineage.lineageSha256,
          sourceMode: journey.sourceMode,
          observationKind: rendered.lineage.observationKind,
          verifiedNumberCount: rendered.lineage.verification.verifiedNumberCount,
          unavailableFactCount: rendered.lineage.verification.unavailableFactCount,
          explanationCount: rendered.lineage.verification.explanationCount,
          completion: rendered.lineage.sections.completion.state,
          complete: rendered.lineage.sections.completion.complete,
          effectJournal: rendered.lineage.verification.effectJournal,
          expectedNumberCount: rendered.lineage.verification.expectedNumberCount,
          sharedReadPurposeBinding: 'NOT_INTEGRATED',
        }, null, 2)}\n`);
      }
    } catch (error) {
      summary.journeyDenial = PRE_DATABASE_DENIALS.has(error?.code)
        ? { kind: 'journey', ...denial('journey', error) }
        : denial('journey', error);
      summary.lineage = null;
      summary.executed = false;
      summary.note = PRE_DATABASE_DENIALS.has(error?.code)
        ? 'A required caller input is missing; the journey refused before creating, seeding or reading any database.'
        : 'The read or the lineage refused; no number is presented as verified.';
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
  }
}
