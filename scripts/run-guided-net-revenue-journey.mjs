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

import {
  runGuidedSession,
  createListAnswerSource,
  guidedSessionDigest,
  GUIDED_STEPS,
  GUIDED_PROMPTS,
} from '../services/bi-control/src/business-bi/net-revenue-guided-session.mjs';
import { ADMITTED_SOURCES } from '../services/bi-control/src/business-bi/net-revenue-guided-decisions.mjs';
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

try {
  const { values } = parseArgs({
    options: {
      answers: { type: 'string' },
      pglite: { type: 'string' },
      format: { type: 'string', default: 'JSON' },
      confirm: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.format !== 'JSON') throw new Error('GUIDED_CLI_FORMAT_DENIED: only --format JSON');

  const lines = await readAnswerLines(values.answers);

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

  // The confirmation callback. It is only reached AFTER the decision was admitted and the
  // parameters resolved, and it is the second real user input of the session: stdin lines
  // are the answers, `--confirm` is the authorization. Without it the session stops at
  // READY having read nothing.
  const confirm = () => values.confirm === true;

  const session = await runGuidedSession({
    answerSource: createListAnswerSource(lines),
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

  process.stdout.write(`${canonicalJson(outJson)}\n`);
  if (values.out) {
    const resolved = await assertAllowedOutputPath(values.out);
    await writeAtPathNoFollow(resolved, `${canonicalJson(outJson)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.code ?? error.message}\n`);
  process.exitCode = 1;
}
