#!/usr/bin/env node
// Opt-in only: both public producer checkouts and the pinned SQL runtime are required.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectPairedReadStatus } from '../services/bi-control/src/business-bi/paired-read-status-projection-v1.mjs';

const args = process.argv.slice(2);
const allowed = ['--pan-status-checkout', '--pan-read-checkout', '--pglite'];
const options = new Map();
const optional = ['--source-variant', '--target-snapshot', '--target-revision', '--target-observation-sha256'];
let invalid = args.length < 6 || args.length % 2 !== 0;
for (let i = 6; i < args.length; i += 2) {
  if (!optional.includes(args[i]) || options.has(args[i])) invalid = true;
  options.set(args[i], args[i + 1]);
}
const variant = options.get('--source-variant') ?? 'v1';
const targetSnapshot = options.has('--target-snapshot') ? { root: options.get('--target-snapshot'),
  revision: options.get('--target-revision'), expectedObservationSha256: options.get('--target-observation-sha256') } : undefined;
if (options.has('--target-snapshot') !== options.has('--target-revision')
    || (options.has('--target-observation-sha256') && !targetSnapshot)) invalid = true;
const deny = (code) => { process.stdout.write(JSON.stringify({ outcome: 'DENIED', code, mutationCount: 0 }) + '\n'); process.exitCode = 1; };
if (invalid || !["v1", "v3"].includes(variant)
    || args.slice(0, 6).some((x, i) => i % 2 === 0 && x !== allowed[i / 2])
    || args.some((x, i) => i % 2 === 1 && (!x || x.startsWith('--')))) {
  deny('KS256_PAIRED_INPUT_SCOPE_DENIED');
} else {
  const root = mkdtempSync(join(tmpdir(), 'ks256-paired-display-'));
  try {
    const answers = join(root, 'answers.txt');
    writeFileSync(answers, [
      'synth_x.pay_feed.pf_id', 'synth_x.pay_feed.val_dt', 'MINOR_UNITS',
      'synth_x.pay_feed.amt_a', 'EUR', 'R', 'V',
    ].join('\n') + '\n');
    const run = (script, rest) => {
      const child = spawnSync(process.execPath, [script, ...rest], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      if (child.error || child.status !== 0) throw Error('KS256_UPSTREAM_UNAVAILABLE');
      return JSON.parse(child.stdout);
    };
    const crossing = run('scripts/run-ks256-public-producer-crossing.mjs', ['--pan-checkout', args[1]]);
    if (crossing.outcome !== 'PROJECTED') throw Error('KS256_PRODUCER_STATUS_UNQUALIFIED');
    const fd = variant === "v3" ? "tests/fixtures/business-bi/ks247-second-source/"
      : "tests/fixtures/business-bi/ks246-unfamiliar-schema/";
    const version = variant === "v3" ? "v2" : "v1";
    const read = run('scripts/run-result-lineage-journey.mjs', [
      '--answers', answers, '--kind-decisions', fd + `kind-decisions-${version}.json`,
      '--business-semantics', fd + `business-semantics-${version}.json`,
      '--source-revision', `synthetic-unfamiliar-source-${version}`,
      '--source-variant', variant,
      ...(variant === "v3" ? ["--source", fd + "source-pay-feed-v2.json",
        "--expectation", fd + "independent-expectation-v2.json"] : []),
      '--producer-checkout', args[3], '--pglite', args[5],
    ]);
    const result = projectPairedReadStatus({ read, crossing, variant, targetSnapshot });
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.outcome === 'DENIED') process.exitCode = 1;
  } catch (error) { deny(error.message === 'KS256_PRODUCER_STATUS_UNQUALIFIED'
    ? error.message : 'KS256_UPSTREAM_UNAVAILABLE'); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
