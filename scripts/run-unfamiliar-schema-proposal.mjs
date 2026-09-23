// KS246 — bounded local CLI for the unfamiliar-schema proposal/clarification slice.
//
// This is a LOCAL-ONLY entry point.  It reads the frozen synthetic unfamiliar-schema
// fixture, drives the clarification questions through either no answer source (EOF) or a
// caller-supplied line file, and prints the reviewable candidate as JSON.  It writes no
// public state, opens no socket, sends no SQL, and grants no execution authority.
//
//   node scripts/run-unfamiliar-schema-proposal.mjs
//       EOF run: every question is ABSENT, the candidate stays PROPOSED.
//   node scripts/run-unfamiliar-schema-proposal.mjs --answers <file>
//       one line per question, in the printed interview order; 'none' refuses a question.
//   node scripts/run-unfamiliar-schema-proposal.mjs --answers <file> --handoff
//       additionally build the AC03 local handoff (refused unless the candidate is CONFIRMED).
//   node scripts/run-unfamiliar-schema-proposal.mjs --negative
//       execute the bounded negative gates and print their exact codes.

import { readFileSync } from 'node:fs';

import {
  buildMetricHandoff,
  createListAnswerSource,
  loadAggregateProfile,
  loadUnfamiliarMetadata,
  runUnfamiliarSchemaProposalEntryPoint,
} from '../services/bi-control/src/business-bi/unfamiliar-schema-proposal.mjs';

const FIXTURE_DIR = 'tests/fixtures/business-bi/ks246-unfamiliar-schema';
const METADATA_PATH = `${FIXTURE_DIR}/metadata-v1.json`;
const AGGREGATE_PATH = `${FIXTURE_DIR}/aggregate-profile-v1.json`;
const CONTRACT_PATH = 'contracts/business-bi/v1/net-revenue.metric.json';

const args = process.argv.slice(2);
const answersIndex = args.indexOf('--answers');
const answersPath = answersIndex === -1 ? null : args[answersIndex + 1];

const metadataBytes = readFileSync(METADATA_PATH);
const aggregateBytes = readFileSync(AGGREGATE_PATH);

if (args.includes('--negative')) {
  const codes = [];
  const record = (label, run) => {
    try { run(); codes.push(`${label}=UNEXPECTEDLY_ACCEPTED`); }
    catch (error) { codes.push(`${label}=${error.code}`); }
  };
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  record('rows', () => loadUnfamiliarMetadata({ ...metadata, rows: [] }));
  record('sql', () => loadUnfamiliarMetadata({ ...metadata, sql: 'select 1' }));
  record('credentials', () => loadUnfamiliarMetadata({ ...metadata, credentials: {} }));
  record('classification', () => loadUnfamiliarMetadata({ ...metadata, classification: 'PRODUCTION_CUSTOMER_BYTES' }));
  record('access-mode', () => loadUnfamiliarMetadata({ ...metadata, accessMode: 'FULL_ROW_ACCESS' }));
  record('surface', () => loadUnfamiliarMetadata({ ...metadata, extra: 1 }));
  const aggregates = JSON.parse(aggregateBytes.toString('utf8'));
  record('aggregate-rows', () => loadAggregateProfile({ ...aggregates, rows: [] }));
  const eof = runUnfamiliarSchemaProposalEntryPoint({ metadataBytes, aggregateBytes });
  record('eof-handoff', () => buildMetricHandoff({ proposal: eof, metricContractBytes: readFileSync(CONTRACT_PATH) }));
  process.stdout.write(`${JSON.stringify({ entryPoint: 'run-unfamiliar-schema-proposal', mode: 'negative', codes }, null, 2)}\n`);
} else {
  const answerSource = answersPath === null
    ? undefined
    : createListAnswerSource(readFileSync(answersPath, 'utf8').split('\n'));
  const result = runUnfamiliarSchemaProposalEntryPoint({ metadataBytes, aggregateBytes, answerSource });
  const summary = {
    entryPoint: 'run-unfamiliar-schema-proposal',
    mode: answersPath === null ? 'eof' : 'answers',
    sourceRevision: result.source.sourceRevision,
    observedRelations: result.observed.relations.length,
    ambiguityByKind: result.computed.ambiguities.byKind,
    // F1 — the clarification conversation is exposed as the ACTUAL question text, its closed
    // answer domain, the subject/evidence it is owed by and its stable interview order, so a
    // caller can answer positionally without inspecting the module source.
    questions: result.questions.map((question, index) => ({
      index,
      questionId: question.questionId,
      kind: question.kind,
      code: question.code,
      blocking: question.blocking,
      subject: question.subject,
      text: question.text,
      answerDomain: question.answerDomain,
      evidenceRefs: question.evidenceRefs,
      questionSha256: question.questionSha256,
    })),
    clarification: {
      confirmedCount: result.clarification.confirmedCount,
      absentCount: result.clarification.absentCount,
      refusedCount: result.clarification.refusedCount,
      rejectedCount: result.clarification.rejectedCount,
      blockingConfirmed: result.clarification.blockingConfirmed,
    },
    metricCandidate: {
      status: result.metricCandidate.status,
      grain: result.metricCandidate.grain.selected,
      unitScale: result.metricCandidate.units.selected,
      amountColumn: result.metricCandidate.units.amountColumn,
      periodColumn: result.metricCandidate.period.selected,
      currency: result.metricCandidate.currency.selected,
      recordKindMapping: result.metricCandidate.recordKind.mapping,
      creditValue: result.metricCandidate.recordKind.creditValue,
      cancelValue: result.metricCandidate.recordKind.cancelValue,
      absenceDeclarations: result.metricCandidate.recordKind.absenceDeclarations,
      coherent: result.metricCandidate.coherent,
      inconsistencyKinds: result.metricCandidate.inconsistencies.map(({ kind }) => kind),
      unresolvedMeaningCount: result.metricCandidate.unresolvedMeaning.length,
    },
    reviewState: result.reviewState,
    executionAuthority: result.executionAuthority,
    carriesResult: result.carriesResult,
    entryPointSha256: result.entryPointSha256,
  };
  if (args.includes('--handoff')) {
    // A denied handoff is REPORTED (exit 0, like the --negative gates) rather than crashing the
    // CLI: the denial code is the evidence, and the candidate stays non-confirmed.
    try {
      const handoff = buildMetricHandoff({ proposal: result, metricContractBytes: readFileSync(CONTRACT_PATH) });
      summary.handoff = {
        ownerEntryPoint: handoff.ownerEntryPoint,
        releasedRoleVocabulary: handoff.releasedRoleVocabulary,
        releasedKindVocabulary: handoff.releasedKindVocabulary,
        canonicalRowBinding: handoff.canonicalRowBinding,
        identity: handoff.identity,
        authority: handoff.authority,
        handoffSha256: handoff.handoffSha256,
      };
    } catch (error) {
      summary.handoff = null;
      summary.handoffDenial = { code: error.code ?? null, message: error.message };
    }
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
