import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const ARTIFACT = 'docs/future/remote-connector/PRODUCT_BOUNDARY_THREAT_MODEL.md';

function section(markdown, heading, nextHeading) {
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing section ${heading}`);
  const end = nextHeading ? markdown.indexOf(nextHeading, start + heading.length) : markdown.length;
  assert.notEqual(end, -1, `missing section boundary ${nextHeading}`);
  return markdown.slice(start, end);
}

function tableRows(markdown, heading, nextHeading) {
  return section(markdown, heading, nextHeading)
    .split('\n')
    .filter((line) => /^\|/.test(line) && !/^\|\s*---/.test(line))
    .slice(1)
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

function ids(rows) {
  return rows.map(([first]) => first.match(/^(?:`)?([A-Z]+-\d{2}|F\d|TB\d)/)?.[1]);
}

test('FRC0 artifact keeps its discovery-only boundary and exact closed inventory', async () => {
  const document = await readFile(ARTIFACT, 'utf8');
  assert.match(document, /Status: FUTURE_BACKLOG — discovery-only planning artifact/);

  const intentSentence = document.match(/only in-bound KaleidoSphere intents remain exactly ([^.]+)\./)?.[1] ?? '';
  assert.deepEqual([...intentSentence.matchAll(/`([^`]+)`/g)].map((match) => match[1]), [
    'status', 'discovery', 'analyze', 'plan', 'preview', 'readback',
  ]);

  assert.deepEqual(ids(tableRows(document, '## 6. Directional data-flow inventory', '## 7. Trust boundaries')),
    ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9']);
  assert.deepEqual(ids(tableRows(document, '## 7. Trust boundaries', '### 7A. Authority and data-flow diagram')),
    ['TB1', 'TB2', 'TB3', 'TB4', 'TB5', 'TB6']);
  assert.deepEqual(ids(tableRows(document, '### 7C. Mandatory negative discovery cases', '## 8. Failure modes and ownership')),
    ['NEG-01', 'NEG-02', 'NEG-03', 'NEG-04', 'NEG-05', 'NEG-06']);
});

test('FRC0 threat register is complete and covers every STRIDE category', async () => {
  const document = await readFile(ARTIFACT, 'utf8');
  const threatSection = section(document, '### 7B. STRIDE-style threat register', '### 7C. Mandatory negative discovery cases');
  const rows = tableRows(document, '### 7B. STRIDE-style threat register', '### 7C. Mandatory negative discovery cases');
  assert.match(threatSection, /\| Threat ID \/ STRIDE \| Boundary \/ asset \| Scenario \| Precondition \| Impact class \| Fail-closed mitigation \| Detection evidence \| Owner \| Residual risk \| Explicit nonclaim \|/);
  assert.ok(rows.length > 0, 'threat register must have rows');
  assert.ok(rows.every((row) => row.length === 10 && row.every(Boolean)), 'every threat row must populate all ten columns');
  for (const category of ['Spoofing', 'Tampering', 'Repudiation', 'Information disclosure', 'Denial of service', 'Elevation of privilege']) {
    assert.ok(rows.some(([threat]) => threat.includes(category)), `missing STRIDE category ${category}`);
  }
});

test('FRC0 decision remains five options, reject-now blockers, and ungranted approvals', async () => {
  const document = await readFile(ARTIFACT, 'utf8');
  const options = tableRows(document, '## 12. Normalized option decision matrix', '### 12.1 Terminal recommendation for this discovery artifact');
  assert.equal(options.length, 5);
  assert.ok(options.every((row) => row.length === 9 && row.every(Boolean)), 'every option must populate all nine columns');
  assert.match(document, /Terminal recommendation: `DEFER\/REJECT-NOW`/);

  assert.deepEqual(ids(tableRows(document, '## 13. Implementation blocker register', '## 14. Required approval register')),
    ['BLK-01', 'BLK-02', 'BLK-03', 'BLK-04', 'BLK-05', 'BLK-06', 'BLK-07', 'BLK-08', 'BLK-09']);
  assert.match(document, /Every blocker is currently \*\*OPEN\*\*/);
  assert.deepEqual(ids(tableRows(document, '## 14. Required approval register', '## 15. Change control')),
    ['APR-01', 'APR-02', 'APR-03', 'APR-04', 'APR-05', 'APR-06', 'APR-07', 'APR-08']);
  assert.match(document, /All entries are \*\*NOT GRANTED \/ NOT EVIDENCED\*\*/);
});

test('FRC0 artifact contains no deployable or readiness-bearing material', async () => {
  const document = await readFile(ARTIFACT, 'utf8');
  assert.doesNotMatch(document, /\b(?:https?|wss?):\/\/\S+/i, 'actual URL or endpoint address');
  assert.doesNotMatch(document, /\b(?:api[_-]?key|client[_-]?secret|password|passwd|token|credential)\s*[:=]\s*["'`]?[A-Za-z0-9_./+@-]{6,}/i,
    'credential assignment or value');
  assert.doesNotMatch(document, /^\s*(?:docker(?:-compose)?|kubectl|helm|terraform|ansible-playbook|npm\s+(?:run\s+)?deploy|git\s+push)\b/im,
    'deployment command');
  assert.doesNotMatch(document, /\b(?:production[- ]ready|compliance[- ]ready|is compliant|implementation (?:is )?authorized|authorized for implementation)\b/i,
    'positive production, compliance, or implementation authorization claim');
  assert.match(document, /does not\n?>?\s*authorize implementation|does not authorize implementation/);
  assert.match(document, /No connector, MCP service, public endpoint[\s\S]*production posture, compliance readiness/);
});
