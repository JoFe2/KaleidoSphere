#!/usr/bin/env node
// KaleidoSphere #238 — fixture LOCKING for the order-source consumption surface.
//
// The fixtures this surface reads are the released synthetic ERP read export and its
// released read contract. They are RELEASED ARTEFACTS, not hand-written test data, so
// they are not edited here: this script re-derives them from the actual PAN dependency
// and LOCKS their digests, failing loudly if the released bytes ever drift.
//
// Run: node scripts/build-ks238-order-source-fixtures.mjs [--write]
//
// Without --write it VERIFIES. With --write it copies the released bytes in and prints
// the digests to paste into tests/ks238-order-source-consumption.test.mjs.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(here, '..');

const RELEASED = Object.freeze({
  exportBytes: {
    upstream: path.resolve(repoRoot, '../PANSPHAIRA-source/tests/fixtures/erp-read/supported-export-v1.json'),
    locked: path.resolve(repoRoot, 'tests/fixtures/business-bi/ks238-order-source/erp-supported-export-v1.json'),
    expectedSha256: '85194ec545b4f1e2e690b4353c6d97d1753bb6043171c00f55ca894fc6669278',
  },
  contract: {
    upstream: path.resolve(repoRoot, '../PANSPHAIRA-source/tests/fixtures/erp-read/contract-v1.json'),
    locked: path.resolve(repoRoot, 'tests/fixtures/business-bi/ks238-order-source/erp-read-contract-v1.json'),
    expectedSha256: '905c53b122a0dbd7c6b07fa5960bb04adc0523f9097587a3219e496cf8737d4f',
  },
});

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const write = process.argv.includes('--write');
let failed = false;

mkdirSync(path.dirname(RELEASED.exportBytes.locked), { recursive: true });

for (const [name, spec] of Object.entries(RELEASED)) {
  if (write) {
    if (!existsSync(spec.upstream)) {
      console.error(`MISSING upstream released artefact for ${name}: ${spec.upstream}`);
      failed = true;
      continue;
    }
    copyFileSync(spec.upstream, spec.locked);
    console.log(`WROTE ${name} -> ${spec.locked}`);
  }
  if (!existsSync(spec.locked)) {
    console.error(`MISSING locked fixture for ${name}: ${spec.locked}`);
    failed = true;
    continue;
  }
  const actual = sha256(spec.locked);
  const ok = actual === spec.expectedSha256;
  if (!ok) failed = true;
  console.log(`${ok ? 'LOCKED' : 'DRIFTED'} ${name} sha256=${actual} expected=${spec.expectedSha256}`);
}

if (failed) {
  console.error('KS238_ORDER_SOURCE_FIXTURE_LOCK_FAILED');
  process.exit(1);
}
console.log('KS238_ORDER_SOURCE_FIXTURE_LOCK_OK');
