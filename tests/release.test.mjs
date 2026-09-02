import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const businessBiReleaseFiles = Object.freeze([
  'contracts/business-bi/v1/net-revenue.metric.json',
  'scripts/run-business-bi-holdout-clean-room.mjs',
  'services/bi-control/src/business-bi/net-revenue-plan.mjs',
  'services/bi-control/src/business-bi/net-revenue-readback.mjs',
  'tests/business-bi-metric-oracle.test.mjs',
  'tests/business-bi-net-revenue-plan.test.mjs',
  'tests/fixtures/business-bi/net-revenue-holdout-v1.json',
  'tests/fixtures/business-bi/net-revenue-oracle-v1.json',
  'verification/business-bi-net-revenue-holdout-v1.json',
]);
const businessBiFalsificationPathClasses = Object.freeze({
  public: Object.freeze([
    'README.md',
  ]),
  evidence: Object.freeze([
    'docs/evidence/business-bi-net-revenue-v1.md',
    'scripts/run-business-bi-falsification-clean-room.mjs',
    'tests/business-bi-clean-room.test.mjs',
    'tests/business-bi-epic-closure.test.mjs',
    'verification/business-bi-epic-closure-v1.json',
    'verification/business-bi-net-revenue-falsification-v1.json',
  ]),
});
const predecessorEvidenceSha256 = Object.freeze({
  'closure-audits/PORTFOLIO-KS146-ROOT-QS/exact-head-local-gate-receipt.json':
    '314459ef8ee132efb924c3aa95767127a94d20d91403747ac443b4706810c918',
  'verification/business-bi-net-revenue-holdout-v1.json':
    '9a962e48ea2d4252d208a03900a92bb4e0d337b9ae30fc2819b7dcce4ba445e7',
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}

test('release archive checksum is portable from a clean verifier directory', async () => {
  const buildDir = await mkdtemp(path.join(tmpdir(), 'sba-release-build-'));
  const verifyDir = await mkdtemp(path.join(tmpdir(), 'sba-release-verify-'));

  const build = run('node', ['scripts/build-release.mjs', buildDir], {
    cwd: root,
    env: { ...process.env, CM_BI_RELEASE_ALLOW_DIRTY: '1' },
  });
  assert.match(build.stdout, /^release-paths public=1 evidence=6\n/);

  const checksumPath = path.join(buildDir, 'KaleidoSphere-v0.26.0.tar.gz.sha256');
  const archivePath = path.join(buildDir, 'KaleidoSphere-v0.26.0.tar.gz');
  const checksum = await readFile(checksumPath, 'utf8');
  assert.match(checksum, /^[a-f0-9]{64}  KaleidoSphere-v0\.26\.0\.tar\.gz\n$/);
  assert.doesNotMatch(checksum.split(/\s+/)[1], /\//);

  await cp(checksumPath, path.join(verifyDir, path.basename(checksumPath)));
  await cp(archivePath, path.join(verifyDir, path.basename(archivePath)));
  run('sha256sum', ['-c', 'KaleidoSphere-v0.26.0.tar.gz.sha256'], { cwd: verifyDir });

  const listing = run('tar', ['-tzf', 'KaleidoSphere-v0.26.0.tar.gz'], { cwd: verifyDir }).stdout;
  assert(listing.includes('KaleidoSphere-v0.26.0/package.json\n'));
  for (const file of businessBiReleaseFiles) {
    assert(listing.includes(`KaleidoSphere-v0.26.0/${file}\n`), file);
  }
  const sourceMap = JSON.parse(await readFile('SOURCE-MAP.json', 'utf8'));
  assert.deepStrictEqual(
    sourceMap.releasePathClasses.businessBiFalsification,
    businessBiFalsificationPathClasses,
  );
  const classifiedPaths = Object.values(businessBiFalsificationPathClasses).flat();
  assert.equal(new Set(classifiedPaths).size, classifiedPaths.length);
  assert.equal(classifiedPaths.length, 7);
  for (const file of classifiedPaths) {
    assert(listing.includes(`KaleidoSphere-v0.26.0/${file}\n`), file);
  }
  for (const [file, expected] of Object.entries(predecessorEvidenceSha256)) {
    const archived = run('tar', [
      '-xOzf',
      'KaleidoSphere-v0.26.0.tar.gz',
      `KaleidoSphere-v0.26.0/${file}`,
    ], { cwd: verifyDir, encoding: null }).stdout;
    assert.equal(createHash('sha256').update(archived).digest('hex'), expected, file);
  }
  assert(!listing.includes('/.git/'));
  assert(!listing.includes('KaleidoSphere-v0.18.2/.env\n'));
  assert(!listing.includes('/node_modules/'));
  for (const entry of listing.split('\n').filter((line) => /\/\.(?:runtime|secrets)\//.test(line))) {
    assert.match(entry, /\/\.(?:runtime|secrets)\/(?:\.gitkeep)?$/);
  }

  for (const name of [
    'kaleidosphere-clawhub-skill-v0.26.0.tar.gz',
    'kaleidosphere-codex-plugin-v0.26.0.tar.gz',
    'kaleidosphere-claude-plugin-v0.26.0.tar.gz',
  ]) {
    await cp(path.join(buildDir, 'agent-skill-distribution', 'archives', `${name}.sha256`), path.join(verifyDir, `${name}.sha256`));
    await cp(path.join(buildDir, 'agent-skill-distribution', 'archives', name), path.join(verifyDir, name));
    run('sha256sum', ['-c', `${name}.sha256`], { cwd: verifyDir });
    const artifactListing = run('tar', ['-tzf', name], { cwd: verifyDir }).stdout;
    assert.match(artifactListing, /SKILL\.md\n/);
    assert.doesNotMatch(artifactListing, /\/\.\.|\.\.\//);
  }
});
