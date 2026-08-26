import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function section(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start < 0) return '';
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(/^#{2,3} /m);
  return next < 0 ? rest : rest.slice(0, next);
}

const compact = (value) => value.replace(/\s+/g, ' ').trim();

function validateReadme(readme) {
  for (const value of [
    'Repository release',
    '`v0.24.0`',
    'bi-agent component',
    '`v0.18.1`',
    'External API contract',
    '`2.0.0`',
    '`bi.object.search.read`',
    '`bi.object.details.read`',
    '`bi.database.overview.read`',
    'local library/contract',
    'synthetic test evidence only',
    'JoFe2/kaleidosphere-dsh-plugin',
    'Developer Preview',
    'not part of the KaleidoSphere v0.24.0 release assets',
  ]) {
    const pattern = value.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    assert.match(readme, new RegExp(pattern, 'i'), `README surface missing: ${value}`);
  }

  const whatYouCanDo = section(readme, '## What you can do');
  const pilots = section(readme, '### Optional bounded pilots');
  const localContracts = section(readme, '### Local library/contract surfaces');
  const synthetic = section(readme, '### Synthetic test evidence only');
  const notClaimed = section(readme, '### Not claimed today');
  const dsh = section(readme, '## DSH and host integrations');
  const docs = section(readme, '## Docs');

  assert.equal(compact(whatYouCanDo), compact(`
    - Analyze Oracle or Microsoft SQL Server metadata with audited read-only query packs.
    - Build a versioned local catalog with receipt IDs, snapshot hashes, coverage states, and blind spots.
    - Ask bounded technical questions about size, statistics, dependencies, stored logic, and coverage.
    - Run guided BI requirements discovery and export a human/machine brief with catalog provenance.
    - Preview fixed managed Superset overview dashboards for system, table, code, and coverage views.
    - Collect a read-only Superset runtime fingerprint before future reviewed promotion planning.
    - Build, inspect, and fail-closed preflight a deterministic review-only promotion ZIP from confirmed evidence.
    - Validate promotion execution as **library/test evidence only** against an isolated synthetic owned metadata target; no shipped CLI, HTTP, or operator invocation path is claimed.
  `));
  assert.equal(compact(pilots), compact(`
    - Bounded PostgreSQL read-only metadata pilot with a frozen catalog pack and digest-pinned synthetic PostgreSQL 16.10 E2E/readback evidence. It is not a third \`BI_ENGINE\` option in the default Compose stack.
    - Explicitly allowlisted PostgreSQL null/distinct count profiling and single-column relationship-candidate evidence with observed/computed/inferred separation, deterministic Evidence Store and proposal-only rule plan/reports.
  `));
  assert.equal(compact(dsh), compact(`
    The AgentSkill above is instruction-only. The optional [\`JoFe2/kaleidosphere-dsh-plugin\`](https://github.com/JoFe2/kaleidosphere-dsh-plugin) is a separate **Developer Preview** for DeepSeek Harness rc.8. It is not part of the KaleidoSphere v0.24.0 release assets and adds no DSH dependency, loader or mapping to this repository. The plugin exposes six native \`kaleidosphere_*\` tools and vendors its own exact KaleidoSphere v0.16.0 subset; its compatibility, lifecycle and release status are governed in that repository.
  `));
  assert.equal(compact(synthetic), compact(`
    - Promotion execution, trusted-workflow apply/readback/rollback and ambiguous outcome reconciliation are exercised through local synthetic library tests. They have no shipped CLI or HTTP invocation path and do not authorize production/customer mutation.
  `));

  assert.match(pilots, /not a\s+third `BI_ENGINE` option in the default Compose stack/i);
  assert.match(localContracts, /do\s+not\s+extend\s+External API v2/i);
  assert.match(synthetic, /no shipped CLI or HTTP invocation path/i);
  assert.match(dsh, /not part\s+of the KaleidoSphere v0\.24\.0 release assets/i);
  assert.match(readme, /six closed External API v2 (?:actions|intents)/i);
  assert.match(readme, /bounded PostgreSQL[^\n]*pilot/i);

  const normalized = compact(readme);
  const withoutPilots = compact(readme.replace('### Optional bounded pilots', '').replace(pilots, ''));
  const withoutDsh = compact(readme.replace('## DSH and host integrations', '').replace(dsh, ''));
  const withoutPromotionOwners = compact(readme
    .replace(whatYouCanDo, '')
    .replace(localContracts, '')
    .replace(synthetic, '')
    .replace(notClaimed, '')
    .replace(docs, ''));
  assert.doesNotMatch(withoutPilots, /\b(?:PostgreSQL|Postgres)\b/i);
  assert.doesNotMatch(withoutDsh, /\bDSH\b|DeepSeek|kaleidosphere-dsh-plugin|native plugin/i);
  assert.doesNotMatch(withoutPromotionOwners, /promot(?:e|ed|es|ing|ions|ion(?!-bundle))|\/v2\/promotion|\.\/bin\/bi\s+promotion/i);
  assert.doesNotMatch(normalized, /BI_ENGINE\s*=\s*postgres|\/v2\/promotion|\.\/bin\/bi\s+promotion\s+apply|promotion(?:-bundle)?\s+(?:execute|apply)/i);
}

test('README distinguishes the v0.24 release surfaces and optional DSH preview', async () => {
  const [readme, rootPackage, agentPackage, compose, cli, server, contract] = await Promise.all([
    readFile('README.md', 'utf8'),
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('services/bi-agent/package.json', 'utf8').then(JSON.parse),
    readFile('compose.yaml', 'utf8'),
    readFile('bin/bi', 'utf8'),
    readFile('services/bi-agent/src/server.mjs', 'utf8'),
    readFile('services/bi-agent/src/object-capability-contract-v1.mjs', 'utf8'),
  ]);

  validateReadme(readme);
  assert.equal(rootPackage.version, '0.24.0');
  assert.equal(agentPackage.version, '0.18.1');
  assert.doesNotMatch(compose, /BI_ENGINE[^\n]*postgres/i);
  assert.doesNotMatch(cli, /promotion-bundle[^\n]*(?:execute|apply)/i);
  assert.doesNotMatch(server, /\/v2\/(?:search|details|overview)/i);
  for (const capability of ['bi.object.search.read', 'bi.object.details.read', 'bi.database.overview.read']) {
    assert.match(contract, new RegExp(capability.replaceAll('.', '\\.')));
  }
  assert.match(contract, /externalApiV2Changed:\s*false/);
});

test('README release-surface gate rejects contradictory overclaims', async () => {
  const readme = await readFile('README.md', 'utf8');
  for (const overclaim of [
    'The default Compose stack now accepts `BI_ENGINE=postgres` for PostgreSQL.',
    'The default Compose stack now supports\nPostgreSQL as a production engine.',
    'Operators can invoke promotion apply through `./bin/bi promotion apply` and POST `/v2/promotion/apply`.',
    'Operators can invoke promotion\napply through a public CLI.',
    'The v0.24.0 release archive bundles kaleidosphere-dsh-plugin.',
    'The v0.24.0 release archive bundles\nthe kaleidosphere-dsh-plugin.',
    'Operators can execute promotions through the public CLI.',
    'A public operator command now runs the promotion workflow end to end.',
    'The shipped server lets operators execute synthetic promotions.',
    'Postgres is now a supported production database engine.',
    'DeepSeek rc.8 integration ships in this release archive.',
    'The release includes the separate DSH plugin.',
  ]) {
    assert.throws(() => validateReadme(`${readme}\n${overclaim}\n`), undefined, overclaim);
  }
});
