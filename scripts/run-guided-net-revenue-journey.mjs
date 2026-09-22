#!/usr/bin/env node
// KaleidoSphere #236 — the GUIDED local user journey CLI.
//
//   node scripts/run-guided-net-revenue-journey.mjs [--answers <path>] [--format JSON]
//       [--pglite <dist/index.js path>] [--out <path>]
//
// What this adds over the released connected runner
// (`run-connected-net-revenue-journey.mjs`, which is UNCHANGED by this work):
//
//   * it asks the user the four bounded questions and reads the ANSWERS from a real
//     source — `--answers <path>` feeds the user's own lines, and stdin is read when no
//     path is given. Nothing is defaulted: an unread answer is ABSENT, and a session with
//     an unanswered step stops without reading any source;
//   * it shows what will run and requires an explicit `--confirm` before the first read;
//   * it dispatches the admitted source to its RELEASED owner (the #239 journey for the
//     admitted holdout relation, the #240 composition for the frozen ledger layouts) and
//     carries the released readback / TABLE / CHART / DETAILS through unmodified.
//
// Every refusal path exits 0 with `executed: false` and its own reason code, because
// "the user asked for something outside the admitted scope" is a legitimate outcome of a
// guided journey and must not be reported as a crash — nor as a success.
//
// No credentials, network, mutation or publish path. `--out` is confined exactly like the
// released #240/#239 CLIs: repository or /tmp, no symlink component, final open O_NOFOLLOW.

import { readFile, realpath, lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';

import {
  runGuidedSession,
  createListAnswerSource,
  guidedSessionDigest,
  confirmationSummary,
  GUIDED_STEPS,
  GUIDED_PROMPTS,
} from '../services/bi-control/src/business-bi/net-revenue-guided-session.mjs';
import { renderGuidedNetRevenueView } from '../services/bi-control/src/business-bi/net-revenue-guided-view.mjs';
import {
  ADMITTED_SOURCES,
  REJECTED_SOURCE_REQUESTS,
  SUPPORTED_QUESTION,
  SUPPORTED_QUESTION_ID,
  SUPPORTED_PERIOD_SETS,
  SUPPORTED_UNIT_ID,
  NO_QUESTION_TOKEN,
  UNSUPPORTED_QUESTIONS,
} from '../services/bi-control/src/business-bi/net-revenue-guided-decisions.mjs';
import {
  buildPgliteJourneyDatabase,
  buildSyntheticJourneyDatabase,
} from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';
import { canonicalJson } from '../services/bi-control/src/canonical-json.js';

const root = path.resolve(import.meta.dirname, '..');
const METRIC = path.join(root, 'contracts/business-bi/v1/net-revenue.metric.json');
const ORACLE = path.join(root, 'tests/fixtures/business-bi/net-revenue-oracle-v1.json');
const HOLDOUT = path.join(root, 'tests/fixtures/business-bi/net-revenue-holdout-v1.json');
const F4_V1 = path.join(root, 'tests/fixtures/business-bi/net-revenue-f4-composition-v1.json');
const F4_V2 = path.join(root, 'tests/fixtures/business-bi/net-revenue-f4-composition-v2.json');

async function assertAllowedOutputPath(out) {
  const resolved = path.resolve(out);
  const prefixes = [root, '/tmp'];
  const matchedNorm = prefixes.map((p) => (p.endsWith(path.sep) ? p.slice(0, -1) : p))
    .find((norm) => resolved === norm || resolved.startsWith(`${norm}${path.sep}`));
  if (!matchedNorm) throw new Error('GUIDED_CLI_OUT_PATH_DENIED: --out must be inside the repository or /tmp');
  const realRoot = await realpath(matchedNorm)
    .then((rp) => (rp.endsWith(path.sep) ? rp.slice(0, -1) : rp)).catch(() => null);
  if (realRoot === null) throw new Error('GUIDED_CLI_OUT_PATH_DENIED: --out must be inside the repository or /tmp');
  const rel = resolved.slice(matchedNorm.length).split(path.sep).filter((c) => c !== '' && c !== '.');
  let walked = realRoot;
  for (const comp of rel) {
    const candidate = path.join(walked, comp);
    let st;
    try { st = await lstat(candidate); } catch { break; }
    if (st.isSymbolicLink()) throw new Error('GUIDED_CLI_OUT_PATH_DENIED: --out must not contain a symlink');
    walked = candidate;
  }
  return resolved;
}

async function writeAtPathNoFollow(resolved, payload) {
  const fd = await open(resolved, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
  try { await fd.writeFile(payload); } finally { await fd.close(); }
}

// Read the user's raw lines. A file supplied explicitly must exist — a missing `--answers`
// file is an operator error, not an unanswered question, and must not silently downgrade
// into "the user chose nothing".
async function readAnswerLines(answersPath) {
  if (answersPath) {
    const resolved = path.resolve(answersPath);
    let raw;
    try { raw = await readFile(resolved, 'utf8'); } catch {
      throw new Error('GUIDED_CLI_ANSWERS_DENIED: --answers file could not be read');
    }
    return raw.split('\n').map((l) => l.replace(/\r$/, ''));
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').split('\n').map((l) => l.replace(/\r$/, ''));
}

// ---------------------------------------------------------------------------------
// R1 correction (focused review, finding R1) — CLARIFY BEFORE CONSUMING.
//
// The previous CLI consumed all of stdin until EOF and only then printed anything, so a
// terminal user saw no options, no supported tokens, no period ranges and no explanation
// of the correction/missing-data behaviour before they had to guess all four answers. The
// clarification existed in the data (`GUIDED_PROMPTS`, `SUPPORTED_QUESTION`) but was never
// presented. This section presents it.
//
// Every prompt line and every explanation goes to STDERR, so the machine JSON receipt on
// STDOUT stays byte-clean for `--answers`/pipeline use. A human terminal shows the
// guidance; a piped consumer is unaffected.
//
// `--answers <path>` remains the explicitly MACHINE/NONINTERACTIVE channel and stays
// silent (the answers are already supplied; there is nothing to ask). A live terminal with
// no `--answers` is the guided human channel and gets the full clarification, printed
// BEFORE each answer is read.
// ---------------------------------------------------------------------------------
const CLARIFICATION = Object.freeze({
  question: (id) => {
    const q = SUPPORTED_QUESTION;
    return [
      '',
      `The one supported question (${SUPPORTED_QUESTION_ID}):`,
      `  ${q.text}`,
      `  measures      : ${q.measures}`,
      `  unit          : ${q.unit}`,
      `  periods       : ${q.periodSemantics}`,
      `  corrections   : ${q.correctionBehaviour}`,
      `  missing data  : ${q.missingDataBehaviour}`,
      '  explicitly NOT answered by this result:',
      ...q.explicitlyNotAnswered.map((line) => `    - ${line}`),
      '',
      'Answer with one of these tokens:',
      ...Object.keys(UNSUPPORTED_QUESTIONS).map(
        (key) => `  ${key.padEnd(32)} (rejected: ${UNSUPPORTED_QUESTIONS[key].rejectedBecause})`,
      ),
      `  ${id.padEnd(32)} (supported — the question above)`,
      `  ${NO_QUESTION_TOKEN.padEnd(32)} (decline; the run ends incompletely)`,
      '',
    ].join('\n');
  },
  source: (ids) => [
    '',
    'Admitted sources (a run reads exactly one of these):',
    ...ids.map((key) => `  ${key.padEnd(32)} ${ADMITTED_SOURCES[key].label} [${ADMITTED_SOURCES[key].relation}, ${ADMITTED_SOURCES[key].declaredArithmeticUnit}]`),
    'Not admitted (rejected, never read):',
    ...Object.keys(REJECTED_SOURCE_REQUESTS).map(
      (key) => `  ${key.padEnd(32)} ${REJECTED_SOURCE_REQUESTS[key].rejectedBecause}`,
    ),
    '',
  ].join('\n'),
  period: (ids) => [
    '',
    'Contract-declared period comparisons (periods are chosen from the contract, never authored):',
    ...ids.map((key) => `  ${key}`),
    '',
  ].join('\n'),
  unit: (ids) => [
    '',
    'Arithmetic unit for the numbers:',
    ...ids.map((key) => (key === SUPPORTED_UNIT_ID
      ? `  ${key.padEnd(32)} supported — integer EUR minor units (cents)`
      : `  ${key.padEnd(32)} rejected — the released metric is integer minor units`)),
    '',
  ].join('\n'),
});

function presentClarification(step, { questionId, sourceIds, periodIds, unitIds }) {
  const header = `\n=== Step ${GUIDED_STEPS.indexOf(step) + 1}/${GUIDED_STEPS.length}: ${GUIDED_PROMPTS[step].prompt}`;
  let body = '';
  if (step === 'question') body = CLARIFICATION.question(questionId);
  else if (step === 'source') body = CLARIFICATION.source(sourceIds);
  else if (step === 'period') body = CLARIFICATION.period(periodIds);
  else body = CLARIFICATION.unit(unitIds);
  process.stderr.write(`${header}\n${body}\n> `);
}

// The interactive answer source. It PRESENTS the step's clarification immediately before
// reading that step's line, which is exactly the ordering R1 requires: the user sees the
// closed options and the business meaning of the current decision before they answer it.
// An EOF here returns null, which the session records as ABSENT — never a default.
function createInteractiveAnswerSource({ questionId, sourceIds, periodIds, unitIds }) {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const iterator = rl[Symbol.asyncIterator]();
  let index = 0;
  return {
    kind: 'INTERACTIVE_TERMINAL',
    async read() {
      const step = GUIDED_STEPS[index];
      if (step === undefined) return null;
      index += 1;
      presentClarification(step, { questionId, sourceIds, periodIds, unitIds });
      const next = await iterator.next();
      if (next.done) { process.stderr.write('\n(no more input - this step is recorded as unanswered)\n'); rl.close(); return null; }
      // readline yields a string per line. Return it VERBATIM: the session's own
      // normalizeAnswer decides what "absent" and "declined" mean, and this reader adds
      // no default and no re-interpretation.
      return typeof next.value === 'string' ? next.value : null;
    },
  };
}

// The resolved-parameter preview shown to a human BEFORE the confirmation gate. It states
// the dataset, periods and unit one final time so a confirmation is a decision about
// stated parameters, not about a familiar-looking prompt.
function renderConfirmationSummary(summary) {
  const periods = Object.entries(summary.periods ?? {})
    .map(([key, p]) => `    ${key.padEnd(11)} ${p.label}  ${p.start} .. ${p.end}`)
    .join('\n');
  return [
    '',
    '=== Confirm what will run (nothing has been read yet)',
    `  dataset      : ${summary.sourceId}  [${summary.relation}]`,
    `  question     : ${summary.questionId}`,
    `  unit         : ${summary.unitId}  (${summary.currency.code}, ${summary.currency.minorUnitsPerMajorUnit} minor units per major unit)`,
    '  periods      :',
    periods,
    `  decisions    : ${summary.decisionsSha256}`,
    `  note         : ${summary.readerNote}`,
    '',
  ].join('\n');
}

// R1 correction: a real `--help`, so the bounded command is discoverable without reading
// the source. Previously `--help` exited 1 with ERR_PARSE_ARGS_UNKNOWN_OPTION.
export const GUIDED_CLI_HELP_TEXT = [
  'KaleidoSphere #236 — guided local net-revenue journey (SYNTHETIC LOCAL SOURCE ONLY)',
  '',
  '  node scripts/run-guided-net-revenue-journey.mjs [options]',
  '',
  'Two answer channels, never mixed:',
  '  (default)          INTERACTIVE - each step closed options and business meaning are',
  '                     printed to stderr BEFORE that answer is read from stdin.',
  '  --answers <path>   MACHINE/NONINTERACTIVE — one answer per line, in step order:',
  '                       question, source, period, unit',
  '                     Nothing is asked and nothing is defaulted; a missing or unreadable',
  '                     file is an error, not an unanswered question.',
  '',
  'Options:',
  '  --answers <path>   read the four answers from a file (noninteractive/machine mode)',
  '  --pglite <path>    absolute path to a PGlite dist/index.js; without it the journey runs',
  '                     on the labelled SYNTHETIC_FALLBACK store instead of a real engine',
  '  --confirm          authorize the single read. Without it the session stops at READY and',
  '                     reads nothing.',
  '  --format <FORMAT>  JSON (default, the machine receipt) | TABLE | HTML   (R2 correction)',
  '  --view <path>      write the practical dataset-bound view (TABLE or HTML per --format)',
  '  --out <path>       write the JSON receipt; confined to the repository or /tmp',
  '  --help             print this text and exit 0',
  '',
  'Exit status: 0 for a completed run AND for every in-scope refusal (an unsupported',
  'question is a legitimate guided outcome, not a crash); 1 for a malformed invocation.',
  '',
  'Questions (asked in this order, each with its closed options shown first):',
  ...GUIDED_STEPS.map((step) => `  ${step.padEnd(8)}  ${GUIDED_PROMPTS[step].prompt}`),
  '',
  'Answers:',
  `  question  ${SUPPORTED_QUESTION_ID}  (or ${NO_QUESTION_TOKEN} to decline)`,
  ...Object.keys(UNSUPPORTED_QUESTIONS).map((k) => `            ${k}  (rejected)`),
  ...Object.keys(ADMITTED_SOURCES).map((k) => `  source    ${k}  (admitted)`),
  ...Object.keys(REJECTED_SOURCE_REQUESTS).map((k) => `            ${k}  (rejected)`),
  ...SUPPORTED_PERIOD_SETS.map((k) => `  period    ${k}`),
  `  unit      ${SUPPORTED_UNIT_ID}  (EUR minor units; any other unit is rejected)`,
  '',
  'No credentials, network, mutation or publish path. No human-comprehension claim.',
  '',
].join('\n');

const VIEW_FORMATS = Object.freeze(['JSON', 'TABLE', 'HTML']);

// R1 correction: this module exports its help text so the CLI --help surface can be
// asserted directly, and it must therefore be importable WITHOUT running the journey.
// Importing it used to execute the whole interactive run as a side effect, so a test that
// imported it to read the help text blocked on stdin forever. Execution is now confined to
// the real CLI invocation.
const invokedAsCli = process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename;

if (invokedAsCli) {
  try {
    const { values } = parseArgs({
      options: {
        answers: { type: 'string' },
        pglite: { type: 'string' },
        format: { type: 'string', default: 'JSON' },
        view: { type: 'string' },
        confirm: { type: 'boolean', default: false },
        out: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: false,
      strict: true,
    });

    if (values.help) {
      process.stdout.write(GUIDED_CLI_HELP_TEXT);
      process.exit(0);
    }

    // R2 correction: JSON stays the machine receipt and the default, and TABLE/HTML are now
    // real, offered formats instead of a bare denial.
    if (!VIEW_FORMATS.includes(values.format)) {
      throw new Error('GUIDED_CLI_FORMAT_DENIED: --format must be JSON, TABLE or HTML');
    }
    if (values.view && values.format === 'JSON') {
      throw new Error('GUIDED_CLI_VIEW_DENIED: --view requires --format TABLE or --format HTML');
    }

    const [metricContractBytes, oracleBytes, holdoutBytes, f4v1, f4v2] = await Promise.all([
      readFile(METRIC), readFile(ORACLE), readFile(HOLDOUT), readFile(F4_V1), readFile(F4_V2),
    ]);

    let database;
    let sourceMode;
    if (values.pglite) {
      if (!path.isAbsolute(values.pglite)) throw new Error('GUIDED_CLI_PGLITE_PATH_DENIED: --pglite must be an absolute path');
      const { PGlite } = await import(pathToFileURL(values.pglite).href);
      database = buildPgliteJourneyDatabase(new PGlite());
      sourceMode = 'REAL_POSTGRESQL';
    } else {
      database = buildSyntheticJourneyDatabase();
      sourceMode = 'SYNTHETIC_FALLBACK';
    }

    // R1 correction: choose the answer channel explicitly. A live terminal presents each
    // step's clarification before reading that step; `--answers` is the silent machine
    // channel. The two are never mixed, and neither one defaults an answer.
    const interactive = !values.answers && process.stdin.isTTY === true;
    const lines = interactive ? null : await readAnswerLines(values.answers);
    const answerSource = interactive
      ? createInteractiveAnswerSource({
        questionId: SUPPORTED_QUESTION_ID,
        sourceIds: Object.keys(ADMITTED_SOURCES),
        periodIds: SUPPORTED_PERIOD_SETS,
        unitIds: [SUPPORTED_UNIT_ID, 'EUR_MAJOR_UNITS'],
      })
      : createListAnswerSource(lines ?? []);

    // The confirmation callback. It is only reached AFTER the decision was admitted and the
    // parameters resolved, and it is the second real user input of the session: the answers
    // are the first, `--confirm` is the authorization. Without it the session stops at READY
    // having read nothing. A live terminal additionally SEES the resolved parameters before
    // authorizing (R1).
    const confirm = (summary) => {
      if (!interactive) return values.confirm === true;
      process.stderr.write(renderConfirmationSummary(summary));
      return values.confirm === true;
    };

    const session = await runGuidedSession({
      answerSource,
      metricContractBytes,
      oracleBytes,
      holdoutBytes,
      f4Sources: {
        'ledger-v1': JSON.parse(f4v1.toString('utf8')),
        'ledger-v2': JSON.parse(f4v2.toString('utf8')),
      },
      database,
      confirm,
    });

    const result = session.result ?? null;
    const outJson = {
      schemaVersion: session.schemaVersion,
      sourceMode,
      sourceMarking: 'SYNTHETIC',
      stepOrder: session.stepOrder,
      prompts: session.stepOrder.map((s) => GUIDED_PROMPTS[s].prompt),
      asked: session.asked,
      rawAnswers: session.rawAnswers,
      phase: session.phase,
      stoppedBecause: session.stoppedBecause,
      decisions: session.decision
        ? {
          schemaVersion: session.decision.schemaVersion,
          admitted: session.decision.admitted,
          incomplete: session.decision.incomplete,
          question: session.decision.question,
          source: session.decision.source,
          period: session.decision.period,
          unit: session.decision.unit,
          mapping: session.decision.mapping,
          consistency: session.decision.consistency,
          decisionsSha256: session.decision.decisionsSha256,
        }
        : null,
      runParameters: session.runParameters,
      confirmed: session.confirmed,
      executed: session.executed,
      // The result is null unless the released owner actually ran. There is no partial
      // result object and no zero-filled placeholder.
      result,
      authority: session.authority,
      writesPerformed: session.writesPerformed,
      sessionDigest: guidedSessionDigest(session),
    };

    // R2 correction: JSON, TABLE and HTML are all real offered formats, and each one is a
    // VIEW OF ITS OWN. Before this, the JSON receipt was written unconditionally, so
    // `--format TABLE` printed the 24 KB escaped-JSON receipt with the table appended — the
    // user still could not just look at the result. The chosen format now selects what goes
    // to stdout. A refused run renders no view at all: an empty table would be a fabricated
    // fact, so the receipt is emitted instead and the view path is refused explicitly.
    const receiptText = `${canonicalJson(outJson)}\n`;
    if (values.format === 'JSON') {
      process.stdout.write(receiptText);
    } else {
      const viewText = renderGuidedNetRevenueView(session, values.format);
      if (values.view) {
        const viewPath = await assertAllowedOutputPath(values.view);
        await writeAtPathNoFollow(viewPath, viewText);
        // The view went to the file the user asked for; stdout keeps the machine receipt so a
        // pipeline still gets canonical JSON.
        process.stdout.write(receiptText);
      } else {
        process.stdout.write(viewText);
      }
    }

    if (values.out) {
      const resolved = await assertAllowedOutputPath(values.out);
      await writeAtPathNoFollow(resolved, `${canonicalJson(outJson)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.code ?? error.message}\n`);
    process.exitCode = 1;
  }
}
