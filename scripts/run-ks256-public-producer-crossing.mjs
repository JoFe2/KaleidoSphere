#!/usr/bin/env node
// Explicit opt-in public-only synthetic producer crossing. No implicit fixtures.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { crossPublicProducerStatus, PUBLIC_PAN_MAIN } from '../services/bi-control/src/business-bi/public-producer-status-crossing-v1.mjs';

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i < 0 ? null : args[i + 1] ?? null; };
const dir = arg('--pan-checkout');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const refused = (code) => { process.stdout.write(JSON.stringify({ outcome: 'DENIED', code, mutationCount: 0 }) + '\n'); process.exitCode = 1; };
if (!dir || args.length !== 2 || args[0] !== '--pan-checkout') {
  refused('PUBLIC_PRODUCER_CHECKOUT_REQUIRED');
} else {
  try {
    const root = realpathSync(dir);
    const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
    if (git('rev-parse', 'HEAD') !== PUBLIC_PAN_MAIN || git('status', '--porcelain') !== ''
      || git('rev-parse', '--show-toplevel') !== root) throw Error('PUBLIC_PRODUCER_SOURCE_UNVERIFIED');
    // Rebuild ignored dist from this verified tracked source; never load a stale local build.
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
    // The working tree must be byte-for-byte the exact named public commit;
    // independently select named fixture bytes rather than serialized results.
    const read = (rel) => {
      const absolute = realpathSync(path.join(root, rel));
      if (!absolute.startsWith(root + path.sep)) throw Error('PUBLIC_PRODUCER_SOURCE_UNVERIFIED');
      const bytes = readFileSync(absolute);
      if (sha(bytes) !== sha(execFileSync('git', ['-C', root, 'show', `HEAD:${rel}`])))
        throw Error('PUBLIC_PRODUCER_SOURCE_UNVERIFIED');
      return bytes;
    };
    const ksRead = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url));
    const ksJson = (rel) => JSON.parse(ksRead(rel).toString('utf8'));
    const pan461 = await import(pathToFileURL(path.join(root, 'src/pan461/lifecycle-inventory.mjs')).href);
    const pan471 = await import(pathToFileURL(path.join(root, 'src/pan471/capability-inventory.mjs')).href);
    const declaredContent = JSON.parse(read('tests/fixtures/pan461/declared-release-content-v1.json'));
    const fd = 'tests/fixtures/business-bi/ks256-lifecycle-transfer-status/';
    const result = crossPublicProducerStatus({ panMain: PUBLIC_PAN_MAIN, pan461, pan471,
      lifecycle: { declaredRelease: pan461.makeDeclaredRelease(declaredContent),
        observed: read('tests/fixtures/pan461/observed-running-v1.json'),
        persistentStores: JSON.parse(read('tests/fixtures/pan461/stores-v1.json')),
        keyRefs: JSON.parse(read('tests/fixtures/pan461/key-refs-v1.json')),
        artifacts: JSON.parse(read('tests/fixtures/pan461/artifacts-v1.json')),
        now: '2026-09-23T10:00:00Z' },
      capability: { contract: JSON.parse(read('tests/fixtures/erp-read/contract-v1.json')),
        sourceBytes: read('tests/fixtures/erp-read/supported-export-v1.json'),
        now: '2026-08-10T08:30:00Z' },
      project: { declaredProject: ksJson(fd + 'project-declaration-v1.json'),
        observedScope: ksJson(fd + 'observed-scope-v1.json'), transfer: ksJson(fd + 'transfer-v1.json'),
        quarantine: ksJson(fd + 'quarantine-v1.json'), lifecycleObservation: ksJson(fd + 'lifecycle-observation-v1.json'),
        retainedComparisonRows: ksJson('tests/fixtures/business-bi/net-revenue-segment-v1.json').rows,
        evidenceRevision: 'ks256-status-observation-v1', now: '2026-09-23T00:00:00.000Z',
        repoRoot: path.resolve(new URL('..', import.meta.url).pathname) } });
    if (result.outcome !== 'PROJECTED') refused(result.code);
    else process.stdout.write(JSON.stringify({ outcome: result.outcome, code: result.code,
      producerCrossing: result.producerCrossing, producerStatus: result.producerStatus,
      ksStatus: { lifecycle: result.ksBoard.lifecycle.state, lifecycleBasis: result.ksBoard.lifecycle.auditedBy,
        progress: result.ksBoard.progress, authority: result.ksBoard.authority,
        bindingDigest: result.ksBoard.bindingDigest }, crossingBindingDigest: result.crossingBindingDigest,
      mutationCount: result.mutationCount, nonClaims: result.nonClaims }) + '\n');
  } catch (error) { refused(error.message === 'PUBLIC_PRODUCER_SOURCE_UNVERIFIED' ? error.message : 'PUBLIC_PRODUCER_INPUT_UNAVAILABLE'); }
}
