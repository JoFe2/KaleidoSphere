#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const VALIDATION_SCHEMA = 'kaleidosphere/synthetic-connector-spike-validation/v1';
export const FIXTURE_SCHEMA = 'kaleidosphere/remote-connector-synthetic-fixture/v1';

const PLAN_SECTIONS = [
  ['PLAN-START', 'Start criteria'],
  ['PLAN-STOP', 'Stop criteria (immediate)'],
  ['PLAN-ROLLBACK', 'Cleanup and rollback'],
  ['PLAN-SUCCESS', 'Success criteria'],
  ['PLAN-FIXTURE', 'Allowed synthetic data'],
  ['PLAN-ISOLATION', 'Isolation boundary'],
  ['PLAN-BOUNDS', 'Bounded execution'],
];

const PLAN_CONTENT = [
  ['PLAN-FAIL-CLOSED', 'preflight evidence fails closed', 'The gates fail closed: any missing, stale, or ambiguous evidence is NO-GO and must not initiate a run'],
  ['PLAN-FIXTURE-LOCAL', 'fixture is local and provenance is recorded', 'A locally present fixture satisfying the Allowed synthetic data section, with recorded provenance and manifest hash'],
  ['PLAN-ISOLATION-LOCAL', 'network is localhost-only or disabled', 'Network: localhost only, or disabled. There is no public bind and no hosted endpoint (NEG-02)'],
  ['PLAN-ISOLATION-DIRECTORY', 'execution is isolated to a disposable directory', 'The spike process and any local helper run inside one disposable execution directory'],
  ['PLAN-BOUND-TIMEOUT', 'per-command timeout is bounded', 'Per-command timeout: 30 seconds'],
  ['PLAN-BOUND-SESSION', 'total session is bounded', 'Total spike session: 10 minutes'],
  ['PLAN-BOUND-REQUESTS', 'request budget is bounded', 'Request budget: at most 20 synthetic requests per run, at most 50 requests for the whole spike'],
  ['PLAN-BOUND-RECORDS', 'record budget is bounded', 'Record budget: at most 100 records read per request; the whole fixture is at most 500 records'],
  ['PLAN-BOUND-RETRIES', 'retry budget is bounded and boundary failures are not retried', 'Retries: at most 1 retry for a local read failure. Zero retries for any boundary, authorization, budget, or fixture-provenance failure'],
  ['PLAN-BOUND-ACTIONS', 'only read-only synthetic actions are allowed', 'read-only synthetic actions only — enumerate collections, read a record, count records'],
  ['PLAN-START-AUTHORIZED', 'only an explicitly authorized actor starts a run', 'An authorized actor (per G-2 and G-3) explicitly starts the run. No timer, script, CI step, or automated follow-on may start it'],
  ['PLAN-CLEANUP-EVIDENCE', 'cleanup evidence is mandatory', 'Cleanup evidence is mandatory for success, not optional documentation'],
  ['PLAN-TERMINAL-OUTCOMES', 'terminal outcomes are explicit', 'The terminal outcome of this artifact is exactly one of'],
  ['PLAN-NONCLAIM', 'the artifact grants no authority', 'This artifact does not claim that a spike was authorized, started, or executed, and it grants no authority'],
  ['NEG-01', 'live credentials fail closed', 'NEG-01: any live credential requirement (provider token, real database credential, personal or service secret) is NO-GO'],
  ['NEG-02', 'public or hosted endpoints fail closed', 'NEG-02: any public bind or hosted endpoint in the plan is NO-GO'],
  ['NEG-03', 'customer data or provider payloads fail closed', 'NEG-03: any customer data or provider payload in the fixture or plan is NO-GO'],
  ['NEG-04', 'mutation-capable actions fail closed', 'NEG-04: any mutation-capable connector action in the planned surface is NO-GO'],
  ['NEG-05', 'open-ended retries fail closed', 'NEG-05: any open-ended or blind retry loop is NO-GO'],
];

const EXPECTED_PROHIBITED_ACTIONS = ['create', 'update', 'delete', 'grant', 'deploy', 'publish', 'send'];
const EXPECTED_LABELS = ['Atlas', 'Beacon', 'Cinder', 'Delta', 'Echo', 'Fable', 'amber', 'blue', 'green', 'ready', 'review', 'paused'];
const EXPECTED_ACTIONS = new Map([
  ['enumerate_collections', { input: {}, output: 'collection summaries' }],
  ['read_record', { input: { collectionId: 'known collection id', recordId: 'known synthetic record id' }, output: 'one declared synthetic record' }],
  ['count_records', { input: { collectionId: 'known collection id' }, output: 'bounded record count' }],
]);
const LIMIT_KEYS = ['maxCollections', 'maxRecordsPerCollection', 'maxRecordsTotal', 'maxFieldsPerRecord', 'maxFieldBytes'];
const EXPECTED_MANIFEST_CANONICALIZATION = 'UTF-8 JSON with sorted object keys and no insignificant whitespace';

function normalize(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

function hasHeading(text, heading) {
  return new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(text);
}

function finding(id, requirement, passed, detail) {
  return passed
    ? { id, requirement, status: 'PASS' }
    : { id, requirement, status: 'FAIL', detail };
}

function hasUnsafeLine(text, pattern) {
  return text.split('\n').some((line) => pattern.test(line)
    && !/\b(?:no|not|never|prohibited|fails closed|NO-GO|only read-only)\b/i.test(line));
}

function report(findings, details = {}) {
  const failed = findings.filter(({ status }) => status === 'FAIL');
  return {
    ...details,
    outcome: failed.length === 0 ? 'VALIDATED' : 'REJECTED_WITH_EVIDENCE',
    valid: failed.length === 0,
    checkCount: findings.length,
    failedCount: failed.length,
    findings,
  };
}

export function validatePlanText(planText) {
  if (typeof planText !== 'string') {
    return report([finding('PLAN-INPUT', 'plan is UTF-8 text', false, 'plan input is not a string')], {
      artifactType: 'synthetic-spike-plan',
    });
  }

  const flat = normalize(planText);
  const findings = [];
  for (const [id, title] of PLAN_SECTIONS) {
    findings.push(finding(id, `section present: ## ${title}`, hasHeading(planText, title), `missing section: ## ${title}`));
  }
  for (const [id, requirement, needle] of PLAN_CONTENT) {
    findings.push(finding(id, requirement, flat.includes(normalize(needle)), `missing required fail-closed contract text: ${needle}`));
  }
  const unsafePlanPatterns = [
    ['DENY-01', 'affirmative live credential use', /(?:\b(?:requires?|uses?|accepts?|inject(?:s|ed)?|suppl(?:y|ies|ied)|provides?)\s+(?:any\s+)?(?:live credentials?|provider tokens?|real database credentials?|personal or service secrets?)\b|\b(?:live credentials?|provider tokens?|real database credentials?|personal or service secrets?)\s+(?:are|is)\s+(?:required|used|permitted|accepted)\b)/i],
    ['DENY-02', 'affirmative public or hosted endpoint use', /\b(?:public|hosted)\s+(?:bind|endpoint)\b.{0,100}\b(?:required|permitted|enabled|used|allowed|exposed)\b/i],
    ['DENY-03', 'affirmative customer data or provider payload use', /\b(?:customer data|provider payloads?)\b.{0,100}\b(?:required|permitted|used|allowed|included|accepted)\b/i],
    ['DENY-04', 'affirmative mutation-capable action use', /\bmutation-capable\s+(?:connector\s+)?actions?\b.{0,100}\b(?:required|permitted|used|allowed|enabled)\b/i],
    ['DENY-05', 'affirmative open-ended retry use', /\b(?:open-ended|blind|unbounded)\s+retry(?:\s+loop)?\b.{0,100}\b(?:required|permitted|used|allowed|enabled)\b|\bretry\s+(?:until|forever|indefinitely|without\s+(?:a\s+)?limit)\b/i],
  ];
  for (const [id, requirement, pattern] of unsafePlanPatterns) {
    findings.push(finding(id, `${requirement} is rejected`, !hasUnsafeLine(planText, pattern), 'affirmative unsafe plan clause detected'));
  }

  return report(findings, { artifactType: 'synthetic-spike-plan' });
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function keysAre(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function typeMatches(value, type) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  return false;
}

export function validateFixtureContract(fixture) {
  const findings = [];
  const check = (id, requirement, passed, detail) => findings.push(finding(id, requirement, passed, detail));
  const object = fixture !== null && typeof fixture === 'object' && !Array.isArray(fixture);

  check('FIX-INPUT', 'fixture is a JSON object', object, 'fixture is not a JSON object');
  if (!object) return report(findings, { artifactType: 'synthetic-connector-fixture' });

  check('FIX-SCHEMA', `schemaVersion is ${FIXTURE_SCHEMA}`, fixture.schemaVersion === FIXTURE_SCHEMA, 'unsupported fixture schema');
  check('FIX-ID', 'fixtureId is synthetic-connector-fixture-v1', fixture.fixtureId === 'synthetic-connector-fixture-v1', 'unexpected fixture id');
  check('FIX-CLASSIFICATION', 'fixture is explicitly future-spike-only and non-production', typeof fixture.classification === 'string'
    && /future-spike-only/i.test(fixture.classification) && /not production evidence/i.test(fixture.classification), 'missing non-production classification');
  check('FIX-TOP-LEVEL-CLOSED', 'fixture top-level shape is closed', keysAre(fixture, ['schemaVersion', 'fixtureId', 'classification', 'contract', 'fixture', 'provenance', 'manifest']), 'unexpected or missing top-level fixture keys');

  const contract = fixture.contract;
  const contractObject = contract !== null && typeof contract === 'object' && !Array.isArray(contract);
  check('CONTRACT-SHAPE', 'connector contract shape is closed', contractObject && keysAre(contract, ['purpose', 'transport', 'network', 'publicEndpointRequired', 'hostedEndpointRequired', 'externalNetworkRequired', 'customerDataRequired', 'credentialsRequired', 'actions', 'prohibitedActions', 'limits']), 'missing or extra connector contract fields');
  if (!contractObject) return report(findings, { artifactType: 'synthetic-connector-fixture' });

  check('CONTRACT-TRANSPORT', 'transport is file-only and network is disabled', contract.transport === 'file-only' && contract.network === 'disabled', 'fixture must not require a network transport');
  for (const [id, key] of [['CONTRACT-PUBLIC', 'publicEndpointRequired'], ['CONTRACT-HOSTED', 'hostedEndpointRequired'], ['CONTRACT-EXTERNAL', 'externalNetworkRequired'], ['CONTRACT-CUSTOMER', 'customerDataRequired'], ['CONTRACT-CREDENTIALS', 'credentialsRequired']]) {
    check(id, `${key} is false`, contract[key] === false, `${key} must fail closed to false`);
  }

  const limits = contract.limits;
  check('CONTRACT-LIMIT-SHAPE', 'contract limits shape is closed', limits !== null && typeof limits === 'object' && keysAre(limits, LIMIT_KEYS), 'missing or extra contract limits');
  if (limits !== null && typeof limits === 'object' && !Array.isArray(limits)) {
    const limitMaximums = { maxCollections: 10, maxRecordsPerCollection: 50, maxRecordsTotal: 500, maxFieldsPerRecord: 10, maxFieldBytes: 256 };
    for (const key of LIMIT_KEYS) check(`LIMIT-${key}`, `${key} is a positive bounded integer no greater than ${limitMaximums[key]}`, Number.isInteger(limits[key]) && limits[key] > 0 && limits[key] <= limitMaximums[key], `${key} exceeds the synthetic-only bound`);
  }

  check('CONTRACT-PROHIBITED-ACTIONS', 'prohibited actions include the complete mutation deny list', Array.isArray(contract.prohibitedActions)
    && JSON.stringify([...contract.prohibitedActions].sort()) === JSON.stringify([...EXPECTED_PROHIBITED_ACTIONS].sort()), 'mutation deny list is missing, altered, or expanded');
  check('CONTRACT-ACTIONS-SHAPE', 'actions are a closed read-only action set', Array.isArray(contract.actions) && contract.actions.length === EXPECTED_ACTIONS.size, 'unexpected action count');
  if (Array.isArray(contract.actions)) {
    const seen = new Set();
    for (const action of contract.actions) {
      const validObject = action !== null && typeof action === 'object' && !Array.isArray(action);
      const name = validObject ? action.name : undefined;
      const expected = EXPECTED_ACTIONS.get(name);
      check(`ACTION-${name ?? 'INVALID'}`, 'action is enumerated and read-only', validObject && !seen.has(name) && expected !== undefined
        && action.mutates === false && keysAre(action, ['name', 'mutates', 'input', 'output']), 'mutation-capable, duplicate, or unknown action');
      if (validObject && expected) {
        check(`ACTION-${name}-CONTRACT`, 'action input and output match the read-only contract', JSON.stringify(action.input) === JSON.stringify(expected.input) && action.output === expected.output, 'action contract changed');
      }
      if (name !== undefined) seen.add(name);
    }
    check('ACTION-SET-CLOSED', 'all and only the three declared read-only actions are present', seen.size === EXPECTED_ACTIONS.size && [...EXPECTED_ACTIONS.keys()].every((name) => seen.has(name)), 'action set is not exactly the declared set');
  }

  const fixtureBody = fixture.fixture;
  const fixtureObject = fixtureBody !== null && typeof fixtureBody === 'object' && !Array.isArray(fixtureBody);
  check('DATA-SHAPE', 'fixture data has a closed collections shape', fixtureObject && keysAre(fixtureBody, ['collections']), 'missing or extra fixture data fields');
  const collections = fixtureObject && Array.isArray(fixtureBody.collections) ? fixtureBody.collections : null;
  check('DATA-COLLECTIONS', 'fixture has at least one and no more than maxCollections collections', collections !== null && collections.length > 0 && collections.length <= (limits?.maxCollections ?? 0), 'collection count is outside the bound');

  let totalRecords = 0;
  if (collections) {
    const collectionIds = new Set();
    for (const collection of collections) {
      const validCollection = collection !== null && typeof collection === 'object' && !Array.isArray(collection);
      const collectionId = validCollection ? collection.id : undefined;
      const collectionLabel = validCollection ? collection.label : undefined;
      const fields = validCollection && Array.isArray(collection.fields) ? collection.fields : null;
      const records = validCollection && Array.isArray(collection.records) ? collection.records : null;
      check(`COLLECTION-${collectionId ?? 'INVALID'}`, 'collection shape and id are synthetic and unique', validCollection && keysAre(collection, ['id', 'label', 'fields', 'records'])
        && typeof collectionId === 'string' && /^[a-z][a-z0-9-]*$/.test(collectionId) && !collectionIds.has(collectionId), 'invalid, duplicate, or environment-derived collection id');
      collectionIds.add(collectionId);
      check(`COLLECTION-${collectionId ?? 'INVALID'}-LABEL`, 'collection label is from the closed synthetic label set', typeof collectionLabel === 'string' && fixture.provenance?.closedLabelSet?.includes(collectionLabel), 'collection label is not an allowed synthetic label');
      check(`COLLECTION-${collectionId ?? 'INVALID'}-FIELDS`, 'collection fields are bounded and unique', fields !== null && fields.length > 0 && fields.length <= (limits?.maxFieldsPerRecord ?? 0), 'field count is outside the bound');
      check(`COLLECTION-${collectionId ?? 'INVALID'}-RECORDS`, 'collection records are bounded', records !== null && records.length <= (limits?.maxRecordsPerCollection ?? 0), 'record count is outside the bound');
      if (!fields || !records) continue;

      const fieldNames = new Set();
      for (const field of fields) {
        const validField = field !== null && typeof field === 'object' && !Array.isArray(field);
        check(`FIELD-${collectionId}-${field?.name ?? 'INVALID'}`, 'field declaration is closed, typed, required, and unique', validField && keysAre(field, ['name', 'type', 'required'])
          && typeof field.name === 'string' && /^[a-z][a-zA-Z0-9]*$/.test(field.name) && !fieldNames.has(field.name)
          && ['string', 'integer', 'boolean'].includes(field.type) && field.required === true, 'invalid, duplicate, or optional field declaration');
        fieldNames.add(field?.name);
      }
      for (const record of records) {
        totalRecords += 1;
        const validRecord = record !== null && typeof record === 'object' && !Array.isArray(record);
        const expectedNames = [...fieldNames];
        check(`RECORD-${collectionId}-${record?.id ?? 'INVALID'}`, 'record has exactly the declared fields and a synthetic id', validRecord && keysAre(record, expectedNames)
          && typeof record.id === 'string' && new RegExp(`^SYN-${collectionId}-\\d{3}$`).test(record.id), 'record shape or synthetic id is invalid');
        for (const field of fields) {
          const value = record?.[field.name];
          check(`VALUE-${collectionId}-${field.name}-${record?.id ?? 'INVALID'}`, 'record value matches its declared type and closed labels', typeMatches(value, field.type)
            && (field.name === 'id' || typeof value !== 'string' || fixture.provenance?.closedLabelSet?.includes(value)), 'record contains an untyped, prohibited, or non-synthetic value');
          check(`BYTES-${collectionId}-${field.name}-${record?.id ?? 'INVALID'}`, 'record field value is within the byte bound', value !== undefined && Buffer.byteLength(JSON.stringify(value), 'utf8') <= (limits?.maxFieldBytes ?? 0), 'field exceeds maxFieldBytes');
        }
      }
    }
    check('DATA-UNIQUE-COLLECTIONS', 'collection ids are unique', collectionIds.size === collections.length, 'duplicate collection id');
  }
  check('DATA-TOTAL-RECORDS', 'total records are within maxRecordsTotal', totalRecords <= (limits?.maxRecordsTotal ?? 0), 'total record count exceeds the bound');

  const provenance = fixture.provenance;
  const provenanceObject = provenance !== null && typeof provenance === 'object' && !Array.isArray(provenance);
  check('PROVENANCE-SHAPE', 'provenance shape is closed', provenanceObject && keysAre(provenance, ['sourceType', 'authoringBasis', 'sourceInputs', 'generatedFromCustomerData', 'copiedFromProviderPayload', 'environmentDerived', 'externalCallsDuringAuthoring', 'determinism', 'closedLabelSet']), 'missing or extra provenance fields');
  if (provenanceObject) {
    check('PROVENANCE-SYNTHETIC', 'provenance identifies hand-authored synthetic data', provenance.sourceType === 'HAND_AUTHORED_SYNTHETIC' && provenance.generatedFromCustomerData === false
      && provenance.copiedFromProviderPayload === false && provenance.environmentDerived === false && provenance.externalCallsDuringAuthoring === false && Array.isArray(provenance.sourceInputs) && provenance.sourceInputs.length === 0, 'customer/provider/environment provenance is prohibited');
    check('PROVENANCE-LABELS', 'closedLabelSet is the documented synthetic label set', Array.isArray(provenance.closedLabelSet)
      && JSON.stringify([...provenance.closedLabelSet].sort()) === JSON.stringify([...EXPECTED_LABELS].sort()), 'closed label set is invalid or broadened');
  }

  const manifest = fixture.manifest;
  check('MANIFEST-SHAPE', 'manifest declares the required canonical sha256 scope', manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest)
    && keysAre(manifest, ['algorithm', 'scope', 'canonicalization', 'sha256']), 'missing or extra manifest fields');
  if (manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest)) {
    const expectedDigest = fixtureObject && Array.isArray(fixtureBody.collections) ? sha256(stableJson(fixtureBody.collections)) : null;
    check('MANIFEST-CANONICALIZATION', 'manifest canonicalization is the declared sorted-key UTF-8 form', manifest.algorithm === 'sha256' && manifest.scope === 'fixture.collections' && manifest.canonicalization === EXPECTED_MANIFEST_CANONICALIZATION, 'manifest canonicalization is unsupported');
    check('MANIFEST-DIGEST', 'manifest digest matches fixture.collections', typeof manifest.sha256 === 'string' && manifest.sha256 === expectedDigest, 'fixture manifest digest mismatch');
  }

  return report(findings, { artifactType: 'synthetic-connector-fixture' });
}

export function validateContracts(planText, fixture) {
  const plan = validatePlanText(planText);
  const fixtureReport = validateFixtureContract(fixture);
  const findings = [
    ...plan.findings.map((item) => ({ ...item, contract: 'plan' })),
    ...fixtureReport.findings.map((item) => ({ ...item, contract: 'fixture' })),
  ];
  return report(findings, {
    schemaVersion: VALIDATION_SCHEMA,
    plan,
    fixture: fixtureReport,
  });
}

async function readInputs(planPath, fixturePath) {
  const [planText, fixtureText] = await Promise.all([readFile(planPath, 'utf8'), readFile(fixturePath, 'utf8')]);
  let fixture;
  try {
    fixture = JSON.parse(fixtureText);
  } catch {
    fixture = null;
  }
  return { planText, fixture };
}

export async function validateContractFiles(planPath, fixturePath) {
  try {
    const { planText, fixture } = await readInputs(planPath, fixturePath);
    return validateContracts(planText, fixture);
  } catch (error) {
    return {
      schemaVersion: VALIDATION_SCHEMA,
      outcome: 'REJECTED_WITH_EVIDENCE',
      valid: false,
      checkCount: 1,
      failedCount: 1,
      findings: [{ id: 'INPUT-READ', contract: 'inputs', status: 'FAIL', detail: error instanceof Error ? error.message : 'unable to read local contract inputs' }],
    };
  }
}

async function main() {
  const [planPath, fixturePath, ...extra] = process.argv.slice(2);
  if (!planPath || !fixturePath || extra.length > 0) {
    console.error('usage: node scripts/validate-synthetic-connector-spike-plan.mjs <plan.md> <fixture.json>');
    process.exitCode = 2;
    return;
  }
  const result = await validateContractFiles(planPath, fixturePath);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) await main();
