#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  validateFixtureContract,
  validatePlanText,
} from './validate-synthetic-connector-spike-plan.mjs';

export const RECEIPT_SCHEMA = 'kaleidosphere/synthetic-connector-spike-dry-run-receipt/v1';
export const OUTCOME = 'SIMULATED_SUCCESS';
export const NO_GO = 'NO_GO';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, '..');
const PLAN_PATH = resolve(REPOSITORY_ROOT, 'docs/future/remote-connector/SYNTHETIC_SPIKE_PLAN.md');
const MAX_REQUESTS = 20;
const MAX_RECORDS_PER_REQUEST = 100;
const MAX_RETRIES = 1;
const PROHIBITED_INPUTS = new Map([
  ['network', 'NEG-02'],
  ['public-bind', 'NEG-02'],
  ['hosted-endpoint', 'NEG-02'],
  ['credentials', 'NEG-01'],
  ['customer-payload', 'NEG-03'],
  ['mutation', 'NEG-04'],
  ['unbounded-retry', 'NEG-05'],
]);

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function noGo(reasonCodes, detail) {
  return {
    schemaVersion: RECEIPT_SCHEMA,
    classification: 'LOCAL_DRY_RUN',
    simulated: false,
    connectorExecuted: false,
    mcpExecuted: false,
    networkAccessed: false,
    spikeAuthorized: false,
    outcome: NO_GO,
    reasonCodes,
    detail,
    simulatedActionReceipt: null,
  };
}

function parseBooleanFlag(value, flag) {
  if (value === undefined) return true;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${flag} expects true or false`);
}

export function parseArgs(argv) {
  const options = {
    fixturePath: null,
    simulate: false,
    authorizationEvidence: false,
    predecessorEvidence: undefined,
    prohibitedInputs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--fixture') {
      options.fixturePath = argv[++index] ?? null;
      continue;
    }
    if (argument === '--simulate') {
      options.simulate = true;
      options.authorizationEvidence = true;
      continue;
    }
    if (argument === '--no-authorization') {
      options.authorizationEvidence = false;
      continue;
    }
    if (argument === '--no-predecessor-evidence') {
      options.predecessorEvidence = false;
      continue;
    }
    if (argument === '--predecessor-evidence') {
      options.predecessorEvidence = parseBooleanFlag(argv[index + 1], argument);
      if (argv[index + 1] === 'true' || argv[index + 1] === 'false') index += 1;
      continue;
    }
    if (argument.startsWith('--')) {
      const input = argument.slice(2);
      if (PROHIBITED_INPUTS.has(input)) {
        options.prohibitedInputs.push(input);
        continue;
      }
      throw new Error(`unsupported input: ${argument}`);
    }
    throw new Error(`unexpected positional input: ${argument}`);
  }
  return options;
}

function findFailedIds(report) {
  return report.findings.filter(({ status }) => status === 'FAIL').map(({ id }) => id);
}

function assertLocalFixturePath(fixturePath) {
  if (!fixturePath || fixturePath.startsWith('http:') || fixturePath.startsWith('https:') || fixturePath.startsWith('file:')) {
    return false;
  }
  return true;
}

function buildPreflight(planReport, fixtureReport, predecessorEvidence) {
  const predecessorPass = predecessorEvidence === undefined
    ? planReport.outcome === 'VALIDATED' && fixtureReport.outcome === 'VALIDATED'
    : predecessorEvidence === true;
  return {
    status: 'NO-GO',
    decision: 'NO_GO',
    gates: [
      { id: 'G-1', status: 'NOT_GRANTED', evidence: 'FRC.0-FRC.2 completion or scope-down evidence is absent' },
      { id: 'G-2', status: 'NOT_GRANTED', evidence: 'product authorization is absent' },
      { id: 'G-3', status: 'NOT_GRANTED', evidence: 'security authorization is absent' },
      { id: 'G-4', status: 'NOT_GRANTED', evidence: 'fixture validated internally; run eligibility is not granted' },
      { id: 'G-5', status: 'NOT_GRANTED', evidence: 'focused tests are internal validation, not authorization' },
      { id: 'G-6', status: 'NOT_GRANTED', evidence: 'this local receipt cannot authorize the run it describes' },
    ],
    decisionOwner: 'final issue #92 delivery owner',
    supersessionConditions: 'all six gates must be independently evidenced and bound to the then-current package by the final owner',
    callerAuthoredAuthorityAccepted: false,
    predecessorEvidence: {
      present: predecessorPass,
      source: 'validated plan and validated static fixture',
    },
    internalValidation: {
      plan: planReport.outcome,
      fixture: fixtureReport.outcome,
      authorizesSpike: false,
    },
  };
}

function fixtureSimulationShape(fixture) {
  const collections = fixture?.fixture?.collections;
  const catalog = Array.isArray(collections) ? collections.find(({ id }) => id === 'catalog') : null;
  const telemetry = Array.isArray(collections) ? collections.find(({ id }) => id === 'telemetry') : null;
  return Boolean(Array.isArray(collections) && catalog && telemetry
    && Array.isArray(catalog.records) && catalog.records.length > 0
    && Array.isArray(telemetry.records));
}

function simulateActions(fixture) {
  const collections = fixture.fixture.collections;
  const catalog = collections.find(({ id }) => id === 'catalog');
  const telemetry = collections.find(({ id }) => id === 'telemetry');
  const actions = [
    {
      name: 'enumerate_collections',
      request: {},
      response: collections.map(({ id, label, records }) => ({ id, label, recordCount: records.length })),
    },
    {
      name: 'count_records',
      request: { collectionId: telemetry.id },
      response: telemetry.records.length,
    },
    {
      name: 'read_record',
      request: { collectionId: catalog.id, recordId: catalog.records[0].id },
      response: catalog.records[0],
    },
  ];
  return actions.map((action, position) => ({
    sequence: position + 1,
    action: action.name,
    request: action.request,
    response: action.response,
    mutates: false,
    external: false,
  }));
}

export async function runDryRun(options) {
  const {
    fixturePath,
    simulate = false,
    authorizationEvidence = false,
    predecessorEvidence,
    prohibitedInputs = [],
  } = options ?? {};

  if (!simulate) return noGo(['AUTH-DRY-RUN'], 'explicit --simulate is required; this harness never runs a spike');
  if (!authorizationEvidence) return noGo(['AUTH-ABSENT'], 'local simulation authorization evidence is absent');
  if (prohibitedInputs.length > 0) {
    const reasonCodes = [...new Set(prohibitedInputs.map((input) => PROHIBITED_INPUTS.get(input) ?? 'NEG-INPUT'))];
    return noGo(reasonCodes, `prohibited input rejected before simulation: ${prohibitedInputs.join(', ')}`);
  }
  if (!assertLocalFixturePath(fixturePath)) return noGo(['NEG-LOCAL-ONLY'], 'fixture must be a local path');

  let planText;
  let fixtureText;
  let fixture;
  try {
    [planText, fixtureText] = await Promise.all([
      readFile(PLAN_PATH, 'utf8'),
      readFile(resolve(process.cwd(), fixturePath), 'utf8'),
    ]);
    fixture = JSON.parse(fixtureText);
  } catch (error) {
    return noGo(['FIXTURE-INPUT'], `unable to read or parse local plan/fixture: ${error.message}`);
  }

  const planReport = validatePlanText(planText);
  const fixtureReport = validateFixtureContract(fixture);
  const preflight = buildPreflight(planReport, fixtureReport, predecessorEvidence);
  if (planReport.outcome !== 'VALIDATED' || fixtureReport.outcome !== 'VALIDATED' || preflight.predecessorEvidence.present !== true) {
    return noGo(
      [...new Set(['PREFLIGHT-NO-GO', ...findFailedIds(planReport), ...findFailedIds(fixtureReport)])],
      'internal plan/fixture evidence is incomplete or failed; no simulated action was created',
    );
  }
  if (!fixtureSimulationShape(fixture)) {
    return noGo(['FIXTURE-SIMULATION-SHAPE'], 'validated fixture lacks catalog, telemetry, or the first catalog record required by the finite local simulation');
  }

  const collectionsDigest = sha256(stableJson(fixture.fixture.collections));
  const actions = simulateActions(fixture);
  const recordsRead = actions.filter(({ action }) => action === 'read_record').length;
  const requestCount = actions.length;
  const readbackDigest = sha256(stableJson(fixture.fixture.collections));
  const cleanup = {
    status: 'PASS',
    isolatedResourcesCreated: [],
    deletedPaths: [],
    filesystemRestored: true,
    evidence: 'simulation-only: no connector, MCP service, process, listener, or temporary resource was created',
  };

  return {
    schemaVersion: RECEIPT_SCHEMA,
    classification: 'LOCAL_DRY_RUN',
    simulated: true,
    connectorExecuted: false,
    mcpExecuted: false,
    networkAccessed: false,
    spikeAuthorized: false,
    outcome: OUTCOME,
    preflight,
    boundedReadOnly: {
      actionSet: ['enumerate_collections', 'read_record', 'count_records'],
      requestBudget: { limit: MAX_REQUESTS, used: requestCount, remaining: MAX_REQUESTS - requestCount },
      recordBudget: { perRequestLimit: MAX_RECORDS_PER_REQUEST, used: recordsRead },
      retryBudget: { limit: MAX_RETRIES, used: 0 },
      timeoutSeconds: 30,
      sessionLimitSeconds: 600,
      mutationCount: 0,
    },
    simulatedActions: actions,
    stop: { status: 'NOT_TRIGGERED', trigger: null },
    cleanup,
    readback: {
      source: 'local static fixture only',
      fixtureId: fixture.fixtureId,
      manifestSha256: fixture.manifest.sha256,
      computedCollectionsSha256: collectionsDigest,
      readbackSha256: readbackDigest,
      manifestMatch: fixture.manifest.sha256 === collectionsDigest,
      byteIdentical: collectionsDigest === readbackDigest,
      recordsRead,
    },
    receiptIntegrity: {
      finite: true,
      sealedLocally: true,
      externalEvidence: false,
      fixtureBytesSha256: sha256(fixtureText),
    },
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stdout.write(`${JSON.stringify(noGo(['INPUT-ARGS'], error.message), null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  const result = await runDryRun(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.outcome !== OUTCOME) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

export { stableJson };
